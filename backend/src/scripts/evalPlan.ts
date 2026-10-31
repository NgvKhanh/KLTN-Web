// Script danh gia LOP 2 - chia viec ca danh sach (buoc 9, ASSIGN_MODULE.md §10.10/§11). CHAY TAY, khong nam trong bo test:
//
//   npm run eval:plan -- --out=eval-plan-result.md
//   npm run eval:plan -- --seeds=5 --out=eval-plan-result.md   (chay thu, khong dung de trich dan)
//
//   --seeds=N   so hat giong (2..20, mac dinh 20: 3001..3000+N) - TACH KHOI 2001-2020 cua lop 1 (buoc 7)
//   --out=FILE  bao cao so sanh (.md) + FILE.json (du lieu tho tung hat giong)
//
// Khong can bo nho dem nhu evaluateAssign.ts: moi luot chay chi mat vai giay (khong quet luoi tham so lon).
// KHONG ghi DB, KHONG import prisma, KHONG mang. Tat dinh: cung tham so -> cung so.

import fs from 'node:fs';
import type { MissingPolicy } from '../modules/assign/assign.score';
import { datasetFingerprint, type PlanArmResult, type PlanReportMeta, type KSweepPoint } from './evalPlanReport';
import { buildPlanReport } from './evalPlanReport';
import { runArmOnBatch, scoreRows, summarizeBatch, meanSummaries, PLAN_ARMS, PLAN_EVAL_SEEDS, runPlanArmOnDataset, type PlanArmId, type PlanBatchSummary } from './evalPlanRun';
import { cutBatches, PLAN_BATCH_DAYS, PLAN_BATCH_K } from './evalPlanBatches';
import { DEFAULT_LOAD_PENALTY, DEFAULT_SIM, generateSimulation, type SimDataset } from './simGenerator';

interface Args {
  seeds: number;
  out: string | null;
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
    if (!['seeds', 'out'].includes(k)) fail(`tham so la "--${k}"`);
  }
  const seeds = Number(opts.get('seeds') ?? String(PLAN_EVAL_SEEDS.length));
  if (!Number.isInteger(seeds) || seeds < 2 || seeds > PLAN_EVAL_SEEDS.length) fail(`--seeds phai la so nguyen 2..${PLAN_EVAL_SEEDS.length}`);
  return { seeds, out: opts.get('out') ?? null };
}

const log = (line: string) => console.error(line);

const K_SWEEP_VALUES = [6, 12, 24];

function armResult(id: PlanArmId, datasets: readonly SimDataset[]): PlanArmResult {
  const spec = PLAN_ARMS.find((a) => a.id === id)!;
  const perSeed = datasets.map((d) => {
    const s = runPlanArmOnDataset(d, id, PLAN_BATCH_DAYS, PLAN_BATCH_K);
    if (!s) throw new Error(`nhanh ${id}: khong cat duoc dot nao tu hat giong ${d.config.seed}`);
    return s;
  });
  return { id, label: spec.label, perSeed };
}

function armResultAtK(id: PlanArmId, k: number, datasets: readonly SimDataset[]): PlanArmResult {
  const spec = PLAN_ARMS.find((a) => a.id === id)!;
  const perSeed = datasets.map((d) => {
    const s = runPlanArmOnDataset(d, id, PLAN_BATCH_DAYS, k);
    if (!s) throw new Error(`nhanh ${id} (K=${k}): khong cat duoc dot nao tu hat giong ${d.config.seed}`);
    return s;
  });
  return { id, label: `${spec.label} (K=${k})`, perSeed };
}

function plannedWithMissing(missing: MissingPolicy, datasets: readonly SimDataset[]): PlanArmResult {
  const perSeed: PlanBatchSummary[] = datasets.map((d) => {
    const batches = cutBatches(d, PLAN_BATCH_DAYS, PLAN_BATCH_K);
    if (batches.length === 0) throw new Error(`planned/${missing}: khong cat duoc dot nao tu hat giong ${d.config.seed}`);
    const summaries = batches.map((b) => {
      const batch = { ...b, ctx: { ...b.ctx, missing } };
      return summarizeBatch(scoreRows(runArmOnBatch(batch, 'planned'), batch), batch.poolKeys);
    });
    return meanSummaries(summaries);
  });
  return { id: 'planned', label: `Cách đã cài, thiếu dữ liệu = ${missing}`, perSeed };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const seeds = PLAN_EVAL_SEEDS.slice(0, args.seeds);
  const t0 = Date.now();
  const datasets = seeds.map((seed) => generateSimulation({ ...DEFAULT_SIM, seed }));
  log(`Da sinh ${datasets.length} bo du lieu sau ${((Date.now() - t0) / 1000).toFixed(1)} s`);

  const mainResults = PLAN_ARMS.map((spec) => armResult(spec.id, datasets));
  log('Da chay 7 cach chia tren cau hinh mac dinh (K=12, ngay 90/150/210)');

  const kSweep: KSweepPoint[] = K_SWEEP_VALUES.map((k) => ({
    k,
    planned: armResultAtK('planned', k, datasets),
    independent: armResultAtK('independent', k, datasets),
  }));
  log(`Da quet K = ${K_SWEEP_VALUES.join(', ')}`);

  const missingPolicy = { drop: plannedWithMissing('DROP', datasets), neutral: plannedWithMissing('NEUTRAL', datasets) };
  log('Da so sanh DROP / NEUTRAL');

  const finger = datasetFingerprint(datasets);
  const meta: PlanReportMeta = {
    date: new Date().toISOString().slice(0, 10),
    seeds,
    datasetSha256: finger.combined,
    batchDays: PLAN_BATCH_DAYS,
    batchK: PLAN_BATCH_K,
    loadPenalty: DEFAULT_LOAD_PENALTY,
  };
  const report = buildPlanReport({ meta, main: mainResults, kSweep, missingPolicy });
  console.log(report);
  if (args.out !== null) {
    fs.writeFileSync(args.out, report, 'utf8');
    fs.writeFileSync(
      `${args.out}.json`,
      JSON.stringify({ meta, datasetSha256PerSeed: finger.perSeed, main: mainResults, kSweep, missingPolicy }),
      'utf8'
    );
    log(`Da ghi ${args.out} va ${args.out}.json`);
  }
}

main();
