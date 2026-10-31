// Kiem than yeu cau cua /api/chat (CHATBOT_MODULE.md §12.1).
// Moi object deu .strict(): client KHONG gui duoc vai tro, danh tinh hay id nguoi duoc nhac.

import { z } from 'zod';
import { MAX_QUESTION_CHARS } from './chat.intent';

const id = z.string().trim().min(1).max(64);

export const chatScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('MY') }).strict(),
  z.object({ kind: z.literal('WORKSPACE'), workspaceId: id }).strict(),
  z.object({ kind: z.literal('BOARD'), boardId: id }).strict(),
]);

const conversationId = z.string().uuid({ message: 'Ma hoi thoai khong hop le' });

export const chatMessageSchema = z
  .object({
    message: z
      .string()
      .trim()
      .min(1, 'Cau hoi khong duoc de trong')
      .max(MAX_QUESTION_CHARS, `Cau hoi toi da ${MAX_QUESTION_CHARS} ky tu`),
    scope: chatScopeSchema,
    conversationId: conversationId.optional(),
  })
  .strict();

export const chatChoiceSchema = z
  .object({
    conversationId,
    userId: id.optional(),
    workspaceId: id.optional(),
    /** Bang / khong gian nguoi dung chon khi trung ten (§18). */
    targetId: id.optional(),
  })
  .strict()
  .refine((v) => [v.userId, v.workspaceId, v.targetId].filter((x) => x !== undefined).length === 1, {
    message: 'Chon dung mot trong ba: userId, workspaceId hoac targetId',
  });

export const chatMoreSchema = z
  .object({
    conversationId,
    page: z.number().int().min(2).max(1000),
  })
  .strict();

export type ChatMessageInput = z.infer<typeof chatMessageSchema>;
export type ChatChoiceInput = z.infer<typeof chatChoiceSchema>;
export type ChatMoreInput = z.infer<typeof chatMoreSchema>;
