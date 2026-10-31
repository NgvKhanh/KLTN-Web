// Trong so cac thanh phan cua mot nhom: hang so + kiem tra + phep chieu (ASSIGN_MODULE.md §5.7, §8, §9, §17.6-17.8).
// HAM THUAN: khong Prisma, khong doc dong ho. Dung o ba noi: zod (kiem tra body PUT), service (rao ve cuoi truoc khi ghi) va
// bo hoc trong so (ket qua hoc cung phai qua cua nay).

import { DEFAULT_DECLARED_WEIGHT, DEFAULT_WEIGHTS, LEGACY_WEIGHTS_V1, type Weights } from './assign.score';

/** Moi trong so nam trong [0,05; 0,70]: khong thanh phan nao bi tat han, cung khong thanh phan nao ap dao. */
export const WEIGHT_MIN = 0.05;
export const WEIGHT_MAX = 0.7;
/** Tong phai bang 1 voi sai so nay (so thuc: 0,1 + 0,2 + 0,7 khong dung tuyet doi 1). */
export const WEIGHT_SUM_TOLERANCE = 1e-6;

export const WEIGHT_KEYS = ['experience', 'reliability', 'availability', 'declared'] as const;
export type WeightKey = (typeof WEIGHT_KEYS)[number];

/** Ten hien cho nguoi dung trong thong bao loi. */
const LABEL: Record<WeightKey, string> = {
  experience: 'kinh nghiem',
  reliability: 'do tin cay',
  availability: 'kha dung',
  declared: 'ho so',
};

export interface WeightIssue {
  /** Truong sai, hoac 'sum' neu ca bo khong cong lai bang 1. */
  path: WeightKey | 'sum';
  message: string;
}

const isFiniteNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * Liet ke MOI loi cua mot bo trong so tren cac khoa `keys` (mac dinh du bon; rong = hop le). Nhan `unknown`-an toan: gia tri khong
 * phai so huu han (NaN, Infinity, chuoi, thieu) deu bi bao loi thay vi nem ngoai le, vi ham nay chay tren du lieu tu nguoi dung.
 */
export function weightIssues(
  w: Readonly<Partial<Record<WeightKey, unknown>>>,
  keys: readonly WeightKey[] = WEIGHT_KEYS
): WeightIssue[] {
  const issues: WeightIssue[] = [];
  let sum = 0;
  let finiteCount = 0;
  for (const key of keys) {
    const v = w[key];
    if (!isFiniteNumber(v)) {
      issues.push({ path: key, message: `trong so ${LABEL[key]} phai la so huu han` });
      continue;
    }
    finiteCount += 1;
    sum += v;
    if (v < WEIGHT_MIN || v > WEIGHT_MAX) {
      issues.push({ path: key, message: `trong so ${LABEL[key]} phai nam trong [${WEIGHT_MIN}, ${WEIGHT_MAX}]` });
    }
  }
  // Tong chi co nghia khi moi khoa deu la so
  if (finiteCount === keys.length && Math.abs(sum - 1) > WEIGHT_SUM_TOLERANCE) {
    const count = keys.length === 3 ? 'ba' : 'bon';
    issues.push({ path: 'sum', message: `tong ${count} trong so phai bang 1 (hien la ${Number(sum.toFixed(6))})` });
  }
  return issues;
}

/** Sai so 1e-9: khac nhau do lam tron khi luu Float khong tinh. */
function sameOn(keys: readonly WeightKey[], a: Readonly<Partial<Weights>>, b: Readonly<Partial<Weights>>): boolean {
  return keys.every((k) => Math.abs(a[k]! - b[k]!) <= 1e-9);
}

/** Hai bo bon trong so co nhu nhau khong. */
export function sameWeights(a: Weights, b: Weights): boolean {
  return sameOn(WEIGHT_KEYS, a, b);
}

export function isDefaultWeights(w: Weights): boolean {
  return sameWeights(w, DEFAULT_WEIGHTS);
}

// ---------- Phep chieu ----------

const BISECTION_STEPS = 200;

/**
 * Chieu vuong goc `values` len tap {tong = mass, moi so trong [WEIGHT_MIN, WEIGHT_MAX]}: nghiem la x_i = kep(v_i - tau) voi tau
 * chon sao cho tong bang `mass`. Ham tong theo tau don dieu giam va lien tuc, di tu n * MAX xuong n * MIN nen co nghiem khi va chi
 * khi n * MIN <= mass <= n * MAX (ngoai khoang -> RangeError); tim bang chia doi (tat dinh, khong phu thuoc thu tu).
 * Dung lam phep chieu cua bo hoc thay cho "kep roi chuan hoa" (xem assign.learn.ts).
 */
export function projectOnto(values: readonly number[], mass: number): number[] {
  if (values.length === 0) throw new RangeError('can it nhat mot trong so');
  if (!values.every(isFiniteNumber)) throw new RangeError('trong so phai la so huu han');
  const n = values.length;
  if (!isFiniteNumber(mass) || mass < n * WEIGHT_MIN - 1e-12 || mass > n * WEIGHT_MAX + 1e-12) {
    throw new RangeError(`tong ${mass} khong dat duoc voi ${n} trong so trong [${WEIGHT_MIN}, ${WEIGHT_MAX}]`);
  }
  const clamp = (x: number) => Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, x));
  const total = (tau: number) => values.reduce((s, x) => s + clamp(x - tau), 0);

  let lo = Math.min(...values) - WEIGHT_MAX; // tai day moi so bi kep len MAX: total = n * MAX >= mass
  let hi = Math.max(...values) - WEIGHT_MIN; // tai day moi so bi kep xuong MIN: total = n * MIN <= mass
  for (let i = 0; i < BISECTION_STEPS; i += 1) {
    const mid = (lo + hi) / 2;
    if (total(mid) > mass) lo = mid;
    else hi = mid;
  }
  const tau = (lo + hi) / 2;
  return values.map((x) => clamp(x - tau));
}

/**
 * Chieu RIENG cac khoa `keys` cua `w` len {tong = 1 - tong cac khoa con lai, moi so trong khoang}; cac khoa ngoai `keys` GIU NGUYEN
 * (§17.7: chieu ca bo se keo ca chung di mot luong tau ma khong co bang chung nao ve chung). keys = WEIGHT_KEYS -> chieu ca bo, tong 1.
 * Tra ve bo moi, khong sua dau vao.
 */
export function projectWithin(w: Weights, keys: readonly WeightKey[]): Weights {
  if (new Set(keys).size !== keys.length) throw new RangeError('khoa trung lap');
  const rest = WEIGHT_KEYS.filter((k) => !keys.includes(k));
  for (const k of rest) {
    if (!isFiniteNumber(w[k])) throw new RangeError(`trong so ${k} phai la so huu han`);
  }
  const mass = 1 - rest.reduce((s, k) => s + w[k], 0);
  const projected = projectOnto(keys.map((k) => w[k]), mass);
  const out: Weights = {
    experience: w.experience,
    reliability: w.reliability,
    availability: w.availability,
    declared: w.declared,
  };
  keys.forEach((k, i) => {
    out[k] = projected[i]!;
  });
  return out;
}

// ---------- Bo BA trong so kieu cu (khong co Ho so): doc dong CSDL truoc buoc 16 (nang cap khi doc) + bo danh gia buoc 7 ----------

export const LEGACY_KEYS = ['experience', 'reliability', 'availability'] as const satisfies readonly WeightKey[];
export type LegacyKey = (typeof LEGACY_KEYS)[number];
/** Bo ba trong so kieu cu (khong co Ho so): dong CSDL truoc buoc 16; cung la ba thanh phan tu LICH SU ma truong nhom gia buoc 7 nhin. */
export type LegacyWeights = Pick<Weights, LegacyKey>;

/** Cat ve ba khoa de luu / tra ve qua API (bo Ho so). */
export function toLegacy(w: LegacyWeights): LegacyWeights {
  return { experience: w.experience, reliability: w.reliability, availability: w.availability };
}

/** Bo ba -> bon khoa voi Ho so = 0 (ket qua cham dung bang truoc buoc 11 - dung o bo danh gia buoc 7). */
export function pinLegacy(w: LegacyWeights): Weights {
  return { ...toLegacy(w), declared: 0 };
}

/** 0,45 / 0,30 / 0,25 - mac dinh truoc buoc 11 (cung la gia tri mac dinh cua cot CSDL: dong moi tao duoc nang cap khi doc). */
export const LEGACY_DEFAULT_WEIGHTS: Readonly<LegacyWeights> = toLegacy(LEGACY_WEIGHTS_V1);

export function legacyWeightIssues(w: Readonly<Partial<Record<LegacyKey, unknown>>>): WeightIssue[] {
  return weightIssues(w, LEGACY_KEYS);
}

/**
 * §17.8 - nang cap mot bo BA trong so cu (dong CSDL co wDeclared = null, doc o assign.repo.ts) len bon khoa:
 * ((1 - d) e, (1 - d) r, (1 - d) a, d) roi chieu len tap hop le. Mot cong thuc cho moi truong hop: bo mac dinh cu cho DUNG bo mac dinh
 * moi (voi d = DEFAULT_DECLARED_WEIGHT) vi ho mac dinh chinh la cong thuc nay va diem do da hop le (phep chieu khong doi gi) - khong
 * can nhanh rieng "chua chinh". Bo cu phai hop le (dich vu kiem truoc, hong thi dung mac dinh); d trong [WEIGHT_MIN, WEIGHT_MAX].
 */
export function upgradeLegacyWeights(w: LegacyWeights, d: number = DEFAULT_DECLARED_WEIGHT): Weights {
  const issues = legacyWeightIssues(w);
  if (issues.length > 0) throw new RangeError(`bo trong so cu khong hop le: ${issues.map((i) => i.message).join('; ')}`);
  if (!isFiniteNumber(d) || d < WEIGHT_MIN || d > WEIGHT_MAX) {
    throw new RangeError(`d phai nam trong [${WEIGHT_MIN}, ${WEIGHT_MAX}]`);
  }
  const k = 1 - d;
  const out = projectWithin(
    { experience: k * w.experience, reliability: k * w.reliability, availability: k * w.availability, declared: d },
    WEIGHT_KEYS
  );
  // Buoc 16: lech mac dinh chi do lam tron (0,8 x 0,45 = 0,36000000000000004) -> tra DUNG hang so, de dong CSDL va giao dien hien 0,36
  return sameWeights(out, DEFAULT_WEIGHTS) ? { ...DEFAULT_WEIGHTS } : out;
}
