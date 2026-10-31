import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { getPublicBoard, getPublicCard, listPublicBoardLists } from './publicBoard.service';

export const getPublicBoardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const board = await getPublicBoard(req.params.boardId as string);
    res.json({ success: true, data: { board } });
  }
);

export const listPublicBoardListsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const lists = await listPublicBoardLists(req.params.boardId as string);
    res.json({ success: true, data: { lists } });
  }
);

export const getPublicCardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const card = await getPublicCard(req.params.cardId as string);
    res.json({ success: true, data: { card } });
  }
);
