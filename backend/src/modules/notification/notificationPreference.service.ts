import { prisma } from '../../config/prisma';
import type { NotificationType } from './notification.service';

export type NotificationCategory = 'card' | 'board' | 'dueReminder' | 'risk';

// Gom cac loai NotificationType thanh 4 nhom nguoi dung tuy chinh duoc (nhom "risk" = canh bao nguy co tre han,
// RISK_MODULE.md §8.4).
export function categoryOfType(type: NotificationType): NotificationCategory {
  if (type === 'card.due.reminder') return 'dueReminder';
  if (type === 'card.risk.warning') return 'risk';
  if (type.startsWith('board.') || type.startsWith('workspace.')) return 'board';
  return 'card';
}

export interface PreferencePatch {
  cardInApp?: boolean;
  cardEmailDigest?: boolean;
  boardInApp?: boolean;
  boardEmailDigest?: boolean;
  dueReminderInApp?: boolean;
  dueReminderEmail?: boolean;
  riskInApp?: boolean;
  riskEmail?: boolean;
  dailyDigestEnabled?: boolean;
}

const DEFAULTS: Omit<
  PreferencePatch,
  'dailyDigestEnabled'
> &
  Required<Pick<PreferencePatch, 'dailyDigestEnabled'>> = {
  cardInApp: true,
  cardEmailDigest: true,
  boardInApp: true,
  boardEmailDigest: true,
  dueReminderInApp: true,
  dueReminderEmail: true,
  riskInApp: true,
  riskEmail: true,
  dailyDigestEnabled: false,
};

// Lay tuy chinh cua 1 nguoi dung; tao san voi gia tri mac dinh neu chua co
// (nguoi dung chua bao gio vao trang cai dat thong bao).
export async function getOrCreatePreference(userId: string) {
  const existing = await prisma.notificationPreference.findUnique({
    where: { userId },
  });
  if (existing) return existing;
  return prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...DEFAULTS },
    update: {},
  });
}

export async function updatePreference(userId: string, patch: PreferencePatch) {
  await getOrCreatePreference(userId);
  return prisma.notificationPreference.update({
    where: { userId },
    data: patch,
  });
}

// Tra ve preference cua nhieu nguoi dung 1 luc (dung khi loc nguoi nhan hang
// loat trong notify()), thieu ai thi dung gia tri mac dinh (khong tao ban ghi
// moi trong DB o day - chi doc, tranh ghi khi khong can thiet).
export async function preferencesFor(
  userIds: string[]
): Promise<Map<string, typeof DEFAULTS>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.notificationPreference.findMany({
    where: { userId: { in: userIds } },
  });
  const map = new Map<string, typeof DEFAULTS>();
  for (const id of userIds) map.set(id, DEFAULTS);
  for (const r of rows) map.set(r.userId, r);
  return map;
}
