import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { isAllowedOrigin } from '../middleware/originGuard.middleware';
import { assertBoardAccess } from '../modules/board/board.service';
import { verifyToken } from '../utils/jwt';
import {
  acquireCardDragLock,
  clearCardDragLocks,
  listBoardCardDragLocks,
  releaseCardDragLock,
  releaseSocketCardDragLocks,
  type CardDragLock,
} from './cardDragLock';

// Cac su kien server -> client
export type RealtimeEvent =
  | 'board:lists-changed' // the / danh sach / checklist / binh luan ... doi
  | 'board:members-changed' // thanh vien / vai tro doi
  | 'board:join-requests-changed' // co yeu cau tham gia moi / da duyet / da tu choi
  | 'board:meta-changed' // ten bang / mau / anh nen / kha nang hien thi / chu bang doi
  | 'board:removed' // nguoi nhan vua bi xoa khoi bang (gui vao phong user)
  | 'board:presence' // danh sach userId dang MO bang nay (thay doi khi co nguoi vao/ra)
  | 'board:card-locks' // cac the dang bi ai do keo tha (khoa keo tha, xem cardDragLock.ts)
  | 'board:access-changed' // danh sach bang nguoi nhan xem duoc co the doi (gui vao phong user)
  | 'workspace:changed' // khong gian / thanh vien khong gian doi (gui vao phong user)
  | 'notification:new'; // co thong bao moi (gui vao phong user)

let io: Server | null = null;

const boardRoom = (boardId: string) => `board:${boardId}`;
const userRoom = (userId: string) => `user:${userId}`;

// Danh sach userId dang mo 1 bang (moi nguoi tinh 1 lan du mo nhieu tab).
async function boardPresenceUserIds(boardId: string): Promise<string[]> {
  if (!io) return [];
  try {
    const sockets = await io.in(boardRoom(boardId)).fetchSockets();
    const ids = new Set<string>();
    for (const s of sockets) {
      const uid = s.data.userId as string | undefined;
      if (uid) ids.add(uid);
    }
    return [...ids];
  } catch {
    return [];
  }
}

// Kiem tra 1 user co con quyen o trong "phong" cua 1 bang khong (chu bang /
// bang PUBLIC / thanh vien bang / thanh vien khong gian neu bang WORKSPACE).
// Dung chung boi handler 'join-board' VA reconcileBoardRoomAccess() (goi lai
// khi quyen co the vua thay doi, de "don" nhung socket khong con hop le).
async function canAccessBoardRoom(
  userId: string,
  boardId: string
): Promise<boolean> {
  const board = await prisma.board.findFirst({
    where: { id: boardId, deletedAt: null },
    select: { ownerId: true, visibility: true, workspaceId: true },
  });
  if (!board) return false;
  if (board.ownerId === userId || board.visibility === 'PUBLIC') return true;

  const isBoardMember = await prisma.boardMember.findFirst({
    where: { boardId, userId, deletedAt: null },
    select: { id: true },
  });
  if (isBoardMember) return true;

  if (board.visibility === 'WORKSPACE') {
    const ws = await prisma.workspace.findFirst({
      where: { id: board.workspaceId, deletedAt: null },
      select: { ownerId: true },
    });
    if (ws?.ownerId === userId) return true;
    const isWsMember = await prisma.workspaceMember.findFirst({
      where: { workspaceId: board.workspaceId, userId, deletedAt: null },
      select: { id: true },
    });
    if (isWsMember) return true;
  }

  return false;
}

// Bao cho ca phong bang biet ai dang online trong bang.
async function broadcastPresence(boardId: string): Promise<void> {
  if (!io) return;
  const userIds = await boardPresenceUserIds(boardId);
  try {
    io.to(boardRoom(boardId)).emit('board:presence', { boardId, userIds });
  } catch {
    // bo qua
  }
}

// Khoa keo tha gui xuong client: bo socketId (thong tin noi bo cua server)
function publicLock(lock: CardDragLock) {
  return { cardId: lock.cardId, userId: lock.userId, userName: lock.userName };
}

function cardLocksPayload(boardId: string) {
  return { boardId, locks: listBoardCardDragLocks(boardId).map(publicLock) };
}

// Bao cho ca phong bang biet nhung the nao dang bi khoa keo tha
function broadcastCardLocks(boardId: string): void {
  if (!io) return;
  try {
    io.to(boardRoom(boardId)).emit('board:card-locks', cardLocksPayload(boardId));
  } catch {
    // bo qua
  }
}

// Nha moi khoa keo tha cua 1 socket (tren 1 bang, hoac moi bang) roi bao lai cho cac bang bi anh huong
function releaseLocksOfSocket(socketId: string, boardId?: string): void {
  const boardIds = new Set(
    releaseSocketCardDragLocks(socketId, boardId).map((l) => l.boardId)
  );
  for (const id of boardIds) broadcastCardLocks(id);
}

type DragStartAck = (res: {
  ok: boolean;
  error?: 'INVALID' | 'FORBIDDEN' | 'NOT_FOUND' | 'LOCKED';
  lock?: ReturnType<typeof publicLock>;
}) => void;

// Doc cookie "token" tu chuoi header Cookie (tu parse, khong can thu vien)
function tokenFromHandshake(socket: Socket): string | null {
  const raw = socket.handshake.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === 'token') {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Gan Socket.IO vao HTTP server dang chay. Neu loi -> chi ghi log,
 * app REST van hoat dong binh thuong (realtime la lop tang cuong).
 */
export function initRealtime(httpServer: HttpServer): void {
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: env.corsOrigins, credentials: true },
  });

  // Xac thuc: bat buoc co JWT hop le trong cookie VA con dung tokenVersion
  // hien tai cua user (doi/dat lai mat khau se tang tokenVersion -> JWT cu
  // khong con ket noi duoc socket moi nao nua, giong REST).
  io.use(async (socket, next) => {
    try {
      // Ket noi WebSocket KHONG qua CORS: voi cookie SameSite=None, trang la mo duoc socket bang cookie cua
      // nguoi dung va nghe thong bao cua ho -> chi nhan Origin nam trong CORS_ORIGIN (nhu originGuard cua REST)
      if (!isAllowedOrigin(socket.handshake.headers.origin, env.corsOrigins)) {
        return next(new Error('origin not allowed'));
      }
      const token = tokenFromHandshake(socket);
      if (!token) return next(new Error('unauthorized'));
      const payload = verifyToken(token);
      const user = await prisma.user.findFirst({
        where: { id: payload.userId, deletedAt: null },
        select: { id: true, tokenVersion: true, name: true },
      });
      if (!user) return next(new Error('unauthorized'));
      if ((payload.tokenVersion ?? -1) !== user.tokenVersion) {
        return next(new Error('unauthorized'));
      }
      socket.data.userId = user.id;
      socket.data.userName = user.name;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId as string;
    const userName = (socket.data.userName as string | undefined) ?? '';
    // Phong rieng cua nguoi dung -> nhan thong bao / su kien bi xoa khoi bang
    void socket.join(userRoom(userId));

    // Vao phong 1 bang sau khi kiem tra quyen xem
    socket.on('join-board', async (boardId: unknown) => {
      if (typeof boardId !== 'string' || !boardId) return;
      if (await canAccessBoardRoom(userId, boardId)) {
        await socket.join(boardRoom(boardId));
        void broadcastPresence(boardId);
        // Nguoi moi vao (hoac vua ket noi lai) can biet ngay the nao dang bi khoa
        socket.emit('board:card-locks', cardLocksPayload(boardId));
      }
    });

    socket.on('leave-board', (boardId: unknown) => {
      if (typeof boardId === 'string' && boardId) {
        void socket.leave(boardRoom(boardId));
        void broadcastPresence(boardId);
        releaseLocksOfSocket(socket.id, boardId);
      }
    });

    // ---- Khoa keo tha the ----
    // Xu ly xin / nha khoa cua socket nay THEO DUNG THU TU gui len. Xin khoa phai doc CSDL (bat dong bo):
    // khong xep hang thi 'card:drag-end' gui sau co the chay xong TRUOC, roi khoa moi duoc cap -> the bi
    // khoa treo cho toi khi het han du nguoi do da tha tay.
    let lockChain: Promise<void> = Promise.resolve();
    const inOrder = (task: () => Promise<void> | void) => {
      lockChain = lockChain.then(task).catch(() => {});
    };

    // Bat dau keo 1 the: { boardId, cardId } + ack({ ok, error?, lock? }). Goi lai trong luc keo = gia han.
    socket.on('card:drag-start', (payload: unknown, ack?: unknown) => {
      const reply: DragStartAck =
        typeof ack === 'function' ? (ack as DragStartAck) : () => {};
      const { boardId, cardId } = (payload ?? {}) as {
        boardId?: unknown;
        cardId?: unknown;
      };
      if (
        typeof boardId !== 'string' ||
        !boardId ||
        typeof cardId !== 'string' ||
        !cardId
      ) {
        reply({ ok: false, error: 'INVALID' });
        return;
      }
      inOrder(async () => {
        // Phai dang o trong phong bang (da qua kiem tra quyen xem), the thuoc bang nay, va co QUYEN SUA
        // (VIEWER / khach xem bang cong khai khong duoc khoa the cua nguoi khac)
        if (!socket.rooms.has(boardRoom(boardId))) {
          reply({ ok: false, error: 'FORBIDDEN' });
          return;
        }
        try {
          const card = await prisma.card.findFirst({
            where: { id: cardId, deletedAt: null, archivedAt: null, list: { boardId } },
            select: { id: true },
          });
          if (!card) {
            reply({ ok: false, error: 'NOT_FOUND' });
            return;
          }
          await assertBoardAccess(userId, boardId);
        } catch {
          reply({ ok: false, error: 'FORBIDDEN' });
          return;
        }
        // Mat ket noi trong luc doc CSDL: khong cap khoa cho socket da chet (se khong ai nha)
        if (!socket.connected) return;

        const result = acquireCardDragLock(
          { cardId, boardId, userId, userName, socketId: socket.id },
          (expired) => broadcastCardLocks(expired.boardId)
        );
        if (!result.ok) {
          reply({ ok: false, error: 'LOCKED', lock: publicLock(result.lock) });
          return;
        }
        reply({ ok: true });
        broadcastCardLocks(boardId);
      });
    });

    // Tha tay / huy keo: { cardId }. Chi socket dang giu khoa moi nha duoc.
    socket.on('card:drag-end', (payload: unknown) => {
      const { cardId } = (payload ?? {}) as { cardId?: unknown };
      if (typeof cardId !== 'string' || !cardId) return;
      inOrder(() => {
        const released = releaseCardDragLock(cardId, socket.id);
        if (released) broadcastCardLocks(released.boardId);
      });
    });

    // Da ngat han (socket.connected = false): nha moi khoa con giu de the khong bi khoa treo
    socket.on('disconnect', () => {
      releaseLocksOfSocket(socket.id);
    });

    // Tab dong / mat ket noi: socket sap roi tat ca phong -> cap nhat presence
    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (room.startsWith('board:')) {
          const boardId = room.slice('board:'.length);
          // Chay sau khi socket thuc su roi phong
          setImmediate(() => {
            void broadcastPresence(boardId);
          });
        }
      }
    });
  });
}

// ---- Ham phat su kien (an toan: bo qua neu io chua san sang) ----

export function emitToBoard(
  boardId: string | null | undefined,
  event: RealtimeEvent
): void {
  if (!io || !boardId) return;
  try {
    io.to(boardRoom(boardId)).emit(event, { boardId });
  } catch {
    // bo qua
  }
}

export function emitToUser(
  userId: string | null | undefined,
  event: RealtimeEvent,
  payload: Record<string, unknown> = {}
): void {
  if (!io || !userId) return;
  try {
    io.to(userRoom(userId)).emit(event, payload);
  } catch {
    // bo qua
  }
}

/**
 * Ngat NGAY moi ket noi Socket.IO dang mo cua 1 user (dung khi doi/dat lai
 * mat khau - JWT cu bi thu hoi nhung socket dang mo se KHONG tu ngat cho toi
 * khi ket noi lai, neu khong chu dong ngat o day).
 */
export function disconnectUserSockets(userId: string | null | undefined): void {
  if (!io || !userId) return;
  try {
    io.in(userRoom(userId)).disconnectSockets(true);
  } catch {
    // bo qua
  }
}

/**
 * Buoc moi socket cua 1 user roi khoi phong cua 1 bang cu the (dung khi
 * nguoi do bi xoa khoi bang). Khac voi chi phat 'board:removed': lam o day
 * dam bao ho KHONG con nhan duoc su kien/presence cua bang do ngay ca khi
 * client khong tuan theo (vd da sua code, bo qua su kien).
 */
export async function evictUserFromBoardRoom(
  userId: string | null | undefined,
  boardId: string | null | undefined
): Promise<void> {
  if (!io || !userId || !boardId) return;
  try {
    const sockets = await io.in(boardRoom(boardId)).fetchSockets();
    for (const s of sockets) {
      if (s.data.userId === userId) {
        void s.leave(boardRoom(boardId));
        releaseLocksOfSocket(s.id, boardId);
      }
    }
    void broadcastPresence(boardId);
  } catch {
    // bo qua
  }
}

/**
 * Doi soat lai quyen cua TAT CA socket dang trong phong 1 bang, "don" nhung
 * socket khong con hop le. Dung khi LUAT truy cap bang co the vua doi ma
 * KHONG biet chinh xac ai bi anh huong (doi visibility cua bang; 1 nguoi roi
 * khoi khong gian co the mat quyen o nhieu bang WORKSPACE cua khong gian do).
 * Khac voi evictUserFromBoardRoom (biet chinh xac 1 nguoi bi mat quyen o 1
 * bang cu the -> khong can truy van lai quyen).
 */
export async function reconcileBoardRoomAccess(
  boardId: string | null | undefined
): Promise<void> {
  if (!io || !boardId) return;
  try {
    const sockets = await io.in(boardRoom(boardId)).fetchSockets();
    const checks = await Promise.all(
      sockets.map(async (s) => {
        const uid = s.data.userId as string | undefined;
        if (!uid) return null;
        const ok = await canAccessBoardRoom(uid, boardId);
        return ok ? null : s;
      })
    );
    let evictedAny = false;
    for (const s of checks) {
      if (!s) continue;
      void s.leave(boardRoom(boardId));
      releaseLocksOfSocket(s.id, boardId);
      evictedAny = true;
    }
    if (evictedAny) void broadcastPresence(boardId);
  } catch {
    // bo qua
  }
}

export function shutdownRealtime(): void {
  io?.close();
  io = null;
  clearCardDragLocks();
}
