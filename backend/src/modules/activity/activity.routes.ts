import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import { assertBoardView } from '../board/board.service';
import {
  listBoardActivity,
  listHomeActivity,
  listMyActivity,
} from './activity.service';

const router = Router();
router.use(requireAuth);

// GET /api/activities/me -> nhat ky thao tac cua toi
router.get(
  '/me',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError('Ban chua dang nhap', 401);
    // ?before=<ISO> (phan trang: createdAt cua dong cuoi trang truoc), ?limit=1..100
    const beforeRaw = typeof req.query.before === 'string' ? new Date(req.query.before) : undefined;
    const before = beforeRaw && !Number.isNaN(beforeRaw.getTime()) ? beforeRaw : undefined;
    const limitRaw = Number(req.query.limit);
    const { activities, hasMore } = await listMyActivity(req.user.id, {
      before,
      ...(Number.isFinite(limitRaw) && limitRaw > 0 ? { limit: limitRaw } : {}),
    });
    res.json({ success: true, data: { activities, hasMore } });
  })
);

// GET /api/activities/home -> nhat ky gop tren moi bang cua toi; ?scope=others -> chi viec nguoi khac lam
router.get(
  '/home',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError('Ban chua dang nhap', 401);
    const activities = await listHomeActivity(req.user.id, { excludeSelf: req.query.scope === 'others' });
    res.json({ success: true, data: { activities } });
  })
);

// GET /api/activities/board/:boardId -> nhat ky ca bang
router.get(
  '/board/:boardId',
  asyncHandler(async (req, res) => {
    if (!req.user) throw new AppError('Ban chua dang nhap', 401);
    await assertBoardView(req.user.id, req.params.boardId as string);
    const activities = await listBoardActivity(req.params.boardId as string);
    res.json({ success: true, data: { activities } });
  })
);

export default router;
