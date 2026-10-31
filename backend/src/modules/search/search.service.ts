import { prisma } from '../../config/prisma';
import { Prisma } from '../../generated/prisma/client';
import { AppError } from '../../utils/AppError';
import { memberWorkspaceIds } from '../workspace/workspace.service';
import type {
  CreateSavedFilterInput,
  SearchCardsQuery,
} from './search.schema';

// KHONG chon email: ket qua tim kiem co the tra ve the tren bang PUBLIC ma
// nguoi goi khong phai thanh vien (chi la khach xem duoc) - khong duoc lo
// email rieng tu cua thanh vien bang cho nguoi la nhu vay (cung nguyen tac
// voi publicBoard.service.ts).
const SEARCH_USER_SELECT = {
  id: true,
  name: true,
  avatarUrl: true,
} as const;

const PAGE_SIZE = 20;

// Tim the theo nhieu dieu kien ket hop, tren moi bang nguoi dung xem duoc
// (chu bang / thanh vien bang / bang WORKSPACE trong khong gian minh /
// bang PUBLIC), co phan trang.
export async function searchCardsAdvanced(
  userId: string,
  filters: SearchCardsQuery
) {
  const myWorkspaceIds = await memberWorkspaceIds(userId);

  const where: Prisma.CardWhereInput = {
    deletedAt: null,
    archivedAt: null,
    list: {
      deletedAt: null,
      archivedAt: null,
      board: {
        deletedAt: null,
        archivedAt: null,
        OR: [
          { ownerId: userId },
          { members: { some: { userId, deletedAt: null } } },
          { visibility: 'WORKSPACE', workspaceId: { in: myWorkspaceIds } },
          { visibility: 'PUBLIC' },
        ],
      },
    },
  };

  if (filters.q) {
    where.OR = [
      { title: { contains: filters.q, mode: 'insensitive' } },
      { description: { contains: filters.q, mode: 'insensitive' } },
    ];
  }

  if (filters.assignee === 'me') {
    where.members = { some: { userId } };
  } else if (filters.assignee === 'unassigned') {
    where.members = { none: {} };
  }

  if (filters.labelName) {
    where.labels = {
      some: { label: { name: { contains: filters.labelName, mode: 'insensitive' } } },
    };
  }

  if (filters.status === 'active') where.isDone = false;
  if (filters.status === 'done') where.isDone = true;

  // Trang thai cong viec: khop 1 trong cac trang thai da chon (AND voi cac dieu kien khac)
  if (filters.statuses.length > 0) where.status = { in: filters.statuses };

  // "Qua han" ghi de status: mot the qua han luon la chua xong.
  if (filters.overdue) {
    where.isDone = false;
    where.dueDate = { lt: new Date() };
  }
  if (filters.dueFrom || filters.dueTo) {
    where.dueDate = {
      ...(typeof where.dueDate === 'object' ? where.dueDate : {}),
      ...(filters.dueFrom ? { gte: new Date(filters.dueFrom) } : {}),
      ...(filters.dueTo ? { lte: new Date(filters.dueTo) } : {}),
    };
  }

  const page = filters.page;
  const [total, items] = await Promise.all([
    prisma.card.count({ where }),
    prisma.card.findMany({
      where,
      orderBy: [{ dueDate: 'asc' }, { updatedAt: 'desc' }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        title: true,
        status: true,
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
        members: { include: { user: { select: SEARCH_USER_SELECT } } },
      },
    }),
  ]);

  return {
    items,
    page,
    pageSize: PAGE_SIZE,
    total,
    hasMore: page * PAGE_SIZE < total,
  };
}

// ---------- Bo loc da luu ----------

export async function listSavedFilters(userId: string) {
  return prisma.savedFilter.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

// Luu 1 bo loc; trung ten thi ghi de dieu kien cu (thay vi bao loi trung ten).
export async function createSavedFilter(
  userId: string,
  input: CreateSavedFilterInput
) {
  return prisma.savedFilter.upsert({
    where: { userId_name: { userId, name: input.name } },
    create: {
      userId,
      name: input.name,
      params: input.params as Prisma.InputJsonValue,
    },
    update: { params: input.params as Prisma.InputJsonValue },
  });
}

export async function deleteSavedFilter(userId: string, filterId: string) {
  const filter = await prisma.savedFilter.findFirst({
    where: { id: filterId, userId },
    select: { id: true },
  });
  if (!filter) {
    throw new AppError('Khong tim thay bo loc', 404);
  }
  await prisma.savedFilter.delete({ where: { id: filterId } });
}
