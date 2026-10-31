import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import type { CreateBoardInput, UpdateBoardInput } from './board.schema';
import {
  archiveBoard,
  clearBoardBackground,
  createBoard,
  createBoardFromTemplate,
  deleteBoard,
  exportBoard,
  getBoard,
  listArchivedBoards,
  listBoardArchive,
  listMyBoards,
  purgeBoard,
  restoreBoard,
  setBoardBackground,
  setBoardStar,
  updateBoard,
} from './board.service';
import { BOARD_TEMPLATES, TEMPLATE_CATEGORIES } from './boardTemplates';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError('Ban chua dang nhap', 401);
  }
  return req.user.id;
}

export const listMyBoardsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const boards = await listMyBoards(requireUserId(req));
    res.json({ success: true, data: { boards } });
  }
);

export const getBoardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const board = await getBoard(
      requireUserId(req),
      req.params.boardId as string
    );
    res.json({ success: true, data: { board } });
  }
);

export const listBoardArchiveHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const archive = await listBoardArchive(
      requireUserId(req),
      req.params.boardId as string
    );
    res.json({ success: true, data: archive });
  }
);

export const exportBoardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await exportBoard(
      requireUserId(req),
      req.params.boardId as string
    );
    res.json({ success: true, data });
  }
);

export const listArchivedBoardsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const boards = await listArchivedBoards(requireUserId(req));
    res.json({ success: true, data: { boards } });
  }
);

export const archiveBoardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await archiveBoard(requireUserId(req), req.params.boardId as string);
    res.json({ success: true, message: 'Da luu tru bang' });
  }
);

export const restoreBoardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await restoreBoard(requireUserId(req), req.params.boardId as string);
    res.json({ success: true, message: 'Da khoi phuc bang' });
  }
);

export const purgeBoardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await purgeBoard(requireUserId(req), req.params.boardId as string);
    res.json({ success: true, message: 'Da xoa han bang' });
  }
);

export const listTemplatesHandler = asyncHandler(
  async (_req: Request, res: Response) => {
    res.json({ success: true, data: { templates: BOARD_TEMPLATES, categories: TEMPLATE_CATEGORIES } });
  }
);

export const createFromTemplateHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const body = req.body as {
      templateId: string;
      workspaceId: string;
      name?: string;
    };
    const board = await createBoardFromTemplate(
      requireUserId(req),
      body.workspaceId,
      body.templateId,
      body.name
    );
    res
      .status(201)
      .json({ success: true, message: 'Da tao bang tu mau', data: { board } });
  }
);

export const createBoardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const board = await createBoard(
      requireUserId(req),
      req.body as CreateBoardInput
    );
    res
      .status(201)
      .json({ success: true, message: 'Da tao bang', data: { board } });
  }
);

export const updateBoardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const board = await updateBoard(
      requireUserId(req),
      req.params.boardId as string,
      req.body as UpdateBoardInput
    );
    res.json({ success: true, message: 'Da cap nhat bang', data: { board } });
  }
);

export const uploadBoardBackgroundHandler = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.file) {
      throw new AppError('Chua chon anh de tai len', 400);
    }
    const board = await setBoardBackground(
      requireUserId(req),
      req.params.boardId as string,
      req.file.filename
    );
    res.json({ success: true, message: 'Da cap nhat anh nen', data: { board } });
  }
);

export const deleteBoardBackgroundHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const board = await clearBoardBackground(
      requireUserId(req),
      req.params.boardId as string
    );
    res.json({ success: true, message: 'Da bo anh nen', data: { board } });
  }
);

export const deleteBoardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteBoard(requireUserId(req), req.params.boardId as string);
    res.json({ success: true, message: 'Da xoa bang' });
  }
);

export const setBoardStarHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const starred = Boolean((req.body as { starred?: unknown }).starred);
    await setBoardStar(
      requireUserId(req),
      req.params.boardId as string,
      starred
    );
    res.json({ success: true, data: { starred } });
  }
);
