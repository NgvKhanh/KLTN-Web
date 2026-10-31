// Hoi quy logistic (RISK_MODULE.md §6.1). HAM THUAN, TypeScript thuan, khong thu vien hoc may.
//
//   p = sigma(b + sum_j w_j * z_j),   z_j = (x_j - mean_j) / std_j   (mean/std lay tu TAP HOC; std = 0 -> 1)
//   Hoc: gradient descent theo lo tren  L = trung binh log-loss + lambda * sum_j w_j^2  (khong phat b).
//   Khoi tao 0, toc do hoc co dinh, so vong co dinh -> TAT DINH: cung tap hoc ra cung he so tung bit.

import { INPUT_NAMES, INPUT_SIGNS, type InputName, type RiskPriors } from './risk.features';

export interface TrainOptions {
  lambda: number;
  iterations: number;
  learningRate: number;
  /**
   * Rang buoc dau tung he so (+1 / -1 / 0 = tu do), cung thu tu voi dac trung. Sau moi buoc, he so sai chieu bi dat ve 0
   * (gradient chieu - projected gradient descent; bai toan van loi nen van hoi tu). Bo trong = khong rang buoc.
   */
  signs?: readonly number[];
}

export const DEFAULT_TRAIN: Readonly<TrainOptions> = { lambda: 0.01, iterations: 2000, learningRate: 0.1 };

export interface LogisticModel {
  mean: number[];
  std: number[];
  weights: number[];
  bias: number;
}

/** Noi dung tep model/risk-model.v1.json, risk-model.v2.json. */
export interface RiskModelFile extends LogisticModel {
  version: string;
  features: string[];
  train: TrainOptions;
  priors: RiskPriors;
  /**
   * `sim` vang mat = bo mo phong v1 (tep v1 giu nguyen tung byte); 'v2' = bo mo phong v2 (RISK_MODULE.md §20).
   * `features` vang mat = dung du 15 dac trung; co = mo hinh chi hoc tren tap con nay (v3, §21), cac cot khac co he so 0.
   */
  training: { seeds: number[]; rows: number; positives: number; sha256: string; sim?: 'v2'; features?: string[] };
  metrics?: Record<string, unknown>;
}

export interface TrainRow {
  x: readonly number[];
  y: 0 | 1;
}

/**
 * sigma(z). Khong can nhanh "on dinh so" rieng cho z am: Math.exp(800) = Infinity va 1 / Infinity = 0 trong JS, khong NaN
 * (cai loi buoc 3 cho thay hai cach cho ket qua nhu nhau).
 */
export function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

export function fitStandardizer(rows: readonly (readonly number[])[]): { mean: number[]; std: number[] } {
  if (rows.length === 0) throw new RangeError('tap hoc rong');
  const d = rows[0]!.length;
  const mean = new Array<number>(d).fill(0);
  for (const r of rows) {
    if (r.length !== d) throw new RangeError('so dac trung khong dong nhat');
    for (let j = 0; j < d; j += 1) mean[j]! += r[j]!;
  }
  for (let j = 0; j < d; j += 1) mean[j] = mean[j]! / rows.length;
  const std = new Array<number>(d).fill(0);
  for (const r of rows) for (let j = 0; j < d; j += 1) std[j]! += (r[j]! - mean[j]!) ** 2;
  for (let j = 0; j < d; j += 1) {
    const s = Math.sqrt(std[j]! / rows.length);
    std[j] = s > 1e-12 ? s : 1;
  }
  return { mean, std };
}

function standardize(x: readonly number[], mean: readonly number[], std: readonly number[]): number[] {
  return x.map((v, j) => (v - mean[j]!) / std[j]!);
}

/** Hoc w, b tren tap hoc (chuan hoa ben trong). Tra ve mo hinh day du de du doan. */
export function trainLogistic(rows: readonly TrainRow[], opts: TrainOptions = DEFAULT_TRAIN): LogisticModel {
  if (!(opts.lambda >= 0) || !(opts.learningRate > 0) || !Number.isInteger(opts.iterations) || opts.iterations < 1) {
    throw new RangeError('tham so hoc khong hop le');
  }
  for (const r of rows) {
    if (r.y !== 0 && r.y !== 1) throw new RangeError('nhan phai la 0 hoac 1');
    for (const v of r.x) if (!Number.isFinite(v)) throw new RangeError('dac trung khong huu han');
  }
  const { mean, std } = fitStandardizer(rows.map((r) => r.x));
  const Z = rows.map((r) => standardize(r.x, mean, std));
  const n = rows.length;
  const d = mean.length;
  const signs = opts.signs;
  if (signs !== undefined && (signs.length !== d || signs.some((s) => s !== -1 && s !== 0 && s !== 1))) {
    throw new RangeError('signs phai co dung so phan tu, moi phan tu -1 / 0 / 1');
  }
  const w = new Array<number>(d).fill(0);
  let b = 0;
  const grad = new Array<number>(d);
  for (let it = 0; it < opts.iterations; it += 1) {
    grad.fill(0);
    let gb = 0;
    for (let i = 0; i < n; i += 1) {
      const z = Z[i]!;
      let s = b;
      for (let j = 0; j < d; j += 1) s += w[j]! * z[j]!;
      const err = sigmoid(s) - rows[i]!.y;
      gb += err;
      for (let j = 0; j < d; j += 1) grad[j]! += err * z[j]!;
    }
    for (let j = 0; j < d; j += 1) {
      w[j] = w[j]! - opts.learningRate * (grad[j]! / n + 2 * opts.lambda * w[j]!);
      if (signs && signs[j]! * w[j]! < 0) w[j] = 0;
    }
    b -= opts.learningRate * (gb / n);
  }
  return { mean, std, weights: w, bias: b };
}

/** Dong gop w_j * z_j cua tung dac trung vao logit (dung de chon ly do, §6.3). */
export function contributions(model: LogisticModel, x: readonly number[]): number[] {
  return x.map((v, j) => model.weights[j]! * ((v - model.mean[j]!) / model.std[j]!));
}

export function predictProbability(model: LogisticModel, x: readonly number[]): number {
  if (x.length !== model.weights.length) throw new RangeError('so dac trung khong khop mo hinh');
  let s = model.bias;
  for (const c of contributions(model, x)) s += c;
  return sigmoid(s);
}

/** Trung binh log-loss (khong tinh phat) - dung de kiem hoi tu va danh gia. */
export function logLoss(model: LogisticModel, rows: readonly TrainRow[]): number {
  let sum = 0;
  for (const r of rows) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, predictProbability(model, r.x)));
    sum += r.y === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return sum / rows.length;
}

/**
 * Kiem tep mo hinh truoc khi dung (§6.1, §22.2): ten dau vao deu da biet va khong trung, moi so huu han, std > 0, he so dung chieu.
 * Khong hop le -> nem loi (tang dich vu chuyen sang luat co dinh va ghi log) - khong de mo hinh chay am tham voi dau vao la.
 */
export function validateModelFile(raw: unknown): RiskModelFile {
  if (typeof raw !== 'object' || raw === null) throw new Error('tep mo hinh khong phai doi tuong');
  const m = raw as Partial<RiskModelFile>;
  if (typeof m.version !== 'string' || m.version.length === 0) throw new Error('thieu version');
  // Dau vao theo TEN (§22.2): ten phai thuoc INPUT_NAMES, khong trung - cham bang dung ten nen khong the lech thu tu
  const known = new Set<string>(INPUT_NAMES);
  if (!Array.isArray(m.features) || m.features.length === 0 || m.features.some((f) => !known.has(f)) || new Set(m.features).size !== m.features.length) {
    throw new Error('danh sach dau vao trong tep khong hop le (rong / ten la / trung)');
  }
  const d = m.features.length;
  const finiteArray = (a: unknown, name: string) => {
    if (!Array.isArray(a) || a.length !== d || a.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
      throw new Error(`${name} khong hop le`);
    }
  };
  finiteArray(m.mean, 'mean');
  finiteArray(m.std, 'std');
  finiteArray(m.weights, 'weights');
  if (m.std!.some((s) => s <= 0)) throw new Error('std phai > 0');
  // Mo hinh dung that phai dung chieu le thuong (§6.1) - neu khong, ly do hien ra co the vo ly
  (m.features as InputName[]).forEach((name, j) => {
    if (INPUT_SIGNS[name] * m.weights![j]! < 0) throw new Error(`he so ${name} sai chieu le thuong`);
  });
  if (typeof m.bias !== 'number' || !Number.isFinite(m.bias)) throw new Error('bias khong hop le');
  const p = m.priors;
  if (!p || !(p.lateRate >= 0 && p.lateRate <= 1) || !(p.daysPerPoint > 0)) throw new Error('priors khong hop le');
  return m as RiskModelFile;
}
