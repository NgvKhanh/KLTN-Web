import type { AssignHistoryWeights, AssignWeightKey, AssignWeights, LegacyWeightKey } from '../types/assign';

// Phep can bang cac thanh truot trong so (ASSIGN_MODULE.md §5.7, §8, §17.6). Lam viec bang SO NGUYEN PHAN TRAM de tong luon
// dung 100 (khong lech do lam tron so thuc) va khop luat cua may chu: moi so trong [5%; 70%], tong 100%. Tu buoc 18 co BON
// thanh (them "Ho so") - moi ham o day viet cho N khoa, khong gia dinh "hai thanh con lai".

export const WEIGHT_MIN_PCT = 5;
export const WEIGHT_MAX_PCT = 70;
export const WEIGHT_KEYS: readonly AssignWeightKey[] = ['experience', 'reliability', 'availability', 'declared'];
/** Ba thanh phan tu lich su - moc lich su truoc buoc 16 chi co ba khoa nay. */
export const LEGACY_KEYS: readonly LegacyWeightKey[] = ['experience', 'reliability', 'availability'];

export type WeightsPct = Record<AssignWeightKey, number>;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** So thuc khong am, tong ~ total -> so nguyen tong DUNG total (phuong phap phan du lon nhat; hoa thi khoa dung truoc). */
function largestRemainder(values: readonly number[], total: number): number[] {
  const floors = values.map((r) => Math.floor(r + 1e-9));
  let rest = Math.round(total - floors.reduce((a, b) => a + b, 0));
  const order = values
    .map((r, i) => ({ i, frac: r - Math.floor(r + 1e-9) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let n = 0; rest > 0; n += 1, rest -= 1) floors[order[n % order.length]!.i]! += 1;
  return floors;
}

/** Dua ve so nguyen trong [5; 70] va tong 100: chinh tung don vi tren thanh phan con cho (thu tu co dinh). */
function repair(values: number[]): number[] {
  const out = values.map((v) => clamp(Math.round(v), WEIGHT_MIN_PCT, WEIGHT_MAX_PCT));
  let diff = 100 - out.reduce((a, b) => a + b, 0);
  for (let guard = 0; diff !== 0 && guard < 300; guard += 1) {
    const step = diff > 0 ? 1 : -1;
    const idx = out.findIndex((v) => (step > 0 ? v < WEIGHT_MAX_PCT : v > WEIGHT_MIN_PCT));
    if (idx < 0) break;
    out[idx]! += step;
    diff -= step;
  }
  return out;
}

/** Ti le phan tram (khong kep) cua cac so thuc; tong 0 / khong phai so -> chia deu. */
function shares(raw: readonly number[]): number[] {
  const total = raw.reduce((a, b) => a + b, 0);
  return total > 0 ? raw.map((r) => (r * 100) / total) : raw.map(() => 100 / raw.length);
}

/**
 * Trong so cua may chu (so thuc, tong 1) -> phan tram nguyen, tong 100 (phuong phap phan du lon nhat, roi dam bao
 * khoang cho phep). Trong so nhom da HOC thuong le (0,3833...) nen phai lam tron o day.
 */
export function toPct(w: AssignWeights): WeightsPct {
  const out = repair(largestRemainder(shares(WEIGHT_KEYS.map((k) => w[k] * 100)), 100));
  return Object.fromEntries(WEIGHT_KEYS.map((k, i) => [k, out[i]!])) as WeightsPct;
}

/**
 * Chu ngan cua mot moc lich su trong so: du bon khoa -> nhu toPct; moc TRUOC buoc 16 (Ho so = null) -> chi ba thanh phan lich
 * su, tong 100, khong kep (dung nhu da luu, khong bia so Ho so).
 */
export function historyPct(w: AssignHistoryWeights): Partial<WeightsPct> {
  if (w.declared !== null) return toPct({ ...w, declared: w.declared });
  const out = largestRemainder(shares(LEGACY_KEYS.map((k) => w[k] * 100)), 100);
  return Object.fromEntries(LEGACY_KEYS.map((k, i) => [k, out[i]!]));
}

/** Phan tram nguyen -> trong so gui len may chu (tong 1 sai so ~1e-16). */
export function fromPct(p: WeightsPct): AssignWeights {
  return {
    experience: p.experience / 100,
    reliability: p.reliability / 100,
    availability: p.availability / 100,
    declared: p.declared / 100,
  };
}

export const pctSum = (p: WeightsPct) => WEIGHT_KEYS.reduce((a, k) => a + p[k], 0);

export const samePct = (a: WeightsPct, b: WeightsPct) => WEIGHT_KEYS.every((k) => a[k] === b[k]);

/**
 * Chia `total` cho cac thanh theo TI LE `basis`, moi thanh trong [5; 70]: tim he so λ sao cho tong kep(λ·b_i, 5, 70) = total
 * (ham don dieu theo λ -> chia doi). Dung ca khi co thanh cham san lan thanh cham tran (kep lan luot theo mot thu tu thi co the sai).
 * Co so < 5 (du lieu bat thuong) coi nhu 5 de moi thanh deu con cho nhan phan du.
 */
function distribute(total: number, basis: readonly number[]): number[] {
  const b = basis.map((x) => Math.max(WEIGHT_MIN_PCT, Number.isFinite(x) ? x : WEIGHT_MIN_PCT));
  const at = (lambda: number) => b.map((x) => clamp(lambda * x, WEIGHT_MIN_PCT, WEIGHT_MAX_PCT));
  const sumAt = (lambda: number) => at(lambda).reduce((s, v) => s + v, 0);
  let lo = 0;
  let hi = WEIGHT_MAX_PCT / WEIGHT_MIN_PCT; // moi b >= 5 -> tai hi moi thanh da cham tran
  for (let i = 0; i < 100; i += 1) {
    const mid = (lo + hi) / 2;
    if (sumAt(mid) < total) lo = mid;
    else hi = mid;
  }
  return largestRemainder(at(hi), total);
}

/**
 * Nguoi dung keo thanh `key` toi `value` (%): thanh do duoc kep vao [5; 70]; phan con lai (100 - value) chia cho CAC thanh
 * kia THEO TI LE hien tai, moi thanh van trong [5; 70]. Tong luon 100.
 */
export function rebalance(current: WeightsPct, key: AssignWeightKey, value: number): WeightsPct {
  // Gia tri khong phai so (o nhap rong...) -> giu nguyen thanh nay, khong sinh NaN
  const v = clamp(Number.isFinite(value) ? Math.round(value) : current[key], WEIGHT_MIN_PCT, WEIGHT_MAX_PCT);
  const others = WEIGHT_KEYS.filter((k) => k !== key);
  // 100 - v trong [30; 95], ba thanh con lai chua duoc [15; 210] -> luon chia duoc
  const parts = distribute(100 - v, others.map((k) => current[k]));
  const out = { ...current, [key]: v };
  others.forEach((k, i) => {
    out[k] = parts[i]!;
  });
  return out;
}
