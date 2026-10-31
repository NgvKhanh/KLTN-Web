import type { z } from 'zod';
import { prisma } from '../../../../config/prisma';
import type { aggregateInputSchema } from '../chat.v2.schema';
import type { ExecutionContext } from '../chat.v2.scope';
import { buildTaskWhere, pageMeta } from '../chat.v2.query';
import { vietnamDay } from '../chat.v2.dates';
import { percentOf } from './getBoardOverview';

interface Group { id: string; label: string; count: number }
export async function aggregateTasks(ctx: ExecutionContext, input: z.infer<typeof aggregateInputSchema>) {
  const where = await buildTaskWhere(ctx, input.filters);
  return prisma.$transaction(async (tx) => {
    const totalCards = await tx.card.count({ where });
    // Phase 4: ty le hoan thanh chi co nghia khi tap loc co CA viec da xong (completion = ALL); con lai de null thay vi tra mot con so sai
    const doneCards = input.filters.completion === 'ALL' ? await tx.card.count({ where: { AND: [where, { isDone: true }] } }) : null;
    const donePercent = doneCards === null ? null : percentOf(doneCards, totalCards);
    let rows: Group[] = [];
    let outsideAssignments = 0;
    let deletedAccountAssignments = 0;
    let unassignedCards = 0;
    if (input.groupBy === 'ASSIGNEE') {
      const groups = await tx.cardMember.groupBy({ by: ['userId'], where: { card: where }, _count: { _all: true } });
      const counts = new Map(groups.map((g) => [g.userId, g._count._all]));
      const roster = new Set(ctx.roster.map((m) => m.userId));
      const outsiders = groups.filter((g) => !roster.has(g.userId));
      const deleted = new Set((await tx.user.findMany({ where: { id: { in: outsiders.map((g) => g.userId) }, deletedAt: { not: null } }, select: { id: true } })).map((u) => u.id));
      for (const g of outsiders) {
        if (deleted.has(g.userId)) deletedAccountAssignments += g._count._all;
        else outsideAssignments += g._count._all;
      }
      rows = ctx.roster.map((m) => ({ id: m.userId, label: m.name, count: counts.get(m.userId) ?? 0 }));
      unassignedCards = await tx.card.count({ where: { AND: [where, { members: { none: {} } }] } });
    } else if (input.groupBy === 'BOARD' || input.groupBy === 'COLUMN') {
      const groups = await tx.card.groupBy({ by: ['listId'], where, _count: { _all: true } });
      const lists = await tx.list.findMany({ where: { id: { in: groups.map((g) => g.listId) } }, select: { id: true, name: true, board: { select: { id: true, name: true } } } });
      const listOf = new Map(lists.map((l) => [l.id, l]));
      const totals = new Map<string, Group>();
      for (const g of groups) {
        const l = listOf.get(g.listId)!;
        const id = input.groupBy === 'BOARD' ? l.board.id : l.id;
        const label = input.groupBy === 'BOARD' ? l.board.name : `${l.name} (${l.board.name})`;
        const row = totals.get(id) ?? { id, label, count: 0 };
        row.count += g._count._all;
        totals.set(id, row);
      }
      rows = [...totals.values()];
    } else if (input.groupBy === 'STATUS') {
      rows = (await tx.card.groupBy({ by: ['status'], where, _count: { _all: true } }))
        .map((g) => ({ id: g.status, label: g.status, count: g._count._all }));
    } else {
      const field = input.dateField === 'DUE' ? 'dueDate' : input.dateField === 'COMPLETED' ? 'completedAt' : 'createdAt';
      const groups = await tx.card.groupBy({ by: [field], where, _count: { _all: true } });
      const totals = new Map<string, Group>();
      for (const g of groups) {
        const day = g[field] ? vietnamDay(g[field]!) : 'NONE';
        const row = totals.get(day) ?? { id: day, label: day === 'NONE' ? 'Chưa đặt ngày' : day, count: 0 };
        row.count += g._count._all;
        totals.set(day, row);
      }
      rows = [...totals.values()];
    }
    rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'vi') || a.id.localeCompare(b.id));
    const highestCount = rows[0]?.count ?? 0;
    return {
      ...pageMeta(rows.length, input.page, input.pageSize), totalCards, groupBy: input.groupBy,
      doneCards, donePercent, highestCount, leaderIds: highestCount === 0 ? [] : rows.filter((r) => r.count === highestCount).map((r) => r.id),
      rows: rows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize),
      outsideAssignments, deletedAccountAssignments, unassignedCards,
      assignmentCounting: 'Một thẻ giao nhiều người được tính cho mỗi người; tổng lượt giao khác tổng thẻ duy nhất.',
    };
  }, { isolationLevel: 'RepeatableRead' });
}
