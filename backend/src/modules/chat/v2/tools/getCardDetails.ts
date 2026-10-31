// Chi tiet MOT the (CHATBOT_V2_ACTIONS_PLAN.md §8.2, Phase 4). Chi DOC. `select` tuong minh theo danh sach cho phep: khong tra email, khong tra
// noi dung binh luan, khong tra duong dan tep, khong tra id nguoi ngoai danh sach. The phai thuoc pham vi (assertCardIds): the o bang khac /
// khong co quyen cho cung mot loi "khong tim thay" nhu the khong ton tai.
//
// Mo ta the la du lieu do nguoi khac viet: chi dua mot TRICH ngan (<= 300 ky tu, bo ky tu dieu khien) de HIEN cho nguoi dung doc, danh dau
// "chua dang tin"; no KHONG BAO GIO duoc gui cho mo hinh (chat.v2.tools.modelView chi giu `hasDescription` / `descriptionLength`).
import type { z } from 'zod';
import { prisma } from '../../../../config/prisma';
import { liveCardWhere } from '../../chat.scope';
import { cleanText } from '../actions/actions.patch.schema';
import { vietnamDay } from '../chat.v2.dates';
import { assertCardIds } from '../chat.v2.query';
import type { cardDetailsInputSchema } from '../chat.v2.schema';
import type { ExecutionContext } from '../chat.v2.scope';

export const EXCERPT_CHARS = 300;

export async function getCardDetails(ctx: ExecutionContext, input: z.infer<typeof cardDetailsInputSchema>) {
  await assertCardIds(ctx, [input.cardId]);
  const card = await prisma.card.findFirstOrThrow({
    where: { AND: [liveCardWhere(ctx.scope.boardWhere), { id: input.cardId }] },
    select: {
      id: true, title: true, status: true, isDone: true, description: true, startDate: true, dueDate: true, completedAt: true, createdAt: true,
      list: { select: { id: true, name: true, board: { select: { id: true, name: true } } } },
      members: { where: { user: { deletedAt: null } }, select: { user: { select: { id: true, name: true } } } },
      labels: { select: { label: { select: { id: true, name: true, color: true } } } },
      checklists: { select: { items: { select: { isDone: true } } } },
      fieldValues: { select: { textValue: true, numberValue: true, dateValue: true, boolValue: true, field: { select: { id: true, name: true, type: true, position: true } }, option: { select: { value: true } } } },
    },
  });
  const [commentCount, attachmentCount] = await Promise.all([
    prisma.comment.count({ where: { cardId: card.id, deletedAt: null } }),
    prisma.attachment.count({ where: { cardId: card.id } }),
  ]);
  const items = card.checklists.flatMap((c) => c.items);
  const fields = card.fieldValues
    .map((v) => {
      const value =
        v.field.type === 'TEXT' ? v.textValue
        : v.field.type === 'NUMBER' ? (v.numberValue === null ? null : String(v.numberValue))
        : v.field.type === 'DATE' ? (v.dateValue === null ? null : vietnamDay(v.dateValue))
        : v.field.type === 'CHECKBOX' ? (v.boolValue === null ? null : v.boolValue ? 'Có' : 'Không')
        : (v.option?.value ?? null);
      return { position: v.field.position, id: v.field.id, name: v.field.name, type: v.field.type, value: value === null ? '' : cleanText(value, 200) };
    })
    .filter((f) => f.value !== '')
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'vi'))
    .map(({ position: _position, ...f }) => f);
  const description = card.description === null ? '' : cleanText(card.description, 100_000);
  return {
    id: card.id, title: card.title, status: card.status, isDone: card.isDone,
    boardId: card.list.board.id, boardName: card.list.board.name, columnId: card.list.id, columnName: card.list.name,
    startDate: card.startDate?.toISOString() ?? null, dueDate: card.dueDate?.toISOString() ?? null,
    completedAt: card.completedAt?.toISOString() ?? null, createdAt: card.createdAt.toISOString(),
    overdue: !card.isDone && card.dueDate !== null && card.dueDate < ctx.now,
    assignees: card.members.map((m) => ({ id: m.user.id, name: m.user.name })),
    labels: card.labels.map((l) => ({ id: l.label.id, name: l.label.name, color: l.label.color })),
    checklist: { lists: card.checklists.length, done: items.filter((i) => i.isDone).length, total: items.length },
    fields, commentCount, attachmentCount,
    hasDescription: description !== '', descriptionLength: description.length,
    descriptionExcerpt: description === '' ? null : description.slice(0, EXCERPT_CHARS),
  };
}
