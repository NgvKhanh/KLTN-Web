// DANH MỤC TRƯỜNG ĐƯỢC PHÉP của công cụ `query_data` (chatbot v2, bước B).
//
// Ý tưởng: thay vì mỗi câu hỏi mới lại cần một công cụ riêng, mô hình khai một TRUY VẤN CÓ CẤU TRÚC (thực thể, điều kiện, cột, sắp xếp, nhóm)
// và backend dịch sang Prisma. Mô hình KHÔNG viết SQL, KHÔNG biết tên bảng/cột thật của CSDL: chỉ chọn trong danh mục này. Mọi thứ không có
// trong danh mục (email, mật khẩu băm, token, CV, đường dẫn tệp, id nội bộ của người khác...) thì không có đường nào để lấy ra.
//
// Quyền: phạm vi bảng (`ctx.scope.boardWhere`, đã áp trần phạm vi theo trang) luôn được AND vào MỌI truy vấn ở `scope()` của từng thực thể -
// không có điều kiện nào của mô hình gỡ được nó. Id tham chiếu (người, bảng, cột, nhãn, thẻ) cũng được kiểm lại nằm trong phạm vi.
import type { Prisma } from '../../../../generated/prisma/client';
import { AppError } from '../../../../utils/AppError';
import { STATUS_LABEL } from '../../../card/cardStatus';
import { liveCardWhere } from '../../chat.scope';
import { normalizeRange, vietnamDay } from '../chat.v2.dates';

export const DATA_ENTITIES = ['CARD', 'COMMENT', 'CHECKLIST_ITEM', 'ATTACHMENT'] as const;
export type DataEntity = (typeof DATA_ENTITIES)[number];
export const ENTITY_LABEL: Record<DataEntity, string> = { CARD: 'Công việc', COMMENT: 'Bình luận', CHECKLIST_ITEM: 'Mục checklist', ATTACHMENT: 'Tệp đính kèm' };

export const DATA_OPS = ['EQ', 'NE', 'IN', 'CONTAINS', 'BEFORE', 'ON_OR_AFTER', 'BETWEEN', 'GT', 'LT', 'IS_NULL', 'NOT_NULL'] as const;
export type DataOp = (typeof DATA_OPS)[number];
export const BUCKETS = ['DAY', 'WEEK', 'MONTH'] as const;
export type Bucket = (typeof BUCKETS)[number];
export type Cell = string | number | boolean | null;
export type ColumnType = 'text' | 'number' | 'date' | 'bool' | 'status';
export type RefKind = 'USER' | 'BOARD' | 'LIST' | 'LABEL' | 'CARD';
type FilterKind = 'string' | 'text' | 'enum' | 'bool' | 'date' | 'number' | 'ref';

/** Tối đa ký tự của một ô văn bản hiện cho người dùng (mô tả / bình luận dài bị cắt, có dấu …). */
export const MAX_CELL_CHARS = 500;
export const DELETED_USER = 'Tài khoản đã xóa';
const STATUS_VALUES = Object.keys(STATUS_LABEL) as string[];

export interface Parsed { one?: string | number | boolean | Date; many?: Array<string | number>; range?: { from: Date; to: Date } }
export interface FilterDef {
  kind: FilterKind;
  ops: readonly DataOp[];
  enumValues?: readonly string[];
  ref?: RefKind;
  hint: string;
  where(op: DataOp, v: Parsed): Record<string, unknown>;
}
export interface ColumnDef<R> { label: string; type: ColumnType; needs: readonly string[]; value(row: R): Cell }
export interface SortDef { label: string; needs?: never; order(dir: 'asc' | 'desc'): Record<string, unknown> }
export interface GroupDef<R> { label: string; needs: readonly string[]; date?: { of(row: R): Date | null }; keys(row: R, bucket?: Bucket): Array<{ id: string | null; label: string }> }
export interface EntityDef<R> {
  label: string;
  /** Điều kiện luôn có: chỉ bản ghi thuộc thẻ "còn sống" trong các bảng đọc được. */
  scope(boardWhere: Prisma.BoardWhereInput): Record<string, unknown>;
  searchFields: readonly string[];
  select: Record<string, unknown>;
  defaultColumns: readonly string[];
  /** Khoá `select` cần để dựng liên kết (cardId / boardId) của mỗi hàng. */
  linkNeeds: readonly string[];
  /** Thứ tự khi mô hình không chọn (luôn có thêm id làm khoá phụ để phân trang ổn định). */
  defaultOrder: Record<string, unknown>[];
  filters: Record<string, FilterDef>;
  columns: Record<string, ColumnDef<R>>;
  sorts: Record<string, SortDef>;
  groups: Record<string, GroupDef<R>>;
  links(row: R): { cardId: string | null; boardId: string | null };
  rowId(row: R): string;
  count(tx: Prisma.TransactionClient, where: Record<string, unknown>): Promise<number>;
  find(tx: Prisma.TransactionClient, args: { where: Record<string, unknown>; select: Record<string, unknown>; orderBy: Record<string, unknown>[]; skip: number; take: number }): Promise<R[]>;
}

// ---------------------------------------------------------------------------------------------------------------------
// Giá trị: chuỗi do mô hình gửi -> kiểu thật. Sai kiểu / ngoài danh sách là lỗi 400 nói rõ, không đoán.
// ---------------------------------------------------------------------------------------------------------------------
function instant(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return normalizeRange({ from: value, to: value }).from; // đầu ngày theo giờ Việt Nam
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) throw new AppError(`Thời điểm “${value}” không hợp lệ (dùng YYYY-MM-DD hoặc ISO có múi giờ).`, 400);
  return d;
}
function scalarOf(kind: FilterKind, def: FilterDef, raw: string): string | number | boolean | Date {
  if (kind === 'bool') {
    if (raw !== 'true' && raw !== 'false') throw new AppError(`Giá trị luận lý phải là true hoặc false, nhận “${raw}”.`, 400);
    return raw === 'true';
  }
  if (kind === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new AppError(`“${raw}” không phải một số.`, 400);
    return n;
  }
  if (kind === 'date') return instant(raw);
  if (kind === 'enum') {
    const v = raw.toUpperCase();
    if (!def.enumValues?.includes(v)) throw new AppError(`Giá trị “${raw}” không hợp lệ; chỉ nhận ${def.enumValues?.join(', ')}.`, 400);
    return v;
  }
  return raw;
}
/** Đọc `value` / `values` theo kiểu của trường. Ném 400 khi thiếu hoặc thừa tham số so với toán tử. */
export function parseCondition(def: FilterDef, name: string, c: { op: DataOp; value?: string; values?: string[] }): Parsed {
  if (!def.ops.includes(c.op)) throw new AppError(`Trường “${name}” không hỗ trợ phép ${c.op}; chỉ có ${def.ops.join(', ')}.`, 400);
  if (c.op === 'IS_NULL' || c.op === 'NOT_NULL') return {};
  if (c.op === 'IN') {
    if (!c.values?.length) throw new AppError(`Phép IN của “${name}” cần values.`, 400);
    return { many: c.values.map((v) => scalarOf(def.kind, def, v) as string | number) };
  }
  if (c.op === 'BETWEEN') {
    if (c.values?.length !== 2) throw new AppError(`Phép BETWEEN của “${name}” cần đúng 2 giá trị trong values.`, 400);
    if (def.kind === 'date') return { range: normalizeRange({ from: c.values[0], to: c.values[1] }) };
    return { many: c.values.map((v) => scalarOf(def.kind, def, v) as number) };
  }
  if (c.value === undefined) throw new AppError(`Phép ${c.op} của “${name}” cần value.`, 400);
  return { one: scalarOf(def.kind, def, c.value) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Bộ dựng điều kiện
// ---------------------------------------------------------------------------------------------------------------------
const TEXT_OPS = ['CONTAINS', 'IS_NULL', 'NOT_NULL'] as const;
const STRING_OPS = ['EQ', 'NE', 'IN', 'CONTAINS'] as const;
const DATE_OPS = ['BEFORE', 'ON_OR_AFTER', 'BETWEEN', 'IS_NULL', 'NOT_NULL'] as const;
const NUMBER_OPS = ['EQ', 'GT', 'LT', 'BETWEEN'] as const;
const ENUM_OPS = ['EQ', 'NE', 'IN'] as const;
const REF_OPS = ['EQ', 'IN'] as const;

function scalar(kind: FilterKind, col: string, ops: readonly DataOp[], hint: string, extra: Partial<FilterDef> = {}): FilterDef {
  return {
    kind, ops, hint, ...extra,
    where(op, v) {
      switch (op) {
        case 'EQ': return { [col]: v.one };
        case 'NE': return { [col]: { not: v.one } };
        case 'IN': return { [col]: { in: v.many } };
        case 'CONTAINS': return { [col]: { contains: v.one, mode: 'insensitive' } };
        case 'BEFORE': return { [col]: { lt: v.one } };
        case 'ON_OR_AFTER': return { [col]: { gte: v.one } };
        case 'GT': return { [col]: { gt: v.one } };
        case 'LT': return { [col]: { lt: v.one } };
        case 'BETWEEN': return kind === 'date' ? { [col]: { gte: v.range!.from, lt: v.range!.to } } : { [col]: { gte: v.many![0], lte: v.many![1] } };
        case 'IS_NULL': return { [col]: null };
        case 'NOT_NULL': return { [col]: { not: null } };
      }
    },
  };
}
/** Trường tham chiếu: `path(ids)` dựng điều kiện trên quan hệ; IS_NULL / NOT_NULL (nếu có) là "chưa có" / "đã có". */
function ref(kind: RefKind, hint: string, path: (ids: string[]) => Record<string, unknown>, presence?: { none: Record<string, unknown>; some: Record<string, unknown> }): FilterDef {
  return {
    kind: 'ref', ref: kind, hint, ops: presence ? [...REF_OPS, 'IS_NULL', 'NOT_NULL'] : REF_OPS,
    where(op, v) {
      if (op === 'IS_NULL') return presence!.none;
      if (op === 'NOT_NULL') return presence!.some;
      return path(op === 'EQ' ? [String(v.one)] : (v.many as string[]));
    },
  };
}
/** Trường đúng/sai suy ra từ quan hệ, chỉ nhận EQ true/false. */
function flag(hint: string, yes: Record<string, unknown>): FilterDef {
  return { kind: 'bool', ops: ['EQ'], hint, where: (_op, v) => (v.one === true ? yes : { NOT: yes }) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Tiện ích hiển thị
// ---------------------------------------------------------------------------------------------------------------------
const iso = (d: Date | null | undefined): string | null => d?.toISOString() ?? null;
function clip(text: string | null | undefined): string | null {
  if (text === null || text === undefined) return null;
  const chars = Array.from(text.normalize('NFC'));
  return chars.length > MAX_CELL_CHARS ? `${chars.slice(0, MAX_CELL_CHARS).join('')}…` : text;
}
interface Person { id: string; name: string; deletedAt: Date | null }
const personName = (p: Person | null | undefined): string | null => (p ? (p.deletedAt ? DELETED_USER : p.name) : null);
const personGroup = (p: Person | null | undefined) => (p ? [{ id: p.id, label: personName(p)! }] : [{ id: null, label: 'Chưa có' }]);
const LIST_SELECT = { select: { id: true, name: true, board: { select: { id: true, name: true } } } } as const;
const CARD_REF_SELECT = { select: { id: true, title: true, list: LIST_SELECT } } as const;
const PERSON_SELECT = { select: { id: true, name: true, deletedAt: true } } as const;

/** Nhãn nhóm theo ngày / tuần (thứ Hai) / tháng, theo GIỜ VIỆT NAM. */
export function bucketOf(date: Date, bucket: Bucket): { id: string; label: string } {
  const day = vietnamDay(date);
  if (bucket === 'DAY') return { id: day, label: day };
  if (bucket === 'MONTH') return { id: day.slice(0, 7), label: day.slice(0, 7) };
  const d = new Date(`${day}T00:00:00.000Z`);
  const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
  return { id: monday, label: `Tuần từ ${monday}` };
}
function dateGroup<R>(label: string, needs: string[], of: (row: R) => Date | null): GroupDef<R> {
  return {
    label, needs, date: { of },
    keys(row, bucket = 'DAY') {
      const d = of(row);
      return d ? [bucketOf(d, bucket)] : [{ id: null, label: 'Chưa có' }];
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// CARD
// ---------------------------------------------------------------------------------------------------------------------
const CARD_SELECT = {
  id: true, title: true, description: true, status: true, isDone: true, dueDate: true, startDate: true, completedAt: true, createdAt: true, updatedAt: true,
  list: LIST_SELECT,
  members: { where: { user: { deletedAt: null } }, select: { user: PERSON_SELECT } },
  labels: { select: { label: { select: { id: true, name: true, color: true } } } },
  checklists: { select: { items: { select: { isDone: true } } } },
  _count: { select: { comments: { where: { deletedAt: null } }, attachments: true } },
} as const satisfies Prisma.CardSelect;
type CardRow = Prisma.CardGetPayload<{ select: typeof CARD_SELECT }>;
const checklistOf = (r: CardRow) => r.checklists.flatMap((c) => c.items);

const CARD: EntityDef<CardRow> = {
  label: ENTITY_LABEL.CARD,
  scope: (bw) => liveCardWhere(bw) as Record<string, unknown>,
  searchFields: ['title', 'description'],
  select: CARD_SELECT,
  defaultColumns: ['title', 'boardName', 'listName', 'status', 'dueDate', 'assignees'],
  linkNeeds: ['list'],
  defaultOrder: [{ dueDate: { sort: 'asc', nulls: 'last' } }],
  filters: {
    title: scalar('string', 'title', STRING_OPS, 'tiêu đề'),
    description: scalar('text', 'description', TEXT_OPS, 'mô tả (CONTAINS; NOT_NULL = có mô tả)'),
    status: scalar('enum', 'status', ENUM_OPS, `trạng thái: ${STATUS_VALUES.join('|')}`, { enumValues: STATUS_VALUES }),
    isDone: scalar('bool', 'isDone', ['EQ'], 'đã xong (true/false)'),
    dueDate: scalar('date', 'dueDate', DATE_OPS, 'hạn'),
    startDate: scalar('date', 'startDate', DATE_OPS, 'ngày bắt đầu'),
    completedAt: scalar('date', 'completedAt', DATE_OPS, 'lúc hoàn thành'),
    createdAt: scalar('date', 'createdAt', DATE_OPS, 'lúc tạo'),
    updatedAt: scalar('date', 'updatedAt', DATE_OPS, 'lúc sửa gần nhất'),
    boardId: ref('BOARD', 'id bảng', (ids) => ({ list: { boardId: { in: ids } } })),
    listId: ref('LIST', 'id cột', (ids) => ({ listId: { in: ids } })),
    assigneeId: ref('USER', 'id người phụ trách (IS_NULL = chưa giao)', (ids) => ({ members: { some: { userId: { in: ids } } } }), { none: { members: { none: {} } }, some: { members: { some: {} } } }),
    labelId: ref('LABEL', 'id nhãn (IS_NULL = chưa có nhãn)', (ids) => ({ labels: { some: { labelId: { in: ids } } } }), { none: { labels: { none: {} } }, some: { labels: { some: {} } } }),
    hasOpenChecklistItems: flag('còn mục checklist chưa xong (true/false)', { checklists: { some: { items: { some: { isDone: false } } } } }),
    hasComments: flag('có bình luận (true/false)', { comments: { some: { deletedAt: null } } }),
    hasAttachments: flag('có tệp đính kèm (true/false)', { attachments: { some: {} } }),
  },
  columns: {
    title: { label: 'Tiêu đề', type: 'text', needs: ['title'], value: (r) => clip(r.title) },
    description: { label: 'Mô tả', type: 'text', needs: ['description'], value: (r) => clip(r.description) },
    status: { label: 'Trạng thái', type: 'status', needs: ['status'], value: (r) => r.status },
    isDone: { label: 'Đã xong', type: 'bool', needs: ['isDone'], value: (r) => r.isDone },
    dueDate: { label: 'Hạn', type: 'date', needs: ['dueDate'], value: (r) => iso(r.dueDate) },
    startDate: { label: 'Bắt đầu', type: 'date', needs: ['startDate'], value: (r) => iso(r.startDate) },
    completedAt: { label: 'Hoàn thành lúc', type: 'date', needs: ['completedAt'], value: (r) => iso(r.completedAt) },
    createdAt: { label: 'Tạo lúc', type: 'date', needs: ['createdAt'], value: (r) => iso(r.createdAt) },
    updatedAt: { label: 'Sửa lúc', type: 'date', needs: ['updatedAt'], value: (r) => iso(r.updatedAt) },
    boardName: { label: 'Bảng', type: 'text', needs: ['list'], value: (r) => r.list.board.name },
    listName: { label: 'Cột', type: 'text', needs: ['list'], value: (r) => r.list.name },
    assignees: { label: 'Người phụ trách', type: 'text', needs: ['members'], value: (r) => r.members.map((m) => m.user.name).join(', ') || null },
    labels: { label: 'Nhãn', type: 'text', needs: ['labels'], value: (r) => r.labels.map((l) => l.label.name || l.label.color).join(', ') || null },
    checklist: { label: 'Checklist', type: 'text', needs: ['checklists'], value: (r) => { const items = checklistOf(r); return items.length ? `${items.filter((i) => i.isDone).length}/${items.length}` : null; } },
    commentCount: { label: 'Số bình luận', type: 'number', needs: ['_count'], value: (r) => r._count.comments },
    attachmentCount: { label: 'Số tệp', type: 'number', needs: ['_count'], value: (r) => r._count.attachments },
  },
  sorts: {
    title: { label: 'Tiêu đề', order: (d) => ({ title: d }) },
    dueDate: { label: 'Hạn', order: (d) => ({ dueDate: { sort: d, nulls: 'last' } }) },
    startDate: { label: 'Bắt đầu', order: (d) => ({ startDate: { sort: d, nulls: 'last' } }) },
    completedAt: { label: 'Hoàn thành lúc', order: (d) => ({ completedAt: { sort: d, nulls: 'last' } }) },
    createdAt: { label: 'Tạo lúc', order: (d) => ({ createdAt: d }) },
    updatedAt: { label: 'Sửa lúc', order: (d) => ({ updatedAt: d }) },
    attachmentCount: { label: 'Số tệp', order: (d) => ({ attachments: { _count: d } }) },
  },
  groups: {
    status: { label: 'Trạng thái', needs: ['status'], keys: (r) => [{ id: r.status, label: STATUS_LABEL[r.status] }] },
    isDone: { label: 'Đã xong / chưa xong', needs: ['isDone'], keys: (r) => [{ id: String(r.isDone), label: r.isDone ? 'Đã xong' : 'Chưa xong' }] },
    boardId: { label: 'Bảng', needs: ['list'], keys: (r) => [{ id: r.list.board.id, label: r.list.board.name }] },
    listId: { label: 'Cột', needs: ['list'], keys: (r) => [{ id: r.list.id, label: `${r.list.name} · ${r.list.board.name}` }] },
    assigneeId: { label: 'Người phụ trách', needs: ['members'], keys: (r) => (r.members.length ? r.members.map((m) => ({ id: m.user.id, label: m.user.name })) : [{ id: null, label: 'Chưa giao' }]) },
    labelId: { label: 'Nhãn', needs: ['labels'], keys: (r) => (r.labels.length ? r.labels.map((l) => ({ id: l.label.id, label: l.label.name || l.label.color })) : [{ id: null, label: 'Không có nhãn' }]) },
    dueDate: dateGroup('Hạn', ['dueDate'], (r) => r.dueDate),
    createdAt: dateGroup('Ngày tạo', ['createdAt'], (r) => r.createdAt),
    completedAt: dateGroup('Ngày hoàn thành', ['completedAt'], (r) => r.completedAt),
    updatedAt: dateGroup('Ngày sửa', ['updatedAt'], (r) => r.updatedAt),
  },
  links: (r) => ({ cardId: r.id, boardId: r.list.board.id }),
  rowId: (r) => r.id,
  count: (tx, where) => tx.card.count({ where: where as Prisma.CardWhereInput }),
  find: (tx, a) => tx.card.findMany({ where: a.where as Prisma.CardWhereInput, select: a.select as typeof CARD_SELECT, orderBy: a.orderBy as Prisma.CardOrderByWithRelationInput[], skip: a.skip, take: a.take }),
};

// ---------------------------------------------------------------------------------------------------------------------
// COMMENT (bình luận chưa xóa của thẻ còn sống)
// ---------------------------------------------------------------------------------------------------------------------
const COMMENT_SELECT = { id: true, text: true, parentId: true, createdAt: true, updatedAt: true, user: PERSON_SELECT, card: CARD_REF_SELECT } as const satisfies Prisma.CommentSelect;
type CommentRow = Prisma.CommentGetPayload<{ select: typeof COMMENT_SELECT }>;
const COMMENT: EntityDef<CommentRow> = {
  label: ENTITY_LABEL.COMMENT,
  scope: (bw) => ({ deletedAt: null, card: liveCardWhere(bw) }),
  searchFields: ['text'],
  select: COMMENT_SELECT,
  defaultColumns: ['text', 'authorName', 'createdAt', 'cardTitle'],
  linkNeeds: ['card'],
  defaultOrder: [{ createdAt: 'desc' }],
  filters: {
    text: scalar('text', 'text', ['CONTAINS'], 'nội dung bình luận'),
    createdAt: scalar('date', 'createdAt', DATE_OPS.filter((o) => o !== 'IS_NULL' && o !== 'NOT_NULL'), 'lúc viết'),
    authorId: ref('USER', 'id người viết', (ids) => ({ userId: { in: ids } })),
    cardId: ref('CARD', 'id thẻ', (ids) => ({ cardId: { in: ids } })),
    boardId: ref('BOARD', 'id bảng', (ids) => ({ card: { list: { boardId: { in: ids } } } })),
    isReply: flag('là câu trả lời của một bình luận khác (true/false)', { parentId: { not: null } }),
  },
  columns: {
    text: { label: 'Nội dung', type: 'text', needs: ['text'], value: (r) => clip(r.text) },
    authorName: { label: 'Người viết', type: 'text', needs: ['user'], value: (r) => personName(r.user) },
    createdAt: { label: 'Lúc viết', type: 'date', needs: ['createdAt'], value: (r) => iso(r.createdAt) },
    updatedAt: { label: 'Sửa lúc', type: 'date', needs: ['updatedAt'], value: (r) => iso(r.updatedAt) },
    cardTitle: { label: 'Thẻ', type: 'text', needs: ['card'], value: (r) => clip(r.card.title) },
    boardName: { label: 'Bảng', type: 'text', needs: ['card'], value: (r) => r.card.list.board.name },
    isReply: { label: 'Là trả lời', type: 'bool', needs: ['parentId'], value: (r) => r.parentId !== null },
  },
  sorts: { createdAt: { label: 'Lúc viết', order: (d) => ({ createdAt: d }) } },
  groups: {
    authorId: { label: 'Người viết', needs: ['user'], keys: (r) => personGroup(r.user) },
    cardId: { label: 'Thẻ', needs: ['card'], keys: (r) => [{ id: r.card.id, label: r.card.title }] },
    boardId: { label: 'Bảng', needs: ['card'], keys: (r) => [{ id: r.card.list.board.id, label: r.card.list.board.name }] },
    createdAt: dateGroup('Ngày viết', ['createdAt'], (r) => r.createdAt),
  },
  links: (r) => ({ cardId: r.card.id, boardId: r.card.list.board.id }),
  rowId: (r) => r.id,
  count: (tx, where) => tx.comment.count({ where: where as Prisma.CommentWhereInput }),
  find: (tx, a) => tx.comment.findMany({ where: a.where as Prisma.CommentWhereInput, select: a.select as typeof COMMENT_SELECT, orderBy: a.orderBy as Prisma.CommentOrderByWithRelationInput[], skip: a.skip, take: a.take }),
};

// ---------------------------------------------------------------------------------------------------------------------
// CHECKLIST_ITEM
// ---------------------------------------------------------------------------------------------------------------------
const ITEM_SELECT = { id: true, content: true, isDone: true, dueDate: true, createdAt: true, assignee: PERSON_SELECT, checklist: { select: { title: true, card: CARD_REF_SELECT } } } as const satisfies Prisma.ChecklistItemSelect;
type ItemRow = Prisma.ChecklistItemGetPayload<{ select: typeof ITEM_SELECT }>;
const CHECKLIST_ITEM: EntityDef<ItemRow> = {
  label: ENTITY_LABEL.CHECKLIST_ITEM,
  scope: (bw) => ({ checklist: { card: liveCardWhere(bw) } }),
  searchFields: ['content'],
  select: ITEM_SELECT,
  defaultColumns: ['content', 'isDone', 'assigneeName', 'dueDate', 'cardTitle'],
  linkNeeds: ['checklist'],
  defaultOrder: [{ createdAt: 'desc' }],
  filters: {
    content: scalar('text', 'content', ['CONTAINS'], 'nội dung mục'),
    isDone: scalar('bool', 'isDone', ['EQ'], 'đã xong (true/false)'),
    dueDate: scalar('date', 'dueDate', DATE_OPS, 'hạn của mục'),
    createdAt: scalar('date', 'createdAt', DATE_OPS.filter((o) => o !== 'IS_NULL' && o !== 'NOT_NULL'), 'lúc tạo'),
    assigneeId: ref('USER', 'id người được chỉ định (IS_NULL = chưa chỉ định)', (ids) => ({ assigneeId: { in: ids } }), { none: { assigneeId: null }, some: { assigneeId: { not: null } } }),
    cardId: ref('CARD', 'id thẻ', (ids) => ({ checklist: { cardId: { in: ids } } })),
    boardId: ref('BOARD', 'id bảng', (ids) => ({ checklist: { card: { list: { boardId: { in: ids } } } } })),
  },
  columns: {
    content: { label: 'Nội dung', type: 'text', needs: ['content'], value: (r) => clip(r.content) },
    isDone: { label: 'Đã xong', type: 'bool', needs: ['isDone'], value: (r) => r.isDone },
    dueDate: { label: 'Hạn', type: 'date', needs: ['dueDate'], value: (r) => iso(r.dueDate) },
    createdAt: { label: 'Tạo lúc', type: 'date', needs: ['createdAt'], value: (r) => iso(r.createdAt) },
    assigneeName: { label: 'Người được chỉ định', type: 'text', needs: ['assignee'], value: (r) => personName(r.assignee) },
    checklistTitle: { label: 'Danh sách checklist', type: 'text', needs: ['checklist'], value: (r) => clip(r.checklist.title) },
    cardTitle: { label: 'Thẻ', type: 'text', needs: ['checklist'], value: (r) => clip(r.checklist.card.title) },
    boardName: { label: 'Bảng', type: 'text', needs: ['checklist'], value: (r) => r.checklist.card.list.board.name },
  },
  sorts: { dueDate: { label: 'Hạn', order: (d) => ({ dueDate: { sort: d, nulls: 'last' } }) }, createdAt: { label: 'Tạo lúc', order: (d) => ({ createdAt: d }) } },
  groups: {
    isDone: { label: 'Đã xong / chưa xong', needs: ['isDone'], keys: (r) => [{ id: String(r.isDone), label: r.isDone ? 'Đã xong' : 'Chưa xong' }] },
    assigneeId: { label: 'Người được chỉ định', needs: ['assignee'], keys: (r) => (r.assignee ? personGroup(r.assignee) : [{ id: null, label: 'Chưa chỉ định' }]) },
    cardId: { label: 'Thẻ', needs: ['checklist'], keys: (r) => [{ id: r.checklist.card.id, label: r.checklist.card.title }] },
    boardId: { label: 'Bảng', needs: ['checklist'], keys: (r) => [{ id: r.checklist.card.list.board.id, label: r.checklist.card.list.board.name }] },
    dueDate: dateGroup('Hạn', ['dueDate'], (r) => r.dueDate),
  },
  links: (r) => ({ cardId: r.checklist.card.id, boardId: r.checklist.card.list.board.id }),
  rowId: (r) => r.id,
  count: (tx, where) => tx.checklistItem.count({ where: where as Prisma.ChecklistItemWhereInput }),
  find: (tx, a) => tx.checklistItem.findMany({ where: a.where as Prisma.ChecklistItemWhereInput, select: a.select as typeof ITEM_SELECT, orderBy: a.orderBy as Prisma.ChecklistItemOrderByWithRelationInput[], skip: a.skip, take: a.take }),
};

// ---------------------------------------------------------------------------------------------------------------------
// ATTACHMENT (chỉ TÊN và loại tệp; không bao giờ trả đường dẫn / nội dung tệp)
// ---------------------------------------------------------------------------------------------------------------------
const ATTACHMENT_SELECT = { id: true, name: true, mime: true, size: true, createdAt: true, uploader: PERSON_SELECT, card: CARD_REF_SELECT } as const satisfies Prisma.AttachmentSelect;
type AttachmentRow = Prisma.AttachmentGetPayload<{ select: typeof ATTACHMENT_SELECT }>;
const ATTACHMENT: EntityDef<AttachmentRow> = {
  label: ENTITY_LABEL.ATTACHMENT,
  scope: (bw) => ({ card: liveCardWhere(bw) }),
  searchFields: ['name'],
  select: ATTACHMENT_SELECT,
  defaultColumns: ['name', 'mime', 'size', 'uploaderName', 'createdAt', 'cardTitle'],
  linkNeeds: ['card'],
  defaultOrder: [{ createdAt: 'desc' }],
  filters: {
    name: scalar('string', 'name', STRING_OPS, 'tên tệp'),
    mime: scalar('string', 'mime', STRING_OPS, 'loại tệp, ví dụ application/pdf, image/png'),
    size: scalar('number', 'size', NUMBER_OPS, 'dung lượng (byte)'),
    createdAt: scalar('date', 'createdAt', DATE_OPS.filter((o) => o !== 'IS_NULL' && o !== 'NOT_NULL'), 'lúc tải lên'),
    uploaderId: ref('USER', 'id người tải lên', (ids) => ({ uploaderId: { in: ids } })),
    cardId: ref('CARD', 'id thẻ', (ids) => ({ cardId: { in: ids } })),
    boardId: ref('BOARD', 'id bảng', (ids) => ({ card: { list: { boardId: { in: ids } } } })),
  },
  columns: {
    name: { label: 'Tên tệp', type: 'text', needs: ['name'], value: (r) => clip(r.name) },
    mime: { label: 'Loại', type: 'text', needs: ['mime'], value: (r) => r.mime },
    size: { label: 'Dung lượng (byte)', type: 'number', needs: ['size'], value: (r) => r.size },
    createdAt: { label: 'Tải lên lúc', type: 'date', needs: ['createdAt'], value: (r) => iso(r.createdAt) },
    uploaderName: { label: 'Người tải lên', type: 'text', needs: ['uploader'], value: (r) => personName(r.uploader) },
    cardTitle: { label: 'Thẻ', type: 'text', needs: ['card'], value: (r) => clip(r.card.title) },
    boardName: { label: 'Bảng', type: 'text', needs: ['card'], value: (r) => r.card.list.board.name },
  },
  sorts: { createdAt: { label: 'Tải lên lúc', order: (d) => ({ createdAt: d }) }, size: { label: 'Dung lượng', order: (d) => ({ size: d }) }, name: { label: 'Tên tệp', order: (d) => ({ name: d }) } },
  groups: {
    uploaderId: { label: 'Người tải lên', needs: ['uploader'], keys: (r) => personGroup(r.uploader) },
    mime: { label: 'Loại tệp', needs: ['mime'], keys: (r) => [{ id: r.mime, label: r.mime }] },
    cardId: { label: 'Thẻ', needs: ['card'], keys: (r) => [{ id: r.card.id, label: r.card.title }] },
    boardId: { label: 'Bảng', needs: ['card'], keys: (r) => [{ id: r.card.list.board.id, label: r.card.list.board.name }] },
    createdAt: dateGroup('Ngày tải lên', ['createdAt'], (r) => r.createdAt),
  },
  links: (r) => ({ cardId: r.card.id, boardId: r.card.list.board.id }),
  rowId: (r) => r.id,
  count: (tx, where) => tx.attachment.count({ where: where as Prisma.AttachmentWhereInput }),
  find: (tx, a) => tx.attachment.findMany({ where: a.where as Prisma.AttachmentWhereInput, select: a.select as typeof ATTACHMENT_SELECT, orderBy: a.orderBy as Prisma.AttachmentOrderByWithRelationInput[], skip: a.skip, take: a.take }),
};

// Ép về kiểu chung: mỗi thực thể có kiểu hàng riêng nhưng bộ thực thi chỉ đi qua các hàm của chính thực thể đó.
type AnyDef = EntityDef<never>;
export const ENTITIES = { CARD, COMMENT, CHECKLIST_ITEM, ATTACHMENT } as unknown as Record<DataEntity, AnyDef>;

const names = (pick: (d: AnyDef) => string[]): [string, ...string[]] => [...new Set(Object.values(ENTITIES).flatMap(pick))] as [string, ...string[]];
/** Tên phẳng của mọi trường (hợp của các thực thể) - dùng làm enum trong lược đồ gửi mô hình; thuộc về thực thể nào được kiểm lúc chạy. */
export const DATA_FILTER_NAMES = names((d) => Object.keys(d.filters));
export const DATA_COLUMN_NAMES = names((d) => Object.keys(d.columns));
export const DATA_SORT_NAMES = names((d) => Object.keys(d.sorts));
export const DATA_GROUP_NAMES = names((d) => Object.keys(d.groups));

/** Mô tả gọn danh mục cho mô hình, sinh từ chính danh mục để không bao giờ lệch với mã. */
export function catalogText(): string {
  return DATA_ENTITIES.map((e) => {
    const d = ENTITIES[e];
    const f = Object.entries(d.filters).map(([k, v]) => `${k}[${v.ops.join('/')}]=${v.hint}`).join('; ');
    return `${e} (${d.label}) — lọc: ${f}. Cột: ${Object.keys(d.columns).join(',')} (mặc định ${d.defaultColumns.join(',')}). Sắp xếp: ${Object.keys(d.sorts).join(',') || 'không'}. Nhóm: ${Object.keys(d.groups).join(',')}.`;
  }).join('\n');
}
