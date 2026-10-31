// API /api/chat + dieu phoi mot luot hoi (CHATBOT_MODULE.md §9, §12, §15).
// HTTP that qua supertest; rieng het han phien / khoi dong lai goi thang dich vu voi dong ho gia.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import { periodRange } from '../src/modules/chat/chat.period';
import { handleMessage, type Understand } from '../src/modules/chat/chat.service';
import { ChatSessionStore } from '../src/modules/chat/chat.session';
import { agent, makeDirectUser, type TestUser } from './helpers';

const D = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function setup() {
  const u = {
    leader: await makeDirectUser('Trưởng Nhóm'),
    lan1: await makeDirectUser('Nguyễn Thị Lan'),
    lan2: await makeDirectUser('Trần Lan'),
    minh: await makeDirectUser('Hoàng Minh'),
    leaderB: await makeDirectUser('Trưởng Nhóm B'),
    solo: await makeDirectUser('Một Mình'),
  };
  const ws = (name: string, owner: TestUser, members: TestUser[]) =>
    prisma.workspace.create({
      data: {
        ownerId: owner.id,
        name,
        members: { create: [{ userId: owner.id, role: 'OWNER' as const }, ...members.map((m) => ({ userId: m.id, role: 'MEMBER' as const }))] },
      },
      select: { id: true },
    });
  const wsA = await ws('Nhóm A', u.leader, [u.lan1, u.lan2, u.minh]);
  const wsB = await ws('Nhóm B', u.leaderB, [u.minh]);
  const board = async (name: string, owner: TestUser, workspaceId: string, visibility: 'PRIVATE' | 'WORKSPACE' | 'PUBLIC', others: TestUser[] = [], archived = false) => {
    const b = await prisma.board.create({
      data: {
        name,
        ownerId: owner.id,
        workspaceId,
        visibility,
        archivedAt: archived ? new Date() : null,
        lists: { create: { name: 'Việc' } },
        members: { create: [{ userId: owner.id, role: 'OWNER' as const }, ...others.map((m) => ({ userId: m.id, role: 'MEMBER' as const }))] },
      },
      include: { lists: { select: { id: true } } },
    });
    return { id: b.id, listId: b.lists[0]!.id };
  };
  const b = {
    W: await board('A-chung', u.leader, wsA.id, 'WORKSPACE'),
    P: await board('A-rieng', u.leader, wsA.id, 'PRIVATE', [u.lan1]),
    B1: await board('B-chung', u.leaderB, wsB.id, 'WORKSPACE'),
    PUB: await board('B-cong-khai', u.leaderB, wsB.id, 'PUBLIC'),
    OLD: await board('A-luu-tru', u.leader, wsA.id, 'WORKSPACE', [], true),
  };
  // lan1: 12 viec dang mo han +1..+12 ngay tren A-chung + 1 viec tren bang rieng; lan2: 2 viec qua han
  const now = Date.now();
  for (let k = 1; k <= 12; k++) {
    await prisma.card.create({
      data: { listId: b.W.listId, title: `Lan1 viec ${k}`, description: 'MO-TA-KIN', dueDate: new Date(now + k * D), members: { create: { userId: u.lan1.id } } },
    });
  }
  await prisma.card.create({ data: { listId: b.P.listId, title: 'Lan1 viec rieng', members: { create: { userId: u.lan1.id } } } });
  for (let k = 1; k <= 2; k++) {
    await prisma.card.create({
      data: { listId: b.W.listId, title: `Lan2 qua han ${k}`, dueDate: new Date(now - k * D), members: { create: { userId: u.lan2.id } } },
    });
  }
  await prisma.card.create({ data: { listId: b.B1.listId, title: 'B qua han', dueDate: new Date(now - 3 * D), members: { create: { userId: u.minh.id } } } });
  return { u, b, wsA: wsA.id, wsB: wsB.id };
}

const MY = { kind: 'MY' as const };
async function ask(user: TestUser, message: string, scope: object = MY, conversationId?: string) {
  return agent()
    .post('/api/chat/messages')
    .set('Cookie', user.cookie)
    .send({ message, scope, ...(conversationId ? { conversationId } : {}) });
}
const choose = (user: TestUser, body: object) => agent().post('/api/chat/messages/choice').set('Cookie', user.cookie).send(body);
const more = (user: TestUser, conversationId: string, page: number) =>
  agent().post('/api/chat/messages/more').set('Cookie', user.cookie).send({ conversationId, page });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('dang nhap + kiem than yeu cau', () => {
  it('401 khi chua dang nhap; 400 khi sai dinh dang, gui kem vai tro / danh tinh', async () => {
    const { u } = await setup();
    for (const [method, path] of [
      ['get', '/api/chat/status'],
      ['post', '/api/chat/messages'],
      ['post', '/api/chat/messages/choice'],
      ['post', '/api/chat/messages/more'],
    ] as const) {
      const res = await agent()[method](path).send({});
      expect(res.status, path).toBe(401);
    }
    const uuid = '00000000-0000-4000-8000-000000000000';
    const bad: [string, object][] = [
      ['/api/chat/messages', { message: '', scope: MY }],
      ['/api/chat/messages', { message: '   ', scope: MY }],
      ['/api/chat/messages', { message: 'x'.repeat(501), scope: MY }],
      ['/api/chat/messages', { message: 'Việc của tôi?' }],
      ['/api/chat/messages', { message: 'Việc của tôi?', scope: { kind: 'ALL' } }],
      ['/api/chat/messages', { message: 'Việc của tôi?', scope: { kind: 'WORKSPACE' } }],
      ['/api/chat/messages', { message: 'Việc của tôi?', scope: { kind: 'MY', workspaceId: 'x' } }],
      ['/api/chat/messages', { message: 'Việc của tôi?', scope: MY, role: 'OWNER' }],
      ['/api/chat/messages', { message: 'Việc của tôi?', scope: MY, userId: u.leader.id }],
      ['/api/chat/messages', { message: 'Việc của tôi?', scope: MY, conversationId: 'abc' }],
      ['/api/chat/messages/choice', { conversationId: uuid }],
      ['/api/chat/messages/choice', { conversationId: uuid, userId: 'a', workspaceId: 'b' }],
      ['/api/chat/messages/more', { conversationId: uuid, page: 1 }],
      ['/api/chat/messages/more', { conversationId: uuid, page: 1.5 }],
      ['/api/chat/messages/more', { conversationId: uuid, page: '2' }],
    ];
    for (const [path, body] of bad) {
      const res = await agent().post(path).set('Cookie', u.lan1.cookie).send(body);
      expect(res.status, `${path} ${JSON.stringify(body).slice(0, 80)}`).toBe(400);
      expect(res.body.success).toBe(false);
    }
    const status = await agent().get('/api/chat/status').set('Cookie', u.lan1.cookie);
    expect([status.status, status.body.data]).toEqual([200, { llmAvailable: false }]);
  });
});

describe('mot luot hoi day du (chua co LLM)', () => {
  it('viec ca nhan, cau noi tiep, xem them, doi pham vi thi khong ke thua', async () => {
    const { u, wsA } = await setup();
    const r1 = await ask(u.lan1, 'Việc nào của tôi sắp đến hạn?');
    expect(r1.status).toBe(200);
    const d1 = r1.body.data;
    expect(d1.conversationId).toMatch(UUID);
    expect(d1.conversationReset).toBeUndefined();
    expect(d1.understood).toEqual({ intent: 'MY_TASKS', period: 'NEXT_7_DAYS', focus: 'OPEN', memberName: null, parser: 'RULE' });
    expect([d1.answer.kind, d1.answer.total, d1.answer.cards.length]).toEqual(['ANSWER', 7, 7]);
    expect(d1.answer.text).toBe('Bạn có 7 việc sắp đến hạn trong 7 ngày tới.');
    expect(d1.answer.scopeLabel).toBe('Tính trên 2 bảng bạn xem được.'); // A-chung + A-rieng
    expect(JSON.stringify(r1.body)).not.toMatch(/MO-TA-KIN|@test\.local|email/);

    // cau noi tiep: giu "dang mo", doi ky
    const r2 = await ask(u.lan1, 'còn tuần sau thì sao?', MY, d1.conversationId);
    expect(r2.body.data.conversationId).toBe(d1.conversationId);
    expect(r2.body.data.understood).toMatchObject({ intent: 'MY_TASKS', period: 'NEXT_WEEK', focus: 'OPEN' });
    const nw = periodRange('NEXT_WEEK', new Date());
    const expectedNextWeek = await prisma.card.count({
      where: { members: { some: { userId: u.lan1.id } }, isDone: false, dueDate: { gte: nw.from, lt: nw.to } },
    });
    expect(r2.body.data.answer.total).toBe(expectedNextWeek);

    // danh sach nhieu trang
    const r3 = await ask(u.lan1, 'Tôi còn những việc gì chưa xong?', MY, d1.conversationId);
    expect([r3.body.data.answer.total, r3.body.data.answer.cards.length, r3.body.data.answer.page]).toEqual([13, 10, 1]);
    const p2 = await more(u.lan1, d1.conversationId, 2);
    expect(p2.status).toBe(200);
    expect([p2.body.data.answer.total, p2.body.data.answer.cards.length, p2.body.data.answer.page]).toEqual([13, 3, 2]);
    const ids = new Set([...r3.body.data.answer.cards, ...p2.body.data.answer.cards].map((c: { id: string }) => c.id));
    expect(ids.size).toBe(13);
    expect((await more(u.lan1, d1.conversationId, 3)).body.data.answer.cards).toEqual([]);
    expect(p2.body.data.understood).toMatchObject({ intent: 'MY_TASKS', focus: 'OPEN', parser: 'RULE' });

    // doi pham vi: "tuần sau?" khong con ngu canh de ke thua -> chua ho tro
    const r4 = await ask(u.lan1, 'tuần sau?', { kind: 'WORKSPACE', workspaceId: wsA }, d1.conversationId);
    expect(r4.body.data.conversationId).toBe(d1.conversationId);
    expect([r4.body.data.answer.kind, r4.body.data.understood.intent]).toEqual(['UNSUPPORTED', 'UNSUPPORTED']);
    // ... va "Xem them" khong con truy van cu
    expect((await more(u.lan1, d1.conversationId, 2)).status).toBe(400);

    // ngu canh luu tham so NGUOI DUNG da noi (truoc mac dinh): "đã xong" khong kem ky -> tuan nay chi la
    // mac dinh, cau sau "còn chưa xong thì sao?" phai ra MOI viec chua xong (khong loc tuan nay)
    const r6 = await ask(u.lan1, 'Tôi đã xong những gì?');
    expect(r6.body.data.understood).toMatchObject({ intent: 'MY_TASKS', focus: 'DONE', period: 'THIS_WEEK' });
    const r7 = await ask(u.lan1, 'còn chưa xong thì sao?', MY, r6.body.data.conversationId);
    expect(r7.body.data.understood).toMatchObject({ intent: 'MY_TASKS', focus: 'OPEN', period: null });
    expect(r7.body.data.answer.total).toBe(13);

    const r5 = await ask(u.lan1, 'Tạo thẻ mới cho Lan');
    expect([r5.body.data.answer.kind, r5.body.data.answer.suggestions.length]).toEqual(['UNSUPPORTED', 5]);
    const m5 = await more(u.lan1, r5.body.data.conversationId, 2);
    expect([m5.status, m5.body.message]).toEqual([400, 'Chua co cau tra loi nao de xem them']);
  });

  it('trung ten -> "Y ban la ai?" -> chon -> tra loi; cau noi tiep giu nguoi; nguoi roi khong gian thi khong con thay', async () => {
    const { u, wsA, wsB } = await setup();
    const WS = { kind: 'WORKSPACE', workspaceId: wsA };
    const r1 = await ask(u.leader, 'Lan đang làm gì?', WS);
    const d1 = r1.body.data;
    expect(d1.answer.kind).toBe('CLARIFY');
    expect(d1.understood).toMatchObject({ intent: 'MEMBER_TASKS', memberName: null });
    expect(d1.answer.clarify.options.map((o: { id: string }) => o.id).sort()).toEqual([u.lan1.id, u.lan2.id].sort());
    const cid = d1.conversationId;

    expect((await choose(u.leader, { conversationId: cid, userId: u.minh.id })).body.message).toBe('Lua chon khong hop le');
    expect((await choose(u.leader, { conversationId: cid, userId: u.leader.id })).status).toBe(400); // tu chon minh
    expect((await choose(u.leader, { conversationId: cid, workspaceId: wsB })).status).toBe(400);
    const c1 = await choose(u.leader, { conversationId: cid, userId: u.lan2.id });
    expect(c1.status).toBe(200);
    // "đang làm" -> tinh trang OPEN (danh sach viec chua xong), khong phai ban tong quan
    expect(c1.body.data.understood).toMatchObject({ intent: 'MEMBER_TASKS', focus: 'OPEN', memberName: 'Trần Lan' });
    expect(c1.body.data.answer.text).toBe('Trần Lan có 2 việc chưa xong, trong đó 2 việc đã quá hạn.');
    const again = await choose(u.leader, { conversationId: cid, userId: u.lan2.id });
    expect([again.status, again.body.message]).toEqual([400, 'Khong co cau hoi lai nao dang cho']);

    const f1 = await ask(u.leader, 'còn quá hạn thì sao?', WS, cid);
    expect(f1.body.data.understood).toMatchObject({ intent: 'MEMBER_TASKS', focus: 'OVERDUE', memberName: 'Trần Lan' });
    expect(f1.body.data.answer.total).toBe(2);
    // "Xem them" cua cau hoi ve mot nguoi: van dung nguoi da chon
    const m1 = await more(u.leader, cid, 2);
    expect([m1.status, m1.body.data.answer.total, m1.body.data.understood.memberName]).toEqual([200, 2, 'Trần Lan']);

    // cau hoi moi thi bo cau hoi lai dang cho
    const c2 = await ask(u.leader, 'Lan đang làm gì?', WS, cid);
    expect(c2.body.data.answer.kind).toBe('CLARIFY');
    await ask(u.leader, 'Nhóm có việc nào quá hạn?', WS, cid);
    expect((await choose(u.leader, { conversationId: cid, userId: u.lan1.id })).body.message).toBe('Khong co cau hoi lai nao dang cho');
    // ... ke ca khi cau moi KHONG duoc tra loi (chua ho tro)
    await ask(u.leader, 'Lan đang làm gì?', WS, cid);
    await ask(u.leader, 'xin chào', WS, cid);
    expect((await choose(u.leader, { conversationId: cid, userId: u.lan1.id })).body.message).toBe('Khong co cau hoi lai nao dang cho');
    await ask(u.leader, 'Lan đang làm gì?', WS, cid);
    await choose(u.leader, { conversationId: cid, userId: u.lan2.id });

    // Tran Lan roi khong gian giua hai luot -> khong con doc duoc du lieu cua nguoi nay
    await prisma.workspaceMember.updateMany({ where: { workspaceId: wsA, userId: u.lan2.id }, data: { deletedAt: new Date() } });
    const gone = await more(u.leader, cid, 2); // "Xem them" cung kiem lai nguoi
    expect([gone.status, gone.body.data.answer.text]).toEqual([200, 'Không tìm thấy “người bạn hỏi” trong không gian “Nhóm A”.']);
    const f2 = await ask(u.leader, 'còn tuần trước thì sao?', WS, cid);
    expect([f2.body.data.answer.kind, f2.body.data.answer.text]).toEqual(['ANSWER', 'Không tìm thấy “người bạn hỏi” trong không gian “Nhóm A”.']);
    expect(f2.body.data.understood.memberName).toBeNull();
    for (const res of [gone, f2]) expect(JSON.stringify(res.body)).not.toContain('Lan2 qua han');
  });

  it('pham vi ca nhan: hoi ve nhom / nguoi khac -> chon khong gian; chi mot khong gian thi dung luon', async () => {
    const { u, wsA, wsB } = await setup();
    const r1 = await ask(u.minh, 'Nhóm có việc nào quá hạn?');
    const d1 = r1.body.data;
    expect(d1.answer.kind).toBe('CLARIFY');
    expect(d1.answer.clarify.options.map((o: { id: string }) => o.id)).toEqual([wsA, wsB, u.minh.personalWorkspaceId]);
    expect((await choose(u.minh, { conversationId: d1.conversationId, workspaceId: u.leader.personalWorkspaceId })).status).toBe(400);
    const c1 = await choose(u.minh, { conversationId: d1.conversationId, workspaceId: wsB });
    expect(c1.body.data.understood).toMatchObject({ intent: 'TEAM_SUMMARY', focus: 'OVERDUE' });
    expect([c1.body.data.answer.total, c1.body.data.answer.scopeLabel]).toEqual([1, 'Tính trên 1 bảng bạn xem được trong không gian “Nhóm B”.']);

    // hoi ve mot nguoi o pham vi ca nhan: nhan ra ten nho danh sach nguoi cua moi khong gian minh o
    const r2 = await ask(u.minh, 'Nguyễn Thị Lan đang làm gì?');
    expect(r2.body.data.answer.kind).toBe('CLARIFY');
    const c2 = await choose(u.minh, { conversationId: r2.body.data.conversationId, workspaceId: wsA });
    expect(c2.body.data.understood).toMatchObject({ intent: 'MEMBER_TASKS', memberName: 'Nguyễn Thị Lan' });
    // Minh khong doc duoc bang rieng "A-rieng" -> chi 12 viec tren A-chung
    expect(c2.body.data.answer.total).toBe(12);
    expect(c2.body.data.answer.notes.join(' ')).toContain('có thể chưa phải toàn bộ việc của Nguyễn Thị Lan');

    const solo = await ask(u.solo, 'Nhóm có việc nào quá hạn?');
    expect(solo.body.data.answer.kind).toBe('ANSWER');
    expect(solo.body.data.answer.scopeLabel).toBe('Tính trên 0 bảng bạn xem được trong không gian “Khong gian cua Một Mình”.');
  });

  it('truong nhom thay gioi han song song, thanh vien khong; khong lo mo ta / email', async () => {
    const { u, wsA } = await setup();
    const WS = { kind: 'WORKSPACE', workspaceId: wsA };
    const lead = await ask(u.leader, 'Ai đang có nhiều việc?', WS);
    expect(lead.body.data.understood.intent).toBe('TEAM_WORKLOAD');
    const rows = lead.body.data.answer.rows as { name: string; open: number; capacity?: number | null }[];
    // truong nhom doc duoc ca A-chung lan A-rieng -> 12 + 1 viec cua Lan1
    expect(rows.find((r) => r.name === 'Nguyễn Thị Lan')).toMatchObject({ open: 13, capacity: null });
    const mem = await ask(u.lan1, 'Ai đang có nhiều việc?', WS);
    expect(JSON.stringify(mem.body)).not.toMatch(/capacity|pausedUntil/);
    for (const res of [lead, mem]) expect(JSON.stringify(res.body)).not.toMatch(/MO-TA-KIN|@test\.local|"email"/);
  });
});

describe('quyen doc lai moi luot; phien cua nguoi khac', () => {
  it('thu hoi quyen giua hai luot; bang PUBLIC / luu tru / khong gian khac; ma hoi thoai cua nguoi khac', async () => {
    const { u, b, wsB } = await setup();
    const BP = { kind: 'BOARD', boardId: b.P.id };
    const r1 = await ask(u.lan1, 'Tôi còn những việc gì chưa xong?', BP);
    expect([r1.status, r1.body.data.answer.total]).toEqual([200, 1]);
    const cid = r1.body.data.conversationId;
    await prisma.boardMember.updateMany({ where: { boardId: b.P.id, userId: u.lan1.id }, data: { deletedAt: new Date() } });
    expect((await more(u.lan1, cid, 2)).status).toBe(403);
    expect((await ask(u.lan1, 'Tôi còn việc gì?', BP, cid)).status).toBe(403);

    expect((await ask(u.lan1, 'Việc của tôi?', { kind: 'BOARD', boardId: b.PUB.id })).body.message).toBe('Tro ly chi ho tro bang ban tham gia');
    expect((await ask(u.leader, 'Việc của tôi?', { kind: 'BOARD', boardId: b.OLD.id })).status).toBe(404);
    expect((await ask(u.lan1, 'Việc của tôi?', { kind: 'WORKSPACE', workspaceId: wsB })).status).toBe(403);

    // ma hoi thoai cua lan1 trong tay lan2: coi nhu phien moi, khong doc / tiep tuc duoc
    const r2 = await ask(u.lan1, 'Việc nào của tôi sắp đến hạn?');
    const lanCid = r2.body.data.conversationId;
    const stolen = await ask(u.lan2, 'còn tuần sau thì sao?', MY, lanCid);
    expect(stolen.body.data.conversationReset).toBe(true);
    expect(stolen.body.data.conversationId).not.toBe(lanCid);
    expect(stolen.body.data.answer.kind).toBe('UNSUPPORTED'); // khong ke thua ngu canh cua lan1
    const m = await more(u.lan2, lanCid, 2);
    expect([m.status, m.body.message]).toEqual([404, 'Hoi thoai da het han hoac khong ton tai, hay hoi lai']);
    expect((await choose(u.lan2, { conversationId: lanCid, userId: u.lan1.id })).status).toBe(404);
    expect((await more(u.lan1, '00000000-0000-4000-8000-000000000000', 2)).status).toBe(404);
    // phien cua lan1 van nguyen
    expect((await more(u.lan1, lanCid, 2)).status).toBe(200);
  });

  it('khong ghi log noi dung cau hoi (ke ca khi loi quyen)', async () => {
    const { u, b } = await setup();
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
    const marker = 'MA-CAU-HOI-7x9q';
    await ask(u.lan1, `Việc nào của tôi quá hạn ${marker}?`);
    await ask(u.lan1, `Việc của tôi ${marker}`, { kind: 'BOARD', boardId: b.PUB.id }); // 403
    await ask(u.lan1, `${marker}`.repeat(60)); // 400 qua dai
    for (const spy of spies) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(marker);
    }
  });
});

describe('phien het han / may chu khoi dong lai (dong ho gia, goi thang dich vu)', () => {
  it('29 phut van noi tiep duoc; 31 phut -> phien moi, mat ngu canh; kho moi -> conversationReset', async () => {
    const { u } = await setup();
    const store = new ChatSessionStore();
    const t0 = new Date();
    const at = (min: number) => new Date(t0.getTime() + min * 60_000);
    const first = await handleMessage(u.lan1.id, { message: 'Việc nào của tôi sắp đến hạn?', scope: MY }, { now: t0, sessions: store });
    const ok = await handleMessage(u.lan1.id, { message: 'còn tuần sau thì sao?', scope: MY, conversationId: first.conversationId }, { now: at(29), sessions: store });
    expect([ok.conversationId, ok.conversationReset, ok.understood.period]).toEqual([first.conversationId, undefined, 'NEXT_WEEK']);
    // 29 + 31 phut khong hoat dong
    const late = await handleMessage(u.lan1.id, { message: 'còn tuần trước thì sao?', scope: MY, conversationId: first.conversationId }, { now: at(60), sessions: store });
    expect(late.conversationReset).toBe(true);
    expect(late.conversationId).not.toBe(first.conversationId);
    expect(late.answer.kind).toBe('UNSUPPORTED');

    const restarted = await handleMessage(u.lan1.id, { message: 'Việc của tôi?', scope: MY, conversationId: late.conversationId }, { now: at(61), sessions: new ChatSessionStore() });
    expect(restarted.conversationReset).toBe(true);
  });

  it('bo hieu cau hoi duoc tiem vao chi nhan cau hoi + danh sach nguoi + ngu canh (khong du lieu the)', async () => {
    const { u, wsA } = await setup();
    const seen: unknown[] = [];
    const stub: Understand = async (question, roster, prev) => {
      seen.push({ question, roster: roster.map((r) => r.name).sort(), prev });
      return { parsed: { intent: 'TEAM_SUMMARY', period: 'THIS_WEEK', focus: null, member: null }, parser: 'LLM' };
    };
    const store = new ChatSessionStore();
    const r = await handleMessage(u.lan1.id, { message: 'hỏi gì đó', scope: { kind: 'WORKSPACE', workspaceId: wsA } }, { now: new Date(), sessions: store, understand: stub });
    expect(r.understood).toMatchObject({ intent: 'TEAM_SUMMARY', parser: 'LLM' });
    expect(seen).toEqual([{ question: 'hỏi gì đó', roster: ['Hoàng Minh', 'Nguyễn Thị Lan', 'Trưởng Nhóm', 'Trần Lan'].sort(), prev: null }]);
    expect(JSON.stringify(seen)).not.toMatch(/Lan1 viec|MO-TA-KIN|A-chung/);

    // Hieu la "hoi ve mot nguoi" nhung khong co ten -> hoi lai "Ban muon hoi ve ai?"
    const noName: Understand = async () => ({ parsed: { intent: 'MEMBER_TASKS', period: null, focus: null, member: null }, parser: 'LLM' });
    const who = await handleMessage(u.lan1.id, { message: 'người đó làm gì?', scope: { kind: 'WORKSPACE', workspaceId: wsA } }, { now: new Date(), sessions: store, understand: noName });
    expect([who.answer.kind, who.answer.clarify?.question, who.answer.clarify?.options]).toEqual(['CLARIFY', 'Bạn muốn hỏi về ai?', []]);
  });
});

describe('gioi han luot goi', () => {
  // DAT CUOI TEP: limiter dem theo tung nguoi trong ca tep
  it('61 luot POST trong 10 phut -> 429 (tinh ca yeu cau sai dinh dang)', async () => {
    const { u } = await setup();
    const fresh = u.solo;
    for (let i = 0; i < 30; i++) expect((await ask(fresh, 'Việc của tôi?')).status).toBe(200);
    for (let i = 0; i < 30; i++) expect((await agent().post('/api/chat/messages').set('Cookie', fresh.cookie).send({})).status).toBe(400);
    const blocked = await ask(fresh, 'Việc của tôi?');
    expect(blocked.status).toBe(429);
    // nguoi khac khong bi anh huong
    expect((await ask(u.lan1, 'Việc của tôi?')).status).toBe(200);
  }, 60_000);
});
