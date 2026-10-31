// Lop 2 - chia viec cho CA DANH SACH (ASSIGN_MODULE.md §4, §10.10). HAM THUAN: khong Prisma, khong doc dong ho.
//
// Vong lap tham lam: xep cac the theo HAN GAP TRUOC; voi moi the goi lop 1 (rankCandidates), chon nguoi xep dau CO DIEM va
// KHONG dang tam nghi; roi cong THE VUA GIAO vao "the dang mo" cua nguoi do (giu nguyen ngay cua the) truoc khi sang the
// sau. Tai cua nguoi do vi vay tang o cac the sau qua CHINH thanh phan kha dung cua lop 1: khong co so tai theo ngay, khong
// co tham so moi (engine v1 phinh to o dung cho nay). Ket qua = lan luot bam goi y so 1 cho tung the va giao that sau moi
// lan, tru viec bo qua nguoi tam nghi - co test doi chieu voi lop 1 tren CSDL that.
//
// Dung chung cho may chu (assign.service.ts) va cho buoc 9 (danh gia lop 2 tren bo mo phong): cung mot ham, khong ban sao.

import {
  rankCandidates,
  type CandidateInput,
  type OpenCard,
  type RankedCandidate,
  type ScoreContext,
} from './assign.score';

/** So the toi da mot lan chia (do do tre: xem ASSIGN_MODULE.md §10.10). Ap dung o tang dich vu, khong o ham thuan. */
export const PLAN_MAX_CARDS = 30;
/** Phien ban cach chia (ghi trong ket qua de tai lap duoc). */
export const PLAN_VERSION = 'greedy-v1';

export interface PlanCard {
  id: string;
  title: string;
  description: string | null;
  startDate: Date | null;
  dueDate: Date | null;
  /** Vi tri trong danh sach (Card.position): pha hoa khi hai the cung han. */
  position: number;
}

export interface PlanRow {
  card: PlanCard;
  /** null = khong ai du dieu kien (moi ung vien dang tam nghi hoac khong co diem). */
  assigneeId: string | null;
  /** Xep hang cua MOI ung vien cho the nay TAI BUOC nay (da tinh cac the chia truoc do). */
  ranked: RankedCandidate[];
}

export interface PlanInput {
  cards: readonly PlanCard[];
  /** Ung vien va cac the DANG MO cua ho TRUOC khi chia (khong chua cac the trong `cards`). */
  candidates: readonly CandidateInput[];
  ctx: ScoreContext;
}

const timeOf = (d: Date | null): number | null => (d instanceof Date && Number.isFinite(d.getTime()) ? d.getTime() : null);
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Thu tu xu ly: han gap truoc (khong co han xuong cuoi), roi vi tri trong danh sach, roi id (tat dinh). Tra mang moi. */
export function urgencyOrder<T extends Pick<PlanCard, 'id' | 'dueDate' | 'position'>>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => {
    const da = timeOf(a.dueDate);
    const db = timeOf(b.dueDate);
    if (da !== db) {
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    }
    return a.position - b.position || cmpStr(a.id, b.id);
  });
}

/**
 * Chia `cards` cho `candidates`. Tra ve mot dong cho moi the theo thu tu xu ly. Khong sua dau vao; tat dinh (khong phu
 * thuoc thu tu cua `cards` va `candidates`). The khong co ngay thi the vao "the dang mo" cung khong co ngay - dung nhu
 * sau khi giao that, tuc chong lan moi khoang thoi gian (§5.6).
 */
export function planAssignments(input: PlanInput): PlanRow[] {
  const { cards, candidates, ctx } = input;
  const seen = new Set<string>();
  for (const c of cards) {
    if (seen.has(c.id)) throw new RangeError(`the trung id: ${c.id}`);
    seen.add(c.id);
    if (!Number.isFinite(c.position)) throw new RangeError(`vi tri cua the ${c.id} khong hop le`);
  }

  // Cac the da chia trong lan nay, theo nguoi (o day, chua ghi vao dau vao)
  const given = new Map<string, OpenCard[]>(candidates.map((c) => [c.userId, []]));
  const rows: PlanRow[] = [];
  for (const card of urgencyOrder(cards)) {
    const pool = candidates.map((c) => ({ ...c, openCards: [...c.openCards, ...given.get(c.userId)!] }));
    const ranked = rankCandidates(card, pool, ctx);
    const pick = ranked.find((r) => r.score !== null && !r.flags.includes('PAUSED'));
    if (pick) given.get(pick.userId)!.push({ cardId: card.id, startDate: card.startDate, dueDate: card.dueDate });
    rows.push({ card, assigneeId: pick ? pick.userId : null, ranked });
  }
  return rows;
}
