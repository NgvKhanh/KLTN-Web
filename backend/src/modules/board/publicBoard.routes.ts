import { Router } from 'express';
import { publicBoardLimiter } from '../../middleware/rateLimit.middleware';
import {
  getPublicBoardHandler,
  getPublicCardHandler,
  listPublicBoardListsHandler,
} from './publicBoard.controller';

// Gan vao /api/public - KHONG requireAuth: bang PUBLIC thi ai co link cung
// xem duoc, khong can dang nhap. Chi tra du lieu CHI DOC, khong co endpoint
// ghi nao o day.
const router = Router();
router.use(publicBoardLimiter);

router.get('/boards/:boardId', getPublicBoardHandler);
router.get('/boards/:boardId/lists', listPublicBoardListsHandler);
router.get('/cards/:cardId', getPublicCardHandler);

export default router;
