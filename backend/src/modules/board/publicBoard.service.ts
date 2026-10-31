import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { maskDeletedComments, VISIBLE_COMMENT_WHERE } from '../card/commentThread';

// Du lieu cong khai: KHONG BAO GIO tra email (rieng tu) - chi id/ten/anh dai dien.
const PUBLIC_USER_SELECT = { id: true, name: true, avatarUrl: true } as const;

async function assertPublicBoard(boardId: string) {
  const board = await prisma.board.findFirst({
    where: {
      id: boardId,
      deletedAt: null,
      archivedAt: null,
      visibility: 'PUBLIC',
    },
  });
  if (!board) {
    throw new AppError('Khong tim thay bang cong khai nay', 404);
  }
  return board;
}

export async function getPublicBoard(boardId: string) {
  const board = await assertPublicBoard(boardId);
  const workspace = await prisma.workspace.findUnique({
    where: { id: board.workspaceId },
    select: { name: true },
  });
  return {
    id: board.id,
    name: board.name,
    color: board.color,
    backgroundImage: board.backgroundImage,
    workspaceName: workspace?.name ?? '',
  };
}

export async function listPublicBoardLists(boardId: string) {
  await assertPublicBoard(boardId);
  return prisma.list.findMany({
    where: { boardId, deletedAt: null, archivedAt: null },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      position: true,
      cards: {
        where: { deletedAt: null, archivedAt: null },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          title: true,
          isDone: true,
          startDate: true,
          dueDate: true,
          coverColor: true,
          coverImageUrl: true,
          position: true,
          labels: { include: { label: true } },
          members: { select: { userId: true, user: { select: PUBLIC_USER_SELECT } } },
          _count: {
            select: { comments: true, attachments: true, checklists: true },
          },
        },
      },
    },
  });
}

export async function getPublicCard(cardId: string) {
  const found = await prisma.card.findFirst({
    where: { id: cardId, deletedAt: null, archivedAt: null },
    select: { list: { select: { boardId: true, deletedAt: true, archivedAt: true } } },
  });
  // Danh sach chua the da bi xoa/luu tru: coi nhu the khong con doc cong khai duoc
  // nua, du ban than the van "hoat dong" trong DB.
  if (!found || found.list.deletedAt !== null || found.list.archivedAt !== null) {
    throw new AppError('Khong tim thay the', 404);
  }
  await assertPublicBoard(found.list.boardId);

  const card = await prisma.card.findFirst({
    where: { id: cardId, deletedAt: null, archivedAt: null },
    select: {
      id: true,
      title: true,
      description: true,
      isDone: true,
      startDate: true,
      dueDate: true,
      coverColor: true,
      coverImageUrl: true,
      createdAt: true,
      list: { select: { id: true, name: true, boardId: true } },
      members: { select: { userId: true, user: { select: PUBLIC_USER_SELECT } } },
      labels: { include: { label: true } },
      checklists: {
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          title: true,
          position: true,
          items: {
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
            select: {
              id: true,
              content: true,
              isDone: true,
              position: true,
              dueDate: true,
              assignee: { select: PUBLIC_USER_SELECT },
            },
          },
        },
      },
      comments: {
        where: VISIBLE_COMMENT_WHERE,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          parentId: true,
          text: true,
          createdAt: true,
          deletedAt: true,
          user: { select: PUBLIC_USER_SELECT },
        },
      },
      attachments: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          url: true,
          mime: true,
          size: true,
          createdAt: true,
          uploader: { select: PUBLIC_USER_SELECT },
        },
      },
    },
  });
  if (!card) throw new AppError('Khong tim thay the', 404);
  return { ...card, comments: maskDeletedComments(card.comments) };
}
