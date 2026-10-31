import { describe, expect, it } from 'vitest';
import { endOfLocalDayIso, formatViDate, isPausedNow, startOfLocalDayIso, toLocalDateInput } from './assignDates';

// Cac phep kiem KHONG phu thuoc mui gio cua may chay test (tren Windows bien TZ cua Node khong doi duoc): moi ky vong
// duoc dung tu cac ham lay thanh phan DIA PHUONG (getHours...), khong viet cung chuoi UTC.

const parts = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()];

describe('endOfLocalDayIso', () => {
  it('"2026-10-05" -> 23:59:59.999 cuoi ngay 05/10 THEO GIO DIA PHUONG', () => {
    const iso = endOfLocalDayIso('2026-10-05');
    expect(iso).not.toBeNull();
    expect(iso).toMatch(/Z$/); // may chu can ISO co Z
    expect(parts(new Date(iso!))).toEqual([2026, 10, 5, 23, 59, 59, 999]);
  });

  it('ngay nhuan: 29/02/2028 hop le, 29/02/2026 va 30/02 khong; cuoi thang / cuoi nam', () => {
    expect(parts(new Date(endOfLocalDayIso('2028-02-29')!)).slice(0, 3)).toEqual([2028, 2, 29]);
    expect(endOfLocalDayIso('2026-02-29')).toBeNull();
    expect(endOfLocalDayIso('2026-02-30')).toBeNull();
    expect(parts(new Date(endOfLocalDayIso('2026-12-31')!)).slice(0, 3)).toEqual([2026, 12, 31]);
    expect(parts(new Date(endOfLocalDayIso('2026-01-01')!)).slice(0, 3)).toEqual([2026, 1, 1]);
  });

  it('chuoi khong phai ngay lich that -> null (khong nem loi)', () => {
    for (const bad of ['', '2026-10-5', '5-10-2026', '05/10/2026', '2026-13-01', '2026-00-10', '2026-10-32', '2026-10-00', 'abc', '2026-10-05T10:00', ' 2026-10-05', '2026-10-05 ']) {
      expect(endOfLocalDayIso(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe('toLocalDateInput', () => {
  it('VONG TRON: toLocalDateInput(endOfLocalDayIso(d)) = d cho 800 ngay lien tiep (qua thang, nam, nam nhuan, doi gio neu co)', () => {
    let d = new Date(2027, 0, 1, 12);
    for (let i = 0; i < 800; i += 1) {
      const s = `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      expect(toLocalDateInput(endOfLocalDayIso(s)), s).toBe(s);
      d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12);
    }
  });

  it('khong dung gio UTC: mot thoi diem 23:30 dia phuong van la NGAY DO (khong lui/tien mot ngay)', () => {
    const late = new Date(2026, 9, 5, 23, 30).toISOString();
    const early = new Date(2026, 9, 5, 0, 30).toISOString();
    expect(toLocalDateInput(late)).toBe('2026-10-05');
    expect(toLocalDateInput(early)).toBe('2026-10-05');
  });

  it('null / rong / khong hop le -> chuoi rong', () => {
    expect(toLocalDateInput(null)).toBe('');
    expect(toLocalDateInput('')).toBe('');
    expect(toLocalDateInput('khong-phai-ngay')).toBe('');
  });
});

describe('isPausedNow', () => {
  const now = new Date('2026-10-05T05:00:00.000Z');
  it('con tam nghi khi thoi diem het tam nghi >= now (bien: bang now van la tam nghi)', () => {
    expect(isPausedNow('2026-10-05T05:00:00.001Z', now)).toBe(true);
    expect(isPausedNow('2026-10-05T05:00:00.000Z', now)).toBe(true);
    expect(isPausedNow('2026-10-05T04:59:59.999Z', now)).toBe(false);
    expect(isPausedNow('2030-01-01T00:00:00.000Z', now)).toBe(true);
    expect(isPausedNow('2020-01-01T00:00:00.000Z', now)).toBe(false);
  });
  it('null / khong hop le -> khong tam nghi', () => {
    expect(isPausedNow(null, now)).toBe(false);
    expect(isPausedNow('rac', now)).toBe(false);
    expect(isPausedNow(new Date(Date.now() + 3_600_000).toISOString())).toBe(true); // mac dinh now = bay gio
  });
});

describe('formatViDate', () => {
  it('dd/MM/yyyy theo gio dia phuong, them so 0', () => {
    expect(formatViDate(new Date(2026, 0, 5, 12).toISOString())).toBe('05/01/2026');
    expect(formatViDate(new Date(2026, 11, 31, 23, 59).toISOString())).toBe('31/12/2026');
  });
  it('khong hop le -> chuoi rong', () => {
    expect(formatViDate('rac')).toBe('');
    expect(formatViDate('')).toBe('');
  });
});

describe('startOfLocalDayIso', () => {
  it('00:00:00.000 dau ngay theo gio dia phuong', () => {
    expect(startOfLocalDayIso('2026-10-05')).toBe(new Date(2026, 9, 5, 0, 0, 0, 0).toISOString());
  });
  it('ngay khong ton tai / sai dinh dang -> null', () => {
    expect(startOfLocalDayIso('2026-02-30')).toBeNull();
    expect(startOfLocalDayIso('2026-13-01')).toBeNull();
    expect(startOfLocalDayIso('05/10/2026')).toBeNull();
    expect(startOfLocalDayIso('')).toBeNull();
  });
  it('dau ngay < cuoi ngay cung ngay, va chi cach nhau < 24h', () => {
    const a = new Date(startOfLocalDayIso('2026-10-05')!).getTime();
    const b = new Date(endOfLocalDayIso('2026-10-05')!).getTime();
    expect(b).toBeGreaterThan(a);
    expect(b - a).toBeLessThan(25 * 3600_000);
  });
});
