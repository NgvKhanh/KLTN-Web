import { describe, expect, it } from 'vitest';
import {
  addMember,
  agent,
  makeBoard,
  makeCard,
  makeList,
  makeUser,
} from './helpers';

describe('Theo doi (watch) card/list/board', () => {
  it('nguoi ngoai bang khong watch duoc the -> 403', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    const outsider = await makeUser();

    const res = await agent()
      .put(`/api/cards/${card.id}/watch`)
      .set('Cookie', outsider.cookie)
      .send({ watching: true });
    expect(res.status).toBe(403);
  });

  it('watch 1 the (khong phai thanh vien duoc gan) -> van nhan thong bao binh luan', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    const watcher = await makeUser();
    await addMember(owner, board.id, watcher.email);

    const watchRes = await agent()
      .put(`/api/cards/${card.id}/watch`)
      .set('Cookie', watcher.cookie)
      .send({ watching: true });
    expect(watchRes.status).toBe(200);
    expect(watchRes.body.data.watching).toBe(true);

    // Chu bang binh luan tren the (watcher KHONG phai thanh vien duoc gan cua the)
    await agent()
      .post(`/api/cards/${card.id}/comments`)
      .set('Cookie', owner.cookie)
      .send({ text: 'xin chao' })
      .expect(201);

    const notiRes = await agent()
      .get('/api/notifications')
      .set('Cookie', watcher.cookie);
    expect(notiRes.status).toBe(200);
    const commentNoti = notiRes.body.data.notifications.find(
      (n: { type: string; cardId: string }) =>
        n.type === 'card.comment' && n.cardId === card.id
    );
    expect(commentNoti).toBeTruthy();
  });

  it('bo watch the -> khong con nhan thong bao binh luan moi', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    const watcher = await makeUser();
    await addMember(owner, board.id, watcher.email);

    await agent()
      .put(`/api/cards/${card.id}/watch`)
      .set('Cookie', watcher.cookie)
      .send({ watching: true })
      .expect(200);
    const unwatchRes = await agent()
      .put(`/api/cards/${card.id}/watch`)
      .set('Cookie', watcher.cookie)
      .send({ watching: false });
    expect(unwatchRes.body.data.watching).toBe(false);

    await agent()
      .post(`/api/cards/${card.id}/comments`)
      .set('Cookie', owner.cookie)
      .send({ text: 'sau khi bo watch' })
      .expect(201);

    const notiRes = await agent()
      .get('/api/notifications')
      .set('Cookie', watcher.cookie);
    const commentNoti = notiRes.body.data.notifications.find(
      (n: { type: string; cardId: string }) =>
        n.type === 'card.comment' && n.cardId === card.id
    );
    expect(commentNoti).toBeFalsy();
  });

  it('watch ca danh sach -> nhan thong bao binh luan cho MOI the trong danh sach do', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id, 'The trong danh sach');
    const watcher = await makeUser();
    await addMember(owner, board.id, watcher.email);

    const watchRes = await agent()
      .put(`/api/lists/${list.id}/watch`)
      .set('Cookie', watcher.cookie)
      .send({ watching: true });
    expect(watchRes.status).toBe(200);

    const statusRes = await agent()
      .get(`/api/lists/${list.id}/watch`)
      .set('Cookie', watcher.cookie);
    expect(statusRes.body.data.watching).toBe(true);

    await agent()
      .post(`/api/cards/${card.id}/comments`)
      .set('Cookie', owner.cookie)
      .send({ text: 'binh luan qua watch danh sach' })
      .expect(201);

    const notiRes = await agent()
      .get('/api/notifications')
      .set('Cookie', watcher.cookie);
    const commentNoti = notiRes.body.data.notifications.find(
      (n: { type: string; cardId: string }) =>
        n.type === 'card.comment' && n.cardId === card.id
    );
    expect(commentNoti).toBeTruthy();
  });

  it('watch ca bang -> nhan thong bao binh luan cho the bat ky trong bang', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id, 'The trong bang');
    const watcher = await makeUser();
    await addMember(owner, board.id, watcher.email);

    await agent()
      .put(`/api/boards/${board.id}/watch`)
      .set('Cookie', watcher.cookie)
      .send({ watching: true })
      .expect(200);

    const boardRes = await agent()
      .get(`/api/boards/${board.id}`)
      .set('Cookie', watcher.cookie);
    expect(boardRes.body.data.board.isWatching).toBe(true);

    await agent()
      .post(`/api/cards/${card.id}/comments`)
      .set('Cookie', owner.cookie)
      .send({ text: 'binh luan qua watch bang' })
      .expect(201);

    const notiRes = await agent()
      .get('/api/notifications')
      .set('Cookie', watcher.cookie);
    const commentNoti = notiRes.body.data.notifications.find(
      (n: { type: string; cardId: string }) =>
        n.type === 'card.comment' && n.cardId === card.id
    );
    expect(commentNoti).toBeTruthy();
  });
});
