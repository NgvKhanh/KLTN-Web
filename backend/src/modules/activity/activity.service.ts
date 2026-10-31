import { prisma } from '../../config/prisma';
import { emitToBoard } from '../../realtime/socket';
import { memberWorkspaceIds } from '../workspace/workspace.service';

type ActivityType =
  | 'card.create'
  | 'card.move'
  | 'card.rename'
  | 'card.done'
  | 'card.undone'
  | 'card.status' // doi trang thai giua cac trang thai KHAC DONE (vao/ra DONE dung card.done/undone)
  | 'card.due.set'
  | 'card.due.clear'
  | 'card.archive'
  | 'card.restore'
  | 'comment.create'
  | 'member.add'
  | 'member.remove'
  | 'checklist.add'
  | 'attachment.add'
  | 'ai.board.create';

interface LogInput {
  boardId: string;
  cardId?: string | null;
  userId: string;
  type: ActivityType;
  data?: Record<string, unknown>;
}

// Ghi 1 dong nhat ky. Loi ghi log khong lam hong thao tac chinh.
export async function logActivity(input: LogInput): Promise<void> {
  try {
    await prisma.activity.create({
      data: {
        boardId: input.boardId,
        cardId: input.cardId ?? null,
        userId: input.userId,
        type: input.type,
        data: (input.data ?? {}) as object,
      },
    });
  } catch {
    // bo qua
  }
  // Moi thao tac co ghi nhat ky deu keo theo thay doi tren bang -> bao realtime
  emitToBoard(input.boardId, 'board:lists-changed');
}

const ACTIVITY_USER_SELECT = { id: true, name: true, avatarUrl: true } as const;
const ACTIVITY_CARD_SELECT = {
  id: true,
  title: true,
  list: { select: { boardId: true } },
} as const;

type ActivityCardRow = { id: string; title: string; list: { boardId: string } } | null;

// The co the da CHUYEN SANG bang khac (kem doi ten) sau khi nhat ky duoc ghi.
// Nhat ky luu theo boardId tai THOI DIEM ghi (boardId cua row), con include
// card.title lai lay ten HIEN TAI cua the -> neu khong che, nguoi chi co
// quyen o bang cu van doc duoc ten moi (co the nhay cam) cua the o bang rieng
// tu ma ho khong he co quyen. Ten chi duoc giu neu the VAN con o dung bang da
// ghi nhat ky; nguoc lai chi tra ve id (de lien ket), che ten.
function redactMovedCard<T extends { boardId: string; card: ActivityCardRow }>(
  activity: T
): Omit<T, 'card'> & { card: { id: string; title: string | null } | null } {
  const { card, ...rest } = activity;
  if (!card) return { ...rest, card: null };
  if (card.list.boardId !== activity.boardId) {
    return { ...rest, card: { id: card.id, title: null } };
  }
  return { ...rest, card: { id: card.id, title: card.title } };
}

export async function listCardActivity(cardId: string) {
  return prisma.activity.findMany({
    where: { cardId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { user: { select: ACTIVITY_USER_SELECT } },
  });
}

// Nhat ky thao tac cua ca 1 bang (moi nguoi, moi the)
export async function listBoardActivity(boardId: string) {
  const rows = await prisma.activity.findMany({
    where: { boardId },
    orderBy: { createdAt: 'desc' },
    take: 80,
    include: {
      user: { select: ACTIVITY_USER_SELECT },
      card: { select: ACTIVITY_CARD_SELECT },
    },
  });
  return rows.map(redactMovedCard);
}

// Nhat ky hoat dong tren TAT CA cac bang user tham gia (ke ca nguoi khac lam).
// excludeSelf: chi lay viec NGUOI KHAC lam (trang Tong quan, tab "Người khác").
export async function listHomeActivity(userId: string, opts: { excludeSelf?: boolean } = {}) {
  const memberships = await prisma.boardMember.findMany({
    where: { userId, deletedAt: null, board: { deletedAt: null, archivedAt: null } },
    select: { boardId: true },
  });
  const boardIds = memberships.map((m) => m.boardId);
  if (boardIds.length === 0) return [];

  const rows = await prisma.activity.findMany({
    where: { boardId: { in: boardIds }, ...(opts.excludeSelf ? { userId: { not: userId } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: {
      user: { select: ACTIVITY_USER_SELECT },
      board: { select: { id: true, name: true } },
      card: { select: ACTIVITY_CARD_SELECT },
    },
  });
  return rows.map(redactMovedCard);
}

export const MY_ACTIVITY_PAGE = 40;

// Nhat ky thao tac cua chinh nguoi dung, chi tren cac bang HIEN CON quyen xem (chu bang / thanh vien / thanh vien
// khong gian cua bang muc WORKSPACE): bang da roi hoac bi thu hoi quyen khong con lo ten bang / ten the.
// Phan trang theo moc thoi gian: `before` = createdAt cua dong cuoi cung trang truoc.
export async function listMyActivity(userId: string, opts: { before?: Date; limit?: number } = {}) {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? MY_ACTIVITY_PAGE), 1), 100);
  const myWorkspaceIds = await memberWorkspaceIds(userId);
  const rows = await prisma.activity.findMany({
    where: {
      userId,
      ...(opts.before ? { createdAt: { lt: opts.before } } : {}),
      board: {
        deletedAt: null,
        archivedAt: null,
        OR: [
          { ownerId: userId },
          { members: { some: { userId, deletedAt: null } } },
          { visibility: 'WORKSPACE', workspaceId: { in: myWorkspaceIds } },
        ],
      },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    include: {
      board: { select: { id: true, name: true } },
      card: { select: { ...ACTIVITY_CARD_SELECT, deletedAt: true } },
    },
  });
  const page = rows.slice(0, limit).map((row) => {
    const removed = row.card?.deletedAt != null;
    const { card, ...rest } = redactMovedCard(row);
    return { ...rest, card: card ? { ...card, deleted: removed } : null };
  });
  return { activities: page, hasMore: rows.length > limit };
}
