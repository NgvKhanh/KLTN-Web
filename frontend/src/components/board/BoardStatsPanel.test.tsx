import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Card, CardStatus } from '../../types/card';
import type { BoardList } from '../../types/list';
import BoardStatsPanel from './BoardStatsPanel';

function card(id: string, status: CardStatus): Card {
  return {
    id,
    listId: 'l1',
    title: id,
    description: null,
    status,
    isDone: status === 'DONE',
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function list(id: string, status: CardStatus | null, cards: Card[]): BoardList {
  return { id, boardId: 'b1', name: `Cột ${id}`, position: 0, status, createdAt: '', updatedAt: '', cards };
}

describe('BoardStatsPanel - thống kê theo trạng thái', () => {
  it('đếm đủ 5 trạng thái trên mọi cột, kèm tỉ lệ; trạng thái không có thẻ = 0', () => {
    render(
      <BoardStatsPanel
        lists={[
          list('a', 'IN_PROGRESS', [card('1', 'IN_PROGRESS'), card('2', 'BLOCKED')]),
          list('b', null, [card('3', 'TODO'), card('4', 'IN_PROGRESS')]),
        ]}
        onClose={() => {}}
      />
    );
    const rows = within(screen.getByRole('list', { name: 'Số thẻ theo trạng thái' }))
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(rows).toEqual([
      'Chưa làm125%',
      'Đang làm250%',
      'Chờ duyệt00%',
      'Hoàn thành00%',
      'Bị chặn125%',
    ]);
  });

  it('bảng chưa có thẻ -> số 0 và dấu "–" thay cho tỉ lệ', () => {
    render(<BoardStatsPanel lists={[list('a', 'TODO', [])]} onClose={() => {}} />);
    const rows = within(screen.getByRole('list', { name: 'Số thẻ theo trạng thái' })).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Chưa làm0–');
  });

  it('phần "Theo danh sách" có chấm trạng thái cho cột có gắn trạng thái', () => {
    render(<BoardStatsPanel lists={[list('a', 'DONE', [card('1', 'DONE')]), list('b', null, [])]} onClose={() => {}} />);
    expect(screen.getByTitle('Trạng thái cột: Hoàn thành')).toBeInTheDocument();
    expect(screen.queryAllByTitle(/^Trạng thái cột/)).toHaveLength(1);
  });
});
