// Tong quan MOT bang: cot, tien do, qua han, bi chan, nhan, nguoi (CHATBOT_V2_ACTIONS_PLAN.md §8.2, Phase 4). Chi DOC, chay duoi tran pham vi.
// Moi con so do SERVER dem tren toan bo the con song cua bang (khong de mo hinh tu cong): "bao nhieu %" la phep chia o day, khong phai chu AI viet.
import type { z } from 'zod';
import { prisma } from '../../../../config/prisma';
import { AppError } from '../../../../utils/AppError';
import { liveCardWhere } from '../../chat.scope';
import type { boardOverviewInputSchema } from '../chat.v2.schema';
import type { ExecutionContext } from '../chat.v2.scope';

export const NEED_BOARD = 'Hãy mở hoặc nêu tên một bảng cụ thể để xem phần này.';

/** Ty le phan tram nguyen (lam tron), null khi chua co the nao (khong chia cho 0). */
export const percentOf = (part: number, total: number): number | null => (total === 0 ? null : Math.round((part / total) * 100));

/** Bang cua pham vi hien tai; pham vi MY / WORKSPACE khong xac dinh duoc mot bang -> loi nhe nhang yeu cau chon bang. */
export function requireBoard(ctx: ExecutionContext): { id: string; name: string } {
  const board = ctx.scope.kind === 'BOARD' ? ctx.scope.board : null;
  if (!board) throw new AppError(NEED_BOARD, 400);
  return { id: board.id, name: board.name };
}

/** So the con song theo tung cot cua bang (the da luu tru / xoa va cot da luu tru khong tinh). */
export async function listStats(ctx: ExecutionContext, boardId: string) {
  const lists = await prisma.list.findMany({ where: { boardId, deletedAt: null, archivedAt: null }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true, name: true, status: true } });
  const groups = lists.length === 0 ? [] : await prisma.card.groupBy({ by: ['listId', 'isDone'], where: { AND: [liveCardWhere(ctx.scope.boardWhere), { listId: { in: lists.map((l) => l.id) } }] }, _count: { _all: true } });
  return lists.map((l) => {
    const done = groups.filter((g) => g.listId === l.id && g.isDone).reduce((n, g) => n + g._count._all, 0);
    const open = groups.filter((g) => g.listId === l.id && !g.isDone).reduce((n, g) => n + g._count._all, 0);
    return { id: l.id, name: l.name, status: l.status, totalCards: done + open, openCards: open, doneCards: done };
  });
}

export async function getBoardOverview(ctx: ExecutionContext, _input: z.infer<typeof boardOverviewInputSchema>) {
  const board = requireBoard(ctx);
  const live = liveCardWhere(ctx.scope.boardWhere);
  const [lists, overdue, blocked, unassigned, labelCount, customFieldCount] = await Promise.all([
    listStats(ctx, board.id),
    prisma.card.count({ where: { AND: [live, { isDone: false, dueDate: { lt: ctx.now } }] } }),
    prisma.card.count({ where: { AND: [live, { isDone: false, status: 'BLOCKED' }] } }),
    prisma.card.count({ where: { AND: [live, { isDone: false, members: { none: {} } }] } }),
    prisma.label.count({ where: { boardId: board.id } }),
    prisma.customField.count({ where: { boardId: board.id } }),
  ]);
  const doneCards = lists.reduce((n, l) => n + l.doneCards, 0);
  const openCards = lists.reduce((n, l) => n + l.openCards, 0);
  const totalCards = doneCards + openCards;
  return {
    board, totalCards, openCards, doneCards, donePercent: percentOf(doneCards, totalCards),
    overdueCards: overdue, blockedCards: blocked, unassignedOpenCards: unassigned,
    listCount: lists.length, labelCount, memberCount: ctx.roster.length, customFieldCount, lists,
  };
}
