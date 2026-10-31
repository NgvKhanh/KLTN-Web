// Tu dac trung ra ket qua cuoi: diem, muc, ly do (RISK_MODULE.md §6.2-§6.5). HAM THUAN.
//
// Ly do = cac NHOM yeu to co dong gop duong lon nhat (mo hinh: tong w_j * z_j cua nhom > 0,1 logit; luat: khoan diem > 0), toi da 3.
// Hai dac trung tan suat hoat dong KHONG thuoc nhom nao -> khong bao gio thanh ly do (user chot §2). Nhom chi duoc chon khi co
// du lieu that de noi (vd "nguoi duoc giao tre 6/10" can nguoi do co it nhat 1 the da co ket qua).

import { FEATURE_NAMES, inputVector, type ExtractedFeatures, type FeatureDetail, type FeatureName, type InputName } from './risk.features';
import { levelOf, scoreOf, type RiskLevel } from './risk.levels';
import { contributions, predictProbability, type LogisticModel } from './risk.model';
import { ruleScore, ruleTerms } from './risk.rules';

export type ReasonCode =
  | 'OVERDUE'
  | 'BEHIND_SCHEDULE'
  | 'LITTLE_TIME'
  | 'HIGH_COMPLEXITY'
  | 'SUBTASKS_LEFT'
  | 'BLOCKED'
  | 'ASSIGNEE_LATE_HISTORY'
  | 'ASSIGNEE_SLOW'
  | 'NO_ASSIGNEE'
  | 'SIMILAR_LATE';

/** Ly do nhac toi NGUOI CU THE - chi nguoi duoc giao + chu / quan tri bang thay so lieu (Q2, §12). */
export const PERSONAL_REASONS: ReadonlySet<ReasonCode> = new Set(['ASSIGNEE_LATE_HISTORY', 'ASSIGNEE_SLOW']);

export interface RiskReason {
  code: ReasonCode;
  params: Record<string, number | boolean>;
}

export interface RiskAssessment {
  probability: number;
  score: number;
  level: RiskLevel;
  reasons: RiskReason[];
  modelVersion: string;
}

export const MAX_REASONS = 3;
/** Nguong dong gop (logit) de mot nhom yeu to du "noi bat" (§6.3). */
export const MIN_LOGIT_CONTRIBUTION = 0.1;

/** Dac trung -> nhom ly do. Dac trung an (tan suat hoat dong) co y KHONG co mat. */
export const FEATURE_GROUP: Readonly<Partial<Record<FeatureName, ReasonCode>>> = {
  progressGap: 'BEHIND_SCHEDULE',
  logDaysLeft: 'LITTLE_TIME',
  log2Points: 'HIGH_COMPLEXITY',
  pointsEstimated: 'HIGH_COMPLEXITY',
  logSubtasksDone: 'SUBTASKS_LEFT',
  logSubtasksLeft: 'SUBTASKS_LEFT',
  blocked: 'BLOCKED',
  logBlockedDays: 'BLOCKED',
  assigneeLateRate: 'ASSIGNEE_LATE_HISTORY',
  noAssignee: 'NO_ASSIGNEE',
  logDaysPerPoint: 'ASSIGNEE_SLOW',
  paceRatio: 'ASSIGNEE_SLOW',
  similarLateRate: 'SIMILAR_LATE',
};

/** Thu tu co dinh de pha hoa khi hai nhom bang diem. */
const CODE_ORDER: readonly ReasonCode[] = [
  'BEHIND_SCHEDULE',
  'LITTLE_TIME',
  'BLOCKED',
  'NO_ASSIGNEE',
  'ASSIGNEE_SLOW',
  'ASSIGNEE_LATE_HISTORY',
  'SUBTASKS_LEFT',
  'SIMILAR_LATE',
  'HIGH_COMPLEXITY',
];

const round1 = (x: number) => Math.round(x * 10) / 10;
const pct = (x: number) => Math.round(x * 100);

/** Tham so cua ly do; null = khong du du lieu that de noi ly do nay (bo qua nhom du dong gop lon). */
function paramsOf(code: ReasonCode, f: ExtractedFeatures): RiskReason['params'] | null {
  const d = f.detail;
  switch (code) {
    case 'BEHIND_SCHEDULE':
      return d.expectedProgress > d.actualProgress ? { expectedPct: pct(d.expectedProgress), actualPct: pct(d.actualProgress) } : null;
    case 'LITTLE_TIME':
      return { daysLeft: round1(d.daysLeft) };
    case 'HIGH_COMPLEXITY':
      // Chi noi "phuc tap" khi that su lon (>= 5 diem, cung moc voi luat co dinh): dong gop cua co "diem la uoc luong" tren mot
      // the 2 diem khong phai ly do de noi the do phuc tap.
      return d.points >= 5 ? { points: d.points, estimated: d.pointsEstimated } : null;
    case 'SUBTASKS_LEFT':
      return d.subtasksTotal > d.subtasksDone ? { done: d.subtasksDone, total: d.subtasksTotal } : null;
    case 'BLOCKED':
      return d.blockedDays > 0 || f.values.blocked === 1 ? { days: round1(d.blockedDays), current: f.values.blocked === 1 } : null;
    case 'NO_ASSIGNEE':
      return f.values.noAssignee === 1 ? {} : null;
    // Chua ai nhan -> danh sach assignees rong -> hai nhom duoi tu tra null (khong co gi de noi ve nguoi)
    case 'ASSIGNEE_LATE_HISTORY': {
      const outcomeCount = d.assignees.reduce((a, x) => a + x.outcomeCount, 0);
      if (outcomeCount === 0) return null;
      return { lateCount: d.assignees.reduce((a, x) => a + x.lateCount, 0), outcomeCount };
    }
    case 'ASSIGNEE_SLOW':
      if (d.assignees.every((x) => x.doneCount === 0)) return null;
      return { needDays: round1(d.needDays), daysLeft: round1(d.daysLeft) };
    case 'SIMILAR_LATE':
      return d.similar.count > 0 ? { lateCount: d.similar.lateCount, count: d.similar.count } : null;
    case 'OVERDUE':
      return null;
  }
}

/** Chon toi da 3 nhom co diem nhom > `minScore`, xep giam dan; nhom khong du du lieu bi bo. */
export function pickReasons(groupScores: ReadonlyMap<ReasonCode, number>, f: ExtractedFeatures, minScore: number): RiskReason[] {
  const ranked = [...groupScores.entries()]
    .filter(([, s]) => s > minScore)
    .sort((a, b) => b[1] - a[1] || CODE_ORDER.indexOf(a[0]) - CODE_ORDER.indexOf(b[0]));
  const out: RiskReason[] = [];
  for (const [code] of ranked) {
    const params = paramsOf(code, f);
    if (params === null) continue;
    out.push({ code, params });
    if (out.length === MAX_REASONS) break;
  }
  return out;
}

/** The da qua han ma chua xong: da tre, khong can doan (§6.5). */
export function overdueAssessment(detail: FeatureDetail): RiskAssessment {
  const days = (Date.parse(detail.t) - Date.parse(detail.dueAt)) / 86_400_000;
  return { probability: 1, score: 100, level: 'CRITICAL', reasons: [{ code: 'OVERDUE', params: { days: round1(days) } }], modelVersion: 'overdue' };
}

export function isOverdue(detail: FeatureDetail): boolean {
  return Date.parse(detail.dueAt) < Date.parse(detail.t);
}

/** Mo hinh kem ten dau vao (tep mo hinh); khong co `features` = du 15 dac trung theo FEATURE_NAMES. */
export type NamedModel = LogisticModel & { features?: readonly string[] };

/** Vector dau vao cua mo hinh, lay THEO TEN dau vao tep khai bao (§22.2). Tep 15 dac trung -> dung bang `f.vector`. */
export function modelInput(model: NamedModel, f: ExtractedFeatures): number[] {
  return model.features ? inputVector(f, model.features as InputName[]) : f.vector;
}

export function assessWithModel(model: NamedModel, version: string, f: ExtractedFeatures): RiskAssessment {
  if (isOverdue(f.detail)) return overdueAssessment(f.detail);
  const x = modelInput(model, f);
  const probability = predictProbability(model, x);
  const contrib = contributions(model, x);
  const groups = new Map<ReasonCode, number>();
  // Dac trung an (HIDDEN_FEATURES) va hai o trang thai khong co trong FEATURE_GROUP nen tu dong bi bo - test canh dieu nay.
  (model.features ?? FEATURE_NAMES).forEach((name, j) => {
    const code = FEATURE_GROUP[name as FeatureName];
    if (code) groups.set(code, (groups.get(code) ?? 0) + contrib[j]!);
  });
  const score = scoreOf(probability);
  return { probability, score, level: levelOf(score), reasons: pickReasons(groups, f, MIN_LOGIT_CONTRIBUTION), modelVersion: version };
}

export const RULES_VERSION = 'rules-v1';

export function assessWithRules(f: ExtractedFeatures): RiskAssessment {
  if (isOverdue(f.detail)) return overdueAssessment(f.detail);
  const score = ruleScore(f);
  const groups = new Map<ReasonCode, number>();
  for (const [k, v] of Object.entries(ruleTerms(f))) if (k !== 'INACTIVE') groups.set(k as ReasonCode, v);
  return { probability: score / 100, score, level: levelOf(score), reasons: pickReasons(groups, f, 0), modelVersion: RULES_VERSION };
}
