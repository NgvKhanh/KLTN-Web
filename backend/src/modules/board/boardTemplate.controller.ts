import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  createBoardFromUserTemplate,
  deleteBoardTemplate,
  listBoardTemplates,
  saveBoardAsTemplate,
} from './boardTemplate.service';

function requireUserId(req: Request): string {
  if (!req.user) throw new AppError('Ban chua dang nhap', 401);
  return req.user.id;
}

export const listBoardTemplatesHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const templates = await listBoardTemplates(
      requireUserId(req),
      req.params.workspaceId as string
    );
    res.json({ success: true, data: { templates } });
  }
);

export const saveBoardAsTemplateHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const template = await saveBoardAsTemplate(
      requireUserId(req),
      req.params.boardId as string,
      (req.body as { name?: string }).name
    );
    res.status(201).json({ success: true, data: { template } });
  }
);

export const deleteBoardTemplateHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteBoardTemplate(
      requireUserId(req),
      req.params.templateId as string
    );
    res.json({ success: true, message: 'Da xoa mau' });
  }
);

export const createFromUserTemplateHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { workspaceId, templateId, name } = req.body as {
      workspaceId: string;
      templateId: string;
      name?: string;
    };
    const board = await createBoardFromUserTemplate(
      requireUserId(req),
      workspaceId,
      templateId,
      name
    );
    res.status(201).json({ success: true, data: { board } });
  }
);
