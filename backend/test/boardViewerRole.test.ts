import { describe, expect, it } from 'vitest';
import { addMember, addWorkspaceMember, agent, makeBoard, makeCard, makeList, makeUser, makeWorkspace } from './helpers';

describe('Vai tro VIEWER (nguoi xem) tren bang', () => {
  it('them thanh vien voi vai tro VIEWER -> luu dung, board tra ve canEdit=false cho ho', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const viewer = await makeUser();

    const addRes = await addMember(owner, board.id, viewer.email, 'VIEWER');
    expect(addRes.data.member.role).toBe('VIEWER');

    const boardRes = await agent()
      .get(`/api/boards/${board.id}`)
      .set('Cookie', viewer.cookie);
    expect(boardRes.status).toBe(200);
    expect(boardRes.body.data.board.canEdit).toBe(false);
  });

  it('VIEWER khong tao duoc list/the -> 403', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const viewer = await makeUser();
    await addMember(owner, board.id, viewer.email, 'VIEWER');

    const createListRes = await agent()
      .post(`/api/boards/${board.id}/lists`)
      .set('Cookie', viewer.cookie)
      .send({ name: 'List cua viewer' });
    expect(createListRes.status).toBe(403);

    const createCardRes = await agent()
      .post(`/api/lists/${list.id}/cards`)
      .set('Cookie', viewer.cookie)
      .send({ title: 'The cua viewer' });
    expect(createCardRes.status).toBe(403);
  });

  it('VIEWER khong gan duoc lam thanh vien the (khong phai "thanh vien co the gan")', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    const viewer = await makeUser();
    await addMember(owner, board.id, viewer.email, 'VIEWER');

    const res = await agent()
      .post(`/api/cards/${card.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: viewer.id });
    expect(res.status).toBe(400);
  });

  // CODE_REVIEW.md #9: bang o muc hien thi WORKSPACE + VIEWER cung la thanh vien khong
  // gian - truoc day isBoardParticipant() "roi" xuong nhanh workspace va cho gan duoc.
  it('VIEWER tren bang WORKSPACE + cung la thanh vien khong gian - VAN khong gan duoc lam thanh vien the', async () => {
    const owner = await makeUser();
    const ws = await makeWorkspace(owner);
    const board = await makeBoard(owner, { workspaceId: ws.id });
    await agent()
      .patch(`/api/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .send({ visibility: 'WORKSPACE' })
      .expect(200);
    const viewer = await makeUser();
    await addWorkspaceMember(owner, ws.id, viewer.email, 'MEMBER');
    await addMember(owner, board.id, viewer.email, 'VIEWER');

    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);

    const res = await agent()
      .post(`/api/cards/${card.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: viewer.id });
    expect(res.status).toBe(400);
  });

  it('VIEWER van xem duoc danh sach + the (chi khong sua)', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    await makeCard(owner, list.id, 'The demo');
    const viewer = await makeUser();
    await addMember(owner, board.id, viewer.email, 'VIEWER');

    const listsRes = await agent()
      .get(`/api/boards/${board.id}/lists`)
      .set('Cookie', viewer.cookie);
    expect(listsRes.status).toBe(200);
    expect(listsRes.body.data.lists).toHaveLength(1);
  });
});
