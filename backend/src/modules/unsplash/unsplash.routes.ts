import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import {
  validateBody,
  validateQuery,
} from '../../middleware/validate.middleware';
import { listPhotosHandler, trackDownloadHandler } from './unsplash.controller';
import { listPhotosQuerySchema, trackDownloadSchema } from './unsplash.schema';

const router = Router();

router.use(requireAuth);

// GET /api/unsplash?query=...&page=1  -> tim anh nen
router.get('/', validateQuery(listPhotosQuerySchema), listPhotosHandler);

// POST /api/unsplash/track-download  -> bao Unsplash "anh nay da duoc dung"
router.post(
  '/track-download',
  validateBody(trackDownloadSchema),
  trackDownloadHandler
);

export default router;
