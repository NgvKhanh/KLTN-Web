import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';
import { getErrorMessage } from './errorMessage';

const apiError = (status: number, data: unknown) =>
  new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    data,
  } as AxiosResponse);

describe('getErrorMessage', () => {
  it('loi nghiep vu: lay `message` cua server', () => {
    expect(getErrorMessage(apiError(403, { message: 'Ban khong co quyen' }), 'x')).toBe(
      'Ban khong co quyen'
    );
  });

  it('loi validate: uu tien ly do cu the theo truong thay vi cau chung', () => {
    const err = apiError(400, {
      message: 'Du lieu gui len khong hop le',
      errors: [{ field: 'description', message: 'Mo ta qua dai' }],
    });
    expect(getErrorMessage(err, 'x')).toBe('Mo ta qua dai');
  });

  it('thong diep mac dinh tieng Anh cua zod bi bo qua -> dung cau chung cua server', () => {
    const err = apiError(400, {
      message: 'Du lieu gui len khong hop le',
      errors: [{ field: 'name', message: 'Too big: expected string to have <=50 characters' }],
    });
    expect(getErrorMessage(err, 'x')).toBe('Du lieu gui len khong hop le');
  });

  it('lay ly do tieng Viet dau tien khi truoc do co thong diep mac dinh cua zod', () => {
    const err = apiError(400, {
      message: 'Du lieu gui len khong hop le',
      errors: [
        { field: 'a', message: 'Invalid input' },
        { field: 'b', message: 'Ten bang qua dai' },
      ],
    });
    expect(getErrorMessage(err, 'x')).toBe('Ten bang qua dai');
  });

  it('khong co phan hoi / khong phai loi axios -> gia tri du phong', () => {
    expect(getErrorMessage(new Error('boom'), 'Du phong')).toBe('Du phong');
    expect(getErrorMessage(null, 'Du phong')).toBe('Du phong');
    expect(getErrorMessage(apiError(500, undefined), 'Du phong')).toBe('Du phong');
  });
});
