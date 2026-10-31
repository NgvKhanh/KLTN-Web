import { describe, expect, it } from 'vitest';
import { agent, makeBoard, makeCard, makeList, makeUser } from './helpers';

async function getCalendar(
  actor: Awaited<ReturnType<typeof makeUser>>,
  from: string,
  to: string
) {
  const res = await agent()
    .get(`/api/cards/calendar?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
    .set('Cookie', actor.cookie);
  expect(res.status).toBe(200);
  return res.body.data as { cards: { id: string }[]; checklistItems: { id: string }[] };
}

describe('GET /api/cards/calendar - khoang ngay + checklist', () => {
  it('the co startDate...dueDate GIAO voi khoang xem, du dueDate ngoai khoang', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id, 'The dai ngay');

    // The keo dai 20/3 -> 10/4, xem thang 3 (view = 1/3 -> 31/3)
    await agent()
      .patch(`/api/cards/${card.id}`)
      .set('Cookie', owner.cookie)
      .send({
        startDate: '2026-03-20T00:00:00.000Z',
        dueDate: '2026-04-10T00:00:00.000Z',
      })
      .expect(200);

    const data = await getCalendar(owner, '2026-03-01T00:00:00.000Z', '2026-03-31T23:59:59.000Z');
    expect(data.cards.map((c) => c.id)).toContain(card.id);
  });

  it('the co dueDate xa hon khoang xem VA startDate cung xa hon -> khong hien', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id, 'The o thang khac');
    await agent()
      .patch(`/api/cards/${card.id}`)
      .set('Cookie', owner.cookie)
      .send({ dueDate: '2026-05-15T00:00:00.000Z' })
      .expect(200);

    const data = await getCalendar(owner, '2026-03-01T00:00:00.000Z', '2026-03-31T23:59:59.000Z');
    expect(data.cards.map((c) => c.id)).not.toContain(card.id);
  });

  it('tra ve ca muc checklist co han trong khoang', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);

    const cl = await agent()
      .post(`/api/cards/${card.id}/checklists`)
      .set('Cookie', owner.cookie)
      .send({ title: 'Cong viec' });
    const checklistId = cl.body.data.checklist.id as string;

    const item = await agent()
      .post(`/api/checklists/${checklistId}/items`)
      .set('Cookie', owner.cookie)
      .send({ content: 'Buoc 1' });
    const itemId = item.body.data.item.id as string;

    await agent()
      .patch(`/api/checklist-items/${itemId}`)
      .set('Cookie', owner.cookie)
      .send({ dueDate: '2026-03-15T00:00:00.000Z' })
      .expect(200);

    const data = await getCalendar(owner, '2026-03-01T00:00:00.000Z', '2026-03-31T23:59:59.000Z');
    expect(data.checklistItems.map((i) => i.id)).toContain(itemId);
  });

  it('nguoi ngoai bang khong thay the/checklist cua bang do', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    await agent()
      .patch(`/api/cards/${card.id}`)
      .set('Cookie', owner.cookie)
      .send({ dueDate: '2026-03-15T00:00:00.000Z' })
      .expect(200);

    const data = await getCalendar(outsider, '2026-03-01T00:00:00.000Z', '2026-03-31T23:59:59.000Z');
    expect(data.cards.map((c) => c.id)).not.toContain(card.id);
  });
});
