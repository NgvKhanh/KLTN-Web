// Y dinh + tham so cua chatbot (CHATBOT_MODULE.md §4, §5.2).
//
// HAM THUAN, khong DB, khong mang, khong doc dong ho. Ca bo luat (B0), lop LLM (B1)
// va bo danh gia deu dung chung cac kieu + ham o day, nen day la "hop dong" trong ma.

import { z } from 'zod';

/** Do dai toi da cua cau hoi (API chan o chat.schema; bo luat tu cat them lan nua). */
export const MAX_QUESTION_CHARS = 500;
/** Do dai toi da cua chuoi ten nguoi LLM tra ve. */
export const MAX_MEMBER_CHARS = 80;
/** Do dai toi da cua chuoi ten bang / khong gian / cot LLM tra ve (§18.2). */
export const MAX_TARGET_CHARS = 80;
/** Danh sach chinh phan trang 10 the; danh sach phu toi da 5 the (§6.3). */
export const PAGE_SIZE = 10;
export const SECTION_SIZE = 5;

/** 5 y dinh tra loi duoc. */
export const ANSWER_INTENTS = [
  'MY_TASKS',
  'MY_PRIORITIES',
  'MEMBER_TASKS',
  'TEAM_SUMMARY',
  'TEAM_WORKLOAD',
] as const;
/**
 * 4 y dinh "danh muc truy van" (§18): bang / khong gian / thanh vien / dem the. Moi y dinh la mot truy van
 * co dinh, chi doc, kiem quyen - LLM chi CHON dong nao va dien tham so, khong viet truy van.
 */
export const CATALOG_INTENTS = ['MY_BOARDS', 'MY_WORKSPACES', 'MEMBER_LIST', 'CARD_COUNTS'] as const;
/** + UNSUPPORTED (ngoai pham vi / yeu cau thao tac) va NONE (cau chi bo sung tham so). */
export const CHAT_INTENTS = [...ANSWER_INTENTS, ...CATALOG_INTENTS, 'UNSUPPORTED', 'NONE'] as const;
export const CHAT_PERIODS = [
  'TODAY',
  'TOMORROW',
  'THIS_WEEK',
  'NEXT_WEEK',
  'LAST_WEEK',
  'NEXT_7_DAYS',
] as const;
export const CHAT_FOCUSES = ['OPEN', 'OVERDUE', 'DONE', 'BLOCKED'] as const;

export type AnswerIntent = (typeof ANSWER_INTENTS)[number];
export type CatalogIntent = (typeof CATALOG_INTENTS)[number];
export type ChatIntent = (typeof CHAT_INTENTS)[number];
export type ChatPeriod = (typeof CHAT_PERIODS)[number];
export type ChatFocus = (typeof CHAT_FOCUSES)[number];
export type ChatSlot = 'period' | 'focus' | 'member';

/** Ket qua "hieu cau hoi" cua ca bo luat lan LLM (da doi NONE / "" thanh null). */
export interface ParsedQuestion {
  intent: ChatIntent;
  period: ChatPeriod | null;
  focus: ChatFocus | null;
  /** Ten nguoi NHU NGUOI DUNG GO (chua nhan dien); null = khong nhac ai. */
  member: string | null;
  /** Ten bang / khong gian NHU NGUOI DUNG GO (chi cac y dinh danh muc, §18.2); vang mat = khong nhac. */
  target?: string | null;
  /** Ten cot / danh sach NHU NGUOI DUNG GO (chi CARD_COUNTS); vang mat = khong nhac. */
  column?: string | null;
}

export function isAnswerIntent(intent: ChatIntent): intent is AnswerIntent {
  return (ANSWER_INTENTS as readonly string[]).includes(intent);
}

export function isCatalogIntent(intent: ChatIntent): intent is CatalogIntent {
  return (CATALOG_INTENTS as readonly string[]).includes(intent);
}

/** Cau hoi cuoi sau buoc noi tiep: mot trong hai loai (3 loai tham so khac nhau). */
export function isCatalogQuestion(q: FinalQuestion | CatalogQuestion): q is CatalogQuestion {
  return isCatalogIntent(q.intent);
}

/** Ky nam hoan toan o tuong lai -> khong the co viec "da xong" trong ky (§5.2). */
export function isFuturePeriod(period: ChatPeriod): boolean {
  return period === 'TOMORROW' || period === 'NEXT_WEEK' || period === 'NEXT_7_DAYS';
}

// ===================== Luoc do gui LLM (§4.3) =====================
// Phang, moi khoa bat buoc, KHONG co null trong enum (dung "NONE" / "") - cung kieu
// voi LLM_DRAFT_JSON_SCHEMA ma Gemini da chap nhan o che do json_schema. Khong dung
// maxLength (khong chac nha cung cap nao cung nhan): Zod ben duoi moi la cua kiem
// soat that, co test doi chieu hai ben.

export const INTENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'period', 'focus', 'member', 'target', 'column'],
  properties: {
    intent: {
      type: 'string',
      enum: [...CHAT_INTENTS],
      description: 'Y dinh cua cau hoi. NONE neu cau chi bo sung tham so cho cau truoc.',
    },
    period: {
      type: 'string',
      enum: [...CHAT_PERIODS, 'NONE'],
      description: 'Khoang thoi gian nguoi dung nhac toi; NONE neu khong nhac.',
    },
    focus: {
      type: 'string',
      enum: [...CHAT_FOCUSES, 'NONE'],
      description: 'Tinh trang cong viec can loc; NONE neu khong nhac.',
    },
    member: {
      type: 'string',
      description: 'Ten nguoi duoc hoi toi, dung nhu trong cau hoi; chuoi rong neu khong co.',
    },
    target: {
      type: 'string',
      description: 'Ten bang hoac khong gian duoc hoi toi (bo chu "bang", "khong gian"), dung nhu trong cau hoi; chuoi rong neu khong co.',
    },
    column: {
      type: 'string',
      description: 'Ten cot / danh sach duoc hoi toi (bo chu "cot"), dung nhu trong cau hoi; chuoi rong neu khong co.',
    },
  },
} as const;

// target / column co mac dinh "" khi THIEU KHOA (che do json_object co the bo sot khoa); sai kieu van la loi.
const llmIntentSchema = z
  .object({
    intent: z.enum(CHAT_INTENTS),
    period: z.enum([...CHAT_PERIODS, 'NONE']),
    focus: z.enum([...CHAT_FOCUSES, 'NONE']),
    member: z.string().max(MAX_MEMBER_CHARS),
    target: z.string().max(MAX_TARGET_CHARS).default(''),
    column: z.string().max(MAX_TARGET_CHARS).default(''),
  })
  .strict();

/**
 * Kiem hinh dang phan hoi LLM (JSON tho da parse). null = sai hinh dang -> nguoi goi
 * coi nhu LLM that bai (INVALID_SHAPE) va lui ve bo luat. Khong bao gio nem loi.
 */
export function parseLlmIntent(raw: unknown): ParsedQuestion | null {
  const r = llmIntentSchema.safeParse(raw);
  if (!r.success) return null;
  const member = r.data.member.trim();
  const target = r.data.target.trim();
  const column = r.data.column.trim();
  return {
    intent: r.data.intent,
    period: r.data.period === 'NONE' ? null : r.data.period,
    focus: r.data.focus === 'NONE' ? null : r.data.focus,
    member: member === '' ? null : member,
    // chi mang khoa khi co chuoi (cac ket qua cu khong doi hinh dang)
    ...(target === '' ? {} : { target }),
    ...(column === '' ? {} : { column }),
  };
}

// ===================== Tham so hieu luc (§4.4, §5.2) =====================

/** Cau hoi sau buoc noi tiep (chat.followup), y dinh da la 1 trong 5 y dinh tra loi. */
export interface FinalQuestion {
  intent: AnswerIntent;
  period: ChatPeriod | null;
  focus: ChatFocus | null;
  /** Ten go moi (chua nhan dien). */
  memberText: string | null;
  /** Nguoi da nhan dien o luot truoc (ke thua qua phien). */
  memberUserId: string | null;
}

/** Cau hoi danh muc sau buoc noi tiep (§18): y dinh + ten go bang / khong gian / cot (chua nhan dien). */
export interface CatalogQuestion {
  intent: CatalogIntent;
  /** Ten go bang / khong gian; null = khong nhac (dung pham vi). */
  target: string | null;
  /** Ten go cot (CARD_COUNTS); null = khong loc. */
  column: string | null;
  /** Id bang / khong gian nguoi dung DA CHON qua nut hoi lai (thay cho `target`); null = chua chon. */
  targetId: string | null;
}

/** Truy van hieu luc: ap mac dinh + bo tham so khong ap dung. */
export interface ResolvedQuery {
  intent: AnswerIntent;
  period: ChatPeriod | null;
  focus: ChatFocus | null;
  /** Tham so nguoi dung CO noi nhung loai cau hoi nay khong dung -> cau tra loi ghi ro. */
  ignoredSlots: ChatSlot[];
}

/** Ky cho viec "da xong": thieu -> tuan nay; ky tuong lai -> tuan nay + ghi bo qua. */
function donePeriod(period: ChatPeriod | null, ignored: Set<ChatSlot>): ChatPeriod {
  if (period === null) return 'THIS_WEEK';
  if (isFuturePeriod(period)) {
    ignored.add('period');
    return 'THIS_WEEK';
  }
  return period;
}

/** focus da biet (khac null) -> ky ap dung ra sao (§5.2). */
function periodForFocus(
  focus: ChatFocus,
  period: ChatPeriod | null,
  ignored: Set<ChatSlot>
): ChatPeriod | null {
  switch (focus) {
    case 'OPEN':
      return period; // null = moi viec dang mo, khong loc ngay
    case 'DONE':
      return donePeriod(period, ignored);
    case 'OVERDUE':
    case 'BLOCKED':
      if (period !== null) ignored.add('period');
      return null;
  }
}

export function resolveSlots(q: FinalQuestion): ResolvedQuery {
  const ignored = new Set<ChatSlot>();
  const hasMember = q.memberText !== null || q.memberUserId !== null;
  if (q.intent !== 'MEMBER_TASKS' && hasMember) ignored.add('member');

  let period: ChatPeriod | null = null;
  let focus: ChatFocus | null = null;

  switch (q.intent) {
    case 'MY_TASKS': {
      focus = q.focus ?? 'OPEN';
      period = periodForFocus(focus, q.period, ignored);
      break;
    }
    case 'MEMBER_TASKS':
    case 'TEAM_SUMMARY': {
      if (q.focus !== null) {
        focus = q.focus;
        period = periodForFocus(focus, q.period, ignored);
      } else if (q.intent === 'MEMBER_TASKS') {
        // Tong quan mot nguoi: viec dang mo (khong loc ngay) + viec xong trong ky
        period = donePeriod(q.period, ignored);
      } else {
        // Tong ket nhom: ky tuong lai van co nghia (viec den han trong ky)
        period = q.period ?? 'THIS_WEEK';
      }
      break;
    }
    case 'MY_PRIORITIES': {
      // "Hom nay nen lam gi truoc" - "hom nay" la ngam dinh, khong bao la bo qua
      if (q.period !== null && q.period !== 'TODAY') ignored.add('period');
      if (q.focus !== null) ignored.add('focus');
      break;
    }
    case 'TEAM_WORKLOAD': {
      if (q.period !== null) ignored.add('period');
      if (q.focus !== null) ignored.add('focus');
      break;
    }
  }

  const order: ChatSlot[] = ['period', 'focus', 'member'];
  return { intent: q.intent, period, focus, ignoredSlots: order.filter((s) => ignored.has(s)) };
}
