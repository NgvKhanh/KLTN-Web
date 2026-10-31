import { Router } from 'express';
import { uploadAvatar } from '../../config/upload';
import { requireAuth } from '../../middleware/auth.middleware';
import {
  authLimiter,
  loginLimiter,
  registerLimiter,
} from '../../middleware/rateLimit.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  changePassword,
  forgotPassword,
  getMe,
  googleLogin,
  login,
  logout,
  register,
  resendVerification,
  resetPassword,
  updateMe,
  uploadMyAvatar,
  verifyEmail,
} from './auth.controller';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  googleLoginSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
  verifyEmailSchema,
} from './auth.schema';

const router = Router();

router.post(
  '/register',
  registerLimiter,
  validateBody(registerSchema),
  register
);
router.post('/login', loginLimiter, validateBody(loginSchema), login);
router.post('/google', authLimiter, validateBody(googleLoginSchema), googleLogin);
router.post('/logout', logout);
router.post(
  '/forgot-password',
  authLimiter,
  validateBody(forgotPasswordSchema),
  forgotPassword
);
router.post(
  '/reset-password',
  authLimiter,
  validateBody(resetPasswordSchema),
  resetPassword
);
router.post('/verify-email', validateBody(verifyEmailSchema), verifyEmail);
router.post('/resend-verification', requireAuth, authLimiter, resendVerification);
router.get('/me', requireAuth, getMe);
router.patch('/me', requireAuth, validateBody(updateProfileSchema), updateMe);
router.post('/me/avatar', requireAuth, uploadAvatar, uploadMyAvatar);
router.patch(
  '/password',
  requireAuth,
  validateBody(changePasswordSchema),
  changePassword
);

export default router;
