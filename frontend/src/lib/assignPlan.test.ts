import { describe, expect, it } from 'vitest';
import type { AssignPlanPerson, AssignPlanPick, AssignPlanRanking, AssignPlanRow } from '../types/assign';
import {
  applySelection,
  distribution,
  initialIncluded,
  initialPicks,
  optionLabel,
  rowWarning,
  selectedRows,
} from './assignPlan';

// Phan tinh toan cua man hinh chia viec: ham thuan, kiem bang so tinh tay.

const comp = (value: number | null) => ({ value, weight: 0.3, scaled: value, share: 0.3 });
const pick = (id: string): AssignPlanPick => ({
  user: { id, name: `Người ${id}`, avatarUrl: null },
  score: 70,
  rawScore: 60,
  confidence: 0.6,
  confidenceLevel: 'GOOD',
  components: { experience: comp(0.5), reliability: comp(0.5), availability: comp(0.5), declared: comp(0.5) },
  load: 1,
  capacity: 5,
  flags: [],
});
const rank = (userId: string, over: Partial<AssignPlanRanking> = {}): AssignPlanRanking => ({
  userId,
  rank: 1,
  score: 70,
  load: 1,
  capacity: 5,
  flags: [],
  ...over,
});
const row = (id: string, over: Partial<AssignPlanRow> = {}): AssignPlanRow => ({
  order: 1,
  card: { id, title: `Thẻ ${id}`, startDate: null, dueDate: null },
  assignee: pick('u1'),
  ranking: [rank('u1'), rank('u2', { rank: 2 })],
  ...over,
});
const person = (id: string, capacity: number, openCards: number): AssignPlanPerson => ({
  user: { id, name: `Người ${id}`, avatarUrl: null },
  capacity,
  openCards,
  paused: false,
});

describe('initialPicks / initialIncluded', () => {
  it('lựa chọn ban đầu = gợi ý của máy chủ; thẻ không ai đủ điều kiện để trống và không được tick', () => {
    const rows = [row('a'), row('b', { assignee: null }), row('c', { assignee: pick('u2') })];
    expect(initialPicks(rows)).toEqual({ a: 'u1', b: null, c: 'u2' });
    expect(initialIncluded(rows)).toEqual({ a: true, b: false, c: true });
    expect(initialPicks([])).toEqual({});
    expect(initialIncluded([])).toEqual({});
  });
});

describe('selectedRows', () => {
  const rows = [row('a'), row('b'), row('c'), row('d')];

  it('chỉ lấy thẻ ĐÃ TICK và CÓ người được chọn, theo thứ tự xử lý của máy chủ (không theo thứ tự khoá)', () => {
    const picks = { d: 'u2', c: null, b: 'u2', a: 'u1' };
    expect(selectedRows(rows, picks, { a: true, b: false, c: true, d: true })).toEqual([
      { cardId: 'a', userId: 'u1' },
      { cardId: 'd', userId: 'u2' },
    ]);
    expect(selectedRows(rows, picks, { a: true, b: true, c: true, d: true }).map((s) => s.cardId)).toEqual(['a', 'b', 'd']);
    expect(selectedRows(rows, picks, {})).toEqual([]);
    expect(selectedRows([], picks, { a: true })).toEqual([]);
  });

  it('bỏ thẻ đã giao xong ở lần trước; chuỗi rỗng và thẻ thiếu trong lựa chọn cũng coi là chưa chọn người', () => {
    const picks = { a: 'u1', b: 'u2', c: '' };
    const included = { a: true, b: true, c: true, d: true };
    expect(selectedRows(rows, picks, included, new Set(['a'])).map((s) => s.cardId)).toEqual(['b']);
    expect(selectedRows(rows, picks, included).map((s) => s.cardId)).toEqual(['a', 'b']);
  });
});

describe('distribution', () => {
  it('mỗi người nhận thêm bao nhiêu thẻ, tổng thẻ đang mở, và vượt sức chứa khi tổng > sức chứa (bằng sức chứa chưa là vượt)', () => {
    const people = [person('u1', 3, 2), person('u2', 5, 0), person('u3', 4, 4)];
    const sel = [
      { cardId: 'a', userId: 'u1' },
      { cardId: 'b', userId: 'u1' },
      { cardId: 'c', userId: 'u2' },
    ];
    const d = distribution(people, sel);
    expect(d.map((x) => [x.added, x.total, x.over])).toEqual([
      [2, 4, true], // 2 + 2 = 4 > 3
      [1, 1, false],
      [0, 4, false], // 4 = sức chứa 4: đầy nhưng chưa vượt
    ]);
    expect(distribution(people, [{ cardId: 'a', userId: 'u1' }]).map((x) => x.over)).toEqual([false, false, false]); // 2 + 1 = 3 = sức chứa
    expect(d[0]!.person).toBe(people[0]);
  });

  it('người lạ trong lựa chọn không làm hỏng; không có ai / không có lựa chọn', () => {
    expect(distribution([person('u1', 5, 1)], [{ cardId: 'a', userId: 'ghost' }])[0]).toMatchObject({ added: 0, total: 1, over: false });
    expect(distribution([], [{ cardId: 'a', userId: 'u1' }])).toEqual([]);
  });
});

describe('rowWarning', () => {
  it('cảnh báo theo xếp hạng của CHÍNH thẻ đó: quá tải, tạm nghỉ, hoặc cả hai; cờ khác không cảnh báo', () => {
    const r = row('a', {
      ranking: [
        rank('u1', { flags: ['OVERLOADED'], load: 5, capacity: 5 }),
        rank('u2', { flags: ['PAUSED'] }),
        rank('u3', { flags: ['OVERLOADED', 'PAUSED'], load: 6, capacity: 4 }),
        rank('u4', { flags: ['NO_HISTORY', 'NO_SIMILAR'] }),
        rank('u5'),
      ],
    });
    expect(rowWarning(r, 'u1', 'An')).toBe('An đang quá tải (5/5 thẻ chồng lấn).');
    expect(rowWarning(r, 'u2', 'Bình')).toBe('Bình đang tạm nghỉ.');
    expect(rowWarning(r, 'u3', 'Chi')).toBe('Chi đang tạm nghỉ và đang quá tải (6/4 thẻ chồng lấn).');
    expect(rowWarning(r, 'u4', 'Dũng')).toBeNull();
    expect(rowWarning(r, 'u5', 'Em')).toBeNull();
  });

  it('không có người được chọn, hoặc người đó không nằm trong xếp hạng -> không cảnh báo', () => {
    const r = row('a', { ranking: [rank('u1', { flags: ['PAUSED'] })] });
    expect(rowWarning(r, null, 'An')).toBeNull();
    expect(rowWarning(r, 'ghost', 'An')).toBeNull();
  });
});

describe('optionLabel', () => {
  it('tên + điểm tương đối làm tròn + cờ tạm nghỉ / quá tải (thứ tự cố định); chưa có điểm -> "chưa đủ dữ liệu"', () => {
    expect(optionLabel('Lan', rank('u1', { score: 70.6 }))).toBe('Lan — phù hợp 71');
    expect(optionLabel('Lan', rank('u1', { score: 70.4 }))).toBe('Lan — phù hợp 70');
    expect(optionLabel('Lan', rank('u1', { score: null }))).toBe('Lan — chưa đủ dữ liệu');
    expect(optionLabel('Lan', rank('u1', { score: 50, flags: ['OVERLOADED', 'PAUSED'] }))).toBe('Lan — phù hợp 50 · tạm nghỉ · quá tải');
    expect(optionLabel('Lan', rank('u1', { score: 0, flags: ['NO_HISTORY'] }))).toBe('Lan — phù hợp 0');
  });
});

describe('applySelection', () => {
  const sel = [
    { cardId: 'a', userId: 'u1' },
    { cardId: 'b', userId: 'u2' },
    { cardId: 'c', userId: 'u1' },
  ];

  it('giao TUẦN TỰ theo thứ tự, không bao giờ hai yêu cầu cùng lúc', async () => {
    const calls: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const add = async (cardId: string, userId: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      await Promise.resolve();
      calls.push(`${cardId}:${userId}`);
      inFlight -= 1;
    };
    const doneOrder: string[] = [];
    const result = await applySelection(sel, add, String, (id) => doneOrder.push(id));
    expect(calls).toEqual(['a:u1', 'b:u2', 'c:u1']);
    expect(maxInFlight).toBe(1);
    expect(result).toEqual({ done: ['a', 'b', 'c'], failed: [] });
    expect(doneOrder).toEqual(['a', 'b', 'c']);
  });

  it('một thẻ lỗi không chặn các thẻ còn lại; thẻ lỗi được báo riêng kèm thông điệp', async () => {
    const add = async (cardId: string) => {
      if (cardId === 'b') throw new Error('người này đã rời bảng');
    };
    const doneOrder: string[] = [];
    const result = await applySelection(sel, add, (e) => (e as Error).message, (id) => doneOrder.push(id));
    expect(result.done).toEqual(['a', 'c']);
    expect(result.failed).toEqual([{ cardId: 'b', message: 'người này đã rời bảng' }]);
    expect(doneOrder).toEqual(['a', 'c']); // thẻ lỗi không được báo là xong
  });

  it('không có gì để giao -> không gọi gì', async () => {
    let calls = 0;
    const result = await applySelection([], async () => void (calls += 1), String);
    expect(calls).toBe(0);
    expect(result).toEqual({ done: [], failed: [] });
  });
});
