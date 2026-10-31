import { z } from 'zod';

export const CUSTOM_FIELD_TYPES = [
  'TEXT',
  'NUMBER',
  'DATE',
  'CHECKBOX',
  'DROPDOWN',
] as const;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Mau khong hop le');

export const createCustomFieldSchema = z.object({
  name: z.string().trim().min(1, 'Ten truong khong duoc de trong').max(60),
  type: z.enum(CUSTOM_FIELD_TYPES),
  // Chi dung khi type = DROPDOWN; cac type khac bo qua neu co gui len
  options: z
    .array(
      z.object({
        value: z.string().trim().min(1).max(60),
        color: hexColor.optional(),
      })
    )
    .max(30)
    .optional(),
});

export const updateCustomFieldSchema = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Khong co du lieu nao de cap nhat',
  });

export const addFieldOptionSchema = z.object({
  value: z.string().trim().min(1, 'Gia tri khong duoc de trong').max(60),
  color: hexColor.optional(),
});

export const updateFieldOptionSchema = z
  .object({
    value: z.string().trim().min(1).max(60).optional(),
    color: z.union([hexColor, z.null()]).optional(),
    position: z.number().int().min(0).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Khong co du lieu nao de cap nhat',
  });

// Gia tri 1 truong tuy chinh tren 1 the. Kieu thuc te phai khop
// CustomField.type (kiem tra o service, khong the bieu dien het bang zod
// don vi phai biet truoc field.type).
export const setCardFieldValueSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
});

export type CreateCustomFieldInput = z.infer<typeof createCustomFieldSchema>;
export type UpdateCustomFieldInput = z.infer<typeof updateCustomFieldSchema>;
export type AddFieldOptionInput = z.infer<typeof addFieldOptionSchema>;
export type UpdateFieldOptionInput = z.infer<typeof updateFieldOptionSchema>;
export type SetCardFieldValueInput = z.infer<typeof setCardFieldValueSchema>;
