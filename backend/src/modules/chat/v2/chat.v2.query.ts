import type { Prisma } from '../../../generated/prisma/client';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../utils/AppError';
import { liveCardWhere } from '../chat.scope';
import { normalizeRange } from './chat.v2.dates';
import { assertRosterIds, type ExecutionContext } from './chat.v2.scope';
import type { HistoryFilter, TaskFilter } from './chat.v2.schema';

export const TASK_SELECT = {
  id: true, title: true, status: true, isDone: true, dueDate: true, completedAt: true, createdAt: true,
  list: { select: { id: true, name: true, board: { select: { id: true, name: true } } } },
  members: { where: { user: { deletedAt: null } }, select: { user: { select: { id: true, name: true } } } },
} satisfies Prisma.CardSelect;
export type TaskRow = Prisma.CardGetPayload<{ select: typeof TASK_SELECT }>;
export function taskView(c: TaskRow, now: Date) {
  return {
    id: c.id, title: c.title, status: c.status, isDone: c.isDone,
    boardId: c.list.board.id, boardName: c.list.board.name, columnId: c.list.id, columnName: c.list.name,
    dueDate: c.dueDate?.toISOString() ?? null, completedAt: c.completedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(), overdue: !c.isDone && c.dueDate !== null && c.dueDate < now,
    assignees: c.members.map((m) => ({ id: m.user.id, name: m.user.name })),
  };
}
export async function buildHistoryWhere(ctx: ExecutionContext, f: HistoryFilter): Promise<Prisma.ActivityWhereInput> {
  assertRosterIds(f.actorIds, ctx);
  const range = normalizeRange(f.range);
  return {
    board: ctx.scope.boardWhere, type: { in: f.types }, createdAt: { gte: range.from, lt: range.to },
    ...(f.actorIds ? { userId: { in: f.actorIds } } : {}),
  };
}
export async function assertCardIds(ctx: ExecutionContext, ids: string[] | undefined, history = false): Promise<void> {
  if (!ids) return;
  const where = history
    ? { deletedAt: null, list: { deletedAt: null, board: ctx.scope.boardWhere } }
    : liveCardWhere(ctx.scope.boardWhere);
  const count = await prisma.card.count({ where: { AND: [where, { id: { in: ids } }] } });
  if (count !== new Set(ids).size) throw new AppError('Không tìm thấy công việc trong phạm vi được phép', 400);
}
/** Shared predicate for lists, aggregates and activity/task intersections. */
export async function buildTaskWhere(ctx: ExecutionContext, f: TaskFilter): Promise<Prisma.CardWhereInput> {
  assertRosterIds(f.assigneeIds, ctx);
  await assertCardIds(ctx, f.cardIds);
  if (f.columnIds) {
    const count = await prisma.list.count({ where: { id: { in: f.columnIds }, deletedAt: null, archivedAt: null, board: ctx.scope.boardWhere } });
    if (count !== new Set(f.columnIds).size) throw new AppError('Không tìm thấy cột trong phạm vi được phép', 400);
  }
  if (f.labelIds) {
    const count = await prisma.label.count({ where: { id: { in: f.labelIds }, board: ctx.scope.boardWhere } });
    if (count !== new Set(f.labelIds).size) throw new AppError('Không tìm thấy nhãn trong phạm vi được phép', 400);
  }
  if (f.fieldOptionIds) {
    const count = await prisma.customFieldOption.count({ where: { id: { in: f.fieldOptionIds }, field: { board: ctx.scope.boardWhere } } });
    if (count !== new Set(f.fieldOptionIds).size) throw new AppError('Không tìm thấy giá trị trường tùy chỉnh trong phạm vi được phép', 400);
  }
  const parts: Prisma.CardWhereInput[] = [liveCardWhere(ctx.scope.boardWhere)];
  if (f.completion !== 'ALL') parts.push({ isDone: f.completion === 'DONE' });
  if (f.assignment === 'UNASSIGNED') parts.push({ members: { none: {} } });
  if (f.assignment === 'ASSIGNED') parts.push({ members: { some: {} } });
  if (f.assigneeIds) parts.push({ members: { some: { userId: { in: f.assigneeIds } } } });
  if (f.cardIds) parts.push({ id: { in: f.cardIds } });
  if (f.columnIds) parts.push({ listId: { in: f.columnIds } });
  if (f.labelIds) parts.push({ labels: { some: { labelId: { in: f.labelIds } } } });
  if (f.fieldOptionIds) parts.push({ fieldValues: { some: { optionId: { in: f.fieldOptionIds } } } });
  if (f.statuses) parts.push({ status: { in: f.statuses } });
  if (f.keyword) parts.push({ OR: [{ title: { contains: f.keyword, mode: 'insensitive' } }, { description: { contains: f.keyword, mode: 'insensitive' } }] });
  if (f.overdue) parts.push({ isDone: false, dueDate: { lt: ctx.now } });
  if (f.date) {
    const { from, to } = normalizeRange(f.date.range);
    const field = { DUE: 'dueDate', COMPLETED: 'completedAt', CREATED: 'createdAt' }[f.date.field];
    parts.push({ [field]: { gte: from, lt: to } });
  }
  if (f.changed) parts.push({ activities: { some: await buildHistoryWhere(ctx, f.changed) } });
  return { AND: parts };
}
export function pageMeta(total: number, page: number, pageSize: number) {
  return { total, page, pageSize, hasMore: page * pageSize < total };
}
