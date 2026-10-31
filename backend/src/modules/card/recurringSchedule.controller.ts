import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import type {
  CreateRecurringScheduleInput,
  UpdateRecurringScheduleInput,
} from './recurringSchedule.schema';
import {
  createSchedule,
  deleteSchedule,
  listSchedulesForList,
  updateSchedule,
} from './recurringSchedule.service';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError('Ban chua dang nhap', 401);
  }
  return req.user.id;
}

export const listSchedulesHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const schedules = await listSchedulesForList(
      requireUserId(req),
      req.params.listId as string
    );
    res.json({ success: true, data: { schedules } });
  }
);

export const createScheduleHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const schedule = await createSchedule(
      requireUserId(req),
      req.params.listId as string,
      req.body as CreateRecurringScheduleInput
    );
    res
      .status(201)
      .json({ success: true, message: 'Da tao lich the dinh ky', data: { schedule } });
  }
);

export const updateScheduleHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const schedule = await updateSchedule(
      requireUserId(req),
      req.params.scheduleId as string,
      req.body as UpdateRecurringScheduleInput
    );
    res.json({ success: true, message: 'Da cap nhat lich', data: { schedule } });
  }
);

export const deleteScheduleHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteSchedule(requireUserId(req), req.params.scheduleId as string);
    res.json({ success: true, message: 'Da xoa lich' });
  }
);
