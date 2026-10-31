import { z } from 'zod';

export const createCardTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Ten mau khong duoc de trong').max(500),
  description: z.string().trim().max(5000).optional(),
  checklists: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(200),
        items: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
      })
    )
    .max(20)
    .optional(),
});

export const saveCardAsTemplateSchema = z.object({
  name: z.string().trim().min(1).max(500).optional(),
});

export const applyCardTemplateSchema = z.object({
  title: z.string().trim().min(1).max(500).optional(),
});
