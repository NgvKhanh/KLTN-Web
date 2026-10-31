// Hoc trong so cua nhom (muc 2) - ASSIGN_MODULE.md §8, §17.7. HAM THUAN: khong Prisma, khong doc dong ho.
//
// Perceptron xep hang theo cap (cung ho voi RankNet), hoc truc tuyen tung luot phan hoi:
// module xep `a` dung dau nhung nguoi dung giao cho `b` -> keo trong so ve phia cac thanh phan `b` hon `a`:
//     w_S <- chieu( w_S + eta * min(D_a, D_b) * (x_b / D_b - x_a / D_a)_S )
// `x` la cac gia tri DUNG DE CONG (`scaled`, da chuan hoa trong nhom o buoc 4b) - chinh la thu tao ra diem, nen
// phai chia theo MAU SO DIEM D_u = tong trong so cac thanh phan tham gia diem cua tung nguoi. Thieu du lieu thi D_a va
// D_b co the khac nhau; dung x_b - x_a truc tiep co the hoc NGUOC phan hoi. min(D_a, D_b) giu buoc hoc nhu cu khi hai
// mau so bang nhau va khong khuech dai dac trung vuot [0,1]. Gia tri tho (`value`) khong quyet dinh hang.
//
// CHIEU thay vi "kep roi chuan hoa" (§8 ghi ban dau): kep tung so vao [0,05; 0,70] roi chia cho tong CO THE lam
// vo chinh bat bien §14 - (0,70; 0,05; 0,05) chuan hoa thanh (0,875; 0,0625; 0,0625), vuot tran. Phep chieu tim
// DIEM HOP LE GAN NHAT (tong dung, moi so trong khoang) nen luon dung bat bien; cung y do, chinh xac hon. Phep chieu nam o
// assign.weights.ts (projectOnto / projectWithin).
//
// HOC TREN THANH PHAN CHUNG (buoc 13, §17.7): S = cac thanh phan ma CA HAI nguoi (xep dau va duoc chon) deu co GIA TRI THAT
// (`value` khac null - khong hoc tu gia tri duoc dien bang NEUTRAL). |S| < 2 -> MISSING_COMPONENT (mot chieu thi khong co ti le
// nao de chinh). Chi cap nhat trong S roi chieu, giu nguyen TONG KHOI cua S; trong so ngoai S giu nguyen (chieu ca bo se keo ca
// chung di mot luong tau ma khong co bang chung nao ve chung). S du bon = luat cu mo rong; chot chan cu "du ca ba thanh phan" voi
// bon thanh phan se gan nhu tat viec hoc.

import { COMPONENT_KEYS, type ComponentKey, type Weights } from './assign.score';
import { projectWithin, sameWeights } from './assign.weights';

/** Toc do hoc (§5.8). */
export const LEARN_ETA = 0.05;
/** Chi bat dau HOC tu luot phan hoi thu nay tro di; truoc do chi ghi nhan (muc 1) - §8 chot chan 1. */
export const LEARN_MIN_FEEDBACK = 10;
/** So thanh phan CHUNG toi thieu de hoc (§17.7). */
export const LEARN_MIN_SHARED = 2;

/** Cac thanh phan CO GIA TRI THAT cua mot ung vien (gia tri `scaled`); khoa vang = thieu du lieu. */
export type Features = Readonly<Partial<Record<ComponentKey, number>>>;

/** Cac thanh phan tham gia MAU SO DIEM, ke ca gia tri dien NEUTRAL (khong phai bang chung hoc). */
export interface LearningScoreComponents {
  top: readonly ComponentKey[];
  chosen: readonly ComponentKey[];
}

const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** S (§17.7): cac thanh phan ca hai deu co, theo thu tu COMPONENT_KEYS. */
export function sharedComponents(a: Features, b: Features): ComponentKey[] {
  return COMPONENT_KEYS.filter((k) => isNum(a[k]) && isNum(b[k]));
}

function scoringMass(w: Weights, features: Features, components?: readonly ComponentKey[]): number {
  const present = COMPONENT_KEYS.filter((k) => isNum(features[k]));
  const scored = components ?? present;
  if (new Set(scored).size !== scored.length || scored.some((k) => !COMPONENT_KEYS.includes(k)) || present.some((k) => !scored.includes(k))) {
    throw new RangeError('thanh phan tinh diem khong hop le');
  }
  // Thu tu co dinh, khop combine() cua bo cham va khong phu thuoc thu tu trong JSON.
  let mass = 0;
  for (const k of COMPONENT_KEYS) {
    if (!scored.includes(k)) continue;
    if (!isNum(w[k]) || w[k] < 0) throw new RangeError(`gia tri ${k} khong hop le`);
    mass += w[k];
  }
  if (!(mass > 0) || !Number.isFinite(mass)) throw new RangeError('mau so diem phai la so huu han > 0');
  return mass;
}

/**
 * Mot buoc cap nhat tren S = sharedComponents(top, chosen), theo huong tang (diem_chosen - diem_top) voi MAU SO RIENG.
 * Chieu len {tong = tong cu cua S, moi so trong khoang}; ngoai S khong doi. Moi khoa trong S tham gia diem cua ca hai,
 * nen giu tong S cung giu nguyen hai mau so: chenh lech diem la tuyen tinh tren mien chieu, khong tang khoang cach sai.
 * `scoring` chi ro cac khoa tham gia diem, gom ca NEUTRAL; khong truyen thi suy ra tu `features` (du lieu cu / goi truc tiep).
 */
export function learnStep(w: Weights, top: Features, chosen: Features, eta: number = LEARN_ETA, scoring?: LearningScoreComponents): Weights {
  if (!Number.isFinite(eta) || eta <= 0) throw new RangeError('eta phai la so huu han > 0');
  // Khoa CO MAT ma khong phai so huu han la loi cua nguoi goi (khong am tham coi la thieu)
  for (const k of COMPONENT_KEYS) {
    if ((top[k] !== undefined && !isNum(top[k])) || (chosen[k] !== undefined && !isNum(chosen[k]))) {
      throw new RangeError(`gia tri ${k} khong hop le`);
    }
  }
  const keys = sharedComponents(top, chosen);
  if (keys.length < LEARN_MIN_SHARED) {
    throw new RangeError(`can it nhat ${LEARN_MIN_SHARED} thanh phan chung de hoc (co ${keys.length})`);
  }
  const topMass = scoringMass(w, top, scoring?.top);
  const chosenMass = scoringMass(w, chosen, scoring?.chosen);
  const commonMass = Math.min(topMass, chosenMass);
  const topScale = commonMass / topMass;
  const chosenScale = commonMass / chosenMass;
  const raw: Weights = { ...w };
  for (const k of keys) {
    if (!Number.isFinite(w[k])) throw new RangeError(`gia tri ${k} khong hop le`);
    raw[k] = w[k] + eta * (chosenScale * chosen[k]! - topScale * top[k]!);
  }
  return projectWithin(raw, keys);
}

export interface LearnCandidate {
  userId: string;
  score: number | null;
  /** Cac thanh phan co gia tri that; null = nhat ky hong (khong co thanh phan nao). Hoc tren phan CHUNG voi nguoi kia (§17.7). */
  features: Features | null;
  /** Khoa co `scaled` hop le trong nhat ky, gom ca NEUTRAL. Vang = suy ra tu features (nguoi goi cu). */
  scoreComponents?: readonly ComponentKey[];
}

export type LearnReason =
  | 'LEARNED'
  | 'NO_TOP'
  | 'ACCEPTED'
  | 'TOO_EARLY'
  | 'NOT_CANDIDATE'
  | 'MISSING_COMPONENT'
  | 'TIE'
  | 'NO_CHANGE';

export type LearnDecision =
  | { learn: true; reason: 'LEARNED'; next: Weights }
  | { learn: false; reason: Exclude<LearnReason, 'LEARNED'> };

export interface LearnInput {
  /** Trong so HIEN TAI cua nhom. */
  weights: Weights;
  /** So luot phan hoi cua nhom SAU KHI da cong luot nay. */
  feedbackCount: number;
  topUserId: string | null;
  chosenUserId: string;
  candidates: readonly LearnCandidate[];
  eta?: number;
  minFeedback?: number;
}

/**
 * Luot phan hoi nay co duoc dung de hoc khong, va neu co thi trong so moi la gi. Thu tu kiem tra (co dinh, dung de
 * bao "vi sao khong hoc"):
 *  NO_TOP -> ACCEPTED (giao dung nguoi xep dau: khong co loi de sua) -> TOO_EARLY (chua du luot) ->
 *  NOT_CANDIDATE (nguoi duoc chon khong nam trong danh sach da cham) -> MISSING_COMPONENT (mot trong hai khong co diem,
 *  hoac hai nguoi co CHUNG it hon 2 thanh phan) -> TIE (diem khong lon hon han: nguoi xep dau chi hon nho tie-break) -> NO_CHANGE (chieu xong
 *  van khong doi) -> LEARNED.
 */
export function learningDecision(input: LearnInput): LearnDecision {
  const { weights, feedbackCount, topUserId, chosenUserId, candidates } = input;
  const minFeedback = input.minFeedback ?? LEARN_MIN_FEEDBACK;
  if (topUserId === null) return { learn: false, reason: 'NO_TOP' };
  if (chosenUserId === topUserId) return { learn: false, reason: 'ACCEPTED' };
  if (feedbackCount < minFeedback) return { learn: false, reason: 'TOO_EARLY' };

  const top = candidates.find((c) => c.userId === topUserId);
  const chosen = candidates.find((c) => c.userId === chosenUserId);
  if (!top || !chosen) return { learn: false, reason: 'NOT_CANDIDATE' };
  if (!top.features || !chosen.features || top.score === null || chosen.score === null) {
    return { learn: false, reason: 'MISSING_COMPONENT' };
  }
  if (sharedComponents(top.features, chosen.features).length < LEARN_MIN_SHARED) {
    return { learn: false, reason: 'MISSING_COMPONENT' };
  }
  if (!(top.score > chosen.score)) return { learn: false, reason: 'TIE' };

  const next = learnStep(weights, top.features, chosen.features, input.eta, {
    top: top.scoreComponents ?? COMPONENT_KEYS.filter((k) => isNum(top.features![k])),
    chosen: chosen.scoreComponents ?? COMPONENT_KEYS.filter((k) => isNum(chosen.features![k])),
  });
  if (sameWeights(next, weights)) return { learn: false, reason: 'NO_CHANGE' };
  return { learn: true, reason: 'LEARNED', next };
}

export interface ParseOptions {
  /**
   * CHI DE DO (§17.7 "nhanh do them"): lay ca gia tri da DIEN bang NEUTRAL (`value` null nhung `scaled` co). San pham khong bat:
   * gia tri dien la "trung binh nhom", khong phai bang chung ve nguoi do.
   */
  includeFilled?: boolean;
}

/** Cac thanh phan co gia tri dung de cong (`scaled`) VA gia tri that (`value`, tru khi includeFilled). Thanh phan vang / hong: bo qua. */
function featuresOf(components: unknown, includeFilled: boolean): Features | null {
  if (typeof components !== 'object' || components === null) return null;
  const record = components as Record<string, unknown>;
  const out: Partial<Record<ComponentKey, number>> = {};
  for (const k of COMPONENT_KEYS) {
    const c = record[k];
    if (typeof c !== 'object' || c === null) continue;
    const { value, scaled } = c as Record<string, unknown>;
    if (isNum(scaled) && (includeFilled || isNum(value))) out[k] = scaled;
  }
  return out;
}

/**
 * Doc lai danh sach ung vien da luu trong AssignRun.candidates (JSON). Dong hong bi bo, khong nem loi: mot luot
 * nhat ky hong chi mat co hoi hoc cua rieng no. JSON cu (ba thanh phan, truoc buoc 12) doc duoc: Ho so vang -> roi khoi S.
 */
export function parseRunCandidates(json: unknown, opts: ParseOptions = {}): LearnCandidate[] {
  if (!Array.isArray(json)) return [];
  const out: LearnCandidate[] = [];
  for (const raw of json) {
    if (typeof raw !== 'object' || raw === null) continue;
    const c = raw as Record<string, unknown>;
    if (typeof c.userId !== 'string') continue;
    // scaled co gia tri thi tham gia DIEM, du value null. featuresOf van loai gia tri dien khoi S khi hoc.
    const scoredFeatures = featuresOf(c.components, true);
    out.push({
      userId: c.userId,
      score: isNum(c.score) ? c.score : null,
      features: featuresOf(c.components, opts.includeFilled ?? false),
      scoreComponents: COMPONENT_KEYS.filter((k) => isNum(scoredFeatures?.[k])),
    });
  }
  return out;
}
