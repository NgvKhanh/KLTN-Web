import { prisma } from '../../config/prisma';
import { emitToBoard } from '../../realtime/socket';
import { AppError } from '../../utils/AppError';
import { assertBoardAccess } from '../board/board.service';
import { runAutomationsForCard } from '../automation/automation.service';
import { assertCardAccess } from './card.service';
import { assertListAccess } from '../list/list.service';
import { logActivity } from '../activity/activity.service';
import { initialStatusData } from './cardStatus';

interface ChecklistInput {
  title: string;
  items?: string[];
}

const TEMPLATE_INCLUDE = {
  checklists: {
    orderBy: { position: 'asc' as const },
    include: { items: { orderBy: { position: 'asc' as const } } },
  },
};

export async function listCardTemplates(userId: string, boardId: string) {
  await assertBoardAccess(userId, boardId);
  return prisma.cardTemplate.findMany({
    where: { boardId },
    orderBy: { createdAt: 'desc' },
    include: TEMPLATE_INCLUDE,
  });
}

export async function createCardTemplate(
  userId: string,
  boardId: string,
  input: { name: string; description?: string; checklists?: ChecklistInput[] }
) {
  await assertBoardAccess(userId, boardId);
  return prisma.cardTemplate.create({
    data: {
      boardId,
      name: input.name,
      description: input.description ?? null,
      checklists: input.checklists
        ? {
            create: input.checklists.map((cl, i) => ({
              title: cl.title,
              position: i,
              items: {
                create: (cl.items ?? []).map((content, j) => ({
                  content,
                  position: j,
                })),
              },
            })),
          }
        : undefined,
    },
    include: TEMPLATE_INCLUDE,
  });
}

// Chup 1 the dang co (tieu de/mo ta/checklist) thanh mau, luu vao bang chua no.
export async function saveCardAsTemplate(
  userId: string,
  cardId: string,
  name?: string
) {
  const card = await assertCardAccess(userId, cardId);
  const full = await prisma.card.findUnique({
    where: { id: cardId },
    include: {
      checklists: {
        orderBy: { position: 'asc' },
        include: { items: { orderBy: { position: 'asc' } } },
      },
    },
  });
  if (!full) throw new AppError('Khong tim thay the', 404);

  return prisma.cardTemplate.create({
    data: {
      boardId: card.list.boardId,
      name: name?.trim() || full.title,
      description: full.description,
      checklists: {
        create: full.checklists.map((cl, i) => ({
          title: cl.title,
          position: i,
          items: {
            create: cl.items.map((it, j) => ({
              content: it.content,
              position: j,
            })),
          },
        })),
      },
    },
    include: TEMPLATE_INCLUDE,
  });
}

async function templateOrThrow(templateId: string) {
  const tpl = await prisma.cardTemplate.findUnique({
    where: { id: templateId },
    include: TEMPLATE_INCLUDE,
  });
  if (!tpl) throw new AppError('Khong tim thay mau the nay', 404);
  return tpl;
}

export async function deleteCardTemplate(userId: string, templateId: string) {
  const tpl = await templateOrThrow(templateId);
  await assertBoardAccess(userId, tpl.boardId);
  await prisma.cardTemplate.delete({ where: { id: templateId } });
}

// Tao 1 the moi trong 1 danh sach tu mau da luu.
export async function applyCardTemplate(
  userId: string,
  listId: string,
  templateId: string,
  title?: string
) {
  const list = await assertListAccess(userId, listId);
  const tpl = await templateOrThrow(templateId);
  if (tpl.boardId !== list.boardId) {
    throw new AppError('Mau the khong thuoc bang nay', 400);
  }

  const last = await prisma.card.findFirst({
    where: { listId, deletedAt: null, archivedAt: null },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const card = await prisma.card.create({
    data: {
      listId,
      title: (title?.trim() || tpl.name).slice(0, 500),
      description: tpl.description,
      position: last ? last.position + 1 : 0,
      ...initialStatusData(list.status),
      checklists: {
        create: tpl.checklists.map((cl, i) => ({
          title: cl.title,
          position: i,
          items: {
            create: cl.items.map((it, j) => ({
              content: it.content,
              position: j,
            })),
          },
        })),
      },
    },
  });

  await logActivity({
    boardId: list.boardId,
    cardId: card.id,
    userId,
    type: 'card.create',
    data: { listName: list.name },
  });
  emitToBoard(list.boardId, 'board:lists-changed');
  await runAutomationsForCard('CARD_CREATED', card.id, card.title, list.boardId, listId);

  // Tu dong hoa (vd SET_DONE) co the vua doi du lieu the - doc lai truoc khi
  // tra ve, tranh response cu (con isDone/... truoc khi tu dong hoa chay).
  return (await prisma.card.findUnique({ where: { id: card.id } })) ?? card;
}
