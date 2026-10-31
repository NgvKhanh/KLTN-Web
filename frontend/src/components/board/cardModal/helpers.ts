import { activityPhrase } from '../../../lib/activityText';
import type { CardActivity } from '../../../types/card';

/** Ngay-gio kieu VN, gon: HH:mm dd/MM/yyyy */
export function fmt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function activityText(a: CardActivity): string {
  return activityPhrase(a);
}

/** Thang do phuc tap cho o chon (story point) - dau vao cua module canh bao tre han (RISK_MODULE.md §3). */
export const STORY_POINT_OPTIONS = [1, 2, 3, 5, 8] as const;

export const COVER_COLORS = [
  '#4bce97',
  '#f5cd47',
  '#fea362',
  '#f87168',
  '#9f8fef',
  '#579dff',
  '#6cc3e0',
  '#94c748',
  '#e774bb',
  '#8590a2',
];
