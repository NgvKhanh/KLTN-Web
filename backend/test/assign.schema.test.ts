// Buoc 1 cua module goi y phan cong (ASSIGN_MODULE.md §9).
// Canh giu 3 bat bien ma toan bo module sau nay dua vao:
//   (1) Card.completedAt luon khop Card.isDone, va KHONG bi troi khi cap nhat
//       linh tinh (neu troi thi moi phep do "dung han hay tre" deu sai).
//   (2) CardMember ghi lai THOI DIEM gan va NGUOI gan.
//   (3) Nhat ky member.add luu memberId chu khong chi memberName (trung ten
//       la lan nguoi - day chinh la lo hong cua ban cu).
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import {
  addMember,
  agent,
  makeBoard,
  makeCard,
  makeList,
  makeUser,
} from './helpers';

const patchCard = (
  user: Awaited<ReturnType<typeof makeUser>>,
  cardId: string,
  body: Record<string, unknown>
) =>
  agent().patch(`/api/cards/${cardId}`).set('Cookie', user.cookie).send(body);

const readCard = (cardId: string) =>
  prisma.card.findUniqueOrThrow({
    where: { id: cardId },
    select: { isDone: true, completedAt: true },
  });

describe('Buoc 1 - nen du lieu cho goi y phan cong', () => {
  it('completedAt bam theo isDone va khong troi khi cap nhat khac', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id, 'Viet API dang nhap');

    // The moi: chua xong -> chua co moc hoan thanh
    expect(await readCard(card.id)).toEqual({ isDone: false, completedAt: null });

    // Danh dau xong -> co moc, va moc nam trong khoang thoi gian goi API
    const before = new Date();
    expect((await patchCard(owner, card.id, { isDone: true })).status).toBe(200);
    const done = await readCard(card.id);
    const after = new Date();
    expect(done.isDone).toBe(true);
    expect(done.completedAt).not.toBeNull();
    expect(done.completedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(done.completedAt!.getTime()).toBeLessThanOrEqual(after.getTime() + 1000);

    // Doi ten: KHONG duoc dung toi moc hoan thanh
    await patchCard(owner, card.id, { title: 'Viet API dang nhap Google' });
    expect((await readCard(card.id)).completedAt).toEqual(done.completedAt);

    // Gui lai isDone: true (khong doi trang thai): cung KHONG duoc lam troi moc
    await patchCard(owner, card.id, { isDone: true });
    expect((await readCard(card.id)).completedAt).toEqual(done.completedAt);

    // Bo danh dau xong -> moc phai bi xoa (bat bien: isDone <-> completedAt)
    await patchCard(owner, card.id, { isDone: false });
    expect(await readCard(card.id)).toEqual({ isDone: false, completedAt: null });

    // Danh dau xong lai -> moc MOI, khong phai moc cu
    await patchCard(owner, card.id, { isDone: true });
    const again = await readCard(card.id);
    expect(again.completedAt).not.toBeNull();
    expect(again.completedAt!.getTime()).toBeGreaterThanOrEqual(
      done.completedAt!.getTime()
    );

    // Lich su mo lai van truy nguoc duoc tu nhat ky, du cot chi giu lan cuoi
    const undone = await prisma.activity.count({
      where: { cardId: card.id, type: 'card.undone' },
    });
    expect(undone).toBe(1);
  });

  it('gan nguoi ghi lai thoi diem, nguoi gan va id trong nhat ky', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const board = await makeBoard(owner);
    await addMember(owner, board.id, worker.email);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id, 'Kiem thu man hinh dang nhap');

    const before = new Date();
    const res = await agent()
      .post(`/api/cards/${card.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: worker.id });
    expect(res.status).toBe(201);

    const row = await prisma.cardMember.findUniqueOrThrow({
      where: { cardId_userId: { cardId: card.id, userId: worker.id } },
      select: { createdAt: true, assignedById: true },
    });
    // Duoc GIAO viec (khac voi tu nhan): nguoi gan la chu bang
    expect(row.assignedById).toBe(owner.id);
    expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);

    const log = await prisma.activity.findFirstOrThrow({
      where: { cardId: card.id, type: 'member.add' },
      select: { data: true },
    });
    const data = log.data as { memberId?: string; memberName?: string };
    // memberId la thu bat buoc: chi co ten thi hai nguoi trung ten se lan nhau
    expect(data.memberId).toBe(worker.id);
    expect(data.memberName).toBe(worker.name);
  });

  it('duong tu dong hoa cung ghi completedAt va nguoi gan', async () => {
    const owner = await makeUser();
    const worker = await makeUser();
    const board = await makeBoard(owner);
    await addMember(owner, board.id, worker.email);
    const list = await makeList(owner, board.id, 'Xong ngay');

    const rule = await agent()
      .post(`/api/boards/${board.id}/automation-rules`)
      .set('Cookie', owner.cookie)
      .send({
        name: 'Tao the -> xong + gan nguoi',
        triggerType: 'CARD_CREATED',
        triggerListId: list.id,
        actions: [
          { type: 'SET_DONE', boolValue: true },
          { type: 'ASSIGN_MEMBER', userId: worker.id },
        ],
      });
    expect(rule.status).toBe(201);

    const card = await makeCard(owner, list.id, 'The do tu dong hoa xu ly');

    // Duong tu dong hoa la cho ghi isDone THU HAI trong ma nguon - de quen
    const row = await readCard(card.id);
    expect(row.isDone).toBe(true);
    expect(row.completedAt).not.toBeNull();

    const member = await prisma.cardMember.findUniqueOrThrow({
      where: { cardId_userId: { cardId: card.id, userId: worker.id } },
      select: { assignedById: true },
    });
    expect(member.assignedById).toBe(owner.id);

    const log = await prisma.activity.findFirstOrThrow({
      where: { cardId: card.id, type: 'member.add' },
      select: { data: true },
    });
    expect((log.data as { memberId?: string }).memberId).toBe(worker.id);
  });
});
