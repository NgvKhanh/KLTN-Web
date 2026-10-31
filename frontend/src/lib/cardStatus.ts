import type { CardStatus } from '../types/card';

// Thu tu hien thi trong menu / dropdown (cung thu tu voi enum CardStatus o backend)
export const CARD_STATUS_ORDER: CardStatus[] = [
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
  'BLOCKED',
];

export const STATUS_META: Record<
  CardStatus,
  { label: string; dot: string; pill: string }
> = {
  TODO: {
    label: 'Chưa làm',
    dot: 'bg-slate-400',
    pill: 'bg-slate-200 text-slate-700 dark:bg-slate-600 dark:text-slate-100',
  },
  IN_PROGRESS: {
    label: 'Đang làm',
    dot: 'bg-blue-500',
    pill: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-200',
  },
  IN_REVIEW: {
    label: 'Chờ duyệt',
    dot: 'bg-violet-500',
    pill: 'bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200',
  },
  DONE: {
    label: 'Hoàn thành',
    dot: 'bg-emerald-500',
    pill: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200',
  },
  BLOCKED: {
    label: 'Bị chặn',
    dot: 'bg-red-500',
    pill: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200',
  },
};

/**
 * Co hien huy hieu trang thai tren the (o bang) khong. Chi hien khi the "lech"
 * so voi cot chua no - the dung trang thai cot thi header cot da noi roi:
 *  - the DONE: da co dau tich xanh + gach ngang -> khong can them;
 *  - cot tu do (null) coi nhu TODO -> the TODO khong hien (bang cu khong roi mat).
 */
export function shouldShowCardStatus(
  cardStatus: CardStatus,
  listStatus: CardStatus | null | undefined
): boolean {
  return cardStatus !== 'DONE' && cardStatus !== (listStatus ?? 'TODO');
}

/**
 * Trang thai khi "mo lai" the da xong (bo tick). Khop reopenStatus() o backend:
 * theo cot neu cot co trang thai khac DONE, khong thi TODO.
 */
export function reopenStatus(listStatus: CardStatus | null | undefined): CardStatus {
  return listStatus && listStatus !== 'DONE' ? listStatus : 'TODO';
}

/**
 * Cot ma the se TU CHUYEN SANG khi doi tay trang thai the thanh `to`
 * (khop quy tac 2 chieu o backend, updateCard):
 *  - the dang o cot tu do, hoac cot dang mang dung `to` -> khong chuyen (null);
 *  - nguoc lai -> cot dau tien (tu trai sang) mang trang thai `to`, neu co.
 * `lists` phai theo dung thu tu tren bang.
 */
export function targetListForStatus<L extends { id: string; status: CardStatus | null }>(
  lists: L[],
  currentListId: string,
  to: CardStatus
): L | null {
  const current = lists.find((l) => l.id === currentListId);
  if (!current || current.status === null || current.status === to) return null;
  return lists.find((l) => l.status === to) ?? null;
}

/** Nhan tieng Viet cua 1 trang thai doc tu du lieu tho (vd data nhat ky); sai -> chuoi rong. */
export function statusLabel(value: unknown): string {
  return typeof value === 'string' && value in STATUS_META
    ? STATUS_META[value as CardStatus].label
    : '';
}

/** Dem so the theo tung trang thai (du 5 trang thai, trang thai khong co the = 0). */
export function countByStatus(cards: { status: CardStatus }[]): Record<CardStatus, number> {
  const counts = Object.fromEntries(CARD_STATUS_ORDER.map((s) => [s, 0])) as Record<CardStatus, number>;
  for (const c of cards) counts[c.status] += 1;
  return counts;
}
