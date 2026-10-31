import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  applyCardTemplate,
  createCardTemplate,
  deleteCardTemplate,
  listCardTemplates,
  saveCardAsTemplate,
} from './cardTemplate.service';

function requireUserId(req: Request): string {
  if (!req.user) throw new AppError('Ban chua dang nhap', 401);
  return req.user.id;
}

export const listCardTemplatesHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const templates = await listCardTemplates(
      requireUserId(req),
      req.params.boardId as string
    );
    res.json({ success: true, data: { templates } });
  }
);

export const createCardTemplateHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const template = await createCardTemplate(
      requireUserId(req),
      req.params.boardId as string,
      req.body
    );
    res.status(201).json({ success: true, data: { template } });
  }
);

export const saveCardAsTemplateHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const template = await saveCardAsTemplate(
      requireUserId(req),
      req.params.cardId as string,
      (req.body as { name?: string }).name
    );
    res.status(201).json({ success: true, data: { template } });
  }
);

export const deleteCardTemplateHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteCardTemplate(
      requireUserId(req),
      req.params.templateId as string
    );
    res.json({ success: true, message: 'Da xoa mau' });
  }
);

export const applyCardTemplateHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const card = await applyCardTemplate(
      requireUserId(req),
      req.params.listId as string,
      req.params.templateId as string,
      (req.body as { title?: string }).title
    );
    res.status(201).json({ success: true, data: { card } });
  }
);
