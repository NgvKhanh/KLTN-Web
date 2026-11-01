import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { initRealtime, shutdownRealtime } from '../src/realtime/socket';
import {
  addMember,
  agent,
  app,
  makeBoard,
  makeCard,
  makeDirectUser,
  makeList,
  type TestUser,
} from './helpers';

// Khoa keo tha the: 1 nguoi dang keo thi nguoi khac khong keo / di chuyen duoc the do.

interface LockInfo {
  cardId: string;
  userId: string;
  userName: string;
}
interface LocksPayload {
  boardId: string;
  locks: LockInfo[];
}
interface DragStartAck {
  ok: boolean;
  error?: string;
  lock?: LockInfo;
}

let server: ReturnType<typeof createServer> | null = null;
let baseUrl = '';
const sockets: ClientSocket[] = [];

async function startServer() {
  server = createServer(app);
  initRealtime(server);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
}

function connect(user: TestUser): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(baseUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      extraHeaders: { Cookie: user.cookie },
      reconnection: false,
      forceNew: true,
      timeout: 4000,
    });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', (err) => reject(err));
  });
}

// Doi su kien `event` dau tien thoa `match` (het 3 giay thi bao loi)
function nextEvent<T>(
  s: ClientSocket,
  event: string,
  match: (p: T) => boolean = () => true
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      s.off(event, handler);
      reject(new Error(`timeout cho ${event}`));
    }, 3000);
    function handler(p: T) {
      if (!match(p)) return;
      clearTimeout(timer);
      s.off(event, handler);
      resolve(p);
    }
    s.on(event, handler);
  });
}

// Vao phong bang; server gui lai anh chup khoa ngay sau khi vao -> dung lam tin hieu "da vao xong"
async function joinBoard(s: ClientSocket, boardId: string): Promise<LocksPayload> {
  const snapshot = nextEvent<LocksPayload>(s, 'board:card-locks', (p) => p.boardId === boardId);
  s.emit('join-board', boardId);
  return snapshot;
}

function dragStart(s: ClientSocket, boardId: string, cardId: string): Promise<DragStartAck> {
  return s.timeout(3000).emitWithAck('card:drag-start', { boardId, cardId });
}

function moveViaApi(user: TestUser, cardId: string, listId: string) {
  return agent()
    .patch(`/api/cards/${cardId}/move`)
    .set('Cookie', user.cookie)
    .send({ listId, position: 0 });
}

async function setup() {
  await startServer();
  const owner = await makeDirectUser('Chu Bang');
  const member = await makeDirectUser('Thanh Vien');
  const board = await makeBoard(owner);
  await addMember(owner, board.id, member.email, 'MEMBER');
  const todo = await makeList(owner, board.id, 'Can lam');
  const doing = await makeList(owner, board.id, 'Dang lam');
  const card = await makeCard(owner, todo.id, 'The dang keo');
  return { owner, member, board, todo, doing, card };
}

afterEach(async () => {
  for (const s of sockets.splice(0)) s.close();
  shutdownRealtime();
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

describe('Khoa keo tha the qua socket', () => {
  it('A dang keo -> ca bang thay the bi khoa; B xin keo cung the bi tu choi va biet A dang keo', async () => {
    const { owner, member, board, card } = await setup();
    const a = await connect(owner);
    const b = await connect(member);
    await joinBoard(a, board.id);
    await joinBoard(b, board.id);

    const bSeesLock = nextEvent<LocksPayload>(b, 'board:card-locks', (p) => p.locks.length > 0);
    expect(await dragStart(a, board.id, card.id)).toEqual({ ok: true });
    expect((await bSeesLock).locks).toEqual([
      { cardId: card.id, userId: owner.id, userName: 'Chu Bang' },
    ]);

    const denied = await dragStart(b, board.id, card.id);
    expect(denied).toMatchObject({
      ok: false,
      error: 'LOCKED',
      lock: { cardId: card.id, userId: owner.id, userName: 'Chu Bang' },
    });
  });

  it('API di chuyen the: nguoi khac -> 409 CARD_LOCKED; chinh nguoi giu khoa -> di chuyen duoc', async () => {
    const { owner, member, board, doing, card } = await setup();
    const a = await connect(owner);
    await joinBoard(a, board.id);
    expect((await dragStart(a, board.id, card.id)).ok).toBe(true);

    const blocked = await moveViaApi(member, card.id, doing.id).expect(409);
    expect(blocked.body.code).toBe('CARD_LOCKED');
    expect(blocked.body.message).toContain('Chu Bang');

    await moveViaApi(owner, card.id, doing.id).expect(200);
  });

  it('A tha tay -> khoa duoc nha, B keo / di chuyen duoc; B KHONG nha ho duoc khoa cua A', async () => {
    const { owner, member, board, doing, card } = await setup();
    const a = await connect(owner);
    const b = await connect(member);
    await joinBoard(a, board.id);
    await joinBoard(b, board.id);
    await dragStart(a, board.id, card.id);

    // B gui drag-end cho the cua A: khong co tac dung
    b.emit('card:drag-end', { cardId: card.id });
    expect((await dragStart(b, board.id, card.id)).ok).toBe(false);

    const released = nextEvent<LocksPayload>(b, 'board:card-locks', (p) => p.locks.length === 0);
    a.emit('card:drag-end', { cardId: card.id });
    await released;

    expect((await dragStart(b, board.id, card.id)).ok).toBe(true);
    await moveViaApi(member, card.id, doing.id).expect(200);
  });

  it('A mat ket noi giua chung -> khoa tu nha, the khong bi khoa treo', async () => {
    const { owner, member, board, card } = await setup();
    const a = await connect(owner);
    const b = await connect(member);
    await joinBoard(a, board.id);
    await joinBoard(b, board.id);
    await dragStart(a, board.id, card.id);

    const released = nextEvent<LocksPayload>(b, 'board:card-locks', (p) => p.locks.length === 0);
    a.close();
    await released;
    expect((await dragStart(b, board.id, card.id)).ok).toBe(true);
  });

  it('A roi bang (leave-board) -> khoa cua A tren bang do duoc nha', async () => {
    const { owner, member, board, card } = await setup();
    const a = await connect(owner);
    const b = await connect(member);
    await joinBoard(a, board.id);
    await joinBoard(b, board.id);
    await dragStart(a, board.id, card.id);

    const released = nextEvent<LocksPayload>(b, 'board:card-locks', (p) => p.locks.length === 0);
    a.emit('leave-board', board.id);
    await released;
  });

  it('nguoi vao bang sau van nhan ngay danh sach the dang bi khoa', async () => {
    const { owner, member, board, card } = await setup();
    const a = await connect(owner);
    await joinBoard(a, board.id);
    await dragStart(a, board.id, card.id);

    const b = await connect(member);
    const snapshot = await joinBoard(b, board.id);
    expect(snapshot.locks.map((l) => l.cardId)).toEqual([card.id]);
  });

  it('VIEWER / chua vao phong bang / the cua bang khac -> khong khoa duoc', async () => {
    const { owner, board, card } = await setup();
    const viewer = await makeDirectUser('Nguoi Xem');
    await addMember(owner, board.id, viewer.email, 'VIEWER');
    const v = await connect(viewer);
    await joinBoard(v, board.id);
    expect(await dragStart(v, board.id, card.id)).toMatchObject({ ok: false, error: 'FORBIDDEN' });

    const a = await connect(owner);
    // Chua join-board
    expect(await dragStart(a, board.id, card.id)).toMatchObject({ ok: false, error: 'FORBIDDEN' });

    const otherBoard = await makeBoard(owner, { name: 'Bang khac' });
    const otherList = await makeList(owner, otherBoard.id);
    const otherCard = await makeCard(owner, otherList.id);
    await joinBoard(a, board.id);
    expect(await dragStart(a, board.id, otherCard.id)).toMatchObject({
      ok: false,
      error: 'NOT_FOUND',
    });

    // Cac lan xin hong o tren khong de lai khoa nao: chu bang van khoa duoc the
    expect((await dragStart(a, board.id, card.id)).ok).toBe(true);
  });
});
