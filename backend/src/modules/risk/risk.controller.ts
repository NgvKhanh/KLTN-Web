import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import { getCardRisk } from './risk.service';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError('Ban chua dang nhap', 401);
  }
  return req.user.id;
}

// GET /api/cards/:cardId/risk - ket qua cham moi nhat (null = khong co / da cu / the khong con trong pham vi quet)
export const getCardRiskHandler = asyncHandler(async (req: Request, res: Response) => {
  const risk = await getCardRisk(requireUserId(req), req.params.cardId as string);
  res.json({ success: true, data: { risk } });
});
