import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import {
  validateBody,
} from '../../middleware/validate.middleware';
import {
  createScheduleHandler,
  deleteScheduleHandler,
  listSchedulesHandler,
  updateScheduleHandler,
} from './recurringSchedule.controller';
import {
  createRecurringScheduleSchema,
  updateRecurringScheduleSchema,
} from './recurringSchedule.schema';

// Gan vao /api/lists/:listId/recurring-schedules
export const listRecurringScheduleRoutes = Router({ mergeParams: true });
listRecurringScheduleRoutes.use(requireAuth);
listRecurringScheduleRoutes.get('/', listSchedulesHandler);
listRecurringScheduleRoutes.post(
  '/',
  validateBody(createRecurringScheduleSchema),
  createScheduleHandler
);

// Gan vao /api/recurring-schedules
export const recurringScheduleRoutes = Router();
recurringScheduleRoutes.use(requireAuth);
recurringScheduleRoutes.patch(
  '/:scheduleId',
  validateBody(updateRecurringScheduleSchema),
  updateScheduleHandler
);
recurringScheduleRoutes.delete('/:scheduleId', deleteScheduleHandler);
