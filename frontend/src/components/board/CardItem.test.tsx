import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { CardDragLock } from '../../lib/cardDragLock';
import type { Card } from '../../types/card';
import { CardDragLockContext } from './CardDragLockContext';
import CardItem from './CardItem';

const card: Card = {
  id: 'c1',
  listId: 'l1',
  title: 'The A',
  description: null,
  status: 'TODO',
  isDone: false,
  position: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderCard(handlers: {
  onToggleDone?: (c: Card) => void;
  onRequestDelete?: (c: Card) => void;
  onDragStart?: () => void;
  locks?: ReadonlyMap<string, CardDragLock>;
}) {
  function Harness() {
    const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
      useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    return (
      <CardDragLockContext.Provider value={handlers.locks ?? new Map()}>
        <DndContext sensors={sensors} onDragStart={handlers.onDragStart ?? (() => {})}>
          <SortableContext items={[card.id]} strategy={verticalListSortingStrategy}>
            <CardItem
              card={card}
              onToggleDone={handlers.onToggleDone}
              onRequestDelete={handlers.onRequestDelete}
              onOpen={() => {}}
            />
          </SortableContext>
        </DndContext>
      </CardDragLockContext.Provider>
    );
  }
  return render(<Harness />);
}

describe('CardItem - phim Enter tren cac nut ben trong the', () => {
  it('bam Enter tren nut "danh dau hoan thanh" khong khoi dong luot keo', async () => {
    const user = userEvent.setup();
    const onToggleDone = vi.fn();
    const onDragStart = vi.fn();

    renderCard({ onToggleDone, onDragStart });

    const btn = screen.getByRole('button', { name: 'Đánh dấu hoàn thành' });
    btn.focus();
    await user.keyboard('{Enter}');

    expect(onToggleDone).toHaveBeenCalledTimes(1);
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('bam Enter tren nut "luu tru the" khong khoi dong luot keo', async () => {
    const user = userEvent.setup();
    const onRequestDelete = vi.fn();
    const onDragStart = vi.fn();

    renderCard({ onRequestDelete, onDragStart });

    const btn = screen.getByRole('button', { name: 'Lưu trữ thẻ' });
    btn.focus();
    await user.keyboard('{Enter}');

    expect(onRequestDelete).toHaveBeenCalledTimes(1);
    expect(onDragStart).not.toHaveBeenCalled();
  });
});

describe('CardItem - the dang bi nguoi khac keo', () => {
  const cardEl = () =>
    screen.getByText('The A').closest('[aria-roledescription="sortable"]') as HTMLElement;

  it('doi chung: the khong bi khoa -> nhan Space tren the thi bat dau keo', async () => {
    const user = userEvent.setup();
    const onDragStart = vi.fn();
    renderCard({ onDragStart });

    cardEl().focus();
    await user.keyboard(' ');
    expect(onDragStart).toHaveBeenCalledTimes(1);
  });

  it('bi khoa -> hien ai dang keo va KHONG bat dau keo duoc', async () => {
    const user = userEvent.setup();
    const onDragStart = vi.fn();
    renderCard({
      onDragStart,
      locks: new Map([['c1', { cardId: 'c1', userId: 'u2', userName: 'Bình' }]]),
    });

    expect(screen.getByText('Bình đang kéo')).toBeInTheDocument();
    expect(cardEl()).toHaveAttribute('title', 'Bình đang kéo thẻ này');

    cardEl().focus();
    await user.keyboard(' ');
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('bi khoa -> con tro cam tren ca the (khong lan voi cursor-pointer), khong tick xong / luu tru duoc', async () => {
    const user = userEvent.setup();
    const onToggleDone = vi.fn();
    renderCard({
      onToggleDone,
      onRequestDelete: () => {},
      locks: new Map([['c1', { cardId: 'c1', userId: 'u2', userName: 'Bình' }]]),
    });

    const el = cardEl();
    // Ca 2 lop cung co mat thi Tailwind de cursor-pointer thang (xep theo thu tu trong file CSS)
    expect(el).toHaveClass('cursor-not-allowed', '[&_*]:cursor-not-allowed');
    expect(el).not.toHaveClass('cursor-pointer');

    const done = screen.getByRole('button', { name: 'Đánh dấu hoàn thành' });
    expect(done).toBeDisabled();
    await user.click(done);
    expect(onToggleDone).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Lưu trữ thẻ' })).toBeNull();
  });

  it('khong bi khoa -> van la con tro ban tay nhu cu', () => {
    renderCard({ onRequestDelete: () => {} });
    expect(cardEl()).toHaveClass('cursor-pointer');
    expect(cardEl()).not.toHaveClass('cursor-not-allowed');
    expect(screen.getByRole('button', { name: 'Lưu trữ thẻ' })).toBeInTheDocument();
  });
});
