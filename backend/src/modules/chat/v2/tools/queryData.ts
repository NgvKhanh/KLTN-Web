// Công cụ ĐỌC tổng quát `query_data` (chatbot v2, bước B): trả lời những câu hỏi mà các công cụ có sẵn (query_tasks, aggregate_tasks...) không
// diễn đạt được - theo nội dung mô tả / bình luận / checklist / tệp, sắp xếp và đếm tuỳ ý.
//
// Mô hình chỉ khai một truy vấn CÓ CẤU TRÚC chọn trong danh mục `data.fields.ts`. Hàm này kiểm từng phần, dịch sang Prisma, và LUÔN ghép điều kiện
// phạm vi của thực thể (bảng đọc được, thẻ còn sống) bằng AND nên điều kiện nào của mô hình cũng không mở rộng được quyền xem.
import type { z } from 'zod';
import { prisma } from '../../../../config/prisma';
import { AppError } from '../../../../utils/AppError';
import { ENTITIES, ENTITY_LABEL, parseCondition, type Cell, type ColumnType, type DataOp, type RefKind } from '../data/data.fields';
import { assertCardIds, pageMeta } from '../chat.v2.query';
import type { queryDataInputSchema } from '../chat.v2.schema';
import { assertRosterIds, type ExecutionContext } from '../chat.v2.scope';

/** Số bản ghi tối đa được quét để NHÓM (đếm) trong bộ nhớ. Vượt thì từ chối, không đếm thiếu âm thầm. */
export const limits = { scan: 5000 };
const MAX_SEARCH_WORDS = 5;
type Input = z.infer<typeof queryDataInputSchema>;
export interface DataColumn { key: string; label: string; type: ColumnType }
export interface DataRow { id: string; cardId: string | null; boardId: string | null; cells: Record<string, Cell> }
export interface DataGroup { id: string | null; label: string; count: number }

const REF_NAME: Record<RefKind, string> = { USER: 'thành viên', BOARD: 'bảng', LIST: 'cột', LABEL: 'nhãn', CARD: 'công việc' };
/** Id tham chiếu phải nằm trong phạm vi được phép (cùng nguyên tắc buildTaskWhere): id lạ cho cùng một lỗi như id không tồn tại. */
async function assertRefs(ctx: ExecutionContext, kind: RefKind, ids: string[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (kind === 'USER') return assertRosterIds(unique, ctx);
  if (kind === 'CARD') return assertCardIds(ctx, unique);
  const bw = ctx.scope.boardWhere;
  const count = kind === 'BOARD' ? await prisma.board.count({ where: { AND: [bw, { id: { in: unique } }] } })
    : kind === 'LIST' ? await prisma.list.count({ where: { id: { in: unique }, deletedAt: null, archivedAt: null, board: bw } })
    : await prisma.label.count({ where: { id: { in: unique }, board: bw } });
  if (count !== unique.length) throw new AppError(`Không tìm thấy ${REF_NAME[kind]} trong phạm vi được phép`, 400);
}

function pick(select: Record<string, unknown>, needs: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(needs.map((k) => [k, select[k]]));
}
function unknownName(kind: string, name: string, entity: string, allowed: string[]): AppError {
  return new AppError(`${kind} “${name}” không có ở ${entity}; chỉ dùng: ${allowed.join(', ')}.`, 400);
}

export async function queryData(ctx: ExecutionContext, input: Input) {
  const def = ENTITIES[input.entity];
  // 1. Điều kiện: phạm vi luôn đứng đầu, điều kiện của mô hình chỉ THU HẸP thêm.
  const parts: Record<string, unknown>[] = [def.scope(ctx.scope.boardWhere)];
  for (const c of input.where) {
    const f = def.filters[c.field];
    if (!f) throw unknownName('Trường lọc', c.field, input.entity, Object.keys(def.filters));
    const parsed = parseCondition(f, c.field, c);
    if (f.ref) {
      const ids = c.op === 'IN' ? c.values ?? [] : c.op === 'EQ' && c.value !== undefined ? [c.value] : [];
      if (ids.length) await assertRefs(ctx, f.ref, ids);
    }
    parts.push(f.where(c.op as DataOp, parsed));
  }
  if (input.search) {
    const words = input.search.split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_WORDS);
    for (const w of words) parts.push({ OR: def.searchFields.map((field) => ({ [field]: { contains: w, mode: 'insensitive' } })) });
  }
  const where = { AND: parts };
  const asGroups = input.groupBy !== undefined;
  const group = input.groupBy === undefined ? undefined : def.groups[input.groupBy];
  if (input.groupBy !== undefined && !group) throw unknownName('Trường nhóm', input.groupBy, input.entity, Object.keys(def.groups));
  if (input.bucket && !group?.date) throw new AppError('bucket chỉ dùng khi nhóm theo một trường ngày.', 400);
  const bucket = group?.date ? input.bucket ?? 'DAY' : null;

  return prisma.$transaction(async (tx) => {
    const matched = await def.count(tx, where);
    if (asGroups && group) {
      if (matched > limits.scan) throw new AppError(`Có hơn ${limits.scan} bản ghi khớp nên chưa nhóm được; hãy thêm điều kiện lọc (bảng, khoảng ngày...).`, 400);
      const select = { id: true, ...pick(def.select, group.needs) };
      const rows = await def.find(tx, { where, select, orderBy: [{ id: 'asc' }], skip: 0, take: limits.scan });
      const counts = new Map<string, DataGroup>();
      for (const r of rows) {
        for (const k of group.keys(r, bucket ?? undefined)) {
          const key = k.id ?? '\u0000none';
          const hit = counts.get(key);
          if (hit) hit.count += 1; else counts.set(key, { id: k.id, label: k.label, count: 1 });
        }
      }
      const all = [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'vi') || String(a.id).localeCompare(String(b.id)));
      const highestCount = all[0]?.count ?? 0;
      return {
        entity: input.entity, mode: 'GROUPS' as const, ...pageMeta(all.length, input.page, input.pageSize), matched,
        columns: [] as DataColumn[], rows: [] as DataRow[],
        groups: all.slice((input.page - 1) * input.pageSize, input.page * input.pageSize),
        groupBy: input.groupBy ?? null, groupLabel: group.label, bucket, highestCount, topGroups: all.filter((g) => g.count === highestCount).length,
      };
    }
    const keys = input.fields ?? def.defaultColumns;
    for (const k of keys) if (!def.columns[k]) throw unknownName('Cột', k, input.entity, Object.keys(def.columns));
    const needs = [...new Set([...keys.flatMap((k) => def.columns[k].needs), ...def.linkNeeds])];
    const order = input.orderBy.length ? input.orderBy.map((o) => {
      const s = def.sorts[o.field];
      if (!s) throw unknownName('Trường sắp xếp', o.field, input.entity, Object.keys(def.sorts));
      return s.order(o.dir === 'DESC' ? 'desc' : 'asc');
    }) : def.defaultOrder;
    const found = await def.find(tx, { where, select: { id: true, ...pick(def.select, needs) }, orderBy: [...order, { id: 'asc' }], skip: (input.page - 1) * input.pageSize, take: input.pageSize });
    return {
      entity: input.entity, mode: 'ROWS' as const, ...pageMeta(matched, input.page, input.pageSize), matched,
      columns: keys.map((k) => ({ key: k, label: def.columns[k].label, type: def.columns[k].type })) as DataColumn[],
      rows: found.map((r) => ({ id: def.rowId(r), ...def.links(r), cells: Object.fromEntries(keys.map((k) => [k, def.columns[k].value(r)])) })) as DataRow[],
      groups: [] as DataGroup[], groupBy: null, groupLabel: null, bucket: null, highestCount: 0, topGroups: 0,
    };
  }, { isolationLevel: 'RepeatableRead' });
}
export { ENTITY_LABEL };
