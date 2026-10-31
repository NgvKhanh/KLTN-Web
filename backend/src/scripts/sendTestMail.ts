/**
 * Gui thu 1 email de kiem tra ha tang mail hoat dong chua.
 *
 * Cach chay (backend chay trong Docker):
 *   docker compose exec -T backend npx tsx src/scripts/sendTestMail.ts you@example.com
 *
 * - Chua cau hinh SMTP_* trong .env -> mail di qua Ethereal, script in ra link xem mail.
 * - Da cau hinh SMTP that            -> mail toi thang hop thu "you@example.com".
 */
import { sendMail, verifyMailer } from '../config/mailer';

async function main(): Promise<void> {
  const to = process.argv[2];
  if (!to) {
    console.error(
      'Thieu dia chi nhan.\nVi du: npx tsx src/scripts/sendTestMail.ts you@example.com'
    );
    process.exit(1);
  }

  console.info('[test] Kiem tra ket noi SMTP...');
  await verifyMailer();
  console.info('[test] Ket noi OK. Dang gui mail toi', to, '...');

  const { previewUrl } = await sendMail({
    to,
    subject: 'TaskFlow - mail thu nghiem',
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;color:#1e293b;line-height:1.6">
        <h2 style="color:#0c66e4;margin:0 0 12px">TaskFlow</h2>
        <p>Day la email thu nghiem. Neu ban doc duoc dong nay thi ha tang gui mail da hoat dong.</p>
        <p style="color:#64748b;font-size:12px">Gui luc ${new Date().toLocaleString('vi-VN')}</p>
      </div>`,
  });

  console.info('[test] Da gui xong.');
  if (previewUrl) console.info('[test] Xem mail tai:', previewUrl);
  process.exit(0);
}

main().catch((err) => {
  console.error('[test] Loi:', err);
  process.exit(1);
});
