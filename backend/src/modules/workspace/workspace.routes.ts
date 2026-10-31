import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  addWorkspaceMemberHandler,
  changeWorkspaceMemberRoleHandler,
  createWorkspaceHandler,
  deleteWorkspaceHandler,
  getWorkspaceHandler,
  getWorkspaceOverviewHandler,
  listMyWorkspacesHandler,
  listWorkspaceMembersHandler,
  removeWorkspaceMemberHandler,
  transferWorkspaceOwnershipHandler,
  updateWorkspaceHandler,
} from './workspace.controller';
import { listBoardTemplatesHandler } from '../board/boardTemplate.controller';
import {
  addWorkspaceMemberSchema,
  changeWorkspaceMemberRoleSchema,
  createWorkspaceSchema,
  updateWorkspaceSchema,
} from './workspace.schema';

const router = Router();

router.use(requireAuth);

router.get('/', listMyWorkspacesHandler);
router.post('/', validateBody(createWorkspaceSchema), createWorkspaceHandler);
router.get('/:workspaceId', getWorkspaceHandler);
router.patch(
  '/:workspaceId',
  validateBody(updateWorkspaceSchema),
  updateWorkspaceHandler
);
router.delete('/:workspaceId', deleteWorkspaceHandler);

// Tong quan: the tren moi bang trong khong gian, so lieu quá han / chưa giao
router.get('/:workspaceId/overview', getWorkspaceOverviewHandler);

// Mau bang do nguoi dung tu luu, pham vi khong gian nay
router.get('/:workspaceId/board-templates', listBoardTemplatesHandler);

// Thanh vien khong gian
router.get('/:workspaceId/members', listWorkspaceMembersHandler);
router.post(
  '/:workspaceId/members',
  validateBody(addWorkspaceMemberSchema),
  addWorkspaceMemberHandler
);
router.patch(
  '/:workspaceId/members/:userId',
  validateBody(changeWorkspaceMemberRoleSchema),
  changeWorkspaceMemberRoleHandler
);
router.post(
  '/:workspaceId/members/:userId/transfer-ownership',
  transferWorkspaceOwnershipHandler
);
router.delete('/:workspaceId/members/:userId', removeWorkspaceMemberHandler);

export default router;
