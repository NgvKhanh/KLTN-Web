import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import { runOnce } from '../src/modules/card/reminder.scheduler';
import * as notificationService from '../src/modules/notification/notification.service';
import * as boardService from '../src/modules/board/board.service';
import {
  addMember,
  agent,
  makeBoard,
  makeCard,
  makeList,
  makeUser,
} from './helpers';

async function setDueDate(actor: Awaited<ReturnType<typeof makeUser>>, cardId: string, iso: string) {
  await agent()
    .patch(`/api/cards/${cardId}`)
    .set('Cookie', actor.cookie)
    .send({ dueDate: iso })
    .expect(200);
}

async function addReminder(
  actor: Awaited<ReturnType<typeof makeUser>>,
  cardId: string,
  offsetMinutes: number
) {
  const res = await agent()
    .post(`/api/cards/${cardId}/reminders`)
    .set('Cookie', actor.cookie)
    .send({ offsetMinutes });
  expect(res.status).toBe(201);
}

describe('Vong quet nhac han (reminder.scheduler)', () => {
  it('nhac han da toi luc -> duoc gui va sentAt duoc dat', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    // Han da qua 5 phut -> nhac "10 phut truoc" chac chan da toi luc
    await setDueDate(owner, card.id, new Date(Date.now() - 5 * 60_000).toISOString());
    await addReminder(owner, card.id, 10);

    await runOnce();

    const row = await prisma.cardReminder.findFirst({ where: { cardId: card.id } });
    expect(row?.sentAt).not.toBeNull();

    const noti = await prisma.notification.findFirst({
      where: { userId: owner.id, cardId: card.id, type: 'card.due.reminder' },
    });
    expect(noti).toBeTruthy();
  });

  it('nhac han con xa (ngoai horizon) khong bi dong ngay ca khi co nhac khac da toi han', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);

    const farCard = await makeCard(owner, list.id, 'The con xa');
    await setDueDate(
      owner,
      farCard.id,
      new Date(Date.now() + 3 * 24 * 60 * 60_000).toISOString() // 3 ngay nua
    );
    await addReminder(owner, farCard.id, 1440); // nhac truoc 1 ngay -> remindAt con 2 ngay nua

    const dueCard = await makeCard(owner, list.id, 'The da toi han');
    await setDueDate(owner, dueCard.id, new Date(Date.now() - 60_000).toISOString());
    await addReminder(owner, dueCard.id, 10);

    await runOnce();

    const farRow = await prisma.cardReminder.findFirst({ where: { cardId: farCard.id } });
    expect(farRow?.sentAt).toBeNull();

    const dueRow = await prisma.cardReminder.findFirst({ where: { cardId: dueCard.id } });
    expect(dueRow?.sentAt).not.toBeNull();
  });

  it('200 reminder chua toi han (dueDate con 12 gio, nhac truoc 10 phut) khong lam "chiem cho" (gioi han take) cua 1 reminder KHAC da toi han that su', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);

    // Dung dung kich ban reviewer neu: 200 the han con 12h, nhac truoc 10
    // phut -> con rat lau moi toi luc nhac (khac voi "ngoai horizon" o test
    // truoc, o day dueDate van con TRONG pham vi 24h nhung remindAt van xa).
    const noiseDue = new Date(Date.now() + 12 * 60 * 60_000);
    const noiseIds = Array.from({ length: 200 }, () => randomUUID());
    await prisma.card.createMany({
      data: noiseIds.map((id, i) => ({
        id,
        listId: list.id,
        title: `Noise ${i}`,
        position: i,
        dueDate: noiseDue,
      })),
    });
    await prisma.cardReminder.createMany({
      data: noiseIds.map((cardId) => ({
        cardId,
        userId: owner.id,
        offsetMinutes: 10,
      })),
    });

    const dueCard = await makeCard(owner, list.id, 'The da toi han that su');
    await setDueDate(owner, dueCard.id, new Date(Date.now() - 60_000).toISOString());
    await addReminder(owner, dueCard.id, 10);

    await runOnce();

    const dueRow = await prisma.cardReminder.findFirst({ where: { cardId: dueCard.id } });
    expect(dueRow?.sentAt).not.toBeNull();

    const untouchedNoise = await prisma.cardReminder.count({
      where: { cardId: { in: noiseIds }, sentAt: null },
    });
    expect(untouchedNoise).toBe(200);
  });

  it('the da hoan thanh (isDone) -> khong gui nhac', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    await setDueDate(owner, card.id, new Date(Date.now() - 60_000).toISOString());
    await addReminder(owner, card.id, 10);
    await agent()
      .patch(`/api/cards/${card.id}`)
      .set('Cookie', owner.cookie)
      .send({ isDone: true })
      .expect(200);

    await runOnce();

    const row = await prisma.cardReminder.findFirst({ where: { cardId: card.id } });
    expect(row?.sentAt).toBeNull();
  });

  it('danh sach da luu tru -> khong gui nhac', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    await setDueDate(owner, card.id, new Date(Date.now() - 60_000).toISOString());
    await addReminder(owner, card.id, 10);
    await agent()
      .post(`/api/lists/${list.id}/archive`)
      .set('Cookie', owner.cookie)
      .expect(200);

    await runOnce();

    const row = await prisma.cardReminder.findFirst({ where: { cardId: card.id } });
    expect(row?.sentAt).toBeNull();
  });

  it('nguoi dat nhac mat quyen xem bang truoc khi den han -> KHONG gui, xoa han reminder', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);

    const member = await makeUser();
    await addMember(owner, board.id, member.email);
    await setDueDate(owner, card.id, new Date(Date.now() - 60_000).toISOString());
    await addReminder(member, card.id, 10);

    // Thu hoi quyen truoc khi scheduler chay
    await agent()
      .delete(`/api/boards/${board.id}/members/${member.id}`)
      .set('Cookie', owner.cookie)
      .expect(200);

    await runOnce();

    const row = await prisma.cardReminder.findFirst({
      where: { cardId: card.id, userId: member.id },
    });
    expect(row).toBeNull();

    const noti = await prisma.notification.findFirst({
      where: { userId: member.id, cardId: card.id, type: 'card.due.reminder' },
    });
    expect(noti).toBeNull();
  });

  it('[P2] tao thong bao that bai giua chung -> claim (sentAt) cung bi rollback, khong "mat" reminder', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    await setDueDate(owner, card.id, new Date(Date.now() - 60_000).toISOString());
    await addReminder(owner, card.id, 10);

    // Gia lap loi khi tao thong bao (vd loi DB nhat thoi) NGAY GIUA vong xu ly,
    // sau khi da "claim" (dat sentAt). Neu claim va tao thong bao khong nam
    // trong cung 1 transaction, sentAt se bi dat = da gui trong khi thuc te
    // chua ai duoc bao -> reminder mat vinh vien, khong bao gio duoc thu lai.
    const spy = vi
      .spyOn(notificationService, 'notifyDueReminder')
      .mockRejectedValueOnce(new Error('Loi DB gia lap'));

    await expect(runOnce()).resolves.toBeUndefined();

    const rowAfterFailure = await prisma.cardReminder.findFirst({
      where: { cardId: card.id },
    });
    // Van con null (CHUA "mat") -> vong quet sau phai thu lai duoc
    expect(rowAfterFailure?.sentAt).toBeNull();

    const notiAfterFailure = await prisma.notification.findFirst({
      where: { cardId: card.id, type: 'card.due.reminder' },
    });
    expect(notiAfterFailure).toBeNull();

    spy.mockRestore();
    await runOnce();

    const rowAfterRetry = await prisma.cardReminder.findFirst({
      where: { cardId: card.id },
    });
    expect(rowAfterRetry?.sentAt).not.toBeNull();
    const notiAfterRetry = await prisma.notification.findFirst({
      where: { cardId: card.id, type: 'card.due.reminder' },
    });
    expect(notiAfterRetry).toBeTruthy();
  });

  it('[P2] doi han ngay khi scheduler dang xu ly (sau khi da doc du lieu) -> khong gui nham theo han cu, khong "nuot" mat nhac cho han moi', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);

    const oldDueDate = new Date(Date.now() - 60_000).toISOString();
    await setDueDate(owner, card.id, oldDueDate);
    await addReminder(owner, card.id, 10);

    // Con xa (24h nua): sau khi doi han, KHONG con den luc nhac nua trong tick nay
    const newDueDate = new Date(Date.now() + 24 * 60 * 60_000).toISOString();

    // assertBoardView duoc goi giua luc scheduler doc du lieu va luc "claim":
    // gia lap dung thoi diem do nguoi dung doi han sang gia tri MOI.
    const realAssertBoardView = boardService.assertBoardView;
    const spy = vi
      .spyOn(boardService, 'assertBoardView')
      .mockImplementation(async (userId: string, boardId: string) => {
        await setDueDate(owner, card.id, newDueDate);
        return realAssertBoardView(userId, boardId);
      });

    await runOnce();
    spy.mockRestore();

    const row = await prisma.cardReminder.findFirst({ where: { cardId: card.id } });
    // Khong duoc claim voi du lieu han CU -> sentAt phai con null de cho
    // vong quet sau xet lai dung theo han MOI (khi thuc su toi luc).
    expect(row?.sentAt).toBeNull();

    const noti = await prisma.notification.findFirst({
      where: { cardId: card.id, type: 'card.due.reminder' },
    });
    expect(noti).toBeNull();
  });
});
