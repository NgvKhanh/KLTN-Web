// Khoi "Hoat dong" o trang Tong quan: gop thao tac lien tiep tren cung mot the + nhom theo ngay. HAM THUAN.
import { dayDiff, weekdayName } from './homeStats';

interface ActivityLike {
  createdAt: string;
  user: { id: string };
  card: { id: string } | null;
}

/** Cac dong lien tiep cach dong moi nhat cua nhom khong qua chung nay thi gop (vd doi trang thai + chuyen cot). */
export const COLLAPSE_WINDOW_MS = 15 * 60_000;

/**
 * Gop cac dong LIEN TIEP (danh sach da xep moi -> cu) cung nguoi, cung the, trong COLLAPSE_WINDOW_MS tinh tu dong
 * moi nhat cua nhom. Moi nhom giu dong moi nhat (`item`) va tong so dong (`count`). Dong khong gan the khong gop.
 */
export function collapseActivity<T extends ActivityLike>(rows: T[], windowMs = COLLAPSE_WINDOW_MS): { item: T; count: number }[] {
  const out: { item: T; count: number }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (
      last &&
      r.card &&
      last.item.card?.id === r.card.id &&
      last.item.user.id === r.user.id &&
      new Date(last.item.createdAt).getTime() - new Date(r.createdAt).getTime() <= windowMs
    ) {
      last.count += 1;
    } else {
      out.push({ item: r, count: 1 });
    }
  }
  return out;
}

/** Tieu de ngay: "Hôm nay", "Hôm qua", trong tuan "Thứ Năm, 15/10", xa hon "05/09/2026". */
export function dayHeading(iso: string, now: Date): string {
  const d = new Date(iso);
  const diff = dayDiff(d, now);
  if (diff <= 0) return 'Hôm nay';
  if (diff === 1) return 'Hôm qua';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  if (diff < 7) {
    const name = weekdayName(d);
    return `${name.charAt(0).toUpperCase()}${name.slice(1)}, ${dd}/${mm}`;
  }
  return `${dd}/${mm}/${d.getFullYear()}`;
}

/** Nhom cac muc (da xep moi -> cu) theo ngay, giu thu tu. */
export function groupByDay<T extends { item: { createdAt: string } }>(items: T[], now: Date): { heading: string; items: T[] }[] {
  const out: { heading: string; items: T[] }[] = [];
  for (const it of items) {
    const heading = dayHeading(it.item.createdAt, now);
    const last = out[out.length - 1];
    if (last && last.heading === heading) last.items.push(it);
    else out.push({ heading, items: [it] });
  }
  return out;
}

/** Gio hien canh moi dong: hom nay ghi "x phút trước", ngay khac ghi gio "14:05". */
export function activityTime(iso: string, now: Date): string {
  const d = new Date(iso);
  if (dayDiff(d, now) > 0) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const s = Math.max(0, Math.floor((now.getTime() - d.getTime()) / 1000));
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  return `${Math.floor(s / 3600)} giờ trước`;
}
