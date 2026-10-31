import { z } from 'zod';

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Mau khong hop le (can dang #RRGGBB)');

// URL anh nen (vd anh tu Unsplash). Chi nhan http(s).
const imageUrl = z
  .string()
  .trim()
  .regex(/^https?:\/\//, 'URL anh nen khong hop le')
  .max(2048);

export const createBoardSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Ten bang khong duoc de trong')
    .max(100, 'Ten bang qua dai'),
  workspaceId: z.string().trim().min(1, 'Thieu khong gian lam viec'),
  color: hexColor.optional(),
  backgroundImage: imageUrl.optional(),
});

export const updateBoardSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Ten bang khong duoc de trong')
      .max(100, 'Ten bang qua dai')
      .optional(),
    color: hexColor.optional(),
    // string -> doi sang anh nen moi; null -> bo anh nen, quay ve mau
    backgroundImage: imageUrl.nullable().optional(),
    // PRIVATE: chi thanh vien bang. WORKSPACE: moi thanh vien khong gian xem/sua.
    // PUBLIC: ai co link deu xem (chi doc).
    visibility: z.enum(['PRIVATE', 'WORKSPACE', 'PUBLIC']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Khong co du lieu nao de cap nhat',
  });

export const fromTemplateSchema = z.object({
  templateId: z.string().trim().min(1, 'Thieu ma mau'),
  workspaceId: z.string().trim().min(1, 'Thieu khong gian lam viec'),
  name: z.string().trim().min(1).max(100).optional(),
});

export type CreateBoardInput = z.infer<typeof createBoardSchema>;
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;
