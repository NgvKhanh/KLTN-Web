import { describe, expect, it, vi } from 'vitest';
import { sendMail } from '../src/config/mailer';
import { prisma } from '../src/config/prisma';
import { runOnce as runReminderOnce } from '../src/modules/card/reminder.scheduler';
import { runOnce as runDigestOnce } from '../src/modules/notification/digest.scheduler';
import { addMember, agent, makeBoard, makeCard, makeList, makeUser } from './helpers';

const mailMock = vi.mocked(sendMail);

async function patchPreference(
  actor: Awaited<ReturnType<typeof makeUser>>,
  body: Record<string, boolean>
) {
  const res = await agent()
    .patch('/api/notifications/preferences')
    .set('Cookie', actor.cookie)
    .send(body);
  expect(res.status).toBe(200);
}

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
  await agent()
    .post(`/api/cards/${cardId}/reminders`)
    .set('Cookie', actor.cookie)
    .send({ offsetMinutes })
    .expect(201);
}

describe('reminder.scheduler ton trong tuy chinh nhac han', () => {
  it('tat dueReminderInApp -> van gui email nhung khong tao thong bao trong-app', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    await setDueDate(owner, card.id, new Date(Date.now() - 60_000).toISOString());
    await addReminder(owner, card.id, 10);
    await patchPreference(owner, { dueReminderInApp: false });

    mailMock.mockClear();
    await runReminderOnce();

    const row = await prisma.cardReminder.findFirst({ where: { cardId: card.id } });
    expect(row?.sentAt).not.toBeNull();
    const noti = await prisma.notification.findFirst({
      where: { cardId: card.id, type: 'card.due.reminder' },
    });
    expect(noti).toBeNull();
    expect(mailMock).toHaveBeenCalledTimes(1);
  });

  it('tat dueReminderEmail -> van tao thong bao trong-app nhung khong gui email', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    await setDueDate(owner, card.id, new Date(Date.now() - 60_000).toISOString());
    await addReminder(owner, card.id, 10);
    await patchPreference(owner, { dueReminderEmail: false });

    mailMock.mockClear();
    await runReminderOnce();

    const row = await prisma.cardReminder.findFirst({ where: { cardId: card.id } });
    expect(row?.sentAt).not.toBeNull();
    const noti = await prisma.notification.findFirst({
      where: { cardId: card.id, type: 'card.due.reminder' },
    });
    expect(noti).toBeTruthy();
    expect(mailMock).not.toHaveBeenCalled();
  });
});

describe('digest.scheduler - email tong hop hang ngay', () => {
  it('dailyDigestEnabled=false -> khong xu ly, khong gui email', async () => {
    const user = await makeUser();

    mailMock.mockClear();
    await runDigestOnce();

    expect(mailMock).not.toHaveBeenCalled();
    const pref = await prisma.notificationPreference.findFirst({
      where: { userId: user.id },
    });
    expect(pref?.lastDigestSentAt).toBeFalsy();
  });

  it('bat digest, co thong bao card+board trong ky -> gui 1 email tong hop dung so luong', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    await patchPreference(member, { dailyDigestEnabled: true });

    const board = await makeBoard(owner);
    await addMember(owner, board.id, member.email); // 1 thong bao "board"
    const list = await makeList(owner, board.id);
    const card1 = await makeCard(owner, list.id, 'The A');
    const card2 = await makeCard(owner, list.id, 'The B');
    await agent()
      .post(`/api/cards/${card1.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: member.id })
      .expect(201);
    await agent()
      .post(`/api/cards/${card2.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: member.id })
      .expect(201); // 2 thong bao "card"

    mailMock.mockClear();
    await runDigestOnce();

    expect(mailMock).toHaveBeenCalledTimes(1);
    const call = mailMock.mock.calls[0]![0] as { to: string; subject: string; html: string };
    expect(call.to).toBe(member.email);
    expect(call.subject).toContain('3 thông báo');
    expect(call.html).toContain('2 thông báo hoạt động trên thẻ');
    expect(call.html).toContain('1 thông báo về bảng');

    const pref = await prisma.notificationPreference.findFirst({
      where: { userId: member.id },
    });
    expect(pref?.lastDigestSentAt).toBeTruthy();
  });

  it('tat cardEmailDigest -> thong bao card khong duoc tinh vao email tong hop', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    await patchPreference(member, { dailyDigestEnabled: true, cardEmailDigest: false });

    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    await addMember(owner, board.id, member.email);
    await agent()
      .post(`/api/cards/${card.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: member.id })
      .expect(201);

    mailMock.mockClear();
    await runDigestOnce();

    // Con 1 thong bao "board" (khong bi tat) -> van gui email, nhung khong dem the
    expect(mailMock).toHaveBeenCalledTimes(1);
    const call = mailMock.mock.calls[0]![0] as { html: string };
    expect(call.html).not.toContain('thông báo hoạt động trên thẻ');
    expect(call.html).toContain('1 thông báo về bảng');
  });

  it('khong co gi de gui -> khong gui email nhung van cap nhat lastDigestSentAt (tranh doc lai cung ky rong)', async () => {
    const user = await makeUser();
    await patchPreference(user, { dailyDigestEnabled: true });

    mailMock.mockClear();
    await runDigestOnce();

    expect(mailMock).not.toHaveBeenCalled();
    const pref = await prisma.notificationPreference.findFirst({ where: { userId: user.id } });
    expect(pref?.lastDigestSentAt).toBeTruthy();
  });

  it('lastDigestSentAt gan day (chua qua 24h) -> chua den ky, bo qua', async () => {
    const user = await makeUser();
    await patchPreference(user, { dailyDigestEnabled: true });
    await prisma.notificationPreference.update({
      where: { userId: user.id },
      data: { lastDigestSentAt: new Date(Date.now() - 60 * 60_000) }, // 1h truoc
    });

    mailMock.mockClear();
    await runDigestOnce();
    expect(mailMock).not.toHaveBeenCalled();
  });
});
