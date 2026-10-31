// Quyet dinh "co bao khong" cho MOT the sau moi lan cham (RISK_MODULE.md §8.3). HAM THUAN - bo quet that (risk.service.ts)
// va mo phong bo quet trong danh gia (scripts/riskEval.ts) cung tuan theo cac luat nay.
//
//   - Thong bao KHONG noi muc (user chot 30/10), chi 2 loai, moi loai toi da 1 lan cho moi phien ban han:
//       "co nguy co tre han" - the chua qua han, muc >= Canh bao (len Nguy cap KHONG bao them);
//       "da tre han"         - the vua qua han (bao ca khi truoc do da bao nguy co).
//     Cot notifiedLevel giu kieu RiskLevel (khong doi CSDL) nhung mang nghia MOC DA BAO: WARNING = da bao nguy co,
//     CRITICAL = da bao tre han.
//   - Vung dem: notifiedLevel chi ve null khi diem <= 40, hoac khi DOI HAN (tinh huong moi).
//   - Lan quet dau tien voi mot phien ban mo hinh (risk.service.ts) va the qua han >= 24 gio: chi ghi nhan moc (notifiedLevel), KHONG gui -
//     tranh vua bat module la ca loat email bay di, va khong bao cho the da tre tu lau.

import { LEVEL_RANK, NOTIFY_MIN_LEVEL, NOTIFY_RESET_SCORE, type RiskLevel } from './risk.levels';

export const OVERDUE_SILENT_MS = 24 * 3_600_000;

export interface PreviousRisk {
  level: RiskLevel;
  notifiedLevel: RiskLevel | null;
  dueDateUsed: Date;
}

/** Loai thong bao: "co nguy co tre han" / "da tre han". */
export type NotifyKind = 'risk' | 'overdue';

/** Moc luu vao notifiedLevel cho tung loai (xem dau tep). */
const KIND_MARK: Readonly<Record<NotifyKind, RiskLevel>> = { risk: 'WARNING', overdue: 'CRITICAL' };

export interface NotifyDecision {
  /** Gui thong bao (+ email) lan nay. */
  notify: boolean;
  /** Loai thong bao khi notify = true; null khi khong gui. */
  kind: NotifyKind | null;
  /** Gia tri moi cua notifiedLevel de luu lai. */
  notifiedLevel: RiskLevel | null;
  /** Muc doi so voi lan cham truoc (hoac lan dau cham) -> ghi CardRiskEvent + lam moi bang. */
  levelChanged: boolean;
}

export function decideNotify(
  prev: PreviousRisk | null,
  current: { score: number; level: RiskLevel },
  ctx: { dueDate: Date; now: Date; bootstrap: boolean }
): NotifyDecision {
  let notified = prev !== null && prev.dueDateUsed.getTime() === ctx.dueDate.getTime() ? prev.notifiedLevel : null;
  if (current.score <= NOTIFY_RESET_SCORE) notified = null;
  // Qua han = han da qua (cung dieu kien isOverdue cua risk.explain: han < t)
  const overdue = ctx.dueDate.getTime() < ctx.now.getTime();
  const kind: NotifyKind | null = overdue ? 'overdue' : LEVEL_RANK[current.level] >= LEVEL_RANK[NOTIFY_MIN_LEVEL] ? 'risk' : null;
  const rising = kind !== null && (notified === null || LEVEL_RANK[KIND_MARK[kind]] > LEVEL_RANK[notified]);
  const silent = ctx.bootstrap || ctx.now.getTime() - ctx.dueDate.getTime() >= OVERDUE_SILENT_MS;
  if (rising) notified = KIND_MARK[kind];
  const notify = rising && !silent;
  return {
    notify,
    kind: notify ? kind : null,
    notifiedLevel: notified,
    levelChanged: prev === null || prev.level !== current.level,
  };
}

/**
 * Ket qua con hieu luc khong (§8.2): the chua xong, chua luu tru, han khong doi tu luc cham. Bo quet chay 30 phut / lan nen giua
 * hai lan quet ket qua cu bi AN thay vi hien sai (vd vua doi han, vua danh dau xong). Dat o day (ham thuan) de list.service dung
 * duoc ma khong keo theo risk.service -> card.service -> list.service (import vong).
 */
export function isRiskFresh(
  risk: { dueDateUsed: Date } | null,
  card: { isDone: boolean; dueDate: Date | null; archivedAt?: Date | null }
): boolean {
  return risk !== null && !card.isDone && !card.archivedAt && card.dueDate !== null && card.dueDate.getTime() === risk.dueDateUsed.getTime();
}
