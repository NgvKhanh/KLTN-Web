// Du lieu trang Tong quan: GET /api/cards/mine tra completedAt (dem "xong tuan nay", ti le dung han);
// GET /api/activities/home?scope=others chi tra viec nguoi khac lam.
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { addMember, agent, makeBoard, makeCard, makeDirectUser, makeList } from './helpers';

describe('Trang Tổng quan', () => {
  it('GET /api/cards/mine trả completedAt: null khi chưa xong, có giá trị sau khi đánh dấu xong', async () => {
    const owner = await makeDirectUser('Chủ');
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id, 'Viết báo cáo');
    await agent().post(`/api/cards/${card.id}/members`).set('Cookie', owner.cookie).send({ userId: owner.id }).expect(201);

    const before = await agent().get('/api/cards/mine').set('Cookie', owner.cookie).expect(200);
    expect(before.body.data.cards).toEqual([expect.objectContaining({ id: card.id, isDone: false, completedAt: null })]);

    const t0 = Date.now();
    await agent().patch(`/api/cards/${card.id}`).set('Cookie', owner.cookie).send({ isDone: true }).expect(200);
    const after = await agent().get('/api/cards/mine').set('Cookie', owner.cookie).expect(200);
    const row = after.body.data.cards[0] as { isDone: boolean; completedAt: string | null };
    expect(row.isDone).toBe(true);
    expect(new Date(row.completedAt ?? 0).getTime()).toBeGreaterThanOrEqual(t0 - 1000);
  });

  it('GET /api/activities/home?scope=others bỏ việc của chính mình; không có scope thì trả cả hai', async () => {
    const owner = await makeDirectUser('Chủ');
    const member = await makeDirectUser('Thành viên');
    const board = await makeBoard(owner);
    await addMember(owner, board.id, member.email);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id, 'Chốt diễn giả');
    await prisma.activity.create({
      data: { boardId: board.id, cardId: card.id, userId: member.id, type: 'card.rename', data: { from: 'a', to: 'b' } },
    });

    const all = await agent().get('/api/activities/home').set('Cookie', owner.cookie).expect(200);
    const allUsers = new Set((all.body.data.activities as { user: { id: string } }[]).map((a) => a.user.id));
    expect(allUsers).toEqual(new Set([owner.id, member.id]));

    const others = await agent().get('/api/activities/home?scope=others').set('Cookie', owner.cookie).expect(200);
    const rows = others.body.data.activities as { user: { id: string }; type: string; card: { title: string } }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ user: { id: member.id }, type: 'card.rename', card: { title: 'Chốt diễn giả' } });
  });
});
