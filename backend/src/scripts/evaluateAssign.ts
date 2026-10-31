// Script danh gia module goi y phan cong (buoc 7, ASSIGN_MODULE.md §11). CHAY TAY, khong nam trong bo test:
//
//   npm run eval:assign -- --exp=arms --out=eval-assign-result.md
//   npm run eval:assign -- --exp=params,norm --seeds=5
//   npm run eval:assign -- --exp=all --out=eval-assign-result.md --out-sweeps=eval-assign-sweeps.md
//   npm run eval:assign -- --exp=report --out=eval-assign-result.md --out-sweeps=eval-assign-sweeps.md   (chi dung lai ket qua da nho)
//
//   --exp=LIST     arms | params | norm | weights | world | robust | learn | text | all | report  (co the liet ke, cach nhau dau phay)
//                  arms    so sanh cac nhanh (vong kin + doi chieu phat lai lich su)            -> bao cao --out        (buoc 7a)
//                  params  quet H, K, m, m_e, simMin, suc chua gia dinh                          -> bao cao --out-sweeps (buoc 7b)
//                  norm    chuan hoa x thieu du lieu (DROP / NEUTRAL, nguoi moi)
//                  weights luoi trong so
//                  world   muc phat tai va mat do viec cua the gioi
//                  robust  do ben truoc cac nguon lech cua bo sinh
//                  learn   hoc trong so: duong hoi tu, toc do hoc, gu ngoai khong gian dac trung, anh huong khach quan
//                  text    bi-gram va trong so tieu de tren 20 hat giong
//                  report  khong chay gi, chi dung bao cao tu ket qua da nho
//   --seeds=N      so hat giong (2..20, mac dinh 20: 2001..2000+N)
//   --out=FILE            bao cao so sanh nhanh (.md) + FILE.json (du lieu tho tung hat giong)
//   --out-sweeps=FILE     bao cao 7b (.md) + FILE.json; duong hoi tu ghi ra FILE (bo .md) + "-hoitu.csv" / "-hoitu.svg"
//   --cache-dir=DIR       thu muc nho ket qua tung thi nghiem (mac dinh .eval-assign-cache); cho phep chay tung phan / song song
//   --refresh=1           bo qua bo nho, chay lai
//
// KHONG ghi DB, KHONG import prisma, KHONG mang. Tat dinh: cung tham so -> cung so.

import fs from 'node:fs';
import path from 'node:path';
import { AssignEvaluationCache, sourceFingerprint } from './evalAssignCache';
import { ABLATION_ARMS, MAIN_ARMS, type Arm, type ArmSpec } from './evalAssignArms';
import { buildArmsReport, datasetFingerprint, type ArmResult, type ReportMeta } from './evalAssignReport';
import {
  convergenceCsv,
  convergenceSeries,
  convergenceSvg,
  buildSweepReport,
  type CurveSeries,
  type SweepReportInput,
} from './evalAssignReportSweeps';
import {
  etaSweepPoints,
  loadPenaltyPoints,
  mainLearningPoints,
  makeDatasetProvider,
  normalizationPoints,
  paramSweepPoints,
  rawSpacePoints,
  robustnessPoints,
  runLearnedObjective,
  runLearning,
  runSweep,
  runTextVariants,
  densityPoints,
  weightsGridPoints,
  type DatasetProvider,
  type LearningResult,
  type ObjectiveResult,
} from './evalAssignExperiments';
import { PERSONAS, type PersonaId } from './evalAssignLeader';
import { DEFAULT_MIN_DAY, EVAL_SEEDS, bestSkillArm, oracleArm, runArm, type RunMode } from './evalAssignRun';
import { LEARN_ETA } from '../modules/assign/assign.learn';
import { DEFAULT_LOAD_PENALTY, type SimDataset } from './simGenerator';

const EXPS = ['arms', 'params', 'norm', 'weights', 'world', 'robust', 'learn', 'text'] as const;
type Exp = (typeof EXPS)[number];

interface Args {
  exps: Exp[];
  reportOnly: boolean;
  seeds: number;
  out: string | null;
  outSweeps: string | null;
  cacheDir: string;
  refresh: boolean;
}

function fail(message: string): never {
  console.error(`Loi tham so: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const opts = new Map<string, string>();
  for (const a of argv) {
    const m = /^--([a-z-]+)=(.*)$/.exec(a);
    if (!m) fail(`khong hieu "${a}" (dung --ten=gia-tri)`);
    opts.set(m[1]!, m[2]!);
  }
  for (const k of opts.keys()) {
    if (!['exp', 'seeds', 'out', 'out-sweeps', 'cache-dir', 'refresh'].includes(k)) fail(`tham so la "--${k}"`);
  }
  const expOpt = opts.get('exp') ?? 'arms';
  let exps: Exp[] = [];
  let reportOnly = false;
  if (expOpt === 'all') exps = [...EXPS];
  else if (expOpt === 'report') reportOnly = true;
  else {
    for (const name of expOpt.split(',').map((s) => s.trim())) {
      const e = EXPS.find((x) => x === name);
      if (!e) fail(`--exp phai la ${EXPS.join('|')}|all|report, nhan "${name}"`);
      if (!exps.includes(e)) exps.push(e);
    }
  }
  const seeds = Number(opts.get('seeds') ?? String(EVAL_SEEDS.length));
  if (!Number.isInteger(seeds) || seeds < 2 || seeds > EVAL_SEEDS.length) fail(`--seeds phai la so nguyen 2..${EVAL_SEEDS.length}`);
  return {
    exps,
    reportOnly,
    seeds,
    out: opts.get('out') ?? null,
    outSweeps: opts.get('out-sweeps') ?? null,
    cacheDir: opts.get('cache-dir') ?? '.eval-assign-cache',
    refresh: opts.get('refresh') === '1',
  };
}

const log = (line: string) => console.error(line);

// ---------- 7a: so sanh cac nhanh ----------

interface ArmsData {
  closed: ArmResult[];
  history: ArmResult[];
}

/** Nhanh tham chieu cung la mot ArmSpec: id / nhan lay tu chinh nhanh. */
const refSpec = (make: () => Arm): ArmSpec => {
  const a = make();
  return { id: a.id, label: a.label, make };
};

function runAll(specs: readonly ArmSpec[], datasets: readonly SimDataset[], mode: RunMode): ArmResult[] {
  return specs.map((spec) => {
    const t0 = Date.now();
    const perSeed = datasets.map((d) => runArm(d, spec.make, { mode }).summary);
    log(`[${mode}] ${spec.id}: ${datasets.length} hat giong, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    return { id: spec.id, label: spec.label, perSeed };
  });
}

function computeArms(datasets: readonly SimDataset[]): ArmsData {
  const refSpecs = [refSpec(bestSkillArm), refSpec(oracleArm)];
  return {
    closed: runAll([...MAIN_ARMS, ...ABLATION_ARMS, ...refSpecs], datasets, 'ARM'),
    history: runAll([...MAIN_ARMS, ...refSpecs], datasets, 'HISTORY'),
  };
}

// ---------- 7b ----------

interface LearnData {
  main: LearningResult[];
  eta: LearningResult[];
  raw: LearningResult[];
  objective: ObjectiveResult[];
}

const OBJECTIVE_PERSONAS: PersonaId[] = ['expert', 'reliable', 'free'];

function computeLearn(seeds: readonly number[], provider: DatasetProvider): LearnData {
  return {
    main: runLearning(seeds, mainLearningPoints(LEARN_ETA), provider, log),
    eta: runLearning(seeds, etaSweepPoints(), provider, log),
    raw: runLearning(seeds, rawSpacePoints(LEARN_ETA), provider, log),
    objective: OBJECTIVE_PERSONAS.map((p) => runLearnedObjective(seeds, p, 0.1, provider)),
  };
}

/** Duong hoi tu de ve: ba gu co "loi" de hoc, moi gu hai muc nhieu (0 va 0,25). */
function curves(learn: LearnData): CurveSeries[] {
  const out: CurveSeries[] = [];
  for (const persona of OBJECTIVE_PERSONAS) {
    for (const noise of [0, 0.25]) {
      const r = learn.main.find((x) => x.point.persona === persona && x.point.noise === noise);
      if (r) out.push(convergenceSeries(r, `${PERSONAS[persona].label} · nhiễu ${String(noise).replace('.', ',')}`));
    }
  }
  return out;
}

function writeSweepOutputs(args: Args, report: string, input: SweepReportInput, learn: LearnData | undefined): void {
  if (args.outSweeps === null) return;
  fs.writeFileSync(args.outSweeps, report, 'utf8');
  fs.writeFileSync(`${args.outSweeps}.json`, JSON.stringify(input), 'utf8');
  if (learn) {
    const base = args.outSweeps.replace(/\.md$/, '');
    fs.writeFileSync(`${base}-hoitu.csv`, convergenceCsv(convergenceSeriesAll(learn)), 'utf8');
    fs.writeFileSync(`${base}-hoitu.svg`, convergenceSvg(curves(learn)), 'utf8');
    log(`Da ghi ${base}-hoitu.csv va ${base}-hoitu.svg`);
  }
  log(`Da ghi ${args.outSweeps} va ${args.outSweeps}.json`);
}

/** CSV chua CA 12 cau hinh cua bang chinh (bieu do chi ve 6). */
function convergenceSeriesAll(learn: LearnData): CurveSeries[] {
  return learn.main.map((r) =>
    convergenceSeries(r, `${PERSONAS[r.point.persona].label} · nhiễu ${String(r.point.noise).replace('.', ',')}`)
  );
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const seeds = EVAL_SEEDS.slice(0, args.seeds);
  const provider = makeDatasetProvider();
  const defaults = seeds.map((s) => provider(s, undefined));
  const finger = datasetFingerprint(defaults);
  const backendDir = path.resolve(__dirname, '../..');
  const sourceSha256 = sourceFingerprint(__filename, ['package.json', 'package-lock.json', 'tsconfig.json'].map((file) => path.join(backendDir, file)));
  const meta: ReportMeta = {
    date: new Date().toISOString().slice(0, 10),
    seeds,
    datasetSha256: finger.combined,
    minDay: DEFAULT_MIN_DAY,
    loadPenalty: DEFAULT_LOAD_PENALTY,
    sourceSha256,
    nodeVersion: process.version,
  };
  const cache = new AssignEvaluationCache(args.cacheDir, {
    sourceSha256,
    datasetSha256: finger.combined,
    datasetSha256PerSeed: finger.perSeed,
    seeds,
    minDay: DEFAULT_MIN_DAY,
    loadPenalty: DEFAULT_LOAD_PENALTY,
    nodeVersion: process.version,
  }, log);
  const experimentRuns: Record<string, string> = {};

  const run = (name: Exp) => !args.reportOnly && args.exps.includes(name);
  const result = <T>(name: Exp, compute: () => T): T | undefined => {
    const entry = run(name) ? cache.run(name, compute, args.refresh) : cache.load<T>(name);
    if (entry) experimentRuns[name] = entry.completedAt;
    return entry?.data;
  };

  // ----- Chay / nap tung thi nghiem -----
  const arms = result('arms', () => computeArms(defaults));
  const params = result('params', () => runSweep(seeds, paramSweepPoints(), provider, log));
  const norm = result('norm', () => runSweep(seeds, normalizationPoints(), provider, log));
  const weights = result('weights', () => runSweep(seeds, weightsGridPoints(), provider, log));
  const world = result('world', () => ({
    penalty: runSweep(seeds, loadPenaltyPoints(), provider, log),
    density: runSweep(seeds, densityPoints(), provider, log),
  }));
  const robust = result('robust', () => runSweep(seeds, robustnessPoints(), provider, log));
  const learn = result('learn', () => computeLearn(seeds, provider));
  const text = result('text', () => runTextVariants(seeds, provider));
  const hasSweeps = !!(params || norm || weights || world || robust || learn || text);
  if ((!arms && !hasSweeps) || (args.out !== null && !arms) || (args.outSweeps !== null && !hasSweeps)) {
    console.error('Khong du ket qua cache hop le de tao bao cao yeu cau. Chay lai --exp=arms / cac thi nghiem can thiet / --exp=all voi cung --seeds va --cache-dir.');
    process.exit(1);
  }

  // ----- Bao cao 7a -----
  if (arms) {
    const armsMeta: ReportMeta = { ...meta, experimentRuns: { arms: experimentRuns.arms! } };
    const report = buildArmsReport({ meta: armsMeta, closed: arms.closed, history: arms.history });
    console.log(report);
    if (args.out !== null) {
      fs.writeFileSync(args.out, report, 'utf8');
      fs.writeFileSync(`${args.out}.json`, JSON.stringify({ meta: armsMeta, datasetSha256PerSeed: finger.perSeed, ...arms }), 'utf8');
      log(`Da ghi ${args.out} va ${args.out}.json`);
    }
  }

  // ----- Bao cao 7b (chi nhung muc co ket qua) -----
  const input: SweepReportInput = {
    meta: { ...meta, experimentRuns: Object.fromEntries(Object.entries(experimentRuns).filter(([name]) => name !== 'arms')) },
    params,
    norm,
    weights,
    penalty: world?.penalty,
    density: world?.density,
    robust,
    learn,
    text,
  };
  if (hasSweeps) {
    const report = buildSweepReport(input);
    console.log('\n' + report);
    writeSweepOutputs(args, report, input, learn);
  }
}

main();
