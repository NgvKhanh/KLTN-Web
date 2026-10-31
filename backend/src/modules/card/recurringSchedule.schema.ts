import { z } from 'zod';

const timeOfDay = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Gio phai dang HH:mm (vd 09:00)');

const baseFields = {
  title: z.string().trim().min(1, 'Thieu tieu de the').max(500),
  description: z.string().trim().max(5000).optional(),
  cardTemplateId: z.string().min(1).optional(),
  frequency: z.enum(['DAILY', 'WEEKLY', 'MONTHLY']),
  dayOfWeek: z.number().int().min(0).max(6).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional(),
  timeOfDay,
  startDate: z.string().datetime().optional(),
  endDate: z.union([z.string().datetime(), z.null()]).optional(),
};

function checkFrequencyFields(
  data: { frequency: string; dayOfWeek?: number; dayOfMonth?: number },
  ctx: z.RefinementCtx
) {
  if (data.frequency === 'WEEKLY' && data.dayOfWeek === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['dayOfWeek'],
      message: 'Can chon thu trong tuan khi lap lai theo tuan',
    });
  }
  if (data.frequency === 'MONTHLY' && data.dayOfMonth === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['dayOfMonth'],
      message: 'Can chon ngay trong thang khi lap lai theo thang',
    });
  }
}

export const createRecurringScheduleSchema = z
  .object(baseFields)
  .superRefine(checkFrequencyFields);

export const updateRecurringScheduleSchema = z
  .object({
    title: baseFields.title.optional(),
    description: baseFields.description,
    cardTemplateId: z.union([z.string().min(1), z.null()]).optional(),
    frequency: baseFields.frequency.optional(),
    dayOfWeek: baseFields.dayOfWeek,
    dayOfMonth: baseFields.dayOfMonth,
    timeOfDay: timeOfDay.optional(),
    startDate: baseFields.startDate,
    endDate: baseFields.endDate,
    isPaused: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Can it nhat 1 truong de cap nhat',
  });

export type CreateRecurringScheduleInput = z.infer<
  typeof createRecurringScheduleSchema
>;
export type UpdateRecurringScheduleInput = z.infer<
  typeof updateRecurringScheduleSchema
>;
