import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sock = vi.hoisted(() => {
  const handlers = new Map<string, Set<(p?: unknown) => void>>();
  return {
    on(event: string, fn: (p?: unknown) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(fn);
    },
    off(event: string, fn: (p?: unknown) => void) {
      handlers.get(event)?.delete(fn);
    },
    emit(event: string, payload?: unknown) {
      handlers.get(event)?.forEach((fn) => fn(payload));
    },
    clear() {
      handlers.clear();
    },
  };
});
vi.mock('../../../lib/socket', () => ({ socket: sock }));

import { useCardRealtime } from './useCardRealtime';

// Nguoi khac sua the -> tai lai the. Dang go tieu de / mo ta thi KHONG tai lai
// (ghi de ban nhap) nhung phai tai lai ngay khi het sua, va bao de nhac nguoi dung.

function setup(initialEditing = false, boardId: string | null = 'b1') {
  const reload = vi.fn().mockResolvedValue(undefined);
  const onChangedWhileEditing = vi.fn();
  const editingRef = { current: initialEditing };
  const boardIdRef = { current: boardId };
  const hook = renderHook(
    ({ editing }: { editing: boolean }) => {
      editingRef.current = editing;
      useCardRealtime({ reload, editingRef, editing, boardIdRef, onChangedWhileEditing });
    },
    { initialProps: { editing: initialEditing } }
  );
  return { reload, onChangedWhileEditing, hook };
}

describe('useCardRealtime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sock.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('khong sua gi: co thay doi tren bang -> tai lai the sau 400ms (gop nhieu su kien)', () => {
    const { reload } = setup();
    act(() => {
      sock.emit('board:lists-changed', { boardId: 'b1' });
      sock.emit('board:lists-changed', { boardId: 'b1' });
    });
    expect(reload).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('su kien cua bang khac -> bo qua', () => {
    const { reload } = setup();
    act(() => {
      sock.emit('board:lists-changed', { boardId: 'khac' });
      vi.advanceTimersByTime(1000);
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it('dang sua: KHONG tai lai luc do (khong ghi de ban nhap), bao cho modal nhac nguoi dung', () => {
    const { reload, onChangedWhileEditing } = setup(true);
    act(() => {
      sock.emit('board:lists-changed', { boardId: 'b1' });
      vi.advanceTimersByTime(400);
    });
    expect(reload).not.toHaveBeenCalled();
    expect(onChangedWhileEditing).toHaveBeenCalledTimes(1);
  });

  it('het sua (luu / huy) -> tai lai phan bi hoan, dung 1 lan', () => {
    const { reload, hook } = setup(true);
    act(() => {
      sock.emit('board:lists-changed', { boardId: 'b1' });
      vi.advanceTimersByTime(400);
    });
    expect(reload).not.toHaveBeenCalled();

    hook.rerender({ editing: false });
    expect(reload).toHaveBeenCalledTimes(1);

    // Khong con gi bi hoan -> doi trang thai sua them lan nua khong tai lai thua
    hook.rerender({ editing: true });
    hook.rerender({ editing: false });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('dang sua nhung KHONG co thay doi nao tu ben ngoai -> het sua khong tai lai', () => {
    const { reload, hook } = setup(true);
    hook.rerender({ editing: false });
    expect(reload).not.toHaveBeenCalled();
  });
});
