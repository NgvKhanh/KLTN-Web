// Dung ke hoach / xem truoc / ket qua - HAM THUAN (CHATBOT_V2_ACTIONS_PLAN.md §9.5, §12). Moi chu hien cho nguoi dung duoc dung tu
// ke hoach DA RESOLVE (ten lay tu CSDL), khong tu chu LLM viet - nen LLM khong the "noi" voi nguoi dung dieu khac voi thao tac se chay.

import { createHash } from 'node:crypto';
import { STATUS_LABEL } from '../../../card/cardStatus';
import { formatDueDate, vnDayOfIso } from './actions.dates';
import { ruleViewOf } from './actions.rule';
import { handlerOf, EXTENDED_TYPES } from './ops/ops.registry';
import type {
  ActionErrorCode,
  AssignChoiceView,
  ConfirmReason,
  PatchView,
  PlanItemView,
  PlanRisk,
  PlanStatus,
  PlanView,
  ResultStatus,
  ResultView,
  StoredOp,
} from './actions.types';

/** Ke hoach cho xem truoc song 10 phut. */
export const PLAN_TTL_MS = 10 * 60_000;

const q = (s: string | undefined): string => `“${s ?? ''}”`;

/** Ten ngan cua tung loai thao tac (dung khi noi ro thao tac nao khong duoc yeu cau). */
const CORE_LABEL: Record<string, string> = {
  CREATE_LIST: 'tạo cột',
  CREATE_CARD: 'tạo thẻ',
  RENAME_CARD: 'đổi tên thẻ',
  SET_CARD_DUE: 'đặt hạn cho thẻ',
  MOVE_CARD: 'chuyển thẻ sang cột khác',
  SET_CARD_STATUS: 'đổi trạng thái thẻ',
  ASSIGN_MEMBER: 'giao thẻ cho người',
  ADD_LABEL: 'gắn nhãn vào thẻ',
  ASSIGN_UNASSIGNED: 'chia các việc chưa có người nhận',
  CREATE_AUTOMATION_RULE: 'tạo luật tự động hóa',
  SET_CARD_DESCRIPTION: 'đổi mô tả thẻ',
  SET_CARD_START: 'đặt ngày bắt đầu cho thẻ',
  ADD_COMMENT: 'viết bình luận vào thẻ',
  ADD_CHECKLIST: 'thêm checklist vào thẻ',
  REMOVE_MEMBER: 'bỏ người khỏi thẻ',
  REMOVE_LABEL: 'gỡ nhãn khỏi thẻ',
  RENAME_LIST: 'đổi tên cột',
  ARCHIVE_CARD: 'lưu trữ thẻ',
};

/** Ten ngan cua MOI loai thao tac (cu + mo rong). */
export const OP_LABEL: Record<string, string> = {
  ...CORE_LABEL,
  ...Object.fromEntries(EXTENDED_TYPES.map((t) => [t, handlerOf(t)?.label ?? t])),
};

/** Dau van tay (sha256) cua mo ta thẻ: luu vao ban xem truoc de phat hien STALE ma khong phai luu ca doan mo ta cu. */
export const descriptionHash = (text: string | null | undefined): string => createHash('sha256').update((text ?? '').trim()).digest('hex');

/** Cat van ban dai de hien trong khung xem truoc (nguoi dung van thay nguyen van o phan chi tiet cua thao tac neu ngan hon gioi han). */
const clip = (text: string, max: number): string => (Array.from(text).length > max ? `${Array.from(text).slice(0, max).join('')}…` : text);

/** JSON on dinh: khoa sap xep, bo undefined - de checksum khong phu thuoc thu tu khoa. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** Dau van tay cua ke hoach: chu nhan, bang, va tung thao tac (loai + key + id + tham chieu noi bo + tham so). Xac nhan phai gui lai dung gia tri nay. */
export function planChecksum(input: { userId: string; boardId: string; ops: readonly StoredOp[] }): string {
  const payload = {
    userId: input.userId,
    boardId: input.boardId,
    ops: input.ops.map((o) => ({ type: o.type, key: o.key, ids: o.ids, local: o.local, params: o.params })),
  };
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

/**
 * Dau van tay TRANG THAI: nhu checksum nhung them gia tri CU, ten hien thi va co "da dung roi". Dung lai ke hoach luc ap dung phai ra
 * DUNG chuoi nay; khac di (the bi doi ten / chuyen / doi han, cot bi xoa, nguoi bi go, xuat hien the cung ten moi...) thi ke hoach
 * da CU (STALE) - khong ghi de thay doi moi cua nguoi khac chi vi ke hoach duoc lap truoc.
 */
export function stateDigest(ops: readonly StoredOp[]): string {
  const payload = ops.map((o) => ({ type: o.type, key: o.key, ids: o.ids, local: o.local, params: o.params, before: o.before, display: o.display, noop: o.noop }));
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

/** Cau giai thich vi sao thao tac `fresh` (dung lai luc ap dung) khac thao tac `seen` (luc xem truoc). */
export function staleReasonOf(seen: StoredOp, fresh: StoredOp): string {
  if (canonicalJson(seen.ids) !== canonicalJson(fresh.ids) || canonicalJson(seen.local) !== canonicalJson(fresh.local)) {
    return 'Đối tượng được chọn đã khác so với lúc xem trước.';
  }
  switch (seen.type) {
    case 'RENAME_CARD':
      return 'Thẻ đã được đổi tên kể từ lúc xem trước.';
    case 'SET_CARD_DUE':
      return 'Hạn của thẻ đã thay đổi kể từ lúc xem trước.';
    case 'MOVE_CARD':
      return 'Thẻ đã được chuyển sang cột khác kể từ lúc xem trước.';
    case 'SET_CARD_STATUS':
      return 'Trạng thái của thẻ đã thay đổi kể từ lúc xem trước.';
    case 'ASSIGN_MEMBER':
      return 'Thành viên của thẻ đã thay đổi kể từ lúc xem trước.';
    case 'ADD_LABEL':
      return 'Nhãn của thẻ đã thay đổi kể từ lúc xem trước.';
    case 'CREATE_AUTOMATION_RULE':
      return 'Cột, nhãn, người hoặc các luật của bảng đã thay đổi kể từ lúc xem trước.';
    case 'SET_CARD_DESCRIPTION':
      return 'Mô tả của thẻ đã thay đổi kể từ lúc xem trước.';
    case 'SET_CARD_START':
      return 'Ngày bắt đầu của thẻ đã thay đổi kể từ lúc xem trước.';
    case 'REMOVE_MEMBER':
      return 'Thành viên của thẻ đã thay đổi kể từ lúc xem trước.';
    case 'REMOVE_LABEL':
      return 'Nhãn của thẻ đã thay đổi kể từ lúc xem trước.';
    case 'RENAME_LIST':
      return 'Cột đã được đổi tên kể từ lúc xem trước.';
    default:
      return handlerOf(seen.type)?.stale ?? 'Dữ liệu đã thay đổi kể từ lúc xem trước.';
  }
}

function dueLabel(op: StoredOp): string {
  return op.params.due === null || op.params.due === undefined ? 'bỏ hạn' : formatDueDate(vnDayOfIso(op.params.due));
}

/** Ghi chu cho thao tac nham vao the do CHINH ke hoach tao ra (chua co trong bang luc xem truoc). */
const fresh = (op: StoredOp): string => (op.local?.card !== undefined ? ' (thẻ mới)' : '');
const listOf = (op: StoredOp, name: string | undefined): string => `${op.local?.list !== undefined ? 'cột mới ' : 'cột '}${q(name)}`;

/** Phan nguoi nhan do may chon dua len giao dien: KHONG co runId (chi dung noi bo de ghi ket qua sau khi Ap dung). */
const choiceView = (c: NonNullable<StoredOp['choice']>): AssignChoiceView => ({ source: c.source, rank: c.rank, score: c.score, confidenceLevel: c.confidenceLevel, flags: [...c.flags], alternatives: c.alternatives.map((a) => ({ ...a })) });

/** Mot dong trong khung xem truoc. */
export function describeOp(op: StoredOp, index: number): PlanItemView {
  const d = op.display;
  const cardId = op.ids.card;
  switch (op.type) {
    case 'CREATE_LIST':
      return {
        index,
        verb: 'Tạo cột',
        text: q(op.params.name),
        ...(op.params.listStatus ? { detail: `Trạng thái cột: ${STATUS_LABEL[op.params.listStatus]} (đoán theo tên, thẻ trong cột sẽ theo trạng thái này)` } : {}),
      };
    case 'CREATE_CARD':
      return { index, verb: 'Tạo thẻ', text: q(op.params.title), detail: `Trong ${listOf(op, d.listName)}` };
    case 'RENAME_CARD':
      return { index, verb: 'Đổi tên thẻ', text: `${q(op.before?.title)}${fresh(op)} → ${q(op.params.title)}`, cardId };
    case 'SET_CARD_DUE':
      return {
        index,
        verb: op.params.due === null ? 'Bỏ hạn' : 'Đặt hạn',
        text: `${q(d.cardTitle)}${fresh(op)}`,
        detail: op.params.due === null ? undefined : `${dueLabel(op)}${op.before?.due ? ` (trước: ${formatDueDate(vnDayOfIso(op.before.due))})` : ''}`,
        cardId,
      };
    case 'MOVE_CARD':
      return {
        index,
        verb: 'Chuyển thẻ',
        text: `${q(d.cardTitle)}${fresh(op)}`,
        detail: op.before ? `${q(op.before.listName)} → ${listOf(op, d.toListName)}` : `→ ${listOf(op, d.toListName)}`,
        cardId,
      };
    case 'SET_CARD_STATUS':
      return {
        index,
        verb: 'Đổi trạng thái',
        text: `${q(d.cardTitle)}${fresh(op)}`,
        detail: `${op.before?.status ? `${STATUS_LABEL[op.before.status]} → ` : '→ '}${op.params.status ? STATUS_LABEL[op.params.status] : '—'}`,
        cardId,
      };
    case 'ASSIGN_MEMBER':
      return { index, verb: 'Giao thẻ', text: `${q(d.cardTitle)}${fresh(op)} cho ${d.memberName ?? ''}`, cardId, ...(op.choice ? { choice: choiceView(op.choice) } : {}) };
    case 'ADD_LABEL':
      return { index, verb: 'Gắn nhãn', text: `${q(d.labelName)} vào thẻ ${q(d.cardTitle)}${fresh(op)}`, cardId };
    case 'CREATE_AUTOMATION_RULE':
      return { index, verb: 'Tạo luật tự động hóa', text: q(op.params.rule?.name), rule: ruleViewOf(d.ruleWhen ?? '', d.ruleThen ?? []) };
    case 'SET_CARD_DESCRIPTION':
      return {
        index,
        verb: 'Đổi mô tả',
        text: `${q(d.cardTitle)}${fresh(op)}`,
        detail: `Nội dung mới: ${clip(op.params.description ?? '', 400)}${(op.before?.descriptionLength ?? 0) > 0 ? `\n(Mô tả cũ ${op.before?.descriptionLength} ký tự sẽ bị thay bằng nội dung này.)` : ''}`,
        cardId,
      };
    case 'SET_CARD_START':
      return {
        index,
        verb: op.params.start === null || op.params.start === undefined ? 'Bỏ ngày bắt đầu' : 'Đặt ngày bắt đầu',
        text: `${q(d.cardTitle)}${fresh(op)}`,
        detail: op.params.start === null || op.params.start === undefined ? undefined : `${formatDueDate(vnDayOfIso(op.params.start))}${op.before?.start ? ` (trước: ${formatDueDate(vnDayOfIso(op.before.start))})` : ''}`,
        cardId,
      };
    case 'ADD_COMMENT':
      return { index, verb: 'Viết bình luận', text: `vào thẻ ${q(d.cardTitle)}${fresh(op)}`, detail: clip(op.params.text ?? '', 400), cardId };
    case 'ADD_CHECKLIST':
      return { index, verb: 'Thêm checklist', text: `${q(op.params.title ?? 'Việc cần làm')} vào thẻ ${q(d.cardTitle)}${fresh(op)}`, detail: (op.params.items ?? []).map((i) => `• ${clip(i, 120)}`).join('\n'), cardId };
    case 'REMOVE_MEMBER':
      return { index, verb: 'Bỏ người', text: `${d.memberName ?? ''} khỏi thẻ ${q(d.cardTitle)}${fresh(op)}`, cardId };
    case 'REMOVE_LABEL':
      return { index, verb: 'Gỡ nhãn', text: `${q(d.labelName)} khỏi thẻ ${q(d.cardTitle)}${fresh(op)}`, cardId };
    case 'RENAME_LIST':
      return { index, verb: 'Đổi tên cột', text: `${q(op.before?.listName)} → ${q(op.params.name)}` };
    case 'ARCHIVE_CARD':
      return { index, verb: 'Lưu trữ thẻ', text: q(d.cardTitle), detail: 'Thẻ sẽ ẩn khỏi bảng; khôi phục lại được trong mục Lưu trữ của bảng.', cardId };
    default:
      return handlerOf(op.type)?.describe(op, index) ?? { index, verb: op.type, text: '' };
  }
}

/** Cau ket qua khi thao tac da chay. `movedTo`: ten cot the tu chuyen sang (khi doi trang thai keo the sang cot khac). */
export function summarizeExecuted(op: StoredOp, extra: { movedTo?: string; createdTitle?: string } = {}): string {
  if (op.noop !== undefined) return op.noop;
  const d = op.display;
  switch (op.type) {
    case 'CREATE_LIST':
      return `Đã tạo cột ${q(op.params.name)}.`;
    case 'CREATE_CARD':
      return `Đã tạo thẻ ${q(extra.createdTitle ?? op.params.title)} trong cột ${q(d.listName)}.`;
    case 'RENAME_CARD':
      return `Đã đổi tên thẻ ${q(op.before?.title)} thành ${q(op.params.title)}.`;
    case 'SET_CARD_DUE':
      return op.params.due === null ? `Đã bỏ hạn của thẻ ${q(d.cardTitle)}.` : `Đã đặt hạn cho thẻ ${q(d.cardTitle)}: ${dueLabel(op)}.`;
    case 'MOVE_CARD':
      return op.before
        ? `Đã chuyển thẻ ${q(d.cardTitle)} từ cột ${q(op.before.listName)} sang ${q(d.toListName)}.`
        : `Đã chuyển thẻ ${q(d.cardTitle)} sang cột ${q(d.toListName)}.`;
    case 'SET_CARD_STATUS': {
      const base = `Đã đổi trạng thái thẻ ${q(d.cardTitle)} thành “${op.params.status ? STATUS_LABEL[op.params.status] : ''}”.`;
      return extra.movedTo === undefined ? base : `${base} Thẻ tự chuyển sang cột ${q(extra.movedTo)}.`;
    }
    case 'ASSIGN_MEMBER':
      return `Đã giao thẻ ${q(d.cardTitle)} cho ${d.memberName ?? ''}.`;
    case 'ADD_LABEL':
      return `Đã gắn nhãn ${q(d.labelName)} vào thẻ ${q(d.cardTitle)}.`;
    case 'CREATE_AUTOMATION_RULE':
      return `Đã tạo luật tự động hóa ${q(op.params.rule?.name)}. Luật đang bật; bạn tắt hoặc xóa được ở mục Tự động hóa của bảng.`;
    case 'SET_CARD_DESCRIPTION':
      return `Đã đổi mô tả của thẻ ${q(d.cardTitle)}.`;
    case 'SET_CARD_START':
      return op.params.start === null || op.params.start === undefined ? `Đã bỏ ngày bắt đầu của thẻ ${q(d.cardTitle)}.` : `Đã đặt ngày bắt đầu cho thẻ ${q(d.cardTitle)}: ${formatDueDate(vnDayOfIso(op.params.start))}.`;
    case 'ADD_COMMENT':
      return `Đã viết bình luận vào thẻ ${q(d.cardTitle)}.`;
    case 'ADD_CHECKLIST':
      return `Đã thêm checklist ${q(op.params.title ?? 'Việc cần làm')} (${op.params.items?.length ?? 0} mục) vào thẻ ${q(d.cardTitle)}.`;
    case 'REMOVE_MEMBER':
      return `Đã bỏ ${d.memberName ?? ''} khỏi thẻ ${q(d.cardTitle)}.`;
    case 'REMOVE_LABEL':
      return `Đã gỡ nhãn ${q(d.labelName)} khỏi thẻ ${q(d.cardTitle)}.`;
    case 'RENAME_LIST':
      return `Đã đổi tên cột ${q(op.before?.listName)} thành ${q(op.params.name)}.`;
    case 'ARCHIVE_CARD':
      return `Đã lưu trữ thẻ ${q(d.cardTitle)}. Khôi phục lại được trong mục Lưu trữ của bảng.`;
    default:
      return handlerOf(op.type)?.summary(op) ?? 'Đã xong.';
  }
}

/** Cau ket qua cua Board Patch: dem cot / the vua THEM va nhac lai rang du lieu cu khong bi dung toi. */
export function summarizePatch(boardName: string, lists: number, cards: number): string {
  const parts = [lists > 0 ? `${lists} cột` : '', cards > 0 ? `${cards} thẻ` : ''].filter((p) => p !== '');
  return parts.length === 0
    ? 'Không có gì mới để thêm.'
    : `Đã thêm ${parts.join(' và ')} vào bảng ${q(boardName)}. Dữ liệu cũ được giữ nguyên.`;
}

/** Cau tom tat ket qua ca ke hoach: mot thao tac -> cau cua thao tac do (nhu Phase 1); nhieu thao tac -> dem + danh sach ben `details`. */
export function summarizePlan(boardName: string, details: readonly { text: string; changed: boolean }[]): string {
  if (details.length === 1) return details[0].text;
  const changed = details.filter((d) => d.changed).length;
  if (changed === 0) return 'Mọi thao tác đều đã có sẵn nên chưa cần thay đổi gì.';
  const skipped = details.length - changed;
  return `Đã áp dụng ${changed} thay đổi trên bảng ${q(boardName)}.${skipped > 0 ? ` Bỏ qua ${skipped} thao tác đã có sẵn.` : ''}`;
}

const ERROR_TEXT: Partial<Record<ActionErrorCode, string>> = {
  FORBIDDEN: 'Bạn không còn quyền sửa bảng này nên chưa thay đổi gì.',
  NOT_FOUND: 'Thẻ, cột hoặc bảng này không còn tồn tại nên chưa thay đổi gì.',
  STALE: 'Dữ liệu đã thay đổi kể từ lúc xem trước nên chưa thay đổi gì. Hãy gửi lại lệnh để tạo kế hoạch mới.',
  EXPIRED: 'Kế hoạch đã hết hạn nên chưa thay đổi gì. Hãy gửi lại lệnh.',
  ALREADY_DECIDED: 'Kế hoạch này đã được xử lý.',
  SUPERSEDED: 'Đã có lệnh mới hơn nên kế hoạch này bị thay thế. Chưa thay đổi gì.',
  SCOPE_CHANGED: 'Bạn đã chuyển sang trang khác nên kế hoạch này đã bị hủy. Chưa thay đổi gì.',
  SERVICE_ERROR: 'Hệ thống chưa thực hiện được thao tác này nên đã hoàn tác toàn bộ. Chưa thay đổi gì.',
  INTERRUPTED: 'Kế hoạch bị gián đoạn giữa chừng. Hãy kiểm tra bảng và gửi lại lệnh nếu cần.',
  INVALID: 'Thao tác không hợp lệ nên chưa thay đổi gì.',
  OUT_OF_SCOPE: 'Thao tác nằm ngoài phạm vi bảng hiện tại nên chưa thay đổi gì.',
};

/** Đuôi câu khi một lý do cụ thể làm kế hoạch cũ: lý do đã nói "đã thay đổi kể từ lúc xem trước" nên không lặp lại. */
export const STALE_TAIL = 'Chưa thay đổi gì. Hãy gửi lại lệnh để tạo kế hoạch mới.';

export function errorText(code: ActionErrorCode, fallback?: string): string {
  return fallback ?? ERROR_TEXT[code] ?? 'Chưa thay đổi gì.';
}

/**
 * Nhom loi de do dac (ChatActionPlan.failureCategory): cho phep dem "bao nhieu ke hoach hong vi AI de xuat sai / vuot gioi han /
 * khong tim thay / mat quyen / du lieu doi / loi he thong" ma khong can doc noi dung.
 */
export function failureCategoryOf(code: ActionErrorCode | null | undefined): string | null {
  switch (code) {
    case undefined:
    case null:
      return null;
    case 'TOO_MANY_OPS':
    case 'TOO_MANY_CARDS':
    case 'TOO_MANY_LISTS':
    case 'TOO_MANY_REFS':
    case 'MULTI_OP':
      return 'LIMIT';
    case 'INVALID_PLAN':
      return 'GRAPH';
    case 'CONFLICT':
      return 'CONFLICT';
    case 'NOT_REQUESTED':
      return 'NOT_REQUESTED';
    case 'NOT_FOUND':
    case 'AMBIGUOUS':
    case 'NO_BOARD':
      return 'RESOLVE';
    case 'FORBIDDEN':
    case 'VIEWER_ASSIGN':
      return 'PERMISSION';
    case 'OUT_OF_SCOPE':
    case 'SCOPE_CHANGED':
      return 'SCOPE';
    case 'STALE':
      return 'STALE';
    case 'SERVICE_ERROR':
    case 'INTERRUPTED':
      return 'EXECUTION';
    case 'RATE_LIMITED':
      return 'LIMIT';
    case 'UNSUPPORTED_RULE':
      return 'UNSUPPORTED';
    case 'NO_CHANGE':
      return 'NO_CHANGE';
    case 'UNSAFE_CONTENT':
      return 'UNSAFE';
    case 'DESTRUCTIVE':
      return 'DESTRUCTIVE';
    case 'EXPIRED':
      return 'EXPIRED';
    case 'SUPERSEDED':
    case 'ALREADY_DECIDED':
      return 'CANCELLED';
    case 'ACTIONS_DISABLED':
    case 'AI_UNAVAILABLE':
      return 'DISABLED';
    case 'INVALID':
      return 'INVALID';
  }
}

export interface PlanViewInput {
  planId: string;
  checksum: string;
  status: PlanStatus;
  risk: PlanRisk;
  requiresConfirmation: boolean;
  reasons: readonly ConfirmReason[];
  expiresAt: Date;
  boardId: string;
  boardName: string;
  ops: readonly StoredOp[];
  warnings: readonly string[];
  now: Date;
  patch?: PatchView;
}

export function buildPlanView(input: PlanViewInput): PlanView {
  return {
    planId: input.planId,
    checksum: input.checksum,
    status: input.status,
    risk: input.risk,
    requiresConfirmation: input.requiresConfirmation,
    canConfirm: input.status === 'PROPOSED' && input.expiresAt.getTime() > input.now.getTime(),
    reasons: [...input.reasons],
    expiresAt: input.expiresAt.toISOString(),
    boardId: input.boardId,
    boardName: input.boardName,
    items: input.ops.map((op, i) => describeOp(op, i)),
    opCount: input.ops.length,
    warnings: [...input.warnings],
    ...(input.patch !== undefined ? { patch: input.patch } : {}),
  };
}

export interface ResultViewInput {
  planId: string;
  status: ResultStatus;
  autoExecuted: boolean;
  alreadyApplied?: boolean;
  summary: string;
  boardId: string;
  cardId?: string;
  error?: { code: ActionErrorCode; text: string };
  warnings?: readonly string[];
  opCount?: number;
  details?: readonly string[];
  cardIds?: readonly string[];
}

export function buildResultView(input: ResultViewInput): ResultView {
  return {
    planId: input.planId,
    status: input.status,
    autoExecuted: input.autoExecuted,
    ...(input.alreadyApplied ? { alreadyApplied: true } : {}),
    summary: input.summary,
    boardId: input.boardId,
    ...(input.cardId !== undefined ? { cardId: input.cardId } : {}),
    ...(input.error !== undefined ? { error: input.error } : {}),
    warnings: [...(input.warnings ?? [])],
    ...(input.opCount !== undefined ? { opCount: input.opCount } : {}),
    ...(input.details !== undefined && input.details.length > 1 ? { details: [...input.details] } : {}),
    ...(input.cardIds !== undefined && input.cardIds.length > 1 ? { cardIds: [...input.cardIds] } : {}),
  };
}
