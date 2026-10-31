// Logic THUAN de sua ke hoach AI o man xem truoc (khong React, khong mang, khong doc dong ho).
// Moi ham tra ban sao moi, KHONG sua doi tuong dau vao (state cua React phai bat bien).
//
// Server la noi kiem tra THAT (Zod cua BoardPlan). validatePlan o day chi de nut "Tao bang" bao
// truoc nhung loi ma server chac chan tu choi - nguoi dung khoi phai cho 400.

import type { BoardPlan, DateOrigin, PlanCard, PlanWarning } from '../types/ai';

/** Do dai toi da o nhap (UX). Server van la noi cat/kiem that. */
export const PLAN_INPUT_LIMITS = { boardName: 100, listName: 100, cardTitle: 500 } as const;

export type PlanDateField = 'startDate' | 'dueDate';

export interface PlanIssue {
  scope: 'board' | 'list' | 'card' | 'plan';
  listIndex?: number;
  /** Ma the (ref) neu loi cua 1 the. */
  ref?: string;
  message: string;
}

export const ORIGIN_LABEL: Record<DateOrigin, string> = {
  EXPLICIT: 'Ghi rõ',
  SCHEDULED: 'Tự xếp',
  NONE: '',
};

// ===================== Sua ke hoach =====================

/** Thay 1 the theo ref; khong co the do thi tra NGUYEN plan (cung tham chieu). */
function mapCard(plan: BoardPlan, ref: string, fn: (card: PlanCard) => PlanCard): BoardPlan {
  let changed = false;
  const lists = plan.lists.map((list) => {
    const idx = list.cards.findIndex((c) => c.ref === ref);
    if (idx < 0) return list;
    const next = fn(list.cards[idx]!);
    if (next === list.cards[idx]) return list;
    changed = true;
    const cards = list.cards.slice();
    cards[idx] = next;
    return { ...list, cards };
  });
  return changed ? { ...plan, lists } : plan;
}

export function setBoardName(plan: BoardPlan, name: string): BoardPlan {
  return { ...plan, board: { ...plan.board, name } };
}

export function setBoardColor(plan: BoardPlan, color: string): BoardPlan {
  return { ...plan, board: { ...plan.board, color } };
}

export function setListName(plan: BoardPlan, listIndex: number, name: string): BoardPlan {
  if (!plan.lists[listIndex]) return plan;
  return { ...plan, lists: plan.lists.map((l, i) => (i === listIndex ? { ...l, name } : l)) };
}

/** Chon / bo chon TAT CA the cua 1 danh sach. */
export function setListSelected(plan: BoardPlan, listIndex: number, selected: boolean): BoardPlan {
  if (!plan.lists[listIndex]) return plan;
  return {
    ...plan,
    lists: plan.lists.map((l, i) =>
      i === listIndex ? { ...l, cards: l.cards.map((c) => (c.selected === selected ? c : { ...c, selected })) } : l
    ),
  };
}

export function setCardSelected(plan: BoardPlan, ref: string, selected: boolean): BoardPlan {
  return mapCard(plan, ref, (c) => (c.selected === selected ? c : { ...c, selected }));
}

export function setCardTitle(plan: BoardPlan, ref: string, title: string): BoardPlan {
  return mapCard(plan, ref, (c) => (c.title === title ? c : { ...c, title }));
}

/**
 * Dat / xoa ngay cua the. Server kiem cheo ngay <-> nguon: co ngay thi nguon KHONG duoc la NONE,
 * khong co ngay thi nguon PHAI la NONE. Nguoi dung tu dat ngay = "ghi ro" (EXPLICIT).
 * `value` la chuoi cua <input type="date"> ("" khi xoa). Gia tri khong doi thi giu nguyen nguon cu
 * (khong bien ngay "tu xep" thanh "ghi ro" chi vi nhap lai dung ngay do).
 */
export function setCardDate(plan: BoardPlan, ref: string, field: PlanDateField, value: string): BoardPlan {
  const next = value.trim() === '' ? null : value.trim();
  const originKey = field === 'startDate' ? 'startOrigin' : 'dueOrigin';
  return mapCard(plan, ref, (c) => {
    if (c[field] === next) return c;
    return { ...c, [field]: next, [originKey]: next === null ? 'NONE' : 'EXPLICIT' };
  });
}

// ===================== Thong ke / so sanh =====================

export function countCards(plan: BoardPlan): number {
  return plan.lists.reduce((n, l) => n + l.cards.length, 0);
}

export function countSelected(plan: BoardPlan): number {
  return plan.lists.reduce((n, l) => n + l.cards.filter((c) => c.selected).length, 0);
}

/** Nguoi dung da sua gi so voi ban AI de xuat chua (de hoi xac nhan truoc khi bo). */
export function planEdited(original: BoardPlan, current: BoardPlan): boolean {
  return JSON.stringify(original) !== JSON.stringify(current);
}

export function warningsForCard(plan: BoardPlan, ref: string): PlanWarning[] {
  return plan.warnings.filter((w) => w.ref === ref);
}

// ===================== Kiem tra truoc khi tao bang =====================

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Ngay lich THAT dang YYYY-MM-DD, nam 1970-2100 (cung khoang voi backend). */
export function isValidDay(value: string): boolean {
  const m = DAY_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1970 || y > 2100) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/** "2026-10-20" -> "20/10/2026"; gia tri la tra nguyen. */
export function formatViDate(value: string): string {
  const m = DAY_RE.exec(value);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value;
}

/**
 * Loi chan viec tao bang. CHI xet cac the DUOC TICK (the bo tick khong duoc tao nen khong can hop le)
 * va cac danh sach co the duoc tick (danh sach khong con the nao bi bo).
 */
export function validatePlan(plan: BoardPlan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  if (plan.board.name.trim() === '') {
    issues.push({ scope: 'board', message: 'Tên bảng không được để trống.' });
  }
  if (countSelected(plan) === 0) {
    issues.push({ scope: 'plan', message: 'Chưa chọn thẻ nào để tạo.' });
  }
  plan.lists.forEach((list, listIndex) => {
    const selected = list.cards.filter((c) => c.selected);
    if (selected.length === 0) return;
    if (list.name.trim() === '') {
      issues.push({ scope: 'list', listIndex, message: 'Tên danh sách không được để trống.' });
    }
    for (const card of selected) {
      const add = (message: string) => issues.push({ scope: 'card', listIndex, ref: card.ref, message });
      if (card.title.trim() === '') add('Tiêu đề thẻ không được để trống.');
      const dates: Array<[string, string | null]> = [
        ['bắt đầu', card.startDate],
        ['hạn chót', card.dueDate],
      ];
      for (const [label, value] of dates) {
        if (value !== null && !isValidDay(value)) add(`Ngày ${label} không hợp lệ (năm 1970–2100).`);
      }
      if (
        card.startDate !== null &&
        card.dueDate !== null &&
        isValidDay(card.startDate) &&
        isValidDay(card.dueDate) &&
        card.startDate > card.dueDate
      ) {
        add('Ngày bắt đầu phải trước hạn chót.');
      }
    }
  });
  return issues;
}
