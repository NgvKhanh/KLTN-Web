import type { Card } from '../types/card';
import type { BoardList } from '../types/list';

/**
 * Thẻ thay đổi thế nào giữa hai lần tải danh sách của bảng:
 *  - new     : thẻ chưa từng có
 *  - moved   : thẻ chuyển sang cột khác
 *  - changed : thẻ ở nguyên cột nhưng nội dung hiện trên mặt thẻ đã đổi
 */
export type CardChange = 'new' | 'moved' | 'changed';

/**
 * Dấu vân tay của những gì NGƯỜI DÙNG THẤY trên mặt thẻ. Cố ý không có `position`
 * và `updatedAt`: kéo một thẻ có thể làm các thẻ lân cận đổi vị trí, và server ghi lại
 * `updatedAt` cho cả những thay đổi không hiện ra -> sẽ làm cả cột nháy oan.
 */
function faceSignature(card: Card): string {
  const items = (card.checklists ?? []).flatMap((c) => c.items);
  return JSON.stringify([
    card.title,
    card.isDone,
    card.status,
    card.dueDate ?? null,
    card.coverColor ?? null,
    card.coverImageUrl ?? null,
    Boolean(card.description),
    (card.labels ?? []).map((l) => l.labelId).sort(),
    (card.members ?? []).map((m) => m.userId).sort(),
    card.comments?.length ?? 0,
    card.attachments?.length ?? 0,
    items.length,
    items.filter((i) => i.isDone).length,
  ]);
}

/** So sánh hai lần tải danh sách; trả về các thẻ khác nhau (chỉ những thẻ CÓ trong `next`). */
export function diffCards(prev: BoardList[], next: BoardList[]): Map<string, CardChange> {
  const before = new Map<string, { listId: string; sig: string }>();
  for (const list of prev) {
    for (const card of list.cards) before.set(card.id, { listId: list.id, sig: faceSignature(card) });
  }

  const changes = new Map<string, CardChange>();
  for (const list of next) {
    for (const card of list.cards) {
      const old = before.get(card.id);
      if (!old) changes.set(card.id, 'new');
      else if (old.listId !== list.id) changes.set(card.id, 'moved');
      else if (old.sig !== faceSignature(card)) changes.set(card.id, 'changed');
    }
  }
  return changes;
}
