// Danh muc truy van tren CSDL that (CHATBOT_MODULE.md §18): 4 truy van + nhan dien ten, doi chieu voi phep dem "ngay tho"
// bang JS tren du lieu tho (khong dung lai where cua san pham).
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import type { ChatAnswer } from '../src/modules/chat/chat.answer';
import {
  MAX_TABLE_ROWS,
  answerCatalog,
  loadCatalog,
  runCatalog,
  type CatalogOutcome,
  type CatalogResult,
} from '../src/modules/chat/chat.catalog';
import type { CatalogIntent } from '../src/modules/chat/chat.intent';
import { resolveScope, type ChatScopeInput } from '../src/modules/chat/chat.scope';
import { scopeInfoOf } from '../src/modules/chat/chat.service';
import { makeDirectUser, type TestUser } from './helpers';

const NOW = new Date('2026-09-30T10:00:00Z');
const SECRET_TITLE = 'TIEU-DE-BI-MAT-CUA-THE';
const SECRET_DESC = 'MO-TA-BI-MAT-CUA-THE';

type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
type Vis = 'PRIVATE' | 'WORKSPACE' | 'PUBLIC';
/** [chua xong, da xong] cua ba cot Can lam / Dang lam / Xong. */
type Spec = [[number, number], [number, number], [number, number]];

const LIST_NAMES = ['Cần làm', 'Đang làm', 'Xong'] as const;

/**
 * Hai khong gian, nhieu bang, moi bang co 3 cot that + 1 cot luu tru + 1 cot da xoa (the trong do KHONG duoc dem):
 * - Nhom A: leader (OWNER), admin (ADMIN), member, viewer (MEMBER), leaver da roi, gone bi xoa tai khoan.
 * - Nhom B: leaderB (OWNER), admin (MEMBER).
 * - guest chi la thanh vien bang "A-khach"; outsider khong lien quan.
 * - Hai bang cung ten "Trung ten" (moi khong gian mot bang) va mot bang ten "Nhóm B" nam trong Nhom A (trung ten khong gian).
 */
async function setup() {
  const u = {
    leader: await makeDirectUser('Trưởng Nhóm'),
    admin: await makeDirectUser('Quản Trị'),
    member: await makeDirectUser('Thành Viên'),
    viewer: await makeDirectUser('Người Xem'),
    guest: await makeDirectUser('Khách Mời'),
    leaver: await makeDirectUser('Người Đã Rời'),
    gone: await makeDirectUser('Tài Khoản Xoá'),
    outsider: await makeDirectUser('Người Ngoài'),
    leaderB: await makeDirectUser('Trưởng Nhóm B'),
  };
  const wsA = await prisma.workspace.create({
    data: {
      ownerId: u.leader.id,
      name: 'Nhóm A',
      members: {
        create: [
          { userId: u.leader.id, role: 'OWNER' },
          { userId: u.admin.id, role: 'ADMIN' },
          { userId: u.member.id, role: 'MEMBER' },
          { userId: u.viewer.id, role: 'MEMBER' },
          { userId: u.leaver.id, role: 'MEMBER', deletedAt: new Date() },
          { userId: u.gone.id, role: 'MEMBER' },
        ],
      },
    },
    select: { id: true },
  });
  await prisma.user.update({ where: { id: u.gone.id }, data: { deletedAt: new Date() } });
  const wsB = await prisma.workspace.create({
    data: {
      ownerId: u.leaderB.id,
      name: 'Nhóm B',
      members: { create: [{ userId: u.leaderB.id, role: 'OWNER' }, { userId: u.admin.id, role: 'MEMBER' }] },
    },
    select: { id: true },
  });

  const board = async (
    name: string,
    owner: TestUser,
    workspaceId: string,
    visibility: Vis,
    spec: Spec,
    others: [TestUser, Role][] = [],
    state: { archived?: boolean; deleted?: boolean } = {}
  ) => {
    const b = await prisma.board.create({
      data: {
        name,
        ownerId: owner.id,
        workspaceId,
        visibility,
        archivedAt: state.archived ? new Date() : null,
        deletedAt: state.deleted ? new Date() : null,
        lists: {
          create: [
            ...LIST_NAMES.map((n, i) => ({ name: n, position: i })),
            { name: 'Cột lưu trữ', position: 3, archivedAt: new Date() },
            { name: 'Cột đã xoá', position: 4, deletedAt: new Date() },
          ],
        },
        members: {
          create: [{ userId: owner.id, role: 'OWNER' as const }, ...others.map(([user, role]) => ({ userId: user.id, role }))],
        },
      },
      include: { lists: { select: { id: true, name: true } } },
    });
    const listId = (n: string) => b.lists.find((l) => l.name === n)!.id;
    const mk = (listId: string, o: { done?: boolean; archived?: boolean; deleted?: boolean }) => ({
      listId,
      title: SECRET_TITLE,
      description: SECRET_DESC,
      status: o.done ? ('DONE' as const) : ('TODO' as const),
      isDone: !!o.done,
      completedAt: o.done ? new Date() : null,
      archivedAt: o.archived ? new Date() : null,
      deletedAt: o.deleted ? new Date() : null,
    });
    const data: ReturnType<typeof mk>[] = [];
    LIST_NAMES.forEach((n, i) => {
      for (let k = 0; k < spec[i][0]; k++) data.push(mk(listId(n), {}));
      for (let k = 0; k < spec[i][1]; k++) data.push(mk(listId(n), { done: true }));
    });
    // The khong duoc dem: da luu tru / da xoa (trong cot that) va moi the cua cot luu tru / cot da xoa
    data.push(mk(listId('Cần làm'), { archived: true }), mk(listId('Đang làm'), { deleted: true }), mk(listId('Xong'), { archived: true, done: true }));
    for (let k = 0; k < 4; k++) data.push(mk(listId('Cột lưu trữ'), {}), mk(listId('Cột đã xoá'), { done: true }));
    await prisma.card.createMany({ data });
    return { id: b.id };
  };

  const b = {
    chung: await board('A-chung', u.leader, wsA.id, 'WORKSPACE', [[3, 0], [2, 1], [0, 4]]),
    rieng: await board('A-rieng', u.leader, wsA.id, 'PRIVATE', [[1, 0], [4, 0], [0, 2]], [[u.member, 'ADMIN']]),
    xem: await board('A-xem', u.member, wsA.id, 'PRIVATE', [[1, 1], [1, 1], [1, 1]], [[u.viewer, 'VIEWER']]),
    khach: await board('A-khach', u.leader, wsA.id, 'PRIVATE', [[7, 0], [0, 0], [0, 1]], [[u.guest, 'MEMBER']]),
    luuTru: await board('A-luu-tru', u.leader, wsA.id, 'WORKSPACE', [[3, 3], [3, 3], [3, 3]], [], { archived: true }),
    daXoa: await board('A-da-xoa', u.leader, wsA.id, 'WORKSPACE', [[3, 3], [3, 3], [3, 3]], [], { deleted: true }),
    congKhaiB: await board('B-cong-khai', u.leaderB, wsB.id, 'PUBLIC', [[9, 9], [9, 9], [9, 9]]),
    chungB: await board('B-chung', u.leaderB, wsB.id, 'WORKSPACE', [[2, 0], [0, 3], [1, 1]]),
    trungA: await board('Trùng tên', u.leader, wsA.id, 'WORKSPACE', [[1, 1], [0, 0], [0, 0]]),
    trungB: await board('Trùng tên', u.leaderB, wsB.id, 'WORKSPACE', [[5, 0], [0, 0], [0, 0]]),
    trungWs: await board('Nhóm B', u.leader, wsA.id, 'WORKSPACE', [[1, 0], [0, 0], [0, 0]]),
    trong: await board('A-trong', u.leader, wsA.id, 'WORKSPACE', [[0, 0], [0, 0], [0, 0]]),
  };
  // Nguoi xem da ROI khoi bang A-chung (BoardMember deletedAt) nhung van doc duoc nho hien thi WORKSPACE: khong tinh vao "tham gia
  // truc tiep", khong co vai tro tren bang (role VIEWER cua dong da xoa de phan biet duoc)
  await prisma.boardMember.create({ data: { boardId: b.chung.id, userId: u.viewer.id, role: 'VIEWER', deletedAt: new Date() } });
  // Bang chi co MOT cot "Xong": loc cot "Đang làm" phai loai bang nay
  const itCot = await prisma.board.create({
    data: {
      name: 'A-it-cot',
      ownerId: u.leader.id,
      workspaceId: wsA.id,
      visibility: 'WORKSPACE',
      members: { create: { userId: u.leader.id, role: 'OWNER' } },
      lists: { create: { name: 'Xong', position: 0, cards: { create: [{ title: SECRET_TITLE, status: 'DONE', isDone: true, completedAt: new Date() }] } } },
    },
    select: { id: true },
  });
  // Khong gian co CHU BI XOA TAI KHOAN va khong co dong thanh vien cua chu; mot bang WORKSPACE cung do nguoi bi xoa lam chu
  const wsC = await prisma.workspace.create({
    data: { ownerId: u.gone.id, name: 'Nhóm C', members: { create: [{ userId: u.member.id, role: 'MEMBER' }] } },
    select: { id: true },
  });
  const cua = await board('C-cua-nguoi-da-xoa', u.gone, wsC.id, 'WORKSPACE', [[1, 0], [0, 0], [0, 0]]);
  return { u, b: { ...b, itCot: { id: itCot.id }, cuaNguoiXoa: cua }, wsA: wsA.id, wsB: wsB.id, wsC: wsC.id };
}
type World = Awaited<ReturnType<typeof setup>>;

// ===================== Phep dem ngay tho (doc bang du lieu tho, khong dung where cua san pham) =====================

async function raw(userId: string) {
  const [wsMemberships, boards, users, workspaces] = await Promise.all([
    prisma.workspaceMember.findMany({ where: { userId } }),
    prisma.board.findMany({ include: { members: true, workspace: true, lists: { include: { cards: true } } } }),
    prisma.user.findMany({ select: { id: true, name: true, deletedAt: true } }),
    prisma.workspace.findMany({ include: { members: true } }),
  ]);
  const myWs = new Set(wsMemberships.filter((m) => m.deletedAt === null).map((m) => m.workspaceId));
  const readable = boards.filter(
    (b) =>
      b.deletedAt === null &&
      b.archivedAt === null &&
      (b.ownerId === userId ||
        b.members.some((m) => m.userId === userId && m.deletedAt === null) ||
        (b.visibility === 'WORKSPACE' && myWs.has(b.workspaceId)))
  );
  const alive = new Set(users.filter((x) => x.deletedAt === null).map((x) => x.id));
  const peopleOf = (workspaceId: string): number => {
    const w = workspaces.find((x) => x.id === workspaceId)!;
    const ids = new Set<string>();
    if (alive.has(w.ownerId)) ids.add(w.ownerId);
    for (const m of w.members) if (m.deletedAt === null && alive.has(m.userId)) ids.add(m.userId);
    return ids.size;
  };
  const liveLists = (b: (typeof boards)[number]) => b.lists.filter((l) => l.deletedAt === null && l.archivedAt === null);
  const liveCards = (l: (typeof boards)[number]['lists'][number]) => l.cards.filter((c) => c.deletedAt === null && c.archivedAt === null);
  const counts = (b: (typeof boards)[number], listName?: string) => {
    let open = 0;
    let done = 0;
    for (const l of liveLists(b)) {
      if (listName !== undefined && l.name !== listName) continue;
      for (const c of liveCards(l)) c.isDone ? done++ : open++;
    }
    return { open, done };
  };
  const myRole = (b: (typeof boards)[number]): string | null =>
    b.ownerId === userId ? 'OWNER' : (b.members.find((m) => m.userId === userId && m.deletedAt === null)?.role ?? null);
  return { myWs, wsMemberships, readable, alive, peopleOf, liveLists, counts, myRole, workspaces };
}

const ROLE_BOARD: Record<string, string> = { OWNER: 'Chủ bảng', ADMIN: 'Quản trị viên', MEMBER: 'Thành viên', VIEWER: 'Người xem' };
const ROLE_WS: Record<string, string> = { OWNER: 'Chủ sở hữu', ADMIN: 'Quản trị viên', MEMBER: 'Thành viên' };

async function ask(
  user: TestUser,
  input: ChatScopeInput,
  q: { intent: CatalogIntent; target?: string | null; column?: string | null; targetId?: string | null }
): Promise<CatalogOutcome> {
  const scope = await resolveScope(user.id, input);
  return answerCatalog(scope, scopeInfoOf(scope), { intent: q.intent, target: q.target ?? null, column: q.column ?? null, targetId: q.targetId ?? null }, NOW);
}

const MY: ChatScopeInput = { kind: 'MY' };
const cells = (a: ChatAnswer) => (a.table?.rows ?? []).map((r) => r.cells);
const fact = (a: ChatAnswer, key: string) => a.facts.find((f) => f.key === key)?.value;

function everyone(w: World): [string, TestUser][] {
  return Object.entries(w.u).filter(([k]) => k !== 'gone') as [string, TestUser][];
}

describe('loadCatalog - danh muc ten chi gom nhung gi doc duoc', () => {
  it('moi nguoi: bang / khong gian / cot dung bang phep dem tho; khong lo bang PUBLIC, luu tru, xoa, cot luu tru', async () => {
    const w = await setup();
    let nonEmpty = 0;
    for (const [who, user] of everyone(w)) {
      const r = await raw(user.id);
      const scope = await resolveScope(user.id, MY);
      const cat = await loadCatalog(scope);
      expect(cat.boards.map((b) => b.id).sort(), `${who}: bang`).toEqual(r.readable.map((b) => b.id).sort());
      expect(cat.workspaces.map((x) => x.id).sort(), `${who}: khong gian`).toEqual([...r.myWs].sort());
      const wantColumns = r.readable.flatMap((b) => r.liveLists(b).map((l) => l.id)).sort();
      expect(cat.columns.map((c) => c.id).sort(), `${who}: cot`).toEqual(wantColumns);
      // moi cot thuoc dung bang, moi bang mang dung ten khong gian
      for (const c of cat.columns) expect(r.readable.find((b) => b.id === c.boardId)).toBeDefined();
      for (const b of cat.boards) expect(b.workspaceName).toBe(r.readable.find((x) => x.id === b.id)!.workspace.name);
      if (cat.boards.length > 0) nonEmpty++;
    }
    expect(nonEmpty).toBeGreaterThanOrEqual(5);

    // chong xanh gia: nhung bang KHONG duoc thay thi that su ton tai trong CSDL
    const admin = await loadCatalog(await resolveScope(w.u.admin.id, MY));
    const names = admin.boards.map((b) => b.name);
    for (const hidden of ['B-cong-khai', 'A-luu-tru', 'A-da-xoa', 'A-rieng', 'A-xem', 'A-khach']) {
      expect(names, hidden).not.toContain(hidden);
      expect(await prisma.board.count({ where: { name: hidden } }), `${hidden} co that`).toBe(1);
    }
    expect(names).toContain('A-chung'); // xem nho hien thi WORKSPACE, khong la BoardMember
    expect(await prisma.boardMember.count({ where: { boardId: w.b.chung.id, userId: w.u.admin.id } })).toBe(0);
    expect(admin.columns.map((c) => c.name)).not.toContain('Cột lưu trữ');
    expect(admin.columns.map((c) => c.name)).not.toContain('Cột đã xoá');
  });

  it('pham vi KHONG GIAN / BANG: danh muc chi con khong gian / bang cua pham vi; nguoi roi khong gian mat quyen', async () => {
    const w = await setup();
    const ws = await loadCatalog(await resolveScope(w.u.admin.id, { kind: 'WORKSPACE', workspaceId: w.wsB }));
    expect(ws.workspaces.map((x) => x.id)).toEqual([w.wsB]);
    expect(ws.boards.map((b) => b.name).sort()).toEqual(['B-chung', 'Trùng tên']);
    const one = await loadCatalog(await resolveScope(w.u.member.id, { kind: 'BOARD', boardId: w.b.xem.id }));
    expect(one.boards.map((b) => b.id)).toEqual([w.b.xem.id]);
    expect(one.workspaces.map((x) => x.id)).toEqual([w.wsA]);
    expect(one.columns.map((c) => c.name)).toEqual([...LIST_NAMES]);

    // nguoi da roi khong gian A: khong thay bang WORKSPACE cua A
    const leaver = await loadCatalog(await resolveScope(w.u.leaver.id, MY));
    expect(leaver.boards.map((b) => b.name)).toEqual([]);
    expect(leaver.workspaces.map((x) => x.id)).toEqual([w.u.leaver.personalWorkspaceId]);
  });
});

describe('MY_BOARDS', () => {
  it('moi nguoi: tong, "tham gia truc tiep", vai tro tung bang dung bang phep dem tho', async () => {
    const w = await setup();
    for (const [who, user] of everyone(w)) {
      const r = await raw(user.id);
      const out = await ask(user, MY, { intent: 'MY_BOARDS' });
      const a = out.answer;
      const direct = r.readable.filter((b) => r.myRole(b) !== null).length;
      expect(fact(a, 'total'), `${who}: tong`).toBe(r.readable.length);
      expect(fact(a, 'direct'), `${who}: truc tiep`).toBe(direct);
      expect(fact(a, 'viaWorkspace'), `${who}: nho khong gian`).toBe(r.readable.length - direct);
      expect(a.table!.total).toBe(r.readable.length);
      const want = r.readable
        .map((b) => [b.name, b.workspace.name, ROLE_BOARD[r.myRole(b) ?? ''] ?? 'Xem nhờ không gian', b.id])
        .sort((x, y) => (x[3] < y[3] ? -1 : 1));
      const got = a.table!.rows.map((row) => [...row.cells, row.boardId]).sort((x, y) => ((x[3] as string) < (y[3] as string) ? -1 : 1));
      expect(got, who).toEqual(want);
      expect(a.text, who).toContain(r.readable.length === 0 ? 'chưa xem được bảng nào' : String(r.readable.length));
      expect(out.targetName).toBeNull();
    }
    // chong xanh gia: co nguoi xem nhieu bang hon so bang minh tham gia
    const admin = await ask(w.u.admin, MY, { intent: 'MY_BOARDS' });
    expect(fact(admin.answer, 'viaWorkspace')).toBeGreaterThan(0);
    expect(fact(admin.answer, 'total')).toBeGreaterThan(fact(admin.answer, 'direct') as number);
  });

  it('loc theo khong gian (pham vi MY); khong gian khong co bang nao; bo qua ten o pham vi hep', async () => {
    const w = await setup();
    const r = await raw(w.u.admin.id);
    const inA = r.readable.filter((b) => b.workspaceId === w.wsA);
    const inB = r.readable.filter((b) => b.workspaceId === w.wsB);
    expect(inA.length).toBeGreaterThan(0);
    expect(inB.length).toBeGreaterThan(0);

    const a = await ask(w.u.admin, MY, { intent: 'MY_BOARDS', target: 'Nhóm A' });
    expect(a.targetName).toBe('Nhóm A');
    expect(fact(a.answer, 'total')).toBe(inA.length);
    expect(cells(a.answer).map((c) => c[0]).sort()).toEqual(inA.map((b) => b.name).sort());
    expect(new Set(cells(a.answer).map((c) => c[1]))).toEqual(new Set(['Nhóm A']));

    // khong gian ca nhan khong co bang
    const personal = await ask(w.u.admin, MY, { intent: 'MY_BOARDS', targetId: w.u.admin.personalWorkspaceId });
    expect(fact(personal.answer, 'total')).toBe(0);
    expect(personal.answer.text).toContain('Không có bảng nào');

    // pham vi KHONG GIAN: da hep san, ten bi bo qua kem ghi chu; pham vi BANG: chi bang do
    const ws = await ask(w.u.admin, { kind: 'WORKSPACE', workspaceId: w.wsB }, { intent: 'MY_BOARDS', target: 'Nhóm A' });
    expect(fact(ws.answer, 'total')).toBe(inB.length);
    expect(ws.answer.notes.join(' ')).toContain('bỏ qua tên');
    const bd = await ask(w.u.member, { kind: 'BOARD', boardId: w.b.xem.id }, { intent: 'MY_BOARDS' });
    expect(cells(bd.answer)).toEqual([['A-xem', 'Nhóm A', ROLE_BOARD.OWNER]]);
    expect(bd.answer.text).toContain('A-xem');
  });

  it(`tra toi da ${MAX_TABLE_ROWS} dong nhung tong dem het`, async () => {
    const u = await makeDirectUser('Nhieu Bang');
    const total = MAX_TABLE_ROWS + 5;
    await prisma.board.createMany({
      data: Array.from({ length: total }, (_, i) => ({ name: `Bảng số ${String(i).padStart(3, '0')}`, ownerId: u.id, workspaceId: u.personalWorkspaceId })),
    });
    const out = await ask(u, MY, { intent: 'MY_BOARDS' });
    expect(fact(out.answer, 'total')).toBe(total);
    expect(out.answer.table!.rows).toHaveLength(MAX_TABLE_ROWS);
    expect(out.answer.table!.total).toBe(total);
    expect(out.answer.notes.join(' ')).toContain(`Chỉ hiện ${MAX_TABLE_ROWS} bảng đầu tiên trong tổng ${total}`);
    // dem the theo bang: cung tran 100 dong, tong so dong that van la ${total}
    const counts = await ask(u, MY, { intent: 'CARD_COUNTS' });
    expect(counts.answer.table!.rows).toHaveLength(MAX_TABLE_ROWS);
    expect(counts.answer.table!.total).toBe(total);
    expect(counts.answer.notes.join(' ')).toContain(`Chỉ hiện ${MAX_TABLE_ROWS} bảng đầu tiên trong tổng ${total}`);
    // tat dinh: hai lan hoi cho cung bang, khong co "Xem them" (cards rong, total 0 -> khong phan trang)
    const again = await ask(u, MY, { intent: 'MY_BOARDS' });
    expect(cells(again.answer)).toEqual(cells(out.answer));
    expect(out.answer.cards).toEqual([]);
  });
});

describe('MY_WORKSPACES', () => {
  it('moi nguoi: khong gian, vai tro, so bang xem duoc, so nguoi dung bang phep dem tho', async () => {
    const w = await setup();
    for (const [who, user] of everyone(w)) {
      const r = await raw(user.id);
      const a = (await ask(user, MY, { intent: 'MY_WORKSPACES' })).answer;
      const mine = r.wsMemberships.filter((m) => m.deletedAt === null);
      const want = mine
        .map((m) => {
          const ws = r.workspaces.find((x) => x.id === m.workspaceId)!;
          return [ws.isPersonal ? `${ws.name} (cá nhân)` : ws.name, ROLE_WS[m.role], r.readable.filter((b) => b.workspaceId === ws.id).length, r.peopleOf(ws.id)];
        })
        .sort((x, y) => String(x[0]).localeCompare(String(y[0])));
      const got = cells(a).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
      expect(got, who).toEqual(want);
      expect(fact(a, 'workspaces'), who).toBe(mine.length);
      expect(a.text, who).toContain(String(mine.length));
    }
    // nguoi da roi: khong con thay Nhom A; khach chi co khong gian ca nhan du van doc duoc mot bang cua Nhom A
    const guest = cells((await ask(w.u.guest, MY, { intent: 'MY_WORKSPACES' })).answer);
    expect(guest.map((c) => c[0])).toEqual(['Khong gian cua Khách Mời (cá nhân)']);
    expect((await raw(w.u.guest.id)).readable.map((b) => b.name)).toEqual(['A-khach']);
    const leaver = cells((await ask(w.u.leaver, MY, { intent: 'MY_WORKSPACES' })).answer);
    expect(leaver.map((c) => c[0]).join('|')).not.toContain('Nhóm A');
    // Nhom A dem 4 nguoi (leader, admin, member, viewer): khong tinh nguoi da roi va tai khoan da xoa
    const admin = cells((await ask(w.u.admin, MY, { intent: 'MY_WORKSPACES' })).answer);
    expect(admin.find((c) => c[0] === 'Nhóm A')![3]).toBe(4);
    // nhom truoc, ca nhan sau
    expect(admin[admin.length - 1][0]).toContain('(cá nhân)');
  });

  it('pham vi KHONG GIAN / BANG: chi khong gian cua pham vi', async () => {
    const w = await setup();
    const ws = await ask(w.u.admin, { kind: 'WORKSPACE', workspaceId: w.wsB }, { intent: 'MY_WORKSPACES' });
    expect(cells(ws.answer)).toEqual([['Nhóm B', ROLE_WS.MEMBER, 2, 2]]);
    const bd = await ask(w.u.viewer, { kind: 'BOARD', boardId: w.b.xem.id }, { intent: 'MY_WORKSPACES' });
    expect(cells(bd.answer).map((c) => c[0])).toEqual(['Nhóm A']);
  });
});

describe('MEMBER_LIST', () => {
  it('bang: chu + thanh vien hien tai (ke ca nguoi xem, khach); khong nguoi da roi / tai khoan xoa; bang WORKSPACE ghi so nguoi cua khong gian', async () => {
    const w = await setup();
    const xem = await ask(w.u.member, MY, { intent: 'MEMBER_LIST', target: 'A-xem' });
    expect(xem.targetName).toBe('A-xem');
    expect(cells(xem.answer)).toEqual([['Thành Viên', 'Chủ bảng'], ['Người Xem', 'Người xem']]);
    expect(fact(xem.answer, 'members')).toBe(2);
    expect(xem.answer.notes.join(' ')).not.toContain('cả không gian');

    // khach chi o bang, khong o khong gian: van nam trong danh sach bang
    const khach = await ask(w.u.leader, MY, { intent: 'MEMBER_LIST', target: 'A-khach' });
    expect(cells(khach.answer)).toEqual([['Trưởng Nhóm', 'Chủ bảng'], ['Khách Mời', 'Thành viên']]);

    // bang WORKSPACE: chi 1 BoardMember (chu) nhung ca khong gian xem duoc
    const chung = await ask(w.u.admin, MY, { intent: 'MEMBER_LIST', target: 'A-chung' });
    expect(cells(chung.answer)).toEqual([['Trưởng Nhóm', 'Chủ bảng']]);
    const r = await raw(w.u.admin.id);
    expect(chung.answer.notes.join(' ')).toContain(`(${r.peopleOf(w.wsA)} người)`);
    expect(r.peopleOf(w.wsA)).toBe(4);

    // BoardMember da roi bang khong con o danh sach
    await prisma.boardMember.update({ where: { boardId_userId: { boardId: w.b.xem.id, userId: w.u.viewer.id } }, data: { deletedAt: new Date() } });
    expect(cells((await ask(w.u.member, MY, { intent: 'MEMBER_LIST', target: 'A-xem' })).answer)).toEqual([['Thành Viên', 'Chủ bảng']]);
    // tai khoan da xoa cung bien mat
    await prisma.boardMember.create({ data: { boardId: w.b.xem.id, userId: w.u.gone.id, role: 'MEMBER' } });
    expect(cells((await ask(w.u.member, MY, { intent: 'MEMBER_LIST', target: 'A-xem' })).answer).map((c) => c[0])).toEqual(['Thành Viên']);
  });

  it('khong gian: thanh vien hien tai theo vai tro; khong nguoi da roi / tai khoan xoa; chu thieu dong thanh vien van co mat', async () => {
    const w = await setup();
    const a = await ask(w.u.member, MY, { intent: 'MEMBER_LIST', target: 'Nhóm A' });
    expect(a.targetName).toBe('Nhóm A');
    expect(cells(a.answer)).toEqual([
      ['Trưởng Nhóm', 'Chủ sở hữu'],
      ['Quản Trị', 'Quản trị viên'],
      ['Người Xem', 'Thành viên'], // cung vai tro: theo ten
      ['Thành Viên', 'Thành viên'],
    ]);
    expect(a.answer.text).toContain('4 thành viên');
    expect(JSON.stringify(a.answer)).not.toContain('Người Đã Rời');
    expect(JSON.stringify(a.answer)).not.toContain('Tài Khoản Xoá');

    // du lieu cu: chu khong-gian khong co dong WorkspaceMember -> van hien la chu
    await prisma.workspaceMember.delete({ where: { workspaceId_userId: { workspaceId: w.wsA, userId: w.u.leader.id } } });
    const noRow = await ask(w.u.member, MY, { intent: 'MEMBER_LIST', target: 'Nhóm A' });
    expect(cells(noRow.answer)[0]).toEqual(['Trưởng Nhóm', 'Chủ sở hữu']);
    expect(cells(noRow.answer)).toHaveLength(4);
  });

  it('chu bi xoa tai khoan khong hien trong danh sach (bang va khong gian), khong gian thieu dong thanh vien cua chu dem dung', async () => {
    const w = await setup();
    const board = await ask(w.u.member, MY, { intent: 'MEMBER_LIST', target: 'C-cua-nguoi-da-xoa' });
    expect(board.targetName).toBe('C-cua-nguoi-da-xoa');
    expect(cells(board.answer)).toEqual([]);
    expect(JSON.stringify(board.answer)).not.toContain('Tài Khoản Xoá');
    const space = await ask(w.u.member, MY, { intent: 'MEMBER_LIST', target: 'Nhóm C' });
    expect(cells(space.answer)).toEqual([['Thành Viên', 'Thành viên']]);
    expect(JSON.stringify(space.answer)).not.toContain('Tài Khoản Xoá');
  });

  it('khong ten: dung bang / khong gian cua pham vi; pham vi MY khong ten -> khong tim thay (dich vu se hoi lai truoc)', async () => {
    const w = await setup();
    const bd = await ask(w.u.member, { kind: 'BOARD', boardId: w.b.xem.id }, { intent: 'MEMBER_LIST' });
    expect(bd.targetName).toBe('A-xem');
    expect(cells(bd.answer)).toHaveLength(2);
    const ws = await ask(w.u.member, { kind: 'WORKSPACE', workspaceId: w.wsA }, { intent: 'MEMBER_LIST' });
    expect(ws.targetName).toBe('Nhóm A');
    expect(cells(ws.answer)).toHaveLength(4);
    const my = await ask(w.u.member, MY, { intent: 'MEMBER_LIST' });
    expect(my.answer.text).toContain('Không tìm thấy');
    expect(my.answer.table).toBeUndefined();
  });
});

describe('CARD_COUNTS', () => {
  it('theo cot cua mot bang: dung bang phep dem tho, dung thu tu cot, khong dem the / cot luu tru, xoa; xem nho khong gian', async () => {
    const w = await setup();
    const r = await raw(w.u.admin.id);
    const chung = r.readable.find((b) => b.name === 'A-chung')!;
    const out = await ask(w.u.admin, MY, { intent: 'CARD_COUNTS', target: 'A-chung' });
    expect(out.targetName).toBe('A-chung');
    expect(cells(out.answer)).toEqual([
      ['Cần làm', 3, 0, 3],
      ['Đang làm', 2, 1, 3],
      ['Xong', 0, 4, 4],
    ]);
    const naive = r.counts(chung);
    expect(naive).toEqual({ open: 5, done: 5 });
    expect(fact(out.answer, 'open')).toBe(naive.open);
    expect(fact(out.answer, 'done')).toBe(naive.done);
    expect(fact(out.answer, 'total')).toBe(naive.open + naive.done);
    expect(out.answer.text).toContain('10 thẻ: 5 chưa xong, 5 đã hoàn thành');
    // chong xanh gia: bang co the that bi luu tru / xoa, nhung khong duoc dem
    expect(await prisma.card.count({ where: { list: { boardId: w.b.chung.id } } })).toBeGreaterThan(10);
    // admin khong la BoardMember cua bang nay
    expect(await prisma.boardMember.count({ where: { boardId: w.b.chung.id, userId: w.u.admin.id } })).toBe(0);
    // bang khong co the: van hien, toan 0
    const trong = await ask(w.u.admin, MY, { intent: 'CARD_COUNTS', target: 'A-trong' });
    expect(cells(trong.answer)).toEqual([['Cần làm', 0, 0, 0], ['Đang làm', 0, 0, 0], ['Xong', 0, 0, 0]]);
    expect(trong.answer.text).toContain('0 thẻ');
  });

  it('theo bang (pham vi MY): dung tung bang bang phep dem tho; sap nhieu the truoc; the cua bang khong doc duoc khong lot vao', async () => {
    const w = await setup();
    for (const [who, user] of everyone(w)) {
      const r = await raw(user.id);
      const a = (await ask(user, MY, { intent: 'CARD_COUNTS' })).answer;
      const want = r.readable.map((b) => [b.id, b.name, b.workspace.name, r.counts(b).open, r.counts(b).done]);
      expect(a.table!.total, who).toBe(want.length);
      const got = a.table!.rows.map((row) => [row.boardId, row.cells[0], row.cells[1], row.cells[2], row.cells[3]]);
      expect([...got].sort((x, y) => (x[0]! < y[0]! ? -1 : 1)), who).toEqual([...want].sort((x, y) => (x[0] < y[0] ? -1 : 1)));
      const totals = a.table!.rows.map((row) => (row.cells[2] as number) + (row.cells[3] as number));
      expect(totals, `${who}: sap nhieu the truoc`).toEqual([...totals].sort((x, y) => y - x));
      expect(fact(a, 'open'), who).toBe(want.reduce((n, x) => n + (x[3] as number), 0));
      expect(fact(a, 'done'), who).toBe(want.reduce((n, x) => n + (x[4] as number), 0));
    }
    // admin khong duoc tinh the cua bang PUBLIC / PRIVATE khong tham gia (18 the / 21 the ...)
    const admin = await ask(w.u.admin, MY, { intent: 'CARD_COUNTS' });
    expect(cells(admin.answer).map((c) => c[0])).not.toContain('B-cong-khai');
    expect(cells(admin.answer).map((c) => c[0])).not.toContain('A-rieng');
    expect(admin.answer.text).toContain('trên ');
  });

  it('theo khong gian: chi cac bang doc duoc cua khong gian do; theo cot: chi bang co cot khop, dem dung cot do', async () => {
    const w = await setup();
    const r = await raw(w.u.admin.id);
    const inB = r.readable.filter((b) => b.workspaceId === w.wsB);
    const wsB = await ask(w.u.admin, MY, { intent: 'CARD_COUNTS', target: 'Nhóm B' });
    // "Nhóm B" vua la khong gian vua la ten bang trong Nhom A -> hoi lai; chon khong gian bang targetId
    expect(wsB.answer.kind).toBe('CLARIFY');
    const chosen = await ask(w.u.admin, MY, { intent: 'CARD_COUNTS', targetId: w.wsB });
    expect(chosen.targetName).toBe('Nhóm B');
    expect(cells(chosen.answer).map((c) => c[0]).sort()).toEqual(inB.map((b) => b.name).sort());
    expect(fact(chosen.answer, 'open')).toBe(inB.reduce((n, b) => n + r.counts(b).open, 0));
    expect(fact(chosen.answer, 'done')).toBe(inB.reduce((n, b) => n + r.counts(b).done, 0));

    // loc cot "Đang làm" o pham vi MY
    const col = await ask(w.u.admin, MY, { intent: 'CARD_COUNTS', column: 'Đang làm' });
    expect(col.columnName).toBe('Đang làm');
    const want = r.readable.map((b) => ({ b, ...r.counts(b, 'Đang làm') }));
    expect(fact(col.answer, 'open')).toBe(want.reduce((n, x) => n + x.open, 0));
    expect(fact(col.answer, 'done')).toBe(want.reduce((n, x) => n + x.done, 0));
    expect(col.answer.table!.total).toBe(r.readable.filter((b) => r.liveLists(b).some((l) => l.name === 'Đang làm')).length);
    expect(col.answer.text).toContain('Đang làm');
    // cot + bang: chi cot do cua bang do
    const both = await ask(w.u.admin, MY, { intent: 'CARD_COUNTS', target: 'A-chung', column: 'đang làm' });
    expect(cells(both.answer)).toEqual([['Đang làm', 2, 1, 3]]);
    // khong co cot nhu vay trong bang do
    const none = await ask(w.u.admin, MY, { intent: 'CARD_COUNTS', target: 'A-chung', column: 'Không có cột này' });
    expect(none.answer.text).toContain('Không tìm thấy cột');
    expect(none.answer.table).toBeUndefined();
    // cot chi ton tai o bang KHONG doc duoc -> khong tim thay, khong lo
    await prisma.list.create({ data: { boardId: w.b.congKhaiB.id, name: 'Cột chỉ bảng công khai' } });
    const hidden = await ask(w.u.admin, MY, { intent: 'CARD_COUNTS', column: 'Cột chỉ bảng công khai' });
    expect(hidden.answer.text).toContain('Không tìm thấy cột');
  });

  it('cot da luu tru / da xoa khong dung duoc; pham vi BANG mac dinh bang do; pham vi KHONG GIAN', async () => {
    const w = await setup();
    const arch = await ask(w.u.admin, MY, { intent: 'CARD_COUNTS', column: 'Cột lưu trữ' });
    expect(arch.answer.text).toContain('Không tìm thấy cột');
    const del = await ask(w.u.admin, MY, { intent: 'CARD_COUNTS', column: 'Cột đã xoá' });
    expect(del.answer.text).toContain('Không tìm thấy cột');

    const bd = await ask(w.u.member, { kind: 'BOARD', boardId: w.b.xem.id }, { intent: 'CARD_COUNTS' });
    expect(bd.targetName).toBeNull(); // mac dinh theo pham vi, chua nhan dien ten nao
    expect(cells(bd.answer)).toEqual([['Cần làm', 1, 1, 2], ['Đang làm', 1, 1, 2], ['Xong', 1, 1, 2]]);
    expect(bd.answer.text).toContain('A-xem');

    const r = await raw(w.u.member.id);
    const inA = r.readable.filter((b) => b.workspaceId === w.wsA);
    const ws = await ask(w.u.member, { kind: 'WORKSPACE', workspaceId: w.wsA }, { intent: 'CARD_COUNTS' });
    expect(cells(ws.answer).map((c) => c[0]).sort()).toEqual(inA.map((b) => b.name).sort());
    expect(fact(ws.answer, 'open')).toBe(inA.reduce((n, b) => n + r.counts(b).open, 0));
  });
});

describe('nhan dien ten trong danh muc (khong lo bang khong doc duoc)', () => {
  it('mot ket qua -> tra loi; nhieu bang cung ten -> nut chon, chua tra so; nguoi chi thay mot bang -> tra loi thang', async () => {
    const w = await setup();
    const one = await ask(w.u.admin, MY, { intent: 'CARD_COUNTS', target: 'a-CHUNG' });
    expect(one.answer.kind).toBe('ANSWER');
    expect(one.pendingTargets).toBeNull();

    const many = await ask(w.u.admin, MY, { intent: 'CARD_COUNTS', target: 'Trùng tên' });
    expect(many.answer.kind).toBe('CLARIFY');
    expect(many.answer.table).toBeUndefined();
    expect(many.answer.facts).toEqual([]);
    expect([...many.pendingTargets!].sort()).toEqual([w.b.trungA.id, w.b.trungB.id].sort());
    expect(many.answer.clarify!.options.map((o) => o.id).sort()).toEqual([...many.pendingTargets!].sort());
    expect(many.answer.clarify!.options.every((o) => o.kind === 'TARGET')).toBe(true);
    expect(many.answer.clarify!.options.map((o) => o.label).sort()).toEqual(['Bảng Trùng tên (Nhóm A)', 'Bảng Trùng tên (Nhóm B)']);

    // leader khong o Nhom B nen chi co mot bang "Trùng tên": tra loi thang (khong lo bang cua Nhom B)
    const leader = await ask(w.u.leader, MY, { intent: 'CARD_COUNTS', target: 'Trùng tên' });
    expect(leader.answer.kind).toBe('ANSWER');
    expect(cells(leader.answer)).toEqual([['Cần làm', 1, 1, 2], ['Đang làm', 0, 0, 0], ['Xong', 0, 0, 0]]);

    // ten khong gian trung ten bang: nut chon gom ca hai loai
    const both = await ask(w.u.admin, MY, { intent: 'MEMBER_LIST', target: 'Nhóm B' });
    expect(both.answer.clarify!.options.map((o) => o.label).sort()).toEqual(['Bảng Nhóm B (Nhóm A)', 'Không gian Nhóm B']);
    // member khong o Nhom B: chi con bang "Nhóm B" cua Nhom A
    const solo = await ask(w.u.member, MY, { intent: 'MEMBER_LIST', target: 'Nhóm B' });
    expect(solo.answer.kind).toBe('ANSWER');
    expect(solo.targetName).toBe('Nhóm B');
    expect(solo.answer.text).toContain('Bảng');
  });

  it('bang khong doc duoc = "khong tim thay" (khong noi no co ton tai), ke ca khi goi bang id; pham vi BANG khong nhan bang khac', async () => {
    const w = await setup();
    const typed = await ask(w.u.outsider, MY, { intent: 'CARD_COUNTS', target: 'A-rieng' });
    const byId = await ask(w.u.outsider, MY, { intent: 'CARD_COUNTS', targetId: w.b.rieng.id });
    for (const out of [typed, byId]) {
      expect(out.answer.kind).toBe('ANSWER');
      expect(out.answer.text).toContain('Không tìm thấy');
      expect(out.answer.table).toBeUndefined();
      expect(out.answer.facts).toEqual([]);
      expect(out.targetName).toBeNull();
    }
    expect(JSON.stringify(typed.answer)).not.toContain('A-rieng'.toUpperCase()); // khong lap lai the / ten bang that
    // bang PUBLIC cua khong gian khac: admin (khong tham gia) cung khong thay
    for (const id of [w.b.congKhaiB.id, w.b.luuTru.id, w.b.daXoa.id]) {
      const o = await ask(w.u.admin, MY, { intent: 'MEMBER_LIST', targetId: id });
      expect(o.answer.text, id).toContain('Không tìm thấy');
    }
    // id cua khong gian minh khong tham gia
    const ws = await ask(w.u.member, MY, { intent: 'MEMBER_LIST', targetId: w.wsB });
    expect(ws.answer.text).toContain('Không tìm thấy');
    // pham vi BANG: catalog chi co bang do, ten bang khac -> khong tim thay
    const inBoard = await ask(w.u.member, { kind: 'BOARD', boardId: w.b.xem.id }, { intent: 'CARD_COUNTS', target: 'A-chung' });
    expect(inBoard.answer.text).toContain('Không tìm thấy');
  });

  it('tham so khong dung toi thi bi bo qua co ghi chu, khong lam sai so', async () => {
    const w = await setup();
    const ws = await ask(w.u.admin, MY, { intent: 'MY_WORKSPACES', target: 'Nhóm A', column: 'Xong' });
    expect(ws.answer.notes.join(' ')).toContain('bỏ qua tên');
    expect(ws.answer.notes.join(' ')).toContain('chưa lọc theo cột');
    expect(cells(ws.answer).length).toBe((await raw(w.u.admin.id)).wsMemberships.filter((m) => m.deletedAt === null).length);
    const list = await ask(w.u.member, MY, { intent: 'MEMBER_LIST', target: 'A-xem', column: 'Xong' });
    expect(list.answer.notes.join(' ')).toContain('chưa lọc theo cột');
    expect(cells(list.answer)).toHaveLength(2);
  });
});

describe('an toan du lieu', () => {
  it('moi cau tra loi danh muc khong chua email, id nguoi dung, mo ta / tieu de the, mat khau', async () => {
    const w = await setup();
    const users = await prisma.user.findMany({ select: { id: true, email: true } });
    const asks: [TestUser, ChatScopeInput, { intent: CatalogIntent; target?: string; column?: string }][] = [
      [w.u.admin, MY, { intent: 'MY_BOARDS' }],
      [w.u.admin, MY, { intent: 'MY_WORKSPACES' }],
      [w.u.admin, MY, { intent: 'CARD_COUNTS' }],
      [w.u.admin, MY, { intent: 'CARD_COUNTS', column: 'Xong' }],
      [w.u.admin, MY, { intent: 'MEMBER_LIST', target: 'A-chung' }],
      [w.u.member, MY, { intent: 'MEMBER_LIST', target: 'A-xem' }],
      [w.u.member, MY, { intent: 'MEMBER_LIST', target: 'Nhóm A' }],
      [w.u.leader, MY, { intent: 'MEMBER_LIST', target: 'A-khach' }],
      [w.u.admin, MY, { intent: 'CARD_COUNTS', target: 'Trùng tên' }],
      [w.u.admin, { kind: 'WORKSPACE', workspaceId: w.wsA }, { intent: 'MEMBER_LIST' }],
    ];
    for (const [user, input, q] of asks) {
      const text = JSON.stringify((await ask(user, input, q)).answer);
      expect(text.length, JSON.stringify(q)).toBeGreaterThan(50);
      for (const x of users) {
        expect(text, `${q.intent}: email`).not.toContain(x.email);
        expect(text, `${q.intent}: id nguoi dung`).not.toContain(x.id);
      }
      for (const secret of [SECRET_TITLE, SECRET_DESC, 'password', 'token']) expect(text, `${q.intent}: ${secret}`).not.toContain(secret);
    }
  });

  it('ket qua tho cua runCatalog chi gom ten va vai tro (khong co truong nhay cam)', async () => {
    const w = await setup();
    const scope = await resolveScope(w.u.admin.id, MY);
    const cat = await loadCatalog(scope);
    const board = cat.boards.find((b) => b.name === 'A-chung')!;
    const ws = cat.workspaces.find((x) => x.name === 'Nhóm A')!;
    const results: CatalogResult[] = [
      await runCatalog(scope, { intent: 'MY_BOARDS', target: null, columns: null }),
      await runCatalog(scope, { intent: 'MY_WORKSPACES', target: null, columns: null }),
      await runCatalog(scope, { intent: 'MEMBER_LIST', target: { type: 'BOARD', board }, columns: null }),
      await runCatalog(scope, { intent: 'MEMBER_LIST', target: { type: 'WORKSPACE', workspace: ws }, columns: null }),
      await runCatalog(scope, { intent: 'CARD_COUNTS', target: null, columns: null }),
    ];
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
      }
    };
    results.forEach(walk);
    for (const bad of ['email', 'description', 'token', 'password', 'userId', 'ownerId', 'title']) expect(keys.has(bad), bad).toBe(false);
    expect(keys.size).toBeGreaterThan(10);
    // MEMBER_LIST khong co ten -> loi lap trinh, khong doan
    await expect(runCatalog(scope, { intent: 'MEMBER_LIST', target: null, columns: null })).rejects.toThrow();
  });

  it('runCatalog tu kiem quyen: dua vao bang / khong gian KHONG doc duoc (hoac bang da luu tru) van khong ra so, khong ra nguoi', async () => {
    const w = await setup();
    const scope = await resolveScope(w.u.admin.id, MY); // admin khong doc duoc A-rieng, A-khach, B-cong-khai
    const entity = async (boardId: string) => {
      const b = await prisma.board.findUniqueOrThrow({ where: { id: boardId }, select: { id: true, name: true, workspaceId: true, workspace: { select: { name: true } } } });
      return { id: b.id, name: b.name, workspaceId: b.workspaceId, workspaceName: b.workspace.name };
    };
    for (const id of [w.b.rieng.id, w.b.khach.id, w.b.congKhaiB.id]) {
      const counts = await runCatalog(scope, { intent: 'CARD_COUNTS', target: { type: 'BOARD', board: await entity(id) }, columns: null });
      expect(counts, id).toMatchObject({ kind: 'COUNTS', rows: [], total: 0, open: 0, done: 0 });
    }
    // khong gian Nhom B: admin la thanh vien nhung chi doc duoc bang WORKSPACE (B-chung, Trung ten), khong doc duoc B-cong-khai (PUBLIC)
    const ws = await runCatalog(scope, { intent: 'CARD_COUNTS', target: { type: 'WORKSPACE', workspace: { id: w.wsB, name: 'Nhóm B' } }, columns: null });
    expect(ws.kind === 'COUNTS' ? ws.rows.map((r) => r.label).sort() : null).toEqual(['B-chung', 'Trùng tên']);
    // thanh vien bang da luu tru: khong ra nguoi nao (bang khong con "song")
    const archived = await entity(w.b.luuTru.id);
    const members = await runCatalog(scope, { intent: 'MEMBER_LIST', target: { type: 'BOARD', board: archived }, columns: null });
    expect(members).toMatchObject({ kind: 'MEMBERS', total: 0, rows: [] });
  });

  it('tat dinh: hai lan hoi cho cung ket qua; khong sua du lieu', async () => {
    const w = await setup();
    const before = await Promise.all([prisma.board.count(), prisma.card.count(), prisma.boardMember.count(), prisma.workspaceMember.count(), prisma.list.count()]);
    const q = { intent: 'CARD_COUNTS' as const, target: 'A-chung' };
    const a = await ask(w.u.admin, MY, q);
    const b = await ask(w.u.admin, MY, q);
    expect(b.answer).toEqual(a.answer);
    const after = await Promise.all([prisma.board.count(), prisma.card.count(), prisma.boardMember.count(), prisma.workspaceMember.count(), prisma.list.count()]);
    expect(after).toEqual(before);
  });
});
