import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../../utils/AppError';
import { resolveExecutionContext, type ToolContext, type ExecutionContext } from './chat.v2.scope';
import { resolveEntities } from './chat.v2.entities';
import { TOOL_SCHEMAS, type ToolName } from './chat.v2.schema';
import { normalizeRange } from './chat.v2.dates';
import { queryTasks } from './tools/queryTasks';
import { aggregateTasks } from './tools/aggregateTasks';
import { queryActivities } from './tools/queryActivities';
import { queryCatalog } from './tools/queryCatalog';
import { getBoardOverview } from './tools/getBoardOverview';
import { getCardDetails } from './tools/getCardDetails';
import { suggestAssignee } from './tools/suggestAssignee';
import { queryData } from './tools/queryData';
import { catalogText } from './data/data.fields';
import { cleanText, looksUnsafe } from './actions/actions.patch.schema';
import { TOOL_OUTPUT_SCHEMAS } from './chat.v2.output';

export type ToolData =
  | Awaited<ReturnType<typeof resolveEntities>> | Awaited<ReturnType<typeof queryTasks>>
  | Awaited<ReturnType<typeof aggregateTasks>> | Awaited<ReturnType<typeof queryActivities>>
  | Awaited<ReturnType<typeof queryCatalog>> | Awaited<ReturnType<typeof getBoardOverview>> | Awaited<ReturnType<typeof getCardDetails>> | Awaited<ReturnType<typeof suggestAssignee>> | Awaited<ReturnType<typeof queryData>>;
export interface ToolDataMap {
  resolve_entities: Awaited<ReturnType<typeof resolveEntities>>;
  query_catalog: Awaited<ReturnType<typeof queryCatalog>>;
  query_tasks: Awaited<ReturnType<typeof queryTasks>>;
  aggregate_tasks: Awaited<ReturnType<typeof aggregateTasks>>;
  query_activities: Awaited<ReturnType<typeof queryActivities>>;
  get_board_overview: Awaited<ReturnType<typeof getBoardOverview>>;
  get_card_details: Awaited<ReturnType<typeof getCardDetails>>;
  suggest_assignee: Awaited<ReturnType<typeof suggestAssignee>>;
  query_data: Awaited<ReturnType<typeof queryData>>;
}
export interface ToolResult<T extends ToolData = ToolData> {
  tool: ToolName;
  source: {
    id: string; generatedAt: string; scope: ExecutionContext['scopeInput']; scopeLabel: string;
    appliedInput: Record<string, unknown>; ranges: { from: string; to: string }[];
  };
  data: T;
}
export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  resolve_entities: 'Tìm bảng, không gian, công việc, cột, thành viên, nhãn, trường tùy chỉnh hoặc giá trị của trường (vd "Cao" của "Ưu tiên") có quyền xem; trả lựa chọn khi trùng tên.',
  query_catalog: 'Danh sách bảng, không gian, thành viên; với MỘT bảng còn có cột (kèm số việc mở / xong), nhãn, trường tùy chỉnh và các giá trị của nó. Có phân trang.',
  query_tasks: 'Lọc công việc theo trạng thái, người, chưa giao, nhãn, ngày và lịch sử; trả tổng số và danh sách.',
  aggregate_tasks: 'Đếm toàn bộ công việc đã lọc, nhóm theo người, bảng, cột, trạng thái hoặc ngày; giữ đồng hạng.',
  query_activities: 'Tra nhật ký trong khoảng thời gian; trả sự kiện hoặc công việc duy nhất có thay đổi, có thể lọc theo trạng thái hiện tại.',
  get_board_overview: 'Tổng quan MỘT bảng: số việc, % hoàn thành, quá hạn, bị chặn, chưa giao, số cột / nhãn / thành viên và số việc từng cột. Dùng cho câu hỏi tiến độ cả bảng.',
  suggest_assignee: 'Xếp hạng người phù hợp nhất cho MỘT công việc đã resolve (module gợi ý phân công): hạng, điểm tương đối, mức tin cậy, cờ cảnh báo, tải hiện tại. Chỉ người sửa được thẻ dùng được; không có bằng chứng hay CV.',
  query_data: `Truy vấn TỔNG QUÁT khi công cụ khác không đủ: theo NỘI DUNG mô tả / bình luận / mục checklist / tệp đính kèm, sắp xếp, đếm, nhóm tùy ý. entity + where (các điều kiện AND) + search (từ khóa trong nội dung) + fields (cột trả về) + orderBy; hoặc groupBy để đếm theo nhóm (trường ngày thì thêm bucket DAY|WEEK|MONTH). Mọi value là CHUỖI: ngày YYYY-MM-DD, true/false, id lấy từ resolve_entities. Danh mục (tên[phép]=ý nghĩa):\n${catalogText()}`,
  get_card_details: 'Chi tiết MỘT công việc đã resolve: trạng thái, cột, hạn, người phụ trách, nhãn, tiến độ checklist, giá trị trường tùy chỉnh, số bình luận / tệp. Không trả nội dung bình luận hay email.',
};

/**
 * Phan CUA KET QUA duoc gui lai cho MO HINH (khac phan hien cho nguoi dung). Mo ta the do nguoi khac viet nen KHONG gui cho mo hinh: chi giu
 * `hasDescription` / `descriptionLength`; nguoi dung van doc duoc trich o khoi hien thi. (Giu nguyen tac toi thieu hoa du lieu gui ben thu ba.)
 */
/** O van ban gui mo hinh: bo ky tu dieu khien / vo hinh, cat ngan; neu giong chi dan / lien ket / dia chi thu thi an han (nguoi dung van thay ban day du). */
export const MODEL_CELL_CHARS = 200;
export const HIDDEN_CELL = '[nội dung bị ẩn: có liên kết, địa chỉ thư hoặc dấu hiệu chỉ dẫn]';
export function safeForModel(value: string): string {
  const clean = cleanText(value, MODEL_CELL_CHARS);
  return looksUnsafe(clean) || looksUnsafe(value.slice(0, 2_000)) ? HIDDEN_CELL : clean;
}
function modelDataView(data: ToolDataMap['query_data']) {
  return {
    ...data,
    rows: data.rows.map((r) => ({ ...r, cells: Object.fromEntries(Object.entries(r.cells).map(([k, v]) => [k, typeof v === 'string' ? safeForModel(v) : v])) })),
    groups: data.groups.map((g) => ({ ...g, label: safeForModel(g.label) })),
  };
}
export function modelView(result: ToolResult): unknown {
  if (result.tool === 'query_data') return { ...result, data: modelDataView(result.data as ToolDataMap['query_data']) };
  if (result.tool !== 'get_card_details') return result;
  const { descriptionExcerpt: _excerpt, ...rest } = result.data as ToolDataMap['get_card_details'];
  return { ...result, data: rest };
}
function envelope<T extends ToolData>(name: ToolName, ctx: ExecutionContext, input: object, data: T): ToolResult<T> {
  const checked = TOOL_OUTPUT_SCHEMAS[name].safeParse(data);
  if (!checked.success) throw new Error(`Invalid v2 output for ${name}`);
  // Normalize every range recorded in the evidence (including nested task/history filters).
  const ranges: { from: string; to: string }[] = [];
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    const object = value as Record<string, unknown>;
    if (typeof object.from === 'string' && typeof object.to === 'string') {
      const range = normalizeRange({ from: object.from, to: object.to });
      ranges.push({ from: range.from.toISOString(), to: range.to.toISOString() });
    } else for (const child of Object.values(object)) visit(child);
  }
  visit(input);
  return {
    tool: name,
    source: { id: randomUUID(), generatedAt: ctx.now.toISOString(), scope: ctx.scopeInput,
      scopeLabel: ctx.scope.board?.name ?? ctx.scope.workspace?.name ?? 'Các bảng bạn được phép xem', appliedInput: { ...input }, ranges },
    data,
  };
}
/** Only entry point for v2 tools. The orchestrator owns LLM calls and HTTP sessions. */
export function executeChatTool<K extends ToolName>(ctx: ToolContext, name: K, raw: unknown): Promise<ToolResult<ToolDataMap[K]>>;
export async function executeChatTool(ctx: ToolContext, name: ToolName, raw: unknown): Promise<ToolResult> {
  if (!Object.hasOwn(TOOL_SCHEMAS, name)) throw new AppError('Công cụ không được hỗ trợ', 400);
  try {
    switch (name) {
      case 'resolve_entities': {
        const input = TOOL_SCHEMAS[name].parse(raw);
        // Explicit entity names for boards/spaces search across allowed scopes, rather than being trapped in the UI board.
        const scope = input.scope ?? (input.kind === 'BOARD' || input.kind === 'WORKSPACE' ? { kind: 'MY' as const } : undefined);
        const exec = await resolveExecutionContext(ctx, scope);
        return envelope(name, exec, input, await resolveEntities(exec, input.kind, input.text));
      }
      case 'query_catalog': {
        const input = TOOL_SCHEMAS[name].parse(raw); const exec = await resolveExecutionContext(ctx, input.scope);
        return envelope(name, exec, input, await queryCatalog(exec, input));
      }
      case 'query_tasks': {
        const input = TOOL_SCHEMAS[name].parse(raw); const exec = await resolveExecutionContext(ctx, input.scope);
        return envelope(name, exec, input, await queryTasks(exec, input));
      }
      case 'aggregate_tasks': {
        const input = TOOL_SCHEMAS[name].parse(raw); const exec = await resolveExecutionContext(ctx, input.scope);
        return envelope(name, exec, input, await aggregateTasks(exec, input));
      }
      case 'query_activities': {
        const input = TOOL_SCHEMAS[name].parse(raw); const exec = await resolveExecutionContext(ctx, input.scope);
        return envelope(name, exec, input, await queryActivities(exec, input));
      }
      case 'get_board_overview': {
        const input = TOOL_SCHEMAS[name].parse(raw); const exec = await resolveExecutionContext(ctx, input.scope);
        return envelope(name, exec, input, await getBoardOverview(exec, input));
      }
      case 'suggest_assignee': {
        const input = TOOL_SCHEMAS[name].parse(raw); const exec = await resolveExecutionContext(ctx, input.scope);
        return envelope(name, exec, input, await suggestAssignee(exec, input));
      }
      case 'get_card_details': {
        const input = TOOL_SCHEMAS[name].parse(raw); const exec = await resolveExecutionContext(ctx, input.scope);
        return envelope(name, exec, input, await getCardDetails(exec, input));
      }
      case 'query_data': {
        const input = TOOL_SCHEMAS[name].parse(raw); const exec = await resolveExecutionContext(ctx, input.scope);
        return envelope(name, exec, input, await queryData(exec, input));
      }
    }
  } catch (error) {
    if (error instanceof z.ZodError) throw new AppError('Tham số công cụ không hợp lệ', 400);
    throw error;
  }
}
