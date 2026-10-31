import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { assertBoardAccess } from './board.service';
import { assertWorkspaceAccess } from '../workspace/workspace.service';
import { initialStatusData } from '../card/cardStatus';

// Mau bang do nguoi dung tu luu (khac BOARD_TEMPLATES tinh san trong code):
// chup lai cau truc list + the (chi tieu de/mo ta, khong kem nhan/checklist/
// thanh vien) cua 1 bang dang co, luu vao khong gian lam viec chua no.

export async function listBoardTemplates(userId: string, workspaceId: string) {
  await assertWorkspaceAccess(userId, workspaceId);
  return prisma.boardTemplate.findMany({
    where: { workspaceId },
    orderBy: { createdAt: 'desc' },
    include: {
      createdBy: { select: { id: true, name: true, avatarUrl: true } },
      lists: {
        orderBy: { position: 'asc' },
        include: { cards: { orderBy: { position: 'asc' } } },
      },
    },
  });
}

// Chup 1 bang dang co thanh mau, luu vao khong gian chua no.
export async function saveBoardAsTemplate(
  userId: string,
  boardId: string,
  name?: string
) {
  const board = await assertBoardAccess(userId, boardId);
  const lists = await prisma.list.findMany({
    where: { boardId, deletedAt: null, archivedAt: null },
    orderBy: { position: 'asc' },
    include: {
      cards: {
        where: { deletedAt: null, archivedAt: null },
        orderBy: { position: 'asc' },
        select: { title: true, description: true, position: true },
      },
    },
  });

  return prisma.boardTemplate.create({
    data: {
      workspaceId: board.workspaceId,
      name: name?.trim() || `${board.name} (mẫu)`,
      color: board.color,
      createdById: userId,
      lists: {
        create: lists.map((l, li) => ({
          name: l.name,
          position: li,
          status: l.status,
          cards: {
            create: l.cards.map((c, ci) => ({
              title: c.title,
              description: c.description,
              position: ci,
            })),
          },
        })),
      },
    },
    include: { lists: { include: { cards: true } } },
  });
}

export async function deleteBoardTemplate(userId: string, templateId: string) {
  const tpl = await prisma.boardTemplate.findUnique({
    where: { id: templateId },
  });
  if (!tpl) throw new AppError('Không tìm thấy mẫu này', 404);
  const { role } = await assertWorkspaceAccess(userId, tpl.workspaceId);
  if (tpl.createdById !== userId && role !== 'OWNER' && role !== 'ADMIN') {
    throw new AppError('Bạn không có quyền xoá mẫu này', 403);
  }
  await prisma.boardTemplate.delete({ where: { id: templateId } });
}

// Tao 1 bang moi tu mau da luu.
export async function createBoardFromUserTemplate(
  userId: string,
  workspaceId: string,
  templateId: string,
  name?: string
) {
  await assertWorkspaceAccess(userId, workspaceId);
  const tpl = await prisma.boardTemplate.findFirst({
    where: { id: templateId, workspaceId },
    include: { lists: { orderBy: { position: 'asc' }, include: { cards: { orderBy: { position: 'asc' } } } } },
  });
  if (!tpl) {
    throw new AppError('Không tìm thấy mẫu này', 404);
  }

  return prisma.board.create({
    data: {
      ownerId: userId,
      workspaceId,
      name: name?.trim() || tpl.name,
      color: tpl.color,
      members: { create: { userId, role: 'OWNER' } },
      lists: {
        create: tpl.lists.map((l, li) => ({
          name: l.name,
          position: li,
          status: l.status,
          cards: {
            create: l.cards.map((c, ci) => ({
              title: c.title,
              description: c.description,
              position: ci,
              ...initialStatusData(l.status),
            })),
          },
        })),
      },
    },
  });
}
