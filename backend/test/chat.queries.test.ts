// Truy van so lieu cua chatbot tren CSDL that (CHATBOT_MODULE.md §6, §15 "Do chinh xac").
// Chot chan chinh: doi chieu MOI con so + MOI the voi mot phep dem "ngay tho" viet bang vong
// lap JS (doc lai toan bo CSDL, tu loc theo dinh nghia §6-§7), tren hang tram to hop.
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { getWorkspaceOverview } from '../src/modules/workspace/workspaceOverview.service';
import type { ChatFocus, ChatPeriod, ResolvedQuery } from '../src/modules/chat/chat.intent';
import { PAGE_SIZE, SECTION_SIZE } from '../src/modules/chat/chat.intent';
import { periodRange, vnDayStart } from '../src/modules/chat/chat.period';
import { runQuery, type ChatCard, type ListResult, type WorkloadResult } from '../src/modules/chat/chat.queries';
import { loadRoster, resolveScope, type ChatScopeInput } from '../src/modules/chat/chat.scope';
import { makeDirectUser, type TestUser } from './helpers';

const NOW = new Date('2026-09-30T03:00:00.000Z'); // Thu Tu 30/09/2026 10:00 gio VN
const H = 3_600_000;
const D = 24 * H;
const at = (ms: number) => new Date(NOW.getTime() + ms);
const SECRET = 'MO-TA-BI-MAT';

const q = (over: Partial<ResolvedQuery>): ResolvedQuery => ({
  intent: 'MY_TASKS',
  period: null,
  focus: null,
  ignoredSlots: [],
  ...over,
});

// ===================== The gioi =====================

async function setup() {
  const u = {
    leader: await makeDirectUser('Trưởng Nhóm'),
    lan: await makeDirectUser('Nguyễn Thị Lan'),
    minh: await makeDirectUser('Hoàng Minh'),
    an: await makeDirectUser('Võ An'),
    guest: await makeDirectUser('Khách Mời'),
    leaver: await makeDirectUser('Người Đã Rời'),
    gone: await makeDirectUser('Tài Khoản Xoá'),
    leaderB: await makeDirectUser('Trưởng Nhóm B'),
  };
  const wsA = await prisma.workspace.create({
    data: {
      ownerId: u.leader.id,
      name: 'Nhóm A',
      members: {
        create: [
          { userId: u.leader.id, role: 'OWNER' },
          { userId: u.lan.id, role: 'MEMBER' },
          { userId: u.minh.id, role: 'MEMBER' },
          { userId: u.an.id, role: 'MEMBER' },
          { userId: u.leaver.id, role: 'MEMBER', deletedAt: new Date() },
          { userId: u.gone.id, role: 'MEMBER' },
        ],
      },
    },
    select: { id: true },
  });
  await prisma.user.update({ where: { id: u.gone.id }, data: { deletedAt: new Date() } });
  const wsB = await prisma.workspace.create({
    data: { ownerId: u.leaderB.id, name: 'Nhóm B', members: { create: { userId: u.leaderB.id, role: 'OWNER' } } },
    select: { id: true },
  });

  const mkBoard = async (
    name: string,
    owner: TestUser,
    workspaceId: string,
    visibility: 'PRIVATE' | 'WORKSPACE' | 'PUBLIC',
    others: TestUser[] = [],
    archived = false
  ) => {
    const b = await prisma.board.create({
      data: {
        name,
        ownerId: owner.id,
        workspaceId,
        visibility,
        archivedAt: archived ? new Date() : null,
        lists: { create: [{ name: 'Việc' }, { name: 'Cũ', archivedAt: new Date() }] },
        members: {
          create: [{ userId: owner.id, role: 'OWNER' as const }, ...others.map((x) => ({ userId: x.id, role: 'MEMBER' as const }))],
        },
      },
      include: { lists: { orderBy: { name: 'desc' }, select: { id: true, name: true } } },
    });
    const live = b.lists.find((l) => l.name === 'Việc')!.id;
    const old = b.lists.find((l) => l.name === 'Cũ')!.id;
    return { id: b.id, live, old };
  };
  const b = {
    W: await mkBoard('A-chung', u.leader, wsA.id, 'WORKSPACE'),
    P: await mkBoard('A-rieng', u.leader, wsA.id, 'PRIVATE', [u.lan]),
    G: await mkBoard('A-khach', u.leader, wsA.id, 'PRIVATE', [u.guest]),
    X: await mkBoard('A-luu-tru', u.leader, wsA.id, 'WORKSPACE', [], true),
    PUB: await mkBoard('B-cong-khai', u.leaderB, wsB.id, 'PUBLIC'),
  };
  return { u, b, wsA: wsA.id, wsB: wsB.id };
}

type World = Awaited<ReturnType<typeof setup>>;

/** ~150 the da dang, tat dinh (hat giong co dinh), giu bat bien DONE <-> isDone <-> completedAt. */
async function seedCards(w: World) {
  const { u, b } = w;
  let seed = 7;
  const rnd = (n: number) => {
    seed = (seed * 48271) % 2147483647;
    return seed % n;
  };
  const lists = [b.W.live, b.W.live, b.W.live, b.W.old, b.P.live, b.P.live, b.G.live, b.X.live, b.PUB.live];
  const dues: (Date | null)[] = [
    null,
    at(-3 * D),
    at(-1 * H),
    at(2 * H), // 12:00 VN hom nay
    at(13 * H + 59 * 60_000), // 23:59 VN hom nay
    at(14 * H), // 00:00 VN ngay mai
    at(2 * D),
    at(6 * D),
    at(9 * D), // tuan sau
    at(-8 * D), // tuan truoc
    NOW, // dung moc bat dau cua "7 ngay toi" (khong qua han)
    new Date('2026-09-29T17:00:00.000Z'), // dung 00:00 VN hom nay (moc bat dau cua TODAY)
  ];
  const completions = [
    new Date('2026-09-27T17:00:00.000Z'), // dung 00:00 VN Thu Hai tuan nay (moc bat dau THIS_WEEK)
    new Date('2026-09-28T02:00:00.000Z'), // Thu Hai tuan nay
    new Date('2026-09-25T09:00:00.000Z'), // Thu Sau tuan truoc
    at(-1 * H),
    at(-20 * D),
  ];
  const statuses = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE', 'DONE'] as const;
  const people = [u.lan.id, u.minh.id, u.an.id, u.guest.id, u.leaver.id, u.gone.id, u.leader.id];
  for (let i = 0; i < 150; i++) {
    const status = statuses[rnd(statuses.length)];
    const done = status === 'DONE';
    const members = people.filter(() => rnd(4) === 0);
    const items = Array.from({ length: rnd(4) }, (_, k) => ({ content: `muc ${k}`, isDone: rnd(2) === 0 }));
    await prisma.card.create({
      data: {
        listId: lists[rnd(lists.length)],
        title: `The ${String(i).padStart(3, '0')}`,
        description: `${SECRET} ${i}`,
        status,
        isDone: done,
        completedAt: done ? completions[rnd(completions.length)] : null,
        dueDate: dues[rnd(dues.length)],
        archivedAt: rnd(15) === 0 ? new Date() : null,
        deletedAt: rnd(15) === 0 ? new Date() : null,
        members: { create: members.map((userId) => ({ userId })) },
        checklists: items.length ? { create: { items: { create: items } } } : undefined,
      },
    });
  }
}

// ===================== Phep dem "ngay tho" =====================

interface Snapshot {
  cards: {
    id: string;
    isDone: boolean;
    status: string;
    dueDate: Date | null;
    completedAt: Date | null;
    archived: boolean;
    deleted: boolean;
    listDead: boolean;
    boardId: string;
    members: string[];
  }[];
  boards: Map<string, { ownerId: string; workspaceId: string; visibility: string; dead: boolean; members: string[] }>;
  wsMembers: Map<string, Set<string>>;
}

async function snapshot(): Promise<Snapshot> {
  const [cards, boards, wsm] = await Promise.all([
    prisma.card.findMany({
      select: {
        id: true,
        isDone: true,
        status: true,
        dueDate: true,
        completedAt: true,
        archivedAt: true,
        deletedAt: true,
        list: { select: { boardId: true, archivedAt: true, deletedAt: true } },
        members: { select: { userId: true } },
      },
    }),
    prisma.board.findMany({ select: { id: true, ownerId: true, workspaceId: true, visibility: true, archivedAt: true, deletedAt: true, members: true } }),
    prisma.workspaceMember.findMany({ where: { deletedAt: null }, select: { workspaceId: true, userId: true } }),
  ]);
  const wsMembers = new Map<string, Set<string>>();
  for (const m of wsm) {
    if (!wsMembers.has(m.workspaceId)) wsMembers.set(m.workspaceId, new Set());
    wsMembers.get(m.workspaceId)!.add(m.userId);
  }
  return {
    cards: cards.map((c) => ({
      id: c.id,
      isDone: c.isDone,
      status: c.status,
      dueDate: c.dueDate,
      completedAt: c.completedAt,
      archived: c.archivedAt !== null,
      deleted: c.deletedAt !== null,
      listDead: c.list.archivedAt !== null || c.list.deletedAt !== null,
      boardId: c.list.boardId,
      members: c.members.map((m) => m.userId),
    })),
    boards: new Map(
      boards.map((x) => [
        x.id,
        {
          ownerId: x.ownerId,
          workspaceId: x.workspaceId,
          visibility: x.visibility,
          dead: x.archivedAt !== null || x.deletedAt !== null,
          members: x.members.filter((m) => m.deletedAt === null).map((m) => m.userId),
        },
      ])
    ),
    wsMembers,
  };
}

function oracle(s: Snapshot, userId: string, scope: ChatScopeInput) {
  const readable = (boardId: string) => {
    const bd = s.boards.get(boardId)!;
    if (bd.dead) return false;
    if (scope.kind === 'WORKSPACE' && bd.workspaceId !== scope.workspaceId) return false;
    if (scope.kind === 'BOARD' && boardId !== scope.boardId) return false;
    if (bd.ownerId === userId || bd.members.includes(userId)) return true;
    return bd.visibility === 'WORKSPACE' && (s.wsMembers.get(bd.workspaceId)?.has(userId) ?? false);
  };
  const live = s.cards.filter((c) => !c.archived && !c.deleted && !c.listDead && readable(c.boardId));
  const inR = (d: Date | null, r: { from: Date; to: Date }) => d !== null && d >= r.from && d < r.to;
  const match = (c: (typeof live)[number], focus: ChatFocus, period: ChatPeriod | null) => {
    const r = period ? periodRange(period, NOW) : null;
    if (focus === 'OPEN') return !c.isDone && (r === null || inR(c.dueDate, r));
    if (focus === 'DONE') return c.isDone && (r === null || inR(c.completedAt, r));
    if (focus === 'OVERDUE') return !c.isDone && c.dueDate !== null && c.dueDate < NOW;
    return c.status === 'BLOCKED';
  };
  const ids = (xs: typeof live) => xs.map((c) => c.id).sort();
  return { live, match, ids, inR };
}

/** Moi trang cua danh sach chinh (den khi rong); kiem khong trung, dung thu tu han. */
async function allPages(run: (page: number) => Promise<ListResult>) {
  const first = await run(1);
  const all: ChatCard[] = [...first.cards];
  for (let p = 2; p <= Math.ceil(first.total / PAGE_SIZE) + 1; p++) {
    const r = await run(p);
    expect(r.total).toBe(first.total);
    all.push(...r.cards);
    if (p === Math.ceil(first.total / PAGE_SIZE) + 1) expect(r.cards).toEqual([]);
  }
  expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1].dueDate;
    const c = all[i].dueDate;
    if (a !== null && c !== null) expect(a <= c).toBe(true);
    if (a === null) expect(c).toBeNull(); // khong co han xep cuoi
  }
  return { first, all };
}

// ===================== Test =====================

describe('runQuery khop phep dem ngay tho', () => {
  it('MY_TASKS / MEMBER_TASKS / TEAM_SUMMARY: moi con so, moi the, moi trang, tren nhieu nguoi hoi x pham vi', async () => {
    const w = await setup();
    await seedCards(w);
    const s = await snapshot();
    const { u, b, wsA } = w;

    const scopes: [TestUser, ChatScopeInput][] = [
      [u.leader, { kind: 'MY' }],
      [u.leader, { kind: 'WORKSPACE', workspaceId: wsA }],
      [u.leader, { kind: 'BOARD', boardId: b.G.id }],
      [u.lan, { kind: 'MY' }],
      [u.lan, { kind: 'WORKSPACE', workspaceId: wsA }],
      [u.lan, { kind: 'BOARD', boardId: b.P.id }],
      [u.minh, { kind: 'WORKSPACE', workspaceId: wsA }],
      [u.guest, { kind: 'MY' }],
      [u.guest, { kind: 'BOARD', boardId: b.G.id }],
    ];
    const focusCases: [ChatFocus, ChatPeriod | null][] = [
      ['OPEN', null],
      ['OPEN', 'NEXT_7_DAYS'],
      ['OPEN', 'TODAY'],
      ['OPEN', 'THIS_WEEK'],
      ['OPEN', 'NEXT_WEEK'],
      ['OPEN', 'LAST_WEEK'],
      ['DONE', 'THIS_WEEK'],
      ['DONE', 'LAST_WEEK'],
      ['DONE', 'TODAY'],
      ['OVERDUE', null],
      ['BLOCKED', null],
    ];
    let checked = 0;
    let multiPage = 0;
    const nonZero = new Map<string, number>();
    for (const [asker, scopeInput] of scopes) {
      const scope = await resolveScope(asker.id, scopeInput);
      const o = oracle(s, asker.id, scopeInput);
      const label = `${asker.name} ${JSON.stringify(scopeInput)}`;

      // Danh sach theo tinh trang: cua toi / cua Lan / cua ca nhom
      const who: [string, ResolvedQuery['intent'], string | null][] = [
        ['toi', 'MY_TASKS', asker.id],
        ['Lan', 'MEMBER_TASKS', u.lan.id],
        ['nhom', 'TEAM_SUMMARY', null],
      ];
      for (const [whoLabel, intent, userId] of who) {
        for (const [focus, period] of focusCases) {
          const query = q({ intent, focus, period });
          const target = userId ? { userId, name: 'x' } : null;
          const { first, all } = await allPages((page) => runQuery({ scope, now: NOW, page }, query, { target }) as Promise<ListResult>);
          const expected = o.live.filter((c) => (userId === null || c.members.includes(userId)) && o.match(c, focus, period));
          const tag = `${label} ${whoLabel} ${focus} ${period}`;
          expect(first.total, tag).toBe(expected.length);
          expect(first.counts.total, tag).toBe(expected.length);
          expect(first.counts.overdue, tag).toBe(expected.filter((c) => o.match(c, 'OVERDUE', null)).length);
          expect(all.map((c) => c.id).sort(), tag).toEqual(o.ids(expected));
          // co "qua han" tinh o backend: chi viec CHUA xong co han < now
          const byId = new Map(expected.map((c) => [c.id, c]));
          for (const c of all) {
            const e = byId.get(c.id)!;
            expect(c.overdue, `${tag} ${c.title}`).toBe(!e.isDone && e.dueDate !== null && e.dueDate < NOW);
          }
          checked++;
          nonZero.set(`${focus} ${period}`, (nonZero.get(`${focus} ${period}`) ?? 0) + expected.length);
          if (first.total > PAGE_SIZE) multiPage++;
        }
      }

      // MEMBER_TASKS tong quan (Lan) va TEAM_SUMMARY tong quan
      for (const period of ['THIS_WEEK', 'LAST_WEEK', 'NEXT_WEEK', 'TODAY'] as ChatPeriod[]) {
        const r = periodRange(period, NOW);
        const lan = o.live.filter((c) => c.members.includes(u.lan.id));
        const mo = (await runQuery({ scope, now: NOW, page: 1 }, q({ intent: 'MEMBER_TASKS', period }), {
          target: { userId: u.lan.id, name: 'Lan' },
        })) as ListResult;
        const tag = `${label} tong quan Lan ${period}`;
        expect(mo.counts.open, tag).toBe(lan.filter((c) => !c.isDone).length);
        expect(mo.counts.overdue, tag).toBe(lan.filter((c) => o.match(c, 'OVERDUE', null)).length);
        expect(mo.counts.doneInPeriod, tag).toBe(lan.filter((c) => c.isDone && o.inR(c.completedAt, r)).length);
        expect(mo.total, tag).toBe(mo.counts.open);
        expect(mo.sections.map((x) => x.key), tag).toEqual(['DONE']);
        expect(mo.sections[0].cards.length, tag).toBe(Math.min(SECTION_SIZE, mo.counts.doneInPeriod ?? 0));
        const moDone = mo.sections[0].cards;
        for (let i = 1; i < moDone.length; i++) expect(moDone[i - 1].completedAt! >= moDone[i].completedAt!, tag).toBe(true);

        const to = (await runQuery({ scope, now: NOW, page: 1 }, q({ intent: 'TEAM_SUMMARY', period }))) as ListResult;
        const all = o.live;
        const t = `${label} tong quan nhom ${period}`;
        expect(to.counts.open, t).toBe(all.filter((c) => !c.isDone).length);
        expect(to.counts.dueInPeriod, t).toBe(all.filter((c) => !c.isDone && o.inR(c.dueDate, r)).length);
        expect(to.counts.overdue, t).toBe(all.filter((c) => o.match(c, 'OVERDUE', null)).length);
        expect(to.counts.blocked, t).toBe(all.filter((c) => c.status === 'BLOCKED').length);
        expect(to.counts.unassignedOpen, t).toBe(all.filter((c) => !c.isDone && c.members.length === 0).length);
        if (period === 'NEXT_WEEK') {
          // ky tuong lai: khong co "hoan thanh trong ky"
          expect(to.counts.doneInPeriod, t).toBeUndefined();
          expect(to.sections.map((x) => x.key), t).toEqual(['OVERDUE', 'BLOCKED']);
        } else {
          expect(to.counts.doneInPeriod, t).toBe(all.filter((c) => c.isDone && o.inR(c.completedAt, r)).length);
          expect(to.sections.map((x) => x.key), t).toEqual(['DONE', 'OVERDUE', 'BLOCKED']);
        }
        for (const sec of to.sections) {
          expect(sec.cards.length, `${t} ${sec.key}`).toBe(Math.min(SECTION_SIZE, sec.total));
          const pool = sec.key === 'DONE' ? all.filter((c) => c.isDone && o.inR(c.completedAt, r)) : sec.key === 'OVERDUE' ? all.filter((c) => o.match(c, 'OVERDUE', null)) : all.filter((c) => c.status === 'BLOCKED');
          expect(sec.total, `${t} ${sec.key}`).toBe(pool.length);
          for (const c of sec.cards) expect(o.ids(pool), `${t} ${sec.key}`).toContain(c.id);
        }
        const done = to.sections.find((x) => x.key === 'DONE');
        if (done) {
          for (let i = 1; i < done.cards.length; i++) expect(done.cards[i - 1].completedAt! >= done.cards[i].completedAt!).toBe(true);
        }
        expect([to.cards, to.total], t).toEqual([[], 0]);
        checked++;
      }
    }
    expect(checked).toBe(scopes.length * (3 * focusCases.length + 4));

    // Goi thang runQuery khong qua resolveSlots: thieu focus -> OPEN, thieu ky (tong ket nhom) -> tuan nay
    const scope = await resolveScope(u.leader.id, { kind: 'WORKSPACE', workspaceId: wsA });
    const bare = (await runQuery({ scope, now: NOW, page: 1 }, q({ intent: 'MY_TASKS' }))) as ListResult;
    const open = (await runQuery({ scope, now: NOW, page: 1 }, q({ intent: 'MY_TASKS', focus: 'OPEN' }))) as ListResult;
    expect([bare.total, bare.cards]).toEqual([open.total, open.cards]);
    const teamBare = (await runQuery({ scope, now: NOW, page: 1 }, q({ intent: 'TEAM_SUMMARY' }))) as ListResult;
    const teamWeek = (await runQuery({ scope, now: NOW, page: 1 }, q({ intent: 'TEAM_SUMMARY', period: 'THIS_WEEK' }))) as ListResult;
    expect(teamBare.counts).toEqual(teamWeek.counts);
    // Chong "xanh gia": moi to hop tinh trang x ky deu co the THAT de doi chieu, va co danh sach nhieu trang
    for (const [focus, period] of focusCases) expect(nonZero.get(`${focus} ${period}`), `${focus} ${period}`).toBeGreaterThan(0);
    expect(multiPage).toBeGreaterThan(5);
  }, 180_000);

  it('truong du lieu theo danh sach cho phep: khong mo ta / email / token; checklist x/y va nguoi nhan dung', async () => {
    const w = await setup();
    await seedCards(w);
    const { u, wsA } = w;
    const scope = await resolveScope(u.leader.id, { kind: 'WORKSPACE', workspaceId: wsA });
    const results = [
      await runQuery({ scope, now: NOW, page: 1 }, q({ intent: 'TEAM_SUMMARY', focus: 'OPEN' })),
      await runQuery({ scope, now: NOW, page: 1 }, q({ intent: 'TEAM_SUMMARY', period: 'THIS_WEEK' })),
      await runQuery({ scope, now: NOW, page: 1 }, q({ intent: 'MY_PRIORITIES' })),
      await runQuery({ scope, now: NOW, page: 1 }, q({ intent: 'TEAM_WORKLOAD' }), { roster: await loadRoster(scope) }),
    ];
    const text = JSON.stringify(results);
    expect(text).not.toContain(SECRET);
    for (const user of Object.values(u)) expect(text).not.toContain(user.email);
    for (const bad of ['passwordHash', 'tokenVersion', 'description', 'email', 'googleId', 'inviteToken', 'avatarUrl']) {
      expect(text).not.toContain(bad);
    }
    const cards = (results[0] as ListResult).cards;
    expect(cards.length).toBeGreaterThan(0);
    const keys = [
      'assignees', 'boardId', 'boardName', 'checklistDone', 'checklistTotal', 'completedAt', 'dueDate', 'id', 'listName',
      'overdue', 'status', 'title',
    ];
    for (const c of cards) expect(Object.keys(c).sort()).toEqual(keys);

    // Doi chieu checklist + nguoi nhan cua tung the voi CSDL
    for (const c of cards) {
      const row = await prisma.card.findUniqueOrThrow({
        where: { id: c.id },
        select: { checklists: { select: { items: { select: { isDone: true } } } }, members: { select: { user: { select: { name: true, deletedAt: true } } } } },
      });
      const items = row.checklists.flatMap((x) => x.items);
      expect([c.checklistDone, c.checklistTotal]).toEqual([items.filter((i) => i.isDone).length, items.length]);
      // tai khoan da xoa khong hien ten
      expect([...c.assignees].sort()).toEqual(row.members.filter((m) => m.user.deletedAt === null).map((m) => m.user.name).sort());
      expect(c.assignees).not.toContain('Tài Khoản Xoá');
      expect(c.overdue).toBe(c.dueDate !== null && new Date(c.dueDate) < NOW);
    }
  });
});

describe('MY_PRIORITIES', () => {
  it('nhan ly do theo moc gio VN, the bi chan tach rieng, viec xong khong tinh', async () => {
    const { u, b } = await setup();
    const tomorrow = vnDayStart(NOW, 1); // 2026-09-30T17:00Z
    const day4 = vnDayStart(NOW, 4); // 2026-10-03T17:00Z
    expect([tomorrow.toISOString(), day4.toISOString()]).toEqual(['2026-09-30T17:00:00.000Z', '2026-10-03T17:00:00.000Z']);
    const mk = (title: string, dueDate: Date | null, status: 'TODO' | 'IN_REVIEW' | 'BLOCKED' | 'DONE' = 'TODO') =>
      prisma.card.create({
        data: {
          listId: b.W.live,
          title,
          status,
          isDone: status === 'DONE',
          completedAt: status === 'DONE' ? at(-H) : null,
          dueDate,
          members: { create: { userId: u.lan.id } },
        },
      });
    await mk('qua han', at(-H));
    await mk('chieu nay', at(2 * H));
    await mk('23:59:59.999 hom nay', new Date(tomorrow.getTime() - 1));
    await mk('00:00 ngay mai', tomorrow, 'IN_REVIEW');
    await mk('cuoi ngay thu 3', new Date(day4.getTime() - 1));
    await mk('00:00 ngay thu 4', day4);
    await mk('khong han', null);
    await mk('bi chan qua han', at(-2 * D), 'BLOCKED');
    await mk('da xong', at(-D), 'DONE');
    await prisma.card.create({ data: { listId: b.W.live, title: 'cua Minh', dueDate: at(-H), members: { create: { userId: u.minh.id } } } });
    // the bi chan cua NGUOI KHAC / chua giao khong duoc vao muc "Cần gỡ chặn" cua Lan
    await prisma.card.create({ data: { listId: b.W.live, title: 'Minh bi chan', status: 'BLOCKED', members: { create: { userId: u.minh.id } } } });
    await prisma.card.create({ data: { listId: b.W.live, title: 'chua giao bi chan', status: 'BLOCKED' } });

    const scope = await resolveScope(u.lan.id, { kind: 'MY' });
    const r = (await runQuery({ scope, now: NOW, page: 1 }, q({ intent: 'MY_PRIORITIES' }))) as ListResult;
    expect(r.counts).toEqual({ total: 7, overdue: 1, dueToday: 2, dueSoon: 2, blocked: 1 });
    expect(r.cards.map((c) => [c.title, c.reason])).toEqual([
      ['qua han', 'OVERDUE'],
      ['chieu nay', 'DUE_TODAY'],
      ['23:59:59.999 hom nay', 'DUE_TODAY'],
      ['00:00 ngay mai', 'DUE_SOON'],
      ['cuoi ngay thu 3', 'DUE_SOON'],
      ['00:00 ngay thu 4', 'LATER'],
      ['khong han', 'LATER'],
    ]);
    expect(r.sections.map((x) => [x.key, x.total, x.cards.map((c) => c.title)])).toEqual([['BLOCKED', 1, ['bi chan qua han']]]);
    expect(r.sections[0].cards[0].reason).toBeUndefined();
  });
});

describe('phan trang', () => {
  it('205 the: tong dung o moi trang, 21 trang khong trung va phu du, trang 22 rong', async () => {
    const { u, b } = await setup();
    const data = Array.from({ length: 205 }, (_, i) => ({
      listId: b.W.live,
      title: `Viec ${i}`,
      dueDate: i % 7 === 0 ? null : at((i % 13) * D - 2 * D), // nhieu the trung han -> thu tu phu thuoc id
    }));
    await prisma.card.createMany({ data });
    const cards = await prisma.card.findMany({ where: { listId: b.W.live }, select: { id: true } });
    await prisma.cardMember.createMany({ data: cards.map((c) => ({ cardId: c.id, userId: u.lan.id })) });

    const scope = await resolveScope(u.lan.id, { kind: 'MY' });
    const query = q({ intent: 'MY_TASKS', focus: 'OPEN' });
    const { first, all } = await allPages((page) => runQuery({ scope, now: NOW, page }, query) as Promise<ListResult>);
    expect(first.total).toBe(205);
    expect(all.map((c) => c.id).sort()).toEqual(cards.map((c) => c.id).sort());
    expect(all.filter((c) => c.dueDate === null)).toHaveLength(30); // 0, 7, ..., 203
    expect(first.counts.overdue).toBe(data.filter((d) => d.dueDate !== null && d.dueDate < NOW).length);
    // Hai lan goi cung trang cho cung thu tu (thu tu on dinh nho id)
    const again = (await runQuery({ scope, now: NOW, page: 7 }, query)) as ListResult;
    const again2 = (await runQuery({ scope, now: NOW, page: 7 }, query)) as ListResult;
    expect(again.cards.map((c) => c.id)).toEqual(again2.cards.map((c) => c.id));
  }, 60_000);
});

describe('TEAM_WORKLOAD', () => {
  it('so the dang mo theo nguoi khop phep dem ngay tho; nguoi ngoai danh sach gop mot dong; ho so chi cho truong nhom', async () => {
    const w = await setup();
    await seedCards(w);
    const { u, b, wsA } = w;
    await prisma.memberWorkProfile.createMany({
      data: [
        { userId: u.lan.id, workspaceId: wsA, maxParallelCards: 3, pausedUntil: at(5 * D) },
        { userId: u.minh.id, workspaceId: wsA, maxParallelCards: 7, pausedUntil: at(-D) }, // da het tam nghi
        // ho so cua An o khong gian KHAC khong duoc lan vao bang cua Nhom A
        { userId: u.an.id, workspaceId: w.wsB, maxParallelCards: 9, pausedUntil: at(3 * D) },
      ],
    });
    const s = await snapshot();

    const check = async (asker: TestUser, input: ChatScopeInput, leader: boolean) => {
      const scope = await resolveScope(asker.id, input);
      expect(scope.isLeader).toBe(leader);
      const roster = await loadRoster(scope);
      const r = (await runQuery({ scope, now: NOW, page: 1 }, q({ intent: 'TEAM_WORKLOAD' }), { roster })) as WorkloadResult;
      const o = oracle(s, asker.id, input);
      const open = o.live.filter((c) => !c.isDone);
      const inRoster = new Set(roster.map((m) => m.userId));
      const tag = `${asker.name} ${JSON.stringify(input)}`;
      expect(r.rows.map((x) => x.userId).sort(), tag).toEqual([...inRoster].sort());
      for (const row of r.rows) {
        expect(row.open, `${tag} ${row.name}`).toBe(open.filter((c) => c.members.includes(row.userId)).length);
        expect(row.overdue, `${tag} ${row.name}`).toBe(open.filter((c) => c.members.includes(row.userId) && o.match(c, 'OVERDUE', null)).length);
      }
      const outside = open.reduce((n, c) => n + c.members.filter((m) => !inRoster.has(m)).length, 0);
      expect(r.outsideAssignments, tag).toBe(outside);
      expect(r.unassignedOpen, tag).toBe(open.filter((c) => c.members.length === 0).length);
      for (let i = 1; i < r.rows.length; i++) {
        const [a, c] = [r.rows[i - 1], r.rows[i]];
        expect(a.open > c.open || (a.open === c.open && a.name.localeCompare(c.name, 'vi') <= 0), tag).toBe(true);
      }
      return r;
    };

    const asLeader = await check(u.leader, { kind: 'WORKSPACE', workspaceId: wsA }, true);
    expect(asLeader.showProfile).toBe(true);
    expect(asLeader.outsideAssignments).toBeGreaterThan(0); // leaver / gone / guest van con CardMember
    const row = (id: string) => asLeader.rows.find((x) => x.userId === id)!;
    expect([row(u.lan.id).capacity, row(u.lan.id).pausedUntil]).toEqual([3, at(5 * D).toISOString()]);
    expect([row(u.minh.id).capacity, row(u.minh.id).pausedUntil]).toEqual([7, null]);
    expect([row(u.an.id).capacity, row(u.an.id).pausedUntil]).toEqual([null, null]);

    const asMember = await check(u.lan, { kind: 'WORKSPACE', workspaceId: wsA }, false);
    expect(asMember.showProfile).toBe(false);
    for (const x of asMember.rows) expect(Object.keys(x).sort()).toEqual(['name', 'open', 'overdue', 'userId']);
    expect(JSON.stringify(asMember)).not.toMatch(/capacity|pausedUntil/);

    // Pham vi bang co khach: khach la mot dong, khong tinh la "ngoai danh sach"
    const board = await check(u.leader, { kind: 'BOARD', boardId: b.G.id }, true);
    expect(board.rows.map((x) => x.userId).sort()).toEqual([u.leader.id, u.guest.id].sort());
  }, 60_000);
});

describe('khop trang Tong quan workspace', () => {
  it('chua xong = tong - da xong; qua han trung nhau; "chua giao, chua xong" <= "chua giao" cua trang Tong quan', async () => {
    const w = await setup();
    await seedCards(w);
    // Tong quan dung dong ho THAT -> them the co han cach xa hom nay de hai ben chac chan cung ket qua
    const now = new Date();
    const far = (days: number) => new Date(now.getTime() + days * D);
    for (const [i, due] of [far(-30), far(-3), far(3), far(30), null].entries()) {
      await prisma.card.create({ data: { listId: w.b.W.live, title: `Gan day ${i}`, dueDate: due } });
    }
    // The cu cua seed co han quanh 30/09/2026 - dua het ra xa de khong phu thuoc ngay chay test
    await prisma.card.updateMany({ where: { title: { startsWith: 'The ' }, dueDate: { not: null } }, data: { dueDate: far(-60) } });
    for (const user of [w.u.leader, w.u.lan, w.u.minh]) {
      const scope = await resolveScope(user.id, { kind: 'WORKSPACE', workspaceId: w.wsA });
      const r = (await runQuery({ scope, now, page: 1 }, q({ intent: 'TEAM_SUMMARY', period: 'THIS_WEEK' }))) as ListResult;
      const ov = await getWorkspaceOverview(user.id, w.wsA, {});
      expect(r.counts.open, user.name).toBe(ov.stats.total - ov.stats.done);
      expect(r.counts.overdue, user.name).toBe(ov.stats.overdue);
      expect(r.counts.unassignedOpen!, user.name).toBeLessThanOrEqual(ov.stats.unassigned);
      expect(scope.boardCount, user.name).toBe(ov.boards.length);
    }
  }, 60_000);
});
