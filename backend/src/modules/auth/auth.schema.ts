import { z } from 'zod';

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Ho ten phai co it nhat 2 ky tu')
    .max(100, 'Ho ten qua dai'),
  email: z.string().trim().toLowerCase().email('Email khong hop le'),
  password: z
    .string()
    .min(6, 'Mat khau phai co it nhat 6 ky tu')
    .max(72, 'Mat khau qua dai'),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email khong hop le'),
  password: z.string().min(1, 'Vui long nhap mat khau'),
});

export const updateProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Ho ten phai co it nhat 2 ky tu')
    .max(100, 'Ho ten qua dai')
    .optional(),
  avatarUrl: z
    .union([z.string().trim().url('Duong dan anh dai dien khong hop le'), z.null()])
    .optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Vui long nhap mat khau hien tai'),
  newPassword: z
    .string()
    .min(6, 'Mat khau moi phai co it nhat 6 ky tu')
    .max(72, 'Mat khau qua dai'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email('Email khong hop le'),
});

export const resetPasswordSchema = z.object({
  token: z.string().trim().min(10, 'Lien ket khong hop le'),
  newPassword: z
    .string()
    .min(6, 'Mat khau moi phai co it nhat 6 ky tu')
    .max(72, 'Mat khau qua dai'),
});

export const verifyEmailSchema = z.object({
  token: z.string().trim().min(10, 'Lien ket khong hop le'),
});

export const googleLoginSchema = z.object({
  credential: z.string().trim().min(20, 'Thieu Google credential'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;
