import { describe, expect, it } from 'vitest';
import { parseCookieSameSite } from '../src/config/cookieSameSite';

describe('parseCookieSameSite', () => {
  it('khong dat / de trong -> lax (frontend va backend cung trang)', () => {
    for (const raw of [undefined, '', '   ']) {
      expect(parseCookieSameSite(raw), String(raw)).toBe('lax');
    }
  });

  it('lax / strict / none, khong phan biet hoa thuong va khoang trang', () => {
    expect(parseCookieSameSite('lax')).toBe('lax');
    expect(parseCookieSameSite('Strict')).toBe('strict');
    expect(parseCookieSameSite(' NONE ')).toBe('none');
  });

  it('gia tri la -> nem loi ngay luc khoi dong', () => {
    expect(() => parseCookieSameSite('no')).toThrow(/COOKIE_SAMESITE/);
    expect(() => parseCookieSameSite('true')).toThrow(/COOKIE_SAMESITE/);
  });
});
