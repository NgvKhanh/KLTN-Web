import { z } from 'zod';
import { CardStatus } from '../../generated/prisma/enums';

// Trang thai gan cho cot; null = cot tu do (khong gan trang thai)
const listStatusSchema = z.enum(CardStatus, { error: 'Trang thai khong hop le' }).nullable();

export const createListSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Ten danh sach khong duoc de trong')
    .max(100, 'Ten danh sach qua dai'),
  // Bo trong -> server tu doan theo ten cot (vd "Hoan thanh" -> DONE)
  status: listStatusSchema.optional(),
});

export const updateListSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Ten danh sach khong duoc de trong')
      .max(100, 'Ten danh sach qua dai')
      .optional(),
    // Vi tri dich (tu 0) khi keo sap xep lai cot
    position: z
      .number()
      .int('Vi tri phai la so nguyen')
      .min(0, 'Vi tri khong hop le')
      .optional(),
    // Doi trang thai cot -> moi the dang hoat dong trong cot doi theo
    status: listStatusSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Khong co du lieu nao de cap nhat',
  });

// Di chuyen tat ca the trong danh sach nay sang danh sach khac (cung bang)
export const moveAllCardsSchema = z.object({
  targetListId: z.string().min(1, 'Thieu danh sach dich'),
});

// Sap xep lai the trong danh sach
export const sortListSchema = z.object({
  by: z.enum(['created-desc', 'created-asc', 'title-asc', 'done']),
});

export type CreateListInput = z.infer<typeof createListSchema>;
export type UpdateListInput = z.infer<typeof updateListSchema>;
export type MoveAllCardsInput = z.infer<typeof moveAllCardsSchema>;
export type SortListInput = z.infer<typeof sortListSchema>;
