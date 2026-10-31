// Khoi hien thi THAT cua mot ke hoach da luu (xem truoc / ket qua) - dung chung boi service, executor va lich su hoi thoai.

import { buildPlanView, buildResultView, errorText } from './actions.plan';
import type { PlanRow } from './actions.plan.repo';
import type { ActionErrorCode, ActionView, ConfirmReason, PlanStatus, ResultStatus, ResultView, StoredPlan } from './actions.types';

export const CANCELLED_TEXT = 'Đã hủy kế hoạch. Chưa thay đổi gì.';

export function planViewOf(row: PlanRow, stored: StoredPlan, status: PlanStatus, now: Date) {
  return buildPlanView({
    planId: row.id,
    checksum: row.checksum,
    status,
    risk: row.risk,
    requiresConfirmation: row.requiresConfirmation,
    reasons: (row.reasons as unknown as ConfirmReason[] | null) ?? [],
    expiresAt: row.expiresAt,
    boardId: stored.boardId,
    boardName: stored.boardName,
    ops: stored.ops,
    warnings: stored.warnings ?? [],
    now,
    ...(stored.kind === 'PATCH' && stored.patch !== undefined
      ? { patch: { newLists: stored.patch.newLists, newCards: stored.patch.newCards, skipped: stored.patch.skipped, untouched: stored.patch.untouched, context: stored.patch.context } }
      : {}),
  });
}

/** Ket qua da luu (hoac suy ra tu trang thai) cua mot ke hoach DA CHOT. `replay` = lan tra loi thu hai tro di. */
export function resultFromRow(row: PlanRow, replay = false): ResultView {
  const plan = row.plan as unknown as StoredPlan;
  const saved = row.result as unknown as (ResultView & { detail?: string }) | null;
  if (saved && (row.status === 'EXECUTED' || row.status === 'FAILED' || row.status === 'STALE')) {
    const { detail: _detail, ...view } = saved;
    return { ...view, planId: row.id, status: row.status, ...(replay && row.status === 'EXECUTED' ? { alreadyApplied: true } : {}) };
  }
  const code = row.errorCode as ActionErrorCode | null;
  const status: ResultStatus =
    row.status === 'EXECUTED' || row.status === 'FAILED' || row.status === 'STALE' || row.status === 'CANCELLED' || row.status === 'EXPIRED'
      ? row.status
      : 'FAILED';
  let summary: string;
  if (status === 'CANCELLED') summary = code === 'SCOPE_CHANGED' || code === 'SUPERSEDED' ? errorText(code) : CANCELLED_TEXT;
  else if (status === 'EXPIRED') summary = errorText('EXPIRED');
  else summary = errorText(code ?? 'INVALID');
  return buildResultView({
    planId: row.id,
    status,
    autoExecuted: row.autoExecuted,
    summary,
    boardId: plan.boardId,
    ...(code !== null && ['SCOPE_CHANGED', 'SUPERSEDED', 'EXPIRED', 'STALE', 'FORBIDDEN', 'NOT_FOUND', 'INVALID', 'INTERRUPTED'].includes(code)
      ? { error: { code, text: summary } }
      : {}),
    warnings: plan.warnings ?? [],
  });
}

/** Khoi hien thi THAT cua mot ke hoach (de phu len ban chup cu khi mo lai lich su). Het han tinh theo `now`, khong ghi CSDL. */
export function viewFromRow(row: PlanRow, now: Date): ActionView {
  const stored = row.plan as unknown as StoredPlan;
  const open = row.status === 'PROPOSED' || row.status === 'NEEDS_CHOICE';
  const status: PlanStatus = open && row.expiresAt.getTime() <= now.getTime() ? 'EXPIRED' : row.status;
  if (status === 'PROPOSED' || status === 'NEEDS_CHOICE' || status === 'EXECUTING') {
    return { kind: 'PLAN', plan: planViewOf(row, stored, status, now) };
  }
  return { kind: 'RESULT', result: resultFromRow({ ...row, status }, false) };
}
