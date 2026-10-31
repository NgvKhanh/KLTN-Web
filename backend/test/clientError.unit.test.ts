import { describe, expect, it } from 'vitest';
import { clientErrorOf, isUniqueViolation } from '../src/utils/clientError';

describe('clientErrorOf', () => {
  it('JSON sai cu phap -> 400 voi thong diep co dinh (khong chuyen tiep thong diep tieng Anh cua thu vien)', () => {
    const err = Object.assign(new SyntaxError("Unexpected token 'b' at position 1"), {
      status: 400,
      statusCode: 400,
      type: 'entity.parse.failed',
    });
    const r = clientErrorOf(err);
    expect(r).toEqual({ status: 400, message: 'Du lieu JSON gui len khong hop le' });
    expect(r!.message).not.toContain('Unexpected');
  });

  it('body qua lon -> 413; charset / ma hoa khong ho tro -> 415', () => {
    expect(clientErrorOf({ status: 413, type: 'entity.too.large' })).toEqual({ status: 413, message: 'Du lieu gui len qua lon' });
    expect(clientErrorOf({ status: 415, type: 'charset.unsupported' })?.status).toBe(415);
    expect(clientErrorOf({ statusCode: 415 })?.status).toBe(415);
  });

  it('loi 4xx khac cua Express (decode param, request aborted...) -> 400 chung', () => {
    expect(clientErrorOf({ status: 400, type: 'request.aborted' })).toEqual({ status: 400, message: 'Yeu cau khong hop le' });
    expect(clientErrorOf({ statusCode: 404 })).toEqual({ status: 400, message: 'Yeu cau khong hop le' });
  });

  it('loi he thong / khong co ma / ma 5xx -> null (de bo xu ly chung tra 500)', () => {
    expect(clientErrorOf(new Error('boom'))).toBeNull();
    expect(clientErrorOf({ status: 500 })).toBeNull();
    expect(clientErrorOf({ statusCode: 302 })).toBeNull();
    expect(clientErrorOf(null)).toBeNull();
    expect(clientErrorOf('x')).toBeNull();
  });
});

describe('isUniqueViolation', () => {
  it('nhan dien ma P2002', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true);
    expect(isUniqueViolation({ code: 'P2025' })).toBe(false);
    expect(isUniqueViolation(new Error('x'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});
