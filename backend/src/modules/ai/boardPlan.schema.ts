// Hop dong du lieu cua module AI (AI_MODULE.md §3, §5, §8.1).
//
// Co 2 lop Zod - dung o 2 BIEN GIOI TIN CAY:
//   1. LlmDraft  : dau ra tho cua mo hinh ngon ngu (khong dang tin).
//   2. BoardPlan : ke hoach di server -> trinh duyet -> server (client co the sua
//                  bat ky truong nao) nen phai KIEM LAI TOAN BO khi tao bang.
// RuleFindings (ai.rules.ts) do chinh code minh sinh ra nen khong co Zod.
//
// NGUYEN TAC: rang buoc bang CAU TRUC, khong bang loi dan trong prompt. Schema cua
// LLM KHONG CO O de dien ngay tuyet doi, id, userId hay ma mau hex - chi co
// startOffsetDays/durationDays (tuong doi) va colorKey (so thu tu). Du mo hinh bi
// van ban dau vao chiem quyen dieu khien, no cung khong co o nao de gay hai.
//
// MOI regex/khoa o day la hang so; khong ghep chuoi vao regex (xem ai.rules.ts).

import { z } from 'zod';
import { isValidIso } from './ai.dates';
import type { PlanMode } from './ai.rules';

// ===================== Bang mau + gioi han =====================

// Bang mau NHAN BAN cua frontend (BOARD_COLORS trong frontend/src/lib/boardColors.ts,
// LABEL_COLORS trong frontend/src/components/board/LabelPanel.tsx - hang cuc bo,
// khong export). KHONG import tu frontend: backend khong duoc phu thuoc hang cua
// frontend, neu khong doi bang mau giao dien se am tham doi rang buoc cua Zod.
// Neu frontend doi bang mau thi phai sua ca o day.
export const BOARD_COLORS = [
  '#0079BF',
  '#D29034',
  '#519839',
  '#B04632',
  '#89609E',
  '#CD5A91',
  '#00AECC',
  '#4BBF6B',
] as const;

export const LABEL_COLORS = [
  '#4bce97',
  '#f5cd47',
  '#fea362',
  '#f87168',
  '#9f8fef',
  '#579dff',
  '#6cc3e0',
  '#94c748',
  '#e774bb',
  '#8590a2',
] as const;

/** colorKey (so thu tu LLM chon) -> ma hex. Ngoai khoang thi ve mau dau tien. */
export function boardColorFromKey(key: number): (typeof BOARD_COLORS)[number] {
  return BOARD_COLORS[key] ?? BOARD_COLORS[0];
}
export function labelColorFromKey(key: number): (typeof LABEL_COLORS)[number] {
  return LABEL_COLORS[key] ?? LABEL_COLORS[0];
}

/**
 * Gioi han so luong theo che do + gioi han do dai.
 * - minLists = 1 (KHONG phai 2): mot ke hoach chi co 1 danh sach van hop le. Ban v1
 *   dat 2 va lam xoa sach ca ke hoach hop le.
 * - "db": lay DUNG bang cac Zod hien co (bang 100, danh sach 100, the 500, mo ta
 *   5000, muc checklist 500, nhan 50) de buoc tao bang khong bao gio bi tu choi oan.
 * - "llm": chat hon de tieu de/mo ta do AI sinh ra gon; nguoi dung van sua dai hon
 *   duoc o man xem truoc, toi da bang gioi han "db".
 */
export const LIMITS = {
  FREEFORM: { minLists: 1, maxLists: 8, maxTotalCards: 25 },
  STRUCTURED: { minLists: 1, maxLists: 20, maxTotalCards: 200 },
  maxLabels: LABEL_COLORS.length,
  maxLabelsPerCard: 10,
  maxChecklistItems: 10,
  maxOffsetDays: 365,
  maxLlmAssumptions: 10,
  maxPlanAssumptions: 20,
  maxWarnings: 50,
  db: {
    boardName: 100,
    listName: 100,
    cardTitle: 500,
    cardDescription: 5000,
    checklistItem: 500,
    labelName: 50,
  },
  llm: { title: 120, description: 2000, checklistItem: 200, assumption: 300, key: 40 },
} as const;

export function limitsForMode(mode: PlanMode) {
  return LIMITS[mode];
}

// ===================== Ma canh bao (tap DONG) =====================
// Moi ma xuat phat tu mot cho co that trong AI_MODULE.md; giao dien anh xa ma -> chu.

export const WARNING_CODES = [
  'LLM_UNAVAILABLE', // khong co khoa/cau hinh -> chay bang bo luat
  'LLM_FAILED', // goi LLM loi (timeout, 429, JSON hong...) -> lui ve bo luat
  'DRAFT_REPAIRED', // dau ra LLM phai sua nhe truoc khi dung duoc
  'INPUT_TRUNCATED', // van ban qua dai, da cat
  'CARD_DROPPED', // the bi loai vi khong truy vet duoc ve dong nguon
  'YEAR_INFERRED', // ngay thieu nam, da doan nam
  'FUZZY_DATE', // moc mo ("cuoi thang sau")
  'RELATIVE_FROM_TODAY', // "trong 2 tuan" tinh tu hom nay, khong phai tu ngay trong van ban
  'DATE_ORDER_FIXED', // ngay bat dau sau han chot (vd "tu 15/11 den 1/11") -> da doi cho
  'DEFAULT_WINDOW', // khong co ngay ket thuc du an -> dung cua so mac dinh
  'DEADLINE_IN_PAST', // ngay ket thuc o qua khu
  'WINDOW_TOO_SHORT', // cua so khong co ngay lam viec
  'OFFSET_CLAMPED', // goi y cua LLM vuot qua ngay ket thuc -> bi ke
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];

// ===================== TANG 2: LlmDraft =====================
// Gia tri "khong co" gui cho LLM la SO QUY UOC (sourceLine = 0, startOffsetDays = -1,
// durationDays = 0), Zod doi thanh null: nhieu nha cung cap mien phi tu choi kieu
// null / truong tuy chon trong JSON Schema. Van chap nhan null/thieu truong.

const keySchema = z.string().trim().min(1).max(LIMITS.llm.key);

const optionalInt = (min: number, max: number, sentinel: number) =>
  z
    .number()
    .int()
    .min(min)
    .max(max)
    .nullish()
    .transform((v) => (v == null || v === sentinel ? null : v));

/** Cac "shape" tach rieng de test doi chieu voi JSON Schema (khong lech tung truong). */
export const LLM_SHAPES = {
  board: z.object({
    // Cho phep rong: ten bang la viec cua buoc hop nhat (lay tu tieu de dau tien),
    // khong dang de mat ca ke hoach chi vi mo hinh quen dat ten.
    name: z.string().trim().max(LIMITS.db.boardName).default(''),
    colorKey: z.number().int().min(0).max(BOARD_COLORS.length - 1).default(0),
  }),
  label: z.object({
    key: keySchema,
    name: z.string().trim().min(1).max(LIMITS.db.labelName),
    colorKey: z.number().int().min(0).max(LABEL_COLORS.length - 1),
  }),
  card: z.object({
    title: z.string().trim().min(1, 'Tieu de trong').max(LIMITS.llm.title),
    description: z.string().trim().max(LIMITS.llm.description).default(''),
    sourceLine: optionalInt(0, 1_000_000, 0),
    labelKeys: z.array(keySchema).max(LIMITS.maxLabelsPerCard).default([]),
    checklist: z
      .array(z.string().trim().min(1).max(LIMITS.llm.checklistItem))
      .max(LIMITS.maxChecklistItems)
      .default([]),
    startOffsetDays: optionalInt(-1, LIMITS.maxOffsetDays, -1),
    durationDays: optionalInt(0, LIMITS.maxOffsetDays, 0),
  }),
  verdict: z.object({
    line: z.number().int().min(1),
    verdict: z.enum(['TASK', 'OTHER']),
  }),
};

const llmListShape = z.object({
  name: z.string().trim().min(1, 'Ten danh sach trong').max(LIMITS.db.listName),
  // Danh sach khong co the nao la vo ich: pha nghiem ngat tu choi, repairRawDraft bo no.
  cards: z.array(LLM_SHAPES.card).min(1, 'Danh sach phai co it nhat 1 the'),
});

const llmDraftBase = z.object({
  board: LLM_SHAPES.board.default({ name: '', colorKey: 0 }),
  labels: z.array(LLM_SHAPES.label).max(LIMITS.maxLabels).default([]),
  lists: z.array(llmListShape).min(1, 'Can it nhat 1 danh sach'),
  lineVerdicts: z.array(LLM_SHAPES.verdict).default([]),
  assumptions: z
    .array(z.string().trim().min(1).max(LIMITS.llm.assumption))
    .max(LIMITS.maxLlmAssumptions)
    .default([]),
});
export const LLM_DRAFT_SHAPES = { ...LLM_SHAPES, list: llmListShape, draft: llmDraftBase };

export interface DraftContext {
  /** So dong dau vao (RuleLine) - de kiem tra sourceLine/verdict nam trong 1..lineCount. */
  lineCount: number;
  mode: PlanMode;
  /**
   * true  = PHA NGHIEM NGAT: lineVerdicts phai phu du moi dong 1..lineCount, moi dong dung 1 lan.
   * false = PHA LONG: khong doi phu du (chi kiem tra tung verdict co hop le).
   */
  requireFullCoverage: boolean;
}

export function buildLlmDraftSchema(ctx: DraftContext) {
  const limits = limitsForMode(ctx.mode);
  return llmDraftBase.superRefine((draft, c) => {
    if (draft.lists.length > limits.maxLists) {
      c.addIssue({ code: 'custom', path: ['lists'], message: `Toi da ${limits.maxLists} danh sach` });
    }

    const labelKeys = new Set<string>();
    draft.labels.forEach((l, i) => {
      if (labelKeys.has(l.key)) {
        c.addIssue({ code: 'custom', path: ['labels', i, 'key'], message: `Khoa nhan trung: ${l.key}` });
      }
      labelKeys.add(l.key);
    });

    let total = 0;
    draft.lists.forEach((list, li) => {
      list.cards.forEach((card, ci) => {
        total += 1;
        if (card.sourceLine !== null && card.sourceLine > ctx.lineCount) {
          c.addIssue({
            code: 'custom',
            path: ['lists', li, 'cards', ci, 'sourceLine'],
            message: `sourceLine ${card.sourceLine} vuot so dong (${ctx.lineCount})`,
          });
        }
        card.labelKeys.forEach((k, ki) => {
          if (!labelKeys.has(k)) {
            c.addIssue({
              code: 'custom',
              path: ['lists', li, 'cards', ci, 'labelKeys', ki],
              message: `Nhan "${k}" chua duoc khai bao`,
            });
          }
        });
      });
    });
    if (total > limits.maxTotalCards) {
      c.addIssue({ code: 'custom', path: ['lists'], message: `Toi da ${limits.maxTotalCards} the (che do ${ctx.mode})` });
    }

    const seen = new Set<number>();
    draft.lineVerdicts.forEach((v, i) => {
      if (v.line > ctx.lineCount) {
        c.addIssue({
          code: 'custom',
          path: ['lineVerdicts', i, 'line'],
          message: `Dong ${v.line} vuot so dong (${ctx.lineCount})`,
        });
      }
      if (seen.has(v.line)) {
        c.addIssue({ code: 'custom', path: ['lineVerdicts', i, 'line'], message: `Dong ${v.line} bi cham 2 lan` });
      }
      seen.add(v.line);
    });
    if (ctx.requireFullCoverage) {
      const missing: number[] = [];
      for (let line = 1; line <= ctx.lineCount; line += 1) if (!seen.has(line)) missing.push(line);
      if (missing.length > 0) {
        c.addIssue({
          code: 'custom',
          path: ['lineVerdicts'],
          message: `Thieu verdict cho ${missing.length}/${ctx.lineCount} dong (vd dong ${missing.slice(0, 5).join(', ')})`,
        });
      }
    }
  });
}
export type LlmDraft = z.output<ReturnType<typeof buildLlmDraftSchema>>;
export type LlmCard = LlmDraft['lists'][number]['cards'][number];

// ===================== Sua nhe TAT DINH (khong goi lai mang) =====================
// CHI sua HINH DANG (cat chuoi, ke so, bo phan tu hong, ...). KHONG quyet dinh
// CHINH SACH (vd "che do STRUCTURED thi loai the khong co sourceLine") - viec do
// cua buoc hop nhat (plan.build). Nhan vao gia tri tho, tra ban sao moi.

export type RepairCode =
  | 'TEXT_TRUNCATED'
  | 'NUMBER_CLAMPED'
  | 'CARD_DROPPED'
  | 'LIST_DROPPED'
  | 'LIST_NAME_DEFAULTED'
  | 'SOURCE_LINE_INVALID'
  | 'LABEL_DROPPED'
  | 'LABEL_KEY_UNKNOWN'
  | 'VERDICT_DROPPED'
  | 'ITEMS_TRUNCATED'
  | 'CARDS_TRUNCATED'
  | 'LISTS_TRUNCATED';
export interface RepairNote {
  code: RepairCode;
  count: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function repairRawDraft(raw: unknown, ctx: DraftContext): { value: unknown; repairs: RepairNote[] } {
  const counts = new Map<RepairCode, number>();
  const note = (code: RepairCode, n = 1) => counts.set(code, (counts.get(code) ?? 0) + n);
  const finish = (value: unknown) => ({
    value,
    repairs: [...counts].map(([code, count]) => ({ code, count })),
  });

  if (!isRecord(raw)) return finish(raw);
  const limits = limitsForMode(ctx.mode);

  const text = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    if (t.length <= max) return t;
    note('TEXT_TRUNCATED');
    return t.slice(0, max).trimEnd();
  };
  const clamp = (v: unknown, min: number, max: number, fallback: number): number => {
    const n = toNumber(v);
    if (n === null) return fallback;
    const r = Math.round(n);
    if (r < min || r > max) {
      note('NUMBER_CLAMPED');
      return Math.min(max, Math.max(min, r));
    }
    return r;
  };
  const cap = <T>(arr: T[], max: number, code: RepairCode): T[] => {
    if (arr.length <= max) return arr;
    note(code, arr.length - max);
    return arr.slice(0, max);
  };

  // --- board ---
  const rawBoard = isRecord(raw.board) ? raw.board : {};
  const board = {
    name: text(rawBoard.name, LIMITS.db.boardName) ?? '',
    colorKey: clamp(rawBoard.colorKey, 0, BOARD_COLORS.length - 1, 0),
  };

  // --- labels ---
  const labels: Array<{ key: string; name: string; colorKey: number }> = [];
  const declared = new Set<string>();
  for (const l of Array.isArray(raw.labels) ? raw.labels : []) {
    const key = isRecord(l) ? text(l.key, LIMITS.llm.key) : null;
    const name = isRecord(l) ? text(l.name, LIMITS.db.labelName) : null;
    if (!isRecord(l) || !key || !name || declared.has(key)) {
      note('LABEL_DROPPED');
      continue;
    }
    declared.add(key);
    labels.push({ key, name, colorKey: clamp(l.colorKey, 0, LABEL_COLORS.length - 1, 0) });
  }
  const labelsCapped = cap(labels, LIMITS.maxLabels, 'ITEMS_TRUNCATED');
  const keptKeys = new Set(labelsCapped.map((l) => l.key));

  // --- lists / cards ---
  const lists: Array<{ name: string; cards: unknown[] }> = [];
  let totalCards = 0;
  const rawLists = cap(Array.isArray(raw.lists) ? raw.lists : [], limits.maxLists, 'LISTS_TRUNCATED');
  rawLists.forEach((rl, li) => {
    if (!isRecord(rl)) {
      note('LIST_DROPPED');
      return;
    }
    let name = text(rl.name, LIMITS.db.listName);
    if (!name) {
      name = `Danh sách ${li + 1}`;
      note('LIST_NAME_DEFAULTED');
    }
    const cards: unknown[] = [];
    for (const rc of Array.isArray(rl.cards) ? rl.cards : []) {
      const title = isRecord(rc) ? text(rc.title, LIMITS.llm.title) : null;
      if (!isRecord(rc) || !title) {
        note('CARD_DROPPED');
        continue;
      }
      if (totalCards >= limits.maxTotalCards) {
        note('CARDS_TRUNCATED');
        continue;
      }
      totalCards += 1;

      // sourceLine: khong hop le / ngoai 1..lineCount -> 0 ("khong co")
      let sourceLine = 0;
      if (rc.sourceLine !== null && rc.sourceLine !== undefined) {
        const n = toNumber(rc.sourceLine);
        if (n !== null && Number.isInteger(n) && n >= 0 && n <= ctx.lineCount) sourceLine = n;
        else note('SOURCE_LINE_INVALID');
      }

      const labelKeys: string[] = [];
      for (const k of Array.isArray(rc.labelKeys) ? rc.labelKeys : []) {
        const key = text(k, LIMITS.llm.key);
        if (!key || !keptKeys.has(key)) note('LABEL_KEY_UNKNOWN');
        else if (!labelKeys.includes(key)) labelKeys.push(key);
      }

      const checklist: string[] = [];
      for (const item of Array.isArray(rc.checklist) ? rc.checklist : []) {
        const t = text(item, LIMITS.llm.checklistItem);
        if (t) checklist.push(t);
      }

      cards.push({
        title,
        description: text(rc.description, LIMITS.llm.description) ?? '',
        sourceLine,
        labelKeys: cap(labelKeys, LIMITS.maxLabelsPerCard, 'ITEMS_TRUNCATED'),
        checklist: cap(checklist, LIMITS.maxChecklistItems, 'ITEMS_TRUNCATED'),
        // am / khong phai so -> "khong xac dinh" (-1); qua lon -> ke o 365
        startOffsetDays: toNumber(rc.startOffsetDays) === null ? -1 : clamp(rc.startOffsetDays, -1, LIMITS.maxOffsetDays, -1),
        durationDays: toNumber(rc.durationDays) === null ? 0 : clamp(rc.durationDays, 0, LIMITS.maxOffsetDays, 0),
      });
    }
    // Danh sach rong sau khi sua khong co ich -> bo
    if (cards.length === 0) {
      note('LIST_DROPPED');
      return;
    }
    lists.push({ name, cards });
  });

  // --- lineVerdicts: giu verdict hop le dau tien cua tung dong ---
  const verdicts: Array<{ line: number; verdict: 'TASK' | 'OTHER' }> = [];
  const seenLines = new Set<number>();
  for (const v of Array.isArray(raw.lineVerdicts) ? raw.lineVerdicts : []) {
    const line = isRecord(v) ? toNumber(v.line) : null;
    const verdict = isRecord(v) && typeof v.verdict === 'string' ? v.verdict.trim().toUpperCase() : '';
    if (
      line === null ||
      !Number.isInteger(line) ||
      line < 1 ||
      line > ctx.lineCount ||
      seenLines.has(line) ||
      (verdict !== 'TASK' && verdict !== 'OTHER')
    ) {
      note('VERDICT_DROPPED');
      continue;
    }
    seenLines.add(line);
    verdicts.push({ line, verdict });
  }

  const assumptions: string[] = [];
  for (const a of Array.isArray(raw.assumptions) ? raw.assumptions : []) {
    const t = text(a, LIMITS.llm.assumption);
    if (t) assumptions.push(t);
  }

  return finish({
    board,
    labels: labelsCapped,
    lists,
    lineVerdicts: verdicts,
    assumptions: cap(assumptions, LIMITS.maxLlmAssumptions, 'ITEMS_TRUNCATED'),
  });
}

export type ParseLlmDraftResult =
  | {
      ok: true;
      draft: LlmDraft;
      /** true = hop le HOAN TOAN ngay lan dau (khong can sua, phu du moi dong). */
      strictParseOk: boolean;
      /** So dong duoc cham verdict hop le (= lineCount khi strictParseOk). */
      verdictLines: number;
      repairs: RepairNote[];
    }
  | { ok: false; reason: 'INVALID_SHAPE'; issues: string[] };

function formatIssues(error: z.ZodError): string[] {
  return error.issues.slice(0, 5).map((i) => `${i.path.join('.') || '(goc)'}: ${i.message}`);
}

/**
 * "DO, KHONG CHAN": pha nghiem ngat -> (that bai) sua nhe tat dinh -> pha long.
 * Model mien phi quen 1 dong tren 40 la chuyen thuong; chan cung se vut ca ket qua
 * tot VA mat luon so lieu. Cung mot rang buoc, nhung do duoc thay vi lam hong.
 */
export function parseLlmDraft(raw: unknown, base: Omit<DraftContext, 'requireFullCoverage'>): ParseLlmDraftResult {
  const strict = buildLlmDraftSchema({ ...base, requireFullCoverage: true }).safeParse(raw);
  if (strict.success) {
    return {
      ok: true,
      draft: strict.data,
      strictParseOk: true,
      verdictLines: strict.data.lineVerdicts.length,
      repairs: [],
    };
  }

  const { value, repairs } = repairRawDraft(raw, { ...base, requireFullCoverage: false });
  const lenient = buildLlmDraftSchema({ ...base, requireFullCoverage: false }).safeParse(value);
  if (!lenient.success) {
    return { ok: false, reason: 'INVALID_SHAPE', issues: formatIssues(lenient.error) };
  }
  return {
    ok: true,
    draft: lenient.data,
    strictParseOk: false,
    verdictLines: lenient.data.lineVerdicts.length,
    repairs,
  };
}

// ===================== JSON Schema gui cho LLM (VIET TAY) =====================
// "Mau so chung nho nhat": chi type/properties/required/items/enum/description/
// additionalProperties:false. KHONG sinh tu Zod: zod-to-json-schema tao $ref/$defs
// ma nhieu nha cung cap mien phi tra 400. MOI truong deu "required" (che do strict
// cua mot so nha yeu cau vay); gia tri "khong co" dung SO QUY UOC, khong dung null.
//
// CHI LA GOI Y. Cua kiem soat that la Zod (parseLlmDraft) - khong bao gio tin
// strict:true cua nha cung cap. Co test doi chieu tung truong voi LLM_DRAFT_SHAPES.

export const LLM_DRAFT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['board', 'labels', 'lists', 'lineVerdicts', 'assumptions'],
  properties: {
    board: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'colorKey'],
      properties: {
        name: { type: 'string', description: 'Ten bang, ngan gon.' },
        colorKey: { type: 'integer', description: 'So thu tu mau nen bang, tu 0 den 7.' },
      },
    },
    labels: {
      type: 'array',
      description: 'Nhan phan loai (toi da 10). De mang rong neu khong can.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'name', 'colorKey'],
        properties: {
          key: { type: 'string', description: 'Khoa ngan duy nhat de the tro toi, vd "l1".' },
          name: { type: 'string', description: 'Ten nhan.' },
          colorKey: { type: 'integer', description: 'So thu tu mau nhan, tu 0 den 9.' },
        },
      },
    },
    lists: {
      type: 'array',
      description: 'Cac danh sach (cot) cua bang, it nhat 1.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'cards'],
        properties: {
          name: { type: 'string', description: 'Ten danh sach.' },
          cards: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: [
                'title',
                'description',
                'sourceLine',
                'labelKeys',
                'checklist',
                'startOffsetDays',
                'durationDays',
              ],
              properties: {
                title: { type: 'string', description: 'Tieu de the, dong tu + tan ngu, toi da 120 ky tu.' },
                description: { type: 'string', description: 'Mo ta ngan; chuoi rong neu khong co.' },
                sourceLine: {
                  type: 'integer',
                  description: 'So dong dau vao sinh ra the nay (tinh tu 1). 0 neu the do ban tu them.',
                },
                labelKeys: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Cac khoa nhan (da khai bao o "labels") gan cho the.',
                },
                checklist: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Cac y nho trong the (toi da 10). Mang rong neu khong co.',
                },
                startOffsetDays: {
                  type: 'integer',
                  description:
                    'So NGAY LAM VIEC ke tu ngay bat dau du an de bat dau the nay (0 = ngay dau tien). -1 neu khong xac dinh. TUYET DOI khong tra ngay thang cu the.',
                },
                durationDays: {
                  type: 'integer',
                  description: 'The keo dai bao nhieu ngay lam viec (>= 1). 0 neu khong xac dinh.',
                },
              },
            },
          },
        },
      },
    },
    lineVerdicts: {
      type: 'array',
      description: 'MOI dong dau vao dung 1 phan tu: dong do la viec can lam (TASK) hay khong (OTHER).',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['line', 'verdict'],
        properties: {
          line: { type: 'integer', description: 'So dong, tinh tu 1.' },
          verdict: { type: 'string', enum: ['TASK', 'OTHER'] },
        },
      },
    },
    assumptions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Nhung dieu ban phai doan de lap ke hoach (toi da 10). Mang rong neu khong doan gi.',
    },
  },
} as const;

// ===================== TANG 3: BoardPlan =====================

const dateOriginSchema = z.enum(['EXPLICIT', 'SCHEDULED', 'NONE']);
/** EXPLICIT: nguoi viet/nguoi dung ghi ro | SCHEDULED: do bo rai lich | NONE: khong co ngay. */
export type DateOrigin = z.infer<typeof dateOriginSchema>;

// Ngay lich THAT (khong chi khop dang chuoi): "2026-02-30" bi tu choi.
const isoDateSchema = z.string().refine(isValidIso, 'Ngay khong hop le (can YYYY-MM-DD that)');

const planCardSchema = z
  .object({
    ref: z.string().trim().min(1).max(LIMITS.llm.key),
    title: z.string().trim().min(1, 'Tieu de trong').max(LIMITS.db.cardTitle),
    description: z.string().trim().max(LIMITS.db.cardDescription),
    /** Dong dau vao sinh ra the nay; null = AI tu them (che do STRUCTURED se bi loai). */
    sourceLine: z.number().int().min(1).nullable(),
    /** Nguoi dung tick o man xem truoc; chi the selected moi duoc tao. */
    selected: z.boolean(),
    startDate: isoDateSchema.nullable(),
    startOrigin: dateOriginSchema,
    dueDate: isoDateSchema.nullable(),
    dueOrigin: dateOriginSchema,
    labelKeys: z.array(z.string().trim().min(1).max(LIMITS.llm.key)).max(LIMITS.maxLabelsPerCard),
    checklist: z
      .array(z.string().trim().min(1).max(LIMITS.db.checklistItem))
      .max(LIMITS.maxChecklistItems),
  })
  .strict()
  .superRefine((c, ctx) => {
    // Rang buoc CHEO 2 chieu giua ngay va nguon goc: bat truong hop giao dien sua
    // ngay ma quen doi nguon (hoac nguoc lai).
    for (const [dateKey, originKey] of [
      ['startDate', 'startOrigin'],
      ['dueDate', 'dueOrigin'],
    ] as const) {
      const hasDate = c[dateKey] !== null;
      if (hasDate && c[originKey] === 'NONE') {
        ctx.addIssue({ code: 'custom', path: [originKey], message: 'Co ngay thi nguon khong duoc la NONE' });
      }
      if (!hasDate && c[originKey] !== 'NONE') {
        ctx.addIssue({ code: 'custom', path: [originKey], message: 'Khong co ngay thi nguon phai la NONE' });
      }
    }
    // Chi so sanh khi CA HAI la ngay that: so sanh chuoi tren "2026-02-30" se sinh
    // them loi "bat dau sau han" gay roi ben canh loi that (ngay khong ton tai).
    if (
      c.startDate !== null &&
      c.dueDate !== null &&
      isValidIso(c.startDate) &&
      isValidIso(c.dueDate) &&
      c.startDate > c.dueDate
    ) {
      ctx.addIssue({ code: 'custom', path: ['startDate'], message: 'Ngay bat dau sau han chot' });
    }
  });
export type PlanCard = z.output<typeof planCardSchema>;

const planLabelSchema = z
  .object({
    key: z.string().trim().min(1).max(LIMITS.llm.key),
    name: z.string().trim().min(1).max(LIMITS.db.labelName),
    color: z.enum(LABEL_COLORS, { error: 'Mau nhan khong nam trong bang mau cho phep' }),
  })
  .strict();

const planListSchema = z
  .object({
    name: z.string().trim().min(1, 'Ten danh sach trong').max(LIMITS.db.listName),
    cards: z.array(planCardSchema),
  })
  .strict();

const planWarningSchema = z
  .object({
    code: z.enum(WARNING_CODES),
    message: z.string().trim().min(1).max(300),
    /** Tro toi the (ref) hoac dong lien quan neu co. */
    ref: z.string().max(LIMITS.llm.key).optional(),
    line: z.number().int().min(1).optional(),
  })
  .strict();
export type PlanWarning = z.output<typeof planWarningSchema>;

// KHONG co truong "stats": thong ke (so the, so the bi loai...) nam o AiRun/response
// va do SERVER tinh - client khong co cho de khai man totalCards.
export const boardPlanSchema = z
  .object({
    mode: z.enum(['STRUCTURED', 'FREEFORM']),
    board: z
      .object({
        name: z.string().trim().min(1, 'Ten bang trong').max(LIMITS.db.boardName),
        color: z.enum(BOARD_COLORS, { error: 'Mau bang khong nam trong bang mau cho phep' }),
      })
      .strict(),
    labels: z.array(planLabelSchema).max(LIMITS.maxLabels),
    lists: z.array(planListSchema).min(1, 'Can it nhat 1 danh sach'),
    warnings: z.array(planWarningSchema).max(LIMITS.maxWarnings),
    assumptions: z.array(z.string().trim().min(1).max(300)).max(LIMITS.maxPlanAssumptions),
  })
  .strict()
  .superRefine((plan, ctx) => {
    const limits = limitsForMode(plan.mode);
    if (plan.lists.length > limits.maxLists) {
      ctx.addIssue({ code: 'custom', path: ['lists'], message: `Toi da ${limits.maxLists} danh sach` });
    }

    const labelKeys = new Set<string>();
    plan.labels.forEach((l, i) => {
      if (labelKeys.has(l.key)) {
        ctx.addIssue({ code: 'custom', path: ['labels', i, 'key'], message: `Khoa nhan trung: ${l.key}` });
      }
      labelKeys.add(l.key);
    });

    const refs = new Set<string>();
    let total = 0;
    plan.lists.forEach((list, li) => {
      list.cards.forEach((card, ci) => {
        total += 1;
        if (refs.has(card.ref)) {
          ctx.addIssue({
            code: 'custom',
            path: ['lists', li, 'cards', ci, 'ref'],
            message: `Ma the trung: ${card.ref}`,
          });
        }
        refs.add(card.ref);
        card.labelKeys.forEach((k, ki) => {
          if (!labelKeys.has(k)) {
            ctx.addIssue({
              code: 'custom',
              path: ['lists', li, 'cards', ci, 'labelKeys', ki],
              message: `Nhan "${k}" chua duoc khai bao`,
            });
          }
        });
      });
    });
    if (total > limits.maxTotalCards) {
      ctx.addIssue({ code: 'custom', path: ['lists'], message: `Toi da ${limits.maxTotalCards} the (che do ${plan.mode})` });
    }
  });
export type BoardPlan = z.output<typeof boardPlanSchema>;
