import { z } from 'zod';
import { CardStatus } from '../../../generated/prisma/enums';
import { ENTITY_KINDS, EVENT_TYPES } from './chat.v2.schema';
import { BUCKETS, DATA_ENTITIES } from './data/data.fields';

const text = z.string();
const count = z.number().int().nonnegative();
const iso = z.string().datetime();
const person = z.object({ id: text, name: text }).strict();
const page = { total: count, page: z.number().int().positive(), pageSize: z.number().int().positive(), hasMore: z.boolean() };
const task = z.object({
  id: text, title: text, status: z.enum(CardStatus), isDone: z.boolean(), boardId: text, boardName: text,
  columnId: text, columnName: text, dueDate: iso.nullable(), completedAt: iso.nullable(), createdAt: iso,
  overdue: z.boolean(), assignees: z.array(person),
}).strict();
const event = z.object({
  id: text, boardId: text, cardId: text.nullable(), cardTitle: text.nullable(), redacted: z.boolean(),
  type: z.enum(EVENT_TYPES), createdAt: iso, actor: person.nullable(), data: z.record(text, text.nullable()),
}).strict();
const catalog = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('BOARDS'), ...page, rows: z.array(z.object({ id: text, name: text, workspaceId: text, workspaceName: text, myRole: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']).nullable() }).strict()) }).strict(),
  z.object({ kind: z.literal('WORKSPACES'), ...page, rows: z.array(z.object({ id: text, name: text, myRole: z.enum(['OWNER', 'ADMIN', 'MEMBER']).nullable(), boards: count, members: count }).strict()) }).strict(),
  z.object({ kind: z.literal('MEMBERS'), ...page, rows: z.array(z.object({ id: text, name: text, role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']).nullable() }).strict()) }).strict(),
  // Phase 4: cau truc cua MOT bang (can pham vi BOARD)
  z.object({ kind: z.literal('LISTS'), ...page, rows: z.array(z.object({ id: text, name: text, status: z.enum(CardStatus).nullable(), totalCards: count, openCards: count, doneCards: count }).strict()) }).strict(),
  z.object({ kind: z.literal('LABELS'), ...page, rows: z.array(z.object({ id: text, name: text, color: text, cards: count }).strict()) }).strict(),
  z.object({ kind: z.literal('CUSTOM_FIELDS'), ...page, rows: z.array(z.object({ id: text, name: text, type: z.enum(['TEXT', 'NUMBER', 'DATE', 'CHECKBOX', 'DROPDOWN']), options: z.array(z.object({ id: text, value: text }).strict()) }).strict()) }).strict(),
]);
const percent = z.number().int().min(0).max(100);
const boardOverview = z.object({
  board: z.object({ id: text, name: text }).strict(), totalCards: count, openCards: count, doneCards: count, donePercent: percent.nullable(),
  overdueCards: count, blockedCards: count, unassignedOpenCards: count, listCount: count, labelCount: count, memberCount: count, customFieldCount: count,
  lists: z.array(z.object({ id: text, name: text, status: z.enum(CardStatus).nullable(), totalCards: count, openCards: count, doneCards: count }).strict()),
}).strict();
// Phase 6: thu hang ung vien. KHONG co bang chung, ho so, CV, thanh phan diem.
const suggestAssignee = z.object({
  card: z.object({ id: text, title: text, boardId: text, boardName: text, columnName: text }).strict(),
  candidateCount: count,
  candidates: z.array(z.object({
    rank: z.number().int().positive(), user: person, score: z.number().int().min(0).max(100).nullable(), confidenceLevel: z.enum(['THIN', 'FAIR', 'GOOD']),
    flags: z.array(z.enum(['NO_HISTORY', 'NO_SIMILAR', 'NO_PROFILE', 'OVERLOADED', 'PAUSED', 'NO_DATA'])), assigned: z.boolean(), load: count, capacity: count,
  }).strict()),
}).strict();
// Chi tiet mot the. `descriptionExcerpt` chi de HIEN cho nguoi dung (chua dang tin); khong bao gio gui cho mo hinh (xem chat.v2.tools.modelView).
const cardDetails = z.object({
  id: text, title: text, status: z.enum(CardStatus), isDone: z.boolean(), boardId: text, boardName: text, columnId: text, columnName: text,
  startDate: iso.nullable(), dueDate: iso.nullable(), completedAt: iso.nullable(), createdAt: iso, overdue: z.boolean(),
  assignees: z.array(person), labels: z.array(z.object({ id: text, name: text, color: text }).strict()),
  checklist: z.object({ lists: count, done: count, total: count }).strict(),
  fields: z.array(z.object({ id: text, name: text, type: z.enum(['TEXT', 'NUMBER', 'DATE', 'CHECKBOX', 'DROPDOWN']), value: text }).strict()),
  commentCount: count, attachmentCount: count, hasDescription: z.boolean(), descriptionLength: count, descriptionExcerpt: text.nullable(),
}).strict();
// Buoc B: o van ban (mo ta, binh luan...) la du lieu do NGUOI KHAC viet - chi hien nhu chu thuan; xem chat.v2.tools.modelView cho phan gui mo hinh.
const dataCell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const queryData = z.object({
  entity: z.enum(DATA_ENTITIES), mode: z.enum(['ROWS', 'GROUPS']), ...page, matched: count,
  columns: z.array(z.object({ key: text, label: text, type: z.enum(['text', 'number', 'date', 'bool', 'status']) }).strict()),
  rows: z.array(z.object({ id: text, cardId: text.nullable(), boardId: text.nullable(), cells: z.record(text, dataCell) }).strict()),
  groups: z.array(z.object({ id: text.nullable(), label: text, count }).strict()),
  groupBy: text.nullable(), groupLabel: text.nullable(), bucket: z.enum(BUCKETS).nullable(), highestCount: count, topGroups: count,
}).strict();
export const TOOL_OUTPUT_SCHEMAS = {
  resolve_entities: z.object({ status: z.enum(['RESOLVED', 'CLARIFY', 'NOT_FOUND']), total: count, options: z.array(z.object({ id: text, name: text, kind: z.enum(ENTITY_KINDS), parentName: text.optional() }).strict()), truncated: z.boolean() }).strict(),
  query_catalog: catalog,
  query_tasks: z.object({ ...page, cards: z.array(task) }).strict(),
  aggregate_tasks: z.object({
    ...page, totalCards: count, groupBy: z.enum(['ASSIGNEE', 'BOARD', 'COLUMN', 'STATUS', 'DATE']), highestCount: count,
    // Phase 4: chi co khi bo loc tinh CA viec da xong (completion = ALL); con lai null vi khong the tinh ty le tren mot tap da bo viec xong
    doneCards: count.nullable(), donePercent: percent.nullable(),
    leaderIds: z.array(text), rows: z.array(z.object({ id: text, label: text, count }).strict()), outsideAssignments: count,
    deletedAccountAssignments: count, unassignedCards: count, assignmentCounting: text,
  }).strict(),
  query_activities: z.object({
    ...page, mode: z.enum(['EVENTS', 'CHANGED_CARDS']), eventCount: count, changedCardCount: count, events: z.array(event),
    cards: z.array(z.object({ id: text, title: text.nullable(), eventCount: count, lastChangedAt: iso, events: z.array(event), eventsTruncated: z.boolean() }).strict()), coverage: text,
  }).strict(),
  get_board_overview: boardOverview,
  get_card_details: cardDetails,
  suggest_assignee: suggestAssignee,
  query_data: queryData,
} as const;
