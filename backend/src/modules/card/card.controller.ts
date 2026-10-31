import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import type {
  CopyCardInput,
  CreateCardInput,
  MoveCardInput,
  UpdateCardInput,
} from './card.schema';
import {
  archiveCard,
  copyCard,
  createCard,
  deleteCard,
  listCalendarCards,
  listCalendarChecklistItems,
  listMyCards,
  moveCard,
  purgeCard,
  restoreCard,
  searchCards,
  updateCard,
} from './card.service';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError('Ban chua dang nhap', 401);
  }
  return req.user.id;
}

export const createCardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const card = await createCard(
      requireUserId(req),
      req.params.listId as string,
      req.body as CreateCardInput
    );
    res
      .status(201)
      .json({ success: true, message: 'Da them the', data: { card } });
  }
);

export const listMyCardsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const cards = await listMyCards(requireUserId(req));
    res.json({ success: true, data: { cards } });
  }
);

export const listCalendarHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { from, to } = req.query as { from?: string; to?: string };
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;
    if (
      !fromDate ||
      !toDate ||
      Number.isNaN(fromDate.getTime()) ||
      Number.isNaN(toDate.getTime())
    ) {
      throw new AppError('Thieu hoac sai tham so from/to', 400);
    }
    const uid = requireUserId(req);
    const [cards, checklistItems] = await Promise.all([
      listCalendarCards(uid, fromDate, toDate),
      listCalendarChecklistItems(uid, fromDate, toDate),
    ]);
    res.json({ success: true, data: { cards, checklistItems } });
  }
);

export const searchCardsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const cards = await searchCards(requireUserId(req), q);
    res.json({ success: true, data: { cards } });
  }
);

export const updateCardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const card = await updateCard(
      requireUserId(req),
      req.params.cardId as string,
      req.body as UpdateCardInput
    );
    res.json({ success: true, message: 'Da cap nhat the', data: { card } });
  }
);

export const copyCardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const card = await copyCard(
      requireUserId(req),
      req.params.cardId as string,
      req.body as CopyCardInput
    );
    res
      .status(201)
      .json({ success: true, message: 'Da sao chep the', data: { card } });
  }
);

export const moveCardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const card = await moveCard(
      requireUserId(req),
      req.params.cardId as string,
      req.body as MoveCardInput
    );
    res.json({ success: true, message: 'Da di chuyen the', data: { card } });
  }
);

export const deleteCardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteCard(requireUserId(req), req.params.cardId as string);
    res.json({ success: true, message: 'Da xoa the' });
  }
);

export const archiveCardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await archiveCard(requireUserId(req), req.params.cardId as string);
    res.json({ success: true, message: 'Da luu tru the' });
  }
);

export const restoreCardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await restoreCard(requireUserId(req), req.params.cardId as string);
    res.json({ success: true, message: 'Da khoi phuc the' });
  }
);

export const purgeCardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await purgeCard(requireUserId(req), req.params.cardId as string);
    res.json({ success: true, message: 'Da xoa han the' });
  }
);
