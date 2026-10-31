// Phat lai lich su mo phong cho bo cham cap (assign.score.ts): dung "anh chup tai ngay d" chi voi
// thong tin biet duoc luc do, cham, roi doi chieu voi dap an tot nhat AN cua bo sinh. Dung chung cho
// showSuggestions.ts (xem bang mat) va test / buoc 7 (danh gia that).
//
// DOC ky nang an de DANH GIA - nen chi nam trong scripts/, module assign/ khong duoc import.

import { buildIdf, type Idf } from '../modules/assign/assign.tfidf';
import { countTerms } from '../modules/assign/assign.text';
import {
  groupOnTimeRate,
  LEGACY_WEIGHTS_V1,
  rankCandidates,
  type CandidateInput,
  type RankedCandidate,
  type OpenCard,
  type MissingPolicy,
  type Normalization,
  type ScoreParams,
  type Weights,
} from '../modules/assign/assign.score';
import type { DeclaredItem } from '../modules/assign/assign.declared';
import type { HistoryCard } from '../modules/assign/assign.profile';
import {
  assignablePool,
  bestCandidate,
  onTimeProbability,
  skillAt,
  type SimCard,
  type SimDataset,
  type SimPerson,
} from './simGenerator';
import { simDayToDate, vnToday } from './simSeed';

// Chup "hom nay" MOT LAN: vnToday() tao Intl.DateTimeFormat moi lan goi, ma phat lai goi hang nghin lan moi the.
const TODAY = vnToday();

/**
 * "Ngay so" cua bo mo phong -> thoi diem that, CUNG "hom nay" voi snapshotAsOf. Bo chay danh gia (buoc 7) dung ham nay
 * thay vi tu goi vnToday(): hai lan chup "hom nay" co the roi vao hai ben nua dem va lech nhau mot ngay.
 */
export const simDate = (days: number, day: number, hour = 0, minute = 0): Date =>
  simDayToDate(TODAY, days, day, hour, minute);

export interface Snapshot {
  now: Date;
  idf: Idf;
  mu: number | null;
  candidates: CandidateInput[];
}

/**
 * Anh chup "tai ngay `day`" chi voi thong tin biet duoc luc do. Cac the da xong SAU luc do van duoc
 * dua vao `history` cho nguoi cham tu bo (kiem chong roi ri tuong lai); the con mo luc do la nhung the
 * da giao (assignedDay <= day) va chua xong tinh den `now`. `declared` (buoc 14): muc ho so tu khai da cat san theo
 * khoa nguoi (simDeclared.ts); khong truyen = khong ai co ho so (ung vien khong co khoa `declared`, y nhu truoc).
 */
export function snapshotAsOf(
  data: SimDataset,
  day: number,
  hour: number,
  pool: readonly { key: string; capacity: number }[],
  targetKey: string | null,
  declared?: ReadonlyMap<string, readonly DeclaredItem[]>
): Snapshot {
  const at = (d: number, h = 0, m = 0) => simDayToDate(TODAY, data.config.days, d, h, m);
  const now = at(day, hour);
  // Kho ngu lieu chi gom cac the DA CO luc do
  const known = data.cards.filter((c) => c.createdDay <= day);
  const idf = buildIdf(known.map((c) => countTerms(c)));

  const done = data.cards.filter((c) => c.done && c.completedDay !== null);
  const asOutcome = done.map((c) => ({
    completedAt: at(c.completedDay!, 17),
    dueDate: at(c.dueDay, 23, 59),
    reopened: c.reopened,
  }));

  const candidates: CandidateInput[] = pool.map((p) => {
    const history: HistoryCard[] = done
      .filter((c) => c.assigneeKey === p.key)
      .map((c) => ({
        cardId: c.key,
        title: c.title,
        description: c.description,
        completedAt: at(c.completedDay!, 17),
        dueDate: at(c.dueDay, 23, 59),
        reopened: c.reopened,
      }));
    const openCards: OpenCard[] = data.cards
      .filter(
        (c) =>
          c.assigneeKey === p.key &&
          c.key !== targetKey &&
          c.assignedDay <= day &&
          (!c.done || c.completedDay === null || at(c.completedDay, 17).getTime() > now.getTime())
      )
      .map((c) => ({ cardId: c.key, startDate: at(c.assignedDay, 0), dueDate: at(c.dueDay, 23, 59) }));
    const base: CandidateInput = { userId: p.key, history, openCards, maxParallelCards: p.capacity, pausedUntil: null };
    return declared ? { ...base, declared: declared.get(p.key) ?? null } : base;
  });
  return { now, idf, mu: groupOnTimeRate(asOutcome, now), candidates };
}

export interface ReplayResult {
  n: number;
  hitScorer: number;
  hitActual: number;
  hitRandom: number;
  regretScorer: number;
  regretActual: number;
  regretRandom: number;
  topNoHistory: number;
  topThin: number;
  poolSize: number;
  /**
   * XAC SUAT DUNG HAN ky vong (mo hinh ket qua cua bo sinh, onTimeProbability) cua nguoi duoc chon, tinh voi tai
   * TAI LUC GIAO. Khac top-1 (chi xet ky nang), chi so nay co xet tai nen "cong bang" voi thanh phan kha dung.
   */
  pOnTimeScorer: number;
  pOnTimeActual: number;
  pOnTimeRandom: number;
  /** Nguoi co ky nang cao nhat (dap an cua top-1). */
  pOnTimeBest: number;
  /** TOI UU: nguoi co xac suat dung han cao nhat trong ho boi (can tren cua moi cach chon). */
  pOnTimeOracle: number;
}

export interface ReplayOptions {
  /** Cach chuan hoa thanh phan khi xep hang; mac dinh theo rankCandidates ('MINMAX'). */
  normalize?: Normalization;
  /** Cach xu ly thanh phan thieu; mac dinh theo rankCandidates ('DROP'). */
  missing?: MissingPolicy;
  /** Mac dinh LEGACY_WEIGHTS_V1 (ghim so lieu buoc 4-7, §17.6), KHONG phai DEFAULT_WEIGHTS cua san pham. */
  weights?: Weights;
  params?: Partial<ScoreParams>;
  /** Chi phat lai the giao tu ngay nay tro di (truoc do chua ai co lich su). */
  minDay?: number;
}

/** Mot the duoc phat lai: ho boi ung vien, ket qua xep hang tai thoi diem giao, va dap an tot nhat AN. */
export interface ReplayTarget {
  card: SimCard;
  pool: SimPerson[];
  ranked: RankedCandidate[];
  best: { key: string; skill: number };
  skillOf: (key: string) => number;
}

/**
 * Voi moi the giao tu `minDay` tro di (ho boi >= 2 nguoi): dung anh chup tai luc giao, cham + xep hang.
 * Dung chung cho replay() va componentSpread() de hai phep do dung CUNG mot tap tinh huong.
 */
export function* replayTargets(data: SimDataset, opts: ReplayOptions = {}): Generator<ReplayTarget> {
  const at = (d: number, h = 0, m = 0) => simDayToDate(TODAY, data.config.days, d, h, m);
  for (const c of data.cards) {
    if (c.assignedDay < (opts.minDay ?? 60)) continue;
    const pool = assignablePool(data.people, c.assignedDay, c.dueDay);
    if (pool.length < 2) continue;
    const snap = snapshotAsOf(
      data,
      c.assignedDay,
      10,
      pool.map((p) => ({ key: p.key, capacity: p.capacity })),
      c.key
    );
    const ranked = rankCandidates(
      { id: c.key, title: c.title, description: c.description, startDate: at(c.assignedDay), dueDate: at(c.dueDay, 23, 59) },
      snap.candidates,
      {
        idf: snap.idf,
        now: snap.now,
        groupOnTimeRate: snap.mu,
        weights: opts.weights ?? LEGACY_WEIGHTS_V1,
        params: opts.params,
        normalize: opts.normalize,
        missing: opts.missing,
      }
    );
    yield {
      card: c,
      pool,
      ranked,
      best: bestCandidate(data.people, c),
      skillOf: (key) => skillAt(data.people.find((p) => p.key === key)!, c.topic, c.assignedDay),
    };
  }
}

export function replay(data: SimDataset, opts: ReplayOptions = {}): ReplayResult {
  let n = 0;
  let hitS = 0;
  let hitA = 0;
  let hitR = 0;
  let regS = 0;
  let regA = 0;
  let regR = 0;
  let noHist = 0;
  let thin = 0;
  let pools = 0;
  let pS = 0;
  let pA = 0;
  let pR = 0;
  let pB = 0;
  let pO = 0;

  for (const t of replayTargets(data, opts)) {
    const top = t.ranked[0]!;
    // Xac suat dung han ky vong cua tung nguoi trong ho boi, voi tai luc giao (chinh cai bo cham nhin thay)
    const info = new Map(t.ranked.map((r) => [r.userId, r]));
    const pOn = (key: string) => onTimeProbability(t.skillOf(key), info.get(key)!.load, info.get(key)!.capacity);
    const pOns = t.pool.map((p) => pOn(p.key));
    pS += pOn(top.userId);
    pA += pOn(t.card.assigneeKey);
    pR += pOns.reduce((a, b) => a + b, 0) / pOns.length;
    pB += pOn(t.best.key);
    pO += Math.max(...pOns);
    n += 1;
    hitS += top.userId === t.best.key ? 1 : 0;
    hitA += t.card.assigneeKey === t.best.key ? 1 : 0;
    hitR += 1 / t.pool.length;
    regS += t.best.skill - t.skillOf(top.userId);
    regA += t.best.skill - t.skillOf(t.card.assigneeKey);
    regR += t.best.skill - t.pool.reduce((s, p) => s + t.skillOf(p.key), 0) / t.pool.length;
    noHist += top.flags.includes('NO_HISTORY') ? 1 : 0;
    thin += top.confidenceLevel === 'THIN' ? 1 : 0;
    pools += t.pool.length;
  }
  return {
    n,
    hitScorer: hitS / n,
    hitActual: hitA / n,
    hitRandom: hitR / n,
    regretScorer: regS / n,
    regretActual: regA / n,
    regretRandom: regR / n,
    topNoHistory: noHist / n,
    topThin: thin / n,
    poolSize: pools / n,
    pOnTimeScorer: pS / n,
    pOnTimeActual: pA / n,
    pOnTimeRandom: pR / n,
    pOnTimeBest: pB / n,
    pOnTimeOracle: pO / n,
  };
}

export type ComponentName = 'experience' | 'reliability' | 'availability';

export interface SpreadStat {
  /** Trung binh gia tri cua thanh phan tren cac ung vien co du lieu. */
  mean: number;
  /** Do lech chuan GIUA CAC UNG VIEN cua cung mot the, trung binh tren cac the. */
  sd: number;
  /** max - min giua cac ung vien cua cung mot the, trung binh tren cac the. */
  range: number;
  /**
   * Do lech chuan giua cac ung vien cua gia tri DUNG DE CONG (`scaled`): bang `sd` khi khong chuan hoa, con
   * sau chuan hoa 'MINMAX' thi cac thanh phan co do phan tan gan nhau -> trong so moi la anh huong thuc te.
   */
  scaledSd: number;
  /** Tuong quan Pearson (ky nang an, thanh phan) trong ho boi, trung binh tren cac the. */
  corrWithSkill: number;
  /** So the co it nhat 2 ung vien co du lieu cho thanh phan nay. */
  n: number;
}

/**
 * Do PHAN TAN cua tung thanh phan giua cac ung vien cua cung mot the. Trong mot tong co trong so, anh
 * huong THUC TE len thu tu xep hang ~ trong so x do phan tan: thanh phan tran rong nhat quyet dinh thu
 * tu ke ca khi trong so danh nghia nho. Xem ASSIGN_MODULE.md (nhat ky buoc 4).
 */
export function componentSpread(datasets: readonly SimDataset[], opts: ReplayOptions = {}): Record<ComponentName, SpreadStat> {
  const names: ComponentName[] = ['experience', 'reliability', 'availability'];
  const acc = Object.fromEntries(
    names.map((k) => [
      k,
      { means: [] as number[], sds: [] as number[], scaledSds: [] as number[], ranges: [] as number[], corrs: [] as number[] },
    ])
  ) as Record<ComponentName, { means: number[]; sds: number[]; scaledSds: number[]; ranges: number[]; corrs: number[] }>;
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

  for (const data of datasets) {
    for (const t of replayTargets(data, opts)) {
      for (const k of names) {
        const rows = t.ranked
          .map((r) => ({ v: r.components[k].value, skill: t.skillOf(r.userId) }))
          .filter((x): x is { v: number; skill: number } => x.v !== null);
        if (rows.length < 2) continue;
        const vs = rows.map((r) => r.v);
        const m = avg(vs);
        acc[k].means.push(m);
        acc[k].sds.push(Math.sqrt(avg(vs.map((v) => (v - m) ** 2))));
        const sc = t.ranked.map((r) => r.components[k].scaled).filter((x): x is number => x !== null);
        const msc = avg(sc);
        acc[k].scaledSds.push(Math.sqrt(avg(sc.map((v) => (v - msc) ** 2))));
        acc[k].ranges.push(Math.max(...vs) - Math.min(...vs));
        const ms = avg(rows.map((r) => r.skill));
        let sxy = 0;
        let sxx = 0;
        let syy = 0;
        for (const r of rows) {
          sxy += (r.skill - ms) * (r.v - m);
          sxx += (r.skill - ms) ** 2;
          syy += (r.v - m) ** 2;
        }
        if (sxx > 0 && syy > 0) acc[k].corrs.push(sxy / Math.sqrt(sxx * syy));
      }
    }
  }
  return Object.fromEntries(
    names.map((k) => [
      k,
      {
        mean: avg(acc[k].means),
        sd: avg(acc[k].sds),
        range: avg(acc[k].ranges),
        scaledSd: avg(acc[k].scaledSds),
        corrWithSkill: avg(acc[k].corrs),
        n: acc[k].sds.length,
      },
    ])
  ) as Record<ComponentName, SpreadStat>;
}
