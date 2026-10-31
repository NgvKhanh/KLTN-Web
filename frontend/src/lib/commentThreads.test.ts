import { describe, expect, it } from 'vitest';
import { groupCommentThreads, type ThreadComment } from './commentThreads';

const c = (id: string, at: string, parentId: string | null = null, deleted = false): ThreadComment => ({
  id,
  parentId,
  createdAt: `2026-10-04T${at}:00.000Z`,
  deleted,
});

describe('groupCommentThreads', () => {
  it('luồng xếp gốc mới nhất trước; câu trả lời trong luồng xếp cũ -> mới', () => {
    // API trả về phẳng, mới nhất trước
    const out = groupCommentThreads([
      c('r2', '10:05', 'a'),
      c('b', '10:04'),
      c('r1', '10:02', 'a'),
      c('a', '10:01'),
    ]);
    expect(out.map((t) => [t.root.id, t.replies.map((r) => r.id)])).toEqual([
      ['b', []],
      ['a', ['r1', 'r2']],
    ]);
  });

  it('gốc đã xoá: còn câu trả lời thì giữ luồng, hết câu trả lời thì bỏ', () => {
    const out = groupCommentThreads([
      c('x', '10:01', null, true),
      c('rx', '10:02', 'x'),
      c('y', '10:03', null, true),
    ]);
    expect(out.map((t) => t.root.id)).toEqual(['x']);
    expect(out[0]!.replies.map((r) => r.id)).toEqual(['rx']);
  });

  it('câu trả lời mất gốc (dữ liệu lẻ) vẫn hiện thành luồng riêng, không bị nuốt', () => {
    const out = groupCommentThreads([c('lac', '10:01', 'khong-co')]);
    expect(out).toEqual([{ root: expect.objectContaining({ id: 'lac' }), replies: [] }]);
  });

  it('danh sách rỗng -> không có luồng nào', () => {
    expect(groupCommentThreads([])).toEqual([]);
  });
});
