// 15 dac trung cua mot the tai thoi diem t (RISK_MODULE.md §5). HAM THUAN - khong Prisma, khong doc dong ho.
//
// Hai buoc:
//   1) buildRiskContext(cac the cua khong gian, t): nhung gi dung chung cho moi the luc t - ket qua (dung/tre) cua cac the da
//      co ket qua, toc do lam theo tung nguoi, trung binh nhom, kho TF-IDF cua cac the da ton tai luc t;
//   2) extractFeatures(the, context): vec-to 15 dac trung + chi tiet (de ghep ly do va luu CSDL).
// Ca hai chi doc du lieu <= t (qua risk.history.ts), nen dung chung duoc cho luc hoc (anh chup qua khu) va luc chay that.

import { countTerms } from '../assign/assign.text';
import { buildIdf, cosine, vectorizeKnown, type Idf, type SparseVector, type TermCounts } from '../assign/assign.tfidf';
import {
  DAY_MS,
  activityTimesUntil,
  blockedDaysBetween,
  checklistAt,
  dueAt,
  isDoneAt,
  isOpenAt,
  lastDoneAt,
  membersAt,
  outcomeAt,
  startAt,
  statusAt,
  statusBeforeBlockAt,
  type RiskCardHistory,
  type RiskMode,
  type RiskStatus,
} from './risk.history';

export const FEATURE_NAMES = [
  'progressGap',
  'logDaysLeft',
  'log2Points',
  'pointsEstimated',
  'logSubtasksDone',
  'logSubtasksLeft',
  'blocked',
  'logBlockedDays',
  'assigneeLateRate',
  'noAssignee',
  'logDaysPerPoint',
  'paceRatio',
  'similarLateRate',
  'logDaysSinceActivity',
  'logEvents7d',
] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];
export type FeatureValues = Record<FeatureName, number>;

/**
 * Chieu "le thuong" cua tung dac trung (+1: tang thi nguy co tang, -1: tang thi nguy co giam, 0: khong rang buoc - co bao
 * "diem la uoc luong" khong co chieu tu nhien). Mo hinh hoc CO RANG BUOC dau theo bang nay (buoc 5, §6.1): he so sai chieu bi
 * keo ve 0, nen moi ly do hien ra deu doc xuoi duoc.
 */
export const FEATURE_SIGNS: Readonly<Record<FeatureName, -1 | 0 | 1>> = {
  progressGap: 1,
  logDaysLeft: -1,
  log2Points: 1,
  pointsEstimated: 0,
  logSubtasksDone: -1,
  logSubtasksLeft: 1,
  blocked: 1,
  logBlockedDays: 1,
  assigneeLateRate: 1,
  noAssignee: 1,
  logDaysPerPoint: 1,
  paceRatio: 1,
  similarLateRate: 1,
  logDaysSinceActivity: 1,
  logEvents7d: -1,
};

/** Hai dac trung tan suat hoat dong: chi luu CSDL, KHONG BAO GIO thanh ly do (§2, §6.3). */
export const HIDDEN_FEATURES: ReadonlySet<FeatureName> = new Set(['logDaysSinceActivity', 'logEvents7d']);

/**
 * 4 yeu to cua mo hinh `logreg-v3` (user chot 31/10, §21): tien do so voi ky vong; toc do nguoi duoc giao so voi thoi gian con
 * lai; lich su tre (+ chua ai nhan); checklist da xong / con lai. Dung thu tu cua FEATURE_NAMES. Cac dac trung khac van duoc tinh
 * va luu (CardRisk.features) nhung mo hinh v3 khong dung (he so 0).
 */
export const CORE_FEATURES: readonly FeatureName[] = ['progressGap', 'logSubtasksDone', 'logSubtasksLeft', 'assigneeLateRate', 'noAssignee', 'paceRatio'];

/**
 * Dau vao mo hinh THEO TEN (§22.2): 15 dac trung + 2 o trang thai (moc so: Can lam; Bi chan da co `blocked`). Tep mo hinh khai
 * bao ten dau vao no dung (`features`); vector 15 dac trung (`vector`, ma bam tap hoc) giu nguyen nen tep v1-v3 cham y het.
 */
export const STATUS_INPUTS = ['statusInProgress', 'statusInReview'] as const;
export const INPUT_NAMES = [...FEATURE_NAMES, ...STATUS_INPUTS] as const;
export type InputName = (typeof INPUT_NAMES)[number];

/** Chieu le thuong cua moi dau vao: Dang lam / Cho duyet it nguy co hon Can lam. */
export const INPUT_SIGNS: Readonly<Record<InputName, -1 | 0 | 1>> = { ...FEATURE_SIGNS, statusInProgress: -1, statusInReview: -1 };

export function inputValue(f: ExtractedFeatures, name: InputName): number {
  if (name === 'statusInProgress') return f.detail.status === 'IN_PROGRESS' ? 1 : 0;
  if (name === 'statusInReview') return f.detail.status === 'IN_REVIEW' ? 1 : 0;
  return f.values[name];
}

export function inputVector(f: ExtractedFeatures, names: readonly InputName[]): number[] {
  return names.map((n) => inputValue(f, n));
}

/**
 * Dau vao cua mo hinh `logreg-v4` (user chot 31/10, §22): so ngay con lai + trang thai hien tai thay cho "tien do so voi ky vong";
 * giu toc do nguoi duoc giao, lich su tre (+ chua ai nhan), checklist. Dung thu tu INPUT_NAMES.
 */
export const STATUS_TIME_INPUTS: readonly InputName[] = [
  'logDaysLeft',
  'logSubtasksDone',
  'logSubtasksLeft',
  'blocked',
  'assigneeLateRate',
  'noAssignee',
  'paceRatio',
  'statusInProgress',
  'statusInReview',
];

/** Tham so co dinh (§5.3) - doi la doi dinh nghia dac trung, phai hoc lai mo hinh. */
export const FEATURE_PARAMS = {
  halfLifeDays: 90,
  shrinkM: 3,
  similarK: 5,
  similarMin: 0.05,
  minDurationDays: 0.25,
  paceSmoothingDays: 0.25,
  inReviewFloor: 0.9,
  recentWindowDays: 7,
} as const;

/** Tien do suy tu trang thai khi the khong co checklist (§5.3 (1)). */
export const STATUS_PROGRESS: Readonly<Record<RiskStatus, number>> = {
  TODO: 0,
  IN_PROGRESS: 0.5,
  IN_REVIEW: 0.9,
  DONE: 1,
  BLOCKED: 0,
};

/** Gia tri du phong khi ca khong gian chua co du lieu (luu trong tep mo hinh = trung binh tap hoc). */
export interface RiskPriors {
  lateRate: number;
  daysPerPoint: number;
}

/** Uoc luong story point tu tong so muc checklist (§5.3 (3)). */
export function estimatePoints(checklistTotal: number): number {
  if (checklistTotal <= 0) return 3;
  if (checklistTotal <= 2) return 1;
  if (checklistTotal <= 4) return 2;
  if (checklistTotal <= 7) return 3;
  if (checklistTotal <= 12) return 5;
  return 8;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const decay = (ageMs: number) => Math.pow(0.5, Math.max(0, ageMs) / DAY_MS / FEATURE_PARAMS.halfLifeDays);
const shrink = (sumWX: number, sumW: number, prior: number) =>
  (sumWX + FEATURE_PARAMS.shrinkM * prior) / (sumW + FEATURE_PARAMS.shrinkM);

// Dem tu cua tung the chi phu thuoc tieu de + mo ta -> nho lai theo doi tuong the (khong doi ket qua, chi tranh tach tu lai).
const termCache = new WeakMap<RiskCardHistory, TermCounts>();
function termsOf(card: RiskCardHistory): TermCounts {
  let c = termCache.get(card);
  if (!c) {
    c = countTerms({ title: card.title, description: card.description });
    termCache.set(card, c);
  }
  return c;
}

interface Outcome {
  card: RiskCardHistory;
  late: boolean;
  weight: number;
}

interface PersonStats {
  lateW: number;
  sumW: number;
  lateCount: number;
  count: number;
  dppW: number;
  dppSumW: number;
  doneCount: number;
}

export interface RiskContext {
  t: Date;
  mode: RiskMode;
  priors: RiskPriors;
  /** mu: ti le tre (co suy giam) cua ca khong gian luc t; chua co the nao co ket qua -> priors.lateRate. */
  workspaceLateRate: number;
  /** Trung binh so ngay / diem cua ca khong gian; chua co the nao xong -> priors.daysPerPoint. */
  workspaceDaysPerPoint: number;
  outcomes: readonly Outcome[];
  people: ReadonlyMap<string, PersonStats>;
  idf: Idf;
  vectors: ReadonlyMap<string, SparseVector>;
}

/** So ngay tren mot diem cua 1 the da xong, tinh tu moc `start` (§5.3 (8)). */
function daysPerPointOf(card: RiskCardHistory, start: Date, doneAt: Date): number {
  const days = Math.max(FEATURE_PARAMS.minDurationDays, (doneAt.getTime() - start.getTime()) / DAY_MS);
  const points = card.storyPoints ?? estimatePoints(checklistAt(card, doneAt, 'live').total);
  return days / points;
}

export function buildRiskContext(
  cards: readonly RiskCardHistory[],
  t: Date,
  priors: RiskPriors,
  mode: RiskMode = 'replay'
): RiskContext {
  if (!(t instanceof Date) || !Number.isFinite(t.getTime())) throw new RangeError('t khong hop le');
  const tMs = t.getTime();
  const outcomes: Outcome[] = [];
  const people = new Map<string, PersonStats>();
  const person = (id: string) => {
    let p = people.get(id);
    if (!p) {
      p = { lateW: 0, sumW: 0, lateCount: 0, count: 0, dppW: 0, dppSumW: 0, doneCount: 0 };
      people.set(id, p);
    }
    return p;
  };
  let lateW = 0;
  let sumW = 0;
  let dppW = 0;
  let dppSumW = 0;

  // Cong so thuc theo MOT thu tu co dinh (theo id) -> ket qua khong phu thuoc thu tu dau vao (bai hoc module phan cong)
  const ordered = [...cards].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const card of ordered) {
    const o = outcomeAt(card, t);
    if (o === null) continue;
    const w = decay(tMs - o.at.getTime());
    outcomes.push({ card, late: o.late, weight: w });
    lateW += w * (o.late ? 1 : 0);
    sumW += w;
    const members = membersAt(card, t);
    for (const m of members) {
      const p = person(m.userId);
      p.lateW += w * (o.late ? 1 : 0);
      p.sumW += w;
      p.count += 1;
      if (o.late) p.lateCount += 1;
    }
    if (!isDoneAt(card, t)) continue;
    const doneAt = lastDoneAt(card, t);
    if (doneAt === null) continue;
    const cardStart = startAt(card, doneAt);
    dppW += w * daysPerPointOf(card, cardStart, doneAt);
    dppSumW += w;
    for (const m of members) {
      // Nguoi vao the muon: tinh tu luc ho duoc giao (toc do CUA HO), khong som hon moc bat dau cua the
      const from = m.createdAt.getTime() > cardStart.getTime() ? m.createdAt : cardStart;
      const p = person(m.userId);
      p.dppW += w * daysPerPointOf(card, from, doneAt);
      p.dppSumW += w;
      p.doneCount += 1;
    }
  }

  const existing = ordered.filter((c) => c.createdAt.getTime() <= tMs);
  const idf = buildIdf(existing.map(termsOf));
  const vectors = new Map<string, SparseVector>();
  for (const o of outcomes) vectors.set(o.card.id, vectorizeKnown(termsOf(o.card), idf));

  return {
    t,
    mode,
    priors,
    workspaceLateRate: sumW > 0 ? lateW / sumW : priors.lateRate,
    workspaceDaysPerPoint: dppSumW > 0 ? dppW / dppSumW : priors.daysPerPoint,
    outcomes,
    people,
    idf,
    vectors,
  };
}

export interface AssigneeDetail {
  userId: string;
  /** Ti le tre da co ve trung binh nhom. */
  lateRate: number;
  /** So the co ket qua / so the tre (khong suy giam) - de hien "tre 6/10 the". */
  outcomeCount: number;
  lateCount: number;
  daysPerPoint: number;
  doneCount: number;
}

export interface FeatureDetail {
  t: string;
  dueAt: string;
  startAt: string;
  status: RiskStatus;
  expectedProgress: number;
  actualProgress: number;
  progressSource: 'CHECKLIST' | 'STATUS';
  daysLeft: number;
  points: number;
  pointsEstimated: boolean;
  subtasksDone: number;
  subtasksTotal: number;
  blockedDays: number;
  assignees: AssigneeDetail[];
  workspaceLateRate: number;
  workspaceDaysPerPoint: number;
  /** So ngay can them theo toc do thuong ngay (§5.3 (8)). */
  needDays: number;
  similar: { count: number; lateCount: number; rate: number };
  daysSinceActivity: number;
  events7d: number;
}

export interface ExtractedFeatures {
  values: FeatureValues;
  /** Dung thu tu FEATURE_NAMES - dau vao cua mo hinh. */
  vector: number[];
  detail: FeatureDetail;
}

/**
 * 15 dac trung cua `card` luc context.t. Tra null khi the khong cham duoc luc do: chua tao / da xong / khong co han.
 * The da QUA han van tra dac trung (daysLeft = 0) - viec "qua han -> 100%" la cua tang cham diem (§6.5).
 */
export function extractFeatures(card: RiskCardHistory, ctx: RiskContext): ExtractedFeatures | null {
  const { t, mode } = ctx;
  const tMs = t.getTime();
  if (!isOpenAt(card, t)) return null;
  const due = dueAt(card, t);
  if (due === null) return null;
  const start = startAt(card, t);

  // (1) tien do
  const span = due.getTime() - start.getTime();
  const expected = span <= 0 ? 1 : clamp01((tMs - start.getTime()) / span);
  const status = statusAt(card, t);
  const checklist = checklistAt(card, t, mode);
  let actual: number;
  let progressSource: FeatureDetail['progressSource'];
  if (checklist.total > 0) {
    actual = checklist.done / checklist.total;
    progressSource = 'CHECKLIST';
  } else {
    actual = STATUS_PROGRESS[status === 'BLOCKED' ? statusBeforeBlockAt(card, t) : status];
    progressSource = 'STATUS';
  }
  if (status === 'IN_REVIEW') actual = Math.max(actual, FEATURE_PARAMS.inReviewFloor);

  // (2) thoi gian con lai; (3) story point
  const daysLeft = Math.max(0, (due.getTime() - tMs) / DAY_MS);
  const pointsEstimated = card.storyPoints === null;
  const points = card.storyPoints ?? estimatePoints(checklist.total);

  // (5)(6) bi chan - tinh tu luc tao the
  const blockedDays = blockedDaysBetween(card, card.createdAt, t);

  // (7)(8) nguoi duoc giao
  const members = membersAt(card, t);
  const assignees: AssigneeDetail[] = members.map((m) => {
    const p = ctx.people.get(m.userId);
    return {
      userId: m.userId,
      lateRate: p ? shrink(p.lateW, p.sumW, ctx.workspaceLateRate) : ctx.workspaceLateRate,
      outcomeCount: p?.count ?? 0,
      lateCount: p?.lateCount ?? 0,
      daysPerPoint: p ? shrink(p.dppW, p.dppSumW, ctx.workspaceDaysPerPoint) : ctx.workspaceDaysPerPoint,
      doneCount: p?.doneCount ?? 0,
    };
  });
  const mean = (xs: number[], empty: number) => (xs.length === 0 ? empty : xs.reduce((a, b) => a + b, 0) / xs.length);
  const assigneeLateRate = mean(assignees.map((a) => a.lateRate), ctx.workspaceLateRate);
  const daysPerPoint = mean(assignees.map((a) => a.daysPerPoint), ctx.workspaceDaysPerPoint);
  const needDays = daysPerPoint * points * (1 - actual);

  // (9) the tuong tu
  const target = vectorizeKnown(termsOf(card), ctx.idf);
  const neighbours = ctx.outcomes
    .filter((o) => o.card.id !== card.id)
    .map((o) => ({ o, sim: cosine(target, ctx.vectors.get(o.card.id) ?? new Map()) }))
    .filter((x) => x.sim >= FEATURE_PARAMS.similarMin)
    .sort((a, b) => b.sim - a.sim || (a.o.card.id < b.o.card.id ? -1 : a.o.card.id > b.o.card.id ? 1 : 0))
    .slice(0, FEATURE_PARAMS.similarK);
  let simLate = 0;
  let simSum = 0;
  for (const n of neighbours) {
    simLate += n.sim * (n.o.late ? 1 : 0);
    simSum += n.sim;
  }
  const similarLateRate = shrink(simLate, simSum, ctx.workspaceLateRate);

  // (10) tan suat hoat dong (chi luu, khong hien)
  const times = activityTimesUntil(card, t);
  const lastActivity = Math.max(card.createdAt.getTime(), ...times);
  const daysSinceActivity = Math.max(0, (tMs - lastActivity) / DAY_MS);
  const windowStart = tMs - FEATURE_PARAMS.recentWindowDays * DAY_MS;
  const events7d = times.filter((x) => x > windowStart && x <= tMs).length;

  const values: FeatureValues = {
    progressGap: expected - actual,
    logDaysLeft: Math.log1p(daysLeft),
    log2Points: Math.log2(points),
    pointsEstimated: pointsEstimated ? 1 : 0,
    logSubtasksDone: Math.log1p(checklist.done),
    logSubtasksLeft: Math.log1p(checklist.total - checklist.done),
    blocked: status === 'BLOCKED' ? 1 : 0,
    logBlockedDays: Math.log1p(blockedDays),
    assigneeLateRate,
    noAssignee: members.length === 0 ? 1 : 0,
    logDaysPerPoint: Math.log1p(daysPerPoint),
    paceRatio: Math.log((needDays + FEATURE_PARAMS.paceSmoothingDays) / (daysLeft + FEATURE_PARAMS.paceSmoothingDays)),
    similarLateRate,
    logDaysSinceActivity: Math.log1p(daysSinceActivity),
    logEvents7d: Math.log1p(events7d),
  };

  return {
    values,
    vector: FEATURE_NAMES.map((n) => values[n]),
    detail: {
      t: t.toISOString(),
      dueAt: due.toISOString(),
      startAt: start.toISOString(),
      status,
      expectedProgress: expected,
      actualProgress: actual,
      progressSource,
      daysLeft,
      points,
      pointsEstimated,
      subtasksDone: checklist.done,
      subtasksTotal: checklist.total,
      blockedDays,
      assignees,
      workspaceLateRate: ctx.workspaceLateRate,
      workspaceDaysPerPoint: ctx.workspaceDaysPerPoint,
      needDays,
      similar: {
        count: neighbours.length,
        lateCount: neighbours.filter((n) => n.o.late).length,
        rate: similarLateRate,
      },
      daysSinceActivity,
      events7d,
    },
  };
}
