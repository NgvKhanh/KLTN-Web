import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import type {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
} from './workspace.schema';

export type WorkspaceRole = 'OWNER' | 'ADMIN' | 'MEMBER';

// ---------- Kiem tra quyen ----------

// CO QUYEN TRUY CAP khong gian: la chu HOAC thanh vien.
export async function assertWorkspaceAccess(
  userId: string,
  workspaceId: string
): Promise<{ workspace: { id: string; ownerId: string; name: string; isPersonal: boolean }; role: WorkspaceRole }> {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, deletedAt: null },
    select: { id: true, ownerId: true, name: true, isPersonal: true },
  });
  if (!workspace) {
    throw new AppError('Khong tim thay khong gian lam viec', 404);
  }
  if (workspace.ownerId === userId) {
    return { workspace, role: 'OWNER' };
  }
  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId, deletedAt: null },
    select: { role: true },
  });
  if (!membership) {
    throw new AppError('Ban khong co quyen truy cap khong gian nay', 403);
  }
  return { workspace, role: membership.role as WorkspaceRole };
}

// CO QUYEN QUAN LY: chu khong gian HOAC ADMIN.
export async function assertWorkspaceManage(
  userId: string,
  workspaceId: string
) {
  const { workspace, role } = await assertWorkspaceAccess(userId, workspaceId);
  if (role === 'MEMBER') {
    throw new AppError('Chi quan tri vien khong gian moi lam duoc thao tac nay', 403);
  }
  return { workspace, role };
}

async function assertWorkspaceOwner(userId: string, workspaceId: string) {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, deletedAt: null },
  });
  if (!workspace) {
    throw new AppError('Khong tim thay khong gian lam viec', 404);
  }
  if (workspace.ownerId !== userId) {
    throw new AppError('Chi chu khong gian moi lam duoc thao tac nay', 403);
  }
  return workspace;
}

// Danh sach id cac khong gian ma nguoi dung la thanh vien (dung o module board)
export async function memberWorkspaceIds(userId: string): Promise<string[]> {
  const rows = await prisma.workspaceMember.findMany({
    where: { userId, deletedAt: null, workspace: { deletedAt: null } },
    select: { workspaceId: true },
  });
  return rows.map((r) => r.workspaceId);
}

export async function isWorkspaceMember(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  return (await workspaceRoleOf(userId, workspaceId)) !== null;
}

// Vai tro cua nguoi dung trong 1 khong gian, hoac null neu khong phai thanh vien.
export async function workspaceRoleOf(
  userId: string,
  workspaceId: string
): Promise<WorkspaceRole | null> {
  const ws = await prisma.workspace.findFirst({
    where: { id: workspaceId, deletedAt: null },
    select: { ownerId: true },
  });
  if (!ws) return null;
  if (ws.ownerId === userId) return 'OWNER';
  const m = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId, deletedAt: null },
    select: { role: true },
  });
  return m ? (m.role as WorkspaceRole) : null;
}

// ---------- Khong gian ca nhan (tao khi dang ky) ----------

export async function createPersonalWorkspace(userId: string, userName: string) {
  const existing = await prisma.workspace.findFirst({
    where: { ownerId: userId, isPersonal: true, deletedAt: null },
  });
  if (existing) return existing;

  return prisma.workspace.create({
    data: {
      ownerId: userId,
      name: `Không gian của ${userName}`,
      isPersonal: true,
      members: { create: { userId, role: 'OWNER' } },
    },
  });
}

// Khong gian ca nhan cua nguoi dung (luon ton tai sau khi dang ky)
export async function getPersonalWorkspaceId(userId: string): Promise<string | null> {
  const ws = await prisma.workspace.findFirst({
    where: { ownerId: userId, isPersonal: true, deletedAt: null },
    select: { id: true },
  });
  return ws?.id ?? null;
}

// ---------- CRUD ----------

const WS_COUNT_SELECT = {
  _count: {
    select: {
      members: { where: { deletedAt: null } },
      boards: { where: { deletedAt: null, archivedAt: null } },
    },
  },
} as const;

export async function listMyWorkspaces(userId: string) {
  const rows = await prisma.workspace.findMany({
    where: {
      deletedAt: null,
      members: { some: { userId, deletedAt: null } },
    },
    orderBy: [{ isPersonal: 'desc' }, { createdAt: 'asc' }],
    include: {
      ...WS_COUNT_SELECT,
      members: { where: { userId, deletedAt: null }, select: { role: true } },
    },
  });

  return rows.map(({ _count, members, ...ws }) => ({
    ...ws,
    myRole: (members[0]?.role ?? 'MEMBER') as WorkspaceRole,
    memberCount: _count.members,
    boardCount: _count.boards,
  }));
}

export async function getWorkspace(userId: string, workspaceId: string) {
  const { role } = await assertWorkspaceAccess(userId, workspaceId);
  const ws = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    include: WS_COUNT_SELECT,
  });
  if (!ws) throw new AppError('Khong tim thay khong gian lam viec', 404);
  const { _count, ...rest } = ws;
  return {
    ...rest,
    myRole: role,
    memberCount: _count.members,
    boardCount: _count.boards,
  };
}

export async function createWorkspace(
  userId: string,
  input: CreateWorkspaceInput
) {
  return prisma.workspace.create({
    data: {
      ownerId: userId,
      name: input.name,
      members: { create: { userId, role: 'OWNER' } },
    },
  });
}

export async function updateWorkspace(
  userId: string,
  workspaceId: string,
  input: UpdateWorkspaceInput
) {
  await assertWorkspaceManage(userId, workspaceId);
  return prisma.workspace.update({
    where: { id: workspaceId },
    data: { ...(input.name !== undefined ? { name: input.name } : {}) },
  });
}

export async function deleteWorkspace(userId: string, workspaceId: string) {
  const workspace = await assertWorkspaceOwner(userId, workspaceId);
  if (workspace.isPersonal) {
    throw new AppError('Khong the xoa khong gian ca nhan', 400);
  }

  const boardCount = await prisma.board.count({
    where: { workspaceId, deletedAt: null },
  });
  if (boardCount > 0) {
    throw new AppError(
      'Khong gian van con bang. Hay chuyen hoac xoa het bang truoc khi xoa khong gian.',
      400
    );
  }

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { deletedAt: new Date() },
  });
}
