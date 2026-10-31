import crypto from 'node:crypto';
import { prisma } from '../../config/prisma';
import { emitToBoard } from '../../realtime/socket';
import { AppError } from '../../utils/AppError';
import {
  boardManagerIds,
  notify,
} from '../notification/notification.service';
import { assertBoardManage } from './board.service';

const MEMBER_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
} as const;

// ---------- Link moi ----------

export async function getInviteToken(actorId: string, boardId: string) {
  const board = await assertBoardManage(actorId, boardId);
  return board.inviteToken;
}

export async function createInviteToken(actorId: string, boardId: string) {
  const board = await assertBoardManage(actorId, boardId);
  if (board.inviteToken) return board.inviteToken;

  // Sinh token duy nhat
  let token = '';
  for (let i = 0; i < 5; i += 1) {
    token = crypto.randomBytes(15).toString('base64url');
    const clash = await prisma.board.findUnique({ where: { inviteToken: token } });
    if (!clash) break;
  }

  const updated = await prisma.board.update({
    where: { id: boardId },
    data: { inviteToken: token },
  });
  return updated.inviteToken;
}

export async function disableInviteToken(actorId: string, boardId: string) {
  await assertBoardManage(actorId, boardId);
  await prisma.board.update({
    where: { id: boardId },
    data: { inviteToken: null },
  });
}

// ---------- Vao bang bang link ----------

async function boardByToken(token: string) {
  const board = await prisma.board.findFirst({
    where: { inviteToken: token, deletedAt: null },
  });
  if (!board) {
    throw new AppError('Link moi khong hop le hoac da bi thu hoi', 404);
  }
  return board;
}

async function viewerStatus(userId: string, boardId: string, ownerId: string) {
  if (ownerId === userId) return 'member' as const;
  const member = await prisma.boardMember.findFirst({
    where: { boardId, userId, deletedAt: null },
  });
  if (member) return 'member' as const;
  const request = await prisma.boardJoinRequest.findUnique({
    where: { boardId_userId: { boardId, userId } },
  });
  if (request && request.status === 'PENDING') return 'pending' as const;
  return 'none' as const;
}

export async function previewByToken(userId: string, token: string) {
  const board = await boardByToken(token);
  const status = await viewerStatus(userId, board.id, board.ownerId);
  return {
    board: {
      id: board.id,
      name: board.name,
      color: board.color,
      backgroundImage: board.backgroundImage,
    },
    status,
  };
}

export async function requestToJoin(userId: string, token: string) {
  const board = await boardByToken(token);
  const status = await viewerStatus(userId, board.id, board.ownerId);
  if (status === 'member') {
    throw new AppError('Ban da la thanh vien cua bang nay', 409);
  }
  if (status === 'pending') {
    throw new AppError('Ban da gui yeu cau, dang cho duyet', 409);
  }

  await prisma.boardJoinRequest.upsert({
    where: { boardId_userId: { boardId: board.id, userId } },
    create: { boardId: board.id, userId, status: 'PENDING' },
    update: { status: 'PENDING' },
  });

  await notify({
    recipients: await boardManagerIds(board.id),
    actorId: userId,
    type: 'board.join.request',
    boardId: board.id,
    data: { boardName: board.name },
  });

  // Quan tri vien dang mo bang -> cap nhat tab "Yeu cau tham gia" ngay
  emitToBoard(board.id, 'board:join-requests-changed');

  return { boardName: board.name };
}

// ---------- Duyet yeu cau (Quan tri vien) ----------

export async function listJoinRequests(actorId: string, boardId: string) {
  await assertBoardManage(actorId, boardId);
  return prisma.boardJoinRequest.findMany({
    where: { boardId, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: MEMBER_USER_SELECT } },
  });
}

export async function approveJoinRequest(
  actorId: string,
  boardId: string,
  requestId: string
) {
  await assertBoardManage(actorId, boardId);

  const request = await prisma.boardJoinRequest.findFirst({
    where: { id: requestId, boardId, status: 'PENDING' },
  });
  if (!request) {
    throw new AppError('Khong tim thay yeu cau tham gia', 404);
  }

  const [, member] = await prisma.$transaction([
    prisma.boardJoinRequest.update({
      where: { id: requestId },
      data: { status: 'APPROVED' },
    }),
    prisma.boardMember.upsert({
      where: { boardId_userId: { boardId, userId: request.userId } },
      create: { boardId, userId: request.userId, role: 'MEMBER' },
      update: { deletedAt: null, role: 'MEMBER', joinedAt: new Date() },
      include: { user: { select: MEMBER_USER_SELECT } },
    }),
  ]);

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { name: true },
  });
  await notify({
    recipients: [request.userId],
    actorId,
    type: 'board.join.approved',
    boardId,
    data: { boardName: board?.name ?? '' },
  });

  emitToBoard(boardId, 'board:join-requests-changed');
  emitToBoard(boardId, 'board:members-changed');

  return member;
}

export async function rejectJoinRequest(
  actorId: string,
  boardId: string,
  requestId: string
) {
  await assertBoardManage(actorId, boardId);

  const request = await prisma.boardJoinRequest.findFirst({
    where: { id: requestId, boardId, status: 'PENDING' },
  });
  if (!request) {
    throw new AppError('Khong tim thay yeu cau tham gia', 404);
  }

  await prisma.boardJoinRequest.update({
    where: { id: requestId },
    data: { status: 'REJECTED' },
  });

  const board = await prisma.board.findUnique({
    where: { id: boardId },
    select: { name: true },
  });
  await notify({
    recipients: [request.userId],
    actorId,
    type: 'board.join.rejected',
    boardId,
    data: { boardName: board?.name ?? '' },
  });

  emitToBoard(boardId, 'board:join-requests-changed');
}
