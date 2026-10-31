// Danh mục mẫu bảng có sẵn: dữ liệu hợp lệ và MỌI mẫu đều tạo được bảng đúng cột / thẻ / nhãn.
import { describe, expect, it } from 'vitest';
import { agent, makeDirectUser } from './helpers';
import { prisma } from '../src/config/prisma';
import { BOARD_TEMPLATES, TEMPLATE_CATEGORIES } from '../src/modules/board/boardTemplates';

const STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED', null];
const HEX = /^#[0-9A-Fa-f]{6}$/;

describe('danh mục mẫu bảng - dữ liệu', () => {
  it('id không trùng, mỗi mẫu thuộc một nhóm có thật, màu hợp lệ', () => {
    const ids = BOARD_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const categories = new Set(TEMPLATE_CATEGORIES.map((c) => c.id));
    for (const t of BOARD_TEMPLATES) {
      expect(categories.has(t.category), t.id).toBe(true);
      expect(t.color, t.id).toMatch(HEX);
      expect(t.name.length, t.id).toBeLessThanOrEqual(100);
      expect(t.description.length, t.id).toBeGreaterThan(10);
    }
    // nhóm nào cũng có ít nhất một mẫu (không hiện nhóm rỗng ở giao diện)
    for (const c of TEMPLATE_CATEGORIES) expect(BOARD_TEMPLATES.some((t) => t.category === c.id), c.id).toBe(true);
    expect(BOARD_TEMPLATES.length).toBeGreaterThanOrEqual(14);
  });

  it('cột / thẻ / nhãn: tên không rỗng, không trùng trong cùng mẫu, trạng thái hợp lệ, có ít nhất một cột và một thẻ ví dụ', () => {
    for (const t of BOARD_TEMPLATES) {
      expect(t.lists.length, t.id).toBeGreaterThanOrEqual(3);
      expect(t.lists.length, t.id).toBeLessThanOrEqual(8);
      const listNames = t.lists.map((l) => l.name.trim().toLowerCase());
      expect(new Set(listNames).size, `${t.id}: tên cột trùng`).toBe(listNames.length);
      for (const l of t.lists) {
        expect(l.name.trim(), t.id).not.toBe('');
        expect(l.name.length, `${t.id}/${l.name}`).toBeLessThanOrEqual(100);
        expect(STATUSES, `${t.id}/${l.name}`).toContain(l.status);
        for (const c of l.cards) {
          expect(c.trim(), `${t.id}/${l.name}`).not.toBe('');
          expect(c.length, `${t.id}/${l.name}`).toBeLessThanOrEqual(500);
        }
      }
      expect(t.lists.some((l) => l.cards.length > 0), `${t.id}: cần thẻ ví dụ`).toBe(true);
      // cột "xong" có thật để người dùng có chỗ đưa việc xong vào
      expect(t.lists.some((l) => l.status === 'DONE'), `${t.id}: thiếu cột hoàn thành`).toBe(true);
      const labelNames = (t.labels ?? []).map((l) => l.name.toLowerCase());
      expect(new Set(labelNames).size, `${t.id}: nhãn trùng`).toBe(labelNames.length);
      for (const l of t.labels ?? []) {
        expect(l.color, `${t.id}/${l.name}`).toMatch(HEX);
        expect(l.name.length, `${t.id}/${l.name}`).toBeLessThanOrEqual(50);
      }
    }
  });
});

describe('danh mục mẫu bảng - API', () => {
  it('GET /api/boards/templates trả mẫu kèm nhóm', async () => {
    const owner = await makeDirectUser();
    const res = await agent().get('/api/boards/templates').set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.templates).toHaveLength(BOARD_TEMPLATES.length);
    expect(res.body.data.categories.map((c: { id: string }) => c.id)).toEqual(TEMPLATE_CATEGORIES.map((c) => c.id));
    expect(res.body.data.templates[0]).toMatchObject({ id: 'kanban', category: 'work' });
  });

  it('tạo bảng từ TỪNG mẫu: đúng số cột, trạng thái, thẻ, nhãn và màu', async () => {
    const owner = await makeDirectUser();
    for (const t of BOARD_TEMPLATES) {
      const res = await agent()
        .post('/api/boards/from-template')
        .set('Cookie', owner.cookie)
        .send({ templateId: t.id, workspaceId: owner.personalWorkspaceId });
      expect(res.status, t.id).toBe(201);
      const board = await prisma.board.findUniqueOrThrow({
        where: { id: res.body.data.board.id },
        include: { lists: { orderBy: { position: 'asc' }, include: { cards: { orderBy: { position: 'asc' } } } }, labels: { orderBy: { createdAt: 'asc' } } },
      });
      expect(board.name, t.id).toBe(t.name);
      expect(board.color, t.id).toBe(t.color);
      expect(board.lists.map((l) => [l.name, l.status]), t.id).toEqual(t.lists.map((l) => [l.name, l.status]));
      expect(board.lists.map((l) => l.cards.map((c) => c.title)), t.id).toEqual(t.lists.map((l) => l.cards));
      expect(board.labels.map((l) => [l.name, l.color]), t.id).toEqual((t.labels ?? []).map((l) => [l.name, l.color]));
    }
  });

  it('đặt tên riêng khi tạo; mẫu không có thì 404', async () => {
    const owner = await makeDirectUser();
    const ok = await agent()
      .post('/api/boards/from-template')
      .set('Cookie', owner.cookie)
      .send({ templateId: 'bugs', workspaceId: owner.personalWorkspaceId, name: '  Lỗi của app di động  ' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.board.name).toBe('Lỗi của app di động');
    const missing = await agent()
      .post('/api/boards/from-template')
      .set('Cookie', owner.cookie)
      .send({ templateId: 'khong-co', workspaceId: owner.personalWorkspaceId });
    expect(missing.status).toBe(404);
  });
});
