// Module canh bao nguy co tre han - buoc 1 (RISK_MODULE.md §9): nen du lieu.
//  - Card.storyPoints: chi nhan 1, 2, 3, 5, 8 hoac null; sao chep the giu nguyen.
//  - ChecklistItem.completedAt: bat bien isDone <-> completedAt != null tren MOI duong ghi (API giao dien, chatbot tick,
//    sao chep the qua giao dien va qua chatbot). Gui lai dung trang thai dang co thi giu nguyen moc cu.
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { handleV2Message } from '../src/modules/chat/v2/chat.v2.service';
import type { V2Reply } from '../src/modules/chat/v2/chat.v2.contract';
import { actionContext, propose, script, seedActions, text, type ActionWorld } from './chat.actions.fixture';
import { agent, makeBoard, makeCard, makeList, makeUser, type TestUser } from './helpers';

async function cardWithChecklist(owner: TestUser) {
  const board = await makeBoard(owner);
  const list = await makeList(owner, board.id);
  const card = await makeCard(owner, list.id);
  const cl = await agent()
    .post(`/api/cards/${card.id}/checklists`)
    .set('Cookie', owner.cookie)
    .send({ title: 'Kiểm' })
    .expect(201);
  const item = await agent()
    .post(`/api/checklists/${cl.body.data.checklist.id}/items`)
    .set('Cookie', owner.cookie)
    .send({ content: 'việc một' })
    .expect(201);
  return { board, list, card, itemId: item.body.data.item.id as string };
}

const tick = (owner: TestUser, itemId: string, isDone: boolean) =>
  agent().patch(`/api/checklist-items/${itemId}`).set('Cookie', owner.cookie).send({ isDone }).expect(200);

const itemRow = (id: string) => prisma.checklistItem.findUniqueOrThrow({ where: { id } });

describe('Card.storyPoints', () => {
  it('nhận 1/2/3/5/8 và null; từ chối 4, 0, 13, số lẻ, chuỗi', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    const patch = (storyPoints: unknown) =>
      agent().patch(`/api/cards/${card.id}`).set('Cookie', owner.cookie).send({ storyPoints });

    for (const ok of [1, 2, 3, 5, 8]) {
      const res = await patch(ok);
      expect(res.status).toBe(200);
      expect((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).storyPoints).toBe(ok);
    }
    for (const bad of [4, 0, 13, 2.5, '5', -1]) {
      const res = await patch(bad);
      expect(res.status, `giá trị ${JSON.stringify(bad)}`).toBe(400);
    }
    expect((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).storyPoints).toBe(8);

    expect((await patch(null)).status).toBe(200);
    expect((await prisma.card.findUniqueOrThrow({ where: { id: card.id } })).storyPoints).toBeNull();
  });

  it('chỉ gửi storyPoints (không kèm trường khác) là một lần cập nhật hợp lệ, không đụng hạn / tiêu đề', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id, 'Giữ nguyên tên');
    await agent().patch(`/api/cards/${card.id}`).set('Cookie', owner.cookie).send({ storyPoints: 3 }).expect(200);
    const row = await prisma.card.findUniqueOrThrow({ where: { id: card.id } });
    expect(row.title).toBe('Giữ nguyên tên');
    expect(row.dueDate).toBeNull();
    // Doi do phuc tap KHONG ghi nhat ky (khong phai "hoat dong" theo §5.3 (10), va giao dien khong co cau hien thi)
    expect(await prisma.activity.count({ where: { cardId: card.id, type: { notIn: ['card.create'] } } })).toBe(0);
  });
});

describe('ChecklistItem.completedAt qua API giao diện', () => {
  it('tick → mốc trong khoảng gọi API; tick lại → giữ mốc cũ; bỏ tick → null; tick lại → mốc mới', async () => {
    const owner = await makeUser();
    const { itemId } = await cardWithChecklist(owner);
    expect((await itemRow(itemId)).completedAt).toBeNull();

    const before = Date.now();
    await tick(owner, itemId, true);
    const after = Date.now();
    const first = (await itemRow(itemId)).completedAt;
    expect(first).not.toBeNull();
    expect(first!.getTime()).toBeGreaterThanOrEqual(before);
    expect(first!.getTime()).toBeLessThanOrEqual(after);

    await new Promise((r) => setTimeout(r, 15));
    await tick(owner, itemId, true);
    expect((await itemRow(itemId)).completedAt!.getTime()).toBe(first!.getTime());

    await tick(owner, itemId, false);
    const off = await itemRow(itemId);
    expect(off.isDone).toBe(false);
    expect(off.completedAt).toBeNull();

    await new Promise((r) => setTimeout(r, 15));
    await tick(owner, itemId, true);
    expect((await itemRow(itemId)).completedAt!.getTime()).toBeGreaterThan(first!.getTime());
  });

  it('bỏ tick một mục chưa tick → vẫn null; sửa nội dung không đụng mốc tick', async () => {
    const owner = await makeUser();
    const { itemId } = await cardWithChecklist(owner);
    await tick(owner, itemId, false);
    expect((await itemRow(itemId)).completedAt).toBeNull();
    await tick(owner, itemId, true);
    const stamp = (await itemRow(itemId)).completedAt!.getTime();
    await agent().patch(`/api/checklist-items/${itemId}`).set('Cookie', owner.cookie).send({ content: 'tên mới' }).expect(200);
    const row = await itemRow(itemId);
    expect(row.content).toBe('tên mới');
    expect(row.completedAt!.getTime()).toBe(stamp);
  });

  it('sao chép thẻ: giữ storyPoints; mục đã tick có mốc = lúc sao chép, mục chưa tick = null', async () => {
    const owner = await makeUser();
    const { card, itemId } = await cardWithChecklist(owner);
    await agent().patch(`/api/cards/${card.id}`).set('Cookie', owner.cookie).send({ storyPoints: 5 }).expect(200);
    await tick(owner, itemId, true);
    const cl = await prisma.checklist.findFirstOrThrow({ where: { cardId: card.id } });
    await prisma.checklistItem.create({ data: { checklistId: cl.id, content: 'việc hai', position: 1 } });
    // Mốc tick gốc lùi hẳn về quá khứ để thấy rõ bản sao KHÔNG chép mốc cũ
    await prisma.checklistItem.update({ where: { id: itemId }, data: { completedAt: new Date('2026-01-01T00:00:00.000Z') } });

    const before = Date.now();
    const res = await agent().post(`/api/cards/${card.id}/copy`).set('Cookie', owner.cookie).send({}).expect(201);
    const after = Date.now();
    const copy = await prisma.card.findUniqueOrThrow({
      where: { id: res.body.data.card.id },
      include: { checklists: { include: { items: { orderBy: { position: 'asc' } } } } },
    });
    expect(copy.storyPoints).toBe(5);
    const [one, two] = copy.checklists[0]!.items;
    expect(one!.isDone).toBe(true);
    expect(one!.completedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(one!.completedAt!.getTime()).toBeLessThanOrEqual(after);
    expect(two!.isDone).toBe(false);
    expect(two!.completedAt).toBeNull();
  });
});

describe('ChecklistItem.completedAt qua chatbot (SET_CHECKLIST_ITEM_DONE, COPY_CARD)', () => {
  const onBoard = (f: ActionWorld) => ({ kind: 'BOARD' as const, boardId: f.alpha.id });
  const ask = (f: ActionWorld, message: string, op: unknown) =>
    handleV2Message(f.owner.id, { message, scope: onBoard(f) }, actionContext({ step: script([propose(op)]) }));
  const executed = (reply: V2Reply) => {
    const a = reply.answer.action;
    if (a?.kind !== 'RESULT') throw new Error(`cần RESULT nhưng nhận ${JSON.stringify(a ?? null)} / "${reply.answer.text}"`);
    expect(a.result.status).toBe('EXECUTED');
  };

  it('tick đặt mốc, tick lại (noop) giữ mốc, bỏ tick xoá mốc', async () => {
    const f = await seedActions();
    const card = await prisma.card.create({ data: { listId: f.todo.id, title: 'Thẻ tick' } });
    const cl = await prisma.checklist.create({ data: { cardId: card.id, title: 'Kiểm', items: { create: [{ content: 'build', position: 0 }] } }, include: { items: true } });
    const itemId = cl.items[0]!.id;

    executed(await ask(f, 'Tick mục build trong thẻ Thẻ tick', { type: 'SET_CHECKLIST_ITEM_DONE', card: text('Thẻ tick'), match: 'build' }));
    const first = await itemRow(itemId);
    expect(first.isDone).toBe(true);
    expect(first.completedAt).not.toBeNull();

    await ask(f, 'Tick mục build trong thẻ Thẻ tick', { type: 'SET_CHECKLIST_ITEM_DONE', card: text('Thẻ tick'), match: 'build' });
    expect((await itemRow(itemId)).completedAt!.getTime()).toBe(first.completedAt!.getTime());

    executed(await ask(f, 'Bỏ tick mục build trong thẻ Thẻ tick', { type: 'SET_CHECKLIST_ITEM_DONE', card: text('Thẻ tick'), match: 'build', done: false }));
    const off = await itemRow(itemId);
    expect(off.isDone).toBe(false);
    expect(off.completedAt).toBeNull();
  });

  it('sao chép thẻ qua chatbot: giữ storyPoints, mục đã tick có mốc mới, mục chưa tick null', async () => {
    const f = await seedActions();
    const card = await prisma.card.create({ data: { listId: f.todo.id, title: 'Thẻ gốc', storyPoints: 8 } });
    await prisma.checklist.create({
      data: {
        cardId: card.id,
        title: 'Kiểm',
        items: { create: [{ content: 'một', position: 0, isDone: true, completedAt: new Date('2026-01-01T00:00:00.000Z') }, { content: 'hai', position: 1 }] },
      },
    });
    const before = Date.now();
    executed(await ask(f, 'Sao chép thẻ Thẻ gốc', { type: 'COPY_CARD', card: text('Thẻ gốc') }));
    const copy = await prisma.card.findFirstOrThrow({
      where: { title: 'Thẻ gốc (bản sao)' },
      include: { checklists: { include: { items: { orderBy: { position: 'asc' } } } } },
    });
    expect(copy.storyPoints).toBe(8);
    const [one, two] = copy.checklists[0]!.items;
    expect(one!.completedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(two!.completedAt).toBeNull();
  });
});

describe('Bất biến trên toàn bảng sau các thao tác trên', () => {
  it('không còn mục nào ghi MỚI mà isDone khác (completedAt != null)', async () => {
    const owner = await makeUser();
    const { itemId } = await cardWithChecklist(owner);
    await tick(owner, itemId, true);
    await tick(owner, itemId, false);
    await tick(owner, itemId, true);
    const rows = await prisma.checklistItem.findMany();
    for (const r of rows) expect(r.isDone, r.content).toBe(r.completedAt !== null);
  });
});
