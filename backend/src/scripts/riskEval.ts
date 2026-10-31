// Loi danh gia mo hinh canh bao tre han (RISK_MODULE.md §13). Dung chung cho trainRisk.ts (hoc + chon lambda tren dev) va
// evalRisk.ts (bao cao dev / xac nhan). Moi so lieu tinh tu bo mo phong vong doi + anh chup qua khu (buoc 4).

import {
  FEATURE_NAMES,
  HIDDEN_FEATURES,
  INPUT_SIGNS,
  buildRiskContext,
  extractFeatures,
  inputVector,
  type ExtractedFeatures,
  type FeatureName,
  type InputName,
  type RiskPriors,
} from '../modules/risk/risk.features';
import { DAY_MS, dueAt, isOpenAt, outcomeAt } from '../modules/risk/risk.history';
import { decideNotify, type PreviousRisk } from '../modules/risk/risk.decide';
import { LEVEL_RANK, NOTIFY_MIN_LEVEL } from '../modules/risk/risk.levels';
import { modelInput, type NamedModel, type RiskAssessment } from '../modules/risk/risk.explain';
import { predictProbability, trainLogistic, type LogisticModel, type TrainOptions } from '../modules/risk/risk.model';
import { ruleScore } from '../modules/risk/risk.rules';
import { atThreshold, auc, brier, ece, median, type Scored } from './riskMetrics';
import { RISK_SIM_DAYS, type RiskWorld } from './riskSim';
import { generateWorld, type Mechanism, type SimVersion } from './riskSimV2';
import { computePriors, labelAt, snapshotsOfWorld, type SnapshotRow } from './riskSnapshots';

// ---------- Nhanh dem so (§13) ----------
export type ArmName =
  | 'logreg'
  | 'logregFree'
  | 'rules'
  | 'timeOnly'
  | 'timeProgress'
  | 'timeStatus'
  | 'noActivity'
  | 'noPeople'
  | 'noSimilar'
  | 'baseRate';

const PEOPLE_FEATURES: readonly FeatureName[] = ['assigneeLateRate', 'noAssignee', 'logDaysPerPoint', 'paceRatio'];

export const ARM_FEATURES: Readonly<Record<Exclude<ArmName, 'rules' | 'baseRate'>, readonly InputName[]>> = {
  logreg: FEATURE_NAMES,
  logregFree: FEATURE_NAMES,
  timeOnly: ['logDaysLeft'],
  timeProgress: ['logDaysLeft', 'progressGap'],
  // Moc so cua P2v4 (§22.4): so ngay con lai + trang thai hien tai (Can lam la moc)
  timeStatus: ['logDaysLeft', 'blocked', 'statusInProgress', 'statusInReview'],
  noActivity: FEATURE_NAMES.filter((f) => !HIDDEN_FEATURES.has(f)),
  noPeople: FEATURE_NAMES.filter((f) => !PEOPLE_FEATURES.includes(f)),
  noSimilar: FEATURE_NAMES.filter((f) => f !== 'similarLateRate'),
};

export const ARMS: readonly ArmName[] = ['logreg', 'logregFree', 'rules', 'timeOnly', 'timeProgress', 'timeStatus', 'noActivity', 'noPeople', 'noSimilar', 'baseRate'];

export type Predictor = (f: ExtractedFeatures) => number;

export function project(vector: readonly number[], names: readonly FeatureName[]): number[] {
  return names.map((n) => vector[FEATURE_NAMES.indexOf(n)]!);
}

/**
 * Hoc mot nhanh logistic tren tap con dac trung (cung lambda voi mo hinh chinh). `constrained` = rang buoc dau theo
 * FEATURE_SIGNS cua dung cac dac trung cua nhanh (mac dinh, giong mo hinh chinh); false chi dung cho nhanh logregFree.
 */
export function trainArm(rows: readonly SnapshotRow[], names: readonly InputName[], opts: TrainOptions, constrained = true): LogisticModel {
  const signs = constrained ? names.map((n) => INPUT_SIGNS[n]) : undefined;
  // inputVector lay theo ten - voi ten trong FEATURE_NAMES gia tri trung dung f.vector (tep v1-v3 khong doi)
  return trainLogistic(rows.map((r) => ({ x: inputVector(r.features, names), y: r.y })), { ...opts, signs });
}

/**
 * Mo hinh hoc tren tap con `names` -> mo hinh du 15 cot theo FEATURE_NAMES (§21.2): cot khong dung co trung binh 0, do lech
 * chuan 1, he so 0 nen dong gop luon bang 0 - bo quet cham va validateModelFile kiem nhu moi tep khac. Du 15 thi tra nguyen.
 */
export function expandModel(m: LogisticModel, names: readonly FeatureName[]): LogisticModel {
  if (names.length === FEATURE_NAMES.length && names.every((n, i) => n === FEATURE_NAMES[i])) return m;
  const idx = names.map((n) => FEATURE_NAMES.indexOf(n));
  if (idx.some((i) => i < 0) || new Set(idx).size !== idx.length || m.weights.length !== names.length) {
    throw new RangeError('tap dac trung khong khop mo hinh');
  }
  const mean = FEATURE_NAMES.map(() => 0);
  const std = FEATURE_NAMES.map(() => 1);
  const weights = FEATURE_NAMES.map(() => 0);
  idx.forEach((i, k) => {
    mean[i] = m.mean[k]!;
    std[i] = m.std[k]!;
    weights[i] = m.weights[k]!;
  });
  return { mean, std, weights, bias: m.bias };
}

/**
 * Bo du doan cho tung nhanh. `full` = mo hinh chinh (doc tu tep); cac nhanh logistic con lai hoc lai tren CUNG tap hoc
 * voi cung lambda (co rang buoc dau, tru logregFree); `rules` = luat co dinh (xac suat = diem / 100); `baseRate` = ti le tre
 * cua tap hoc.
 */
export function buildPredictors(full: NamedModel, train: readonly SnapshotRow[], opts: TrainOptions): Record<ArmName, Predictor> {
  const baseRate = train.reduce((a, r) => a + r.y, 0) / train.length;
  const out = {} as Record<ArmName, Predictor>;
  for (const arm of ARMS) {
    if (arm === 'logreg') out[arm] = (f) => predictProbability(full, modelInput(full, f));
    else if (arm === 'rules') out[arm] = (f) => ruleScore(f) / 100;
    else if (arm === 'baseRate') out[arm] = () => baseRate;
    else {
      const names = ARM_FEATURES[arm];
      const m = trainArm(train, names, opts, arm !== 'logregFree');
      out[arm] = (f) => predictProbability(m, inputVector(f, names));
    }
  }
  return out;
}

// ---------- Tap du lieu ----------
export interface WorldRows {
  world: RiskWorld;
  rows: SnapshotRow[];
}

export function buildTrainSet(
  seeds: readonly number[],
  sim: SimVersion = 'v1',
  disable: readonly Mechanism[] = []
): { priors: RiskPriors; worlds: RiskWorld[]; rows: SnapshotRow[] } {
  const worlds = seeds.map((s) => generateWorld(s, sim, disable));
  const priors = computePriors(worlds);
  const rows = worlds.flatMap((w) => snapshotsOfWorld(w.seed, w.cards, w.now, priors));
  return { priors, worlds, rows };
}

export function buildEvalSet(
  seeds: readonly number[],
  priors: RiskPriors,
  sim: SimVersion = 'v1',
  disable: readonly Mechanism[] = []
): WorldRows[] {
  return seeds.map((s) => {
    const world = generateWorld(s, sim, disable);
    return { world, rows: snapshotsOfWorld(s, world.cards, world.now, priors) };
  });
}

// ---------- Chi so tren anh chup ----------
export interface SeedMetrics {
  auc: number | null;
  brier: number;
  ece: number;
  logLoss: number;
  precision51: number | null;
  recall51: number | null;
  precision76: number | null;
  recall76: number | null;
  rows: number;
  positives: number;
}

export function scoreRows(rows: readonly SnapshotRow[], predict: Predictor): Scored[] {
  return rows.map((r) => ({ p: predict(r.features), y: r.y }));
}

export function metricsOf(scored: readonly Scored[]): SeedMetrics {
  const at51 = atThreshold(scored, 51);
  const at76 = atThreshold(scored, 76);
  let ll = 0;
  for (const s of scored) {
    const p = Math.min(1 - 1e-12, Math.max(1e-12, s.p));
    ll += s.y === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return {
    auc: auc(scored),
    brier: brier(scored),
    ece: ece(scored),
    logLoss: ll / scored.length,
    precision51: at51.precision,
    recall51: at51.recall,
    precision76: at76.precision,
    recall76: at76.recall,
    rows: scored.length,
    positives: scored.filter((s) => s.y === 1).length,
  };
}

// ---------- Mo phong bo quet theo ngay (§8.3) ----------
export interface TimelineStats {
  /** So lan "len muc bao" (moi lan = 1 thong bao cho moi nguoi nhan). */
  notifications: number;
  /** So nguoi x so tuan cua the gioi - mau so cua "thong bao / nguoi / tuan". */
  personWeeks: number;
  /** The rot cuoc tre (ket qua luc cuoi the gioi). */
  lateCards: number;
  /** ...trong do duoc bao (>= Canh bao) TRUOC han it nhat mot lan. */
  warnedLate: number;
  /** So ngay bao truoc han (lan bao dau tien) cua tung the tre duoc bao. */
  leadDays: number[];
  /** The duoc bao it nhat mot lan / trong do xong dung han tinh theo han luc bao (bao nham). */
  warnedCards: number;
  falseAlarms: number;
  /** Lan danh gia o muc >= Canh bao ma khong co ly do hien thi nao (he qua cua viec giau tan suat hoat dong, §6.3). */
  warnAssessments: number;
  emptyReasons: number;
}

/** Quet moi ngay luc 09:00: the dang mo co han trong (t, t + 14 ngay]; bao khi len muc, vung dem <= 40, doi han thi dat lai. */
export function runTimeline(world: RiskWorld, priors: RiskPriors, assess: (f: ExtractedFeatures) => RiskAssessment): TimelineStats {
  const stats: TimelineStats = {
    notifications: 0,
    personWeeks: (world.people.length * RISK_SIM_DAYS) / 7,
    lateCards: 0,
    warnedLate: 0,
    leadDays: [],
    warnedCards: 0,
    falseAlarms: 0,
    warnAssessments: 0,
    emptyReasons: 0,
  };
  // Trang thai bao cua tung the - CUNG dang voi CardRisk ma bo quet that luu (level, notifiedLevel, dueDateUsed)
  const prev = new Map<string, PreviousRisk>();
  const firstWarn = new Map<string, Date>();
  const start = world.now.getTime() - RISK_SIM_DAYS * DAY_MS;
  for (let d = 0; d < RISK_SIM_DAYS; d += 1) {
    const t = new Date(start + d * DAY_MS + 9 * 3_600_000);
    const open = world.cards.filter((c) => {
      if (!isOpenAt(c, t)) return false;
      const due = dueAt(c, t);
      return due !== null && due.getTime() > t.getTime() && due.getTime() <= t.getTime() + 14 * DAY_MS;
    });
    if (open.length === 0) continue;
    const ctx = buildRiskContext(world.cards, t, priors, 'replay');
    for (const c of open) {
      const f = extractFeatures(c, ctx);
      if (f === null) continue;
      const a = assess(f);
      const dueDate = new Date(f.detail.dueAt);
      // DUNG ham quyet dinh cua bo quet that (risk.decide.ts) - danh gia do dung luat dang chay, khong phai mot ban chep
      const decision = decideNotify(prev.get(c.id) ?? null, a, { dueDate, now: t, bootstrap: false });
      prev.set(c.id, { level: a.level, notifiedLevel: decision.notifiedLevel, dueDateUsed: dueDate });
      if (LEVEL_RANK[a.level] >= LEVEL_RANK[NOTIFY_MIN_LEVEL]) {
        stats.warnAssessments += 1;
        if (a.reasons.length === 0) stats.emptyReasons += 1;
      }
      if (decision.notify) {
        stats.notifications += 1;
        if (!firstWarn.has(c.id)) firstWarn.set(c.id, t);
      }
    }
  }
  for (const c of world.cards) {
    const warnedAt = firstWarn.get(c.id);
    if (warnedAt) {
      stats.warnedCards += 1;
      if (labelAt(c, warnedAt, world.now) === 0) stats.falseAlarms += 1;
    }
    const o = outcomeAt(c, world.now);
    if (o === null || !o.late) continue;
    stats.lateCards += 1;
    if (warnedAt) {
      stats.warnedLate += 1;
      stats.leadDays.push((dueAt(c, warnedAt)!.getTime() - warnedAt.getTime()) / DAY_MS);
    }
  }
  return stats;
}

export function timelineSummary(s: TimelineStats) {
  return {
    notificationsPerPersonWeek: s.notifications / s.personWeeks,
    coverage: s.lateCards > 0 ? s.warnedLate / s.lateCards : null,
    medianLeadDays: median(s.leadDays),
    falseAlarmRate: s.warnedCards > 0 ? s.falseAlarms / s.warnedCards : null,
    emptyReasonRate: s.warnAssessments > 0 ? s.emptyReasons / s.warnAssessments : null,
  };
}
