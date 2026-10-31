// GET /api/activities/me: nhật ký của CHÍNH người dùng, kèm tên thẻ, chỉ trên bảng còn quyền xem, phân trang theo mốc thời gian.
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { agent, addMember, makeBoard, makeCard, makeDirectUser, makeList } from './helpers';

const mine = (cookie: string, query = '') => agent().get(`/api/activities/me${query}`).set('Cookie', cookie);

describe('GET /api/activities/me', () => {
  it('trả tên thẻ hiện tại + cờ đã xoá, bảng; chỉ nhật ký của chính mình', async () => {
    const owner = await makeDirectUser('Chủ');
    const member = await makeDirectUser('Thành viên');
    const board = await makeBoard(owner, { name: 'Bảng hoạt động' });
    await addMember(owner, board.id, member.email);
    const list = await makeList(owner, board.id, 'Cần làm');
    const card = await makeCard(owner, list.id, 'Viết báo cáo');
    // thành viên cũng làm một việc: không được lẫn vào nhật ký của chủ
    await prisma.activity.create({ data: { boardId: board.id, cardId: card.id, userId: member.id, type: 'card.rename', data: { from: 'a', to: 'b' } } });

    const res = await mine(owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.hasMore).toBe(false);
    const rows = res.body.data.activities as { type: string; userId: string; board: { name: string }; card: { id: string; title: string; deleted: boolean } | null }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.userId === owner.id)).toBe(true);
    const created = rows.find((r) => r.type === 'card.create');
    expect(created).toMatchObject({ board: { name: 'Bảng hoạt động' }, card: { id: card.id, title: 'Viết báo cáo', deleted: false } });

    await prisma.card.update({ where: { id: card.id }, data: { deletedAt: new Date() } });
    const after = (await mine(owner.cookie)).body.data.activities as { type: string; card: { deleted: boolean } | null }[];
    expect(after.find((r) => r.type === 'card.create')?.card?.deleted).toBe(true);
  });

  it('bảng đã rời / bị thu hồi quyền / đã xoá thì không còn trong nhật ký (không lộ tên bảng, tên thẻ)', async () => {
    const owner = await makeDirectUser('Chủ');
    const member = await makeDirectUser('Thành viên');
    const board = await makeBoard(owner, { name: 'Bảng bí mật' });
    await addMember(owner, board.id, member.email);
    const list = await makeList(owner, board.id, 'Cột');
    const card = await makeCard(member, list.id, 'Thẻ của thành viên');
    expect((await mine(member.cookie)).body.data.activities.some((a: { card: { id: string } | null }) => a.card?.id === card.id)).toBe(true);

    await prisma.boardMember.updateMany({ where: { boardId: board.id, userId: member.id }, data: { deletedAt: new Date() } });
    const revoked = await mine(member.cookie);
    expect(revoked.body.data.activities).toEqual([]);
    expect(JSON.stringify(revoked.body)).not.toContain('Bảng bí mật');
    expect(JSON.stringify(revoked.body)).not.toContain('Thẻ của thành viên');

    await prisma.boardMember.updateMany({ where: { boardId: board.id, userId: member.id }, data: { deletedAt: null } });
    await prisma.board.update({ where: { id: board.id }, data: { deletedAt: new Date() } });
    expect((await mine(member.cookie)).body.data.activities).toEqual([]);
  });

  it('phân trang: limit + before; hasMore đúng; không trùng, không sót', async () => {
    const owner = await makeDirectUser('Chủ');
    const board = await makeBoard(owner);
    const base = new Date('2026-10-01T00:00:00.000Z').getTime();
    for (let i = 0; i < 7; i += 1) {
      await prisma.activity.create({ data: { boardId: board.id, userId: owner.id, type: 'card.create', data: { listName: `Cột ${i}` }, createdAt: new Date(base + i * 60_000) } });
    }
    const first = await mine(owner.cookie, '?limit=3');
    expect(first.status).toBe(200);
    expect(first.body.data.activities).toHaveLength(3);
    expect(first.body.data.hasMore).toBe(true);
    const lists = (rows: { data: { listName?: string } }[]) => rows.map((r) => r.data.listName);
    expect(lists(first.body.data.activities)).toEqual(['Cột 6', 'Cột 5', 'Cột 4']);

    const lastAt = first.body.data.activities[2].createdAt as string;
    const second = await mine(owner.cookie, `?limit=3&before=${encodeURIComponent(lastAt)}`);
    expect(lists(second.body.data.activities)).toEqual(['Cột 3', 'Cột 2', 'Cột 1']);
    expect(second.body.data.hasMore).toBe(true);
    const lastAt2 = second.body.data.activities[2].createdAt as string;
    const third = await mine(owner.cookie, `?limit=3&before=${encodeURIComponent(lastAt2)}`);
    expect(lists(third.body.data.activities)).toEqual(['Cột 0']);
    expect(third.body.data.hasMore).toBe(false);

    // tham số hỏng thì bỏ qua, không lỗi
    const bad = await mine(owner.cookie, '?before=khong-phai-ngay&limit=abc');
    expect(bad.status).toBe(200);
    expect(bad.body.data.activities.length).toBe(7);
  });
});
