import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../../types/card';
import type { BoardList } from '../../types/list';
import ListColumn from './ListColumn';

// Mục "Chia việc gợi ý..." ở menu danh sách (lớp 2): hiện khi sửa được bảng, kèm số thẻ chưa giao; khoá khi không có thẻ nào
// chưa giao; mở màn hình chia việc và báo bảng tải lại khi có thẻ đã giao. Màn hình chia việc có test riêng nên ở đây chỉ giả lập.

const mocks = vi.hoisted(() => ({ planProps: vi.fn() }));

vi.mock('./AssignPlanModal', () => ({
  default: (props: { listId: string; listName: string; onClose: () => void; onApplied: () => void }) => {
    mocks.planProps(props);
    return (
      <div role="dialog" aria-label="Màn hình chia việc giả">
        <button type="button" onClick={props.onApplied}>
          giả lập đã giao
        </button>
        <button type="button" onClick={props.onClose}>
          giả lập đóng
        </button>
      </div>
    );
  },
}));
// Mở menu thì ListColumn hỏi trạng thái theo dõi: không cho đi ra mạng
vi.mock('../../lib/api/list', () => ({
  fetchListWatch: vi.fn().mockResolvedValue(false),
  setListWatch: vi.fn().mockResolvedValue(undefined),
}));

const member = (id: string) => ({ userId: id, user: { id, name: id, email: `${id}@x.vn`, avatarUrl: null } });

function card(id: string, over: Partial<Card> = {}): Card {
  return {
    id,
    listId: 'l1',
    title: `Thẻ ${id}`,
    description: null,
    status: 'TODO',
    isDone: false,
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function list(cards: Card[]): BoardList {
  return {
    id: 'l1',
    boardId: 'b1',
    name: 'Việc tuần này',
    position: 0,
    status: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cards,
  };
}

const noop = () => {};
const asyncNoop = async () => {};

// Dung lai dung bo sensor cua BoardPage (bam khong di chuyen khong bat dau luot keo), neu khong bam vao nut trong tay cam se bi nuot.
function renderColumn(l: BoardList, opts: { readOnly?: boolean; onAssignApplied?: () => void } = {}) {
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
            readOnly={opts.readOnly}
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
            onSetListStatus={noop}
            onAssignApplied={opts.onAssignApplied}
          />
        </SortableContext>
      </DndContext>
    );
  }
  return render(<Harness />);
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Hành động danh sách' }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ListColumn - mục "Chia việc gợi ý"', () => {
  it('kèm số thẻ CHƯA GIAO: chưa xong và chưa có người nhận (thẻ đã xong, thẻ đã giao không tính; thiếu thông tin thành viên coi là chưa giao)', async () => {
    const user = userEvent.setup();
    renderColumn(
      list([
        card('a'),
        card('b', { members: [] }),
        card('c', { members: [member('u1')] }),
        card('d', { isDone: true }),
        card('e', { isDone: true, members: [member('u1')] }),
        card('f', { members: [member('u1'), member('u2')] }),
      ])
    );
    await openMenu(user);
    const item = screen.getByRole('button', { name: /^Chia việc gợi ý/ });
    expect(item).toHaveTextContent('Chia việc gợi ý... (2 thẻ chưa giao)');
    expect(item).toBeEnabled();
    expect(item).not.toHaveAttribute('title');
  });

  it('không có thẻ nào chưa giao (danh sách trống, hoặc thẻ đã xong / đã có người) -> khoá, không hiện số, có giải thích', async () => {
    const user = userEvent.setup();
    const { unmount } = renderColumn(list([]));
    await openMenu(user);
    let item = screen.getByRole('button', { name: /^Chia việc gợi ý/ });
    expect(item).toBeDisabled();
    expect(item).toHaveTextContent(/^Chia việc gợi ý\.\.\.$/);
    expect(item).toHaveAttribute('title', 'Không có thẻ nào chưa giao người');
    unmount();

    renderColumn(list([card('a', { isDone: true }), card('b', { members: [member('u1')] })]));
    await openMenu(user);
    item = screen.getByRole('button', { name: /^Chia việc gợi ý/ });
    expect(item).toBeDisabled();
  });

  it('bảng chỉ xem (readOnly) thì không có mục này', async () => {
    const user = userEvent.setup();
    renderColumn(list([card('a')]), { readOnly: true });
    await openMenu(user);
    expect(screen.queryByRole('button', { name: /^Chia việc gợi ý/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Theo dõi danh sách|^Đang theo dõi/ })).toBeInTheDocument(); // menu vẫn mở được
  });

  it('bấm mục -> đóng menu và mở màn hình chia việc với đúng danh sách; chưa bấm thì không mở', async () => {
    const user = userEvent.setup();
    renderColumn(list([card('a')]));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await openMenu(user);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Chia việc gợi ý/ }));
    expect(screen.getByRole('dialog', { name: 'Màn hình chia việc giả' })).toBeInTheDocument();
    expect(screen.queryByText('Thao tác với danh sách')).not.toBeInTheDocument(); // menu đã đóng
    expect(mocks.planProps).toHaveBeenCalled();
    expect(mocks.planProps.mock.calls[0]![0]).toMatchObject({ listId: 'l1', listName: 'Việc tuần này' });
  });

  it('đóng màn hình thì gỡ nó; giao xong thì báo bảng tải lại (onAssignApplied), và không lỗi khi cha không truyền hàm này', async () => {
    const user = userEvent.setup();
    const onAssignApplied = vi.fn();
    const { unmount } = renderColumn(list([card('a')]), { onAssignApplied });
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: /^Chia việc gợi ý/ }));
    await user.click(screen.getByRole('button', { name: 'giả lập đã giao' }));
    expect(onAssignApplied).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'giả lập đóng' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    unmount();

    renderColumn(list([card('a')]));
    await openMenu(user);
    await user.click(screen.getByRole('button', { name: /^Chia việc gợi ý/ }));
    await user.click(screen.getByRole('button', { name: 'giả lập đã giao' })); // không có onAssignApplied: không được ném lỗi
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
