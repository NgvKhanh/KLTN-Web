// DICH VU HANH DONG cua chatbot v2 - Phase 1 (mot thao tac) + Phase 2 (nhieu thao tac trong MOT bang) (CHATBOT_V2_ACTIONS_PLAN.md §6).
//
// Cac cua vao (chi cua dau tien dung LLM; tu do ve sau LLM khong con tham gia):
//   proposeActions : LLM da de xuat cac thao tac tuong trung -> preflight -> kiem quyen -> TU CHAY (1 thao tac an toan) hoac XEM TRUOC
//   choosePlanRef  : nguoi dung bam nut chon (tham chieu nhap nhang) -> tiep tuc DUNG ke hoach dang do
//   confirmPlan    : nut "Ap dung"          cancelPlan : nut "Huy"          planView : xem lai trang thai that
//   typedPlanCommand : go "huy" -> huy ke hoach dang mo; go "ok / ap dung" -> KHONG xac nhan, nhac bam nut
//
// Moi ke hoach nam o bang ChatActionPlan nen khong phu thuoc phien trong bo nho (may chu khoi dong lai van xac nhan duoc).
// Moi lan cham toi ke hoach deu kiem lai: chu so huu, hoi thoai, han, checksum, tran pham vi, quyen. Viec ghi nam trong
// actions.executor (mot transaction); o day khong co lenh ghi nao.

import { prisma } from '../../../../config/prisma';
import { AppError } from '../../../../utils/AppError';
import { vnToday } from '../../chat.period';
import type { ChatScopeInput } from '../../chat.scope';
import type { EntityOption } from '../chat.v2.entities';
import { OUT_OF_CEILING, resolveExecutionContext, type ExecutionContext } from '../chat.v2.scope';
import type { V2Session } from '../chat.v2.session';
import { decideExecution, refusalBeforeResolve } from './actions.autorun';
import { handlerOf } from './ops/ops.registry';
import { executePlan } from './actions.executor';
import { guardPlan } from './actions.guard';
import { describeOp, errorText, OP_LABEL, planChecksum, stateDigest } from './actions.plan';
import {
  cancelOpenPlans,
  cancelPlanRow,
  createPlanRow,
  expireIfNeeded,
  findOpenPlan,
  findOwnedPlan,
  recoverIfStuck,
  replacePlan,
  type NewPlan,
  type PlanRow,
} from './actions.plan.repo';
import { prepare, resolvePrepared, type Prepared, type ResolvedPlan } from './actions.preflight';
import type { PlanProvenance } from './actions.provenance';
import type { Presets } from './actions.resolve';
import type { ActionOp } from './actions.schema';
import { foldWords } from './actions.text';
import type { ActionErrorCode, ActionView, ConfirmReason, PendingChoice, PlanRisk, PlanStatus, Provenance, ResultView, StoredOp, StoredPlan } from './actions.types';
import { planViewOf, resultFromRow, viewFromRow } from './actions.view';

export { resultFromRow, viewFromRow };

/** Thong tin ve lan goi LLM da sinh ra de xuat (ghi vao ChatActionPlan de do dac / truy vet). */
export interface PlanMeta {
  provider: string;
  model: string;
  adapter: string;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs: number | null;
}

/** Phan cua phien hoi thoai ma lop hanh dong duoc doc (khong sua). */
export interface ActionSession {
  id: string;
  userId: string;
  uiScope: ChatScopeInput;
  scope?: ChatScopeInput;
  bindings: readonly EntityOption[];
}

export interface ActionOutcome {
  /** Khoi hien thi (xem truoc / ket qua). Vang khi chi la loi nhac bang chu (tu choi, hoi lai). */
  action?: ActionView;
  text: string;
  /** Ma tu choi (de ghi vet / kiem thu): co khi khong chay gi. */
  refusal?: ActionErrorCode;
  /** Doi tuong dua vao ngu canh hoi thoai de hieu "no" o cau sau. */
  bind: EntityOption[];
  /** Cau hoi tiep theo (chon doi tuong / nhap ten bang). */
  pending?: NonNullable<V2Session['pending']>;
}

export const PREVIEW_TEXT = 'Mình sẽ làm như sau. Bấm “Áp dụng” để thực hiện hoặc “Hủy” để bỏ qua.';
/** Cau dan cua ban xem truoc nhieu thao tac ("Tôi sẽ thực hiện N thay đổi"); danh sach tung buoc nam o khoi ke hoach. */
export const previewText = (count: number): string =>
  count <= 1 ? PREVIEW_TEXT : `Mình sẽ thực hiện ${count} thay đổi trên cùng một bảng (làm tất cả hoặc không làm gì). Bấm “Áp dụng” để thực hiện hoặc “Hủy” để bỏ qua.`;
const NO_BOARD_TEXT =
  'Bạn muốn thao tác ở bảng nào? Hãy trả lời dạng “bảng Marketing” (hoặc mở bảng đó rồi nhờ mình). Chưa thay đổi gì.';

const KIND_OF: Record<PendingChoice['kind'], EntityOption['kind']> = {
  card: 'CARD',
  list: 'COLUMN',
  member: 'MEMBER',
  label: 'LABEL',
  // doi tuong con (binh luan, muc checklist, tep, luat...): giao dien chi can id + ten, nen dung chung kieu 'CARD'
  comment: 'CARD',
  item: 'CARD',
  checklist: 'CARD',
  attachment: 'CARD',
  rule: 'CARD',
  field: 'CARD',
  template: 'CARD',
  archivedCard: 'CARD',
  archivedList: 'COLUMN',
  option: 'CARD',
};
const WHAT: Record<PendingChoice['kind'], string> = {
  card: 'thẻ',
  list: 'cột',
  member: 'người',
  label: 'nhãn',
  comment: 'bình luận',
  item: 'mục checklist',
  checklist: 'checklist',
  attachment: 'tệp',
  rule: 'luật',
  field: 'trường',
  template: 'thẻ mẫu',
  archivedCard: 'thẻ đã lưu trữ',
  archivedList: 'cột đã lưu trữ',
  option: 'lựa chọn',
};

// ---------------------------------------------------------------------------------------------------------------------
// Bang dich + tran pham vi
// ---------------------------------------------------------------------------------------------------------------------

export interface Target {
  exec: ExecutionContext;
  boardId: string;
  boardName: string;
}
type TargetResult = { ok: true; target: Target } | { ok: false; code: ActionErrorCode; text: string };

/**
 * Bang cua ke hoach = bang ma `exec` da kep ve (trang bang: dung bang do; trang chu: bang da nhac ten trong hoi thoai). Khong biet
 * bang nao -> NO_BOARD (hoi lai). Moi ke hoach CHI tac dong mot bang (D5).
 */
export async function targetBoard(session: ActionSession, now: Date): Promise<TargetResult> {
  let exec: ExecutionContext;
  try {
    exec = await resolveExecutionContext({ userId: session.userId, now, scope: session.uiScope, conversationScope: session.scope });
  } catch (e) {
    if (e instanceof AppError && e.statusCode < 500) {
      if (e.message === OUT_OF_CEILING) return { ok: false, code: 'OUT_OF_SCOPE', text: `${OUT_OF_CEILING} Chưa thay đổi gì.` };
      return e.statusCode === 404
        ? { ok: false, code: 'NOT_FOUND', text: 'Không tìm thấy bảng này (có thể đã bị xóa hoặc lưu trữ). Chưa thay đổi gì.' }
        : { ok: false, code: 'FORBIDDEN', text: 'Bạn không còn quyền với bảng này. Chưa thay đổi gì.' };
    }
    throw e;
  }
  const board = exec.scope.board;
  if (exec.scope.kind !== 'BOARD' || board === null) return { ok: false, code: 'NO_BOARD', text: NO_BOARD_TEXT };
  return { ok: true, target: { exec, boardId: board.id, boardName: board.name } };
}

/** Bang nam trong tran pham vi cua giao dien? (trang bang: dung bang do; khong gian: bang cua khong gian do; trang chu: moi bang). */
export async function boardInCeiling(scope: ChatScopeInput, boardId: string): Promise<boolean> {
  if (scope.kind === 'MY') return true;
  if (scope.kind === 'BOARD') return scope.boardId === boardId;
  return (await prisma.board.count({ where: { id: boardId, workspaceId: scope.workspaceId } })) > 0;
}

// ---------------------------------------------------------------------------------------------------------------------
// Ghi ke hoach
// ---------------------------------------------------------------------------------------------------------------------

export interface Base {
  session: ActionSession;
  now: Date;
  message: string;
  symbolic: ActionOp[];
  meta: PlanMeta;
  autoExecute: boolean;
  /** Buoc G: cac tep tam nguoi dung dinh kem vao tin nhan (rong = khong). */
  uploads?: { id: string; name: string; size: number; ext: string }[];
}

interface Run {
  base: Base;
  target: Target;
  prepared: Prepared;
  inCeiling: boolean;
  presets: Presets;
  existing: PlanRow | null;
}

export interface PlanData {
  plan: StoredPlan;
  risk: PlanRisk;
  requiresConfirmation: boolean;
  reasons: readonly ConfirmReason[];
  provenance: Provenance;
  status: PlanStatus;
  autoExecuted?: boolean;
  errorCode?: ActionErrorCode;
  /** Do dac: qua duoc buoc phan tich (schema + do thi) / buoc phan giai chua. */
  parse?: boolean;
  resolve?: boolean | null;
}

export function storedPlan(base: Base, target: Target | null, ops: StoredOp[], extra: Partial<StoredPlan> = {}): StoredPlan {
  return {
    version: 2,
    boardId: target?.boardId ?? '',
    boardName: target?.boardName ?? '',
    message: base.message,
    symbolic: base.symbolic,
    ops,
    presets: {},
    warnings: [],
    ...(ops.length > 0 ? { stateDigest: stateDigest(ops) } : {}),
    ...(base.uploads !== undefined && base.uploads.length > 0 ? { uploads: base.uploads } : {}),
    ...extra,
  };
}

export async function persist(base: Base, target: Target | null, data: PlanData, existing: PlanRow | null): Promise<PlanRow> {
  const userId = base.session.userId;
  const input: NewPlan = {
    userId,
    conversationId: base.session.id,
    boardId: target?.boardId ?? null,
    scopeKind: base.session.uiScope.kind,
    prompt: base.message,
    plan: data.plan,
    checksum: planChecksum({ userId, boardId: target?.boardId ?? '', ops: data.plan.ops }),
    risk: data.risk,
    requiresConfirmation: data.requiresConfirmation,
    reasons: data.reasons,
    provenance: data.provenance,
    status: data.status,
    ...(data.autoExecuted !== undefined ? { autoExecuted: data.autoExecuted } : {}),
    ...(data.errorCode !== undefined ? { errorCode: data.errorCode } : {}),
    opTypes: (data.plan.ops.length > 0 ? data.plan.ops.map((o) => o.type) : base.symbolic.map((o) => o.type)),
    proposedOps: base.symbolic.length,
    parseSuccess: data.parse ?? true,
    resolveSuccess: data.resolve ?? null,
    now: base.now,
    meta: base.meta,
  };
  if (!existing) return createPlanRow(input);
  const updated = await replacePlan(existing.id, input);
  // da bi huy / het han giua luc nguoi dung bam nut -> khong tiep tuc
  if (!updated) throw new AppError('Kế hoạch đã hết hạn hoặc đã bị hủy. Hãy gửi lại lệnh.', 409);
  return updated;
}

/** Ghi vet mot lan TU CHOI (khong chay gi) va tra loi bang chu. */
export async function refuse(
  base: Base,
  target: Target | null,
  code: ActionErrorCode,
  text: string,
  extra: {
    ops?: StoredOp[];
    provenance?: Provenance;
    presets?: Presets;
    existing?: PlanRow | null;
    pending?: ActionOutcome['pending'];
    parse?: boolean;
    resolve?: boolean | null;
    /** Phan them vao ban ghi ke hoach (vd kind: 'PATCH' + thong tin Board Patch) de lan tu choi van duoc do dac dung loai. */
    stored?: Partial<StoredPlan>;
  } = {}
): Promise<ActionOutcome> {
  await persist(
    base,
    target,
    {
      plan: storedPlan(base, target, extra.ops ?? [], { presets: extra.presets ?? {}, ...(extra.stored ?? {}) }),
      risk: 'LOW',
      requiresConfirmation: false,
      reasons: [],
      provenance: extra.provenance ?? 'UNGROUNDED',
      status: 'FAILED',
      errorCode: code,
      ...(extra.parse !== undefined ? { parse: extra.parse } : {}),
      ...(extra.resolve !== undefined ? { resolve: extra.resolve } : {}),
    },
    extra.existing ?? null
  );
  return { text, refusal: code, bind: [], ...(extra.pending !== undefined ? { pending: extra.pending } : {}) };
}

function labelOf(stored: StoredPlan): string {
  if (stored.kind === 'PATCH' && stored.patch) {
    const parts = [stored.patch.newLists > 0 ? `${stored.patch.newLists} cột` : '', stored.patch.newCards > 0 ? `${stored.patch.newCards} thẻ` : ''].filter((p) => p !== '');
    return `thêm ${parts.join(' và ')} vào bảng “${stored.boardName}”`;
  }
  if (stored.ops.length > 1) return `${stored.ops.length} thay đổi trên bảng “${stored.boardName}”`;
  const first = stored.ops[0];
  if (!first) return 'kế hoạch';
  const item = describeOp(first, 0);
  return `${item.verb} ${item.text}`.slice(0, 120);
}

// ---------------------------------------------------------------------------------------------------------------------
// De xuat -> tu chay / xem truoc
// ---------------------------------------------------------------------------------------------------------------------

export interface ProposeInput {
  session: ActionSession;
  now: Date;
  /** Cau CUA NGUOI DUNG (da gop phan bo sung): nguon cua giay phep dong tu va cua viec "gan vao cau". */
  message: string;
  operations: readonly ActionOp[];
  autoExecute: boolean;
  meta: PlanMeta;
  /** Buoc G: cac tep tam nguoi dung dinh kem vao tin nhan nay. */
  uploads?: { id: string; name: string; size: number; ext: string }[];
}

async function needsChoice(run: Run, pending: PendingChoice, pins: Record<string, string>): Promise<ActionOutcome> {
  const { base, target } = run;
  const row = await persist(
    base,
    target,
    {
      plan: storedPlan(base, target, [], { presets: { ...run.presets, ...pins }, pending }),
      risk: 'LOW',
      requiresConfirmation: true,
      reasons: [],
      provenance: run.prepared.prov.verdict,
      status: 'NEEDS_CHOICE',
    },
    run.existing
  );
  // tao the ma khong noi cot nao: khong co gi "khop" ca, chi la chua noi
  const question =
    pending.sig === 'list:none'
      ? 'Bạn muốn tạo thẻ trong cột nào?'
      : pending.text === ''
        ? `Có nhiều ${WHAT[pending.kind]} phù hợp. Bạn muốn chọn ${WHAT[pending.kind]} nào?`
        : `Có nhiều ${WHAT[pending.kind]} khớp “${pending.text}”. Bạn muốn chọn ${WHAT[pending.kind]} nào?`;
  return {
    text: question,
    bind: [],
    pending: {
      kind: 'PLAN_REF',
      planId: row.id,
      original: base.message,
      question,
      options: pending.options.map((o) => ({ id: o.id, name: o.label, kind: KIND_OF[pending.kind] })),
    },
  };
}

/** Ket qua phan giai -> chinh sach tu chay -> luu ke hoach -> (tu chay | xem truoc | tu choi). */
async function conclude(run: Run, resolved: ResolvedPlan): Promise<ActionOutcome> {
  const { base, target, prepared } = run;
  const userId = base.session.userId;
  const verdict = prepared.prov.verdict;
  const fail = (code: ActionErrorCode, text: string, ops: StoredOp[], resolve: boolean) =>
    refuse(base, target, code, text, { ops, provenance: verdict, presets: run.presets, existing: run.existing, resolve });

  if (resolved.kind === 'FAIL') return fail(resolved.code, resolved.text, resolved.ops, false);
  if (resolved.kind === 'CHOICE') return needsChoice(run, resolved.pending, resolved.pins);

  const ops = resolved.ops;
  const guard = await guardPlan({ userId, boardId: target.boardId, ops });
  const decision = decideExecution({
    opTypes: ops.map((o) => o.type),
    provenance: prepared.prov,
    dueFuzzy: prepared.prov.dueFuzzy,
    refsUnique: true, // resolveOps chi tra OK khi moi tham chieu da la DUNG MOT (hoac nguoi dung vua tu chon bang nut)
    boardIds: [target.boardId],
    inCeiling: run.inCeiling,
    guard,
    autoExecute: base.autoExecute,
    aiChosen: ops.some((o) => o.choice !== undefined),
    extraReasons: ops.flatMap((o) => handlerOf(o.type)?.policy.confirmFor?.(o) ?? []),
  });
  if (decision.mode === 'REFUSE') return fail(decision.code, decision.text, ops, true);

  // moi thao tac deu KHONG doi gi (da dung roi) thi khong co gi de xac nhan: chay thang (khong ghi gi)
  const auto = decision.mode === 'AUTO' || ops.every((o) => o.noop !== undefined);
  const stored = storedPlan(base, target, ops, { presets: { ...run.presets, ...resolved.pins }, warnings: resolved.warnings });
  const row = await persist(
    base,
    target,
    {
      plan: stored,
      risk: auto ? 'LOW' : decision.risk,
      requiresConfirmation: !auto,
      reasons: auto ? [] : decision.reasons,
      provenance: verdict,
      status: 'PROPOSED',
      autoExecuted: auto,
      resolve: true,
    },
    run.existing
  );
  // mot lenh moi thay the cac ke hoach dang mo truoc do trong hoi thoai
  await cancelOpenPlans(userId, base.session.id, 'SUPERSEDED', base.now, { except: row.id });

  if (!auto) return { text: previewText(ops.length), action: { kind: 'PLAN', plan: planViewOf(row, stored, 'PROPOSED', base.now) }, bind: [] };
  const out = await executePlan({ row, now: base.now, autoExecuted: true, scope: base.session.uiScope, skipRebuild: true });
  return { text: out.result.summary, action: { kind: 'RESULT', result: out.result }, bind: out.bind };
}

export async function proposeActions(input: ProposeInput): Promise<ActionOutcome> {
  const { session, now, message, meta } = input;
  const symbolic = [...input.operations];
  const base: Base = { session, now, message, symbolic, meta, autoExecute: input.autoExecute, ...(input.uploads !== undefined ? { uploads: input.uploads } : {}) };

  // Hinh dang + nguon goc chi phu thuoc cau + de xuat (khong can biet bang): tinh TRUOC de (1) de xuat vuot gioi han / sai do thi / lenh
  // khong he duoc yeu cau bi tu choi ngay, khong hoi "bang nao?" cho mot viec nguoi dung khong nho, (2) dong kiem toan luon ghi dung
  // nguon goc ke ca khi thieu bang.
  const prep = prepare(symbolic, message, vnToday(now));
  if (!prep.ok) return refuse(base, null, prep.code, prep.text, { parse: false });
  const { prepared } = prep;
  const prov: PlanProvenance = prepared.prov;
  const multi = prepared.ordered.length > 1;
  const early = refusalBeforeResolve(prov, multi && prov.firstNotRequested !== undefined ? OP_LABEL[prepared.ordered[prov.firstNotRequested].type] : undefined);
  const found = await targetBoard(session, now);
  if (early) return refuse(base, found.ok ? found.target : null, early.code, early.text, { provenance: prov.verdict });
  if (!found.ok) {
    return refuse(base, null, found.code, found.text, {
      provenance: prov.verdict,
      ...(found.code === 'NO_BOARD' ? { pending: { kind: 'QUESTION', original: message, question: found.text, options: [] } as const } : {}),
    });
  }
  const { target } = found;

  const run: Run = { base, target, prepared, inCeiling: await boardInCeiling(session.uiScope, target.boardId), presets: {}, existing: null };
  const resolved = await resolvePrepared({ userId: session.userId, exec: target.exec, boardId: target.boardId, bindings: session.bindings, prepared, presets: {}, planNow: now, ...(input.uploads !== undefined ? { uploads: input.uploads } : {}) });
  return conclude(run, resolved);
}

/** Ghi vet mot lan tu choi khong gan voi thao tac cu the (de xuat khong hop le sau khi da cho mo hinh sua mot lan...). */
export async function recordRefusal(
  input: { session: ActionSession; now: Date; message: string; meta: PlanMeta },
  code: ActionErrorCode,
  text: string
): Promise<ActionOutcome> {
  return refuse({ ...input, symbolic: [], autoExecute: false }, null, code, text, { parse: false });
}

export interface ChoiceInput {
  session: ActionSession;
  planId: string;
  optionId: string;
  now: Date;
  autoExecute: boolean;
}

/** Nguoi dung bam nut chon mot doi tuong: tiep tuc DUNG ke hoach dang do, KHONG goi lai LLM. */
export async function choosePlanRef(input: ChoiceInput): Promise<ActionOutcome> {
  const { session, planId, optionId, now } = input;
  const found = await findOwnedPlan(session.userId, planId);
  if (!found || found.conversationId !== session.id) throw new AppError('Không tìm thấy kế hoạch.', 404);
  const row = await expireIfNeeded(found, now);
  if (row.status !== 'NEEDS_CHOICE') throw new AppError('Lựa chọn này đã hết hạn hoặc đã được xử lý. Hãy gửi lại lệnh.', 409);

  const stored = row.plan as unknown as StoredPlan;
  const pending = stored.pending;
  if (stored.version !== 2 || !pending || !pending.options.some((o) => o.id === optionId)) {
    if (stored.version !== 2) {
      // cau hoi chon do ma Phase 1 de lai: khong dung duoc voi bo phan giai moi
      await cancelPlanRow(row.id, session.userId, 'SUPERSEDED', now);
      throw new AppError('Lựa chọn này đã cũ. Hãy gửi lại lệnh.', 409);
    }
    throw new AppError('Lựa chọn không hợp lệ', 400);
  }
  const presets: Presets = { ...stored.presets, [pending.sig]: optionId };
  const meta: PlanMeta = {
    provider: row.provider ?? 'unknown',
    model: row.model ?? 'unknown',
    adapter: row.adapter ?? 'unknown',
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    latencyMs: row.latencyMs,
  };
  const base: Base = { session, now, message: stored.message, symbolic: stored.symbolic, meta, autoExecute: input.autoExecute, ...(stored.uploads !== undefined ? { uploads: stored.uploads } : {}) };

  const found2 = await targetBoard(session, now);
  if (!found2.ok) return refuse(base, null, found2.code, found2.text, { presets, existing: row });
  const { target } = found2;
  if (target.boardId !== stored.boardId) {
    // nguoi dung da sang bang / trang khac giua hai buoc
    await cancelPlanRow(row.id, session.userId, 'SCOPE_CHANGED', now);
    return { text: errorText('SCOPE_CHANGED'), refusal: 'SCOPE_CHANGED', bind: [] };
  }
  // ngay "hom nay" cua ke hoach la ngay LAP ke hoach (khong troi neu nguoi dung bam chon muon)
  const prep = prepare(stored.symbolic, stored.message, vnToday(row.createdAt));
  if (!prep.ok) return refuse(base, target, prep.code, prep.text, { presets, existing: row, parse: false });
  const run: Run = { base, target, prepared: prep.prepared, inCeiling: await boardInCeiling(session.uiScope, target.boardId), presets, existing: row };
  const resolved = await resolvePrepared({ userId: session.userId, exec: target.exec, boardId: target.boardId, bindings: session.bindings, prepared: prep.prepared, presets, ...(stored.uploads !== undefined ? { uploads: stored.uploads } : {}) });
  return conclude(run, resolved);
}

// ---------------------------------------------------------------------------------------------------------------------
// Ap dung / huy / xem lai
// ---------------------------------------------------------------------------------------------------------------------

export interface PlanDecision {
  result: ResultView;
  text: string;
  bind: EntityOption[];
  /** Mo ta ngan cua ke hoach (ghi vao lich su: "Ap dung: ..."). */
  label: string;
}

const NOT_FOUND_PLAN = 'Không tìm thấy kế hoạch.';

async function ownedPlan(userId: string, planId: string, conversationId: string): Promise<PlanRow> {
  const row = await findOwnedPlan(userId, planId);
  // nguoi khac / hoi thoai khac -> cung mot cau tra loi nhu "khong ton tai" (khong lo la co ke hoach)
  if (!row || row.conversationId !== conversationId) throw new AppError(NOT_FOUND_PLAN, 404);
  return row;
}

function decided(row: PlanRow, replay: boolean): PlanDecision {
  const result = resultFromRow(row, replay);
  return { result, text: result.summary, bind: [], label: labelOf(row.plan as unknown as StoredPlan) };
}

export interface ConfirmInput {
  userId: string;
  planId: string;
  conversationId: string;
  checksum: string;
  /** Pham vi giao dien HIEN TAI (khong phai luc de xuat): ke hoach cua bang khac bi huy. */
  scope: ChatScopeInput;
  now: Date;
}

/**
 * Nut "Ap dung". Khong goi LLM. Viec nhan cho nam TRONG transaction ghi (actions.executor): bam hai lan / hai tab chi chay mot lan,
 * lan sau doi lan dau xong roi nhan lai ket qua da luu (alreadyApplied) - khong tao ban sao.
 */
export async function confirmPlan(input: ConfirmInput): Promise<PlanDecision> {
  const { userId, planId, now } = input;
  const row = await recoverIfStuck(await expireIfNeeded(await ownedPlan(userId, planId, input.conversationId), now), now);

  if (row.status === 'NEEDS_CHOICE') throw new AppError('Hãy chọn đối tượng trước khi áp dụng.', 409);
  if (row.status === 'EXECUTING') throw new AppError('Kế hoạch đang được thực hiện. Hãy chờ một chút.', 409);
  if (row.status !== 'PROPOSED') return decided(row, true);

  const stored = row.plan as unknown as StoredPlan;
  if (row.checksum !== input.checksum) throw new AppError('Kế hoạch không khớp với bản xem trước. Hãy gửi lại lệnh.', 409);
  if (row.boardId === null || !(await boardInCeiling(input.scope, row.boardId))) {
    await cancelPlanRow(row.id, userId, 'SCOPE_CHANGED', now);
    return decided((await findOwnedPlan(userId, planId)) ?? row, false);
  }

  const out = await executePlan({ row, now, autoExecuted: false, scope: input.scope });
  return { result: out.result, text: out.result.summary, bind: out.bind, label: labelOf(stored) };
}

export interface CancelInput {
  userId: string;
  planId: string;
  conversationId: string;
  now: Date;
}

/** Nut "Huy" (hoac go "huy"). Lap lai an toan: huy hai lan van la "da huy"; ke hoach da chay thi tra ket qua that. */
export async function cancelPlan(input: CancelInput): Promise<PlanDecision> {
  const { userId, planId, now } = input;
  let row = await recoverIfStuck(await expireIfNeeded(await ownedPlan(userId, planId, input.conversationId), now), now);
  if (row.status === 'PROPOSED' || row.status === 'NEEDS_CHOICE') {
    await cancelPlanRow(row.id, userId, null, now);
    row = (await findOwnedPlan(userId, planId)) ?? row;
  }
  if (row.status === 'EXECUTING') throw new AppError('Kế hoạch đang được thực hiện nên chưa hủy được.', 409);
  return decided(row, false);
}

/** Trang thai that (de giao dien tai lai). Chi chu ke hoach xem duoc. */
export async function planView(userId: string, planId: string, now: Date): Promise<ActionView> {
  const row = await findOwnedPlan(userId, planId);
  if (!row) throw new AppError(NOT_FOUND_PLAN, 404);
  return viewFromRow(row, now);
}

// ---------------------------------------------------------------------------------------------------------------------
// Lenh go bang chu: "huy" huy ke hoach dang mo; "ok / ap dung" KHONG xac nhan (chi nut moi xac nhan)
// ---------------------------------------------------------------------------------------------------------------------

const CANCEL_WORDS: readonly string[] = [
  'huy',
  'huy di',
  'huy ke hoach',
  'huy cai vua roi',
  'huy lenh',
  'thoi',
  'thoi khong lam nua',
  'khong lam nua',
  'khong can nua',
  'dung lai',
];
const CONFIRM_WORDS: readonly string[] = [
  'ok',
  'oke',
  'okay',
  'yes',
  'co',
  'duoc',
  'dong y',
  'ap dung',
  'ap dung di',
  'xac nhan',
  'lam di',
  'chay di',
  'thuc hien di',
  'thuc hien',
];

/** null = khong phai lenh go hoac khong co ke hoach dang mo -> xu ly nhu cau hoi binh thuong. */
export async function typedPlanCommand(session: ActionSession, message: string, now: Date): Promise<ActionOutcome | null> {
  const folded = foldWords(message).join(' ');
  const cancel = CANCEL_WORDS.includes(folded);
  const confirm = CONFIRM_WORDS.includes(folded);
  if (!cancel && !confirm) return null;
  const open = await findOpenPlan(session.userId, session.id, now);
  if (!open) return null;
  if (confirm) {
    return {
      text: 'Để tránh làm nhầm, mình chỉ áp dụng khi bạn bấm nút “Áp dụng” trên bản xem trước (gõ “ok” thì mình không chạy). Chưa thay đổi gì.',
      bind: [],
    };
  }
  const res = await cancelPlan({ userId: session.userId, planId: open.id, conversationId: session.id, now });
  return { text: res.text, action: { kind: 'RESULT', result: res.result }, bind: [] };
}
