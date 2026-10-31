// HOP DONG BOARD PATCH (Phase 3): mo rong bang dang co bang cot / the MOI do AI de xuat. HAM THUAN: khong CSDL, khong mang, khong dong ho.
//
// Nguyen tac (cung triet ly AI_MODULE.md §3.1 - "LLM khong co o nao de gay hai"):
//  - Board Patch CHI co hai loai thao tac: CREATE_LIST va CREATE_CARD. Khong co o nao de xoa / doi ten / chuyen / sua / ghi de du lieu cu,
//    nen mot de xuat (ke ca bi tiem chi dan tu noi dung the) khong the lam mat du lieu cu.
//  - AI khong dien id. No chi thay ban chup rut gon voi khoa tam (L1, L2...) cua cac cot co san; cot moi tu dat khoa; server tu ghep id.
//  - Noi dung duoc phep do AI nghi ra (khac propose_actions), nen nguon cua hanh dong chi con la CAU cua nguoi dung (assessPatchRequest).
//  - Gioi han so luong nam o BACKEND; moi cot / the sinh ra deu qua sang loc an toan (screenGenerated) va loc trung (actions.patch.build).

import { z } from 'zod';
import type { PlanProvenance, ProvenanceReport } from './actions.provenance';
import type { PlanLimits } from './actions.schema';
import { dropEmpty, PLAN_KEY_RE } from './actions.schema';
import { asksDestructive, asksNewBoard, delegatesToData, foldWords, hasPhrase, isQuestionForm, licenceForPatch, type Phrase } from './actions.text';
import type { ActionErrorCode } from './actions.types';

/** Han muc cua MOT Board Patch (rong hon ke hoach thuong vi noi dung do AI sinh ra, nhung van co tran cung o backend). */
export const PATCH_LIMITS: PlanLimits = { maxOps: 30, maxLists: 5, maxCards: 25, maxRefs: 30 };
export const PATCH_SPLIT_HINT = 'Hãy nêu phạm vi hẹp hơn (một giai đoạn hoặc một nhóm việc) rồi gửi lại. Chưa thay đổi gì.';

/** Phan cua bang duoc gui cho AI lap ke hoach (con lai chi dung de kiem tra trung o server). */
export const PATCH_CONTEXT = { maxLists: 30, maxCards: 150, perList: 12, titleChars: 100, nameChars: 60, dedupeCards: 5000 } as const;

/** Tran cung khi doc de xuat cua AI (an toan bo nho). Vuot han muc that (PATCH_LIMITS) van duoc tu choi bang cau tieng Viet o buoc sau. */
const DRAFT_MAX_LISTS = 40;
const DRAFT_MAX_CARDS = 120;

const draftText = (max: number) => z.string().trim().min(1).max(max);

export const PatchDraftSchema = z
  .object({
    /** Cot MOI. `key` do AI dat de the cua de xuat tro toi; khong duoc trung khoa tam cua cot co san (L1, L2...). */
    lists: z.array(z.object({ key: z.string().trim().regex(PLAN_KEY_RE), name: draftText(100) }).strict()).max(DRAFT_MAX_LISTS),
    /** The MOI. `list` = khoa tam cua cot co san (L1...) HOAC khoa cua cot moi khai o `lists`. */
    cards: z.array(z.object({ list: draftText(120), title: draftText(500) }).strict()).max(DRAFT_MAX_CARDS),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();
export type PatchDraft = z.infer<typeof PatchDraftSchema>;

/** Doc de xuat tho cua AI: bo khoa null / rong roi kiem tra voi luoc do dong. */
export const parsePatchDraft = (raw: unknown) => PatchDraftSchema.safeParse(dropEmpty(raw));

/** Tham so cong cu `propose_board_patch`: chi la muc tieu ngan (de do dac). Noi dung mo rong KHONG di qua day: server tu goi bo lap ke hoach. */
export const ProposeBoardPatchInput = z.object({ goal: z.string().trim().min(1).max(300) }).strict();
export const proposeBoardPatchSchema = z.preprocess(dropEmpty, ProposeBoardPatchInput);
export type ProposeBoardPatch = z.infer<typeof ProposeBoardPatchInput>;

export const PROPOSE_BOARD_PATCH_PROVIDER_SCHEMA = {
  type: 'object',
  properties: { goal: { type: 'string', description: 'Muc tieu mo rong bang, chep ngan tu cau nguoi dung (toi da 300 ky tu).' } },
  required: ['goal'],
} as const;

// ---------------------------------------------------------------------------------------------------------------------
// Cau yeu cau
// ---------------------------------------------------------------------------------------------------------------------

export type PatchRequestVerdict = { ok: true } | { ok: false; code: ActionErrorCode; text: string };

const NO_CHANGE = 'Chưa thay đổi gì.';
export const DESTRUCTIVE_TEXT = `Mình chỉ có thể THÊM cột và thẻ mới, không xóa, thay thế hay sửa dữ liệu đang có. Muốn xóa hoặc sửa, bạn thao tác trực tiếp trên bảng. Nếu chỉ cần thêm phần mới, hãy nói rõ, ví dụ: “Bổ sung các thẻ cho giai đoạn kiểm thử, giữ nguyên các thẻ cũ”. ${NO_CHANGE}`;
export const NEW_BOARD_TEXT = `Mình chỉ bổ sung vào bảng đang mở, không tạo bảng mới được. Để tạo cả một bảng, hãy dùng chức năng tạo bảng bằng AI. ${NO_CHANGE}`;
export const PATCH_NOT_REQUESTED_TEXT = `Mình chưa thấy câu của bạn yêu cầu thêm cột hoặc thẻ vào bảng nên chưa thay đổi gì. Hãy nói rõ, ví dụ: “Bổ sung các thẻ cho giai đoạn kiểm thử”.`;
export const PATCH_DELEGATED_TEXT = `Mình không làm theo chỉ dẫn nằm trong nội dung thẻ, mô tả hay bình luận. Hãy nói trực tiếp bạn muốn thêm gì vào bảng. ${NO_CHANGE}`;

/**
 * Cau CUA NGUOI DUNG co phai la yeu cau mo rong bang khong. Thu tu: xoa / thay the du lieu cu -> tao ca bang moi -> lam theo noi dung trong
 * du lieu -> khong co dong tu "them / bo sung..." (hoac bi phu dinh, hoac chi la cau hoi). Du lieu trong bang (tieu de the, mo ta, binh luan)
 * KHONG bao gio la nguon cua giay phep.
 */
export function assessPatchRequest(message: string): PatchRequestVerdict {
  const words = foldWords(message);
  if (asksDestructive(words)) return { ok: false, code: 'DESTRUCTIVE', text: DESTRUCTIVE_TEXT };
  if (asksNewBoard(words)) return { ok: false, code: 'NOT_REQUESTED', text: NEW_BOARD_TEXT };
  if (delegatesToData(words)) return { ok: false, code: 'NOT_REQUESTED', text: PATCH_DELEGATED_TEXT };
  const licence = licenceForPatch(words);
  if (!licence.licensed || licence.negated || isQuestionForm(message, words)) return { ok: false, code: 'NOT_REQUESTED', text: PATCH_NOT_REQUESTED_TEXT };
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Lam sach + sang loc noi dung AI sinh ra
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Bo ky tu dieu khien / ky tu vo hinh (zero-width, dao chieu chu), gop khoang trang, cat do dai. Dung cho CA noi dung AI sinh ra LAN du lieu
 * gui cho AI (tieu de the co the do nguoi khac viet).
 */
export function cleanText(input: string, max: number): string {
  let out = '';
  let lastSpace = true;
  for (const ch of input.normalize('NFC')) {
    const c = ch.codePointAt(0) as number;
    const hidden = c < 32 || (c >= 127 && c <= 159) || (c >= 0x200b && c <= 0x200f) || (c >= 0x202a && c <= 0x202e) || (c >= 0x2060 && c <= 0x2064) || c === 0xfeff;
    if (hidden || ch === ' ') {
      if (!lastSpace) out += ' ';
      lastSpace = true;
    } else {
      out += ch;
      lastSpace = false;
    }
  }
  return out.trim().slice(0, max).trim();
}

const UNSAFE_PATTERNS: readonly RegExp[] = [
  /https?:\/\//i,
  /\bwww\./i,
  /[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,64}\.[a-z]{2,}/i,
  /```/,
  /<\/?[a-z][^>]{0,40}>/i,
  /\bjavascript:/i,
  /\bdata:text/i,
];
const UNSAFE_PHRASES: readonly Phrase[] = [
  ['ignore', 'previous'],
  ['ignore', 'all'],
  ['ignore', 'above'],
  ['disregard'],
  ['system', 'prompt'],
  ['developer', 'message'],
  ['jailbreak'],
  ['propose', 'actions'],
  ['propose', 'board', 'patch'],
  ['bo', 'qua', 'moi', 'huong', 'dan'],
  ['bo', 'qua', 'cac', 'huong', 'dan'],
  ['bo', 'qua', 'chi', 'dan'],
  ['bo', 'qua', 'tat', 'ca'],
  ['quen', 'het', 'huong', 'dan'],
];

/** Mot chuoi AI sinh ra co giong chi dan / lien ket / thu / ma khong. Tieu de cong viec binh thuong khong bao gio roi vao day. */
export function looksUnsafe(text: string): boolean {
  if (UNSAFE_PATTERNS.some((p) => p.test(text))) return true;
  const words = foldWords(text);
  return UNSAFE_PHRASES.some((p) => hasPhrase(words, p));
}

export const UNSAFE_CONTENT_TEXT = `Nội dung AI đề xuất có dấu hiệu là chỉ dẫn, liên kết hoặc địa chỉ thư (có thể lẫn từ dữ liệu trong bảng) nên mình không đưa vào kế hoạch. ${NO_CHANGE}`;

// ---------------------------------------------------------------------------------------------------------------------
// Nguon goc cua ke hoach Board Patch
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Nguon goc cua Board Patch = nguon goc CUA CAU (noi dung do AI nghi ra nen khong co "chu gan vao cau" de doi chieu nhu propose_actions).
 * USER_DIRECT khi cau la yeu cau mo rong ro rang; NOT_REQUESTED khi khong (khi do ca ke hoach bi tu choi truoc khi hien xem truoc).
 */
export function assessPatchProvenance(ops: readonly unknown[], message: string): PlanProvenance {
  const request = assessPatchRequest(message);
  const report: ProvenanceReport = request.ok
    ? { verdict: 'USER_DIRECT', failures: [] }
    : { verdict: 'NOT_REQUESTED', failures: [{ code: 'OP_NOT_LICENSED' }] };
  return {
    ...report,
    perOp: ops.map(() => report),
    dueFuzzy: false,
    ...(!request.ok && ops.length > 0 ? { firstNotRequested: 0 } : {}),
  };
}
