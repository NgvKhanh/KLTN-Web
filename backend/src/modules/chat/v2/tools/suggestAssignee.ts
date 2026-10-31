// "Ai phu hop nhat cho viec nay?" (Phase 6; CHATBOT_V2_ACTIONS_PLAN.md PL-D). GOI LAI suggestForCard cua module phan cong, khong viet lai thuat toan.
// Quyen: assertCardAccess ben trong suggestForCard (chi nguoi SUA duoc the; VIEWER / nguoi ngoai bi chan) + the phai thuoc pham vi cua trang.
// Chi tra thu hang: tong, ten, diem tuong doi, muc tin cay, co (qua tai / tam nghi...), tai hien tai. KHONG tra: bang chung (tieu de the cu), ho so tu khai,
// CV (`cvAvailable`), thanh phan diem, email - dung nhung gi mot nguoi sua duoc the duoc thay, nhung toi thieu hon nhieu (§8.2).
import type { z } from 'zod';
import { prisma } from '../../../../config/prisma';
import { AppError } from '../../../../utils/AppError';
import { suggestForCard } from '../../../assign/assign.service';
import { RATE_TEXT, takeAssignBudget } from '../actions/actions.assign';
import { assertCardIds } from '../chat.v2.query';
import type { suggestAssigneeInputSchema } from '../chat.v2.schema';
import type { ExecutionContext } from '../chat.v2.scope';

export async function suggestAssignee(ctx: ExecutionContext, input: z.infer<typeof suggestAssigneeInputSchema>) {
  await assertCardIds(ctx, [input.cardId]);
  if (!takeAssignBudget('SUGGEST', ctx.scope.userId, ctx.now.getTime())) throw new AppError(RATE_TEXT, 429);
  const result = await suggestForCard(ctx.scope.userId, input.cardId, ctx.now);
  const where = await prisma.card.findUniqueOrThrow({ where: { id: input.cardId }, select: { list: { select: { name: true, board: { select: { id: true, name: true } } } } } });
  return {
    card: { id: result.card.id, title: result.card.title, boardId: where.list.board.id, boardName: where.list.board.name, columnName: where.list.name },
    candidateCount: result.candidateCount,
    candidates: result.candidates.slice(0, input.top).map((c) => ({
      rank: c.rank,
      user: { id: c.user.id, name: c.user.name },
      score: c.score === null ? null : Math.round(c.score),
      confidenceLevel: c.confidenceLevel,
      flags: [...c.flags],
      assigned: c.assigned,
      load: c.load,
      capacity: c.capacity,
    })),
  };
}
