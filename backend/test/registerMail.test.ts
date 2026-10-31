import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import { sendMail } from '../src/config/mailer';
import { agent } from './helpers';

const mailMock = vi.mocked(sendMail);

beforeEach(() => mailMock.mockClear());

// Render goi Free chan cong SMTP: gui mail treo toi het thoi gian cho. Dang ky truoc day CHO gui xong mail xac minh.
describe('dang ky khong cho gui mail xac minh', () => {
  it('may chu mail khong bao gio tra loi -> van 201 ngay, token xac minh da nam trong CSDL', async () => {
    mailMock.mockImplementationOnce(() => new Promise(() => {}));
    const email = `treo_${Date.now()}@test.local`;

    const started = Date.now();
    const res = await agent()
      .post('/api/auth/register')
      .send({ email, password: 'Password123', name: 'Nguoi Dung' });

    expect(res.status).toBe(201);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(mailMock).toHaveBeenCalledWith(expect.objectContaining({ to: email }));
    // Token tao TRUOC khi tra loi (khong ghi CSDL lo lung sau response) -> link trong mail van dung duoc
    const tokens = await prisma.authToken.count({
      where: { userId: res.body.data.user.id, type: 'EMAIL_VERIFY' },
    });
    expect(tokens).toBe(1);
  });

  it('gui mail loi -> dang ky van thanh cong', async () => {
    mailMock.mockRejectedValueOnce(new Error('connect ETIMEDOUT'));
    const res = await agent()
      .post('/api/auth/register')
      .send({ email: `loi_${Date.now()}@test.local`, password: 'Password123', name: 'Nguoi Dung' });
    expect(res.status).toBe(201);
  });
});
