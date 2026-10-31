import { describe, expect, it } from 'vitest';
import { agent, makeBoard, makeCard, makeList, makeUser } from './helpers';

// [P1] Tim kiem khong duoc lo email thanh vien bang PUBLIC cho khach (nguoi
// khong phai thanh vien, chi xem duoc vi bang la PUBLIC).
describe('Tim kiem khong lo email thanh vien tren bang PUBLIC', () => {
  it('GET /api/search/cards (tim nang cao): khach xem bang PUBLIC khong thay email', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const board = await makeBoard(owner);
    await agent()
      .patch(`/api/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .send({ visibility: 'PUBLIC' })
      .expect(200);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id, 'The cong khai');
    await agent()
      .post(`/api/cards/${card.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: owner.id })
      .expect(201);

    const res = await agent()
      .get('/api/search/cards?q=cong khai')
      .set('Cookie', outsider.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    const member = res.body.data.items[0].members[0];
    expect(member.user.name).toBeTruthy();
    expect(member.user.email).toBeUndefined();
  });

  it('GET /api/cards/search (tim nhanh o header): khach xem bang PUBLIC khong thay email', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const board = await makeBoard(owner);
    await agent()
      .patch(`/api/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .send({ visibility: 'PUBLIC' })
      .expect(200);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id, 'The cong khai nhanh');
    await agent()
      .post(`/api/cards/${card.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: owner.id })
      .expect(201);

    const res = await agent()
      .get('/api/cards/search?q=cong khai nhanh')
      .set('Cookie', outsider.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.cards).toHaveLength(1);
    const member = res.body.data.cards[0].members[0];
    expect(member.user.name).toBeTruthy();
    expect(member.user.email).toBeUndefined();
  });

  it('thanh vien that su cua bang van tim duoc (khong bi chan qua tay)', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    await makeCard(owner, list.id, 'The rieng tu cua owner');

    const res = await agent()
      .get('/api/search/cards?q=rieng tu cua owner')
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
  });
});
