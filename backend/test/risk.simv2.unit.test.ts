// Buoc 10 module canh bao tre han (RISK_MODULE.md §20): bo mo phong v2 - ngau nhien hoa thoi quen nhom. Test THUAN.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DAY_MS, outcomeAt, type RiskCardHistory, type RiskStatus } from '../src/modules/risk/risk.history';
import { generateRiskWorld, RISK_SIM_START } from '../src/scripts/riskSim';
import {
  CONFIRM_SEEDS_V2,
  CONFIRM_SEEDS_V3,
  CONFIRM_SEEDS_V4,
  COVERAGE_STATS,
  DEV_SEEDS_V2,
  HABIT_RANGES,
  MECHANISMS,
  PULL_MAX_OPEN,
  REMIND_DAYS_LEFT,
  RESCUE_DAYS_LEFT,
  TRAIN_SEEDS_V2,
  coverageCheck,
  coverageStats,
  generateRiskWorldV2,
  generateWorld,
  sampleHabits,
  seedsOf,
  type RiskWorldV2,
} from '../src/scripts/riskSimV2';
import { computePriors, snapshotsOfWorld } from '../src/scripts/riskSnapshots';

describe('bộ mô phỏng v2: tất định, tách bạch với v1', () => {
  it('cùng hạt giống → cùng thế giới; khác v1 cùng hạt giống', () => {
    expect(generateRiskWorldV2(7001)).toEqual(generateRiskWorldV2(7001));
    expect(JSON.stringify(generateRiskWorldV2(7001).cards)).not.toBe(JSON.stringify(generateRiskWorld(7001).cards));
  });

  it('ĐÓNG BĂNG v2: mã băm 3 thế giới đầu không đổi', () => {
    const h = createHash('sha256');
    for (const s of [7001, 7002, 7003]) h.update(JSON.stringify(generateRiskWorldV2(s)));
    expect(h.digest('hex')).toBe('f6b6729392ab95483791db9b2ecabfe2fc5d802e4cdd4363eae3c3be689e8569');
  });

  it('dải hạt giống v2 (kể cả xác nhận mới của v3) không giao nhau và không trùng v1', () => {
    const all = [...TRAIN_SEEDS_V2, ...DEV_SEEDS_V2, ...CONFIRM_SEEDS_V2, ...CONFIRM_SEEDS_V3, ...CONFIRM_SEEDS_V4];
    expect(new Set(all).size).toBe(120);
    expect([CONFIRM_SEEDS_V3[0], CONFIRM_SEEDS_V3.at(-1)]).toEqual([7301, 7320]);
    const v1 = seedsOf('v1');
    for (const s of [...v1.train, ...v1.dev, ...v1.confirm]) expect(all).not.toContain(s);
    expect(seedsOf('v2')).toEqual({ train: TRAIN_SEEDS_V2, dev: DEV_SEEDS_V2, confirm: CONFIRM_SEEDS_V2 });
  });

  it('generateWorld chọn đúng phiên bản; v1 không nhận tắt cơ chế; cơ chế lạ / hạt giống hỏng → lỗi', () => {
    expect(generateWorld(6001, 'v1')).toEqual(generateRiskWorld(6001));
    expect(generateWorld(7001, 'v2')).toEqual(generateRiskWorldV2(7001));
    expect(() => generateWorld(6001, 'v1', ['M1'])).toThrow(RangeError);
    expect(() => generateRiskWorldV2(7001, ['M5' as 'M1'])).toThrow(RangeError);
    expect(() => generateRiskWorldV2(-1)).toThrow(RangeError);
  });
});

describe('thói quen nhóm', () => {
  const seeds = Array.from({ length: 300 }, (_, i) => 7001 + i);
  const inRange = (v: number, [a, b]: readonly [number, number]) => v >= a && v <= b;

  it('mọi tham số nằm trong khoảng đã chốt; 25% nhóm không dùng story point', () => {
    let noSp = 0;
    for (const s of seeds) {
      const h = sampleHabits(s);
      expect(inRange(h.unassignedShare!, HABIT_RANGES.unassignedShare)).toBe(true);
      expect(inRange(h.pullRate, HABIT_RANGES.pullRate)).toBe(true);
      expect(inRange(h.procrastinatorShare, HABIT_RANGES.procrastinatorShare)).toBe(true);
      expect(inRange(h.forgetRate, HABIT_RANGES.forgetRate)).toBe(true);
      expect(inRange(h.statusDiscipline, HABIT_RANGES.statusDiscipline)).toBe(true);
      expect(inRange(h.lateMarkerShare, HABIT_RANGES.lateMarkerShare)).toBe(true);
      expect(inRange(h.checklistUsage, HABIT_RANGES.checklistUsage)).toBe(true);
      expect(inRange(h.planAheadShare, HABIT_RANGES.planAheadShare)).toBe(true);
      if (h.storyPointUsage === 0) noSp += 1;
      else expect(inRange(h.storyPointUsage, HABIT_RANGES.storyPointUsage)).toBe(true);
    }
    expect(noSp / seeds.length).toBeGreaterThan(0.18);
    expect(noSp / seeds.length).toBeLessThan(0.32);
  });

  it('tắt một cơ chế: đúng giá trị "như v1", các cơ chế khác GIỮ NGUYÊN', () => {
    const off = {
      M1: { unassignedShare: null, pullRate: 0 },
      M2: { procrastinatorShare: 0, forgetRate: 0 },
      M3: { statusDiscipline: 1, lateMarkerShare: 0 },
      M4: { checklistUsage: 0.7, storyPointUsage: 0.6 },
      M6: { planAheadShare: 0 },
    } as const;
    for (const s of seeds.slice(0, 30)) {
      const full = sampleHabits(s);
      for (const m of MECHANISMS) {
        expect(sampleHabits(s, [m])).toEqual({ ...full, ...off[m] });
      }
      expect(sampleHabits(s, [...MECHANISMS])).toEqual({ ...full, ...off.M1, ...off.M2, ...off.M3, ...off.M4, ...off.M6 });
    }
  });
});

// ---------- Bat bien du lieu quan sat duoc (nhu v1) ----------
const sorted = (xs: readonly Date[]) => xs.every((x, i) => i === 0 || xs[i - 1]!.getTime() <= x.getTime());
function checkInvariants(w: RiskWorldV2) {
  const now = w.now.getTime();
  for (const c of w.cards) {
    let cur: RiskStatus = 'TODO';
    for (const e of c.statusEvents) {
      expect(e.from, c.id).toBe(cur);
      expect(e.to).not.toBe(e.from);
      cur = e.to;
    }
    expect(c.status, c.id).toBe(cur);
    expect(sorted(c.statusEvents.map((e) => e.at)), c.id).toBe(true);
    const lastDone = c.statusEvents.filter((e) => e.to === 'DONE').at(-1)?.at ?? null;
    expect(c.completedAt, c.id).toEqual(c.status === 'DONE' ? lastDone : null);
    for (let i = 1; i < c.dueEvents.length; i += 1) expect(c.dueEvents[i]!.from).toEqual(c.dueEvents[i - 1]!.to);
    if (c.dueEvents.length > 0) expect(c.dueDate).toEqual(c.dueEvents.at(-1)!.to);
    for (const it of c.checklist) {
      expect(it.isDone).toBe(it.completedAt !== null);
      if (it.completedAt) expect(it.completedAt.getTime()).toBeLessThanOrEqual(now);
    }
    if (c.status === 'DONE') expect(c.checklist.every((i) => i.isDone), c.id).toBe(true);
    expect(sorted(c.activityAt)).toBe(true);
    for (const t of [...c.activityAt, ...c.statusEvents.map((e) => e.at), ...c.members.map((m) => m.createdAt)]) {
      expect(t.getTime(), c.id).toBeGreaterThanOrEqual(c.createdAt.getTime());
      expect(t.getTime(), c.id).toBeLessThanOrEqual(now);
    }
    expect(new Set(c.members.map((m) => m.userId)).size).toBe(c.members.length);
    expect([null, 1, 2, 3, 5, 8]).toContain(c.storyPoints);
    expect(c.createdAt.getTime()).toBeGreaterThanOrEqual(RISK_SIM_START);
    expect(Object.keys(c).sort()).toEqual(
      ['activityAt', 'checklist', 'completedAt', 'createdAt', 'description', 'dueDate', 'dueEvents', 'id', 'members', 'startDate', 'status', 'statusEvents', 'storyPoints', 'title'].sort()
    );
  }
}

describe.each([7002, 7004, 7005, 7010, 7203])('bất biến dữ liệu (v2, hạt giống %i)', (seed) => {
  it('đủ cơ chế', () => checkInvariants(generateRiskWorldV2(seed)));
  it.each(MECHANISMS)('tắt %s', (m) => checkInvariants(generateRiskWorldV2(seed, [m])));
});

// ---------- Tung co che lam dung viec cua no ----------
describe('cơ chế', () => {
  it('M1: thẻ chưa ai nhận không tiến triển (không đổi trạng thái trước khi có người nhận)', () => {
    let unassignedSeen = 0;
    for (const seed of [7002, 7003, 7007]) {
      const w = generateRiskWorldV2(seed);
      for (const c of w.cards) {
        if (!w.hidden[c.id]!.createdUnassigned) continue;
        unassignedSeen += 1;
        const firstMember = c.members.reduce<number>((a, m) => Math.min(a, m.createdAt.getTime()), Number.POSITIVE_INFINITY);
        for (const e of c.statusEvents) expect(e.at.getTime(), c.id).toBeGreaterThanOrEqual(firstMember);
        if (c.members.length === 0) expect(c.statusEvents).toEqual([]);
      }
    }
    expect(unassignedSeen).toBeGreaterThan(100);
  });

  it('M1 tắt: không thẻ nào "tạo ra chưa giao"', () => {
    const w = generateRiskWorldV2(7002, ['M1']);
    expect(Object.values(w.hidden).some((h) => h.createdUnassigned)).toBe(false);
  });

  it('M2: thẻ bị bỏ quên trễ nhiều hơn thẻ thường; M2 tắt thì không ai trì hoãn, không thẻ nào bỏ quên', () => {
    let fLate = 0;
    let fN = 0;
    let oLate = 0;
    let oN = 0;
    for (const seed of [7002, 7004, 7005]) {
      const w = generateRiskWorldV2(seed);
      for (const c of w.cards) {
        const o = outcomeAt(c, w.now);
        if (o === null) continue;
        if (w.hidden[c.id]!.forgotten) {
          fN += 1;
          if (o.late) fLate += 1;
        } else {
          oN += 1;
          if (o.late) oLate += 1;
        }
      }
    }
    expect(fN).toBeGreaterThan(50);
    expect(fLate / fN).toBeGreaterThan(oLate / oN + 0.05);
    const off = generateRiskWorldV2(7002, ['M2']);
    expect(off.people.every((p) => p.procrastinateWithin === null)).toBe(true);
    expect(Object.values(off.hidden).some((h) => h.forgotten)).toBe(false);
  });

  it('M3: nhóm lười cập nhật → nhiều thẻ đi thẳng Cần làm → Xong; M3 tắt → thẻ xong nào cũng qua Đang làm', () => {
    const direct = (w: RiskWorldV2) => {
      const done = w.cards.filter((c) => c.status === 'DONE');
      return done.filter((c) => !c.statusEvents.some((e) => e.to === 'IN_PROGRESS')).length / done.length;
    };
    expect(direct(generateRiskWorldV2(7004))).toBeGreaterThan(0.2); // statusDiscipline < 0,3
    const off = generateRiskWorldV2(7004, ['M3']);
    expect(direct(off)).toBe(0);
    expect(off.people.some((p) => p.lateMarker)).toBe(false);
  });

  it('M6: thẻ lập kế hoạch trước tạo vào ngày lập (0, 14, 28…), bắt đầu sau ≥ 3 ngày; M6 tắt → không có', () => {
    let planned = 0;
    for (const seed of [7002, 7010, 7011]) {
      const w = generateRiskWorldV2(seed);
      for (const c of w.cards) {
        if (!w.hidden[c.id]!.plannedAhead) continue;
        planned += 1;
        const createdDay = Math.floor((c.createdAt.getTime() - RISK_SIM_START) / DAY_MS);
        expect(createdDay % HABIT_RANGES.planEveryDays).toBe(0);
        expect(c.startDate!.getTime() - c.createdAt.getTime()).toBeGreaterThan(3 * DAY_MS - 3 * 3_600_000);
      }
    }
    expect(planned).toBeGreaterThan(100);
    const off = generateRiskWorldV2(7002, ['M6']);
    expect(Object.values(off.hidden).some((h) => h.plannedAhead)).toBe(false);
  });

  it('tổng số thẻ gần như không phụ thuộc tỉ lệ lập kế hoạch trước', () => {
    const counts = TRAIN_SEEDS_V2.slice(0, 20).map((s) => generateRiskWorldV2(s).cards.length);
    expect(Math.min(...counts)).toBeGreaterThan(100);
    expect(Math.max(...counts)).toBeLessThan(200);
  });
});

// ---------- Hanh vi chi tiet (viet sau lan cai loi dau: 7 phep song sot) ----------
const hourOf = (t: Date) => ((t.getTime() - RISK_SIM_START) % DAY_MS) / 3_600_000;
const dayOf = (t: Date) => Math.floor((t.getTime() - RISK_SIM_START) / DAY_MS);
const atHour = (t: Date, h: number) => Math.abs(hourOf(t) - h) < 1e-9;
/** Han cua the tai thoi diem t (lui theo cac lan doi han). */
function dueAt(c: RiskCardHistory, t: Date): Date {
  let due = c.dueEvents[0]?.from ?? c.dueDate;
  for (const e of c.dueEvents) if (e.at.getTime() <= t.getTime()) due = e.to;
  return due;
}
const daysLeftAt = (c: RiskCardHistory, t: Date) => (dueAt(c, t).getTime() - t.getTime()) / DAY_MS;
/** So the nguoi nay dang mo ngay truoc thoi diem t (khong tinh the duoc giao dung luc t). */
const openAt = (w: RiskWorldV2, userId: string, t: Date) =>
  w.cards.filter((c) => c.members.some((m) => m.userId === userId && m.createdAt < t) && (c.completedAt === null || c.completedAt > t)).length;

describe('hành vi chi tiết', () => {
  it('M2 trì hoãn: thẻ chỉ người trì hoãn làm thì lần đổi trạng thái đầu tiên chỉ khi còn ≤ procrastinateWithin ngày', () => {
    let n = 0;
    for (const seed of [7004, 7028]) {
      const w = generateRiskWorldV2(seed);
      const within = new Map(w.people.map((p) => [p.id, p.procrastinateWithin]));
      for (const c of w.cards) {
        const ws = c.members.map((m) => within.get(m.userId)!);
        if (ws.length === 0 || ws.some((x) => x === null) || c.statusEvents.length === 0) continue;
        n += 1;
        // lan doi dau tien (tu Can lam) xay ra trong ngay lam viec; buoi trua hom do nguoi lam phai thay con <= nguong
        const noon = new Date(RISK_SIM_START + dayOf(c.statusEvents[0]!.at) * DAY_MS + 13 * 3_600_000);
        expect(daysLeftAt(c, noon), c.id).toBeLessThanOrEqual(Math.max(...(ws as number[])) + 1e-9);
      }
    }
    expect(n).toBeGreaterThan(150);
  });

  it('M3 đánh dấu Xong muộn: thẻ chỉ người "đánh dấu muộn" làm không qua Chờ duyệt, được ghi Xong lúc ≥ 17h', () => {
    let done = 0;
    for (const seed of [7024, 7002]) {
      const w = generateRiskWorldV2(seed);
      const late = new Set(w.people.filter((p) => p.lateMarker).map((p) => p.id));
      for (const c of w.cards) {
        if (c.members.length === 0 || !c.members.every((m) => late.has(m.userId))) continue;
        expect(c.statusEvents.some((e) => e.to === 'IN_REVIEW'), c.id).toBe(false);
        if (c.status !== 'DONE') continue;
        done += 1;
        expect(hourOf(c.completedAt!), c.id).toBeGreaterThanOrEqual(17);
      }
    }
    expect(done).toBeGreaterThan(100);
  });

  it('M1 tự nhận việc (11h30): chỉ người đang mở ≤ PULL_MAX_OPEN thẻ mới tự nhận thêm', () => {
    let pulls = 0;
    for (const seed of [7020, 7033]) {
      const w = generateRiskWorldV2(seed);
      for (const c of w.cards) {
        for (const m of c.members) {
          if (!atHour(m.createdAt, 11.5)) continue;
          pulls += 1;
          expect(openAt(w, m.userId, m.createdAt), c.id).toBeLessThanOrEqual(PULL_MAX_OPEN);
        }
      }
    }
    expect(pulls).toBeGreaterThan(200);
  });

  it('M1 giao bù (18h05): chỉ thẻ chưa ai nhận, còn ≤ RESCUE_DAYS_LEFT ngày', () => {
    let rescues = 0;
    for (const seed of [7002, 7017]) {
      const w = generateRiskWorldV2(seed);
      for (const c of w.cards) {
        const m = c.members.find((x) => atHour(x.createdAt, 18 + 5 / 60));
        if (m === undefined) continue;
        rescues += 1;
        expect(c.members[0], c.id).toBe(m);
        expect(daysLeftAt(c, m.createdAt), c.id).toBeLessThanOrEqual(RESCUE_DAYS_LEFT);
      }
    }
    expect(rescues).toBeGreaterThan(50);
  });

  it('M2 bỏ quên: không ai nhắc thì chỉ nhớ ra khi đã quá hạn; nhắc (18h10) chỉ khi còn ≤ REMIND_DAYS_LEFT ngày', () => {
    let unreminded = 0;
    let reminders = 0;
    for (const seed of [7017, 7020]) {
      const w = generateRiskWorldV2(seed);
      for (const c of w.cards) {
        if (!w.hidden[c.id]!.forgotten) continue;
        const remind = c.activityAt.filter((t) => atHour(t, 18 + 10 / 60));
        for (const t of remind) {
          reminders += 1;
          expect(daysLeftAt(c, t), c.id).toBeGreaterThan(0);
          expect(daysLeftAt(c, t), c.id).toBeLessThanOrEqual(REMIND_DAYS_LEFT);
        }
        if (remind.length > 0 || c.status !== 'DONE') continue;
        unreminded += 1;
        expect(c.completedAt!.getTime(), c.id).toBeGreaterThan(c.dueDate.getTime());
      }
    }
    expect(unreminded).toBeGreaterThan(50);
    expect(reminders).toBeGreaterThan(20);
  });

  it('thẻ tạo sát lúc làm có ngày bắt đầu: hạn tính từ ngày TẠO (như v1), không cộng thêm độ lệch ngày bắt đầu', () => {
    // So ngay lam du kien khong phu thuoc do lech ngay bat dau -> phan du (ngay han goc - ngay tao - ky vong) phai nhu nhau
    const groups: Record<'none' | 'k1' | 'k2', number[]> = { none: [], k1: [], k2: [] };
    for (const seed of TRAIN_SEEDS_V2.slice(0, 20)) {
      const w = generateRiskWorldV2(seed);
      const teamSpeed = w.people.reduce((a, p) => a + p.speed / p.diligence, 0) / w.people.length;
      for (const c of w.cards) {
        const h = w.hidden[c.id]!;
        if (h.plannedAhead) continue;
        const k = c.startDate === null ? 'none' : `k${dayOf(c.startDate) - dayOf(c.createdAt)}`;
        if (k !== 'none' && k !== 'k1' && k !== 'k2') continue;
        groups[k].push(dayOf(c.dueEvents[0]?.from ?? c.dueDate) - dayOf(c.createdAt) - (h.truePoints * teamSpeed * 1.25 + 2));
      }
    }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(groups.k1.length).toBeGreaterThan(100);
    expect(groups.k2.length).toBeGreaterThan(100);
    expect(Math.abs(avg(groups.k1) - avg(groups.none))).toBeLessThan(0.5); // dung: -0,09; neu tinh tu ngay bat dau: ~ +0,9
    expect(Math.abs(avg(groups.k2) - avg(groups.none))).toBeLessThan(0.5); // dung: -0,13; neu tinh tu ngay bat dau: ~ +1,9
  });
});

// ---------- Kiem do phu (§20.4) - trang thai user da chap nhan 27/10: phu 3/5 ----------
describe('kiểm độ phủ', () => {
  // So do tren CSDL dev ngay 27/10 (eval-risk-coverage-v2.md)
  const DEV = { noAssignee: 0.404, logDaysSinceActivity: 2.216, logEvents7d: 0.444, checklistShare: 0.057, storyPointShare: 0 };

  it('coverageCheck: biên nhỏ nhất / lớn nhất tính đúng, giá trị ở biên vẫn là phủ', () => {
    const w = (v: number) => Object.fromEntries(COVERAGE_STATS.map((k) => [k, v])) as Record<(typeof COVERAGE_STATS)[number], number>;
    const r = coverageCheck([w(0.1), w(0.5), w(0.3)], { ...w(0.5), noAssignee: 0.6, checklistShare: 0.05 });
    expect(r.find((x) => x.stat === 'logEvents7d')).toMatchObject({ min: 0.1, max: 0.5, covered: true });
    expect(r.find((x) => x.stat === 'noAssignee')!.covered).toBe(false);
    expect(r.find((x) => x.stat === 'checklistShare')!.covered).toBe(false);
  });

  it('40 thế giới học v2 phủ "chưa ai nhận", "checklist", "story point"; hai thống kê hoạt động là giới hạn đã chấp nhận', () => {
    const worlds = TRAIN_SEEDS_V2.map((s) => generateRiskWorldV2(s));
    const priors = computePriors(worlds);
    const stats = worlds.map((w) => coverageStats(snapshotsOfWorld(w.seed, w.cards, w.now, priors)));
    const r = Object.fromEntries(coverageCheck(stats, DEV).map((x) => [x.stat, x.covered]));
    expect(r).toEqual({ noAssignee: true, checklistShare: true, storyPointShare: true, logDaysSinceActivity: false, logEvents7d: false });
  }, 120_000);
});
