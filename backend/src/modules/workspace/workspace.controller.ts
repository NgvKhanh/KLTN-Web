import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import type {
  AddWorkspaceMemberInput,
  ChangeWorkspaceMemberRoleInput,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
} from './workspace.schema';
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listMyWorkspaces,
  updateWorkspace,
} from './workspace.service';
import {
  addWorkspaceMember,
  changeWorkspaceMemberRole,
  listWorkspaceMembers,
  removeWorkspaceMember,
  transferWorkspaceOwnership,
} from './workspaceMember.service';
import {
  getWorkspaceOverview,
  type OverviewStatusFilter,
} from './workspaceOverview.service';

const OVERVIEW_STATUSES: OverviewStatusFilter[] = [
  'all',
  'overdue',
  'unassigned',
  'done',
];

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError('Ban chua dang nhap', 401);
  }
  return req.user.id;
}

export const listMyWorkspacesHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const workspaces = await listMyWorkspaces(requireUserId(req));
    res.json({ success: true, data: { workspaces } });
  }
);

export const getWorkspaceHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const workspace = await getWorkspace(
      requireUserId(req),
      req.params.workspaceId as string
    );
    res.json({ success: true, data: { workspace } });
  }
);

export const createWorkspaceHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const workspace = await createWorkspace(
      requireUserId(req),
      req.body as CreateWorkspaceInput
    );
    res
      .status(201)
      .json({ success: true, message: 'Da tao khong gian', data: { workspace } });
  }
);

export const updateWorkspaceHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const workspace = await updateWorkspace(
      requireUserId(req),
      req.params.workspaceId as string,
      req.body as UpdateWorkspaceInput
    );
    res.json({ success: true, message: 'Da cap nhat khong gian', data: { workspace } });
  }
);

export const deleteWorkspaceHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteWorkspace(
      requireUserId(req),
      req.params.workspaceId as string
    );
    res.json({ success: true, message: 'Da xoa khong gian' });
  }
);

export const getWorkspaceOverviewHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { assigneeId, status } = req.query as {
      assigneeId?: string;
      status?: string;
    };
    const overview = await getWorkspaceOverview(
      requireUserId(req),
      req.params.workspaceId as string,
      {
        assigneeId: assigneeId || undefined,
        status: OVERVIEW_STATUSES.includes(status as OverviewStatusFilter)
          ? (status as OverviewStatusFilter)
          : undefined,
      }
    );
    res.json({ success: true, data: overview });
  }
);

export const listWorkspaceMembersHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const members = await listWorkspaceMembers(
      requireUserId(req),
      req.params.workspaceId as string
    );
    res.json({ success: true, data: { members } });
  }
);

export const addWorkspaceMemberHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const result = await addWorkspaceMember(
      requireUserId(req),
      req.params.workspaceId as string,
      req.body as AddWorkspaceMemberInput
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

export const changeWorkspaceMemberRoleHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const member = await changeWorkspaceMemberRole(
      requireUserId(req),
      req.params.workspaceId as string,
      req.params.userId as string,
      req.body as ChangeWorkspaceMemberRoleInput
    );
    res.json({ success: true, message: 'Da doi vai tro', data: { member } });
  }
);

export const transferWorkspaceOwnershipHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await transferWorkspaceOwnership(
      requireUserId(req),
      req.params.workspaceId as string,
      req.params.userId as string
    );
    res.json({ success: true, message: 'Da chuyen quyen so huu khong gian' });
  }
);

export const removeWorkspaceMemberHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await removeWorkspaceMember(
      requireUserId(req),
      req.params.workspaceId as string,
      req.params.userId as string
    );
    res.json({ success: true, message: 'Da xoa thanh vien' });
  }
);
