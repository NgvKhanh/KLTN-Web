import { describe, expect, it } from 'vitest';
import {
  addWorkspaceMember,
  agent,
  makeBoard,
  makeUser,
  makeWorkspace,
} from './helpers';

async function getBoard(user: { cookie: string }, boardId: string) {
  const res = await agent()
    .get(`/api/boards/${boardId}`)
    .set('Cookie', user.cookie);
  return res;
}

// Van de #10: GET /api/boards/:id tra ve canManage do backend tinh
// (gom ca OWNER/ADMIN cua khong gian chua bang)
describe('#10 co canManage do backend tinh', () => {
  it('ADMIN khong gian (khong phai thanh vien bang) -> canManage = true', async () => {
    const owner = await makeUser();
    const wsAdmin = await makeUser();
    const ws = await makeWorkspace(owner);
    await addWorkspaceMember(owner, ws.id, wsAdmin.email, 'ADMIN');

    const board = await makeBoard(owner, { workspaceId: ws.id });
    await agent()
      .patch(`/api/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .send({ visibility: 'WORKSPACE' })
      .expect(200);

    const res = await getBoard(wsAdmin, board.id);
    expect(res.status).toBe(200);
    expect(res.body.data.board.isOwner).toBe(false);
    expect(res.body.data.board.canManage).toBe(true);
  });

  it('MEMBER khong gian -> canManage = false', async () => {
    const owner = await makeUser();
    const wsMember = await makeUser();
    const ws = await makeWorkspace(owner);
    await addWorkspaceMember(owner, ws.id, wsMember.email, 'MEMBER');

    const board = await makeBoard(owner, { workspaceId: ws.id });
    await agent()
      .patch(`/api/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .send({ visibility: 'WORKSPACE' })
      .expect(200);

    const res = await getBoard(wsMember, board.id);
    expect(res.status).toBe(200);
    expect(res.body.data.board.canManage).toBe(false);
  });

  it('chu bang -> canManage = true', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const res = await getBoard(owner, board.id);
    expect(res.body.data.board.canManage).toBe(true);
  });

  // Van de moi #6: bang PUBLIC + ADMIN khong gian CHUA la thanh vien truc
  // tiep cua bang -> canEdit=false (khong sua duoc noi dung the) nhung
  // canManage=true (van quan ly duoc thanh vien/hien thi). Frontend phai
  // hien BoardMembers trong truong hop nay du readOnly=true.
  it('bang PUBLIC + ADMIN khong gian (chua la thanh vien bang) -> canEdit=false nhung canManage=true', async () => {
    const owner = await makeUser();
    const wsAdmin = await makeUser();
    const ws = await makeWorkspace(owner);
    await addWorkspaceMember(owner, ws.id, wsAdmin.email, 'ADMIN');

    const board = await makeBoard(owner, { workspaceId: ws.id });
    await agent()
      .patch(`/api/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .send({ visibility: 'PUBLIC' })
      .expect(200);

    const res = await getBoard(wsAdmin, board.id);
    expect(res.status).toBe(200);
    expect(res.body.data.board.canEdit).toBe(false);
    expect(res.body.data.board.canManage).toBe(true);
  });
});
