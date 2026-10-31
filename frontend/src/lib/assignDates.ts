// Ngay "tam nghi den" cua ho so lam viec. Dung o input type="date" (chi co NGAY) nen doi qua lai voi thoi diem ISO
// theo GIO DIA PHUONG cua nguoi dung: tam nghi den het ngay 05/10 nghia la 23:59:59.999 ngay 05/10 gio may ho.
// KHONG dung toISOString().slice(...) de dien o nhap: no cho gio UTC va lech mot ngay o Viet Nam.

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** "2026-10-05" (ngay dia phuong) -> ISO cua 23:59:59.999 cuoi ngay do; chuoi khong phai ngay lich that -> null. */
export function endOfLocalDayIso(dateStr: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(y, mo - 1, d, 23, 59, 59, 999);
  // Ngay khong ton tai (30/02, thang 13...) bi Date "cuon" sang ngay khac -> doi chieu lai tung phan
  if (t.getFullYear() !== y || t.getMonth() !== mo - 1 || t.getDate() !== d) return null;
  return t.toISOString();
}

/** "2026-10-05" (ngay dia phuong) -> ISO cua 00:00:00.000 dau ngay do; chuoi khong phai ngay lich that -> null. */
export function startOfLocalDayIso(dateStr: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = new Date(y, mo - 1, d, 0, 0, 0, 0);
  if (t.getFullYear() !== y || t.getMonth() !== mo - 1 || t.getDate() !== d) return null;
  return t.toISOString();
}

/** ISO -> "YYYY-MM-DD" theo gio dia phuong (gia tri cho o input type="date"); null / khong hop le -> "". */
export function toLocalDateInput(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return '';
  return `${pad(t.getFullYear(), 4)}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}

/** Con dang tam nghi o thoi diem `now` khong (chua den het thoi diem tam nghi). */
export function isPausedNow(iso: string | null, now: Date = new Date()): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && t >= now.getTime();
}

/** dd/MM/yyyy theo gio dia phuong; khong hop le -> "". */
export function formatViDate(iso: string): string {
  const t = new Date(iso);
  if (!Number.isFinite(t.getTime())) return '';
  return `${pad(t.getDate())}/${pad(t.getMonth() + 1)}/${pad(t.getFullYear(), 4)}`;
}
