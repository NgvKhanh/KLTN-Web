// Hop dong HANH DONG cua chatbot v2 - Phase 1 (mot thao tac) + Phase 2 (nhieu thao tac trong MOT bang).
//
// NGUYEN TAC: rang buoc bang CAU TRUC, khong bang loi dan trong prompt (cung triet ly AI_MODULE.md §3.1). LLM KHONG co o nao de
// dien id cua the / cot / nguoi / nhan: chi co 4 cach chi toi mot thuc the:
//   TEXT    = dung chu nguoi dung go
//   CONTEXT = "no" / "the vua roi"
//   SELF    = "toi"
//   PLAN    = thuc the do CHINH KE HOACH nay se tao (cot / the moi), tro bang `key` cua thao tac tao ra no
// Backend tu tim (actions.resolve) roi moi co id. Ngay han cung khong do LLM tinh: LLM chi khai DateSpec, server doi
// (actions.dates). Khoa la (cardId, boardId...) bi .strict() loai ngay o day.

import { z } from 'zod';
import { CardStatus } from '../../../../generated/prisma/enums';
import { COLOR_NAMES } from './actions.palette';

const text = (max: number) => z.string().trim().min(1).max(max);

/**
 * Gioi han o BACKEND (khong chi trong prompt). `MAX_PROPOSED_OPS` la tran cua schema de mot de xuat qua dai duoc tra loi bang cau
 * ro rang ("chia nho lenh") thay vi loi cu phap; han muc that su cua mot ke hoach la cac MAX_* ben duoi (actions.graph.checkLimits).
 */
export const MAX_PROPOSED_OPS = 30;
export const MAX_OPS_PER_PLAN = 15;
export const MAX_CREATE_CARDS = 10;
export const MAX_CREATE_LISTS = 3;
/** So doi tuong CO SAN (the / cot / nguoi / nhan khac nhau) ma mot ke hoach duoc nhac toi. */
export const MAX_REFERENCED = 20;

/** Bo gioi han cua mot ke hoach. Ke hoach thuong dung `DEFAULT_LIMITS`; Board Patch (Phase 3) co han muc rieng (actions.patch.schema). */
export interface PlanLimits {
  maxOps: number;
  maxLists: number;
  maxCards: number;
  maxRefs: number;
}
export const DEFAULT_LIMITS: PlanLimits = { maxOps: MAX_OPS_PER_PLAN, maxLists: MAX_CREATE_LISTS, maxCards: MAX_CREATE_CARDS, maxRefs: MAX_REFERENCED };

export const REF_SLOTS = ['LAST_CARD', 'LAST_LIST', 'LAST_MEMBER'] as const;
export type RefSlot = (typeof REF_SLOTS)[number];

/** Khoa cua thao tac tao thuc the moi: chu cai dau, chi chu / so / gach duoi (dung de tham chieu trong cung ke hoach). */
export const PLAN_KEY_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const planKey = z.string().trim().regex(PLAN_KEY_RE);

export const RefSchema = z.discriminatedUnion('by', [
  z.object({ by: z.literal('TEXT'), text: text(200) }).strict(),
  z.object({ by: z.literal('CONTEXT'), slot: z.enum(REF_SLOTS) }).strict(),
  z.object({ by: z.literal('SELF') }).strict(),
  z.object({ by: z.literal('PLAN'), key: planKey }).strict(),
]);
export type Ref = z.infer<typeof RefSchema>;
/**
 * Phase 6: rieng o `member` cua ASSIGN_MEMBER con co `{by:'BEST'}` = "nguoi phu hop nhat" (server tu chon bang module goi y phan cong, luon xem
 * truoc). Cac o khac (the, cot, nhan...) KHONG co BEST nen mo hinh khong the dung no de ne tranh goi ten.
 */
export const MemberRefSchema = z.discriminatedUnion('by', [...RefSchema.options, z.object({ by: z.literal('BEST') }).strict()]);
export type MemberRef = z.infer<typeof MemberRefSchema>;

/**
 * Phase 7 - LUAT TU DONG HOA bang ngon ngu tu nhien. Chi anh xa vao nhung gi engine (modules/automation) co: 2 dieu kien kich hoat va 3 hanh dong
 * (toi da 5). Luat chi nham vao thuc the CO SAN (TEXT / CONTEXT / SELF): khong PLAN (khong tao cot + luat trong cung lenh), khong BEST.
 */
export const RULE_TRIGGERS = ['CARD_CREATED', 'CARD_MOVED_TO_LIST'] as const;
export type RuleTrigger = (typeof RULE_TRIGGERS)[number];
export const MAX_RULE_ACTIONS = 5;
const RuleRefSchema = z.discriminatedUnion('by', [
  z.object({ by: z.literal('TEXT'), text: text(200) }).strict(),
  z.object({ by: z.literal('CONTEXT'), slot: z.enum(REF_SLOTS) }).strict(),
  z.object({ by: z.literal('SELF') }).strict(),
]);
export const RuleActionSchema = z.discriminatedUnion('type', [
  // done = true (mac dinh): danh dau hoan thanh; done = false: mo lai (bo danh dau hoan thanh)
  z.object({ type: z.literal('SET_DONE'), done: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('ADD_LABEL'), label: RuleRefSchema }).strict(),
  z.object({ type: z.literal('ASSIGN_MEMBER'), member: RuleRefSchema }).strict(),
]);
export type RuleAction = z.infer<typeof RuleActionSchema>;

export const DateSpecSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ABSOLUTE'), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  // weekday: 1 = Thu Hai ... 7 = Chu nhat (ISO)
  z.object({ type: z.literal('WEEKDAY'), weekday: z.number().int().min(1).max(7), week: z.enum(['THIS', 'NEXT']) }).strict(),
  z.object({ type: z.literal('RELATIVE_DAYS'), days: z.number().int().min(-30).max(365) }).strict(),
  z.object({ type: z.literal('END_OF_WEEK') }).strict(),
  // bo han
  z.object({ type: z.literal('NONE') }).strict(),
]);
export type DateSpec = z.infer<typeof DateSpecSchema>;

/** 7 thao tac cua Phase 1 + CREATE_LIST (can cho ke hoach nhieu buoc: tao cot roi tao the trong cot do). */
export const ACTION_TYPES = [
  'CREATE_LIST',
  'CREATE_CARD',
  'RENAME_CARD',
  'SET_CARD_DUE',
  'MOVE_CARD',
  'SET_CARD_STATUS',
  'ASSIGN_MEMBER',
  'ADD_LABEL',
  'ASSIGN_UNASSIGNED',
  'CREATE_AUTOMATION_RULE',
  // Buoc D: sua noi dung va don dep the (khong xoa han)
  'SET_CARD_DESCRIPTION',
  'SET_CARD_START',
  'ADD_COMMENT',
  'ADD_CHECKLIST',
  'REMOVE_MEMBER',
  'REMOVE_LABEL',
  'RENAME_LIST',
  'ARCHIVE_CARD',
  // Buoc E: don dep the va cot (xoa / khoi phuc / sao chep / di chuyen / sap xep) - xoa luon xem truoc
  'DELETE_CARD',
  'RESTORE_CARD',
  'COPY_CARD',
  'SET_CARD_COVER',
  'ARCHIVE_LIST',
  'DELETE_LIST',
  'RESTORE_LIST',
  'COPY_LIST',
  'MOVE_LIST',
  'SORT_LIST',
  'MOVE_ALL_CARDS',
  'DELETE_ALL_CARDS',
  'SET_LIST_STATUS',
  // Buoc F: binh luan va checklist
  'EDIT_COMMENT',
  'DELETE_COMMENT',
  'REPLY_COMMENT',
  'SET_CHECKLIST_ITEM_DONE',
  'ADD_CHECKLIST_ITEM',
  'EDIT_CHECKLIST_ITEM',
  'DELETE_CHECKLIST_ITEM',
  'RENAME_CHECKLIST',
  'DELETE_CHECKLIST',
  'ASSIGN_CHECKLIST_ITEM',
  'SET_CHECKLIST_ITEM_DUE',
  'CONVERT_ITEM_TO_CARD',
  // Buoc G: tep dinh kem
  'ADD_ATTACHMENT',
  'DELETE_ATTACHMENT',
  // Buoc H: truong tuy chinh, nhac han, theo doi, the mau
  'SET_FIELD_VALUE',
  'ADD_REMINDER',
  'REMOVE_REMINDER',
  'SET_WATCH',
  'CREATE_CARD_FROM_TEMPLATE',
  'SAVE_CARD_AS_TEMPLATE',
  // Buoc I: quan tri bang (luon xem truoc tru STAR_BOARD)
  'RENAME_BOARD',
  'SET_BOARD_VISIBILITY',
  'STAR_BOARD',
  'ARCHIVE_BOARD',
  'DELETE_BOARD',
  'SET_INVITE_LINK',
  'CREATE_LABEL',
  'UPDATE_LABEL',
  'DELETE_LABEL',
  'TOGGLE_AUTOMATION_RULE',
  'DELETE_AUTOMATION_RULE',
  'ADD_BOARD_MEMBER',
  'REMOVE_BOARD_MEMBER',
  'CHANGE_MEMBER_ROLE',
  'CREATE_CUSTOM_FIELD',
  'RENAME_CUSTOM_FIELD',
  'DELETE_CUSTOM_FIELD',
  'ADD_FIELD_OPTION',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** Thao tac viet NOI DUNG van ban moi (mo ta, binh luan, checklist): nguoi khac se doc nen luon xem truoc, khong bao gio tu chay. */
export const CONTENT_TYPES: readonly ActionType[] = ['SET_CARD_DESCRIPTION', 'ADD_COMMENT', 'ADD_CHECKLIST', 'EDIT_COMMENT', 'REPLY_COMMENT', 'ADD_CHECKLIST_ITEM', 'EDIT_CHECKLIST_ITEM', 'RENAME_CHECKLIST'];
/** Thao tac doi CAU TRUC bang (cot): luon xem truoc. */
export const STRUCTURE_TYPES: readonly ActionType[] = ['CREATE_LIST', 'RENAME_LIST'];
/** Thao tac XOA (khong khoi phuc duoc o giao dien): luon xem truoc, rui ro CAO, hien canh bao. */
export const DESTRUCTIVE_TYPES: readonly ActionType[] = ['DELETE_CARD', 'DELETE_LIST', 'DELETE_ALL_CARDS', 'DELETE_COMMENT', 'DELETE_CHECKLIST_ITEM', 'DELETE_CHECKLIST', 'CONVERT_ITEM_TO_CARD', 'DELETE_ATTACHMENT', 'DELETE_BOARD', 'DELETE_LABEL', 'DELETE_AUTOMATION_RULE', 'DELETE_CUSTOM_FIELD', 'REMOVE_BOARD_MEMBER'];
/** Quan tri bang (thanh vien, quyen, hien thi, link moi, xoa / luu tru bang): chi tron voi thao tac quan tri khac, khong bao gio tu chay. */
export const BOARD_ADMIN_TYPES: readonly ActionType[] = ['SET_BOARD_VISIBILITY', 'ARCHIVE_BOARD', 'DELETE_BOARD', 'SET_INVITE_LINK', 'ADD_BOARD_MEMBER', 'REMOVE_BOARD_MEMBER', 'CHANGE_MEMBER_ROLE'];
/** Lam CA BANG bien mat khoi nguoi dung: phai la thao tac DUY NHAT cua ke hoach. */
export const BOARD_REMOVING_TYPES: readonly ActionType[] = ['ARCHIVE_BOARD', 'DELETE_BOARD'];
/** `ids.member` cua cac thao tac nay la thanh vien BANG (co the chi-xem hoac chua la thanh vien), khong phai nguoi duoc giao the. */
export const BOARD_MEMBER_TYPES: readonly ActionType[] = ['ADD_BOARD_MEMBER', 'REMOVE_BOARD_MEMBER', 'CHANGE_MEMBER_ROLE'];
export const VISIBILITIES = ['PRIVATE', 'WORKSPACE', 'PUBLIC'] as const;
export const MEMBER_ROLES = ['ADMIN', 'MEMBER', 'VIEWER'] as const;
export const FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'CHECKBOX', 'DROPDOWN'] as const;
/** Cung tran voi customField.schema (ten truong / lua chon 60 ky tu, toi da 20 lua chon luc tao) va nhan (50 ky tu). */
export const MAX_FIELD_NAME = 60;
export const MAX_FIELD_OPTIONS = 20;
export const MAX_LABEL_NAME = 50;
/** Vi tri moi cua cot (MOVE_LIST) va cach sap xep the trong cot (SORT_LIST). */
export const PLACEMENTS = ['FIRST', 'LAST', 'BEFORE', 'AFTER'] as const;
export const SORT_KEYS = ['CREATED_DESC', 'CREATED_ASC', 'TITLE_ASC', 'DONE_LAST'] as const;
export const COVER_COLORS = [...COLOR_NAMES, 'NONE'] as const;
/** Muc nhac han giao dien cho phep (phut truoc han): card.schema.REMINDER_OFFSETS. */
export const REMINDER_MINUTES = [10, 60, 1440] as const;
export const WATCH_TARGETS = ['CARD', 'LIST', 'BOARD'] as const;
/** Gioi han noi dung van ban (cung tran 500 ky tu cua cau lenh nen thuc te nho hon). */
export const MAX_TEXT_CHARS = 1000;
export const MAX_CHECKLIST_ITEMS = 20;

/**
 * Thao tac duoc phep TU CHAY khi dung 1 thao tac (Phase 1). CREATE_LIST khong nam trong day: no doi CAU TRUC bang (va ten cot co the
 * keo theo trang thai, vd "Hoan thanh" -> DONE) nen luon cho xem truoc.
 */
export const AUTO_RUN_TYPES: readonly ActionType[] = [
  'CREATE_CARD',
  'RENAME_CARD',
  'SET_CARD_DUE',
  'MOVE_CARD',
  'SET_CARD_STATUS',
  'ASSIGN_MEMBER',
  'ADD_LABEL',
  'SET_CARD_START',
  'REMOVE_MEMBER',
  'REMOVE_LABEL',
  // Buoc E: viec chinh xac, hoan tac duoc
  'RESTORE_CARD',
  'COPY_CARD',
  'SET_CARD_COVER',
  // Buoc F: viec chinh xac, hoan tac duoc bang chinh thao tac nay
  'SET_CHECKLIST_ITEM_DONE',
  'ASSIGN_CHECKLIST_ITEM',
  'SET_CHECKLIST_ITEM_DUE',
  // Buoc H: viec ca nhan / chinh xac
  'SET_FIELD_VALUE',
  'ADD_REMINDER',
  'REMOVE_REMINDER',
  'SET_WATCH',
  'CREATE_CARD_FROM_TEMPLATE',
  // Buoc I: dau sao la cua rieng nguoi dung
  'STAR_BOARD',
];

export const ActionOpSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('CREATE_LIST'), key: planKey.optional(), name: text(100) }).strict(),
  z.object({ type: z.literal('CREATE_CARD'), key: planKey.optional(), list: RefSchema.optional(), title: text(500) }).strict(),
  z.object({ type: z.literal('RENAME_CARD'), card: RefSchema, title: text(500) }).strict(),
  z.object({ type: z.literal('SET_CARD_DUE'), card: RefSchema, due: DateSpecSchema }).strict(),
  z.object({ type: z.literal('MOVE_CARD'), card: RefSchema, toList: RefSchema }).strict(),
  z.object({ type: z.literal('SET_CARD_STATUS'), card: RefSchema, status: z.enum(CardStatus) }).strict(),
  z.object({ type: z.literal('ASSIGN_MEMBER'), card: RefSchema, member: MemberRefSchema }).strict(),
  // Phase 6: chia cac the CHUA co nguoi nhan cua mot cot cho nhom (server goi planForList va khai trien thanh nhieu ASSIGN_MEMBER)
  z.object({ type: z.literal('ASSIGN_UNASSIGNED'), list: RefSchema }).strict(),
  z.object({ type: z.literal('ADD_LABEL'), card: RefSchema, label: RefSchema }).strict(),
  // Phase 7: luat tu dong hoa (luon xem truoc, rui ro CAO, phai la thao tac DUY NHAT cua ke hoach)
  z.object({ type: z.literal('CREATE_AUTOMATION_RULE'), trigger: z.enum(RULE_TRIGGERS), list: RuleRefSchema.optional(), actions: z.array(RuleActionSchema).min(1).max(MAX_RULE_ACTIONS) }).strict(),
  // Buoc D
  z.object({ type: z.literal('SET_CARD_DESCRIPTION'), card: RefSchema, description: text(MAX_TEXT_CHARS) }).strict(),
  z.object({ type: z.literal('SET_CARD_START'), card: RefSchema, start: DateSpecSchema }).strict(),
  z.object({ type: z.literal('ADD_COMMENT'), card: RefSchema, text: text(MAX_TEXT_CHARS) }).strict(),
  z.object({ type: z.literal('ADD_CHECKLIST'), card: RefSchema, title: text(200).optional(), items: z.array(text(500)).min(1).max(MAX_CHECKLIST_ITEMS) }).strict(),
  z.object({ type: z.literal('REMOVE_MEMBER'), card: RefSchema, member: RefSchema }).strict(),
  z.object({ type: z.literal('REMOVE_LABEL'), card: RefSchema, label: RefSchema }).strict(),
  z.object({ type: z.literal('RENAME_LIST'), list: RefSchema, name: text(100) }).strict(),
  z.object({ type: z.literal('ARCHIVE_CARD'), card: RefSchema }).strict(),
  // Buoc E
  z.object({ type: z.literal('DELETE_CARD'), card: RefSchema }).strict(),
  z.object({ type: z.literal('RESTORE_CARD'), card: RefSchema }).strict(),
  z.object({ type: z.literal('COPY_CARD'), card: RefSchema, toList: RefSchema.optional(), title: text(500).optional() }).strict(),
  z.object({ type: z.literal('SET_CARD_COVER'), card: RefSchema, color: z.enum(COVER_COLORS) }).strict(),
  z.object({ type: z.literal('ARCHIVE_LIST'), list: RefSchema }).strict(),
  z.object({ type: z.literal('DELETE_LIST'), list: RefSchema }).strict(),
  z.object({ type: z.literal('RESTORE_LIST'), list: RefSchema }).strict(),
  z.object({ type: z.literal('COPY_LIST'), list: RefSchema }).strict(),
  z.object({ type: z.literal('MOVE_LIST'), list: RefSchema, placement: z.enum(PLACEMENTS), anchor: RefSchema.optional() }).strict(),
  z.object({ type: z.literal('SORT_LIST'), list: RefSchema, sortBy: z.enum(SORT_KEYS) }).strict(),
  z.object({ type: z.literal('MOVE_ALL_CARDS'), list: RefSchema, toList: RefSchema }).strict(),
  z.object({ type: z.literal('DELETE_ALL_CARDS'), list: RefSchema }).strict(),
  z.object({ type: z.literal('SET_LIST_STATUS'), list: RefSchema, status: z.union([z.enum(CardStatus), z.literal('NONE')]) }).strict(),
  // Buoc F: `match` = chu nguoi dung go de chi ra binh luan / muc (khong dien id); bo trong = the chi co mot cai thi lay cai do, nhieu thi hoi lai
  z.object({ type: z.literal('EDIT_COMMENT'), card: RefSchema, match: text(300).optional(), text: text(MAX_TEXT_CHARS) }).strict(),
  z.object({ type: z.literal('DELETE_COMMENT'), card: RefSchema, match: text(300).optional() }).strict(),
  z.object({ type: z.literal('REPLY_COMMENT'), card: RefSchema, match: text(300).optional(), text: text(MAX_TEXT_CHARS) }).strict(),
  z.object({ type: z.literal('SET_CHECKLIST_ITEM_DONE'), card: RefSchema, match: text(300), checklist: text(200).optional(), done: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('ADD_CHECKLIST_ITEM'), card: RefSchema, checklist: text(200).optional(), items: z.array(text(500)).min(1).max(MAX_CHECKLIST_ITEMS) }).strict(),
  z.object({ type: z.literal('EDIT_CHECKLIST_ITEM'), card: RefSchema, match: text(300), checklist: text(200).optional(), text: text(500) }).strict(),
  z.object({ type: z.literal('DELETE_CHECKLIST_ITEM'), card: RefSchema, match: text(300), checklist: text(200).optional() }).strict(),
  z.object({ type: z.literal('RENAME_CHECKLIST'), card: RefSchema, checklist: text(200).optional(), title: text(200) }).strict(),
  z.object({ type: z.literal('DELETE_CHECKLIST'), card: RefSchema, checklist: text(200).optional() }).strict(),
  z.object({ type: z.literal('ASSIGN_CHECKLIST_ITEM'), card: RefSchema, match: text(300), checklist: text(200).optional(), member: RefSchema.optional() }).strict(),
  z.object({ type: z.literal('SET_CHECKLIST_ITEM_DUE'), card: RefSchema, match: text(300), checklist: text(200).optional(), due: DateSpecSchema }).strict(),
  z.object({ type: z.literal('CONVERT_ITEM_TO_CARD'), card: RefSchema, match: text(300), checklist: text(200).optional() }).strict(),
  // Buoc G: `file` = ten tep nguoi dung noi (bo trong = moi tep ho vua dinh kem o khung chat); KHONG co o nao de dien duong dan / id tep
  z.object({ type: z.literal('ADD_ATTACHMENT'), card: RefSchema, file: text(200).optional() }).strict(),
  z.object({ type: z.literal('DELETE_ATTACHMENT'), card: RefSchema, match: text(300).optional() }).strict(),
  // Buoc H: `field` = ten truong; `value` luon la chuoi (server doc theo kieu truong: so, ngay, hop kiem, lua chon); clear = xoa gia tri
  z.object({ type: z.literal('SET_FIELD_VALUE'), card: RefSchema, field: text(200), value: text(500).optional(), clear: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('ADD_REMINDER'), card: RefSchema, minutes: z.union([z.literal(10), z.literal(60), z.literal(1440)]) }).strict(),
  z.object({ type: z.literal('REMOVE_REMINDER'), card: RefSchema, minutes: z.union([z.literal(10), z.literal(60), z.literal(1440)]).optional() }).strict(),
  z.object({ type: z.literal('SET_WATCH'), target: z.enum(WATCH_TARGETS), card: RefSchema.optional(), list: RefSchema.optional(), watch: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('CREATE_CARD_FROM_TEMPLATE'), template: text(200), list: RefSchema.optional(), title: text(500).optional() }).strict(),
  z.object({ type: z.literal('SAVE_CARD_AS_TEMPLATE'), card: RefSchema, name: text(100).optional() }).strict(),
  // Buoc I: quan tri bang. `confirmName` = dung TEN BANG nguoi dung go (luu tru / xoa bang); `match` = vai tu trong ten luat; `email` phai do chinh nguoi dung go
  z.object({ type: z.literal('RENAME_BOARD'), name: text(100) }).strict(),
  z.object({ type: z.literal('SET_BOARD_VISIBILITY'), visibility: z.enum(VISIBILITIES) }).strict(),
  z.object({ type: z.literal('STAR_BOARD'), starred: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('ARCHIVE_BOARD'), confirmName: text(100) }).strict(),
  z.object({ type: z.literal('DELETE_BOARD'), confirmName: text(100) }).strict(),
  z.object({ type: z.literal('SET_INVITE_LINK'), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('CREATE_LABEL'), name: text(MAX_LABEL_NAME), color: z.enum(COLOR_NAMES) }).strict(),
  z.object({ type: z.literal('UPDATE_LABEL'), label: RefSchema, name: text(MAX_LABEL_NAME).optional(), color: z.enum(COLOR_NAMES).optional() }).strict(),
  z.object({ type: z.literal('DELETE_LABEL'), label: RefSchema }).strict(),
  z.object({ type: z.literal('TOGGLE_AUTOMATION_RULE'), match: text(300).optional(), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('DELETE_AUTOMATION_RULE'), match: text(300).optional() }).strict(),
  z.object({ type: z.literal('ADD_BOARD_MEMBER'), email: z.string().trim().toLowerCase().email().max(254), role: z.enum(MEMBER_ROLES).optional() }).strict(),
  z.object({ type: z.literal('REMOVE_BOARD_MEMBER'), member: RefSchema }).strict(),
  z.object({ type: z.literal('CHANGE_MEMBER_ROLE'), member: RefSchema, role: z.enum(MEMBER_ROLES) }).strict(),
  z.object({ type: z.literal('CREATE_CUSTOM_FIELD'), name: text(MAX_FIELD_NAME), fieldType: z.enum(FIELD_TYPES), options: z.array(text(MAX_FIELD_NAME)).min(1).max(MAX_FIELD_OPTIONS).optional() }).strict(),
  z.object({ type: z.literal('RENAME_CUSTOM_FIELD'), field: text(200), name: text(MAX_FIELD_NAME) }).strict(),
  z.object({ type: z.literal('DELETE_CUSTOM_FIELD'), field: text(200) }).strict(),
  z.object({ type: z.literal('ADD_FIELD_OPTION'), field: text(200), value: text(MAX_FIELD_NAME) }).strict(),
]);
export type ActionOp = z.infer<typeof ActionOpSchema>;

/**
 * Bo cac khoa null / chuoi rong truoc khi kiem tra: Gemini hay dien khoa thua ("list": null) khi luoc do phang. Chi bo gia tri
 * RONG - mot khoa la co gia tri that (vd "cardId": "abc") van bi .strict() tu choi.
 */
export function dropEmpty(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropEmpty);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === null || v === undefined || v === '') continue;
    out[key] = dropEmpty(v);
  }
  return out;
}

export const ProposeActionsInput = z.object({ operations: z.array(ActionOpSchema).min(1).max(MAX_PROPOSED_OPS) }).strict();
export type ProposeActions = z.infer<typeof ProposeActionsInput>;

/** Schema dua vao registry: bo khoa rong roi moi kiem tra. */
export const proposeActionsSchema = z.preprocess(dropEmpty, ProposeActionsInput);

const refHint = {
  type: 'object',
  description:
    'Tham chieu: {by:"TEXT",text:<dung chu nguoi dung go, bo tu chung nhu task/the/cot/nhan>} | {by:"CONTEXT",slot:"LAST_CARD"|"LAST_LIST"|"LAST_MEMBER"} cho "no / the vua roi" | {by:"SELF"} cho "toi" | {by:"PLAN",key:<key cua thao tac CREATE_LIST / CREATE_CARD trong CUNG danh sach>} cho cot / the ma chinh lenh nay tao ra | CHI o member cua ASSIGN_MEMBER: {by:"BEST"} khi nguoi dung nho chon "nguoi phu hop nhat" (khong goi ten). KHONG dien id.',
  properties: {
    by: { type: 'string', enum: ['TEXT', 'CONTEXT', 'SELF', 'PLAN', 'BEST'] },
    text: { type: 'string' },
    slot: { type: 'string', enum: [...REF_SLOTS] },
    key: { type: 'string' },
  },
  required: ['by'],
} as const;

const dueHint = {
  type: 'object',
  description:
    'Han: ABSOLUTE(date YYYY-MM-DD, chi khi nguoi dung viet ngay cu the) | WEEKDAY(weekday 1=Thu Hai..7=Chu nhat, week THIS|NEXT) | RELATIVE_DAYS(days, 0=hom nay) | END_OF_WEEK | NONE(bo han). Khong tu tinh ngay.',
  properties: {
    type: { type: 'string', enum: ['ABSOLUTE', 'WEEKDAY', 'RELATIVE_DAYS', 'END_OF_WEEK', 'NONE'] },
    date: { type: 'string' },
    weekday: { type: 'number' },
    week: { type: 'string', enum: ['THIS', 'NEXT'] },
    days: { type: 'number' },
  },
  required: ['type'],
} as const;

/**
 * Luoc do GUI Gemini (phang, viet tay). Khong sinh tu Zod vi `providerSchema` (chat.v2.registry) thay moi `anyOf` toan object
 * bang goi y pham vi; Zod o server van la nguon su that (.strict()).
 */
export const PROPOSE_ACTIONS_PROVIDER_SCHEMA = {
  type: 'object',
  properties: {
    operations: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_PROPOSED_OPS,
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...ACTION_TYPES] },
          key: { type: 'string', description: 'CREATE_LIST / CREATE_CARD: khoa ngan (chu, so, gach duoi) de thao tac khac tro toi cot / the vua tao.' },
          name: { type: 'string', description: 'CREATE_LIST: ten cot moi; RENAME_LIST: ten moi cua cot (list = cot can doi ten); SAVE_CARD_AS_TEMPLATE: ten the mau; RENAME_BOARD: ten moi cua bang; CREATE_LABEL / UPDATE_LABEL: ten nhan; CREATE_CUSTOM_FIELD / RENAME_CUSTOM_FIELD: ten truong. Dung chu nguoi dung go.' },
          card: refHint,
          list: refHint,
          toList: refHint,
          anchor: refHint,
          member: refHint,
          label: refHint,
          title: { type: 'string', description: 'Tieu de moi (CREATE_CARD, RENAME_CARD), ten ban sao (COPY_CARD, tuy chon) hoac ten danh sach checklist (ADD_CHECKLIST, tuy chon): dung chu nguoi dung go.' },
          description: { type: 'string', description: 'SET_CARD_DESCRIPTION: noi dung mo ta moi cua the, dung chu nguoi dung go (se THAY mo ta cu).' },
          text: { type: 'string', description: 'ADD_COMMENT / EDIT_COMMENT / REPLY_COMMENT: noi dung binh luan, dung chu nguoi dung go; khong dung @ de nhac ten. EDIT_CHECKLIST_ITEM: noi dung moi cua muc.' },
          items: { type: 'array', minItems: 1, maxItems: MAX_CHECKLIST_ITEMS, items: { type: 'string' }, description: 'ADD_CHECKLIST / ADD_CHECKLIST_ITEM: cac muc, dung chu nguoi dung go.' },
          due: dueHint,
          start: dueHint,
          status: { type: 'string', enum: [...Object.values(CardStatus), 'NONE'], description: 'SET_CARD_STATUS: trang thai the; SET_LIST_STATUS: trang thai cua COT (NONE = cot tu do, khong gan trang thai).' },
          match: { type: 'string', description: 'Chi ra MOT luat (TOGGLE_AUTOMATION_RULE / DELETE_AUTOMATION_RULE: vai tu trong ten luat), MOT binh luan (EDIT_COMMENT / DELETE_COMMENT / REPLY_COMMENT), MOT tep (DELETE_ATTACHMENT) hoac MOT muc checklist (SET_CHECKLIST_ITEM_DONE, EDIT_/DELETE_/ASSIGN_/SET_..._DUE, CONVERT_ITEM_TO_CARD): vai tu dung trong noi dung do, chep dung chu nguoi dung go. Bo trong khi the chi co mot cai.' },
          field: { type: 'string', description: 'SET_FIELD_VALUE / RENAME_CUSTOM_FIELD / DELETE_CUSTOM_FIELD / ADD_FIELD_OPTION: ten truong tuy chinh cua bang (chep dung chu nguoi dung go).' },
          value: { type: 'string', description: 'SET_FIELD_VALUE: gia tri nguoi dung noi (chuoi: so, ngay dd/mm, co / khong, hay ten lua chon); bo trong khi clear. ADD_FIELD_OPTION: lua chon moi cua truong danh sach chon.' },
          visibility: { type: 'string', enum: [...VISIBILITIES], description: 'SET_BOARD_VISIBILITY: PRIVATE = rieng tu (chi thanh vien bang), WORKSPACE = ca khong gian lam viec, PUBLIC = cong khai (ai co link cung xem duoc).' },
          confirmName: { type: 'string', description: 'ARCHIVE_BOARD / DELETE_BOARD: DUNG ten bang ma nguoi dung go.' },
          email: { type: 'string', description: 'ADD_BOARD_MEMBER: email cua nguoi can them, chep dung chu nguoi dung go.' },
          role: { type: 'string', enum: [...MEMBER_ROLES], description: 'ADD_BOARD_MEMBER (mac dinh MEMBER) / CHANGE_MEMBER_ROLE: ADMIN quan tri vien, MEMBER thanh vien, VIEWER chi xem.' },
          enabled: { type: 'boolean', description: 'SET_INVITE_LINK: true = bat link moi, false = tat; TOGGLE_AUTOMATION_RULE: true = bat luat, false = tat.' },
          starred: { type: 'boolean', description: 'STAR_BOARD: true (mac dinh) = gan sao bang, false = bo sao.' },
          fieldType: { type: 'string', enum: [...FIELD_TYPES], description: 'CREATE_CUSTOM_FIELD: kieu truong (TEXT van ban, NUMBER so, DATE ngay, CHECKBOX hop kiem, DROPDOWN danh sach chon).' },
          options: { type: 'array', minItems: 1, maxItems: MAX_FIELD_OPTIONS, items: { type: 'string' }, description: 'CREATE_CUSTOM_FIELD kieu DROPDOWN: cac lua chon, dung chu nguoi dung go.' },
          clear: { type: 'boolean', description: 'SET_FIELD_VALUE: true = xoa gia tri cua truong.' },
          minutes: { type: 'number', enum: [10, 60, 1440], description: 'ADD_REMINDER / REMOVE_REMINDER: nhac truoc han bao nhieu phut (10, 60 = 1 gio, 1440 = 1 ngay); bo trong khi REMOVE de bo moi nhac.' },
          target: { type: 'string', enum: [...WATCH_TARGETS], description: 'SET_WATCH: theo doi the (card), cot (list) hay ca bang (BOARD).' },
          watch: { type: 'boolean', description: 'SET_WATCH: true (mac dinh) = bat theo doi, false = bo theo doi.' },
          template: { type: 'string', description: 'CREATE_CARD_FROM_TEMPLATE: ten the mau cua bang (chep dung chu nguoi dung go).' },
          file: { type: 'string', description: 'ADD_ATTACHMENT: ten tep (hoac vai tu trong ten) khi nguoi dung chi gan MOT trong cac tep da dinh kem; bo trong = gan tat ca tep vua dinh kem.' },
          checklist: { type: 'string', description: 'Ten checklist cua the (khi the co nhieu checklist): chep dung chu nguoi dung go.' },
          done: { type: 'boolean', description: 'SET_CHECKLIST_ITEM_DONE: true = danh dau xong (mac dinh), false = bo danh dau.' },
          color: { type: 'string', enum: [...COVER_COLORS], description: 'SET_CARD_COVER: mau anh bia (NONE = bo anh bia); CREATE_LABEL / UPDATE_LABEL: mau nhan (khong dung NONE). Chi chon mau nguoi dung noi.' },
          placement: { type: 'string', enum: [...PLACEMENTS], description: 'MOVE_LIST: FIRST = len dau bang, LAST = xuong cuoi, BEFORE / AFTER = truoc / sau cot `anchor`.' },
          sortBy: { type: 'string', enum: [...SORT_KEYS], description: 'SORT_LIST: CREATED_DESC moi nhat len tren, CREATED_ASC cu nhat len tren, TITLE_ASC theo ten A-Z, DONE_LAST the xong xuong duoi.' },
          trigger: { type: 'string', enum: [...RULE_TRIGGERS], description: 'CREATE_AUTOMATION_RULE: CARD_CREATED = khi co the MOI duoc tao (list = cot, bo trong = moi cot); CARD_MOVED_TO_LIST = khi the duoc chuyen VAO cot (list bat buoc).' },
          actions: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_RULE_ACTIONS,
            description: 'CREATE_AUTOMATION_RULE: cac hanh dong luat se lam (toi da 5): SET_DONE (done false = mo lai) | ADD_LABEL (label) | ASSIGN_MEMBER (member).',
            items: {
              type: 'object',
              properties: { type: { type: 'string', enum: ['SET_DONE', 'ADD_LABEL', 'ASSIGN_MEMBER'] }, done: { type: 'boolean' }, label: refHint, member: refHint },
              required: ['type'],
            },
          },
        },
        required: ['type'],
      },
    },
  },
  required: ['operations'],
} as const;
