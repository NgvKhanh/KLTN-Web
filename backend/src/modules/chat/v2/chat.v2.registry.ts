import { z } from 'zod';
import { PROPOSE_BOARD_PATCH_PROVIDER_SCHEMA, proposeBoardPatchSchema } from './actions/actions.patch.schema';
import { PROPOSE_ACTIONS_PROVIDER_SCHEMA, proposeActionsSchema } from './actions/actions.schema';
import { TOOL_SCHEMAS } from './chat.v2.schema';
import { TOOL_DESCRIPTIONS } from './chat.v2.tools';
import { MAX_ANSWER_CHARS } from './answer/answer.check';

export const finishSchema = z.object({ sourceIds: z.array(z.string().uuid()).max(8), comment: z.string().trim().min(1).max(300).optional(), answer: z.string().trim().min(1).max(MAX_ANSWER_CHARS).optional() }).strict();
export const clarifySchema = z.object({ question: z.string().min(1).max(300) }).strict();
export const unsupportedSchema = z.object({ reason: z.string().min(1).max(300) }).strict();
export const MODEL_SCHEMAS = { ...TOOL_SCHEMAS, finish: finishSchema, clarify: clarifySchema, unsupported: unsupportedSchema };
// Provider schema hints are deliberately simpler than validation. Zod remains authoritative.
// Gemini's compatible endpoint rejects some draft-2020 keywords (notably oneOf/const).
function providerSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(providerSchema);
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (['$schema', 'default', 'pattern', 'format', 'additionalProperties'].includes(key)) continue;
    if (key === 'const') result.enum = [v];
    else result[key === 'oneOf' ? 'anyOf' : key] = providerSchema(v);
  }
  if (Array.isArray(result.anyOf) && result.anyOf.every((v: { type?: string; enum?: unknown }) => v.type === 'string' && !v.enum)) {
    delete result.anyOf; result.type = 'string'; result.description = 'YYYY-MM-DD hoặc ISO timestamp có múi giờ';
  }
  if (Array.isArray(result.anyOf) && result.anyOf.every((v: { type?: string }) => v.type === 'object')) {
    // Scope discriminators stay strict on the server. A flat hint avoids provider grammar
    // expansion across the same union in every function declaration.
    return { type: 'object', properties: { kind: { type: 'string', enum: ['MY', 'WORKSPACE', 'BOARD'] },
      boardId: { type: 'string' }, workspaceId: { type: 'string' } }, required: ['kind'],
      description: 'MY: chỉ kind; BOARD: kind và boardId; WORKSPACE: kind và workspaceId. Không gửi khóa thừa.' };
  }
  return result;
}
export const modelTools = Object.entries(MODEL_SCHEMAS).map(([name, schema]) => {
  const parameters = providerSchema(z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })) as Record<string, unknown>;
  if (name === 'query_activities') {
    // Nested history is rejected by this tool's Zod refinement; do not advertise it.
    const props = parameters.properties as Record<string, { properties?: Record<string, unknown> }>;
    if (props.taskFilters?.properties) delete props.taskFilters.properties.changed;
  }
  return ({
  type: 'function', function: { name,
    description: name in TOOL_DESCRIPTIONS ? TOOL_DESCRIPTIONS[name as keyof typeof TOOL_DESCRIPTIONS]
      : name === 'finish' ? 'Kết thúc khi đã truy vấn đủ mọi phần. sourceIds là nguồn kết quả thành công. answer (tùy chọn, nên dùng khi câu hỏi cần giải thích / tóm tắt / so sánh / gợi ý): 1-6 câu tiếng Việt dựa CHỈ trên kết quả vừa tra. Số: chữ số và phải có trong kết quả (không tự cộng / trừ / làm tròn, không số thập phân, không số viết bằng chữ như một / bảy). Tên người, thẻ, bảng, nhãn: chỉ nêu khi có trong kết quả, đặt trong dấu ngoặc kép “…”. Không tự đếm từ các dòng (muốn số theo người / thẻ / ngày thì gọi query_data với groupBy), không chép mốc thời gian dạng ISO (2026-10-07T01:00:00.000Z). Không markdown, liên kết, địa chỉ thư. Server kiểm và bỏ answer nếu sai. comment (tùy chọn): nhận xét ngắn 1-2 câu, không tên riêng.'
      : name === 'clarify' ? 'Hỏi làm rõ trước khi truy vấn nếu thiếu thời gian hoặc nghĩa của bộ lọc.'
      : 'Giải thích giới hạn nếu không có công cụ đọc phù hợp. Không thực hiện thao tác ghi.',
    parameters,
  },
  });
});

// Cong cu GHI duy nhat (Phase 1 mot thao tac, Phase 2 nhieu thao tac). KHONG nam trong MODEL_SCHEMAS / modelTools: chi duoc gui cho LLM khi CHAT_ACTIONS bat, co AI va
// nguoi dung sua duoc (xem chat.v2.service). Luoc do gui di la ban VIET TAY phang (khong sinh tu Zod vi preprocess + union object);
// Zod ben server (`proposeActionsSchema`, .strict()) van la nguon su that: khoa la nhu cardId / boardId bi tu choi.
export const PROPOSE_TOOL = 'propose_actions';
export const proposeActionsTool = {
  type: 'function',
  function: {
    name: PROPOSE_TOOL,
    description:
      'Đề xuất các thay đổi dữ liệu (1-15 thao tác, CÙNG MỘT bảng) theo lệnh của người dùng: CREATE_LIST, CREATE_CARD, RENAME_CARD, SET_CARD_DUE, MOVE_CARD, SET_CARD_STATUS, ASSIGN_MEMBER, ADD_LABEL, ASSIGN_UNASSIGNED (chia việc chưa có người trong một cột), CREATE_AUTOMATION_RULE (luật tự động hóa: trigger CARD_CREATED / CARD_MOVED_TO_LIST + 1-5 actions SET_DONE / ADD_LABEL / ASSIGN_MEMBER; phải là thao tác duy nhất), SET_CARD_DESCRIPTION (đổi mô tả thẻ), SET_CARD_START (ngày bắt đầu), ADD_COMMENT (viết bình luận), ADD_CHECKLIST (thêm checklist + các mục), REMOVE_MEMBER (bỏ người khỏi thẻ), REMOVE_LABEL (gỡ nhãn), RENAME_LIST (đổi tên cột), ARCHIVE_CARD (lưu trữ thẻ, khôi phục được), DELETE_CARD (xóa thẻ), RESTORE_CARD (khôi phục thẻ đã lưu trữ), COPY_CARD (sao chép thẻ), SET_CARD_COVER (ảnh bìa thẻ theo tên màu), ARCHIVE_LIST / DELETE_LIST / RESTORE_LIST / COPY_LIST (lưu trữ, xóa, khôi phục, sao chép cột), MOVE_LIST (đổi vị trí cột), SORT_LIST (sắp xếp thẻ trong cột), MOVE_ALL_CARDS (chuyển hết thẻ của cột sang cột khác), DELETE_ALL_CARDS (xóa hết thẻ trong cột), SET_LIST_STATUS (trạng thái của cột; xóa và thao tác cả cột luôn cần bấm Áp dụng), EDIT_COMMENT / DELETE_COMMENT / REPLY_COMMENT (bình luận có sẵn; chỉ sửa / xóa bình luận của chính người dùng), SET_CHECKLIST_ITEM_DONE / ADD_CHECKLIST_ITEM / EDIT_CHECKLIST_ITEM / DELETE_CHECKLIST_ITEM / RENAME_CHECKLIST / DELETE_CHECKLIST / ASSIGN_CHECKLIST_ITEM / SET_CHECKLIST_ITEM_DUE / CONVERT_ITEM_TO_CARD (checklist có sẵn), ADD_ATTACHMENT (gắn tệp người dùng vừa đính kèm) / DELETE_ATTACHMENT, SET_FIELD_VALUE (giá trị trường tùy chỉnh), ADD_REMINDER / REMOVE_REMINDER (nhắc trước hạn), SET_WATCH (theo dõi thẻ / cột / bảng), CREATE_CARD_FROM_TEMPLATE / SAVE_CARD_AS_TEMPLATE (thẻ mẫu), và quản trị bảng: RENAME_BOARD (đổi tên bảng), SET_BOARD_VISIBILITY (riêng tư / không gian / công khai), STAR_BOARD (gắn sao), ARCHIVE_BOARD / DELETE_BOARD (lưu trữ / xóa bảng, kèm confirmName là tên bảng), SET_INVITE_LINK (bật / tắt link mời), CREATE_LABEL / UPDATE_LABEL / DELETE_LABEL (nhãn của bảng), TOGGLE_AUTOMATION_RULE / DELETE_AUTOMATION_RULE (luật tự động hóa đã có), ADD_BOARD_MEMBER / REMOVE_BOARD_MEMBER / CHANGE_MEMBER_ROLE (thành viên và quyền), CREATE_CUSTOM_FIELD / RENAME_CUSTOM_FIELD / DELETE_CUSTOM_FIELD / ADD_FIELD_OPTION (trường tùy chỉnh). Dùng tham chiếu tượng trưng (TEXT/CONTEXT/SELF/PLAN; member còn có BEST = người phù hợp nhất do server chọn), KHÔNG điền id; cột/thẻ do chính lệnh tạo ra thì đặt key rồi tham chiếu {by:PLAN,key}. Đây là lệnh kết thúc: backend tự tìm đối tượng, kiểm quyền rồi tự chạy (một thao tác an toàn) hoặc hiện bản xem trước.',
    parameters: PROPOSE_ACTIONS_PROVIDER_SCHEMA,
  },
} as const;
// Cong cu GHI thu hai (Phase 3): AI mo rong bang. Mo hinh chi khai muc tieu; noi dung do bo lap ke hoach rieng cua server sinh ra (khong co cong cu).
export const PATCH_TOOL = 'propose_board_patch';
export const proposeBoardPatchTool = {
  type: 'function',
  function: {
    name: PATCH_TOOL,
    description:
      'Mở rộng bảng đang mở bằng cột/thẻ MỚI do AI nghĩ ra, khi người dùng chỉ nêu mục tiêu hoặc chủ đề và nhờ trợ lý đề xuất thêm (vd "bổ sung các việc còn thiếu cho giai đoạn kiểm thử", "lên danh sách việc cho tính năng thanh toán"), KHÔNG tự liệt kê tên cột/thẻ. Chỉ THÊM cột/thẻ, không xóa hay sửa dữ liệu cũ. Đây là lệnh kết thúc: backend tự đọc bảng, lập đề xuất, lọc trùng rồi hiện bản xem trước (luôn phải bấm Áp dụng).',
    parameters: PROPOSE_BOARD_PATCH_PROVIDER_SCHEMA,
  },
} as const;
export const ACTION_MODEL_SCHEMAS = { [PROPOSE_TOOL]: proposeActionsSchema, [PATCH_TOOL]: proposeBoardPatchSchema } as const;

export interface ModelCall { id: string; name: string; arguments: unknown }
const plannerCall = (names: [string, ...string[]]) => z.object({ name: z.enum(names), arguments: z.record(z.string(), z.unknown()) }).strict();
const READ_TOOL_NAMES = Object.keys(MODEL_SCHEMAS) as [keyof typeof MODEL_SCHEMAS, ...Array<keyof typeof MODEL_SCHEMAS>];
export const plannerSchema = z.object({ calls: z.array(plannerCall(READ_TOOL_NAMES)).min(1).max(8) }).strict();
/** Ban du phong JSON khi cho phep cong cu ghi: cung hinh dang, them ten `propose_actions`. */
export const plannerSchemaWithActions = z.object({ calls: z.array(plannerCall([...READ_TOOL_NAMES, PROPOSE_TOOL, PATCH_TOOL])).min(1).max(8) }).strict();
