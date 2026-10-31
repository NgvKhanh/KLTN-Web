// Bo mo phong vong doi the v2 - NGAU NHIEN HOA THOI QUEN NHOM (RISK_MODULE.md §20). HAM THUAN, TAT DINH theo hat giong.
//
// Giu nguyen khung v1 (riskSim.ts - KHONG doi mot byte, ma bam v1 van dung): dung / tre han van la KET QUA cua qua trinh lam viec
// tung ngay. Khac v1: moi the gioi rut mot bo "thoi quen nhom" AN trong khoang rong, tu nhom ngan nap nhu v1 toi nhom long leo:
//   M1 the chua nguoi nhan + tu nhan viec    M2 tri hoan + bo quen
//   M3 ky luat cap nhat trang thai + danh dau Xong muon    M4 ti le dung checklist + story point theo nhom
//   (M5 = cac nguon lech cu cua v1, giu nguyen)    M6 lap ke hoach truoc (the tao san theo dot, nhieu tuan truoc han)
// Khoang tham so da chinh 27/10 sau lan kiem do phu dau (user chot, §20.2).
// Moi co che tat duoc rieng (P6, §20.4). Thoi quen rut tu MOT luong ngau nhien rieng, rut HET roi moi tat -> tat mot co che khong
// lam doi gia tri cua co che khac.
//
// Module risk/ KHONG DUOC import tep nay (bo mo phong biet phan an).

import { DAY_MS, type RiskCardHistory, type RiskChecklistItem, type RiskDueEvent, type RiskStatus, type RiskStatusEvent } from '../modules/risk/risk.history';
import { streamSeed } from './evalAssignStats';
import {
  CONFIRM_SEEDS,
  DEV_SEEDS,
  POINT_SCALE,
  RISK_SIM_DAYS,
  RISK_SIM_LAST_CREATE_DAY,
  RISK_SIM_START,
  TRAIN_SEEDS,
  generateRiskWorld,
  normal,
  type RiskWorld,
  type SimRiskHidden,
  type SimRiskPerson,
} from './riskSim';
import type { SnapshotRow } from './riskSnapshots';
import { Rng } from './simGenerator';
import { TOPICS } from './simVocab';

/** Hat giong v2 (§20.3) - chua tung dung, khong trung dai nao truoc do. */
export const TRAIN_SEEDS_V2 = range(7001, 7040);
export const DEV_SEEDS_V2 = range(7101, 7120);
export const CONFIRM_SEEDS_V2 = range(7201, 7220);
/** Xac nhan cua mo hinh 4 yeu to `logreg-v3` (§21.4): the gioi v2 MOI, vi 7201-7220 da dung mot lan o buoc 12. */
export const CONFIRM_SEEDS_V3 = range(7301, 7320);
/** Xac nhan cua mo hinh trang thai + so ngay con lai `logreg-v4` (§22.4): the gioi v2 MOI. */
export const CONFIRM_SEEDS_V4 = range(7401, 7420);

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

export type SimVersion = 'v1' | 'v2';
export type Mechanism = 'M1' | 'M2' | 'M3' | 'M4' | 'M6';
export const MECHANISMS: readonly Mechanism[] = ['M1', 'M2', 'M3', 'M4', 'M6'];

/** Khoang rut thoi quen nhom (§20.2) - CHOT truoc khi sinh the gioi v2 nao. */
export const HABIT_RANGES = {
  unassignedShare: [0.05, 0.9],
  pullRate: [0.02, 0.6],
  procrastinatorShare: [0, 0.9],
  procrastinateWithin: [1, 4],
  forgetRate: [0, 0.6],
  statusDiscipline: [0.1, 1],
  lateMarkerShare: [0, 0.4],
  lateMarkMaxDays: 5,
  checklistUsage: [0, 0.8],
  storyPointUsage: [0.05, 0.7],
  noStoryPointTeams: 0.25,
  planAheadShare: [0, 0.8],
  planEveryDays: 14,
  planStartOffset: [3, 42],
  planTrials: 28,
} as const;

/** Gia tri khi TAT co che = hanh vi v1. */
const V1_HABITS = { checklistUsage: 0.7, storyPointUsage: 0.6 } as const;
/** Nguoi "dang it viec" (tu nhan them) = dang mo khong qua so the nay. */
export const PULL_MAX_OPEN = 2;
export const RESCUE_DAYS_LEFT = 2;
const RESCUE_CHANCE = 0.5;
export const REMIND_DAYS_LEFT = 1;
const REMIND_CHANCE = 0.5;

export interface WorldHabits {
  /** null = M1 tat: giao viec nhu v1 (85% ngay, con lai trong 1-4 ngay). */
  unassignedShare: number | null;
  pullRate: number;
  procrastinatorShare: number;
  forgetRate: number;
  statusDiscipline: number;
  lateMarkerShare: number;
  checklistUsage: number;
  storyPointUsage: number;
  /** M6: ti le the duoc lap ke hoach truoc theo dot (0 = moi the tao sat luc lam). */
  planAheadShare: number;
}

export function sampleHabits(seed: number, disable: readonly Mechanism[] = []): WorldHabits {
  const r = new Rng(streamSeed(seed, 0, 42));
  const pick = (k: keyof typeof HABIT_RANGES) => {
    const [a, b] = HABIT_RANGES[k] as readonly [number, number];
    return r.range(a, b);
  };
  // Rut HET truoc (thu tu co dinh) roi moi ap "tat" -> cac co che con lai giu nguyen gia tri
  const u = pick('unassignedShare');
  const p = pick('pullRate');
  const q = pick('procrastinatorShare');
  const f = pick('forgetRate');
  const s = pick('statusDiscipline');
  const m = pick('lateMarkerShare');
  const c = pick('checklistUsage');
  const noSp = r.chance(HABIT_RANGES.noStoryPointTeams);
  const sp = pick('storyPointUsage');
  const a = pick('planAheadShare');
  const off = new Set(disable);
  return {
    unassignedShare: off.has('M1') ? null : u,
    pullRate: off.has('M1') ? 0 : p,
    procrastinatorShare: off.has('M2') ? 0 : q,
    forgetRate: off.has('M2') ? 0 : f,
    statusDiscipline: off.has('M3') ? 1 : s,
    lateMarkerShare: off.has('M3') ? 0 : m,
    checklistUsage: off.has('M4') ? V1_HABITS.checklistUsage : c,
    storyPointUsage: off.has('M4') ? V1_HABITS.storyPointUsage : noSp ? 0 : sp,
    planAheadShare: off.has('M6') ? 0 : a,
  };
}

export interface SimRiskPersonV2 extends SimRiskPerson {
  /** AN (M2): chi bat dau lam khi con <= so ngay nay; null = khong tri hoan. */
  procrastinateWithin: number | null;
  /** AN (M3): lam xong roi moi danh dau Xong sau 0-5 ngay. */
  lateMarker: boolean;
}

export interface SimRiskHiddenV2 extends SimRiskHidden {
  /** AN (M2): the bi bo quen luc tao. */
  forgotten: boolean;
  /** AN (M1): tao ra khong co ai duoc len lich giao. */
  createdUnassigned: boolean;
  /** AN (M6): the duoc tao san trong dot lap ke hoach. */
  plannedAhead: boolean;
}

export interface RiskWorldV2 extends RiskWorld {
  version: 2;
  habits: WorldHabits;
  disabled: Mechanism[];
  people: SimRiskPersonV2[];
  hidden: Record<string, SimRiskHiddenV2>;
}

interface Working {
  id: string;
  title: string;
  description: string | null;
  createdAt: Date;
  startDate: Date | null;
  dueDate: Date;
  storyPoints: number | null;
  members: { userId: string; createdAt: Date }[];
  statusEvents: RiskStatusEvent[];
  dueEvents: RiskDueEvent[];
  checklist: RiskChecklistItem[];
  activityAt: Date[];
  status: RiskStatus;
  completedAt: Date | null;
  hidden: SimRiskHiddenV2;
  remaining: number;
  assignDay: number;
  blockedUntilDay: number;
  reviewDoneDay: number;
  postponed: number;
  forgotten: boolean;
  /** M3: da lam xong that, cho toi ngay nay moi ghi Xong; -1 = khong cho. */
  pendingDoneDay: number;
}

export function generateRiskWorldV2(seed: number, disable: readonly Mechanism[] = []): RiskWorldV2 {
  if (!Number.isInteger(seed) || seed < 0) throw new RangeError('seed phai la so nguyen >= 0');
  for (const d of disable) if (!MECHANISMS.includes(d)) throw new RangeError(`co che la: ${d}`);
  const h = sampleHabits(seed, disable);
  const rng = new Rng(streamSeed(seed, 0, 43));
  const at = (day: number, hour: number) => new Date(RISK_SIM_START + day * DAY_MS + hour * 3_600_000);
  const daysLeft = (c: Working, t: Date) => (c.dueDate.getTime() - t.getTime()) / DAY_MS;

  // ---- nguoi ----
  const people: SimRiskPersonV2[] = Array.from({ length: 6 + rng.int(5) }, (_, i) => ({
    id: `w${seed}-u${i}`,
    speed: Math.exp(Math.log(0.8) + 0.35 * normal(rng)),
    diligence: rng.range(0.55, 0.95),
    batchTicker: rng.chance(0.3),
    commentRate: rng.range(0.02, 0.25),
    procrastinateWithin: rng.chance(h.procrastinatorShare) ? rng.range(...HABIT_RANGES.procrastinateWithin) : null,
    lateMarker: rng.chance(h.lateMarkerShare),
  }));
  const teamSpeed = people.reduce((a, p) => a + p.speed / p.diligence, 0) / people.length;
  const topicOverrun = TOPICS.map(() => Math.exp(0.3 * normal(rng)));

  const cards: Working[] = [];
  const isOpen = (c: Working) => c.status !== 'DONE';
  const openOf = (userId: string) => cards.filter((c) => isOpen(c) && c.members.some((m) => m.userId === userId));

  const setStatus = (c: Working, to: RiskStatus, when: Date) => {
    if (c.status === to) return;
    c.statusEvents.push({ at: when, from: c.status, to });
    c.activityAt.push(when);
    c.status = to;
  };
  const assignTo = (c: Working, userId: string, when: Date) => {
    c.members.push({ userId, createdAt: when });
    c.activityAt.push(when);
  };
  // Truong nhom giao (nhu v1): can tai co nhieu, 15% co nguoi thu hai
  const assign = (c: Working, when: Date) => {
    const weights = people.map((p) => (1 / (1 + openOf(p.id).length)) * rng.range(0.5, 1.5));
    const first = rng.weighted(people, weights);
    assignTo(c, first.id, when);
    if (rng.chance(0.15)) c.members.push({ userId: rng.pick(people.filter((p) => p.id !== first.id)).id, createdAt: when });
  };
  const tickUpTo = (c: Working, target: number, when: Date) => {
    let done = c.checklist.filter((i) => i.isDone).length;
    for (const it of c.checklist) {
      if (done >= target) break;
      if (it.isDone) continue;
      it.isDone = true;
      it.completedAt = new Date(when.getTime() + done * 60_000);
      done += 1;
    }
  };
  const finish = (c: Working, when: Date) => {
    tickUpTo(c, c.checklist.length, new Date(when.getTime() - 30 * 60_000));
    setStatus(c, 'DONE', when);
    c.completedAt = when;
  };
  const afterLast = (c: Working, t: Date, gapMs: number) =>
    new Date(Math.max(t.getTime(), (c.statusEvents.at(-1)?.at.getTime() ?? 0) + gapMs));

  /**
   * Tao 1 the. `plannedStartDay` = null: the tao sat luc lam (nhu v1 - 30% co ngay bat dau 0-2 ngay sau, han tinh tu hom nay);
   * so: the lap ke hoach truoc (M6) - ngay bat dau o tuong lai, han tinh tu ngay bat dau, giao 0-2 ngay truoc ngay bat dau.
   */
  const newCard = (day: number, createdAt: Date, plannedStartDay: number | null) => {
    const topic = rng.int(TOPICS.length);
    const tp = TOPICS[topic]!;
    const truePoints = rng.weighted(POINT_SCALE, [0.15, 0.25, 0.3, 0.2, 0.1]);
    const effort = truePoints * topicOverrun[topic]! * Math.exp(0.35 * normal(rng));
    const items = rng.chance(h.checklistUsage) ? Math.min(14, Math.max(1, Math.round(truePoints * rng.range(0.8, 1.6)))) : 0;
    const leadDays = Math.ceil(truePoints * teamSpeed * rng.range(0.9, 1.6) + rng.range(1, 3));
    const planned = plannedStartDay !== null;
    const startOffset = planned ? -1 : rng.chance(0.3) ? rng.int(3) : -1;
    const startDay = planned ? plannedStartDay : startOffset >= 0 ? day + startOffset : day;
    const createdUnassigned = h.unassignedShare !== null && rng.chance(h.unassignedShare);
    let assignDay: number;
    if (h.unassignedShare === null) assignDay = planned ? startDay : rng.chance(0.85) ? day : day + 1 + rng.int(4);
    else if (createdUnassigned) assignDay = -1;
    else assignDay = planned ? Math.max(day, startDay - rng.int(3)) : day;
    const forgotten = rng.chance(h.forgetRate);
    cards.push({
      id: `w${seed}-c${cards.length}`,
      title: `${rng.pick(tp.verbs)} ${rng.pick(tp.objects)}${rng.chance(0.4) ? ` ${rng.pick(tp.details)}` : ''}`,
      description: rng.chance(0.6) ? `${rng.pick(tp.descWords)} ${rng.pick(tp.descWords)}` : null,
      createdAt,
      startDate: planned || startOffset >= 0 ? at(startDay, 8) : null,
      // the tao sat luc lam: han tinh tu hom nay nhu v1; the lap ke hoach: tu ngay bat dau
      dueDate: at((planned ? startDay : day) + leadDays, 17),
      storyPoints: rng.chance(h.storyPointUsage) ? truePoints : null,
      members: [],
      statusEvents: [],
      dueEvents: [],
      checklist: Array.from({ length: items }, () => ({ createdAt, isDone: false, completedAt: null })),
      activityAt: [createdAt],
      status: 'TODO',
      completedAt: null,
      hidden: { topic, effort, truePoints, forgotten, createdUnassigned, plannedAhead: planned },
      remaining: effort,
      assignDay,
      blockedUntilDay: -1,
      reviewDoneDay: -1,
      postponed: 0,
      forgotten,
      pendingDoneDay: -1,
    });
  };

  for (let day = 0; day < RISK_SIM_DAYS; day += 1) {
    // 1) tao the: dot lap ke hoach (M6) + the tao sat luc lam (~0,9 the / ngay tong cong)
    if (day < RISK_SIM_LAST_CREATE_DAY) {
      if (day % HABIT_RANGES.planEveryDays === 0 && h.planAheadShare > 0) {
        let planned = 0;
        for (let k = 0; k < HABIT_RANGES.planTrials; k += 1) if (rng.chance(0.45 * h.planAheadShare)) planned += 1;
        for (let k = 0; k < planned; k += 1) {
          const startDay = day + Math.round(rng.range(...HABIT_RANGES.planStartOffset));
          newCard(day, at(day, 9 + rng.range(0, 1)), startDay);
        }
      }
      const born = (rng.chance(0.45 * (1 - h.planAheadShare)) ? 1 : 0) + (rng.chance(0.45 * (1 - h.planAheadShare)) ? 1 : 0);
      for (let k = 0; k < born; k += 1) newCard(day, at(day, 8 + rng.range(0, 3)), null);
    }

    // 2) giao viec den han (lich cua truong nhom)
    for (const c of cards) if (c.members.length === 0 && c.assignDay === day) assign(c, at(day, 11));

    // 3) M1: nguoi dang it viec tu nhan the chua ai nhan, gan han nhat truoc
    if (h.unassignedShare !== null) {
      const pullAt = at(day, 11.5);
      for (const p of people) {
        if (openOf(p.id).length > PULL_MAX_OPEN || !rng.chance(h.pullRate)) continue;
        const free = cards
          .filter((c) => isOpen(c) && c.members.length === 0 && c.createdAt.getTime() <= pullAt.getTime())
          .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
        if (free.length > 0) assignTo(free[0]!, p.id, pullAt);
      }
    }

    // 4) bi chan / het chan (doc lap voi nguoi); the da lam xong cho ghi nhan thi khong bi chan nua
    for (const c of cards) {
      if (c.status === 'BLOCKED' && day >= c.blockedUntilDay) setStatus(c, 'IN_PROGRESS', at(day, 9));
      else if (c.status === 'IN_PROGRESS' && c.pendingDoneDay < 0 && rng.chance(0.03)) {
        setStatus(c, 'BLOCKED', at(day, 11.5));
        c.blockedUntilDay = day + 1 + Math.floor(-Math.log(Math.max(1e-12, rng.next())) * 2);
      }
    }

    // 5) lam viec - M2: bo qua the bi bo quen, nguoi tri hoan chi lam khi gan han; M3: co the khong chuyen Dang lam
    for (const p of people) {
      if (!rng.chance(p.diligence)) continue;
      const noon = at(day, 13);
      const mine = cards.filter(
        (c) =>
          (c.status === 'TODO' || c.status === 'IN_PROGRESS') &&
          c.pendingDoneDay < 0 &&
          !c.forgotten &&
          c.members.some((m) => m.userId === p.id) &&
          (c.startDate === null || c.startDate.getTime() <= at(day, 23).getTime()) &&
          (p.procrastinateWithin === null || daysLeft(c, noon) <= p.procrastinateWithin)
      );
      if (mine.length === 0) continue;
      const c = rng.chance(0.8) ? [...mine].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0]! : rng.pick(mine);
      const when = afterLast(c, at(day, 13 + rng.range(0, 4)), 5 * 60_000);
      if (c.status === 'TODO' && rng.chance(h.statusDiscipline)) setStatus(c, 'IN_PROGRESS', when);
      c.remaining -= 1 / p.speed;
      if (rng.chance(0.05)) c.activityAt.push(new Date(when.getTime() + 10 * 60_000)); // dinh kem
      if (c.remaining > 0) {
        if (!p.batchTicker && c.checklist.length > 0) {
          const progress = 1 - c.remaining / c.hidden.effort;
          tickUpTo(c, Math.floor(progress * c.checklist.length), new Date(when.getTime() + 5 * 60_000));
        }
        continue;
      }
      if (p.lateMarker) {
        // M3: xong that hom nay, ghi Xong sau 0-5 ngay -> completedAt (va nhan dung / tre) theo thoi diem GHI
        c.pendingDoneDay = day + rng.int(HABIT_RANGES.lateMarkMaxDays + 1);
      } else if (rng.chance(0.5)) {
        setStatus(c, 'IN_REVIEW', new Date(when.getTime() + 20 * 60_000));
        c.reviewDoneDay = day + rng.int(3);
      } else {
        finish(c, new Date(when.getTime() + 30 * 60_000));
      }
    }

    // 6) duyet xong; 7) M3: toi ngay ghi nhan thi danh dau Xong
    for (const c of cards) {
      if (c.status === 'IN_REVIEW' && day >= c.reviewDoneDay) finish(c, afterLast(c, at(day, 20), 60 * 60_000));
      else if (c.pendingDoneDay >= 0 && day >= c.pendingDoneDay && isOpen(c)) {
        finish(c, afterLast(c, at(day, 17), 60 * 60_000));
        c.pendingDoneDay = -1;
      }
    }

    // 8) binh luan - khong gan voi tien do
    for (const p of people) {
      if (!rng.chance(p.commentRate)) continue;
      const mine = openOf(p.id);
      if (mine.length > 0) rng.pick(mine).activityAt.push(at(day, 15 + rng.range(0, 2)));
    }

    // 9) 18h: truong nhom lui han (v1); M1 giao bu the chua ai nhan sat han; M2 nhac the bi bo quen
    const evening = at(day, 18);
    for (const c of cards) {
      if (c.status === 'DONE' || c.postponed >= 2) continue;
      const left = daysLeft(c, evening);
      if (left <= 0 || left > 1.5) continue;
      if (1 - c.remaining / c.hidden.effort >= 0.7 || !rng.chance(0.3)) continue;
      const to = new Date(c.dueDate.getTime() + (2 + rng.int(4)) * DAY_MS);
      c.dueEvents.push({ at: evening, from: c.dueDate, to });
      c.activityAt.push(evening);
      c.dueDate = to;
      c.postponed += 1;
    }
    if (h.unassignedShare !== null) {
      const rescueAt = new Date(evening.getTime() + 5 * 60_000);
      for (const c of cards) {
        if (!isOpen(c) || c.members.length > 0 || c.createdAt.getTime() > rescueAt.getTime()) continue;
        if (daysLeft(c, rescueAt) > RESCUE_DAYS_LEFT || !rng.chance(RESCUE_CHANCE)) continue;
        const least = [...people].sort((a, b) => openOf(a.id).length - openOf(b.id).length || (a.id < b.id ? -1 : 1))[0]!;
        assignTo(c, least.id, rescueAt);
      }
    }
    const remindAt = new Date(evening.getTime() + 10 * 60_000);
    for (const c of cards) {
      if (!c.forgotten || !isOpen(c)) continue;
      const left = daysLeft(c, remindAt);
      if (left <= 0) c.forgotten = false; // qua han moi nho ra (khong ghi gi)
      else if (left <= REMIND_DAYS_LEFT && rng.chance(REMIND_CHANCE)) {
        c.forgotten = false;
        c.activityAt.push(remindAt); // truong nhom binh luan nhac
      }
    }
  }

  const byTime = (a: Date, b: Date) => a.getTime() - b.getTime();
  const out: RiskCardHistory[] = cards.map((c) => ({
    id: c.id,
    title: c.title,
    description: c.description,
    createdAt: c.createdAt,
    startDate: c.startDate,
    dueDate: c.dueDate,
    status: c.status,
    completedAt: c.completedAt,
    storyPoints: c.storyPoints,
    members: c.members.map((m) => ({ ...m })),
    statusEvents: [...c.statusEvents].sort((a, b) => byTime(a.at, b.at)),
    dueEvents: [...c.dueEvents].sort((a, b) => byTime(a.at, b.at)),
    checklist: c.checklist.map((i) => ({ ...i })),
    activityAt: [...c.activityAt].sort(byTime),
  }));
  return {
    version: 2,
    seed,
    now: at(RISK_SIM_DAYS, 0),
    habits: h,
    disabled: [...disable],
    people,
    hidden: Object.fromEntries(cards.map((c) => [c.id, c.hidden])),
    cards: out,
  };
}

/** Sinh the gioi theo phien ban (v1 KHONG doi; v2 co the tat co che). */
export function generateWorld(seed: number, sim: SimVersion, disable: readonly Mechanism[] = []): RiskWorld {
  if (sim === 'v1') {
    if (disable.length > 0) throw new RangeError('v1 khong co co che de tat');
    return generateRiskWorld(seed);
  }
  return generateRiskWorldV2(seed, disable);
}

export function seedsOf(sim: SimVersion): { train: number[]; dev: number[]; confirm: number[] } {
  if (sim === 'v1') return { train: TRAIN_SEEDS, dev: DEV_SEEDS, confirm: CONFIRM_SEEDS };
  return { train: TRAIN_SEEDS_V2, dev: DEV_SEEDS_V2, confirm: CONFIRM_SEEDS_V2 };
}

// ---------- Kiem do phu (§20.4) ----------
export const COVERAGE_STATS = ['noAssignee', 'logDaysSinceActivity', 'logEvents7d', 'checklistShare', 'storyPointShare'] as const;
export type CoverageStat = (typeof COVERAGE_STATS)[number];

/** Nam thong ke cua bang §20.1 tren mot tap anh chup. */
export function coverageStats(rows: readonly SnapshotRow[]): Record<CoverageStat, number> {
  const n = Math.max(1, rows.length);
  const mean = (f: (r: SnapshotRow) => number) => rows.reduce((a, r) => a + f(r), 0) / n;
  return {
    noAssignee: mean((r) => r.features.values.noAssignee),
    logDaysSinceActivity: mean((r) => r.features.values.logDaysSinceActivity),
    logEvents7d: mean((r) => r.features.values.logEvents7d),
    checklistShare: mean((r) => (r.features.detail.progressSource === 'CHECKLIST' ? 1 : 0)),
    storyPointShare: 1 - mean((r) => r.features.values.pointsEstimated),
  };
}

/** Gia tri dev co nam trong [nho nhat; lon nhat] cua cac the gioi khong (§20.4). */
export function coverageCheck(worldStats: readonly Record<CoverageStat, number>[], dev: Record<CoverageStat, number>) {
  return COVERAGE_STATS.map((k) => {
    const vals = worldStats.map((w) => w[k]);
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    return { stat: k, dev: dev[k], min, max, covered: dev[k] >= min && dev[k] <= max };
  });
}
