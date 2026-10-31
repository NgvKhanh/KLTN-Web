import { AppError } from '../../../utils/AppError';
import type { DateRangeInput } from './chat.v2.schema';

const DAY = 86_400_000;
const VN_OFFSET = 7 * 3_600_000;
function boundary(value: string, inclusiveEnd: boolean): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const utc = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== value) throw new AppError('Ngày không hợp lệ', 400);
    return new Date(utc.getTime() - VN_OFFSET + (inclusiveEnd ? DAY : 0));
  }
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new AppError('Thời điểm không hợp lệ', 400);
  return result;
}
/** Date-only `to` is an inclusive VN day; a timestamp `to` is exclusive. */
export function normalizeRange(input: DateRangeInput): { from: Date; to: Date } {
  const from = boundary(input.from, false);
  const to = boundary(input.to, true);
  if (from >= to) throw new AppError('Khoảng thời gian phải có điểm cuối sau điểm đầu', 400);
  return { from, to };
}
export function vietnamDay(date: Date): string {
  return new Date(date.getTime() + VN_OFFSET).toISOString().slice(0, 10);
}
