import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { easeOutCubic, useCountUp } from './useCountUp';

function mockReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: reduce && q.includes('reduce'),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'] });
  mockReducedMotion(false);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('easeOutCubic', () => {
  it('đi từ 0 đến 1, nhanh lúc đầu, và kẹp ngoài khoảng', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(-1)).toBe(0);
    expect(easeOutCubic(2)).toBe(1);
  });
});

describe('useCountUp', () => {
  it('lần đầu hiện thẳng giá trị (không đếm từ 0)', () => {
    const { result } = renderHook(() => useCountUp(12));
    expect(result.current).toBe(12);
  });

  it('khi đích đổi thì đếm dần rồi kết thúc đúng đích', () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v, { durationMs: 500 }), {
      initialProps: { v: 0 },
    });
    rerender({ v: 10 });
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(result.current).toBeGreaterThan(0);
    expect(result.current).toBeLessThan(10);
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(result.current).toBe(10);
  });

  it('enabled=false (đang tải): nhảy thẳng tới đích, không hiệu ứng', () => {
    const { result, rerender } = renderHook(({ v, on }) => useCountUp(v, { enabled: on }), {
      initialProps: { v: 0, on: false },
    });
    rerender({ v: 8, on: false });
    expect(result.current).toBe(8);
  });

  it('người dùng chọn giảm chuyển động: nhảy thẳng tới đích', () => {
    mockReducedMotion(true);
    const { result, rerender } = renderHook(({ v }) => useCountUp(v), { initialProps: { v: 0 } });
    rerender({ v: 7 });
    expect(result.current).toBe(7);
  });

  it('đích đổi giữa chừng: kết thúc ở đích MỚI', () => {
    const { result, rerender } = renderHook(({ v }) => useCountUp(v, { durationMs: 500 }), {
      initialProps: { v: 0 },
    });
    rerender({ v: 10 });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ v: 3 });
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(result.current).toBe(3);
  });
});
