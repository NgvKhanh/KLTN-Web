/**
 * Khoa keo tha the: trong luc 1 nguoi dang keo 1 the, nhung nguoi khac KHONG
 * duoc keo the do (giao dien khoa the lai, API di chuyen the tra 409).
 *
 * Luu trong bo nho cua tien trinh server (Map), khong luu CSDL: khoa chi song
 * vai giay, mat khi server khoi dong lai cung khong sao. Chi dung dung khi chay
 * MOT tien trinh backend (dang deploy 1 instance) - chay nhieu instance thi phai
 * chuyen sang kho dung chung (vd Redis).
 *
 * Khoa tinh theo NGUOI (userId): chinh nguoi giu khoa van keo / goi API duoc,
 * ke ca o tab khac. Nhung chi socket da xin khoa moi nha duoc khoa do.
 */

export interface CardDragLock {
  cardId: string;
  boardId: string;
  userId: string;
  userName: string;
  socketId: string;
}

// Client gia han khoa moi 20 giay trong luc keo. Qua thoi han ma khong gia han
// (vd trinh duyet treo) thi khoa tu nha de the khong bi khoa mai.
export const CARD_DRAG_LOCK_TTL_MS = 60_000;

const locks = new Map<string, CardDragLock & { timer: ReturnType<typeof setTimeout> }>();

function strip(lock: CardDragLock & { timer?: unknown }): CardDragLock {
  return {
    cardId: lock.cardId,
    boardId: lock.boardId,
    userId: lock.userId,
    userName: lock.userName,
    socketId: lock.socketId,
  };
}

export type AcquireResult =
  | { ok: true; lock: CardDragLock }
  | { ok: false; lock: CardDragLock };

/**
 * Xin khoa 1 the. Duoc cap neu the chua bi khoa, hoac dang do CHINH nguoi nay
 * giu (gia han / doi sang socket moi). Nguoi khac dang giu -> tu choi, tra ve
 * khoa hien tai de bao "ai dang keo".
 * `onExpire` duoc goi khi khoa tu het han (de bao lai cho ca bang).
 */
export function acquireCardDragLock(
  input: CardDragLock,
  onExpire: (lock: CardDragLock) => void,
  ttlMs = CARD_DRAG_LOCK_TTL_MS
): AcquireResult {
  const current = locks.get(input.cardId);
  if (current && current.userId !== input.userId) {
    return { ok: false, lock: strip(current) };
  }
  if (current) clearTimeout(current.timer);

  const timer = setTimeout(() => {
    const now = locks.get(input.cardId);
    if (now && now.timer === timer) {
      locks.delete(input.cardId);
      onExpire(strip(now));
    }
  }, ttlMs);
  // Khong giu tien trinh song chi vi bo hen gio nay
  timer.unref?.();

  const lock = { ...input, timer };
  locks.set(input.cardId, lock);
  return { ok: true, lock: strip(lock) };
}

/** Nha khoa 1 the - chi socket dang giu moi nha duoc. Tra ve khoa da nha (hoac null). */
export function releaseCardDragLock(
  cardId: string,
  socketId: string
): CardDragLock | null {
  const current = locks.get(cardId);
  if (!current || current.socketId !== socketId) return null;
  clearTimeout(current.timer);
  locks.delete(cardId);
  return strip(current);
}

/**
 * Nha moi khoa cua 1 socket (mat ket noi / roi bang). `boardId` co gia tri thi
 * chi nha khoa tren bang do. Tra ve cac khoa da nha de bao lai cho tung bang.
 */
export function releaseSocketCardDragLocks(
  socketId: string,
  boardId?: string
): CardDragLock[] {
  const released: CardDragLock[] = [];
  for (const [cardId, lock] of locks) {
    if (lock.socketId !== socketId) continue;
    if (boardId && lock.boardId !== boardId) continue;
    clearTimeout(lock.timer);
    locks.delete(cardId);
    released.push(strip(lock));
  }
  return released;
}

export function getCardDragLock(cardId: string): CardDragLock | null {
  const lock = locks.get(cardId);
  return lock ? strip(lock) : null;
}

/** Cac the dang bi khoa tren 1 bang (gui cho client ve bieu tuong khoa). */
export function listBoardCardDragLocks(boardId: string): CardDragLock[] {
  const out: CardDragLock[] = [];
  for (const lock of locks.values()) {
    if (lock.boardId === boardId) out.push(strip(lock));
  }
  return out;
}

/** Xoa sach (dung khi tat realtime va trong test). */
export function clearCardDragLocks(): void {
  for (const lock of locks.values()) clearTimeout(lock.timer);
  locks.clear();
}
