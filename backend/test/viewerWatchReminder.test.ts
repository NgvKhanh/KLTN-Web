import { describe, expect, it } from 'vitest';
import { addMember, agent, makeBoard, makeCard, makeList, makeUser } from './helpers';

// Tach rieng khoi boardViewerRole.test.ts de khong vuot han muc dang ky
// (registerLimiter: 10 lan/gio/IP) khi ca file chay chung 1 tien trinh test.
describe('VIEWER dung duoc Watch va nhac han rieng (chi can quyen xem)', () => {
  it('VIEWER theo doi (watch) duoc ca danh sach lan the', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    const viewer = await makeUser();
    await addMember(owner, board.id, viewer.email, 'VIEWER');

    const listWatchRes = await agent()
      .put(`/api/lists/${list.id}/watch`)
      .set('Cookie', viewer.cookie)
      .send({ watching: true });
    expect(listWatchRes.status).toBe(200);

    const cardWatchRes = await agent()
      .put(`/api/cards/${card.id}/watch`)
      .set('Cookie', viewer.cookie)
      .send({ watching: true });
    expect(cardWatchRes.status).toBe(200);
  });

  it('VIEWER dat duoc nhac han rieng cho ban than', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    await agent()
      .patch(`/api/cards/${card.id}`)
      .set('Cookie', owner.cookie)
      .send({ dueDate: new Date(Date.now() + 3600_000).toISOString() })
      .expect(200);
    const viewer = await makeUser();
    await addMember(owner, board.id, viewer.email, 'VIEWER');

    const res = await agent()
      .post(`/api/cards/${card.id}/reminders`)
      .set('Cookie', viewer.cookie)
      .send({ offsetMinutes: 10 });
    expect(res.status).toBe(201);
  });
});
