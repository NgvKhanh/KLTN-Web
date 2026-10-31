import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDays } from '../src/modules/ai/ai.dates';
import { scheduleCards, type ScheduleInput } from '../src/modules/ai/ai.schedule';
import {
  BOARD_COLORS,
  LABEL_COLORS,
  LIMITS,
  LLM_DRAFT_JSON_SCHEMA,
  LLM_DRAFT_SHAPES,
  LLM_SHAPES,
  WARNING_CODES,
  boardColorFromKey,
  boardPlanSchema,
  labelColorFromKey,
  parseLlmDraft,
  type BoardPlan,
  type ParseLlmDraftResult,
} from '../src/modules/ai/boardPlan.schema';
import { createBoardSchema } from '../src/modules/board/board.schema';
import { createCardSchema, updateCardSchema } from '../src/modules/card/card.schema';
import { addChecklistItemSchema, createLabelSchema } from '../src/modules/card/cardExtras.schema';
import { createListSchema } from '../src/modules/list/list.schema';

// Buoc 3 (AI_MODULE.md §3, §5, §8.1): hop dong du lieu LlmDraft / BoardPlan.
// Moi gia tri mong doi duoc LAY tu lan chay that (script tham do) roi doi chieu bang
// mat truoc khi viet vao day. test/setup.ts TRUNCATE DB truoc MOI `it` (~0.4 giay)
// nen cac ca duoc gop thanh bang.

const ctx = { lineCount: 5, mode: 'FREEFORM' as const };

const card = (over: Record<string, unknown> = {}) => ({
  title: 'Viet de cuong',
  description: 'Mo ta',
  sourceLine: 1,
  labelKeys: [] as string[],
  checklist: [] as string[],
  startOffsetDays: 0,
  durationDays: 2,
  ...over,
});
const verdicts = (n: number, verdict = 'TASK') => Array.from({ length: n }, (_, i) => ({ line: i + 1, verdict }));
const draft = (over: Record<string, unknown> = {}) => ({
  board: { name: 'Khoa luan', colorKey: 2 },
  labels: [{ key: 'l1', name: 'Gap', colorKey: 3 }],
  lists: [{ name: 'Viec can lam', cards: [card({ labelKeys: ['l1'] })] }],
  lineVerdicts: verdicts(5),
  assumptions: [] as string[],
  ...over,
});
const oneList = (cards: unknown[]) => ({ lists: [{ name: 'L', cards }] });

function summary(r: ParseLlmDraftResult): string {
  if (!r.ok) return `INVALID ${r.issues[0]}`;
  const repairs = r.repairs.map((x) => `${x.code}:${x.count}`).join(',');
  return `ok strict=${r.strictParseOk} verdicts=${r.verdictLines} repairs=[${repairs}]`;
}
function parsed(raw: unknown, c: Parameters<typeof parseLlmDraft>[1] = ctx) {
  const r = parseLlmDraft(raw, c);
  if (!r.ok) throw new Error(`Mong doi parse duoc: ${r.issues.join(' | ')}`);
  return r;
}
function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

// ===================== Bang mau + gioi han khop the gioi ben ngoai =====================

describe('bang mau va gioi han khop voi phan con lai cua he thong', () => {
  const ROOT = path.resolve(__dirname, '..', '..', 'frontend', 'src');
  const hexes = (s: string) => s.match(/#[0-9A-Fa-f]{6}/g) ?? [];

  it('BOARD_COLORS / LABEL_COLORS trung KHIT tung ma voi hang cua frontend (chong lech am tham)', () => {
    const board = hexes(fs.readFileSync(path.join(ROOT, 'lib', 'boardColors.ts'), 'utf8'));
    const panel = fs.readFileSync(path.join(ROOT, 'components', 'board', 'LabelPanel.tsx'), 'utf8');
    const block = panel.slice(panel.indexOf('const LABEL_COLORS = ['), panel.indexOf('];', panel.indexOf('const LABEL_COLORS = [')));
    expect(hexes(block).length).toBe(10); // dam bao cat dung khoi
    expect([...BOARD_COLORS]).toEqual(board);
    expect([...LABEL_COLORS]).toEqual(hexes(block));
  });

  it('moi mau trong bang deu qua duoc Zod that cua backend; colorKey ngoai khoang ve mau dau', () => {
    for (const color of BOARD_COLORS) {
      expect(createBoardSchema.safeParse({ name: 'B', workspaceId: 'w', color }).success).toBe(true);
    }
    for (const color of LABEL_COLORS) {
      expect(createLabelSchema.safeParse({ name: 'L', color }).success).toBe(true);
    }
    expect(boardColorFromKey(0)).toBe('#0079BF');
    expect(boardColorFromKey(7)).toBe('#4BBF6B');
    expect(boardColorFromKey(8)).toBe('#0079BF');
    expect(boardColorFromKey(-1)).toBe('#0079BF');
    expect(labelColorFromKey(9)).toBe('#8590a2');
    expect(labelColorFromKey(10)).toBe('#4bce97');
  });

  it('LIMITS.db bang DUNG gioi han cua Zod DB that (ngay tai bien va +1), ca hai phia deu chap nhan/tu choi giong nhau', () => {
    const x = (n: number) => 'x'.repeat(n);
    const planWith = (cardOver: Record<string, unknown>, other: Record<string, unknown> = {}) =>
      boardPlanSchema.safeParse({
        mode: 'FREEFORM',
        board: { name: 'B', color: BOARD_COLORS[0] },
        labels: [],
        lists: [{ name: 'L', cards: [planCard(cardOver)] }],
        warnings: [],
        assumptions: [],
        ...other,
      }).success;
    const rows: Array<[string, number, (n: number) => boolean, (n: number) => boolean]> = [
      [
        'ten bang',
        LIMITS.db.boardName,
        (n) => createBoardSchema.safeParse({ name: x(n), workspaceId: 'w' }).success,
        (n) => planWith({}, { board: { name: x(n), color: BOARD_COLORS[0] } }),
      ],
      [
        'ten danh sach',
        LIMITS.db.listName,
        (n) => createListSchema.safeParse({ name: x(n) }).success,
        (n) =>
          boardPlanSchema.safeParse({
            mode: 'FREEFORM',
            board: { name: 'B', color: BOARD_COLORS[0] },
            labels: [],
            lists: [{ name: x(n), cards: [] }],
            warnings: [],
            assumptions: [],
          }).success,
      ],
      [
        'tieu de the',
        LIMITS.db.cardTitle,
        (n) => createCardSchema.safeParse({ title: x(n) }).success,
        (n) => planWith({ title: x(n) }),
      ],
      [
        'mo ta the',
        LIMITS.db.cardDescription,
        (n) => updateCardSchema.safeParse({ description: x(n) }).success,
        (n) => planWith({ description: x(n) }),
      ],
      [
        'muc checklist',
        LIMITS.db.checklistItem,
        (n) => addChecklistItemSchema.safeParse({ content: x(n) }).success,
        (n) => planWith({ checklist: [x(n)] }),
      ],
      [
        'ten nhan',
        LIMITS.db.labelName,
        (n) => createLabelSchema.safeParse({ name: x(n), color: LABEL_COLORS[0] }).success,
        (n) =>
          planWith({}, { labels: [{ key: 'l1', name: x(n), color: LABEL_COLORS[0] }] }),
      ],
    ];
    const wrong = rows.flatMap(([name, limit, dbOk, planOk]) => [
      ...(dbOk(limit) && planOk(limit) ? [] : [`${name}: tai bien ${limit} phai duoc chap nhan o CA HAI`]),
      ...(!dbOk(limit + 1) && !planOk(limit + 1) ? [] : [`${name}: ${limit + 1} phai bi tu choi o CA HAI`]),
    ]);
    expect(wrong).toEqual([]);
  });
});

/** The BoardPlan hop le toi thieu, dung lai cho nhieu ca. */
function planCard(over: Record<string, unknown> = {}) {
  return {
    ref: 'c1',
    title: 'Viet de cuong',
    description: '',
    sourceLine: 1,
    selected: true,
    startDate: '2026-09-14',
    startOrigin: 'SCHEDULED',
    dueDate: '2026-09-18',
    dueOrigin: 'SCHEDULED',
    labelKeys: [] as string[],
    checklist: ['A', 'B'],
    ...over,
  };
}

// ===================== parseLlmDraft: do, khong chan =====================

describe('parseLlmDraft: pha nghiem ngat -> sua nhe -> pha long', () => {
  it('tom tat ket qua cua 18 dau vao (hop le, thieu verdict, vuot gioi han, hong nang...)', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => card({ title: `T${i}` }));
    const rows: Array<[string, unknown, string, Parameters<typeof parseLlmDraft>[1]?]> = [
      ['hop le day du', draft(), 'ok strict=true verdicts=5 repairs=[]'],
      ['thieu verdict 2/5 dong -> van dung duoc, do duoc do phu', draft({ lineVerdicts: verdicts(3) }), 'ok strict=false verdicts=3 repairs=[]'],
      ['khong co verdict nao', draft({ lineVerdicts: [] }), 'ok strict=false verdicts=0 repairs=[]'],
      ['verdict viet thuong + truong la o goc', { ...draft({ lineVerdicts: verdicts(5, 'task') }), bonus: 1 }, 'ok strict=false verdicts=5 repairs=[]'],
      ['truong la o the (userId, dueDate) bi bo im lang', draft(oneList([{ ...card(), userId: 'x', dueDate: '2026-01-01' }])), 'ok strict=true verdicts=5 repairs=[]'],
      ['tieu de 200 ky tu -> cat ve 120', draft(oneList([card({ title: 'x'.repeat(200) })])), 'ok strict=false verdicts=5 repairs=[TEXT_TRUNCATED:1]'],
      ['sourceLine 99 khi chi co 5 dong', draft(oneList([card({ sourceLine: 99 })])), 'ok strict=false verdicts=5 repairs=[SOURCE_LINE_INVALID:1]'],
      ['labelKey khong ton tai (va trung)', draft(oneList([card({ labelKeys: ['l1', 'zzz', 'l1'] })])), 'ok strict=false verdicts=5 repairs=[LABEL_KEY_UNKNOWN:1]'],
      ['offset 500 / -5 / "abc" / 3.6 / "3"', draft(oneList([card({ startOffsetDays: 500, durationDays: 3.6 }), card({ startOffsetDays: -5, durationDays: 'abc' }), card({ startOffsetDays: '3', durationDays: '2' })])), 'ok strict=false verdicts=5 repairs=[NUMBER_CLAMPED:2]'],
      ['30 the o che do FREEFORM (toi da 25)', draft(oneList(many(30))), 'ok strict=false verdicts=5 repairs=[CARDS_TRUNCATED:5]'],
      ['30 the o che do STRUCTURED (duoc phep)', draft(oneList(many(30))), 'ok strict=true verdicts=5 repairs=[]', { lineCount: 5, mode: 'STRUCTURED' }],
      ['12 danh sach o che do FREEFORM (toi da 8)', draft({ lists: Array.from({ length: 12 }, (_, i) => ({ name: `L${i}`, cards: [card()] })) }), 'ok strict=false verdicts=5 repairs=[LISTS_TRUNCATED:4]'],
      [
        'danh sach rong + the khong tieu de + danh sach thieu ten',
        draft({
          lists: [
            { name: 'Rong', cards: [] },
            { name: 'Co the hong', cards: [{ title: '   ' }, { description: 'khong title' }, 'chuoi la', null, card()] },
            { cards: [card({ title: 'Ten list thieu' })] },
          ],
        }),
        'ok strict=false verdicts=5 repairs=[LIST_DROPPED:1,CARD_DROPPED:4,LIST_NAME_DEFAULTED:1]',
      ],
      ['nhan trung khoa / khoa rong / colorKey 99', draft({ labels: [{ key: 'l1', name: 'A', colorKey: 99 }, { key: 'l1', name: 'B', colorKey: 1 }, { key: '', name: 'C', colorKey: 1 }] }), 'ok strict=false verdicts=5 repairs=[NUMBER_CLAMPED:1,LABEL_DROPPED:2]'],
      [
        'verdict trung / ngoai pham vi / sai gia tri / dong 0',
        draft({ lineVerdicts: [{ line: 1, verdict: 'TASK' }, { line: 1, verdict: 'OTHER' }, { line: 9, verdict: 'TASK' }, { line: 2, verdict: 'MAYBE' }, { line: 0, verdict: 'TASK' }, { line: 3, verdict: 'other' }] }),
        'ok strict=false verdicts=2 repairs=[VERDICT_DROPPED:4]',
      ],
      ['ten bang de trong (cho phep - buoc hop nhat tu dat)', draft({ board: { colorKey: 1 } }), 'ok strict=true verdicts=5 repairs=[]'],
      ['khong co truong board', (({ board: _b, ...rest }) => rest)(draft()), 'ok strict=true verdicts=5 repairs=[]'],
      ['lineCount = 0', draft({ lineVerdicts: [] }), 'ok strict=false verdicts=0 repairs=[SOURCE_LINE_INVALID:1]', { lineCount: 0, mode: 'FREEFORM' }],
    ];
    const wrong = rows
      .map(([name, raw, want, c]) => ({ name, want, got: summary(parseLlmDraft(raw, c ?? ctx)) }))
      .filter((r) => r.want !== r.got);
    expect(wrong).toEqual([]);
  });

  it('hong that (khong phai object, khong co danh sach nao dung duoc) -> INVALID_SHAPE de dung duong rule-only', () => {
    const rows: Array<[string, unknown, RegExp]> = [
      ['goc la chuoi', 'khong phai object', /^\(goc\):/],
      ['goc la mang', [], /^\(goc\):/],
      ['goc la null', null, /^\(goc\):/],
      ['{}', {}, /^lists: Can it nhat 1 danh sach$/],
      ['lists khong phai mang', draft({ lists: 'oops' }), /^lists: Can it nhat 1 danh sach$/],
      ['tat ca danh sach rong (sau khi sua khong con gi)', draft({ lists: [{ name: 'Rong', cards: [] }] }), /^lists: Can it nhat 1 danh sach$/],
      ['tat ca the deu khong co tieu de', draft(oneList([{ title: '' }, {}])), /^lists: Can it nhat 1 danh sach$/],
    ];
    const wrong = rows
      .map(([name, raw, re]) => ({ name, re, r: parseLlmDraft(raw, ctx) }))
      .filter(({ r, re }) => r.ok || !re.test(r.issues[0] ?? ''))
      .map(({ name, r }) => ({ name, r }));
    expect(wrong).toEqual([]);
  });

  it('gia tri sau khi sua dung y: so quy uoc -> null, truong la bi bo, cat chuoi, ke so, dat ten mac dinh', () => {
    // so quy uoc "khong co" va null deu thanh null; thieu truong thi lay mac dinh
    const sentinel = parsed(draft(oneList([{ title: 'T', sourceLine: 0, startOffsetDays: -1, durationDays: 0 }]))).draft;
    expect(sentinel.lists[0]!.cards[0]).toEqual({
      title: 'T',
      description: '',
      sourceLine: null,
      labelKeys: [],
      checklist: [],
      startOffsetDays: null,
      durationDays: null,
    });
    const nulls = parsed(draft(oneList([{ title: 'T', sourceLine: null, startOffsetDays: null, durationDays: null }]))).draft;
    expect(nulls.lists[0]!.cards[0]).toEqual(sentinel.lists[0]!.cards[0]);

    // truong nguy hiem (userId, dueDate...) khong bao gio song sot qua parse
    const stripped = parsed(draft(oneList([{ ...card(), userId: 'u1', dueDate: '2026-01-01', color: '#fff' }]))).draft;
    expect(Object.keys(stripped.lists[0]!.cards[0]!).sort()).toEqual(
      ['checklist', 'description', 'durationDays', 'labelKeys', 'sourceLine', 'startOffsetDays', 'title'].sort()
    );

    expect(parsed(draft(oneList([card({ title: 'x'.repeat(200) })]))).draft.lists[0]!.cards[0]!.title).toHaveLength(120);
    expect(parsed(draft(oneList([card({ sourceLine: 99 })]))).draft.lists[0]!.cards[0]!.sourceLine).toBeNull();
    expect(parsed(draft(oneList([card({ labelKeys: ['l1', 'zzz', 'l1'] })]))).draft.lists[0]!.cards[0]!.labelKeys).toEqual(['l1']);

    const nums = parsed(
      draft(oneList([card({ startOffsetDays: 500, durationDays: 3.6 }), card({ startOffsetDays: -5, durationDays: 'abc' }), card({ startOffsetDays: '3', durationDays: '2' })]))
    ).draft.lists[0]!.cards.map((c) => [c.startOffsetDays, c.durationDays]);
    expect(nums).toEqual([[365, 4], [null, null], [3, 2]]);

    const lower = parsed(draft({ lineVerdicts: verdicts(5, 'task') })).draft.lineVerdicts;
    expect(lower.every((v) => v.verdict === 'TASK')).toBe(true);

    const messy = parsed(
      draft({
        lists: [
          { name: 'Rong', cards: [] },
          { name: 'Co the hong', cards: [{ title: '   ' }, 'chuoi la', null, card()] },
          { cards: [card({ title: 'Ten list thieu' })] },
        ],
      })
    ).draft;
    expect(messy.lists.map((l) => l.name)).toEqual(['Co the hong', 'Danh sách 3']);

    const many = parsed(draft(oneList(Array.from({ length: 30 }, (_, i) => card({ title: `T${i}` }))))).draft;
    expect(many.lists[0]!.cards).toHaveLength(25); // cat theo thu tu: giu 25 the dau
    expect(many.lists[0]!.cards[24]!.title).toBe('T24');
    expect(parsed(draft({ lists: Array.from({ length: 12 }, (_, i) => ({ name: `L${i}`, cards: [card()] })) })).draft.lists).toHaveLength(8);
  });

  it('sua nhe CHI sua hinh dang, khong quyet chinh sach: the khong co sourceLine van con o che do STRUCTURED (viec cua buoc hop nhat)', () => {
    const r = parsed(draft(oneList([card({ sourceLine: 0 }), card({ sourceLine: 3 })])), { lineCount: 5, mode: 'STRUCTURED' });
    expect(r.strictParseOk).toBe(true); // sourceLine 0 la "khong co" hop le
    expect(r.draft.lists[0]!.cards.map((c) => c.sourceLine)).toEqual([null, 3]);
  });

  it('khong sua dau vao (object dong bang khong lam nem loi) va ket qua tat dinh', () => {
    const raw = deepFreeze(JSON.parse(JSON.stringify(draft(oneList([card({ title: 'y'.repeat(300), sourceLine: 99 })])))));
    const a = parseLlmDraft(raw, ctx);
    const b = parseLlmDraft(raw, ctx);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
  });
});

// ===================== BoardPlan =====================

describe('boardPlanSchema: kiem lai TOAN BO ke hoach khi tao bang (khong tin client)', () => {
  const plan = (over: Record<string, unknown> = {}): unknown => ({
    mode: 'FREEFORM',
    board: { name: 'Khoa luan', color: '#0079BF' },
    labels: [{ key: 'l1', name: 'Gap', color: '#f87168' }],
    lists: [{ name: 'Viec', cards: [planCard({ labelKeys: ['l1'] })] }],
    warnings: [],
    assumptions: [],
    ...over,
  });
  const oneListPlan = (cards: unknown[], over: Record<string, unknown> = {}) => plan({ lists: [{ name: 'V', cards }], ...over });
  const paths = (p: unknown) => {
    const r = boardPlanSchema.safeParse(p);
    return r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
  };
  const many = (n: number) => Array.from({ length: n }, (_, i) => planCard({ ref: `c${i}` }));

  it('28 ca hop le / bi tu choi, kem DUNG duong dan cua loi (khong sinh loi thua)', () => {
    const rows: Array<[string, unknown, string[]]> = [
      ['hop le', plan(), []],
      ['ref trung', oneListPlan([planCard(), planCard({ title: 'B' })]), ['lists.0.cards.1.ref']],
      ['labelKey chua khai bao', oneListPlan([planCard({ labelKeys: ['zzz'] })]), ['lists.0.cards.0.labelKeys.0']],
      ['co ngay ma nguon NONE', oneListPlan([planCard({ dueOrigin: 'NONE' })]), ['lists.0.cards.0.dueOrigin']],
      ['khong co ngay ma nguon EXPLICIT', oneListPlan([planCard({ dueDate: null, dueOrigin: 'EXPLICIT' })]), ['lists.0.cards.0.dueOrigin']],
      ['khong co ngay bat dau ma nguon SCHEDULED', oneListPlan([planCard({ startDate: null })]), ['lists.0.cards.0.startOrigin']],
      ['bat dau sau han chot', oneListPlan([planCard({ startDate: '2026-09-20' })]), ['lists.0.cards.0.startDate']],
      ['bat dau bang han chot (cho phep)', oneListPlan([planCard({ startDate: '2026-09-18' })]), []],
      ['ngay khong ton tai 2026-02-30 (chi 1 loi, khong loi "bat dau sau han" thua)', oneListPlan([planCard({ dueDate: '2026-02-30' })]), ['lists.0.cards.0.dueDate']],
      ['ngay sai dang 14/09/2026', oneListPlan([planCard({ dueDate: '14/09/2026' })]), ['lists.0.cards.0.dueDate']],
      ['mau bang ngoai bang mau', plan({ board: { name: 'B', color: '#123456' } }), ['board.color']],
      ['mau bang dung ma nhung sai hoa/thuong', plan({ board: { name: 'B', color: '#0079bf' } }), ['board.color']],
      ['mau nhan ngoai bang mau', plan({ labels: [{ key: 'l1', name: 'G', color: '#123456' }] }), ['labels.0.color']],
      ['truong la o goc (stats)', plan({ stats: { totalCards: 999 } }), ['']],
      ['truong la o the (userId)', oneListPlan([planCard({ userId: 'u1' })]), ['lists.0.cards.0']],
      ['26 the o che do FREEFORM', oneListPlan(many(26)), ['lists']],
      ['26 the o che do STRUCTURED', oneListPlan(many(26), { mode: 'STRUCTURED' }), []],
      ['201 the o che do STRUCTURED', oneListPlan(many(201), { mode: 'STRUCTURED' }), ['lists']],
      ['0 danh sach', plan({ lists: [] }), ['lists']],
      ['1 danh sach 0 the (cho phep - minLists la 1, khong phai 2)', oneListPlan([]), []],
      ['9 danh sach o che do FREEFORM', plan({ lists: Array.from({ length: 9 }, (_, i) => ({ name: `L${i}`, cards: [] })) }), ['lists']],
      ['tieu de 501 ky tu', oneListPlan([planCard({ title: 'x'.repeat(501) })]), ['lists.0.cards.0.title']],
      ['checklist 11 muc', oneListPlan([planCard({ checklist: Array.from({ length: 11 }, () => 'x') })]), ['lists.0.cards.0.checklist']],
      ['sourceLine 0 (phai >= 1 hoac null)', oneListPlan([planCard({ sourceLine: 0 })]), ['lists.0.cards.0.sourceLine']],
      ['sourceLine null (the AI tu them)', oneListPlan([planCard({ sourceLine: null })]), []],
      ['nhan trung khoa', plan({ labels: [{ key: 'l1', name: 'A', color: '#f87168' }, { key: 'l1', name: 'B', color: '#f5cd47' }] }), ['labels.1.key']],
      ['ten bang chi co khoang trang', plan({ board: { name: '  ', color: '#0079BF' } }), ['board.name']],
      ['ma canh bao ngoai tap dong', plan({ warnings: [{ code: 'KHONG_CO', message: 'x' }] }), ['warnings.0.code']],
    ];
    const wrong = rows
      .map(([name, p, want]) => ({ name, want, got: paths(p) }))
      .filter((r) => JSON.stringify(r.want) !== JSON.stringify(r.got));
    expect(wrong).toEqual([]);
  });

  it('thong bao loi cua cac rang buoc cheo noi ro nguyen nhan; tu dong cat khoang trang; canh bao hop le', () => {
    const msg = (p: unknown) => {
      const r = boardPlanSchema.safeParse(p);
      return r.success ? '' : r.error.issues.map((i) => i.message).join(' | ');
    };
    expect(msg(oneListPlan([planCard({ dueOrigin: 'NONE' })]))).toMatch(/NONE/);
    expect(msg(oneListPlan([planCard({ startDate: '2026-09-20' })]))).toMatch(/bat dau sau han/i);
    expect(msg(oneListPlan([planCard(), planCard({ title: 'B' })]))).toMatch(/trung: c1/);
    expect(msg(oneListPlan([planCard({ labelKeys: ['zzz'] })]))).toMatch(/"zzz" chua duoc khai bao/);

    const ok = boardPlanSchema.parse(
      plan({
        lists: [{ name: '  Viec  ', cards: [planCard({ title: '  Tieu de  ' })] }],
        warnings: [{ code: 'DEFAULT_WINDOW', message: 'x', ref: 'c1' }],
      })
    ) as BoardPlan;
    expect([ok.lists[0]!.name, ok.lists[0]!.cards[0]!.title]).toEqual(['Viec', 'Tieu de']);
    expect(ok.warnings).toHaveLength(1);
  });
});

// ===================== JSON Schema viet tay <-> Zod =====================

type JsonNode = { type?: string; properties?: Record<string, JsonNode>; required?: string[]; items?: JsonNode; [k: string]: unknown };

describe('LLM_DRAFT_JSON_SCHEMA: viet tay, luon khop Zod va chi dung tu khoa an toan', () => {
  const ROOT_NODE = LLM_DRAFT_JSON_SCHEMA as unknown as JsonNode;

  /** Duyet moi nut schema, tra ve [duong dan, nut]. */
  function nodes(node: JsonNode, at = '$'): Array<[string, JsonNode]> {
    const out: Array<[string, JsonNode]> = [[at, node]];
    for (const [name, child] of Object.entries(node.properties ?? {})) out.push(...nodes(child, `${at}.${name}`));
    if (node.items) out.push(...nodes(node.items, `${at}[]`));
    return out;
  }
  const all = nodes(ROOT_NODE);

  it('tap truong tung cap = tap truong cua Zod (khong lech), va MOI truong deu "required"', () => {
    const zodKeys: Record<string, string[]> = {
      $: Object.keys(LLM_DRAFT_SHAPES.draft.shape),
      '$.board': Object.keys(LLM_SHAPES.board.shape),
      '$.labels[]': Object.keys(LLM_SHAPES.label.shape),
      '$.lists[]': Object.keys(LLM_DRAFT_SHAPES.list.shape),
      '$.lists.cards[]': Object.keys(LLM_SHAPES.card.shape), // "cards" la mang cua the
      '$.lineVerdicts[]': Object.keys(LLM_SHAPES.verdict.shape),
    };
    const lookup: Record<string, string> = {
      '$.lists[].cards[]': '$.lists.cards[]',
    };
    const wrong: string[] = [];
    let checked = 0;
    for (const [at, node] of all) {
      if (node.type !== 'object') continue;
      const key = lookup[at] ?? at;
      const zod = zodKeys[key];
      if (!zod) {
        wrong.push(`${at}: chua co doi chieu Zod`);
        continue;
      }
      checked += 1;
      const props = Object.keys(node.properties ?? {}).sort();
      if (JSON.stringify(props) !== JSON.stringify([...zod].sort())) wrong.push(`${at}: truong ${props} != Zod ${[...zod].sort()}`);
      if (JSON.stringify([...(node.required ?? [])].sort()) !== JSON.stringify(props)) wrong.push(`${at}: required khong liet ke du moi truong`);
      if (node.additionalProperties !== false) wrong.push(`${at}: thieu additionalProperties:false`);
    }
    expect(wrong).toEqual([]);
    expect(checked).toBe(6); // goc, board, labels[], lists[], cards[], lineVerdicts[]
  });

  it('chi dung "mau so chung nho nhat": khong $ref/$defs/oneOf/anyOf/allOf/pattern/format/minimum/default...', () => {
    const ALLOWED = new Set(['type', 'properties', 'required', 'items', 'enum', 'description', 'additionalProperties']);
    const used = new Set<string>();
    for (const [, node] of all) for (const k of Object.keys(node)) used.add(k);
    expect([...used].filter((k) => !ALLOWED.has(k))).toEqual([]);
    // chi 4 kieu don gian, khong co mang kieu ["integer","null"]
    const types = new Set(all.map(([, n]) => n.type));
    expect([...types].sort()).toEqual(['array', 'integer', 'object', 'string']);
    // co the tuan tu hoa qua lai (thuan JSON)
    expect(JSON.parse(JSON.stringify(LLM_DRAFT_JSON_SCHEMA))).toEqual(LLM_DRAFT_JSON_SCHEMA);
  });

  it('LLM KHONG CO O de dien ngay tuyet doi / id / userId / ma mau hex / email (rang buoc bang cau truc)', () => {
    const FORBIDDEN = ['dueDate', 'startDate', 'date', 'id', 'userId', 'boardId', 'cardId', 'color', 'hex', 'email', 'assignee', 'assigneeKeys', 'password', 'ref'];
    const names = new Set<string>();
    for (const [, node] of all) for (const k of Object.keys(node.properties ?? {})) names.add(k.toLowerCase());
    expect(FORBIDDEN.filter((f) => names.has(f.toLowerCase()))).toEqual([]);
    // va Zod cung the: gui cac truong do thi bi bo, khong bao gio den duoc DB
    const out = parsed(draft(oneList([{ ...card(), ...Object.fromEntries(FORBIDDEN.map((f) => [f, 'x'])) }]))).draft;
    expect(Object.keys(out.lists[0]!.cards[0]!)).not.toEqual(expect.arrayContaining(['dueDate']));
    expect(FORBIDDEN.filter((f) => f in out.lists[0]!.cards[0]!)).toEqual([]);
  });
});

// ===================== Ghep cac manh: LlmDraft -> rai lich -> BoardPlan =====================

describe('ghep cac manh cua buoc 3: LlmDraft -> scheduleCards -> BoardPlan hop le', () => {
  it('vi du Marketing: sua nhe, rai lich, ghep thanh BoardPlan roi qua Zod (chuan bi cho buoc 4)', () => {
    const TODAY = '2026-09-14';
    // "Dau ra cua LLM" viet tay: co loi nhe (tieu de qua dai, thieu verdict 1 dong, sourceLine sai)
    const raw = {
      board: { name: 'Ra mat san pham Q4', colorKey: 1 },
      labels: [{ key: 'l1', name: 'Truyen thong', colorKey: 5 }],
      lists: [
        {
          name: 'Chuan bi',
          cards: [
            { title: 'Chot thong diep chien dich', sourceLine: 1, labelKeys: ['l1'], startOffsetDays: 0, durationDays: 3, checklist: ['Hop nhom', 'Chot slogan'] },
            { title: 'x'.repeat(200), sourceLine: 2, startOffsetDays: 3, durationDays: 5 },
          ],
        },
        { name: 'Trien khai', cards: [{ title: 'Chay quang cao', sourceLine: 99 }] },
      ],
      lineVerdicts: verdicts(3),
    };
    const r = parsed(raw, { lineCount: 4, mode: 'FREEFORM' });
    expect(r.strictParseOk).toBe(false);
    expect(r.repairs.map((x) => x.code).sort()).toEqual(['SOURCE_LINE_INVALID', 'TEXT_TRUNCATED']);

    const flat = r.draft.lists.flatMap((l) => l.cards);
    const inputs: ScheduleInput[] = flat.map((c) => ({
      startDate: null,
      dueDate: null,
      startOffsetDays: c.startOffsetDays,
      durationDays: c.durationDays,
    }));
    const sched = scheduleCards(inputs, { today: TODAY, end: '2026-10-30' });
    expect(sched.warnings).toEqual([]);

    let n = 0;
    const plan = {
      mode: 'FREEFORM' as const,
      board: { name: r.draft.board.name, color: boardColorFromKey(r.draft.board.colorKey) },
      labels: r.draft.labels.map((l) => ({ key: l.key, name: l.name, color: labelColorFromKey(l.colorKey) })),
      lists: r.draft.lists.map((l) => ({
        name: l.name,
        cards: l.cards.map((c) => {
          const s = sched.cards[n]!;
          n += 1;
          return {
            ref: `c${n}`,
            title: c.title,
            description: c.description,
            sourceLine: c.sourceLine,
            selected: true,
            ...s,
            labelKeys: c.labelKeys,
            checklist: c.checklist,
          };
        }),
      })),
      // moi ma canh bao cua bo rai lich phai nam trong tap dong WARNING_CODES
      warnings: sched.warnings.map((w) => ({ code: w.code, message: w.message })),
      assumptions: [],
    };
    const check = boardPlanSchema.safeParse(plan);
    expect(check.success).toBe(true);
    const dates = plan.lists.flatMap((l) => l.cards.map((c) => `${c.startDate}..${c.dueDate}`));
    expect(dates).toEqual(['2026-09-14..2026-09-16', '2026-09-17..2026-09-23', '2026-09-14..2026-10-30']);
    expect(plan.lists[0]!.cards[1]!.title).toHaveLength(120);
    expect(plan.lists[1]!.cards[0]!.sourceLine).toBeNull(); // sourceLine 99 -> null: chinh sach xu ly o buoc 4
  });

  it('moi ma canh bao ma bo rai lich co the phat ra deu thuoc tap WARNING_CODES', () => {
    const blank = (): ScheduleInput => ({ startDate: null, dueDate: null, startOffsetDays: null, durationDays: null });
    const emitted = new Set<string>();
    const scenarios: Array<[ScheduleInput[], Parameters<typeof scheduleCards>[1]]> = [
      [[blank()], { today: '2026-09-14' }], // DEFAULT_WINDOW
      [[blank()], { today: '2026-09-14', end: '2026-09-10' }], // DEADLINE_IN_PAST
      [[blank()], { today: '2026-09-14', start: '2026-09-19', end: '2026-09-20' }], // WINDOW_TOO_SHORT
      [[{ ...blank(), startOffsetDays: 50, durationDays: 5 }], { today: '2026-09-14', end: addDays('2026-09-14', 10) }], // OFFSET_CLAMPED
    ];
    for (const [cards, opts] of scenarios) for (const w of scheduleCards(cards, opts).warnings) emitted.add(w.code);
    expect([...emitted].sort()).toEqual(['DEADLINE_IN_PAST', 'DEFAULT_WINDOW', 'OFFSET_CLAMPED', 'WINDOW_TOO_SHORT']);
    expect([...emitted].every((c) => (WARNING_CODES as readonly string[]).includes(c))).toBe(true);
  });
});

// ===================== Ky luat ma nguon =====================

describe('ky luat ma nguon cua 2 file moi', () => {
  const ROOT = path.resolve(__dirname, '../src/modules/ai');
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  for (const file of ['ai.schedule.ts', 'boardPlan.schema.ts']) {
    it(`${file}: khong ghep chuoi vao regex, khong regex "khop moi ky tu", khong dung gio dia phuong, khong doc dong ho`, () => {
      const src = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
      expect(src).not.toMatch(/\bRegExp\s*\(/);
      expect(src).not.toContain('.*');
      expect(src).not.toContain('.+');
      expect(src).not.toMatch(/\.(get|set)(Date|Day|Month|FullYear|Hours|Minutes|Seconds|Milliseconds|TimezoneOffset)\s*\(/);
      expect(src).not.toMatch(/toLocale\w*String/);
      expect(src).not.toMatch(/Date\.now\s*\(/);
      expect(src).not.toMatch(/new\s+Date\s*\(/); // khong tu tao Date: moi tinh toan qua ai.dates.ts
    });
  }
});
