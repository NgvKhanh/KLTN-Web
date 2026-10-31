// Bo CHAY danh gia lop 2 (buoc 9, ASSIGN_MODULE.md §10.10/§11): noi cac "cach chia" (evalPlanArms.ts) voi mot dot
// (evalPlanBatches.ts), cham diem bang ky nang AN, roi gop nhieu dot cua CUNG mot hat giong thanh mot so ("moi hat
// giong la mot don vi doc lap", giong het buoc 7). KHONG Prisma, KHONG dong ho, KHONG mang - tat dinh.
//
// DOC ky nang an de CHAM - chi nam trong scripts/, module assign/ khong bao gio import tep nay.

import { planAssignments, urgencyOrder, type PlanCard } from '../modules/assign/assign.plan';
import { rankCandidates, type CandidateInput, type OpenCard, type ScoreContext } from '../modules/assign/assign.score';
import {
  makeRoundRobin,
  pickCapped,
  pickIndependent,
  pickPenalty,
  runGreedyBatch,
  type PlanArmRow,
} from './evalPlanArms';
import { cutBatches, type BatchOptions, type PlanBatch } from './evalPlanBatches';
import { gini, maxShare, mean } from './evalAssignStats';
import { DEFAULT_LOAD_PENALTY, onTimeProbability, type SimDataset } from './simGenerator';

/**
 * 20 hat giong DANH GIA cua buoc 9, chua tung dung de chon gi o cac buoc 0-8 (tach khoi 2001-2020 cua lop 1 - buoc 7 -
 * va khoi 93xx/94xx cua dev). Tham so bo cham giu dung mac dinh da duyet.
 */
export const PLAN_EVAL_SEEDS: readonly number[] = Array.from({ length: 20 }, (_, i) => 3001 + i);

export type PlanArmId = 'independent' | 'planned' | 'plannedCap' | 'plannedPenalty10' | 'plannedPenalty20' | 'roundRobin' | 'oracleGreedy';

export interface PlanArmSpec {
  id: PlanArmId;
  label: string;
}

/** Bay "cach chia" theo dung thu tu bang §10.10 (tru "chia deu tuyet doi", khong the co that). */
export const PLAN_ARMS: readonly PlanArmSpec[] = [
  { id: 'independent', label: 'Chấm riêng từng thẻ, không cộng tải' },
  { id: 'planned', label: 'Cộng thẻ vừa giao vào tải (cách đã cài)' },
  { id: 'plannedCap', label: 'Cách trên + trần ⌈K/người⌉ thẻ mỗi người' },
  { id: 'plannedPenalty10', label: 'Cách trên + phạt 10 điểm mỗi thẻ đã nhận' },
  { id: 'plannedPenalty20', label: 'Cách trên + phạt 20 điểm mỗi thẻ đã nhận' },
  { id: 'roundRobin', label: 'Chia vòng tròn' },
  { id: 'oracleGreedy', label: 'Tối ưu tham lam (biết kỹ năng ẩn, không phải tối ưu toàn cục)' },
];

/** `planned` la nguyen ham san pham that (khong ban sao) - map PlanRow.ranked ve dung hinh dang PlanArmRow. */
function runPlannedRows(cards: readonly PlanCard[], candidates: readonly CandidateInput[], ctx: ScoreContext): PlanArmRow[] {
  return planAssignments({ cards, candidates, ctx }).map((row) => {
    const info = row.assigneeId === null ? undefined : row.ranked.find((r) => r.userId === row.assigneeId);
    return { cardId: row.card.id, assigneeId: row.assigneeId, load: info?.load ?? null, capacity: info?.capacity ?? null };
  });
}

/**
 * Tham chieu can ky nang an: tai MOI buoc chon nguoi co xac suat dung han TAT (onTimeProbability, tai THAT tinh den
 * truoc the nay) cao nhat. THAM LAM tung the theo thu tu han gap truoc - KHONG phai loi giai toi uu toan cuc cho ca
 * dot (khong lam bai toan ghep tot nhat kieu Hungary) - chi la mot tham chieu manh, ghi ro trong bao cao.
 */
function runOracleGreedy(batch: PlanBatch): PlanArmRow[] {
  const { cards, candidates, ctx, skillOf } = batch;
  const given = new Map<string, OpenCard[]>(candidates.map((c) => [c.userId, []]));
  const rows: PlanArmRow[] = [];
  for (const card of urgencyOrder(cards)) {
    const pool = candidates.map((c) => ({ ...c, openCards: [...c.openCards, ...given.get(c.userId)!] }));
    const byId = new Map(rankCandidates(card, pool, ctx).map((r) => [r.userId, r]));
    let bestId: string | null = null;
    let bestP = -Infinity;
    for (const c of candidates) {
      const info = byId.get(c.userId)!;
      const p = onTimeProbability(skillOf(c.userId, card.id), info.load, info.capacity, DEFAULT_LOAD_PENALTY);
      if (bestId === null || p > bestP || (p === bestP && c.userId < bestId)) {
        bestP = p;
        bestId = c.userId;
      }
    }
    if (bestId !== null) given.get(bestId)!.push({ cardId: card.id, startDate: card.startDate, dueDate: card.dueDate });
    const info = bestId === null ? undefined : byId.get(bestId);
    rows.push({ cardId: card.id, assigneeId: bestId, load: info?.load ?? null, capacity: info?.capacity ?? null });
  }
  return rows;
}

/** Chay MOT "cach chia" tren MOT dot. Xuat rieng de test doi chieu `planned` voi `planAssignments()` goi truc tiep. */
export function runArmOnBatch(batch: PlanBatch, armId: PlanArmId): PlanArmRow[] {
  const { cards, candidates, ctx } = batch;
  switch (armId) {
    case 'independent':
      return runGreedyBatch(cards, candidates, ctx, pickIndependent);
    case 'planned':
      return runPlannedRows(cards, candidates, ctx);
    case 'plannedCap':
      return runGreedyBatch(cards, candidates, ctx, pickCapped(Math.ceil(cards.length / candidates.length)));
    case 'plannedPenalty10':
      return runGreedyBatch(cards, candidates, ctx, pickPenalty(10));
    case 'plannedPenalty20':
      return runGreedyBatch(cards, candidates, ctx, pickPenalty(20));
    case 'roundRobin':
      return runGreedyBatch(cards, candidates, ctx, makeRoundRobin(candidates.map((c) => c.userId)));
    case 'oracleGreedy':
      return runOracleGreedy(batch);
  }
}

export interface ScoredPlanRow extends PlanArmRow {
  bestSkill: number;
  chosenSkill: number | null;
  /** Xac suat dung han KY VONG (mo hinh ket qua cua bo sinh) cua nguoi duoc chon, voi tai LUC GIAO. */
  pOnTime: number | null;
}

/** Cham diem MOT ket qua chia (bat ky nhanh nao) bang ky nang an cua dung dot da sinh ra no. Chi can hai truy van cua
 * PlanBatch (khong can ca doi tuong) - de test doc lap khong phai dung cutBatch that. */
export function scoreRows(
  rows: readonly PlanArmRow[],
  batch: Pick<PlanBatch, 'bestSkill' | 'skillOf'>,
  loadPenalty = DEFAULT_LOAD_PENALTY
): ScoredPlanRow[] {
  return rows.map((row) => {
    const bestSkill = batch.bestSkill(row.cardId);
    const chosenSkill = row.assigneeId === null ? null : batch.skillOf(row.assigneeId, row.cardId);
    const pOnTime =
      row.assigneeId === null || row.load === null || row.capacity === null || chosenSkill === null
        ? null
        : onTimeProbability(chosenSkill, row.load, row.capacity, loadPenalty);
    return { ...row, bestSkill, chosenSkill, pOnTime };
  });
}

export interface PlanBatchSummary {
  cards: number;
  /** Ti le the khong ai du dieu kien (moi ung vien tam nghi / khong diem) - o bo mo phong gan nhu luon 0. */
  unassigned: number;
  maxShare: number;
  gini: number;
  /** Trung binh tren cac the CO NGUOI - CHI SO CHINH (can tai). */
  pOnTime: number;
  /** Ky nang nguoi tot nhat tru ky nang nguoi duoc chon, trung binh tren the co nguoi. */
  regret: number;
  top1: number;
  /** Ti le the co nguoi ma P(dung han) < 0,5. */
  risky: number;
}

const ZERO_SUMMARY_TAIL = { pOnTime: 0, regret: 0, top1: 0, risky: 0 } as const;

/** Tong hop cac dong da cham diem CUA MOT DOT thanh mot bo chi so. */
export function summarizeBatch(scored: readonly ScoredPlanRow[], poolKeys: readonly string[]): PlanBatchSummary {
  if (scored.length === 0) throw new RangeError('summarizeBatch: khong co the nao');
  if (poolKeys.length === 0) throw new RangeError('summarizeBatch: ho boi rong');
  type Assigned = ScoredPlanRow & { assigneeId: string; chosenSkill: number; pOnTime: number };
  const assigned = scored.filter((r): r is Assigned => r.assigneeId !== null);
  const counts = poolKeys.map((k) => scored.filter((r) => r.assigneeId === k).length);
  return {
    cards: scored.length,
    unassigned: (scored.length - assigned.length) / scored.length,
    maxShare: maxShare(counts),
    gini: gini(counts),
    ...(assigned.length === 0
      ? ZERO_SUMMARY_TAIL
      : {
          pOnTime: mean(assigned.map((r) => r.pOnTime)),
          regret: mean(assigned.map((r) => r.bestSkill - r.chosenSkill)),
          top1: mean(assigned.map((r) => (r.chosenSkill === r.bestSkill ? 1 : 0))),
          risky: mean(assigned.map((r) => (r.pOnTime < 0.5 ? 1 : 0))),
        }),
  };
}

/** Trung binh CAC THANH PHAN cua nhieu dot (vd nhieu ngay quyet dinh cung mot hat giong) thanh mot bo chi so. */
export function meanSummaries(xs: readonly PlanBatchSummary[]): PlanBatchSummary {
  if (xs.length === 0) throw new RangeError('meanSummaries: mang rong');
  return {
    cards: mean(xs.map((x) => x.cards)),
    unassigned: mean(xs.map((x) => x.unassigned)),
    maxShare: mean(xs.map((x) => x.maxShare)),
    gini: mean(xs.map((x) => x.gini)),
    pOnTime: mean(xs.map((x) => x.pOnTime)),
    regret: mean(xs.map((x) => x.regret)),
    top1: mean(xs.map((x) => x.top1)),
    risky: mean(xs.map((x) => x.risky)),
  };
}

/** Duong ong day du tren MOT bo du lieu: cat cac dot, chay mot nhanh, cham diem, gop lai. `null` neu khong cat duoc dot nao. */
export function runPlanArmOnDataset(
  data: SimDataset,
  armId: PlanArmId,
  batchDays: readonly number[],
  k: number,
  opts: BatchOptions = {}
): PlanBatchSummary | null {
  const batches = cutBatches(data, batchDays, k, opts);
  if (batches.length === 0) return null;
  const summaries = batches.map((b) => summarizeBatch(scoreRows(runArmOnBatch(b, armId), b), b.poolKeys));
  return meanSummaries(summaries);
}
