import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import { sendMail } from '../src/config/mailer';
import { prisma } from '../src/config/prisma';
import { agent, makeUser } from './helpers';

// Tai khoan dang ky bang Google (passwordHash = null) bam "Quen mat khau" phai nhan duoc mail de DAT mat khau
// lan dau, dat xong dang nhap duoc ca bang mat khau lan bang Google.

const mailMock = vi.mocked(sendMail);

const verifyIdToken = vi.fn();
vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({ verifyIdToken })),
}));

const originalClientId = env.googleClientId;

beforeEach(() => {
  mailMock.mockClear();
  verifyIdToken.mockReset();
  env.googleClientId = 'fake-google-client-id';
});
afterEach(() => {
  env.googleClientId = originalClientId;
});

let seq = 0;

/**
 * Tai khoan nhu loginWithGoogle tao lan dau (googleId, da xac minh, KHONG co mat khau). Ghi thang CSDL thay vi goi
 * /auth/google: /google, /forgot-password, /reset-password dung chung authLimiter (10 lan / IP) -> goi API het luot.
 * verifyIdToken duoc dat san cho cung tai khoan nay, de test nao can thi dang nhap Google that qua API.
 */
async function makeGoogleUser() {
  seq += 1;
  const email = `google${seq}_${Date.now()}@test.local`;
  const googleId = `google-sub-${email}`;
  verifyIdToken.mockResolvedValue({
    getPayload: () => ({
      sub: googleId,
      email,
      email_verified: true,
      name: 'Nguoi Dung Google',
      picture: null,
    }),
  });
  return prisma.user.create({
    data: { email, name: 'Nguoi Dung Google', googleId, emailVerifiedAt: new Date() },
  });
}

function lastMail() {
  const calls = mailMock.mock.calls;
  const input = calls[calls.length - 1]?.[0];
  if (!input) throw new Error('Khong co email nao duoc gui');
  return input;
}

function tokenIn(html: string): string {
  const m = html.match(/reset-password\?token=([A-Za-z0-9]+)/);
  if (!m) throw new Error('Khong tim thay token trong email');
  return m[1]!;
}

describe('quen mat khau voi tai khoan Google (chua co mat khau)', () => {
  it('van gui mail "Dat mat khau" toi dung email', async () => {
    const user = await makeGoogleUser();

    await agent()
      .post('/api/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);

    expect(mailMock).toHaveBeenCalledTimes(1);
    const mail = lastMail();
    expect(mail.to).toBe(user.email);
    expect(mail.subject).toBe('Dat mat khau cho tai khoan TaskFlow');
    expect(mail.html).toContain('dang nhap bang Google va chua co mat khau');
  });

  it('dat mat khau qua link -> dang nhap bang mat khau duoc, dang nhap Google van dung tai khoan cu', async () => {
    const user = await makeGoogleUser();
    await agent()
      .post('/api/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);

    await agent()
      .post('/api/auth/reset-password')
      .send({ token: tokenIn(String(lastMail().html)), newPassword: 'MatKhauMoi1' })
      .expect(200);

    const login = await agent()
      .post('/api/auth/login')
      .send({ email: user.email, password: 'MatKhauMoi1' });
    expect(login.status).toBe(200);
    expect(login.body.data.user.id).toBe(user.id);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.googleId).toBe(user.googleId);

    const google = await agent()
      .post('/api/auth/google')
      .send({ credential: 'gia-lap-google-id-token-1234567890' });
    expect(google.status).toBe(200);
    expect(google.body.data.user.id).toBe(user.id);
  });

  it('tai khoan da co mat khau van nhan mail "Dat lai mat khau"', async () => {
    const user = await makeUser();
    mailMock.mockClear(); // bo mail xac minh luc dang ky

    await agent()
      .post('/api/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);

    expect(lastMail().subject).toBe('Dat lai mat khau TaskFlow');
  });
});

// Render goi Free chan cong SMTP: truoc day forgot-password CHO gui mail -> treo toi het thoi gian cho, va email
// da dang ky tra loi cham hon han email chua dang ky (do duoc qua thoi gian).
describe('quen mat khau o production khong cho gui mail', () => {
  beforeEach(() => {
    env.isProduction = true;
  });
  afterEach(() => {
    env.isProduction = false;
  });

  it('may chu mail khong bao gio tra loi -> van 200 ngay, token da nam trong CSDL', async () => {
    const user = await makeGoogleUser();
    mailMock.mockImplementationOnce(() => new Promise(() => {}));

    const started = Date.now();
    const res = await agent()
      .post('/api/auth/forgot-password')
      .send({ email: user.email });

    expect(res.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(res.body.data).toBeUndefined(); // khong lo previewUrl
    expect(mailMock).toHaveBeenCalledWith(expect.objectContaining({ to: user.email }));
    const tokens = await prisma.authToken.count({
      where: { userId: user.id, type: 'PASSWORD_RESET' },
    });
    expect(tokens).toBe(1);
  });

  it('gui mail loi -> van 200 cung thong bao', async () => {
    const user = await makeGoogleUser();
    mailMock.mockRejectedValueOnce(new Error('connect ETIMEDOUT'));

    const res = await agent()
      .post('/api/auth/forgot-password')
      .send({ email: user.email });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
