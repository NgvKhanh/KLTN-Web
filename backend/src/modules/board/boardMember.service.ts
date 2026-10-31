import { env } from '../../config/env';
import { sendMail } from '../../config/mailer';
import { prisma } from '../../config/prisma';
import {
  emitToBoard,
  emitToUser,
  evictUserFromBoardRoom,
} from '../../realtime/socket';
import { AppError } from '../../utils/AppError';
import { boardInviteEmail } from '../auth/emailTemplates';
import { notify } from '../notification/notification.service';
import {
  assertBoardManage,
  assertBoardOwner,
  assertBoardView,
} from './board.service';
import { createInviteToken } from './boardShare.service';
import type {
  AddBoardMemberInput,
  ChangeMemberRoleInput,
} from './boardMember.schema';

const MEMBER_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
} as const;

export async function listBoardMembers(userId: string, boardId: string) {
  const { board } = await assertBoardView(userId, boardId);

  const rows = await prisma.boardMember.findMany({
    where: { boardId, deletedAt: null },
    orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    include: { user: { select: MEMBER_USER_SELECT } },
  });
  const members = rows.map((m) => ({ ...m, viaWorkspace: false }));

  // Bang chia se theo khong gian -> hien ca thanh vien khong gian (co quyen xem/sua
  // nhung chua duoc them thang vao bang). Danh dau viaWorkspace de UI khong cho xoa.
  let all = members;
  if (board.visibility === 'WORKSPACE') {
    const known = new Set([board.ownerId, ...members.map((m) => m.userId)]);
    const wsMembers = await prisma.workspaceMember.findMany({
      where: { workspaceId: board.workspaceId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: MEMBER_USER_SELECT } },
    });
    const extra = wsMembers
      .filter((wm) => !known.has(wm.userId))
      .map((wm) => ({
        id: `ws-${wm.userId}`,
        boardId,
        userId: wm.userId,
        role: 'MEMBER' as const,
        starred: false,
        joinedAt: wm.createdAt,
        createdAt: wm.createdAt,
        updatedAt: wm.updatedAt,
        deletedAt: null as Date | null,
        user: wm.user,
        viaWorkspace: true,
      }));
    all = [...members, ...extra];
  }

  // Nguoi xem duoc bang chi vi no la PUBLIC (khong phai chu bang / thanh vien bang /
  // thanh vien khong gian) khong duoc thay EMAIL that cua nguoi khac - ho chi co
  // quyen XEM noi dung bang, khong phai "nguoi trong noi bo" bang.
  const isInsider = board.ownerId === userId || all.some((m) => m.userId === userId);
  return isInsider ? all : all.map((m) => ({ ...m, user: { ...m.user, email: '' } }));
}

// Ket qua them thanh vien: da them ngay (user co san) hoac da gui email moi.
export type AddBoardMemberResult =
  | { kind: 'member'; member: Awaited<ReturnType<typeof createMemberRow>> }
  | { kind: 'invited'; email: string };

function createMemberRow(data: {
  boardId: string;
  userId: string;
  role: 'ADMIN' | 'MEMBER' | 'VIEWER';
}) {
  return prisma.boardMember.create({
    data,
    include: { user: { select: MEMBER_USER_SELECT } },
  });
}

// Nguoi duoc moi chua co tai khoan -> bao dam co link moi + gui email kem link.
async function inviteByEmail(
  actorId: string,
  boardId: string,
  boardName: string,
  email: string
): Promise<AddBoardMemberResult> {
  const token = await createInviteToken(actorId, boardId);
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { name: true },
  });
  const url = `${env.frontendUrl.replace(/\/$/, '')}/join/${token}`;

  try {
    const { subject, html } = boardInviteEmail({
      inviterName: actor?.name ?? 'Mot thanh vien',
      boardName,
      url,
    });
    await sendMail({ to: email, subject, html });
  } catch (err) {
    console.error('[board] Gui email moi that bai:', err);
    throw new AppError(
      'Nguoi nay chua co tai khoan va khong gui duoc email moi. Hay thu lai sau.',
      502
    );
  }

  return { kind: 'invited', email };
}

export async function addBoardMember(
  actorId: string,
  boardId: string,
  input: AddBoardMemberInput
): Promise<AddBoardMemberResult> {
  const board = await assertBoardManage(actorId, boardId);

  const targetUser = await prisma.user.findFirst({
    where: { email: input.email, deletedAt: null },
    select: { id: true, emailVerifiedAt: true },
  });
  // Chua co tai khoan HOAC tai khoan chua xac minh email (chua ai chung minh so huu
  // that dia chi nay - co the la tai khoan chiem cho): gui link moi qua email, KHONG
  // cap quyen ngay. Chi email that su dang so huu hop thu moi bam vao link duoc.
  if (!targetUser || !targetUser.emailVerifiedAt) {
    return inviteByEmail(actorId, boardId, board.name, input.email);
  }

  const existing = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId: targetUser.id } },
  });
  if (existing && existing.deletedAt === null) {
    throw new AppError('Nguoi nay da la thanh vien cua bang', 409);
  }

  const member = existing
    ? await prisma.boardMember.update({
        where: { id: existing.id },
        data: { deletedAt: null, role: input.role, joinedAt: new Date() },
        include: { user: { select: MEMBER_USER_SELECT } },
      })
    : await createMemberRow({
        boardId,
        userId: targetUser.id,
        role: input.role,
      });

  await notify({
    recipients: [targetUser.id],
    actorId,
    type: 'board.member.added',
    boardId,
    data: { boardName: board.name },
  });

  emitToBoard(boardId, 'board:members-changed');
  // Nguoi vua duoc them -> lam moi danh sach bang cua ho ngay
  emitToUser(targetUser.id, 'board:access-changed');
  return { kind: 'member', member };
}

export async function changeMemberRole(
  actorId: string,
  boardId: string,
  targetUserId: string,
  input: ChangeMemberRoleInput
) {
  const board = await assertBoardManage(actorId, boardId);

  const membership = await prisma.boardMember.findFirst({
    where: { boardId, userId: targetUserId, deletedAt: null },
  });
  if (!membership) {
    throw new AppError('Nguoi nay khong phai thanh vien cua bang', 404);
  }
  if (membership.role === 'OWNER') {
    throw new AppError('Khong the doi vai tro cua chu bang', 400);
  }

  const updated = await prisma.boardMember.update({
    where: { id: membership.id },
    data: { role: input.role },
    include: { user: { select: MEMBER_USER_SELECT } },
  });

  await notify({
    recipients: [targetUserId],
    actorId,
    type: 'board.role.changed',
    boardId,
    data: { boardName: board.name, role: input.role },
  });

  emitToBoard(boardId, 'board:members-changed');
  return updated;
}

export async function removeBoardMember(
  actorId: string,
  boardId: string,
  targetUserId: string
) {
  const board = await assertBoardManage(actorId, boardId);

  const membership = await prisma.boardMember.findFirst({
    where: { boardId, userId: targetUserId, deletedAt: null },
  });
  if (!membership) {
    throw new AppError('Nguoi nay khong phai thanh vien cua bang', 404);
  }
  if (membership.role === 'OWNER') {
    throw new AppError('Khong the xoa chu bang khoi bang', 400);
  }
  // Cho phep tu roi bang (targetUserId === actorId) hoac quan tri vien xoa nguoi khac

  // Xoa mem quan he thanh vien VA don sach moi lien ket con lai giup nguoi bi
  // thu hoi quyen tiep tuc nhan du lieu cua bang:
  //  - CardMember: van bi chon lam nguoi nhan thong bao (ten the, binh luan...)
  //    va van keo the vao muc "The cua toi"
  //  - BoardJoinRequest PENDING cu: tranh trang thai treo
  await prisma.$transaction([
    prisma.boardMember.update({
      where: { id: membership.id },
      data: { deletedAt: new Date() },
    }),
    prisma.cardMember.deleteMany({
      where: { userId: targetUserId, card: { list: { boardId } } },
    }),
    prisma.boardJoinRequest.deleteMany({
      where: { boardId, userId: targetUserId, status: 'PENDING' },
    }),
  ]);

  emitToBoard(boardId, 'board:members-changed');
  // Nguoi bi xoa: day ra khoi bang ngay (neu dang mo) + lam moi danh sach bang
  emitToUser(targetUserId, 'board:removed', { boardId });
  emitToUser(targetUserId, 'board:access-changed');
  // Buoc roi phong Socket.IO cua bang o phia server -> khong con nhan duoc
  // su kien/presence cua bang nay du client co lam theo 'board:removed' hay khong.
  void evictUserFromBoardRoom(targetUserId, boardId);

  // Chi bao khi bi nguoi khac xoa (khong bao khi tu roi bang)
  if (targetUserId !== actorId) {
    await notify({
      recipients: [targetUserId],
      actorId,
      type: 'board.member.removed',
      boardId,
      data: { boardName: board.name },
    });
  }
}

// Chuyen quyen so huu bang cho 1 thanh vien khac.
// Chu bang hien tai -> ha xuong Quan tri vien; thanh vien duoc chon -> Chu bang.
export async function transferOwnership(
  actorId: string,
  boardId: string,
  targetUserId: string
) {
  const board = await assertBoardOwner(actorId, boardId);

  if (targetUserId === actorId) {
    throw new AppError('Ban da la chu bang', 400);
  }

  const target = await prisma.boardMember.findFirst({
    where: { boardId, userId: targetUserId, deletedAt: null },
  });
  if (!target) {
    throw new AppError('Nguoi nay khong phai thanh vien cua bang', 404);
  }

  await prisma.$transaction([
    prisma.board.update({
      where: { id: boardId },
      data: { ownerId: targetUserId },
    }),
    prisma.boardMember.update({
      where: { boardId_userId: { boardId, userId: targetUserId } },
      data: { role: 'OWNER' },
    }),
    prisma.boardMember.updateMany({
      where: { boardId, userId: actorId },
      data: { role: 'ADMIN' },
    }),
  ]);

  await notify({
    recipients: [targetUserId],
    actorId,
    type: 'board.ownership.transferred',
    boardId,
    data: { boardName: board.name },
  });

  emitToBoard(boardId, 'board:members-changed');
  emitToBoard(boardId, 'board:meta-changed');
}
