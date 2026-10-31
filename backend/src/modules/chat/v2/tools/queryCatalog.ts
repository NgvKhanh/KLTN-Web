import type { z } from 'zod';
import { prisma } from '../../../../config/prisma';
import { listChoosableWorkspaces } from '../../chat.scope';
import { workspaceRoleOf } from '../../../workspace/workspace.service';
import type { catalogInputSchema } from '../chat.v2.schema';
import type { ExecutionContext } from '../chat.v2.scope';
import { pageMeta } from '../chat.v2.query';
import { listStats, requireBoard } from './getBoardOverview';

export async function queryCatalog(ctx: ExecutionContext, input: z.infer<typeof catalogInputSchema>) {
  const skip = (input.page - 1) * input.pageSize;
  // Phase 4: cau truc cua MOT bang (can pham vi BOARD; cac hang chi gom ten / so dem, khong co noi dung the)
  if (input.kind === 'LISTS') {
    const board = requireBoard(ctx);
    const all = await listStats(ctx, board.id);
    return { kind: input.kind, ...pageMeta(all.length, input.page, input.pageSize), rows: all.slice(skip, skip + input.pageSize) };
  }
  if (input.kind === 'LABELS') {
    const board = requireBoard(ctx);
    const [total, labels] = await prisma.$transaction([
      prisma.label.count({ where: { boardId: board.id } }),
      prisma.label.findMany({
        where: { boardId: board.id }, orderBy: [{ name: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], skip, take: input.pageSize,
        select: { id: true, name: true, color: true, _count: { select: { cards: { where: { card: { deletedAt: null, archivedAt: null, list: { deletedAt: null, archivedAt: null } } } } } } },
      }),
    ], { isolationLevel: 'RepeatableRead' });
    return { kind: input.kind, ...pageMeta(total, input.page, input.pageSize), rows: labels.map((l) => ({ id: l.id, name: l.name, color: l.color, cards: l._count.cards })) };
  }
  if (input.kind === 'CUSTOM_FIELDS') {
    const board = requireBoard(ctx);
    const [total, fields] = await prisma.$transaction([
      prisma.customField.count({ where: { boardId: board.id } }),
      prisma.customField.findMany({
        where: { boardId: board.id }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], skip, take: input.pageSize,
        select: { id: true, name: true, type: true, options: { orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { id: true, value: true } } },
      }),
    ], { isolationLevel: 'RepeatableRead' });
    return { kind: input.kind, ...pageMeta(total, input.page, input.pageSize), rows: fields.map((f) => ({ id: f.id, name: f.name, type: f.type, options: f.options })) };
  }
  if (input.kind === 'BOARDS') {
    const [total, boards] = await prisma.$transaction([
      prisma.board.count({ where: ctx.scope.boardWhere }),
      prisma.board.findMany({
        where: ctx.scope.boardWhere, select: { id: true, name: true, ownerId: true, workspace: { select: { id: true, name: true } }, members: { where: { userId: ctx.scope.userId, deletedAt: null }, select: { role: true } } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }], skip, take: input.pageSize,
      }),
    ], { isolationLevel: 'RepeatableRead' });
    return { kind: input.kind, ...pageMeta(total, input.page, input.pageSize), rows: boards.map((b) => ({ id: b.id, name: b.name, workspaceId: b.workspace.id, workspaceName: b.workspace.name, myRole: b.ownerId === ctx.scope.userId ? 'OWNER' : b.members[0]?.role ?? null })) };
  }
  if (input.kind === 'WORKSPACES') {
    const all = (await listChoosableWorkspaces(ctx.scope.userId)).filter((w) => ctx.scope.kind === 'MY' || w.id === ctx.scope.workspace?.id);
    const selected = all.slice(skip, skip + input.pageSize);
    const rows = await Promise.all(selected.map(async (w) => {
      const [myRole, boards, people] = await Promise.all([
        workspaceRoleOf(ctx.scope.userId, w.id),
        prisma.board.count({ where: { AND: [ctx.scope.boardWhere, { workspaceId: w.id }] } }),
        prisma.workspace.findUniqueOrThrow({ where: { id: w.id }, select: { ownerId: true, owner: { select: { deletedAt: true } }, members: { where: { deletedAt: null, user: { deletedAt: null } }, select: { userId: true } } } }),
      ]);
      const ids = new Set(people.members.map((m) => m.userId));
      if (people.owner.deletedAt === null) ids.add(people.ownerId);
      return { id: w.id, name: w.name, myRole, boards, members: ids.size };
    }));
    return { kind: input.kind, ...pageMeta(all.length, input.page, input.pageSize), rows };
  }
  const people = [...ctx.roster].sort((a, b) => a.name.localeCompare(b.name, 'vi') || a.userId.localeCompare(b.userId));
  let roleOf = new Map<string, string>();
  if (ctx.scope.kind === 'BOARD' && ctx.scope.board) {
    roleOf = new Map((await prisma.boardMember.findMany({ where: { boardId: ctx.scope.board.id, deletedAt: null }, select: { userId: true, role: true } })).map((m) => [m.userId, m.role]));
    roleOf.set(ctx.scope.board.ownerId, 'OWNER');
  } else if (ctx.scope.kind === 'WORKSPACE' && ctx.scope.workspace) {
    roleOf = new Map((await prisma.workspaceMember.findMany({ where: { workspaceId: ctx.scope.workspace.id, deletedAt: null }, select: { userId: true, role: true } })).map((m) => [m.userId, m.role]));
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: ctx.scope.workspace.id }, select: { ownerId: true } });
    roleOf.set(ws.ownerId, 'OWNER');
  }
  return { kind: input.kind, ...pageMeta(people.length, input.page, input.pageSize), rows: people.slice(skip, skip + input.pageSize).map((m) => ({ id: m.userId, name: m.name, role: roleOf.get(m.userId) ?? null })) };
}
