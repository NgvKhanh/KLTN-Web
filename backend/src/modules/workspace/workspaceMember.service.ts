import { env } from '../../config/env';
import { sendMail } from '../../config/mailer';
import { prisma } from '../../config/prisma';
import { emitToUser, reconcileBoardRoomAccess } from '../../realtime/socket';
import { AppError } from '../../utils/AppError';
import { workspaceInviteEmail } from '../auth/emailTemplates';
import { notify } from '../notification/notification.service';
import {
  assertWorkspaceAccess,
  assertWorkspaceManage,
} from './workspace.service';
import type {
  AddWorkspaceMemberInput,
  ChangeWorkspaceMemberRoleInput,
} from './workspace.schema';

const MEMBER_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
} as const;

function memberRow(data: {
  workspaceId: string;
  userId: string;
  role: 'ADMIN' | 'MEMBER';
}) {
  return prisma.workspaceMember.create({
    data,
    include: { user: { select: MEMBER_USER_SELECT } },
  });
}

// Bao cho moi thanh vien (dang mo trang khong gian) refresh
async function emitWorkspaceChanged(workspaceId: string, extraUserIds: string[] = []) {
  const rows = await prisma.workspaceMember.findMany({
    where: { workspaceId, deletedAt: null },
    select: { userId: true },
  });
  const ids = new Set([...rows.map((r) => r.userId), ...extraUserIds]);
  for (const userId of ids) {
    emitToUser(userId, 'workspace:changed', { workspaceId });
  }
}

export async function listWorkspaceMembers(userId: string, workspaceId: string) {
  await assertWorkspaceAccess(userId, workspaceId);
  return prisma.workspaceMember.findMany({
    where: { workspaceId, deletedAt: null },
    orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    include: { user: { select: MEMBER_USER_SELECT } },
  });
}

export type AddWorkspaceMemberResult =
  | { kind: 'member'; member: Awaited<ReturnType<typeof memberRow>> }
  | { kind: 'invited'; email: string };

async function inviteByEmail(
  actorId: string,
  workspaceName: string,
  email: string
): Promise<AddWorkspaceMemberResult> {
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { name: true },
  });
  const url = `${env.frontendUrl.replace(/\/$/, '')}/register`;
  try {
    const { subject, html } = workspaceInviteEmail({
      inviterName: actor?.name ?? 'Mot thanh vien',
      workspaceName,
      url,
    });
    await sendMail({ to: email, subject, html });
  } catch (err) {
    console.error('[workspace] Gui email moi that bai:', err);
    throw new AppError(
      'Nguoi nay chua co tai khoan va khong gui duoc email moi. Hay thu lai sau.',
      502
    );
  }
  return { kind: 'invited', email };
}

export async function addWorkspaceMember(
  actorId: string,
  workspaceId: string,
  input: AddWorkspaceMemberInput
): Promise<AddWorkspaceMemberResult> {
  const { workspace } = await assertWorkspaceManage(actorId, workspaceId);

  const targetUser = await prisma.user.findFirst({
    where: { email: input.email, deletedAt: null },
    select: { id: true, emailVerifiedAt: true },
  });
  // Chua co tai khoan HOAC tai khoan chua xac minh email (co the la tai khoan chiem
  // cho): gui email moi thay vi cap quyen ngay - xem boardMember.service.ts.
  if (!targetUser || !targetUser.emailVerifiedAt) {
    return inviteByEmail(actorId, workspace.name, input.email);
  }

  const existing = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: targetUser.id } },
  });
  if (existing && existing.deletedAt === null) {
    throw new AppError('Nguoi nay da la thanh vien cua khong gian', 409);
  }

  const member = existing
    ? await prisma.workspaceMember.update({
        where: { id: existing.id },
        data: { deletedAt: null, role: input.role },
        include: { user: { select: MEMBER_USER_SELECT } },
      })
    : await memberRow({ workspaceId, userId: targetUser.id, role: input.role });

  await notify({
    recipients: [targetUser.id],
    actorId,
    type: 'workspace.member.added',
    workspaceId,
    data: { workspaceName: workspace.name },
  });
  await emitWorkspaceChanged(workspaceId, [targetUser.id]);

  return { kind: 'member', member };
}

export async function changeWorkspaceMemberRole(
  actorId: string,
  workspaceId: string,
  targetUserId: string,
  input: ChangeWorkspaceMemberRoleInput
) {
  const { workspace } = await assertWorkspaceManage(actorId, workspaceId);

  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: targetUserId, deletedAt: null },
  });
  if (!membership) {
    throw new AppError('Nguoi nay khong phai thanh vien cua khong gian', 404);
  }
  if (membership.role === 'OWNER') {
    throw new AppError('Khong the doi vai tro cua chu khong gian', 400);
  }

  const updated = await prisma.workspaceMember.update({
    where: { id: membership.id },
    data: { role: input.role },
    include: { user: { select: MEMBER_USER_SELECT } },
  });

  await notify({
    recipients: [targetUserId],
    actorId,
    type: 'workspace.role.changed',
    workspaceId,
    data: { workspaceName: workspace.name, role: input.role },
  });
  await emitWorkspaceChanged(workspaceId);

  return updated;
}

export async function removeWorkspaceMember(
  actorId: string,
  workspaceId: string,
  targetUserId: string
) {
  const isSelf = targetUserId === actorId;
  // Tu roi khong gian -> chi can la thanh vien; xoa nguoi khac -> phai quan ly
  const { workspace } = isSelf
    ? await assertWorkspaceAccess(actorId, workspaceId)
    : await assertWorkspaceManage(actorId, workspaceId);

  const membership = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: targetUserId, deletedAt: null },
  });
  if (!membership) {
    throw new AppError('Nguoi nay khong phai thanh vien cua khong gian', 404);
  }
  if (membership.role === 'OWNER') {
    throw new AppError(
      'Chu khong gian khong the roi. Hay chuyen quyen so huu truoc.',
      400
    );
  }

  await prisma.workspaceMember.update({
    where: { id: membership.id },
    data: { deletedAt: new Date() },
  });

  await emitWorkspaceChanged(workspaceId, [targetUserId]);

  // Thanh vien khong gian con la duong truy cap cho bang muc WORKSPACE (chu
  // khong phai PRIVATE/PUBLIC). Nguoi bi xoa co the dang trong "phong"
  // Socket.IO cua 1 hoac nhieu bang nhu vay -> don khoi tat ca cac phong do,
  // khong doi den khi client tu roi.
  const workspaceBoards = await prisma.board.findMany({
    where: { workspaceId, visibility: 'WORKSPACE', deletedAt: null },
    select: { id: true },
  });
  await Promise.all(
    workspaceBoards.map((b) => reconcileBoardRoomAccess(b.id))
  );

  if (!isSelf) {
    await notify({
      recipients: [targetUserId],
      actorId,
      type: 'workspace.member.removed',
      workspaceId,
      data: { workspaceName: workspace.name },
    });
  }
}

export async function transferWorkspaceOwnership(
  actorId: string,
  workspaceId: string,
  targetUserId: string
) {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, deletedAt: null },
  });
  if (!workspace) {
    throw new AppError('Khong tim thay khong gian lam viec', 404);
  }
  if (workspace.ownerId !== actorId) {
    throw new AppError('Chi chu khong gian moi chuyen duoc quyen so huu', 403);
  }
  if (workspace.isPersonal) {
    throw new AppError('Khong the chuyen quyen so huu khong gian ca nhan', 400);
  }
  if (targetUserId === actorId) {
    throw new AppError('Ban da la chu khong gian', 400);
  }

  const target = await prisma.workspaceMember.findFirst({
    where: { workspaceId, userId: targetUserId, deletedAt: null },
  });
  if (!target) {
    throw new AppError('Nguoi nay khong phai thanh vien cua khong gian', 404);
  }

  await prisma.$transaction([
    prisma.workspace.update({
      where: { id: workspaceId },
      data: { ownerId: targetUserId },
    }),
    prisma.workspaceMember.update({
      where: { workspaceId_userId: { workspaceId, userId: targetUserId } },
      data: { role: 'OWNER' },
    }),
    prisma.workspaceMember.updateMany({
      where: { workspaceId, userId: actorId },
      data: { role: 'ADMIN' },
    }),
  ]);

  await notify({
    recipients: [targetUserId],
    actorId,
    type: 'workspace.ownership.transferred',
    workspaceId,
    data: { workspaceName: workspace.name },
  });
  await emitWorkspaceChanged(workspaceId);
}
