import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  approveJoinRequest,
  createInviteToken,
  disableInviteToken,
  getInviteToken,
  listJoinRequests,
  previewByToken,
  rejectJoinRequest,
  requestToJoin,
} from './boardShare.service';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError('Ban chua dang nhap', 401);
  }
  return req.user.id;
}

// Dia chi frontend (dung phan tu dau trong CORS_ORIGIN) de ghep link moi
function inviteUrl(token: string): string {
  const base = env.corsOrigins[0] ?? 'http://localhost:5173';
  return `${base.replace(/\/$/, '')}/join/${token}`;
}

export const getInviteLinkHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const token = await getInviteToken(
      requireUserId(req),
      req.params.boardId as string
    );
    res.json({
      success: true,
      data: { token, url: token ? inviteUrl(token) : null },
    });
  }
);

export const createInviteLinkHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const token = await createInviteToken(
      requireUserId(req),
      req.params.boardId as string
    );
    res.json({
      success: true,
      message: 'Da tao link moi',
      data: { token, url: token ? inviteUrl(token) : null },
    });
  }
);

export const disableInviteLinkHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await disableInviteToken(
      requireUserId(req),
      req.params.boardId as string
    );
    res.json({ success: true, message: 'Da thu hoi link moi' });
  }
);

export const previewInviteHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await previewByToken(
      requireUserId(req),
      req.params.token as string
    );
    res.json({ success: true, data });
  }
);

export const requestToJoinHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const data = await requestToJoin(
      requireUserId(req),
      req.params.token as string
    );
    res
      .status(201)
      .json({ success: true, message: 'Da gui yeu cau tham gia', data });
  }
);

export const listJoinRequestsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const requests = await listJoinRequests(
      requireUserId(req),
      req.params.boardId as string
    );
    res.json({ success: true, data: { requests } });
  }
);

export const approveJoinRequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const member = await approveJoinRequest(
      requireUserId(req),
      req.params.boardId as string,
      req.params.requestId as string
    );
    res.json({ success: true, message: 'Da duyet yeu cau', data: { member } });
  }
);

export const rejectJoinRequestHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await rejectJoinRequest(
      requireUserId(req),
      req.params.boardId as string,
      req.params.requestId as string
    );
    res.json({ success: true, message: 'Da tu choi yeu cau' });
  }
);
