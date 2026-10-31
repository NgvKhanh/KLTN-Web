import fs from 'node:fs';
import type { Request, Response, NextFunction } from 'express';
import { assertBoardAccess } from '../modules/board/board.service';
import { assertCardAccess } from '../modules/card/card.service';
import { asyncHandler } from '../utils/asyncHandler';

/**
 * Kiem tra quyen tren tai nguyen TRUOC khi middleware upload (multer) ghi file
 * xuong dia. Neu bo qua buoc nay, mot tai khoan hop le co the gui file toi mot
 * cardId/boardId khong duoc phep: request bi tu choi o handler nhung file da
 * nam tren o dia va khong ai don.
 */
export const requireCardAccess = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    await assertCardAccess(req.user!.id, req.params.cardId as string);
    next();
  }
);

export const requireBoardAccess = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    await assertBoardAccess(req.user!.id, req.params.boardId as string);
    next();
  }
);

/**
 * Luoi an toan: neu multer da ghi file nhung buoc xu ly sau do that bai,
 * xoa file rac roi chuyen tiep loi.
 * Gan NGAY SAU handler upload trong chuoi route.
 */
export function cleanupUploadOnError(
  err: unknown,
  req: Request,
  _res: Response,
  next: NextFunction
) {
  const filePath = req.file?.path;
  if (filePath) {
    fs.promises.unlink(filePath).catch(() => {
      // file co the da bi xoa -> bo qua
    });
  }
  next(err);
}
