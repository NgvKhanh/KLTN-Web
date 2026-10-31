import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendMail } from '../src/config/mailer';
import { agent, cookieOf, makeUser } from './helpers';

const mailMock = vi.mocked(sendMail);

beforeEach(() => mailMock.mockClear());

/** Lay token reset tu noi dung email (da bi mock, doc qua mock.calls). */
function lastResetToken(): string {
  const calls = mailMock.mock.calls;
  const html = String(calls[calls.length - 1]?.[0]?.html ?? '');
  const m = html.match(/reset-password\?token=([A-Za-z0-9]+)/);
  if (!m) throw new Error('Khong tim thay token trong email reset');
  return m[1]!;
}

// Van de #6: token 1 lan dung phai tieu thu nguyen tu
describe('#6 reset mat khau - token 1 lan', () => {
  it('dung token 2 lan -> lan 2 that bai', async () => {
    const user = await makeUser();
    await agent()
      .post('/api/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);
    const token = lastResetToken();

    const first = await agent()
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'MatKhauMoi1' });
    expect(first.status).toBe(200);

    const second = await agent()
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'MatKhauMoi2' });
    expect(second.status).toBe(400);
  });

  it('2 request dong thoi cung 1 token -> chi 1 cai thanh cong', async () => {
    const user = await makeUser();
    await agent()
      .post('/api/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);
    const token = lastResetToken();

    const results = await Promise.all([
      agent()
        .post('/api/auth/reset-password')
        .send({ token, newPassword: 'Song song A1' }),
      agent()
        .post('/api/auth/reset-password')
        .send({ token, newPassword: 'Song song B1' }),
    ]);
    const ok = results.filter((r) => r.status === 200).length;
    expect(ok).toBe(1);
  });
});

// Van de #7: doi / reset mat khau phai vo hieu JWT cu.
// Dung tokenVersion (so nguyen, so sanh bang) thay vi moc thoi gian iat/giay
// -> khong con "khoang ho cung giay" nhu cach lam truoc, nen KHONG can cho
// qua ranh gioi 1 giay giua cac buoc nua (test nhanh + dung dan hon).
describe('#7 thu hoi JWT sau khi doi mat khau', () => {
  it('doi mat khau -> cookie cu bi tu choi, cookie moi dung duoc', async () => {
    const user = await makeUser();

    // /me voi cookie hien tai: OK
    await agent().get('/api/auth/me').set('Cookie', user.cookie).expect(200);

    const changed = await agent()
      .patch('/api/auth/password')
      .set('Cookie', user.cookie)
      .send({ currentPassword: user.password, newPassword: 'MatKhauMoi123' });
    expect(changed.status).toBe(200);
    const newCookie = cookieOf(changed);

    // Cookie CU: khong con dung duoc, KE CA khi doi mat khau xay ra trong
    // CUNG 1 giay voi luc cap token (truoc day la khoang ho cua cach so
    // sanh theo iat lam tron xuong giay).
    const oldRes = await agent()
      .get('/api/auth/me')
      .set('Cookie', user.cookie);
    expect(oldRes.status).toBe(401);

    // Cookie MOI: van dung duoc
    await agent().get('/api/auth/me').set('Cookie', newCookie).expect(200);
  });

  it('reset mat khau -> moi JWT cap truoc do het hieu luc (ke ca cung giay)', async () => {
    const user = await makeUser();
    await agent().get('/api/auth/me').set('Cookie', user.cookie).expect(200);

    await agent()
      .post('/api/auth/forgot-password')
      .send({ email: user.email })
      .expect(200);
    const token = lastResetToken();
    await agent()
      .post('/api/auth/reset-password')
      .send({ token, newPassword: 'ResetXongABC1' })
      .expect(200);

    const oldRes = await agent()
      .get('/api/auth/me')
      .set('Cookie', user.cookie);
    expect(oldRes.status).toBe(401);
  });

  it('doi mat khau nhieu lan lien tiep -> chi cookie cua lan cuoi cung dung', async () => {
    const user = await makeUser();
    const r1 = await agent()
      .patch('/api/auth/password')
      .set('Cookie', user.cookie)
      .send({ currentPassword: user.password, newPassword: 'LanDoi2Abc' })
      .expect(200);
    const cookie1 = cookieOf(r1);

    const r2 = await agent()
      .patch('/api/auth/password')
      .set('Cookie', cookie1)
      .send({ currentPassword: 'LanDoi2Abc', newPassword: 'LanDoi3Abc' })
      .expect(200);
    const cookie2 = cookieOf(r2);

    await agent().get('/api/auth/me').set('Cookie', user.cookie).expect(401);
    await agent().get('/api/auth/me').set('Cookie', cookie1).expect(401);
    await agent().get('/api/auth/me').set('Cookie', cookie2).expect(200);
  });
});
