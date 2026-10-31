// Khoang thoi gian cua chatbot theo gio Viet Nam (CHATBOT_MODULE.md §5.1).
import { describe, expect, it } from 'vitest';
import { CHAT_PERIODS, type ChatPeriod } from '../src/modules/chat/chat.intent';
import { periodRange, vnDayStart, vnToday } from '../src/modules/chat/chat.period';

const iso = (d: Date) => d.toISOString();
const range = (p: ChatPeriod, now: Date) => {
  const r = periodRange(p, now);
  return [iso(r.from), iso(r.to)];
};
const DAY = 86_400_000;

describe('periodRange', () => {
  it('dung bang vi du §5.1 (now = Thu Tu 30/09/2026 10:00 gio VN)', () => {
    const now = new Date('2026-09-30T03:00:00.000Z');
    expect(vnToday(now)).toBe('2026-09-30');
    expect(range('TODAY', now)).toEqual(['2026-09-29T17:00:00.000Z', '2026-09-30T17:00:00.000Z']);
    expect(range('TOMORROW', now)).toEqual(['2026-09-30T17:00:00.000Z', '2026-10-01T17:00:00.000Z']);
    expect(range('THIS_WEEK', now)).toEqual(['2026-09-27T17:00:00.000Z', '2026-10-04T17:00:00.000Z']);
    expect(range('NEXT_WEEK', now)).toEqual(['2026-10-04T17:00:00.000Z', '2026-10-11T17:00:00.000Z']);
    expect(range('LAST_WEEK', now)).toEqual(['2026-09-20T17:00:00.000Z', '2026-09-27T17:00:00.000Z']);
    // tu thoi diem hoi den 00:00 ngay 08/10 gio VN
    expect(range('NEXT_7_DAYS', now)).toEqual(['2026-09-30T03:00:00.000Z', '2026-10-07T17:00:00.000Z']);
    expect(iso(vnDayStart(now, 4))).toBe('2026-10-03T17:00:00.000Z');
  });

  it('bien nua dem va Chu nhat / Thu Hai (16:59:59.999Z / 17:00Z), qua nam', () => {
    // Chu nhat 04/10 23:59:59.999 gio VN: van la tuan 28/09
    const sunLate = new Date('2026-10-04T16:59:59.999Z');
    expect(vnToday(sunLate)).toBe('2026-10-04');
    expect(range('THIS_WEEK', sunLate)).toEqual(['2026-09-27T17:00:00.000Z', '2026-10-04T17:00:00.000Z']);
    expect(range('TODAY', sunLate)).toEqual(['2026-10-03T17:00:00.000Z', '2026-10-04T17:00:00.000Z']);
    expect(range('TOMORROW', sunLate)).toEqual(['2026-10-04T17:00:00.000Z', '2026-10-05T17:00:00.000Z']);

    // Thu Hai 05/10 00:00 gio VN: sang tuan moi
    const monStart = new Date('2026-10-04T17:00:00.000Z');
    expect(vnToday(monStart)).toBe('2026-10-05');
    expect(range('THIS_WEEK', monStart)).toEqual(['2026-10-04T17:00:00.000Z', '2026-10-11T17:00:00.000Z']);
    expect(range('LAST_WEEK', monStart)).toEqual(['2026-09-27T17:00:00.000Z', '2026-10-04T17:00:00.000Z']);
    expect(range('TODAY', monStart)).toEqual(['2026-10-04T17:00:00.000Z', '2026-10-05T17:00:00.000Z']);

    // 31/12/2026 20:00 gio VN (Thu Nam): tuan va ngay mai vat qua nam 2027
    const nye = new Date('2026-12-31T13:00:00.000Z');
    expect(vnToday(nye)).toBe('2026-12-31');
    expect(range('TOMORROW', nye)).toEqual(['2026-12-31T17:00:00.000Z', '2027-01-01T17:00:00.000Z']);
    expect(range('THIS_WEEK', nye)).toEqual(['2026-12-27T17:00:00.000Z', '2027-01-03T17:00:00.000Z']);
    expect(range('NEXT_7_DAYS', nye)).toEqual(['2026-12-31T13:00:00.000Z', '2027-01-07T17:00:00.000Z']);

    // 29/02/2028 03:00 gio VN (nam nhuan)
    expect(range('TODAY', new Date('2028-02-28T20:00:00.000Z'))).toEqual([
      '2028-02-28T17:00:00.000Z',
      '2028-02-29T17:00:00.000Z',
    ]);
    expect(range('TOMORROW', new Date('2028-02-28T20:00:00.000Z'))).toEqual([
      '2028-02-29T17:00:00.000Z',
      '2028-03-01T17:00:00.000Z',
    ]);
  });

  it('tinh chat tren 400 thoi diem ngau nhien (hat giong co dinh)', () => {
    let seed = 20260928; // MINSTD: tich < 2^53 nen tinh chinh xac bang so thuc
    const rand = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    const start = Date.parse('2024-01-01T00:00:00.000Z');
    const span = Date.parse('2030-12-31T00:00:00.000Z') - start;
    for (let n = 0; n < 400; n++) {
      const now = new Date(start + Math.floor(rand() * span));
      const r = Object.fromEntries(CHAT_PERIODS.map((p) => [p, periodRange(p, now)])) as Record<
        ChatPeriod,
        { from: Date; to: Date }
      >;
      const t = now.getTime();
      const label = iso(now);
      for (const p of CHAT_PERIODS) expect(r[p].from.getTime(), `${p} ${label}`).toBeLessThan(r[p].to.getTime());
      expect(r.TODAY.to.getTime() - r.TODAY.from.getTime(), label).toBe(DAY);
      expect(r.TODAY.from.getTime() <= t && t < r.TODAY.to.getTime(), label).toBe(true);
      expect(r.TOMORROW.from.getTime(), label).toBe(r.TODAY.to.getTime());
      for (const p of ['THIS_WEEK', 'NEXT_WEEK', 'LAST_WEEK'] as const) {
        expect(r[p].to.getTime() - r[p].from.getTime(), `${p} ${label}`).toBe(7 * DAY);
        // bat dau dung 00:00 Thu Hai gio VN
        const vn = new Date(r[p].from.getTime() + 7 * 3_600_000);
        expect(vn.getUTCDay(), `${p} ${label}`).toBe(1);
        expect(vn.getUTCHours() + vn.getUTCMinutes() + vn.getUTCSeconds() + vn.getUTCMilliseconds(), label).toBe(0);
      }
      expect(r.THIS_WEEK.from.getTime() <= t && t < r.THIS_WEEK.to.getTime(), label).toBe(true);
      expect(r.LAST_WEEK.to.getTime(), label).toBe(r.THIS_WEEK.from.getTime());
      expect(r.NEXT_WEEK.from.getTime(), label).toBe(r.THIS_WEEK.to.getTime());
      expect(r.NEXT_7_DAYS.from.getTime(), label).toBe(t);
      expect(r.NEXT_7_DAYS.to.getTime(), label).toBe(r.TODAY.from.getTime() + 8 * DAY);
      // khong tra ve chinh doi tuong `now` (nguoi goi sua ket qua khong lam hong now)
      expect(r.NEXT_7_DAYS.from).not.toBe(now);
    }
  });

  it('now khong hop le -> nem loi ro rang', () => {
    expect(() => periodRange('TODAY', new Date('khong phai ngay'))).toThrow('Thoi diem "now" khong hop le');
    expect(() => vnToday(new Date(Number.NaN))).toThrow('Thoi diem "now" khong hop le');
  });
});
