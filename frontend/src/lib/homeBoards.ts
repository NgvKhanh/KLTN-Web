// Khoi "Bang cua ban" o trang Tong quan. HAM THUAN: nhan `now` / danh sach bang da xem de kiem thu duoc.
import type { MyCard } from './api/card';
import { bucketOf } from './myCards';

export type BoardTab = 'recent' | 'starred' | 'mine';

export const BOARD_TABS: { key: BoardTab; label: string }[] = [
  { key: 'recent', label: 'Gần đây' },
  { key: 'starred', label: 'Có sao' },
  { key: 'mine', label: 'Có việc của bạn' },
];

export const BOARDS_SHOWN = 6;

export interface BoardWork {
  /** The CHUA xong cua minh tren bang. */
  open: number;
  overdue: number;
}

/** Dem the chua xong (va qua han) cua minh theo tung bang. */
export function workByBoard(cards: Pick<MyCard, 'isDone' | 'dueDate' | 'list'>[], now: Date): Map<string, BoardWork> {
  const map = new Map<string, BoardWork>();
  for (const c of cards) {
    if (c.isDone) continue;
    const w = map.get(c.list.boardId) ?? { open: 0, overdue: 0 };
    w.open += 1;
    if (bucketOf(c.dueDate, now) === 'overdue') w.overdue += 1;
    map.set(c.list.boardId, w);
  }
  return map;
}

interface BoardLike {
  id: string;
  updatedAt: string;
  isStarred?: boolean;
}

/**
 * Danh sach bang cho tung tab:
 *  - Gần đây: theo thu tu da mo (recentIds); chua mo bang nao thi lay bang cap nhat gan nhat.
 *  - Có sao: bang da danh dau sao.
 *  - Có việc của bạn: bang co the chua xong cua minh, nhieu the qua han len truoc, roi nhieu the dang mo.
 */
export function boardsForTab<B extends BoardLike>(
  tab: BoardTab,
  boards: B[],
  recentIds: string[],
  work: Map<string, BoardWork>,
  limit = BOARDS_SHOWN
): B[] {
  let list: B[];
  if (tab === 'starred') {
    list = boards.filter((b) => b.isStarred);
  } else if (tab === 'mine') {
    list = boards
      .filter((b) => work.has(b.id))
      .sort((a, b) => {
        const wa = work.get(a.id)!;
        const wb = work.get(b.id)!;
        return wb.overdue - wa.overdue || wb.open - wa.open;
      });
  } else {
    const byId = new Map(boards.map((b) => [b.id, b]));
    list = recentIds.map((id) => byId.get(id)).filter((b): b is B => Boolean(b));
    if (list.length === 0) {
      list = [...boards].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
  }
  return list.slice(0, limit);
}
