import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { uploadAiDocument } from '../../config/upload';
import { aiApplyLimiter, aiExtractLimiter, aiGenerateLimiter } from '../../middleware/rateLimit.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { applyPlanHandler, extractDocumentHandler, generatePlanHandler, getAiStatusHandler } from './ai.controller';
import { applyPlanSchema, generatePlanSchema } from './ai.schema';

// Gan vao /api/ai
export const aiRoutes = Router();
aiRoutes.use(requireAuth);
aiRoutes.get('/status', getAiStatusHandler);
// Doc tep .docx/.pdf -> chu de nguoi dung SUA roi moi sinh ke hoach. KHONG goi LLM, khong ghi DB.
// Thu tu: dang nhap (router.use) -> limiter -> multer (nhan tep vao bo nho) -> xu ly.
aiRoutes.post('/documents/extract', aiExtractLimiter, uploadAiDocument, extractDocumentHandler);
// Limiter dat TRUOC validate: yeu cau sai dinh dang cung ton han muc (chong do dung).
aiRoutes.post('/board-plans', aiGenerateLimiter, validateBody(generatePlanSchema), generatePlanHandler);
// Ap dung khong goi LLM nen dung limiter nhe hon (30/10 phut/user).
aiRoutes.post('/board-plans/:runId/apply', aiApplyLimiter, validateBody(applyPlanSchema), applyPlanHandler);
