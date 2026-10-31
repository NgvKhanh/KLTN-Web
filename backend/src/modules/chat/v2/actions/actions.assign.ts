// TICH HOP PHAN CONG (Phase 6; CHATBOT_V2_ACTIONS_PLAN.md PL-D): chatbot goi LAI module goi y phan cong, khong viet lai thuat toan.
//
//  - "giao cho nguoi phu hop nhat" -> member {by:'BEST'}: server goi suggestForCard, chon ung vien xep dau chua o trong the va khong tam nghi.
//  - "chia cac viec chua co nguoi trong cot X" -> ASSIGN_UNASSIGNED: server goi planForList va KHAI TRIEN thanh nhieu ASSIGN_MEMBER.
// Nguoi nhan do MAY chon (khong phai do nguoi dung goi ten) nen ke hoach LUON xem truoc (ly do AI_CHOSEN_TARGET) va hien diem, do tin cay,
// co (qua tai / tam nghi...) + ung vien khac. KHONG BAO GIO lo bang chung (the cu), ho so, CV, thanh phan diem.
//
// recordOutcome (nhat ky chap nhan + hoc trong so cua nhom) CHI duoc goi SAU KHI nguoi dung bam "Ap dung" va CHI cho ung vien xep dau cua dung
// luot goi y do: la mot quyet dinh cua con nguoi (nhu chon nguoi o giao dien). Khong bao gio cho thao tac tu chay, ke hoach bi huy / het han /
// loi thoi, hay khi chon nguoi xep thu hai (do la lua chon cua may, khong phai cua nguoi dung) - de chatbot khong thoi phong ty le chap nhan.

import { AppError } from '../../../../utils/AppError';
import { isBoardParticipant } from '../../../board/board.service';
import { planForList, recordOutcome, suggestForCard } from '../../../assign/assign.service';
import { MAX_OPS_PER_PLAN } from './actions.schema';
import type { ActionErrorCode, AssignChoice, StoredOp } from './actions.types';

type Kind = 'SUGGEST' | 'PLAN';
/** Tuong duong gioi han cua route /api/assign (rateLimit.middleware): goi y 60 / 10 phut (day la 30 vi chatbot con co gioi han rieng), chia 10 / 10 phut. */
const LIMITS: Record<Kind, { limit: number; windowMs: number }> = { SUGGEST: { limit: 30, windowMs: 10 * 60_000 }, PLAN: { limit: 10, windowMs: 10 * 60_000 } };
const hits = new Map<string, number[]>();
export const RATE_TEXT = 'Bạn đã nhờ gợi ý phân công quá nhiều lần trong ít phút. Hãy thử lại sau ít phút. Chưa thay đổi gì.';

/** Lay mot luot trong ngan sach (cua so truot, theo nguoi dung). `nowMs` truyen vao de test; tra false khi het luot. */
export function takeAssignBudget(kind: Kind, userId: string, nowMs: number): boolean {
  const { limit, windowMs } = LIMITS[kind];
  const key = `${kind}:${userId}`;
  const recent = (hits.get(key) ?? []).filter((t) => nowMs - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(nowMs);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => nowMs - t >= windowMs)) hits.delete(k);
  return true;
}
export const resetAssignBudget = (): void => hits.clear();

type Fail = { ok: false; code: ActionErrorCode; text: string };

function mapAssignError(e: unknown): Fail {
  if (e instanceof AppError && e.statusCode === 403) return { ok: false, code: 'FORBIDDEN', text: 'Bạn chỉ có quyền xem (hoặc không còn quyền sửa) bảng này nên mình không gợi ý phân công được. Chưa thay đổi gì.' };
  if (e instanceof AppError && e.statusCode === 404) return { ok: false, code: 'NOT_FOUND', text: 'Không tìm thấy thẻ hoặc cột này (có thể đã bị xóa hoặc lưu trữ). Chưa thay đổi gì.' };
  if (e instanceof AppError && e.statusCode < 500) return { ok: false, code: 'INVALID', text: `Không gợi ý được: ${e.message}. Chưa thay đổi gì.` };
  throw e;
}

/** Diem hien cho nguoi dung la so nguyen 0-100 (module phan cong tra so thuc nhu 72.49999999999999). */
export const wholeScore = (score: number | null): number | null => (score === null ? null : Math.round(score));

export interface BestPick {
  userId: string;
  name: string;
  choice: AssignChoice;
}

/**
 * Nguoi phu hop nhat cho MOT the (xep hang cua module phan cong). Bo qua nguoi da o trong the va nguoi dang tam nghi; nguoi qua tai van duoc
 * chon nhung co `OVERLOADED` hien o ban xem truoc. Ghi MOT dong AssignRun (nhu bam "Goi y" o giao dien) - runId dung de ghi ket qua khi Ap dung.
 */
export async function bestAssignee(args: { userId: string; cardId: string; now: Date }): Promise<{ ok: true; pick: BestPick } | Fail> {
  if (!takeAssignBudget('SUGGEST', args.userId, args.now.getTime())) return { ok: false, code: 'RATE_LIMITED', text: RATE_TEXT };
  let result: Awaited<ReturnType<typeof suggestForCard>>;
  try {
    result = await suggestForCard(args.userId, args.cardId, args.now);
  } catch (e) {
    return mapAssignError(e);
  }
  // module phan cong co the xep ca nguoi chi co quyen XEM o bang (thanh vien khong gian bi ha xuong VIEWER): khong giao duoc nen bo qua
  const eligible: typeof result.candidates = [];
  for (const c of result.candidates) {
    if (!c.assigned && !c.flags.includes('PAUSED') && (await isBoardParticipant(result.card.boardId, c.user.id))) eligible.push(c);
  }
  const top = eligible[0];
  if (!top) return { ok: false, code: 'NOT_FOUND', text: 'Chưa có ứng viên nào phù hợp để giao thẻ này (mọi người đã ở trong thẻ hoặc đang tạm nghỉ). Hãy nêu rõ tên người. Chưa thay đổi gì.' };
  return {
    ok: true,
    pick: {
      userId: top.user.id,
      name: top.user.name,
      choice: {
        source: 'BEST',
        runId: top.rank === 1 ? result.runId : null,
        rank: top.rank,
        score: wholeScore(top.score),
        confidenceLevel: top.confidenceLevel,
        flags: [...top.flags],
        alternatives: eligible.slice(1, 3).map((c) => ({ name: c.user.name, rank: c.rank, score: wholeScore(c.score) })),
      },
    },
  };
}

export interface SplitResult {
  ops: StoredOp[];
  /** So the chua co nguoi nhan cua cot (co the nhieu hon so dong duoc chia). */
  totalUnassigned: number;
  /** Dong khong ai du dieu kien (moi nguoi dang tam nghi): de trong, khong bia. */
  noOne: number;
  truncated: boolean;
  /** Chi chia nhieu nhat `room` the (gioi han so thao tac cua mot ke hoach); phan con lai de lan sau. */
  cut: number;
}

/** Chia cac the CHUA co nguoi nhan cua mot cot (planForList): moi dong la mot ASSIGN_MEMBER do may chon. Chi xem truoc, khong ghi gi. */
export async function splitUnassigned(args: { userId: string; listId: string; now: Date; room: number }): Promise<({ ok: true } & SplitResult) | Fail> {
  if (!takeAssignBudget('PLAN', args.userId, args.now.getTime())) return { ok: false, code: 'RATE_LIMITED', text: RATE_TEXT };
  let plan: Awaited<ReturnType<typeof planForList>>;
  try {
    plan = await planForList(args.userId, args.listId, args.now);
  } catch (e) {
    return mapAssignError(e);
  }
  const names = new Map(plan.people.map((p) => [p.user.id, p.user.name]));
  // chi giao cho nguoi co quyen SUA bang (isBoardParticipant); dong ma ung vien duoc chon la nguoi chi xem thi coi nhu khong ai du dieu kien
  const assigned: typeof plan.rows = [];
  for (const row of plan.rows) {
    if (row.assignee !== null && (await isBoardParticipant(plan.list.boardId, row.assignee.user.id))) assigned.push(row);
  }
  const noOne = plan.rows.length - assigned.length;
  const room = Math.max(1, Math.min(args.room, MAX_OPS_PER_PLAN));
  const taken = assigned.slice(0, room);
  const ops: StoredOp[] = taken.map((row) => {
    const pick = row.assignee!;
    const mine = row.ranking.find((r) => r.userId === pick.user.id);
    return {
      type: 'ASSIGN_MEMBER',
      ids: { card: row.card.id, member: pick.user.id },
      params: {},
      before: { alreadyAssigned: false },
      display: { cardTitle: row.card.title, memberName: pick.user.name },
      choice: {
        source: 'PLAN',
        runId: null,
        rank: mine?.rank ?? 1,
        score: wholeScore(pick.score),
        confidenceLevel: pick.confidenceLevel,
        flags: [...pick.flags],
        alternatives: row.ranking
          .filter((r) => r.userId !== pick.user.id && !r.flags.includes('PAUSED'))
          .slice(0, 2)
          .map((r) => ({ name: names.get(r.userId) ?? '', rank: r.rank, score: wholeScore(r.score) })),
      },
    };
  });
  return { ok: true, ops, totalUnassigned: plan.totalUnassigned, noOne, truncated: plan.truncated, cut: assigned.length - taken.length };
}

/**
 * Ghi ket qua cho cac luot goi y sau khi ke hoach DA CHAY (nguoi dung bam Ap dung): chi ung vien xep dau (rank 1) cua luot goi y co runId va chi
 * khi thao tac that su doi du lieu (nguoi do vua duoc giao). Loi o day khong lam hong ket qua (du lieu da commit); chi ghi log.
 */
export async function recordAssignOutcomes(input: { userId: string; ops: readonly StoredOp[]; changed: readonly boolean[]; now: Date }): Promise<number> {
  let recorded = 0;
  for (const [i, op] of input.ops.entries()) {
    const choice = op.choice;
    if (op.type !== 'ASSIGN_MEMBER' || choice?.source !== 'BEST' || choice.rank !== 1 || choice.runId === null || input.changed[i] !== true || op.ids.member === undefined) continue;
    try {
      await recordOutcome(input.userId, choice.runId, op.ids.member, input.now);
      recorded += 1;
    } catch (e) {
      console.error('[chat-actions] ghi ket qua goi y phan cong that bai:', e);
    }
  }
  return recorded;
}
