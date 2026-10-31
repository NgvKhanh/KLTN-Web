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

// Van de #3: xoa thanh vien khoi bang phai chan het viec tiep tuc nhan du lieu
describe('Thu hoi quyen thanh vien bang', () => {
  it('xoa thanh vien -> xoa luon CardMember cua ho tren bang', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const board = await makeBoard(owner);
    await addMember(owner, board.id, member.email, 'MEMBER');
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);

    // Gan member vao the
    await agent()
      .post(`/api/cards/${card.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: member.id })
      .expect(201);

    expect(
      await prisma.cardMember.count({ where: { userId: member.id } })
    ).toBe(1);

    // Xoa member khoi bang
    await agent()
      .delete(`/api/boards/${board.id}/members/${member.id}`)
      .set('Cookie', owner.cookie)
      .expect(200);

    // CardMember cua ho da bi don sach
    expect(
      await prisma.cardMember.count({ where: { userId: member.id } })
    ).toBe(0);
  });

  it('nguoi da bi xoa khong con thay the trong GET /api/cards/mine', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const board = await makeBoard(owner);
    await addMember(owner, board.id, member.email, 'MEMBER');
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    await agent()
      .post(`/api/cards/${card.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: member.id })
      .expect(201);

    // Truoc khi xoa: member thay the
    const before = await agent()
      .get('/api/cards/mine')
      .set('Cookie', member.cookie);
    expect(before.body.data.cards.map((c: { id: string }) => c.id)).toContain(
      card.id
    );

    await agent()
      .delete(`/api/boards/${board.id}/members/${member.id}`)
      .set('Cookie', owner.cookie)
      .expect(200);

    // Sau khi xoa: khong con the nao
    const after = await agent()
      .get('/api/cards/mine')
      .set('Cookie', member.cookie);
    expect(after.body.data.cards).toHaveLength(0);
  });
});
