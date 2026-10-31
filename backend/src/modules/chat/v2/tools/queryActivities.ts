import type { z } from 'zod';
import type { Prisma } from '../../../../generated/prisma/client';
import { prisma } from '../../../../config/prisma';
import type { activitiesInputSchema } from '../chat.v2.schema';
import type { ExecutionContext } from '../chat.v2.scope';
import { assertCardIds, buildHistoryWhere, buildTaskWhere, pageMeta } from '../chat.v2.query';

const SELECT = {
  id: true, boardId: true, cardId: true, type: true, createdAt: true, data: true,
  user: { select: { id: true, name: true, deletedAt: true } },
  card: { select: { id: true, title: true, deletedAt: true, list: { select: { boardId: true, deletedAt: true } } } },
} satisfies Prisma.ActivitySelect;
type ActivityRow = Prisma.ActivityGetPayload<{ select: typeof SELECT }>;
/** Explicit event fields only; never forward arbitrary Activity.data or moved/deleted card snapshots. */
function safeData(row: ActivityRow, canReadCard: boolean): Record<string, string | null> {
  if (!canReadCard || typeof row.data !== 'object' || row.data === null || Array.isArray(row.data)) return {};
  const source = row.data as Record<string, unknown>;
  const fields: Record<string, string[]> = {
    'card.rename': ['from', 'to'], 'card.status': ['from', 'to'], 'card.done': ['from', 'to'], 'card.undone': ['from', 'to'],
    'card.due.set': ['from', 'to', 'dueDate'], 'card.due.clear': ['from', 'to'],
    // A cross-board move can expose a private source column; report destination only.
    'card.move': ['toList'],
  };
  const result: Record<string, string | null> = {};
  for (const key of fields[row.type] ?? []) {
    if (source[key] === null || typeof source[key] === 'string') result[key] = source[key] === null ? null : (source[key] as string).slice(0, 1000);
  }
  return result;
}
function view(row: ActivityRow, ctx: ExecutionContext) {
  const visible = row.card !== null && row.card.deletedAt === null && row.card.list.deletedAt === null && row.card.list.boardId === row.boardId;
  const data = safeData(row, visible);
  if (visible && (row.type === 'member.add' || row.type === 'member.remove') && typeof row.data === 'object' && row.data !== null && !Array.isArray(row.data)) {
    const memberId = (row.data as Record<string, unknown>).memberId;
    const member = ctx.roster.find((m) => m.userId === memberId);
    if (member) { data.memberId = member.userId; data.memberName = member.name; }
  }
  return {
    id: row.id, boardId: row.boardId, cardId: row.cardId, cardTitle: visible ? row.card!.title : null,
    redacted: !visible, type: row.type, createdAt: row.createdAt.toISOString(),
    actor: row.user.deletedAt === null ? { id: row.user.id, name: row.user.name } : null,
    data,
  };
}
export async function queryActivities(ctx: ExecutionContext, input: z.infer<typeof activitiesInputSchema>) {
  await assertCardIds(ctx, input.cardIds, true);
  const parts: Prisma.ActivityWhereInput[] = [await buildHistoryWhere(ctx, input)];
  if (input.cardIds) parts.push({ cardId: { in: input.cardIds } });
  if (input.taskFilters) parts.push({ card: await buildTaskWhere(ctx, input.taskFilters) });
  const where: Prisma.ActivityWhereInput = { AND: parts };
  return prisma.$transaction(async (tx) => {
    const eventCount = await tx.activity.count({ where });
    const groups = await tx.activity.groupBy({ by: ['cardId'], where: { AND: [where, { cardId: { not: null } }] }, _count: { _all: true }, _max: { createdAt: true } });
    const changedCardCount = groups.length;
    if (input.mode === 'EVENTS') {
      const rows = await tx.activity.findMany({ where, select: SELECT, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (input.page - 1) * input.pageSize, take: input.pageSize });
      return { ...pageMeta(eventCount, input.page, input.pageSize), mode: input.mode, eventCount, changedCardCount, events: rows.map((r) => view(r, ctx)), cards: [], coverage: 'Theo nhật ký đã ghi nhận; dữ liệu cũ có thể thiếu giá trị trước thay đổi.' };
    }
    const ordered = groups.sort((a, b) => b._max.createdAt!.getTime() - a._max.createdAt!.getTime() || a.cardId!.localeCompare(b.cardId!));
    const selected = ordered.slice((input.page - 1) * input.pageSize, input.page * input.pageSize);
    const cards = await Promise.all(selected.map(async (g) => {
      const events = (await tx.activity.findMany({ where: { AND: [where, { cardId: g.cardId! }] }, select: SELECT, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 5 })).map((r) => view(r, ctx));
      return { id: g.cardId!, title: events[0]?.cardTitle ?? null, eventCount: g._count._all, lastChangedAt: g._max.createdAt!.toISOString(), events, eventsTruncated: g._count._all > events.length };
    }));
    return { ...pageMeta(changedCardCount, input.page, input.pageSize), mode: input.mode, eventCount, changedCardCount, events: [], cards, coverage: 'Theo nhật ký đã ghi nhận; dữ liệu cũ có thể thiếu giá trị trước thay đổi.' };
  }, { isolationLevel: 'RepeatableRead' });
}
