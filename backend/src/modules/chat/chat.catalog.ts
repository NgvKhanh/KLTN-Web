// Danh muc truy van (CHATBOT_MODULE.md §18): nap danh muc TEN theo pham vi + 4 truy van chi doc.
//
// - Danh muc ten (bang / khong gian / cot) chi de bo luat va buoc nhan dien o server thay; KHONG gui LLM.
// - Moi truy van di qua boardWhere cua resolveScope (bang doc duoc, §7.1) - khong tu dat lai quyen.
// - So dem bang count / groupBy tren TOAN BO tap hop le; bang ket qua toi da MAX_TABLE_ROWS dong.
// - Chi tra ten va vai tro - khong email, khong id nguoi, khong mo ta (§18.3).
// - Khong doc dong ho, khong ghi log noi dung.

import type { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../config/prisma';
import { memberWorkspaceIds } from '../workspace/workspace.service';
import type { ChatAnswer, ScopeInfo } from './chat.answer';
import { renderCatalog, renderClarifyTarget, renderTargetNotFound, type TargetOption } from './chat.catalog.answer';
import { resolveCatalogQuestion, targetLabel, targetName, targetId, type CatalogTarget } from './chat.catalog.resolve';
import { MAX_BOARDS, MAX_COLUMNS, MAX_WORKSPACES, type ColumnEntity, type EntityCatalog, type NamedEntity } from './chat.entities';
import type { CatalogIntent, CatalogQuestion } from './chat.intent';
import { listChoosableWorkspaces, type ResolvedScope } from './chat.scope';

/** Bang ket qua toi da bay nhieu dong (khong phan trang). */
export const MAX_TABLE_ROWS = 100;

export type BoardRoleCode = 'OWNER' | 'ADMIN' | 'MEMBER' | 'VIEWER';
export type WorkspaceRoleCode = 'OWNER' | 'ADMIN' | 'MEMBER';

export type { CatalogTarget };

/** Truy van danh muc da nhan dien ten (do chat.catalog.answerCatalog dung tu cau hoi). */
export interface ResolvedCatalogQuery {
  intent: CatalogIntent;
  /** Bang / khong gian da nhan dien; null = dung pham vi. */
  target: CatalogTarget | null;
  /** CARD_COUNTS: cac cot khop ten da go; null = khong loc cot. */
  columns: ColumnEntity[] | null;
}

// ===================== Ket qua =====================

export interface BoardRow {
  id: string;
  name: string;
  workspaceName: string;
  /** Vai tro cua nguoi hoi tren bang; null = chi xem duoc nho hien thi WORKSPACE. */
  myRole: BoardRoleCode | null;
}
export interface BoardsResult {
  kind: 'BOARDS';
  total: number;
  /** So bang tham gia truc tiep (chu bang hoac BoardMember hien tai). */
  direct: number;
  rows: BoardRow[];
  /** Ten khong gian dang loc (bang cua rieng khong gian do), null = khong loc. */
  workspaceName: string | null;
}

export interface WorkspaceRow {
  id: string;
  name: string;
  isPersonal: boolean;
  myRole: WorkspaceRoleCode;
  boards: number;
  members: number;
}
export interface WorkspacesResult {
  kind: 'WORKSPACES';
  rows: WorkspaceRow[];
}

export interface PersonRow {
  name: string;
  role: BoardRoleCode | WorkspaceRoleCode;
}
export interface MembersResult {
  kind: 'MEMBERS';
  subject: { type: 'BOARD' | 'WORKSPACE'; name: string; workspaceName: string | null };
  total: number;
  rows: PersonRow[];
  /** Bang hien thi WORKSPACE: so nguoi cua khong gian cung xem duoc (null neu khong phai). */
  workspaceWide: { workspaceName: string; people: number } | null;
}

export interface CountRow {
  label: string;
  boardId?: string;
  workspaceName?: string;
  open: number;
  done: number;
}
export interface CountsResult {
  kind: 'COUNTS';
  mode: 'BY_COLUMN' | 'BY_BOARD';
  /** BY_COLUMN: ten bang; BY_BOARD voi `target` khong gian: ten khong gian; con lai null. */
  subject: string | null;
  /** So cot khop ten da go (>= 1); null = khong loc cot. */
  columnFilter: { matched: number } | null;
  rows: CountRow[];
  total: number;
  open: number;
  done: number;
}

export type CatalogResult = BoardsResult | WorkspacesResult | MembersResult | CountsResult;

// ===================== Danh muc ten =====================

async function workspacesOfScope(scope: ResolvedScope): Promise<NamedEntity[]> {
  if (scope.kind === 'MY') {
    const ws = await listChoosableWorkspaces(scope.userId);
    return ws.slice(0, MAX_WORKSPACES).map((w) => ({ id: w.id, name: w.name }));
  }
  return scope.workspace ? [{ id: scope.workspace.id, name: scope.workspace.name }] : [];
}

/**
 * Danh muc ten cua pham vi: bang doc duoc, khong gian dang la thanh vien (pham vi WORKSPACE / BOARD: chi khong gian
 * cua pham vi), cot cua cac bang do. Chi de nhan dien o server - khong gui LLM.
 */
export async function loadCatalog(scope: ResolvedScope): Promise<EntityCatalog> {
  const [boards, lists, workspaces] = await Promise.all([
    prisma.board.findMany({
      where: scope.boardWhere,
      select: { id: true, name: true, workspaceId: true, workspace: { select: { name: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: MAX_BOARDS,
    }),
    prisma.list.findMany({
      where: { deletedAt: null, archivedAt: null, board: scope.boardWhere },
      select: { id: true, name: true, boardId: true },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      take: MAX_COLUMNS,
    }),
    workspacesOfScope(scope),
  ]);
  return {
    boards: boards.map((b) => ({ id: b.id, name: b.name, workspaceId: b.workspaceId, workspaceName: b.workspace.name })),
    workspaces,
    columns: lists.map((l) => ({ id: l.id, name: l.name, boardId: l.boardId })),
  };
}

// ===================== MY_BOARDS =====================

async function myBoards(scope: ResolvedScope, target: CatalogTarget | null): Promise<BoardsResult> {
  // Loc theo khong gian chi co nghia o pham vi MY (o pham vi khac, pham vi da hep san)
  const filter = scope.kind === 'MY' && target?.type === 'WORKSPACE' ? target.workspace : null;
  const where: Prisma.BoardWhereInput = filter ? { AND: [scope.boardWhere, { workspaceId: filter.id }] } : scope.boardWhere;
  const direct: Prisma.BoardWhereInput = {
    AND: [where, { OR: [{ ownerId: scope.userId }, { members: { some: { userId: scope.userId, deletedAt: null } } }] }],
  };
  const [total, directCount, rows] = await Promise.all([
    prisma.board.count({ where }),
    prisma.board.count({ where: direct }),
    prisma.board.findMany({
      where,
      select: {
        id: true,
        name: true,
        ownerId: true,
        workspace: { select: { name: true } },
        members: { where: { userId: scope.userId, deletedAt: null }, select: { role: true } },
      },
      orderBy: [{ workspace: { name: 'asc' } }, { name: 'asc' }, { id: 'asc' }],
      take: MAX_TABLE_ROWS,
    }),
  ]);
  return {
    kind: 'BOARDS',
    total,
    direct: directCount,
    workspaceName: filter?.name ?? null,
    rows: rows.map((b) => ({
      id: b.id,
      name: b.name,
      workspaceName: b.workspace.name,
      myRole: b.ownerId === scope.userId ? 'OWNER' : ((b.members[0]?.role as BoardRoleCode | undefined) ?? null),
    })),
  };
}

// ===================== MY_WORKSPACES =====================

async function myWorkspaces(scope: ResolvedScope): Promise<WorkspacesResult> {
  const ids = scope.kind === 'MY' ? await memberWorkspaceIds(scope.userId) : scope.workspace ? [scope.workspace.id] : [];
  const mine = await prisma.workspaceMember.findMany({
    where: { userId: scope.userId, deletedAt: null, workspaceId: { in: ids }, workspace: { deletedAt: null } },
    select: { role: true, workspace: { select: { id: true, name: true, isPersonal: true } } },
    take: MAX_WORKSPACES,
  });
  const wsIds = mine.map((m) => m.workspace.id);
  const [boardGroups, people] = await Promise.all([
    prisma.board.groupBy({
      by: ['workspaceId'],
      where: { AND: [scope.boardWhere, { workspaceId: { in: wsIds } }] },
      _count: { _all: true },
    }),
    prisma.workspace.findMany({
      where: { id: { in: wsIds } },
      select: {
        id: true,
        ownerId: true,
        owner: { select: { deletedAt: true } },
        members: { where: { deletedAt: null, user: { deletedAt: null } }, select: { userId: true } },
      },
    }),
  ]);
  const boardsOf = new Map(boardGroups.map((g) => [g.workspaceId, g._count._all]));
  const membersOf = new Map(
    people.map((w) => [w.id, new Set([...(w.owner.deletedAt === null ? [w.ownerId] : []), ...w.members.map((m) => m.userId)]).size])
  );
  const rows: WorkspaceRow[] = mine.map((m) => ({
    id: m.workspace.id,
    name: m.workspace.name,
    isPersonal: m.workspace.isPersonal,
    myRole: m.role as WorkspaceRoleCode,
    boards: boardsOf.get(m.workspace.id) ?? 0,
    members: membersOf.get(m.workspace.id) ?? 0,
  }));
  // Khong gian nhom truoc, ca nhan sau; roi theo ten
  rows.sort((a, b) => Number(a.isPersonal) - Number(b.isPersonal) || a.name.localeCompare(b.name, 'vi') || (a.id < b.id ? -1 : 1));
  return { kind: 'WORKSPACES', rows };
}

// ===================== MEMBER_LIST =====================

const ROLE_RANK: Record<string, number> = { OWNER: 0, ADMIN: 1, MEMBER: 2, VIEWER: 3 };

function sortPeople(rows: PersonRow[]): PersonRow[] {
  return rows.sort((a, b) => (ROLE_RANK[a.role] ?? 9) - (ROLE_RANK[b.role] ?? 9) || a.name.localeCompare(b.name, 'vi'));
}

async function workspacePeopleCount(workspaceId: string): Promise<number> {
  const ws = await prisma.workspace.findFirst({
    where: { id: workspaceId, deletedAt: null },
    select: {
      ownerId: true,
      owner: { select: { deletedAt: true } },
      members: { where: { deletedAt: null, user: { deletedAt: null } }, select: { userId: true } },
    },
  });
  if (!ws) return 0;
  return new Set([...(ws.owner.deletedAt === null ? [ws.ownerId] : []), ...ws.members.map((m) => m.userId)]).size;
}

async function memberList(target: CatalogTarget): Promise<MembersResult> {
  if (target.type === 'BOARD') {
    const b = await prisma.board.findFirst({
      where: { id: target.board.id, deletedAt: null, archivedAt: null },
      select: {
        ownerId: true,
        visibility: true,
        workspaceId: true,
        owner: { select: { name: true, deletedAt: true } },
        workspace: { select: { name: true } },
        members: { where: { deletedAt: null, user: { deletedAt: null } }, select: { userId: true, role: true, user: { select: { name: true } } } },
      },
    });
    const rows: PersonRow[] = [];
    const seen = new Set<string>();
    if (b) {
      if (b.owner.deletedAt === null) {
        rows.push({ name: b.owner.name, role: 'OWNER' });
        seen.add(b.ownerId);
      }
      for (const m of b.members) {
        if (seen.has(m.userId)) continue;
        seen.add(m.userId);
        rows.push({ name: m.user.name, role: m.role as BoardRoleCode });
      }
    }
    sortPeople(rows);
    return {
      kind: 'MEMBERS',
      subject: { type: 'BOARD', name: target.board.name, workspaceName: target.board.workspaceName },
      total: rows.length,
      rows: rows.slice(0, MAX_TABLE_ROWS),
      workspaceWide:
        b && b.visibility === 'WORKSPACE' ? { workspaceName: b.workspace.name, people: await workspacePeopleCount(b.workspaceId) } : null,
    };
  }
  const ws = await prisma.workspace.findFirst({
    where: { id: target.workspace.id, deletedAt: null },
    select: {
      ownerId: true,
      owner: { select: { name: true, deletedAt: true } },
      members: { where: { deletedAt: null, user: { deletedAt: null } }, select: { userId: true, role: true, user: { select: { name: true } } } },
    },
  });
  const rows: PersonRow[] = [];
  const seen = new Set<string>();
  if (ws) {
    for (const m of ws.members) {
      seen.add(m.userId);
      rows.push({ name: m.user.name, role: m.role as WorkspaceRoleCode });
    }
    // Du lieu cu co the thieu dong thanh vien cua CHU (scope test): chu van la thanh vien
    if (!seen.has(ws.ownerId) && ws.owner.deletedAt === null) rows.push({ name: ws.owner.name, role: 'OWNER' });
  }
  sortPeople(rows);
  return {
    kind: 'MEMBERS',
    subject: { type: 'WORKSPACE', name: target.workspace.name, workspaceName: null },
    total: rows.length,
    rows: rows.slice(0, MAX_TABLE_ROWS),
    workspaceWide: null,
  };
}

// ===================== CARD_COUNTS =====================

async function cardCounts(scope: ResolvedScope, target: CatalogTarget | null, columns: ColumnEntity[] | null): Promise<CountsResult> {
  const boardTarget: { id: string; name: string } | null =
    target?.type === 'BOARD' ? target.board : scope.kind === 'BOARD' && scope.board ? { id: scope.board.id, name: scope.board.name } : null;
  const wsTarget = target?.type === 'WORKSPACE' ? target.workspace : null;
  const boardsWhere: Prisma.BoardWhereInput = boardTarget
    ? { AND: [scope.boardWhere, { id: boardTarget.id }] }
    : wsTarget
      ? { AND: [scope.boardWhere, { workspaceId: wsTarget.id }] }
      : scope.boardWhere;
  const columnIds = columns === null ? null : columns.map((c) => c.id);

  const lists = await prisma.list.findMany({
    where: { deletedAt: null, archivedAt: null, board: boardsWhere, ...(columnIds === null ? {} : { id: { in: columnIds } }) },
    select: { id: true, name: true, boardId: true, board: { select: { name: true, workspace: { select: { name: true } } } } },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    take: MAX_COLUMNS,
  });
  const groups =
    lists.length === 0
      ? []
      : await prisma.card.groupBy({
          by: ['listId', 'isDone'],
          where: { deletedAt: null, archivedAt: null, listId: { in: lists.map((l) => l.id) } },
          _count: { _all: true },
        });
  const perList = new Map<string, { open: number; done: number }>();
  for (const g of groups) {
    const cur = perList.get(g.listId) ?? { open: 0, done: 0 };
    if (g.isDone) cur.done += g._count._all;
    else cur.open += g._count._all;
    perList.set(g.listId, cur);
  }
  const of = (listId: string) => perList.get(listId) ?? { open: 0, done: 0 };
  const columnFilter = columns === null ? null : { matched: lists.length };

  let rows: CountRow[];
  if (boardTarget) {
    rows = lists.map((l) => ({ label: l.name, ...of(l.id) }));
  } else {
    const boards = await prisma.board.findMany({
      where: boardsWhere,
      select: { id: true, name: true, workspace: { select: { name: true } } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: MAX_BOARDS,
    });
    const sums = new Map<string, { open: number; done: number }>();
    for (const l of lists) {
      const cur = sums.get(l.boardId) ?? { open: 0, done: 0 };
      cur.open += of(l.id).open;
      cur.done += of(l.id).done;
      sums.set(l.boardId, cur);
    }
    rows = boards
      // loc cot: chi bang co cot khop; khong loc: moi bang (ke ca bang chua co the)
      .filter((b) => columns === null || lists.some((l) => l.boardId === b.id))
      .map((b) => ({ label: b.name, boardId: b.id, workspaceName: b.workspace.name, ...(sums.get(b.id) ?? { open: 0, done: 0 }) }));
    // nhieu the nhat truoc; hoa ten cho on dinh
    rows.sort((a, b) => b.open + b.done - (a.open + a.done) || a.label.localeCompare(b.label, 'vi') || (a.boardId! < b.boardId! ? -1 : 1));
  }
  const open = rows.reduce((n, r) => n + r.open, 0);
  const done = rows.reduce((n, r) => n + r.done, 0);
  return {
    kind: 'COUNTS',
    mode: boardTarget ? 'BY_COLUMN' : 'BY_BOARD',
    subject: boardTarget ? boardTarget.name : wsTarget ? wsTarget.name : null,
    columnFilter,
    rows: rows.slice(0, MAX_TABLE_ROWS),
    total: rows.length,
    open,
    done,
  };
}

// ===================== Diem vao =====================

/**
 * Chay mot dong cua danh muc. Quyen / pham vi da duoc resolveScope kiem truoc; `q.target` va `q.columns` da nhan dien
 * TRONG danh muc cua pham vi (nen chi la bang / khong gian / cot doc duoc). Ham nay khong tu quyet dinh hoi lai.
 */
export async function runCatalog(scope: ResolvedScope, q: ResolvedCatalogQuery): Promise<CatalogResult> {
  switch (q.intent) {
    case 'MY_BOARDS':
      return myBoards(scope, q.target);
    case 'MY_WORKSPACES':
      return myWorkspaces(scope);
    case 'MEMBER_LIST': {
      if (!q.target) throw new Error('MEMBER_LIST can bang hoac khong gian da nhan dien');
      return memberList(q.target);
    }
    case 'CARD_COUNTS':
      return cardCounts(scope, q.target, q.columns);
  }
}

// ===================== Dieu phoi mot cau hoi danh muc =====================

export interface CatalogOutcome {
  answer: ChatAnswer;
  /** Ten bang / khong gian DA nhan dien (tu danh muc), khong phai chuoi go. */
  targetName: string | null;
  /** Ten cot da nhan dien. */
  columnName: string | null;
  /** Nhieu bang / khong gian khop ten go: id cac lua chon dang cho nguoi dung bam (dich vu dat vao phien). */
  pendingTargets: string[] | null;
}

/**
 * Tra loi mot cau hoi danh muc trong pham vi da kiem quyen (§18): nhan dien ten TRONG danh muc cua pham vi (chat.catalog.resolve),
 * chay truy van, dung cau tra loi theo mau. Khong doc / ghi phien: dich vu dat `pending` khi `pendingTargets` khac null.
 */
export async function answerCatalog(
  scope: ResolvedScope,
  info: ScopeInfo,
  question: CatalogQuestion,
  now: Date,
  catalog?: EntityCatalog
): Promise<CatalogOutcome> {
  const cat = catalog ?? (await loadCatalog(scope));
  const res = resolveCatalogQuestion(scope, question, cat);
  const done = (answer: ChatAnswer, target: string | null, column: string | null): CatalogOutcome => ({ answer, targetName: target, columnName: column, pendingTargets: null });

  if (res.kind === 'NOT_FOUND') return done(renderTargetNotFound(res.typed, res.what, info, now), res.targetName, null);
  if (res.kind === 'CLARIFY') {
    const options: TargetOption[] = res.refs.map((x) => ({ id: targetId(x), label: targetLabel(x) }));
    return { answer: renderClarifyTarget(res.typed, options, info, now), targetName: null, columnName: null, pendingTargets: options.map((o) => o.id) };
  }
  const result = await runCatalog(scope, { intent: question.intent, target: res.target, columns: res.columns });
  const answer = renderCatalog({ intent: question.intent, result, scope: info, now, columnLabel: res.columnName, notes: res.notes });
  return done(answer, res.target ? targetName(res.target) : null, res.columnName);
}
