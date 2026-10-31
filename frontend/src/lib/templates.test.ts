import { describe, expect, it } from 'vitest';
import { cardCount, fromBuiltin, fromUser, matchesTemplate, MINE_CATEGORY } from './templates';

const builtin = fromBuiltin({
  id: 'sales',
  name: 'Quy trình bán hàng',
  description: 'Đưa khách hàng tiềm năng qua từng bước.',
  category: 'marketing',
  color: '#519839',
  labels: [{ name: 'Nóng', color: '#EB5A46' }],
  lists: [
    { name: 'Khách tiềm năng', status: 'TODO', cards: ['Công ty ABC – cần báo giá'] },
    { name: 'Chốt đơn', status: 'DONE', cards: [] },
  ],
});

describe('mẫu bảng - mô hình hiển thị', () => {
  it('mẫu có sẵn giữ nhóm, nhãn, trạng thái cột; khoá phân biệt nguồn', () => {
    expect(builtin).toMatchObject({ key: 'b:sales', source: 'builtin', category: 'marketing', labels: [{ name: 'Nóng', color: '#EB5A46' }] });
    expect(cardCount(builtin)).toBe(1);
  });

  it('mẫu của người dùng: nhóm "mine", tiêu đề thẻ, trạng thái cột (thiếu = cột tự do), tên người lưu', () => {
    const item = fromUser({
      id: 'u9',
      workspaceId: 'w',
      name: 'Bảng nhóm (mẫu)',
      color: '#0079BF',
      createdById: 'me',
      createdAt: '2026-10-01T00:00:00.000Z',
      createdBy: { id: 'me', name: 'Khanh', avatarUrl: null },
      lists: [
        { id: 'a', name: 'Việc nhóm', position: 0, status: 'IN_PROGRESS', cards: [{ id: 'c', title: 'Họp tuần', description: null, position: 0 }] },
        { id: 'b', name: 'Ý tưởng', position: 1, cards: [] },
      ],
    });
    expect(item).toMatchObject({ key: 'u:u9', source: 'user', category: MINE_CATEGORY, createdBy: 'Khanh' });
    expect(item.lists).toEqual([
      { name: 'Việc nhóm', status: 'IN_PROGRESS', cards: ['Họp tuần'] },
      { name: 'Ý tưởng', status: null, cards: [] },
    ]);
  });

  it('tìm theo tên, mô tả, cột, thẻ, nhãn; không phân biệt hoa thường và dấu', () => {
    for (const q of ['ban hang', 'TIEM NANG', 'khach tiem', 'bao gia', 'nong', '  ']) expect(matchesTemplate(builtin, q), q).toBe(true);
    for (const q of ['kanban', 'sprint']) expect(matchesTemplate(builtin, q), q).toBe(false);
  });
});
