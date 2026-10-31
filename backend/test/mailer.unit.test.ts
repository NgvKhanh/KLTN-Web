import { beforeEach, describe, expect, it, vi } from 'vitest';

// SMTP that kieu Render + Brevo (cong 2525). setup.unit.ts mock san config/mailer -> lay ban THAT qua importActual,
// con nodemailer va env thi mock o day de khong mo ket noi mang nao.
vi.mock('../src/config/env', () => ({
  env: {
    mail: { host: 'smtp-relay.brevo.test', port: 2525, user: 'u', pass: 'p', from: 'TaskFlow <a@b.test>' },
  },
}));

const transport = { sendMail: vi.fn().mockResolvedValue({ messageId: 'x' }) };
vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn(() => transport),
    createTestAccount: vi.fn(),
    getTestMessageUrl: vi.fn(() => false),
  },
}));

import nodemailer from 'nodemailer';

type MailerModule = typeof import('../src/config/mailer');

describe('mailer: gioi han thoi gian cho may chu mail', () => {
  beforeEach(() => vi.mocked(nodemailer.createTransport).mockClear());

  it('SMTP that duoc tao kem MAIL_TIMEOUTS (cong bi chan -> loi sau 10 giay, khong treo 2 phut)', async () => {
    const { sendMail, MAIL_TIMEOUTS } = await vi.importActual<MailerModule>('../src/config/mailer');
    await sendMail({ to: 'x@y.test', subject: 's', html: '<p>h</p>' });

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'smtp-relay.brevo.test', port: 2525, secure: false, ...MAIL_TIMEOUTS })
    );
    expect(MAIL_TIMEOUTS.connectionTimeout).toBeLessThanOrEqual(10_000);
    expect(MAIL_TIMEOUTS.greetingTimeout).toBeLessThanOrEqual(10_000);
  });
});
