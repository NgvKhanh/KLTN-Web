import type { CookieOptions, Request, Response } from 'express';
import { env } from '../../config/env';
import { TOKEN_COOKIE_NAME } from '../../middleware/auth.middleware';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  changeUserPassword,
  getUserProfile,
  loginUser,
  loginWithGoogle,
  registerUser,
  requestPasswordReset,
  resendVerification as resendVerificationService,
  resetPassword as resetPasswordService,
  setUserAvatar,
  updateUserProfile,
  verifyEmail as verifyEmailService,
} from './auth.service';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  GoogleLoginInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  UpdateProfileInput,
  VerifyEmailInput,
} from './auth.schema';

const TOKEN_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 ngay

function tokenCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
    maxAge: TOKEN_COOKIE_MAX_AGE_MS,
  };
}

// Khi xoa cookie khong duoc truyen maxAge (Express 5 canh bao deprecated)
function clearTokenCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: 'lax',
  };
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { user, token } = await registerUser(req.body as RegisterInput);

  res.cookie(TOKEN_COOKIE_NAME, token, tokenCookieOptions());
  res.status(201).json({
    success: true,
    message: 'Dang ky thanh cong',
    data: { user, token },
  });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { user, token } = await loginUser(req.body as LoginInput);

  res.cookie(TOKEN_COOKIE_NAME, token, tokenCookieOptions());
  res.json({
    success: true,
    message: 'Dang nhap thanh cong',
    data: { user, token },
  });
});

export const googleLogin = asyncHandler(async (req: Request, res: Response) => {
  const { user, token } = await loginWithGoogle(req.body as GoogleLoginInput);

  res.cookie(TOKEN_COOKIE_NAME, token, tokenCookieOptions());
  res.json({
    success: true,
    message: 'Dang nhap Google thanh cong',
    data: { user, token },
  });
});

export const logout = asyncHandler(async (_req: Request, res: Response) => {
  res.clearCookie(TOKEN_COOKIE_NAME, clearTokenCookieOptions());
  res.json({ success: true, message: 'Da dang xuat' });
});

export const getMe = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('Ban chua dang nhap', 401);
  }

  const user = await getUserProfile(req.user.id);
  res.json({ success: true, data: { user } });
});

export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new AppError('Ban chua dang nhap', 401);
  }

  const user = await updateUserProfile(
    req.user.id,
    req.body as UpdateProfileInput
  );

  res.json({
    success: true,
    message: 'Cap nhat thong tin thanh cong',
    data: { user },
  });
});

export const uploadMyAvatar = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError('Ban chua dang nhap', 401);
    }
    if (!req.file) {
      throw new AppError('Chua chon anh de tai len', 400);
    }
    const user = await setUserAvatar(req.user.id, req.file.filename);
    res.json({
      success: true,
      message: 'Da cap nhat anh dai dien',
      data: { user },
    });
  }
);

export const changePassword = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError('Ban chua dang nhap', 401);
    }
    const { token } = await changeUserPassword(
      req.user.id,
      req.body as ChangePasswordInput
    );
    // Cap lai cookie cho phien hien tai de khong bi dang xuat ngay sau khi doi
    res.cookie(TOKEN_COOKIE_NAME, token, tokenCookieOptions());
    res.json({ success: true, message: 'Da doi mat khau' });
  }
);

export const forgotPassword = asyncHandler(
  async (req: Request, res: Response) => {
    const { previewUrl } = await requestPasswordReset(
      req.body as ForgotPasswordInput
    );
    res.json({
      success: true,
      message:
        'Neu email da dang ky, chung toi da gui huong dan dat lai mat khau. Vui long kiem tra hop thu.',
      data: previewUrl ? { previewUrl } : undefined,
    });
  }
);

export const resetPassword = asyncHandler(
  async (req: Request, res: Response) => {
    await resetPasswordService(req.body as ResetPasswordInput);
    res.json({
      success: true,
      message: 'Da dat lai mat khau. Ban co the dang nhap bang mat khau moi.',
    });
  }
);

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const user = await verifyEmailService(req.body as VerifyEmailInput);
  res.json({
    success: true,
    message: 'Da xac minh email.',
    data: { user },
  });
});

export const resendVerification = asyncHandler(
  async (req: Request, res: Response) => {
    if (!req.user) {
      throw new AppError('Ban chua dang nhap', 401);
    }
    const { previewUrl } = await resendVerificationService(req.user.id);
    res.json({
      success: true,
      message: 'Da gui lai email xac minh. Vui long kiem tra hop thu.',
      data: previewUrl ? { previewUrl } : undefined,
    });
  }
);
