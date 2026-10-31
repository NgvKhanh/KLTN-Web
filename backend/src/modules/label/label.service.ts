import { prisma } from '../../config/prisma';
import { emitToBoard } from '../../realtime/socket';
import { AppError } from '../../utils/AppError';
import { assertBoardAccess, assertBoardView } from '../board/board.service';
import { assertCardAccess } from '../card/card.service';

// 6 mau nhan mac dinh tao san khi bang chua co nhan nao
const DEFAULT_LABEL_COLORS = [
  '#61BD4F',
  '#F2D600',
  '#FF9F1A',
  '#EB5A46',
  '#C377E0',
  '#0079BF',
];

export async function listBoardLabels(userId: string, boardId: string) {
  const { canEdit } = await assertBoardView(userId, boardId);

  let labels = await prisma.label.findMany({
    where: { boardId },
    orderBy: { createdAt: 'asc' },
  });

  // Lan dau: tao san bo mau co ban (chi khi nguoi xem co quyen sua)
  if (labels.length === 0 && canEdit) {
    await prisma.label.createMany({
      data: DEFAULT_LABEL_COLORS.map((color) => ({ boardId, color })),
    });
    labels = await prisma.label.findMany({
      where: { boardId },
      orderBy: { createdAt: 'asc' },
    });
  }

  return labels;
}

export async function createLabel(
  userId: string,
  boardId: string,
  input: { name?: string; color: string }
) {
  await assertBoardAccess(userId, boardId);
  const label = await prisma.label.create({
    data: { boardId, name: input.name?.trim() ?? '', color: input.color },
  });
  emitToBoard(boardId, 'board:lists-changed');
  return label;
}

async function labelBoard(userId: string, labelId: string) {
  const label = await prisma.label.findUnique({ where: { id: labelId } });
  if (!label) throw new AppError('Khong tim thay nhan', 404);
  await assertBoardAccess(userId, label.boardId);
  return label;
}

export async function updateLabel(
  userId: string,
  labelId: string,
  input: { name?: string; color?: string }
) {
  const label = await labelBoard(userId, labelId);
  const updated = await prisma.label.update({
    where: { id: labelId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
    },
  });
  emitToBoard(label.boardId, 'board:lists-changed');
  return updated;
}

export async function deleteLabel(userId: string, labelId: string) {
  const label = await labelBoard(userId, labelId);
  await prisma.label.delete({ where: { id: labelId } });
  emitToBoard(label.boardId, 'board:lists-changed');
}

// ---------- Gan / bo nhan tren the ----------

export async function attachLabel(
  userId: string,
  cardId: string,
  labelId: string
) {
  const card = await assertCardAccess(userId, cardId);
  const label = await prisma.label.findUnique({ where: { id: labelId } });
  if (!label || label.boardId !== card.list.boardId) {
    throw new AppError('Nhan khong thuoc bang nay', 400);
  }
  await prisma.cardLabel.upsert({
    where: { cardId_labelId: { cardId, labelId } },
    create: { cardId, labelId },
    update: {},
  });
  emitToBoard(card.list.boardId, 'board:lists-changed');
  return label;
}

export async function detachLabel(
  userId: string,
  cardId: string,
  labelId: string
) {
  const card = await assertCardAccess(userId, cardId);
  await prisma.cardLabel.deleteMany({ where: { cardId, labelId } });
  emitToBoard(card.list.boardId, 'board:lists-changed');
}
