import { describe, expect, it } from 'vitest';
import {
  addMember,
  addWorkspaceMember,
  agent,
  makeBoard,
  makeCard,
  makeList,
  makeUser,
  makeWorkspace,
} from './helpers';

// Van de: khong gian can trang tong quan tong hop the tu nhieu bang,
// tinh so lieu quá han / chưa giao, loc theo nguoi phu trach.
describe('GET /api/workspaces/:id/overview', () => {
  it('gom the tu nhieu bang trong khong gian, tinh dung so lieu', async () => {
    const owner = await makeUser();
    const ws = await makeWorkspace(owner);
    const board1 = await makeBoard(owner, { workspaceId: ws.id });
    const board2 = await makeBoard(owner, { workspaceId: ws.id });
    const list1 = await makeList(owner, board1.id);
    const list2 = await makeList(owner, board2.id);

    const overdueCard = await makeCard(owner, list1.id, 'The qua han');
    await agent()
      .patch(`/api/cards/${overdueCard.id}`)
      .set('Cookie', owner.cookie)
      .send({ dueDate: '2020-01-01T00:00:00.000Z' });

    const doneCard = await makeCard(owner, list2.id, 'The da xong');
    await agent()
      .patch(`/api/cards/${doneCard.id}`)
      .set('Cookie', owner.cookie)
      .send({ isDone: true });

    await makeCard(owner, list1.id, 'The chua giao');

    const res = await agent()
      .get(`/api/workspaces/${ws.id}/overview`)
      .set('Cookie', owner.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.stats.total).toBe(3);
    expect(res.body.data.stats.done).toBe(1);
    expect(res.body.data.stats.overdue).toBe(1);
    expect(res.body.data.stats.unassigned).toBe(3);
    expect(res.body.data.boards).toHaveLength(2);
  });

  it('loc theo nguoi phu trach', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const ws = await makeWorkspace(owner);
    await addWorkspaceMember(owner, ws.id, member.email);
    const board = await makeBoard(owner, { workspaceId: ws.id });
    await addMember(owner, board.id, member.email);
    const list = await makeList(owner, board.id);

    const assignedCard = await makeCard(owner, list.id, 'The da giao');
    await agent()
      .post(`/api/cards/${assignedCard.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: member.id });
    await makeCard(owner, list.id, 'The khac');

    const res = await agent()
      .get(`/api/workspaces/${ws.id}/overview?assigneeId=${member.id}`)
      .set('Cookie', owner.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.cards).toHaveLength(1);
    expect(res.body.data.cards[0].id).toBe(assignedCard.id);
    expect(res.body.data.stats.total).toBe(1);
    expect(res.body.data.stats.unassigned).toBe(0);

    // Selecting "unassigned" must not discard the assignee filter and expose unrelated cards.
    const unassigned = await agent()
      .get(`/api/workspaces/${ws.id}/overview?assigneeId=${member.id}&status=unassigned`)
      .set('Cookie', owner.cookie);
    expect(unassigned.status).toBe(200);
    expect(unassigned.body.data.cards).toEqual([]);
    expect(unassigned.body.data.stats.unassigned).toBe(0);
  });

  it('nguoi khong thuoc khong gian bi tu choi -> 403', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const ws = await makeWorkspace(owner);

    const res = await agent()
      .get(`/api/workspaces/${ws.id}/overview`)
      .set('Cookie', outsider.cookie);

    expect(res.status).toBe(403);
  });
});
