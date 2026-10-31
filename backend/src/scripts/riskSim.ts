// Bo mo phong VONG DOI the cho module canh bao tre han (RISK_MODULE.md §7.2, §7.3). HAM THUAN, TAT DINH theo hat giong.
//
// Mo phong TUNG NGAY lam viec. Dung han / tre han la KET QUA cua qua trinh (khoi luong that, toc do that, do cham, bi chan,
// truong nhom lui han...), KHONG phai tu mot cong thuc dat san tren cac dac trung - mo hinh phai SUY ra qua trinh tu dau vet.
//
// PHAN AN (mo hinh khong bao gio thay - chi nam trong `hidden` / `people`): toc do that (ngay / diem), do cham (xac suat lam viec
// trong ngay), thoi quen tick checklist (tick dan hay don cuoi), khoi luong that cua the (= story point x nhieu x do kho an cua chu de).
// PHAN QUAN SAT DUOC (RiskCardHistory): dung nhu CSDL that se luu - tieu de, han, story point (40% khong nhap), checklist + moc
// tick, nguoi duoc giao + luc giao, dong thoi gian trang thai / han, moc cac dong nhat ky.
//
// Module risk/ KHONG DUOC import tep nay (bo mo phong biet phan an).

import { DAY_MS, type RiskCardHistory, type RiskChecklistItem, type RiskDueEvent, type RiskStatus, type RiskStatusEvent } from '../modules/risk/risk.history';
import { streamSeed } from './evalAssignStats';
import { Rng } from './simGenerator';
import { TOPICS } from './simVocab';

export const RISK_SIM_START = Date.parse('2025-03-03T00:00:00.000Z');
/** Do dai the gioi (ngay); "bay gio" cua the gioi = ngay cuoi. */
export const RISK_SIM_DAYS = 180;
/** Ngung tao the moi tu ngay nay (de cuoi the gioi con the dang mo, giong du lieu that). */
export const RISK_SIM_LAST_CREATE_DAY = 165;

/** Hat giong (§7.2): hoc / dev (chon lambda, tham do) / xac nhan (chay DUNG MOT LAN o buoc 8). */
export const TRAIN_SEEDS = range(6001, 6040);
export const DEV_SEEDS = range(6101, 6120);
export const CONFIRM_SEEDS = range(6201, 6220);

function range(a: number, b: number): number[] {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

const HOUR_MS = 3_600_000;
export const POINT_SCALE = [1, 2, 3, 5, 8] as const;

export interface SimRiskPerson {
  id: string;
  /** AN: so ngay lam viec can cho 1 diem khoi luong. */
  speed: number;
  /** AN: xac suat lam viec trong 1 ngay. */
  diligence: number;
  /** AN: don het tick checklist vao luc xong (thay vi tick dan). */
  batchTicker: boolean;
  /** AN: xac suat binh luan trong 1 ngay (KHONG gan voi tien do). */
  commentRate: number;
}

export interface SimRiskHidden {
  topic: number;
  /** Khoi luong that (diem tuong duong). */
  effort: number;
  /** Story point that (truoc khi bi an 40%). */
  truePoints: number;
}

export interface RiskWorld {
  seed: number;
  now: Date;
  people: SimRiskPerson[];
  cards: RiskCardHistory[];
  hidden: Record<string, SimRiskHidden>;
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
  // phan an + trang thai mo phong
  hidden: SimRiskHidden;
  remaining: number;
  assignDay: number;
  blockedUntilDay: number;
  reviewDoneDay: number;
  postponed: number;
}

/** Phan phoi chuan (Box-Muller) tu bo sinh tat dinh. */
export function normal(rng: Rng): number {
  const u = Math.max(1e-12, rng.next());
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function generateRiskWorld(seed: number): RiskWorld {
  if (!Number.isInteger(seed) || seed < 0) throw new RangeError('seed phai la so nguyen >= 0');
  const rng = new Rng(streamSeed(seed, 0, 41));
  const at = (day: number, hour: number) => new Date(RISK_SIM_START + day * DAY_MS + hour * HOUR_MS);

  // ---- nguoi ----
  const people: SimRiskPerson[] = Array.from({ length: 6 + rng.int(5) }, (_, i) => ({
    id: `w${seed}-u${i}`,
    speed: Math.exp(Math.log(0.8) + 0.35 * normal(rng)),
    diligence: rng.range(0.55, 0.95),
    batchTicker: rng.chance(0.3),
    commentRate: rng.range(0.02, 0.25),
  }));
  const teamSpeed = people.reduce((a, p) => a + p.speed / p.diligence, 0) / people.length;
  // Do kho AN cua tung chu de: co chu de luon ton cong hon uoc luong
  const topicOverrun = TOPICS.map(() => Math.exp(0.3 * normal(rng)));

  const cards: Working[] = [];
  const openOf = (userId: string) => cards.filter((c) => c.status !== 'DONE' && c.members.some((m) => m.userId === userId));

  const setStatus = (c: Working, to: RiskStatus, when: Date) => {
    if (c.status === to) return;
    c.statusEvents.push({ at: when, from: c.status, to });
    c.activityAt.push(when);
    c.status = to;
  };
  const assign = (c: Working, when: Date) => {
    const weights = people.map((p) => (1 / (1 + openOf(p.id).length)) * rng.range(0.5, 1.5));
    const first = rng.weighted(people, weights);
    c.members.push({ userId: first.id, createdAt: when });
    c.activityAt.push(when);
    if (rng.chance(0.15)) {
      const others = people.filter((p) => p.id !== first.id);
      const second = rng.pick(others);
      c.members.push({ userId: second.id, createdAt: when });
    }
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

  for (let day = 0; day < RISK_SIM_DAYS; day += 1) {
    // 1) tao the moi (~0,9 the / ngay)
    if (day < RISK_SIM_LAST_CREATE_DAY) {
      const born = (rng.chance(0.45) ? 1 : 0) + (rng.chance(0.45) ? 1 : 0);
      for (let k = 0; k < born; k += 1) {
        const topic = rng.int(TOPICS.length);
        const tp = TOPICS[topic]!;
        const truePoints = rng.weighted(POINT_SCALE, [0.15, 0.25, 0.3, 0.2, 0.1]);
        const effort = truePoints * topicOverrun[topic]! * Math.exp(0.35 * normal(rng));
        const createdAt = at(day, 8 + rng.range(0, 3));
        const items = rng.chance(0.7) ? Math.min(14, Math.max(1, Math.round(truePoints * rng.range(0.8, 1.6)))) : 0;
        const leadDays = Math.ceil(truePoints * teamSpeed * rng.range(0.9, 1.6) + rng.range(1, 3));
        const startOffset = rng.chance(0.3) ? rng.int(3) : -1;
        const id = `w${seed}-c${cards.length}`;
        const c: Working = {
          id,
          title: `${rng.pick(tp.verbs)} ${rng.pick(tp.objects)}${rng.chance(0.4) ? ` ${rng.pick(tp.details)}` : ''}`,
          description: rng.chance(0.6) ? `${rng.pick(tp.descWords)} ${rng.pick(tp.descWords)}` : null,
          createdAt,
          startDate: startOffset >= 0 ? at(day + startOffset, 8) : null,
          dueDate: at(day + leadDays, 17),
          storyPoints: rng.chance(0.6) ? truePoints : null,
          members: [],
          statusEvents: [],
          dueEvents: [],
          checklist: Array.from({ length: items }, () => ({ createdAt, isDone: false, completedAt: null })),
          activityAt: [createdAt],
          status: 'TODO',
          completedAt: null,
          hidden: { topic, effort, truePoints },
          remaining: effort,
          assignDay: rng.chance(0.85) ? day : day + 1 + rng.int(4),
          blockedUntilDay: -1,
          reviewDoneDay: -1,
          postponed: 0,
        };
        cards.push(c);
      }
    }

    // 2) giao viec den han
    for (const c of cards) if (c.members.length === 0 && c.assignDay === day) assign(c, at(day, 11));

    // 3) bi chan / het chan (doc lap voi nguoi)
    for (const c of cards) {
      if (c.status === 'BLOCKED' && day >= c.blockedUntilDay) setStatus(c, 'IN_PROGRESS', at(day, 9));
      else if (c.status === 'IN_PROGRESS' && rng.chance(0.03)) {
        setStatus(c, 'BLOCKED', at(day, 11.5));
        c.blockedUntilDay = day + 1 + Math.floor(-Math.log(Math.max(1e-12, rng.next())) * 2);
      }
    }

    // 4) lam viec
    for (const p of people) {
      if (!rng.chance(p.diligence)) continue;
      const mine = cards.filter(
        (c) =>
          (c.status === 'TODO' || c.status === 'IN_PROGRESS') &&
          c.members.some((m) => m.userId === p.id) &&
          (c.startDate === null || c.startDate.getTime() <= at(day, 23).getTime())
      );
      if (mine.length === 0) continue;
      const c = rng.chance(0.8) ? [...mine].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0]! : rng.pick(mine);
      // Hai nguoi cung lam 1 the trong 1 ngay: moc lam viec phai di SAU su kien trang thai truoc cua the (khong thi dong thoi
      // gian trang thai bi dao: "xong" luc 13h roi "bat dau lam" luc 16h - test bat bien da bat duoc loi nay)
      const lastAt = c.statusEvents.at(-1)?.at.getTime() ?? 0;
      const when = new Date(Math.max(at(day, 13 + rng.range(0, 4)).getTime(), lastAt + 5 * 60_000));
      if (c.status === 'TODO') setStatus(c, 'IN_PROGRESS', when);
      c.remaining -= 1 / p.speed;
      if (rng.chance(0.05)) c.activityAt.push(new Date(when.getTime() + 10 * 60_000)); // dinh kem
      if (c.remaining > 0) {
        if (!p.batchTicker && c.checklist.length > 0) {
          const progress = 1 - c.remaining / c.hidden.effort;
          tickUpTo(c, Math.floor(progress * c.checklist.length), new Date(when.getTime() + 5 * 60_000));
        }
        continue;
      }
      if (rng.chance(0.5)) {
        setStatus(c, 'IN_REVIEW', new Date(when.getTime() + 20 * 60_000));
        c.reviewDoneDay = day + rng.int(3);
      } else {
        finish(c, new Date(when.getTime() + 30 * 60_000));
      }
    }

    // 5) duyet xong
    for (const c of cards) {
      if (c.status === 'IN_REVIEW' && day >= c.reviewDoneDay) {
        const t = at(day, 20);
        const after = new Date(Math.max(t.getTime(), (c.statusEvents.at(-1)?.at.getTime() ?? 0) + 60 * 60_000));
        finish(c, after);
      }
    }

    // 6) binh luan - khong gan voi tien do
    for (const p of people) {
      if (!rng.chance(p.commentRate)) continue;
      const mine = openOf(p.id);
      if (mine.length > 0) rng.pick(mine).activityAt.push(at(day, 15 + rng.range(0, 2)));
    }

    // 7) truong nhom lui han khi thay cham sat han
    const evening = at(day, 18);
    for (const c of cards) {
      if (c.status === 'DONE' || c.postponed >= 2) continue;
      const left = (c.dueDate.getTime() - evening.getTime()) / DAY_MS;
      if (left <= 0 || left > 1.5) continue;
      if (1 - c.remaining / c.hidden.effort >= 0.7 || !rng.chance(0.3)) continue;
      const to = new Date(c.dueDate.getTime() + (2 + rng.int(4)) * DAY_MS);
      c.dueEvents.push({ at: evening, from: c.dueDate, to });
      c.activityAt.push(evening);
      c.dueDate = to;
      c.postponed += 1;
    }
  }

  const byTime = (a: Date, b: Date) => a.getTime() - b.getTime();
  return {
    seed,
    now: at(RISK_SIM_DAYS, 0),
    people,
    hidden: Object.fromEntries(cards.map((c) => [c.id, c.hidden])),
    cards: cards.map((c) => ({
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
    })),
  };
}

/** Tom tat 1 the gioi de do / in (ti le tre tren the da xong co han, so the...). */
export function summarizeWorld(w: RiskWorld) {
  const done = w.cards.filter((c) => c.completedAt !== null);
  const late = done.filter((c) => c.completedAt!.getTime() > c.dueDate!.getTime());
  const open = w.cards.filter((c) => c.completedAt === null);
  const overdue = open.filter((c) => c.dueDate!.getTime() < w.now.getTime());
  return {
    seed: w.seed,
    people: w.people.length,
    cards: w.cards.length,
    done: done.length,
    lateRate: done.length > 0 ? late.length / done.length : 0,
    open: open.length,
    overdueOpen: overdue.length,
    postponed: w.cards.filter((c) => c.dueEvents.length > 0).length,
    blocked: w.cards.filter((c) => c.statusEvents.some((e) => e.to === 'BLOCKED')).length,
    withPoints: w.cards.filter((c) => c.storyPoints !== null).length,
    withChecklist: w.cards.filter((c) => c.checklist.length > 0).length,
  };
}
