import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env';
import { sendMail } from '../../config/mailer';
import { prisma } from '../../config/prisma';
import { avatarPublicPath, removeAvatarFile } from '../../config/upload';
import { disconnectUserSockets } from '../../realtime/socket';
import { AppError } from '../../utils/AppError';
import { isUniqueViolation } from '../../utils/clientError';
import { signToken } from '../../utils/jwt';
import { comparePassword, hashPassword } from '../../utils/password';
import { createPersonalWorkspace } from '../workspace/workspace.service';
import { consumeAuthToken, createAuthToken } from './authToken.service';
import { resetPasswordEmail, verifyEmailEmail } from './emailTemplates';
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

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1 gio
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24 gio

const PUBLIC_USER_SELECT = {
  id: true,
  email: true,
  name: true,
  avatarUrl: true,
  emailVerifiedAt: true,
  createdAt: true,
  tokenVersion: true,
} as const;

/**
 * Tao token EMAIL_VERIFY va gui mail xac minh cho user.
 * Loi gui mail duoc nuot (chi log) de khong lam hong luong dang ky.
 * Tra ve previewUrl (link mail Ethereal) khi chay dev.
 */
async function sendVerificationEmail(user: {
  id: string;
  name: string;
  email: string;
}): Promise<{ previewUrl: string | null }> {
  try {
    const rawToken = await createAuthToken(
      user.id,
      'EMAIL_VERIFY',
      EMAIL_VERIFY_TTL_MS
    );
    const url = `${env.frontendUrl}/verify-email?token=${rawToken}`;
    const { subject, html } = verifyEmailEmail({
      name: user.name,
      url,
      expiresInHours: EMAIL_VERIFY_TTL_MS / 3600000,
    });
    const { previewUrl } = await sendMail({ to: user.email, subject, html });
    return { previewUrl: env.isProduction ? null : previewUrl };
  } catch (err) {
    console.error('[auth] Gui mail xac minh that bai:', err);
    return { previewUrl: null };
  }
}

export async function registerUser(input: RegisterInput) {
  const existing = await prisma.user.findFirst({
    where: { email: input.email, deletedAt: null },
    select: { id: true },
  });

  if (existing) {
    throw new AppError('Email nay da duoc su dung', 409);
  }

  const passwordHash = await hashPassword(input.password);

  // Hai yeu cau dang ky cung email dong thoi (hoac email cua tai khoan da xoa mem) deu qua duoc buoc
  // kiem tra o tren; rang buoc duy nhat cua CSDL la hang rao cuoi cung -> 409 thay vi 500.
  const user = await prisma.user
    .create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
      },
      select: PUBLIC_USER_SELECT,
    })
    .catch((err: unknown) => {
      if (isUniqueViolation(err)) throw new AppError('Email nay da duoc su dung', 409);
      throw err;
    });

  // Moi nguoi dung co san 1 khong gian ca nhan
  await createPersonalWorkspace(user.id, user.name);

  // Gui mail xac minh (khong chan neu that bai)
  await sendVerificationEmail(user);

  const token = signToken({ userId: user.id, tokenVersion: user.tokenVersion });

  return { user, token };
}

export async function loginUser(input: LoginInput) {
  const user = await prisma.user.findFirst({
    where: { email: input.email, deletedAt: null },
  });

  if (!user) {
    throw new AppError('Email hoac mat khau khong dung', 401);
  }

  if (!user.passwordHash) {
    throw new AppError(
      'Tai khoan nay dang nhap bang Google. Hay dung nut "Dang nhap voi Google".',
      400
    );
  }

  const isPasswordValid = await comparePassword(
    input.password,
    user.passwordHash
  );

  if (!isPasswordValid) {
    throw new AppError('Email hoac mat khau khong dung', 401);
  }

  const token = signToken({ userId: user.id, tokenVersion: user.tokenVersion });

  return {
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      emailVerifiedAt: user.emailVerifiedAt,
      createdAt: user.createdAt,
    },
    token,
  };
}

let googleClient: OAuth2Client | null = null;
function getGoogleClient(): OAuth2Client {
  if (!googleClient) {
    googleClient = new OAuth2Client(env.googleClientId);
  }
  return googleClient;
}

/**
 * Dang nhap / dang ky bang Google.
 * Frontend gui "credential" = ID token lay tu Google Identity Services.
 * - Xac thuc chu ky + audience bang google-auth-library.
 * - Tim user theo googleId -> theo email (lien ket) -> tao moi.
 * - Email tu Google luon coi la da xac minh.
 */
export async function loginWithGoogle(input: GoogleLoginInput) {
  if (!env.googleClientId) {
    throw new AppError('Dang nhap bang Google chua duoc cau hinh', 503);
  }

  let payload;
  try {
    const ticket = await getGoogleClient().verifyIdToken({
      idToken: input.credential,
      audience: env.googleClientId,
    });
    payload = ticket.getPayload();
  } catch {
    throw new AppError('Xac thuc Google that bai', 401);
  }

  if (!payload?.sub || !payload.email || payload.email_verified === false) {
    throw new AppError('Tai khoan Google khong hop le', 401);
  }

  const googleId = payload.sub;
  const email = payload.email.toLowerCase();
  const name = payload.name?.trim() || email.split('@')[0];
  const picture = payload.picture ?? null;

  // 1) Da tung dang nhap Google
  let user = await prisma.user.findFirst({
    where: { googleId, deletedAt: null },
    select: PUBLIC_USER_SELECT,
  });

  // 2) Chua co googleId nhung email da dang ky -> lien ket
  if (!user) {
    const byEmail = await prisma.user.findFirst({
      where: { email, deletedAt: null },
      select: { id: true, avatarUrl: true, emailVerifiedAt: true },
    });

    if (byEmail) {
      // Email nay CHUA tung duoc xac minh (khong ai chung minh da so huu qua mail xac
      // minh / dat lai mat khau) -> tai khoan co the do ke khac chiem cho bang dang ky
      // truoc. Google vua chung minh AI THUC SU so huu email nay: vo hieu mat khau cu
      // (chi con dang nhap duoc bang Google tu gio) va thu hoi moi JWT/phien da cap
      // truoc do, tranh nguoi chiem cho tiep tuc dung mat khau/token cu de vao tai khoan.
      const wasUnverified = byEmail.emailVerifiedAt === null;
      user = await prisma.user.update({
        where: { id: byEmail.id },
        data: {
          googleId,
          emailVerifiedAt: byEmail.emailVerifiedAt ?? new Date(),
          avatarUrl: byEmail.avatarUrl ?? picture,
          ...(wasUnverified
            ? { passwordHash: null, tokenVersion: { increment: 1 } }
            : {}),
        },
        select: PUBLIC_USER_SELECT,
      });
      if (wasUnverified) disconnectUserSockets(byEmail.id);
    }
  }

  // 3) Nguoi dung moi hoan toan
  if (!user) {
    user = await prisma.user
      .create({
        data: {
          email,
          name,
          googleId,
          avatarUrl: picture,
          emailVerifiedAt: new Date(),
          // passwordHash de trong -> tai khoan chi dang nhap Google
        },
        select: PUBLIC_USER_SELECT,
      })
      .catch((err: unknown) => {
        // Bam nut hai lan: yeu cau kia dang tao cung tai khoan nay
        if (isUniqueViolation(err)) {
          throw new AppError('Tai khoan dang duoc khoi tao. Hay thu lai sau it giay.', 409);
        }
        throw err;
      });
    // Moi nguoi dung co san 1 khong gian ca nhan
    await createPersonalWorkspace(user.id, user.name);
  }

  const token = signToken({ userId: user.id, tokenVersion: user.tokenVersion });
  return { user, token };
}

export async function getUserProfile(userId: string) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: PUBLIC_USER_SELECT,
  });

  if (!user) {
    throw new AppError('Khong tim thay nguoi dung', 404);
  }

  return user;
}

export async function updateUserProfile(
  userId: string,
  input: UpdateProfileInput
) {
  if (Object.keys(input).length === 0) {
    throw new AppError('Khong co du lieu nao de cap nhat', 400);
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.avatarUrl !== undefined ? { avatarUrl: input.avatarUrl } : {}),
    },
    select: PUBLIC_USER_SELECT,
  });

  return user;
}

// Tai anh dai dien len: luu file, cap nhat avatarUrl, xoa anh cu (neu la file upload)
export async function setUserAvatar(userId: string, filename: string) {
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true },
  });

  const user = await prisma.user.update({
    where: { id: userId },
    data: { avatarUrl: avatarPublicPath(filename) },
    select: PUBLIC_USER_SELECT,
  });

  removeAvatarFile(current?.avatarUrl ?? null);
  return user;
}

export async function changeUserPassword(
  userId: string,
  input: ChangePasswordInput
) {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
  });
  if (!user) {
    throw new AppError('Khong tim thay nguoi dung', 404);
  }

  if (!user.passwordHash) {
    throw new AppError(
      'Tai khoan Google chua co mat khau. Hay dung chuc nang "Quen mat khau" de dat mat khau moi.',
      400
    );
  }

  const ok = await comparePassword(input.currentPassword, user.passwordHash);
  if (!ok) {
    throw new AppError('Mat khau hien tai khong dung', 400);
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(input.newPassword),
      // Thu hoi moi JWT cu (REST + Socket.IO) da cap truoc do; phien hien tai
      // se duoc cap cookie moi o controller voi tokenVersion vua tang.
      tokenVersion: { increment: 1 },
    },
    select: { tokenVersion: true },
  });

  // Ngat cac ket noi Socket.IO dang mo cua user (chung khong tu ngat khi doi
  // mat khau, chi bi tu choi o lan ket noi TIEP THEO neu khong lam viec nay).
  disconnectUserSockets(userId);

  return { token: signToken({ userId, tokenVersion: updated.tokenVersion }) };
}

/**
 * Quen mat khau: neu email ton tai (va la tai khoan co mat khau) thi gui mail
 * chua link dat lai. Ham nay KHONG bao gio bao "email khong ton tai" -> tranh
 * lo danh sach email da dang ky. Controller luon tra ve cung mot thong bao.
 *
 * Tra ve previewUrl (link xem mail Ethereal) khi chay dev, de tien kiem thu.
 */
export async function requestPasswordReset(
  input: ForgotPasswordInput
): Promise<{ previewUrl: string | null }> {
  const user = await prisma.user.findFirst({
    where: { email: input.email, deletedAt: null },
    select: { id: true, name: true, email: true, passwordHash: true },
  });

  // Khong co user, hoac tai khoan chi dang nhap Google -> im lang bo qua
  if (!user) {
    return { previewUrl: null };
  }

  const rawToken = await createAuthToken(
    user.id,
    'PASSWORD_RESET',
    PASSWORD_RESET_TTL_MS
  );
  const url = `${env.frontendUrl}/reset-password?token=${rawToken}`;

  try {
    const { subject, html } = resetPasswordEmail({
      name: user.name,
      url,
      expiresInMinutes: PASSWORD_RESET_TTL_MS / 60000,
    });
    const { previewUrl } = await sendMail({ to: user.email, subject, html });
    return { previewUrl: env.isProduction ? null : previewUrl };
  } catch (err) {
    console.error('[auth] Gui mail dat lai mat khau that bai:', err);
    return { previewUrl: null };
  }
}

/**
 * Dat lai mat khau bang token trong link email.
 * Token hop le -> doi mat khau, danh dau token da dung, coi email da xac minh.
 */
export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  // Bam mat khau TRUOC (ton CPU) de khong keo dai transaction ben duoi
  const passwordHash = await hashPassword(input.newPassword);

  // Tieu thu token va doi mat khau trong CUNG mot transaction: neu buoc doi
  // mat khau loi thi token cung duoc hoan (khong mat hieu luc lien ket oan).
  const userId = await prisma.$transaction(async (tx) => {
    const uid = await consumeAuthToken(tx, input.token, 'PASSWORD_RESET');
    await tx.user.update({
      where: { id: uid },
      data: {
        passwordHash,
        // Dat lai mat khau qua email cung chung minh so huu email
        emailVerifiedAt: new Date(),
        // Thu hoi moi JWT da cap truoc do (quan trong khi lay lai tai khoan
        // tu tay ke chiem doat) - ap dung ca REST lan Socket.IO.
        tokenVersion: { increment: 1 },
      },
    });
    return uid;
  });

  // Nguoi lay lai tai khoan co the dang bi chiem: ngat ngay moi ket noi
  // Socket.IO hien co cua tai khoan nay (khong cho tro thu dong duong ket noi).
  disconnectUserSockets(userId);
}

/**
 * Xac minh email bang token trong link. Tra ve thong tin user da cap nhat.
 * Neu email da xac minh tu truoc thi giu nguyen moc thoi gian cu.
 */
export async function verifyEmail(input: VerifyEmailInput) {
  return prisma.$transaction(async (tx) => {
    const userId = await consumeAuthToken(tx, input.token, 'EMAIL_VERIFY');

    const current = await tx.user.findUnique({
      where: { id: userId },
      select: { emailVerifiedAt: true },
    });

    return tx.user.update({
      where: { id: userId },
      data: { emailVerifiedAt: current?.emailVerifiedAt ?? new Date() },
      select: PUBLIC_USER_SELECT,
    });
  });
}

/**
 * Gui lai email xac minh cho nguoi dung dang dang nhap.
 * Da xac minh roi -> bao loi 400.
 */
export async function resendVerification(
  userId: string
): Promise<{ previewUrl: string | null }> {
  const user = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true, name: true, email: true, emailVerifiedAt: true },
  });

  if (!user) {
    throw new AppError('Khong tim thay nguoi dung', 404);
  }
  if (user.emailVerifiedAt) {
    throw new AppError('Email cua ban da duoc xac minh', 400);
  }

  return sendVerificationEmail(user);
}
