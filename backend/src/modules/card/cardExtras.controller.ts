import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  attachLabel,
  detachLabel,
} from '../label/label.service';
import { getCardDetail } from './card.service';
import {
  addCardReminder,
  listCardReminders,
  removeCardReminder,
} from './cardReminder.service';
import type { CreateReminderInput } from './card.schema';
import {
  addAttachment,
  addCardMember,
  addChecklist,
  addChecklistItem,
  addComment,
  convertItemToCard,
  deleteAttachment,
  deleteChecklist,
  deleteChecklistItem,
  deleteComment,
  removeCardMember,
  reorderChecklistItems,
  updateChecklist,
  updateChecklistItem,
  updateComment,
} from './cardExtras.service';

function uid(req: Request): string {
  if (!req.user) throw new AppError('Ban chua dang nhap', 401);
  return req.user.id;
}

export const getCardDetailHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const card = await getCardDetail(uid(req), req.params.cardId as string);
    res.json({ success: true, data: { card } });
  }
);

// ----- Nhac han -----
export const listCardRemindersHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const reminders = await listCardReminders(
      uid(req),
      req.params.cardId as string
    );
    res.json({ success: true, data: { reminders } });
  }
);

export const addCardReminderHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const reminder = await addCardReminder(
      uid(req),
      req.params.cardId as string,
      (req.body as CreateReminderInput).offsetMinutes
    );
    res.status(201).json({ success: true, data: { reminder } });
  }
);

export const removeCardReminderHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await removeCardReminder(
      uid(req),
      req.params.cardId as string,
      Number(req.params.offsetMinutes)
    );
    res.json({ success: true, message: 'Da bo nhac han' });
  }
);

// ----- Thanh vien the -----
export const addCardMemberHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const member = await addCardMember(
      uid(req),
      req.params.cardId as string,
      (req.body as { userId: string }).userId
    );
    res.status(201).json({ success: true, data: { member } });
  }
);

export const removeCardMemberHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await removeCardMember(
      uid(req),
      req.params.cardId as string,
      req.params.userId as string
    );
    res.json({ success: true, message: 'Da bo thanh vien khoi the' });
  }
);

// ----- Checklist -----
export const addChecklistHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const body = req.body as {
      title?: string;
      copyFromChecklistId?: string;
    };
    const checklist = await addChecklist(
      uid(req),
      req.params.cardId as string,
      body.title ?? '',
      body.copyFromChecklistId
    );
    res.status(201).json({ success: true, data: { checklist } });
  }
);

export const updateChecklistHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const checklist = await updateChecklist(
      uid(req),
      req.params.checklistId as string,
      (req.body as { title: string }).title
    );
    res.json({ success: true, data: { checklist } });
  }
);

export const deleteChecklistHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteChecklist(uid(req), req.params.checklistId as string);
    res.json({ success: true, message: 'Da xoa checklist' });
  }
);

export const addChecklistItemHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const item = await addChecklistItem(
      uid(req),
      req.params.checklistId as string,
      (req.body as { content: string }).content
    );
    res.status(201).json({ success: true, data: { item } });
  }
);

export const updateChecklistItemHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const item = await updateChecklistItem(
      uid(req),
      req.params.itemId as string,
      req.body as { content?: string; isDone?: boolean }
    );
    res.json({ success: true, data: { item } });
  }
);

export const deleteChecklistItemHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteChecklistItem(uid(req), req.params.itemId as string);
    res.json({ success: true, message: 'Da xoa muc' });
  }
);

export const reorderChecklistItemsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await reorderChecklistItems(
      uid(req),
      req.params.checklistId as string,
      (req.body as { itemIds: string[] }).itemIds
    );
    res.json({ success: true, message: 'Da sap xep lai muc' });
  }
);

export const convertItemToCardHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const card = await convertItemToCard(uid(req), req.params.itemId as string);
    res
      .status(201)
      .json({ success: true, message: 'Da chuyen muc thanh the', data: { card } });
  }
);

// ----- Binh luan -----
export const addCommentHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const body = req.body as { text: string; parentId?: string };
    const comment = await addComment(
      uid(req),
      req.params.cardId as string,
      body.text,
      body.parentId
    );
    res.status(201).json({ success: true, data: { comment } });
  }
);

export const updateCommentHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const comment = await updateComment(
      uid(req),
      req.params.commentId as string,
      (req.body as { text: string }).text
    );
    res.json({ success: true, data: { comment } });
  }
);

export const deleteCommentHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteComment(uid(req), req.params.commentId as string);
    res.json({ success: true, message: 'Da xoa binh luan' });
  }
);

// ----- Tep dinh kem -----
export const addAttachmentHandler = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.file) throw new AppError('Chua chon tep', 400);
    const attachment = await addAttachment(
      uid(req),
      req.params.cardId as string,
      req.file
    );
    res.status(201).json({ success: true, data: { attachment } });
  }
);

export const deleteAttachmentHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteAttachment(uid(req), req.params.attachmentId as string);
    res.json({ success: true, message: 'Da xoa tep dinh kem' });
  }
);

// ----- Gan / bo nhan tren the -----
export const attachLabelHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const label = await attachLabel(
      uid(req),
      req.params.cardId as string,
      req.params.labelId as string
    );
    res.json({ success: true, data: { label } });
  }
);

export const detachLabelHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await detachLabel(
      uid(req),
      req.params.cardId as string,
      req.params.labelId as string
    );
    res.json({ success: true, message: 'Da bo nhan' });
  }
);
