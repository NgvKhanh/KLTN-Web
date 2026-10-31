// Mo hinh hien thi chung cho mau bang co san (tu code) va mau cua nguoi dung (da luu). HAM THUAN.
import type { BoardTemplate } from './api/board';
import { fold } from './textFold';
import type { CardStatus } from '../types/card';
import type { UserBoardTemplate } from '../types/boardTemplate';

/** Nhom dac biet cho mau do nguoi dung tu luu. */
export const MINE_CATEGORY = 'mine';

export interface TemplateList {
  name: string;
  status: CardStatus | null;
  cards: string[];
}

export interface TemplateItem {
  /** "b:<id>" (co san) hoac "u:<id>" (cua nguoi dung): khoa duy nhat trong danh sach hien thi. */
  key: string;
  id: string;
  source: 'builtin' | 'user';
  name: string;
  description: string;
  color: string;
  category: string;
  labels: { name: string; color: string }[];
  lists: TemplateList[];
  createdBy?: string;
}

export function fromBuiltin(t: BoardTemplate): TemplateItem {
  return {
    key: `b:${t.id}`,
    id: t.id,
    source: 'builtin',
    name: t.name,
    description: t.description,
    color: t.color,
    category: t.category,
    labels: t.labels ?? [],
    lists: t.lists,
  };
}

export function fromUser(t: UserBoardTemplate): TemplateItem {
  return {
    key: `u:${t.id}`,
    id: t.id,
    source: 'user',
    name: t.name,
    description: '',
    color: t.color,
    category: MINE_CATEGORY,
    labels: [],
    lists: t.lists.map((l) => ({ name: l.name, status: l.status ?? null, cards: l.cards.map((c) => c.title) })),
    createdBy: t.createdBy.name,
  };
}

export const cardCount = (t: TemplateItem): number => t.lists.reduce((n, l) => n + l.cards.length, 0);

/** Khop ten, mo ta, ten cot, tieu de the va ten nhan (khong phan biet hoa thuong / dau). Chuoi tim rong = khop het. */
export function matchesTemplate(t: TemplateItem, query: string): boolean {
  const q = fold(query);
  if (q === '') return true;
  const haystack = [t.name, t.description, ...t.lists.map((l) => l.name), ...t.lists.flatMap((l) => l.cards), ...t.labels.map((l) => l.name)];
  return haystack.some((s) => fold(s).includes(q));
}
