// Luat co dinh (cach 1) - RISK_MODULE.md §6.4. HAM THUAN. Cac con so tu dat va da CO DINH TRUOC khi chay danh gia (de so sanh
// cong bang voi mo hinh hoc); khong chinh sau khi da thay ket qua. Dung lam moc so sanh (§13) va du phong khi tep mo hinh hong.

import type { ExtractedFeatures } from './risk.features';

/** Tung khoan diem, dat ten theo nhom ly do (§6.3) de chon ly do giong het cach mo hinh lam. INACTIVE khong bao gio hien. */
export interface RuleTerms {
  BEHIND_SCHEDULE: number;
  LITTLE_TIME: number;
  BLOCKED: number;
  NO_ASSIGNEE: number;
  ASSIGNEE_LATE_HISTORY: number;
  SIMILAR_LATE: number;
  INACTIVE: number;
  HIGH_COMPLEXITY: number;
}

export function ruleTerms(f: ExtractedFeatures): RuleTerms {
  const d = f.detail;
  const mu = d.workspaceLateRate;
  return {
    BEHIND_SCHEDULE: 60 * Math.max(0, f.values.progressGap),
    LITTLE_TIME: d.daysLeft <= 1 ? 20 : d.daysLeft <= 3 ? 10 : 0,
    BLOCKED: (f.values.blocked === 1 ? 20 : 0) + Math.min(10, 2 * d.blockedDays),
    NO_ASSIGNEE: f.values.noAssignee === 1 ? 15 : 0,
    ASSIGNEE_LATE_HISTORY: 30 * Math.max(0, f.values.assigneeLateRate - mu),
    SIMILAR_LATE: 20 * Math.max(0, f.values.similarLateRate - mu),
    INACTIVE: Math.min(15, 3 * Math.max(0, d.daysSinceActivity - 2)),
    HIGH_COMPLEXITY: d.points >= 8 ? 10 : d.points >= 5 ? 5 : 0,
  };
}

/** Diem 0-100 cua luat co dinh. */
export function ruleScore(f: ExtractedFeatures): number {
  const t = ruleTerms(f);
  const s = Object.values(t).reduce((a, b) => a + b, 0);
  return Math.min(100, Math.max(0, Math.round(s)));
}
