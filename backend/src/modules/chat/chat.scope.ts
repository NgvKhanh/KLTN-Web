// Pham vi + quyen doc cua chatbot (CHATBOT_MODULE.md §6.1, §7, §8.1).
//
// Moi luot hoi deu goi lai resolveScope: quyen doc lai tu CSDL, khong tin phien hay
// client. Client khong bao gio gui vai tro / danh tinh.
//
// "Bang doc duoc" (§7.1) = chu bang | BoardMember (ke ca VIEWER) | bang WORKSPACE thuoc
// khong gian minh dang la thanh vien. KHONG tinh bang PUBLIC chi vi no cong khai, va
// KHONG dung assertBoardView (co nhanh PUBLIC) hay isBoardParticipant (loai VIEWER).
// Dieu kien sao y phep OR cua listMyCards (card.service.ts).

import type { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { assertWorkspaceAccess, memberWorkspaceIds, workspaceRoleOf } from '../workspace/workspace.service';
import type { RosterMember } from './chat.members';

export type ChatScopeInput =
  | { kind: 'MY' }
  | { kind: 'WORKSPACE'; workspaceId: string }
  | { kind: 'BOARD'; boardId: string };

export interface ScopeWorkspace {
  id: string;
  name: string;
  isPersonal: boolean;
}

export interface ResolvedScope {
  kind: ChatScopeInput['kind'];
  userId: string;
  /** WORKSPACE: chinh no; BOARD: khong gian cua bang; MY: null. */
  workspace: ScopeWorkspace | null;
  board: { id: string; name: string; visibility: string; ownerId: string } | null;
  /** OWNER/ADMIN cua `workspace` (§7.3). Tinh lai moi luot; MY luon false. */
  isLeader: boolean;
  /** Dieu kien bang = doc duoc AND thuoc pham vi. */
  boardWhere: Prisma.BoardWhereInput;
  /** So bang doc duoc trong pham vi - cho dong "Tinh tren N bang ban xem duoc". */
  boardCount: number;
}

export function readableBoardWhere(userId: string, myWorkspaceIds: string[]): Prisma.BoardWhereInput {
  return {
    deletedAt: null,
    archivedAt: null,
    OR: [
      { ownerId: userId },
      { members: { some: { userId, deletedAt: null } } },
      { visibility: 'WORKSPACE', workspaceId: { in: myWorkspaceIds } },
    ],
  };
}

/**
 * The "con song" trong cac bang thoa `boardWhere` (§6.1): the, danh sach, bang deu chua
 * xoa / chua luu tru. Ghep them dieu kien the bang AND o noi goi, khong trai object.
 */
export function liveCardWhere(boardWhere: Prisma.BoardWhereInput): Prisma.CardWhereInput {
  return {
    deletedAt: null,
    archivedAt: null,
    list: { deletedAt: null, archivedAt: null, board: boardWhere },
  };
}

function isLeaderRole(role: string | null): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export async function resolveScope(userId: string, input: ChatScopeInput): Promise<ResolvedScope> {
  const wsIds = await memberWorkspaceIds(userId);
  const readable = readableBoardWhere(userId, wsIds);

  let workspace: ScopeWorkspace | null = null;
  let board: ResolvedScope['board'] = null;
  let isLeader = false;
  let boardWhere: Prisma.BoardWhereInput = readable;

  if (input.kind === 'WORKSPACE') {
    // 404 neu khong ton tai, 403 neu khong phai thanh vien
    const access = await assertWorkspaceAccess(userId, input.workspaceId);
    workspace = { id: access.workspace.id, name: access.workspace.name, isPersonal: access.workspace.isPersonal };
    isLeader = isLeaderRole(access.role);
    boardWhere = { AND: [readable, { workspaceId: input.workspaceId }] };
  } else if (input.kind === 'BOARD') {
    const found = await prisma.board.findFirst({
      where: { id: input.boardId, deletedAt: null, archivedAt: null },
      select: {
        id: true,
        name: true,
        visibility: true,
        ownerId: true,
        workspace: { select: { id: true, name: true, isPersonal: true } },
      },
    });
    if (!found) throw new AppError('Khong tim thay bang', 404);
    const canRead = await prisma.board.count({ where: { AND: [readable, { id: found.id }] } });
    // Bang PUBLIC (hoac PRIVATE) ma minh khong tham gia: tro ly khong doc
    if (canRead === 0) throw new AppError('Tro ly chi ho tro bang ban tham gia', 403);
    board = { id: found.id, name: found.name, visibility: found.visibility, ownerId: found.ownerId };
    workspace = found.workspace;
    // Quan tri vien CUA BANG khong phai truong nhom: chi xet vai tro trong khong gian
    isLeader = isLeaderRole(await workspaceRoleOf(userId, found.workspace.id));
    boardWhere = { AND: [readable, { id: found.id }] };
  }

  const boardCount = await prisma.board.count({ where: boardWhere });
  return { kind: input.kind, userId, workspace, board, isLeader, boardWhere, boardCount };
}

async function activeUsers(ids: Iterable<string>): Promise<RosterMember[]> {
  const rows = await prisma.user.findMany({
    where: { id: { in: [...new Set(ids)] }, deletedAt: null },
    select: { id: true, name: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
  return rows.map((u) => ({ userId: u.id, name: u.name }));
}

/** Chu + thanh vien HIEN TAI cua khong gian (khong gian chua xoa). */
async function workspacePeople(workspaceId: string): Promise<string[]> {
  const ws = await prisma.workspace.findFirst({
    where: { id: workspaceId, deletedAt: null },
    select: { ownerId: true, members: { where: { deletedAt: null }, select: { userId: true } } },
  });
  return ws ? [ws.ownerId, ...ws.members.map((m) => m.userId)] : [];
}

/**
 * Danh sach nguoi cua pham vi (§8.1) - chi o server, KHONG gui cho LLM.
 * - WORKSPACE: chu + thanh vien hien tai cua khong gian.
 * - BOARD: chu bang + BoardMember hien tai (ke ca VIEWER, ke ca khach khong o khong gian)
 *   + (bang WORKSPACE) chu + thanh vien khong gian.
 * - MY: rong (hoi ve nguoi khac o pham vi ca nhan -> hoi lai chon khong gian).
 * Bo tai khoan da xoa. Nguoi da roi khong gian / bang khong con trong danh sach.
 */
export async function loadRoster(scope: ResolvedScope): Promise<RosterMember[]> {
  if (scope.workspace === null) return []; // pham vi MY
  if (scope.kind === 'WORKSPACE') return activeUsers(await workspacePeople(scope.workspace.id));

  const board = scope.board;
  if (!board) return [];
  const members = await prisma.boardMember.findMany({
    where: { boardId: board.id, deletedAt: null },
    select: { userId: true },
  });
  const ids = [board.ownerId, ...members.map((m) => m.userId)];
  if (board.visibility === 'WORKSPACE') ids.push(...(await workspacePeople(scope.workspace.id)));
  return activeUsers(ids);
}

/**
 * Danh sach nguoi dung de NHAN DIEN ten o pham vi MY: chu + thanh vien hien tai cua MOI khong
 * gian nguoi hoi dang tham gia. Chi de bo luat biet "Lan" la ten nguoi roi hoi lai chon khong
 * gian (§7.2) - truy van that van chi dung danh sach cua khong gian duoc chon. Chi o server.
 */
export async function loadMyRoster(userId: string): Promise<RosterMember[]> {
  const wsIds = await memberWorkspaceIds(userId);
  const people = await Promise.all(wsIds.map((id) => workspacePeople(id)));
  return activeUsers(people.flat());
}

/** Lua chon khi hoi lai "Ban muon xem trong workspace nao?" (§7.2): khong gian nhom truoc, ca nhan sau. */
export async function listChoosableWorkspaces(userId: string): Promise<ScopeWorkspace[]> {
  const ids = await memberWorkspaceIds(userId);
  return prisma.workspace.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, name: true, isPersonal: true },
    orderBy: [{ isPersonal: 'asc' }, { name: 'asc' }, { id: 'asc' }],
  });
}
