import { z } from 'zod';
import { CardStatus } from '../../../generated/prisma/enums';
import { chatScopeSchema } from '../chat.schema';
import { BUCKETS, DATA_COLUMN_NAMES, DATA_ENTITIES, DATA_FILTER_NAMES, DATA_GROUP_NAMES, DATA_OPS, DATA_SORT_NAMES } from './data/data.fields';

export const CHANGE_TYPES = [
  'card.move', 'card.rename', 'card.done', 'card.undone', 'card.status',
  'card.due.set', 'card.due.clear', 'member.add', 'member.remove',
  'card.archive', 'card.restore',
] as const;
export const EVENT_TYPES = [...CHANGE_TYPES, 'card.create', 'comment.create', 'checklist.add', 'attachment.add', 'ai.board.create'] as const;
// Phase 4: them CUSTOM_FIELD (truong tuy chinh, vd "Uu tien") va FIELD_OPTION (mot lua chon cua truong, vd "Cao") de hoi theo gia tri truong.
export const ENTITY_KINDS = ['BOARD', 'WORKSPACE', 'CARD', 'COLUMN', 'MEMBER', 'LABEL', 'CUSTOM_FIELD', 'FIELD_OPTION'] as const;
const id = z.string().trim().min(1).max(128);
const ids = z.array(id).min(1).max(100);
const date = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.string().datetime({ offset: true })]);
export const dateRangeSchema = z.object({ from: date, to: date }).strict();
const historyFields = {
  types: z.array(z.enum(EVENT_TYPES)).min(1).max(EVENT_TYPES.length).default([...CHANGE_TYPES]),
  actorIds: ids.optional(),
  range: dateRangeSchema,
};
export const historyFilterSchema = z.object(historyFields).strict();
export const taskFilterSchema = z.object({
  completion: z.enum(['OPEN', 'DONE', 'ALL']).default('OPEN'),
  assignment: z.enum(['ANY', 'ASSIGNED', 'UNASSIGNED']).default('ANY'),
  assigneeIds: ids.optional(),
  cardIds: ids.optional(),
  columnIds: ids.optional(),
  labelIds: ids.optional(),
  /** Phase 4: loc theo gia tri cua truong tuy chinh dang lua chon (vd "Uu tien = Cao"); id lay tu resolve_entities FIELD_OPTION. */
  fieldOptionIds: ids.optional(),
  statuses: z.array(z.enum(CardStatus)).min(1).max(5).optional(),
  keyword: z.string().trim().min(1).max(200).optional(),
  overdue: z.boolean().default(false),
  date: z.object({ field: z.enum(['DUE', 'COMPLETED', 'CREATED']), range: dateRangeSchema }).strict().optional(),
  changed: historyFilterSchema.optional(),
}).strict().superRefine((v, ctx) => {
  if (v.assignment === 'UNASSIGNED' && v.assigneeIds) ctx.addIssue({ code: 'custom', message: 'Không kết hợp chưa giao với người phụ trách' });
  if (v.overdue && v.completion === 'DONE') ctx.addIssue({ code: 'custom', message: 'Việc đã xong không được tính là quá hạn' });
  if (v.completion === 'OPEN' && v.statuses?.includes('DONE')) ctx.addIssue({ code: 'custom', message: 'Trạng thái DONE mâu thuẫn với chưa hoàn thành' });
  if (v.completion === 'DONE' && v.statuses?.some((s) => s !== 'DONE')) ctx.addIssue({ code: 'custom', message: 'Trạng thái mâu thuẫn với hoàn thành' });
});
const pageFields = { page: z.number().int().min(1).max(1000).default(1), pageSize: z.number().int().min(1).max(100).default(20) };
export const entityInputSchema = z.object({
  kind: z.enum(ENTITY_KINDS), text: z.string().trim().min(1).max(500), scope: chatScopeSchema.optional(),
}).strict();
export const catalogInputSchema = z.object({
  kind: z.enum(['BOARDS', 'WORKSPACES', 'MEMBERS', 'LISTS', 'LABELS', 'CUSTOM_FIELDS']), scope: chatScopeSchema.optional(), ...pageFields,
}).strict();
export const tasksInputSchema = z.object({
  scope: chatScopeSchema.optional(), filters: taskFilterSchema.default(() => taskFilterSchema.parse({})),
  sort: z.enum(['DUE_ASC', 'CREATED_DESC']).default('DUE_ASC'), ...pageFields,
}).strict();
export const aggregateInputSchema = z.object({
  scope: chatScopeSchema.optional(), filters: taskFilterSchema.default(() => taskFilterSchema.parse({})),
  groupBy: z.enum(['ASSIGNEE', 'BOARD', 'COLUMN', 'STATUS', 'DATE']),
  dateField: z.enum(['DUE', 'COMPLETED', 'CREATED']).default('DUE'), ...pageFields,
}).strict();
export const activitiesInputSchema = z.object({
  scope: chatScopeSchema.optional(), ...historyFields, cardIds: ids.optional(),
  mode: z.enum(['EVENTS', 'CHANGED_CARDS']).default('EVENTS'),
  taskFilters: taskFilterSchema.optional(), ...pageFields,
}).strict().superRefine((v, ctx) => {
  if (v.taskFilters?.changed) ctx.addIssue({ code: 'custom', message: 'Không lồng bộ lọc lịch sử trong bộ lọc lịch sử' });
});
// Phase 4: tong quan mot bang (cot, tien do, qua han, bi chan...) va chi tiet mot the. Ca hai chi DOC, chay duoi tran pham vi nhu moi cong cu doc.
export const boardOverviewInputSchema = z.object({ scope: chatScopeSchema.optional() }).strict();
export const cardDetailsInputSchema = z.object({ cardId: id, scope: chatScopeSchema.optional() }).strict();
// Phase 6: xep hang ung vien cho MOT the bang module goi y phan cong (chi nguoi sua duoc the). Chi tra hang / diem / tin cay / co; khong co bang chung hay CV.
export const suggestAssigneeInputSchema = z.object({ cardId: id, top: z.number().int().min(1).max(5).default(3), scope: chatScopeSchema.optional() }).strict();
// Buoc B: truy van tong quat. Moi gia tri la CHUOI (ngay YYYY-MM-DD, true/false, id): kieu that do server doc theo truong, nen luoc do gui Gemini don gian
// (khong union nhieu kieu). Truong nao thuoc thuc the nao duoc kiem luc chay (queryData), khong the kiem o day vi ten truong dung chung giua cac thuc the.
const dataConditionSchema = z.object({
  field: z.enum(DATA_FILTER_NAMES), op: z.enum(DATA_OPS),
  value: z.string().trim().min(1).max(500).optional(),
  values: z.array(z.string().trim().min(1).max(128)).min(1).max(50).optional(),
}).strict();
export const queryDataInputSchema = z.object({
  entity: z.enum(DATA_ENTITIES), scope: chatScopeSchema.optional(),
  where: z.array(dataConditionSchema).max(8).default([]),
  search: z.string().trim().min(1).max(200).optional(),
  fields: z.array(z.enum(DATA_COLUMN_NAMES)).min(1).max(8).optional(),
  orderBy: z.array(z.object({ field: z.enum(DATA_SORT_NAMES), dir: z.enum(['ASC', 'DESC']).default('ASC') }).strict()).max(2).default([]),
  groupBy: z.enum(DATA_GROUP_NAMES).optional(), bucket: z.enum(BUCKETS).optional(), ...pageFields,
}).strict().superRefine((v, ctx) => {
  if (v.groupBy && v.fields) ctx.addIssue({ code: 'custom', message: 'groupBy trả về số đếm theo nhóm nên không kèm fields' });
  if (v.groupBy && v.orderBy.length) ctx.addIssue({ code: 'custom', message: 'groupBy luôn xếp nhóm theo số lượng giảm dần nên không kèm orderBy' });
});
export const TOOL_SCHEMAS = {
  resolve_entities: entityInputSchema, query_catalog: catalogInputSchema,
  query_tasks: tasksInputSchema, aggregate_tasks: aggregateInputSchema, query_activities: activitiesInputSchema,
  get_board_overview: boardOverviewInputSchema, get_card_details: cardDetailsInputSchema, suggest_assignee: suggestAssigneeInputSchema,
  query_data: queryDataInputSchema,
} as const;
export type ToolName = keyof typeof TOOL_SCHEMAS;
export type TaskFilter = z.infer<typeof taskFilterSchema>;
export type HistoryFilter = z.infer<typeof historyFilterSchema>;
export type DateRangeInput = z.infer<typeof dateRangeSchema>;
