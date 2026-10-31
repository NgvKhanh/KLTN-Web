// Chi so danh gia mo hinh canh bao tre han (RISK_MODULE.md §13). HAM THUAN.
//   AUC   : xac suat mo hinh cham mot the tre cao hon mot the dung han (chon ngau nhien); hoa tinh nua.
//   Brier : trung binh (p - y)^2.
//   ECE   : sai so hieu chinh, 10 khoang deu [0; 0,1) ... [0,9; 1]: tong (n_b / N) * |trung binh p - ti le tre that|.
//   Tai nguong diem s (diem = round(100 p)): do chinh xac = TP / (TP + FP), do phu = TP / (TP + FN).

import { scoreOf } from '../modules/risk/risk.levels';

export interface Scored {
  p: number;
  y: 0 | 1;
}

function check(rows: readonly Scored[]) {
  for (const r of rows) {
    if (!Number.isFinite(r.p) || r.p < 0 || r.p > 1) throw new RangeError('p phai trong [0,1]');
    if (r.y !== 0 && r.y !== 1) throw new RangeError('y phai la 0 hoac 1');
  }
}

/** AUC theo hang (Mann-Whitney), hang trung binh khi hoa. Thieu mot trong hai lop -> null. */
export function auc(rows: readonly Scored[]): number | null {
  check(rows);
  const nPos = rows.filter((r) => r.y === 1).length;
  const nNeg = rows.length - nPos;
  if (nPos === 0 || nNeg === 0) return null;
  const sorted = [...rows].sort((a, b) => a.p - b.p);
  let rankSumPos = 0;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1]!.p === sorted[i]!.p) j += 1;
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) if (sorted[k]!.y === 1) rankSumPos += avgRank;
    i = j + 1;
  }
  return (rankSumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

export function brier(rows: readonly Scored[]): number {
  check(rows);
  if (rows.length === 0) throw new RangeError('khong co dong nao');
  return rows.reduce((a, r) => a + (r.p - r.y) ** 2, 0) / rows.length;
}

export const ECE_BINS = 10;

export function ece(rows: readonly Scored[], bins: number = ECE_BINS): number {
  check(rows);
  if (rows.length === 0) throw new RangeError('khong co dong nao');
  const sumP = new Array<number>(bins).fill(0);
  const sumY = new Array<number>(bins).fill(0);
  const n = new Array<number>(bins).fill(0);
  for (const r of rows) {
    const b = Math.min(bins - 1, Math.floor(r.p * bins));
    sumP[b]! += r.p;
    sumY[b]! += r.y;
    n[b]! += 1;
  }
  let e = 0;
  for (let b = 0; b < bins; b += 1) if (n[b]! > 0) e += (n[b]! / rows.length) * Math.abs(sumP[b]! / n[b]! - sumY[b]! / n[b]!);
  return e;
}

/** Bang hieu chinh (de ve / in bao cao): moi khoang co so dong, p trung binh, ti le tre that. */
export function calibrationTable(rows: readonly Scored[], bins: number = ECE_BINS) {
  check(rows);
  return Array.from({ length: bins }, (_, b) => {
    const inBin = rows.filter((r) => Math.min(bins - 1, Math.floor(r.p * bins)) === b);
    return {
      from: b / bins,
      to: (b + 1) / bins,
      n: inBin.length,
      meanP: inBin.length > 0 ? inBin.reduce((a, r) => a + r.p, 0) / inBin.length : null,
      lateRate: inBin.length > 0 ? inBin.reduce((a, r) => a + r.y, 0) / inBin.length : null,
    };
  });
}

/** Do chinh xac / do phu khi canh bao moi the co diem >= `minScore`. Khong canh bao the nao -> precision null. */
export function atThreshold(rows: readonly Scored[], minScore: number): { precision: number | null; recall: number | null; flagged: number } {
  check(rows);
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const r of rows) {
    const flagged = scoreOf(r.p) >= minScore;
    if (flagged && r.y === 1) tp += 1;
    else if (flagged) fp += 1;
    else if (r.y === 1) fn += 1;
  }
  return { precision: tp + fp > 0 ? tp / (tp + fp) : null, recall: tp + fn > 0 ? tp / (tp + fn) : null, flagged: tp + fp };
}

/** Trung vi (mang rong -> null). */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
