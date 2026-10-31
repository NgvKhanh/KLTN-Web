// PREFLIGHT (CHATBOT_V2_ACTIONS_PLAN.md, Phase 2): moi buoc TRUOC KHI ghi bat ky dong nao vao CSDL.
//
//   1. hinh dang  (thuan)  : gioi han -> tu noi chu thanh tham chieu noi bo -> do thi phu thuoc (khong vong, khong thieu, khong sai loai)
//   2. nguon goc  (thuan)  : tung thao tac co do chinh cau cua nguoi dung yeu cau khong (DATA khong phai CHI DAN)
//   3. phan giai  (CSDL)   : the / cot / nguoi / nhan co san -> id, trong DUNG bang cua ke hoach; trung ten -> nut chon; khong thay -> loi
//   4. nghiep vu  (CSDL)   : trung / mau thuan giua cac thao tac
//   5. quyen      (CSDL)   : actions.guard.guardPlan cho TAT CA thao tac
// Mot buoc bao loi -> khong thao tac nao duoc ghi. Cung cac ham nay duoc goi LAI luc "Ap dung" de phat hien du lieu da doi (STALE).

import type { IsoDate } from '../../../ai/ai.dates';
import { resolveEntities } from '../chat.v2.entities';
import type { EntityOption } from '../chat.v2.entities';
import type { ExecutionContext } from '../chat.v2.scope';
import { shapePlan, type LimitErrorCode } from './actions.graph';
import { findPatchCollision } from './actions.patch.build';
import { loadBoardContext } from './actions.patch.context';
import { assessPatchProvenance, PATCH_LIMITS, PATCH_SPLIT_HINT } from './actions.patch.schema';
import { assessPlanProvenance, type PlanProvenance } from './actions.provenance';
import { slotsOf } from './actions.refs';
import { UNSUPPORTED_RULE_TEXT } from './actions.rule';
import { unsupportedRuleCue } from './actions.text';
import { resolveOps, type Presets, type ResolveOpsResult } from './actions.resolve';
import type { ActionOp } from './actions.schema';
import { canonicalJson, stateDigest, staleReasonOf } from './actions.plan';
import type { ActionErrorCode, StoredOp, StoredPlan } from './actions.types';

export interface Prepared {
  /** Thao tac da gan key + noi tham chieu, THEO THU TU CHAY (topo on dinh). */
  ordered: ActionOp[];
  prov: PlanProvenance;
  /** Chu cua cac tham chieu THE da duoc tu noi vao the sap tao (de canh bao khi bang cung co the cung ten). */
  linkedCardTexts: string[];
  /** Ghi chu hien o ban xem truoc (vd "no" duoc hieu la the moi). */
  notes: string[];
}

/** ACTIONS: ke hoach thuong (Phase 1-2). PATCH: Board Patch (Phase 3) - han muc rieng, nguon goc theo CAU, cot tu do, kiem trung khi ap dung. */
export type PlanMode = 'ACTIONS' | 'PATCH';
export const modeOf = (stored: Pick<StoredPlan, 'kind'>): PlanMode => (stored.kind === 'PATCH' ? 'PATCH' : 'ACTIONS');

export type PrepareResult = { ok: true; prepared: Prepared } | { ok: false; code: ActionErrorCode; text: string };

const LIMIT_CODES: ReadonlySet<string> = new Set<LimitErrorCode>(['TOO_MANY_OPS', 'TOO_MANY_CARDS', 'TOO_MANY_LISTS', 'TOO_MANY_REFS']);

/** Pha thuan: hinh dang + nguon goc. `today` = ngay lich o Viet Nam luc LAP ke hoach (khong doc dong ho o day). */
export function prepare(proposed: readonly ActionOp[], message: string, today: IsoDate, mode: PlanMode = 'ACTIONS'): PrepareResult {
  const shaped = mode === 'PATCH' ? shapePlan(proposed, PATCH_LIMITS, PATCH_SPLIT_HINT) : shapePlan(proposed);
  if (!shaped.ok) {
    const code: ActionErrorCode = LIMIT_CODES.has(shaped.code) ? (shaped.code as LimitErrorCode) : 'INVALID_PLAN';
    return { ok: false, code, text: shaped.text };
  }
  // Phase 7: luat tu dong hoa chi ho tro 2 dieu kien + 3 hanh dong cua engine; cau doi dieu kien / hanh dong khac (nhac han, gui email, hen gio...) -> noi ro, khong tao
  for (const op of proposed) {
    if (op.type !== 'CREATE_AUTOMATION_RULE') continue;
    const own = slotsOf(op).flatMap((s) => (s.ref?.by === 'TEXT' ? [s.ref.text] : []));
    if (unsupportedRuleCue(message, own) !== null) return { ok: false, code: 'UNSUPPORTED_RULE', text: UNSUPPORTED_RULE_TEXT };
  }
  const ordered = shaped.order.map((i) => shaped.ops[i]);
  const linkedCardTexts: string[] = [];
  for (const [i, original] of proposed.entries()) {
    const after = slotsOf(shaped.ops[i]);
    for (const slot of slotsOf(original)) {
      if (slot.kind !== 'card' || slot.ref?.by !== 'TEXT') continue;
      if (after.find((s) => s.name === slot.name)?.ref?.by === 'PLAN' && !linkedCardTexts.includes(slot.ref.text)) linkedCardTexts.push(slot.ref.text);
    }
  }
  const prov = mode === 'PATCH' ? assessPatchProvenance(ordered, message) : assessPlanProvenance(ordered, message, today);
  return { ok: true, prepared: { ordered, prov, linkedCardTexts, notes: shaped.notes } };
}

export interface ResolveArgs {
  userId: string;
  exec: ExecutionContext;
  boardId: string;
  bindings: readonly EntityOption[];
  prepared: Prepared;
  presets: Presets;
  mode?: PlanMode;
  /** Thoi diem lap ke hoach (xem ResolveEnv.planNow). */
  planNow?: Date;
  /** Buoc G: cac tep tam dinh kem vao tin nhan lap ke hoach. */
  uploads?: readonly { id: string; name: string; size: number; ext: string }[];
}

export type ResolvedPlan =
  | { kind: 'OK'; ops: StoredOp[]; warnings: string[]; pins: Record<string, string> }
  | Exclude<ResolveOpsResult, { kind: 'OK' }>;

/** Pha CSDL: phan giai moi tham chieu, tim trung / mau thuan. Chua kiem quyen (guardPlan lam o buoc sau). */
export async function resolvePrepared(args: ResolveArgs): Promise<ResolvedPlan> {
  const { prepared } = args;
  const patch = args.mode === 'PATCH';
  const res = await resolveOps(
    { userId: args.userId, exec: args.exec, boardId: args.boardId, bindings: args.bindings, ...(patch ? { freeLists: true } : {}), ...(args.planNow !== undefined ? { planNow: args.planNow } : {}), ...(args.uploads !== undefined ? { uploads: args.uploads } : {}) },
    prepared.ordered,
    args.presets,
    prepared.prov.perOp.map((p) => p.due)
  );
  if (res.kind !== 'OK') return res;
  if (patch) {
    // cot / the cua Board Patch khong duoc trung thu da co (ke ca thu nguoi khac vua them sau luc xem truoc)
    const collision = findPatchCollision(res.ops, (await loadBoardContext(args.boardId)).context);
    if (collision !== null) return { kind: 'FAIL', code: 'CONFLICT', text: `${collision} Chưa thay đổi gì.`, ops: res.ops };
  }
  const warnings = [...res.warnings, ...prepared.notes];
  // "giao Unit Test cho Nam" hieu la the MOI sap tao; neu bang da co the gan ten do thi noi ro de nguoi dung kiem tra o ban xem truoc
  for (const text of prepared.linkedCardTexts) {
    const existing = await resolveEntities(args.exec, 'CARD', text);
    if (existing.status !== 'NOT_FOUND') warnings.push(`“${text}” được hiểu là thẻ MỚI sắp tạo trong kế hoạch này (bảng cũng đã có thẻ tên tương tự).`);
  }
  return { kind: 'OK', ops: res.ops, warnings, pins: res.pins };
}

export type RebuildResult =
  | { kind: 'SAME' }
  | { kind: 'CHANGED'; reason: string }
  | { kind: 'UNRESOLVABLE'; code: ActionErrorCode; reason: string };

/**
 * DUNG LAI ke hoach tu phan tuong trung da luu + cac id da ghim, roi so voi ke hoach luc xem truoc. Khac (id, gia tri cu, ten, mot
 * tham chieu khong con duy nhat / khong con tim thay...) thi ke hoach da CU: khong ghi de thay doi moi cua nguoi khac.
 * Ngay luc lap ke hoach dung `createdAt` de "thu sau" khong troi neu nguoi dung bam Ap dung sang ngay hom sau.
 */
export async function rebuildAndCompare(args: {
  userId: string;
  exec: ExecutionContext;
  stored: StoredPlan;
  today: IsoDate;
  /** Thoi diem lap ke hoach (createdAt): goi y / chia viec dung lai ket qua tai thoi diem do. */
  planNow?: Date;
}): Promise<RebuildResult> {
  const { stored } = args;
  const mode = modeOf(stored);
  const prep = prepare(stored.symbolic, stored.message, args.today, mode);
  if (!prep.ok) return { kind: 'UNRESOLVABLE', code: prep.code, reason: prep.text };
  const res = await resolvePrepared({ userId: args.userId, exec: args.exec, boardId: stored.boardId, bindings: [], prepared: prep.prepared, presets: stored.presets, mode, ...(args.planNow !== undefined ? { planNow: args.planNow } : {}), ...(stored.uploads !== undefined ? { uploads: stored.uploads } : {}) });
  if (res.kind === 'CHOICE') return { kind: 'CHANGED', reason: 'Có thêm đối tượng cùng tên kể từ lúc xem trước nên mình không còn chắc bạn muốn đối tượng nào.' };
  if (res.kind === 'FAIL') return { kind: 'UNRESOLVABLE', code: res.code === 'NOT_FOUND' ? 'STALE' : res.code, reason: res.text };
  const seen = stored.ops;
  const expected = stored.stateDigest ?? stateDigest(seen);
  if (stateDigest(res.ops) === expected) return { kind: 'SAME' };
  const at = seen.findIndex((op, i) => res.ops[i] === undefined || canonicalJson(op) !== canonicalJson(res.ops[i]));
  return { kind: 'CHANGED', reason: at >= 0 && res.ops[at] !== undefined ? staleReasonOf(seen[at], res.ops[at]) : 'Dữ liệu đã thay đổi kể từ lúc xem trước.' };
}
