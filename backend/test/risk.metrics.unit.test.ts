// Buoc 5 module canh bao tre han (RISK_MODULE.md §13): chi so danh gia. Test THUAN, so lieu tinh tay.
import { describe, expect, it } from 'vitest';
import { atThreshold, auc, brier, calibrationTable, ece, median, type Scored } from '../src/scripts/riskMetrics';

const r = (p: number, y: 0 | 1): Scored => ({ p, y });

describe('AUC', () => {
  it('tách hoàn hảo → 1; đảo ngược → 0', () => {
    expect(auc([r(0.1, 0), r(0.2, 0), r(0.8, 1), r(0.9, 1)])).toBe(1);
    expect(auc([r(0.9, 0), r(0.8, 0), r(0.2, 1), r(0.1, 1)])).toBe(0);
  });
  it('ví dụ tính tay: 2 dương × 3 âm = 6 cặp, thắng 3, hoà 1 → 3,5/6', () => {
    // duong 0,6 thang 0,2 / 0,4, hoa 0,6 (2,5); duong 0,3 thang 0,2, thua 0,4 / 0,6 (1)
    expect(auc([r(0.6, 1), r(0.3, 1), r(0.2, 0), r(0.4, 0), r(0.6, 0)])).toBeCloseTo(3.5 / 6, 15);
  });
  it('mọi điểm bằng nhau → 0,5; thiếu một lớp → null', () => {
    expect(auc([r(0.5, 1), r(0.5, 0), r(0.5, 0)])).toBe(0.5);
    expect(auc([r(0.2, 1), r(0.4, 1)])).toBeNull();
    expect(auc([])).toBeNull();
  });
  it('không phụ thuộc thứ tự đầu vào', () => {
    const rows = [r(0.6, 1), r(0.3, 1), r(0.2, 0), r(0.4, 0), r(0.6, 0), r(0.35, 1)];
    expect(auc([...rows].reverse())).toBe(auc(rows));
  });
});

describe('Brier, ECE, bảng hiệu chỉnh', () => {
  it('Brier tính tay', () => {
    expect(brier([r(0.8, 1), r(0.3, 0)])).toBeCloseTo((0.04 + 0.09) / 2, 15);
    expect(() => brier([])).toThrow(RangeError);
  });
  it('ECE tính tay: hai khoảng', () => {
    // khoang [0,1;0,2): p 0,1 / 0,15, y 0 / 1 -> |0,125 - 0,5| = 0,375, trong so 2/4
    // khoang [0,9;1]: p 0,9 / 1, y 1 / 1 -> |0,95 - 1| = 0,05, trong so 2/4
    expect(ece([r(0.1, 0), r(0.15, 1), r(0.9, 1), r(1, 1)])).toBeCloseTo(0.5 * 0.375 + 0.5 * 0.05, 15);
  });
  it('hiệu chỉnh hoàn hảo → ECE 0', () => {
    expect(ece([r(0.25, 1), r(0.25, 0), r(0.25, 0), r(0.25, 0)])).toBeCloseTo(0, 15);
  });
  it('p = 1 rơi vào khoảng cuối, p = 0 vào khoảng đầu', () => {
    const t = calibrationTable([r(1, 1), r(0, 0), r(0.05, 1)]);
    expect(t).toHaveLength(10);
    expect(t[9]).toMatchObject({ n: 1, meanP: 1, lateRate: 1 });
    expect(t[0]).toMatchObject({ n: 2, meanP: 0.025, lateRate: 0.5 });
    expect(t[5]).toMatchObject({ n: 0, meanP: null, lateRate: null });
  });
  it('đầu vào hỏng → RangeError', () => {
    expect(() => ece([r(1.2, 1)])).toThrow(RangeError);
    expect(() => auc([{ p: 0.5, y: 2 as 1 }])).toThrow(RangeError);
    expect(() => brier([r(Number.NaN, 1)])).toThrow(RangeError);
  });
});

describe('tại ngưỡng điểm', () => {
  const rows = [r(0.9, 1), r(0.76, 0), r(0.755, 1), r(0.51, 1), r(0.505, 0), r(0.2, 1)];
  it('ngưỡng 51: điểm = round(100p) ≥ 51', () => {
    // diem: 90, 76, 76 (75,5 -> 76), 51, 51 (50,5 -> 51), 20
    expect(atThreshold(rows, 51)).toEqual({ precision: 3 / 5, recall: 3 / 4, flagged: 5 });
  });
  it('ngưỡng 76', () => expect(atThreshold(rows, 76)).toEqual({ precision: 2 / 3, recall: 2 / 4, flagged: 3 }));
  it('không cảnh báo thẻ nào → precision null; không có thẻ trễ → recall null', () => {
    expect(atThreshold([r(0.1, 1)], 51)).toEqual({ precision: null, recall: 0, flagged: 0 });
    expect(atThreshold([r(0.9, 0)], 51)).toEqual({ precision: 0, recall: null, flagged: 1 });
  });
});

describe('median', () => {
  it('lẻ / chẵn / rỗng', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
