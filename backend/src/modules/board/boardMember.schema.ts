import { z } from 'zod';

// Vai tro nguoi mac dinh nhan duoc khi duoc chia se (khong bao gom OWNER)
const assignableRole = z.enum(['ADMIN', 'MEMBER', 'VIEWER']);

export const addBoardMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email khong hop le'),
  role: assignableRole.default('MEMBER'),
});

export const changeMemberRoleSchema = z.object({
  role: assignableRole,
});

export type AddBoardMemberInput = z.infer<typeof addBoardMemberSchema>;
export type ChangeMemberRoleInput = z.infer<typeof changeMemberRoleSchema>;
