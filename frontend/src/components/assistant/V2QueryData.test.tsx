import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AssistantTurn } from '../../context/AssistantContext';
import { mergeV2Block } from '../../lib/chatV2';
import type { ChatReply, ChatV2Block, ChatV2QueryData } from '../../types/chat';
import V2AnswerView from './V2AnswerView';

// Buoc B: khoi `query_data` (truy van tong quat). Noi dung van ban la du lieu do NGUOI KHAC viet -> luon hien nhu chu thuan.

const GENERATED = '2026-10-07T03:00:00.000Z';
const source = (appliedInput: Record<string, unknown> = {}) => ({ id: 's1', generatedAt: GENERATED, scope: { kind: 'BOARD' as const, boardId: 'b1' }, scopeLabel: 'Dự án Alpha', appliedInput, ranges: [] });
const data = (over: Partial<ChatV2QueryData>): ChatV2QueryData => ({
  entity: 'COMMENT', mode: 'ROWS', total: 2, page: 1, pageSize: 20, hasMore: false, matched: 2,
  columns: [{ key: 'text', label: 'Nội dung', type: 'text' }, { key: 'authorName', label: 'Người viết', type: 'text' }, { key: 'createdAt', label: 'Lúc viết', type: 'date' }, { key: 'isReply', label: 'Là trả lời', type: 'bool' }],
  rows: [
    { id: 'r1', cardId: 'c1', boardId: 'b1', cells: { text: 'Đã xong bản nháp', authorName: 'Nguyễn Lan', createdAt: '2026-10-06T03:00:00.000Z', isReply: false } },
    { id: 'r2', cardId: null, boardId: null, cells: { text: '<img src=x onerror=alert(1)> **không phải markup**', authorName: null, createdAt: null, isReply: true } },
  ],
  groups: [], groupBy: null, groupLabel: null, bucket: null, highestCount: 0, topGroups: 0, ...over,
});
const block = (d: ChatV2QueryData, appliedInput: Record<string, unknown> = {}, title = 'Dữ liệu: Bình luận', pagination = { page: 1, hasMore: false }): ChatV2Block => ({ id: 'blk', title, status: 'OK', tool: 'query_data', source: source(appliedInput), pagination, data: d }) as ChatV2Block;

function renderBlocks(blocks: ChatV2Block[], onMore = vi.fn()) {
  const reply = { conversationId: 'conv', mode: 'AI', understood: {}, answer: { kind: 'ANSWER', text: 'Kết quả từ dữ liệu bạn được phép xem:', blocks, notes: [] } } as unknown as ChatReply;
  const turn = { id: 1, question: 'q', status: 'done', reply, cards: [], page: 1, error: null, loadingMore: false, moreError: null, actionBusy: false, actionError: null } as unknown as AssistantTurn;
  render(<MemoryRouter><V2AnswerView turn={turn} latest busy={false} scope={{ kind: 'BOARD', boardId: 'b1' }} onMore={onMore} onChoose={vi.fn()} onConfirm={vi.fn()} onCancel={vi.fn()} /></MemoryRouter>);
  return onMore;
}

describe('khối dữ liệu truy vấn tổng quát', () => {
  it('hiện tổng, tiêu đề hàng là liên kết tới thẻ, các cột còn lại dạng "nhãn: giá trị"; ô trống là dấu gạch', () => {
    renderBlocks([block(data({}))]);
    const section = screen.getByRole('region', { name: 'Dữ liệu: Bình luận' });
    expect(section).toHaveTextContent('Tổng: 2 bình luận');
    expect(within(section).getByRole('link', { name: 'Đã xong bản nháp' })).toHaveAttribute('href', '/boards/b1?card=c1');
    expect(section).toHaveTextContent('Người viết');
    expect(section).toHaveTextContent('Nguyễn Lan');
    expect(section).toHaveTextContent('Không'); // isReply = false
    expect(section).toHaveTextContent('Có'); // isReply = true
    expect(within(section).getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('văn bản của người khác luôn là chữ thuần: không thành thẻ HTML, không thành liên kết khi thiếu cardId', () => {
    renderBlocks([block(data({}))]);
    const section = screen.getByRole('region', { name: 'Dữ liệu: Bình luận' });
    expect(section.querySelector('img')).toBeNull();
    expect(section).toHaveTextContent('<img src=x onerror=alert(1)> **không phải markup**');
    expect(within(section).queryByRole('link', { name: /img/ })).toBeNull();
  });

  it('chế độ thống kê: bảng nhóm + dòng "nhiều nhất", ghi rõ đồng hạng và đơn vị theo ngày', () => {
    renderBlocks([block(data({ mode: 'GROUPS', total: 2, matched: 5, rows: [], columns: [], groups: [{ id: 'u1', label: 'Trần Tuấn', count: 3 }, { id: 'u2', label: 'Nguyễn Lan', count: 3 }], groupBy: 'authorId', groupLabel: 'Người viết', highestCount: 3, topGroups: 2 }), {}, 'Thống kê: Bình luận')]);
    const section = screen.getByRole('region', { name: 'Thống kê: Bình luận' });
    expect(section).toHaveTextContent('5 bình luận · 2 nhóm theo người viết');
    expect(section).toHaveTextContent('Nhiều nhất (đồng hạng 2 nhóm): 3 bình luận/nhóm.');
    const rows = within(section).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent));
    expect(rows).toEqual([['Trần Tuấn', '3'], ['Nguyễn Lan', '3']]);
  });

  it('nhóm theo ngày ghi "theo ngày"; không có dữ liệu thì nói rõ', () => {
    renderBlocks([block(data({ mode: 'GROUPS', total: 0, matched: 0, rows: [], columns: [], groups: [], groupBy: 'createdAt', groupLabel: 'Ngày viết', bucket: 'WEEK' }), {}, 'Thống kê: Bình luận')]);
    const section = screen.getByRole('region', { name: 'Thống kê: Bình luận' });
    expect(section).toHaveTextContent('theo ngày viết theo tuần');
    expect(section).toHaveTextContent('Không có dữ liệu khớp điều kiện.');
  });

  it('điều kiện hiện bằng tiếng Việt; id (…Id) không hiện giá trị; từ khóa tìm được nêu rõ; "xem thêm" gọi onMore đúng khối', () => {
    const onMore = renderBlocks([block(data({ hasMore: true }), { search: 'thanh toán', where: [{ field: 'authorId', op: 'EQ', value: 'cuid123' }, { field: 'createdAt', op: 'BETWEEN', values: ['2026-10-01', '2026-10-07'] }, { field: 'isReply', op: 'EQ', value: 'false' }] }, 'Dữ liệu: Bình luận', { page: 1, hasMore: true })]);
    const section = screen.getByRole('region', { name: 'Dữ liệu: Bình luận' });
    expect(section).toHaveTextContent('Tìm “thanh toán” · authorId = · createdAt từ…đến 2026-10-01 … 2026-10-07 · isReply = false');
    expect(section).not.toHaveTextContent('cuid123');
    within(section).getByRole('button', { name: /Xem thêm/ }).click();
    expect(onMore).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }), 'blk');
  });

  it('mergeV2Block gộp thêm trang: hàng theo id (không trùng), nhóm theo id/nhãn', () => {
    const a = block(data({ rows: [data({}).rows[0]], hasMore: true }));
    const b = block(data({ rows: [data({}).rows[0], data({}).rows[1]], page: 2 }));
    const merged = mergeV2Block(a, b);
    if (merged.status !== 'OK' || merged.tool !== 'query_data') throw new Error('sai khối');
    expect(merged.data.rows.map((r) => r.id)).toEqual(['r1', 'r2']);
    const g1 = block(data({ mode: 'GROUPS', groups: [{ id: 'u1', label: 'A', count: 2 }, { id: null, label: 'Chưa giao', count: 1 }] }));
    const g2 = block(data({ mode: 'GROUPS', groups: [{ id: 'u1', label: 'A', count: 2 }, { id: null, label: 'Chưa giao', count: 1 }, { id: 'u2', label: 'B', count: 1 }] }));
    const mg = mergeV2Block(g1, g2);
    if (mg.status !== 'OK' || mg.tool !== 'query_data') throw new Error('sai khối');
    expect(mg.data.groups.map((g) => g.label)).toEqual(['A', 'Chưa giao', 'B']);
  });
});
