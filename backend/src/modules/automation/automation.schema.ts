import { z } from 'zod';

const actionSchema = z
  .object({
    type: z.enum(['SET_DONE', 'ADD_LABEL', 'ASSIGN_MEMBER']),
    boolValue: z.boolean().optional(),
    labelId: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.type === 'ADD_LABEL' && !v.labelId) {
      ctx.addIssue({ code: 'custom', path: ['labelId'], message: 'Thieu nhan' });
    }
    if (v.type === 'ASSIGN_MEMBER' && !v.userId) {
      ctx.addIssue({ code: 'custom', path: ['userId'], message: 'Thieu thanh vien' });
    }
  });

const baseFields = {
  name: z.string().trim().min(1, 'Thieu ten luat').max(200),
  isEnabled: z.boolean().optional(),
  triggerType: z.enum(['CARD_CREATED', 'CARD_MOVED_TO_LIST']),
  triggerListId: z.string().min(1).optional(),
  actions: z.array(actionSchema).min(1, 'Can it nhat 1 hanh dong').max(5),
};

export const createAutomationRuleSchema = z
  .object(baseFields)
  .superRefine((v, ctx) => {
    if (v.triggerType === 'CARD_MOVED_TO_LIST' && !v.triggerListId) {
      ctx.addIssue({
        code: 'custom',
        path: ['triggerListId'],
        message: 'Can chon danh sach dich khi kich hoat theo "chuyen vao danh sach"',
      });
    }
  });

export const updateAutomationRuleSchema = z
  .object({
    name: baseFields.name.optional(),
    isEnabled: baseFields.isEnabled,
    triggerType: baseFields.triggerType.optional(),
    triggerListId: z.union([z.string().min(1), z.null()]).optional(),
    actions: baseFields.actions.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: 'Can it nhat 1 truong de cap nhat',
  });

export type CreateAutomationRuleInput = z.infer<typeof createAutomationRuleSchema>;
export type UpdateAutomationRuleInput = z.infer<typeof updateAutomationRuleSchema>;
