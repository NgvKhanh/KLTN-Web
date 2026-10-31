import { prisma } from '../../config/prisma';
import { emitToBoard } from '../../realtime/socket';
import { AppError } from '../../utils/AppError';
import { maskEmails } from '../../utils/privacy';
import { isRiskFresh } from '../risk/risk.decide';
import { runAutomationsForCard } from '../automation/automation.service';
import { assertBoardAccess, assertBoardView } from '../board/board.service';
import {
  guessListStatus,
  logBulkStatusChange,
  statusWrite,
  type CardStatus,
} from '../card/cardStatus';
import type {
  CreateListInput,
  MoveAllCardsInput,
  SortListInput,
  UpdateListInput,
} from './list.schema';

// Lay 1 danh sach con hoat dong va kiem tra nguoi dung CO QUYEN SUA bang
// chua no. Export de module card tai su dung.
export async function assertListAccess(userId: string, listId: string) {
  const list = await prisma.list.findFirst({
    where: { id: listId, deletedAt: null, archivedAt: null },
  });
  if (!list) {
    throw new AppError('Khong tim thay danh sach', 404);
  }
  await assertBoardAccess(userId, list.boardId);
  return list;
}

// Nhu tren nhung chi doi hoi QUYEN XEM (VIEWER cung qua duoc) - dung cho cac
// thiet lap ca nhan khong lam thay doi noi dung bang: watch, nhac han rieng.
export async function assertListView(userId: string, listId: string) {
  const list = await prisma.list.findFirst({
    where: { id: listId, deletedAt: null, archivedAt: null },
  });
  if (!list) {
    throw new AppError('Khong tim thay danh sach', 404);
  }
  await assertBoardView(userId, list.boardId);
  return list;
}

export async function listBoardLists(userId: string, boardId: string) {
  const { insider } = await assertBoardView(userId, boardId);
  const lists = await prisma.list.findMany({
    where: { boardId, deletedAt: null, archivedAt: null },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: {
      cards: {
        where: { deletedAt: null, archivedAt: null },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        include: {
          labels: { include: { label: true } },
          members: {
            include: {
              user: {
                select: { id: true, name: true, email: true, avatarUrl: true },
              },
            },
          },
          checklists: { select: { items: { select: { isDone: true } } } },
          comments: { where: { deletedAt: null }, select: { id: true } },
          attachments: { select: { id: true } },
          risk: { select: { score: true, level: true, dueDateUsed: true } },
        },
      },
    },
  });
  // Muc nguy co tre han cho dau tren the (RISK_MODULE.md §10): chi thanh vien thay (nguoi xem bang PUBLIC tu ngoai vao khong),
  // va chi khi ket qua con hieu luc (the chua xong, han khong doi tu luc cham).
  const withRisk = lists.map((l) => ({
    ...l,
    cards: l.cards.map(({ risk, ...c }) => ({
      ...c,
      risk: insider && isRiskFresh(risk, c) ? { score: risk!.score, level: risk!.level } : null,
    })),
  }));
  // Nguoi xem chi vi bang la PUBLIC khong duoc thay email that cua thanh vien the
  // (giong GET .../members). Thanh vien / chu bang van thay nhu cu.
  return insider ? withRisk : maskEmails(withRisk);
}

export async function createList(
  userId: string,
  boardId: string,
  input: CreateListInput
) {
  await assertBoardAccess(userId, boardId);

  const last = await prisma.list.findFirst({
    where: { boardId, deletedAt: null, archivedAt: null },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  // Khong chi dinh trang thai -> doan theo ten cot moi (doi lai duoc trong menu cot)
  const status =
    input.status !== undefined ? input.status : guessListStatus(input.name);

  const created = await prisma.list.create({
    data: { boardId, name: input.name, position, status },
  });
  emitToBoard(boardId, 'board:lists-changed');
  return created;
}

export async function updateList(
  userId: string,
  listId: string,
  input: UpdateListInput
) {
  const list = await assertListAccess(userId, listId);

  if (input.status !== undefined) {
    await setListStatus(userId, list, input.status);
  }

  // Keo sap xep lai: dua cot nay toi vi tri input.position roi danh so lai het
  if (input.position !== undefined) {
    const others = await prisma.list.findMany({
      where: {
        boardId: list.boardId,
        deletedAt: null,
        archivedAt: null,
        id: { not: listId },
      },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    });
    const target = Math.min(Math.max(input.position, 0), others.length);
    const orderedIds = [
      ...others.slice(0, target).map((l) => l.id),
      listId,
      ...others.slice(target).map((l) => l.id),
    ];

    await prisma.$transaction(
      orderedIds.map((id, index) =>
        prisma.list.update({
          where: { id },
          data: {
            position: index,
            ...(id === listId && input.name !== undefined
              ? { name: input.name }
              : {}),
          },
        })
      )
    );

    emitToBoard(list.boardId, 'board:lists-changed');
    return prisma.list.findFirst({ where: { id: listId } });
  }

  const updated = await prisma.list.update({
    where: { id: listId },
    data: { ...(input.name !== undefined ? { name: input.name } : {}) },
  });
  emitToBoard(list.boardId, 'board:lists-changed');
  return updated;
}

// Gan trang thai cho cot. Trang thai khac null -> moi the DANG HOAT DONG trong
// cot doi theo (the luu tru se doi theo khi duoc khoi phuc). Gan lai dung trang
// thai cu van dong bo lai cac the dang "lech" cot (the da doi tay trang thai).
// null -> cot tro thanh cot tu do, the giu nguyen trang thai.
async function setListStatus(
  userId: string,
  list: { id: string; boardId: string; status: CardStatus | null },
  status: CardStatus | null
) {
  if (status === null) {
    if (list.status !== null) {
      await prisma.list.update({ where: { id: list.id }, data: { status: null } });
    }
    return;
  }

  const activeInList = { listId: list.id, deletedAt: null, archivedAt: null };
  // Doc truoc de ghi nhat ky tung the (tu dau -> den dau)
  const changing = await prisma.card.findMany({
    where: { ...activeInList, status: { not: status } },
    select: { id: true, title: true, status: true },
  });
  await prisma.$transaction([
    prisma.list.update({ where: { id: list.id }, data: { status } }),
    statusWrite(prisma, activeInList, status),
  ]);
  await logBulkStatusChange(list.boardId, userId, changing, status);
}

export async function deleteList(userId: string, listId: string) {
  const list = await assertListAccess(userId, listId);
  await prisma.list.update({
    where: { id: listId },
    data: { deletedAt: new Date() },
  });
  emitToBoard(list.boardId, 'board:lists-changed');
}

// Lay danh sach (bat ke da luu tru) + kiem tra quyen sua bang
async function assertArchivedList(userId: string, listId: string) {
  const list = await prisma.list.findFirst({
    where: { id: listId, deletedAt: null },
  });
  if (!list) throw new AppError('Khong tim thay danh sach', 404);
  await assertBoardAccess(userId, list.boardId);
  return list;
}

// Luu tru danh sach (co the khoi phuc). Cac the ben trong van giu nguyen.
export async function archiveList(userId: string, listId: string) {
  const list = await assertListAccess(userId, listId);
  await prisma.list.update({
    where: { id: listId },
    data: { archivedAt: new Date() },
  });
  emitToBoard(list.boardId, 'board:lists-changed');
}

// Khoi phuc danh sach da luu tru -> dua ve cuoi bang
export async function restoreList(userId: string, listId: string) {
  const list = await assertArchivedList(userId, listId);
  const last = await prisma.list.findFirst({
    where: { boardId: list.boardId, deletedAt: null, archivedAt: null },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  await prisma.list.update({
    where: { id: listId },
    data: { archivedAt: null, position: last ? last.position + 1 : 0 },
  });
  emitToBoard(list.boardId, 'board:lists-changed');
}

// Xoa han danh sach da luu tru
export async function purgeList(userId: string, listId: string) {
  const list = await assertArchivedList(userId, listId);
  await prisma.list.update({
    where: { id: listId },
    data: { deletedAt: new Date() },
  });
  emitToBoard(list.boardId, 'board:lists-changed');
}

// Sao chep danh sach (kem toan bo the) va chen ngay sau danh sach goc
export async function copyList(userId: string, listId: string) {
  const src = await assertListAccess(userId, listId);

  const cards = await prisma.card.findMany({
    where: { listId, deletedAt: null, archivedAt: null },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });

  // Day cac cot phia sau ra 1 bac de chua ban sao
  await prisma.list.updateMany({
    where: {
      boardId: src.boardId,
      deletedAt: null,
      archivedAt: null,
      position: { gt: src.position },
    },
    data: { position: { increment: 1 } },
  });

  const copy = await prisma.list.create({
    data: {
      boardId: src.boardId,
      name: `${src.name} (bản sao)`.slice(0, 100),
      position: src.position + 1,
      status: src.status,
      cards: {
        // Giu nguyen trang thai tung the (ca 3 cot status/isDone/completedAt
        // de khong pha bat bien isDone <-> completedAt != null)
        create: cards.map((c, i) => ({
          title: c.title,
          description: c.description,
          status: c.status,
          isDone: c.isDone,
          completedAt: c.completedAt,
          position: i,
        })),
      },
    },
    include: {
      cards: {
        where: { deletedAt: null, archivedAt: null },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      },
    },
  });
  emitToBoard(src.boardId, 'board:lists-changed');
  return copy;
}

// Chuyen toan bo the cua danh sach nay sang mot danh sach khac cung bang
export async function moveAllCards(
  userId: string,
  listId: string,
  input: MoveAllCardsInput
) {
  const src = await assertListAccess(userId, listId);

  if (input.targetListId === listId) {
    throw new AppError('Danh sach dich trung voi danh sach nguon', 400);
  }
  const target = await prisma.list.findFirst({
    where: { id: input.targetListId, deletedAt: null, archivedAt: null },
  });
  if (!target || target.boardId !== src.boardId) {
    throw new AppError('Danh sach dich khong hop le', 400);
  }

  const targetCards = await prisma.card.findMany({
    where: { listId: target.id, deletedAt: null, archivedAt: null },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  const movingCards = await prisma.card.findMany({
    where: { listId, deletedAt: null, archivedAt: null },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, title: true, status: true },
  });

  const orderedIds = [
    ...targetCards.map((c) => c.id),
    ...movingCards.map((c) => c.id),
  ];
  await prisma.$transaction([
    ...orderedIds.map((id, i) =>
      prisma.card.update({
        where: { id },
        data: { listId: target.id, position: i },
      })
    ),
    // Cot dich co trang thai -> cac the vua chuyen sang doi theo
    ...(target.status
      ? [statusWrite(prisma, { id: { in: movingCards.map((c) => c.id) } }, target.status)]
      : []),
  ]);
  if (target.status) {
    await logBulkStatusChange(src.boardId, userId, movingCards, target.status);
  }
  emitToBoard(src.boardId, 'board:lists-changed');

  // CODE_REVIEW.md #8: nhu chuyen 1 the, phai chay automation CARD_MOVED_TO_LIST cho
  // TUNG the vua chuyen (runAutomationsForCard khong bao gio nem loi).
  for (const card of movingCards) {
    await runAutomationsForCard('CARD_MOVED_TO_LIST', card.id, card.title, src.boardId, target.id);
  }
}

// Sap xep lai the trong danh sach theo tieu chi
export async function sortListCards(
  userId: string,
  listId: string,
  input: SortListInput
) {
  const list = await assertListAccess(userId, listId);

  const cards = await prisma.card.findMany({
    where: { listId, deletedAt: null, archivedAt: null },
  });

  const sorted = [...cards].sort((a, b) => {
    switch (input.by) {
      case 'created-desc':
        return b.createdAt.getTime() - a.createdAt.getTime();
      case 'created-asc':
        return a.createdAt.getTime() - b.createdAt.getTime();
      case 'title-asc':
        return a.title.localeCompare(b.title, 'vi');
      case 'done':
        // The chua xong len tren, xong xuong duoi
        return Number(a.isDone) - Number(b.isDone);
      default:
        return 0;
    }
  });

  await prisma.$transaction(
    sorted.map((c, i) =>
      prisma.card.update({ where: { id: c.id }, data: { position: i } })
    )
  );
  emitToBoard(list.boardId, 'board:lists-changed');
}

// Xoa (mem) toan bo the trong danh sach
export async function deleteAllCards(userId: string, listId: string) {
  const list = await assertListAccess(userId, listId);
  await prisma.card.updateMany({
    where: { listId, deletedAt: null, archivedAt: null },
    data: { deletedAt: new Date() },
  });
  emitToBoard(list.boardId, 'board:lists-changed');
}
