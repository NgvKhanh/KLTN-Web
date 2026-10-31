import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  getPreferenceHandler,
  listNotificationsHandler,
  markAllReadHandler,
  markReadHandler,
  unreadCountHandler,
  updatePreferenceHandler,
} from './notification.controller';
import { updateNotificationPreferenceSchema } from './notification.schema';

// Gan vao /api/notifications
const router = Router();
router.use(requireAuth);

router.get('/', listNotificationsHandler);
router.get('/unread-count', unreadCountHandler);
router.post('/read-all', markAllReadHandler);
router.post('/:id/read', markReadHandler);

router.get('/preferences', getPreferenceHandler);
router.patch(
  '/preferences',
  validateBody(updateNotificationPreferenceSchema),
  updatePreferenceHandler
);

export default router;
