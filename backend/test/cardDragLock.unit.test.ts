import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acquireCardDragLock,
  clearCardDragLocks,
  getCardDragLock,
  listBoardCardDragLocks,
  releaseCardDragLock,
  releaseSocketCardDragLocks,
  type CardDragLock,
} from '../src/realtime/cardDragLock';

function lockOf(over: Partial<CardDragLock> = {}): CardDragLock {
  return {
    cardId: 'c1',
    boardId: 'b1',
    userId: 'uA',
    userName: 'An',
    socketId: 'sA',
    ...over,
  };
}

afterEach(() => {
  clearCardDragLocks();
  vi.useRealTimers();
});

describe('Kho khoa keo tha the', () => {
  it('the chua bi khoa -> cap khoa; nguoi KHAC xin -> tu choi va biet ai dang giu', () => {
    expect(acquireCardDragLock(lockOf(), () => {}).ok).toBe(true);

    const denied = acquireCardDragLock(
      lockOf({ userId: 'uB', userName: 'Binh', socketId: 'sB' }),
      () => {}
    );
    expect(denied.ok).toBe(false);
    expect(denied.lock).toMatchObject({ userId: 'uA', userName: 'An' });
    expect(getCardDragLock('c1')?.userId).toBe('uA');
  });

  it('CHINH nguoi giu xin lai (gia han / tab khac) -> van duoc cap', () => {
    acquireCardDragLock(lockOf(), () => {});
    const again = acquireCardDragLock(lockOf({ socketId: 'sA2' }), () => {});
    expect(again.ok).toBe(true);
    expect(getCardDragLock('c1')?.socketId).toBe('sA2');
  });

  it('chi socket dang giu moi nha duoc khoa', () => {
    acquireCardDragLock(lockOf(), () => {});
    expect(releaseCardDragLock('c1', 'sB')).toBeNull();
    expect(getCardDragLock('c1')).not.toBeNull();

    expect(releaseCardDragLock('c1', 'sA')?.cardId).toBe('c1');
    expect(getCardDragLock('c1')).toBeNull();
  });

  it('nha theo socket: chi nha khoa cua socket do (va chi tren bang chi dinh neu co)', () => {
    acquireCardDragLock(lockOf({ cardId: 'c1', boardId: 'b1' }), () => {});
    acquireCardDragLock(lockOf({ cardId: 'c2', boardId: 'b2' }), () => {});
    acquireCardDragLock(
      lockOf({ cardId: 'c3', boardId: 'b1', userId: 'uB', socketId: 'sB' }),
      () => {}
    );

    expect(releaseSocketCardDragLocks('sA', 'b1').map((l) => l.cardId)).toEqual(['c1']);
    expect(getCardDragLock('c2')).not.toBeNull();

    expect(releaseSocketCardDragLocks('sA').map((l) => l.cardId)).toEqual(['c2']);
    expect(listBoardCardDragLocks('b1').map((l) => l.cardId)).toEqual(['c3']);
  });

  it('khong gia han -> tu het han va bao lai; gia han truoc han -> dem lai tu dau', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    acquireCardDragLock(lockOf(), onExpire, 1_000);

    vi.advanceTimersByTime(800);
    acquireCardDragLock(lockOf(), onExpire, 1_000); // gia han
    vi.advanceTimersByTime(800);
    expect(getCardDragLock('c1')).not.toBeNull();
    expect(onExpire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(getCardDragLock('c1')).toBeNull();
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onExpire.mock.calls[0]![0]).toMatchObject({ cardId: 'c1', boardId: 'b1' });
  });

  it('da nha tay thi bo hen gio cu khong duoc xoa khoa MOI cua nguoi khac', () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    acquireCardDragLock(lockOf(), onExpire, 1_000);
    releaseCardDragLock('c1', 'sA');
    acquireCardDragLock(lockOf({ userId: 'uB', socketId: 'sB' }), onExpire, 5_000);

    vi.advanceTimersByTime(1_500);
    expect(getCardDragLock('c1')?.userId).toBe('uB');
    expect(onExpire).not.toHaveBeenCalled();
  });
});
