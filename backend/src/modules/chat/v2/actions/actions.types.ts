// Kieu dung chung cua lop hanh dong (CHATBOT_V2_ACTIONS_PLAN.md §9.3, §9.5). Chi la kieu: khong co ma chay.

import type { CardStatus } from '../../../../generated/prisma/enums';
import type { ActionOp, ActionType, RuleTrigger } from './actions.schema';

/** Loai thao tac cua ke hoach DA phan giai: ASSIGN_UNASSIGNED chi la de xuat tuong trung, luc phan giai no duoc khai trien thanh nhieu ASSIGN_MEMBER. */
export type StoredOpType = Exclude<ActionType, 'ASSIGN_UNASSIGNED'>;
import type { SlotKind } from './actions.refs';

export type PlanStatus =
  | 'NEEDS_CHOICE'
  | 'PROPOSED'
  | 'EXECUTING'
  | 'EXECUTED'
  | 'FAILED'
  | 'STALE'
  | 'CANCELLED'
  | 'EXPIRED';
export type PlanRisk = 'LOW' | 'MEDIUM' | 'HIGH';
export type Provenance = 'USER_DIRECT' | 'DELEGATED_TO_DATA' | 'UNGROUNDED' | 'NOT_REQUESTED';

/** Ma loi hien cho nguoi dung / ghi vao ChatActionPlan.errorCode. */
export type ActionErrorCode =
  | 'ACTIONS_DISABLED'
  | 'AI_UNAVAILABLE'
  | 'NO_BOARD'
  | 'MULTI_OP' // Phase 1: chi mot thao tac / lan. Con lai de doc duoc hang cu trong CSDL, Phase 2 khong sinh ma nay nua
  | 'TOO_MANY_OPS'
  | 'TOO_MANY_CARDS'
  | 'TOO_MANY_LISTS'
  | 'TOO_MANY_REFS'
  | 'INVALID_PLAN' // do thi phu thuoc sai: trung key / tham chieu thieu / vong / sai loai / trung ten
  | 'CONFLICT' // hai thao tac mau thuan nhau tren cung mot doi tuong, hoac trung voi du lieu co san
  | 'INTERRUPTED' // hang EXECUTING tu Phase 1 bi bo do (tien trinh chet) - Phase 2 khong sinh ra nua
  | 'RATE_LIMITED' // Phase 6: nho goi y phan cong qua nhieu lan trong it phut
  | 'UNSUPPORTED_RULE' // Phase 7: luat tu dong hoa ngoai nhung gi engine co (nhac han, gui email, hen gio, chuyen / xoa the...)
  | 'NO_CHANGE' // Phase 3 (Board Patch): bang da co du moi muc AI de xuat -> khong co gi de them
  | 'UNSAFE_CONTENT' // Phase 3: noi dung AI sinh ra giong chi dan / lien ket / thu tu dong (dau hieu bi tiem chi dan tu du lieu)
  | 'DESTRUCTIVE' // Phase 3: cau yeu cau xoa / thay the du lieu cu - Board Patch chi THEM
  | 'NOT_REQUESTED'
  | 'NOT_FOUND'
  | 'AMBIGUOUS'
  | 'FORBIDDEN'
  | 'VIEWER_ASSIGN'
  | 'OUT_OF_SCOPE'
  | 'INVALID'
  | 'STALE'
  | 'EXPIRED'
  | 'ALREADY_DECIDED'
  | 'SUPERSEDED'
  | 'SCOPE_CHANGED'
  | 'SERVICE_ERROR';

/** Vi sao mot ke hoach hop le van CHUA tu chay. */
export type ConfirmReasonCode =
  | 'AUTO_DISABLED'
  | 'DELEGATED_TO_DATA'
  | 'NOT_GROUNDED'
  | 'FUZZY_DATE'
  | 'QUESTION_FORM'
  | 'MULTI_OP' // tu hai thao tac tro len = hang loat -> khong bao gio tu chay
  | 'NEW_STRUCTURE' // tao cot: doi cau truc bang
  | 'BOARD_PATCH' // Phase 3: noi dung do AI de xuat -> luon xem truoc, khong bao gio tu chay
  | 'AI_CHOSEN_TARGET' // Phase 6: nguoi nhan do MAY chon (khong phai nguoi dung goi ten) -> luon xem truoc
  | 'STANDING_RULE' // Phase 7: luat tu dong hoa chay LAU DAI bang quyen cua nguoi tao -> luon xem truoc, rui ro CAO
  | 'TEXT_CONTENT' // Buoc D: viet mo ta / binh luan / checklist -> nguoi khac se doc, luon xem truoc
  | 'ARCHIVE' // Buoc D: luu tru the (an khoi bang, khoi phuc duoc) -> luon xem truoc
  | 'DELETE' // Buoc E: xoa the / cot / binh luan / tep... -> khong khoi phuc duoc o giao dien, luon xem truoc
  | 'BULK' // Buoc E: thao tac len CA mot cot (xoa het the, chuyen het the) -> luon xem truoc
  | 'ADMIN' // Buoc I: quan tri bang (thanh vien, quyen, hien thi, xoa bang) -> luon xem truoc, rui ro CAO
  | 'FILE'; // Buoc G: dinh kem tep do chinh nguoi dung tai len -> luon xem truoc
export interface ConfirmReason {
  code: ConfirmReasonCode;
  text: string;
}

/**
 * Nguoi nhan do MAY chon (module goi y phan cong) cho mot ASSIGN_MEMBER. `runId` (AssignRun) chi dung de ghi ket qua SAU KHI nguoi dung bam
 * Ap dung; khong bao gio dua cho mo hinh / giao dien. Khong co bang chung (the cu), ho so, CV hay thanh phan diem.
 */
export interface AssignChoice {
  /** BEST: ung vien xep dau cho mot the (suggestForCard); PLAN: mot dong cua ke hoach chia viec (planForList). */
  source: 'BEST' | 'PLAN';
  runId: string | null;
  rank: number;
  /** Diem TUONG DOI trong nhom ung vien cua the nay (0-100), null neu khong co du lieu. */
  score: number | null;
  confidenceLevel: 'THIN' | 'FAIR' | 'GOOD';
  /** NO_HISTORY | NO_SIMILAR | NO_PROFILE | OVERLOADED | PAUSED | NO_DATA */
  flags: string[];
  alternatives: { name: string; rank: number; score: number | null }[];
}
export type AssignChoiceView = Omit<AssignChoice, 'runId'>;

/** Mot hanh dong cua luat tu dong hoa DA phan giai (id THAT cua nhan / nguoi trong bang). `done` chi cho SET_DONE (mac dinh true). */
export interface StoredRuleAction {
  type: 'SET_DONE' | 'ADD_LABEL' | 'ASSIGN_MEMBER';
  done?: boolean;
  labelId?: string;
  userId?: string;
}
/** Luat tu dong hoa se tao: nam trong `params` nen checksum / stateDigest bao trum DAY DU nhung gi nguoi dung duyet. Cot kich hoat nam o `ids.list`. */
export interface StoredRule {
  trigger: RuleTrigger;
  /** Ten luat do SERVER dung tu ten cot / nhan / nguoi da phan giai (khong lay chu cua mo hinh). */
  name: string;
  actions: StoredRuleAction[];
}

/** Truong cua mot thao tac duoc phan giai: id THAT, gia tri cu (de kiem tien dieu kien), ten hien thi lay tu CSDL. */
export interface StoredOp {
  type: StoredOpType;
  /** Phase 6: chi ASSIGN_MEMBER do may chon nguoi. Khong nam trong checksum / stateDigest (khong phai ket qua nguoi dung xem de duyet chu thay doi). */
  choice?: AssignChoice;
  /** Chi thao tac TAO (CREATE_LIST / CREATE_CARD): khoa de thao tac sau tro toi thuc the vua tao. */
  key?: string;
  /**
   * id cua thuc the CO SAN. Thuc the do chinh ke hoach tao thi KHONG co id o day ma nam o `local`. Cac khoa sau `label` chi dung cho thao tac mo rong
   * (actions/ops): cot dich, cot moc, binh luan / muc / checklist / tep cua the, luat, truong...
   */
  ids: { card?: string; list?: string; member?: string; label?: string; toList?: string; anchor?: string; checklist?: string; item?: string; comment?: string; attachment?: string; rule?: string; field?: string; template?: string; archived?: string };
  /** Tham chieu noi bo: key cua thao tac tao ra the / cot ma thao tac nay dung (id chi co sau khi thao tac do chay). */
  local?: { card?: string; list?: string };
  /** `due`: thoi diem ISO (UTC) hoac null = bo han. `listStatus`: trang thai cot moi (doan theo ten, giong tao cot bang tay). */
  params: { title?: string; name?: string; due?: string | null; status?: CardStatus; listStatus?: CardStatus | null; rule?: StoredRule; description?: string; text?: string; start?: string | null; items?: string[]; [extra: string]: unknown };
  before: {
    title?: string;
    due?: string | null;
    listId?: string;
    listName?: string;
    status?: CardStatus;
    alreadyAssigned?: boolean;
    alreadyLabeled?: boolean;
    /** Buoc D: ngay bat dau cu (ISO hoac null) va dau van tay (sha256) cua mo ta cu - de phat hien STALE ma khong luu ca doan mo ta. */
    start?: string | null;
    descriptionHash?: string;
    descriptionLength?: number;
    /** Thao tac mo rong: gia tri cu tuy loai (ten, mau, so luong, tep...). */
    [extra: string]: unknown;
  } | null;
  display: { cardTitle?: string; listName?: string; toListName?: string; memberName?: string; labelName?: string; dueText?: string; ruleWhen?: string; ruleThen?: string[]; [extra: string]: unknown };
  /** Khong thay doi gi (da dung roi) -> khong goi service. */
  noop?: string;
}

/** Tham chieu nhap nhang dang cho nguoi dung chon. `sig` = dau van tay cua tham chieu (actions.refs): mot lan chon ap dung cho moi cho nhac cung chu. */
/** Loai doi tuong con cua the / bang ma nguoi dung duoc nhac chon (thao tac mo rong). */
export type ChildKind = 'comment' | 'item' | 'checklist' | 'attachment' | 'rule' | 'field' | 'template' | 'archivedCard' | 'archivedList' | 'option';

export interface PendingChoice {
  sig: string;
  kind: SlotKind | ChildKind;
  /** Chu nguoi dung go cho tham chieu nay ("" khi khong noi, vd tao the ma khong noi cot). */
  text: string;
  options: { id: string; label: string }[];
}

/** Mot muc AI de xuat nhung KHONG dua vao ke hoach (da co / trung / khong hop le) - hien o muc "Da co - bo qua". */
export interface PatchSkipped {
  kind: 'LIST' | 'CARD';
  title: string;
  /** EXISTS: trung het ten da co; SIMILAR: gan giong the da co; DUPLICATE_IN_PATCH: trung mot muc khac trong chinh de xuat; UNKNOWN_LIST: AI chon cot khong ton tai. */
  reason: 'EXISTS' | 'SIMILAR' | 'DUPLICATE_IN_PATCH' | 'UNKNOWN_LIST';
  /** Ten muc co san (hoac muc trong de xuat) ma muc nay trung. */
  existing?: string;
  /** Ten cot chua muc co san. */
  where?: string;
}

/** Thong tin rieng cua mot ke hoach Board Patch (luu trong StoredPlan, khong co cot rieng trong CSDL). */
export interface PatchInfo {
  /** Muc tieu mo hinh khai khi chon cong cu (chi de do dac, KHONG hien cho nguoi dung nhu su that). */
  goal: string;
  /** So cot / the MOI se tao. */
  newLists: number;
  newCards: number;
  /** So cot / the mo hinh de xuat truoc khi loc trung. */
  draftLists: number;
  draftCards: number;
  skipped: PatchSkipped[];
  /** So cot / the CO SAN cua bang (khong bi dung toi). */
  untouched: { lists: number; cards: number };
  /** Cac the AI duoc xem la bao nhieu tren tong so (khi bang lon, chi mot phan duoc gui cho AI; kiem trung luon chay tren TOAN BO the). */
  context: { cardsShown: number; cardsTotal: number; truncated: boolean };
  plannerMs: number | null;
}

export interface StoredPlan {
  /** Phan loai ke hoach: vang = cac thao tac thuong; PATCH = Board Patch (Phase 3, chi CREATE_LIST + CREATE_CARD do AI sinh noi dung). */
  kind?: 'PATCH';
  patch?: PatchInfo;
  /** 1 = Phase 1 (mot thao tac, presets theo ten o), 2 = Phase 2 (nhieu thao tac, presets theo dau van tay). */
  version: 1 | 2;
  boardId: string;
  boardName: string;
  /** Cau nguoi dung (de ghi vet; nguon cua giay phep dong tu; dung lai khi tiep tuc sau nut chon). */
  message: string;
  /** De xuat tuong trung cua LLM, NGUYEN VAN (de do dac / danh gia; khong dung de chay). */
  symbolic: ActionOp[];
  /** Thao tac da phan giai (rong khi con cho nguoi dung chon). */
  ops: StoredOp[];
  /**
   * id da GHIM theo dau van tay tham chieu: lua chon bang nut + cac "no / the vua roi" da hieu luc de xuat. Dung lai khi tiep tuc sau
   * lua chon va khi DUNG LAI ke hoach luc ap dung (de phat hien du lieu doi) - nen ket qua khong phu thuoc phien hoi thoai.
   */
  presets: Record<string, string>;
  pending?: PendingChoice;
  /** Dau van tay trang thai luc xem truoc (ids + tham so + gia tri cu + ten hien thi): ap dung phai dung lai ra DUNG gia tri nay. */
  stateDigest?: string;
  /** Ngay he thong da hieu (khong phai ngay LLM khai) + canh bao khi LLM khai khac. */
  warnings: string[];
  /** Buoc G: cac tep tam nguoi dung dinh kem vao tin nhan tao ke hoach (de dung lai ke hoach luc ap dung). */
  uploads?: { id: string; name: string; size: number; ext: string }[];
}

export interface PlanItemView {
  index: number;
  /** Phase 6: nguoi nhan do may chon (diem, do tin cay, co, ung vien khac). */
  choice?: AssignChoiceView;
  verb: string;
  text: string;
  detail?: string;
  cardId?: string;
  /** Phase 7: luat tu dong hoa - dieu kien, cac viec se lam va ghi chu "chay bang quyen cua ban". */
  rule?: RuleView;
  /** Thao tac xoa / khong khoi phuc duoc: giao dien to mau canh bao. */
  danger?: boolean;
}

export interface RuleView {
  when: string;
  then: string[];
  note: string;
}


export interface PlanView {
  planId: string;
  checksum: string;
  status: PlanStatus;
  risk: PlanRisk;
  requiresConfirmation: boolean;
  /** true khi nut "Ap dung" con dung duoc (PROPOSED va chua het han). */
  canConfirm: boolean;
  reasons: ConfirmReason[];
  expiresAt: string;
  boardId: string;
  boardName: string;
  items: PlanItemView[];
  /** Phase 2 (them, tuong thich nguoc): so thao tac. */
  opCount: number;
  warnings: string[];
  /** Phase 3 (them, tuong thich nguoc): co khi la Board Patch. */
  patch?: PatchView;
}

/** Phan hien thi rieng cua ban xem truoc Board Patch. */
export interface PatchView {
  newLists: number;
  newCards: number;
  skipped: PatchSkipped[];
  untouched: { lists: number; cards: number };
  context: { cardsShown: number; cardsTotal: number; truncated: boolean };
}

export type ResultStatus = 'EXECUTED' | 'FAILED' | 'STALE' | 'CANCELLED' | 'EXPIRED';
export interface ResultView {
  planId: string;
  status: ResultStatus;
  autoExecuted: boolean;
  alreadyApplied?: boolean;
  summary: string;
  boardId: string;
  cardId?: string;
  error?: { code: ActionErrorCode; text: string };
  warnings: string[];
  /** Phase 2 (them, tuong thich nguoc): so thao tac da chay va mot cau cho moi thao tac (chi khi tu hai thao tac tro len). */
  opCount?: number;
  details?: string[];
  cardIds?: string[];
}

export type ActionView = { kind: 'PLAN'; plan: PlanView } | { kind: 'RESULT'; result: ResultView };

/** Ket qua kiem tra quyen + nghiep vu (actions.guard). */
export type GuardVerdict = { ok: true } | { ok: false; code: ActionErrorCode; text: string };
