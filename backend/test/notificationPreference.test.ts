import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { addMember, agent, makeBoard, makeCard, makeList, makeUser } from './helpers';

async function patchPreference(
  actor: Awaited<ReturnType<typeof makeUser>>,
  body: Record<string, boolean>
) {
  const res = await agent()
    .patch('/api/notifications/preferences')
    .set('Cookie', actor.cookie)
    .send(body);
  expect(res.status).toBe(200);
  return res.body.data.preference;
}

describe('GET/PATCH /api/notifications/preferences', () => {
  it('gia tri mac dinh: moi thong bao trong-app bat, digest tat', async () => {
    const user = await makeUser();
    const res = await agent()
      .get('/api/notifications/preferences')
      .set('Cookie', user.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.preference).toMatchObject({
      cardInApp: true,
      cardEmailDigest: true,
      boardInApp: true,
      boardEmailDigest: true,
      dueReminderInApp: true,
      dueReminderEmail: true,
      dailyDigestEnabled: false,
    });
  });

  it('cap nhat 1 truong -> giu nguyen cac truong khac', async () => {
    const user = await makeUser();
    const updated = await patchPreference(user, { cardInApp: false });
    expect(updated.cardInApp).toBe(false);
    expect(updated.boardInApp).toBe(true);

    const check = await agent()
      .get('/api/notifications/preferences')
      .set('Cookie', user.cookie);
    expect(check.body.data.preference.cardInApp).toBe(false);
  });

  it('body rong -> 400', async () => {
    const user = await makeUser();
    const res = await agent()
      .patch('/api/notifications/preferences')
      .set('Cookie', user.cookie)
      .send({});
    expect(res.status).toBe(400);
  });
});

describe('notify() ton trong tuy chinh in-app theo nhom (chi AN, khong bo luu)', () => {
  it('[P3] tat cardInApp -> van LUU ban ghi (cho digest) nhung AN khoi danh sach/dem chua doc trong-app', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const board = await makeBoard(owner);
    await addMember(owner, board.id, member.email);
    const list = await makeList(owner, board.id);
    const card1 = await makeCard(owner, list.id, 'The 1');
    const card2 = await makeCard(owner, list.id, 'The 2');

    await patchPreference(member, { cardInApp: false });
    // Dem chua doc TRUOC (co san 1 thong bao "board.member.added" tu
    // addMember o tren, van hien binh thuong vi boardInApp con bat).
    const countBefore = await agent()
      .get('/api/notifications/unread-count')
      .set('Cookie', member.cookie);

    await agent()
      .post(`/api/cards/${card1.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: member.id })
      .expect(201);

    // Ban ghi van duoc luu that (nguon cho digest) ...
    const notiOff = await prisma.notification.findFirst({
      where: { userId: member.id, type: 'card.member.added', cardId: card1.id },
    });
    expect(notiOff).toBeTruthy();
    // ... nhung KHONG hien trong danh sach/dem chua doc trong-app cua member
    const listRes = await agent()
      .get('/api/notifications')
      .set('Cookie', member.cookie);
    expect(
      listRes.body.data.notifications.some(
        (n: { cardId: string | null }) => n.cardId === card1.id
      )
    ).toBe(false);
    const countAfter = await agent()
      .get('/api/notifications/unread-count')
      .set('Cookie', member.cookie);
    expect(countAfter.body.data.count).toBe(countBefore.body.data.count);

    await patchPreference(member, { cardInApp: true });
    await agent()
      .post(`/api/cards/${card2.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: member.id })
      .expect(201);

    const notiOn = await prisma.notification.findFirst({
      where: { userId: member.id, type: 'card.member.added', cardId: card2.id },
    });
    expect(notiOn).toBeTruthy();
    const listRes2 = await agent()
      .get('/api/notifications')
      .set('Cookie', member.cookie);
    expect(
      listRes2.body.data.notifications.some(
        (n: { cardId: string | null }) => n.cardId === card2.id
      )
    ).toBe(true);
  });

  it('tat boardInApp -> van luu ban ghi nhung an khoi danh sach trong-app', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    await patchPreference(member, { boardInApp: false });
    const board = await makeBoard(owner);

    await addMember(owner, board.id, member.email);

    const noti = await prisma.notification.findFirst({
      where: { userId: member.id, type: 'board.member.added', boardId: board.id },
    });
    expect(noti).toBeTruthy();
    const listRes = await agent()
      .get('/api/notifications')
      .set('Cookie', member.cookie);
    expect(
      listRes.body.data.notifications.some(
        (n: { boardId: string | null }) => n.boardId === board.id
      )
    ).toBe(false);
  });
});
