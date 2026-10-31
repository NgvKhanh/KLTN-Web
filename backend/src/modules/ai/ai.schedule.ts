// Bo rai lich TAT DINH cua module AI (AI_MODULE.md §5.2) - thay cho scheduler
// duong gang (CPM) cua ban v1. Ham thuan: khong doc dong ho ("hom nay" la tham so),
// khong doi vao dau vao, cung dau vao luon ra cung ket qua.
//
// 3 LUAT theo thu tu uu tien cho tung the:
//   1. The da co ngay EXPLICIT (bo luat tim thay hoac nguoi dung ghi) -> GIU NGUYEN
//      tuyet doi, ke ca roi vao T7/CN, ke ca ngoai cua so. Khong bia not ngay con
//      lai: chi co han chot thi ngay bat dau de trong.
//   2. The co goi y cua LLM (startOffsetDays / durationDays) -> doi thanh ngay that.
//   3. The con lai -> rai deu trong cua so [start, end].
//
// "Ngay" o day dem theo NGAY LAM VIEC khi skipWeekend (mac dinh), tuc "offset 5" la
// ngay lam viec thu 6 ke tu ngay bat dau; khi tat skipWeekend thi dem ngay lich.
// Nho vay khong bao gio phai xu ly "offset roi vao Chu nhat".
//
// Ngay la chuoi "YYYY-MM-DD", tinh bang ai.dates.ts (chi UTC).

import { addDays, diffDays, isValidIso, isWeekend, type IsoDate } from './ai.dates';
import type { DateOrigin, WarningCode } from './boardPlan.schema';

export type ScheduleWarningCode = Extract<
  WarningCode,
  'DEFAULT_WINDOW' | 'DEADLINE_IN_PAST' | 'WINDOW_TOO_SHORT' | 'OFFSET_CLAMPED'
>;

export interface ScheduleWarning {
  code: ScheduleWarningCode;
  message: string;
  /** Vi tri cua the trong mang dau vao (neu canh bao ve 1 the). */
  index?: number;
}

export interface ScheduleInput {
  /** Ngay DA CO (EXPLICIT) tu bo luat hoac nguoi dung. */
  startDate: IsoDate | null;
  dueDate: IsoDate | null;
  /** Goi y cua LLM: ngay lam viec ke tu ngay bat dau du an (0 = ngay dau); null = khong biet. */
  startOffsetDays: number | null;
  /** Goi y cua LLM: keo dai bao nhieu ngay lam viec (>= 1); null = khong biet. */
  durationDays: number | null;
}

export interface ScheduleOptions {
  /** Ngay lich hien tai. */
  today: IsoDate;
  /** Ngay bat dau du an. Mac dinh = today. */
  start?: IsoDate | null;
  /** Ngay ket thuc du an. Khong co -> cua so mac dinh 28 ngay ke tu start (+ canh bao). */
  end?: IsoDate | null;
  /** Bo T7/CN khi rai va khi doi offset. Mac dinh true. */
  skipWeekend?: boolean;
  /** Co bia ngay cho the KHONG co ngay va KHONG co goi y khong? Mac dinh true. */
  spreadUndated?: boolean;
}

export interface ScheduledDates {
  startDate: IsoDate | null;
  startOrigin: DateOrigin;
  dueDate: IsoDate | null;
  dueOrigin: DateOrigin;
}

export interface ScheduleResult {
  /** Cung thu tu va so luong voi dau vao. */
  cards: ScheduledDates[];
  warnings: ScheduleWarning[];
  window: {
    start: IsoDate;
    end: IsoDate;
    /** So "ngay" (lam viec neu skipWeekend) trong cua so. */
    dayCount: number;
    /** false neu cua so khong co ngay lam viec nen phai dem ngay lich. */
    skipWeekend: boolean;
    /** true neu ngay ket thuc la cua so mac dinh chu khong phai do nguoi dung dat. */
    defaultEnd: boolean;
  };
}

export const DEFAULT_WINDOW_DAYS = 28;

function mustBeIso(label: string, value: string): void {
  if (!isValidIso(value)) {
    throw new Error(`"${label}" phai la YYYY-MM-DD hop le, nhan duoc "${value}"`);
  }
}

/** Ngay lam viec dau tien tu d tro di (d neu d da la ngay lam viec). */
function nextWorkday(d: IsoDate): IsoDate {
  let x = d;
  while (isWeekend(x)) x = addDays(x, 1);
  return x;
}

/** So ngay trong [from, to] (chi dem ngay lam viec neu skipWeekend). 0 neu to < from. */
export function countDays(from: IsoDate, to: IsoDate, skipWeekend: boolean): number {
  if (to < from) return 0;
  const total = diffDays(from, to) + 1;
  if (!skipWeekend) return total;
  const fullWeeks = Math.floor(total / 7);
  let count = fullWeeks * 5;
  let d = addDays(from, fullWeeks * 7);
  for (let i = 0; i < total % 7; i += 1) {
    if (!isWeekend(d)) count += 1;
    d = addDays(d, 1);
  }
  return count;
}

/**
 * Ngay thu n (tu 0) ke tu `from`. Neu skipWeekend thi `from` PHAI la ngay lam viec
 * va n dem ngay lam viec.
 */
export function nthDay(from: IsoDate, n: number, skipWeekend: boolean): IsoDate {
  if (!skipWeekend) return addDays(from, n);
  let d = addDays(from, Math.floor(n / 5) * 7);
  for (let i = 0; i < n % 5; i += 1) {
    d = addDays(d, 1);
    while (isWeekend(d)) d = addDays(d, 1);
  }
  return d;
}

export function scheduleCards(cards: readonly ScheduleInput[], opts: ScheduleOptions): ScheduleResult {
  mustBeIso('today', opts.today);
  const projectStart = opts.start ?? opts.today;
  mustBeIso('start', projectStart);
  const endGiven = opts.end ?? null;
  if (endGiven !== null) mustBeIso('end', endGiven);
  const spreadUndated = opts.spreadUndated ?? true;

  const warnings: ScheduleWarning[] = [];
  const warn = (w: ScheduleWarning) => {
    // Canh bao ve "cua so" chi bao 1 lan; canh bao theo the (co index) thi bao het.
    if (w.index === undefined && warnings.some((x) => x.code === w.code)) return;
    warnings.push(w);
  };

  // ---- Cua so ----
  let useSkip = opts.skipWeekend ?? true;
  let startDay: IsoDate = projectStart;
  let endDay: IsoDate = endGiven ?? addDays(projectStart, DEFAULT_WINDOW_DAYS - 1);

  if (endDay < startDay) {
    // Cua so dao nguoc (thuong do ngay ket thuc o qua khu trong khi start = hom nay).
    warn(
      endDay < opts.today
        ? { code: 'DEADLINE_IN_PAST', message: 'Ngày kết thúc đã ở quá khứ, các thẻ được xếp vào ngày bắt đầu.' }
        : { code: 'WINDOW_TOO_SHORT', message: 'Ngày kết thúc sớm hơn ngày bắt đầu, các thẻ được xếp vào ngày bắt đầu.' }
    );
    endDay = startDay;
  } else if (endGiven !== null && endGiven < opts.today) {
    warn({ code: 'DEADLINE_IN_PAST', message: 'Ngày kết thúc đã ở quá khứ.' });
  }

  if (useSkip) {
    if (countDays(startDay, endDay, true) === 0) {
      // Cua so chi gom T7/CN -> dem ngay lich thay vi khong co cho de xep.
      useSkip = false;
      warn({
        code: 'WINDOW_TOO_SHORT',
        message: 'Khoảng thời gian không có ngày làm việc nào, đã tính cả thứ Bảy và Chủ nhật.',
      });
    } else {
      startDay = nextWorkday(startDay);
    }
  }
  const dayCount = countDays(startDay, endDay, useSkip);

  // ---- Tung the ----
  const result: ScheduledDates[] = cards.map(() => ({
    startDate: null,
    startOrigin: 'NONE',
    dueDate: null,
    dueOrigin: 'NONE',
  }));
  const toSpread: number[] = [];

  cards.forEach((card, i) => {
    // Luat 1: co ngay EXPLICIT -> giu nguyen, khong bia not ngay con lai
    if (card.startDate !== null || card.dueDate !== null) {
      result[i] = {
        startDate: card.startDate,
        startOrigin: card.startDate !== null ? 'EXPLICIT' : 'NONE',
        dueDate: card.dueDate,
        dueOrigin: card.dueDate !== null ? 'EXPLICIT' : 'NONE',
      };
      return;
    }

    // Luat 2: goi y cua LLM
    if (card.startOffsetDays !== null || card.durationDays !== null) {
      let startIdx = Math.max(0, card.startOffsetDays ?? 0);
      let dueIdx = startIdx + Math.max(1, card.durationDays ?? 1) - 1;
      // Chi ke vao cua so khi NGUOI DUNG dat ngay ket thuc; cua so mac dinh 28 ngay la
      // do ta tu chon nen khong duoc de no cat ngan ke hoach dai hon cua LLM.
      if (endGiven !== null && dueIdx > dayCount - 1) {
        startIdx = Math.min(startIdx, dayCount - 1);
        dueIdx = dayCount - 1;
        warn({
          code: 'OFFSET_CLAMPED',
          message: 'Gợi ý thời gian của AI vượt quá ngày kết thúc nên đã được rút gọn.',
          index: i,
        });
      }
      result[i] = {
        startDate: nthDay(startDay, startIdx, useSkip),
        startOrigin: 'SCHEDULED',
        dueDate: nthDay(startDay, dueIdx, useSkip),
        dueOrigin: 'SCHEDULED',
      };
      return;
    }

    // Luat 3: rai deu
    if (spreadUndated) toSpread.push(i);
  });

  const n = toSpread.length;
  let prevDueIdx = -1;
  toSpread.forEach((cardIndex, j) => {
    // ceil((j+1) * dayCount / n) - 1 bang so nguyen, khong dung so thuc
    const dueIdx = Math.floor(((j + 1) * dayCount + n - 1) / n) - 1;
    const startIdx = Math.min(prevDueIdx + 1, dueIdx);
    prevDueIdx = dueIdx;
    result[cardIndex] = {
      startDate: nthDay(startDay, startIdx, useSkip),
      startOrigin: 'SCHEDULED',
      dueDate: nthDay(startDay, dueIdx, useSkip),
      dueOrigin: 'SCHEDULED',
    };
  });
  if (n > 0 && endGiven === null) {
    warn({
      code: 'DEFAULT_WINDOW',
      message: `Chưa có ngày kết thúc dự án nên các thẻ được xếp trong ${DEFAULT_WINDOW_DAYS} ngày kể từ ngày bắt đầu.`,
    });
  }

  return {
    cards: result,
    warnings,
    window: { start: startDay, end: endDay, dayCount, skipWeekend: useSkip, defaultEnd: endGiven === null },
  };
}
