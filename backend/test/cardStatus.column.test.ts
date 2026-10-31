import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { agent, makeBoard, makeCard, makeDirectUser, type TestUser } from './helpers';

type Status = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | 'BLOCKED';

// Tao cot voi trang thai CHI DINH (null = cot tu do), khong phu thuoc vao viec doan ten
async function makeStatusList(user: TestUser, boardId: string, name: string, status: Status | null) {
  const res = await agent()
    .post(`/api/boards/${boardId}/lists`)
    .set('Cookie', user.cookie)
    .send({ name, status });
  expect(res.status).toBe(201);
  return res.body.data.list as { id: string; status: Status | null };
}

async function moveCard(user: TestUser, cardId: string, listId: string, position = 0) {
  const res = await agent()
    .patch(`/api/cards/${cardId}/move`)
    .set('Cookie', user.cookie)
    .send({ listId, position });
  expect(res.status).toBe(200);
}

const row = (id: string) =>
  prisma.card.findUniqueOrThrow({
    where: { id },
    select: { status: true, isDone: true, completedAt: true },
  });

const activityTypes = async (cardId: string) =>
  (
    await prisma.activity.findMany({
      where: { cardId },
      orderBy: { createdAt: 'asc' },
      select: { type: true, data: true },
    })
  ).map((a) => ({ type: a.type, data: a.data }));

describe('Tao cot - doan trang thai theo ten', () => {
  it('khong gui status -> doan theo ten; gui status (ke ca null) -> dung dung gia tri gui', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);

    const guessed = await agent()
      .post(`/api/boards/${board.id}/lists`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Hoàn thành' });
    expect(guessed.body.data.list.status).toBe('DONE');

    const free = await agent()
      .post(`/api/boards/${board.id}/lists`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Ý tưởng' });
    expect(free.body.data.list.status).toBeNull();

    const forcedNull = await makeStatusList(owner, board.id, 'Hoàn thành', null);
    expect(forcedNull.status).toBeNull();

    const bad = await agent()
      .post(`/api/boards/${board.id}/lists`)
      .set('Cookie', owner.cookie)
      .send({ name: 'X', status: 'KHONG_CO' });
    expect(bad.status).toBe(400);
  });

  it('the moi tao trong cot DONE -> da xong ngay; cot tu do -> TODO', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const done = await makeStatusList(owner, board.id, 'Xong', 'DONE');
    const free = await makeStatusList(owner, board.id, 'Khac', null);

    const c1 = await makeCard(owner, done.id);
    const c2 = await makeCard(owner, free.id);
    const r1 = await row(c1.id);
    expect(r1.status).toBe('DONE');
    expect(r1.isDone).toBe(true);
    expect(r1.completedAt).not.toBeNull();
    expect(await row(c2.id)).toEqual({ status: 'TODO', isDone: false, completedAt: null });
  });
});

describe('Keo tha - the doi trang thai theo cot', () => {
  it('vao DONE -> xong + completedAt; ra cot IN_PROGRESS -> mo lai; nhat ky dung loai', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const todo = await makeStatusList(owner, board.id, 'Can lam', 'TODO');
    const doing = await makeStatusList(owner, board.id, 'Dang lam', 'IN_PROGRESS');
    const done = await makeStatusList(owner, board.id, 'Xong', 'DONE');
    const card = await makeCard(owner, todo.id);

    await moveCard(owner, card.id, doing.id);
    expect(await row(card.id)).toEqual({ status: 'IN_PROGRESS', isDone: false, completedAt: null });

    await moveCard(owner, card.id, done.id);
    const afterDone = await row(card.id);
    expect(afterDone.status).toBe('DONE');
    expect(afterDone.isDone).toBe(true);
    expect(afterDone.completedAt).not.toBeNull();

    await moveCard(owner, card.id, doing.id);
    expect(await row(card.id)).toEqual({ status: 'IN_PROGRESS', isDone: false, completedAt: null });

    const types = (await activityTypes(card.id)).map((a) => a.type);
    expect(types).toEqual([
      'card.create',
      'card.move',
      'card.status',
      'card.move',
      'card.done',
      'card.move',
      'card.undone',
    ]);
    const statusLog = (await activityTypes(card.id)).find((a) => a.type === 'card.status');
    expect(statusLog?.data).toEqual({ from: 'TODO', to: 'IN_PROGRESS' });
  });

  it('keo sang cot tu do -> giu nguyen trang thai', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const done = await makeStatusList(owner, board.id, 'Xong', 'DONE');
    const free = await makeStatusList(owner, board.id, 'Khac', null);
    const card = await makeCard(owner, done.id);
    const before = await row(card.id);

    await moveCard(owner, card.id, free.id);
    expect(await row(card.id)).toEqual(before);
  });

  it('keo giua 2 cot DONE -> KHONG ghi de completedAt, khong ghi nhat ky trang thai', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const done1 = await makeStatusList(owner, board.id, 'Xong 1', 'DONE');
    const done2 = await makeStatusList(owner, board.id, 'Xong 2', 'DONE');
    const card = await makeCard(owner, done1.id);
    const before = await row(card.id);

    await moveCard(owner, card.id, done2.id);
    expect((await row(card.id)).completedAt?.getTime()).toBe(before.completedAt?.getTime());
    const types = (await activityTypes(card.id)).map((a) => a.type);
    expect(types).toEqual(['card.create', 'card.move']);
  });

  it('keo doi cho trong CUNG cot -> khong dong den trang thai da doi tay', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const doing = await makeStatusList(owner, board.id, 'Dang lam', 'IN_PROGRESS');
    const card = await makeCard(owner, doing.id);
    await makeCard(owner, doing.id);
    // Gia lap the da doi tay sang BLOCKED (buoc 3 moi co API)
    await prisma.card.update({ where: { id: card.id }, data: { status: 'BLOCKED' } });

    await moveCard(owner, card.id, doing.id, 1);
    expect((await row(card.id)).status).toBe('BLOCKED');
  });

  it('chuyen xuyen bang -> theo trang thai cot o bang dich', async () => {
    const owner = await makeDirectUser();
    const b1 = await makeBoard(owner);
    const b2 = await makeBoard(owner);
    const src = await makeStatusList(owner, b1.id, 'Can lam', 'TODO');
    const dst = await makeStatusList(owner, b2.id, 'Cho duyet', 'IN_REVIEW');
    const card = await makeCard(owner, src.id);

    await moveCard(owner, card.id, dst.id);
    expect((await row(card.id)).status).toBe('IN_REVIEW');
  });
});

describe('Doi trang thai cot', () => {
  it('gan trang thai -> moi the dang hoat dong doi theo, the luu tru khong doi; khoi phuc thi theo cot', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const list = await makeStatusList(owner, board.id, 'Cot', null);
    const a = await makeCard(owner, list.id, 'A');
    const b = await makeCard(owner, list.id, 'B');
    const archived = await makeCard(owner, list.id, 'C');
    await agent().post(`/api/cards/${archived.id}/archive`).set('Cookie', owner.cookie).expect(200);

    const res = await agent()
      .patch(`/api/lists/${list.id}`)
      .set('Cookie', owner.cookie)
      .send({ status: 'DONE' });
    expect(res.status).toBe(200);
    expect(res.body.data.list.status).toBe('DONE');

    for (const c of [a, b]) {
      const r = await row(c.id);
      expect(r.status).toBe('DONE');
      expect(r.isDone).toBe(true);
      expect(r.completedAt).not.toBeNull();
    }
    expect((await row(archived.id)).status).toBe('TODO');
    expect((await activityTypes(a.id)).map((x) => x.type)).toContain('card.done');

    await agent().post(`/api/cards/${archived.id}/restore`).set('Cookie', owner.cookie).expect(200);
    const restored = await row(archived.id);
    expect(restored.status).toBe('DONE');
    expect(restored.isDone).toBe(true);
  });

  it('bo trang thai cot (null) -> the giu nguyen', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const list = await makeStatusList(owner, board.id, 'Dang lam', 'IN_PROGRESS');
    const card = await makeCard(owner, list.id);

    await agent()
      .patch(`/api/lists/${list.id}`)
      .set('Cookie', owner.cookie)
      .send({ status: null })
      .expect(200);
    const l = await prisma.list.findUniqueOrThrow({ where: { id: list.id } });
    expect(l.status).toBeNull();
    expect((await row(card.id)).status).toBe('IN_PROGRESS');
  });
});

describe('Chuyen tat ca / sao chep / mau bang', () => {
  it('chuyen tat ca the sang cot co trang thai -> tat ca doi theo', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const src = await makeStatusList(owner, board.id, 'Can lam', 'TODO');
    const dst = await makeStatusList(owner, board.id, 'Xong', 'DONE');
    const a = await makeCard(owner, src.id);
    const b = await makeCard(owner, src.id);

    await agent()
      .post(`/api/lists/${src.id}/move-all-cards`)
      .set('Cookie', owner.cookie)
      .send({ targetListId: dst.id })
      .expect(200);
    for (const c of [a, b]) {
      const r = await row(c.id);
      expect(r).toMatchObject({ status: 'DONE', isDone: true });
      expect(r.completedAt).not.toBeNull();
    }
  });

  it('sao chep cot -> giu trang thai cot va ca 3 cot trang thai cua the', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const done = await makeStatusList(owner, board.id, 'Xong', 'DONE');
    await makeCard(owner, done.id);

    const res = await agent().post(`/api/lists/${done.id}/copy`).set('Cookie', owner.cookie);
    expect(res.status).toBe(201);
    expect(res.body.data.list.status).toBe('DONE');
    const copied = await prisma.card.findFirstOrThrow({ where: { listId: res.body.data.list.id } });
    expect(copied.status).toBe('DONE');
    expect(copied.isDone).toBe(true);
    expect(copied.completedAt).not.toBeNull();
  });

  it('sao chep the sang cot khac -> the moi theo trang thai cot dich', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    const todo = await makeStatusList(owner, board.id, 'Can lam', 'TODO');
    const review = await makeStatusList(owner, board.id, 'Cho duyet', 'IN_REVIEW');
    const card = await makeCard(owner, todo.id);

    const res = await agent()
      .post(`/api/cards/${card.id}/copy`)
      .set('Cookie', owner.cookie)
      .send({ listId: review.id });
    expect(res.status).toBe(201);
    expect((await row(res.body.data.card.id)).status).toBe('IN_REVIEW');
  });

  it('tao bang tu mau Kanban -> cot co san trang thai, the mau theo cot', async () => {
    const owner = await makeDirectUser();
    const res = await agent()
      .post('/api/boards/from-template')
      .set('Cookie', owner.cookie)
      .send({ templateId: 'kanban', workspaceId: owner.personalWorkspaceId });
    expect(res.status).toBe(201);
    const lists = await prisma.list.findMany({
      where: { boardId: res.body.data.board.id },
      orderBy: { position: 'asc' },
      include: { cards: { select: { status: true } } },
    });
    expect(lists.map((l) => l.status)).toEqual(['TODO', 'IN_PROGRESS', 'DONE']);
    expect(lists[1]!.cards.map((c) => c.status)).toEqual(['IN_PROGRESS']);
  });

  it('luu bang thanh mau roi tao lai -> giu trang thai tung cot', async () => {
    const owner = await makeDirectUser();
    const board = await makeBoard(owner);
    await makeStatusList(owner, board.id, 'Viec', 'TODO');
    await makeStatusList(owner, board.id, 'Tu do', null);
    await makeStatusList(owner, board.id, 'Xong', 'DONE');

    const saved = await agent()
      .post(`/api/boards/${board.id}/save-as-template`)
      .set('Cookie', owner.cookie)
      .send({});
    expect([200, 201]).toContain(saved.status);
    const tpl = await prisma.boardTemplate.findFirstOrThrow({ where: { workspaceId: owner.personalWorkspaceId } });

    const created = await agent()
      .post('/api/boards/from-saved-template')
      .set('Cookie', owner.cookie)
      .send({ templateId: tpl.id, workspaceId: owner.personalWorkspaceId });
    expect(created.status).toBe(201);
    const lists = await prisma.list.findMany({
      where: { boardId: created.body.data.board.id },
      orderBy: { position: 'asc' },
    });
    expect(lists.map((l) => l.status)).toEqual(['TODO', null, 'DONE']);
  });
});
