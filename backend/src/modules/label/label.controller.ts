import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  createLabel,
  deleteLabel,
  listBoardLabels,
  updateLabel,
} from './label.service';

function uid(req: Request): string {
  if (!req.user) throw new AppError('Ban chua dang nhap', 401);
  return req.user.id;
}

export const listBoardLabelsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const labels = await listBoardLabels(
      uid(req),
      req.params.boardId as string
    );
    res.json({ success: true, data: { labels } });
  }
);

export const createLabelHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const label = await createLabel(
      uid(req),
      req.params.boardId as string,
      req.body as { name?: string; color: string }
    );
    res.status(201).json({ success: true, data: { label } });
  }
);

export const updateLabelHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const label = await updateLabel(
      uid(req),
      req.params.labelId as string,
      req.body as { name?: string; color?: string }
    );
    res.json({ success: true, data: { label } });
  }
);

export const deleteLabelHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteLabel(uid(req), req.params.labelId as string);
    res.json({ success: true, message: 'Da xoa nhan' });
  }
);
