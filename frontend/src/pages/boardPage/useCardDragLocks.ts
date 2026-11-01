import { useEffect, useMemo, useState } from 'react';
import type { CardDragLock } from '../../lib/cardDragLock';
import { socket } from '../../lib/socket';

const NONE: CardDragLock[] = [];

/**
 * Nghe 'board:card-locks': server gui CA danh sach the dang bi keo tren bang moi
 * khi co thay doi, va gui rieng cho minh ngay sau khi vao phong bang (ke ca luc
 * ket noi lai) -> chi can thay the danh sach, khong phai cong don.
 * Tra ve cac the dang bi NGUOI KHAC keo (khoa cua chinh minh, ke ca o tab khac,
 * khong chan minh keo).
 */
export function useCardDragLocks(
  boardId: string | undefined,
  currentUserId: string | undefined
): ReadonlyMap<string, CardDragLock> {
  // Ghi kem bang cua danh sach: doi sang bang khac thi danh sach cu tu het hieu luc
  const [received, setReceived] = useState<{ boardId: string; locks: CardDragLock[] } | null>(null);

  useEffect(() => {
    if (!boardId) return;
    const onLocks = (payload: { boardId?: string; locks?: CardDragLock[] }) => {
      if (payload?.boardId === boardId) setReceived({ boardId, locks: payload.locks ?? [] });
    };
    socket.on('board:card-locks', onLocks);
    return () => {
      socket.off('board:card-locks', onLocks);
    };
  }, [boardId]);

  const locks = received && received.boardId === boardId ? received.locks : NONE;
  return useMemo(
    () =>
      new Map(
        locks
          .filter((l) => l.userId !== currentUserId)
          .map((l) => [l.cardId, l] as const)
      ),
    [locks, currentUserId]
  );
}
