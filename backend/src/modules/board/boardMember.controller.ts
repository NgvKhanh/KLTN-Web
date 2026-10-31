import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import type {
  AddBoardMemberInput,
  ChangeMemberRoleInput,
} from './boardMember.schema';
import {
  addBoardMember,
  changeMemberRole,
  listBoardMembers,
  removeBoardMember,
  transferOwnership,
} from './boardMember.service';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError('Ban chua dang nhap', 401);
  }
  return req.user.id;
}

export const listBoardMembersHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const members = await listBoardMembers(
      requireUserId(req),
      req.params.boardId as string
    );
    res.json({ success: true, data: { members } });
  }
);

export const addBoardMemberHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await addBoardMember(
      requireUserId(req),
      req.params.boardId as string,
      req.body as AddBoardMemberInput
    );
    if (result.kind === 'invited') {
      res.json({
        success: true,
        message: `Da gui email moi toi ${result.email}`,
        data: { invitedEmail: result.email },
      });
      return;
    }
    res.status(201).json({
      success: true,
      message: 'Da them thanh vien',
      data: { member: result.member },
    });
  }
);

export const changeMemberRoleHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const member = await changeMemberRole(
      requireUserId(req),
      req.params.boardId as string,
      req.params.userId as string,
      req.body as ChangeMemberRoleInput
    );
    res.json({ success: true, message: 'Da doi vai tro', data: { member } });
  }
);

export const removeBoardMemberHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await removeBoardMember(
      requireUserId(req),
      req.params.boardId as string,
      req.params.userId as string
    );
    res.json({ success: true, message: 'Da xoa thanh vien' });
  }
);

export const transferOwnershipHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await transferOwnership(
      requireUserId(req),
      req.params.boardId as string,
      req.params.userId as string
    );
    res.json({ success: true, message: 'Da chuyen quyen so huu bang' });
  }
);
