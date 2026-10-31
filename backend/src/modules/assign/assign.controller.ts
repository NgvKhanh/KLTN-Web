import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import type { OutcomeInput, WeightsInput, WorkProfileInput } from './assign.schema';
import {
  getMyWorkProfile,
  getWorkspaceWeights,
  planForList,
  recordOutcome,
  resetWorkspaceWeights,
  setMyWorkProfile,
  setWorkspaceWeights,
  suggestForCard,
} from './assign.service';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError('Ban chua dang nhap', 401);
  }
  return req.user.id;
}

// GET nhung CO GHI 1 dong AssignRun (nhat ky) - vi the route co gioi han toc do.
export const suggestHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await suggestForCard(requireUserId(req), req.params.cardId as string);
  res.json({ success: true, data });
});

// POST nhung KHONG ghi CSDL: chi tinh ban xem truoc chia viec cho ca danh sach (lop 2). Dung POST vi ton tai nguyen
// (doc ca khong gian, cham tung the) - route co gioi han toc do rieng.
export const planHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await planForList(requireUserId(req), req.params.listId as string);
  res.json({ success: true, data });
});

export const outcomeHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await recordOutcome(
    requireUserId(req),
    req.params.runId as string,
    (req.body as OutcomeInput).chosenUserId
  );
  res.json({ success: true, data });
});

export const getWeightsHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await getWorkspaceWeights(requireUserId(req), req.params.workspaceId as string);
  res.json({ success: true, data });
});

export const putWeightsHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await setWorkspaceWeights(
    requireUserId(req),
    req.params.workspaceId as string,
    req.body as WeightsInput
  );
  res.json({ success: true, message: 'Da luu trong so', data });
});

export const resetWeightsHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await resetWorkspaceWeights(requireUserId(req), req.params.workspaceId as string);
  res.json({ success: true, message: 'Da dat lai trong so mac dinh', data });
});

// Ho so lam viec cua CHINH nguoi goi (so the song song toi da, tam nghi)
export const getProfileHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await getMyWorkProfile(requireUserId(req), req.params.workspaceId as string);
  res.json({ success: true, data });
});

export const putProfileHandler = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as WorkProfileInput;
  const data = await setMyWorkProfile(requireUserId(req), req.params.workspaceId as string, {
    maxParallelCards: body.maxParallelCards,
    pausedUntil: body.pausedUntil === null ? null : new Date(body.pausedUntil),
  });
  res.json({ success: true, message: 'Da luu ho so lam viec', data });
});
