// Bước H - mở rộng thẻ: giá trị trường tùy chỉnh, nhắc hạn, theo dõi, thẻ mẫu. So SONG SONG với service giao diện trên dữ liệu song sinh.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import { handleV2Message } from '../src/modules/chat/v2/chat.v2.service';
import { persistentConfirm, persistentMessage } from '../src/modules/chat/v2/chat.v2.history';
import { V2SessionStore } from '../src/modules/chat/v2/chat.v2.session';
import type { V2Reply } from '../src/modules/chat/v2/chat.v2.contract';
import { setCardFieldValue } from '../src/modules/customField/customField.service';
import { addCardReminder, removeCardReminder } from '../src/modules/card/cardReminder.service';
import { setBoardWatch, setCardWatch, setListWatch } from '../src/modules/watch/watch.service';
import { applyCardTemplate, saveCardAsTemplate } from '../src/modules/card/cardTemplate.service';
import { ActionOpSchema, type ActionOp } from '../src/modules/chat/v2/actions/actions.schema';
import { assessProvenance } from '../src/modules/chat/v2/actions/actions.provenance';
import { foldWords, licenceFromPositions } from '../src/modules/chat/v2/actions/actions.text';
import { handlerOf } from '../src/modules/chat/v2/actions/ops/ops.registry';
import { ACT_NOW, actionContext, propose, script, seedActions, text, type ActionWorld } from './chat.actions.fixture';

const mocks = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock('../src/realtime/socket', async (original) => ({ ...(await original<object>()), emitToBoard: mocks.emit }));
beforeEach(() => mocks.emit.mockClear());

const onBoard = (f: ActionWorld) => ({ kind: 'BOARD' as const, boardId: f.alpha.id });
function resultOf(reply: V2Reply) {
  const a = reply.answer.action;
  if (a?.kind !== 'RESULT') throw new Error(`cần RESULT nhưng nhận ${JSON.stringify(a ?? null)} / "${reply.answer.text}"`);
  return a.result;
}
function planOf(reply: V2Reply) {
  const a = reply.answer.action;
  if (a?.kind !== 'PLAN') throw new Error(`cần PLAN nhưng nhận ${JSON.stringify(a ?? null)} / "${reply.answer.text}"`);
  return a.plan;
}
const ask = (f: ActionWorld, message: string, ...ops: unknown[]) => handleV2Message(f.owner.id, { message, scope: onBoard(f) }, actionContext({ step: script([propose(...ops)]) }));
async function preview(f: ActionWorld, message: string, ops: unknown[]) {
  const sessions = new V2SessionStore();
  const scope = onBoard(f);
  const reply = await persistentMessage(f.owner.id, { message, scope }, actionContext({ step: script([propose(...ops)]), sessions }));
  const plan = planOf(reply);
  return { plan, confirm: () => persistentConfirm(f.owner.id, plan.planId, { conversationId: reply.conversationId, checksum: plan.checksum, scope }, actionContext({ sessions, now: ACT_NOW })) };
}
const op = (value: unknown): ActionOp => ActionOpSchema.parse(value);
const t = (s: string) => ({ by: 'TEXT' as const, text: s });
const lic = (message: string, value: unknown) => {
  const o = op(value);
  const words = foldWords(message);
  return licenceFromPositions(handlerOf(o.type)!.licence(words, o as never), words);
};
const prov = (message: string, value: unknown) => assessProvenance(op(value), message, '2026-10-07');
async function twinCards(f: ActionWorld) {
  const make = (title: string) => prisma.card.create({ data: { listId: f.todo.id, title, dueDate: new Date('2026-10-12T16:59:00.000Z') } });
  return { a: await make('Song sinh A'), b: await make('Song sinh B') };
}
async function fields(f: ActionWorld) {
  const mk = (name: string, type: 'TEXT' | 'NUMBER' | 'DATE' | 'CHECKBOX' | 'DROPDOWN', position: number) => prisma.customField.create({ data: { boardId: f.alpha.id, name, type, position } });
  const priority = await mk('Ưu tiên', 'DROPDOWN', 0);
  const low = await prisma.customFieldOption.create({ data: { fieldId: priority.id, value: 'Thấp', position: 0 } });
  const high = await prisma.customFieldOption.create({ data: { fieldId: priority.id, value: 'Cao', position: 1 } });
  return { priority, low, high, score: await mk('Điểm', 'NUMBER', 1), done: await mk('Hoàn tất', 'CHECKBOX', 2), meeting: await mk('Ngày họp', 'DATE', 3), note: await mk('Ghi chú', 'TEXT', 4) };
}
const valueOf = async (cardId: string, fieldId: string) => {
  const v = await prisma.cardFieldValue.findUnique({ where: { cardId_fieldId: { cardId, fieldId } } });
  return v ? [v.textValue, v.numberValue, v.dateValue?.toISOString() ?? null, v.boolValue, v.optionId] : null;
};

describe('thuần: giấy phép + nguồn gốc', () => {
  it('SET_FIELD_VALUE: động từ + tên trường trong cầu; giá trị mô hình tự nghĩ → xem lại', () => {
    const o = { type: 'SET_FIELD_VALUE', card: t('Login UI'), field: 'Ưu tiên', value: 'Cao' };
    expect(lic('Đặt Ưu tiên của thẻ Login UI là Cao', o).licensed).toBe(true);
    expect(lic('Thẻ Login UI có Ưu tiên gì', o).licensed).toBe(false);
    expect(prov('Đặt Ưu tiên của thẻ Login UI là Cao', o).verdict).toBe('USER_DIRECT');
    expect(prov('Đặt Ưu tiên của thẻ Login UI là Thấp', o).verdict).toBe('UNGROUNDED');
    expect(prov('Đặt Điểm của thẻ Login UI là 8', { type: 'SET_FIELD_VALUE', card: t('Login UI'), field: 'Điểm', value: '8' }).verdict).toBe('USER_DIRECT');
    expect(prov('Đặt Điểm của thẻ Login UI là 8', { type: 'SET_FIELD_VALUE', card: t('Login UI'), field: 'Điểm', value: '9' }).verdict).toBe('UNGROUNDED');
  });
  it('ADD_REMINDER / REMOVE_REMINDER: cần "nhắc"; mức nhắc phải là mức người dùng nói', () => {
    const add = { type: 'ADD_REMINDER', card: t('Login UI'), minutes: 60 };
    expect(lic('Nhắc tôi trước hạn 1 giờ cho thẻ Login UI', add).licensed).toBe(true);
    expect(lic('Đặt hạn thẻ Login UI là thứ sáu', add).licensed).toBe(false);
    expect(prov('Nhắc tôi trước hạn 1 giờ cho thẻ Login UI', add).verdict).toBe('USER_DIRECT');
    expect(prov('Nhắc tôi trước hạn 1 giờ cho thẻ Login UI', { ...add, minutes: 1440 }).verdict).toBe('UNGROUNDED');
    expect(lic('Bỏ nhắc hạn của thẻ Login UI', { type: 'REMOVE_REMINDER', card: t('Login UI') }).licensed).toBe(true);
  });
  it('SET_WATCH: theo dõi / bỏ theo dõi; watch không khớp câu → không cấp phép', () => {
    expect(lic('Theo dõi thẻ Login UI', { type: 'SET_WATCH', target: 'CARD', card: t('Login UI') }).licensed).toBe(true);
    expect(lic('Bỏ theo dõi cột Cần làm', { type: 'SET_WATCH', target: 'LIST', list: t('Cần làm'), watch: false }).licensed).toBe(true);
    expect(lic('Bỏ theo dõi cột Cần làm', { type: 'SET_WATCH', target: 'LIST', list: t('Cần làm') }).licensed).toBe(false);
    expect(lic('Chuyển thẻ Login UI sang Done', { type: 'SET_WATCH', target: 'CARD', card: t('Login UI') }).licensed).toBe(false);
  });
  it('thẻ mẫu: "tạo thẻ từ mẫu" có, "tạo thẻ" thường không; "lưu thẻ làm mẫu" có', () => {
    const from = { type: 'CREATE_CARD_FROM_TEMPLATE', template: 'Họp tuần', list: t('Cần làm') };
    expect(lic('Tạo thẻ từ mẫu Họp tuần trong cột Cần làm', from).licensed).toBe(true);
    expect(lic('Tạo thẻ Họp tuần trong cột Cần làm', from).licensed).toBe(false);
    expect(lic('Lưu thẻ Login UI làm thẻ mẫu', { type: 'SAVE_CARD_AS_TEMPLATE', card: t('Login UI') }).licensed).toBe(true);
    expect(lic('Lưu thẻ Login UI', { type: 'SAVE_CARD_AS_TEMPLATE', card: t('Login UI') }).licensed).toBe(false);
  });
});

describe('SET_FIELD_VALUE - giống setCardFieldValue', () => {
  it('lựa chọn / số / hộp kiểm / ngày: tự chạy, cùng dữ liệu như service', async () => {
    const f = await seedActions();
    const fd = await fields(f);
    const { a, b } = await twinCards(f);
    const run = async (message: string, value: string, field: string) => resultOf(await ask(f, message, { type: 'SET_FIELD_VALUE', card: text('Song sinh A'), field, value }));
    expect(await run('Đặt Ưu tiên của thẻ Song sinh A là Cao', 'Cao', 'Ưu tiên')).toMatchObject({ status: 'EXECUTED', autoExecuted: true, summary: 'Đã đặt trường “Ưu tiên” của thẻ “Song sinh A” thành “Cao”.' });
    await setCardFieldValue(f.owner.id, b.id, fd.priority.id, { value: fd.high.id });
    expect(await valueOf(a.id, fd.priority.id)).toEqual(await valueOf(b.id, fd.priority.id));
    expect(await valueOf(a.id, fd.priority.id)).toEqual([null, null, null, null, fd.high.id]);

    expect((await run('Đặt Điểm của thẻ Song sinh A là 8', '8', 'Điểm')).status).toBe('EXECUTED');
    await setCardFieldValue(f.owner.id, b.id, fd.score.id, { value: 8 });
    expect(await valueOf(a.id, fd.score.id)).toEqual(await valueOf(b.id, fd.score.id));

    expect((await run('Đánh dấu Hoàn tất của thẻ Song sinh A là có', 'có', 'Hoàn tất')).status).toBe('EXECUTED');
    await setCardFieldValue(f.owner.id, b.id, fd.done.id, { value: true });
    expect(await valueOf(a.id, fd.done.id)).toEqual(await valueOf(b.id, fd.done.id));

    expect((await run('Đặt Ngày họp của thẻ Song sinh A là 15/10', '15/10', 'Ngày họp')).status).toBe('EXECUTED');
    await setCardFieldValue(f.owner.id, b.id, fd.meeting.id, { value: '2026-10-15T00:00:00.000Z' });
    expect(await valueOf(a.id, fd.meeting.id)).toEqual(await valueOf(b.id, fd.meeting.id));
  });

  it('trường văn bản tự do là NỘI DUNG: luôn xem trước; xóa giá trị; đã đúng → nói rõ; giá trị sai kiểu → từ chối', async () => {
    const f = await seedActions();
    const fd = await fields(f);
    const { a } = await twinCards(f);
    const p = await preview(f, 'Đặt Ghi chú của thẻ Song sinh A là cần xem lại', [{ type: 'SET_FIELD_VALUE', card: text('Song sinh A'), field: 'Ghi chú', value: 'cần xem lại' }]);
    expect(p.plan.reasons.map((r) => r.code)).toContain('TEXT_CONTENT');
    expect(resultOf(await p.confirm()).status).toBe('EXECUTED');
    expect(await valueOf(a.id, fd.note.id)).toEqual(['cần xem lại', null, null, null, null]);
    const same = await ask(f, 'Đặt Ghi chú của thẻ Song sinh A là cần xem lại', { type: 'SET_FIELD_VALUE', card: text('Song sinh A'), field: 'Ghi chú', value: 'cần xem lại' });
    expect(resultOf(same).summary).toBe('Trường “Ghi chú” của thẻ “Song sinh A” đã là “cần xem lại” rồi.');
    const clear = await ask(f, 'Xóa Ghi chú của thẻ Song sinh A', { type: 'SET_FIELD_VALUE', card: text('Song sinh A'), field: 'Ghi chú', clear: true });
    expect(resultOf(clear).summary).toBe('Đã xóa giá trị trường “Ghi chú” của thẻ “Song sinh A”.');
    expect(await valueOf(a.id, fd.note.id)).toBeNull();
    const bad = await ask(f, 'Đặt Điểm của thẻ Song sinh A là rất cao', { type: 'SET_FIELD_VALUE', card: text('Song sinh A'), field: 'Điểm', value: 'rất cao' });
    expect(bad.answer.text).toContain('không hợp lệ cho trường “Điểm”');
  });

  it('lựa chọn không tồn tại / trùng tên → báo rõ hoặc nút chọn; bảng chưa có trường → nói rõ', async () => {
    const f = await seedActions();
    const none = await ask(f, 'Đặt Ưu tiên của thẻ Login UI là Cao', { type: 'SET_FIELD_VALUE', card: text('Login UI'), field: 'Ưu tiên', value: 'Cao' });
    expect(none.answer.text).toContain('chưa có trường tùy chỉnh nào');
    await fields(f);
    const missing = await ask(f, 'Đặt Ưu tiên của thẻ Login UI là Khẩn', { type: 'SET_FIELD_VALUE', card: text('Login UI'), field: 'Ưu tiên', value: 'Khẩn' });
    expect(missing.answer.text).toContain('Không tìm thấy lựa chọn “Khẩn”');
  });
});

describe('ADD_REMINDER / REMOVE_REMINDER - giống cardReminder.service, chỉ nhắc của chính người dùng', () => {
  it('đặt nhắc 1 giờ: tự chạy, giống addCardReminder; đã có → nói rõ; thẻ chưa có hạn → từ chối; bỏ nhắc', async () => {
    const f = await seedActions();
    const { a, b } = await twinCards(f);
    const set = await ask(f, 'Nhắc tôi trước hạn 1 giờ cho thẻ Song sinh A', { type: 'ADD_REMINDER', card: text('Song sinh A'), minutes: 60 });
    expect(resultOf(set)).toMatchObject({ status: 'EXECUTED', autoExecuted: true, summary: 'Đã đặt nhắc 1 giờ trước hạn cho thẻ “Song sinh A”.' });
    await addCardReminder(f.owner.id, b.id, 60);
    const rows = async (cardId: string) => (await prisma.cardReminder.findMany({ where: { cardId } })).map((r) => [r.userId, r.offsetMinutes, r.sentAt]);
    expect(await rows(a.id)).toEqual([[f.owner.id, 60, null]]);
    expect(await rows(a.id)).toEqual(await rows(b.id));
    expect(resultOf(await ask(f, 'Nhắc tôi trước hạn 1 giờ cho thẻ Song sinh A', { type: 'ADD_REMINDER', card: text('Song sinh A'), minutes: 60 })).summary).toBe('Bạn đã đặt nhắc 1 giờ trước hạn cho thẻ “Song sinh A” rồi.');
    const noDue = await ask(f, 'Nhắc tôi trước hạn 1 giờ cho thẻ Login UI', { type: 'ADD_REMINDER', card: text('Login UI'), minutes: 60 });
    expect(noDue.answer.text).toContain('chưa có hạn');
    const del = await ask(f, 'Bỏ nhắc hạn của thẻ Song sinh A', { type: 'REMOVE_REMINDER', card: text('Song sinh A') });
    expect(resultOf(del).summary).toBe('Đã bỏ nhắc hạn của thẻ “Song sinh A”.');
    await removeCardReminder(f.owner.id, b.id, 60);
    expect(await rows(a.id)).toEqual([]);
    expect(await rows(b.id)).toEqual([]);
  });

  it('chỉ bỏ nhắc của CHÍNH người dùng; nhắc của người khác còn nguyên', async () => {
    const f = await seedActions();
    const { a } = await twinCards(f);
    await prisma.cardReminder.createMany({ data: [{ cardId: a.id, userId: f.owner.id, offsetMinutes: 10 }, { cardId: a.id, userId: f.lan.id, offsetMinutes: 10 }] });
    expect(resultOf(await ask(f, 'Bỏ nhắc hạn của thẻ Song sinh A', { type: 'REMOVE_REMINDER', card: text('Song sinh A') })).status).toBe('EXECUTED');
    expect((await prisma.cardReminder.findMany({ where: { cardId: a.id } })).map((r) => r.userId)).toEqual([f.lan.id]);
  });
});

describe('SET_WATCH - giống watch.service', () => {
  it('theo dõi thẻ / cột / bảng và bỏ theo dõi: tự chạy, giống service; đã đúng → nói rõ', async () => {
    const f = await seedActions();
    const { a, b } = await twinCards(f);
    const card = await ask(f, 'Theo dõi thẻ Song sinh A', { type: 'SET_WATCH', target: 'CARD', card: text('Song sinh A') });
    expect(resultOf(card)).toMatchObject({ status: 'EXECUTED', autoExecuted: true, summary: 'Đã bật theo dõi thẻ “Song sinh A”.' });
    await setCardWatch(f.owner.id, b.id, true);
    expect((await prisma.watch.findMany({ where: { cardId: { in: [a.id, b.id] } } })).map((w) => w.userId)).toEqual([f.owner.id, f.owner.id]);
    expect(resultOf(await ask(f, 'Theo dõi thẻ Song sinh A', { type: 'SET_WATCH', target: 'CARD', card: text('Song sinh A') })).summary).toBe('Bạn đang theo dõi thẻ “Song sinh A” rồi.');

    const list = await ask(f, 'Theo dõi cột Đang làm', { type: 'SET_WATCH', target: 'LIST', list: text('Đang làm') });
    expect(resultOf(list).summary).toBe('Đã bật theo dõi cột “Đang làm”.');
    await setListWatch(f.owner.id, f.todo.id, true);
    const board = await ask(f, 'Theo dõi bảng này', { type: 'SET_WATCH', target: 'BOARD' });
    expect(resultOf(board).summary).toBe('Đã bật theo dõi bảng “Dự án Alpha”.');
    await setBoardWatch(f.owner.id, f.beta.id, true);
    expect(await prisma.watch.count({ where: { userId: f.owner.id, boardId: { in: [f.alpha.id, f.beta.id] } } })).toBe(2);

    const off = await ask(f, 'Bỏ theo dõi thẻ Song sinh A', { type: 'SET_WATCH', target: 'CARD', card: text('Song sinh A'), watch: false });
    expect(resultOf(off).summary).toBe('Đã bỏ theo dõi thẻ “Song sinh A”.');
    expect(await prisma.watch.count({ where: { cardId: a.id } })).toBe(0);
    expect(resultOf(await ask(f, 'Bỏ theo dõi thẻ Song sinh A', { type: 'SET_WATCH', target: 'CARD', card: text('Song sinh A'), watch: false })).summary).toBe('Bạn chưa theo dõi thẻ “Song sinh A” nên chưa cần bỏ.');
  });
});

describe('thẻ mẫu - giống cardTemplate.service', () => {
  it('tạo thẻ từ mẫu: tự chạy; mô tả + checklist lấy từ mẫu; giống applyCardTemplate; tên riêng theo chữ người dùng', async () => {
    const f = await seedActions();
    const tpl = await prisma.cardTemplate.create({
      data: { boardId: f.alpha.id, name: 'Họp tuần', description: 'Chuẩn bị nội dung họp', checklists: { create: [{ title: 'Chuẩn bị', position: 0, items: { create: [{ content: 'Soạn lịch', position: 0 }, { content: 'Gửi lời mời', position: 1 }] } }] } },
    });
    const reply = await ask(f, 'Tạo thẻ từ mẫu Họp tuần trong cột Cần làm', { type: 'CREATE_CARD_FROM_TEMPLATE', template: 'Họp tuần', list: text('Cần làm') });
    expect(resultOf(reply)).toMatchObject({ status: 'EXECUTED', autoExecuted: true, summary: 'Đã tạo thẻ “Họp tuần” từ thẻ mẫu “Họp tuần” trong cột “Cần làm”.' });
    const viaService = await applyCardTemplate(f.owner.id, f.todo.id, tpl.id, undefined);
    const shape = async (id: string) => {
      const c = await prisma.card.findUniqueOrThrow({ where: { id }, include: { checklists: { include: { items: { orderBy: { position: 'asc' } } } } } });
      return { listId: c.listId, description: c.description, status: c.status, checklists: c.checklists.map((cl) => [cl.title, cl.items.map((i) => [i.content, i.isDone])]) };
    };
    const chatCard = await prisma.card.findFirstOrThrow({ where: { title: 'Họp tuần', id: { not: viaService.id }, deletedAt: null } });
    expect(await shape(chatCard.id)).toEqual(await shape(viaService.id));
    expect((await shape(chatCard.id)).checklists).toEqual([['Chuẩn bị', [['Soạn lịch', false], ['Gửi lời mời', false]]]]);
    expect(await prisma.activity.count({ where: { cardId: chatCard.id, type: 'card.create' } })).toBe(1);

    const named = await ask(f, 'Tạo thẻ Họp quý từ mẫu Họp tuần trong cột Đang làm', { type: 'CREATE_CARD_FROM_TEMPLATE', template: 'Họp tuần', list: text('Đang làm'), title: 'Họp quý' });
    expect(resultOf(named).status).toBe('EXECUTED');
    expect(await prisma.card.findFirstOrThrow({ where: { title: 'Họp quý' } })).toMatchObject({ listId: f.doing.id, status: 'IN_PROGRESS' });
  });

  it('mẫu không có / bảng chưa có mẫu → nói rõ', async () => {
    const f = await seedActions();
    const none = await ask(f, 'Tạo thẻ từ mẫu Họp tuần trong cột Cần làm', { type: 'CREATE_CARD_FROM_TEMPLATE', template: 'Họp tuần', list: text('Cần làm') });
    expect(none.answer.text).toContain('chưa có thẻ mẫu nào');
    await prisma.cardTemplate.create({ data: { boardId: f.alpha.id, name: 'Họp tuần' } });
    const missing = await ask(f, 'Tạo thẻ từ mẫu Báo cáo trong cột Cần làm', { type: 'CREATE_CARD_FROM_TEMPLATE', template: 'Báo cáo', list: text('Cần làm') });
    expect(missing.answer.text).toContain('Không tìm thấy thẻ mẫu “Báo cáo”');
  });

  it('lưu thẻ làm mẫu: xem trước (NEW_STRUCTURE) → giống saveCardAsTemplate', async () => {
    const f = await seedActions();
    const { a, b } = await twinCards(f);
    for (const c of [a, b]) {
      await prisma.card.update({ where: { id: c.id }, data: { description: 'mô tả thẻ' } });
      await prisma.checklist.create({ data: { cardId: c.id, title: 'Kiểm', items: { create: [{ content: 'một', position: 0 }, { content: 'hai', position: 1 }] } } });
    }
    const p = await preview(f, 'Lưu thẻ Song sinh A làm thẻ mẫu Mẫu kiểm thử', [{ type: 'SAVE_CARD_AS_TEMPLATE', card: text('Song sinh A'), name: 'Mẫu kiểm thử' }]);
    expect(p.plan.reasons.map((r) => r.code)).toContain('NEW_STRUCTURE');
    expect(resultOf(await p.confirm()).summary).toBe('Đã lưu thẻ “Song sinh A” làm thẻ mẫu “Mẫu kiểm thử”.');
    await saveCardAsTemplate(f.owner.id, b.id, 'Mẫu kiểm thử 2');
    const shape = async (name: string) => {
      const tpl = await prisma.cardTemplate.findFirstOrThrow({ where: { name }, include: { checklists: { include: { items: { orderBy: { position: 'asc' } } } } } });
      return { description: tpl.description, boardId: tpl.boardId, checklists: tpl.checklists.map((c) => [c.title, c.items.map((i) => i.content)]) };
    };
    expect(await shape('Mẫu kiểm thử')).toEqual(await shape('Mẫu kiểm thử 2'));
  });
});
