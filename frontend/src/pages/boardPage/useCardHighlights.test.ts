import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../../types/card';
import type { BoardList } from '../../types/list';
import { useCardHighlights } from './useCardHighlights';

function card(id: string, over: Partial<Card> = {}): Card {
  return {
    id,
    listId: 'l1',
    title: `Thẻ ${id}`,
    description: null,
    status: 'TODO',
    isDone: false,
    position: 1,
    createdAt: '2026-09-30T00:00:00Z',
    updatedAt: '2026-09-30T00:00:00Z',
    ...over,
  };
}
function list(id: string, cards: Card[]): BoardList {
  return {
    id,
    boardId: 'b1',
    name: id,
    position: 1,
    status: null,
    createdAt: '2026-09-30T00:00:00Z',
    updatedAt: '2026-09-30T00:00:00Z',
    cards,
  };
}

interface Props {
  lists: BoardList[];
  listsLoading: boolean;
}
const dragging = { current: false };

function setup(initial: BoardList[]) {
  const hook = renderHook((p: Props) => useCardHighlights({ ...p, draggingRef: dragging }), {
    initialProps: { lists: initial, listsLoading: false } as Props,
  });
  return {
    ...hook,
    show: (lists: BoardList[]) => hook.rerender({ lists, listsLoading: false }),
  };
}

// Mô phỏng một thao tác của chính người dùng (chuột/bàn phím)
function userInput() {
  window.dispatchEvent(new Event('pointerdown'));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-30T10:00:00Z'));
  dragging.current = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useCardHighlights', () => {
  it('lần tải đầu chỉ làm mốc: không thẻ nào có hiệu ứng', () => {
    const { result } = setup([list('l1', [card('c1'), card('c2')])]);
    expect(result.current.size).toBe(0);
  });

  it('người khác thêm thẻ: thẻ hiện ra (enter) và viền nổi bật (flash)', () => {
    vi.advanceTimersByTime(5000); // không có thao tác nào của mình gần đây
    const { result, show } = setup([list('l1', [card('c1')])]);
    show([list('l1', [card('c1'), card('c2')])]);
    expect(result.current.get('c2')).toEqual({ enter: true, flash: true });
    expect(result.current.has('c1')).toBe(false);
  });

  it('mình vừa thao tác rồi thẻ mới xuất hiện: chỉ hiện ra, KHÔNG nháy viền', () => {
    const { result, show } = setup([list('l1', [card('c1')])]);
    userInput();
    show([list('l1', [card('c1'), card('c2')])]);
    expect(result.current.get('c2')).toEqual({ enter: true, flash: false });
  });

  it('mình vừa thao tác rồi thẻ đổi tên: không hiệu ứng nào (không tự nháy thẻ của mình)', () => {
    const { result, show } = setup([list('l1', [card('c1')])]);
    userInput();
    show([list('l1', [card('c1', { title: 'Tên mới' })])]);
    expect(result.current.size).toBe(0);
  });

  it('người khác đổi tên thẻ: chỉ nháy viền, không chạy hiệu ứng hiện ra', () => {
    vi.advanceTimersByTime(5000);
    const { result, show } = setup([list('l1', [card('c1')])]);
    show([list('l1', [card('c1', { title: 'Tên mới' })])]);
    expect(result.current.get('c1')).toEqual({ enter: false, flash: true });
  });

  it('người khác chuyển thẻ sang cột khác: hiện ra ở cột mới và nháy viền', () => {
    vi.advanceTimersByTime(5000);
    const { result, show } = setup([list('l1', [card('c1')]), list('l2', [])]);
    show([list('l1', []), list('l2', [card('c1')])]);
    expect(result.current.get('c1')).toEqual({ enter: true, flash: true });
  });

  it('thao tác của mình đã cũ hơn 1,5 giây thì thay đổi tiếp theo được coi là của người khác', () => {
    const { result, show } = setup([list('l1', [card('c1')])]);
    userInput();
    vi.advanceTimersByTime(2000);
    show([list('l1', [card('c1'), card('c2')])]);
    expect(result.current.get('c2')?.flash).toBe(true);
  });

  it('đang kéo thả: không hiệu ứng nào (thẻ đổi cột theo tay mình)', () => {
    vi.advanceTimersByTime(5000);
    const { result, show } = setup([list('l1', [card('c1')]), list('l2', [])]);
    dragging.current = true;
    show([list('l1', []), list('l2', [card('c1')])]);
    expect(result.current.size).toBe(0);
    // và mốc đã cập nhật: sau khi thả, cùng dữ liệu đó không bị coi là thay đổi mới
    dragging.current = false;
    show([list('l1', []), list('l2', [card('c1')])]);
    expect(result.current.size).toBe(0);
  });

  it('hiệu ứng tự tắt sau khoảng 1,6 giây', () => {
    vi.advanceTimersByTime(5000);
    const { result, show } = setup([list('l1', [card('c1')])]);
    show([list('l1', [card('c1'), card('c2')])]);
    expect(result.current.has('c2')).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1700);
    });
    expect(result.current.size).toBe(0);
  });

  it('đổi sang bảng khác (đang tải lại): danh sách mới chỉ là mốc, không thẻ nào nháy', () => {
    vi.advanceTimersByTime(5000);
    const { result, rerender } = setup([list('l1', [card('c1')])]);
    rerender({ lists: [], listsLoading: true });
    rerender({ lists: [list('lx', [card('x1'), card('x2'), card('x3')])], listsLoading: true });
    rerender({ lists: [list('lx', [card('x1'), card('x2'), card('x3')])], listsLoading: false });
    expect(result.current.size).toBe(0);
  });

  it('quá nhiều thẻ đổi cùng lúc (áp dụng kế hoạch, đổi trạng thái cột) thì không nháy cả bảng', () => {
    vi.advanceTimersByTime(5000);
    const { result, show } = setup([list('l1', [card('c0')])]);
    const many = Array.from({ length: 20 }, (_, i) => card(`n${i}`));
    show([list('l1', [card('c0'), ...many])]);
    expect(result.current.size).toBe(0);
  });
});
