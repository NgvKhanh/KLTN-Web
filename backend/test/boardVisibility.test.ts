import { describe, expect, it } from 'vitest';
import { addMember, agent, makeBoard, makeUser } from './helpers';

// Van de #1: thanh vien thuong khong duoc doi che do hien thi bang
describe('PATCH /api/boards/:id - quyen doi visibility', () => {
  it('chu bang doi PRIVATE -> PUBLIC thanh cong', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);

    const res = await agent()
      .patch(`/api/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .send({ visibility: 'PUBLIC' });

    expect(res.status).toBe(200);
    expect(res.body.data.board.visibility).toBe('PUBLIC');
  });

  it('thanh vien thuong (MEMBER) KHONG doi duoc visibility -> 403', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const board = await makeBoard(owner);
    await addMember(owner, board.id, member.email, 'MEMBER');

    const res = await agent()
      .patch(`/api/boards/${board.id}`)
      .set('Cookie', member.cookie)
      .send({ visibility: 'PUBLIC' });

    expect(res.status).toBe(403);

    // Xac nhan visibility khong doi
    const check = await agent()
      .get(`/api/boards/${board.id}`)
      .set('Cookie', owner.cookie);
    expect(check.body.data.board.visibility).toBe('PRIVATE');
  });

  it('thanh vien thuong VAN doi duoc ten bang (chi can quyen sua)', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const board = await makeBoard(owner);
    await addMember(owner, board.id, member.email, 'MEMBER');

    const res = await agent()
      .patch(`/api/boards/${board.id}`)
      .set('Cookie', member.cookie)
      .send({ name: 'Ten moi do member dat' });

    expect(res.status).toBe(200);
    expect(res.body.data.board.name).toBe('Ten moi do member dat');
  });

  it('ADMIN bang doi duoc visibility', async () => {
    const owner = await makeUser();
    const admin = await makeUser();
    const board = await makeBoard(owner);
    await addMember(owner, board.id, admin.email, 'ADMIN');

    const res = await agent()
      .patch(`/api/boards/${board.id}`)
      .set('Cookie', admin.cookie)
      .send({ visibility: 'WORKSPACE' });

    expect(res.status).toBe(200);
    expect(res.body.data.board.visibility).toBe('WORKSPACE');
  });
});
