import { describe, expect, it } from 'vitest';
import { parseTrustProxy } from '../src/config/trustProxy';

describe('parseTrustProxy', () => {
  it('de trong / khong dat / false / 0 -> null (khong tin proxy nao)', () => {
    for (const raw of [undefined, '', '   ', 'false', 'FALSE', 'no', 'off', '0']) {
      expect(parseTrustProxy(raw), String(raw)).toBeNull();
    }
  });

  it('so nguyen -> so cap proxy', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
  });

  it('true -> tin moi proxy', () => {
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('ON')).toBe(true);
  });

  it('danh sach dia chi / mang con -> giu nguyen chuoi cho Express', () => {
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
    expect(parseTrustProxy('::1')).toBe('::1');
  });

  it('gia tri la (chua ky tu khong cho phep) -> nem loi ngay luc khoi dong', () => {
    expect(() => parseTrustProxy('1; drop table')).toThrow(/TRUST_PROXY/);
  });
});
