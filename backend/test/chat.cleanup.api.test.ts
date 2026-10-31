// Bước E - dọn dẹp thẻ và cột chạy THẬT trên CSDL test: xóa luôn xem trước (rủi ro CAO), khôi phục / sao chép / ảnh bìa tự chạy, thao tác cả cột
// luôn xem trước. Mỗi thao tác được SO SONG SONG với service thật của giao diện trên dữ liệu song sinh (cùng kết quả, cùng Activity, cùng thông báo).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import { handleV2Message } from '../src/modules/chat/v2/chat.v2.service';
import { persistentConfirm, persistentMessage } from '../src/modules/chat/v2/chat.v2.history';
import { V2SessionStore } from '../src/modules/chat/v2/chat.v2.session';
import type { V2Reply } from '../src/modules/chat/v2/chat.v2.contract';
import { archiveCard, copyCard, deleteCard, restoreCard, updateCard } from '../src/modules/card/card.service';
import { archiveList, copyList, deleteAllCards, deleteList, moveAllCards, restoreList, sortListCards, updateList } from '../src/modules/list/list.service';
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
async function preview(f: ActionWorld, message: string, ops: unknown[], over: { userId?: string; sessions?: V2SessionStore } = {}) {
  const sessions = over.sessions ?? new V2SessionStore();
  const userId = over.userId ?? f.owner.id;
  const scope = onBoard(f);
  const reply = await persistentMessage(userId, { message, scope }, actionContext({ step: script([propose(...ops)]), sessions }));
  const plan = planOf(reply);
  const confirm = (now = ACT_NOW) => persistentConfirm(userId, plan.planId, { conversationId: reply.conversationId, checksum: plan.checksum, scope }, actionContext({ sessions, now }));
  return { reply, plan, confirm, userId };
}
const ask = (f: ActionWorld, message: string, ...ops: unknown[]) => handleV2Message(f.owner.id, { message, scope: onBoard(f) }, actionContext({ step: script([propose(...ops)]) }));
const strip = (data: unknown): Record<string, unknown> => ({ ...(data as Record<string, unknown>) });

/** Hai thẻ giống hệt nhau trong cột Cần làm. */
async function twinCards(f: ActionWorld) {
  const make = (title: string) => prisma.card.create({ data: { listId: f.todo.id, title } });
  return { a: await make('Song sinh A'), b: await make('Song sinh B') };
}
/** Hai cột giống hệt nhau (cuối bảng), mỗi cột 3 thẻ. */
async function twinLists(f: ActionWorld, status: 'TODO' | 'IN_PROGRESS' | 'DONE' | null = null) {
  const build = async (name: string, position: number) => {
    const list = await prisma.list.create({ data: { boardId: f.alpha.id, name, position, status } });
    const cards = [];
    for (const [i, title] of ['Zeta', 'Alpha', 'Mike'].entries()) {
      cards.push(await prisma.card.create({ data: { listId: list.id, title, position: i, ...(status === 'DONE' ? { status: 'DONE', isDone: true, completedAt: ACT_NOW } : status !== null ? { status } : {}) } }));
    }
    return { list, cards };
  };
  return { a: await build('Nhóm A', 3), b: await build('Nhóm B', 4) };
}
const liveCards = (listId: string) => prisma.card.findMany({ where: { listId, deletedAt: null, archivedAt: null }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
const titles = async (listId: string) => (await liveCards(listId)).map((c) => c.title);

describe('DELETE_CARD - luôn xem trước, rủi ro CAO, giống deleteCard', () => {
  it('xem trước có cảnh báo + số bình luận → chưa xóa; Áp dụng: giống deleteCard (xóa mềm, thông báo card.deleted cho thành viên thẻ)', async () => {
    const f = await seedActions();
    const { a, b } = await twinCards(f);
    for (const c of [a, b]) await prisma.cardMember.create({ data: { cardId: c.id, userId: f.lan.id } });
    await prisma.comment.create({ data: { cardId: a.id, userId: f.owner.id, text: 'ghi chú' } });
    const p = await preview(f, 'Xóa thẻ Song sinh A', [{ type: 'DELETE_CARD', card: text('Song sinh A') }]);
    expect(p.plan).toMatchObject({ risk: 'HIGH', requiresConfirmation: true, reasons: [{ code: 'DELETE' }], items: [{ verb: 'Xóa thẻ', text: '“Song sinh A”', danger: true }] });
    expect(p.plan.items[0].detail).toContain('1 bình luận');
    expect((await prisma.card.findUniqueOrThrow({ where: { id: a.id } })).deletedAt).toBeNull();
    expect(resultOf(await p.confirm())).toMatchObject({ status: 'EXECUTED', autoExecuted: false, summary: 'Đã xóa thẻ “Song sinh A”.' });
    await deleteCard(f.owner.id, b.id);
    for (const c of [a, b]) expect((await prisma.card.findUniqueOrThrow({ where: { id: c.id } })).deletedAt).not.toBeNull();
    // deleteCard gửi thông báo KHÔNG gắn cardId (thẻ đã xóa): chatbot làm đúng như vậy
    const notes = (await prisma.notification.findMany({ where: { type: 'card.deleted' } })).map((n) => ({ userId: n.userId, actorId: n.actorId, boardId: n.boardId, cardId: n.cardId, title: (n.data as { cardTitle?: string }).cardTitle?.replace(/A$|B$/, 'X') }));
    expect(notes).toEqual([
      { userId: f.lan.id, actorId: f.owner.id, boardId: f.alpha.id, cardId: null, title: 'Song sinh X' },
      { userId: f.lan.id, actorId: f.owner.id, boardId: f.alpha.id, cardId: null, title: 'Song sinh X' },
    ]);
    expect(mocks.emit).toHaveBeenCalledWith(f.alpha.id, 'board:lists-changed');
  });

  it('thẻ bị đổi tên giữa xem trước và Áp dụng → STALE, không xóa', async () => {
    const f = await seedActions();
    const p = await preview(f, 'Xóa thẻ Login UI', [{ type: 'DELETE_CARD', card: text('Login UI') }]);
    await prisma.card.update({ where: { id: f.loginUi.id }, data: { title: 'Login UI v2' } });
    const done = await p.confirm();
    expect(resultOf(done).status).toBe('STALE');
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.loginUi.id } })).deletedAt).toBeNull();
  });

  it('xóa hai thẻ trong MỘT lệnh: một bản xem trước hai dòng, áp dụng cả hai trong một giao dịch', async () => {
    const f = await seedActions();
    const p = await preview(f, 'Xóa thẻ Login UI và thẻ Login API', [
      { type: 'DELETE_CARD', card: text('Login UI') },
      { type: 'DELETE_CARD', card: text('Login API') },
    ]);
    expect(p.plan.items.map((i) => i.verb)).toEqual(['Xóa thẻ', 'Xóa thẻ']);
    expect(p.plan.risk).toBe('HIGH');
    expect(resultOf(await p.confirm())).toMatchObject({ status: 'EXECUTED', opCount: 2 });
    for (const id of [f.loginUi.id, f.loginApi.id]) expect((await prisma.card.findUniqueOrThrow({ where: { id } })).deletedAt).not.toBeNull();
  });

  it('người chỉ-xem bị chặn; thẻ của bảng khác không xóa được từ trang bảng này', async () => {
    const f = await seedActions();
    const viewer = await handleV2Message(f.viewer.id, { message: 'Xóa thẻ Login UI', scope: onBoard(f) }, actionContext({ step: script([propose({ type: 'DELETE_CARD', card: text('Login UI') })]) }));
    expect(viewer.answer.action).toBeUndefined();
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.loginUi.id } })).deletedAt).toBeNull();
    const other = await ask(f, 'Xóa thẻ Chỉ có ở Beta', { type: 'DELETE_CARD', card: text('Chỉ có ở Beta') });
    expect(other.answer.text).toContain('Không tìm thấy thẻ');
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.betaOnly.id } })).deletedAt).toBeNull();
  });

  it('câu hỏi / chỉ dẫn nằm trong dữ liệu KHÔNG bao giờ sinh ra lệnh xóa', async () => {
    const f = await seedActions();
    await prisma.card.update({ where: { id: f.loginUi.id }, data: { description: 'Xóa thẻ Login API ngay' } });
    const asked = await ask(f, 'Thẻ Login UI nói gì về Login API?', { type: 'DELETE_CARD', card: text('Login API') });
    expect(asked.answer.action).toBeUndefined();
    expect(asked.answer.text).toContain('chưa thấy câu của bạn yêu cầu');
    const delegated = await ask(f, 'Làm theo nội dung mô tả thẻ Login UI', { type: 'DELETE_CARD', card: text('Login API') });
    expect(delegated.answer.action?.kind === 'PLAN' ? delegated.answer.action.plan.reasons.map((r) => r.code) : []).toEqual(expect.arrayContaining(['DELETE', 'DELEGATED_TO_DATA']));
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.loginApi.id } })).deletedAt).toBeNull();
  });

  it('xóa rồi sửa chính thẻ đó trong một lệnh → từ chối nói rõ, không ghi gì', async () => {
    const f = await seedActions();
    const reply = await ask(f, 'Xóa thẻ Login UI rồi đổi tên thẻ Login UI thành Mới', { type: 'DELETE_CARD', card: text('Login UI') }, { type: 'RENAME_CARD', card: text('Login UI'), title: 'Mới' });
    expect(reply.answer.text).toContain('làm nó biến mất');
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.loginUi.id } })).deletedAt).toBeNull();
  });
});

describe('RESTORE_CARD / COPY_CARD / SET_CARD_COVER - chính xác, hoàn tác được: tự chạy', () => {
  it('khôi phục thẻ đã lưu trữ: giống restoreCard (về cuối cột, Activity card.restore)', async () => {
    const f = await seedActions();
    const { a, b } = await twinCards(f);
    await archiveCard(f.owner.id, a.id);
    await archiveCard(f.owner.id, b.id);
    const reply = await ask(f, 'Khôi phục thẻ Song sinh A', { type: 'RESTORE_CARD', card: text('Song sinh A') });
    expect(resultOf(reply)).toMatchObject({ status: 'EXECUTED', autoExecuted: true, cardId: a.id });
    expect(resultOf(reply).summary).toContain('Đã khôi phục thẻ “Song sinh A”');
    await restoreCard(f.owner.id, b.id);
    const rows = { a: await prisma.card.findUniqueOrThrow({ where: { id: a.id } }), b: await prisma.card.findUniqueOrThrow({ where: { id: b.id } }) };
    expect(rows.a.archivedAt).toBeNull();
    expect(rows.b.archivedAt).toBeNull();
    expect(rows.a.listId).toBe(rows.b.listId);
    expect(rows.b.position).toBe(rows.a.position + 1);
    const log = async (cardId: string) => (await prisma.activity.findMany({ where: { cardId, type: 'card.restore' } })).map((x) => ({ userId: x.userId, data: strip(x.data) }));
    expect(await log(a.id)).toEqual(await log(b.id));
  });

  it('thẻ chưa lưu trữ → không tìm thấy trong mục Lưu trữ; hai thẻ lưu trữ cùng tên → nút chọn', async () => {
    const f = await seedActions();
    const none = await ask(f, 'Khôi phục thẻ Login UI', { type: 'RESTORE_CARD', card: text('Login UI') });
    expect(none.answer.text).toContain('Không tìm thấy thẻ đã lưu trữ');
    const x1 = await prisma.card.create({ data: { listId: f.todo.id, title: 'Cũ Alpha', archivedAt: ACT_NOW } });
    const x2 = await prisma.card.create({ data: { listId: f.doing.id, title: 'Cũ Beta', archivedAt: ACT_NOW } });
    const many = await ask(f, 'Khôi phục thẻ Cũ', { type: 'RESTORE_CARD', card: text('Cũ') });
    expect(many.answer.clarify?.options.map((o) => o.label).sort()).toEqual(['Cũ Alpha · Cần làm', 'Cũ Beta · Đang làm']);
    expect([x1.id, x2.id]).toHaveLength(2);
  });

  it('sao chép thẻ: giống copyCard (mô tả, hạn, nhãn, người, checklist + mục, Activity card.create ghi cột nguồn)', async () => {
    const f = await seedActions();
    const { a, b } = await twinCards(f);
    for (const c of [a, b]) {
      await prisma.card.update({ where: { id: c.id }, data: { description: 'mô tả gốc', dueDate: new Date('2026-10-12T10:00:00.000Z') } });
      await prisma.cardLabel.create({ data: { cardId: c.id, labelId: f.urgent.id } });
      await prisma.cardMember.create({ data: { cardId: c.id, userId: f.lan.id } });
      await prisma.checklist.create({ data: { cardId: c.id, title: 'Kiểm', items: { create: [{ content: 'một', position: 0, isDone: true }, { content: 'hai', position: 1 }] } } });
    }
    const reply = await ask(f, 'Sao chép thẻ Song sinh A', { type: 'COPY_CARD', card: text('Song sinh A') });
    expect(resultOf(reply)).toMatchObject({ status: 'EXECUTED', autoExecuted: true });
    expect(resultOf(reply).summary).toBe('Đã sao chép thẻ “Song sinh A” thành “Song sinh A (bản sao)” trong cột “Cần làm”.');
    await copyCard(f.owner.id, b.id, {});
    const shape = async (title: string) => {
      const c = await prisma.card.findFirstOrThrow({ where: { title, deletedAt: null }, include: { labels: true, members: true, checklists: { include: { items: { orderBy: { position: 'asc' } } } } } });
      return {
        listId: c.listId, description: c.description, due: c.dueDate?.toISOString(), status: c.status, isDone: c.isDone,
        labels: c.labels.map((l) => l.labelId), members: c.members.map((m) => m.userId),
        checklists: c.checklists.map((cl) => ({ title: cl.title, items: cl.items.map((i) => [i.content, i.isDone, i.position]) })),
      };
    };
    expect(await shape('Song sinh A (bản sao)')).toEqual(await shape('Song sinh B (bản sao)'));
    const log = async (title: string) => {
      const c = await prisma.card.findFirstOrThrow({ where: { title } });
      return (await prisma.activity.findMany({ where: { cardId: c.id, type: 'card.create' } })).map((x) => strip(x.data));
    };
    expect(await log('Song sinh A (bản sao)')).toEqual([{ listName: 'Cần làm' }]);
    expect(await log('Song sinh A (bản sao)')).toEqual(await log('Song sinh B (bản sao)'));
  });

  it('sao chép sang cột khác với tên riêng: trạng thái theo cột đích, đúng tên người dùng gõ', async () => {
    const f = await seedActions();
    const reply = await ask(f, 'Sao chép thẻ Login UI sang cột Đang làm với tên Login UI bản hai', { type: 'COPY_CARD', card: text('Login UI'), toList: text('Đang làm'), title: 'Login UI bản hai' });
    expect(resultOf(reply).status).toBe('EXECUTED');
    const copy = await prisma.card.findFirstOrThrow({ where: { title: 'Login UI bản hai' } });
    expect(copy).toMatchObject({ listId: f.doing.id, status: 'IN_PROGRESS' });
  });

  it('ảnh bìa: đặt màu như updateCard, bỏ ảnh bìa, đã đúng thì nói rõ', async () => {
    const f = await seedActions();
    const { a, b } = await twinCards(f);
    const set = await ask(f, 'Đặt ảnh bìa màu đỏ cho thẻ Song sinh A', { type: 'SET_CARD_COVER', card: text('Song sinh A'), color: 'RED' });
    expect(resultOf(set)).toMatchObject({ status: 'EXECUTED', autoExecuted: true, summary: 'Đã đặt ảnh bìa màu đỏ cho thẻ “Song sinh A”.' });
    await updateCard(f.owner.id, b.id, { coverColor: '#f87168', coverImageUrl: null });
    const cover = async (id: string) => { const c = await prisma.card.findUniqueOrThrow({ where: { id } }); return [c.coverColor, c.coverImageUrl]; };
    expect(await cover(a.id)).toEqual(['#f87168', null]);
    expect(await cover(a.id)).toEqual(await cover(b.id));
    const again = await ask(f, 'Đặt ảnh bìa màu đỏ cho thẻ Song sinh A', { type: 'SET_CARD_COVER', card: text('Song sinh A'), color: 'RED' });
    expect(resultOf(again).summary).toBe('Ảnh bìa của thẻ “Song sinh A” đã là màu này rồi.');
    const clear = await ask(f, 'Bỏ ảnh bìa của thẻ Song sinh A', { type: 'SET_CARD_COVER', card: text('Song sinh A'), color: 'NONE' });
    expect(resultOf(clear).summary).toBe('Đã bỏ ảnh bìa của thẻ “Song sinh A”.');
    expect(await cover(a.id)).toEqual([null, null]);
  });

  it('màu mô hình tự chọn (người dùng không nói màu) → phải xem trước, không tự chạy', async () => {
    const f = await seedActions();
    const reply = await ask(f, 'Đặt ảnh bìa màu đỏ cho thẻ Login UI', { type: 'SET_CARD_COVER', card: text('Login UI'), color: 'BLUE' });
    expect(planOf(reply).reasons.map((r) => r.code)).toContain('NOT_GROUNDED');
    expect((await prisma.card.findUniqueOrThrow({ where: { id: f.loginUi.id } })).coverColor).toBeNull();
  });
});

describe('cột: lưu trữ / xóa / khôi phục / sao chép - luôn xem trước, giống list.service', () => {
  it('ARCHIVE_LIST: giống archiveList (archivedAt, thẻ giữ nguyên)', async () => {
    const f = await seedActions();
    const { a, b } = await twinLists(f);
    const p = await preview(f, 'Lưu trữ cột Nhóm A', [{ type: 'ARCHIVE_LIST', list: text('Nhóm A') }]);
    expect(p.plan).toMatchObject({ reasons: [{ code: 'ARCHIVE' }], items: [{ verb: 'Lưu trữ cột', text: '“Nhóm A”' }] });
    expect(p.plan.items[0].detail).toContain('3 thẻ');
    expect(resultOf(await p.confirm())).toMatchObject({ status: 'EXECUTED' });
    await archiveList(f.owner.id, b.list.id);
    for (const l of [a.list, b.list]) {
      const row = await prisma.list.findUniqueOrThrow({ where: { id: l.id } });
      expect(row.archivedAt).not.toBeNull();
      expect(row.deletedAt).toBeNull();
      expect(await prisma.card.count({ where: { listId: l.id, deletedAt: null } })).toBe(3);
    }
  });

  it('DELETE_LIST: xem trước cảnh báo (HIGH, danger) → Áp dụng giống deleteList (xóa mềm cột)', async () => {
    const f = await seedActions();
    const { a, b } = await twinLists(f);
    const p = await preview(f, 'Xóa danh sách Nhóm A', [{ type: 'DELETE_LIST', list: text('Nhóm A') }]);
    expect(p.plan).toMatchObject({ risk: 'HIGH', items: [{ verb: 'Xóa cột', danger: true }] });
    expect(p.plan.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['DELETE', 'NEW_STRUCTURE']));
    expect(resultOf(await p.confirm()).summary).toBe('Đã xóa cột “Nhóm A”.');
    await deleteList(f.owner.id, b.list.id);
    for (const l of [a.list, b.list]) expect((await prisma.list.findUniqueOrThrow({ where: { id: l.id } })).deletedAt).not.toBeNull();
  });

  it('RESTORE_LIST: giống restoreList (về cuối bảng)', async () => {
    const f = await seedActions();
    const { a, b } = await twinLists(f);
    await archiveList(f.owner.id, a.list.id);
    await archiveList(f.owner.id, b.list.id);
    const p = await preview(f, 'Khôi phục cột Nhóm A', [{ type: 'RESTORE_LIST', list: text('Nhóm A') }]);
    expect(resultOf(await p.confirm())).toMatchObject({ status: 'EXECUTED' });
    await restoreList(f.owner.id, b.list.id);
    const rows = { a: await prisma.list.findUniqueOrThrow({ where: { id: a.list.id } }), b: await prisma.list.findUniqueOrThrow({ where: { id: b.list.id } }) };
    expect(rows.a.archivedAt).toBeNull();
    expect(rows.b.archivedAt).toBeNull();
    expect(rows.b.position).toBe(rows.a.position + 1);
  });

  it('COPY_LIST: giống copyList (tên "(bản sao)", đặt ngay sau cột gốc, đẩy cột sau, giữ trạng thái từng thẻ)', async () => {
    const f = await seedActions();
    const { a, b } = await twinLists(f, 'IN_PROGRESS');
    const p = await preview(f, 'Sao chép cột Nhóm A', [{ type: 'COPY_LIST', list: text('Nhóm A') }]);
    expect(p.plan).toMatchObject({ reasons: [{ code: 'NEW_STRUCTURE' }], items: [{ verb: 'Sao chép cột' }] });
    expect(resultOf(await p.confirm()).status).toBe('EXECUTED');
    await copyList(f.owner.id, b.list.id);
    const copyA = await prisma.list.findFirstOrThrow({ where: { name: 'Nhóm A (bản sao)', boardId: f.alpha.id } });
    const copyB = await prisma.list.findFirstOrThrow({ where: { name: 'Nhóm B (bản sao)', boardId: f.alpha.id } });
    // bản sao của A chen ngay sau A và đẩy B xuống một bậc; bản sao của B chen ngay sau B (đã ở vị trí mới)
    const bNow = await prisma.list.findUniqueOrThrow({ where: { id: b.list.id } });
    expect(copyA).toMatchObject({ position: a.list.position + 1, status: 'IN_PROGRESS' });
    expect(bNow.position).toBe(b.list.position + 1);
    expect(copyB).toMatchObject({ position: bNow.position + 1, status: 'IN_PROGRESS' });
    const shape = async (id: string) => (await liveCards(id)).map((c) => [c.title, c.status, c.position]);
    expect(await shape(copyA.id)).toEqual(await shape(copyB.id));
    expect(await shape(copyA.id)).toEqual([['Zeta', 'IN_PROGRESS', 0], ['Alpha', 'IN_PROGRESS', 1], ['Mike', 'IN_PROGRESS', 2]]);
  });

  it('MOVE_LIST: lên đầu / xuống cuối / sau một cột - cùng thứ tự như updateList({ position })', async () => {
    const f = await seedActions();
    const { a, b } = await twinLists(f);
    const order = async () => (await prisma.list.findMany({ where: { boardId: f.alpha.id, deletedAt: null, archivedAt: null }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] })).map((l) => l.name);
    const first = await preview(f, 'Đưa cột Nhóm A lên đầu bảng', [{ type: 'MOVE_LIST', list: text('Nhóm A'), placement: 'FIRST' }]);
    expect(first.plan.items[0]).toMatchObject({ verb: 'Di chuyển cột', detail: 'lên đầu bảng' });
    expect(resultOf(await first.confirm()).status).toBe('EXECUTED');
    expect(await order()).toEqual(['Nhóm A', 'Cần làm', 'Đang làm', 'Hoàn thành', 'Nhóm B']);
    await updateList(f.owner.id, b.list.id, { position: 0 });
    expect(await order()).toEqual(['Nhóm B', 'Nhóm A', 'Cần làm', 'Đang làm', 'Hoàn thành']);
    const after = await preview(f, 'Di chuyển cột Nhóm A sau cột Cần làm', [{ type: 'MOVE_LIST', list: text('Nhóm A'), placement: 'AFTER', anchor: text('Cần làm') }]);
    expect(after.plan.items[0].detail).toBe('đặt sau cột “Cần làm”');
    expect(resultOf(await after.confirm()).status).toBe('EXECUTED');
    expect(await order()).toEqual(['Nhóm B', 'Cần làm', 'Nhóm A', 'Đang làm', 'Hoàn thành']);
    expect(a.list.id).not.toBe(b.list.id);
  });

  it('MOVE_LIST đã đúng vị trí → nói rõ; thứ tự cột đổi giữa chừng → STALE', async () => {
    const f = await seedActions();
    const same = await ask(f, 'Đưa cột Cần làm lên đầu bảng', { type: 'MOVE_LIST', list: text('Cần làm'), placement: 'FIRST' });
    expect(resultOf(same).summary).toBe('Cột “Cần làm” đã ở vị trí này rồi.');
    const p = await preview(f, 'Đưa cột Hoàn thành lên đầu bảng', [{ type: 'MOVE_LIST', list: text('Hoàn thành'), placement: 'FIRST' }]);
    await updateList(f.owner.id, f.doing.id, { position: 0 });
    expect(resultOf(await p.confirm()).status).toBe('STALE');
  });
});

describe('thao tác lên CẢ cột: sắp xếp / chuyển hết / xóa hết / trạng thái - luôn xem trước kèm số lượng', () => {
  it('SORT_LIST theo tên A-Z: giống sortListCards', async () => {
    const f = await seedActions();
    const { a, b } = await twinLists(f);
    const p = await preview(f, 'Sắp xếp thẻ trong cột Nhóm A theo tên A-Z', [{ type: 'SORT_LIST', list: text('Nhóm A'), sortBy: 'TITLE_ASC' }]);
    expect(p.plan).toMatchObject({ reasons: [{ code: 'BULK' }], items: [{ verb: 'Sắp xếp thẻ trong cột' }] });
    expect(await titles(a.list.id)).toEqual(['Zeta', 'Alpha', 'Mike']);
    expect(resultOf(await p.confirm()).status).toBe('EXECUTED');
    await sortListCards(f.owner.id, b.list.id, { by: 'title-asc' });
    expect(await titles(a.list.id)).toEqual(['Alpha', 'Mike', 'Zeta']);
    expect(await titles(a.list.id)).toEqual(await titles(b.list.id));
  });

  it('SORT_LIST đã đúng thứ tự → nói rõ, không ghi', async () => {
    const f = await seedActions();
    const { a } = await twinLists(f);
    await sortListCards(f.owner.id, a.list.id, { by: 'title-asc' });
    const reply = await ask(f, 'Sắp xếp thẻ trong cột Nhóm A theo tên A-Z', { type: 'SORT_LIST', list: text('Nhóm A'), sortBy: 'TITLE_ASC' });
    expect(resultOf(reply).summary).toBe('Các thẻ trong cột “Nhóm A” đã đúng thứ tự này rồi.');
  });

  it('MOVE_ALL_CARDS: giống moveAllCards (thẻ nguồn nằm SAU thẻ sẵn có ở cột đích, trạng thái theo cột đích, Activity card.status từng thẻ)', async () => {
    const f = await seedActions();
    const { a, b } = await twinLists(f, 'TODO');
    const doingBefore = (await liveCards(f.doing.id)).map((c) => c.title);
    const p = await preview(f, 'Chuyển tất cả thẻ của cột Nhóm A sang cột Đang làm', [{ type: 'MOVE_ALL_CARDS', list: text('Nhóm A'), toList: text('Đang làm') }]);
    expect(p.plan).toMatchObject({ reasons: [{ code: 'BULK' }], items: [{ verb: 'Chuyển hết thẻ', text: '“Nhóm A” → “Đang làm”', detail: expect.stringContaining('3 thẻ') }] });
    expect(resultOf(await p.confirm()).status).toBe('EXECUTED');
    expect(await titles(a.list.id)).toEqual([]);
    const afterChat = await liveCards(f.doing.id);
    expect(afterChat.map((c) => c.title)).toEqual([...doingBefore, 'Zeta', 'Alpha', 'Mike']);
    expect(afterChat.slice(-3).map((c) => c.status)).toEqual(['IN_PROGRESS', 'IN_PROGRESS', 'IN_PROGRESS']);
    await moveAllCards(f.owner.id, b.list.id, { targetListId: f.doing.id });
    const afterService = await liveCards(f.doing.id);
    expect(afterService.slice(-3).map((c) => [c.title, c.status])).toEqual([['Zeta', 'IN_PROGRESS'], ['Alpha', 'IN_PROGRESS'], ['Mike', 'IN_PROGRESS']]);
    const log = (cards: { id: string }[]) => prisma.activity.count({ where: { type: 'card.status', cardId: { in: cards.map((c) => c.id) } } });
    expect(await log(a.cards)).toBe(3);
    expect(await log(a.cards)).toBe(await log(b.cards));
  });

  it('MOVE_ALL_CARDS chuyển tới cột DONE: Activity card.done từng thẻ giống service, chạy tự động hóa CARD_MOVED_TO_LIST', async () => {
    const f = await seedActions();
    const a = await twinLists(f, 'TODO');
    const p = await preview(f, 'Chuyển tất cả thẻ của cột Nhóm A sang cột Hoàn thành', [{ type: 'MOVE_ALL_CARDS', list: text('Nhóm A'), toList: text('Hoàn thành') }]);
    expect(resultOf(await p.confirm()).status).toBe('EXECUTED');
    expect((await liveCards(f.done.id)).map((c) => [c.title, c.status, c.isDone])).toEqual([['Zeta', 'DONE', true], ['Alpha', 'DONE', true], ['Mike', 'DONE', true]]);
    expect((await prisma.activity.findMany({ where: { type: 'card.done', boardId: f.alpha.id } })).map((x) => strip(x.data))).toEqual([{ from: 'TODO', to: 'DONE' }, { from: 'TODO', to: 'DONE' }, { from: 'TODO', to: 'DONE' }]);
    expect(a.a.list.id).toBeTruthy();
  });

  it('MOVE_ALL_CARDS cột nguồn trùng cột đích → từ chối; cột rỗng → nói rõ', async () => {
    const f = await seedActions();
    const same = await ask(f, 'Chuyển tất cả thẻ của cột Cần làm sang cột Cần làm', { type: 'MOVE_ALL_CARDS', list: text('Cần làm'), toList: text('Cần làm') });
    expect(same.answer.text).toContain('là một');
    const empty = await ask(f, 'Chuyển tất cả thẻ của cột Hoàn thành sang cột Đang làm', { type: 'MOVE_ALL_CARDS', list: text('Hoàn thành'), toList: text('Đang làm') });
    expect(resultOf(empty).summary).toBe('Cột “Hoàn thành” không có thẻ nào để chuyển.');
  });

  it('DELETE_ALL_CARDS: cảnh báo số thẻ (HIGH) → Áp dụng giống deleteAllCards (xóa mềm hết thẻ, cột giữ nguyên)', async () => {
    const f = await seedActions();
    const { a, b } = await twinLists(f);
    const p = await preview(f, 'Xóa hết thẻ trong cột Nhóm A', [{ type: 'DELETE_ALL_CARDS', list: text('Nhóm A') }]);
    expect(p.plan).toMatchObject({ risk: 'HIGH', items: [{ verb: 'Xóa hết thẻ trong cột', danger: true }] });
    expect(p.plan.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['DELETE', 'BULK']));
    expect(p.plan.items[0].detail).toContain('3 thẻ');
    expect(resultOf(await p.confirm())).toMatchObject({ status: 'EXECUTED', summary: 'Đã xóa 3 thẻ trong cột “Nhóm A”.' });
    await deleteAllCards(f.owner.id, b.list.id);
    for (const l of [a.list, b.list]) {
      expect(await prisma.card.count({ where: { listId: l.id, deletedAt: null } })).toBe(0);
      expect((await prisma.list.findUniqueOrThrow({ where: { id: l.id } })).deletedAt).toBeNull();
    }
  });

  it('DELETE_ALL_CARDS: có thẻ mới xuất hiện giữa xem trước và Áp dụng → STALE (không xóa thẻ người xem chưa thấy)', async () => {
    const f = await seedActions();
    const { a } = await twinLists(f);
    const p = await preview(f, 'Xóa hết thẻ trong cột Nhóm A', [{ type: 'DELETE_ALL_CARDS', list: text('Nhóm A') }]);
    await prisma.card.create({ data: { listId: a.list.id, title: 'Thẻ mới', position: 9 } });
    expect(resultOf(await p.confirm()).status).toBe('STALE');
    expect(await prisma.card.count({ where: { listId: a.list.id, deletedAt: null } })).toBe(4);
  });

  it('SET_LIST_STATUS: giống updateList({ status }) - cột và thẻ đổi theo, Activity từng thẻ; "NONE" bỏ trạng thái cột', async () => {
    const f = await seedActions();
    const { a, b } = await twinLists(f, 'TODO');
    const p = await preview(f, 'Đặt trạng thái cột Nhóm A là xong', [{ type: 'SET_LIST_STATUS', list: text('Nhóm A'), status: 'DONE' }]);
    expect(p.plan.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['BULK', 'NEW_STRUCTURE']));
    expect(p.plan.items[0].detail).toContain('3 thẻ trong cột sẽ đổi theo');
    expect(resultOf(await p.confirm()).status).toBe('EXECUTED');
    await updateList(f.owner.id, b.list.id, { status: 'DONE' });
    for (const l of [a.list, b.list]) {
      expect((await prisma.list.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('DONE');
      expect((await liveCards(l.id)).map((c) => [c.status, c.isDone])).toEqual([['DONE', true], ['DONE', true], ['DONE', true]]);
    }
    const log = async (listId: string) => (await prisma.activity.findMany({ where: { type: 'card.done', cardId: { in: (await liveCards(listId)).map((c) => c.id) } } })).length;
    expect(await log(a.list.id)).toBe(await log(b.list.id));
    const none = await preview(f, 'Bỏ trạng thái của cột Nhóm A', [{ type: 'SET_LIST_STATUS', list: text('Nhóm A'), status: 'NONE' }]);
    expect(resultOf(await none.confirm()).summary).toBe('Đã bỏ trạng thái của cột “Nhóm A” (cột tự do).');
    expect((await prisma.list.findUniqueOrThrow({ where: { id: a.list.id } })).status).toBeNull();
    expect((await liveCards(a.list.id)).map((c) => c.status)).toEqual(['DONE', 'DONE', 'DONE']);
  });

  it('SET_LIST_STATUS: trạng thái do mô hình tự chọn (người dùng không nói) → phải xem lại nguồn gốc, không tự chạy', async () => {
    const f = await seedActions();
    const reply = await ask(f, 'Đặt trạng thái cột Cần làm là xong', { type: 'SET_LIST_STATUS', list: text('Cần làm'), status: 'BLOCKED' });
    expect(planOf(reply).reasons.map((r) => r.code)).toContain('NOT_GROUNDED');
    expect((await prisma.list.findUniqueOrThrow({ where: { id: f.todo.id } })).status).toBe('TODO');
  });
});
