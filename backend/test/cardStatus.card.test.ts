import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { agent, makeBoard, makeCard, makeDirectUser, type TestUser } from './helpers';

// Chieu the -> cot: doi tay trang thai the (dropdown / tick hoan thanh) thi the tu
// chuyen sang cot mang trang thai do, neu the dang o cot co trang thai va bang co cot phu hop.

type Status = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | 'BLOCKED';

async function makeStatusList(user: TestUser, boardId: string, name: string, status: Status | null) {
  const res = await agent()
    .post(`/api/boards/${boardId}/lists`)
    .set('Cookie', user.cookie)
    .send({ name, status });
  expect(res.status).toBe(201);
  return res.body.data.list as { id: string };
}

function patchCard(user: TestUser, cardId: string, body: Record<string, unknown>) {
  return agent().patch(`/api/cards/${cardId}`).set('Cookie', user.cookie).send(body);
}

const row = (id: string) =>
  prisma.card.findUniqueOrThrow({
    where: { id },
    select: { listId: true, status: true, isDone: true, completedAt: true, position: true },
  });

const types = async (cardId: string) =>
  (
    await prisma.activity.findMany({ where: { cardId }, orderBy: { createdAt: 'asc' }, select: { type: true } })
  ).map((a) => a.type);

describe('Doi tay trang thai the -> nhay cot', () => {
  it('tick hoan thanh o cot "Dang lam" -> sang dau cot DONE dau tien; response tra ve listId moi', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const doing = await makeStatusList(owner, board.id, 'Dang lam', 'IN_PROGRESS');
    const done1 = await makeStatusList(owner, board.id, 'Xong', 'DONE');
    await makeStatusList(owner, board.id, 'Xong 2', 'DONE');
    const old = await makeCard(owner, done1.id, 'The cu trong Xong');
    const card = await makeCard(owner, doing.id);

    const res = await patchCard(owner, card.id, { isDone: true });
    expect(res.status).toBe(200);
    expect(res.body.data.card.listId).toBe(done1.id);

    const r = await row(card.id);
    expect(r).toMatchObject({ listId: done1.id, status: 'DONE', isDone: true, position: 0 });
    expect(r.completedAt).not.toBeNull();
    expect((await row(old.id)).position).toBe(1);
    expect(await types(card.id)).toEqual(['card.create', 'card.move', 'card.done']);
  });

  it('bo tick trong cot DONE -> ve cot TODO dau tien', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const todo = await makeStatusList(owner, board.id, 'Can lam', 'TODO');
    const done = await makeStatusList(owner, board.id, 'Xong', 'DONE');
    const card = await makeCard(owner, done.id);

    const res = await patchCard(owner, card.id, { isDone: false });
    expect(res.status).toBe(200);
    expect(await row(card.id)).toMatchObject({ listId: todo.id, status: 'TODO', isDone: false, completedAt: null });
  });

  it('dropdown trang thai "Cho duyet" -> sang cot IN_REVIEW', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const todo = await makeStatusList(owner, board.id, 'Can lam', 'TODO');
    const review = await makeStatusList(owner, board.id, 'Kiem thu', 'IN_REVIEW');
    const card = await makeCard(owner, todo.id);

    await patchCard(owner, card.id, { status: 'IN_REVIEW' }).expect(200);
    expect(await row(card.id)).toMatchObject({ listId: review.id, status: 'IN_REVIEW' });
  });

  it('bang khong co cot mang trang thai moi -> chi doi nhan, the dung yen', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const doing = await makeStatusList(owner, board.id, 'Dang lam', 'IN_PROGRESS');
    const card = await makeCard(owner, doing.id);

    await patchCard(owner, card.id, { status: 'BLOCKED' }).expect(200);
    expect(await row(card.id)).toMatchObject({ listId: doing.id, status: 'BLOCKED' });
    expect(await types(card.id)).toEqual(['card.create', 'card.status']);

    // Bang khong co cot DONE: tick xong van duoc, the o yen
    await patchCard(owner, card.id, { isDone: true }).expect(200);
    const r = await row(card.id);
    expect(r).toMatchObject({ listId: doing.id, status: 'DONE', isDone: true });
    expect(r.completedAt).not.toBeNull();
  });

  it('the o cot tu do -> KHONG di chuyen du bang co cot DONE (hanh vi nhu truoc day)', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const free = await makeStatusList(owner, board.id, 'Tu do', null);
    await makeStatusList(owner, board.id, 'Xong', 'DONE');
    const card = await makeCard(owner, free.id);

    await patchCard(owner, card.id, { isDone: true }).expect(200);
    expect(await row(card.id)).toMatchObject({ listId: free.id, status: 'DONE', isDone: true });

    // Bo tick o cot tu do -> ve TODO, van o yen
    await patchCard(owner, card.id, { isDone: false }).expect(200);
    expect(await row(card.id)).toMatchObject({ listId: free.id, status: 'TODO', isDone: false, completedAt: null });
  });

  it('doi ve dung trang thai cua cot dang dung -> khong di chuyen (vd BLOCKED -> IN_PROGRESS trong cot Dang lam)', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    await makeStatusList(owner, board.id, 'Dang lam 0', 'IN_PROGRESS');
    const doing = await makeStatusList(owner, board.id, 'Dang lam', 'IN_PROGRESS');
    const card = await makeCard(owner, doing.id);
    await patchCard(owner, card.id, { status: 'BLOCKED' }).expect(200);

    await patchCard(owner, card.id, { status: 'IN_PROGRESS' }).expect(200);
    expect(await row(card.id)).toMatchObject({ listId: doing.id, status: 'IN_PROGRESS' });
  });

  it('gui lai dung trang thai hien tai -> khong ghi nhat ky, khong troi completedAt', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const done = await makeStatusList(owner, board.id, 'Xong', 'DONE');
    const card = await makeCard(owner, done.id);
    const before = await row(card.id);

    await patchCard(owner, card.id, { status: 'DONE', title: 'Doi ten' }).expect(200);
    const after = await row(card.id);
    expect(after.completedAt?.getTime()).toBe(before.completedAt?.getTime());
    expect(await types(card.id)).toEqual(['card.create', 'card.rename']);
  });

  it('status + isDone mau thuan -> 400; status sai -> 400', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const list = await makeStatusList(owner, board.id, 'Cot', null);
    const card = await makeCard(owner, list.id);

    expect((await patchCard(owner, card.id, { status: 'IN_PROGRESS', isDone: true })).status).toBe(400);
    expect((await patchCard(owner, card.id, { status: 'LAM_XONG' })).status).toBe(400);
    // Khop nhau thi hop le
    expect((await patchCard(owner, card.id, { status: 'DONE', isDone: true })).status).toBe(200);
  });
});

describe('Tu dong hoa SET_DONE di qua trang thai, khong di chuyen the', () => {
  it('luat "chuyen vao cot X -> danh dau xong": the o yen trong X, trang thai DONE', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const todo = await makeStatusList(owner, board.id, 'Can lam', 'TODO');
    const qa = await makeStatusList(owner, board.id, 'QA noi bo', null);
    await makeStatusList(owner, board.id, 'Xong', 'DONE');

    await agent()
      .post(`/api/boards/${board.id}/automation-rules`)
      .set('Cookie', owner.cookie)
      .send({
        name: 'Vao QA -> xong',
        triggerType: 'CARD_MOVED_TO_LIST',
        triggerListId: qa.id,
        actions: [{ type: 'SET_DONE', boolValue: true }],
      })
      .expect(201);

    const card = await makeCard(owner, todo.id);
    await agent()
      .patch(`/api/cards/${card.id}/move`)
      .set('Cookie', owner.cookie)
      .send({ listId: qa.id, position: 0 })
      .expect(200);

    const r = await row(card.id);
    expect(r).toMatchObject({ listId: qa.id, status: 'DONE', isDone: true });
    expect(r.completedAt).not.toBeNull();
  });

  it('luat bo danh dau xong (cot tu do) -> mo lai ve TODO, the o yen trong cot dich', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const free1 = await makeStatusList(owner, board.id, 'Tu do 1', null);
    const free2 = await makeStatusList(owner, board.id, 'Lam lai', null);
    await makeStatusList(owner, board.id, 'Can lam', 'TODO');

    await agent()
      .post(`/api/boards/${board.id}/automation-rules`)
      .set('Cookie', owner.cookie)
      .send({
        name: 'Vao Lam lai -> bo danh dau xong',
        triggerType: 'CARD_MOVED_TO_LIST',
        triggerListId: free2.id,
        actions: [{ type: 'SET_DONE', boolValue: false }],
      })
      .expect(201);

    const card = await makeCard(owner, free1.id);
    await patchCard(owner, card.id, { isDone: true }).expect(200);
    await agent()
      .patch(`/api/cards/${card.id}/move`)
      .set('Cookie', owner.cookie)
      .send({ listId: free2.id, position: 0 })
      .expect(200);

    expect(await row(card.id)).toMatchObject({ listId: free2.id, status: 'TODO', isDone: false, completedAt: null });
    expect(await types(card.id)).toEqual(['card.create', 'card.done', 'card.move', 'card.undone']);
  });
});
