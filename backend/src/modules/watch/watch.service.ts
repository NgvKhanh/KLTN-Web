import { prisma } from '../../config/prisma';
import { assertBoardView } from '../board/board.service';
import { assertListView } from '../list/list.service';
import { assertCardView } from '../card/card.service';

// Theo doi (watch): nguoi dung tu nguyen nhan thong bao hoat dong cua 1
// bang/danh sach/the, khong can la thanh vien duoc gan. Doc them o
// notification.service.ts (cardMemberIds) - noi tap hop nguoi nhan thong bao
// cua 1 the duoc mo rong de gom ca nguoi theo doi the/danh sach/bang chua no.

export async function isWatchingBoard(
  userId: string,
  boardId: string
): Promise<boolean> {
  const w = await prisma.watch.findUnique({
    where: { userId_boardId: { userId, boardId } },
  });
  return Boolean(w);
}

export async function setBoardWatch(
  userId: string,
  boardId: string,
  watching: boolean
): Promise<void> {
  await assertBoardView(userId, boardId);
  if (watching) {
    await prisma.watch.upsert({
      where: { userId_boardId: { userId, boardId } },
      create: { userId, boardId },
      update: {},
    });
  } else {
    await prisma.watch.deleteMany({ where: { userId, boardId } });
  }
}

export async function isWatchingList(
  userId: string,
  listId: string
): Promise<boolean> {
  const w = await prisma.watch.findUnique({
    where: { userId_listId: { userId, listId } },
  });
  return Boolean(w);
}

export async function setListWatch(
  userId: string,
  listId: string,
  watching: boolean
): Promise<void> {
  await assertListView(userId, listId);
  if (watching) {
    await prisma.watch.upsert({
      where: { userId_listId: { userId, listId } },
      create: { userId, listId },
      update: {},
    });
  } else {
    await prisma.watch.deleteMany({ where: { userId, listId } });
  }
}

export async function isWatchingCard(
  userId: string,
  cardId: string
): Promise<boolean> {
  const w = await prisma.watch.findUnique({
    where: { userId_cardId: { userId, cardId } },
  });
  return Boolean(w);
}

export async function setCardWatch(
  userId: string,
  cardId: string,
  watching: boolean
): Promise<void> {
  await assertCardView(userId, cardId);
  if (watching) {
    await prisma.watch.upsert({
      where: { userId_cardId: { userId, cardId } },
      create: { userId, cardId },
      update: {},
    });
  } else {
    await prisma.watch.deleteMany({ where: { userId, cardId } });
  }
}

// Tien ich: userId cua nhung nguoi dang theo doi 1 the, danh sach chua no,
// hoac bang chua no (goi tu notification.service.ts de mo rong nguoi nhan).
export async function watcherIdsForCard(
  cardId: string,
  listId: string,
  boardId: string
): Promise<string[]> {
  const rows = await prisma.watch.findMany({
    where: { OR: [{ cardId }, { listId }, { boardId }] },
    select: { userId: true },
  });
  return [...new Set(rows.map((r) => r.userId))];
}
