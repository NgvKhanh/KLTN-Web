import { describe, expect, it } from 'vitest';
import {
  addWorkspaceMember,
  agent,
  makeBoard,
  makeCard,
  makeList,
  makeUser,
  makeWorkspace,
} from './helpers';

describe('Mau bang do nguoi dung tu luu', () => {
  it('luu bang dang co thanh mau -> chup dung list + the', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner, { name: 'Bang goc' });
    const list = await makeList(owner, board.id, 'Danh sach A');
    await makeCard(owner, list.id, 'The 1');

    const res = await agent()
      .post(`/api/boards/${board.id}/save-as-template`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Mau cua toi' });
    expect(res.status).toBe(201);
    expect(res.body.data.template.name).toBe('Mau cua toi');
    expect(res.body.data.template.lists).toHaveLength(1);
    expect(res.body.data.template.lists[0].cards[0].title).toBe('The 1');

    const listRes = await agent()
      .get(`/api/workspaces/${board.workspaceId}/board-templates`)
      .set('Cookie', owner.cookie);
    expect(listRes.body.data.templates).toHaveLength(1);
  });

  it('nguoi ngoai bang khong luu duoc mau -> 403', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const outsider = await makeUser();

    const res = await agent()
      .post(`/api/boards/${board.id}/save-as-template`)
      .set('Cookie', outsider.cookie)
      .send({});
    expect(res.status).toBe(403);
  });

  it('tao bang moi tu mau da luu -> co dung list + the', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner, { name: 'Bang goc' });
    const list = await makeList(owner, board.id, 'Todo');
    await makeCard(owner, list.id, 'Viec A');

    const tplRes = await agent()
      .post(`/api/boards/${board.id}/save-as-template`)
      .set('Cookie', owner.cookie)
      .send({});
    const templateId = tplRes.body.data.template.id as string;

    const newBoardRes = await agent()
      .post('/api/boards/from-saved-template')
      .set('Cookie', owner.cookie)
      .send({ workspaceId: board.workspaceId, templateId, name: 'Bang moi tu mau' });
    expect(newBoardRes.status).toBe(201);
    const newBoardId = newBoardRes.body.data.board.id as string;

    const listsRes = await agent()
      .get(`/api/boards/${newBoardId}/lists`)
      .set('Cookie', owner.cookie);
    expect(listsRes.body.data.lists).toHaveLength(1);
    expect(listsRes.body.data.lists[0].name).toBe('Todo');
    expect(listsRes.body.data.lists[0].cards[0].title).toBe('Viec A');
  });

  it('thanh vien thuong (MEMBER) khong xoa duoc mau cua nguoi khac', async () => {
    const owner = await makeUser();
    const ws = await makeWorkspace(owner);
    const board = await makeBoard(owner, { workspaceId: ws.id });
    const tplRes = await agent()
      .post(`/api/boards/${board.id}/save-as-template`)
      .set('Cookie', owner.cookie)
      .send({});
    const templateId = tplRes.body.data.template.id as string;

    const member = await makeUser();
    await addWorkspaceMember(owner, ws.id, member.email, 'MEMBER');

    const delRes = await agent()
      .delete(`/api/boards/templates/${templateId}`)
      .set('Cookie', member.cookie);
    expect(delRes.status).toBe(403);

    const okRes = await agent()
      .delete(`/api/boards/templates/${templateId}`)
      .set('Cookie', owner.cookie);
    expect(okRes.status).toBe(200);
  });
});
