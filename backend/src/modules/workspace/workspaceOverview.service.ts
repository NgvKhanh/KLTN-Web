import { prisma } from '../../config/prisma';
import { assertWorkspaceAccess } from './workspace.service';

const OVERVIEW_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
} as const;

export type OverviewStatusFilter = 'all' | 'overdue' | 'unassigned' | 'done';

export interface WorkspaceOverviewFilters {
  assigneeId?: string;
  status?: OverviewStatusFilter;
}

// Tong hop the tren moi bang cua 1 khong gian: so lieu quá han / chưa giao,
// loc theo nguoi phu trach. Chi tinh tren cac bang nguoi dung xem duoc
// (chu bang / thanh vien bang / bang che do WORKSPACE trong khong gian nay).
export async function getWorkspaceOverview(
  userId: string,
  workspaceId: string,
  filters: WorkspaceOverviewFilters
) {
  await assertWorkspaceAccess(userId, workspaceId);

  const boards = await prisma.board.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      archivedAt: null,
      OR: [
        { ownerId: userId },
        { members: { some: { userId, deletedAt: null } } },
        { visibility: 'WORKSPACE' },
      ],
    },
    select: { id: true, name: true, color: true },
    orderBy: { name: 'asc' },
  });
  const boardIds = boards.map((b) => b.id);

  if (boardIds.length === 0) {
    return {
      boards: [],
      stats: { total: 0, done: 0, overdue: 0, unassigned: 0 },
      cards: [],
    };
  }

  const now = new Date();
  const status = filters.status ?? 'all';

  const baseWhere = {
    deletedAt: null,
    archivedAt: null,
    list: { deletedAt: null, archivedAt: null, boardId: { in: boardIds } },
    ...(filters.assigneeId
      ? { members: { some: { userId: filters.assigneeId } } }
      : {}),
  };

  const [total, done, overdue, unassigned] = await Promise.all([
    prisma.card.count({ where: baseWhere }),
    prisma.card.count({ where: { ...baseWhere, isDone: true } }),
    prisma.card.count({
      where: { ...baseWhere, isDone: false, dueDate: { lt: now } },
    }),
    prisma.card.count({ where: { AND: [baseWhere, { members: { none: {} } }] } }),
  ]);

  const statusWhere =
    status === 'overdue'
      ? { ...baseWhere, isDone: false, dueDate: { lt: now } }
      : status === 'unassigned'
        ? { AND: [baseWhere, { members: { none: {} } }] }
        : status === 'done'
          ? { ...baseWhere, isDone: true }
          : baseWhere;

  const cards = await prisma.card.findMany({
    where: statusWhere,
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    take: 200,
    select: {
      id: true,
      title: true,
      isDone: true,
      dueDate: true,
      coverColor: true,
      list: {
        select: {
          id: true,
          name: true,
          boardId: true,
          board: { select: { id: true, name: true, color: true } },
        },
      },
      labels: { include: { label: true } },
      members: { include: { user: { select: OVERVIEW_USER_SELECT } } },
    },
  });

  return {
    boards,
    stats: { total, done, overdue, unassigned },
    cards,
  };
}
