import { describe, expect, it } from 'vitest';
import { activityTime, collapseActivity, dayHeading, groupByDay } from './homeActivity';

// Giữa trưa thứ Tư 14/10/2026 theo giờ máy
const NOW = new Date(2026, 9, 14, 12, 0, 0);
const at = (day: number, hour: number, minute = 0, month = 9) => new Date(2026, month, day, hour, minute).toISOString();
const row = (id: string, user: string, card: string | null, createdAt: string) => ({
  id,
  user: { id: user },
  card: card ? { id: card } : null,
  createdAt,
});

describe('collapseActivity', () => {
  it('gộp dòng liền nhau cùng người + cùng thẻ trong 15 phút; giữ dòng mới nhất', () => {
    const rows = [
      row('a', 'u1', 'c1', at(14, 11, 50)),
      row('b', 'u1', 'c1', at(14, 11, 49)), // đổi trạng thái + chuyển cột cùng lúc
      row('c', 'u1', 'c1', at(14, 11, 40)),
      row('d', 'u1', 'c1', at(14, 11, 30)), // cách dòng mới nhất 20 phút: nhóm mới
      row('e', 'u2', 'c1', at(14, 11, 29)), // người khác
      row('f', 'u2', 'c2', at(14, 11, 28)), // thẻ khác
      row('g', 'u2', null, at(14, 11, 27)), // không gắn thẻ: không gộp
      row('h', 'u2', null, at(14, 11, 26)),
    ];
    expect(collapseActivity(rows).map((x) => [x.item.id, x.count])).toEqual([
      ['a', 3],
      ['d', 1],
      ['e', 1],
      ['f', 1],
      ['g', 1],
      ['h', 1],
    ]);
  });

  it('không gộp dòng cùng thẻ nhưng không liền nhau', () => {
    const rows = [
      row('a', 'u1', 'c1', at(14, 11, 50)),
      row('b', 'u2', 'c9', at(14, 11, 49)),
      row('c', 'u1', 'c1', at(14, 11, 48)),
    ];
    expect(collapseActivity(rows)).toHaveLength(3);
  });
});

describe('dayHeading / groupByDay / activityTime', () => {
  it('hôm nay, hôm qua, trong tuần ghi thứ, xa hơn ghi ngày đủ', () => {
    expect(dayHeading(at(14, 0, 5), NOW)).toBe('Hôm nay');
    expect(dayHeading(at(13, 23), NOW)).toBe('Hôm qua');
    expect(dayHeading(at(10, 9), NOW)).toBe('Thứ Bảy, 10/10');
    expect(dayHeading(at(11, 9), NOW)).toBe('Chủ nhật, 11/10');
    expect(dayHeading(at(7, 9), NOW)).toBe('07/10/2026');
  });

  it('nhóm theo ngày, giữ thứ tự', () => {
    const items = [at(14, 11), at(14, 9), at(13, 20), at(10, 8)].map((t) => ({ item: { createdAt: t } }));
    expect(groupByDay(items, NOW).map((g) => [g.heading, g.items.length])).toEqual([
      ['Hôm nay', 2],
      ['Hôm qua', 1],
      ['Thứ Bảy, 10/10', 1],
    ]);
  });

  it('hôm nay ghi "x phút/giờ trước", ngày khác ghi giờ', () => {
    expect(activityTime(at(14, 11, 59), NOW)).toBe('1 phút trước');
    expect(activityTime(new Date(NOW.getTime() - 20_000).toISOString(), NOW)).toBe('vừa xong');
    expect(activityTime(at(14, 9), NOW)).toBe('3 giờ trước');
    expect(activityTime(at(13, 16, 5), NOW)).toBe('16:05');
  });
});
