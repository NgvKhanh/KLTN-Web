import { z } from 'zod';

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Mau khong hop le');

export const addCardMemberSchema = z.object({
  userId: z.string().min(1, 'Thieu nguoi dung'),
});

export const addChecklistSchema = z.object({
  title: z.string().trim().max(200, 'Ten checklist qua dai').optional(),
  // Sao chep cac muc tu 1 checklist khac cua cung the
  copyFromChecklistId: z.string().min(1).optional(),
});

export const updateChecklistSchema = z.object({
  title: z.string().trim().min(1, 'Tieu de trong').max(200, 'Ten checklist qua dai'),
});

export const addChecklistItemSchema = z.object({
  content: z.string().trim().min(1, 'Noi dung trong').max(500, 'Noi dung muc qua dai'),
});

export const updateChecklistItemSchema = z
  .object({
    content: z.string().trim().min(1, 'Noi dung trong').max(500, 'Noi dung muc qua dai').optional(),
    isDone: z.boolean().optional(),
    // string userId -> chi dinh; null -> bo chi dinh
    assigneeId: z.string().min(1).nullable().optional(),
    // ISO datetime -> dat han; null -> bo han
    dueDate: z.union([z.string().datetime(), z.null()]).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Khong co du lieu de cap nhat',
  });

export const reorderChecklistItemsSchema = z.object({
  itemIds: z.array(z.string().min(1)).min(1, 'Thieu danh sach muc'),
});

export const commentSchema = z.object({
  text: z.string().trim().min(1, 'Binh luan trong').max(5000, 'Binh luan qua dai'),
});

// Tao binh luan: co parentId = tra loi binh luan do (sua binh luan van dung commentSchema)
export const createCommentSchema = commentSchema.extend({
  parentId: z.string().trim().min(1).max(64).optional(),
});

export const createLabelSchema = z.object({
  name: z.string().trim().max(50, 'Ten nhan qua dai').optional(),
  color: hexColor,
});

export const updateLabelSchema = z
  .object({
    name: z.string().trim().max(50, 'Ten nhan qua dai').optional(),
    color: hexColor.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'Khong co du lieu de cap nhat',
  });
