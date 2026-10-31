import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Card, CardStatus } from '../../types/card';
import type { BoardList } from '../../types/list';
import BoardTableView from './BoardTableView';

// Chế độ bảng biểu: cột "Trạng thái" hiện trạng thái thật của thẻ, sắp xếp theo thứ tự quy trình,
// "Quá hạn" là nhãn riêng ở cột "Hạn".

function card(id: string, status: CardStatus, over: Partial<Card> = {}): Card {
  return {
    id,
    listId: 'l1',
    title: `Thẻ ${id}`,
    description: null,
    status,
    isDone: status === 'DONE',
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function list(id: string, status: CardStatus | null, cards: Card[]): BoardList {
  return { id, boardId: 'b1', name: `Cột ${id}`, position: 0, status, createdAt: '', updatedAt: '', cards };
}

// Doc tung dong du lieu: [ten the, trang thai]
function rowsOf() {
  const body = screen.getAllByRole('rowgroup')[1]!;
  return within(body)
    .getAllByRole('row')
    .map((tr) => {
      const cells = within(tr).getAllByRole('cell');
      return [cells[1]!.textContent, cells[6]!.textContent];
    });
}

describe('BoardTableView - cột trạng thái', () => {
  it('mỗi dòng hiện đúng trạng thái của thẻ (kể cả Chờ duyệt / Bị chặn)', () => {
    render(
      <BoardTableView
        lists={[list('a', 'IN_PROGRESS', [card('1', 'BLOCKED'), card('2', 'IN_REVIEW'), card('3', 'DONE')])]}
        onOpenCard={() => {}}
      />
    );
    expect(rowsOf()).toEqual([
      ['Thẻ 1', 'Bị chặn'],
      ['Thẻ 2', 'Chờ duyệt'],
      ['Thẻ 3', 'Hoàn thành'],
    ]);
  });

  it('bấm tiêu đề "Trạng thái" -> xếp theo quy trình; bấm lại -> đảo chiều', async () => {
    const user = userEvent.setup();
    render(
      <BoardTableView
        lists={[
          list('a', null, [card('1', 'BLOCKED'), card('2', 'DONE'), card('3', 'TODO')]),
          list('b', null, [card('4', 'IN_REVIEW'), card('5', 'IN_PROGRESS')]),
        ]}
        onOpenCard={() => {}}
      />
    );
    await user.click(screen.getByRole('columnheader', { name: 'Trạng thái' }));
    expect(rowsOf().map((r) => r[1])).toEqual(['Chưa làm', 'Đang làm', 'Chờ duyệt', 'Hoàn thành', 'Bị chặn']);

    await user.click(screen.getByRole('columnheader', { name: /Trạng thái/ }));
    expect(rowsOf().map((r) => r[1])).toEqual(['Bị chặn', 'Hoàn thành', 'Chờ duyệt', 'Đang làm', 'Chưa làm']);
  });

  it('thẻ quá hạn chưa xong -> nhãn "Quá hạn" ở cột Hạn; thẻ đã xong thì không', () => {
    const past = '2020-01-01T00:00:00.000Z';
    render(
      <BoardTableView
        lists={[list('a', null, [card('1', 'IN_PROGRESS', { dueDate: past }), card('2', 'DONE', { dueDate: past })])]}
        onOpenCard={() => {}}
      />
    );
    expect(screen.getAllByText('Quá hạn')).toHaveLength(1);
    expect(within(screen.getByText('Thẻ 1').closest('tr')!).getByText('Quá hạn')).toBeInTheDocument();
  });

  it('cột "Danh sách" có chấm trạng thái cho cột có gắn trạng thái; bấm dòng -> mở thẻ', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <BoardTableView
        lists={[list('a', 'DONE', [card('1', 'DONE')]), list('b', null, [card('2', 'TODO')])]}
        onOpenCard={onOpen}
      />
    );
    expect(screen.getAllByTitle(/^Trạng thái cột/)).toHaveLength(1);
    expect(screen.getByTitle('Trạng thái cột: Hoàn thành')).toBeInTheDocument();
    await user.click(screen.getByText('Thẻ 2'));
    expect(onOpen).toHaveBeenCalledWith('2');
  });
});
