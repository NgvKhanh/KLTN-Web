// Thong ke cho bo danh gia goi y phan cong (buoc 7, ASSIGN_MODULE.md §11). TOAN HAM THUAN, TAT DINH: khong doc dong ho,
// khong doc DB -> test duoc truc tiep (test/assign.evalstats.test.ts). Bootstrap dung bo so ngau nhien co hat giong
// (Rng cua bo sinh) nen chay lai ra dung cung khoang tin cay.

import { Rng } from './simGenerator';

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function assertNumbers(xs: readonly number[], what: string, min: number): void {
  if (!Array.isArray(xs) || xs.length < min) throw new RangeError(`${what}: can it nhat ${min} gia tri`);
  for (const x of xs) if (!isNum(x)) throw new RangeError(`${what}: co gia tri khong phai so huu han`);
}

export function mean(xs: readonly number[]): number {
  assertNumbers(xs, 'mean', 1);
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Do lech chuan MAU (chia n - 1); can it nhat 2 gia tri. */
export function sd(xs: readonly number[]): number {
  assertNumbers(xs, 'sd', 2);
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

/** Phan vi `p` trong [0,1] cua mang DA SAP XEP tang dan, noi suy tuyen tinh giua hai gia tri ke nhau (kieu "type 7" cua R). */
export function quantile(sortedAsc: readonly number[], p: number): number {
  assertNumbers(sortedAsc, 'quantile', 1);
  if (!isNum(p) || p < 0 || p > 1) throw new RangeError('quantile: p phai trong [0,1]');
  const h = (sortedAsc.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(sortedAsc.length - 1, lo + 1);
  return sortedAsc[lo]! + (h - lo) * (sortedAsc[hi]! - sortedAsc[lo]!);
}

/**
 * He so Gini cua cac so DEM (so viec moi nguoi nhan): 0 = chia deu tuyet doi, tien toi (n - 1) / n khi mot nguoi nhan het.
 * Cong thuc tren mang tang dan: G = 2 * tong(i * x_i) / (n * tong(x)) - (n + 1) / n. Khong ai nhan viec nao (tong = 0) -> 0.
 */
export function gini(counts: readonly number[]): number {
  assertNumbers(counts, 'gini', 1);
  for (const c of counts) if (c < 0) throw new RangeError('gini: so dem khong duoc am');
  const xs = [...counts].sort((a, b) => a - b);
  const n = xs.length;
  let total = 0;
  let weighted = 0;
  xs.forEach((x, i) => {
    total += x;
    weighted += (i + 1) * x;
  });
  if (total === 0) return 0;
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

/** Phan viec cua nguoi nhan NHIEU NHAT (0..1); khong ai nhan gi -> 0. Doc de hon Gini khi nhom chi co vai nguoi. */
export function maxShare(counts: readonly number[]): number {
  assertNumbers(counts, 'maxShare', 1);
  for (const c of counts) if (c < 0) throw new RangeError('maxShare: so dem khong duoc am');
  const total = counts.reduce((a, b) => a + b, 0);
  return total === 0 ? 0 : Math.max(...counts) / total;
}

/**
 * Hat giong cho luong ngau nhien RIENG cua mot muc dich (`salt`) tren mot the (`index`) cua bo du lieu `seed`.
 * BAT BUOC tron bit: gieo LCG bang hai so nguyen KE NHAU cho gia tri dau tien gan nhu trung nhau (tuong quan ~0,998,
 * do o buoc 7), nen "ket qua cua the 5" va "ket qua cua the 6" khong doc lap. Sau khi tron con ~0,01.
 */
export function streamSeed(seed: number, index: number, salt: number): number {
  for (const [name, v] of [['seed', seed], ['index', index], ['salt', salt]] as const) {
    if (!Number.isInteger(v) || v < 0) throw new RangeError(`streamSeed: ${name} phai la so nguyen >= 0`);
  }
  let h = (seed >>> 0) ^ Math.imul((index + 1) >>> 0, 0x9e3779b1) ^ Math.imul((salt + 1) >>> 0, 0x7f4a7c15);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export interface BootstrapOptions {
  /** So lan lay mau lai (mac dinh 10 000). */
  resamples?: number;
  /** Muc tin cay, mac dinh 0,95. */
  level?: number;
  /** Hat giong cua bo so ngau nhien: cung du lieu + cung hat giong = cung khoang. */
  seed?: number;
}

export interface Interval {
  mean: number;
  lo: number;
  hi: number;
}

const DEFAULT_RESAMPLES = 10_000;
const DEFAULT_LEVEL = 0.95;
const DEFAULT_BOOTSTRAP_SEED = 20260921;

function resolveBootstrap(o: BootstrapOptions | undefined): Required<BootstrapOptions> {
  const r = {
    resamples: o?.resamples ?? DEFAULT_RESAMPLES,
    level: o?.level ?? DEFAULT_LEVEL,
    seed: o?.seed ?? DEFAULT_BOOTSTRAP_SEED,
  };
  if (!Number.isInteger(r.resamples) || r.resamples < 100) throw new RangeError('resamples phai la so nguyen >= 100');
  if (!isNum(r.level) || r.level <= 0 || r.level >= 1) throw new RangeError('level phai trong (0,1)');
  if (!Number.isInteger(r.seed) || r.seed < 0) throw new RangeError('seed phai la so nguyen >= 0');
  return r;
}

/**
 * Khoang tin cay BOOTSTRAP phan vi cho TRUNG BINH cua `values` (moi phan tu = mot hat giong, tuc mot don vi doc lap).
 * Khong dua vao gia dinh phan phoi chuan - quan trong voi chi so ti le trong ~20 hat giong.
 */
export function bootstrapMeanCI(values: readonly number[], opts?: BootstrapOptions): Interval {
  assertNumbers(values, 'bootstrapMeanCI', 2);
  const { resamples, level, seed } = resolveBootstrap(opts);
  const n = values.length;
  const rng = new Rng(seed);
  const means = new Array<number>(resamples);
  for (let b = 0; b < resamples; b += 1) {
    let s = 0;
    for (let i = 0; i < n; i += 1) s += values[rng.int(n)]!;
    means[b] = s / n;
  }
  means.sort((x, y) => x - y);
  const alpha = (1 - level) / 2;
  return { mean: mean(values), lo: quantile(means, alpha), hi: quantile(means, 1 - alpha) };
}

export interface PairedComparison extends Interval {
  n: number;
  /** So hat giong ma `a` HON `b` / KEM `b` / bang hat nhau (chenh lech dung bang 0). */
  positive: number;
  negative: number;
  ties: number;
}

/**
 * So sanh CAP theo hat giong: a[i] va b[i] la CUNG mot bo du lieu (cung the, cung may rui) nen chenh lech theo cap co phuong
 * sai thap hon nhieu so voi so hai trung binh doc lap. `mean` la trung binh chenh lech a - b.
 */
export function comparePaired(a: readonly number[], b: readonly number[], opts?: BootstrapOptions): PairedComparison {
  assertNumbers(a, 'comparePaired', 2);
  assertNumbers(b, 'comparePaired', 2);
  if (a.length !== b.length) throw new RangeError('comparePaired: hai day phai cung do dai (cung cac hat giong)');
  const diffs = a.map((x, i) => x - b[i]!);
  const ci = bootstrapMeanCI(diffs, opts);
  return {
    ...ci,
    n: diffs.length,
    positive: diffs.filter((d) => d > 0).length,
    negative: diffs.filter((d) => d < 0).length,
    ties: diffs.filter((d) => d === 0).length,
  };
}

export interface SeedSummary extends Interval {
  n: number;
  sd: number;
}

/** Trung binh + do lech chuan + khoang tin cay bootstrap cua mot chi so tren cac hat giong. */
export function summarizeSeeds(values: readonly number[], opts?: BootstrapOptions): SeedSummary {
  const ci = bootstrapMeanCI(values, opts);
  return { ...ci, n: values.length, sd: sd(values) };
}
