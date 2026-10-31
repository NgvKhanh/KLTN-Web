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
import type { Card } from '../../types/card';
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
}) {
  function Harness() {
    const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
      useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );
    return (
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
