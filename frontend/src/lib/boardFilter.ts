import type { Card, CardStatus } from '../types/card';

export interface BoardFilter {
  keyword: string;
  memberIds: string[];
  noMembers: boolean;
  assignedToMe: boolean;
  complete: boolean;
  incomplete: boolean;
  // Trang thai cong viec (chon nhieu, the khop 1 trong so do la dat)
  statuses: CardStatus[];
  dueNone: boolean;
  dueOverdue: boolean;
  dueTomorrow: boolean;
  dueWeek: boolean;
  labelIds: string[];
}

export const EMPTY_FILTER: BoardFilter = {
  keyword: '',
  memberIds: [],
  noMembers: false,
  assignedToMe: false,
  complete: false,
  incomplete: false,
  statuses: [],
  dueNone: false,
  dueOverdue: false,
  dueTomorrow: false,
  dueWeek: false,
  labelIds: [],
};

export function filterActiveCount(f: BoardFilter): number {
  let n = 0;
  if (f.keyword.trim()) n += 1;
  n += f.memberIds.length + f.labelIds.length + f.statuses.length;
  for (const b of [
    f.noMembers,
    f.assignedToMe,
    f.complete,
    f.incomplete,
    f.dueNone,
    f.dueOverdue,
    f.dueTomorrow,
    f.dueWeek,
  ]) {
    if (b) n += 1;
  }
  return n;
}

export function isFilterActive(f: BoardFilter): boolean {
  return filterActiveCount(f) > 0;
}

// Trong 1 nhom la OR, giua cac nhom la AND (giong Trello)
export function cardMatchesFilter(
  card: Card,
  f: BoardFilter,
  currentUserId?: string
): boolean {
  const kw = f.keyword.trim().toLowerCase();
  if (kw) {
    const hay = `${card.title} ${card.description ?? ''}`.toLowerCase();
    if (!hay.includes(kw)) return false;
  }

  const memberOn =
    f.noMembers || f.assignedToMe || f.memberIds.length > 0;
  if (memberOn) {
    const ids = card.members?.map((m) => m.userId) ?? [];
    let ok = false;
    if (f.noMembers && ids.length === 0) ok = true;
    if (f.assignedToMe && currentUserId && ids.includes(currentUserId)) ok = true;
    if (f.memberIds.some((id) => ids.includes(id))) ok = true;
    if (!ok) return false;
  }

  if (f.complete || f.incomplete) {
    const ok = (f.complete && card.isDone) || (f.incomplete && !card.isDone);
    if (!ok) return false;
  }

  if (f.statuses.length > 0 && !f.statuses.includes(card.status)) return false;

  const dueOn = f.dueNone || f.dueOverdue || f.dueTomorrow || f.dueWeek;
  if (dueOn) {
    const due = card.dueDate ? new Date(card.dueDate).getTime() : null;
    const now = Date.now();
    const endTomorrow = (() => {
      const d = new Date();
      d.setHours(23, 59, 59, 999);
      d.setDate(d.getDate() + 1);
      return d.getTime();
    })();
    let ok = false;
    if (f.dueNone && due === null) ok = true;
    if (due !== null) {
      if (f.dueOverdue && due < now && !card.isDone) ok = true;
      if (f.dueTomorrow && due >= now && due <= endTomorrow) ok = true;
      if (f.dueWeek && due >= now && due <= now + 7 * 86400000) ok = true;
    }
    if (!ok) return false;
  }

  if (f.labelIds.length > 0) {
    const cardLabelIds = card.labels?.map((l) => l.labelId) ?? [];
    if (!f.labelIds.some((id) => cardLabelIds.includes(id))) return false;
  }

  return true;
}
