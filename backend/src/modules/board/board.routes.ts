import { Router } from 'express';
import { uploadBoardBackground } from '../../config/upload';
import { requireAuth } from '../../middleware/auth.middleware';
import {
  cleanupUploadOnError,
  requireBoardAccess,
} from '../../middleware/uploadGuard.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  archiveBoardHandler,
  createBoardHandler,
  createFromTemplateHandler,
  deleteBoardBackgroundHandler,
  deleteBoardHandler,
  exportBoardHandler,
  getBoardHandler,
  listArchivedBoardsHandler,
  listBoardArchiveHandler,
  listMyBoardsHandler,
  listTemplatesHandler,
  purgeBoardHandler,
  restoreBoardHandler,
  setBoardStarHandler,
  updateBoardHandler,
  uploadBoardBackgroundHandler,
} from './board.controller';
import {
  createBoardSchema,
  fromTemplateSchema,
  updateBoardSchema,
} from './board.schema';
import {
  approveJoinRequestHandler,
  createInviteLinkHandler,
  disableInviteLinkHandler,
  getInviteLinkHandler,
  listJoinRequestsHandler,
  previewInviteHandler,
  rejectJoinRequestHandler,
  requestToJoinHandler,
} from './boardShare.controller';
import { setBoardWatchHandler } from '../watch/watch.controller';
import {
  createFromUserTemplateHandler,
  deleteBoardTemplateHandler,
  saveBoardAsTemplateHandler,
} from './boardTemplate.controller';
import {
  createFromUserTemplateSchema,
  saveAsTemplateSchema,
} from './boardTemplate.schema';

const router = Router();

router.use(requireAuth);

// Vao bang bang link moi (dat truoc "/:boardId" de khong bi nham)
router.get('/join/:token', previewInviteHandler);
router.post('/join/:token', requestToJoinHandler);

router.get('/', listMyBoardsHandler);
router.get('/archived', listArchivedBoardsHandler);
router.get('/templates', listTemplatesHandler);
router.delete('/templates/:templateId', deleteBoardTemplateHandler);
router.post('/', validateBody(createBoardSchema), createBoardHandler);
router.post(
  '/from-template',
  validateBody(fromTemplateSchema),
  createFromTemplateHandler
);
router.post(
  '/from-saved-template',
  validateBody(createFromUserTemplateSchema),
  createFromUserTemplateHandler
);
router.get('/:boardId', getBoardHandler);
router.get('/:boardId/archive', listBoardArchiveHandler);
router.get('/:boardId/export', exportBoardHandler);
router.patch('/:boardId', validateBody(updateBoardSchema), updateBoardHandler);
router.put('/:boardId/star', setBoardStarHandler);
router.put('/:boardId/watch', setBoardWatchHandler);
router.post(
  '/:boardId/save-as-template',
  validateBody(saveAsTemplateSchema),
  saveBoardAsTemplateHandler
);
router.post('/:boardId/archive-board', archiveBoardHandler);
router.post('/:boardId/restore', restoreBoardHandler);
router.delete('/:boardId/purge', purgeBoardHandler);
router.delete('/:boardId', deleteBoardHandler);

// Anh nen: kiem tra quyen sua bang TRUOC khi ghi file; don file rac neu loi.
router.post(
  '/:boardId/background',
  requireBoardAccess,
  uploadBoardBackground,
  uploadBoardBackgroundHandler,
  cleanupUploadOnError
);
router.delete('/:boardId/background', deleteBoardBackgroundHandler);

// Link moi (Quan tri vien)
router.get('/:boardId/invite-link', getInviteLinkHandler);
router.post('/:boardId/invite-link', createInviteLinkHandler);
router.delete('/:boardId/invite-link', disableInviteLinkHandler);

// Yeu cau tham gia (Quan tri vien duyet)
router.get('/:boardId/join-requests', listJoinRequestsHandler);
router.post(
  '/:boardId/join-requests/:requestId/approve',
  approveJoinRequestHandler
);
router.post(
  '/:boardId/join-requests/:requestId/reject',
  rejectJoinRequestHandler
);

export default router;
