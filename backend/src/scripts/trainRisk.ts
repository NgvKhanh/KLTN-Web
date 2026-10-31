// Hoc mo hinh canh bao tre han (RISK_MODULE.md §6.1, buoc 5). Chay: `npm run risk:train` trong backend/.
//
//   1) 40 the gioi HOC (6001-6040) -> anh chup + priors;  2) 20 the gioi DEV (6101-6120) -> anh chup (dung priors cua tap hoc);
//   3) moi lambda trong luoi: hoc tren tap hoc, do log-loss + AUC tren dev;  4) chon lambda co log-loss dev nho nhat (hoa -> lambda
//   LON hon, mo hinh don gian hon);  5) hoc lai tren TAP HOC voi lambda da chon (khong tron dev vao) -> ghi tep mo hinh.
// Moi lan hoc deu RANG BUOC DAU he so theo FEATURE_SIGNS (§6.1, chot o buoc 5 tren dev).
// Hat giong XAC NHAN (6201-6220) KHONG duoc dung o day.
// `--sim=v2` (buoc 11, §20): cung quy trinh tren bo mo phong v2 - hoc 7001-7040, dev 7101-7120 -> model/risk-model.v2.json;
// tep v1 giu nguyen tung byte (khong co khoa training.sim).
// `--model=v3` (buoc 16, §21): mo phong v2, chi 4 yeu to (CORE_FEATURES) -> model/risk-model.v3.json; cot khong dung co he so 0.
// `--model=v4` (buoc 21, §22): mo phong v2, trang thai + so ngay con lai thay tien do (STATUS_TIME_INPUTS) -> model/risk-model.v4.json;
// tep chi ghi 9 dau vao no dung (dau vao theo ten).

import fs from 'node:fs';
import path from 'node:path';
import {
  CORE_FEATURES,
  FEATURE_NAMES,
  FEATURE_SIGNS,
  INPUT_SIGNS,
  STATUS_TIME_INPUTS,
  inputVector,
  type ExtractedFeatures,
  type FeatureName,
  type InputName,
} from '../modules/risk/risk.features';
import { DEFAULT_TRAIN, predictProbability, type LogisticModel, type RiskModelFile, type TrainOptions } from '../modules/risk/risk.model';
import { buildEvalSet, buildTrainSet, expandModel, metricsOf, scoreRows, trainArm, type ArmName } from './riskEval';
import { mean } from './evalAssignStats';
import { hashRows } from './riskSnapshots';
import { CONFIRM_SEEDS_V3, CONFIRM_SEEDS_V4, seedsOf, type SimVersion } from './riskSimV2';

export const LAMBDA_GRID = [0.001, 0.01, 0.1, 1] as const;

/**
 * Cac mo hinh: v1 (mo phong v1, 15 dac trung), v2 (mo phong v2, 15 dac trung), v3 (mo phong v2, 4 yeu to - §21),
 * v4 (mo phong v2, trang thai + so ngay con lai thay tien do - §22).
 */
export type ModelKey = 'v1' | 'v2' | 'v3' | 'v4';

export interface ModelSpec {
  version: string;
  sim: SimVersion;
  features: readonly InputName[];
  /** true: tep chi ghi cac dau vao no dung (v4); khong co: tep du 15 cot theo FEATURE_NAMES (v3 mo rong bang expandModel). */
  compact?: boolean;
  /** Nhanh moc so cua P2 (mac dinh "thoi gian + tien do"; v4: "thoi gian + trang thai"). */
  p2Arm?: ArmName;
  /** Hat giong xac nhan cua mo hinh (v3 dung dai moi vi 7201-7220 da dung mot lan o buoc 12). */
  confirm: readonly number[];
  /** Mo hinh lien truoc - de so sanh (P4v3 trong evalRisk, bang 1b trong riskBacktestDb). */
  previous?: ModelKey;
  file: string;
}

const modelFile = (name: string) => path.resolve(__dirname, '../modules/risk/model', name);

export const MODEL_SPECS: Readonly<Record<ModelKey, ModelSpec>> = {
  v1: { version: 'logreg-v1', sim: 'v1', features: FEATURE_NAMES, confirm: seedsOf('v1').confirm, file: modelFile('risk-model.v1.json') },
  v2: { version: 'logreg-v2', sim: 'v2', features: FEATURE_NAMES, confirm: seedsOf('v2').confirm, previous: 'v1', file: modelFile('risk-model.v2.json') },
  v3: { version: 'logreg-v3', sim: 'v2', features: CORE_FEATURES, confirm: CONFIRM_SEEDS_V3, previous: 'v2', file: modelFile('risk-model.v3.json') },
  v4: {
    version: 'logreg-v4',
    sim: 'v2',
    features: STATUS_TIME_INPUTS,
    compact: true,
    p2Arm: 'timeStatus',
    confirm: CONFIRM_SEEDS_V4,
    previous: 'v3',
    file: modelFile('risk-model.v4.json'),
  },
};
const MODEL_KEYS: readonly ModelKey[] = ['v1', 'v2', 'v3', 'v4'];
export const MODEL_VERSIONS = Object.fromEntries(MODEL_KEYS.map((k) => [k, MODEL_SPECS[k].version])) as Readonly<Record<ModelKey, string>>;
export const MODEL_PATHS = Object.fromEntries(MODEL_KEYS.map((k) => [k, MODEL_SPECS[k].file])) as Readonly<Record<ModelKey, string>>;
export const MODEL_VERSION = MODEL_VERSIONS.v1;
export const MODEL_PATH = MODEL_PATHS.v1;

/** Doc `--sim=v1|v2` tu dong lenh (mac dinh v1). */
export function simArg(argv: readonly string[] = process.argv): SimVersion {
  const v = argv.find((a) => a.startsWith('--sim='))?.slice('--sim='.length) ?? 'v1';
  if (v !== 'v1' && v !== 'v2') throw new RangeError(`--sim phai la v1 hoac v2, nhan ${v}`);
  return v;
}

/** Doc `--model=v1|v2|v3|v4`; khong co thi theo `--sim=` nhu truoc (v1 / v2). */
export function modelArg(argv: readonly string[] = process.argv): ModelKey {
  const v = argv.find((a) => a.startsWith('--model='))?.slice('--model='.length);
  if (v === undefined) return simArg(argv);
  if (!(MODEL_KEYS as readonly string[]).includes(v)) throw new RangeError(`--model phai la ${MODEL_KEYS.join(' / ')}, nhan ${v}`);
  return v as ModelKey;
}

const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

export function trainRiskModel(log: (s: string) => void = console.log, key: ModelKey = 'v1'): RiskModelFile {
  const t0 = Date.now();
  const spec = MODEL_SPECS[key];
  const seeds = seedsOf(spec.sim);
  const train = buildTrainSet(seeds.train, spec.sim);
  const dev = buildEvalSet(seeds.dev, train.priors, spec.sim);
  const devRows = dev.flatMap((d) => d.rows);
  log(`tap hoc: ${train.rows.length} anh chup (${train.rows.filter((r) => r.y === 1).length} tre); dev: ${devRows.length} anh chup; ${Date.now() - t0} ms`);

  // Du doan bang mo hinh hoc tren tap con dac trung cua spec (du 15 thi project giu nguyen vector -> tep v1/v2 khong doi)
  const predictor = (m: LogisticModel) => (f: ExtractedFeatures) => predictProbability(m, inputVector(f, spec.features));
  const grid = LAMBDA_GRID.map((lambda) => {
    const opts: TrainOptions = { ...DEFAULT_TRAIN, lambda };
    const m = trainArm(train.rows, spec.features, opts);
    const pooled = metricsOf(scoreRows(devRows, predictor(m)));
    const perSeed = dev.map((d) => metricsOf(scoreRows(d.rows, predictor(m))).auc ?? Number.NaN);
    const row = { lambda, devLogLoss: r4(pooled.logLoss), devAucMean: r4(mean(perSeed.filter(Number.isFinite))), devBrier: r4(pooled.brier) };
    log(`  lambda ${lambda}: log-loss dev ${row.devLogLoss}, AUC dev (tb hat giong) ${row.devAucMean}, Brier ${row.devBrier}`);
    return row;
  });
  const best = [...grid].sort((a, b) => a.devLogLoss - b.devLogLoss || b.lambda - a.lambda)[0]!;
  // Tep gon (v4): he so + chieu theo dung cac dau vao; tep 15 cot (v1-v3): chieu theo FEATURE_NAMES nhu cu (tep khong doi)
  const columns: readonly InputName[] = spec.compact ? spec.features : FEATURE_NAMES;
  const signs = spec.compact ? columns.map((n) => INPUT_SIGNS[n]) : FEATURE_NAMES.map((n) => FEATURE_SIGNS[n]);
  const opts: TrainOptions = { ...DEFAULT_TRAIN, lambda: best.lambda, signs };
  const sub = trainArm(train.rows, spec.features, opts);
  const model = spec.compact ? sub : expandModel(sub, spec.features as FeatureName[]);
  const devMetrics = metricsOf(scoreRows(devRows, (f) => predictProbability(model, inputVector(f, columns))));
  log(`chon lambda = ${best.lambda}; ${Date.now() - t0} ms`);

  return {
    version: spec.version,
    features: [...columns],
    mean: model.mean,
    std: model.std,
    weights: model.weights,
    bias: model.bias,
    train: opts,
    priors: train.priors,
    training: {
      seeds: [...seeds.train],
      rows: train.rows.length,
      positives: train.rows.filter((r) => r.y === 1).length,
      sha256: hashRows(train.rows),
      ...(spec.sim === 'v2' ? { sim: spec.sim } : {}),
      ...(!spec.compact && spec.features.length < FEATURE_NAMES.length ? { features: [...spec.features] } : {}),
    },
    metrics: {
      lambdaGrid: grid,
      devSeeds: [...seeds.dev],
      dev: { rows: devRows.length, logLoss: r4(devMetrics.logLoss), brier: r4(devMetrics.brier), ece: r4(devMetrics.ece), auc: devMetrics.auc === null ? null : r4(devMetrics.auc) },
    },
  };
}

if (require.main === module) {
  const key = modelArg();
  const file = trainRiskModel(console.log, key);
  const outPath = MODEL_PATHS[key];
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(file, null, 2)}\n`, 'utf8');
  console.log(`da ghi ${path.relative(process.cwd(), outPath)}`);
  console.log('he so (sau chuan hoa):');
  file.features.forEach((n, j) => console.log(`  ${n.padEnd(22)} ${file.weights[j]!.toFixed(4)}`));
  console.log(`  ${'bias'.padEnd(22)} ${file.bias.toFixed(4)}`);
}
