import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { detectMode, splitLines } from '../src/modules/ai/ai.rules';
import type { LlmResult } from '../src/modules/ai/ai.llm';
import { buildLlmMessages } from '../src/modules/ai/ai.prompt';
import { generatePlan, type AiConfig } from '../src/modules/ai/ai.service';
import {
  callJsonLlm,
  hybridMessages,
  llmOnlyMessages,
  parseLlmOnly,
  runHybrid,
  runLlmOnly,
  runRule,
} from '../src/scripts/evalArms';
import { cacheKey, cacheRead, cacheWrite, isCacheable } from '../src/scripts/evalCache';
import { DATASET, DATASET_TODAY, sampleText, type DatasetSample } from '../src/scripts/evalDataset';
import {
  fmt,
  fmtPct,
  mdTable,
  metricsOf,
  modeAt,
  percentile,
  scoreRun,
  summarizeLlm,
  sumScores,
  type CardOut,
  type LlmObs,
  type ModeRow,
  type RunScore,
} from '../src/scripts/evalMetrics';
import { buildReport, MODE_THRESHOLDS_SWEEP, type ReportMeta, type RunRow } from '../src/scripts/evalReport';
import { makeUser } from './helpers';

// Buoc 10: cham diem + bao cao + ba nhanh. KHONG ra mang that: moi ca LLM dung fetch gia.

afterEach(() => {
  vi.unstubAllGlobals();
});

const byId = (id: string): DatasetSample => DATASET.find((s) => s.id === id)!;

// ===================== scoreRun =====================

// dong: 1 tieu de | 2 viec co han | 3 viec co khoang ngay | 4 viec khong ngay | 5 ghi chu
const SAMPLE: DatasetSample = {
  id: 'X01',
  group: 'STRUCTURED',
  goldMode: 'STRUCTURED',
  note: 'mau tong hop de test cham diem',
  projectStart: '2026-10-01',
  projectEnd: '2026-10-31',
  lines: [
    { t: '# Tieu de', task: false },
    { t: '- a han 05/10', task: true, due: '2026-10-05' },
    { t: '- b tu 06/10 den 08/10', task: true, start: '2026-10-06', due: '2026-10-08' },
    { t: '- c', task: true },
    { t: 'Ghi chu', task: false },
  ],
};
const card = (sourceLine: number | null, over: Partial<CardOut> = {}): CardOut => ({
  sourceLine,
  startDate: null,
  dueDate: null,
  startOrigin: 'NONE',
  dueOrigin: 'NONE',
  selected: true,
  ...over,
});
const exp = (due: string, start: string | null = null): Partial<CardOut> => ({
  dueDate: due,
  dueOrigin: 'EXPLICIT',
  startDate: start,
  startOrigin: start === null ? 'NONE' : 'EXPLICIT',
});

describe('scoreRun: muc dong, ngay, ngay xau', () => {
  it('ke hoach hoan hao: 3 viec that, 2 dong co ngay vang deu trung, khong the thua/ngay xau', () => {
    const s = scoreRun(SAMPLE, [card(2, exp('2026-10-05')), card(3, exp('2026-10-08', '2026-10-06')), card(4)]);
    expect(s).toEqual({
      cards: 3, tp: 3, fp: 0, fn: 0, matchedCards: 3,
      goldDated: 2, dateHits: 2, explicitLines: 2, explicitHits: 2, datedCards: 2, badDates: 0,
    });
  });

  it('dong khong phai viec / the bia dat (khong dong nguon, dong 0, ngoai pham vi) la FP; the KHONG chon bi bo qua; viec khong co the la FN', () => {
    // Moi loai "bia" co HAI the: neu bi coi nhu "mot dong la" thi hai the chi tinh 1 FP.
    const s = scoreRun(SAMPLE, [
      card(1), // tieu de -> FP
      card(5), // ghi chu -> FP
      card(null), card(null), // AI tu them -> 2 FP (bia)
      card(99), card(99), // ngoai pham vi -> 2 FP
      card(0), card(0), // dong 0 -> 2 FP
      card(1.5), card(1.5), // khong nguyen -> 2 FP
      card(4, { selected: false }), // KHONG chon -> nhu khong co the
      card(2),
    ]);
    expect(s).toMatchObject({ cards: 11, tp: 1, fp: 10, fn: 2, matchedCards: 1 });
  });

  it('bien so dong: dong 1 va dong cuoi la dong hop le (viec that o dong dau/cuoi van tinh TP); ngay sau dong cuoi la bia', () => {
    expect(scoreRun(byId('F08'), [card(1)])).toMatchObject({ tp: 1, fp: 0, fn: 2 }); // F08 dong 1 la viec
    expect(scoreRun(byId('S06'), [card(7)])).toMatchObject({ tp: 1, fp: 0, fn: 5 }); // S06 co 7 dong, dong 7 la viec
    expect(scoreRun(byId('S06'), [card(8), card(8)])).toMatchObject({ tp: 0, fp: 2, fn: 6 });
  });

  it('nhieu the tren cung mot dong chi tinh 1 dong dung (khong bi phat) nhung the/dong tang', () => {
    const s = scoreRun(SAMPLE, [card(3), card(3), card(2)]);
    expect(s).toMatchObject({ cards: 3, tp: 2, fp: 0, fn: 1, matchedCards: 3 });
    expect(metricsOf(s).cardsPerLine).toBe(1.5);
  });

  it('ngay ghi ro: phai dung DUNG han, va dung ca bat dau neu nhan vang co; sai/thieu = khong trung; nhieu the chi can 1 the dung', () => {
    const wrongDue = scoreRun(SAMPLE, [card(2, exp('2026-10-06'))]);
    expect(wrongDue).toMatchObject({ goldDated: 2, dateHits: 0, explicitLines: 1, explicitHits: 0 });
    const missingStart = scoreRun(SAMPLE, [card(3, exp('2026-10-08'))]);
    expect(missingStart.dateHits).toBe(0);
    const wrongStart = scoreRun(SAMPLE, [card(3, exp('2026-10-08', '2026-10-07'))]);
    expect(wrongStart.dateHits).toBe(0);
    const rightStart = scoreRun(SAMPLE, [card(3, exp('2026-10-08', '2026-10-06'))]);
    expect(rightStart.dateHits).toBe(1);
    const oneOfTwo = scoreRun(SAMPLE, [card(2, exp('2026-10-01')), card(2, exp('2026-10-05'))]);
    expect(oneOfTwo).toMatchObject({ dateHits: 1, explicitLines: 1, explicitHits: 1 });
    // dong co ngay vang nhung the KHONG o dong do -> khong trung
    expect(scoreRun(SAMPLE, [card(4, exp('2026-10-05'))]).dateHits).toBe(0);
  });

  it('EXPLICIT tren dong khong co ngay vang la SAI (ngay thua); ngay SCHEDULED thi khong tinh la ghi ro', () => {
    const spurious = scoreRun(SAMPLE, [card(4, exp('2026-10-09'))]);
    expect(spurious).toMatchObject({ explicitLines: 1, explicitHits: 0, dateHits: 0 });
    const scheduled = scoreRun(SAMPLE, [card(4, { dueDate: '2026-10-09', dueOrigin: 'SCHEDULED' })]);
    expect(scheduled).toMatchObject({ explicitLines: 0, explicitHits: 0, datedCards: 1, badDates: 0 });
    // chi startOrigin la EXPLICIT cung tinh
    const startOnly = scoreRun(SAMPLE, [card(3, { startDate: '2026-10-06', startOrigin: 'EXPLICIT', dueDate: '2026-10-08', dueOrigin: 'SCHEDULED' })]);
    expect(startOnly).toMatchObject({ explicitLines: 1, explicitHits: 1, dateHits: 1 });
  });

  it('ngay xau: khong phai ngay that, bat dau sau han, ngay SCHEDULED ngoai khoang du an (ngay EXPLICIT ngoai khoang thi hop le)', () => {
    const cards: CardOut[] = [
      card(2, exp('2026-02-30')), // khong co that -> xau
      card(2, { startDate: '2026-10-09', startOrigin: 'SCHEDULED', dueDate: '2026-10-08', dueOrigin: 'SCHEDULED' }), // start > due
      card(2, { dueDate: '2026-11-02', dueOrigin: 'SCHEDULED' }), // sau khoang -> xau
      card(2, { startDate: '2026-09-30', startOrigin: 'SCHEDULED' }), // truoc khoang -> xau
      card(2, exp('2026-11-02')), // EXPLICIT ngoai khoang -> hop le
      card(2, { dueDate: '2026-10-10', dueOrigin: 'SCHEDULED' }), // trong khoang -> hop le
      card(2), // khong ngay -> khong tinh
    ];
    expect(scoreRun(SAMPLE, cards)).toMatchObject({ cards: 7, datedCards: 6, badDates: 4 });
    // bien khoang: dung ngay dau/ngay cuoi la hop le
    const edge = scoreRun(SAMPLE, [
      card(2, { startDate: '2026-10-01', startOrigin: 'SCHEDULED', dueDate: '2026-10-31', dueOrigin: 'SCHEDULED' }),
    ]);
    expect(edge.badDates).toBe(0);
    // bat dau TRUNG ngay han (viec trong 1 ngay) la hop le
    const sameDay = scoreRun(SAMPLE, [card(2, { startDate: '2026-10-05', startOrigin: 'SCHEDULED', dueDate: '2026-10-05', dueOrigin: 'SCHEDULED' })]);
    expect(sameDay.badDates).toBe(0);
  });

  it('nhan vang chi co bat dau (hoac chi co han) van cham dung', () => {
    const only: DatasetSample = {
      ...SAMPLE,
      lines: [
        { t: '- chi bat dau', task: true, start: '2026-10-06' },
        { t: '- chi han', task: true, due: '2026-10-08' },
      ],
    };
    expect(scoreRun(only, [card(1, { startDate: '2026-10-06', startOrigin: 'EXPLICIT' })])).toMatchObject({ goldDated: 2, dateHits: 1 });
    expect(scoreRun(only, [card(1, { startDate: '2026-10-07', startOrigin: 'EXPLICIT' })])).toMatchObject({ dateHits: 0 });
    expect(scoreRun(only, [card(2, { dueDate: '2026-10-08', dueOrigin: 'EXPLICIT' })])).toMatchObject({ dateHits: 1 });
    expect(scoreRun(only, [card(2, { startDate: '2026-10-06', startOrigin: 'EXPLICIT' })])).toMatchObject({ dateHits: 0 }); // co start nhung nhan vang can due
    // ngay chi duoc tinh tren dong LA VIEC: dong khong phai viec ma (nhan nham) co ngay thi bo qua
    const noted: DatasetSample = { ...SAMPLE, lines: [{ t: 'ghi chu co ngay', task: false, due: '2026-10-05' }, { t: '- viec', task: true }] };
    expect(scoreRun(noted, [card(1, exp('2026-10-05')), card(2)])).toMatchObject({ goldDated: 0, dateHits: 0, explicitLines: 1, explicitHits: 0 });
  });

  it('khoang du an chi co mot dau thi chi kiem dau do; khong co khoang thi khong kiem', () => {
    const late = { dueDate: '2026-12-31', dueOrigin: 'SCHEDULED' as const };
    const early = { startDate: '2026-09-30', startOrigin: 'SCHEDULED' as const };
    const onlyStart = { ...SAMPLE, projectEnd: undefined };
    expect(scoreRun(onlyStart, [card(2, late)]).badDates).toBe(0);
    expect(scoreRun(onlyStart, [card(2, early)]).badDates).toBe(1);
    const onlyEnd = { ...SAMPLE, projectStart: undefined };
    expect(scoreRun(onlyEnd, [card(2, early)]).badDates).toBe(0);
    expect(scoreRun(onlyEnd, [card(2, late)]).badDates).toBe(1);
    const none = { ...SAMPLE, projectStart: undefined, projectEnd: undefined };
    expect(scoreRun(none, [card(2, late), card(2, early)]).badDates).toBe(0);
  });
});

// ===================== sumScores / metricsOf =====================

const SCORE_A: RunScore = { cards: 1, tp: 2, fp: 3, fn: 4, matchedCards: 5, goldDated: 6, dateHits: 7, explicitLines: 8, explicitHits: 9, datedCards: 10, badDates: 11 };
const SCORE_B: RunScore = { cards: 100, tp: 200, fp: 300, fn: 400, matchedCards: 500, goldDated: 600, dateHits: 700, explicitLines: 800, explicitHits: 900, datedCards: 1000, badDates: 1100 };

describe('sumScores / metricsOf', () => {
  it('cong tung truong (moi truong mot gia tri khac nhau de khong nham); rong -> toan 0', () => {
    expect(sumScores([SCORE_A, SCORE_B])).toEqual({
      cards: 101, tp: 202, fp: 303, fn: 404, matchedCards: 505, goldDated: 606, dateHits: 707, explicitLines: 808, explicitHits: 909, datedCards: 1010, badDates: 1111,
    });
    expect(sumScores([]).tp).toBe(0);
    expect(SCORE_A.tp).toBe(2); // khong sua dau vao
  });

  it('cong thuc: precision = tp/(tp+fp), recall = tp/(tp+fn), F1 dieu hoa, cac ty le khac dung mau so', () => {
    const m = metricsOf({ cards: 9, tp: 3, fp: 1, fn: 2, matchedCards: 6, goldDated: 4, dateHits: 3, explicitLines: 5, explicitHits: 2, datedCards: 8, badDates: 2 });
    expect(m.precision).toBe(0.75);
    expect(m.recall).toBe(0.6);
    expect(m.f1).toBeCloseTo((2 * 0.75 * 0.6) / (0.75 + 0.6), 10);
    expect(m.cardsPerLine).toBe(2);
    expect(m.dateRecall).toBe(0.75);
    expect(m.explicitPrecision).toBe(0.4);
    expect(m.badDateRate).toBe(0.25);
  });

  it('mau so 0 -> null (khong NaN); tp = 0 nhung co fp/fn -> F1 = 0', () => {
    const empty = metricsOf(sumScores([]));
    expect(Object.values(empty)).toEqual([null, null, null, null, null, null, null]);
    const zero = metricsOf({ ...sumScores([]), fp: 2, fn: 3 });
    expect(zero).toMatchObject({ precision: 0, recall: 0, f1: 0, cardsPerLine: null });
    // chi co fn: precision khong xac dinh nhung recall = 0 -> F1 khong xac dinh
    expect(metricsOf({ ...sumScores([]), fn: 3 })).toMatchObject({ precision: null, recall: 0, f1: null });
  });
});

// ===================== modeAt =====================

describe('modeAt: cung cong thuc voi detectMode', () => {
  const rows: ModeRow[] = [
    { id: 'a', group: 'S', goldMode: 'STRUCTURED', structuredRatio: 0.4, contentLines: 5 },
    { id: 'b', group: 'F', goldMode: 'FREEFORM', structuredRatio: 0.39, contentLines: 5 },
    { id: 'c', group: 'F', goldMode: 'FREEFORM', structuredRatio: 1, contentLines: 2 },
  ];
  it('bang nguong tinh la STRUCTURED (>=); qua it dong -> luon FREEFORM; liet ke mau sai', () => {
    expect(modeAt(rows, 0.4)).toEqual({ correct: 3, total: 3, accuracy: 1, wrong: [] });
    const strict = modeAt(rows, 0.41);
    expect(strict.wrong).toEqual(['a']);
    expect(strict.accuracy).toBeCloseTo(2 / 3, 10);
    expect(modeAt(rows, 0.3).wrong).toEqual(['b']);
    expect(modeAt(rows, 0.4).wrong).not.toContain('c'); // c chi 2 dong (< 3) -> FREEFORM dung
    expect(modeAt(rows, 0.4, 2).wrong).toEqual(['c']); // ha muc toi thieu xuong 2 -> c thanh STRUCTURED (sai); b van FREEFORM (0,39 < 0,4)
    expect(modeAt([], 0.4).accuracy).toBeNull();
  });

  it('tren toan bo bo du lieu: cho dung cung ket qua voi detectMode that o moi nguong quet', () => {
    const modeRows: ModeRow[] = DATASET.map((s) => {
      const lines = splitLines(sampleText(s));
      return { id: s.id, group: s.group, goldMode: s.goldMode, structuredRatio: detectMode(lines).structuredRatio, contentLines: lines.length };
    });
    for (const t of MODE_THRESHOLDS_SWEEP) {
      const expectedWrong = DATASET.filter((s) => detectMode(splitLines(sampleText(s)), { minContentLines: 3, structuredRatio: t }).mode !== s.goldMode).map((s) => s.id);
      expect(modeAt(modeRows, t).wrong, `nguong ${t}`).toEqual(expectedWrong);
    }
  });
});

// ===================== percentile / summarizeLlm =====================

const obs = (over: Partial<LlmObs> = {}): LlmObs => ({
  ok: true, reason: null, formatMode: 'json_schema', latencyMs: 1000, promptTokens: 100, completionTokens: 50,
  strictParseOk: true, verdictLines: 10, lineCount: 10, proposedCards: 8, droppedCards: 0, draftUsed: true, ...over,
});

describe('percentile / summarizeLlm', () => {
  it('nearest-rank: p50 cua 2 gia tri la gia tri nho; p95 la lon; rong -> null; khong sua mang goc', () => {
    expect(percentile([30, 10, 20], 50)).toBe(20);
    expect(percentile([10, 20], 50)).toBe(10);
    expect(percentile([10, 20], 95)).toBe(20);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 90)).toBe(9);
    expect(percentile([7], 0)).toBe(7);
    expect(percentile([], 50)).toBeNull();
    const src = [3, 1, 2];
    percentile(src, 50);
    expect(src).toEqual([3, 1, 2]);
  });

  it('gop chi so lop LLM: ti le thanh cong, hop le lan dau, phu verdict (chan o 1), bi loai, dung ban nhap, do tre/token cua lan OK, lich su loi/muc ep JSON', () => {
    const s = summarizeLlm([
      obs({ latencyMs: 1000, promptTokens: 100, completionTokens: 40 }),
      obs({ latencyMs: 3000, promptTokens: 200, completionTokens: 60, strictParseOk: false, verdictLines: 5, formatMode: 'json_object', proposedCards: 4, droppedCards: 2 }),
      // lan OK nhung nha cung cap khong tra token: khong duoc keo trung binh ve 0
      // (reason chi co nghia o lan THAT BAI: 'IGNORED' o day khong duoc dem vao ly do loi)
      obs({ reason: 'IGNORED', latencyMs: 2000, promptTokens: null, completionTokens: null, strictParseOk: true, verdictLines: null, proposedCards: null, droppedCards: null, formatMode: 'none' }),
      obs({ ok: false, reason: 'TIMEOUT', formatMode: null, latencyMs: 9999, promptTokens: null, completionTokens: null, strictParseOk: null, verdictLines: null, proposedCards: null, droppedCards: null, draftUsed: false }),
      obs({ ok: false, reason: 'HTTP_5XX', latencyMs: 50, strictParseOk: null, verdictLines: null, proposedCards: null, droppedCards: null, draftUsed: false }),
      obs({ ok: false, reason: 'TIMEOUT', latencyMs: 60, strictParseOk: null, verdictLines: null, proposedCards: null, droppedCards: null, draftUsed: false }),
    ]);
    expect(s.calls).toBe(6);
    expect(s.okRate).toBe(3 / 6);
    expect(s.strictRate).toBe(2 / 3); // 2 trong 3 lan ok (true, false, true)
    expect(s.verdictCoverage).toBeCloseTo((1 + 0.5) / 2, 10);
    expect(s.droppedRate).toBeCloseTo(2 / (8 + 4), 10);
    expect(s.draftUsedRate).toBe(3 / 6);
    expect(s.latencyP50).toBe(2000);
    expect(s.latencyP95).toBe(3000);
    expect(s.promptTokensMean).toBe(150);
    expect(s.completionTokensMean).toBe(50);
    expect(s.failReasons).toEqual({ TIMEOUT: 2, HTTP_5XX: 1 });
    expect(s.formatModes).toEqual({ json_schema: 1, json_object: 1, none: 1 });
  });

  it('nhanh khong co strictParseOk/verdict/draftUsed (llm-only) -> cac ty le do la null; phu verdict > 1 bi chan o 1', () => {
    const s = summarizeLlm([obs({ strictParseOk: null, verdictLines: null, draftUsed: null, proposedCards: null, droppedCards: null })]);
    expect(s).toMatchObject({ okRate: 1, strictRate: null, verdictCoverage: null, droppedRate: null, draftUsedRate: null });
    expect(summarizeLlm([obs({ verdictLines: 30, lineCount: 10 })]).verdictCoverage).toBe(1);
    expect(summarizeLlm([])).toMatchObject({ calls: 0, okRate: null, strictRate: null, verdictCoverage: null, droppedRate: null, draftUsedRate: null, latencyP50: null, latencyP95: null, promptTokensMean: null, completionTokensMean: null, failReasons: {}, formatModes: {} });
  });
});

// ===================== dinh dang =====================

describe('dinh dang so va bang', () => {
  it('so kieu Viet (dau phay), null -> gach; phan tram 1 chu so; bang markdown', () => {
    expect(fmt(0.756)).toBe('0,76');
    expect(fmt(0.756, 3)).toBe('0,756');
    expect(fmt(null)).toBe('–');
    expect(fmtPct(0.8857)).toBe('88,6%');
    expect(fmtPct(1)).toBe('100,0%');
    expect(fmtPct(null)).toBe('–');
    expect(mdTable(['A', 'B'], [[1, null], ['x', 'y']])).toBe('| A | B |\n|---|---|\n| 1 | – |\n| x | y |');
  });
});

// ===================== buildReport =====================

const META: ReportMeta = {
  date: '2026-09-20', today: '2026-09-19', provider: 'google-gemini', model: 'gemini-x', runs: 2, sampleCount: 25, apiCalls: 7, cacheHits: 3, aborted: null,
};
const SCORE_R: RunScore = { cards: 4, tp: 3, fp: 1, fn: 0, matchedCards: 3, goldDated: 2, dateHits: 1, explicitLines: 2, explicitHits: 1, datedCards: 4, badDates: 1 };
const MODE_ROWS: ModeRow[] = [
  { id: 'a', group: 'S', goldMode: 'STRUCTURED', structuredRatio: 0.5, contentLines: 5 },
  { id: 'b', group: 'F', goldMode: 'FREEFORM', structuredRatio: 0.3, contentLines: 5 },
];
const row = (arm: RunRow['arm'], group: RunRow['group'], run: number, score: RunScore, o: LlmObs | null = null, sampleId = 'S01'): RunRow => ({ arm, sampleId, group, run, score, obs: o });

describe('buildReport', () => {
  it('chi nhanh rule: co thong tin chung, bang che do, bang theo nhom voi con so dung, KHONG co so sanh va KHONG co lop AI', () => {
    const md = buildReport([row('rule', 'STRUCTURED', 1, SCORE_R)], META, MODE_ROWS);
    expect(md).toContain('# Kết quả đánh giá module AI');
    expect(md).toContain('Ngày chạy: 2026-09-20; ngày giả định của bộ mẫu: 2026-09-19');
    expect(md).toContain('25 mẫu tự soạn, một người gán nhãn; số lần chạy mỗi mẫu: 2');
    expect(md).toContain('Nhà cung cấp AI: google-gemini / gemini-x');
    expect(md).toContain('Gọi API thật: 7; lấy từ cache: 3');
    expect(md).not.toContain('CHƯA ĐỦ');
    // bang che do: 5 nguong, nguong 0,3 chi dung 1/2 (b ratio 0.3 >= 0.3 -> STRUCTURED sai)
    expect(md).toContain('| 0,2 | 1/2 | 50,0% | b |');
    expect(md).toContain('| 0,3 | 1/2 | 50,0% | b |');
    expect(md).toContain('| 0,4 | 2/2 | 100,0% | – |');
    expect(md).toContain('| 0,5 | 2/2 | 100,0% | – |');
    expect(md).toContain('| 0,6 | 1/2 | 50,0% | a |');
    expect(md).toContain('### B0 chỉ bộ luật');
    expect(md).toContain('| STRUCTURED | 1 | 0,75 | 1,00 | 0,86 | 1,00 | 50,0% | 50,0% | 25,0% |');
    expect(md).toContain('| FREEFORM | 0 | – | – | – | – | – | – | – |');
    expect(md).toContain('| Tất cả | 1 | 0,75 | 1,00 | 0,86 | 1,00 | 50,0% | 50,0% | 25,0% |');
    expect(md).not.toContain('## So sánh các nhánh');
    expect(md).not.toContain('Lớp AI');
    expect(md).not.toContain('F1 giữa');
    expect(md).not.toContain('### B1'); // nhanh khong chay thi khong co muc
    expect(md).not.toContain('### B2');
  });

  it('nhieu nhanh: thu tu rule, llm-only, hybrid; co bang so sanh; co lop AI cho hai nhanh LLM; F1 giua cac lan chay', () => {
    const better: RunScore = { ...SCORE_R, tp: 4, fp: 0 }; // precision 1
    const md = buildReport(
      [
        row('hybrid', 'NOISY', 1, better, obs({ latencyMs: 1000 }), 'N01'),
        row('hybrid', 'NOISY', 2, SCORE_R, obs({ latencyMs: 3000, promptTokens: 101 }), 'N01'),
        row('llm-only', 'FREEFORM', 1, SCORE_R, obs({ strictParseOk: null, verdictLines: null, draftUsed: null }), 'F01'),
        row('rule', 'STRUCTURED', 1, SCORE_R),
      ],
      META,
      MODE_ROWS
    );
    const at = (s: string) => md.indexOf(s);
    expect(at('### B0 chỉ bộ luật')).toBeGreaterThan(0);
    expect(at('### B1 chỉ AI')).toBeGreaterThan(at('### B0 chỉ bộ luật'));
    expect(at('### B2 kết hợp (sản phẩm)')).toBeGreaterThan(at('### B1 chỉ AI'));
    expect(md).toContain('## So sánh các nhánh (gộp tất cả mẫu)');
    expect(md).toContain('### Lớp AI: B1 chỉ AI');
    expect(md).toContain('### Lớp AI: B2 kết hợp (sản phẩm)');
    expect(md).not.toContain('### Lớp AI: B0');
    // hybrid: 2 lan chay -> F1 nho nhat/lon nhat (lan 1: precision 1 recall 1 -> 1,000; lan 2: 0,857)
    expect(md).toContain('F1 giữa 2 lần chạy: nhỏ nhất 0,857, lớn nhất 1,000.');
    // do tre p50 = 1000, p95 = 3000
    expect(md).toContain('| Độ trễ p50 (ms) | 1000 |');
    expect(md).toContain('| Độ trễ p95 (ms) | 3000 |');
    expect(md).toContain('| Mức ép JSON được chấp nhận | json_schema: 2 |');
    expect(md).toContain('| Token vào trung bình | 101 |'); // (100 + 101) / 2 = 100,5 -> lam tron 101
    expect(md).toContain('| NOISY | 1 | 0,88 |'); // 2 lan chay cua CUNG 1 mau = 1 mau (khong phai 2); precision (4+3)/(4+3+0+1)
    expect(md).toContain('| Lý do thất bại | – |');
    // nhanh rule chi 1 lan -> khong co dong F1 giua cac lan
    expect(md.split('F1 giữa').length - 1).toBe(1);
  });

  it('bi dung giua chung (429) -> ghi ro CHUA DU; lich su loi xuat hien trong bang lop AI', () => {
    const failed = obs({ ok: false, reason: 'HTTP_5XX', strictParseOk: null, verdictLines: null, proposedCards: null, droppedCards: null, draftUsed: false });
    const md = buildReport([row('hybrid', 'NOISY', 1, SCORE_R, failed, 'N01')], { ...META, aborted: 'gặp HTTP 429 ở nhánh hybrid' }, MODE_ROWS);
    expect(md).toContain('- **CHƯA ĐỦ**: gặp HTTP 429 ở nhánh hybrid');
    expect(md).toContain('| Lý do thất bại | HTTP_5XX: 1 |');
    expect(md).toContain('| Gọi thành công và đọc được | 0,0% |');
  });
});

// ===================== Nhanh llm-only =====================

const okRes = (raw: unknown, over: Partial<Extract<LlmResult, { ok: true }>> = {}): LlmResult => ({
  ok: true, raw, promptTokens: 11, completionTokens: 22, latencyMs: 1234, formatMode: 'json_object', ...over,
});
const badRes = (reason: Extract<LlmResult, { ok: false }>['reason'], status: number | null = null): LlmResult => ({
  ok: false, reason, status, detail: 'x', latencyMs: 77, formatMode: 'none',
});

describe('parseLlmOnly / runLlmOnly', () => {
  it('doc dung the, ngay, nguon ngay; giu NGUYEN ngay sai dinh dang de bi tinh "ngay xau"; sourceLine sai -> null (bia)', () => {
    const cards = parseLlmOnly(
      {
        lists: [
          {
            name: 'A',
            cards: [
              { title: 'T1', sourceLine: 2, startDate: '2026-10-01', dueDate: '2026-10-05', dateOrigin: 'EXPLICIT' },
              { title: 'T2', sourceLine: 3, startDate: null, dueDate: '2026-02-30', dateOrigin: 'SCHEDULED' },
              { title: 'T3', sourceLine: 0, startDate: '', dueDate: '', dateOrigin: 'EXPLICIT' },
              { title: 'T4', sourceLine: 99, dueDate: '2026-10-09' },
              { title: 'T5', sourceLine: 1.5 },
              { title: '  ', sourceLine: 1 },
              { sourceLine: 1 },
              'khong phai the',
              { title: 'T8', sourceLine: 5 }, // dong cuoi (lineCount = 5) la hop le
              { title: 'T9', sourceLine: 1 }, // dong dau la hop le
            ],
          },
          { name: 'khong co cards' },
        ],
      },
      5
    );
    expect(cards).toEqual([
      { sourceLine: 2, startDate: '2026-10-01', dueDate: '2026-10-05', startOrigin: 'EXPLICIT', dueOrigin: 'EXPLICIT', selected: true },
      { sourceLine: 3, startDate: null, dueDate: '2026-02-30', startOrigin: 'NONE', dueOrigin: 'SCHEDULED', selected: true },
      { sourceLine: null, startDate: null, dueDate: null, startOrigin: 'NONE', dueOrigin: 'NONE', selected: true },
      { sourceLine: null, startDate: null, dueDate: '2026-10-09', startOrigin: 'NONE', dueOrigin: 'SCHEDULED', selected: true }, // thieu dateOrigin -> tu xep
      { sourceLine: null, startDate: null, dueDate: null, startOrigin: 'NONE', dueOrigin: 'NONE', selected: true },
      { sourceLine: 5, startDate: null, dueDate: null, startOrigin: 'NONE', dueOrigin: 'NONE', selected: true },
      { sourceLine: 1, startDate: null, dueDate: null, startOrigin: 'NONE', dueOrigin: 'NONE', selected: true },
    ]);
  });

  it('sai cau truc -> null; toi da 200 the', () => {
    expect(parseLlmOnly(null, 5)).toBeNull();
    expect(parseLlmOnly('x', 5)).toBeNull();
    expect(parseLlmOnly({}, 5)).toBeNull();
    expect(parseLlmOnly({ lists: 'x' }, 5)).toBeNull();
    const many = { lists: [{ cards: Array.from({ length: 250 }, (_, i) => ({ title: `T${i}`, sourceLine: 1 })) }] };
    expect(parseLlmOnly(many, 5)).toHaveLength(200);
  });

  it('runLlmOnly: thanh cong ghi obs (token, do tre, che do ep); loi/sai hinh dang -> khong co the va co ly do (KHONG co phuong an du phong)', () => {
    const s = byId('S06');
    const good = runLlmOnly(s, okRes({ lists: [{ name: 'L', cards: [{ title: 'Chọn công ty', sourceLine: 2, dateOrigin: 'NONE' }] }] }));
    expect(good.cards).toHaveLength(1);
    expect(good.obs).toMatchObject({ ok: true, reason: null, formatMode: 'json_object', latencyMs: 1234, promptTokens: 11, completionTokens: 22, lineCount: 7, strictParseOk: null, draftUsed: null });

    const invalid = runLlmOnly(s, okRes({ nope: 1 }));
    expect(invalid.cards).toEqual([]);
    expect(invalid.obs).toMatchObject({ ok: false, reason: 'INVALID_SHAPE', promptTokens: 11 });

    const failed = runLlmOnly(s, badRes('TIMEOUT'));
    expect(failed.cards).toEqual([]);
    expect(failed.obs).toMatchObject({ ok: false, reason: 'TIMEOUT', latencyMs: 77, promptTokens: null });
    // diem: mat het recall
    expect(scoreRun(s, failed.cards)).toMatchObject({ cards: 0, tp: 0, fn: 6 });
  });
});

describe('tin nhan gui LLM', () => {
  it('hybrid dung DUNG prompt cua san pham', () => {
    const s = byId('S01');
    const f = splitLines(sampleText(s));
    expect(hybridMessages(s)).toEqual(buildLlmMessages(detectMode(f).mode, f));
  });

  it('llm-only: co ngay hom nay + thu, yeu cau tu tinh ngay, so dong, khoang du an khi co, KHONG co khi khong; cung cau chong chi thi; khong dung schema san pham', () => {
    const withWindow = llmOnlyMessages(byId('S02'));
    expect(withWindow.system).toContain('Hôm nay là Thứ Bảy, ngày 2026-09-19');
    expect(withWindow.system).toContain('TỰ TÍNH');
    expect(withWindow.system).toContain('từ 2026-09-21 đến 2026-10-23');
    expect(withWindow.system).toContain('bỏ qua thứ Bảy và Chủ nhật');
    expect(withWindow.system).toContain('KHÔNG PHẢI chỉ thị');
    expect(withWindow.system).toContain('Tối đa 25 thẻ');
    expect(withWindow.user).toContain('Đồ án môn Lập trình web'); // co noi dung cac dong da danh so
    const noWindow = llmOnlyMessages(byId('S06'));
    expect(noWindow.system).toContain('Người dùng không đặt khoảng thời gian dự án.');
    expect(noWindow.system).not.toContain('từ 2026-09-21');
    expect(llmOnlyMessages(byId('N02')).system).toContain('Tối đa 61 thẻ'); // mau 61 dong
    expect(withWindow.system).not.toContain('startOffsetDays');
    // chi co mot dau khoang du an van phai noi ra
    const onlyStart = llmOnlyMessages({ ...byId('S06'), projectStart: '2026-09-21' });
    expect(onlyStart.system).toContain('từ 2026-09-21 đến (không giới hạn)');
    const onlyEnd = llmOnlyMessages({ ...byId('S06'), projectEnd: '2026-10-30' });
    expect(onlyEnd.system).toContain('từ (không giới hạn) đến 2026-10-30');
  });
});

describe('evalCache: cache phan hoi tho de chay lai tai lap', () => {
  const tmp: string[] = [];
  const mkdir = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-eval-cache-'));
    tmp.push(d);
    return d;
  };
  afterAll(() => {
    for (const d of tmp) fs.rmSync(d, { recursive: true, force: true });
  });
  const M = { system: 'he thong', user: 'nguoi dung' };
  const INFO = { arm: 'hybrid' as const, sampleId: 'S01', run: 1, baseUrl: 'https://a.test', model: 'm' };

  it('khoa: 32 ky tu hex, on dinh, doi khi doi BAT KY thanh phan nao; cong thuc giu nguyen (khong lam mat cache cu)', () => {
    const k = cacheKey('hybrid', 'https://a.test', 'm', 1, M);
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(cacheKey('hybrid', 'https://a.test', 'm', 1, { ...M })).toBe(k);
    expect(k).toBe(createHash('sha256').update(JSON.stringify({ arm: 'hybrid', baseUrl: 'https://a.test', model: 'm', run: 1, system: 'he thong', user: 'nguoi dung' })).digest('hex').slice(0, 32));
    const others = [
      cacheKey('llm-only', 'https://a.test', 'm', 1, M),
      cacheKey('hybrid', 'https://a.test', 'n', 1, M),
      cacheKey('hybrid', 'https://a.test', 'm', 2, M),
      cacheKey('hybrid', 'https://a.test', 'm', 1, { ...M, system: 'khac' }),
      cacheKey('hybrid', 'https://a.test', 'm', 1, { ...M, user: 'khac' }),
      // CODE_REVIEW.md #14: doi endpoint (nha cung cap) nhung GIU NGUYEN ten model
      // trung nhau giua 2 nha cung cap - truoc day se doc nham cache cua nha cung
      // cap kia, gio phai ra khoa khac.
      cacheKey('hybrid', 'https://b.test', 'm', 1, M),
    ];
    for (const o of others) expect(o).not.toBe(k);
    expect(new Set(others).size).toBe(6);
    // B1 v1 va v2 co prompt khac nhau -> khoa khac (khong dung nham cache cua nhau)
    expect(cacheKey('llm-only-v2', 'https://a.test', 'm', 1, llmOnlyMessages(byId('S09'), 'v2'))).not.toBe(
      cacheKey('llm-only', 'https://a.test', 'm', 1, llmOnlyMessages(byId('S09'), 'v1'))
    );
  });

  it('ghi roi doc lai (tao ca thu muc long nhau); thieu file / hong JSON / thieu res / raw khong phai doi tuong / thieu do tre -> null', () => {
    const dir = path.join(mkdir(), 'long', 'nhau');
    const res = okRes({ a: 1 });
    expect(cacheWrite(dir, 'k1', INFO, res)).toBe(true);
    expect(cacheRead(dir, 'k1')).toEqual(res);
    const entry = JSON.parse(fs.readFileSync(path.join(dir, 'k1.json'), 'utf8'));
    expect(entry).toMatchObject({ ...INFO, res });
    expect(new Date(entry.savedAt).toISOString()).toBe(entry.savedAt);

    expect(cacheRead(dir, 'khong-co')).toBeNull();
    const put = (name: string, body: unknown) => fs.writeFileSync(path.join(dir, `${name}.json`), typeof body === 'string' ? body : JSON.stringify(body));
    put('hong', '{khong phai json');
    put('trong', { arm: 'hybrid' });
    put('rawchuoi', { res: { ok: true, raw: 'chuoi', latencyMs: 5 } });
    put('rawnull', { res: { ok: true, raw: null, latencyMs: 5 } });
    put('thieudotre', { res: { ok: true, raw: {} } });
    for (const name of ['hong', 'trong', 'rawchuoi', 'rawnull', 'thieudotre']) expect(cacheRead(dir, name), name).toBeNull();
  });

  it('loi NOI DUNG (BAD_JSON, EMPTY) duoc cache de chay lai tai lap; loi ha tang (429, 5xx, het gio, mang, DISABLED) KHONG, ke ca khi co file san', () => {
    const dir = mkdir();
    expect(isCacheable(okRes({}))).toBe(true);
    for (const reason of ['BAD_JSON', 'EMPTY'] as const) {
      const r = badRes(reason, 200);
      expect(isCacheable(r), reason).toBe(true);
      expect(cacheWrite(dir, reason, INFO, r), reason).toBe(true);
      expect(cacheRead(dir, reason), reason).toEqual(r);
    }
    for (const reason of ['HTTP_4XX', 'HTTP_5XX', 'TIMEOUT', 'NETWORK', 'DISABLED'] as const) {
      const r = badRes(reason, reason === 'HTTP_4XX' ? 429 : null);
      expect(isCacheable(r), reason).toBe(false);
      expect(cacheWrite(dir, reason, INFO, r), reason).toBe(false);
      expect(fs.existsSync(path.join(dir, `${reason}.json`)), reason).toBe(false);
      fs.writeFileSync(path.join(dir, `${reason}.json`), JSON.stringify({ res: r }));
      expect(cacheRead(dir, reason), reason).toBeNull();
    }
  });
});

describe('llm-only v2 (do nhay prompt)', () => {
  it('CHI khac v1 o dung MOT cau (ngoai le cuoi tuan); v1 khong doi va la mac dinh; phan nguoi dung giong het', () => {
    const s = byId('S09');
    const v1 = llmOnlyMessages(s);
    const v2 = llmOnlyMessages(s, 'v2');
    expect(llmOnlyMessages(s, 'v1')).toEqual(v1);
    expect(v1.system).toContain('Khi tự xếp lịch, bỏ qua thứ Bảy và Chủ nhật.');
    expect(v1.system).not.toContain('KHÔNG áp dụng điều này');
    expect(v2.system).toContain('KHÔNG áp dụng điều này cho ngày văn bản đã ghi rõ (dateOrigin = "EXPLICIT")');
    expect(v2.system).toContain('giữ đúng ngày đó kể cả khi rơi vào cuối tuần');
    expect(v2.system).not.toContain('Khi tự xếp lịch, bỏ qua thứ Bảy và Chủ nhật.');
    // thay lai cau v1 vao cho cau v2 thi hai prompt trung khit
    const v2Sentence = v2.system.slice(v2.system.indexOf('Khi tự xếp lịch (dateOrigin'), v2.system.indexOf(' Tối đa'));
    expect(v2.system.replace(v2Sentence, 'Khi tự xếp lịch, bỏ qua thứ Bảy và Chủ nhật.')).toBe(v1.system);
    expect(v2.user).toBe(v1.user);
  });

  it('bao cao: nhanh v2 dung giua llm-only va hybrid, co nhan rieng va co bang lop AI rieng', () => {
    const md = buildReport(
      [
        row('hybrid', 'FREEFORM', 1, SCORE_R, obs(), 'F01'),
        row('llm-only-v2', 'FREEFORM', 1, SCORE_R, obs({ strictParseOk: null, verdictLines: null, draftUsed: null }), 'F01'),
        row('llm-only', 'FREEFORM', 1, SCORE_R, obs({ strictParseOk: null, verdictLines: null, draftUsed: null }), 'F01'),
      ],
      META,
      MODE_ROWS
    );
    const at = (t: string) => md.indexOf(t);
    expect(at('### B1 chỉ AI')).toBeGreaterThan(0);
    expect(at('### B1v2 chỉ AI (prompt làm rõ ngoại lệ cuối tuần)')).toBeGreaterThan(at('### B1 chỉ AI'));
    expect(at('### B2 kết hợp (sản phẩm)')).toBeGreaterThan(at('### B1v2'));
    expect(md).toContain('### Lớp AI: B1v2 chỉ AI (prompt làm rõ ngoại lệ cuối tuần)');
    expect(md).toContain('| B1v2 chỉ AI (prompt làm rõ ngoại lệ cuối tuần) |');
  });
});

// ===================== callJsonLlm (fetch gia) =====================

const KEY = 'khoa-bi-mat-123';
const CFG = { baseUrl: 'https://llm.test/v1/', apiKey: KEY, model: 'gia', timeoutMs: 1500 };
const MSG = { system: 'he thong', user: 'nguoi dung' };

interface Call { url: string; init: RequestInit; body: { messages: unknown; response_format?: { type: string } } & Record<string, unknown> }
function stubFetch(handler: (call: Call, n: number) => Response | Promise<Response>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (!String(url).startsWith('https://llm.test/') || !String(url).endsWith('/chat/completions')) throw new Error(`URL ngoai du kien: ${url}`);
    const call: Call = { url: String(url), init, body: JSON.parse(String(init.body)) };
    calls.push(call);
    return handler(call, calls.length);
  });
  return calls;
}
const json = (status: number, body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const completion = (content: unknown, usage?: unknown) =>
  json(200, { choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }], ...(usage ? { usage } : {}) });

describe('callJsonLlm: goi rieng cua nhanh llm-only (khong dung schema san pham)', () => {
  it('thieu cau hinh -> DISABLED, khong ra mang; dung URL, header, json_object (KHONG gui schema cua san pham); tra JSON + token', async () => {
    const calls = stubFetch(() => {
      throw new Error('khong duoc goi');
    });
    for (const drop of ['baseUrl', 'apiKey', 'model'] as const) {
      expect(await callJsonLlm(MSG, { ...CFG, [drop]: '' })).toMatchObject({ ok: false, reason: 'DISABLED' });
    }
    expect(calls).toHaveLength(0);

    const seen = stubFetch(() => completion('```json\n{"lists":[]}\n```', { prompt_tokens: 9, completion_tokens: 4 }));
    const r = await callJsonLlm(MSG, CFG);
    expect(r).toMatchObject({ ok: true, raw: { lists: [] }, promptTokens: 9, completionTokens: 4, formatMode: 'json_object' });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe('https://llm.test/v1/chat/completions'); // bo dau / thua
    expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    expect(seen[0]!.body).toMatchObject({ model: 'gia', temperature: 0.2, response_format: { type: 'json_object' } });
    expect(seen[0]!.body.messages).toEqual([{ role: 'system', content: 'he thong' }, { role: 'user', content: 'nguoi dung' }]);
    expect(JSON.stringify(seen[0]!.body)).not.toContain(KEY);
  });

  it('400/422 -> ha xuong khong ep JSON; loi khac (401, 429, 500) dung ngay, khong thu lai; khoa bi che trong thong bao loi', async () => {
    const down = stubFetch((_c, n) => (n === 1 ? json(400, 'khong ho tro response_format') : completion({ lists: [] })));
    expect(await callJsonLlm(MSG, CFG)).toMatchObject({ ok: true, formatMode: 'none' });
    expect(down.map((c) => c.body.response_format?.type ?? 'none')).toEqual(['json_object', 'none']);

    const still = stubFetch(() => json(422, 'van khong duoc'));
    expect(await callJsonLlm(MSG, CFG)).toMatchObject({ ok: false, reason: 'HTTP_4XX', status: 422, formatMode: 'none' });
    expect(still).toHaveLength(2);

    stubFetch(() => json(500, 'x'.repeat(500)));
    expect(((await callJsonLlm(MSG, CFG)) as { detail: string }).detail).toHaveLength(200); // cat ngan

    for (const [status, reason] of [[401, 'HTTP_4XX'], [429, 'HTTP_4XX'], [500, 'HTTP_5XX']] as const) {
      const c = stubFetch(() => json(status, `sai khoa ${KEY}`));
      const r = await callJsonLlm(MSG, CFG);
      expect(r).toMatchObject({ ok: false, reason, status });
      expect(c).toHaveLength(1);
      expect(JSON.stringify(r)).not.toContain(KEY);
      expect((r as { detail: string }).detail).toContain('sai khoa ***');
    }
  });

  it('phan hoi hong: khong phai JSON / rong / khong co doi tuong JSON; mang: NETWORK; treo: TIMEOUT', async () => {
    stubFetch(() => json(200, 'khong phai json'));
    expect(await callJsonLlm(MSG, CFG)).toMatchObject({ ok: false, reason: 'BAD_JSON' });
    stubFetch(() => completion(''));
    expect(await callJsonLlm(MSG, CFG)).toMatchObject({ ok: false, reason: 'EMPTY' });
    stubFetch(() => completion('xin chao, day khong phai JSON'));
    expect(await callJsonLlm(MSG, CFG)).toMatchObject({ ok: false, reason: 'BAD_JSON' });
    stubFetch(() => {
      throw new Error(`mat ket noi ${KEY}`);
    });
    const net = await callJsonLlm(MSG, CFG);
    expect(net).toMatchObject({ ok: false, reason: 'NETWORK' });
    expect(JSON.stringify(net)).not.toContain(KEY);
    stubFetch((c) => new Promise<Response>((_res, rej) => c.init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })))));
    expect(await callJsonLlm(MSG, { ...CFG, timeoutMs: 40 })).toMatchObject({ ok: false, reason: 'TIMEOUT' });
  });
});

// ===================== runRule / runHybrid doi chieu voi generatePlan that =====================

/** Ban nhap LLM hop le cho 1 mau: moi dong viec (nhan vang) thanh 1 the trong mot danh sach. */
function draftFor(s: DatasetSample, opts: { fake?: boolean } = {}) {
  const cards = opts.fake
    ? [1, 2].map((i) => ({ title: `Ảo ${i}`, description: '', sourceLine: null, labelKeys: [], checklist: [], startOffsetDays: null, durationDays: null }))
    : s.lines.flatMap((l, i) =>
        l.task
          ? [{ title: l.t.replace(/^[-*•+–\d)\s.]+/u, '').slice(0, 80), description: '', sourceLine: i + 1, labelKeys: [], checklist: [], startOffsetDays: null, durationDays: null }]
          : []
      );
  return {
    board: { name: '', colorKey: 0 },
    labels: [],
    lists: [{ name: 'Việc', cards }],
    lineVerdicts: s.lines.map((l, i) => ({ line: i + 1, verdict: l.task ? 'TASK' : 'OTHER' })),
    assumptions: [],
  };
}

const CFG_SVC: AiConfig = { baseUrl: 'https://llm.test/v1', apiKey: KEY, model: 'gia', providerLabel: 'p', timeoutMs: 2000, maxInputChars: 6000 };
const NOW = new Date('2026-09-19T03:00:00Z');
const paramsOf = (s: DatasetSample, userId: string, workspaceId: string) => ({
  userId,
  workspaceId,
  text: sampleText(s),
  skipWeekend: true,
  today: DATASET_TODAY,
  ...(s.projectStart !== undefined ? { projectStart: s.projectStart } : {}),
  ...(s.projectEnd !== undefined ? { projectEnd: s.projectEnd } : {}),
});

describe('runRule / runHybrid', () => {
  it('runRule khong LLM: moi dong la mot the, cac the co dong nguon; diem chuan cua vai mau da biet', () => {
    const r = runRule(byId('S02'));
    expect(r.cards).toHaveLength(11); // 3 tieu de danh so bi tinh la the (dieu nhanh rule mac phai)
    expect(scoreRun(byId('S02'), r.cards)).toMatchObject({ tp: 8, fp: 3, fn: 0, goldDated: 0, badDates: 0 });
    expect(scoreRun(byId('N03'), runRule(byId('N03')).cards)).toMatchObject({ tp: 5, fp: 1, fn: 0, dateHits: 4, goldDated: 4 }); // dong chen lenh la FP
    expect(scoreRun(byId('S09'), runRule(byId('S09')).cards)).toMatchObject({ dateHits: 5, goldDated: 5 }); // ngay tuong doi deu dung
  });

  it('runRule chuyen DUNG the: han/bat dau/nguon tach rieng, muc "Thanh vien" bi bo chon, ton trong khoang du an, dung hom nay khi chi co ngay ket thuc', () => {
    const s01 = runRule(byId('S01')).cards;
    expect(s01[0]).toEqual({ sourceLine: 3, startDate: null, dueDate: '2026-10-05', startOrigin: 'NONE', dueOrigin: 'EXPLICIT', selected: true });
    expect(s01[3]).toEqual({ sourceLine: 7, startDate: '2026-10-12', dueDate: '2026-10-25', startOrigin: 'EXPLICIT', dueOrigin: 'EXPLICIT', selected: true });
    expect(scoreRun(byId('S01'), s01)).toMatchObject({ tp: 8, fp: 0, fn: 0, dateHits: 5, explicitLines: 5, explicitHits: 5, badDates: 0 });

    // muc "Thanh vien" la danh sach ten nguoi -> the bi BO CHON (khong tinh vao ket qua)
    const members: DatasetSample = {
      id: 'X02', group: 'STRUCTURED', goldMode: 'STRUCTURED', note: 'co muc Thanh vien',
      lines: [
        { t: '# Du an web', task: false }, { t: '## Thành viên', task: false }, { t: '- Nguyễn Văn An', task: false }, { t: '- Trần Thị Bình', task: false },
        { t: '## Công việc', task: false }, { t: '- Làm bài tập', task: true }, { t: '- Nộp báo cáo', task: true },
      ],
    };
    const mc = runRule(members).cards;
    expect(mc.map((c) => `${c.sourceLine}:${c.selected}`)).toEqual(['3:false', '4:false', '6:true', '7:true']);
    expect(scoreRun(members, mc)).toMatchObject({ cards: 2, tp: 2, fp: 0, fn: 0 });

    // khoang du an bat dau MUON hon ngay lam viec dau tien: lich phai bat dau tu do va nam trong khoang
    const late = { ...byId('S02'), projectStart: '2026-10-05', projectEnd: '2026-10-30' };
    const lc = runRule(late).cards;
    expect(lc[0]).toMatchObject({ startDate: '2026-10-05', dueDate: '2026-10-06', startOrigin: 'SCHEDULED', dueOrigin: 'SCHEDULED' });
    expect(scoreRun(late, lc).badDates).toBe(0);
    expect(lc.map((c) => c.dueDate).sort().at(-1)).toBe('2026-10-30');
    // chi co ngay ket thuc: bat dau tu HOM NAY (T7 19/09 -> ngay lam viec dau tien thu Hai 21/09)
    const endOnly = { ...byId('S02'), projectStart: undefined, projectEnd: '2026-10-09' };
    expect(runRule(endOnly).cards[0]!.startDate).toBe('2026-09-21');
  });

  it('LLM loi -> ke hoach giong het rule-only, obs ghi ly do; sai hinh dang -> INVALID_SHAPE; toan the ao -> EMPTY (ok = false)', () => {
    const s = byId('S01');
    const rule = runRule(s);
    for (const res of [badRes('HTTP_5XX', 500), badRes('TIMEOUT'), badRes('DISABLED')]) {
      const h = runHybrid(s, res);
      expect(h.plan.lists).toEqual(rule.plan.lists);
      expect(h.obs).toMatchObject({ ok: false, reason: (res as { reason: string }).reason, draftUsed: false, strictParseOk: null, proposedCards: null, droppedCards: null, latencyMs: 77 });
    }
    const invalid = runHybrid(s, okRes({ hello: 'world' }));
    expect(invalid.plan.lists).toEqual(rule.plan.lists);
    expect(invalid.obs).toMatchObject({ ok: false, reason: 'INVALID_SHAPE', draftUsed: false, promptTokens: 11 });

    const fake = runHybrid(s, okRes(draftFor(s, { fake: true })));
    expect(fake.plan.lists).toEqual(rule.plan.lists);
    expect(fake.obs).toMatchObject({ ok: false, reason: 'EMPTY', draftUsed: false, proposedCards: 2, droppedCards: 2, strictParseOk: true });
  });

  it('LLM tot -> dung ban nhap, obs day du (strict, verdict, de xuat)', () => {
    const s = byId('S02');
    const h = runHybrid(s, okRes(draftFor(s)));
    expect(h.obs).toMatchObject({ ok: true, reason: null, draftUsed: true, strictParseOk: true, verdictLines: 12, lineCount: 12, proposedCards: 8, droppedCards: 0, formatMode: 'json_object' });
    // AI bo 3 tieu de danh so -> 8 the, khong FP
    expect(scoreRun(s, h.cards)).toMatchObject({ cards: 8, tp: 8, fp: 0, fn: 0 });
  });

  it('DOI CHIEU: runHybrid cho danh sach/the GIONG HET generatePlan that (cung ban nhap, cung cau hinh, co/khong khoang du an, LLM loi)', async () => {
    const u = await makeUser();
    const samples = ['S01', 'S02', 'F01', 'F03', 'N03'].map(byId);
    for (const s of samples) {
      const draft = draftFor(s);
      stubFetch(() => completion(draft));
      const real = await generatePlan(paramsOf(s, u.id, u.personalWorkspaceId), NOW, CFG_SVC);
      const mine = runHybrid(s, okRes(draft));
      expect(mine.plan.lists, `${s.id} co LLM`).toEqual(real.plan.lists);
      expect(real.llmUsed, s.id).toBe(true);
      expect(mine.obs.draftUsed, s.id).toBe(true);

      stubFetch(() => json(500, 'sap'));
      const realFail = await generatePlan(paramsOf(s, u.id, u.personalWorkspaceId), NOW, CFG_SVC);
      expect(runHybrid(s, badRes('HTTP_5XX', 500)).plan.lists, `${s.id} LLM loi`).toEqual(realFail.plan.lists);
      expect(runRule(s).plan.lists, `${s.id} rule`).toEqual(realFail.plan.lists);
    }
  });
});
