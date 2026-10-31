import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, CardStatus } from '../../types/card';
import type { BoardList } from '../../types/list';
import ListColumn from './ListColumn';

// Trạng thái cột: chip ở header, mục menu "Trạng thái cột", và huy hiệu trên thẻ khi thẻ "lệch" cột.

// Mở menu thì ListColumn hỏi trạng thái theo dõi: không cho đi ra mạng
vi.mock('../../lib/api/list', () => ({
  fetchListWatch: vi.fn().mockResolvedValue(false),
  setListWatch: vi.fn().mockResolvedValue(undefined),
}));

function card(id: string, status: CardStatus): Card {
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
  };
}

function list(status: CardStatus | null, cards: Card[] = []): BoardList {
  return {
    id: 'l1',
    boardId: 'b1',
    name: 'Cột thử',
    position: 0,
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cards,
  };
}

const noop = () => {};
const asyncNoop = async () => {};

function renderColumn(l: BoardList, onSetListStatus = vi.fn()) {
  // Cảm biến giống trang bảng thật (kéo phải đi >= 5px): bấm nút trong header không bị hiểu là kéo cột
  function Harness() {
    const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
      useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    return (
      <DndContext sensors={sensors}>
        <SortableContext items={[`list-${l.id}`]} strategy={horizontalListSortingStrategy}>
          <ListColumn
            list={l}
            allLists={[l]}
            onRename={noop}
            onRequestDeleteList={noop}
            onAddCard={asyncNoop}
            onApplyCardTemplate={asyncNoop}
            onToggleCardDone={noop}
            onRequestDeleteCard={noop}
            onOpenCard={noop}
            onCopyList={noop}
            onMoveList={noop}
            onMoveAllCards={noop}
            onSortList={noop}
            onRequestDeleteAllCards={noop}
            onSetListStatus={onSetListStatus}
          />
        </SortableContext>
      </DndContext>
    );
  }
  render(<Harness />);
  return onSetListStatus;
}

async function openStatusMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Hành động danh sách' }));
  await user.click(screen.getByRole('button', { name: 'Trạng thái cột' }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

// Lưu ý: header cột (tay cầm kéo) cũng có role="button" và tên gồm toàn bộ chữ bên trong
// (kể cả menu) -> tìm nút trong menu bằng TÊN CHÍNH XÁC, không dùng regex lỏng.
describe('ListColumn - trạng thái cột', () => {
  it('cột có trạng thái -> hiện chip ở header', () => {
    renderColumn(list('IN_PROGRESS'));
    expect(screen.getByTitle(/^Trạng thái cột/)).toHaveTextContent('Đang làm');
  });

  it('cột tự do -> không có chip', () => {
    renderColumn(list(null));
    expect(screen.queryByTitle(/^Trạng thái cột/)).toBeNull();
  });

  it('menu "Trạng thái cột" -> trạng thái hiện tại được đánh dấu; chọn trạng thái khác gọi onSetListStatus', async () => {
    const user = userEvent.setup();
    const onSet = renderColumn(list('TODO'));
    await openStatusMenu(user);

    expect(screen.getByRole('button', { name: /^Chưa làm/, pressed: true })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hoàn thành', pressed: false }));
    expect(onSet).toHaveBeenCalledWith(expect.objectContaining({ id: 'l1' }), 'DONE');
  });

  it('chọn "Không gắn trạng thái" -> gọi với null', async () => {
    const user = userEvent.setup();
    const onSet = renderColumn(list('DONE'));
    await openStatusMenu(user);
    await user.click(screen.getByRole('button', { name: 'Không gắn trạng thái', pressed: false }));
    expect(onSet).toHaveBeenCalledWith(expect.objectContaining({ id: 'l1' }), null);
  });

  it('huy hiệu trên thẻ chỉ hiện khi thẻ lệch trạng thái cột', () => {
    renderColumn(list('IN_PROGRESS', [card('a', 'IN_PROGRESS'), card('b', 'BLOCKED')]));
    const cardA = screen.getByText('Thẻ a').parentElement!;
    const cardB = screen.getByText('Thẻ b').parentElement!;
    // Chip "Đang làm" ở header là duy nhất; thẻ a đúng cột nên không có huy hiệu riêng
    expect(screen.getAllByText('Đang làm')).toHaveLength(1);
    expect(within(cardA).queryByText('Đang làm')).toBeNull();
    expect(within(cardB).getByText('Bị chặn')).toBeInTheDocument();
  });
});
