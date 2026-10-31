import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import { applyPlan } from './ai.apply';
import { extractDocument } from './ai.document';
import type { ApplyPlanInput, GeneratePlanInput } from './ai.schema';
import { generatePlan, getAiStatus } from './ai.service';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError('Ban chua dang nhap', 401);
  }
  return req.user.id;
}

// Cho ket qua "AI co san sang khong" - frontend dung de hien huy hieu che do.
// KHONG BAO GIO tra 503 (co y lam nguoc mau Unsplash): thieu cau hinh AI khong phai
// loi, module van chay bang bo luat.
export const getAiStatusHandler = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: getAiStatus() });
});

// Trich chu tu tep da tai len (multer memoryStorage). KHONG goi LLM, KHONG ghi DB: nguoi dung
// sua chu roi moi gui sang POST /board-plans.
export const extractDocumentHandler = asyncHandler(async (req: Request, res: Response) => {
  requireUserId(req);
  if (!req.file) throw new AppError('Chưa chọn tệp (cần gửi tệp ở trường "file")', 400);
  const data = await extractDocument(req.file.buffer, req.file.originalname);
  res.json({ success: true, data });
});

export const generatePlanHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await generatePlan({
    userId: requireUserId(req),
    ...(req.body as GeneratePlanInput),
  });
  res.json({ success: true, data: result });
});

// Tra ve bang co cung hinh dang voi createBoard de frontend goi thang upsertBoard.
export const applyPlanHandler = asyncHandler(async (req: Request, res: Response) => {
  const { board } = await applyPlan(
    requireUserId(req),
    req.params.runId as string,
    (req.body as ApplyPlanInput).plan
  );
  res.status(201).json({ success: true, message: 'Da tao bang tu ke hoach AI', data: { board } });
});
