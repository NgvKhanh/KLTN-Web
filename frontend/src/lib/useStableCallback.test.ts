import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useStableCallback } from './useStableCallback';

describe('useStableCallback', () => {
  it('giu nguyen mot ham qua cac lan render nhung luon goi ban moi nhat cua ham truyen vao', () => {
    const first = vi.fn((x: number) => x + 1);
    const second = vi.fn((x: number) => x * 10);
    const { result, rerender } = renderHook(({ fn }) => useStableCallback(fn), {
      initialProps: { fn: first },
    });
    const stable = result.current;
    expect(stable(1)).toBe(2);

    rerender({ fn: second });
    // Cung mot tham chieu (de component memo khong phai ve lai) ...
    expect(result.current).toBe(stable);
    // ... nhung goi ham moi nhat (khong bi ket voi dong-bao-dong cu)
    expect(stable(3)).toBe(30);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
