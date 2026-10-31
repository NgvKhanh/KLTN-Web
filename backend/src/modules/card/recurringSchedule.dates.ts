// Tinh toan lich lap lai (ngay/tuan/thang) - module thuan, khong dung DB, de
// test rieng phan logic ngay thang de xay ra loi nhat.

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface RecurrenceRule {
  frequency: Frequency;
  dayOfWeek?: number | null; // 0 (CN) - 6 (T7), dung khi WEEKLY
  dayOfMonth?: number | null; // 1-31, dung khi MONTHLY
  timeOfDay: string; // "HH:mm", gio UTC
}

const DAY_MS = 24 * 60 * 60_000;

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function atTime(year: number, monthIndex0: number, day: number, timeOfDay: string): Date {
  const [h, m] = timeOfDay.split(':').map(Number);
  return new Date(Date.UTC(year, monthIndex0, day, h, m, 0, 0));
}

// Lan xay ra dau tien >= "from" (bao gom chinh "from" neu khop gio phut).
export function nextOccurrenceOnOrAfter(from: Date, rule: RecurrenceRule): Date {
  if (rule.frequency === 'DAILY') {
    let candidate = atTime(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), rule.timeOfDay);
    if (candidate < from) candidate = new Date(candidate.getTime() + DAY_MS);
    return candidate;
  }

  if (rule.frequency === 'WEEKLY') {
    const targetDow = rule.dayOfWeek ?? 0;
    for (let i = 0; i < 8; i += 1) {
      const d = new Date(from.getTime() + i * DAY_MS);
      if (d.getUTCDay() !== targetDow) continue;
      const candidate = atTime(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), rule.timeOfDay);
      if (candidate >= from) return candidate;
    }
    throw new Error('Khong tinh duoc lan chay tiep theo (weekly)');
  }

  // MONTHLY: neu thang khong co du ngay (vd 31 o thang 2), lay ngay cuoi cung
  // cua thang do - KHONG "dinh" vinh vien vao ngay bi rut gon, thang sau van
  // tinh lai theo so ngay thuc te cua thang do.
  const targetDom = rule.dayOfMonth ?? 1;
  let year = from.getUTCFullYear();
  let month = from.getUTCMonth();
  for (let i = 0; i < 24; i += 1) {
    const day = Math.min(targetDom, daysInMonth(year, month));
    const candidate = atTime(year, month, day, rule.timeOfDay);
    if (candidate >= from) return candidate;
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  throw new Error('Khong tinh duoc lan chay tiep theo (monthly)');
}

// Lan xay ra dau tien SAU "after" (khong bao gom chinh "after").
export function nextOccurrenceAfter(after: Date, rule: RecurrenceRule): Date {
  return nextOccurrenceOnOrAfter(new Date(after.getTime() + 1000), rule);
}
