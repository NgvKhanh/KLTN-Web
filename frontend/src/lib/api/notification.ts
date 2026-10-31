import { api } from '../axios';
import type { AppNotification } from '../../types/notification';

export async function fetchNotifications(
  unreadOnly: boolean
): Promise<AppNotification[]> {
  const res = await api.get<{ data: { notifications: AppNotification[] } }>(
    '/notifications',
    { params: { unreadOnly: unreadOnly ? 'true' : undefined } }
  );
  return res.data.data.notifications;
}

export async function fetchUnreadCount(): Promise<number> {
  const res = await api.get<{ data: { count: number } }>(
    '/notifications/unread-count'
  );
  return res.data.data.count;
}

export async function markNotificationRead(id: string): Promise<void> {
  await api.post(`/notifications/${id}/read`);
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.post('/notifications/read-all');
}

export interface NotificationPreference {
  cardInApp: boolean;
  cardEmailDigest: boolean;
  boardInApp: boolean;
  boardEmailDigest: boolean;
  dueReminderInApp: boolean;
  dueReminderEmail: boolean;
  riskInApp: boolean;
  riskEmail: boolean;
  dailyDigestEnabled: boolean;
}

export async function fetchNotificationPreference(): Promise<NotificationPreference> {
  const res = await api.get<{ data: { preference: NotificationPreference } }>(
    '/notifications/preferences'
  );
  return res.data.data.preference;
}

export async function updateNotificationPreference(
  patch: Partial<NotificationPreference>
): Promise<NotificationPreference> {
  const res = await api.patch<{ data: { preference: NotificationPreference } }>(
    '/notifications/preferences',
    patch
  );
  return res.data.data.preference;
}
