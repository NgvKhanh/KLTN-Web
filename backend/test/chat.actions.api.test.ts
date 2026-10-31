// Lớp HÀNH ĐỘNG chatbot v2 - Phase 1: 7 thao tác chạy thật trên CSDL test, qua đúng service của giao diện (Activity, thông báo, socket).
// LLM được thay bằng kịch bản (script) nên kết quả tất định; phần "hiểu câu" của LLM thật được đo riêng bằng probeChatActions.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import { handleV2Message } from '../src/modules/chat/v2/chat.v2.service';
import { persistentChoice, persistentConfirm, persistentMessage } from '../src/modules/chat/v2/chat.v2.history';
import type { V2Reply } from '../src/modules/chat/v2/chat.v2.contract';
import { V2SessionStore } from '../src/modules/chat/v2/chat.v2.session';
import { ACT_NOW, actionContext, lastCard, propose, script, seedActions, text, type ActionWorld } from './chat.actions.fixture';

const mocks = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock('../src/realtime/socket', async (original) => ({ ...(await original<object>()), emitToBoard: mocks.emit }));
beforeEach(() => mocks.emit.mockClear());

const MY = { kind: 'MY' as const };
const onBoard = (f: ActionWorld) => ({ kind: 'BOARD' as const, boardId: f.alpha.id });
const planRows = () => prisma.chatActionPlan.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

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

describe('7 thao tác tự chạy khi đủ an toàn (CHAT_AUTO_EXECUTE bật)', () => {
  it('CREATE_CARD: "Tạo thẻ Họp nhóm trong cột Cần làm"', async () => {
    const f = await seedActions();
    const step = script([propose({ type: 'CREATE_CARD', title: 'Họp nhóm', list: text('Cần làm') })]);
    const reply = await handleV2Message(f.owner.id, { message: 'Tạo thẻ Họp nhóm trong cột Cần làm', scope: onBoard(f) }, actionContext({ step }));
    const result = resultOf(reply);
    expect(result).toMatchObject({ status: 'EXECUTED', autoExecuted: true, boardId: f.alpha.id });
    expect(result.summary).toBe('Đã tạo thẻ “Họp nhóm” trong cột “Cần làm”.');
    expect(reply.answer.text).toBe(result.summary);
    const card = await prisma.card.findFirstOrThrow({ where: { title: 'Họp nhóm' } });
    expect(card.listId).toBe(f.todo.id);
    expect(result.cardId).toBe(card.id);
    expect(await prisma.activity.count({ where: { cardId: card.id, type: 'card.create', userId: f.owner.id } })).toBe(1);
    expect(mocks.emit).toHaveBeenCalledWith(f.alpha.id, 'board:lists-changed');
    const [row, ...rest] = await planRows();
    expect(rest).toHaveLength(0);
    expect(row).toMatchObject({ userId: f.owner.id, boardId: f.alpha.id, status: 'EXECUTED', autoExecuted: true, provenance: 'USER_DIRECT', risk: 'LOW', requiresConfirmation: false, executedOps: 1, proposedOps: 1, scopeKind: 'BOARD', errorCode: null });
    expect(row.promptTokens).toBe(11); expect(row.completionTokens).toBe(7);
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('RENAME_CARD: "Đổi tên thẻ Login UI thành Đăng nhập giao diện"', async () => {
    const f = await seedActions();
    const step = script([propose({ type: 'RENAME_CARD', card: text('Login UI'), title: 'Đăng nhập giao diện' })]);
    const reply = await handleV2Message(f.owner.id, { message: 'Đổi tên thẻ Login UI thành Đăng nhập giao diện', scope: onBoard(f) }, actionContext({ step }));
    expect(resultOf(reply)).toMatchObject({ status: 'EXECUTED', summary: 'Đã đổi tên thẻ “Login UI” thành “Đăng nhập giao diện”.', cardId: f.loginUi.id });
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.loginUi.id } })).title).toBe('Đăng nhập giao diện');
    const activity = await prisma.activity.findFirstOrThrow({ where: { cardId: f.loginUi.id, type: 'card.rename' } });
    expect(activity).toMatchObject({ userId: f.owner.id, boardId: f.alpha.id });
    expect(activity.data).toMatchObject({ from: 'Login UI', to: 'Đăng nhập giao diện' });
    expect(mocks.emit).toHaveBeenCalledWith(f.alpha.id, 'board:lists-changed');
  });

  it('SET_CARD_DUE: "thứ sáu" = 09/10/2026 23:59 (+07:00), ghi Activity card.due.set', async () => {
    const f = await seedActions();
    const step = script([propose({ type: 'SET_CARD_DUE', card: text('Thiết kế giao diện'), due: { type: 'WEEKDAY', weekday: 5, week: 'THIS' } })]);
    const reply = await handleV2Message(f.owner.id, { message: 'Đặt hạn cho Thiết kế giao diện là thứ sáu', scope: onBoard(f) }, actionContext({ step }));
    expect(resultOf(reply)).toMatchObject({ status: 'EXECUTED', summary: 'Đã đặt hạn cho thẻ “Thiết kế giao diện”: Thứ Sáu, 09/10/2026.' });
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.design.id } })).dueDate?.toISOString()).toBe('2026-10-09T16:59:00.000Z');
    expect(await prisma.activity.count({ where: { cardId: f.design.id, type: 'card.due.set', userId: f.owner.id } })).toBe(1);
  });

  it('SET_CARD_DUE: ngày trong câu thắng ngày LLM tự tính, kèm cảnh báo', async () => {
    const f = await seedActions();
    // LLM khai nhầm "5 ngày nữa" (12/10) trong khi người dùng nói thứ sáu (09/10)
    const step = script([propose({ type: 'SET_CARD_DUE', card: text('Thiết kế giao diện'), due: { type: 'RELATIVE_DAYS', days: 5 } })]);
    const reply = await handleV2Message(f.owner.id, { message: 'Đặt hạn cho Thiết kế giao diện là thứ sáu', scope: onBoard(f) }, actionContext({ step }));
    const result = resultOf(reply);
    expect(result.status).toBe('EXECUTED');
    expect(result.warnings.join(' ')).toContain('khác với ngày AI đề xuất');
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.design.id } })).dueDate?.toISOString()).toBe('2026-10-09T16:59:00.000Z');
  });

  it('SET_CARD_DUE: "bỏ hạn" xóa hạn (card.due.clear)', async () => {
    const f = await seedActions();
    const step = script([propose({ type: 'SET_CARD_DUE', card: text('Báo cáo tuần'), due: { type: 'NONE' } })]);
    const reply = await handleV2Message(f.owner.id, { message: 'Bỏ hạn của thẻ Báo cáo tuần', scope: onBoard(f) }, actionContext({ step }));
    expect(resultOf(reply)).toMatchObject({ status: 'EXECUTED', summary: 'Đã bỏ hạn của thẻ “Báo cáo tuần”.' });
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.report.id } })).dueDate).toBeNull();
    expect(await prisma.activity.count({ where: { cardId: f.report.id, type: 'card.due.clear' } })).toBe(1);
  });

  it('MOVE_CARD: "Chuyển task Login UI sang Đang làm" - đi theo cột nên trạng thái đổi theo (quy tắc hai chiều của cột)', async () => {
    const f = await seedActions();
    const step = script([propose({ type: 'MOVE_CARD', card: text('task Login UI'), toList: text('Đang làm') })]);
    const reply = await handleV2Message(f.owner.id, { message: 'Chuyển task Login UI sang Đang làm', scope: onBoard(f) }, actionContext({ step }));
    expect(resultOf(reply)).toMatchObject({ status: 'EXECUTED', summary: 'Đã chuyển thẻ “Login UI” từ cột “Cần làm” sang “Đang làm”.' });
    const card = await prisma.card.findUniqueOrThrow({ where: { id: f.loginUi.id } });
    expect(card).toMatchObject({ listId: f.doing.id, status: 'IN_PROGRESS' });
    expect(await prisma.activity.count({ where: { cardId: f.loginUi.id, type: 'card.move', userId: f.owner.id } })).toBe(1);
    // thẻ được đặt CUỐI cột đích: không trùng vị trí với thẻ có sẵn
    const positions = (await prisma.card.findMany({ where: { listId: f.doing.id, deletedAt: null } })).map((c) => c.position);
    expect(new Set(positions).size).toBe(positions.length);
  });

  it('MOVE_CARD: chuyển sang cột khớp theo TRẠNG THAI ("Đang thực hiện" → cột Đang làm) khi không có cột trùng tên', async () => {
    const f = await seedActions();
    const step = script([propose({ type: 'MOVE_CARD', card: text('Thiết kế giao diện'), toList: text('Đang thực hiện') })]);
    const reply = await handleV2Message(f.owner.id, { message: 'Chuyển Thiết kế giao diện sang Đang thực hiện', scope: onBoard(f) }, actionContext({ step }));
    expect(resultOf(reply).status).toBe('EXECUTED');
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.design.id } })).listId).toBe(f.doing.id);
  });

  it('SET_CARD_STATUS: "xong" → DONE; thẻ tự chuyển sang cột Hoàn thành, isDone/completedAt nhất quán', async () => {
    const f = await seedActions();
    const step = script([propose({ type: 'SET_CARD_STATUS', card: text('Báo cáo tuần'), status: 'DONE' })]);
    const reply = await handleV2Message(f.owner.id, { message: 'Đánh dấu Báo cáo tuần là xong', scope: onBoard(f) }, actionContext({ step }));
    const result = resultOf(reply);
    expect(result.status).toBe('EXECUTED');
    expect(result.summary).toContain('Đã đổi trạng thái thẻ “Báo cáo tuần” thành “Hoàn thành”.');
    expect(result.summary).toContain('Thẻ tự chuyển sang cột “Hoàn thành”.');
    const card = await prisma.card.findUniqueOrThrow({ where: { id: f.report.id } });
    expect(card).toMatchObject({ status: 'DONE', isDone: true, listId: f.done.id });
    expect(card.completedAt).not.toBeNull();
  });

  it('ASSIGN_MEMBER: "Giao Thiết kế giao diện cho Lan" - ghi người giao, Activity và gửi thông báo cho Lan', async () => {
    const f = await seedActions();
    const step = script([propose({ type: 'ASSIGN_MEMBER', card: text('Thiết kế giao diện'), member: text('Lan') })]);
    const reply = await handleV2Message(f.owner.id, { message: 'Giao Thiết kế giao diện cho Lan', scope: onBoard(f) }, actionContext({ step }));
    expect(resultOf(reply)).toMatchObject({ status: 'EXECUTED', summary: 'Đã giao thẻ “Thiết kế giao diện” cho Nguyễn Lan.' });
    expect(await prisma.cardMember.findFirstOrThrow({ where: { cardId: f.design.id, userId: f.lan.id } })).toMatchObject({ assignedById: f.owner.id });
    expect(await prisma.activity.count({ where: { cardId: f.design.id, type: 'member.add', userId: f.owner.id } })).toBe(1);
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: f.lan.id, type: 'card.member.added' } });
    expect(note).toMatchObject({ actorId: f.owner.id, cardId: f.design.id, boardId: f.alpha.id });
  });

  it('ASSIGN_MEMBER: "tôi" → chính người hỏi (không gửi thông báo cho chính mình)', async () => {
    const f = await seedActions();
    const step = script([propose({ type: 'ASSIGN_MEMBER', card: text('Thiết kế giao diện'), member: { by: 'SELF' } })]);
    const reply = await handleV2Message(f.lan.id, { message: 'Giao Thiết kế giao diện cho tôi', scope: onBoard(f) }, actionContext({ step }));
    expect(resultOf(reply).status).toBe('EXECUTED');
    expect(await prisma.cardMember.count({ where: { cardId: f.design.id, userId: f.lan.id } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: f.lan.id, type: 'card.member.added' } })).toBe(0);
  });

  it('ADD_LABEL: "Gắn nhãn Backend vào Thiết kế giao diện"', async () => {
    const f = await seedActions();
    const step = script([propose({ type: 'ADD_LABEL', card: text('Thiết kế giao diện'), label: text('Backend') })]);
    const reply = await handleV2Message(f.owner.id, { message: 'Gắn nhãn Backend vào Thiết kế giao diện', scope: onBoard(f) }, actionContext({ step }));
    expect(resultOf(reply)).toMatchObject({ status: 'EXECUTED', summary: 'Đã gắn nhãn “Backend” vào thẻ “Thiết kế giao diện”.' });
    expect(await prisma.cardLabel.count({ where: { cardId: f.design.id, labelId: f.backend.id } })).toBe(1);
    expect(mocks.emit).toHaveBeenCalledWith(f.alpha.id, 'board:lists-changed');
  });

  it('thao tác KHÔNG đổi gì (đã đúng rồi) thì không gọi service, không ghi Activity, nói rõ "đã đúng rồi"', async () => {
    const f = await seedActions();
    await prisma.cardLabel.create({ data: { cardId: f.design.id, labelId: f.backend.id } });
    await prisma.cardMember.create({ data: { cardId: f.design.id, userId: f.lan.id } });
    const cases: Array<[string, unknown, string]> = [
      ['Gắn nhãn Backend vào Thiết kế giao diện', { type: 'ADD_LABEL', card: text('Thiết kế giao diện'), label: text('Backend') }, 'Thẻ “Thiết kế giao diện” đã có nhãn “Backend” rồi.'],
      ['Giao Thiết kế giao diện cho Lan', { type: 'ASSIGN_MEMBER', card: text('Thiết kế giao diện'), member: text('Lan') }, 'Nguyễn Lan đã được giao thẻ “Thiết kế giao diện” rồi.'],
      ['Chuyển Login UI sang Cần làm', { type: 'MOVE_CARD', card: text('Login UI'), toList: text('Cần làm') }, 'Thẻ “Login UI” đã ở cột “Cần làm” rồi.'],
      ['Đặt hạn Báo cáo tuần là 09/10', { type: 'SET_CARD_DUE', card: text('Báo cáo tuần'), due: { type: 'ABSOLUTE', date: '2026-10-09' } }, 'Hạn của thẻ “Báo cáo tuần” đã là Thứ Sáu, 09/10/2026 rồi.'],
      ['Bỏ hạn thẻ Thiết kế giao diện', { type: 'SET_CARD_DUE', card: text('Thiết kế giao diện'), due: { type: 'NONE' } }, 'Thẻ “Thiết kế giao diện” chưa có hạn nên không cần bỏ.'],
      ['Đổi tên thẻ Login UI thành Login UI', { type: 'RENAME_CARD', card: text('Login UI'), title: 'Login UI' }, 'Thẻ “Login UI” đã có tên này rồi nên chưa cần đổi.'],
    ];
    const before = await prisma.activity.count();
    for (const [message, op, expected] of cases) {
      const reply = await handleV2Message(f.owner.id, { message, scope: onBoard(f) }, actionContext({ step: script([propose(op)]) }));
      expect(resultOf(reply), message).toMatchObject({ status: 'EXECUTED', summary: expected });
    }
    expect(await prisma.activity.count()).toBe(before);
    expect(await prisma.cardLabel.count({ where: { cardId: f.design.id } })).toBe(1);
    expect(await prisma.cardMember.count({ where: { cardId: f.design.id } })).toBe(1);
    const rows = await planRows();
    expect(rows.every((r) => r.status === 'EXECUTED' && r.executedOps === 0)).toBe(true);
  });

  it('dùng đúng service của giao diện: thẻ chuyển vào cột có luật tự động hóa thì luật cũng chạy', async () => {
    const f = await seedActions();
    const rule = await prisma.automationRule.create({ data: { boardId: f.alpha.id, createdById: f.owner.id, name: 'Vào Đang làm thì gắn Gấp', triggerType: 'CARD_MOVED_TO_LIST', triggerListId: f.doing.id } });
    await prisma.automationAction.create({ data: { ruleId: rule.id, type: 'ADD_LABEL', labelId: f.urgent.id } });
    const step = script([propose({ type: 'MOVE_CARD', card: text('Login UI'), toList: text('Đang làm') })]);
    const reply = await handleV2Message(f.owner.id, { message: 'Chuyển Login UI sang Đang làm', scope: onBoard(f) }, actionContext({ step }));
    expect(resultOf(reply).status).toBe('EXECUTED');
    expect(await prisma.cardLabel.count({ where: { cardId: f.loginUi.id, labelId: f.urgent.id } })).toBe(1);
  });

  it('ngôn ngữ tự nhiên khác nhau cùng ra đúng thao tác (động từ đồng nghĩa)', async () => {
    const f = await seedActions();
    const cases: Array<[string, unknown]> = [
      ['Thêm task Họp tuần vào cột Cần làm', { type: 'CREATE_CARD', title: 'Họp tuần', list: text('Cần làm') }],
      ['Kéo Login UI vào Đang làm', { type: 'MOVE_CARD', card: text('Login UI'), toList: text('Đang làm') }],
      ['Phân công Tuấn làm Thiết kế giao diện', { type: 'ASSIGN_MEMBER', card: text('Thiết kế giao diện'), member: text('Tuấn') }],
      ['Thêm nhãn Gấp cho API thanh toán', { type: 'ADD_LABEL', card: text('API thanh toán'), label: text('Gấp') }],
    ];
    for (const [message, op] of cases) {
      const reply = await handleV2Message(f.owner.id, { message, scope: onBoard(f) }, actionContext({ step: script([propose(op)]) }));
      expect(resultOf(reply), message).toMatchObject({ status: 'EXECUTED', autoExecuted: true });
    }
    expect(await prisma.card.count({ where: { title: 'Họp tuần', listId: f.todo.id } })).toBe(1);
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.loginUi.id } })).listId).toBe(f.doing.id);
    expect(await prisma.cardMember.count({ where: { cardId: f.design.id, userId: f.tuan.id } })).toBe(1);
    expect(await prisma.cardLabel.count({ where: { cardId: f.payment.id, labelId: f.urgent.id } })).toBe(1);
  });
});

describe('xem trước rồi bấm Áp dụng (CHAT_AUTO_EXECUTE tắt hoặc lệnh chưa đủ chắc chắn)', () => {
  it('autoExecute tắt: có khối xem trước, CSDL chưa đổi gì; bấm Áp dụng mới chạy và ghi Activity một lần', async () => {
    const f = await seedActions();
    const sessions = new V2SessionStore();
    const step = script([propose({ type: 'RENAME_CARD', card: text('Login UI'), title: 'Đăng nhập giao diện' })]);
    const reply = await persistentMessage(f.owner.id, { message: 'Đổi tên thẻ Login UI thành Đăng nhập giao diện', scope: onBoard(f) }, actionContext({ step, sessions, autoExecute: false }));
    const plan = planOf(reply);
    expect(plan).toMatchObject({ status: 'PROPOSED', risk: 'LOW', requiresConfirmation: true, canConfirm: true, boardId: f.alpha.id, boardName: 'Dự án Alpha' });
    expect(plan.reasons.map((r) => r.code)).toEqual(['AUTO_DISABLED']);
    expect(plan.items).toEqual([expect.objectContaining({ verb: 'Đổi tên thẻ', text: '“Login UI” → “Đăng nhập giao diện”', cardId: f.loginUi.id })]);
    expect(plan.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(new Date(plan.expiresAt).getTime()).toBe(ACT_NOW.getTime() + 10 * 60_000);
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.loginUi.id } })).title).toBe('Login UI');
    expect(await prisma.activity.count({ where: { type: 'card.rename' } })).toBe(0);

    const confirmed = await persistentConfirm(f.owner.id, plan.planId, { conversationId: reply.conversationId, checksum: plan.checksum, scope: onBoard(f) }, actionContext({ sessions, now: new Date(ACT_NOW.getTime() + 60_000) }));
    expect(resultOf(confirmed)).toMatchObject({ planId: plan.planId, status: 'EXECUTED', autoExecuted: false, summary: 'Đã đổi tên thẻ “Login UI” thành “Đăng nhập giao diện”.' });
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.loginUi.id } })).title).toBe('Đăng nhập giao diện');
    expect(await prisma.activity.count({ where: { type: 'card.rename', cardId: f.loginUi.id } })).toBe(1);
    expect(await prisma.chatActionPlan.findUniqueOrThrow({ where: { id: plan.planId } })).toMatchObject({ status: 'EXECUTED', autoExecuted: false, executedOps: 1 });
    // lịch sử hội thoại có thêm một lượt "Áp dụng: ..."
    const turns = await prisma.chatTurn.findMany({ where: { conversationId: reply.conversationId }, orderBy: { id: 'asc' } });
    expect(turns.map((t) => t.question)).toEqual(['Đổi tên thẻ Login UI thành Đăng nhập giao diện', expect.stringMatching(/^Áp dụng: Đổi tên thẻ/)]);
  });

  it('bấm Áp dụng lần hai (hoặc từ tab khác): trả lại kết quả đã lưu, đánh dấu alreadyApplied, không ghi lại', async () => {
    const f = await seedActions();
    const sessions = new V2SessionStore();
    const step = script([propose({ type: 'ADD_LABEL', card: text('Thiết kế giao diện'), label: text('Gấp') })]);
    const reply = await persistentMessage(f.owner.id, { message: 'Gắn nhãn Gấp vào Thiết kế giao diện', scope: onBoard(f) }, actionContext({ step, sessions, autoExecute: false }));
    const plan = planOf(reply);
    const body = { conversationId: reply.conversationId, checksum: plan.checksum, scope: onBoard(f) };
    const first = await persistentConfirm(f.owner.id, plan.planId, body, actionContext({ sessions }));
    const second = await persistentConfirm(f.owner.id, plan.planId, body, actionContext({ sessions: new V2SessionStore() })); // như sau khi máy chủ khởi động lại
    expect(resultOf(first).alreadyApplied).toBeUndefined();
    expect(resultOf(second)).toMatchObject({ status: 'EXECUTED', alreadyApplied: true, summary: resultOf(first).summary });
    expect(await prisma.cardLabel.count({ where: { cardId: f.design.id } })).toBe(1);
  });

  it('ngày mơ hồ ("cuối tuần") luôn xem trước, ghi rõ ngày đã hiểu; sau khi áp dụng hạn là Chủ nhật 11/10 23:59', async () => {
    const f = await seedActions();
    const sessions = new V2SessionStore();
    const step = script([propose({ type: 'SET_CARD_DUE', card: text('Thiết kế giao diện'), due: { type: 'END_OF_WEEK' } })]);
    const reply = await persistentMessage(f.owner.id, { message: 'Đặt hạn Thiết kế giao diện là cuối tuần', scope: onBoard(f) }, actionContext({ step, sessions }));
    const plan = planOf(reply);
    expect(plan.reasons.map((r) => r.code)).toEqual(['FUZZY_DATE']);
    expect(plan).toMatchObject({ risk: 'MEDIUM', canConfirm: true });
    expect(plan.items[0].detail).toBe('Chủ nhật, 11/10/2026');
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.design.id } })).dueDate).toBeNull();
    await persistentConfirm(f.owner.id, plan.planId, { conversationId: reply.conversationId, checksum: plan.checksum, scope: onBoard(f) }, actionContext({ sessions }));
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.design.id } })).dueDate?.toISOString()).toBe('2026-10-11T16:59:00.000Z');
  });

  it('tiêu đề mô hình tự diễn đạt lại (không có trong câu) → xem trước với lý do NOT_GROUNDED', async () => {
    const f = await seedActions();
    const step = script([propose({ type: 'CREATE_CARD', title: 'Họp nhóm thứ ba', list: text('Cần làm') })]);
    const reply = await handleV2Message(f.owner.id, { message: 'Tạo thẻ họp nhóm trong cột Cần làm', scope: onBoard(f) }, actionContext({ step }));
    const plan = planOf(reply);
    expect(plan.reasons.map((r) => r.code)).toEqual(['NOT_GROUNDED']);
    expect(plan.risk).toBe('MEDIUM');
    expect(await prisma.card.count({ where: { title: { contains: 'Họp nhóm' } } })).toBe(0);
    expect(await planRows()).toMatchObject([{ status: 'PROPOSED', provenance: 'UNGROUNDED', autoExecuted: false, requiresConfirmation: true }]);
  });

  it('câu dạng hỏi ("Có nên chuyển ... không?") → xem trước với lý do QUESTION_FORM, không tự chạy', async () => {
    const f = await seedActions();
    const step = script([propose({ type: 'MOVE_CARD', card: text('Login UI'), toList: text('Đang làm') })]);
    const reply = await handleV2Message(f.owner.id, { message: 'Có nên chuyển Login UI sang Đang làm không?', scope: onBoard(f) }, actionContext({ step }));
    expect(planOf(reply).reasons.map((r) => r.code)).toEqual(['QUESTION_FORM']);
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.loginUi.id } })).listId).toBe(f.todo.id);
  });

  it('thao tác không đổi gì thì khỏi hỏi xác nhận dù autoExecute tắt', async () => {
    const f = await seedActions();
    const step = script([propose({ type: 'MOVE_CARD', card: text('Login UI'), toList: text('Cần làm') })]);
    const reply = await handleV2Message(f.owner.id, { message: 'Chuyển Login UI sang Cần làm', scope: onBoard(f) }, actionContext({ step, autoExecute: false }));
    expect(resultOf(reply)).toMatchObject({ status: 'EXECUTED', summary: 'Thẻ “Login UI” đã ở cột “Cần làm” rồi.' });
  });
});

describe('tham chiếu nhập nhằng → nút chọn, KHÔNG gọi lại LLM', () => {
  it('"Chuyển Login sang Đang làm": hai thẻ Login trong bảng (không lẫn thẻ cùng tên ở bảng khác) → chọn → chạy đúng kế hoạch đang dở', async () => {
    const f = await seedActions();
    const sessions = new V2SessionStore();
    const step = script([propose({ type: 'MOVE_CARD', card: text('Login'), toList: text('Đang làm') })]);
    const ctx = actionContext({ step, sessions });
    const first = await persistentMessage(f.owner.id, { message: 'Chuyển Login sang Đang làm', scope: onBoard(f) }, ctx);
    expect(first.answer.kind).toBe('CLARIFY');
    const labels = first.answer.clarify!.options.map((o) => o.label).sort();
    expect(labels).toEqual(['Login API · Đang làm', 'Login UI · Cần làm']);
    expect(JSON.stringify(first)).not.toContain('Login Beta');
    expect(first.answer.action).toBeUndefined();
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.loginUi.id } })).listId).toBe(f.todo.id);
    const [pending] = await planRows();
    expect(pending).toMatchObject({ status: 'NEEDS_CHOICE', boardId: f.alpha.id });

    // chọn sau khi máy chủ khởi động lại (phiên mới, trạng thái đọc từ CSDL)
    const choice = first.answer.clarify!.options.find((o) => o.label.startsWith('Login UI'))!;
    const done = await persistentChoice(f.owner.id, { conversationId: first.conversationId, optionId: choice.id }, actionContext({ sessions: new V2SessionStore(), step }));
    expect(resultOf(done)).toMatchObject({ planId: pending.id, status: 'EXECUTED', autoExecuted: true, cardId: f.loginUi.id });
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.loginUi.id } })).listId).toBe(f.doing.id);
    expect(step).toHaveBeenCalledTimes(1); // chọn bằng nút KHÔNG gọi lại LLM
    expect(await planRows()).toHaveLength(1); // cùng một kế hoạch, không sinh bản ghi thứ hai
    expect(await prisma.chatActionPlan.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: 'EXECUTED', autoExecuted: true });
  });

  it('lựa chọn không nằm trong danh sách (ví dụ id thẻ của bảng khác) bị từ chối 400', async () => {
    const f = await seedActions();
    const sessions = new V2SessionStore();
    const step = script([propose({ type: 'MOVE_CARD', card: text('Login'), toList: text('Đang làm') })]);
    const ctx = actionContext({ step, sessions });
    const first = await persistentMessage(f.owner.id, { message: 'Chuyển Login sang Đang làm', scope: onBoard(f) }, ctx);
    await expect(persistentChoice(f.owner.id, { conversationId: first.conversationId, optionId: f.loginBeta.id }, ctx)).rejects.toMatchObject({ statusCode: 400 });
    await expect(persistentChoice(f.owner.id, { conversationId: first.conversationId, optionId: f.secretCard.id }, ctx)).rejects.toMatchObject({ statusCode: 400 });
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.loginBeta.id } })).listId).toBe(f.betaTodo.id);
  });

  it('chọn sau khi kế hoạch hết hạn (10 phút) → 409 và không chạy gì', async () => {
    const f = await seedActions();
    const sessions = new V2SessionStore();
    const step = script([propose({ type: 'MOVE_CARD', card: text('Login'), toList: text('Đang làm') })]);
    const first = await persistentMessage(f.owner.id, { message: 'Chuyển Login sang Đang làm', scope: onBoard(f) }, actionContext({ step, sessions }));
    const late = actionContext({ sessions, now: new Date(ACT_NOW.getTime() + 11 * 60_000) });
    await expect(persistentChoice(f.owner.id, { conversationId: first.conversationId, optionId: first.answer.clarify!.options[0].id }, late)).rejects.toMatchObject({ statusCode: 409 });
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.loginUi.id } })).listId).toBe(f.todo.id);
    expect((await planRows())[0].status).toBe('EXPIRED');
  });

  it('quá nhiều thẻ khớp (> 8) → không hiện nút, yêu cầu nêu rõ hơn', async () => {
    const f = await seedActions();
    for (let i = 1; i <= 9; i += 1) await prisma.card.create({ data: { listId: f.todo.id, title: `Báo lỗi ${i}` } });
    const step = script([propose({ type: 'MOVE_CARD', card: text('Báo lỗi'), toList: text('Đang làm') })]);
    const reply = await handleV2Message(f.owner.id, { message: 'Chuyển Báo lỗi sang Đang làm', scope: onBoard(f) }, actionContext({ step }));
    expect(reply.answer.clarify).toBeUndefined();
    expect(reply.answer.text).toContain('Có 9 thẻ khớp');
    expect(reply.answer.text).toContain('Chưa thay đổi gì');
    expect(await planRows()).toMatchObject([{ status: 'FAILED', errorCode: 'AMBIGUOUS' }]);
  });
});

describe('tạo thẻ mà không nói cột nào', () => {
  it('bảng nhiều cột → hỏi bằng nút (không tự chọn cột), chọn xong mới tạo, không gọi lại LLM', async () => {
    const f = await seedActions();
    const sessions = new V2SessionStore();
    const step = script([propose({ type: 'CREATE_CARD', title: 'Họp tuần' })]);
    const first = await persistentMessage(f.owner.id, { message: 'Thêm task Họp tuần', scope: onBoard(f) }, actionContext({ step, sessions }));
    expect(first.answer.kind).toBe('CLARIFY');
    expect(first.answer.clarify!.question).toBe('Bạn muốn tạo thẻ trong cột nào?');
    expect(first.answer.clarify!.options.map((o) => o.label)).toEqual(['Cần làm', 'Đang làm', 'Hoàn thành']);
    expect(await prisma.card.count({ where: { title: 'Họp tuần' } })).toBe(0);
    const pick = first.answer.clarify!.options.find((o) => o.label === 'Đang làm')!;
    const done = await persistentChoice(f.owner.id, { conversationId: first.conversationId, optionId: pick.id }, actionContext({ step, sessions }));
    expect(resultOf(done)).toMatchObject({ status: 'EXECUTED', summary: 'Đã tạo thẻ “Họp tuần” trong cột “Đang làm”.' });
    expect((await prisma.card.findFirstOrThrow({ where: { title: 'Họp tuần' } })).listId).toBe(f.doing.id);
    expect(step).toHaveBeenCalledTimes(1);
  });

  it('bảng chỉ có một cột → dùng luôn cột đó', async () => {
    const f = await seedActions();
    const solo = await prisma.board.create({ data: { name: 'Bảng một cột', workspaceId: f.ws.id, ownerId: f.owner.id, visibility: 'PRIVATE', lists: { create: { name: 'Việc cần làm' } } }, include: { lists: true } });
    const step = script([propose({ type: 'CREATE_CARD', title: 'Họp tuần' })]);
    const reply = await handleV2Message(f.owner.id, { message: 'Thêm task Họp tuần', scope: { kind: 'BOARD', boardId: solo.id } }, actionContext({ step }));
    expect(resultOf(reply).status).toBe('EXECUTED');
    expect((await prisma.card.findFirstOrThrow({ where: { title: 'Họp tuần' } })).listId).toBe(solo.lists[0].id);
  });

  it('mô hình tự bịa cột mà người dùng không nói → xem trước (NOT_GROUNDED), không tự chạy', async () => {
    const f = await seedActions();
    const step = script([propose({ type: 'CREATE_CARD', title: 'Họp tuần', list: text('Cần làm') })]);
    const reply = await handleV2Message(f.owner.id, { message: 'Thêm task Họp tuần', scope: onBoard(f) }, actionContext({ step }));
    expect(planOf(reply).reasons.map((r) => r.code)).toEqual(['NOT_GROUNDED']);
    expect(await prisma.card.count({ where: { title: 'Họp tuần' } })).toBe(0);
  });

  it('bảng có hơn 8 cột → yêu cầu nói rõ tên cột, không cắt danh sách âm thầm', async () => {
    const f = await seedActions();
    for (let i = 1; i <= 7; i += 1) await prisma.list.create({ data: { boardId: f.alpha.id, name: `Cột phụ ${i}`, position: 10 + i } });
    const step = script([propose({ type: 'CREATE_CARD', title: 'Họp tuần' })]);
    const reply = await handleV2Message(f.owner.id, { message: 'Thêm task Họp tuần', scope: onBoard(f) }, actionContext({ step }));
    expect(reply.answer.clarify).toBeUndefined();
    expect(reply.answer.text).toBe('Hãy nói rõ tên cột. Chưa thay đổi gì.');
  });
});

describe('không tìm thấy / sai đối tượng → từ chối rõ ràng, không đoán, không ghi', () => {
  it('thẻ, cột, người, nhãn không có trong bảng → NOT_FOUND và "Chưa thay đổi gì"', async () => {
    const f = await seedActions();
    const cases: Array<[string, unknown, string]> = [
      ['Chuyển Thẻ Không Tồn Tại sang Đang làm', { type: 'MOVE_CARD', card: text('Thẻ Không Tồn Tại'), toList: text('Đang làm') }, 'Không tìm thấy thẻ “Thẻ Không Tồn Tại”'],
      ['Chuyển Login UI sang Cột Không Có', { type: 'MOVE_CARD', card: text('Login UI'), toList: text('Cột Không Có') }, 'Không tìm thấy cột “Cột Không Có”'],
      ['Giao Login UI cho Người Lạ', { type: 'ASSIGN_MEMBER', card: text('Login UI'), member: text('Người Lạ') }, 'Không tìm thấy thành viên “Người Lạ”'],
      ['Gắn nhãn Không Có vào Login UI', { type: 'ADD_LABEL', card: text('Login UI'), label: text('Không Có') }, 'Không tìm thấy nhãn “Không Có”'],
      ['Chuyển nó sang Đang làm', { type: 'MOVE_CARD', card: lastCard, toList: text('Đang làm') }, 'Không tìm thấy thẻ “thẻ vừa nhắc”'],
    ];
    for (const [message, op, expected] of cases) {
      const reply = await handleV2Message(f.owner.id, { message, scope: onBoard(f) }, actionContext({ step: script([propose(op)]) }));
      expect(reply.answer.action, message).toBeUndefined();
      expect(reply.answer.text, message).toContain(expected);
      expect(reply.answer.text, message).toContain('Chưa thay đổi gì');
    }
    const rows = await planRows();
    expect(rows).toHaveLength(cases.length);
    expect(rows.every((r) => r.status === 'FAILED' && r.errorCode === 'NOT_FOUND')).toBe(true);
    expect(await prisma.cardMember.count()).toBe(0);
    expect(await prisma.cardLabel.count()).toBe(0);
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.loginUi.id } })).listId).toBe(f.todo.id);
  });
});

describe('"nó": ngữ cảnh hội thoại', () => {
  it('sau một thao tác, "nó" là thẻ vừa thao tác; slot được kiểm lại mỗi lần dùng', async () => {
    const f = await seedActions();
    const sessions = new V2SessionStore();
    const ctxFor = (step: ReturnType<typeof script>) => actionContext({ step, sessions });
    const first = await persistentMessage(f.owner.id, { message: 'Đổi tên thẻ Login UI thành Đăng nhập giao diện', scope: onBoard(f) }, ctxFor(script([propose({ type: 'RENAME_CARD', card: text('Login UI'), title: 'Đăng nhập giao diện' })])));
    expect(resultOf(first).status).toBe('EXECUTED');
    const second = await persistentMessage(f.owner.id, { message: 'Chuyển nó sang Đang làm', scope: onBoard(f), conversationId: first.conversationId }, ctxFor(script([propose({ type: 'MOVE_CARD', card: lastCard, toList: text('Đang làm') })])));
    expect(resultOf(second)).toMatchObject({ status: 'EXECUTED', cardId: f.loginUi.id });
    expect(second.answer.text).toContain('“Đăng nhập giao diện”');
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.loginUi.id } })).listId).toBe(f.doing.id);
  });

  it('thẻ được nhắc trước đó bị lưu trữ → cuộc trò chuyện KHÔNG bị kẹt, "nó" không còn dùng được', async () => {
    const f = await seedActions();
    const sessions = new V2SessionStore();
    const first = await persistentMessage(f.owner.id, { message: 'Đổi tên thẻ Login UI thành Đăng nhập giao diện', scope: onBoard(f) }, actionContext({ sessions, step: script([propose({ type: 'RENAME_CARD', card: text('Login UI'), title: 'Đăng nhập giao diện' })]) }));
    expect(resultOf(first).status).toBe('EXECUTED');
    await prisma.card.update({ where: { id: f.loginUi.id }, data: { archivedAt: ACT_NOW } });
    const second = await persistentMessage(f.owner.id, { message: 'Chuyển nó sang Đang làm', scope: onBoard(f), conversationId: first.conversationId }, actionContext({ sessions, step: script([propose({ type: 'MOVE_CARD', card: lastCard, toList: text('Đang làm') })]) }));
    expect(second.answer.text).toContain('Không tìm thấy thẻ');
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.loginUi.id } })).listId).toBe(f.todo.id);
    // hỏi tiếp một câu khác vẫn được
    const third = await persistentMessage(f.owner.id, { message: 'Chuyển Login API sang Cần làm', scope: onBoard(f), conversationId: first.conversationId }, actionContext({ sessions, step: script([propose({ type: 'MOVE_CARD', card: text('Login API'), toList: text('Cần làm') })]) }));
    expect(resultOf(third).status).toBe('EXECUTED');
  });
});

describe('lệnh lặp / lệnh nối tiếp trong một hội thoại', () => {
  it('nhiều lệnh nối tiếp: mỗi lệnh một kế hoạch riêng, lệnh sau không làm hỏng lệnh trước', async () => {
    const f = await seedActions();
    const sessions = new V2SessionStore();
    let conversationId: string | undefined;
    const lines: Array<[string, unknown]> = [
      ['Tạo thẻ Họp nhóm trong cột Cần làm', { type: 'CREATE_CARD', title: 'Họp nhóm', list: text('Cần làm') }],
      ['Giao Họp nhóm cho Lan', { type: 'ASSIGN_MEMBER', card: text('Họp nhóm'), member: text('Lan') }],
      ['Gắn nhãn Gấp vào Họp nhóm', { type: 'ADD_LABEL', card: text('Họp nhóm'), label: text('Gấp') }],
      ['Đặt hạn Họp nhóm là ngày mai', { type: 'SET_CARD_DUE', card: text('Họp nhóm'), due: { type: 'RELATIVE_DAYS', days: 1 } }],
      ['Chuyển Họp nhóm sang Đang làm', { type: 'MOVE_CARD', card: text('Họp nhóm'), toList: text('Đang làm') }],
    ];
    for (const [message, op] of lines) {
      const reply = await persistentMessage(f.owner.id, { message, scope: onBoard(f), ...(conversationId ? { conversationId } : {}) }, actionContext({ sessions, step: script([propose(op)]) }));
      conversationId = reply.conversationId;
      expect(resultOf(reply), message).toMatchObject({ status: 'EXECUTED' });
    }
    const card = await prisma.card.findFirstOrThrow({ where: { title: 'Họp nhóm' }, include: { members: true, labels: true } });
    expect(card).toMatchObject({ listId: f.doing.id, status: 'IN_PROGRESS' });
    expect(card.members.map((m) => m.userId)).toEqual([f.lan.id]);
    expect(card.labels.map((l) => l.labelId)).toEqual([f.urgent.id]);
    expect(card.dueDate?.toISOString()).toBe('2026-10-08T16:59:00.000Z');
    expect((await planRows()).map((r) => r.status)).toEqual(['EXECUTED', 'EXECUTED', 'EXECUTED', 'EXECUTED', 'EXECUTED']);
    expect(await prisma.chatTurn.count({ where: { conversationId } })).toBe(5);
  });
});
