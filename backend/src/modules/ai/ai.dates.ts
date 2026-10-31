// Tien ich lich cua module AI (AI_MODULE.md §5.3).
//
// QUY UOC BAT BUOC:
// - Ngay luon la chuoi lich "YYYY-MM-DD" (IsoDate), khong gio, khong "Z".
// - Chi dung Date.UTC va cac ham getUTC*. KHONG dung cac ham theo gio dia phuong
//   (getMonth, getDate, setDate...) - Viet Nam la UTC+7 nen chung de lech 1 ngay
//   tuy may chay. Co test doc chinh file nguon nay de ep tuan thu.
// - Khong doc dong ho he thong o day: "hom nay" luon la tham so do ben goi truyen
//   vao, de test tat dinh.

export type IsoDate = string;

const MS_PER_DAY = 86_400_000;
const MIN_YEAR = 1970;
const MAX_YEAR = 2100;

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

/** So ngay cua thang (month: 1-12), da tinh nam nhuan. */
export function daysInMonth(year: number, month: number): number {
  // Ngay 0 cua thang JS ke tiep (month, khong tru 1) = ngay cuoi cua `month`.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** true neu (y, m, d) la ngay lich that va nam nam trong khoang hop ly. */
export function isValidYmd(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (year < MIN_YEAR || year > MAX_YEAR) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

export function toIso(year: number, month: number, day: number): IsoDate {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Tach "YYYY-MM-DD"; null neu sai dinh dang HOAC khong phai ngay that (vd 2026-02-31). */
export function parseIso(iso: string): { year: number; month: number; day: number } | null {
  const m = ISO_RE.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  return isValidYmd(year, month, day) ? { year, month, day } : null;
}

export function isValidIso(iso: string): boolean {
  return parseIso(iso) !== null;
}

function mustParse(iso: string): { year: number; month: number; day: number } {
  const p = parseIso(iso);
  if (!p) throw new Error(`Ngay khong hop le (can YYYY-MM-DD that): "${iso}"`);
  return p;
}

function utcMs(iso: string): number {
  const { year, month, day } = mustParse(iso);
  return Date.UTC(year, month - 1, day);
}

function fromUtcMs(ms: number): IsoDate {
  const d = new Date(ms);
  return toIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Cong/tru so ngay lich (UTC khong co gio mua he nen luon dung 24h/ngay). */
export function addDays(iso: IsoDate, n: number): IsoDate {
  return fromUtcMs(utcMs(iso) + n * MS_PER_DAY);
}

/**
 * Cong/tru so thang. Neu ngay khong ton tai o thang dich thi kep ve ngay cuoi
 * thang (31/01 + 1 thang = 28/02 hoac 29/02).
 */
export function addMonths(iso: IsoDate, n: number): IsoDate {
  const { year, month, day } = mustParse(iso);
  const total = year * 12 + (month - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toIso(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}

/** Thu trong tuan theo ISO: 1 = thu Hai ... 7 = Chu nhat. */
export function isoWeekday(iso: IsoDate): number {
  const w = new Date(utcMs(iso)).getUTCDay(); // 0 = Chu nhat
  return w === 0 ? 7 : w;
}

/** Thu Hai cua tuan (Thu Hai -> Chu nhat) chua ngay nay. */
export function mondayOfWeek(iso: IsoDate): IsoDate {
  return addDays(iso, -(isoWeekday(iso) - 1));
}

export function isWeekend(iso: IsoDate): boolean {
  return isoWeekday(iso) >= 6;
}

/** Ngay cuoi cua thang (month: 1-12). */
export function lastDayOfMonth(year: number, month: number): IsoDate {
  return toIso(year, month, daysInMonth(year, month));
}

/** So ngay tu a den b (b - a); am neu b truoc a. */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((utcMs(b) - utcMs(a)) / MS_PER_DAY);
}
