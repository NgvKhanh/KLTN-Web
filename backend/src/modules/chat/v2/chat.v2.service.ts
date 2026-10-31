import { z } from 'zod';
import { env } from '../../../config/env';
import { AppError } from '../../../utils/AppError';
import { assertBoardView } from '../../board/board.service';
import { handleMessage, handleChoice, handleMore, understandByRules, type ChatReply } from '../chat.service';
import { chatSessions } from '../chat.session';
import type { ChatMessageInput } from '../chat.schema';
import { basicStep, bindEntity, explicitBoardRef, orchestrate, validateBindings } from './chat.v2.orchestrator';
import { callChatModel, v2LlmAvailable, type ModelFailReason, type ModelStep } from './chat.v2.llm';
import type { PatchPlanner } from './actions/actions.patch.context';
import { proposeActionsTool, proposeBoardPatchTool } from './chat.v2.registry';
import { choosePlanRef, typedPlanCommand, type ActionOutcome } from './actions/actions.service';
import { cancelOpenPlans, cancelPlanRow } from './actions/actions.plan.repo';
import { v2Sessions, type V2Session, type V2SessionStore } from './chat.v2.session';
import { v2Reply, resultBlock } from './chat.v2.answer';
import { executeChatTool } from './chat.v2.tools';
import { OUT_OF_CEILING, resolveExecutionContext } from './chat.v2.scope';
import { v2ChoiceSchema, v2MoreSchema, type V2Reply } from './chat.v2.contract';
import { refOf, resolveStaged, type StagedUploadRef } from './uploads/chat.uploads';

// `actions` / `autoExecute`: ghi de co CHAT_ACTIONS / CHAT_AUTO_EXECUTE (de kiem thu); mac dinh doc tu env.
export interface V2ServiceContext { now: Date; sessions?: V2SessionStore; step?: ModelStep; available?: boolean; actions?: boolean; autoExecute?: boolean; patchPlanner?: PatchPlanner }

const ACTIONS_OFF_TEXT = 'Trợ lý hiện chỉ đọc dữ liệu. Bạn cần thực hiện tạo, sửa hoặc giao việc trực tiếp trên website.';
const NEEDS_AI_TEXT = 'Cần bật AI để thực hiện thao tác; hiện trợ lý chỉ tra cứu được. Bạn có thể thao tác trực tiếp trên website.';
const READ_ONLY_HERE_TEXT = 'Bạn chỉ có quyền xem bảng này nên trợ lý không thay đổi dữ liệu ở đây được. Chưa thay đổi gì.';
const AI_FAILED_TEXT = 'Trợ lý chưa xử lý được lệnh này nên chưa thay đổi gì. Hãy thử lại sau.';
/** Lý do (đã dịch) AI không dùng được ở lượt này; HTTP / INVALID / DISABLED quá chung nên không nêu. */
function aiWhy(reason: ModelFailReason | undefined): string | undefined {
  if (reason === 'QUOTA' || reason === 'BUDGET') return 'AI đã hết hạn mức hoặc đang quá tải';
  if (reason === 'TIMEOUT') return 'AI phản hồi quá chậm';
  if (reason === 'NETWORK') return 'không kết nối được tới AI';
  return undefined;
}
function aiFailedText(reason: ModelFailReason | undefined): string {
  const why = aiWhy(reason);
  return why ? `Trợ lý chưa xử lý được lệnh này vì ${why} nên chưa thay đổi gì. Hãy thử lại sau ít phút.` : AI_FAILED_TEXT;
}

/**
 * Câu có phải một LỆNH ghi nói thẳng ở đầu câu không (đã bỏ dấu, chữ thường)? Dùng để chặn sớm khi không được phép / không có AI, và để
 * không bao giờ trả lời lệnh ghi bằng nhánh đọc. Động từ "mềm" (thêm, gán, cập nhật...) chỉ tính khi câu không phải câu hỏi:
 * "Cập nhật gần đây của bảng này?" là câu hỏi lịch sử, "gần đây" bị nhầm với "gán" nếu không loại trừ.
 */
export function looksLikeWriteCommand(folded: string, asksQuestion: boolean): boolean {
  const lead = '(?:hay |vui long |toi muon |toi can )?';
  if (new RegExp(`^${lead}(?:tao |xoa |sua |doi han |giao viec |phan cong |chuyen |luu tru )`).test(folded)) return true;
  if (/(?:tao|xoa|sua|doi han|giao viec|phan cong|chuyen|them).*(?:giup toi|giup minh|gium|ho toi)/.test(folded)) return true;
  return !asksQuestion && new RegExp(`^${lead}(?:them |bo sung |mo rong |doi ten |dat han |dat ngay |gan (?!day)|giao (?!dien)|danh dau |cap nhat |di chuyen |keo |bo |go |rut |viet |binh luan |luu tru |khoi phuc |sao chep |nhan ban |lay lai |sap xep (?:the|cot|danh sach|task|cac the) |dua cot |doi vi tri |dat anh bia |bo anh bia |dat trang thai cot )`).test(folded);
}

const PAGE_CHANGED_TEXT = 'Bạn đã chuyển sang trang khác nên lựa chọn / kết quả cũ không còn dùng được. Hãy hỏi lại ở trang này.';
/**
 * Nút "chọn" / "xem thêm" của một lượt cũ chạy theo phạm vi trang đã lưu trong hội thoại. Nếu giao diện đã sang trang khác (client gửi
 * kèm `scope` hiện tại) thì nút cũ vô hiệu - và mọi kế hoạch đang dở bị hủy - để trần phạm vi theo trang không bị lách qua nút cũ.
 */
async function assertSamePage(s: V2Session, scope: z.infer<typeof v2ChoiceSchema>['scope'], now: Date): Promise<void> {
  if (!scope) return;
  const same = scope.kind === s.uiScope.kind
    && (scope.kind === 'MY' || (scope.kind === 'BOARD' && s.uiScope.kind === 'BOARD' && scope.boardId === s.uiScope.boardId)
      || (scope.kind === 'WORKSPACE' && s.uiScope.kind === 'WORKSPACE' && scope.workspaceId === s.uiScope.workspaceId));
  if (same) return;
  await cancelOpenPlans(s.userId, s.id, 'SCOPE_CHANGED', now);
  if (s.pending?.kind === 'PLAN_REF') s.pending = undefined;
  throw new AppError(PAGE_CHANGED_TEXT, 409);
}
/** Nguoi dung sua duoc o trang hien tai? (trang bang: VIEWER thi khong; trang chu / khong gian: de guard kiem tung bang). */
async function canModifyHere(s: V2Session): Promise<boolean> {
  if (s.uiScope.kind !== 'BOARD') return true;
  try { return (await assertBoardView(s.userId, s.uiScope.boardId)).canEdit; }
  catch (e) { if (e instanceof AppError && e.statusCode < 500) return false; throw e; }
}
/** Ket qua cua lop hanh dong -> tra loi V2 (chi tiep nhan: ngu canh "no", cau hoi tiep, khoi xem truoc / ket qua). */
function actionReply(s: V2Session, now: Date, outcome: ActionOutcome): V2Reply {
  for (const entity of outcome.bind) bindEntity(s, entity);
  s.pending = outcome.pending;
  return v2Reply(s, now, [], 'AI', outcome.text, [], outcome.action ? { action: outcome.action } : {});
}
function legacyReply(s: V2Session, reply: ChatReply, aiFailure?: ModelFailReason): V2Reply {
  s.legacyId = reply.conversationId;
  s.legacyOptions = reply.answer.clarify?.options.map((o) => ({ id: o.id, kind: o.kind }));
  const out: V2Reply = { ...reply, conversationId: s.id, version: 'v2', mode: 'BASIC', understood: { ...reply.understood, summary: 'Tra cứu bằng chế độ cơ bản' } };
  const why = aiWhy(aiFailure);
  if (aiFailure) {
    out.answer = { ...out.answer, notes: [...out.answer.notes, `AI chưa phản hồi${why ? ` (${why})` : ''} nên đây là kết quả của chế độ cơ bản.`] };
    // Câu "chưa tạo, sửa hay giao việc được" của v1 sai với v2: ở đây lỗi nằm ở AI, không phải ở chức năng.
    if (out.answer.kind === 'UNSUPPORTED') out.answer.text = `Chế độ cơ bản chưa hiểu câu này${why ? ` và ${why}` : ''}. Hãy thử lại sau ít phút, hoặc hỏi theo các mẫu gợi ý bên dưới. Chưa thay đổi gì.`;
  }
  return out;
}
async function answerQuestion(s: V2Session, message: string, context: V2ServiceContext, uploads: StagedUploadRef[] = []): Promise<V2Reply> {
  const { now } = context;
  const basic = basicStep(message, now);
  const available = context.available ?? v2LlmAvailable();
  const actionsFlag = context.actions ?? env.chatActions;
  const autoExecute = context.autoExecute ?? env.chatAutoExecute;
  s.legacyOptions = undefined;
  const folded = message.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');
  // Mot LENH ghi ("doi han ... sang thu sau", "Trong bang X, doi ten the A thanh Da doi...") khong phai cau hoi lich su: co dong tu ghi o bat ky
  // dau trong cau ma khong co chu nghi van thi bo loi tat "ban muon xem khoang thoi gian nao" (cau hoi that luon co ? hoac nao / gi / ai...).
  const asksQuestion = /\?|(?:^|\s)(?:nao|gi|ai|bao nhieu|khi nao)(?:\s|$)/.test(folded);
  const writeRequest = looksLikeWriteCommand(folded, asksQuestion);
  let aiFailure: ModelFailReason | undefined;
  // Hanh dong: chi gui cong cu ghi cho AI khi co co + co AI + nguoi dung sua duoc o trang nay (dac quyen toi thieu).
  let canModify = false;
  if (writeRequest || (actionsFlag && available)) canModify = actionsFlag && available && await canModifyHere(s);
  if (writeRequest && !canModify) {
    s.pending = undefined; s.queries = []; s.legacyId = undefined;
    const text = !actionsFlag ? ACTIONS_OFF_TEXT : !available ? NEEDS_AI_TEXT : READ_ONLY_HERE_TEXT;
    return v2Reply(s, now, [], available ? 'AI' : 'BASIC', text);
  }
  const boardRef = explicitBoardRef(message);
  const namedBoard = boardRef?.name;
  if (namedBoard && !s.bindings.some((b) => b.kind === 'BOARD' && b.name === namedBoard)) {
    const resolveInput = { kind: 'BOARD', text: namedBoard };
    const found = await executeChatTool({ userId: s.userId, now, scope: s.uiScope }, 'resolve_entities', resolveInput);
    // cụm viết thường không khớp bảng nào có thể chỉ là cách nói ("bảng tiến độ…"): để mô hình xử lý chứ không chặn cả câu hỏi
    if (found.data.status === 'NOT_FOUND' && boardRef?.strong === true) { s.pending = undefined; s.queries = []; return v2Reply(s, now, [], available ? 'AI' : 'BASIC', s.uiScope.kind === 'MY' ? 'Không tìm thấy bảng này trong dữ liệu bạn được phép xem.' : `Không tìm thấy bảng này trong phạm vi bạn đang mở. ${OUT_OF_CEILING}`); }
    if (found.data.status === 'CLARIFY') {
      s.queries = []; s.pending = { kind: 'ENTITY', original: message, question: 'Có nhiều bảng cùng tên. Bạn muốn chọn bảng nào?', options: found.data.options, resolveInput };
      return v2Reply(s, now, [], available ? 'AI' : 'BASIC', s.pending.question);
    }
    if (found.data.status !== 'NOT_FOUND') bindEntity(s, found.data.options[0]);
  }
  const commandLike = canModify && !asksQuestion && /(?:doi ten|doi han|thay doi han|dat han|chuyen |giao |gan (?!day)|them |tao |sua |keo |danh dau|cap nhat|di chuyen|phan cong|bo sung|mo rong|len ke hoach|viet them|khoi phuc|sao chep|nhan ban|sap xep (?:the|cot|danh sach|task|cac the)|dua cot|doi vi tri|anh bia|trang thai cot)/.test(folded);
  const historyQuestion = !writeRequest && !commandLike && /(?:thay doi|da doi|doi han|nhat ky|lich su)/.test(folded);
  const hasHistoryTime = /(?:hom nay|hom qua|tuan|thang|gan day|\bngay\b|\d{1,4}[/-]\d{1,2}|\bvua\b)/.test(folded);
  if (historyQuestion && !hasHistoryTime) {
    s.queries = []; s.pending = { kind: 'QUESTION', original: message, question: 'Bạn muốn xem thay đổi trong khoảng thời gian nào? Ví dụ: hôm nay hoặc tuần này.', options: [] };
    return v2Reply(s, now, [], available ? 'AI' : 'BASIC', s.pending.question);
  }
  if (available) {
    // Co cong cu ghi thi gui kem propose_actions; ngoai ra giu nguyen buoc goi mo hinh nhu truoc.
    const step: ModelStep = context.step ?? (canModify ? (messages, timeoutMs) => callChatModel(messages, timeoutMs, env.ai, true, [proposeActionsTool, proposeBoardPatchTool]) : callChatModel);
    const response = await orchestrate(s, message, now, step, 'AI', { ...(canModify ? { actions: { autoExecute, uploads, ...(context.patchPlanner ? { patchPlanner: context.patchPlanner } : {}) } } : {}), onModelFailure: (reason) => { aiFailure ??= reason; } });
    if (response.mode !== 'BASIC') { s.legacyId = undefined; return response; }
    // Mot LENH ghi (ke ca cau co dong tu ghi o giua cau) khong duoc de roi xuong cac nhanh doc / v1: noi ro la chua thay doi gi va vi sao.
    if (writeRequest || commandLike) { s.pending = undefined; s.queries = []; s.legacyId = undefined; return v2Reply(s, now, [], 'BASIC', aiFailedText(aiFailure)); }
  }
  if (basic) { s.legacyId = undefined; return orchestrate(s, message, now, basic, 'BASIC'); }
  if (historyQuestion || /(?:\bva\b|phan cong|chua giao|\bgan\b)/.test(folded)) return v2Reply(s, now, [], 'BASIC', `AI hiện chưa sẵn sàng${aiWhy(aiFailure) ? ` (${aiWhy(aiFailure)})` : ''} để xử lý đầy đủ câu này. Hãy thử lại hoặc tách câu hỏi thành từng phần.`);
  await validateBindings(s, now);
  const reply = await handleMessage(s.userId, { message, scope: s.scope ?? s.uiScope, conversationId: s.legacyId }, { now, sessions: chatSessions, understand: understandByRules });
  s.lastQuestion = message;
  return legacyReply(s, reply, aiFailure);
}
export async function handleV2Message(userId: string, input: ChatMessageInput & { uploadIds?: string[] }, context: V2ServiceContext): Promise<V2Reply> {
  const store = context.sessions ?? v2Sessions;
  let s = store.get(userId, input.conversationId, context.now);
  const reset = !!input.conversationId && !s;
  if (!s) s = store.create(userId, input.scope, context.now);
  if (JSON.stringify(s.uiScope) !== JSON.stringify(input.scope)) {
    s.uiScope = input.scope; s.scope = undefined; s.bindings = []; s.queries = []; s.pending = undefined;
    s.lastQuestion = undefined; s.legacyId = undefined; s.legacyOptions = undefined;
    // doi trang giua luc xem truoc va ap dung: ke hoach cu khong con hop le
    await cancelOpenPlans(userId, s.id, 'SCOPE_CHANGED', context.now);
  }
  await resolveExecutionContext({ userId, now: context.now, scope: input.scope });
  if (context.actions ?? env.chatActions) {
    // go "huy" -> huy ke hoach dang mo; go "ok / ap dung" -> khong xac nhan (chi nut moi xac nhan). Khong goi LLM.
    const typed = await typedPlanCommand(s, input.message, context.now);
    if (typed) { const reply = actionReply(s, context.now, typed); if (reset) reply.conversationReset = true; return reply; }
  }
  // cau moi bo qua cau hoi chon dang do -> ke hoach dang cho chon bi bo
  if (s.pending?.kind === 'PLAN_REF' && s.pending.planId) { await cancelPlanRow(s.pending.planId, userId, 'SUPERSEDED', context.now); s.pending = undefined; }
  const message = s.pending?.kind === 'QUESTION' ? `${s.pending.original}\nBổ sung: ${input.message}` : input.message;
  // tep nguoi dung dinh kem vao CHINH tin nhan nay (kho tam; phai la tep cua ho, con han)
  const uploads = (input.uploadIds?.length ?? 0) > 0 ? (await resolveStaged(userId, input.uploadIds as string[], context.now)).map(refOf) : [];
  const reply = await answerQuestion(s, message, context, uploads);
  if (reset) reply.conversationReset = true;
  return reply;
}
export async function handleV2Choice(userId: string, input: z.infer<typeof v2ChoiceSchema>, context: V2ServiceContext): Promise<V2Reply> {
  const s = (context.sessions ?? v2Sessions).require(userId, input.conversationId, context.now);
  await assertSamePage(s, input.scope, context.now);
  await validateBindings(s, context.now);
  if (s.legacyOptions && s.legacyId) {
    const o = s.legacyOptions.find((o) => o.id === input.optionId);
    if (!o) throw new AppError('Lựa chọn không hợp lệ', 400);
    const selected = o.kind === 'USER' ? { userId: o.id } : o.kind === 'WORKSPACE' ? { workspaceId: o.id } : { targetId: o.id };
    return legacyReply(s, await handleChoice(userId, { conversationId: s.legacyId, ...selected }, { now: context.now, sessions: chatSessions }));
  }
  if (s.pending?.kind === 'PLAN_REF') {
    const pending = s.pending;
    if (!pending.planId || !pending.options.some((o) => o.id === input.optionId)) throw new AppError('Lựa chọn không hợp lệ', 400);
    try {
      const outcome = await choosePlanRef({ session: s, planId: pending.planId, optionId: input.optionId, now: context.now, autoExecute: context.autoExecute ?? env.chatAutoExecute });
      return actionReply(s, context.now, outcome);
    } catch (e) {
      if (e instanceof AppError && (e.statusCode === 404 || e.statusCode === 409)) s.pending = undefined; // het han / da xu ly: bo cau hoi chon
      throw e;
    }
  }
  const pending = s.pending;
  if (!pending || pending.kind !== 'ENTITY' || !pending.resolveInput) throw new AppError('Không có lựa chọn đang chờ', 400);
  if (!pending.options.some((o) => o.id === input.optionId)) throw new AppError('Lựa chọn không hợp lệ', 400);
  const result = await executeChatTool({ userId, now: context.now, scope: s.uiScope, conversationScope: s.scope }, 'resolve_entities', pending.resolveInput);
  const option = result.data.options.find((o) => o.id === input.optionId);
  if (!option) throw new AppError('Đối tượng không còn được phép xem', 403);
  bindEntity(s, option);
  s.pending = undefined;
  return answerQuestion(s, pending.original, context);
}
export async function handleV2More(userId: string, input: z.infer<typeof v2MoreSchema>, context: V2ServiceContext): Promise<V2Reply> {
  const s = (context.sessions ?? v2Sessions).require(userId, input.conversationId, context.now);
  await assertSamePage(s, input.scope, context.now);
  if (!input.blockId && s.legacyId && !s.queries.length) return legacyReply(s, await handleMore(userId, { conversationId: s.legacyId, page: input.page }, { now: context.now, sessions: chatSessions }));
  const saved = s.queries.find((q) => q.blockId === input.blockId);
  if (!saved || !saved.hasMore || input.page !== saved.page + 1) throw new AppError('Phần trả lời hoặc trang không hợp lệ', 400);
  const result = await executeChatTool({ userId, now: context.now, scope: s.uiScope }, saved.tool, { ...saved.input, page: input.page });
  const block = resultBlock(result, saved.blockId);
  saved.page = input.page;
  saved.hasMore = block.status === 'OK' && block.pagination.hasMore;
  return v2Reply(s, context.now, [block], 'BASIC');
}
