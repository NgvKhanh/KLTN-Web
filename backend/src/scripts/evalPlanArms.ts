// Cac "cach chia" doi chung cho bo danh gia lop 2 (buoc 9, ASSIGN_MODULE.md §10.10/§11). Doi voi nhanh cua buoc 7
// (evalAssignArms.ts), o day KHONG danh gia MOT quyet dinh don le ma danh gia CA MOT DOT (batch) K the cung luc.
//
// TEP NAY KHONG duoc import simGenerator / simVocab: mot "cach chia" chi duoc thay diem so cua lop 1 (rankCandidates)
// va so the da giao TRONG DOT nay - khong bao gio thay ky nang an. Hai nhanh can ky nang an (oracleGreedy) va nhanh
// GOI THANG san pham (planned = planAssignments that) nam o evalPlanRun.ts.

import { urgencyOrder, type PlanCard } from '../modules/assign/assign.plan';
import { rankCandidates, type CandidateInput, type OpenCard, type RankedCandidate, type ScoreContext } from '../modules/assign/assign.score';

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Ung vien du dieu kien duoc chon: co diem VA khong dang tam nghi - dung HET voi luat cua planAssignments that. */
const eligible = (ranked: readonly RankedCandidate[]): RankedCandidate[] =>
  ranked.filter((r) => r.score !== null && !r.flags.includes('PAUSED'));

/** Thong tin mot "cach chia" can de chon nguoi cho MOT the, tai dung buoc cua vong lap tham lam tuan tu. */
export interface PlanArmContext {
  /** Xep hang CO cong don cac the da chia TRONG DOT nay (dung nhu planAssignments that). */
  ranked: readonly RankedCandidate[];
  /** Xep hang KHONG cong don gi ca (chi tai/lich su TRUOC dot) - "cham rieng tung the" kieu cu. */
  blind: readonly RankedCandidate[];
  /** So the DA giao trong dot nay cho tung nguoi, TINH DEN TRUOC the dang xet. */
  counts: ReadonlyMap<string, number>;
}

/** Chon nguoi cho mot the; null = khong ai du dieu kien. Ham THUAN, khong tu giu trang thai (trang thai o `counts`). */
export type PlanPickFn = (ctx: PlanArmContext) => string | null;

/** "Cham rieng tung the": mo phong tinh nang goi y cu truoc khi co lop 2 - khong biet cac the khac trong dot. */
export const pickIndependent: PlanPickFn = ({ blind }) => eligible(blind)[0]?.userId ?? null;

/** Dung nguyen luat cua planAssignments (§10.10) - CHI dung de kiem doi chieu, khong dung de dung bao cao chinh thuc
 * (bao cao goi thang planAssignments that, xem evalPlanRun.ts). */
export const pickPlannedLikeProduct: PlanPickFn = ({ ranked }) => eligible(ranked)[0]?.userId ?? null;

/**
 * Them TRAN `cap` the/nguoi trong dot: uu tien nguoi du dieu kien VA chua cham tran; het ca nhom moi coi tran chi la
 * uu tien mem (fallback ve nguoi du dieu kien tot nhat, bo qua tran) - giu dung bat bien "khong nguoi = khong ai du
 * dieu kien", khong phai vi tran.
 */
export function pickCapped(cap: number): PlanPickFn {
  if (!Number.isFinite(cap) || cap < 1) throw new RangeError('pickCapped: cap phai la so huu han >= 1');
  return ({ ranked, counts }) => {
    const cands = eligible(ranked);
    const underCap = cands.find((r) => (counts.get(r.userId) ?? 0) < cap);
    return (underCap ?? cands[0])?.userId ?? null;
  };
}

/** Tru `lambda` diem (thang diem tho 0-100) moi the DA nhan trong dot truoc khi so ai xep dau; hoa thi userId. */
export function pickPenalty(lambda: number): PlanPickFn {
  if (!Number.isFinite(lambda) || lambda < 0) throw new RangeError('pickPenalty: lambda phai la so huu han >= 0');
  return ({ ranked, counts }) => {
    const cands = eligible(ranked);
    if (cands.length === 0) return null;
    const adjusted = cands.map((r) => ({ userId: r.userId, adj: r.score! - lambda * (counts.get(r.userId) ?? 0) }));
    adjusted.sort((a, b) => b.adj - a.adj || cmpStr(a.userId, b.userId));
    return adjusted[0]!.userId;
  };
}

/**
 * San day nhat de doi chieu: bo qua diem so, chia vong tron theo mot thu tu CO DINH. Tao MOI cho moi dot (co con tro
 * rieng) - dung nhu ArmSpec.make() cua buoc 7.
 */
export function makeRoundRobin(order: readonly string[]): PlanPickFn {
  const ids = [...order].sort(cmpStr);
  let i = 0;
  return () => {
    if (ids.length === 0) return null;
    const id = ids[i % ids.length]!;
    i += 1;
    return id;
  };
}

/**
 * Vong lap tham lam tuan tu DUNG CHUNG cho moi "cach chia" (tru `planned` - goi thang san pham - va `oracleGreedy` -
 * can ky nang an, ca hai o evalPlanRun.ts). Cung mot khuon voi planAssignments that: han gap truoc, cong the vua chia
 * vao "the dang mo" cua nguoi duoc chon truoc khi sang the sau. Khong sua `cards` / `candidates` dau vao.
 */
export interface PlanArmRow {
  cardId: string;
  assigneeId: string | null;
  /** Tai LUC GIAO (truoc khi cong the nay) cua nguoi duoc chon; null neu khong ai duoc chon. */
  load: number | null;
  capacity: number | null;
}

export function runGreedyBatch(cards: readonly PlanCard[], candidates: readonly CandidateInput[], ctx: ScoreContext, pick: PlanPickFn): PlanArmRow[] {
  const given = new Map<string, OpenCard[]>(candidates.map((c) => [c.userId, []]));
  const counts = new Map<string, number>(candidates.map((c) => [c.userId, 0]));
  const rows: PlanArmRow[] = [];
  for (const card of urgencyOrder(cards)) {
    const pool = candidates.map((c) => ({ ...c, openCards: [...c.openCards, ...given.get(c.userId)!] }));
    const ranked = rankCandidates(card, pool, ctx);
    const blind = rankCandidates(card, candidates, ctx);
    const chosen = pick({ ranked, blind, counts });
    if (chosen !== null) {
      if (!given.has(chosen)) throw new Error(`pick() tra ve nguoi ngoai ho boi: ${chosen}`);
      given.get(chosen)!.push({ cardId: card.id, startDate: card.startDate, dueDate: card.dueDate });
      counts.set(chosen, (counts.get(chosen) ?? 0) + 1);
    }
    const info = chosen === null ? undefined : ranked.find((r) => r.userId === chosen);
    rows.push({ cardId: card.id, assigneeId: chosen, load: info?.load ?? null, capacity: info?.capacity ?? null });
  }
  return rows;
}
