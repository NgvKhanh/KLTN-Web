import { z } from 'zod';

// Vai tro co the gan cho thanh vien (khong bao gom OWNER)
const assignableRole = z.enum(['ADMIN', 'MEMBER']);

export const createWorkspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Ten khong gian khong duoc de trong')
    .max(100, 'Ten khong gian qua dai'),
});

export const updateWorkspaceSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Ten khong gian khong duoc de trong')
      .max(100, 'Ten khong gian qua dai')
      .optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'Khong co du lieu nao de cap nhat',
  });

export const addWorkspaceMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email khong hop le'),
  role: assignableRole.default('MEMBER'),
});

export const changeWorkspaceMemberRoleSchema = z.object({
  role: assignableRole,
});

export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;
export type AddWorkspaceMemberInput = z.infer<typeof addWorkspaceMemberSchema>;
export type ChangeWorkspaceMemberRoleInput = z.infer<
  typeof changeWorkspaceMemberRoleSchema
>;
