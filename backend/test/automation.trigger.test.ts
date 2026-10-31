import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { addMember, agent, makeBoard, makeCard, makeList, makeUser } from './helpers';

async function createRule(
  owner: Awaited<ReturnType<typeof makeUser>>,
  boardId: string,
  body: Record<string, unknown>
) {
  const res = await agent()
    .post(`/api/boards/${boardId}/automation-rules`)
    .set('Cookie', owner.cookie)
    .send(body);
  expect(res.status).toBe(201);
  return res.body.data.rule as { id: string };
}

describe('Tu dong hoa - CARD_CREATED', () => {
  it('tao the trong dung danh sach -> chay SET_DONE, danh sach khac khong chay', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const targetList = await makeList(owner, board.id, 'Hoan thanh ngay');
    const otherList = await makeList(owner, board.id, 'Khac');

    await createRule(owner, board.id, {
      name: 'Tao trong Hoan thanh ngay -> danh dau xong',
      triggerType: 'CARD_CREATED',
      triggerListId: targetList.id,
      actions: [{ type: 'SET_DONE', boolValue: true }],
    });

    const cardIn = await makeCard(owner, targetList.id, 'The trong list dich');
    const cardOut = await makeCard(owner, otherList.id, 'The o list khac');

    const rowIn = await prisma.card.findUnique({ where: { id: cardIn.id } });
    const rowOut = await prisma.card.findUnique({ where: { id: cardOut.id } });
    expect(rowIn?.isDone).toBe(true);
    expect(rowOut?.isDone).toBe(false);
  });

  it('luat khong gioi han danh sach (triggerListId = null) -> chay cho moi danh sach', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list1 = await makeList(owner, board.id, 'List 1');
    const list2 = await makeList(owner, board.id, 'List 2');

    const labelRes = await agent()
      .post(`/api/boards/${board.id}/labels`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Moi', color: '#00ff00' });
    const labelId = labelRes.body.data.label.id as string;

    await createRule(owner, board.id, {
      name: 'The moi o bat ky dau -> gan nhan Moi',
      triggerType: 'CARD_CREATED',
      actions: [{ type: 'ADD_LABEL', labelId }],
    });

    const card1 = await makeCard(owner, list1.id);
    const card2 = await makeCard(owner, list2.id);

    const labels1 = await prisma.cardLabel.findMany({ where: { cardId: card1.id } });
    const labels2 = await prisma.cardLabel.findMany({ where: { cardId: card2.id } });
    expect(labels1.map((l) => l.labelId)).toEqual([labelId]);
    expect(labels2.map((l) => l.labelId)).toEqual([labelId]);
  });

  it('luat da tat (isEnabled=false) -> khong chay', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);

    const rule = await createRule(owner, board.id, {
      name: 'Tam tat',
      triggerType: 'CARD_CREATED',
      actions: [{ type: 'SET_DONE' }],
    });
    await agent()
      .patch(`/api/automation-rules/${rule.id}`)
      .set('Cookie', owner.cookie)
      .send({ isEnabled: false })
      .expect(200);

    const card = await makeCard(owner, list.id);
    const row = await prisma.card.findUnique({ where: { id: card.id } });
    expect(row?.isDone).toBe(false);
  });
});

describe('Tu dong hoa - CARD_MOVED_TO_LIST', () => {
  it('chuyen the vao dung danh sach -> gan thanh vien tu dong; chuyen sang danh sach khac thi khong', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const board = await makeBoard(owner);
    await addMember(owner, board.id, member.email);
    const inbox = await makeList(owner, board.id, 'Inbox');
    const target = await makeList(owner, board.id, 'Dang xu ly');
    const other = await makeList(owner, board.id, 'Khac');

    await createRule(owner, board.id, {
      name: 'Vao Dang xu ly -> gan nguoi',
      triggerType: 'CARD_MOVED_TO_LIST',
      triggerListId: target.id,
      actions: [{ type: 'ASSIGN_MEMBER', userId: member.id }],
    });

    const card = await makeCard(owner, inbox.id);
    await agent()
      .patch(`/api/cards/${card.id}/move`)
      .set('Cookie', owner.cookie)
      .send({ listId: other.id, position: 0 })
      .expect(200);
    let members = await prisma.cardMember.findMany({ where: { cardId: card.id } });
    expect(members).toHaveLength(0);

    await agent()
      .patch(`/api/cards/${card.id}/move`)
      .set('Cookie', owner.cookie)
      .send({ listId: target.id, position: 0 })
      .expect(200);
    members = await prisma.cardMember.findMany({ where: { cardId: card.id } });
    expect(members.map((m) => m.userId)).toEqual([member.id]);
  });

  it('nguoi duoc gan da bi xoa khoi bang truoc khi chuyen the -> bo qua an toan, khong loi', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const board = await makeBoard(owner);
    await addMember(owner, board.id, member.email);
    const inbox = await makeList(owner, board.id, 'Inbox');
    const target = await makeList(owner, board.id, 'Dang xu ly');

    await createRule(owner, board.id, {
      name: 'Vao Dang xu ly -> gan nguoi',
      triggerType: 'CARD_MOVED_TO_LIST',
      triggerListId: target.id,
      actions: [{ type: 'ASSIGN_MEMBER', userId: member.id }],
    });

    await agent()
      .delete(`/api/boards/${board.id}/members/${member.id}`)
      .set('Cookie', owner.cookie)
      .expect(200);

    const card = await makeCard(owner, inbox.id);
    const res = await agent()
      .patch(`/api/cards/${card.id}/move`)
      .set('Cookie', owner.cookie)
      .send({ listId: target.id, position: 0 });
    expect(res.status).toBe(200);

    const members = await prisma.cardMember.findMany({ where: { cardId: card.id } });
    expect(members).toHaveLength(0);
  });

  // CODE_REVIEW.md #8: chuyen HANG LOAT (move-all-cards) truoc day khong chay
  // CARD_MOVED_TO_LIST cho tung the, khac voi chuyen tung the mot.
  it('chuyen HANG LOAT ca danh sach vao dung danh sach dich -> automation van chay cho tung the', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const inbox = await makeList(owner, board.id, 'Inbox');
    const target = await makeList(owner, board.id, 'Hoan thanh ngay');

    await createRule(owner, board.id, {
      name: 'Vao Hoan thanh ngay -> danh dau xong',
      triggerType: 'CARD_MOVED_TO_LIST',
      triggerListId: target.id,
      actions: [{ type: 'SET_DONE', boolValue: true }],
    });

    const card1 = await makeCard(owner, inbox.id, 'The 1');
    const card2 = await makeCard(owner, inbox.id, 'The 2');

    await agent()
      .post(`/api/lists/${inbox.id}/move-all-cards`)
      .set('Cookie', owner.cookie)
      .send({ targetListId: target.id })
      .expect(200);

    const row1 = await prisma.card.findUnique({ where: { id: card1.id } });
    const row2 = await prisma.card.findUnique({ where: { id: card2.id } });
    expect(row1?.isDone).toBe(true);
    expect(row2?.isDone).toBe(true);
  });
});
