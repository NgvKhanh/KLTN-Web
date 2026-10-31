import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env';
import { prisma } from '../src/config/prisma';
import { agent, makeUser } from './helpers';

// CODE_REVIEW.md #1: mot ke tan cong dang ky truoc bang email cua nguoi khac (dang ky
// KHONG doi hoi xac minh email) roi "chiem cho" tai khoan do. Khi CHU THAT su cua email
// do sau nay dang nhap bang Google, ma nguon truoc day chi lien ket googleId vao dung
// tai khoan bi chiem cho ma GIU NGUYEN mat khau/tokenVersion cu -> ke chiem cho van dang
// nhap duoc bang mat khau cu / cookie cu da cap truoc do, ke ca sau khi chu that su da
// "lay lai" tai khoan bang Google. Xem them emailInviteVerification.test.ts cho #2 (moi
// thanh vien bang email khong duoc cap quyen ngay cho tai khoan chua xac minh).

const verifyIdToken = vi.fn();
vi.mock('google-auth-library', () => ({
  OAuth2Client: vi.fn().mockImplementation(() => ({ verifyIdToken })),
}));

function googlePayload(email: string) {
  return {
    sub: `google-sub-${email}`,
    email,
    email_verified: true,
    name: 'Ten tren Google',
    picture: null,
  };
}

describe('#1 dang nhap Google lien ket vao tai khoan CHUA xac minh (co the la tai khoan chiem cho)', () => {
  const originalClientId = env.googleClientId;

  beforeEach(() => {
    env.googleClientId = 'fake-google-client-id';
    verifyIdToken.mockReset();
  });
  afterEach(() => {
    env.googleClientId = originalClientId;
  });

  it('email thuoc tai khoan CHUA xac minh: lien ket Google -> vo hieu mat khau cu + thu hoi cookie/JWT cu', async () => {
    const squatter = await makeUser({ verified: false });
    verifyIdToken.mockResolvedValueOnce({ getPayload: () => googlePayload(squatter.email) });

    // Cookie hien tai (dang nhap bang mat khau) con dung TRUOC khi lien ket Google
    await agent().get('/api/auth/me').set('Cookie', squatter.cookie).expect(200);

    const res = await agent()
      .post('/api/auth/google')
      .send({ credential: 'gia-lap-google-id-token-1234567890' });
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(squatter.email);

    // Cookie CU (cua ke da dang ky truoc, chua chung minh so huu email) khong con dung nua
    const oldCookieRes = await agent().get('/api/auth/me').set('Cookie', squatter.cookie);
    expect(oldCookieRes.status).toBe(401);

    // Mat khau cu KHONG con dang nhap duoc: tai khoan gio chi dang nhap duoc bang Google
    const loginWithOldPassword = await agent()
      .post('/api/auth/login')
      .send({ email: squatter.email, password: squatter.password });
    expect(loginWithOldPassword.status).toBe(400);

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: squatter.id } });
    expect(dbUser.passwordHash).toBeNull();
    expect(dbUser.googleId).toBe(`google-sub-${squatter.email}`);
  });

  it('email thuoc tai khoan DA xac minh tu truoc: lien ket Google KHONG dong mat khau, KHONG thu hoi cookie cu', async () => {
    const owner = await makeUser(); // makeUser() mac dinh danh dau da xac minh
    verifyIdToken.mockResolvedValueOnce({ getPayload: () => googlePayload(owner.email) });

    await agent().get('/api/auth/me').set('Cookie', owner.cookie).expect(200);

    const res = await agent()
      .post('/api/auth/google')
      .send({ credential: 'gia-lap-google-id-token-1234567890' });
    expect(res.status).toBe(200);

    // Cookie cu VAN con dung: khong bi thu hoi oan vi chu tai khoan da duoc xac minh that su
    await agent().get('/api/auth/me').set('Cookie', owner.cookie).expect(200);

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: owner.id } });
    expect(dbUser.passwordHash).not.toBeNull();
    // Van dang nhap duoc bang mat khau cu nhu binh thuong
    await agent()
      .post('/api/auth/login')
      .send({ email: owner.email, password: owner.password })
      .expect(200);
  });
});
