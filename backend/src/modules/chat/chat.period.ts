// Khoang thoi gian [tu, den) cua tung period (CHATBOT_MODULE.md §5.1).
//
// Moc tinh theo GIO VIET NAM (+07:00, khong gio mua he), KHONG phu thuoc bien TZ
// cua may chu: "hom nay" lay qua Intl (todayInVietnam), moc 00:00 lay qua
// startInstant - ca hai la ham san co cua module AI, day la tep DUY NHAT cua
// chatbot import chung (de bo luat / lop LLM khong keo theo prisma).
// "Bay gio" luon la tham so `now`, khong doc dong ho o day.

import { addDays, mondayOfWeek, type IsoDate } from '../ai/ai.dates';
import { todayInVietnam } from '../ai/ai.service';
import { startInstant } from '../ai/ai.apply';
import type { ChatPeriod } from './chat.intent';

/** Khoang nua mo [from, to). */
export interface TimeRange {
  from: Date;
  to: Date;
}

function assertValidNow(now: Date): void {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new Error('Thoi diem "now" khong hop le');
  }
}

/** Ngay lich hien tai o Viet Nam ("YYYY-MM-DD"). */
export function vnToday(now: Date): IsoDate {
  assertValidNow(now);
  return todayInVietnam(now);
}

/** 00:00 gio Viet Nam cua (hom nay + offsetDays). */
export function vnDayStart(now: Date, offsetDays: number): Date {
  return startInstant(addDays(vnToday(now), offsetDays));
}

export function periodRange(period: ChatPeriod, now: Date): TimeRange {
  const today = vnToday(now);
  const day = (offset: number) => startInstant(addDays(today, offset));
  const monday = mondayOfWeek(today);
  const week = (offsetWeeks: number): TimeRange => ({
    from: startInstant(addDays(monday, 7 * offsetWeeks)),
    to: startInstant(addDays(monday, 7 * offsetWeeks + 7)),
  });

  switch (period) {
    case 'TODAY':
      return { from: day(0), to: day(1) };
    case 'TOMORROW':
      return { from: day(1), to: day(2) };
    case 'THIS_WEEK':
      return week(0);
    case 'NEXT_WEEK':
      return week(1);
    case 'LAST_WEEK':
      return week(-1);
    case 'NEXT_7_DAYS':
      // Tu THOI DIEM HOI den het 7 ngay toi -> khong gom viec da qua han
      return { from: new Date(now.getTime()), to: day(8) };
  }
}
