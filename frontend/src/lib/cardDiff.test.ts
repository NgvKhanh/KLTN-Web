import { describe, expect, it } from 'vitest';
import type { Card } from '../types/card';
import type { BoardList } from '../types/list';
import { diffCards } from './cardDiff';

function card(id: string, over: Partial<Card> = {}): Card {
  return {
    id,
    listId: 'l1',
    title: `Thẻ ${id}`,
    description: null,
    status: 'TODO',
    isDone: false,
    position: 1,
    createdAt: '2026-09-30T00:00:00Z',
    updatedAt: '2026-09-30T00:00:00Z',
    ...over,
  };
}
function list(id: string, cards: Card[]): BoardList {
  return {
    id,
    boardId: 'b1',
    name: id,
    position: 1,
    status: null,
    createdAt: '2026-09-30T00:00:00Z',
    updatedAt: '2026-09-30T00:00:00Z',
    cards,
  };
}

describe('diffCards', () => {
  it('giống hệt nhau thì không có thay đổi', () => {
    const a = [list('l1', [card('c1'), card('c2')])];
    const b = [list('l1', [card('c1'), card('c2')])];
    expect(diffCards(a, b).size).toBe(0);
  });

  it('thẻ chưa từng có là "new"', () => {
    const a = [list('l1', [card('c1')])];
    const b = [list('l1', [card('c1'), card('c2')])];
    expect([...diffCards(a, b)]).toEqual([['c2', 'new']]);
  });

  it('thẻ sang cột khác là "moved" (không phải "new")', () => {
    const a = [list('l1', [card('c1')]), list('l2', [])];
    const b = [list('l1', []), list('l2', [card('c1')])];
    expect([...diffCards(a, b)]).toEqual([['c1', 'moved']]);
  });

  it('đổi tiêu đề, hoàn thành, hạn, nhãn, thành viên, số bình luận... là "changed"', () => {
    const base = card('c1');
    const cases: Partial<Card>[] = [
      { title: 'Tên mới' },
      { isDone: true },
      { dueDate: '2026-10-05T00:00:00Z' },
      { labels: [{ labelId: 'x', label: { id: 'x', boardId: 'b1', name: 'Gấp', color: '#f00' } }] },
      { members: [{ userId: 'u1', user: { id: 'u1', name: 'A', email: 'a@x', avatarUrl: null } }] },
      { comments: [{ id: 'k1' }] },
      { attachments: [{ id: 'f1' }] },
      { checklists: [{ id: 'cl', items: [{ id: 'i1', isDone: true }] }] },
    ];
    for (const over of cases) {
      const result = diffCards([list('l1', [base])], [list('l1', [card('c1', over)])]);
      expect([...result], JSON.stringify(over)).toEqual([['c1', 'changed']]);
    }
  });

  it('vị trí và updatedAt đổi (kéo thả làm các thẻ lân cận xê dịch) KHÔNG tính là thay đổi', () => {
    const a = [list('l1', [card('c1', { position: 1 }), card('c2', { position: 2 })])];
    const b = [
      list('l1', [
        card('c2', { position: 1, updatedAt: '2026-10-01T00:00:00Z' }),
        card('c1', { position: 2, updatedAt: '2026-10-01T00:00:00Z' }),
      ]),
    ];
    expect(diffCards(a, b).size).toBe(0);
  });

  it('nhãn/thành viên chỉ khác thứ tự thì không tính là thay đổi', () => {
    const l = (id: string) => ({ labelId: id, label: { id, boardId: 'b1', name: id, color: '#000' } });
    const a = [list('l1', [card('c1', { labels: [l('a'), l('b')] })])];
    const b = [list('l1', [card('c1', { labels: [l('b'), l('a')] })])];
    expect(diffCards(a, b).size).toBe(0);
  });

  it('thẻ bị xoá khỏi danh sách mới không được báo (chỉ báo các thẻ còn trong danh sách mới)', () => {
    const a = [list('l1', [card('c1'), card('c2')])];
    const b = [list('l1', [card('c1')])];
    expect(diffCards(a, b).size).toBe(0);
  });
});
