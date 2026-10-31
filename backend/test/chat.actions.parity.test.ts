// Phase 2 - "tương đương thao tác tay": cùng một việc được làm (a) bằng SERVICE THẬT của giao diện (createCard, updateCard, moveCard,
// addCardMember, attachLabel, createList) trên thế giới A và (b) bằng kế hoạch chatbot (hàm ghi trong transaction) trên thế giới B giống hệt.
// Sau đó so sánh THỨ ĐƯỢC QUAN SÁT: dữ liệu bảng, nhật ký Activity, thông báo (ai nhận, loại gì, nội dung gì), bảng được báo realtime.
// Đây là lưới an toàn cho việc KHÔNG refactor service cũ (D2): hai đường ghi khác mã nhưng phải cho cùng kết quả.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import { persistentConfirm, persistentMessage } from '../src/modules/chat/v2/chat.v2.history';
import { V2SessionStore } from '../src/modules/chat/v2/chat.v2.session';
import { createCard, moveCard, updateCard } from '../src/modules/card/card.service';
import { addCardMember } from '../src/modules/card/cardExtras.service';
import { attachLabel } from '../src/modules/label/label.service';
import { createList } from '../src/modules/list/list.service';
import { ACT_NOW, actionContext, propose, script, seedActions, text, type ActionWorld } from './chat.actions.fixture';

const mocks = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock('../src/realtime/socket', async (original) => ({ ...(await original<object>()), emitToBoard: mocks.emit }));

const onBoard = (w: ActionWorld) => ({ kind: 'BOARD' as const, boardId: w.alpha.id });
let tick = 0;
beforeEach(() => {
  mocks.emit.mockClear();
  tick = 0;
});

/** Chạy một kế hoạch chatbot ở bảng của thế giới `w` (xem trước rồi Áp dụng — luôn qua cả bước dựng lại để so sánh). */
async function viaChatbot(w: ActionWorld, message: string, operations: unknown[]) {
  const sessions = new V2SessionStore();
  tick += 1;
  const now = new Date(ACT_NOW.getTime() + tick * 1000);
  const reply = await persistentMessage(w.owner.id, { message, scope: onBoard(w) }, actionContext({ sessions, now, step: script([propose(...operations)]), autoExecute: false }));
  const a = reply.answer.action;
  if (a?.kind !== 'PLAN') throw new Error(`cần PLAN: ${reply.answer.text}`);
  const done = await persistentConfirm(w.owner.id, a.plan.planId, { conversationId: reply.conversationId, checksum: a.plan.checksum, scope: onBoard(w) }, actionContext({ sessions, now: new Date(ACT_NOW.getTime() + 300_000) }));
  if (done.answer.action?.kind !== 'RESULT' || done.answer.action.result.status !== 'EXECUTED') throw new Error(`cần EXECUTED: ${done.answer.text}`);
}

/** Thay mọi id bằng nhãn ổn định để hai thế giới (id khác nhau) so sánh được. */
async function labelsOf(w: ActionWorld) {
  const map = new Map<string, string>();
  const users = [w.owner, w.lan, w.tuan, w.viewer, w.outsider];
  for (const u of users) map.set(u.id, `<user:${u.name}>`);
  map.set(w.alpha.id, '<board>');
  for (const l of await prisma.list.findMany({ where: { boardId: w.alpha.id } })) map.set(l.id, `<list:${l.name}>`);
  for (const c of await prisma.card.findMany({ where: { list: { boardId: w.alpha.id } } })) map.set(c.id, `<card:${c.title}>`);
  for (const l of await prisma.label.findMany({ where: { boardId: w.alpha.id } })) map.set(l.id, `<label:${l.name}>`);
  return (value: unknown): unknown => {
    let s = JSON.stringify(value);
    for (const [id, label] of map) s = s.split(id).join(label);
    return JSON.parse(s);
  };
}

/** Mọi thứ người dùng có thể quan sát được ở bảng sau một thao tác. */
async function snapshot(w: ActionWorld) {
  const norm = await labelsOf(w);
  const lists = await prisma.list.findMany({
    where: { boardId: w.alpha.id, deletedAt: null },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: {
      cards: {
        where: { deletedAt: null },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        include: { members: true, labels: true, reminders: true },
      },
    },
  });
  const board = lists.map((l) => ({
    name: l.name,
    position: l.position,
    status: l.status,
    cards: l.cards.map((c) => ({
      title: c.title,
      position: c.position,
      status: c.status,
      isDone: c.isDone,
      completed: c.completedAt !== null,
      due: c.dueDate?.toISOString() ?? null,
      members: c.members.map((m) => m.userId).sort(),
      labels: c.labels.map((x) => x.labelId).sort(),
      reminders: c.reminders.map((r) => r.sentAt !== null),
    })),
  }));
  const activities = (await prisma.activity.findMany({ where: { boardId: w.alpha.id }, orderBy: { createdAt: 'asc' } })).map((a) => ({ type: a.type, user: a.userId, card: a.cardId, data: a.data }));
  const notifications = (await prisma.notification.findMany({ where: { boardId: w.alpha.id } }))
    .map((n) => ({ type: n.type, to: n.userId, actor: n.actorId, card: n.cardId, data: n.data }))
    .map((n) => JSON.stringify(norm(n)))
    .sort();
  const boards = [...new Set(mocks.emit.mock.calls.map((c) => c[0] as string))].map((id) => (id === w.alpha.id ? '<board>' : id));
  return { board: norm(board), activities: norm(activities), notifications, boards };
}

/** Hai thế giới giống hệt nhau (cùng dữ liệu mẫu, id khác); `prepare` chạy trên CẢ HAI trước khi so sánh. */
async function twins(prepare: (w: ActionWorld) => Promise<void> = async () => {}) {
  const a = await seedActions();
  const b = await seedActions();
  for (const w of [a, b]) await prepare(w);
  return { a, b };
}

async function compare(a: ActionWorld, b: ActionWorld, manual: (w: ActionWorld) => Promise<unknown>, chatbot: (w: ActionWorld) => Promise<unknown>) {
  mocks.emit.mockClear();
  await manual(a);
  const manualEmits = new Set(mocks.emit.mock.calls.map((c) => c[0]));
  const manualCount = mocks.emit.mock.calls.length;
  expect([...manualEmits]).toEqual([a.alpha.id]); // thao tác tay có báo realtime cho bảng
  const sa = await snapshot(a);
  mocks.emit.mockClear();
  await chatbot(b);
  const sb = await snapshot(b);
  expect(sb.boards).toEqual(['<board>']); // chatbot cũng báo đúng bảng đó
  // gộp thành ít sự kiện hơn (hoặc bằng) thao tác tay: một sự kiện cho cả kế hoạch + sự kiện do chính luật tự động hóa phát
  expect(mocks.emit.mock.calls.length).toBeGreaterThanOrEqual(1);
  expect(mocks.emit.mock.calls.length).toBeLessThanOrEqual(manualCount);
  expect(sb.board).toEqual(sa.board);
  expect(sb.activities).toEqual(sa.activities);
  expect(sb.notifications).toEqual(sa.notifications);
  return sa;
}

const manualMove = async (w: ActionWorld, cardId: string, listId: string) => {
  const position = await prisma.card.count({ where: { listId, deletedAt: null, archivedAt: null, id: { not: cardId } } });
  await moveCard(w.owner.id, cardId, { listId, position });
};

describe('mỗi thao tác của chatbot ghi GIỐNG HỆT thao tác tay', () => {
  it('CREATE_LIST: cột mới ở cuối, trạng thái đoán theo tên (có / không có)', async () => {
    for (const [name, status] of [['Kiểm thử', 'IN_REVIEW'], ['Ý tưởng', null], ['Hoàn thành sớm', 'DONE']] as const) {
      const { a, b } = await twins();
      const snap = await compare(a, b, (w) => createList(w.owner.id, w.alpha.id, { name }), (w) => viaChatbot(w, `Tạo cột ${name}`, [{ type: 'CREATE_LIST', name }]));
      expect((snap.board as Array<{ name: string; status: string | null; position: number }>).at(-1)).toMatchObject({ name, status, position: 3 });
      await prisma.$executeRawUnsafe('TRUNCATE "Board" CASCADE'); // dọn để lần lặp sau có hai thế giới mới
    }
  });

  it('CREATE_CARD vào cột thường và vào cột DONE (thẻ sinh ra đã xong: isDone, completedAt)', async () => {
    for (const listName of ['Cần làm', 'Hoàn thành']) {
      const { a, b } = await twins();
      const listOf = (w: ActionWorld) => (listName === 'Cần làm' ? w.todo.id : w.done.id);
      const snap = await compare(a, b, (w) => createCard(w.owner.id, listOf(w), { title: 'Họp nhóm' }), (w) => viaChatbot(w, `Tạo thẻ Họp nhóm trong cột ${listName}`, [{ type: 'CREATE_CARD', title: 'Họp nhóm', list: text(listName) }]));
      const made = (snap.board as Array<{ name: string; cards: Array<{ title: string; isDone: boolean; completed: boolean }> }>).find((l) => l.name === listName)!.cards.at(-1)!;
      expect(made).toMatchObject({ title: 'Họp nhóm', isDone: listName === 'Hoàn thành', completed: listName === 'Hoàn thành' });
      await prisma.$executeRawUnsafe('TRUNCATE "Board" CASCADE');
    }
  });

  it('RENAME_CARD: Activity card.rename + thông báo card.renamed cho thành viên của thẻ', async () => {
    const { a, b } = await twins(async (w) => { await prisma.cardMember.create({ data: { cardId: w.loginUi.id, userId: w.tuan.id } }); });
    const snap = await compare(a, b, (w) => updateCard(w.owner.id, w.loginUi.id, { title: 'Đăng nhập giao diện' }), (w) => viaChatbot(w, 'Đổi tên thẻ Login UI thành Đăng nhập giao diện', [{ type: 'RENAME_CARD', card: text('Login UI'), title: 'Đăng nhập giao diện' }]));
    expect(snap.notifications).toHaveLength(1);
  });

  it('SET_CARD_DUE: đặt hạn (đặt lại nhắc hạn + thông báo) và bỏ hạn (xoá nhắc hạn)', async () => {
    const due = '2026-10-09T16:59:00.000Z';
    const { a, b } = await twins(async (w) => {
      await prisma.cardMember.create({ data: { cardId: w.report.id, userId: w.tuan.id } });
      await prisma.cardReminder.create({ data: { cardId: w.report.id, userId: w.owner.id, offsetMinutes: 60, sentAt: new Date() } });
    });
    const set = await compare(a, b, (w) => updateCard(w.owner.id, w.report.id, { dueDate: '2026-10-12T16:59:00.000Z' }), (w) => viaChatbot(w, 'Đặt hạn Báo cáo tuần là 12/10', [{ type: 'SET_CARD_DUE', card: text('Báo cáo tuần'), due: { type: 'ABSOLUTE', date: '2026-10-12' } }]));
    expect(set.notifications).toHaveLength(1);
    mocks.emit.mockClear();
    // bỏ hạn tiếp trên cả hai thế giới (hạn hiện là 12/10 ở cả hai)
    await updateCard(a.owner.id, a.report.id, { dueDate: null });
    const sa = await snapshot(a);
    mocks.emit.mockClear();
    await viaChatbot(b, 'Bỏ hạn thẻ Báo cáo tuần', [{ type: 'SET_CARD_DUE', card: text('Báo cáo tuần'), due: { type: 'NONE' } }]);
    const sb = await snapshot(b);
    expect(sb.board).toEqual(sa.board);
    expect(sb.activities).toEqual(sa.activities);
    expect(sa.activities.map((x) => (x as { type: string }).type)).toContain('card.due.clear');
    expect(due).toBe('2026-10-09T16:59:00.000Z');
  });

  it('MOVE_CARD: vị trí cột đích, đánh lại cột nguồn, trạng thái theo cột, Activity move + status, thông báo card.moved, luật tự động hóa', async () => {
    for (const target of ['Đang làm', 'Hoàn thành']) {
      const { a, b } = await twins(async (w) => {
        await prisma.cardMember.create({ data: { cardId: w.loginUi.id, userId: w.tuan.id } });
        const rule = await prisma.automationRule.create({ data: { boardId: w.alpha.id, createdById: w.owner.id, name: 'Vào cột thì gắn Gấp', triggerType: 'CARD_MOVED_TO_LIST', triggerListId: target === 'Đang làm' ? w.doing.id : w.done.id } });
        await prisma.automationAction.create({ data: { ruleId: rule.id, type: 'ADD_LABEL', labelId: w.urgent.id } });
      });
      const to = (w: ActionWorld) => (target === 'Đang làm' ? w.doing.id : w.done.id);
      const snap = await compare(a, b, (w) => manualMove(w, w.loginUi.id, to(w)), (w) => viaChatbot(w, `Chuyển Login UI sang ${target}`, [{ type: 'MOVE_CARD', card: text('Login UI'), toList: text(target) }]));
      const moved = (snap.board as Array<{ name: string; cards: Array<{ title: string; labels: string[]; status: string }> }>).find((l) => l.name === target)!.cards.find((c) => c.title === 'Login UI')!;
      expect(moved.labels).toEqual(['<label:Gấp>']); // luật tự động hóa chạy ở CẢ HAI đường
      expect(moved.status).toBe(target === 'Đang làm' ? 'IN_PROGRESS' : 'DONE');
      await prisma.$executeRawUnsafe('TRUNCATE "Board" CASCADE');
    }
  });

  it('SET_CARD_STATUS: liên kết hai chiều với cột (thẻ tự chuyển cột), vào DONE có thông báo "đã hoàn thành", mở lại, và cột tự do chỉ đổi trạng thái', async () => {
    const cases: Array<[string, 'IN_PROGRESS' | 'DONE' | 'BLOCKED', string]> = [
      ['TODO → IN_PROGRESS (kéo sang cột Đang làm)', 'IN_PROGRESS', 'Đặt Login UI là đang làm'],
      ['TODO → DONE (kéo sang Hoàn thành + thông báo)', 'DONE', 'Đánh dấu Login UI là xong'],
      ['TODO → BLOCKED (bảng không có cột Bị chặn: chỉ đổi trạng thái)', 'BLOCKED', 'Đặt Login UI là bị chặn'],
    ];
    for (const [name, status, message] of cases) {
      const { a, b } = await twins(async (w) => { await prisma.cardMember.create({ data: { cardId: w.loginUi.id, userId: w.lan.id } }); });
      await compare(a, b, (w) => updateCard(w.owner.id, w.loginUi.id, { status }), (w) => viaChatbot(w, message, [{ type: 'SET_CARD_STATUS', card: text('Login UI'), status }]));
      expect(name.length).toBeGreaterThan(0);
      await prisma.$executeRawUnsafe('TRUNCATE "Board" CASCADE');
    }
    // mở lại thẻ đã xong, và thẻ trong cột tự do (không gắn trạng thái)
    const { a, b } = await twins(async (w) => {
      await prisma.card.update({ where: { id: w.report.id }, data: { listId: w.done.id, status: 'DONE', isDone: true, completedAt: new Date() } });
      const free = await prisma.list.create({ data: { boardId: w.alpha.id, name: 'Ý tưởng', position: 9 } });
      await prisma.card.update({ where: { id: w.design.id }, data: { listId: free.id } });
    });
    await compare(a, b, (w) => updateCard(w.owner.id, w.report.id, { status: 'TODO' }), (w) => viaChatbot(w, 'Đặt Báo cáo tuần là chưa làm', [{ type: 'SET_CARD_STATUS', card: text('Báo cáo tuần'), status: 'TODO' }]));
    const free = await compare(a, b, (w) => updateCard(w.owner.id, w.design.id, { status: 'IN_REVIEW' }), (w) => viaChatbot(w, 'Đặt Thiết kế giao diện là chờ duyệt', [{ type: 'SET_CARD_STATUS', card: text('Thiết kế giao diện'), status: 'IN_REVIEW' }]));
    const idea = (free.board as Array<{ name: string; cards: Array<{ title: string; status: string }> }>).find((l) => l.name === 'Ý tưởng')!;
    expect(idea.cards).toMatchObject([{ title: 'Thiết kế giao diện', status: 'IN_REVIEW' }]); // vẫn ở cột tự do
  });

  it('ASSIGN_MEMBER: Activity member.add (có memberId + memberName) + thông báo cho người được giao; giao lại không ghi thêm', async () => {
    const { a, b } = await twins();
    const snap = await compare(a, b, (w) => addCardMember(w.owner.id, w.design.id, w.lan.id), (w) => viaChatbot(w, 'Giao Thiết kế giao diện cho Lan', [{ type: 'ASSIGN_MEMBER', card: text('Thiết kế giao diện'), member: text('Lan') }]));
    expect(snap.notifications).toHaveLength(1);
    expect(snap.activities).toMatchObject([{ type: 'member.add', data: { memberId: '<user:Nguyễn Lan>', memberName: 'Nguyễn Lan' } }]);
  });

  it('ADD_LABEL: gắn nhãn (không Activity, không thông báo — như attachLabel)', async () => {
    const { a, b } = await twins();
    const snap = await compare(a, b, (w) => attachLabel(w.owner.id, w.design.id, w.backend.id), (w) => viaChatbot(w, 'Gắn nhãn Backend vào Thiết kế giao diện', [{ type: 'ADD_LABEL', card: text('Thiết kế giao diện'), label: text('Backend') }]));
    expect(snap.activities).toEqual([]);
    expect(snap.notifications).toEqual([]);
  });
});

describe('chuỗi nhiều thao tác = làm tay từng bước theo đúng thứ tự', () => {
  it('tạo cột → tạo thẻ → gắn nhãn → giao người (thẻ mới nhận thông báo "được giao" nhưng không nhận gì khác)', async () => {
    const { a, b } = await twins();
    const snap = await compare(
      a,
      b,
      async (w) => {
        const list = await createList(w.owner.id, w.alpha.id, { name: 'Kiểm thử' });
        const card = await createCard(w.owner.id, list.id, { title: 'Unit Test' });
        await attachLabel(w.owner.id, card.id, w.backend.id);
        await addCardMember(w.owner.id, card.id, w.lan.id);
      },
      (w) => viaChatbot(w, 'Tạo cột Kiểm thử, thêm task Unit Test, gắn nhãn Backend và giao cho Lan', [
        { type: 'CREATE_LIST', key: 'c1', name: 'Kiểm thử' },
        { type: 'CREATE_CARD', key: 'k1', title: 'Unit Test', list: { by: 'PLAN', key: 'c1' } },
        { type: 'ADD_LABEL', card: { by: 'PLAN', key: 'k1' }, label: text('Backend') },
        { type: 'ASSIGN_MEMBER', card: { by: 'PLAN', key: 'k1' }, member: text('Lan') },
      ])
    );
    expect(snap.activities.map((x) => (x as { type: string }).type)).toEqual(['card.create', 'member.add']);
  });

  it('đổi tên rồi giao người cùng một thẻ: người MỚI được giao không nhận thông báo đổi tên (đúng thứ tự tay)', async () => {
    const { a, b } = await twins(async (w) => { await prisma.cardMember.create({ data: { cardId: w.loginUi.id, userId: w.tuan.id } }); });
    const snap = await compare(
      a,
      b,
      async (w) => {
        await updateCard(w.owner.id, w.loginUi.id, { title: 'Đăng nhập giao diện' });
        await addCardMember(w.owner.id, w.loginUi.id, w.lan.id);
      },
      (w) => viaChatbot(w, 'Đổi tên thẻ Login UI thành Đăng nhập giao diện và giao cho Lan', [
        { type: 'RENAME_CARD', card: text('Login UI'), title: 'Đăng nhập giao diện' },
        { type: 'ASSIGN_MEMBER', card: text('Login UI'), member: text('Lan') },
      ])
    );
    const toLan = snap.notifications.map((n) => JSON.parse(n) as { type: string; to: string }).filter((n) => n.to === '<user:Nguyễn Lan>');
    expect(toLan.map((n) => n.type)).toEqual(['card.member.added']);
  });

  it('chuyển hai thẻ sang cùng một cột rồi đánh dấu một thẻ khác là xong', async () => {
    const { a, b } = await twins();
    await compare(
      a,
      b,
      async (w) => {
        await manualMove(w, w.loginUi.id, w.doing.id);
        await manualMove(w, w.design.id, w.doing.id);
        await updateCard(w.owner.id, w.payment.id, { status: 'DONE' });
      },
      (w) => viaChatbot(w, 'Chuyển Login UI và Thiết kế giao diện sang Đang làm và đánh dấu API thanh toán là xong', [
        { type: 'MOVE_CARD', card: text('Login UI'), toList: text('Đang làm') },
        { type: 'MOVE_CARD', card: text('Thiết kế giao diện'), toList: text('Đang làm') },
        { type: 'SET_CARD_STATUS', card: text('API thanh toán'), status: 'DONE' },
      ])
    );
  });
});
