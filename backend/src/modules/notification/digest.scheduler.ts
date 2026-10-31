import { env } from '../../config/env';
import { sendMail } from '../../config/mailer';
import { prisma } from '../../config/prisma';
import { dailyDigestEmail } from '../auth/emailTemplates';
import type { NotificationType } from './notification.service';
import { categoryOfType } from './notificationPreference.service';

// Vong quet email tong hop hang ngay: moi 15 phut, tim nguoi dung da bat
// "dailyDigestEnabled" ma lan gui gan nhat (hoac chua tung gui) da qua 24h,
// gom thong bao ho nhan duoc tu do toi nay, gui 1 email tom tat.
const CHECK_INTERVAL_MS = 15 * 60_000;
const DIGEST_PERIOD_MS = 24 * 60 * 60_000;
const MAX_USERS_PER_TICK = 500; // an toan, quy mo du an hien tai khong can phan trang

let timer: ReturnType<typeof setInterval> | null = null;

export async function runOnce(): Promise<void> {
  const now = new Date();
  const dueUsers = await prisma.notificationPreference.findMany({
    where: {
      dailyDigestEnabled: true,
      OR: [
        { lastDigestSentAt: null },
        { lastDigestSentAt: { lte: new Date(now.getTime() - DIGEST_PERIOD_MS) } },
      ],
    },
    include: { user: { select: { id: true, email: true, name: true } } },
    take: MAX_USERS_PER_TICK,
  });

  for (const pref of dueUsers) {
    const since = pref.lastDigestSentAt ?? new Date(now.getTime() - DIGEST_PERIOD_MS);

    try {
      const notifications = await prisma.notification.findMany({
        where: {
          userId: pref.userId,
          createdAt: { gt: since, lte: now },
          type: { not: 'card.due.reminder' },
        },
        select: { type: true },
      });

      let cardCount = 0;
      let boardCount = 0;
      for (const n of notifications) {
        const category = categoryOfType(n.type as NotificationType);
        if (category === 'card' && pref.cardEmailDigest) cardCount += 1;
        if (category === 'board' && pref.boardEmailDigest) boardCount += 1;
      }

      if (cardCount + boardCount > 0) {
        const { subject, html } = dailyDigestEmail({
          name: pref.user.name,
          cardCount,
          boardCount,
          url: `${env.frontendUrl}/home`,
        });
        await sendMail({ to: pref.user.email, subject, html });
      }

      // Cap nhat moc thoi gian du khong co gi de gui, tranh ke lai cung 1
      // khoang trong (chi tich luy sang chu ky sau, khong gui email trong).
      await prisma.notificationPreference.update({
        where: { userId: pref.userId },
        data: { lastDigestSentAt: now },
      });
    } catch (err) {
      // Loi cua 1 nguoi (vd gui mail that bai) khong duoc chan nhung nguoi con lai.
      console.error('[digest] gui email tong hop that bai cho', pref.userId, err);
    }
  }
}

export function startDigestScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    runOnce().catch((err) => {
      console.error('[digest] loi khi quet email tong hop:', err);
    });
  }, CHECK_INTERVAL_MS);
  timer.unref();
}

export function stopDigestScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
