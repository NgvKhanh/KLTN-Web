import { describe, expect, it } from 'vitest';
import { agent, makeBoard, makeCard, makeList, makeUser } from './helpers';

// CODE_REVIEW.md #7: thieu dieu kien archivedAt:null tren Board o 3 truy van (tim
// nang cao, tim nhanh, "the cua toi") khien bang da LUU TRU van lot vao ket qua -
// ke ca cho CHINH CHU BANG, khong chi nguoi ngoai.
describe('Bang da luu tru khong con lot vao tim kiem / "the cua toi"', () => {
  it('bang da luu tru khong con lot vao tim kiem nang cao / tim nhanh / "the cua toi"', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id, 'The trong bang se luu tru');
    await agent()
      .post(`/api/cards/${card.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: owner.id })
      .expect(201);

    const before = await Promise.all([
      agent().get('/api/search/cards?q=luu tru').set('Cookie', owner.cookie),
      agent().get('/api/cards/search?q=luu tru').set('Cookie', owner.cookie),
      agent().get('/api/cards/mine').set('Cookie', owner.cookie),
    ]);
    expect(before[0]!.body.data.items).toHaveLength(1);
    expect(before[1]!.body.data.cards).toHaveLength(1);
    expect(before[2]!.body.data.cards.map((c: { id: string }) => c.id)).toContain(card.id);

    await agent()
      .post(`/api/boards/${board.id}/archive-board`)
      .set('Cookie', owner.cookie)
      .expect(200);

    const after = await Promise.all([
      agent().get('/api/search/cards?q=luu tru').set('Cookie', owner.cookie),
      agent().get('/api/cards/search?q=luu tru').set('Cookie', owner.cookie),
      agent().get('/api/cards/mine').set('Cookie', owner.cookie),
    ]);
    expect(after[0]!.body.data.items).toHaveLength(0);
    expect(after[1]!.body.data.cards).toHaveLength(0);
    expect(after[2]!.body.data.cards.map((c: { id: string }) => c.id)).not.toContain(card.id);
  });
});
