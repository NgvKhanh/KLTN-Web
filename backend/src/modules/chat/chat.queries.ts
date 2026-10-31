// Truy van du lieu cho tung y dinh (CHATBOT_MODULE.md §6).
//
// - Moi con so dem bang count / groupBy tren TOAN BO tap hop le, khong dem tu danh
//   sach da phan trang.
// - Dieu kien the = AND[the con song trong pham vi (chat.scope), dieu kien tinh trang/ky,
//   dieu kien nguoi] - luon ghep bang AND, khong trai object (ca hai co the mang OR).
// - Truong tra ve theo DANH SACH CHO PHEP (select tuong minh, §6.3): khong mo ta, khong
//   email, khong token. Ket qua o day chi hien cho nguoi hoi, KHONG gui cho LLM.
// - `now` la tham so (khong doc dong ho) de test tat dinh.

import type { Prisma } from '../../generated/prisma/client';
import type { CardStatus } from '../../generated/prisma/enums';
import { prisma } from '../../config/prisma';
import type { ChatFocus, ResolvedQuery } from './chat.intent';
import { PAGE_SIZE, SECTION_SIZE, isFuturePeriod } from './chat.intent';
import type { RosterMember } from './chat.members';
import { periodRange, vnDayStart, type TimeRange } from './chat.period';
import { priorityReason, type PriorityBounds, type PriorityReason } from './chat.priority';
import { liveCardWhere, type ResolvedScope } from './chat.scope';

/** Bang theo nguoi toi da bay nhieu dong (khong gian that nho hon nhieu). */
export const MAX_WORKLOAD_ROWS = 100;

export interface ChatCard {
  id: string;
  title: string;
  boardId: string;
  boardName: string;
  listName: string;
  status: CardStatus;
  dueDate: string | null;
  completedAt: string | null;
  overdue: boolean;
  checklistDone: number;
  checklistTotal: number;
  /** Ten nguoi nhan (tai khoan chua xoa), sap theo ten. */
  assignees: string[];
  /** Chi co o MY_PRIORITIES. */
  reason?: PriorityReason;
}

export interface CardSection {
  key: 'BLOCKED' | 'DONE' | 'OVERDUE';
  total: number;
  cards: ChatCard[];
}

export type CountKey =
  | 'total'
  | 'open'
  | 'overdue'
  | 'blocked'
  | 'doneInPeriod'
  | 'dueInPeriod'
  | 'unassignedOpen'
  | 'dueToday'
  | 'dueSoon';

export interface ListResult {
  kind: 'LIST';
  counts: Partial<Record<CountKey, number>>;
  /** Danh sach chinh (trang hien tai); rong neu y dinh khong co danh sach chinh. */
  cards: ChatCard[];
  /** Tong cua danh sach chinh. */
  total: number;
  page: number;
  sections: CardSection[];
}

export interface WorkloadRow {
  userId: string;
  name: string;
  open: number;
  overdue: number;
  /** Chi co khi nguoi hoi la truong nhom; null = chua khai (mac dinh). */
  capacity?: number | null;
  /** Chi co khi nguoi hoi la truong nhom; null = khong tam nghi (hoac da qua). */
  pausedUntil?: string | null;
}

export interface WorkloadResult {
  kind: 'WORKLOAD';
  rows: WorkloadRow[];
  /** Tong so luot giao (the dang mo) cho nguoi NGOAI danh sach nguoi cua pham vi. */
  outsideAssignments: number;
  unassignedOpen: number;
  showProfile: boolean;
}

export type QueryResult = ListResult | WorkloadResult;

export interface QueryContext {
  scope: ResolvedScope;
  now: Date;
  /** Trang cua danh sach chinh, >= 1. */
  page: number;
}

// ===================== Dieu kien =====================

const CARD_SELECT = {
  id: true,
  title: true,
  status: true,
  dueDate: true,
  completedAt: true,
  isDone: true,
  list: { select: { name: true, board: { select: { id: true, name: true } } } },
  checklists: { select: { items: { select: { isDone: true } } } },
  members: { select: { user: { select: { name: true, deletedAt: true } } } },
} satisfies Prisma.CardSelect;

type CardRow = Prisma.CardGetPayload<{ select: typeof CARD_SELECT }>;

const BY_DUE: Prisma.CardOrderByWithRelationInput[] = [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }];
const BY_COMPLETED: Prisma.CardOrderByWithRelationInput[] = [{ completedAt: 'desc' }, { id: 'asc' }];

function and(...parts: Prisma.CardWhereInput[]): Prisma.CardWhereInput {
  return { AND: parts };
}

function inRange(r: TimeRange): Prisma.DateTimeNullableFilter {
  return { gte: r.from, lt: r.to };
}

/** Dieu kien tinh trang + ky (§5.2). `range` = khoang cua period (null = khong loc ngay). */
function focusWhere(focus: ChatFocus, range: TimeRange | null, now: Date): Prisma.CardWhereInput {
  switch (focus) {
    case 'OPEN':
      return range ? { isDone: false, dueDate: inRange(range) } : { isDone: false };
    case 'DONE':
      // resolveSlots luon cho DONE mot ky; phong ho: thieu ky thi moi viec da xong
      return range ? { isDone: true, completedAt: inRange(range) } : { isDone: true };
    case 'OVERDUE':
      return { isDone: false, dueDate: { lt: now } };
    case 'BLOCKED':
      return { status: 'BLOCKED' };
  }
}

const assignedTo = (userId: string): Prisma.CardWhereInput => ({ members: { some: { userId } } });
const OPEN: Prisma.CardWhereInput = { isDone: false };
const overdueWhere = (now: Date): Prisma.CardWhereInput => ({ isDone: false, dueDate: { lt: now } });

function toCard(c: CardRow, now: Date): ChatCard {
  const items = c.checklists.flatMap((cl) => cl.items);
  return {
    id: c.id,
    title: c.title,
    boardId: c.list.board.id,
    boardName: c.list.board.name,
    listName: c.list.name,
    status: c.status,
    dueDate: c.dueDate ? c.dueDate.toISOString() : null,
    completedAt: c.completedAt ? c.completedAt.toISOString() : null,
    overdue: !c.isDone && c.dueDate !== null && c.dueDate.getTime() < now.getTime(),
    checklistDone: items.filter((i) => i.isDone).length,
    checklistTotal: items.length,
    assignees: c.members
      .filter((m) => m.user.deletedAt === null)
      .map((m) => m.user.name)
      .sort((a, b) => a.localeCompare(b, 'vi')),
  };
}

async function count(where: Prisma.CardWhereInput): Promise<number> {
  return prisma.card.count({ where });
}

async function page(
  where: Prisma.CardWhereInput,
  ctx: QueryContext,
  orderBy: Prisma.CardOrderByWithRelationInput[] = BY_DUE
): Promise<ChatCard[]> {
  const pageNo = Math.max(1, Math.floor(ctx.page));
  const rows = await prisma.card.findMany({
    where,
    select: CARD_SELECT,
    orderBy,
    skip: (pageNo - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  return rows.map((r) => toCard(r, ctx.now));
}

async function section(
  key: CardSection['key'],
  where: Prisma.CardWhereInput,
  now: Date,
  orderBy: Prisma.CardOrderByWithRelationInput[] = BY_DUE
): Promise<CardSection> {
  const [total, rows] = await Promise.all([
    count(where),
    prisma.card.findMany({ where, select: CARD_SELECT, orderBy, take: SECTION_SIZE }),
  ]);
  return { key, total, cards: rows.map((r) => toCard(r, now)) };
}

function rangeOf(q: ResolvedQuery, now: Date): TimeRange | null {
  return q.period ? periodRange(q.period, now) : null;
}

// ===================== Danh sach theo tinh trang (MY_TASKS, MEMBER/TEAM + focus) =====================

async function focusedList(ctx: QueryContext, q: ResolvedQuery, focus: ChatFocus, who: Prisma.CardWhereInput[]): Promise<ListResult> {
  const where = and(liveCardWhere(ctx.scope.boardWhere), ...who, focusWhere(focus, rangeOf(q, ctx.now), ctx.now));
  const [total, overdue, cards] = await Promise.all([
    count(where),
    count(and(where, overdueWhere(ctx.now))),
    page(where, ctx),
  ]);
  return { kind: 'LIST', counts: { total, overdue }, cards, total, page: ctx.page, sections: [] };
}

// ===================== MY_PRIORITIES =====================

async function priorities(ctx: QueryContext): Promise<ListResult> {
  const { now } = ctx;
  const bounds: PriorityBounds = { now, tomorrow: vnDayStart(now, 1), day4: vnDayStart(now, 4) };
  const mineOpen = and(liveCardWhere(ctx.scope.boardWhere), assignedTo(ctx.scope.userId), OPEN);
  const main = and(mineOpen, { status: { not: 'BLOCKED' } });
  const [total, overdue, dueToday, dueSoon, cards, blocked] = await Promise.all([
    count(main),
    count(and(main, { dueDate: { lt: now } })),
    count(and(main, { dueDate: { gte: now, lt: bounds.tomorrow } })),
    count(and(main, { dueDate: { gte: bounds.tomorrow, lt: bounds.day4 } })),
    page(main, ctx),
    section('BLOCKED', and(mineOpen, { status: 'BLOCKED' }), now),
  ]);
  for (const c of cards) c.reason = priorityReason(c.dueDate ? new Date(c.dueDate) : null, bounds);
  return {
    kind: 'LIST',
    counts: { total, overdue, dueToday, dueSoon, blocked: blocked.total },
    cards,
    total,
    page: ctx.page,
    sections: [blocked],
  };
}

// ===================== MEMBER_TASKS tong quan =====================

async function memberOverview(ctx: QueryContext, q: ResolvedQuery, userId: string): Promise<ListResult> {
  const { now } = ctx;
  const mine = and(liveCardWhere(ctx.scope.boardWhere), assignedTo(userId));
  const open = and(mine, OPEN);
  const done = and(mine, focusWhere('DONE', rangeOf(q, now), now));
  const [openTotal, overdue, cards, doneSection] = await Promise.all([
    count(open),
    count(and(mine, overdueWhere(now))),
    page(open, ctx),
    section('DONE', done, now, BY_COMPLETED),
  ]);
  return {
    kind: 'LIST',
    counts: { open: openTotal, overdue, doneInPeriod: doneSection.total },
    cards,
    total: openTotal,
    page: ctx.page,
    sections: [doneSection],
  };
}

// ===================== TEAM_SUMMARY tong quan =====================

async function teamOverview(ctx: QueryContext, q: ResolvedQuery): Promise<ListResult> {
  const { now } = ctx;
  const period = q.period ?? 'THIS_WEEK';
  const range = periodRange(period, now);
  const live = liveCardWhere(ctx.scope.boardWhere);
  const future = isFuturePeriod(period);
  const doneWhere = and(live, { isDone: true, completedAt: inRange(range) });
  const overdue = and(live, overdueWhere(now));
  const blocked = and(live, { status: 'BLOCKED' });

  const [open, dueInPeriod, unassignedOpen, overdueSection, blockedSection, doneSection] = await Promise.all([
    count(and(live, OPEN)),
    count(and(live, OPEN, { dueDate: inRange(range) })),
    count(and(live, OPEN, { members: { none: {} } })),
    section('OVERDUE', overdue, now),
    section('BLOCKED', blocked, now),
    future ? Promise.resolve(null) : section('DONE', doneWhere, now, BY_COMPLETED),
  ]);
  const counts: ListResult['counts'] = {
    open,
    dueInPeriod,
    overdue: overdueSection.total,
    blocked: blockedSection.total,
    unassignedOpen,
  };
  if (doneSection) counts.doneInPeriod = doneSection.total;
  return {
    kind: 'LIST',
    counts,
    cards: [],
    total: 0,
    page: ctx.page,
    sections: [...(doneSection ? [doneSection] : []), overdueSection, blockedSection],
  };
}

// ===================== TEAM_WORKLOAD =====================

async function workload(ctx: QueryContext, roster: readonly RosterMember[]): Promise<WorkloadResult> {
  const { scope, now } = ctx;
  const open = and(liveCardWhere(scope.boardWhere), OPEN);
  const [openBy, overdueBy, unassignedOpen] = await Promise.all([
    prisma.cardMember.groupBy({ by: ['userId'], where: { card: open }, _count: { _all: true } }),
    prisma.cardMember.groupBy({ by: ['userId'], where: { card: and(open, { dueDate: { lt: now } }) }, _count: { _all: true } }),
    count(and(open, { members: { none: {} } })),
  ]);
  const openOf = new Map(openBy.map((g) => [g.userId, g._count._all]));
  const overdueOf = new Map(overdueBy.map((g) => [g.userId, g._count._all]));
  const inRoster = new Set(roster.map((m) => m.userId));
  let outsideAssignments = 0;
  for (const [userId, n] of openOf) if (!inRoster.has(userId)) outsideAssignments += n;

  const showProfile = scope.isLeader && scope.workspace !== null;
  const profiles = showProfile
    ? await prisma.memberWorkProfile.findMany({
        where: { workspaceId: scope.workspace!.id, userId: { in: [...inRoster] } },
        select: { userId: true, maxParallelCards: true, pausedUntil: true },
      })
    : [];
  const profileOf = new Map(profiles.map((p) => [p.userId, p]));

  const rows: WorkloadRow[] = roster.map((m) => {
    const row: WorkloadRow = { userId: m.userId, name: m.name, open: openOf.get(m.userId) ?? 0, overdue: overdueOf.get(m.userId) ?? 0 };
    if (showProfile) {
      const p = profileOf.get(m.userId);
      row.capacity = p ? p.maxParallelCards : null;
      row.pausedUntil = p?.pausedUntil && p.pausedUntil.getTime() > now.getTime() ? p.pausedUntil.toISOString() : null;
    }
    return row;
  });
  rows.sort((a, b) => b.open - a.open || a.name.localeCompare(b.name, 'vi') || (a.userId < b.userId ? -1 : 1));
  return { kind: 'WORKLOAD', rows: rows.slice(0, MAX_WORKLOAD_ROWS), outsideAssignments, unassignedOpen, showProfile };
}

// ===================== Diem vao =====================

/**
 * Chay truy van cho truy van hieu luc `q`. `target` = nguoi da nhan dien (MEMBER_TASKS),
 * `roster` = danh sach nguoi cua pham vi (TEAM_WORKLOAD). Quyen / pham vi da duoc
 * resolveScope kiem truoc; ham nay khong tu quyet dinh hoi lai.
 */
export async function runQuery(
  ctx: QueryContext,
  q: ResolvedQuery,
  opts: { target?: RosterMember | null; roster?: readonly RosterMember[] } = {}
): Promise<QueryResult> {
  switch (q.intent) {
    case 'MY_TASKS':
      return focusedList(ctx, q, q.focus ?? 'OPEN', [assignedTo(ctx.scope.userId)]);
    case 'MY_PRIORITIES':
      return priorities(ctx);
    case 'MEMBER_TASKS': {
      if (!opts.target) throw new Error('MEMBER_TASKS can nguoi da nhan dien');
      return q.focus
        ? focusedList(ctx, q, q.focus, [assignedTo(opts.target.userId)])
        : memberOverview(ctx, q, opts.target.userId);
    }
    case 'TEAM_SUMMARY':
      return q.focus ? focusedList(ctx, q, q.focus, []) : teamOverview(ctx, q);
    case 'TEAM_WORKLOAD':
      return workload(ctx, opts.roster ?? []);
  }
}
