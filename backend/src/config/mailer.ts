import nodemailer, { type Transporter } from 'nodemailer';
import { env } from './env';

/**
 * Ha tang gui email dung chung cho toan backend.
 *
 * - Neu .env co SMTP_HOST  -> dung SMTP that (Gmail, Brevo, Mailtrap...).
 * - Neu KHONG co            -> tu tao tai khoan test cua Ethereal (nodemailer):
 *   email khong toi hop thu that, nhung moi lan gui se in ra 1 link xem truoc
 *   trong log. Rat tien de phat trien / demo ma khong can cau hinh gi.
 *
 * Transporter duoc tao 1 lan roi dung lai (nhat la Ethereal - moi lan tao la
 * mot lan goi mang).
 */

let transporterPromise: Promise<Transporter> | null = null;
let usingEthereal = false;

async function createTransporter(): Promise<Transporter> {
  if (env.mail.host) {
    usingEthereal = false;
    return nodemailer.createTransport({
      host: env.mail.host,
      port: env.mail.port,
      secure: env.mail.port === 465, // 465 = SSL; 587 / 2525 = STARTTLS
      auth: env.mail.user
        ? { user: env.mail.user, pass: env.mail.pass }
        : undefined,
    });
  }

  // Khong co cau hinh SMTP -> Ethereal (hop thu ao)
  const testAccount = await nodemailer.createTestAccount();
  usingEthereal = true;
  console.warn(
    '[mailer] Chua cau hinh SMTP_HOST -> dung Ethereal (mail ao, khong toi hop thu that).\n' +
      `[mailer] Hop thu ao: https://ethereal.email  |  user=${testAccount.user}  pass=${testAccount.pass}`
  );
  return nodemailer.createTransport({
    host: 'smtp.ethereal.email',
    port: 587,
    secure: false,
    auth: { user: testAccount.user, pass: testAccount.pass },
  });
}

function getTransporter(): Promise<Transporter> {
  if (!transporterPromise) {
    transporterPromise = createTransporter().catch((err) => {
      transporterPromise = null; // cho phep thu lai o lan goi sau
      throw err;
    });
  }
  return transporterPromise;
}

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Gui 1 email.
 * - Tra ve { previewUrl }: link xem mail (chi co gia tri khi dang dung Ethereal).
 * - Nem loi neu gui that bai -> ben goi tu quyet dinh xu ly (vi du: van tra 200
 *   cho luong "quen mat khau" de khong lo email nao ton tai).
 */
export async function sendMail(
  input: SendMailInput
): Promise<{ previewUrl: string | null }> {
  const transporter = await getTransporter();
  const info = await transporter.sendMail({
    from: env.mail.from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text ?? htmlToText(input.html),
  });

  const previewUrl = usingEthereal
    ? nodemailer.getTestMessageUrl(info) || null
    : null;
  if (previewUrl) {
    console.info(`[mailer] Xem mail vua gui: ${previewUrl}`);
  }
  return { previewUrl };
}

/** Bo tag HTML tho de lam ban text du phong cho email. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Kiem tra ket noi / dang nhap SMTP. Dung cho script test hoac healthcheck. */
export async function verifyMailer(): Promise<void> {
  const transporter = await getTransporter();
  await transporter.verify();
}
