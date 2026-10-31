import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  isWatchingList,
  setBoardWatch,
  setCardWatch,
  setListWatch,
} from './watch.service';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError('Ban chua dang nhap', 401);
  }
  return req.user.id;
}

function watchingFromBody(req: Request): boolean {
  return Boolean((req.body as { watching?: unknown }).watching);
}

export const setBoardWatchHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const watching = watchingFromBody(req);
    await setBoardWatch(
      requireUserId(req),
      req.params.boardId as string,
      watching
    );
    res.json({ success: true, data: { watching } });
  }
);

export const setListWatchHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const watching = watchingFromBody(req);
    await setListWatch(
      requireUserId(req),
      req.params.listId as string,
      watching
    );
    res.json({ success: true, data: { watching } });
  }
);

export const getListWatchHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const watching = await isWatchingList(
      requireUserId(req),
      req.params.listId as string
    );
    res.json({ success: true, data: { watching } });
  }
);

export const setCardWatchHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const watching = watchingFromBody(req);
    await setCardWatch(
      requireUserId(req),
      req.params.cardId as string,
      watching
    );
    res.json({ success: true, data: { watching } });
  }
);
