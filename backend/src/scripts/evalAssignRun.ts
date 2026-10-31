// Bo CHAY danh gia goi y phan cong (buoc 7, ASSIGN_MODULE.md §11): cho mot NHANH (evalAssignArms.ts) chay tren mot bo du
// lieu mo phong, ghi tung quyet dinh va tong hop so do. KHONG Prisma, KHONG dong ho, KHONG mang - tat dinh.
//
// BA CHE DO (khac nhau o "the gioi" ma nhanh nhin thay va o ai thuc su giao viec):
//   HISTORY  the gioi = lich su cua bo sinh, CO DINH. Nhanh chi xep hang; ket qua tai hien replay() cu (doi chieu tung
//            con so). Do duoc chat luong xep hang, KHONG do duoc viec don ve mot nguoi hay tai tu dieu chinh.
//   ARM      VONG KIN: nhanh TU GIAO nguoi xep dau; ket qua rut tu CUNG mo hinh ket qua cua bo sinh (sampleOutcome, ky
//            nang an + tai that); lich su tich luy theo chinh cac lua chon cua nhanh. Day la cho do duoc Gini, tai va
//            "bay nguoi moi" (khong duoc giao thi mai khong co lich su).
//   LEADER   truong nhom (gia) giao viec, nhanh chi GOI Y va nhan phan hoi (buoc 7b: hoc trong so).
//
// SO SANH CAP: moi the co luong ngau nhien RIENG (streamSeed) cho ket qua, cho nhanh ngau nhien va cho truong nhom, giong
// het nhau o moi nhanh -> hai nhanh chi khac nhau o NGUOI DUOC CHON, khong phai may rui (phuong sai thap hon nhieu).
//
// DOC ky nang an de DANH GIA - chi nam trong scripts/, module assign/ khong bao gio import. Bo cham (qua Arm) khong thay chung.

import type { DeclaredItem } from '../modules/assign/assign.declared';
import { LEGACY_WEIGHTS_V1, rankCandidates, type RankedCandidate, type ScoreCard, type Weights } from '../modules/assign/assign.score';
import type { Arm, ArmInput, ArmOutput, Oracle } from './evalAssignArms';
import { gini, maxShare, streamSeed } from './evalAssignStats';
import {
  DEFAULT_LOAD_PENALTY,
  Rng,
  assignablePool,
  bestCandidate,
  onTimeProbability,
  sampleOutcome,
  skillAt,
  type Outcome,
  type SimCard,
  type SimDataset,
  type SimPerson,
} from './simGenerator';
import { simDate, snapshotAsOf } from './simReplay';

export type RunMode = 'HISTORY' | 'ARM' | 'LEADER';

/** Truong nhom gia: chon mot nguoi trong danh sach da xep hang (dung cac gia tri ma giao dien hien ra). */
export interface Leader {
  pick(input: { cardKey: string; ranked: readonly RankedCandidate[]; rng: Rng }): string;
}

export interface RunOptions {
  mode: RunMode;
  /** Chi quyet dinh cac the giao tu ngay nay tro di; truoc do giu lich su cua bo sinh (nhu replay). Mac dinh 60. */
  minDay?: number;
  /** He so phat tai cua the gioi (mac dinh cua bo sinh). */
  loadPenalty?: number;
  /** Suc chua ma BO CHAM tin cho moi nguoi (mac dinh: suc chua that - nhu khi moi nguoi da khai ho so). */
  assumedCapacity?: number;
  /**
   * Truong nhom gia. Che do LEADER: nguoi thuc su giao viec. Che do HISTORY / ARM: chi cho PHAN HOI (nhanh co hoc) - "truong
   * nhom se chon ai neu duoc hoi" - the gioi van theo lich su / theo nhanh.
   */
  leader?: Leader;
  /** Tra lai the gioi cuoi cung (de kiem thu). */
  keepWorld?: boolean;
  /** CHI DE KIEM THU: dung ket qua cua bo sinh thay vi rut (chi hop le khi nguoi duoc giao trung nguoi cua bo sinh). */
  replayOutcomes?: boolean;
  /** Buoc 14: muc ho so tu khai da cat san theo khoa nguoi (simDeclared.ts) - dua vao anh chup cua moi quyet dinh. */
  declared?: ReadonlyMap<string, readonly DeclaredItem[]>;
  /**
   * Buoc 14 - the gioi W2 "NHOM MOI" (§17.10): xoa trang (khong nguoi nhan, khong ket qua) moi the giao TRUOC `minDay` -> luc bat
   * dau danh gia khong ai co lich su hay tai. Chu cua cac the do van o kho IDF (xoa trang, khong xoa: vi tri the la khoa cua luong
   * ngau nhien).
   */
  coldStart?: boolean;
}

/**
 * 20 hat giong DANH GIA cua buoc 7 (chua tung dung de CHON gi o cac buoc truoc: buoc 2-6 dung 20260920 va 1..6). Hat giong phat
 * trien / kiem thu la 9xxx, khong nam trong tap nay. Tham so giu dung mac dinh da duyet - khong chon "cau hinh dep nhat".
 */
export const EVAL_SEEDS: readonly number[] = Array.from({ length: 20 }, (_, i) => 2001 + i);

export const DEFAULT_MIN_DAY = 60;
/** Gio "hom nay" cua quyet dinh: giong replayTargets. */
const DECISION_HOUR = 10;
/** Muc dich cua tung luong ngau nhien RIENG cua moi the; phai doi mot (neu trung, ket qua va lua chon tuong quan ngam). */
export const STREAM_SALTS = { outcome: 1, arm: 2, leader: 3, declared: 4 } as const;

/** Mot quyet dinh cua nhanh. */
export interface DecisionRecord {
  index: number;
  cardKey: string;
  day: number;
  poolKeys: string[];
  /** Nguoi nhanh xep dau (goi y). */
  topKey: string;
  /** Nguoi co ky nang an cao nhat trong ho boi (dap an cua Top-k / MRR / hoi tiec). */
  bestKey: string;
  /** Hang (tinh tu 1) cua nguoi tot nhat trong thu tu cua nhanh. */
  rankOfBest: number;
  /** Ky nang cua nguoi tot nhat tru ky nang cua nguoi xep dau. */
  regret: number;
  /** Xac suat dung han cua nguoi xep dau, voi tai luc giao (mo hinh ket qua cua bo sinh). */
  pOnTimeTop: number;
  topHasNoHistory: boolean;
  /** Nguoi thuc su giu the: nguoi xep dau (ARM), truong nhom (LEADER), hoac nguoi bo sinh da giao (HISTORY). */
  assignedKey: string;
  pOnTimeAssigned: number;
  regretAssigned: number;
  hitAssigned: boolean;
  /** Nguoi truong nhom gia se chon (neu co truong nhom). */
  leaderKey: string | null;
  /** Ket qua da rut cua the (ARM / LEADER); null neu chua xong den hom nay hoac o che do HISTORY. */
  onTime: boolean | null;
  /** Gia tri ky vong neu chon NGAU NHIEN trong ho boi (tham chieu, khong phai nhanh). */
  chanceTop1: number;
  chanceRegret: number;
  chancePOnTime: number;
  /** Trong so cua nhanh SAU quyet dinh nay (nhanh dung bo cham); null voi nhanh khong dung. */
  weights: Weights | null;
  /** So the nguoi TOT NHAT da xong tinh den luc quyet dinh (the gioi cua nhanh) - loc "quyet dinh lanh" W3 (§17.10). */
  bestDoneCount: number;
}

export interface RunSummary {
  decisions: number;
  // --- Chat luong GOI Y (nguoi xep dau) ---
  top1: number;
  top3: number;
  mrr: number;
  regret: number;
  /** Xac suat dung han ky vong cua nguoi xep dau - CHI SO CHINH. */
  pOnTime: number;
  /** Ti le quyet dinh ma nguoi xep dau chua co the nao da xong (NO_HISTORY). */
  topNoHistory: number;
  /** Do tap trung cua cac goi y: Gini cua so lan moi nguoi duoc xep dau, va phan cua nguoi nhieu nhat. */
  giniTop: number;
  maxShareTop: number;
  // --- Viec THUC SU giao ---
  giniAssigned: number;
  maxShareAssigned: number;
  top1Assigned: number;
  regretAssigned: number;
  pOnTimeAssigned: number;
  /** Ti le dung han THUC cua cac the da xong (ARM / LEADER); null neu khong co / che do HISTORY. */
  onTimeRealised: number | null;
  /** Nguoi vao muon: (viec ho nhan) / (phan chia deu neu ai cung nhu ai). 1 = cong bang; null neu khong co nguoi vao muon. */
  newcomerParity: number | null;
  /** Ti le viec giao dung nguoi xep dau. */
  acceptance: number;
  // --- Tham chieu ngau nhien (ky vong) ---
  chanceTop1: number;
  chanceRegret: number;
  chancePOnTime: number;
}

export interface RunResult {
  summary: RunSummary;
  decisions: DecisionRecord[];
  finalWeights: Weights | null;
  /** The gioi cuoi cung, chi khi keepWorld. */
  world: SimDataset | null;
}

// ---------- Ke hoach quyet dinh ----------

export interface PlannedDecision {
  card: SimCard;
  /** Vi tri trong data.cards - khoa cua luong ngau nhien rieng cua the. */
  cardIndex: number;
  pool: SimPerson[];
}

/**
 * Cac the ma nhanh phai quyet dinh: giao tu `minDay`, ho boi >= 2 nguoi (dung tap cua replayTargets), theo THOI GIAN
 * (cung ngay thi theo thu tu trong bo) - de lich su tich luy dung thu tu nhan qua.
 */
export function planDecisions(data: SimDataset, minDay: number): PlannedDecision[] {
  const out: PlannedDecision[] = [];
  data.cards.forEach((card, cardIndex) => {
    if (card.assignedDay < minDay) return;
    const pool = assignablePool(data.people, card.assignedDay, card.dueDay);
    if (pool.length < 2) return;
    out.push({ card, cardIndex, pool });
  });
  return out.sort((a, b) => a.card.assignedDay - b.card.assignedDay || a.cardIndex - b.cardIndex);
}

/** The chua duoc quyet dinh: chua ai nhan, chua xong - khong anh huong lich su hay tai cua ai. */
/** Xoa trang mot the (khong nguoi nhan, khong ket qua) - dung cho the gioi "nhom moi" (W2) o ca lop 1 lan lop 2 (evalPlanBatches). */
export const blankCard = (c: SimCard): SimCard => ({
  ...c,
  assigneeKey: '',
  done: false,
  completedDay: null,
  onTime: false,
  reopened: false,
});

const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

function isPermutation(order: readonly string[], keys: readonly string[]): boolean {
  if (order.length !== keys.length) return false;
  const want = new Set(keys);
  return want.size === keys.length && order.every((k) => want.delete(k));
}

// ---------- Tong hop ----------

/**
 * Tong hop cac quyet dinh thanh so do. HAM THUAN. `newcomerKeys` = nhung nguoi vao SAU khi phase danh gia bat dau.
 * Gini tinh tren nhung nguoi tung nam trong ho boi it nhat mot lan (nguoi chua vao / da roi khong tinh la "nhan 0 viec").
 */
export function summarizeDecisions(ds: readonly DecisionRecord[], newcomerKeys: readonly string[] = []): RunSummary {
  if (ds.length === 0) throw new RangeError('khong co quyet dinh nao de tong hop');
  const everInPool = [...new Set(ds.flatMap((d) => d.poolKeys))].sort();
  const countBy = (pick: (d: DecisionRecord) => string) =>
    everInPool.map((k) => ds.filter((d) => pick(d) === k).length);
  const topCounts = countBy((d) => d.topKey);
  const assignedCounts = countBy((d) => d.assignedKey);

  // Phan chia deu ky vong cua tung nguoi = tong 1/|ho boi| tren cac quyet dinh ho co mat
  let fairNewcomers = 0;
  for (const d of ds) {
    for (const k of newcomerKeys) if (d.poolKeys.includes(k)) fairNewcomers += 1 / d.poolKeys.length;
  }
  const newcomerPicks = ds.filter((d) => newcomerKeys.includes(d.assignedKey)).length;

  const realised = ds.filter((d) => d.onTime !== null);
  return {
    decisions: ds.length,
    top1: mean(ds.map((d) => (d.rankOfBest === 1 ? 1 : 0))),
    top3: mean(ds.map((d) => (d.rankOfBest <= 3 ? 1 : 0))),
    mrr: mean(ds.map((d) => 1 / d.rankOfBest)),
    regret: mean(ds.map((d) => d.regret)),
    pOnTime: mean(ds.map((d) => d.pOnTimeTop)),
    topNoHistory: mean(ds.map((d) => (d.topHasNoHistory ? 1 : 0))),
    giniTop: gini(topCounts),
    maxShareTop: maxShare(topCounts),
    giniAssigned: gini(assignedCounts),
    maxShareAssigned: maxShare(assignedCounts),
    top1Assigned: mean(ds.map((d) => (d.hitAssigned ? 1 : 0))),
    regretAssigned: mean(ds.map((d) => d.regretAssigned)),
    pOnTimeAssigned: mean(ds.map((d) => d.pOnTimeAssigned)),
    onTimeRealised: realised.length === 0 ? null : mean(realised.map((d) => (d.onTime ? 1 : 0))),
    newcomerParity: fairNewcomers > 0 ? newcomerPicks / fairNewcomers : null,
    acceptance: mean(ds.map((d) => (d.assignedKey === d.topKey ? 1 : 0))),
    chanceTop1: mean(ds.map((d) => d.chanceTop1)),
    chanceRegret: mean(ds.map((d) => d.chanceRegret)),
    chancePOnTime: mean(ds.map((d) => d.chancePOnTime)),
  };
}

// ---------- Bo chay ----------

function resolveOptions(o: RunOptions) {
  if (o.mode !== 'HISTORY' && o.mode !== 'ARM' && o.mode !== 'LEADER') throw new RangeError('mode phai la HISTORY | ARM | LEADER');
  if (o.mode === 'LEADER' && !o.leader) throw new RangeError('che do LEADER can truong nhom (leader)');
  const minDay = o.minDay ?? DEFAULT_MIN_DAY;
  if (!Number.isInteger(minDay) || minDay < 0) throw new RangeError('minDay phai la so nguyen >= 0');
  const loadPenalty = o.loadPenalty ?? DEFAULT_LOAD_PENALTY;
  if (!Number.isFinite(loadPenalty) || loadPenalty < 0) throw new RangeError('loadPenalty phai la so huu han >= 0');
  if (o.assumedCapacity !== undefined && (!Number.isInteger(o.assumedCapacity) || o.assumedCapacity < 1)) {
    throw new RangeError('assumedCapacity phai la so nguyen >= 1');
  }
  return { mode: o.mode, minDay, loadPenalty, assumedCapacity: o.assumedCapacity };
}

/** Chay mot nhanh tren mot bo du lieu. `makeArm` tao ban MOI (nhanh co trang thai). */
export function runArm(data: SimDataset, makeArm: () => Arm, opts: RunOptions): RunResult {
  const { mode, minDay, loadPenalty, assumedCapacity } = resolveOptions(opts);
  const arm = makeArm();
  const cfg = data.config;
  const at = (d: number, h = 0, m = 0) => simDate(cfg.days, d, h, m);
  const people = new Map(data.people.map((p) => [p.key, p]));
  const plan = planDecisions(data, minDay);

  // The gioi cua nhanh. HISTORY: chinh bo du lieu (khong bao gio sua). Con lai: cac the nhanh se quyet dinh bi xoa trang
  // cho den luc quyet dinh - neu khong, lich su + tai do BO SINH giao se ro vao the gioi cua nhanh.
  const decidedKeys = new Set(plan.map((p) => p.card.key));
  const mutable = mode !== 'HISTORY';
  const world: SimDataset = {
    ...data,
    cards:
      mutable || opts.coldStart
        ? data.cards.map((c) => (decidedKeys.has(c.key) && mutable) || (opts.coldStart && c.assignedDay < minDay) ? blankCard(c) : c)
        : data.cards,
  };

  const decisions: DecisionRecord[] = [];
  for (const { card: c, cardIndex, pool } of plan) {
    const poolSpec = pool.map((p) => ({ key: p.key, capacity: assumedCapacity ?? p.capacity }));
    const snap = snapshotAsOf(world, c.assignedDay, DECISION_HOUR, poolSpec, c.key, opts.declared);
    const scoreCard: ScoreCard = {
      id: c.key,
      title: c.title,
      description: c.description,
      startDate: at(c.assignedDay),
      dueDate: at(c.dueDay, 23, 59),
    };

    // "Tai" cua tung nguoi theo dinh nghia cua bo cham (the mo chong lan) - dung cho ca cac nhanh khong dung bo cham va cho
    // mo hinh ket qua cua the gioi. Xep hang tham chieu nay khong anh huong nhanh nao, nhung la thu TRUONG NHOM GIA nhin (thu tu
    // quyet dinh ai thang khi hoa tien ich) -> ghim bo trong so cua buoc 7 (§17.6) de so lieu cu tai hien dung.
    const reference = rankCandidates(scoreCard, snap.candidates, {
      idf: snap.idf,
      now: snap.now,
      groupOnTimeRate: snap.mu,
      weights: LEGACY_WEIGHTS_V1,
    });
    const load = new Map(reference.map((r) => [r.userId, r.load]));

    const skillOf = (key: string) => skillAt(people.get(key)!, c.topic, c.assignedDay);
    const pOn = (key: string) =>
      onTimeProbability(skillOf(key), load.get(key)!, people.get(key)!.capacity, loadPenalty);
    const oracle: Oracle = { skillOf, pOnTimeOf: pOn };

    const input: ArmInput = {
      card: scoreCard,
      snapshot: snap,
      load,
      rng: new Rng(streamSeed(cfg.seed, cardIndex, STREAM_SALTS.arm)),
      oracle,
    };
    const output: ArmOutput = arm.rank(input);
    const poolKeys = pool.map((p) => p.key);
    if (!isPermutation(output.order, poolKeys)) {
      throw new Error(`nhanh ${arm.id} tra ve thu tu khong phai hoan vi cua ho boi (the ${c.key})`);
    }
    const topKey = output.order[0]!;

    // Truong nhom gia nhin vao xep hang THAM CHIEU (khong phai xep hang cua nhanh) -> cung mot nguoi chon o moi nhanh
    const leaderKey = opts.leader
      ? opts.leader.pick({ cardKey: c.key, ranked: reference, rng: new Rng(streamSeed(cfg.seed, cardIndex, STREAM_SALTS.leader)) })
      : null;
    if (leaderKey !== null && !poolKeys.includes(leaderKey)) {
      throw new Error(`truong nhom chon ngoai ho boi (the ${c.key}): ${leaderKey}`);
    }

    const assignedKey = mode === 'HISTORY' ? c.assigneeKey : mode === 'LEADER' ? leaderKey! : topKey;
    if (!load.has(assignedKey)) throw new Error(`nguoi duoc giao ngoai ho boi (the ${c.key}): ${assignedKey}`);

    // Ket qua cua the (chi khi the gioi tien trien)
    let onTime: boolean | null = null;
    if (mutable) {
      let outcome: Outcome;
      if (opts.replayOutcomes) {
        if (assignedKey !== c.assigneeKey) throw new Error('replayOutcomes chi hop le khi nguoi duoc giao trung nguoi cua bo sinh');
        outcome = { stillOpen: !c.done, completedDay: c.completedDay, onTime: c.onTime, reopened: c.reopened };
      } else {
        outcome = sampleOutcome(new Rng(streamSeed(cfg.seed, cardIndex, STREAM_SALTS.outcome)), {
          skill: skillOf(assignedKey),
          load: load.get(assignedKey)!,
          capacity: people.get(assignedKey)!.capacity,
          assignedDay: c.assignedDay,
          dueDay: c.dueDay,
          days: cfg.days,
          recent: c.createdDay > cfg.days - cfg.openRecentDays,
          loadPenalty,
        });
      }
      world.cards[cardIndex] = {
        ...c,
        assigneeKey: assignedKey,
        done: !outcome.stillOpen,
        completedDay: outcome.completedDay,
        onTime: outcome.onTime,
        reopened: outcome.reopened,
      };
      onTime = outcome.completedDay === null ? null : outcome.onTime;
    }

    if (leaderKey !== null) arm.observe?.({ output, chosenKey: leaderKey });

    const best = bestCandidate(data.people, c);
    const rankOfBest = output.order.indexOf(best.key) + 1;
    if (rankOfBest === 0) throw new Error(`nguoi tot nhat ${best.key} khong nam trong ho boi (the ${c.key})`);
    const skills = poolKeys.map(skillOf);
    const topInfo = snap.candidates.find((k) => k.userId === topKey)!;
    const bestInfo = snap.candidates.find((k) => k.userId === best.key)!;
    const nowMs = snap.now.getTime();
    decisions.push({
      index: decisions.length,
      cardKey: c.key,
      day: c.assignedDay,
      poolKeys,
      topKey,
      bestKey: best.key,
      rankOfBest,
      regret: best.skill - skillOf(topKey),
      pOnTimeTop: pOn(topKey),
      topHasNoHistory: !topInfo.history.some((h) => h.completedAt.getTime() <= nowMs),
      assignedKey,
      pOnTimeAssigned: pOn(assignedKey),
      regretAssigned: best.skill - skillOf(assignedKey),
      hitAssigned: assignedKey === best.key,
      leaderKey,
      onTime,
      chanceTop1: 1 / poolKeys.length,
      chanceRegret: best.skill - mean(skills),
      chancePOnTime: mean(poolKeys.map(pOn)),
      weights: arm.weights ? arm.weights() : null,
      bestDoneCount: bestInfo.history.filter((h) => h.completedAt.getTime() <= nowMs).length,
    });
  }

  const newcomerKeys = data.people.filter((p) => p.joinedDay > minDay).map((p) => p.key);
  return {
    summary: summarizeDecisions(decisions, newcomerKeys),
    decisions,
    finalWeights: arm.weights ? arm.weights() : null,
    world: opts.keepWorld ? world : null,
  };
}

// ---------- Nhanh THAM CHIEU (can ky nang an - chi bo danh gia duoc phep) ----------

const needOracle = (o: Oracle | undefined): Oracle => {
  if (!o) throw new Error('nhanh tham chieu can `oracle` (chi bo chay danh gia cung cap)');
  return o;
};

/** Tham chieu: luon giao nguoi co KY NANG cao nhat (khong xet tai). Tran cua Top-1 / hoi tiec. */
export function bestSkillArm(): Arm {
  return {
    id: 'best-skill',
    label: 'Tham chiếu: người kỹ năng cao nhất',
    rank({ snapshot, oracle }) {
      const o = needOracle(oracle);
      const keys = snapshot.candidates.map((c) => c.userId);
      const order = keys.sort((a, b) => o.skillOf(b) - o.skillOf(a) || (a < b ? -1 : a > b ? 1 : 0));
      return { order, ranked: null };
    },
  };
}

/** Tham chieu: luon giao nguoi co XAC SUAT DUNG HAN cao nhat (xet ca tai) - tran cua chi so chinh trong the gioi nay. */
export function oracleArm(): Arm {
  return {
    id: 'oracle',
    label: 'Tham chiếu: tối ưu (xác suất đúng hạn cao nhất)',
    rank({ snapshot, oracle }) {
      const o = needOracle(oracle);
      const keys = snapshot.candidates.map((c) => c.userId);
      const order = keys.sort((a, b) => o.pOnTimeOf(b) - o.pOnTimeOf(a) || (a < b ? -1 : a > b ? 1 : 0));
      return { order, ranked: null };
    },
  };
}
