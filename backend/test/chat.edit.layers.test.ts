// Bước D - các lớp phòng thủ THỨ HAI / THỨ BA của 8 thao tác mới, kiểm TRỰC TIẾP. Trong luồng đầy đủ, lớp "dựng lại kế hoạch" (rebuildAndCompare) và
// bộ giải tham chiếu đã chặn trước nên các lớp sau không bao giờ được chạm tới; test này chứng minh chúng vẫn đúng khi lớp trước bị vượt qua
// (người khác sửa dữ liệu NGAY giữa lúc dựng lại và lúc ghi; hoặc có mã khác gọi thẳng executor).
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { guardOp } from '../src/modules/chat/v2/actions/actions.guard';
import { descriptionHash } from '../src/modules/chat/v2/actions/actions.plan';
import { assessProvenance } from '../src/modules/chat/v2/actions/actions.provenance';
import type { ActionOp } from '../src/modules/chat/v2/actions/actions.schema';
import type { StoredOp } from '../src/modules/chat/v2/actions/actions.types';
import { lockAndVerify } from '../src/modules/chat/v2/actions/actions.write';
import { ACT_NOW, seedActions, type ActionWorld } from './chat.actions.fixture';

const op = (type: StoredOp['type'], ids: StoredOp['ids'], params: StoredOp['params'] = {}, before: StoredOp['before'] = null): StoredOp => ({ type, ids, params, before, display: {} });

describe('lockAndVerify: kiểm lại GIÁ TRỊ CŨ ngay trong transaction', () => {
  const verify = (f: ActionWorld, ops: StoredOp[]) => prisma.$transaction((tx) => lockAndVerify(tx, { userId: f.owner.id, boardId: f.alpha.id }, ops));

  it('mô tả, ngày bắt đầu, người, nhãn, tên cột: giá trị cũ khớp → qua; lệch → STALE (rollback, không ghi gì)', async () => {
    const f = await seedActions();
    await prisma.card.update({ where: { id: f.loginUi.id }, data: { description: 'bản một', startDate: new Date('2026-10-01T17:00:00.000Z') } });
    await prisma.cardMember.create({ data: { cardId: f.loginUi.id, userId: f.lan.id } });
    await prisma.cardLabel.create({ data: { cardId: f.loginUi.id, labelId: f.urgent.id } });
    const card = { card: f.loginUi.id };
    const good: StoredOp[] = [
      op('SET_CARD_DESCRIPTION', card, { description: 'x' }, { descriptionHash: descriptionHash('bản một'), descriptionLength: 7 }),
      op('SET_CARD_START', card, { start: null }, { start: '2026-10-01T17:00:00.000Z' }),
      op('REMOVE_MEMBER', { ...card, member: f.lan.id }, {}, { alreadyAssigned: true }),
      op('REMOVE_LABEL', { ...card, label: f.urgent.id }, {}, { alreadyLabeled: true }),
      op('RENAME_LIST', { list: f.todo.id }, { name: 'Mới' }, { listName: 'Cần làm' }),
    ];
    await expect(verify(f, good)).resolves.toBeDefined();
    const bad: Array<[string, StoredOp]> = [
      ['mô tả', op('SET_CARD_DESCRIPTION', card, { description: 'x' }, { descriptionHash: descriptionHash('bản khác'), descriptionLength: 7 })],
      ['ngày bắt đầu', op('SET_CARD_START', card, { start: null }, { start: null })],
      ['người (chưa được giao lúc xem trước)', op('REMOVE_MEMBER', { ...card, member: f.lan.id }, {}, { alreadyAssigned: false })],
      ['nhãn (chưa gắn lúc xem trước)', op('REMOVE_LABEL', { ...card, label: f.urgent.id }, {}, { alreadyLabeled: false })],
      ['tên cột', op('RENAME_LIST', { list: f.todo.id }, { name: 'Mới' }, { listName: 'Tên cũ khác' })],
    ];
    for (const [label, o] of bad) await expect(verify(f, [o]), label).rejects.toMatchObject({ name: 'PlanAbort', code: 'STALE' });
  });

  it('đổi tên cột sang tên mà một cột KHÁC đang có (kể cả khác hoa thường / dấu) → STALE ngay trong transaction', async () => {
    const f = await seedActions();
    await expect(verify(f, [op('RENAME_LIST', { list: f.todo.id }, { name: 'ĐANG LÀM' }, { listName: 'Cần làm' })])).rejects.toMatchObject({ code: 'STALE' });
    await expect(verify(f, [op('RENAME_LIST', { list: f.todo.id }, { name: 'Cần làm mới' }, { listName: 'Cần làm' })])).resolves.toBeDefined();
  });

  it('bỏ người khỏi thẻ KHÔNG đòi người đó còn quyền sửa bảng (khác với giao việc)', async () => {
    const f = await seedActions();
    await prisma.cardMember.create({ data: { cardId: f.loginUi.id, userId: f.viewer.id } });
    await expect(verify(f, [op('REMOVE_MEMBER', { card: f.loginUi.id, member: f.viewer.id }, {}, { alreadyAssigned: true })])).resolves.toBeDefined();
    await expect(verify(f, [op('ASSIGN_MEMBER', { card: f.loginUi.id, member: f.viewer.id }, {}, { alreadyAssigned: false })])).rejects.toMatchObject({ code: 'STALE' });
  });
});

describe('guardOp: quyền + nghiệp vụ của từng thao tác mới (lớp cuối, chạy lại lúc Áp dụng)', () => {
  const guard = (f: ActionWorld, o: StoredOp, userId = f.owner.id) => guardOp({ userId, boardId: f.alpha.id, op: o });

  it('RENAME_LIST: cột đã bị lưu trữ → NOT_FOUND; tên rỗng hoặc > 100 ký tự → INVALID', async () => {
    const f = await seedActions();
    expect(await guard(f, op('RENAME_LIST', { list: f.todo.id }, { name: 'Mới' }))).toEqual({ ok: true });
    await prisma.list.update({ where: { id: f.todo.id }, data: { archivedAt: ACT_NOW } });
    expect(await guard(f, op('RENAME_LIST', { list: f.todo.id }, { name: 'Mới' }))).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await guard(f, op('RENAME_LIST', { list: f.doing.id }, { name: '   ' }))).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await guard(f, op('RENAME_LIST', { list: f.doing.id }, { name: 'x'.repeat(101) }))).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('ADD_CHECKLIST: 0 hoặc quá 20 mục, mục rỗng / quá 500 ký tự, tên quá 200 ký tự → INVALID', async () => {
    const f = await seedActions();
    const card = { card: f.loginUi.id };
    expect(await guard(f, op('ADD_CHECKLIST', card, { items: Array.from({ length: 20 }, (_, i) => `m${i}`) }))).toEqual({ ok: true });
    const cases: Array<StoredOp['params']> = [{ items: [] }, { items: Array.from({ length: 21 }, (_, i) => `m${i}`) }, { items: ['  '] }, { items: ['x'.repeat(501)] }, { items: ['a'], title: 'x'.repeat(201) }];
    for (const params of cases) expect(await guard(f, op('ADD_CHECKLIST', card, params)), JSON.stringify(params).slice(0, 40)).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('REMOVE_LABEL / REMOVE_MEMBER / ADD_COMMENT / SET_CARD_DESCRIPTION: nhãn của bảng khác, thiếu người, bình luận có @ hoặc rỗng, mô tả rỗng', async () => {
    const f = await seedActions();
    const card = { card: f.loginUi.id };
    const foreignLabel = await prisma.label.create({ data: { boardId: f.beta.id, name: 'Của Beta', color: '#000000' } });
    expect(await guard(f, op('REMOVE_LABEL', { ...card, label: f.urgent.id }))).toEqual({ ok: true });
    expect(await guard(f, op('REMOVE_LABEL', { ...card, label: foreignLabel.id }))).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await guard(f, op('REMOVE_MEMBER', card))).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await guard(f, op('ADD_COMMENT', card, { text: 'nhắc @Lan' }))).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await guard(f, op('ADD_COMMENT', card, { text: '' }))).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await guard(f, op('SET_CARD_DESCRIPTION', card, { description: '' }))).toMatchObject({ ok: false, code: 'INVALID' });
  });

  it('thẻ của BẢNG KHÁC không qua guard (OUT_OF_SCOPE); người chỉ-xem (VIEWER) bị chặn mọi thao tác mới', async () => {
    const f = await seedActions();
    expect(await guard(f, op('ARCHIVE_CARD', { card: f.loginBeta.id }))).toMatchObject({ ok: false, code: 'OUT_OF_SCOPE' });
    for (const o of [op('ARCHIVE_CARD', { card: f.loginUi.id }), op('ADD_COMMENT', { card: f.loginUi.id }, { text: 'ok' }), op('RENAME_LIST', { list: f.todo.id }, { name: 'Mới' })]) {
      expect(await guard(f, o, f.viewer.id), o.type).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    }
  });
});

describe('nguồn gốc của RENAME_LIST: tên cột mới phải là chữ người dùng gõ', () => {
  it('tên do mô hình tự nghĩ ra → UNGROUNDED (xem lại); đúng chữ trong câu → lệnh trực tiếp', () => {
    const verdict = (name: string) => assessProvenance({ type: 'RENAME_LIST', list: { by: 'TEXT', text: 'Cần làm' }, name } as ActionOp, 'Đổi tên cột Cần làm thành Việc cần làm', '2026-10-07').verdict;
    expect(verdict('Việc cần làm')).toBe('USER_DIRECT');
    expect(verdict('Backlog chưa phân loại của dự án')).toBe('UNGROUNDED');
  });
});
