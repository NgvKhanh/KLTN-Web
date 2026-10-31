import { prisma } from '../../../../config/prisma';
import type { z } from 'zod';
import type { tasksInputSchema } from '../chat.v2.schema';
import type { ExecutionContext } from '../chat.v2.scope';
import { buildTaskWhere, TASK_SELECT, taskView, pageMeta } from '../chat.v2.query';

export async function queryTasks(ctx: ExecutionContext, input: z.infer<typeof tasksInputSchema>) {
  const where = await buildTaskWhere(ctx, input.filters);
  const [total, rows] = await prisma.$transaction([
    prisma.card.count({ where }),
    prisma.card.findMany({
      where, select: TASK_SELECT, skip: (input.page - 1) * input.pageSize, take: input.pageSize,
      orderBy: input.sort === 'DUE_ASC' ? [{ dueDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'asc' }],
    }),
  ], { isolationLevel: 'RepeatableRead' });
  return { ...pageMeta(total, input.page, input.pageSize), cards: rows.map((r) => taskView(r, ctx.now)) };
}
