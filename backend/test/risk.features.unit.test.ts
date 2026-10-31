// Buoc 2 module canh bao tre han (RISK_MODULE.md §5): dung lai the luc t + 15 dac trung. Test THUAN (khong CSDL).
import { describe, expect, it } from 'vitest';
import {
  DAY_MS,
  blockedDaysBetween,
  checklistAt,
  dueAt,
  isDoneAt,
  isOpenAt,
  outcomeAt,
  startAt,
  statusAt,
  statusBeforeBlockAt,
  type RiskCardHistory,
  type RiskStatus,
} from '../src/modules/risk/risk.history';
import {
  FEATURE_NAMES,
  HIDDEN_FEATURES,
  buildRiskContext,
  estimatePoints,
  extractFeatures,
  type RiskPriors,
} from '../src/modules/risk/risk.features';

const T0 = Date.parse('2026-03-01T00:00:00.000Z');
const day = (d: number) => new Date(T0 + d * DAY_MS);
const PRIORS: RiskPriors = { lateRate: 0.35, daysPerPoint: 2 };

function card(over: Partial<RiskCardHistory> & { id: string }): RiskCardHistory {
  return {
    title: over.id,
    description: null,
    createdAt: day(0),
    startDate: null,
    dueDate: null,
    status: 'TODO',
    completedAt: null,
    storyPoints: null,
    members: [],
    statusEvents: [],
    dueEvents: [],
    checklist: [],
    activityAt: [],
    ...over,
  };
}
const ev = (d: number, from: RiskStatus, to: RiskStatus) => ({ at: day(d), from, to });

describe('estimatePoints - đúng ranh giới §5.3 (3)', () => {
  it.each([
    [0, 3], [1, 1], [2, 1], [3, 2], [4, 2], [5, 3], [7, 3], [8, 5], [12, 5], [13, 8], [40, 8],
  ])('%i mục → %i điểm', (n, p) => expect(estimatePoints(n)).toBe(p));
});

describe('dueAt - hạn có hiệu lực lúc t', () => {
  const c = card({
    id: 'c',
    dueDate: day(20),
    dueEvents: [
      { at: day(2), from: null, to: day(10) },
      { at: day(8), from: day(10), to: day(20) },
    ],
  });
  it('trước lần đặt hạn đầu → from của lần đầu (null)', () => expect(dueAt(c, day(1))).toBeNull());
  it('giữa hai lần → to của lần trước', () => expect(dueAt(c, day(5))).toEqual(day(10)));
  it('đúng lúc đổi hạn → giá trị mới', () => expect(dueAt(c, day(8))).toEqual(day(20)));
  it('sau lần cuối → hạn hiện tại', () => expect(dueAt(c, day(30))).toEqual(day(20)));
  it('không có sự kiện → hạn hiện tại', () => expect(dueAt(card({ id: 'x', dueDate: day(3) }), day(0))).toEqual(day(3)));
  it('bỏ hạn sau t: lúc t vẫn còn hạn cũ', () => {
    const cleared = card({ id: 'y', dueDate: null, dueEvents: [{ at: day(4), from: day(9), to: null }] });
    expect(dueAt(cleared, day(3))).toEqual(day(9));
    expect(dueAt(cleared, day(5))).toBeNull();
  });
});

describe('trạng thái lúc t', () => {
  const c = card({
    id: 'c',
    status: 'DONE',
    completedAt: day(9),
    statusEvents: [ev(1, 'TODO', 'IN_PROGRESS'), ev(3, 'IN_PROGRESS', 'DONE'), ev(4, 'DONE', 'IN_PROGRESS'), ev(5, 'IN_PROGRESS', 'BLOCKED'), ev(7, 'BLOCKED', 'IN_REVIEW'), ev(9, 'IN_REVIEW', 'DONE')],
  });
  it('dựng đúng từng khoảng, kể cả lần xong rồi mở lại', () => {
    expect(statusAt(c, day(0))).toBe('TODO');
    expect(statusAt(c, day(2))).toBe('IN_PROGRESS');
    expect(isDoneAt(c, day(3.5))).toBe(true);
    expect(isOpenAt(c, day(3.5))).toBe(false);
    expect(isOpenAt(c, day(4.5))).toBe(true);
    expect(statusAt(c, day(6))).toBe('BLOCKED');
    expect(statusBeforeBlockAt(c, day(6))).toBe('IN_PROGRESS');
    expect(statusAt(c, day(8))).toBe('IN_REVIEW');
    expect(isDoneAt(c, day(9))).toBe(true);
  });
  it('thiếu nhật ký trạng thái: dùng completedAt; trạng thái hiện tại DONE mà còn mở lúc t → IN_PROGRESS', () => {
    const bare = card({ id: 'b', status: 'DONE', completedAt: day(6) });
    expect(isOpenAt(bare, day(5))).toBe(true);
    expect(statusAt(bare, day(5))).toBe('IN_PROGRESS');
    expect(isDoneAt(bare, day(6))).toBe(true);
  });
  it('chưa tạo lúc t → không mở', () => expect(isOpenAt(card({ id: 'z', createdAt: day(3) }), day(2))).toBe(false));
  it('thời gian bị chặn: khoảng đã xong + khoảng đang dở', () => {
    expect(blockedDaysBetween(c, day(0), day(9))).toBeCloseTo(2, 12);
    expect(blockedDaysBetween(c, day(0), day(6))).toBeCloseTo(1, 12);
    expect(blockedDaysBetween(c, day(6), day(6.5))).toBeCloseTo(0.5, 12);
    expect(blockedDaysBetween(c, day(5), day(5))).toBe(0);
  });
  it('bị chặn khi chưa có trạng thái trước → TODO', () => {
    const b = card({ id: 'b2', statusEvents: [ev(2, 'TODO', 'BLOCKED')] });
    expect(statusBeforeBlockAt(b, day(3))).toBe('TODO');
  });
});

describe('checklistAt - live đọc isDone, replay chỉ tin mốc tick', () => {
  const c = card({
    id: 'c',
    checklist: [
      { createdAt: day(0), isDone: true, completedAt: day(2) },
      { createdAt: day(0), isDone: true, completedAt: null }, // du lieu cu, khong ro luc tick
      { createdAt: day(0), isDone: false, completedAt: null },
      { createdAt: day(5), isDone: true, completedAt: day(6) }, // tao sau t
    ],
  });
  it('replay lúc ngày 3: bỏ mục không rõ mốc, bỏ mục tạo sau t', () => expect(checklistAt(c, day(3), 'replay')).toEqual({ done: 1, total: 2 }));
  it('replay lúc ngày 1: mục tick ở ngày 2 tính là CHƯA xong', () => expect(checklistAt(c, day(1), 'replay')).toEqual({ done: 0, total: 2 }));
  it('live: đọc isDone của mọi mục đã tạo', () => expect(checklistAt(c, day(3), 'live')).toEqual({ done: 2, total: 3 }));
});

describe('outcomeAt - kết quả của thẻ khác lúc t', () => {
  it('xong sau hạn có hiệu lực LÚC XONG → trễ; xong trước → đúng hạn', () => {
    const late = card({ id: 'l', dueDate: day(10), status: 'DONE', completedAt: day(12) });
    expect(outcomeAt(late, day(20))).toEqual({ late: true, at: day(12) });
    const ok = card({ id: 'o', dueDate: day(10), status: 'DONE', completedAt: day(10) });
    expect(outcomeAt(ok, day(20))).toEqual({ late: false, at: day(10) });
  });
  it('lùi hạn trước khi xong: so với hạn mới', () => {
    const moved = card({ id: 'm', dueDate: day(15), status: 'DONE', completedAt: day(12), dueEvents: [{ at: day(9), from: day(10), to: day(15) }] });
    expect(outcomeAt(moved, day(20))!.late).toBe(false);
  });
  it('còn mở mà đã quá hạn → trễ, mốc = hạn; chưa quá hạn → chưa có kết quả', () => {
    const open = card({ id: 'p', dueDate: day(5) });
    expect(outcomeAt(open, day(8))).toEqual({ late: true, at: day(5) });
    expect(outcomeAt(open, day(4))).toBeNull();
  });
  it('không có hạn / xong sau t → null', () => {
    expect(outcomeAt(card({ id: 'n', status: 'DONE', completedAt: day(2) }), day(5))).toBeNull();
    expect(outcomeAt(card({ id: 'f', dueDate: day(30), status: 'DONE', completedAt: day(9) }), day(5))).toBeNull();
  });
});

describe('startAt', () => {
  it('ưu tiên startDate (kể cả sau t), rồi người được giao đầu tiên ≤ t, rồi lúc tạo', () => {
    expect(startAt(card({ id: 'a', startDate: day(9) }), day(3))).toEqual(day(9));
    const m = card({ id: 'b', createdAt: day(1), members: [{ userId: 'u2', createdAt: day(4) }, { userId: 'u1', createdAt: day(2) }] });
    expect(startAt(m, day(3))).toEqual(day(2));
    expect(startAt(m, day(1.5))).toEqual(day(1));
  });
});

// ---------- Vi du tinh tay du 15 dac trung (RISK_MODULE.md §5.3) ----------
function world() {
  const H1 = card({
    id: 'h1', title: 'Thiết kế slide', storyPoints: 2, dueDate: day(10), status: 'DONE', completedAt: day(12),
    members: [{ userId: 'u1', createdAt: day(0) }], statusEvents: [ev(1, 'TODO', 'IN_PROGRESS'), ev(12, 'IN_PROGRESS', 'DONE')],
  });
  const H2 = card({
    id: 'h2', title: 'Viết kịch bản dẫn chương trình', storyPoints: 5, dueDate: day(20), status: 'DONE', completedAt: day(15),
    members: [{ userId: 'u1', createdAt: day(0) }], statusEvents: [ev(15, 'TODO', 'DONE')],
  });
  const H3 = card({
    id: 'h3', title: 'In poster quảng bá', dueDate: day(5), status: 'IN_PROGRESS',
    members: [{ userId: 'u2', createdAt: day(0) }], statusEvents: [ev(1, 'TODO', 'IN_PROGRESS')],
  });
  const H4 = card({
    id: 'h4', title: 'Đặt phòng hội trường', storyPoints: 1, dueDate: day(10), status: 'DONE', completedAt: day(4),
    members: [{ userId: 'u2', createdAt: day(2) }], statusEvents: [ev(4, 'TODO', 'DONE')],
  });
  const C = card({
    id: 'c', title: 'Thiết kế slide', createdAt: day(25), dueDate: day(36), status: 'BLOCKED',
    members: [{ userId: 'u1', createdAt: day(26) }],
    statusEvents: [ev(27, 'TODO', 'IN_PROGRESS'), ev(29, 'IN_PROGRESS', 'BLOCKED')],
    checklist: [
      { createdAt: day(25), isDone: true, completedAt: day(27) },
      { createdAt: day(25), isDone: true, completedAt: day(28) },
      { createdAt: day(25), isDone: false, completedAt: null },
      { createdAt: day(25), isDone: false, completedAt: null },
    ],
    activityAt: [day(25), day(26), day(27), day(29)],
  });
  return { H1, H2, H3, H4, C, all: [H1, H2, H3, H4, C] };
}

describe('extractFeatures - ví dụ tính tay', () => {
  const { C, all } = world();
  const t = day(30);
  const w = (ageDays: number) => Math.pow(0.5, ageDays / 90);
  // ket qua luc ngay 30: H1 tre (xong ngay 12), H2 dung han (ngay 15), H3 con mo qua han (han ngay 5), H4 dung han (ngay 4)
  const w1 = w(18), w2 = w(15), w3 = w(25), w4 = w(26);
  const mu = (w1 + w3) / (w1 + w2 + w3 + w4);
  // ngay / diem: H1 12/2 = 6, H2 15/5 = 3 (u1 tu ngay 0); H4 tu luc giao u2 (ngay 2) toi ngay 4 = 2/1 = 2
  const wsDpp = (w1 * 6 + w2 * 3 + w4 * 2) / (w1 + w2 + w4);
  const u1Late = (w1 * 1 + 3 * mu) / (w1 + w2 + 3);
  const u1Dpp = (w1 * 6 + w2 * 3 + 3 * wsDpp) / (w1 + w2 + 3);
  const ctx = buildRiskContext(all, t, PRIORS, 'live');
  const f = extractFeatures(C, ctx)!;

  it('bối cảnh không gian: mu và ngày/điểm trung bình', () => {
    expect(ctx.workspaceLateRate).toBeCloseTo(mu, 12);
    expect(ctx.workspaceDaysPerPoint).toBeCloseTo(wsDpp, 12);
  });

  it('đủ 15 đặc trưng đúng thứ tự FEATURE_NAMES', () => {
    expect(f.vector).toHaveLength(15);
    expect(f.vector).toEqual(FEATURE_NAMES.map((n) => f.values[n]));
  });

  it('(1)-(6): tiến độ, thời gian, điểm, subtask, bị chặn', () => {
    // S = ngay 26 (giao nguoi dau tien), han ngay 36 -> ky vong 0,4; checklist 2/4 = 0,5
    expect(f.detail.expectedProgress).toBeCloseTo(0.4, 12);
    expect(f.detail.actualProgress).toBe(0.5);
    expect(f.detail.progressSource).toBe('CHECKLIST');
    expect(f.values.progressGap).toBeCloseTo(-0.1, 12);
    expect(f.values.logDaysLeft).toBeCloseTo(Math.log(7), 12);
    expect(f.values.log2Points).toBe(1); // khong nhap -> 4 muc -> 2 diem
    expect(f.values.pointsEstimated).toBe(1);
    expect(f.values.logSubtasksDone).toBeCloseTo(Math.log(3), 12);
    expect(f.values.logSubtasksLeft).toBeCloseTo(Math.log(3), 12);
    expect(f.values.blocked).toBe(1);
    expect(f.values.logBlockedDays).toBeCloseTo(Math.log(2), 12);
  });

  it('(7)(8): người được giao co về trung bình nhóm, tốc độ, nhịp cần thiết', () => {
    expect(f.values.assigneeLateRate).toBeCloseTo(u1Late, 12);
    expect(f.values.noAssignee).toBe(0);
    expect(f.values.logDaysPerPoint).toBeCloseTo(Math.log1p(u1Dpp), 12);
    expect(f.detail.needDays).toBeCloseTo(u1Dpp * 2 * 0.5, 12);
    expect(f.values.paceRatio).toBeCloseTo(Math.log((u1Dpp + 0.25) / (6 + 0.25)), 12);
    expect(f.detail.assignees).toEqual([
      expect.objectContaining({ userId: 'u1', outcomeCount: 2, lateCount: 1, doneCount: 2 }),
    ]);
  });

  it('(9): chỉ thẻ trùng tiêu đề là tương tự (độ giống 1)', () => {
    expect(f.detail.similar.count).toBe(1);
    expect(f.detail.similar.lateCount).toBe(1);
    expect(f.values.similarLateRate).toBeCloseTo((1 + 3 * mu) / (1 + 3), 9);
  });

  it('(10): tần suất hoạt động gồm cả lần tick checklist', () => {
    // su kien <= ngay 30: 25, 26, 27, 29 (nhat ky) + 27, 28 (tick) -> gan nhat ngay 29
    expect(f.detail.daysSinceActivity).toBeCloseTo(1, 12);
    expect(f.detail.events7d).toBe(6);
    expect(f.values.logEvents7d).toBeCloseTo(Math.log(7), 12);
  });

  it('chưa ai nhận: (7)(8) bằng đúng trung bình nhóm, noAssignee = 1', () => {
    const lone = { ...C, id: 'lone', members: [] };
    const g = extractFeatures(lone, buildRiskContext([...all, lone], t, PRIORS, 'live'))!;
    expect(g.values.noAssignee).toBe(1);
    expect(g.values.assigneeLateRate).toBeCloseTo(mu, 12);
    expect(g.values.logDaysPerPoint).toBeCloseTo(Math.log1p(wsDpp), 12);
  });

  it('người chưa có lịch sử: nhận đúng trung bình nhóm', () => {
    const fresh = { ...C, id: 'fresh', members: [{ userId: 'newbie', createdAt: day(26) }] };
    const g = extractFeatures(fresh, buildRiskContext([...all, fresh], t, PRIORS, 'live'))!;
    expect(g.values.assigneeLateRate).toBeCloseTo(mu, 12);
    expect(g.values.logDaysPerPoint).toBeCloseTo(Math.log1p(wsDpp), 12);
  });

  it('không gian chưa có thẻ nào có kết quả → dùng priors', () => {
    const solo = buildRiskContext([C], t, PRIORS, 'live');
    expect(solo.workspaceLateRate).toBe(PRIORS.lateRate);
    expect(solo.workspaceDaysPerPoint).toBe(PRIORS.daysPerPoint);
  });

  it('không có checklist: tiến độ theo trạng thái; Chờ duyệt ≥ 0,9; bị chặn lấy trạng thái trước khi chặn', () => {
    const base = { ...C, checklist: [] };
    const blocked = extractFeatures(base, buildRiskContext(all, t, PRIORS, 'live'))!;
    expect(blocked.detail.progressSource).toBe('STATUS');
    expect(blocked.detail.actualProgress).toBe(0.5); // truoc khi chan la IN_PROGRESS
    expect(blocked.values.log2Points).toBeCloseTo(Math.log2(3), 12); // 0 muc -> 3 diem
    const review = { ...base, statusEvents: [ev(27, 'TODO', 'IN_REVIEW')], status: 'IN_REVIEW' as const };
    expect(extractFeatures(review, buildRiskContext(all, t, PRIORS, 'live'))!.detail.actualProgress).toBe(0.9);
    const reviewLowChecklist = { ...C, statusEvents: [ev(27, 'TODO', 'IN_REVIEW')], status: 'IN_REVIEW' as const };
    expect(extractFeatures(reviewLowChecklist, buildRiskContext(all, t, PRIORS, 'live'))!.detail.actualProgress).toBe(0.9);
  });

  it('story point đã nhập → không ước lượng', () => {
    const sp = { ...C, storyPoints: 8 };
    const g = extractFeatures(sp, buildRiskContext(all, t, PRIORS, 'live'))!;
    expect(g.values.log2Points).toBe(3);
    expect(g.values.pointsEstimated).toBe(0);
  });

  it('không chấm: chưa tạo, đã xong, không có hạn', () => {
    expect(extractFeatures(C, buildRiskContext(all, day(20), PRIORS))).toBeNull();
    const { H1 } = world();
    expect(extractFeatures(H1, buildRiskContext(all, day(20), PRIORS))).toBeNull();
    const noDue = { ...C, dueDate: null };
    expect(extractFeatures(noDue, buildRiskContext(all, t, PRIORS))).toBeNull();
  });

  it('thẻ đã quá hạn vẫn có đặc trưng, daysLeft = 0', () => {
    const g = extractFeatures(C, buildRiskContext(all, day(40), PRIORS, 'live'))!;
    expect(g.detail.daysLeft).toBe(0);
    expect(g.values.logDaysLeft).toBe(0);
  });

  it('kết quả không phụ thuộc thứ tự thẻ đầu vào (so từng bit)', () => {
    const a = extractFeatures(C, buildRiskContext(all, t, PRIORS, 'live'))!;
    for (const perm of [[...all].reverse(), [all[2]!, all[4]!, all[0]!, all[3]!, all[1]!]]) {
      expect(extractFeatures(C, buildRiskContext(perm, t, PRIORS, 'live'))!.vector).toEqual(a.vector);
    }
  });

  it('HIDDEN_FEATURES đúng là hai đặc trưng tần suất hoạt động', () => {
    expect([...HIDDEN_FEATURES].sort()).toEqual(['logDaysSinceActivity', 'logEvents7d']);
    for (const h of HIDDEN_FEATURES) expect(FEATURE_NAMES).toContain(h);
  });

  it('t không hợp lệ → RangeError', () => {
    expect(() => buildRiskContext(all, new Date(Number.NaN), PRIORS)).toThrow(RangeError);
  });
});

// ---------- Ca bien do cai loi lo ra (du lieu mau doi xung khong cham toi) ----------
describe('ca biên', () => {
  it('bị chặn ngay sau khi mở lại từ Xong → tiến độ coi như Đang làm (không phải 1)', () => {
    const c = card({ id: 'r', statusEvents: [ev(1, 'TODO', 'DONE'), ev(2, 'DONE', 'BLOCKED')], status: 'BLOCKED', dueDate: day(10) });
    expect(statusBeforeBlockAt(c, day(3))).toBe('IN_PROGRESS');
    expect(extractFeatures(c, buildRiskContext([c], day(3), PRIORS, 'live'))!.detail.actualProgress).toBe(0.5);
  });

  it('startAt: người được giao sớm nhất dù không đứng đầu mảng', () => {
    const m = card({ id: 'b', members: [{ userId: 'u2', createdAt: day(4) }, { userId: 'u1', createdAt: day(2) }] });
    expect(startAt(m, day(5))).toEqual(day(2));
  });

  it('kết quả so với hạn LÚC XONG, không phải hạn đổi sau khi xong', () => {
    const c = card({ id: 'x', dueDate: day(20), status: 'DONE', completedAt: day(12), dueEvents: [{ at: day(14), from: day(10), to: day(20) }] });
    expect(outcomeAt(c, day(30))).toEqual({ late: true, at: day(12) });
  });

  it('tiến độ kỳ vọng: bắt đầu ≥ hạn → 1; chưa tới ngày bắt đầu → 0; đã quá hạn → 1', () => {
    const inverted = card({ id: 'i', startDate: day(10), dueDate: day(8) });
    expect(extractFeatures(inverted, buildRiskContext([inverted], day(5), PRIORS))!.detail.expectedProgress).toBe(1);
    const future = card({ id: 'f', startDate: day(10), dueDate: day(20) });
    expect(extractFeatures(future, buildRiskContext([future], day(5), PRIORS))!.detail.expectedProgress).toBe(0);
    const over = card({ id: 'o', startDate: day(0), dueDate: day(4) });
    expect(extractFeatures(over, buildRiskContext([over], day(6), PRIORS))!.detail.expectedProgress).toBe(1);
  });

  it('thời gian bị chặn tính từ lúc TẠO thẻ, kể cả trước ngày bắt đầu', () => {
    const c = card({ id: 'k', startDate: day(5), dueDate: day(20), statusEvents: [ev(1, 'TODO', 'BLOCKED'), ev(3, 'BLOCKED', 'TODO')] });
    expect(extractFeatures(c, buildRiskContext([c], day(6), PRIORS))!.detail.blockedDays).toBeCloseTo(2, 12);
  });

  it('không có sự kiện hoạt động nào → số ngày tính từ lúc tạo', () => {
    const c = card({ id: 'q', createdAt: day(3), dueDate: day(20) });
    expect(extractFeatures(c, buildRiskContext([c], day(5), PRIORS))!.detail.daysSinceActivity).toBeCloseTo(2, 12);
  });

  it('cửa sổ 7 ngày mở bên trái: sự kiện đúng t − 7 ngày không tính', () => {
    const c = card({ id: 'w', dueDate: day(30), activityAt: [day(3), day(3.001), day(10)] });
    expect(extractFeatures(c, buildRiskContext([c], day(10), PRIORS))!.detail.events7d).toBe(2);
  });

  // The cu cua nguoi duoc giao: moi the mot y, dung de ep cac nhanh cua phep tinh ngay / diem
  function speedWorld() {
    const lateJoin = card({ // the bat dau ngay 0, u1 vao ngay 6, xong ngay 9 -> toc do CUA u1 = 3 ngay / 3 diem
      id: 'a', startDate: day(0), storyPoints: 3, dueDate: day(20), status: 'DONE', completedAt: day(9),
      members: [{ userId: 'u0', createdAt: day(0) }, { userId: 'u1', createdAt: day(6) }],
    });
    const instant = card({ // xong ngay luc bat dau -> san 0,25 ngay
      id: 'b', storyPoints: 1, dueDate: day(20), status: 'DONE', completedAt: day(2),
      members: [{ userId: 'u2', createdAt: day(2) }],
    });
    const estimated = card({ // khong nhap diem, 8 muc checklist -> 5 diem; 10 ngay -> 2 ngay / diem
      id: 'c', dueDate: day(20), status: 'DONE', completedAt: day(10),
      members: [{ userId: 'u3', createdAt: day(0) }],
      checklist: Array.from({ length: 8 }, () => ({ createdAt: day(0), isDone: true, completedAt: day(5) })),
    });
    const reopened = card({ // xong ngay 4, mo lai ngay 5, con mo va da QUA HAN (co ket qua "tre") -> van khong tinh vao toc do
      id: 'd', storyPoints: 1, dueDate: day(10), status: 'IN_PROGRESS', completedAt: day(4),
      members: [{ userId: 'u4', createdAt: day(0) }],
      statusEvents: [ev(4, 'TODO', 'DONE'), ev(5, 'DONE', 'IN_PROGRESS')],
    });
    return [lateJoin, instant, estimated, reopened];
  }
  const dppOf = (cards: RiskCardHistory[], userId: string) =>
    buildRiskContext(cards, day(12), PRIORS).people.get(userId);

  it('tốc độ người vào thẻ muộn tính từ lúc họ được giao', () => {
    const p = dppOf(speedWorld(), 'u1')!;
    expect(p.dppW / p.dppSumW).toBeCloseTo(1, 12);
    const p0 = dppOf(speedWorld(), 'u0')!;
    expect(p0.dppW / p0.dppSumW).toBeCloseTo(3, 12);
  });

  it('xong ngay lúc bắt đầu → sàn 0,25 ngày', () => {
    const p = dppOf(speedWorld(), 'u2')!;
    expect(p.dppW / p.dppSumW).toBeCloseTo(0.25, 12);
  });

  it('thẻ cũ không nhập điểm: ước lượng từ số mục checklist lúc xong', () => {
    const p = dppOf(speedWorld(), 'u3')!;
    expect(p.dppW / p.dppSumW).toBeCloseTo(2, 12);
  });

  it('thẻ đã mở lại (đang mở, quá hạn) tính là trễ nhưng không góp vào tốc độ', () => {
    const p = dppOf(speedWorld(), 'u4')!;
    expect(p.lateCount).toBe(1);
    expect(p.dppSumW).toBe(0);
  });

  it('nhiều người được giao → lấy TRUNG BÌNH từng người', () => {
    const hist = [
      card({ id: 'h1', dueDate: day(5), status: 'DONE', completedAt: day(8), members: [{ userId: 'u1', createdAt: day(0) }] }),
      card({ id: 'h2', dueDate: day(9), status: 'DONE', completedAt: day(4), members: [{ userId: 'u2', createdAt: day(0) }] }),
    ];
    const target = card({ id: 't', createdAt: day(10), dueDate: day(20), members: [{ userId: 'u1', createdAt: day(10) }, { userId: 'u2', createdAt: day(10) }] });
    const ctx = buildRiskContext([...hist, target], day(11), PRIORS);
    const f = extractFeatures(target, ctx)!;
    const [a, b] = f.detail.assignees;
    expect(f.values.assigneeLateRate).toBeCloseTo((a!.lateRate + b!.lateRate) / 2, 12);
    expect(a!.lateRate).not.toBeCloseTo(b!.lateRate, 3);
    expect(f.values.logDaysPerPoint).toBeCloseTo(Math.log1p((a!.daysPerPoint + b!.daysPerPoint) / 2), 12);
  });

  it('thẻ tương tự: tối đa 5, không tính chính nó khi chính nó đã quá hạn', () => {
    const twins = Array.from({ length: 7 }, (_, i) =>
      card({ id: `s${i}`, title: 'Thiết kế slide', dueDate: day(5), status: 'DONE', completedAt: day(i % 2 === 0 ? 4 : 6) }));
    const target = card({ id: 'zz', title: 'Thiết kế slide', createdAt: day(1), dueDate: day(8) });
    const f = extractFeatures(target, buildRiskContext([...twins, target], day(7), PRIORS))!;
    expect(f.detail.similar.count).toBe(5);
    const overdue = extractFeatures(target, buildRiskContext([twins[0]!, target], day(9), PRIORS))!;
    expect(overdue.detail.similar.count).toBe(1);
  });
});

// ---------- Khong nhin thay tuong lai (bat bien 2, §15) ----------
/** Cat moi thong tin sau t: the "trong nhu" luc t, nhu thu CSDL luc do se luu. */
function truncateAt(c: RiskCardHistory, t: Date): RiskCardHistory | null {
  const tm = t.getTime();
  if (c.createdAt.getTime() > tm) return null;
  const done = isDoneAt(c, t);
  return {
    ...c,
    dueDate: dueAt(c, t),
    status: done ? 'DONE' : statusAt(c, t),
    completedAt: done ? c.completedAt && c.completedAt.getTime() <= tm ? c.completedAt : c.statusEvents.filter((e) => e.at.getTime() <= tm && e.to === 'DONE').at(-1)?.at ?? null : null,
    members: c.members.filter((m) => m.createdAt.getTime() <= tm),
    statusEvents: c.statusEvents.filter((e) => e.at.getTime() <= tm),
    dueEvents: c.dueEvents.filter((e) => e.at.getTime() <= tm),
    checklist: c.checklist
      .filter((i) => i.createdAt.getTime() <= tm)
      .map((i) => (i.completedAt && i.completedAt.getTime() > tm ? { ...i, isDone: false, completedAt: null } : i)),
    activityAt: c.activityAt.filter((a) => a.getTime() <= tm),
  };
}

describe('bất biến: không dùng dữ liệu sau t', () => {
  it('cắt hết sự kiện sau t → đặc trưng (replay) không đổi ở mọi mốc', () => {
    const { all: base } = world();
    // H5 giong C MOT PHAN (do giong < 1, phu thuoc IDF); F tao SAU moi moc t - neu kho IDF lo dung F thi do giong voi H5 doi
    const H5 = card({ id: 'h5', title: 'Thiết kế poster', createdAt: day(10), dueDate: day(15), status: 'DONE', completedAt: day(14), members: [{ userId: 'u2', createdAt: day(10) }] });
    const F = card({ id: 'f', title: 'Thiết kế thiết kế thiết kế', description: 'thiết kế', createdAt: day(33.5), dueDate: day(50) });
    const all = [...base, H5, F];
    // Them tuong lai cho the C: tick them, doi han, xong
    const future = all.map((c) =>
      c.id !== 'c'
        ? c
        : {
            ...c,
            status: 'DONE' as const,
            completedAt: day(38),
            dueDate: day(40),
            dueEvents: [{ at: day(33), from: day(36), to: day(40) }],
            statusEvents: [...c.statusEvents, ev(31, 'BLOCKED', 'IN_PROGRESS'), ev(38, 'IN_PROGRESS', 'DONE')],
            checklist: c.checklist.map((i) => (i.isDone ? i : { ...i, isDone: true, completedAt: day(34) })),
            activityAt: [...c.activityAt, day(31), day(33), day(38)],
            members: [...c.members, { userId: 'u2', createdAt: day(32) }],
          }
    );
    for (const d of [25.5, 26, 27.5, 29, 30, 32.9]) {
      const t = day(d);
      const full = future.find((c) => c.id === 'c')!;
      const cut = future.map((c) => truncateAt(c, t)).filter((c): c is RiskCardHistory => c !== null);
      const a = extractFeatures(full, buildRiskContext(future, t, PRIORS, 'replay'));
      const b = extractFeatures(cut.find((c) => c.id === 'c')!, buildRiskContext(cut, t, PRIORS, 'replay'));
      expect(a, `ngày ${d}`).not.toBeNull();
      expect(a!.detail.similar.count, `ngày ${d}`).toBe(2); // H1 (trung) + H5 (mot phan)
      expect(a!.vector, `ngày ${d}`).toEqual(b!.vector);
      expect(a!.detail, `ngày ${d}`).toEqual(b!.detail);
    }
  });
});
