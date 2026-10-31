import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../axios', () => ({ api: {} }));

import { getCardConflict } from './card';

const axiosError = (status: number, data: unknown) =>
  new AxiosError('x', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    data,
  } as AxiosResponse);

describe('getCardConflict', () => {
  it('409 CARD_CONFLICT -> tra ve cac truong xung dot + gia tri hien tai', () => {
    const c = getCardConflict(
      axiosError(409, {
        success: false,
        code: 'CARD_CONFLICT',
        data: { fields: ['description'], current: { description: 'Ban cua B' } },
      })
    );
    expect(c).toEqual({
      fields: ['description'],
      current: { description: 'Ban cua B' },
    });
  });

  it('giu duoc gia tri null (nguoi kia vua xoa mo ta / bo han)', () => {
    const c = getCardConflict(
      axiosError(409, {
        code: 'CARD_CONFLICT',
        data: { current: { startDate: null, dueDate: '2026-10-20T10:00:00.000Z' } },
      })
    );
    expect(c?.fields).toEqual(['startDate', 'dueDate']);
    expect(c?.current.startDate).toBeNull();
  });

  it('409 cua nghiep vu khac (khong co code CARD_CONFLICT) -> null', () => {
    expect(getCardConflict(axiosError(409, { message: 'Trung email' }))).toBeNull();
  });

  it('loi khac 409 / khong phai loi axios -> null', () => {
    expect(getCardConflict(axiosError(500, { code: 'CARD_CONFLICT' }))).toBeNull();
    expect(getCardConflict(new Error('boom'))).toBeNull();
    expect(getCardConflict(null)).toBeNull();
  });
});
