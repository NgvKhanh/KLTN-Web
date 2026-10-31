// Buoc 8 module canh bao tre han: story point cho du lieu demo Talk show (RISK_MODULE.md §2). Test THUAN.
import { describe, expect, it } from 'vitest';
import { storyPointsOf } from '../src/scripts/seedTalkshow';

const DAY = 86_400_000;
const start = new Date('2026-10-01T00:00:00.000Z');
const due = (days: number) => new Date(start.getTime() + days * DAY);

describe('storyPointsOf - suy từ thời lượng kế hoạch, bỏ trống 1/3 số thẻ', () => {
  it.each([
    [0.5, 1], [1, 1], [1.01, 2], [3, 2], [3.5, 3], [6, 3], [6.5, 5], [10, 5], [10.5, 8], [40, 8],
  ])('%f ngày → %i điểm', (days, points) => expect(storyPointsOf(start, due(days), 0)).toBe(points));

  it('thẻ thứ 3, 6, 9… (chỉ số chia 3 dư 2) để trống', () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => storyPointsOf(start, due(2), i))).toEqual([2, 2, null, 2, 2, null]);
  });
});
