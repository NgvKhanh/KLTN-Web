import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import type { ChatChoiceInput, ChatMessageInput, ChatMoreInput } from './chat.schema';
import { getChatStatus, handleChoice, handleMessage, handleMore, type ChatContext } from './chat.service';
import { chatSessions } from './chat.session';

function requireUserId(req: Request): string {
  if (!req.user) throw new AppError('Ban chua dang nhap', 401);
  return req.user.id;
}

// TEP DUY NHAT cua module chatbot doc dong ho: moi tang duoi nhan `now` qua tham so.
function context(): ChatContext {
  return { now: new Date(), sessions: chatSessions };
}

export const getChatStatusHandler = asyncHandler(async (_req: Request, res: Response) => {
  res.json({ success: true, data: getChatStatus() });
});

export const postMessageHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await handleMessage(requireUserId(req), req.body as ChatMessageInput, context());
  res.json({ success: true, data });
});

export const postChoiceHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await handleChoice(requireUserId(req), req.body as ChatChoiceInput, context());
  res.json({ success: true, data });
});

export const postMoreHandler = asyncHandler(async (req: Request, res: Response) => {
  const data = await handleMore(requireUserId(req), req.body as ChatMoreInput, context());
  res.json({ success: true, data });
});
