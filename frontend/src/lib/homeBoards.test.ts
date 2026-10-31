import { describe, expect, it } from 'vitest';
import { boardsForTab, workByBoard } from './homeBoards';

// Giữa trưa thứ Tư 14/10/2026 theo giờ máy
const NOW = new Date(2026, 9, 14, 12, 0, 0);
const at = (day: number) => new Date(2026, 9, day, 9, 0, 0).toISOString();
const card = (boardId: string, dueDate: string | null = null, isDone = false) => ({
  isDone,
  dueDate,
  list: { boardId } as never,
});
const board = (id: string, updatedAt: string, isStarred = false) => ({ id, updatedAt, isStarred });

describe('workByBoard', () => {
  it('đếm thẻ chưa xong và quá hạn của mình theo bảng; bỏ thẻ đã xong', () => {
    const work = workByBoard([card('a', at(10)), card('a'), card('a', at(1), true), card('b', at(20))], NOW);
    expect(Object.fromEntries(work)).toEqual({ a: { open: 2, overdue: 1 }, b: { open: 1, overdue: 0 } });
  });
});

describe('boardsForTab', () => {
  const boards = [board('a', '2026-10-01T00:00:00Z'), board('b', '2026-10-09T00:00:00Z', true), board('c', '2026-10-05T00:00:00Z')];
  const work = workByBoard([card('c', at(10)), card('a'), card('a'), card('a')], NOW);

  it('Gần đây: theo thứ tự đã mở, bỏ id không còn; chưa mở bảng nào thì theo ngày cập nhật', () => {
    expect(boardsForTab('recent', boards, ['c', 'x', 'a'], work).map((b) => b.id)).toEqual(['c', 'a']);
    expect(boardsForTab('recent', boards, [], work).map((b) => b.id)).toEqual(['b', 'c', 'a']);
  });

  it('Có sao: chỉ bảng có sao', () => {
    expect(boardsForTab('starred', boards, [], work).map((b) => b.id)).toEqual(['b']);
  });

  it('Có việc của bạn: bảng nhiều thẻ quá hạn trước, rồi nhiều thẻ đang mở', () => {
    expect(boardsForTab('mine', boards, [], work).map((b) => b.id)).toEqual(['c', 'a']);
  });

  it('giới hạn số bảng hiện', () => {
    expect(boardsForTab('recent', boards, [], work, 2)).toHaveLength(2);
  });
});
