// Pham vi + quyen doc + danh sach nguoi cua chatbot tren CSDL that (CHATBOT_MODULE.md §6.1, §7, §8.1, §15).
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { AppError } from '../src/utils/AppError';
import { assertBoardView, canManageBoard, listMyBoards } from '../src/modules/board/board.service';
import { resolveMemberRef, type MemberMatch, type RosterMember } from '../src/modules/chat/chat.members';
import {
  liveCardWhere,
  listChoosableWorkspaces,
  loadRoster,
  resolveScope,
  type ChatScopeInput,
} from '../src/modules/chat/chat.scope';
import { makeDirectUser, type TestUser } from './helpers';

type Role = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';

/**
 * Hai khong gian, 9 bang, 11 nguoi:
 * - Nhom A: leader (OWNER), admin (ADMIN), member, viewer, lan1, lan2 (MEMBER); leaver da roi; gone bi xoa tai khoan.
 * - Nhom B: leaderB (OWNER), admin (MEMBER).
 * - guest: chi la thanh vien bang "A-khach", khong o khong gian nao; outsider: khong lien quan.
 */
async function setup() {
  const u = {
    leader: await makeDirectUser('Trưởng Nhóm'),
    admin: await makeDirectUser('Quản Trị'),
    member: await makeDirectUser('Thành Viên'),
    viewer: await makeDirectUser('Người Xem'),
    lan1: await makeDirectUser('Nguyễn Thị Lan'),
    lan2: await makeDirectUser('Trần Lan'),
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
          { userId: u.lan1.id, role: 'MEMBER' },
          { userId: u.lan2.id, role: 'MEMBER' },
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
      members: {
        create: [
          { userId: u.leaderB.id, role: 'OWNER' },
          { userId: u.admin.id, role: 'MEMBER' },
        ],
      },
    },
    select: { id: true },
  });

  const board = async (
    name: string,
    owner: TestUser,
    workspaceId: string,
    visibility: 'PRIVATE' | 'WORKSPACE' | 'PUBLIC',
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
        lists: { create: { name: 'Việc' } },
        members: {
          create: [
            { userId: owner.id, role: 'OWNER' as const },
            ...others.map(([user, role]) => ({ userId: user.id, role })),
          ],
        },
      },
      include: { lists: { select: { id: true } } },
    });
    return { id: b.id, listId: b.lists[0]!.id };
  };

  const b = {
    chung: await board('A-chung', u.leader, wsA.id, 'WORKSPACE'),
    rieng: await board('A-rieng', u.leader, wsA.id, 'PRIVATE', [[u.member, 'ADMIN']]),
    rieng2: await board('A-rieng-2', u.member, wsA.id, 'PRIVATE'),
    xem: await board('A-xem', u.member, wsA.id, 'PRIVATE', [[u.viewer, 'VIEWER']]),
    khach: await board('A-khach', u.leader, wsA.id, 'PRIVATE', [[u.guest, 'MEMBER']]),
    luuTru: await board('A-luu-tru', u.leader, wsA.id, 'WORKSPACE', [], { archived: true }),
    daXoa: await board('A-da-xoa', u.leader, wsA.id, 'WORKSPACE', [], { deleted: true }),
    congKhaiB: await board('B-cong-khai', u.leaderB, wsB.id, 'PUBLIC'),
    chungB: await board('B-chung', u.leaderB, wsB.id, 'WORKSPACE'),
  };
  return { u, b, wsA: wsA.id, wsB: wsB.id };
}

async function boardNames(userId: string, input: ChatScopeInput): Promise<string[]> {
  const scope = await resolveScope(userId, input);
  const rows = await prisma.board.findMany({ where: scope.boardWhere, select: { name: true } });
  expect(scope.boardCount, JSON.stringify(input)).toBe(rows.length);
  return rows.map((r) => r.name).sort();
}

async function statusOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (err) {
    if (err instanceof AppError) return `${err.statusCode} ${err.message}`;
    throw err;
  }
}

const ids = (roster: RosterMember[]) => roster.map((m) => m.userId).sort();
function short(m: MemberMatch): string {
  if (m.kind === 'ONE') return `ONE:${m.member.userId}`;
  if (m.kind === 'MANY') return `MANY:${m.members.map((x) => x.userId).sort().join(',')}`;
  return 'NONE';
}

describe('bang doc duoc (§7.1)', () => {
  it('pham vi MY dung voi tung vai tro, khong tinh bang PUBLIC / luu tru / da xoa, trung listMyBoards', async () => {
    const { u, b, wsA } = await setup();
    const expected: [keyof typeof u, string[]][] = [
      ['leader', ['A-chung', 'A-khach', 'A-rieng']],
      ['admin', ['A-chung', 'B-chung']], // ADMIN khong gian KHONG mac nhien doc bang PRIVATE
      ['member', ['A-chung', 'A-rieng', 'A-rieng-2', 'A-xem']],
      ['viewer', ['A-chung', 'A-xem']], // VIEWER doc duoc
      ['lan1', ['A-chung']],
      ['guest', ['A-khach']], // khach cua bang: khong thay bang WORKSPACE
      ['leaver', []], // roi khong gian -> mat bang WORKSPACE
      ['outsider', []],
      ['leaderB', ['B-chung', 'B-cong-khai']],
    ];
    for (const [who, names] of expected) {
      expect(await boardNames(u[who].id, { kind: 'MY' }), who).toEqual(names);
      // Doi chieu voi ham san co cua trang chu (cung dinh nghia "bang cua toi")
      const mine = (await listMyBoards(u[who].id)).map((x) => x.name).sort();
      expect(mine, `listMyBoards ${who}`).toEqual(names);
    }
    // Du lieu cu: bang thieu dong BoardMember cua chu -> chu van doc duoc (giong listMyCards;
    // listMyBoards khong co nhanh nay nen o day hai ben khac nhau la co chu dich)
    await prisma.board.create({
      data: { name: 'A-cu', ownerId: u.lan1.id, workspaceId: wsA, visibility: 'PRIVATE', lists: { create: { name: 'Việc' } } },
    });
    expect(await boardNames(u.lan1.id, { kind: 'MY' })).toEqual(['A-chung', 'A-cu']);
    expect(await boardNames(u.lan2.id, { kind: 'MY' })).toEqual(['A-chung']);

    // Bang PUBLIC xem duoc qua assertBoardView nhung tro ly KHONG tinh
    const view = await assertBoardView(u.member.id, b.congKhaiB.id);
    expect(view.canEdit).toBe(false);
    expect(await boardNames(u.member.id, { kind: 'MY' })).not.toContain('B-cong-khai');
    const my = await resolveScope(u.member.id, { kind: 'MY' });
    expect([my.workspace, my.board, my.isLeader]).toEqual([null, null, false]);
  });

  it('the con song: bo the / danh sach / bang da xoa hoac luu tru; ghep them dieu kien bang AND', async () => {
    const { u, b } = await setup();
    const mk = (listId: string, title: string, over: Record<string, unknown> = {}) =>
      prisma.card.create({ data: { listId, title, members: { create: { userId: u.member.id } }, ...over } });
    await mk(b.chung.listId, 'song 1');
    await mk(b.chung.listId, 'song 2');
    await prisma.card.create({ data: { listId: b.chung.listId, title: 'song, khong giao' } });
    await mk(b.chung.listId, 'luu tru', { archivedAt: new Date() });
    await mk(b.chung.listId, 'da xoa', { deletedAt: new Date() });
    const archivedList = await prisma.list.create({ data: { boardId: b.chung.id, name: 'Cu', archivedAt: new Date() } });
    const deletedList = await prisma.list.create({ data: { boardId: b.chung.id, name: 'Xoa', deletedAt: new Date() } });
    await mk(archivedList.id, 'trong danh sach luu tru');
    await mk(deletedList.id, 'trong danh sach da xoa');
    await mk(b.luuTru.listId, 'trong bang luu tru');
    await mk(b.congKhaiB.listId, 'trong bang cong khai');

    const scope = await resolveScope(u.member.id, { kind: 'MY' });
    const titles = async (where: object) =>
      (await prisma.card.findMany({ where, select: { title: true } })).map((c) => c.title).sort();
    expect(await titles(liveCardWhere(scope.boardWhere))).toEqual(['song 1', 'song 2', 'song, khong giao']);
    expect(
      await titles({ AND: [liveCardWhere(scope.boardWhere), { members: { some: { userId: u.member.id } } }] })
    ).toEqual(['song 1', 'song 2']);
  });
});

describe('ba pham vi va truong nhom (§7.2, §7.3)', () => {
  it('WORKSPACE: chi bang doc duoc CUA khong gian do; khong muon quyen khong gian nay sang khong gian kia', async () => {
    const { u, wsA, wsB } = await setup();
    const WS = (workspaceId: string): ChatScopeInput => ({ kind: 'WORKSPACE', workspaceId });

    expect(await boardNames(u.member.id, WS(wsA))).toEqual(['A-chung', 'A-rieng', 'A-rieng-2', 'A-xem']);
    expect(await boardNames(u.leader.id, WS(wsA))).toEqual(['A-chung', 'A-khach', 'A-rieng']);
    // admin doc duoc ca "B-chung" o pham vi MY, nhung pham vi A chi con bang cua A
    expect(await boardNames(u.admin.id, WS(wsA))).toEqual(['A-chung']);
    expect(await boardNames(u.admin.id, WS(wsB))).toEqual(['B-chung']);

    const leaderOf = async (user: TestUser, ws: string) => (await resolveScope(user.id, WS(ws))).isLeader;
    expect(await leaderOf(u.leader, wsA)).toBe(true);
    expect(await leaderOf(u.admin, wsA)).toBe(true);
    expect(await leaderOf(u.admin, wsB)).toBe(false); // truong nhom A khong la truong nhom B
    expect(await leaderOf(u.member, wsA)).toBe(false);
    const scopeA = await resolveScope(u.member.id, WS(wsA));
    expect([scopeA.kind, scopeA.workspace?.id, scopeA.workspace?.name, scopeA.board]).toEqual(['WORKSPACE', wsA, 'Nhóm A', null]);

    const denied = 'Ban khong co quyen truy cap khong gian nay';
    expect(await statusOf(resolveScope(u.member.id, WS(wsB)))).toBe(`403 ${denied}`);
    expect(await statusOf(resolveScope(u.guest.id, WS(wsA)))).toBe(`403 ${denied}`);
    expect(await statusOf(resolveScope(u.leaver.id, WS(wsA)))).toBe(`403 ${denied}`);
    expect(await statusOf(resolveScope(u.outsider.id, WS(wsA)))).toBe(`403 ${denied}`);
    expect(await statusOf(resolveScope(u.member.id, WS(u.leader.personalWorkspaceId)))).toBe(`403 ${denied}`);
    expect(await statusOf(resolveScope(u.member.id, WS('khong-ton-tai')))).toBe('404 Khong tim thay khong gian lam viec');
  });

  it('BOARD: phai doc duoc (khong tinh PUBLIC); truong nhom theo vai tro KHONG GIAN, khong theo vai tro bang', async () => {
    const { u, b, wsA } = await setup();
    const BD = (boardId: string): ChatScopeInput => ({ kind: 'BOARD', boardId });

    const rieng = await resolveScope(u.member.id, BD(b.rieng.id));
    expect([rieng.boardCount, rieng.board?.name, rieng.workspace?.id]).toEqual([1, 'A-rieng', wsA]);
    expect(rieng.isLeader).toBe(false); // member la ADMIN cua bang nay nhung chi la MEMBER khong gian
    expect((await resolveScope(u.viewer.id, BD(b.xem.id))).isLeader).toBe(false);
    expect((await resolveScope(u.member.id, BD(b.xem.id))).isLeader).toBe(false); // CHU bang nhung chi la MEMBER khong gian
    expect((await resolveScope(u.leader.id, BD(b.khach.id))).isLeader).toBe(true);
    expect((await resolveScope(u.guest.id, BD(b.khach.id))).isLeader).toBe(false);
    expect(await boardNames(u.viewer.id, BD(b.xem.id))).toEqual(['A-xem']);

    const notMine = '403 Tro ly chi ho tro bang ban tham gia';
    // admin khong gian QUAN LY duoc bang rieng nay (doi hien thi, tu them minh) nhung tro ly chi xet quyen DOC
    expect(await canManageBoard(u.admin.id, { id: b.rieng2.id, ownerId: u.member.id, workspaceId: wsA })).toBe(true);
    expect(await statusOf(resolveScope(u.admin.id, BD(b.rieng2.id)))).toBe(notMine);
    expect(await statusOf(resolveScope(u.leader.id, BD(b.rieng2.id)))).toBe(notMine);
    // bang PUBLIC: xem duoc tren giao dien nhung tro ly tu choi
    expect((await assertBoardView(u.member.id, b.congKhaiB.id)).canEdit).toBe(false);
    expect(await statusOf(resolveScope(u.member.id, BD(b.congKhaiB.id)))).toBe(notMine);
    expect(await statusOf(resolveScope(u.leader.id, BD(b.chungB.id)))).toBe(notMine);

    const missing = '404 Khong tim thay bang';
    expect(await statusOf(resolveScope(u.leader.id, BD(b.luuTru.id)))).toBe(missing);
    expect(await statusOf(resolveScope(u.leader.id, BD(b.daXoa.id)))).toBe(missing);
    expect(await statusOf(resolveScope(u.leader.id, BD('khong-ton-tai')))).toBe(missing);
  });

  it('thu hoi quyen / doi vai tro giua hai luot: luot sau doc lai tu CSDL', async () => {
    const { u, b, wsA } = await setup();
    const BD: ChatScopeInput = { kind: 'BOARD', boardId: b.rieng.id };
    const WS: ChatScopeInput = { kind: 'WORKSPACE', workspaceId: wsA };

    expect(await statusOf(resolveScope(u.member.id, BD))).toBe('OK');
    await prisma.boardMember.updateMany({ where: { boardId: b.rieng.id, userId: u.member.id }, data: { deletedAt: new Date() } });
    expect(await statusOf(resolveScope(u.member.id, BD))).toBe('403 Tro ly chi ho tro bang ban tham gia');

    expect(await boardNames(u.viewer.id, WS)).toEqual(['A-chung', 'A-xem']);
    await prisma.board.update({ where: { id: b.chung.id }, data: { visibility: 'PRIVATE' } });
    expect(await boardNames(u.viewer.id, WS)).toEqual(['A-xem']);

    expect((await resolveScope(u.admin.id, WS)).isLeader).toBe(true);
    await prisma.workspaceMember.updateMany({ where: { workspaceId: wsA, userId: u.admin.id }, data: { role: 'MEMBER' } });
    expect((await resolveScope(u.admin.id, WS)).isLeader).toBe(false);

    // Roi khong gian: mat pham vi WORKSPACE nhung van doc bang rieng minh la thanh vien truc tiep
    await prisma.workspaceMember.updateMany({ where: { workspaceId: wsA, userId: u.member.id }, data: { deletedAt: new Date() } });
    expect(await statusOf(resolveScope(u.member.id, WS))).toBe('403 Ban khong co quyen truy cap khong gian nay');
    expect(await boardNames(u.member.id, { kind: 'MY' })).toEqual(['A-rieng-2', 'A-xem']);
  });
});

describe('danh sach nguoi va nhan dien ten tren du lieu that (§8)', () => {
  it('WORKSPACE / BOARD / MY; bo nguoi da roi, tai khoan da xoa; khach chi co o pham vi bang', async () => {
    const { u, b, wsA } = await setup();
    const roster = async (userId: string, input: ChatScopeInput) => loadRoster(await resolveScope(userId, input));
    const WS: ChatScopeInput = { kind: 'WORKSPACE', workspaceId: wsA };

    const wsRoster = await roster(u.member.id, WS);
    expect(ids(wsRoster)).toEqual([u.leader, u.admin, u.member, u.viewer, u.lan1, u.lan2].map((x) => x.id).sort());
    expect(wsRoster.find((m) => m.userId === u.lan1.id)?.name).toBe('Nguyễn Thị Lan');
    // Bang WORKSPACE: nguoi cua bang + nguoi cua khong gian (khong trung lap)
    expect(ids(await roster(u.viewer.id, { kind: 'BOARD', boardId: b.chung.id }))).toEqual(ids(wsRoster));
    // Bang PRIVATE: chi chu + thanh vien bang (ke ca VIEWER, ke ca khach)
    expect(ids(await roster(u.member.id, { kind: 'BOARD', boardId: b.xem.id }))).toEqual([u.member.id, u.viewer.id].sort());
    const guestRoster = await roster(u.guest.id, { kind: 'BOARD', boardId: b.khach.id });
    expect(ids(guestRoster)).toEqual([u.leader.id, u.guest.id].sort());
    expect(await roster(u.member.id, { kind: 'MY' })).toEqual([]);

    const cases: [string, { memberText: string | null; memberUserId: string | null }, RosterMember[], string][] = [
      ['trung ten -> hoi lai', { memberText: 'Lan', memberUserId: null }, wsRoster, `MANY:${[u.lan1.id, u.lan2.id].sort().join(',')}`],
      ['ho ten day du', { memberText: 'Nguyễn Thị Lan', memberUserId: null }, wsRoster, `ONE:${u.lan1.id}`],
      ['khong dau', { memberText: 'tran lan', memberUserId: null }, wsRoster, `ONE:${u.lan2.id}`],
      ['nguoi da roi', { memberText: 'Người Đã Rời', memberUserId: null }, wsRoster, 'NONE'],
      ['tai khoan da xoa', { memberText: 'Tài Khoản Xoá', memberUserId: null }, wsRoster, 'NONE'],
      ['khach o pham vi khong gian', { memberText: 'Khách Mời', memberUserId: null }, wsRoster, 'NONE'],
      ['khach o pham vi bang', { memberText: 'Khách Mời', memberUserId: null }, guestRoster, `ONE:${u.guest.id}`],
      ['id da chon con trong danh sach', { memberText: null, memberUserId: u.member.id }, wsRoster, `ONE:${u.member.id}`],
      ['id nguoi da roi', { memberText: null, memberUserId: u.leaver.id }, wsRoster, 'NONE'],
      ['id khach o pham vi khong gian', { memberText: null, memberUserId: u.guest.id }, wsRoster, 'NONE'],
      ['id uu tien hon ten go', { memberText: 'Lan', memberUserId: u.lan2.id }, wsRoster, `ONE:${u.lan2.id}`],
      ['khong co gi', { memberText: null, memberUserId: null }, wsRoster, 'NONE'],
    ];
    for (const [name, ref, r, expected] of cases) expect(short(resolveMemberRef(ref, r)), name).toBe(expected);

    // Luot sau doc lai: lan2 roi khong gian -> "Lan" chi con mot nguoi
    await prisma.workspaceMember.updateMany({ where: { workspaceId: wsA, userId: u.lan2.id }, data: { deletedAt: new Date() } });
    const after = await roster(u.member.id, WS);
    expect(short(resolveMemberRef({ memberText: 'Lan', memberUserId: null }, after))).toBe(`ONE:${u.lan1.id}`);
    // viewer bi xoa khoi bang -> khong con trong danh sach nguoi cua bang
    await prisma.boardMember.updateMany({ where: { boardId: b.xem.id, userId: u.viewer.id }, data: { deletedAt: new Date() } });
    expect(ids(await roster(u.member.id, { kind: 'BOARD', boardId: b.xem.id }))).toEqual([u.member.id]);
  });

  it('du lieu cu thieu dong thanh vien cua CHU (khong gian / bang) -> chu van co trong danh sach nguoi', async () => {
    const { u, wsA } = await setup();
    const wsC = await prisma.workspace.create({ data: { ownerId: u.lan1.id, name: 'Nhóm C' }, select: { id: true } });
    const rosterC = await loadRoster(await resolveScope(u.lan1.id, { kind: 'WORKSPACE', workspaceId: wsC.id }));
    expect(ids(rosterC)).toEqual([u.lan1.id]);

    const old = await prisma.board.create({
      data: { name: 'A-cu', ownerId: u.lan2.id, workspaceId: wsA, visibility: 'PRIVATE', lists: { create: { name: 'Việc' } } },
      select: { id: true },
    });
    const rosterOld = await loadRoster(await resolveScope(u.lan2.id, { kind: 'BOARD', boardId: old.id }));
    expect(ids(rosterOld)).toEqual([u.lan2.id]);
  });

  it('lua chon khong gian khi hoi lai: nhom truoc, ca nhan sau; khong co khong gian da roi / cua nguoi khac', async () => {
    const { u, wsA, wsB } = await setup();
    const opts = async (user: TestUser) => (await listChoosableWorkspaces(user.id)).map((w) => w.id);
    expect(await opts(u.admin)).toEqual([wsA, wsB, u.admin.personalWorkspaceId]);
    expect(await opts(u.member)).toEqual([wsA, u.member.personalWorkspaceId]);
    expect(await opts(u.leaver)).toEqual([u.leaver.personalWorkspaceId]);
    expect(await opts(u.guest)).toEqual([u.guest.personalWorkspaceId]);
    const first = (await listChoosableWorkspaces(u.admin.id))[0];
    expect(first).toEqual({ id: wsA, name: 'Nhóm A', isPersonal: false });
  });
});
