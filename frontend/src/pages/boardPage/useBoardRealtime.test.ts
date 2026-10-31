import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ----- Mock API + socket -----
const fetchBoardMock = vi.fn().mockResolvedValue({
  id: 'b1',
  canManage: true,
  visibility: 'WORKSPACE',
});
const fetchBoardMembersMock = vi.fn().mockResolvedValue([]);
vi.mock('../../lib/api/board', () => ({
  fetchBoard: (...a: unknown[]) =>
    (fetchBoardMock as (...a: unknown[]) => Promise<unknown>)(...a),
  fetchBoardMembers: (...a: unknown[]) =>
    (fetchBoardMembersMock as (...a: unknown[]) => Promise<unknown>)(...a),
}));
const fetchBoardListsMock = vi.fn().mockResolvedValue([]);
vi.mock('../../lib/api/list', () => ({
  fetchBoardLists: (...a: unknown[]) =>
    (fetchBoardListsMock as (...a: unknown[]) => Promise<unknown>)(...a),
}));

const socketHandlers = new Map<string, ((...a: unknown[]) => void)[]>();
vi.mock('../../lib/socket', () => ({
  socket: {
    emit: () => {},
    on: (ev: string, fn: (...a: unknown[]) => void) => {
      socketHandlers.set(ev, [...(socketHandlers.get(ev) ?? []), fn]);
    },
    off: (ev: string, fn: (...a: unknown[]) => void) => {
      socketHandlers.set(
        ev,
        (socketHandlers.get(ev) ?? []).filter((f) => f !== fn)
      );
    },
  },
}));
function emitSocket(ev: string, payload?: unknown) {
  for (const fn of socketHandlers.get(ev) ?? []) fn(payload);
}

// Cung MOT ham moi lan render: useNavigate that giu tham chieu on dinh, va effect co navigate trong deps
const navigateMock = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

import { useBoardRealtime } from './useBoardRealtime';

// Van de moi (vong 3) #4: doi vai tro trong KHONG GIAN LAM VIEC phai lam
// canManage cua bang dang mo tai lai theo, khong chi board:members-changed.
describe('#4 (vong 3) useBoardRealtime phai nghe workspace:changed', () => {
  it('workspace:changed -> tai lai chi tiet bang (canManage co the vua doi)', async () => {
    socketHandlers.clear();
    fetchBoardMock.mockClear();

    renderHook(() =>
      useBoardRealtime({
        boardId: 'b1',
        patchBoard: () => {},
        setLists: () => {},
        setMembers: () => {},
        setFetchedBoard: () => {},
        setOnlineIds: () => {},
        draggingRef: { current: false },
        pendingReloadRef: { current: false },
      })
    );

    expect(fetchBoardMock).not.toHaveBeenCalled();
    emitSocket('workspace:changed', { workspaceId: 'w1' });
    // fetchBoard() duoc goi ngay (khong debounce nhu lists-changed)
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchBoardMock).toHaveBeenCalledWith('b1');
  });
});

// REVIEW 26/09 #4: effect go listener va huy timer khi doi bang, nhung request da bay van tra ve va goi
// setLists / setMembers / patchBoard cua bang MOI -> danh sach cua bang cu de len bang dang mo.
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('REVIEW 26/09 #4 phan hoi cua bang cu khong de len bang dang mo', () => {
  function mount() {
    const spies = {
      patchBoard: vi.fn(),
      setLists: vi.fn(),
      setMembers: vi.fn(),
      setFetchedBoard: vi.fn(),
      setOnlineIds: vi.fn(),
    };
    const view = renderHook(
      ({ boardId }: { boardId: string }) =>
        useBoardRealtime({
          boardId,
          ...spies,
          draggingRef: { current: false },
          pendingReloadRef: { current: false },
        }),
      { initialProps: { boardId: 'A' } }
    );
    return { ...view, spies };
  }

  it('danh sach: A dang tai, doi sang B, A tra ve muon -> khong ghi; phan hoi cua B van duoc ap dung', async () => {
    vi.useFakeTimers();
    try {
      socketHandlers.clear();
      const a = deferred<unknown[]>();
      fetchBoardListsMock.mockReset();
      fetchBoardListsMock.mockImplementationOnce(() => a.promise).mockResolvedValue([{ id: 'list-of-B' }]);
      const { rerender, spies } = mount();

      emitSocket('board:lists-changed', { boardId: 'A' });
      await vi.advanceTimersByTimeAsync(400); // het debounce -> fetchBoardLists('A') dang cho
      expect(fetchBoardListsMock).toHaveBeenCalledWith('A');

      rerender({ boardId: 'B' }); // cleanup cua A chay
      a.resolve([{ id: 'list-of-A' }]);
      await vi.advanceTimersByTimeAsync(0);
      expect(spies.setLists).not.toHaveBeenCalled();

      emitSocket('board:lists-changed', { boardId: 'B' });
      await vi.advanceTimersByTimeAsync(400);
      expect(spies.setLists).toHaveBeenCalledTimes(1);
      expect(spies.setLists).toHaveBeenCalledWith([{ id: 'list-of-B' }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('chi tiet bang + thanh vien: phan hoi muon cua bang cu khong goi patchBoard / setFetchedBoard / setMembers', async () => {
    socketHandlers.clear();
    const boardA = deferred<{ id: string; name: string }>();
    const membersA = deferred<unknown[]>();
    fetchBoardMock.mockReset();
    fetchBoardMembersMock.mockReset();
    fetchBoardMock.mockImplementationOnce(() => boardA.promise);
    fetchBoardMembersMock.mockImplementationOnce(() => membersA.promise);
    const { rerender, spies } = mount();

    emitSocket('board:members-changed', { boardId: 'A' }); // tai thanh vien + chi tiet bang
    await Promise.resolve();
    expect(fetchBoardMembersMock).toHaveBeenCalledWith('A');
    expect(fetchBoardMock).toHaveBeenCalledWith('A');

    rerender({ boardId: 'B' });
    boardA.resolve({ id: 'A', name: 'Bang A' });
    membersA.resolve([{ userId: 'u-of-A' }]);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(spies.patchBoard).not.toHaveBeenCalled();
    expect(spies.setFetchedBoard).not.toHaveBeenCalled();
    expect(spies.setMembers).not.toHaveBeenCalled();
  });

  it('khong doi bang: phan hoi van duoc ap dung nhu cu', async () => {
    socketHandlers.clear();
    fetchBoardMock.mockReset();
    fetchBoardMock.mockResolvedValue({ id: 'A', name: 'Bang A' });
    const { spies } = mount();

    emitSocket('board:meta-changed', { boardId: 'A' });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(spies.patchBoard).toHaveBeenCalledWith({ id: 'A', name: 'Bang A' });
    expect(spies.setFetchedBoard).toHaveBeenCalledTimes(1);
  });
});
