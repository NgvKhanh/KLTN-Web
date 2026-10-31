import type { AssignPlanPerson, AssignPlanRanking, AssignPlanRow } from '../types/assign';
import { riskWarning } from './assignLabels';

// Phan tinh toan cua man hinh chia viec (lop 2, ASSIGN_MODULE.md §10.10): HAM THUAN de test khong can dung giao dien.

/** Nguoi duoc chon cho tung the: cardId -> userId; null = de trong (khong giao the nay). */
export type PlanPicks = Record<string, string | null>;

/** Lua chon ban dau = goi y cua may chu (khong ai du dieu kien thi de trong). */
export function initialPicks(rows: readonly AssignPlanRow[]): PlanPicks {
  return Object.fromEntries(rows.map((r) => [r.card.id, r.assignee ? r.assignee.user.id : null]));
}

/** Mac dinh chi tick nhung the co nguoi duoc chon. */
export function initialIncluded(rows: readonly AssignPlanRow[]): Record<string, boolean> {
  return Object.fromEntries(rows.map((r) => [r.card.id, r.assignee !== null]));
}

export interface PlanSelection {
  cardId: string;
  userId: string;
}

/** Cac the SE duoc giao: da tick, co nguoi duoc chon, chua giao xong o lan truoc; theo thu tu xu ly cua may chu. */
export function selectedRows(
  rows: readonly AssignPlanRow[],
  picks: PlanPicks,
  included: Record<string, boolean>,
  done: ReadonlySet<string> = new Set()
): PlanSelection[] {
  const out: PlanSelection[] = [];
  for (const r of rows) {
    const userId = picks[r.card.id];
    if (included[r.card.id] && userId && !done.has(r.card.id)) out.push({ cardId: r.card.id, userId });
  }
  return out;
}

export interface PersonShare {
  person: AssignPlanPerson;
  /** So the moi nguoi nay se nhan. */
  added: number;
  /** So the dang mo sau khi ap dung (cach tinh tho: dem CA the khong chong lan thoi gian). */
  total: number;
  /** Vuot suc chua song song. */
  over: boolean;
}

/** Sau khi ap dung: moi nguoi nhan them may the va co vuot suc chua song song khong. */
export function distribution(people: readonly AssignPlanPerson[], selection: readonly PlanSelection[]): PersonShare[] {
  return people.map((person) => {
    const added = selection.filter((s) => s.userId === person.user.id).length;
    const total = person.openCards + added;
    return { person, added, total, over: total > person.capacity };
  });
}

/** Canh bao (neu co) khi nguoi duoc chon cho the nay dang qua tai / tam nghi, theo xep hang cua CHINH the do. */
export function rowWarning(row: AssignPlanRow, userId: string | null, name: string): string | null {
  if (!userId) return null;
  const r = row.ranking.find((x) => x.userId === userId);
  return r ? riskWarning(name, r.flags, r) : null;
}

/** Nhan mot lua chon trong o chon nguoi: ten + diem tuong doi + co qua tai / tam nghi. */
export function optionLabel(name: string, r: AssignPlanRanking): string {
  const parts = [r.score === null ? 'chưa đủ dữ liệu' : `phù hợp ${Math.round(r.score)}`];
  if (r.flags.includes('PAUSED')) parts.push('tạm nghỉ');
  if (r.flags.includes('OVERLOADED')) parts.push('quá tải');
  return `${name} — ${parts.join(' · ')}`;
}

export interface ApplyFailure {
  cardId: string;
  message: string;
}
export interface ApplyResult {
  done: string[];
  failed: ApplyFailure[];
}

/**
 * Giao tung the MOT, TUAN TU: moi lan giao ghi nhat ky va gui thong bao nen khong chay song song; loi cua mot the khong chan
 * cac the con lai (the loi duoc bao rieng de nguoi dung thu lai).
 */
export async function applySelection(
  selection: readonly PlanSelection[],
  add: (cardId: string, userId: string) => Promise<void>,
  messageOf: (err: unknown) => string,
  onDone?: (cardId: string) => void
): Promise<ApplyResult> {
  const done: string[] = [];
  const failed: ApplyFailure[] = [];
  for (const s of selection) {
    try {
      await add(s.cardId, s.userId);
      done.push(s.cardId);
      onDone?.(s.cardId);
    } catch (err) {
      failed.push({ cardId: s.cardId, message: messageOf(err) });
    }
  }
  return { done, failed };
}
