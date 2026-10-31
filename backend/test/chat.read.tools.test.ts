// Phase 4 - công cụ ĐỌC mở rộng của chatbot v2: get_board_overview, get_card_details, query_catalog (LISTS / LABELS / CUSTOM_FIELDS),
// donePercent của aggregate_tasks, resolve_entities (CUSTOM_FIELD / FIELD_OPTION, parentName của thẻ), bộ lọc theo giá trị trường, nhận xét AI
// từ số đã tính, và các rào: trần phạm vi, quyền, không lộ trường ngoài danh sách cho phép, mô tả thẻ KHÔNG gửi cho mô hình.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import { conversationHistory, persistentMessage } from '../src/modules/chat/v2/chat.v2.history';
import { modelView, executeChatTool, type ToolResult } from '../src/modules/chat/v2/chat.v2.tools';
import { numbersIn } from '../src/modules/chat/v2/chat.v2.orchestrator';
import { modelTools, MODEL_SCHEMAS } from '../src/modules/chat/v2/chat.v2.registry';
import { TOOL_SCHEMAS } from '../src/modules/chat/v2/chat.v2.schema';
import type { ModelMessage } from '../src/modules/chat/v2/chat.v2.llm';
import { V2SessionStore } from '../src/modules/chat/v2/chat.v2.session';
import { ACT_NOW, actionContext, script, seedActions } from './chat.actions.fixture';

const ZW = String.fromCodePoint(0x200b); // zero-width space: mô tả có ký tự vô hình phải được làm sạch
const ZWNJ = String.fromCodePoint(0x200c);

beforeEach(() => vi.restoreAllMocks());

const onBoard = (boardId: string) => ({ kind: 'BOARD' as const, boardId });
const ctxOf = (userId: string, scope: ReturnType<typeof onBoard> | { kind: 'MY' }) => ({ userId, now: ACT_NOW, scope });
const run = <K extends keyof typeof TOOL_SCHEMAS>(f: { userId: string; scope: Parameters<typeof ctxOf>[1] }, name: K, input: Record<string, unknown> = {}) =>
  executeChatTool(ctxOf(f.userId, f.scope), name, input);

/**
 * Thế giới đọc: bảng Alpha có 5 thẻ sống (1 xong, 1 bị chặn, 1 quá hạn, 2 chưa giao), 1 thẻ lưu trữ, 1 thẻ xóa, 1 cột lưu trữ có thẻ;
 * 2 nhãn; 5 trường tùy chỉnh đủ kiểu; thẻ Login UI có mô tả dài, bình luận, tệp, checklist.
 */
async function seedRead() {
  const f = await seedActions();
  await prisma.card.update({ where: { id: f.design.id }, data: { status: 'DONE', isDone: true, completedAt: ACT_NOW } });
  await prisma.card.update({ where: { id: f.payment.id }, data: { status: 'BLOCKED' } });
  await prisma.card.update({ where: { id: f.loginApi.id }, data: { dueDate: new Date('2026-10-05T03:00:00.000Z') } }); // quá hạn
  await prisma.cardMember.create({ data: { cardId: f.loginUi.id, userId: f.lan.id } });
  await prisma.cardMember.create({ data: { cardId: f.report.id, userId: f.tuan.id } });
  await prisma.card.create({ data: { listId: f.todo.id, title: 'Thẻ đã lưu trữ', archivedAt: ACT_NOW } });
  await prisma.card.create({ data: { listId: f.todo.id, title: 'Thẻ đã xóa', deletedAt: ACT_NOW } });
  const oldList = await prisma.list.create({ data: { boardId: f.alpha.id, name: 'Cột đã lưu trữ', archivedAt: ACT_NOW, position: 9 } });
  await prisma.card.create({ data: { listId: oldList.id, title: 'Thẻ trong cột lưu trữ' } });
  await prisma.cardLabel.create({ data: { cardId: f.loginUi.id, labelId: f.backend.id } });
  await prisma.cardLabel.create({ data: { cardId: f.payment.id, labelId: f.backend.id } });
  const archivedLabelled = await prisma.card.create({ data: { listId: f.todo.id, title: 'Thẻ lưu trữ có nhãn', archivedAt: ACT_NOW } });
  await prisma.cardLabel.create({ data: { cardId: archivedLabelled.id, labelId: f.backend.id } });

  const priority = await prisma.customField.create({ data: { boardId: f.alpha.id, name: 'Ưu tiên', type: 'DROPDOWN', position: 0, options: { create: [{ value: 'Cao', position: 0 }, { value: 'Thấp', position: 1 }] } }, include: { options: { orderBy: { position: 'asc' } } } });
  const cost = await prisma.customField.create({ data: { boardId: f.alpha.id, name: 'Chi phí', type: 'NUMBER', position: 1 } });
  const accept = await prisma.customField.create({ data: { boardId: f.alpha.id, name: 'Hạn nghiệm thu', type: 'DATE', position: 2 } });
  const approve = await prisma.customField.create({ data: { boardId: f.alpha.id, name: 'Cần duyệt', type: 'CHECKBOX', position: 3 } });
  const note = await prisma.customField.create({ data: { boardId: f.alpha.id, name: 'Ghi chú', type: 'TEXT', position: 4 } });
  const [high, low] = priority.options;
  await prisma.cardFieldValue.create({ data: { cardId: f.loginUi.id, fieldId: priority.id, optionId: high.id } });
  await prisma.cardFieldValue.create({ data: { cardId: f.loginUi.id, fieldId: cost.id, numberValue: 1500000 } });
  await prisma.cardFieldValue.create({ data: { cardId: f.loginUi.id, fieldId: accept.id, dateValue: new Date('2026-10-20T03:00:00.000Z') } });
  await prisma.cardFieldValue.create({ data: { cardId: f.loginUi.id, fieldId: approve.id, boolValue: true } });
  await prisma.cardFieldValue.create({ data: { cardId: f.loginUi.id, fieldId: note.id, textValue: 'Làm trước' } });
  await prisma.cardFieldValue.create({ data: { cardId: f.payment.id, fieldId: priority.id, optionId: high.id } });
  await prisma.cardFieldValue.create({ data: { cardId: f.report.id, fieldId: priority.id, optionId: low.id } });
  // một trường và giá trị ở bảng KHÁC: không bao giờ lộ sang Alpha
  const otherField = await prisma.customField.create({ data: { boardId: f.beta.id, name: 'Trường bảng Beta', type: 'DROPDOWN', options: { create: [{ value: 'Giá trị Beta' }] }, } , include: { options: true } });

  const description = `Mô tả viết tay${ZW} có${ZWNJ} ký tự vô hình. ${'Nội dung dài. '.repeat(60)}`;
  await prisma.card.update({ where: { id: f.loginUi.id }, data: { description, startDate: new Date('2026-10-06T03:00:00.000Z') } });
  await prisma.comment.createMany({ data: [
    { cardId: f.loginUi.id, userId: f.lan.id, text: 'BÌNH-LUẬN-BÍ-MẬT-1' },
    { cardId: f.loginUi.id, userId: f.tuan.id, text: 'BÌNH-LUẬN-BÍ-MẬT-2' },
    { cardId: f.loginUi.id, userId: f.tuan.id, text: 'BÌNH-LUẬN-ĐÃ-XÓA', deletedAt: ACT_NOW },
  ] });
  await prisma.attachment.create({ data: { cardId: f.loginUi.id, uploaderId: f.lan.id, name: 'TỆP-BÍ-MẬT.pdf', url: '/uploads/cards/TỆP-BÍ-MẬT.pdf', mime: 'application/pdf', size: 1234 } });
  await prisma.checklist.create({ data: { cardId: f.loginUi.id, title: 'Danh sách A', items: { create: [{ content: 'Mục 1', isDone: true }, { content: 'Mục 2' }] } } });
  await prisma.checklist.create({ data: { cardId: f.loginUi.id, title: 'Danh sách B', items: { create: [{ content: 'Mục 3' }] } } });
  return { ...f, priority, high, low, cost, accept, approve, note, otherField };
}
type World = Awaited<ReturnType<typeof seedRead>>;
const owner = (f: World) => ({ userId: f.owner.id, scope: onBoard(f.alpha.id) });

describe('get_board_overview', () => {
  it('mọi con số khớp phép đếm tay trên CSDL; thẻ lưu trữ / xóa và cột lưu trữ không tính; cột theo đúng thứ tự', async () => {
    const f = await seedRead();
    const { data } = await run(owner(f), 'get_board_overview');
    expect(data).toEqual({
      board: { id: f.alpha.id, name: 'Dự án Alpha' },
      totalCards: 5, openCards: 4, doneCards: 1, donePercent: 20,
      overdueCards: 1, blockedCards: 1, unassignedOpenCards: 2,
      listCount: 3, labelCount: 2, memberCount: 4, customFieldCount: 5,
      lists: [
        { id: f.todo.id, name: 'Cần làm', status: 'TODO', totalCards: 3, openCards: 2, doneCards: 1 },
        { id: f.doing.id, name: 'Đang làm', status: 'IN_PROGRESS', totalCards: 2, openCards: 2, doneCards: 0 },
        { id: f.done.id, name: 'Hoàn thành', status: 'DONE', totalCards: 0, openCards: 0, doneCards: 0 },
      ],
    });
    // đối chiếu với phép đếm "ngây thơ" độc lập
    const live = await prisma.card.findMany({ where: { deletedAt: null, archivedAt: null, list: { boardId: f.alpha.id, deletedAt: null, archivedAt: null } }, include: { members: true } });
    expect(live).toHaveLength((data as { totalCards: number }).totalCards);
    expect(live.filter((c) => !c.isDone && c.dueDate && c.dueDate < ACT_NOW)).toHaveLength((data as { overdueCards: number }).overdueCards);
    expect(live.filter((c) => !c.isDone && c.members.length === 0)).toHaveLength((data as { unassignedOpenCards: number }).unassignedOpenCards);
  });

  it('bảng trống: tỉ lệ là null (không chia cho 0), danh sách cột rỗng', async () => {
    const f = await seedRead();
    const empty = await prisma.board.create({ data: { name: 'Bảng trống', workspaceId: f.ws.id, ownerId: f.owner.id, visibility: 'PRIVATE' } });
    const { data } = await run({ userId: f.owner.id, scope: onBoard(empty.id) }, 'get_board_overview');
    expect(data).toMatchObject({ totalCards: 0, openCards: 0, doneCards: 0, donePercent: null, listCount: 0, lists: [], labelCount: 0 });
  });

  it('làm tròn phần trăm; nguồn (source) ghi đúng phạm vi và thời điểm', async () => {
    const f = await seedRead();
    await prisma.card.update({ where: { id: f.report.id }, data: { status: 'DONE', isDone: true, completedAt: ACT_NOW } });
    const result = await run(owner(f), 'get_board_overview');
    expect(result.data).toMatchObject({ doneCards: 2, donePercent: 40 }); // 2/5
    await prisma.card.update({ where: { id: f.loginApi.id }, data: { status: 'DONE', isDone: true, completedAt: ACT_NOW } });
    expect((await run(owner(f), 'get_board_overview')).data).toMatchObject({ doneCards: 3, donePercent: 60 });
    expect(result.source).toMatchObject({ scopeLabel: 'Dự án Alpha', scope: { kind: 'BOARD', boardId: f.alpha.id }, generatedAt: ACT_NOW.toISOString() });
  });

  it('phần trăm LÀM TRÒN (2/3 → 67, 1/6 → 17, 1/3 → 33), không cắt cụt', async () => {
    const f = await seedRead();
    const make = async (name: string, done: number, total: number) => {
      const board = await prisma.board.create({ data: { name, workspaceId: f.ws.id, ownerId: f.owner.id, visibility: 'PRIVATE', lists: { create: { name: 'Cột' } } }, include: { lists: true } });
      for (let i = 0; i < total; i += 1) await prisma.card.create({ data: { listId: board.lists[0].id, title: `Việc ${i}`, ...(i < done ? { status: 'DONE', isDone: true, completedAt: ACT_NOW } : {}) } });
      return (await run({ userId: f.owner.id, scope: onBoard(board.id) }, 'get_board_overview')).data as { donePercent: number | null };
    };
    expect((await make('Hai phần ba', 2, 3)).donePercent).toBe(67);
    expect((await make('Một phần sáu', 1, 6)).donePercent).toBe(17);
    expect((await make('Một phần ba', 1, 3)).donePercent).toBe(33);
    expect((await make('Xong hết', 4, 4)).donePercent).toBe(100);
    expect((await make('Chưa xong gì', 0, 4)).donePercent).toBe(0);
  });

  it('cần MỘT bảng: trang chủ / không gian không tự chọn bảng; bảng khác ngoài trần bị chặn; người ngoài không xem được', async () => {
    const f = await seedRead();
    await expect(run({ userId: f.owner.id, scope: { kind: 'MY' } }, 'get_board_overview')).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('một bảng cụ thể') });
    await expect(run({ userId: f.owner.id, scope: { kind: 'WORKSPACE', workspaceId: f.ws.id } as never }, 'get_board_overview')).rejects.toMatchObject({ statusCode: 400 });
    // đang ở trang Alpha mà đòi xem Beta → vượt trần
    await expect(run(owner(f), 'get_board_overview', { scope: onBoard(f.beta.id) })).rejects.toMatchObject({ statusCode: 403 });
    // người không có quyền với bảng
    await expect(run({ userId: f.outsider.id, scope: onBoard(f.alpha.id) }, 'get_board_overview')).rejects.toMatchObject({ statusCode: 403 });
    // bảng công khai của người khác: chatbot không đọc
    await expect(run({ userId: f.owner.id, scope: onBoard(f.publicBoard.id) }, 'get_board_overview')).rejects.toMatchObject({ statusCode: 403 });
  });

  it('VIEWER vẫn xem được tổng quan (chỉ đọc)', async () => {
    const f = await seedRead();
    const { data } = await run({ userId: f.viewer.id, scope: onBoard(f.alpha.id) }, 'get_board_overview');
    expect(data).toMatchObject({ totalCards: 5 });
  });
});

describe('get_card_details', () => {
  const details = async (f: World, cardId = f.loginUi.id, who = f.owner.id) => (await run({ userId: who, scope: onBoard(f.alpha.id) }, 'get_card_details', { cardId })).data;

  it('trả đúng trạng thái, cột, hạn, người, nhãn, checklist, trường tùy chỉnh đủ 5 kiểu, số bình luận / tệp', async () => {
    const f = await seedRead();
    const d = await details(f);
    expect(d).toMatchObject({
      id: f.loginUi.id, title: 'Login UI', status: 'TODO', isDone: false, boardId: f.alpha.id, boardName: 'Dự án Alpha', columnId: f.todo.id, columnName: 'Cần làm',
      startDate: '2026-10-06T03:00:00.000Z', dueDate: null, completedAt: null, overdue: false,
      assignees: [{ id: f.lan.id, name: 'Nguyễn Lan' }],
      labels: [{ id: f.backend.id, name: 'Backend', color: '#0079BF' }],
      checklist: { lists: 2, done: 1, total: 3 },
      commentCount: 2, attachmentCount: 1,
    });
    expect((d as { fields: unknown[] }).fields).toEqual([
      { id: f.priority.id, name: 'Ưu tiên', type: 'DROPDOWN', value: 'Cao' },
      { id: f.cost.id, name: 'Chi phí', type: 'NUMBER', value: '1500000' },
      { id: f.accept.id, name: 'Hạn nghiệm thu', type: 'DATE', value: '2026-10-20' },
      { id: f.approve.id, name: 'Cần duyệt', type: 'CHECKBOX', value: 'Có' },
      { id: f.note.id, name: 'Ghi chú', type: 'TEXT', value: 'Làm trước' },
    ]);
  });

  it('quá hạn / đã xong được tính đúng; thẻ không có gì thì các danh sách rỗng', async () => {
    const f = await seedRead();
    expect(await details(f, f.loginApi.id)).toMatchObject({ overdue: true, isDone: false, assignees: [], labels: [], fields: [], checklist: { lists: 0, done: 0, total: 0 }, commentCount: 0, attachmentCount: 0, hasDescription: false, descriptionExcerpt: null });
    expect(await details(f, f.design.id)).toMatchObject({ isDone: true, status: 'DONE', overdue: false, completedAt: ACT_NOW.toISOString() });
  });

  it('mô tả: chỉ TRÍCH ≤ 300 ký tự đã bỏ ký tự vô hình để HIỂN THỊ; có cờ độ dài', async () => {
    const f = await seedRead();
    const d = (await details(f)) as { descriptionExcerpt: string; hasDescription: boolean; descriptionLength: number };
    expect(d.hasDescription).toBe(true);
    expect(d.descriptionExcerpt).toHaveLength(300);
    expect(d.descriptionExcerpt.startsWith('Mô tả viết tay có ký tự vô hình. Nội dung dài.')).toBe(true);
    expect(d.descriptionExcerpt).not.toContain(ZW);
    expect(d.descriptionExcerpt).not.toContain(ZWNJ);
    expect(d.descriptionLength).toBeGreaterThan(300);
  });

  it('thẻ ngoài phạm vi (bảng khác, đã lưu trữ / xóa, trong cột lưu trữ, id bịa) → CÙNG một lỗi "không tìm thấy", không lộ là có tồn tại', async () => {
    const f = await seedRead();
    const archived = await prisma.card.findFirstOrThrow({ where: { title: 'Thẻ đã lưu trữ' } });
    const deleted = await prisma.card.findFirstOrThrow({ where: { title: 'Thẻ đã xóa' } });
    const inOldList = await prisma.card.findFirstOrThrow({ where: { title: 'Thẻ trong cột lưu trữ' } });
    const messages = new Set<string>();
    for (const id of [f.loginBeta.id, f.secretCard.id, f.publicCard.id, archived.id, deleted.id, inOldList.id, 'khong-ton-tai-123']) {
      await run(owner(f), 'get_card_details', { cardId: id }).then(
        () => { throw new Error(`lộ thẻ ${id}`); },
        (e: { statusCode: number; message: string }) => { expect(e.statusCode).toBe(400); messages.add(e.message); }
      );
    }
    expect([...messages]).toEqual(['Không tìm thấy công việc trong phạm vi được phép']);
    // người ngoài thì cả bảng đã bị chặn từ đầu
    await expect(run({ userId: f.outsider.id, scope: onBoard(f.alpha.id) }, 'get_card_details', { cardId: f.loginUi.id })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('KHÔNG LỘ trường ngoài danh sách cho phép: không email, không nội dung bình luận, không tên / đường dẫn tệp, không giá trị trường của bảng khác', async () => {
    const f = await seedRead();
    const result = await run(owner(f), 'get_card_details', { cardId: f.loginUi.id });
    const everything = JSON.stringify(result);
    for (const secret of ['BÌNH-LUẬN-BÍ-MẬT-1', 'BÌNH-LUẬN-BÍ-MẬT-2', 'BÌNH-LUẬN-ĐÃ-XÓA', 'TỆP-BÍ-MẬT', '/uploads/', 'Trường bảng Beta', 'Giá trị Beta', f.tuan.id]) expect(everything).not.toContain(secret);
    for (const u of await prisma.user.findMany({ select: { email: true } })) expect(everything).not.toContain(u.email);
    expect(Object.keys(result.data).sort()).toEqual([
      'assignees', 'attachmentCount', 'boardId', 'boardName', 'checklist', 'columnId', 'columnName', 'commentCount', 'completedAt', 'createdAt', 'descriptionExcerpt',
      'descriptionLength', 'dueDate', 'fields', 'hasDescription', 'id', 'isDone', 'labels', 'overdue', 'startDate', 'status', 'title',
    ]);
  });

  it('người phụ trách đã xóa tài khoản không hiện', async () => {
    const f = await seedRead();
    await prisma.cardMember.create({ data: { cardId: f.loginUi.id, userId: f.tuan.id } });
    await prisma.user.update({ where: { id: f.tuan.id }, data: { deletedAt: ACT_NOW } });
    expect(((await details(f)) as { assignees: { id: string }[] }).assignees.map((a) => a.id)).toEqual([f.lan.id]);
  });

  it('tham số: chỉ cardId (+ scope); khóa lạ bị từ chối; thiếu cardId bị từ chối', () => {
    expect(TOOL_SCHEMAS.get_card_details.safeParse({ cardId: 'abc' }).success).toBe(true);
    expect(TOOL_SCHEMAS.get_card_details.safeParse({ cardId: 'abc', includeComments: true }).success).toBe(false);
    expect(TOOL_SCHEMAS.get_card_details.safeParse({}).success).toBe(false);
    expect(TOOL_SCHEMAS.get_board_overview.safeParse({ boardId: 'x' }).success).toBe(false);
  });
});

describe('modelView: phần được gửi lại cho MÔ HÌNH', () => {
  it('bỏ trích mô tả (dữ liệu do người khác viết), giữ cờ có / độ dài; công cụ khác giữ nguyên', async () => {
    const f = await seedRead();
    const details = await run(owner(f), 'get_card_details', { cardId: f.loginUi.id });
    const forModel = modelView(details as ToolResult) as { data: Record<string, unknown> };
    expect(forModel.data).not.toHaveProperty('descriptionExcerpt');
    expect(JSON.stringify(forModel)).not.toContain('Mô tả viết tay');
    expect(forModel.data).toMatchObject({ hasDescription: true });
    expect(forModel.data.descriptionLength as number).toBeGreaterThan(300);
    // phần hiển thị cho người dùng vẫn còn trích
    expect((details.data as { descriptionExcerpt: string }).descriptionExcerpt).toContain('Mô tả viết tay');
    const overview = await run(owner(f), 'get_board_overview');
    expect(modelView(overview as ToolResult)).toBe(overview);
  });
});

describe('query_catalog: LISTS / LABELS / CUSTOM_FIELDS của một bảng', () => {
  it('LISTS: tên, trạng thái, số việc mở / xong; thẻ lưu trữ / xóa và cột lưu trữ không tính', async () => {
    const f = await seedRead();
    const { data } = await run(owner(f), 'query_catalog', { kind: 'LISTS' });
    expect(data).toMatchObject({ kind: 'LISTS', total: 3, page: 1, hasMore: false });
    expect((data as { rows: unknown[] }).rows).toEqual([
      { id: f.todo.id, name: 'Cần làm', status: 'TODO', totalCards: 3, openCards: 2, doneCards: 1 },
      { id: f.doing.id, name: 'Đang làm', status: 'IN_PROGRESS', totalCards: 2, openCards: 2, doneCards: 0 },
      { id: f.done.id, name: 'Hoàn thành', status: 'DONE', totalCards: 0, openCards: 0, doneCards: 0 },
    ]);
  });

  it('LABELS: tên, màu, số thẻ SỐNG gắn nhãn (thẻ lưu trữ không tính); nhãn không tên vẫn liệt kê', async () => {
    const f = await seedRead();
    await prisma.label.create({ data: { boardId: f.alpha.id, name: '', color: '#61BD4F' } });
    const { data } = await run(owner(f), 'query_catalog', { kind: 'LABELS' });
    expect(data).toMatchObject({ kind: 'LABELS', total: 3 });
    const rows = (data as { rows: { name: string; color: string; cards: number }[] }).rows;
    expect(rows.find((r) => r.name === 'Backend')).toMatchObject({ color: '#0079BF', cards: 2 }); // loginUi + payment; thẻ lưu trữ không tính
    expect(rows.find((r) => r.name === 'Gấp')).toMatchObject({ cards: 0 });
    expect(rows.find((r) => r.name === '')).toMatchObject({ color: '#61BD4F', cards: 0 });
  });

  it('CUSTOM_FIELDS: tên, kiểu, các lựa chọn theo thứ tự; không lộ trường của bảng khác', async () => {
    const f = await seedRead();
    const { data } = await run(owner(f), 'query_catalog', { kind: 'CUSTOM_FIELDS' });
    const rows = (data as { rows: { name: string; type: string; options: { value: string }[] }[] }).rows;
    expect(rows.map((r) => [r.name, r.type])).toEqual([['Ưu tiên', 'DROPDOWN'], ['Chi phí', 'NUMBER'], ['Hạn nghiệm thu', 'DATE'], ['Cần duyệt', 'CHECKBOX'], ['Ghi chú', 'TEXT']]);
    expect(rows[0].options.map((o) => o.value)).toEqual(['Cao', 'Thấp']);
    expect(JSON.stringify(data)).not.toContain('Trường bảng Beta');
  });

  it('phân trang theo pageSize; không có bảng (trang chủ) → lỗi chọn bảng', async () => {
    const f = await seedRead();
    const first = await run(owner(f), 'query_catalog', { kind: 'CUSTOM_FIELDS', pageSize: 2 });
    expect(first.data).toMatchObject({ total: 5, page: 1, pageSize: 2, hasMore: true });
    const last = await run(owner(f), 'query_catalog', { kind: 'CUSTOM_FIELDS', pageSize: 2, page: 3 });
    expect((last.data as { rows: unknown[] }).rows).toHaveLength(1);
    expect(last.data).toMatchObject({ hasMore: false });
    for (const kind of ['LISTS', 'LABELS', 'CUSTOM_FIELDS']) {
      await expect(run({ userId: f.owner.id, scope: { kind: 'MY' } }, 'query_catalog', { kind })).rejects.toMatchObject({ statusCode: 400 });
    }
  });

  it('các loại cũ (BOARDS / WORKSPACES / MEMBERS) không đổi', async () => {
    const f = await seedRead();
    const boards = await run({ userId: f.owner.id, scope: { kind: 'MY' } }, 'query_catalog', { kind: 'BOARDS' });
    expect((boards.data as { rows: { name: string }[] }).rows.map((r) => r.name)).toContain('Dự án Alpha');
    expect((await run(owner(f), 'query_catalog', { kind: 'MEMBERS' })).data).toMatchObject({ kind: 'MEMBERS', total: 4 });
  });
});

describe('aggregate_tasks: doneCards / donePercent', () => {
  const agg = (f: World, completion: 'OPEN' | 'DONE' | 'ALL') => run(owner(f), 'aggregate_tasks', { groupBy: 'STATUS', filters: { completion } });

  it('completion = ALL: tỉ lệ hoàn thành đúng (1/5 = 20%); OPEN → null (không thể tính trên tập đã bỏ việc xong); DONE → 100%', async () => {
    const f = await seedRead();
    expect((await agg(f, 'ALL')).data).toMatchObject({ totalCards: 5, doneCards: 1, donePercent: 20 });
    expect((await agg(f, 'OPEN')).data).toMatchObject({ totalCards: 4, doneCards: null, donePercent: null });
    expect((await agg(f, 'DONE')).data).toMatchObject({ totalCards: 1, doneCards: null, donePercent: null });
  });

  it('tập lọc rỗng → tỉ lệ null; tập lọc theo người vẫn đúng', async () => {
    const f = await seedRead();
    const none = await run(owner(f), 'aggregate_tasks', { groupBy: 'STATUS', filters: { completion: 'ALL', keyword: 'không-có-thẻ-nào-như-vậy' } });
    expect(none.data).toMatchObject({ totalCards: 0, doneCards: 0, donePercent: null });
    const lan = await run(owner(f), 'aggregate_tasks', { groupBy: 'STATUS', filters: { completion: 'ALL', assigneeIds: [f.lan.id] } });
    expect(lan.data).toMatchObject({ totalCards: 1, doneCards: 0, donePercent: 0 });
  });
});

describe('resolve_entities: trường tùy chỉnh, giá trị trường, parentName của thẻ', () => {
  it('CUSTOM_FIELD "ưu tiên" và FIELD_OPTION "Cao" (kèm tên trường làm parentName); không tìm thấy giá trị của bảng khác', async () => {
    const f = await seedRead();
    const field = await run(owner(f), 'resolve_entities', { kind: 'CUSTOM_FIELD', text: 'ưu tiên' });
    expect(field.data).toMatchObject({ status: 'RESOLVED', options: [{ id: f.priority.id, name: 'Ưu tiên', kind: 'CUSTOM_FIELD' }] });
    const option = await run(owner(f), 'resolve_entities', { kind: 'FIELD_OPTION', text: 'Cao' });
    expect(option.data).toMatchObject({ status: 'RESOLVED', options: [{ id: f.high.id, name: 'Cao', kind: 'FIELD_OPTION', parentName: 'Ưu tiên' }] });
    expect((await run(owner(f), 'resolve_entities', { kind: 'FIELD_OPTION', text: 'Giá trị Beta' })).data).toMatchObject({ status: 'NOT_FOUND' });
  });

  it('thẻ: parentName là tên CỘT ở trang bảng; "cột · bảng" ở phạm vi rộng; hai thẻ cùng tên được phân biệt bằng cột', async () => {
    const f = await seedRead();
    await prisma.card.create({ data: { listId: f.doing.id, title: 'Login UI' } });
    const onPage = await run(owner(f), 'resolve_entities', { kind: 'CARD', text: 'Login UI' });
    expect(onPage.data).toMatchObject({ status: 'CLARIFY', total: 2 });
    expect((onPage.data as { options: { parentName: string }[] }).options.map((o) => o.parentName).sort()).toEqual(['Cần làm', 'Đang làm']);
    const wide = await run({ userId: f.owner.id, scope: { kind: 'MY' } }, 'resolve_entities', { kind: 'CARD', text: 'Login UI' });
    expect((wide.data as { options: { parentName: string }[] }).options.map((o) => o.parentName).sort()).toEqual(['Cần làm · Dự án Alpha', 'Đang làm · Dự án Alpha']);
  });
});

describe('bộ lọc theo giá trị trường (fieldOptionIds): "bao nhiêu việc ưu tiên Cao?"', () => {
  it('query_tasks + aggregate_tasks lọc đúng thẻ có giá trị đó; giá trị của bảng khác / bịa bị từ chối', async () => {
    const f = await seedRead();
    const list = await run(owner(f), 'query_tasks', { filters: { completion: 'ALL', fieldOptionIds: [f.high.id] } });
    expect(list.data).toMatchObject({ total: 2 });
    expect((list.data as { cards: { id: string }[] }).cards.map((c) => c.id).sort()).toEqual([f.loginUi.id, f.payment.id].sort());
    expect((await run(owner(f), 'aggregate_tasks', { groupBy: 'STATUS', filters: { completion: 'ALL', fieldOptionIds: [f.low.id] } })).data).toMatchObject({ totalCards: 1 });
    // kết hợp với bộ lọc khác
    expect((await run(owner(f), 'query_tasks', { filters: { completion: 'OPEN', fieldOptionIds: [f.high.id], statuses: ['BLOCKED'] } })).data).toMatchObject({ total: 1 });
    for (const bad of [f.otherField.options[0].id, 'khong-co']) {
      await expect(run(owner(f), 'query_tasks', { filters: { fieldOptionIds: [bad] } })).rejects.toMatchObject({ statusCode: 400 });
    }
  });
});

describe('công cụ mới trong danh sách gửi mô hình', () => {
  it('có get_board_overview / get_card_details với mô tả; khóa đầu vào chặt; finish nhận comment tùy chọn', () => {
    const names = modelTools.map((t) => t.function.name);
    expect(names).toEqual(expect.arrayContaining(['get_board_overview', 'get_card_details', 'query_catalog']));
    expect(Object.keys(MODEL_SCHEMAS)).toContain('get_card_details');
    for (const t of modelTools) expect(t.function.description.length, t.function.name).toBeGreaterThan(20);
    const finish = MODEL_SCHEMAS.finish;
    expect(finish.safeParse({ sourceIds: [], comment: 'Tiến độ ổn.' }).success).toBe(true);
    expect(finish.safeParse({ sourceIds: [], comment: 'x'.repeat(301) }).success).toBe(false);
    expect(finish.safeParse({ sourceIds: [], note: 'x' }).success).toBe(false);
    expect(TOOL_SCHEMAS.query_catalog.safeParse({ kind: 'LISTS' }).success).toBe(true);
    expect(TOOL_SCHEMAS.query_catalog.safeParse({ kind: 'DELETE_ALL' }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Qua vòng lặp mô hình (kịch bản): 3 câu hỏi mới của bảng "câu hỏi mẫu" + nhận xét AI + lịch sử
// ---------------------------------------------------------------------------------------------------------------------

const lastToolJson = (messages: ModelMessage[]): { data: { options?: { id: string }[] } } => JSON.parse([...messages].reverse().find((m) => m.role === 'tool')!.content!);
const call = (name: string, args: unknown) => ({ name, arguments: args });

async function ask(f: World, message: string, steps: Parameters<typeof script>[0], opts: { userId?: string } = {}) {
  const step = script(steps);
  const sessions = new V2SessionStore();
  const reply = await persistentMessage(opts.userId ?? f.owner.id, { message, scope: onBoard(f.alpha.id) }, actionContext({ step, sessions, actions: false }));
  return { reply, step, sessions };
}
/** Lượt cuối: finish với mọi nguồn đã tra cứu thành công (và nhận xét nếu có). */
const finish = (comment?: string) => (messages: ModelMessage[]) => {
  const ids = messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content!)).filter((r) => r.source && r.tool !== 'resolve_entities').map((r) => r.source.id as string);
  return [call('finish', { sourceIds: ids, ...(comment !== undefined ? { comment } : {}) })];
};

describe('qua vòng lặp mô hình: câu hỏi mẫu của giai đoạn 4', () => {
  it('"Task Login UI đang thế nào?": resolve → get_card_details → khối chi tiết; mô hình KHÔNG nhận trích mô tả, người dùng thì có', async () => {
    const f = await seedRead();
    await prisma.card.update({ where: { id: f.loginApi.id }, data: { title: 'Cổng API' } });
    const { reply, step } = await ask(f, 'Task Login UI đang thế nào?', [
      [call('resolve_entities', { kind: 'CARD', text: 'Login UI' })],
      (m) => [call('get_card_details', { cardId: lastToolJson(m).data.options![0].id })],
      finish(),
    ]);
    const block = reply.answer.blocks?.[0];
    expect(block).toMatchObject({ status: 'OK', tool: 'get_card_details', title: 'Chi tiết công việc', pagination: { page: 1, hasMore: false } });
    expect(block?.status === 'OK' && (block.data as { descriptionExcerpt: string }).descriptionExcerpt).toContain('Mô tả viết tay');
    // lượt gọi thứ 3 (sau khi có kết quả chi tiết): transcript gửi mô hình không chứa chữ trong mô tả
    const transcript = JSON.stringify((step as ReturnType<typeof vi.fn>).mock.calls[2][0]);
    expect(transcript).toContain('hasDescription');
    expect(transcript).not.toContain('Mô tả viết tay');
    expect(transcript).not.toContain('descriptionExcerpt');
  });

  it('"Board này tiến độ bao nhiêu?": get_board_overview → khối tổng quan với % và cột; hoặc aggregate ALL có donePercent', async () => {
    const f = await seedRead();
    const overview = await ask(f, 'Board này tiến độ bao nhiêu?', [[call('get_board_overview', {})], finish()]);
    expect(overview.reply.answer.blocks?.[0]).toMatchObject({ status: 'OK', tool: 'get_board_overview', title: 'Tổng quan bảng', data: { donePercent: 20, totalCards: 5 } });
    const agg = await ask(f, 'Bao nhiêu phần trăm việc đã xong?', [[call('aggregate_tasks', { groupBy: 'STATUS', filters: { completion: 'ALL' } })], finish()]);
    expect(agg.reply.answer.blocks?.[0]).toMatchObject({ tool: 'aggregate_tasks', data: { donePercent: 20, doneCards: 1 } });
  });

  it('"Có bao nhiêu việc ưu tiên Cao?": resolve FIELD_OPTION → aggregate với fieldOptionIds', async () => {
    const f = await seedRead();
    const { reply } = await ask(f, 'Có bao nhiêu việc ưu tiên Cao?', [
      [call('resolve_entities', { kind: 'FIELD_OPTION', text: 'Cao' })],
      (m) => [call('aggregate_tasks', { groupBy: 'STATUS', filters: { completion: 'ALL', fieldOptionIds: [lastToolJson(m).data.options![0].id] } })],
      finish(),
    ]);
    expect(reply.answer.blocks?.[0]).toMatchObject({ tool: 'aggregate_tasks', data: { totalCards: 2 } });
  });

  it('"Bảng này có những cột / nhãn / trường nào?": query_catalog LISTS, LABELS, CUSTOM_FIELDS trong cùng một lượt', async () => {
    const f = await seedRead();
    const { reply } = await ask(f, 'Bảng này có những cột, nhãn và trường tùy chỉnh nào?', [
      [call('query_catalog', { kind: 'LISTS' }), call('query_catalog', { kind: 'LABELS' }), call('query_catalog', { kind: 'CUSTOM_FIELDS' })],
      finish(),
    ]);
    expect(reply.answer.blocks?.map((b) => b.title)).toEqual(['Các cột của bảng', 'Nhãn của bảng', 'Trường tùy chỉnh của bảng']);
  });

  it('hỏi tổng quan ở TRANG CHỦ (không có bảng): lỗi nhẹ nhàng trong khối, không làm hỏng lượt', async () => {
    const f = await seedRead();
    const step = script([[call('get_board_overview', {})], () => [call('finish', { sourceIds: [] })]]);
    const reply = await persistentMessage(f.owner.id, { message: 'Tiến độ bảng thế nào?', scope: { kind: 'MY' } }, actionContext({ step, actions: false }));
    expect(reply.answer.blocks?.[0]).toMatchObject({ status: 'ERROR', error: expect.stringContaining('một bảng cụ thể') });
  });
});

describe('nhận xét ngắn của AI từ số đã tính (finish.comment)', () => {
  const askComment = async (comment: string, f?: World) => {
    const world = f ?? (await seedRead());
    return (await ask(world, 'Tóm tắt tiến độ bảng và nhận xét ngắn', [[call('get_board_overview', {})], finish(comment)])).reply;
  };

  it('nhận xét chỉ dùng số có trong kết quả → hiển thị, nhãn nguồn AI', async () => {
    const reply = await askComment('Mới hoàn thành 1 trên 5 việc, còn 1 việc quá hạn cần xử lý sớm.');
    expect(reply.answer.comment).toEqual({ text: 'Mới hoàn thành 1 trên 5 việc, còn 1 việc quá hạn cần xử lý sớm.', source: 'AI' });
    expect(reply.answer.blocks?.[0]).toMatchObject({ tool: 'get_board_overview' });
  });

  it.each([
    ['con số không có trong kết quả', 'Đã hoàn thành 7 việc, rất tốt.'],
    ['có ký hiệu %', 'Tiến độ đạt 20% so với kế hoạch.'],
    ['số viết bằng chữ', 'Mới xong một việc trên năm việc.'],
    ['tên riêng giữa câu', 'Việc của Lan còn nhiều, cần hỗ trợ ngay.'],
    ['có liên kết', 'Xem thêm tại https://evil.example để biết chi tiết 5 việc.'],
    ['có đánh dấu markup', 'Hoàn thành **1** việc trên 5 việc.'],
    ['quá dài (>300 ký tự)', `Việc ${'còn nhiều '.repeat(40)}.`],
  ])('nhận xét bị loại, câu trả lời vẫn đủ khối số liệu: %s', async (_name, comment) => {
    const reply = await askComment(comment);
    expect(reply.answer.comment).toBeUndefined();
    expect(reply.answer.blocks?.[0]).toMatchObject({ status: 'OK', tool: 'get_board_overview' });
  });

  it('không có kết quả nào để dựa vào (không gọi công cụ) → không có nhận xét', async () => {
    const f = await seedRead();
    const { reply } = await ask(f, 'Chào bạn', [[call('finish', { sourceIds: [], comment: 'Chúc một ngày tốt lành.' })]]);
    expect(reply.answer.comment).toBeUndefined();
  });

  it('numbersIn: chỉ gom số nguyên không âm trong dữ liệu, bỏ chữ số trong chuỗi (id, ngày)', () => {
    const n = numbersIn({ a: 3, b: [4, { c: 5 }], d: 'id-123', e: '2026-10-07', f: -2, g: 1.5, h: null });
    expect([...n].sort()).toEqual(['3', '4', '5']);
  });
});

describe('lịch sử hội thoại với khối mới', () => {
  it('khối tổng quan lưu và đọc lại được; khi bảng thành riêng tư (mất quyền) thì bản lưu bị che', async () => {
    const f = await seedRead();
    const { reply } = await ask(f, 'Tổng quan bảng', [[call('get_board_overview', {})], finish()], { userId: f.lan.id });
    const before = await conversationHistory(f.lan.id, reply.conversationId, undefined, ACT_NOW);
    expect(before.turns[0].reply?.answer.blocks?.[0]).toMatchObject({ tool: 'get_board_overview' });
    // bảng chuyển sang riêng tư: Lan chỉ là thành viên không gian nên không còn đọc được
    await prisma.board.update({ where: { id: f.alpha.id }, data: { visibility: 'PRIVATE' } });
    const after = await conversationHistory(f.lan.id, reply.conversationId, undefined, ACT_NOW);
    expect(after.turns[0].reply?.answer.blocks ?? []).toHaveLength(0);
    expect(after.turns[0].reply?.answer.text).toContain('không còn được phép xem');
  });
});

describe('explicitBoardRef: cụm "bảng …" chỉ là TÊN khi giống một tên (sửa lỗi chặn câu hỏi "Board này tiến độ bao nhiêu?")', () => {
  it.each([
    ['Bảng này đang có những gì?', undefined],
    ['Board này tiến độ bao nhiêu?', undefined],
    ['Tóm tắt tiến độ bảng và nhận xét ngắn', undefined],
    ['bảng đó còn bao nhiêu việc', undefined],
    ['Bảng hiện tại có ai', undefined],
    ['bảng Marketing có những ai', { name: 'Marketing', strong: true }],
    ['bảng 1234 gồm những ai', { name: '1234', strong: true }],
    ['Bảng Do An Tốt Nghiệp có bao nhiêu việc', { name: 'Do An Tốt Nghiệp', strong: true }],
    ['bảng “Kế hoạch gồm các thành viên mới” gồm những ai?', { name: 'Kế hoạch gồm các thành viên mới', strong: true }],
    ['xem bảng tiến độ dự án', { name: 'tiến độ dự án', strong: false }],
  ])('%s', async (question, want) => {
    const { explicitBoardRef, explicitBoardName } = await import('../src/modules/chat/v2/chat.v2.orchestrator');
    expect(explicitBoardRef(question)).toEqual(want);
    expect(explicitBoardName(question)).toBe(want?.name);
  });

  it('câu hỏi về "bảng này" tới được mô hình (không bị chặn "không tìm thấy bảng"); tên VIẾT HOA không tồn tại vẫn bị chặn rõ ràng', async () => {
    const f = await seedRead();
    const sessions = new V2SessionStore();
    const step = script([[call('get_board_overview', {})], finish()]);
    const ok = await persistentMessage(f.owner.id, { message: 'Board này tiến độ bao nhiêu?', scope: onBoard(f.alpha.id) }, actionContext({ step, sessions, actions: false }));
    expect(ok.answer.blocks?.[0]).toMatchObject({ status: 'OK', tool: 'get_board_overview' });
    const blocked = script([]);
    const reply = await persistentMessage(f.owner.id, { message: 'bảng Zzzzz gồm những ai', scope: { kind: 'MY' } }, actionContext({ step: blocked, actions: false }));
    expect(reply.answer.text).toContain('Không tìm thấy bảng này');
    expect(blocked).not.toHaveBeenCalled();
    // cụm viết thường không khớp bảng nào: để mô hình xử lý (không chặn)
    const weak = script([[call('finish', { sourceIds: [] })]]);
    await persistentMessage(f.owner.id, { message: 'cho xem bảng sprint ba gồm những ai', scope: { kind: 'MY' } }, actionContext({ step: weak, actions: false }));
    expect(weak).toHaveBeenCalled();
  });
});
