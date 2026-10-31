import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import type {
  CreateListInput,
  MoveAllCardsInput,
  SortListInput,
  UpdateListInput,
} from './list.schema';
import {
  archiveList,
  copyList,
  createList,
  deleteAllCards,
  deleteList,
  listBoardLists,
  moveAllCards,
  purgeList,
  restoreList,
  sortListCards,
  updateList,
} from './list.service';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError('Ban chua dang nhap', 401);
  }
  return req.user.id;
}

export const listBoardListsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const lists = await listBoardLists(
      requireUserId(req),
      req.params.boardId as string
    );
    res.json({ success: true, data: { lists } });
  }
);

export const createListHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const list = await createList(
      requireUserId(req),
      req.params.boardId as string,
      req.body as CreateListInput
    );
    res
      .status(201)
      .json({ success: true, message: 'Da them danh sach', data: { list } });
  }
);

export const updateListHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const list = await updateList(
      requireUserId(req),
      req.params.listId as string,
      req.body as UpdateListInput
    );
    res.json({ success: true, message: 'Da cap nhat danh sach', data: { list } });
  }
);

export const deleteListHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteList(requireUserId(req), req.params.listId as string);
    res.json({ success: true, message: 'Da xoa danh sach' });
  }
);

export const archiveListHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await archiveList(requireUserId(req), req.params.listId as string);
    res.json({ success: true, message: 'Da luu tru danh sach' });
  }
);

export const restoreListHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await restoreList(requireUserId(req), req.params.listId as string);
    res.json({ success: true, message: 'Da khoi phuc danh sach' });
  }
);

export const purgeListHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await purgeList(requireUserId(req), req.params.listId as string);
    res.json({ success: true, message: 'Da xoa han danh sach' });
  }
);

export const copyListHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const list = await copyList(
      requireUserId(req),
      req.params.listId as string
    );
    res
      .status(201)
      .json({ success: true, message: 'Da sao chep danh sach', data: { list } });
  }
);

export const moveAllCardsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await moveAllCards(
      requireUserId(req),
      req.params.listId as string,
      req.body as MoveAllCardsInput
    );
    res.json({ success: true, message: 'Da di chuyen toan bo the' });
  }
);

export const sortListHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await sortListCards(
      requireUserId(req),
      req.params.listId as string,
      req.body as SortListInput
    );
    res.json({ success: true, message: 'Da sap xep danh sach' });
  }
);

export const deleteAllCardsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteAllCards(requireUserId(req), req.params.listId as string);
    res.json({ success: true, message: 'Da xoa toan bo the trong danh sach' });
  }
);
