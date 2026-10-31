import { useEffect, useRef, useState } from 'react';

const DEFAULT_DURATION_MS = 500;

/** Nội suy giảm tốc (nhanh lúc đầu, chậm dần về đích). t chạy từ 0 đến 1. */
export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - c, 3);
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Số "đếm lên" từ giá trị đang hiển thị tới `target`. Giảm chuyển động hoặc `enabled = false`
 * (ví dụ đang tải) thì nhảy thẳng tới `target`, không hiệu ứng. Số nguyên, luôn kết thúc đúng `target`.
 */
export function useCountUp(
  target: number,
  { enabled = true, durationMs = DEFAULT_DURATION_MS }: { enabled?: boolean; durationMs?: number } = {}
): number {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);

  useEffect(() => {
    const from = shownRef.current;
    if (!enabled || from === target || prefersReducedMotion() || durationMs <= 0) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    let frame = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      start ??= now;
      const t = (now - start) / durationMs;
      const value = t >= 1 ? target : Math.round(from + (target - from) * easeOutCubic(t));
      shownRef.current = value;
      setShown(value);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, enabled, durationMs]);

  return shown;
}
