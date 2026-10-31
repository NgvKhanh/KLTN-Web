// Buoc 6 module canh bao tre han: luat bao (RISK_MODULE.md §8.3), loc ket qua cu (§8.2), chuyen dong CSDL -> lich su. Test THUAN.
import { describe, expect, it } from 'vitest';
import { decideNotify, isRiskFresh, OVERDUE_SILENT_MS, type PreviousRisk } from '../src/modules/risk/risk.decide';
import { levelOf } from '../src/modules/risk/risk.levels';
import { toRiskHistory, type ActivityRow, type CardRow } from '../src/modules/risk/risk.repo';
import { loadScorer } from '../src/modules/risk/risk.service';
import { RULES_VERSION } from '../src/modules/risk/risk.explain';

const due = new Date('2026-11-10T10:00:00.000Z');
const before = new Date('2026-11-08T10:00:00.000Z');
const cur = (score: number) => ({ score, level: levelOf(score) });
const prev = (score: number, notifiedLevel: PreviousRisk['notifiedLevel'], dueDateUsed = due): PreviousRisk => ({ level: levelOf(score), notifiedLevel, dueDateUsed });
const ctx = { dueDate: due, now: before, bootstrap: false };

// 30/10: thong bao khong noi muc - chi "co nguy co tre han" (1 lan) va "da tre han" (1 lan); notifiedLevel = moc da bao
describe('decideNotify', () => {
  const justLate = new Date(due.getTime() + 60_000);

  it('lần đầu chấm, chưa quá hạn: ≥ 51 thì báo nguy cơ (mốc WARNING, kể cả điểm Nguy cấp); < 51 thì không; luôn là "đổi mức"', () => {
    expect(decideNotify(null, cur(51), ctx)).toEqual({ notify: true, kind: 'risk', notifiedLevel: 'WARNING', levelChanged: true });
    expect(decideNotify(null, cur(50), ctx)).toEqual({ notify: false, kind: null, notifiedLevel: null, levelChanged: true });
    expect(decideNotify(null, cur(90), ctx)).toEqual({ notify: true, kind: 'risk', notifiedLevel: 'WARNING', levelChanged: true });
  });

  it('đã báo nguy cơ: lên Nguy cấp KHÔNG báo thêm (sẽ trùng câu), giữ mốc WARNING', () => {
    expect(decideNotify(prev(60, 'WARNING'), cur(70), ctx)).toEqual({ notify: false, kind: null, notifiedLevel: 'WARNING', levelChanged: false });
    expect(decideNotify(prev(70, 'WARNING'), cur(80), ctx)).toEqual({ notify: false, kind: null, notifiedLevel: 'WARNING', levelChanged: true });
    expect(decideNotify(prev(80, 'WARNING'), cur(95), ctx).notify).toBe(false);
  });

  it('vừa quá hạn: báo "đã trễ hạn" (kể cả đã báo nguy cơ, kể cả chưa báo gì), mốc CRITICAL; lần sau không báo lại', () => {
    expect(decideNotify(prev(70, 'WARNING'), cur(100), { ...ctx, now: justLate })).toEqual({ notify: true, kind: 'overdue', notifiedLevel: 'CRITICAL', levelChanged: true });
    expect(decideNotify(prev(20, null), cur(100), { ...ctx, now: justLate })).toMatchObject({ notify: true, kind: 'overdue' });
    expect(decideNotify(prev(100, 'CRITICAL'), cur(100), { ...ctx, now: justLate })).toEqual({ notify: false, kind: null, notifiedLevel: 'CRITICAL', levelChanged: false });
  });

  it('đúng lúc hạn chưa là quá hạn (cùng điều kiện isOverdue: hạn < t)', () => {
    expect(decideNotify(prev(60, 'WARNING'), cur(100), { ...ctx, now: new Date(due) })).toMatchObject({ notify: false, notifiedLevel: 'WARNING' });
  });

  it('vùng đệm: xuống 41–50 giữ mốc đã báo; xuống ≤ 40 mới đặt lại', () => {
    const mid = decideNotify(prev(60, 'WARNING'), cur(41), ctx);
    expect(mid).toEqual({ notify: false, kind: null, notifiedLevel: 'WARNING', levelChanged: true });
    expect(decideNotify(prev(41, 'WARNING'), cur(55), ctx).notify).toBe(false);
    const low = decideNotify(prev(60, 'WARNING'), cur(40), ctx);
    expect(low.notifiedLevel).toBeNull();
    expect(decideNotify(prev(40, null), cur(55), ctx).notify).toBe(true);
  });

  it('mốc không đi xuống khi chưa đặt lại: đã báo trễ hạn mà điểm còn 60 → không báo nguy cơ nữa', () => {
    expect(decideNotify(prev(100, 'CRITICAL'), cur(60), ctx)).toEqual({ notify: false, kind: null, notifiedLevel: 'CRITICAL', levelChanged: true });
  });

  it('đổi hạn → đặt lại mốc đã báo (tình huống mới)', () => {
    const moved = new Date('2026-11-15T10:00:00.000Z');
    expect(decideNotify(prev(60, 'WARNING'), cur(60), { ...ctx, dueDate: moved })).toEqual({ notify: true, kind: 'risk', notifiedLevel: 'WARNING', levelChanged: false });
  });

  it('lần quét đầu tiên: ghi nhận mốc nhưng KHÔNG gửi (chưa quá hạn → WARNING, quá hạn → CRITICAL)', () => {
    expect(decideNotify(null, cur(80), { ...ctx, bootstrap: true })).toEqual({ notify: false, kind: null, notifiedLevel: 'WARNING', levelChanged: true });
    expect(decideNotify(null, cur(100), { ...ctx, now: justLate, bootstrap: true })).toEqual({ notify: false, kind: null, notifiedLevel: 'CRITICAL', levelChanged: true });
  });

  it('quá hạn ≥ 24 giờ: im lặng (ghi nhận mốc); quá hạn < 24 giờ: vẫn báo "đã trễ hạn"', () => {
    const late = new Date(due.getTime() + OVERDUE_SILENT_MS);
    expect(decideNotify(null, cur(100), { ...ctx, now: late })).toEqual({ notify: false, kind: null, notifiedLevel: 'CRITICAL', levelChanged: true });
    const almost = new Date(due.getTime() + OVERDUE_SILENT_MS - 1);
    expect(decideNotify(null, cur(100), { ...ctx, now: almost })).toMatchObject({ notify: true, kind: 'overdue' });
  });
});

describe('isRiskFresh', () => {
  const r = { dueDateUsed: due };
  it('chỉ còn hiệu lực khi thẻ chưa xong, chưa lưu trữ, hạn không đổi', () => {
    expect(isRiskFresh(r, { isDone: false, dueDate: new Date(due) })).toBe(true);
    expect(isRiskFresh(null, { isDone: false, dueDate: due })).toBe(false);
    expect(isRiskFresh(r, { isDone: true, dueDate: due })).toBe(false);
    expect(isRiskFresh(r, { isDone: false, dueDate: due, archivedAt: new Date() })).toBe(false);
    expect(isRiskFresh(r, { isDone: false, dueDate: null })).toBe(false);
    expect(isRiskFresh(r, { isDone: false, dueDate: new Date(due.getTime() + 1) })).toBe(false);
  });
});

describe('toRiskHistory - chuyển dòng CSDL + nhật ký', () => {
  const at = (h: number) => new Date(Date.parse('2026-10-01T00:00:00.000Z') + h * 3_600_000);
  const row = (over: Partial<CardRow> = {}): CardRow => ({
    id: 'c', title: 'T', description: null, createdAt: at(0), startDate: null, dueDate: at(100), status: 'IN_PROGRESS', completedAt: null,
    storyPoints: 3, members: [{ userId: 'u', createdAt: at(1) }],
    checklists: [{ items: [{ createdAt: at(0), isDone: true, completedAt: at(5) }] }, { items: [{ createdAt: at(2), isDone: false, completedAt: null }] }],
    ...over,
  });
  const act = (h: number, type: string, data: unknown): ActivityRow => ({ type, data, createdAt: at(h) });

  it('dựng dòng thời gian trạng thái + hạn hợp lệ; mọi dòng nhật ký là một sự kiện hoạt động (đã sắp)', () => {
    const h = toRiskHistory(row(), [
      act(10, 'card.due.set', { from: at(80).toISOString(), to: at(100).toISOString(), dueDate: at(100).toISOString() }),
      act(3, 'card.status', { from: 'TODO', to: 'IN_PROGRESS' }),
      act(0, 'card.create', { listName: 'Cần làm' }),
      act(4, 'comment.create', { text: 'x' }),
    ]);
    expect(h.statusEvents).toEqual([{ at: at(3), from: 'TODO', to: 'IN_PROGRESS' }]);
    expect(h.dueEvents).toEqual([{ at: at(10), from: at(80), to: at(100) }]);
    expect(h.activityAt).toEqual([at(0), at(3), at(4), at(10)]);
    expect(h.checklist).toHaveLength(2);
    expect(h.members).toEqual([{ userId: 'u', createdAt: at(1) }]);
    expect(h.status).toBe('IN_PROGRESS');
  });

  it('nhật ký cũ thiếu trường / giá trị lạ: bỏ qua sự kiện, vẫn tính là hoạt động', () => {
    const h = toRiskHistory(row({ status: 'TODO', dueDate: at(100) }), [
      act(1, 'card.done', {}),
      act(2, 'card.status', { from: 'TODO', to: 'WAITING' }),
      act(3, 'card.due.set', { dueDate: at(100).toISOString() }),
      act(4, 'card.due.set', { from: 'khong phai ngay', to: at(100).toISOString() }),
      act(5, 'card.status', { from: 'TODO', to: 'TODO' }),
    ]);
    expect(h.statusEvents).toEqual([]);
    expect(h.dueEvents).toEqual([]);
    expect(h.activityAt).toHaveLength(5);
  });

  it('bỏ hạn: to = null hợp lệ', () => {
    const h = toRiskHistory(row({ dueDate: null }), [act(6, 'card.due.clear', { from: at(50).toISOString(), to: null })]);
    expect(h.dueEvents).toEqual([{ at: at(6), from: at(50), to: null }]);
  });

  it('dòng thời gian không khớp giá trị hiện tại → bỏ cả dòng thời gian đó', () => {
    const h = toRiskHistory(row({ status: 'BLOCKED', dueDate: at(120) }), [
      act(3, 'card.status', { from: 'TODO', to: 'IN_PROGRESS' }), // hien tai la BLOCKED -> lech
      act(10, 'card.due.set', { from: at(80).toISOString(), to: at(100).toISOString() }), // hien tai 120 -> lech
    ]);
    expect(h.statusEvents).toEqual([]);
    expect(h.dueEvents).toEqual([]);
    expect(h.status).toBe('BLOCKED');
  });

  it('trạng thái hiện tại lạ → TODO', () => {
    expect(toRiskHistory(row({ status: 'XYZ' }), []).status).toBe('TODO');
  });
});

describe('loadScorer', () => {
  it('tệp mô hình đang dùng (v3 — 4 yếu tố, từ bước 18) nạp được', () => {
    const s = loadScorer();
    expect(s.version).toBe('logreg-v3');
  });
  it('tệp hỏng → luật cố định (không ném lỗi)', () => {
    const errors: unknown[] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => errors.push(a);
    try {
      expect(loadScorer({ version: 'x' }).version).toBe(RULES_VERSION);
    } finally {
      console.error = orig;
    }
    expect(errors).toHaveLength(1);
  });
});
