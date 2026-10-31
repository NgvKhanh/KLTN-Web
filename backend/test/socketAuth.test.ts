import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { initRealtime, shutdownRealtime } from '../src/realtime/socket';
import {
  addMember,
  addWorkspaceMember,
  agent,
  app,
  makeBoard,
  makeUser,
  makeWorkspace,
} from './helpers';

let server: ReturnType<typeof createServer> | null = null;
let baseUrl = '';

async function startServer() {
  server = createServer(app);
  initRealtime(server);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  const { port } = server!.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
}

function connect(cookie: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const s = ioClient(baseUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
      reconnection: false,
      forceNew: true,
      timeout: 4000,
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (err) => reject(err));
  });
}

afterEach(async () => {
  shutdownRealtime();
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
});

// Van de moi #3a: Socket.IO khong kiem tra thu hoi phien nhu REST
describe('#3 Socket.IO phai tu choi JWT da bi thu hoi', () => {
  it('token con hieu luc -> ket noi duoc', async () => {
    await startServer();
    const user = await makeUser();
    const s = await connect(user.cookie);
    expect(s.connected).toBe(true);
    s.close();
  });

  it('doi mat khau xong -> cookie cu KHONG con ket noi duoc socket moi', async () => {
    await startServer();
    const user = await makeUser();
    await agent()
      .patch('/api/auth/password')
      .set('Cookie', user.cookie)
      .send({ currentPassword: user.password, newPassword: 'MatKhauMoi123' })
      .expect(200);

    await expect(connect(user.cookie)).rejects.toBeTruthy();
  });

  it('doi mat khau xong -> socket DANG MO bi ngat ngay lap tuc (khong cho toi khi ket noi lai)', async () => {
    await startServer();
    const user = await makeUser();
    const s = await connect(user.cookie);
    expect(s.connected).toBe(true);

    const disconnected = new Promise<void>((resolve) =>
      s.on('disconnect', () => resolve())
    );
    await agent()
      .patch('/api/auth/password')
      .set('Cookie', user.cookie)
      .send({ currentPassword: user.password, newPassword: 'MatKhauMoi123' })
      .expect(200);

    await Promise.race([
      disconnected,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('timeout cho disconnect')), 3000)
      ),
    ]);
    expect(s.connected).toBe(false);
  });
});

// Van de moi #3b: xoa thanh vien phai buoc socket roi phong bang o server,
// khong chi trong cay client tuan theo su kien 'board:removed'
describe('#3 Bi xoa khoi bang -> buoc roi phong socket ngay tai server', () => {
  it('sau khi bi xoa, khong con nhan duoc board:lists-changed cua bang do', async () => {
    await startServer();
    const owner = await makeUser();
    const member = await makeUser();
    const board = await makeBoard(owner);
    await addMember(owner, board.id, member.email, 'MEMBER');

    const s = await connect(member.cookie);
    await new Promise<void>((resolve) => {
      s.emit('join-board', board.id);
      setTimeout(resolve, 300); // cho server xu ly join
    });

    await agent()
      .delete(`/api/boards/${board.id}/members/${member.id}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    await new Promise((r) => setTimeout(r, 300)); // cho server xu ly eviction

    let receivedAfterRemoval = false;
    s.on('board:lists-changed', () => {
      receivedAfterRemoval = true;
    });

    // Owner van con quyen -> tao 1 list moi de kich hoat board:lists-changed
    await agent()
      .post(`/api/boards/${board.id}/lists`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Sau khi bi xoa' })
      .expect(201);
    await new Promise((r) => setTimeout(r, 400));

    expect(receivedAfterRemoval).toBe(false);
    s.close();
  });
});

// Van de moi (vong 3) #1: cac duong MAT QUYEN khac (roi khong gian, doi
// visibility bang) cung phai don socket khoi phong bang, khong chi truong
// hop xoa truc tiep khoi bang.
describe('#1 (vong 3) cac duong mat quyen khac cung phai don socket khoi phong', () => {
  it('bi xoa khoi KHONG GIAN -> mat presence/su kien cua bang muc WORKSPACE thuoc khong gian do', async () => {
    await startServer();
    const owner = await makeUser();
    const member = await makeUser();
    const ws = await makeWorkspace(owner);
    await addWorkspaceMember(owner, ws.id, member.email, 'MEMBER');

    const board = await makeBoard(owner, { workspaceId: ws.id });
    await agent()
      .patch(`/api/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .send({ visibility: 'WORKSPACE' })
      .expect(200);

    const s = await connect(member.cookie);
    await new Promise<void>((resolve) => {
      s.emit('join-board', board.id);
      setTimeout(resolve, 300);
    });

    // Xoa member khoi KHONG GIAN (khong phai khoi bang truc tiep)
    await agent()
      .delete(`/api/workspaces/${ws.id}/members/${member.id}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    await new Promise((r) => setTimeout(r, 400)); // cho server doi soat lai phong

    let received = false;
    s.on('board:lists-changed', () => {
      received = true;
    });
    await agent()
      .post(`/api/boards/${board.id}/lists`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Sau khi roi khong gian' })
      .expect(201);
    await new Promise((r) => setTimeout(r, 400));

    expect(received).toBe(false);
    // Van con ket noi (chi mat quyen o PHONG bang nay, khong bi ngat han)
    expect(s.connected).toBe(true);
    s.close();
  });

  it('bang doi tu PUBLIC ve PRIVATE -> nguoi ngoai (dang trong phong tu luc con PUBLIC) bi don ra', async () => {
    await startServer();
    const owner = await makeUser();
    const outsider = await makeUser();
    const board = await makeBoard(owner);
    await agent()
      .patch(`/api/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .send({ visibility: 'PUBLIC' })
      .expect(200);

    const s = await connect(outsider.cookie);
    await new Promise<void>((resolve) => {
      s.emit('join-board', board.id);
      setTimeout(resolve, 300);
    });

    // Dong lai thanh PRIVATE
    await agent()
      .patch(`/api/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .send({ visibility: 'PRIVATE' })
      .expect(200);
    await new Promise((r) => setTimeout(r, 400));

    let received = false;
    s.on('board:lists-changed', () => {
      received = true;
    });
    await agent()
      .post(`/api/boards/${board.id}/lists`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Sau khi dong bang' })
      .expect(201);
    await new Promise((r) => setTimeout(r, 400));

    expect(received).toBe(false);
    expect(s.connected).toBe(true);
    s.close();
  });
});
