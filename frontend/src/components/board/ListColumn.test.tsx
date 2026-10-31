import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Card } from '../../types/card';
import type { BoardList } from '../../types/list';
import ListColumn from './ListColumn';

function makeCard(id: string, listId: string, title: string): Card {
  return {
    id,
    listId,
    title,
    description: null,
    status: 'TODO',
    isDone: false,
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function makeList(id: string, name: string, cards: Card[] = []): BoardList {
  return {
    id,
    boardId: 'board-1',
    name,
    position: 0,
    status: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    cards,
  };
}

const noop = () => {};
const asyncNoop = async () => {};

// Dung lai dung bo sensor cua BoardPage (co KeyboardSensor) de tai hien loi that.
function renderBoard(lists: BoardList[], handlers: {
  onRename?: (listId: string, name: string) => void;
  onDragStart?: () => void;
}) {
  function Harness() {
    const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
      useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    return (
      <DndContext sensors={sensors} onDragStart={handlers.onDragStart ?? noop}>
        <SortableContext
          items={lists.map((l) => `list-${l.id}`)}
          strategy={horizontalListSortingStrategy}
        >
          {lists.map((list) => (
            <ListColumn
              key={list.id}
              list={list}
              allLists={lists}
              onRename={handlers.onRename ?? noop}
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
            />
          ))}
        </SortableContext>
      </DndContext>
    );
  }
  return render(<Harness />);
}

describe('ListColumn - doi ten danh sach', () => {
  it('bam Enter thi luu ten moi va KHONG khoi dong luot keo', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onDragStart = vi.fn();
    const lists = [makeList('l1', 'Danh sach 1', [makeCard('c1', 'l1', 'The A')])];

    renderBoard(lists, { onRename, onDragStart });

    await user.click(screen.getByRole('button', { name: 'Danh sach 1' }));

    const input = screen.getByDisplayValue('Danh sach 1');
    await user.clear(input);
    await user.type(input, 'Ten moi{Enter}');

    expect(onRename).toHaveBeenCalledWith('l1', 'Ten moi');

    // Day la loi cu: Enter noi bot len header (cung la tay cam keo) va
    // KeyboardSensor cua dnd-kit bat dau mot luot keo khong bao gio ket thuc.
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('sau khi doi ten, cot khong bi ket o trang thai "dang keo"', async () => {
    const user = userEvent.setup();
    const lists = [makeList('l1', 'Danh sach 1', [makeCard('c1', 'l1', 'The A')])];

    const { container } = renderBoard(lists, {});

    await user.click(screen.getByRole('button', { name: 'Danh sach 1' }));
    await user.type(screen.getByDisplayValue('Danh sach 1'), '{Enter}');

    // Khi bi ket, dnd-kit dat aria-pressed="true" tren tay cam va cot doi sang
    // kieu "ban nhay" (border-dashed + [&>*]:invisible).
    const handle = container.querySelector('[aria-roledescription="sortable"]');
    expect(handle).not.toBeNull();
    expect(handle).not.toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelector('.border-dashed')).toBeNull();

    // Va the trong cot van con nhin thay duoc (khong bi [&>*]:invisible).
    expect(screen.getByText('The A')).toBeVisible();
  });

  it('bam Escape thi huy sua, giu nguyen ten cu', async () => {
    const user = userEvent.setup();
    const onRename = vi.fn();
    const onDragStart = vi.fn();
    const lists = [makeList('l1', 'Danh sach 1')];

    renderBoard(lists, { onRename, onDragStart });

    await user.click(screen.getByRole('button', { name: 'Danh sach 1' }));
    const input = screen.getByDisplayValue('Danh sach 1');
    await user.clear(input);
    await user.type(input, 'Bo di{Escape}');

    expect(onRename).not.toHaveBeenCalled();
    expect(onDragStart).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Danh sach 1' })).toBeInTheDocument();
  });

  it('go phim trong o doi ten khong lot ra toi cac handler tren document', async () => {
    const user = userEvent.setup();
    const onDocumentKey = vi.fn();
    const lists = [makeList('l1', 'Danh sach 1')];

    renderBoard(lists, {});

    await user.click(screen.getByRole('button', { name: 'Danh sach 1' }));
    document.addEventListener('keydown', onDocumentKey);
    try {
      await user.type(screen.getByDisplayValue('Danh sach 1'), 'nfb{Enter}');
    } finally {
      document.removeEventListener('keydown', onDocumentKey);
    }

    expect(onDocumentKey).not.toHaveBeenCalled();
  });
});

// jsdom khong tinh layout that (moi chieu cao deu = 0), nen chieu cao/cuon da
// duoc kiem tra bang do dac DOM tren trinh duyet that. O day chi chot lai cac
// rang buoc CSS quyet dinh hanh vi do, de sau nay sua nham thi test bao ngay.
describe('ListColumn - cot nhieu the thi cuon thay vi tran ra ngoai', () => {
  it('chi vung the duoc cuon; header va nut "Them the" khong co lai', () => {
    const lists = [
      makeList(
        'l1',
        'Danh sach 1',
        Array.from({ length: 30 }, (_, i) => makeCard(`c${i}`, 'l1', `The ${i}`))
      ),
    ];
    const { container } = renderBoard(lists, {});

    // Vung the: tu cuon doc va co the co lai
    const cardArea = container.querySelector('.list-scroll');
    expect(cardArea).not.toBeNull();

    // Cot bi gioi han boi chieu cao cua vung board
    const column = cardArea!.parentElement!;
    expect(column.className).toContain('max-h-full');
    expect(cardArea!.className).toContain('overflow-y-auto');

    // Tung the giu nguyen chieu cao that (khong bi flexbox bop det)
    const cards = Array.from(cardArea!.children);
    expect(cards).toHaveLength(30);
    for (const card of cards) {
      expect(card.className).toContain('shrink-0');
    }

    // Header va chan cot khong co lai -> chi vung the cuon
    const header = container.querySelector('[aria-roledescription="sortable"]');
    expect(header!.className).toContain('shrink-0');
    const footer = cardArea!.nextElementSibling;
    expect(footer!.className).toContain('shrink-0');
  });
});
