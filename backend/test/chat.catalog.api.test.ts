// API /api/chat cho cau hoi danh muc (CHATBOT_MODULE.md §18): luong HTTP that, nut chon bang / khong gian, phien.
// Khong co khoa LLM trong moi truong test -> bo hieu cau la bo luat (parser RULE).
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { agent, makeDirectUser, type TestUser } from './helpers';

type Vis = 'PRIVATE' | 'WORKSPACE' | 'PUBLIC';

const LISTS = ['Cần làm', 'Đang làm', 'Xong'];

async function setup() {
  const u = {
    leader: await makeDirectUser('Trưởng Nhóm'),
    lan1: await makeDirectUser('Nguyễn Thị Lan'),
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
  const wsA = await ws('Nhóm A', u.leader, [u.lan1, u.minh]);
  const wsB = await ws('Nhóm B', u.leaderB, [u.minh]);
  /** spec: [chua xong, da xong] cua ba cot. */
  const board = async (name: string, owner: TestUser, workspaceId: string, visibility: Vis, spec: [number, number][], others: TestUser[] = []) => {
    const b = await prisma.board.create({
      data: {
        name,
        ownerId: owner.id,
        workspaceId,
        visibility,
        lists: { create: LISTS.map((n, i) => ({ name: n, position: i })) },
        members: { create: [{ userId: owner.id, role: 'OWNER' as const }, ...others.map((m) => ({ userId: m.id, role: 'MEMBER' as const }))] },
      },
      include: { lists: { select: { id: true, name: true } } },
    });
    const data = LISTS.flatMap((n, i) => {
      const listId = b.lists.find((l) => l.name === n)!.id;
      const mk = (done: boolean) => ({
        listId,
        title: 'TIEU-DE-BI-MAT',
        description: 'MO-TA-KIN',
        status: done ? ('DONE' as const) : ('TODO' as const),
        isDone: done,
        completedAt: done ? new Date() : null,
      });
      return [...Array.from({ length: spec[i][0] }, () => mk(false)), ...Array.from({ length: spec[i][1] }, () => mk(true))];
    });
    await prisma.card.createMany({ data });
    return b.id;
  };
  const b = {
    chung: await board('A-chung', u.leader, wsA.id, 'WORKSPACE', [[2, 1], [1, 0], [0, 3]]),
    rieng: await board('A-rieng', u.leader, wsA.id, 'PRIVATE', [[5, 5], [5, 5], [5, 5]], [u.lan1]),
    trungA: await board('Trùng tên', u.leader, wsA.id, 'WORKSPACE', [[1, 1], [0, 0], [0, 0]]),
    trungB: await board('Trùng tên', u.leaderB, wsB.id, 'WORKSPACE', [[4, 0], [0, 0], [0, 2]]),
    congKhai: await board('B-cong-khai', u.leaderB, wsB.id, 'PUBLIC', [[9, 9], [9, 9], [9, 9]]),
  };
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

type Row = { cells: (string | number)[]; boardId?: string };
const rowsOf = (res: { body: { data: { answer: { table?: { rows: Row[] } } } } }) => (res.body.data.answer.table?.rows ?? []).map((r) => r.cells);
const factOf = (res: { body: { data: { answer: { facts: { key: string; value: number }[] } } } }, key: string) =>
  res.body.data.answer.facts.find((f) => f.key === key)?.value;

/** Dem "ngay tho" cua mot bang: chua xong / da xong. */
async function counts(boardId: string) {
  const cards = await prisma.card.findMany({ where: { list: { boardId } }, select: { isDone: true } });
  return { open: cards.filter((c) => !c.isDone).length, done: cards.filter((c) => c.isDone).length };
}

describe('bon y dinh danh muc qua HTTP (chua co LLM)', () => {
  it('bang / khong gian / thanh vien / dem the: dung so, khong co the, khong lo email va mo ta', async () => {
    const { u, b } = await setup();

    // ---- MY_BOARDS: lan1 doc A-chung (khong gian) + A-rieng (thanh vien) + 2 bang cua ca nhan khong co
    const r1 = await ask(u.lan1, 'Tôi đang ở bao nhiêu bảng?');
    expect(r1.status).toBe(200);
    const d1 = r1.body.data;
    expect(d1.understood).toEqual({ intent: 'MY_BOARDS', period: null, focus: null, memberName: null, targetName: null, columnName: null, parser: 'RULE' });
    // A-chung, A-rieng, Trung ten (A): 3 bang; truc tiep = A-rieng (BoardMember) + 0
    expect([factOf(r1, 'total'), factOf(r1, 'direct'), factOf(r1, 'viaWorkspace')]).toEqual([3, 1, 2]);
    expect(d1.answer.text).toBe('Bạn xem được 3 bảng, trong đó bạn tham gia trực tiếp 1 bảng.');
    expect(rowsOf(r1).map((c) => c[0]).sort()).toEqual(['A-chung', 'A-rieng', 'Trùng tên']);
    expect([d1.answer.cards, d1.answer.total, d1.answer.page]).toEqual([[], 0, 1]);
    expect(d1.answer.table.rows.every((r: Row) => typeof r.boardId === 'string')).toBe(true);
    expect(d1.answer.suggestions.length).toBe(2);

    // ---- MY_WORKSPACES
    const r2 = await ask(u.minh, 'Tôi thuộc những không gian nào?');
    expect(r2.body.data.understood).toMatchObject({ intent: 'MY_WORKSPACES', parser: 'RULE' });
    expect(r2.body.data.answer.text).toBe('Bạn thuộc 3 không gian làm việc.');
    expect(rowsOf(r2)).toEqual([
      ['Nhóm A', 'Thành viên', 2, 3],
      ['Nhóm B', 'Thành viên', 1, 2],
      ['Khong gian cua Hoàng Minh (cá nhân)', 'Chủ sở hữu', 0, 1],
    ]);

    // ---- CARD_COUNTS theo ten bang
    const r3 = await ask(u.lan1, 'Bảng A-chung có bao nhiêu thẻ?');
    expect(r3.body.data.understood).toMatchObject({ intent: 'CARD_COUNTS', targetName: 'A-chung', columnName: null });
    expect(rowsOf(r3)).toEqual([['Cần làm', 2, 1, 3], ['Đang làm', 1, 0, 1], ['Xong', 0, 3, 3]]);
    const naive = await counts(b.chung);
    expect([factOf(r3, 'open'), factOf(r3, 'done')]).toEqual([naive.open, naive.done]);
    expect(r3.body.data.answer.text).toBe('Bảng “A-chung” có 7 thẻ: 3 chưa xong, 4 đã hoàn thành.');

    // ---- CARD_COUNTS theo cot ("Đang làm" la ten cot, khong phai tinh trang)
    const r4 = await ask(u.lan1, 'Cột Đang làm có mấy thẻ?');
    expect(r4.body.data.understood).toMatchObject({ intent: 'CARD_COUNTS', columnName: 'Đang làm', focus: null });
    const inProgress = await prisma.card.count({
      where: { list: { name: 'Đang làm', boardId: { in: [b.chung, b.rieng, b.trungA] } }, isDone: false },
    });
    expect(factOf(r4, 'open')).toBe(inProgress);
    expect(rowsOf(r4).map((c) => c[0]).sort()).toEqual(['A-chung', 'A-rieng', 'Trùng tên']);

    // ---- MEMBER_LIST
    const r5 = await ask(u.lan1, 'Bảng A-rieng có những ai?');
    expect(r5.body.data.understood).toMatchObject({ intent: 'MEMBER_LIST', targetName: 'A-rieng' });
    expect(rowsOf(r5)).toEqual([['Trưởng Nhóm', 'Chủ bảng'], ['Nguyễn Thị Lan', 'Thành viên']]);
    const r6 = await ask(u.lan1, 'Không gian Nhóm A có bao nhiêu người?', MY);
    expect(r6.body.data.answer.text).toBe('Không gian “Nhóm A” có 3 thành viên.');

    // Khong gian nao cung khong lo email / id nguoi dung / mo ta / tieu de the
    for (const res of [r1, r2, r3, r4, r5, r6]) {
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(/@test\.local|"email"|MO-TA-KIN|TIEU-DE-BI-MAT|password/);
      for (const person of Object.values(u)) expect(text).not.toContain(person.id);
    }
  });

  it('pham vi BANG / KHONG GIAN: cau khong ten dung bang / khong gian dang xem', async () => {
    const { u, b, wsA } = await setup();
    const bd = await ask(u.lan1, 'Bảng này có bao nhiêu thẻ?', { kind: 'BOARD', boardId: b.chung });
    expect(rowsOf(bd)).toEqual([['Cần làm', 2, 1, 3], ['Đang làm', 1, 0, 1], ['Xong', 0, 3, 3]]);
    const who = await ask(u.lan1, 'Bảng này có bao nhiêu thành viên?', { kind: 'BOARD', boardId: b.rieng });
    expect(rowsOf(who)).toEqual([['Trưởng Nhóm', 'Chủ bảng'], ['Nguyễn Thị Lan', 'Thành viên']]);
    const ws = await ask(u.lan1, 'Không gian này có bao nhiêu thành viên?', { kind: 'WORKSPACE', workspaceId: wsA });
    expect(ws.body.data.answer.text).toBe('Không gian “Nhóm A” có 3 thành viên.');
    const boards = await ask(u.lan1, 'Tôi có những bảng nào?', { kind: 'WORKSPACE', workspaceId: wsA });
    expect(boards.body.data.answer.text).toBe('Không gian “Nhóm A” có 3 bảng bạn xem được, trong đó bạn tham gia trực tiếp 1 bảng.');
  });

  it('bang khong doc duoc / khong ton tai -> "khong tim thay", khong noi bang co ton tai hay khong; khong tra so', async () => {
    const { u } = await setup();
    // A-rieng ton tai nhung minh khong doc duoc; B-cong-khai la bang PUBLIC minh khong tham gia; bang "bí mật" khong ton tai
    // (bo luat tach "A-rieng" thanh hai tu "A rieng" khi doan ten)
    for (const [name, typed] of [['A-rieng', 'A rieng'], ['B-cong-khai', 'B cong khai'], ['bí mật', 'bí mật']] as const) {
      const res = await ask(u.minh, `Bảng ${name} có bao nhiêu thẻ?`);
      expect(res.status, name).toBe(200);
      expect(res.body.data.answer.text, name).toContain('Không tìm thấy bảng hoặc không gian');
      expect(res.body.data.answer.text, name).toContain(typed);
      expect(res.body.data.answer.table, name).toBeUndefined();
      expect(res.body.data.answer.facts, name).toEqual([]);
    }
    const col = await ask(u.minh, 'Cột Kiểm thử có mấy thẻ?');
    expect(col.body.data.answer.text).toContain('Không tìm thấy cột');
  });
});

describe('sau cau tra loi danh muc: khong noi tiep, khong "Xem them"', () => {
  it('ngu canh va truy van cuoi bi xoa; hoi cau viec binh thuong sau do van chay', async () => {
    const { u } = await setup();
    const a = await ask(u.lan1, 'Tôi đang ở bao nhiêu bảng?');
    const cid = a.body.data.conversationId;
    const follow = await ask(u.lan1, 'còn tuần sau thì sao?', MY, cid);
    expect([follow.body.data.answer.kind, follow.body.data.understood.intent]).toEqual(['UNSUPPORTED', 'UNSUPPORTED']);
    const m = await more(u.lan1, cid, 2);
    expect([m.status, m.body.message]).toEqual([400, 'Chua co cau tra loi nao de xem them']);

    // cau viec truoc, roi cau danh muc, roi "Xem them": khong con truy van viec cu
    await prisma.card.createMany({
      data: await (async () => {
        const list = await prisma.list.findFirstOrThrow({ where: { name: 'Cần làm', board: { name: 'A-chung' } }, select: { id: true } });
        return Array.from({ length: 12 }, (_, i) => ({ listId: list.id, title: `Viec ${i}`, dueDate: new Date(Date.now() + (i + 1) * 3_600_000) }));
      })(),
    });
    const work = await ask(u.lan1, 'Việc nào của tôi sắp đến hạn?', MY, cid);
    expect(work.body.data.understood.intent).toBe('MY_TASKS');
    await prisma.cardMember.createMany({ data: (await prisma.card.findMany({ where: { title: { startsWith: 'Viec ' } }, select: { id: true } })).map((c) => ({ cardId: c.id, userId: u.lan1.id })) });
    const work2 = await ask(u.lan1, 'Việc nào của tôi sắp đến hạn?', MY, cid);
    expect(work2.body.data.answer.total).toBe(12);
    expect((await more(u.lan1, cid, 2)).status).toBe(200);
    await ask(u.lan1, 'Bảng A-chung có bao nhiêu thẻ?', MY, cid);
    expect((await more(u.lan1, cid, 2)).status).toBe(400);
    // ... va sau cau danh muc, cau viec moi lai chay binh thuong
    const again = await ask(u.lan1, 'Việc nào của tôi sắp đến hạn?', MY, cid);
    expect(again.body.data.answer.total).toBe(12);
    // cau viec (co ngu canh) roi cau danh muc: cau noi tiep sau do KHONG ke thua ngu canh cua cau viec truoc do
    await ask(u.lan1, 'Tôi đang ở bao nhiêu bảng?', MY, cid);
    const chained = await ask(u.lan1, 'còn tuần sau thì sao?', MY, cid);
    expect([chained.body.data.answer.kind, chained.body.data.understood.intent]).toEqual(['UNSUPPORTED', 'UNSUPPORTED']);
  });
});

describe('trung ten -> nut chon bang / khong gian -> /choice (targetId)', () => {
  it('nut chon; chon sai (nguoi, khong gian, bang ngoai danh sach) -> 400; chon dung -> tra loi; chon lai -> 400', async () => {
    const { u, b, wsA, wsB } = await setup();
    const r1 = await ask(u.minh, 'Bảng Trùng tên có bao nhiêu thẻ?');
    const d1 = r1.body.data;
    expect(d1.answer.kind).toBe('CLARIFY');
    expect(d1.understood).toMatchObject({ intent: 'CARD_COUNTS', targetName: null });
    expect(d1.answer.clarify.options.map((o: { id: string; kind: string }) => [o.id, o.kind]).sort()).toEqual(
      [[b.trungA, 'TARGET'], [b.trungB, 'TARGET']].sort()
    );
    expect(d1.answer.clarify.options.map((o: { label: string }) => o.label).sort()).toEqual(['Bảng Trùng tên (Nhóm A)', 'Bảng Trùng tên (Nhóm B)']);
    expect(d1.answer.table).toBeUndefined();
    const cid = d1.conversationId;

    // sai kieu: nguoi / khong gian / bang khong nam trong danh sach nut / bang PUBLIC khong doc duoc / thieu id
    for (const body of [{ userId: u.leader.id }, { workspaceId: wsA }, { targetId: b.chung }, { targetId: b.rieng }, { targetId: b.congKhai }, { targetId: wsB }]) {
      const res = await choose(u.minh, { conversationId: cid, ...body });
      expect([res.status, res.body.message], JSON.stringify(body)).toEqual([400, 'Lua chon khong hop le']);
    }
    // schema: dung MOT trong ba
    for (const body of [{}, { targetId: b.trungA, userId: u.leader.id }, { targetId: b.trungA, workspaceId: wsA }, { targetId: '' }]) {
      expect((await choose(u.minh, { conversationId: cid, ...body })).status, JSON.stringify(body)).toBe(400);
    }

    const ok = await choose(u.minh, { conversationId: cid, targetId: b.trungB });
    expect(ok.status).toBe(200);
    expect(ok.body.data.conversationId).toBe(cid);
    expect(ok.body.data.understood).toMatchObject({ intent: 'CARD_COUNTS', targetName: 'Trùng tên', parser: 'RULE' });
    const naive = await counts(b.trungB);
    expect([factOf(ok, 'open'), factOf(ok, 'done')]).toEqual([naive.open, naive.done]);
    expect(rowsOf(ok)).toEqual([['Cần làm', 4, 0, 4], ['Đang làm', 0, 0, 0], ['Xong', 0, 2, 2]]);
    const again = await choose(u.minh, { conversationId: cid, targetId: b.trungB });
    expect([again.status, again.body.message]).toEqual([400, 'Khong co cau hoi lai nao dang cho']);

    // cau moi bo cau hoi lai dang cho
    await ask(u.minh, 'Bảng Trùng tên có bao nhiêu thẻ?', MY, cid);
    await ask(u.minh, 'Tôi đang ở bao nhiêu bảng?', MY, cid);
    expect((await choose(u.minh, { conversationId: cid, targetId: b.trungA })).body.message).toBe('Khong co cau hoi lai nao dang cho');
  });

  it('thu hoi quyen giua hai luot: chon bang cua khong gian vua bi loai -> "khong tim thay", khong lo so', async () => {
    const { u, b, wsB } = await setup();
    const r1 = await ask(u.minh, 'Bảng Trùng tên có những ai?');
    expect(r1.body.data.answer.kind).toBe('CLARIFY');
    await prisma.workspaceMember.updateMany({ where: { workspaceId: wsB, userId: u.minh.id }, data: { deletedAt: new Date() } });
    const res = await choose(u.minh, { conversationId: r1.body.data.conversationId, targetId: b.trungB });
    expect(res.status).toBe(200);
    expect(res.body.data.answer.text).toContain('Không tìm thấy');
    expect(res.body.data.answer.table).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('Trưởng Nhóm B');
  });

  it('ten khong gian trung ten bang: nut chon gom ca hai loai; chon khong gian -> dem the theo bang cua khong gian', async () => {
    const { u, b, wsB } = await setup();
    await prisma.board.update({ where: { id: b.trungA }, data: { name: 'Nhóm B' } });
    const r2 = await ask(u.minh, 'Không gian Nhóm B có bao nhiêu thẻ?');
    expect(r2.body.data.answer.kind).toBe('CLARIFY');
    expect(r2.body.data.answer.clarify.options.map((o: { label: string }) => o.label).sort()).toEqual(['Bảng Nhóm B (Nhóm A)', 'Không gian Nhóm B']);
    const pick = await choose(u.minh, { conversationId: r2.body.data.conversationId, targetId: wsB });
    expect(pick.body.data.understood.targetName).toBe('Nhóm B');
    // minh doc duoc o Nhom B: chi "Trùng tên" (B-cong-khai la bang PUBLIC minh khong tham gia)
    expect(rowsOf(pick).map((c) => c[0])).toEqual(['Trùng tên']);
  });
});

describe('thanh vien o pham vi ca nhan (khong noi ten) -> chon khong gian', () => {
  it('nhieu khong gian: nut chon roi tra loi; chon khong gian khong thuoc minh -> 400; chi mot khong gian thi dung luon', async () => {
    const { u, wsA, wsB } = await setup();
    const r1 = await ask(u.minh, 'Bảng này có bao nhiêu thành viên?');
    const d1 = r1.body.data;
    expect(d1.answer.kind).toBe('CLARIFY');
    expect(d1.understood).toMatchObject({ intent: 'MEMBER_LIST' });
    expect(d1.answer.clarify.options.map((o: { id: string; kind: string }) => [o.id, o.kind])).toEqual([
      [wsA, 'WORKSPACE'],
      [wsB, 'WORKSPACE'],
      [u.minh.personalWorkspaceId, 'WORKSPACE'],
    ]);
    const cid = d1.conversationId;
    expect((await choose(u.minh, { conversationId: cid, workspaceId: u.leader.personalWorkspaceId })).status).toBe(400);
    expect((await choose(u.minh, { conversationId: cid, targetId: wsA })).status).toBe(400); // kieu chon khong khop cau hoi lai
    const c1 = await choose(u.minh, { conversationId: cid, workspaceId: wsB });
    expect(c1.status).toBe(200);
    expect(c1.body.data.understood).toMatchObject({ intent: 'MEMBER_LIST', targetName: 'Nhóm B' });
    expect(rowsOf(c1)).toEqual([['Trưởng Nhóm B', 'Chủ sở hữu'], ['Hoàng Minh', 'Thành viên']]);

    const solo = await ask(u.solo, 'Bảng này có bao nhiêu thành viên?');
    expect(solo.body.data.answer.kind).toBe('ANSWER');
    expect(solo.body.data.understood.targetName).toBe('Khong gian cua Một Mình');
    expect(rowsOf(solo)).toEqual([['Một Mình', 'Chủ sở hữu']]);
  });
});
