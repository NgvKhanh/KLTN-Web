import { Router } from 'express';
import { env } from '../../../config/env';
import { AppError } from '../../../utils/AppError';
import { asyncHandler } from '../../../utils/asyncHandler';
import { chatActionLimiter, chatLimiter } from '../../../middleware/rateLimit.middleware';
import { validateBody } from '../../../middleware/validate.middleware';
import { planView } from './actions/actions.service';
import { v2CancelSchema, v2ChoiceSchema, v2ConfirmSchema, v2MessageSchema, v2MoreSchema, v2PlanIdSchema } from './chat.v2.contract';
import { conversationHistory, historyListSchema, historyTurnsSchema, listConversations, persistentCancel, persistentChoice, persistentConfirm, persistentMessage, persistentMore } from './chat.v2.history';
import { z } from 'zod';
import { v2LlmAvailable } from './chat.v2.llm';
import { discardStaged, refOf, registerStaged, stageUploadMiddleware } from './uploads/chat.uploads';

export const v2ChatRoutes = Router();
const active = new Set<string>();
// `actions`: lenh GHI co the chay khong (co CHAT_ACTIONS va co AI). Giao dien dua vao day de hien goi y / bo goi y.
v2ChatRoutes.get('/status', (_req, res) => res.json({ success: true, data: { engine: env.chatEngine, llmAvailable: v2LlmAvailable(), version: 'v2', actions: env.chatActions && v2LlmAvailable() } }));
v2ChatRoutes.get('/conversations', asyncHandler(async (req, res) => {
  const input = historyListSchema.safeParse(req.query);
  if (!input.success) throw new AppError('Trang lịch sử không hợp lệ.', 400);
  res.json({ success: true, data: await listConversations(req.user!.id, input.data.page) });
}));
v2ChatRoutes.get('/conversations/:id', asyncHandler(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  const input = historyTurnsSchema.safeParse(req.query);
  if (!id.success || !input.success) throw new AppError('Hội thoại hoặc trang lịch sử không hợp lệ.', 400);
  res.json({ success: true, data: await conversationHistory(req.user!.id, id.data, input.data.before, new Date()) });
}));
/** Mot yeu cau tai mot thoi diem cho moi nguoi dung (hai tab / bam dup khong chay chong len nhau). */
async function exclusive<T>(userId: string, run: () => Promise<T>): Promise<T> {
  if (active.has(userId)) throw new AppError('Trợ lý đang xử lý câu trước. Hãy chờ một chút.', 429);
  active.add(userId);
  try { return await run(); } finally { active.delete(userId); }
}
function post(path: string, schema: typeof v2MessageSchema | typeof v2ChoiceSchema | typeof v2MoreSchema) {
  v2ChatRoutes.post(path, chatLimiter, validateBody(schema), asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const data = await exclusive(userId, async () => {
      const context = { now: new Date() };
      return path === '/messages' ? persistentMessage(userId, v2MessageSchema.parse(req.body), context)
        : path === '/messages/choice' ? persistentChoice(userId, v2ChoiceSchema.parse(req.body), context)
        : persistentMore(userId, v2MoreSchema.parse(req.body), context);
    });
    res.json({ success: true, data });
  }));
}
post('/messages', v2MessageSchema);
post('/messages/choice', v2ChoiceSchema);
post('/messages/more', v2MoreSchema);

// Tep dinh kem (buoc G): tai len KHO TAM (chua gan vao the nao); chi gan khi ke hoach ADD_ATTACHMENT duoc Ap dung. Chi khi tro ly bat hanh dong.
v2ChatRoutes.post('/uploads', chatActionLimiter, (req, _res, next) => {
  if (!env.chatActions) return next(new AppError('Trợ lý đang tắt chức năng thay đổi dữ liệu nên chưa nhận tệp đính kèm.', 403));
  next();
}, stageUploadMiddleware, asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('Chưa chọn tệp.', 400);
  const staged = await registerStaged(req.user!.id, req.file, new Date());
  const { id, name, size } = refOf(staged);
  res.json({ success: true, data: { id, name, size } });
}));
v2ChatRoutes.delete('/uploads/:id', chatLimiter, asyncHandler(async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) throw new AppError('Tệp không hợp lệ.', 400);
  const removed = await discardStaged(req.user!.id, id.data);
  res.json({ success: true, data: { removed } });
}));

// Hanh dong (Phase 1). Ap dung / huy chi bang NUT, khong goi LLM; ke hoach nam o CSDL nen khong phu thuoc phien trong bo nho.
function planIdOf(value: unknown): string {
  const id = v2PlanIdSchema.safeParse(value);
  if (!id.success) throw new AppError('Kế hoạch không hợp lệ.', 400);
  return id.data;
}
v2ChatRoutes.post('/actions/:planId/confirm', chatActionLimiter, validateBody(v2ConfirmSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id; const planId = planIdOf(req.params.planId);
  const data = await exclusive(userId, () => persistentConfirm(userId, planId, v2ConfirmSchema.parse(req.body), { now: new Date() }));
  res.json({ success: true, data });
}));
v2ChatRoutes.post('/actions/:planId/cancel', chatLimiter, validateBody(v2CancelSchema), asyncHandler(async (req, res) => {
  const userId = req.user!.id; const planId = planIdOf(req.params.planId);
  const data = await exclusive(userId, () => persistentCancel(userId, planId, v2CancelSchema.parse(req.body).conversationId, { now: new Date() }));
  res.json({ success: true, data });
}));
v2ChatRoutes.get('/actions/:planId', asyncHandler(async (req, res) => {
  res.json({ success: true, data: await planView(req.user!.id, planIdOf(req.params.planId), new Date()) });
}));
