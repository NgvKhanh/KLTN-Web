import { z } from 'zod';

export const updateNotificationPreferenceSchema = z
  .object({
    cardInApp: z.boolean().optional(),
    cardEmailDigest: z.boolean().optional(),
    boardInApp: z.boolean().optional(),
    boardEmailDigest: z.boolean().optional(),
    dueReminderInApp: z.boolean().optional(),
    dueReminderEmail: z.boolean().optional(),
    riskInApp: z.boolean().optional(),
    riskEmail: z.boolean().optional(),
    dailyDigestEnabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Can it nhat 1 truong de cap nhat',
  });

export type UpdateNotificationPreferenceInput = z.infer<
  typeof updateNotificationPreferenceSchema
>;
