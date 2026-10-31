import { prisma } from '../../config/prisma';
import type { Prisma } from '../../generated/prisma/client';
import { emitToBoard, emitToUser } from '../../realtime/socket';
import { watcherIdsForCard } from '../watch/watch.service';
import {
  categoryOfType,
  getOrCreatePreference,
  preferencesFor,
} from './notificationPreference.service';

// Prisma Client thuong HOAC client trong 1 transaction ($transaction(async (tx) => ...))
type Db = typeof prisma | Prisma.TransactionClient;

export type NotificationType =
  | 'board.member.added'
  | 'board.member.removed'
  | 'board.role.changed'
  | 'board.ownership.transferred'
  | 'board.join.request'
  | 'board.join.approved'
  | 'board.join.rejected'
  | 'workspace.member.added'
  | 'workspace.member.removed'
  | 'workspace.role.changed'
  | 'workspace.ownership.transferred'
  | 'card.member.added'
  | 'card.comment'
  | 'card.mentioned'
  | 'card.comment.reply'
  | 'card.attachment.added'
  | 'card.moved'
  | 'card.renamed'
  | 'card.due.set'
  | 'card.due.reminder'
  | 'card.risk.warning'
  | 'card.marked.done'
  | 'card.deleted';

// Liet ke day du (dung de tinh danh sach loai bi an trong-app theo tuy chinh
// nguoi dung - xem "hiddenTypesFor" ben duoi). Nho cap nhat khi them loai moi.
export const NOTIFICATION_TYPES: readonly NotificationType[] = [
  'board.member.added',
  'board.member.removed',
  'board.role.changed',
  'board.ownership.transferred',
  'board.join.request',
  'board.join.approved',
  'board.join.rejected',
  'workspace.member.added',
  'workspace.member.removed',
  'workspace.role.changed',
  'workspace.ownership.transferred',
  'card.member.added',
  'card.comment',
  'card.mentioned',
  'card.comment.reply',
  'card.attachment.added',
  'card.moved',
  'card.renamed',
  'card.due.set',
  'card.due.reminder',
  'card.risk.warning',
  'card.marked.done',
  'card.deleted',
];

interface NotifyInput {
  recipients: string[]; // userId cua nguoi nhan
  actorId: string;
  type: NotificationType;
  boardId?: string | null;
  cardId?: string | null;
  workspaceId?: string | null;
  data?: Record<string, unknown>;
}

// Tao thong bao cho nhieu nguoi (bo qua nguoi trung voi actor va trung lap).
// LUON LUU ban ghi cho moi nguoi nhan hop le, KE CA nguoi da tat hien thi
// trong-app cho nhom nay - ban ghi Notification la nguon du lieu DUNG CHUNG
// cho ca danh sach trong-app LAN email tong hop hang ngay (digest.scheduler).
// Neu loc bo ngay tu day, nguoi tat "thong bao the trong-app" nhung van bat
// "email tong hop cho nhom the" se khong con gi de tong hop - xem
// notificationPreference.service.ts. Tuy chinh "*InApp" chi quyet dinh CO
// HIEN THI trong-app khong (xem listNotifications/countUnread va emit
// realtime ben duoi), khong quyet dinh co LUU su kien khong.
// Loi ghi thong bao khong duoc lam hong thao tac chinh.
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const ids = [...new Set(input.recipients)].filter(
      (id) => id && id !== input.actorId
    );
    if (ids.length === 0) return;

    await prisma.notification.createMany({
      data: ids.map((userId) => ({
        userId,
        actorId: input.actorId,
        type: input.type,
        boardId: input.boardId ?? null,
        cardId: input.cardId ?? null,
        workspaceId: input.workspaceId ?? null,
        data: (input.data ?? {}) as object,
      })),
    });

    // Chi bao realtime ("co thong bao moi") cho nguoi DANG BAT hien thi
    // trong-app cho nhom nay - tranh lam phien nguoi da tat, du ban ghi van
    // duoc luu (de con dung cho email tong hop sau).
    const category = categoryOfType(input.type);
    const prefs = await preferencesFor(ids);
    const inAppKey = category === 'board' ? 'boardInApp' : 'cardInApp';
    for (const userId of ids) {
      if (prefs.get(userId)?.[inAppKey] !== false) {
        emitToUser(userId, 'notification:new', {});
      }
    }
    // Su kien lien quan thanh vien -> lam moi danh sach thanh vien tren bang
    // (danh cho MOI thanh vien dang xem bang, khong phu thuoc tuy chinh
    // thong bao ca nhan - day la lam moi UI, khong phai thong bao).
    if (input.boardId && input.type.startsWith('board.')) {
      emitToBoard(input.boardId, 'board:members-changed');
    }
  } catch {
    // bo qua
  }
}

// Thong bao nhac han: khong co "nguoi thuc hien" that (he thong tu tao), nen
// khong the dung notify() vi ham do loc bo nguoi nhan trung voi actorId.
// actorId o day dat = chinh userId nhan (chi de thoa man khoa ngoai bat buoc).
//
// CO Y khong nuot loi (khac notify() o tren): ham nay duoc goi trong 1
// transaction cung voi buoc "claim" (danh dau sentAt) ben reminder.scheduler.
// Neu tao thong bao that bai, loi phai duoc nem ra de transaction rollback ca
// buoc claim - nho vay reminder khong bi danh dau "da gui" trong khi that ra
// chua ai duoc bao, va vong quet sau se tu dong thu lai.
export async function notifyDueReminder(
  db: Db,
  input: {
    userId: string;
    cardId: string;
    boardId: string;
    data: Record<string, unknown>;
  }
): Promise<void> {
  await db.notification.create({
    data: {
      userId: input.userId,
      actorId: input.userId,
      type: 'card.due.reminder',
      boardId: input.boardId,
      cardId: input.cardId,
      data: input.data as object,
    },
  });
}

// Tien ich: userId cac thanh vien the + nguoi dang THEO DOI the / danh sach /
// bang chua no, CON quyen truy cap bang. Loc bo nguoi da bi thu hoi quyen
// (vd bi xoa khoi bang, roi khoi khong gian) de ho khong con nhan thong bao
// chua ten the / noi dung binh luan moi.
export async function cardMemberIds(cardId: string): Promise<string[]> {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: {
      listId: true,
      members: { select: { userId: true } },
      list: {
        select: {
          board: {
            select: {
              id: true,
              ownerId: true,
              visibility: true,
              workspaceId: true,
            },
          },
        },
      },
    },
  });
  if (!card) return [];

  const board = card.list.board;
  const watcherIds = await watcherIdsForCard(cardId, card.listId, board.id);
  const candidateIds = [
    ...new Set([...card.members.map((m) => m.userId), ...watcherIds]),
  ];
  if (candidateIds.length === 0) return [];
  const activeMembers = await prisma.boardMember.findMany({
    where: {
      boardId: board.id,
      deletedAt: null,
      userId: { in: candidateIds },
    },
    select: { userId: true },
  });
  const allowed = new Set<string>([
    board.ownerId,
    ...activeMembers.map((m) => m.userId),
  ]);

  if (board.visibility === 'WORKSPACE') {
    const wsMembers = await prisma.workspaceMember.findMany({
      where: {
        workspaceId: board.workspaceId,
        deletedAt: null,
        userId: { in: candidateIds },
      },
      select: { userId: true },
    });
    for (const m of wsMembers) allowed.add(m.userId);
  }
  // Bang PUBLIC: ai cung xem duoc -> nguoi theo doi (du chua la thanh vien)
  // van hop le, khong bi loc bo.
  if (board.visibility === 'PUBLIC') {
    for (const id of candidateIds) allowed.add(id);
  }

  return candidateIds.filter((id) => allowed.has(id));
}

// Tien ich: chu bang + cac quan tri vien cua 1 bang
export async function boardManagerIds(boardId: string): Promise<string[]> {
  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { ownerId: true },
  });
  const admins = await prisma.boardMember.findMany({
    where: { boardId, deletedAt: null, role: { in: ['OWNER', 'ADMIN'] } },
    select: { userId: true },
  });
  return [
    ...(board ? [board.ownerId] : []),
    ...admins.map((a) => a.userId),
  ];
}

const ACTOR_SELECT = { id: true, name: true, avatarUrl: true } as const;

// Cac loai thong bao dang bi AN trong-app theo tuy chinh HIEN TAI cua nguoi
// dung (doc dong, khong phai snapshot luc tao) - dung de loc danh sach/dem
// chua doc. Ban ghi Notification van con nguyen trong DB cho digest.
async function hiddenTypesFor(userId: string): Promise<NotificationType[]> {
  const pref = await getOrCreatePreference(userId);
  return NOTIFICATION_TYPES.filter((t) => {
    const cat = categoryOfType(t);
    if (cat === 'card') return !pref.cardInApp;
    if (cat === 'board') return !pref.boardInApp;
    if (cat === 'risk') return !pref.riskInApp;
    return !pref.dueReminderInApp;
  });
}

export async function listNotifications(
  userId: string,
  opts: { unreadOnly?: boolean }
) {
  const hidden = await hiddenTypesFor(userId);
  return prisma.notification.findMany({
    where: {
      userId,
      ...(opts.unreadOnly ? { isRead: false } : {}),
      ...(hidden.length > 0 ? { type: { notIn: hidden } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 40,
    include: { actor: { select: ACTOR_SELECT } },
  });
}

export async function countUnread(userId: string): Promise<number> {
  const hidden = await hiddenTypesFor(userId);
  return prisma.notification.count({
    where: {
      userId,
      isRead: false,
      ...(hidden.length > 0 ? { type: { notIn: hidden } } : {}),
    },
  });
}

export async function markRead(userId: string, id: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { id, userId },
    data: { isRead: true },
  });
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true },
  });
}
