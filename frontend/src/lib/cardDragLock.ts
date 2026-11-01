import { socket } from './socket';

/** 1 the dang bi ai do keo (server gui ca danh sach qua su kien 'board:card-locks'). */
export interface CardDragLock {
  cardId: string;
  userId: string;
  userName: string;
}

// Gia han khoa trong luc keo (server tu nha khoa sau 60 giay neu khong duoc gia han)
export const CARD_DRAG_LOCK_RENEW_MS = 20_000;

/**
 * Xin khoa keo 1 the (goi lai trong luc keo = gia han). Tra ve khoa cua NGUOI
 * KHAC neu bi tu choi, null neu duoc keo.
 * Mat ket noi / server khong tra loi kip -> cho keo tiep (null): API di chuyen the
 * van kiem tra khoa lan cuoi (409 CARD_LOCKED) nen khong lach duoc.
 */
export async function acquireCardDragLock(
  boardId: string,
  cardId: string
): Promise<CardDragLock | null> {
  if (!socket.connected) return null;
  try {
    const res = (await socket
      .timeout(3000)
      .emitWithAck('card:drag-start', { boardId, cardId })) as
      | { ok?: boolean; error?: string; lock?: CardDragLock }
      | undefined;
    return res && !res.ok && res.error === 'LOCKED' && res.lock ? res.lock : null;
  } catch {
    return null;
  }
}

/** Nha khoa sau khi tha tay / huy keo (server chi nha neu chinh socket nay dang giu). */
export function releaseCardDragLock(cardId: string): void {
  if (socket.connected) socket.emit('card:drag-end', { cardId });
}
