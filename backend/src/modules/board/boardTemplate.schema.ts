import { z } from 'zod';

export const saveAsTemplateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
});

export const createFromUserTemplateSchema = z.object({
  templateId: z.string().trim().min(1, 'Thieu ma mau'),
  workspaceId: z.string().trim().min(1, 'Thieu khong gian lam viec'),
  name: z.string().trim().min(1).max(100).optional(),
});
