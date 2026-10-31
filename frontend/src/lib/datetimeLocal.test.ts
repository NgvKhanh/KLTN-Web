import { describe, expect, it } from 'vitest';
import { toDatetimeLocalValue } from './datetimeLocal';

/**
 * Tinh gia tri "dung" mot cach DOC LAP voi cai dat that (khong dung
 * getFullYear/getMonth/... nhu toDatetimeLocalValue) - de test khong tro
 * thanh dong nghia voi chinh ham dang kiem. Dung getTimezoneOffset() (chenh
 * lech UTC - dia phuong theo PHUT) roi doi sang truong UTC cua 1 moc da doi.
 */
function expectedLocal(isoUtc: string): string {
  const utcMs = new Date(isoUtc).getTime();
  const offsetMin = new Date(utcMs).getTimezoneOffset();
  const shifted = new Date(utcMs - offsetMin * 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

// CODE_REVIEW.md #5: CardModal dung new Date(iso).toISOString().slice(0,16) de
// dien <input type="datetime-local">, nhung the loai o nay HIEU gia tri la GIO
// DIA PHUONG - ket qua la o hien SOM hon thuc te dung bang do lech mui gio, va
// bam Luu ma khong sua gi cung lam han lui lai dung tung do (o UTC+7 la 7 tieng).
describe('toDatetimeLocalValue', () => {
  it('rong / null / undefined -> chuoi rong', () => {
    expect(toDatetimeLocalValue('')).toBe('');
    expect(toDatetimeLocalValue(null)).toBe('');
    expect(toDatetimeLocalValue(undefined)).toBe('');
  });

  it('chuoi khong phai ngay hop le -> chuoi rong (khong nem loi)', () => {
    expect(toDatetimeLocalValue('khong-phai-ngay')).toBe('');
    expect(toDatetimeLocalValue('2026-13-99T99:99:00.000Z')).toBe('');
  });

  it('doi dung theo GIO DIA PHUONG cua may chay test (doc lap voi cai dat, xem expectedLocal)', () => {
    const cases = [
      '2026-09-19T03:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      '2026-12-31T23:59:00.000Z',
      '2026-02-28T12:34:00.000Z',
      new Date().toISOString(),
    ];
    for (const iso of cases) {
      expect(toDatetimeLocalValue(iso), iso).toBe(expectedLocal(iso));
    }
  });

  it('bo giay/mili-giay (dinh dang chi den PHUT, dung yeu cau cua input datetime-local)', () => {
    const v = toDatetimeLocalValue('2026-09-19T03:00:45.678Z');
    expect(v).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('khu vuc phia UTC+7 (may test o VN): 03:00Z hien thanh 10:00 dia phuong - dung dung tinh huong CODE_REVIEW.md tai hien', () => {
    // Chi kiem tra khi MAY THAT SU dang o UTC+7 (lech -420 phut) - tranh gia
    // dinh sai mui gio cua may chay CI/test khac (xem node-windows-tz-kiem-thu).
    if (new Date('2026-09-19T03:00:00.000Z').getTimezoneOffset() === -420) {
      expect(toDatetimeLocalValue('2026-09-19T03:00:00.000Z')).toBe('2026-09-19T10:00');
    }
  });

  it('doc roi ghi lai (khong sua gi) phai tra ve DUNG moc thoi gian ban dau - day chinh la kich ban "bam Luu ma khong sua" tung bi lui 1 khoang lech mui gio', () => {
    const original = '2026-09-19T03:00:00.000Z';
    const displayed = toDatetimeLocalValue(original);
    const savedBack = new Date(displayed).toISOString();
    expect(new Date(savedBack).getTime()).toBe(new Date(original).getTime());
  });
});
