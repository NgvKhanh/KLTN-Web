// Bo cham cap (viec, nguoi) - ASSIGN_MODULE.md §5.4-5.7. HAM THUAN: "hom nay" luon la tham so
// (`now`), khong doc dong ho, khong Prisma, khong mang.
//
// KHONG BAO GIO import simGenerator/simVocab: bo cham chi duoc thay CHU trong the va KET QUA
// hoan thanh - khong duoc thay ky nang an cua nguoi mo phong (co test canh giu).
//
// BA THANH PHAN, moi cai trong [0,1]:
//   experience   "da lam viec giong the nay chua" - k lang gieng gan nhat trong cac the NGUOI DO da
//                xong (khong gop lich su thanh mot vec-to), trong so theo thoi gian.
//   reliability  "lam nhung viec giong the nay co dung han khong" - tinh tren DUNG cac the do,
//                co ve trung binh nhom (lam tron kieu Bayes) de 1 the dung han khong thanh 100%.
//   availability "co ranh khong" - so the dang mo chong lan khoang thoi gian cua the moi.
// THANH PHAN THU TU (buoc 12, §17): declared "ho so tu khai co khop the nay khong" - do giong lon nhat giua the va tung muc
//                ho so (ky nang, cong viec da lam, doan CV) - assign.declared.ts. Chua kiem chung nen KHONG gop vao tin cay /
//                confidence; khong co ho so -> null + co NO_PROFILE.
// Diem tong chi cong cac thanh phan CO DU LIEU (chia lai theo tong trong so cua chung). Khi XEP HANG, moi
// thanh phan duoc CHUAN HOA trong nhom ung vien cua the do truoc khi cong (phuong an A, ASSIGN_MODULE.md
// nhat ky buoc 4b): ba thanh phan khong cung thang nen cong tho thi trong so danh nghia khong phai anh huong
// thuc te.
//
// CAC CHO TAI LIEU §5.4-5.7 DE HO, DA CHOT (ghi o day de truy vet):
//  1. The moi thieu ngay: khong co ca hai -> cua so [now, now+14 ngay]; chi co han -> [min(now,han), han];
//     chi co bat dau -> [bat dau, bat dau+14 ngay].
//  2. The DANG MO cua nguoi khac: khoang la [bat dau, han] nhung KEO DAI it nhat den `now` (viec
//     qua han van chiem cho); thieu bat dau coi nhu da bat dau tu lau, thieu han coi nhu chua co han.
//  3. Nguoi co `pausedUntil` >= luc bat dau cua cua so: kha dung = 0 va co PAUSED.
//  4. CHONG ROI RI TUONG LAI: the da xong SAU `now` khong duoc dung (o ho so, o trung binh nhom).
//     Vo nghia khi chay that (now = bay gio) nhung bat buoc khi PHAT LAI lich su o buoc 7.
//  5. Nguoi khong co the nao da xong -> NO_HISTORY: khong cham kinh nghiem va tin cay (chi con kha dung).
//     Nguoi co lich su nhung khong the nao giong (sim < simMin) -> NO_SIMILAR: kinh nghiem = 0
//     (da tim va khong thay), tin cay lui ve trung binh nhom.
//  6. Chi the co sim > 0 moi tinh: neu simMin = 0 thi the sim = 0 van khong duoc dem la bang chung.

import { scoreDeclared, type DeclaredEvidence, type DeclaredItem } from './assign.declared';
import { buildProfile, type HistoryCard, type ProfileEntry } from './assign.profile';
import { countTerms, type CardText } from './assign.text';
import { cosine, vectorize, type Idf, type SparseVector } from './assign.tfidf';

const DAY_MS = 86_400_000;

// ---------- Tham so ----------

/**
 * Bon trong so (§17.6). `declared` = thanh phan "Ho so" (ho so tu khai). Khong ai co ho so -> thanh phan nay vang voi moi nguoi,
 * bi bo va chia lai theo ba trong so con lai (voi DROP va NEUTRAL).
 */
export interface Weights {
  experience: number;
  reliability: number;
  availability: number;
  declared: number;
}

/** Trong so thanh phan Ho so trong bo mac dinh - TAM, chot bang do o buoc 15 (§17.10). */
export const DEFAULT_DECLARED_WEIGHT = 0.2;

/**
 * §5.7, §17.6. Moi nhom co bo rieng (bang WorkspaceAssignWeights); day chi la mac dinh. Thuoc ho (1 - d) x (0,45; 0,30; 0,25) + d
 * voi d = DEFAULT_DECLARED_WEIGHT: khi khong ai co Ho so, ba trong so con lai chia lai dung ve 0,45 / 0,30 / 0,25 -> xep hang
 * y nhu truoc buoc 11.
 */
export const DEFAULT_WEIGHTS: Readonly<Weights> = {
  experience: 0.36,
  reliability: 0.24,
  availability: 0.2,
  declared: 0.2,
};

/**
 * Bo mac dinh truoc buoc 11 (khong co Ho so). CHI de ghim cac nhanh danh gia cu (buoc 7/9) cho so lieu cu tai hien dung, va - tu
 * buoc 11 den buoc 16 - de dich vu cham bang bo ba trong so dang luu (§17.6). Khong luu duoc qua API (0 < muc san 0,05).
 */
export const LEGACY_WEIGHTS_V1: Readonly<Weights> = {
  experience: 0.45,
  reliability: 0.3,
  availability: 0.25,
  declared: 0,
};

export interface ScoreParams {
  /** K: so the cu giong nhat dem xet. */
  k: number;
  /** Nguong sim: the cu giong the moi it hon nguong nay bi bo. */
  simMin: number;
  /** m_e: he so bao hoa luong bang chung, experience = fit * e / (e + m_e). */
  evidenceSaturation: number;
  /** m: he so co ve trung binh nhom cua tin cay. */
  shrinkage: number;
  /** confidence = e / (e + confidenceScale). */
  confidenceScale: number;
  /** H: nua doi suy giam thoi gian (ngay). */
  halfLifeDays: number;
  /** Do dai cua so mac dinh (ngay) khi the moi thieu ngay. */
  defaultWindowDays: number;
}

/** §5.8. Ca bo nay se duoc quet o buoc 7 - khong phai gia tri "da toi uu". */
export const DEFAULT_PARAMS: Readonly<ScoreParams> = {
  k: 5,
  simMin: 0.05,
  evidenceSaturation: 2,
  shrinkage: 3,
  confidenceScale: 3,
  halfLifeDays: 90,
  defaultWindowDays: 14,
};

/** So the song song toi da khi nguoi do chua co ho so lam viec (MemberWorkProfile). */
export const DEFAULT_MAX_PARALLEL = 5;
export const CONFIDENCE_THIN_BELOW = 0.25;
export const CONFIDENCE_FAIR_BELOW = 0.6;

function resolveParams(over?: Partial<ScoreParams>): ScoreParams {
  const p: ScoreParams = { ...DEFAULT_PARAMS, ...over };
  if (!Number.isInteger(p.k) || p.k < 1) throw new RangeError('k phai la so nguyen >= 1');
  if (!Number.isFinite(p.simMin) || p.simMin < 0 || p.simMin > 1) throw new RangeError('simMin phai trong [0,1]');
  if (!Number.isFinite(p.evidenceSaturation) || p.evidenceSaturation < 0) {
    throw new RangeError('evidenceSaturation phai la so huu han >= 0');
  }
  for (const key of ['shrinkage', 'confidenceScale', 'halfLifeDays', 'defaultWindowDays'] as const) {
    if (!Number.isFinite(p[key]) || p[key] <= 0) throw new RangeError(`${key} phai la so huu han > 0`);
  }
  return p;
}

function resolveWeights(w: Weights | undefined): Weights {
  const r = w ?? DEFAULT_WEIGHTS;
  let sum = 0;
  // Du BON khoa: bo ba khoa kieu cu (test / script khong qua tsc) phai loi ngay, khong duoc am tham coi Ho so = 0
  for (const key of ['experience', 'reliability', 'availability', 'declared'] as const) {
    if (!Number.isFinite(r[key]) || r[key] < 0) throw new RangeError(`trong so ${key} phai la so huu han >= 0`);
    sum += r[key];
  }
  if (sum <= 0) throw new RangeError('it nhat mot trong so phai > 0');
  return r;
}

const validDate = (d: Date | null | undefined): d is Date => d instanceof Date && Number.isFinite(d.getTime());

// ---------- Ket qua cua mot the da xong ----------

export type OutcomeKind = 'ON_TIME' | 'ON_TIME_REOPENED' | 'LATE' | 'NO_DUE';

export interface OutcomeCard {
  completedAt: Date;
  dueDate?: Date | null;
  reopened?: boolean;
}

/**
 * DINH NGHIA DUY NHAT cua "dung han": completedAt <= dueDate (khop bo sinh o buoc 2). Tre han thi
 * la LATE du co bi mo lai hay khong. Khong co han -> NO_DUE (khong dua vao do tin cay).
 */
export function outcomeKindOf(card: OutcomeCard): OutcomeKind {
  if (!validDate(card.dueDate)) return 'NO_DUE';
  if (card.completedAt.getTime() > card.dueDate.getTime()) return 'LATE';
  return card.reopened ? 'ON_TIME_REOPENED' : 'ON_TIME';
}

/** 1 / 0,5 / 0 (§5.5); NO_DUE -> null (loai khoi phep tinh). */
export function outcomeValue(kind: OutcomeKind): number | null {
  if (kind === 'ON_TIME') return 1;
  if (kind === 'ON_TIME_REOPENED') return 0.5;
  if (kind === 'LATE') return 0;
  return null;
}

/**
 * `muy` cua §5.5: trung binh outcome cua moi the da xong (co han) trong khong gian lam viec, tinh
 * DUNG cung ham outcome nhu tung nguoi. Bo qua the xong sau `now` (chong roi ri tuong lai) va the
 * khong co han. Khong co the nao -> null (thanh phan tin cay khong co du lieu).
 */
export function groupOnTimeRate(cards: Iterable<OutcomeCard>, now: Date): number | null {
  if (!validDate(now)) throw new RangeError('now khong hop le');
  let sum = 0;
  let n = 0;
  for (const c of cards) {
    if (!validDate(c.completedAt) || c.completedAt.getTime() > now.getTime()) continue;
    const v = outcomeValue(outcomeKindOf(c));
    if (v === null) continue;
    sum += v;
    n += 1;
  }
  return n > 0 ? sum / n : null;
}

// ---------- Dau vao / dau ra ----------

export interface ScoreCard extends CardText {
  /** Neu co: bi loai khoi lich su va khoi cac the dang mo cua ung vien (the dang xet khong tu chong lan minh). */
  id?: string;
  startDate?: Date | null;
  dueDate?: Date | null;
}

export interface OpenCard {
  cardId: string;
  startDate: Date | null;
  dueDate: Date | null;
}

export interface CandidateInput {
  userId: string;
  /** Cac the nguoi nay DA XONG (da duoc gan). Nguoi goi khong can loc theo thoi gian: bo cham tu bo the xong sau `now`. */
  history: readonly HistoryCard[];
  /** Cac the nguoi nay dang phu trach va CHUA xong. */
  openCards: readonly OpenCard[];
  /** MemberWorkProfile.maxParallelCards; mac dinh DEFAULT_MAX_PARALLEL. */
  maxParallelCards?: number;
  /** MemberWorkProfile.pausedUntil. */
  pausedUntil?: Date | null;
  /**
   * Cac MUC ho so tu khai da cat san (§17.3): nguoi lap danh sach ung vien goi declaredItems(hoSo) MOT lan - tach tu la phan dat
   * nhat (~6 ms / ho so lon), khong duoc lap lai cho moi the. null / thieu / rong = khong co ho so dung duoc (NO_PROFILE).
   */
  declared?: readonly DeclaredItem[] | null;
}

/**
 * Cach dua ba thanh phan ve CUNG THANG truoc khi cong (chi ap dung khi XEP HANG nhieu ung vien):
 *  - 'MINMAX' (mac dinh, phuong an A): tren TUNG thanh phan, trong tap ung vien cua the nay, nguoi thap
 *    nhat = 0, cao nhat = 1. Trong so tro thanh TAM QUAN TRONG TUONG DOI. Neu moi ung vien bang nhau
 *    (khong phan biet duoc) thi ca nhom = 0,5.
 *  - 'NONE': cong thang gia tri tho (§5.7 nguyen van). Khi do anh huong THUC TE cua mot thanh phan ~
 *    trong so x do phan tan cua no giua cac ung vien - khong phai chi trong so (xem ASSIGN_MODULE.md).
 */
export type Normalization = 'MINMAX' | 'NONE';

/**
 * Thanh phan THIEU du lieu (vd nguoi chua co lich su khong co kinh nghiem / tin cay) tinh the nao:
 *  - 'DROP' (nguyen tac 4): bo thanh phan do, chia lai theo trong so cac thanh phan con lai.
 *  - 'NEUTRAL': thay bang TRUNG BINH cua nhung nguoi co du lieu ("chua biet = trung binh nhom"); khong ai co -> van bo.
 *  - 'ZERO' (CHI dung khi do, §17.5): thieu = 0 TRUOC khi chuan hoa, tuc nhu "co khai ma khong khop".
 * Tren du lieu mo phong DROP va NEUTRAL cho do chinh xac nhu nhau; khac nhau o CHO NGUOI MOI: DROP van cho ho
 * dung dau o ~3% so the (gap ~2 lan ti le ung vien), NEUTRAL gan nhu khong bao gio (~0,1%).
 */
export type MissingPolicy = 'DROP' | 'NEUTRAL' | 'ZERO';

export type ComponentKey = 'experience' | 'reliability' | 'availability' | 'declared';
export const COMPONENT_KEYS: readonly ComponentKey[] = ['experience', 'reliability', 'availability', 'declared'];

/**
 * §17.5 - mac dinh khi khong truyen `missing`: DROP cho ba thanh phan tu lich su, NEUTRAL cho Ho so (voi DROP, nguoi KHONG khai
 * khong bi so o thanh phan nay con nguoi khai ma khong khop bi chuan hoa ve 0 - "khong khai lai co loi"; NEUTRAL chi GIAM, khong
 * xoa han dong co do).
 */
export const DEFAULT_MISSING: Readonly<Record<ComponentKey, MissingPolicy>> = {
  experience: 'DROP',
  reliability: 'DROP',
  availability: 'DROP',
  declared: 'NEUTRAL',
};

export interface ScoreContext {
  /** IDF cua kho ngu lieu (the cua khong gian lam viec) - dung CHUNG cho the moi va ho so. */
  idf: Idf;
  now: Date;
  /** `muy`: xem groupOnTimeRate(). null = khong co du lieu. */
  groupOnTimeRate: number | null;
  weights?: Weights;
  params?: Partial<ScoreParams>;
  /** Chi co tac dung o rankCandidates (scoreCandidate cham mot nguoi nen khong co "nhom" de chuan hoa). Mac dinh 'MINMAX'. */
  normalize?: Normalization;
  /**
   * Chi co tac dung o rankCandidates. MOT gia tri = ap cho ca bon thanh phan (moi loi goi cu giu nguyen nghia); hoac ban ghi theo
   * thanh phan (khoa thieu lay theo DEFAULT_MISSING). Khong truyen = DEFAULT_MISSING.
   */
  missing?: MissingPolicy | Partial<Record<ComponentKey, MissingPolicy>>;
}

export interface EvidenceItem {
  cardId: string;
  title: string;
  /** Do giong voi the moi, trong (0,1]. */
  sim: number;
  /** Trong so thoi gian decay(tuoi), trong (0,1]. */
  weight: number;
  outcome: OutcomeKind;
  completedAt: Date;
  dueDate: Date | null;
}

export type Flag = 'NO_HISTORY' | 'NO_SIMILAR' | 'NO_PROFILE' | 'OVERLOADED' | 'PAUSED' | 'NO_DATA';
export type ConfidenceLevel = 'THIN' | 'FAIR' | 'GOOD';

export interface ComponentScore {
  /** Gia tri THO trong [0,1] - cai nguoi dung thay ("kha dung 60%"); null = khong co du lieu. */
  value: number | null;
  /** Trong so cau hinh. */
  weight: number;
  /**
   * Gia tri DUNG DE CONG vao diem tong: bang `value` khi khong chuan hoa (scoreCandidate, hoac 'NONE'),
   * hoac da chuan hoa trong nhom (rankCandidates + 'MINMAX'). Voi 'NEUTRAL' co the co gia tri du `value` = null.
   */
  scaled: number | null;
  /** Ti trong THUC SU trong diem tong (weight / tong trong so cac thanh phan co `scaled`); 0 neu khong co. */
  share: number;
}

export interface CandidateScore {
  userId: string;
  /**
   * 0..100, hoac null khi khong thanh phan nao co du lieu (co NO_DATA). Khi xep hang voi 'MINMAX' day la diem
   * TUONG DOI trong nhom ("100 = tot nhat nhom o moi thanh phan co trong so"), khong phai diem tuyet doi.
   */
  score: number | null;
  /** Diem THO theo §5.7 nguyen van (cong gia tri tho, bo thanh phan thieu) - khong doi theo chuan hoa. */
  rawScore: number | null;
  /** evidenceMass / (evidenceMass + confidenceScale), trong [0,1). */
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  components: Record<ComponentKey, ComponentScore>;
  /** Toi da K the cu da dung, giong nhat truoc. Bang chung truy vet duoc cua diem. */
  evidence: EvidenceItem[];
  /** Toi da 3 muc ho so tu khai giong nhat (§17.4) - TACH RIENG khoi `evidence` (bang chung la the that). */
  declaredEvidence: DeclaredEvidence[];
  /** "So the hieu dung" = tong trong so thoi gian cua cac the trong `evidence` (e trong §5.4). */
  evidenceMass: number;
  /** Chat luong khop trung binh (co trong so) cua cac the trong `evidence`, [0,1]. */
  fit: number;
  /** So the dang mo chong lan khoang thoi gian cua the moi. */
  load: number;
  capacity: number;
  flags: Flag[];
}

export interface RankedCandidate extends CandidateScore {
  /** 1 = phu hop nhat. */
  rank: number;
}

export function confidenceLevelOf(confidence: number): ConfidenceLevel {
  if (confidence < CONFIDENCE_THIN_BELOW) return 'THIN';
  if (confidence < CONFIDENCE_FAIR_BELOW) return 'FAIR';
  return 'GOOD';
}

// ---------- Khoang thoi gian va tai ----------

/** Cua so cua the moi (ms). Quy tac o dau tep, muc 1. */
function windowOf(card: ScoreCard, nowMs: number, defaultDays: number): [number, number] {
  const s = validDate(card.startDate) ? card.startDate.getTime() : null;
  const d = validDate(card.dueDate) ? card.dueDate.getTime() : null;
  let a: number;
  let b: number;
  if (s !== null && d !== null) {
    a = s;
    b = d;
  } else if (s !== null) {
    a = s;
    b = s + defaultDays * DAY_MS;
  } else if (d !== null) {
    a = Math.min(nowMs, d);
    b = d;
  } else {
    a = nowMs;
    b = nowMs + defaultDays * DAY_MS;
  }
  return a <= b ? [a, b] : [b, a];
}

/** So the dang mo chong lan cua so [ws, we]. Quy tac o dau tep, muc 2. */
function countOverlaps(
  open: readonly OpenCard[],
  ws: number,
  we: number,
  nowMs: number,
  excludeId: string | undefined
): number {
  let n = 0;
  for (const o of open) {
    if (excludeId !== undefined && o.cardId === excludeId) continue;
    let a = validDate(o.startDate) ? o.startDate.getTime() : -Infinity;
    let b = validDate(o.dueDate) ? o.dueDate.getTime() : Infinity;
    if (a > b) [a, b] = [b, a];
    // The con mo thi it nhat cung dang chiem cho den bay gio
    const end = Math.max(b, nowMs);
    if (a <= we && end >= ws) n += 1;
  }
  return n;
}

// ---------- Cham mot ung vien ----------

interface Resolved {
  now: Date;
  nowMs: number;
  idf: Idf;
  mu: number | null;
  weights: Weights;
  params: ScoreParams;
  normalize: Normalization;
  missing: Readonly<Record<ComponentKey, MissingPolicy>>;
}

const POLICIES: ReadonlySet<string> = new Set(['DROP', 'NEUTRAL', 'ZERO']);

function resolveMissing(m: ScoreContext['missing']): Readonly<Record<ComponentKey, MissingPolicy>> {
  if (m === undefined) return DEFAULT_MISSING;
  if (typeof m === 'string') {
    if (!POLICIES.has(m)) throw new RangeError(`missing khong hop le: ${String(m)}`);
    return { experience: m, reliability: m, availability: m, declared: m };
  }
  if (typeof m !== 'object' || m === null) throw new RangeError(`missing khong hop le: ${String(m)}`);
  const out: Record<ComponentKey, MissingPolicy> = { ...DEFAULT_MISSING };
  for (const [k, v] of Object.entries(m)) {
    if (!(COMPONENT_KEYS as readonly string[]).includes(k)) throw new RangeError(`missing: thanh phan la "${k}"`);
    if (typeof v !== 'string' || !POLICIES.has(v)) throw new RangeError(`missing.${k} khong hop le: ${String(v)}`);
    out[k as ComponentKey] = v as MissingPolicy;
  }
  return out;
}

function resolveContext(ctx: ScoreContext): Resolved {
  if (!validDate(ctx.now)) throw new RangeError('now khong hop le');
  if (ctx.groupOnTimeRate !== null && !(ctx.groupOnTimeRate >= 0 && ctx.groupOnTimeRate <= 1)) {
    throw new RangeError('groupOnTimeRate phai trong [0,1] hoac null');
  }
  const normalize = ctx.normalize ?? 'MINMAX';
  if (normalize !== 'MINMAX' && normalize !== 'NONE') throw new RangeError(`normalize khong hop le: ${String(normalize)}`);
  const missing = resolveMissing(ctx.missing);
  return {
    now: ctx.now,
    nowMs: ctx.now.getTime(),
    idf: ctx.idf,
    mu: ctx.groupOnTimeRate,
    weights: resolveWeights(ctx.weights),
    params: resolveParams(ctx.params),
    normalize,
    missing,
  };
}

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * §5.7: 100 x tong(w.gia_tri) / tong(w) tren cac thanh phan CO gia tri. Tra ve diem (null neu tong trong so = 0)
 * va ti trong thuc te cua tung thanh phan.
 */
function combine(
  values: readonly (number | null)[],
  weights: readonly number[]
): { score: number | null; shares: number[] } {
  let num = 0;
  let den = 0;
  values.forEach((v, i) => {
    if (v === null) return;
    num += weights[i]! * v;
    den += weights[i]!;
  });
  return {
    score: den > 0 ? Math.min(100, Math.max(0, (100 * num) / den)) : null,
    shares: values.map((v, i) => (v !== null && den > 0 ? weights[i]! / den : 0)),
  };
}

function scoreOne(card: ScoreCard, qvec: SparseVector, cand: CandidateInput, r: Resolved): CandidateScore {
  const { params: p, weights: w } = r;

  // Lich su: chi the DA XONG truoc/dung luc `now` (chong roi ri tuong lai) va khong phai chinh the dang xet
  const usable = cand.history.filter(
    (h) => validDate(h.completedAt) && h.completedAt.getTime() <= r.nowMs && h.cardId !== card.id
  );
  const entries: ProfileEntry[] = buildProfile(cand.userId, usable, r.idf, r.now, p.halfLifeDays).entries;
  const hasHistory = entries.length > 0;

  // ---- Kinh nghiem (§5.4) ----
  const similar: { e: ProfileEntry; sim: number }[] = [];
  for (const e of entries) {
    const sim = cosine(qvec, e.vec);
    if (sim > 0 && sim >= p.simMin) similar.push({ e, sim });
  }
  similar.sort(
    (x, y) =>
      y.sim - x.sim ||
      y.e.completedAt.getTime() - x.e.completedAt.getTime() ||
      cmpStr(x.e.cardId, y.e.cardId)
  );
  const top = similar.slice(0, p.k);

  let evidenceMass = 0;
  let weightedSim = 0;
  for (const t of top) {
    evidenceMass += t.e.weight;
    weightedSim += t.e.weight * t.sim;
  }
  const fit = evidenceMass > 0 ? weightedSim / evidenceMass : 0;
  const denomExp = evidenceMass + p.evidenceSaturation;
  const experience = hasHistory ? clamp01(evidenceMass > 0 && denomExp > 0 ? (fit * evidenceMass) / denomExp : 0) : null;

  const evidence: EvidenceItem[] = top.map((t) => ({
    cardId: t.e.cardId,
    title: t.e.title,
    sim: t.sim,
    weight: t.e.weight,
    outcome: outcomeKindOf(t.e),
    completedAt: t.e.completedAt,
    dueDate: t.e.dueDate,
  }));

  // ---- Tin cay (§5.5): tinh tren DUNG K the o tren ----
  let reliability: number | null = null;
  if (hasHistory && r.mu !== null) {
    let sv = 0;
    let svo = 0;
    for (const t of top) {
      const o = outcomeValue(outcomeKindOf(t.e));
      if (o === null) continue; // the khong dat han: loai khoi phep tinh
      const v = t.e.weight * t.sim;
      sv += v;
      svo += v * o;
    }
    reliability = clamp01((svo + p.shrinkage * r.mu) / (sv + p.shrinkage));
  }

  // ---- Kha dung (§5.6) ----
  const capacity = cand.maxParallelCards ?? DEFAULT_MAX_PARALLEL;
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`maxParallelCards cua ${cand.userId} phai la so nguyen >= 1`);
  }
  const [ws, we] = windowOf(card, r.nowMs, p.defaultWindowDays);
  const load = countOverlaps(cand.openCards, ws, we, r.nowMs, card.id);
  const paused = validDate(cand.pausedUntil) && cand.pausedUntil.getTime() >= ws;
  const availability = paused ? 0 : clamp01(1 - load / capacity);

  // ---- Ho so tu khai (§17.4): khong gop vao tin cay / confidence ----
  const declared = scoreDeclared(qvec, cand.declared ?? [], r.idf, p.simMin);

  // ---- Tong hop (§5.7): chi cong thanh phan CO du lieu ----
  const values = [experience, reliability, availability, declared.value];
  const weights = COMPONENT_KEYS.map((k) => w[k]);
  const { score, shares } = combine(values, weights);
  const component = (i: number): ComponentScore => ({
    value: values[i]!,
    weight: weights[i]!,
    scaled: values[i]!, // scoreCandidate khong chuan hoa; rankCandidates co the doi
    share: shares[i]!,
  });

  const flags: Flag[] = [];
  if (!hasHistory) flags.push('NO_HISTORY');
  else if (top.length === 0) flags.push('NO_SIMILAR');
  if (declared.value === null) flags.push('NO_PROFILE');
  if (load >= capacity) flags.push('OVERLOADED');
  if (paused) flags.push('PAUSED');
  if (score === null) flags.push('NO_DATA');

  const confidence = evidenceMass / (evidenceMass + p.confidenceScale);
  return {
    userId: cand.userId,
    score,
    rawScore: score,
    confidence,
    confidenceLevel: confidenceLevelOf(confidence),
    components: {
      experience: component(0),
      reliability: component(1),
      availability: component(2),
      declared: component(3),
    },
    evidence,
    declaredEvidence: declared.evidence,
    evidenceMass,
    fit,
    load,
    capacity,
    flags,
  };
}

/** Chuan hoa MOT cot (mot thanh phan, moi ung vien). null = khong co du lieu (giu nguyen tru khi 'NEUTRAL' / 'ZERO'). */
function scaleColumn(
  raw: readonly (number | null)[],
  mode: Normalization,
  missing: MissingPolicy
): (number | null)[] {
  // 'ZERO': thieu = 0 TRUOC khi chuan hoa - dung nhu mot nguoi co khai ma khong khop
  const values = missing === 'ZERO' ? raw.map((v) => v ?? 0) : raw;
  const present = values.filter((v): v is number => v !== null);
  let scaled: (number | null)[] = [...values];
  if (mode === 'MINMAX' && present.length > 0) {
    const lo = Math.min(...present);
    const hi = Math.max(...present);
    // Moi nguoi bang nhau -> khong phan biet duoc -> trung tinh 0,5 (khong lam doi thu tu)
    scaled = values.map((v) => (v === null ? null : hi > lo ? (v - lo) / (hi - lo) : 0.5));
  }
  if (missing === 'NEUTRAL' && present.length > 0) {
    // Cong theo thu tu TANG DAN: phep cong so thuc khong giao hoan tuyet doi, cong theo thu tu ung vien dau vao
    // se lam diem lech o chu so cuoi khi doi thu tu dau vao -> hai diem sat nhau co the doi hang.
    const known = scaled.filter((v): v is number => v !== null).sort((a, b) => a - b);
    const mean = known.reduce((a, b) => a + b, 0) / known.length;
    scaled = scaled.map((v) => (v === null ? mean : v));
  }
  return scaled;
}

/** Tinh lai `scaled`, ti trong, diem va co NO_DATA cua ca nhom sau khi chuan hoa tung thanh phan. */
function applyScaling(scored: CandidateScore[], r: Resolved): CandidateScore[] {
  // = ket qua tho cua scoreOne: chi khi khong chuan hoa VA moi thanh phan deu DROP
  if (r.normalize === 'NONE' && COMPONENT_KEYS.every((k) => r.missing[k] === 'DROP')) return scored;
  const weights = COMPONENT_KEYS.map((k) => r.weights[k]);
  const cols = COMPONENT_KEYS.map((k) => scaleColumn(scored.map((s) => s.components[k].value), r.normalize, r.missing[k]));
  return scored.map((s, i) => {
    const vals = cols.map((c) => c[i]!);
    const { score, shares } = combine(vals, weights);
    const withScaled = (k: ComponentKey, j: number): ComponentScore => ({
      ...s.components[k],
      scaled: vals[j]!,
      share: shares[j]!,
    });
    const flags: Flag[] = s.flags.filter((f) => f !== 'NO_DATA');
    if (score === null) flags.push('NO_DATA');
    return {
      ...s,
      score,
      flags,
      components: {
        experience: withScaled('experience', 0),
        reliability: withScaled('reliability', 1),
        availability: withScaled('availability', 2),
        declared: withScaled('declared', 3),
      },
    };
  });
}

/** Cham MOT ung vien cho mot the (khong chuan hoa: khong co "nhom" de so sanh). */
export function scoreCandidate(card: ScoreCard, candidate: CandidateInput, ctx: ScoreContext): CandidateScore {
  const r = resolveContext(ctx);
  return scoreOne(card, vectorize(countTerms(card), r.idf), candidate, r);
}

/**
 * Xep hang cac ung vien cho mot the. Truoc khi cong, tung thanh phan duoc chuan hoa TRONG NHOM ung vien nay
 * (ctx.normalize, mac dinh 'MINMAX') de trong so la tam quan trong TUONG DOI chu khong bi do phan tan cua
 * thanh phan quyet dinh. Diem giam dan; khong co diem (null) xuong cuoi; hoa thi do tin cay cao hon truoc,
 * roi userId (tat dinh, khong phu thuoc thu tu dau vao). Tra ve mang moi, khong sua dau vao.
 */
export function rankCandidates(
  card: ScoreCard,
  candidates: readonly CandidateInput[],
  ctx: ScoreContext
): RankedCandidate[] {
  const r = resolveContext(ctx);
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.userId)) throw new RangeError(`ung vien trung userId: ${c.userId}`);
    seen.add(c.userId);
  }
  const qvec = vectorize(countTerms(card), r.idf);
  const scored = applyScaling(
    candidates.map((c) => scoreOne(card, qvec, c, r)),
    r
  );
  scored.sort((a, b) => {
    if (a.score === null && b.score !== null) return 1;
    if (b.score === null && a.score !== null) return -1;
    if (a.score !== null && b.score !== null && a.score !== b.score) return b.score - a.score;
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    return cmpStr(a.userId, b.userId);
  });
  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}
