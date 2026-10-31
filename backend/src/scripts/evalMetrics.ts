// Cham diem cho bo danh gia (buoc 10, AI_MODULE.md §13). TOAN HAM THUAN: khong doc env, khong ra
// mang, khong cham DB -> test duoc truc tiep (test/ai.eval.test.ts).
//
// DINH NGHIA CHI SO (de luan van ghi dung):
//  - Muc DONG: the du doan = tap cac `sourceLine` khac nhau cua the DUOC CHON. Nhan vang = cac dong
//    `task: true`. TP = dong co the va la viec that; FP = dong co the nhung khong phai viec + the
//    KHONG co dong nguon (bia dat); FN = viec that khong co the nao. Gop (micro) qua cac mau/lan chay
//    de khong bi mau so 0. "The/dong" > 1 nghia la tach mot dong thanh nhieu the (khong bi phat).
//  - NGAY GHI RO: dong nhan vang co `due` (va `start` neu co) duoc tinh la "trung" khi co it nhat mot
//    the tu dong do mang dung ngay. explicitPrecision = trong cac dong co the mang nguon ngay EXPLICIT,
//    ti le dong ma ngay do dung nhan vang (ngay EXPLICIT lien quan den dong khong co ngay vang => sai).
//  - NGAY XAU: the co ngay ma (a) khong phai ngay lich that, hoac (b) bat dau sau han, hoac (c) ngay
//    SCHEDULED nam ngoai khoang du an nguoi dung dat. Bo luat/hybrid dam bao = 0 boi cau truc; nhanh
//    llm-only khong co bao dam nao nen day la cho hai nhanh khac nhau.

import { isValidIso } from '../modules/ai/ai.dates';
import type { PlanMode } from '../modules/ai/ai.rules';
import type { DatasetSample } from './evalDataset';

export type Origin = 'EXPLICIT' | 'SCHEDULED' | 'NONE';

/** The o dang toi thieu de cham (BoardPlan.lists[].cards[] hoac dau ra llm-only). */
export interface CardOut {
  sourceLine: number | null;
  startDate: string | null;
  dueDate: string | null;
  startOrigin: Origin;
  dueOrigin: Origin;
  selected: boolean;
}

export interface RunScore {
  /** So the duoc chon. */
  cards: number;
  tp: number;
  fp: number;
  fn: number;
  /** So the (khong phai so dong) nam tren dong nhan vang la viec that. */
  matchedCards: number;
  /** Dong nhan vang co ngay ghi ro / trong do so dong co the mang dung ngay. */
  goldDated: number;
  dateHits: number;
  /** Dong co the mang nguon ngay EXPLICIT / trong do so dong ma ngay dung. */
  explicitLines: number;
  explicitHits: number;
  /** The co ngay / trong do so the co ngay xau. */
  datedCards: number;
  badDates: number;
}

export function scoreRun(sample: DatasetSample, allCards: readonly CardOut[]): RunScore {
  const cards = allCards.filter((c) => c.selected);
  const lineCount = sample.lines.length;

  const gold = new Set<number>();
  sample.lines.forEach((l, i) => {
    if (l.task) gold.add(i + 1);
  });

  const byLine = new Map<number, CardOut[]>();
  let invented = 0;
  for (const c of cards) {
    const ln = c.sourceLine;
    if (ln === null || !Number.isInteger(ln) || ln < 1 || ln > lineCount) {
      invented += 1;
      continue;
    }
    const list = byLine.get(ln);
    if (list) list.push(c);
    else byLine.set(ln, [c]);
  }

  let tp = 0;
  let matchedCards = 0;
  for (const [ln, on] of byLine) {
    if (gold.has(ln)) {
      tp += 1;
      matchedCards += on.length;
    }
  }
  const fp = byLine.size - tp + invented;
  const fn = gold.size - tp;

  let goldDated = 0;
  let dateHits = 0;
  const hitLines = new Set<number>();
  sample.lines.forEach((l, i) => {
    if (!l.task || (l.due === undefined && l.start === undefined)) return;
    goldDated += 1;
    const on = byLine.get(i + 1) ?? [];
    const hit = on.some(
      (c) => (l.due === undefined || c.dueDate === l.due) && (l.start === undefined || c.startDate === l.start)
    );
    if (hit) {
      dateHits += 1;
      hitLines.add(i + 1);
    }
  });

  let explicitLines = 0;
  let explicitHits = 0;
  for (const [ln, on] of byLine) {
    if (on.some((c) => c.dueOrigin === 'EXPLICIT' || c.startOrigin === 'EXPLICIT')) {
      explicitLines += 1;
      if (hitLines.has(ln)) explicitHits += 1;
    }
  }

  const ws = sample.projectStart;
  const we = sample.projectEnd;
  let datedCards = 0;
  let badDates = 0;
  for (const c of cards) {
    if (c.startDate === null && c.dueDate === null) continue;
    datedCards += 1;
    let bad = false;
    const parts: ReadonlyArray<readonly [string | null, Origin]> = [
      [c.startDate, c.startOrigin],
      [c.dueDate, c.dueOrigin],
    ];
    for (const [d, origin] of parts) {
      if (d === null) continue;
      if (!isValidIso(d)) {
        bad = true;
      } else if (origin === 'SCHEDULED') {
        if ((ws !== undefined && d < ws) || (we !== undefined && d > we)) bad = true;
      }
    }
    if (c.startDate !== null && c.dueDate !== null && isValidIso(c.startDate) && isValidIso(c.dueDate) && c.startDate > c.dueDate) {
      bad = true;
    }
    if (bad) badDates += 1;
  }

  return { cards: cards.length, tp, fp, fn, matchedCards, goldDated, dateHits, explicitLines, explicitHits, datedCards, badDates };
}

export function sumScores(list: readonly RunScore[]): RunScore {
  const sum: RunScore = {
    cards: 0, tp: 0, fp: 0, fn: 0, matchedCards: 0, goldDated: 0, dateHits: 0, explicitLines: 0, explicitHits: 0, datedCards: 0, badDates: 0,
  };
  for (const s of list) {
    sum.cards += s.cards;
    sum.tp += s.tp;
    sum.fp += s.fp;
    sum.fn += s.fn;
    sum.matchedCards += s.matchedCards;
    sum.goldDated += s.goldDated;
    sum.dateHits += s.dateHits;
    sum.explicitLines += s.explicitLines;
    sum.explicitHits += s.explicitHits;
    sum.datedCards += s.datedCards;
    sum.badDates += s.badDates;
  }
  return sum;
}

export interface Metrics {
  precision: number | null;
  recall: number | null;
  f1: number | null;
  cardsPerLine: number | null;
  dateRecall: number | null;
  explicitPrecision: number | null;
  badDateRate: number | null;
}

function ratio(num: number, den: number): number | null {
  return den > 0 ? num / den : null;
}

export function metricsOf(s: RunScore): Metrics {
  const precision = ratio(s.tp, s.tp + s.fp);
  const recall = ratio(s.tp, s.tp + s.fn);
  let f1: number | null = null;
  if (precision !== null && recall !== null) f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    precision,
    recall,
    f1,
    cardsPerLine: ratio(s.matchedCards, s.tp),
    dateRecall: ratio(s.dateHits, s.goldDated),
    explicitPrecision: ratio(s.explicitHits, s.explicitLines),
    badDateRate: ratio(s.badDates, s.datedCards),
  };
}

// ===================== Che do (detectMode) =====================

export interface ModeRow {
  id: string;
  group: string;
  goldMode: PlanMode;
  structuredRatio: number;
  contentLines: number;
}

/** Cung cong thuc voi ai.rules.detectMode (test doi chieu). */
export function modeAt(rows: readonly ModeRow[], ratioThreshold: number, minContentLines = 3) {
  const wrong: string[] = [];
  let correct = 0;
  for (const r of rows) {
    const predicted: PlanMode =
      r.contentLines >= minContentLines && r.structuredRatio >= ratioThreshold ? 'STRUCTURED' : 'FREEFORM';
    if (predicted === r.goldMode) correct += 1;
    else wrong.push(r.id);
  }
  return { correct, total: rows.length, accuracy: rows.length === 0 ? null : correct / rows.length, wrong };
}

// ===================== Lop LLM =====================

export interface LlmObs {
  ok: boolean;
  reason: string | null;
  formatMode: string | null;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  /** Chi hybrid: JSON hop le ngay lan dau (khong phai sua). null = khong ap dung. */
  strictParseOk: boolean | null;
  verdictLines: number | null;
  lineCount: number;
  /** Chi hybrid: so the LLM de xuat (giu + bi loai) va so the bi loai vi khong truy vet duoc. */
  proposedCards: number | null;
  droppedCards: number | null;
  draftUsed: boolean | null;
}

/** Nearest-rank: p50 cua [a,b] la a. Rong -> null. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

function histogram(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

export interface LlmSummary {
  calls: number;
  okRate: number | null;
  /** Trong cac lan ok co do strictParseOk: ti le hop le ngay lan dau. */
  strictRate: number | null;
  verdictCoverage: number | null;
  /** Tong the bi loai / tong the LLM de xuat. */
  droppedRate: number | null;
  /** Ti le lan ma ke hoach thuc su dung ban nhap cua LLM (khong lui ve bo luat). */
  draftUsedRate: number | null;
  latencyP50: number | null;
  latencyP95: number | null;
  promptTokensMean: number | null;
  completionTokensMean: number | null;
  failReasons: Record<string, number>;
  formatModes: Record<string, number>;
}

export function summarizeLlm(obs: readonly LlmObs[]): LlmSummary {
  const ok = obs.filter((o) => o.ok);
  const strict = ok.filter((o) => o.strictParseOk !== null);
  const verdict = ok.filter((o) => o.verdictLines !== null && o.lineCount > 0);
  const proposed = obs.reduce((a, o) => a + (o.proposedCards ?? 0), 0);
  const dropped = obs.reduce((a, o) => a + (o.droppedCards ?? 0), 0);
  const drafts = obs.filter((o) => o.draftUsed !== null);
  return {
    calls: obs.length,
    okRate: ratio(ok.length, obs.length),
    strictRate: ratio(strict.filter((o) => o.strictParseOk === true).length, strict.length),
    verdictCoverage: mean(verdict.map((o) => Math.min(1, (o.verdictLines as number) / o.lineCount))),
    droppedRate: ratio(dropped, proposed),
    draftUsedRate: ratio(drafts.filter((o) => o.draftUsed === true).length, drafts.length),
    latencyP50: percentile(ok.map((o) => o.latencyMs), 50),
    latencyP95: percentile(ok.map((o) => o.latencyMs), 95),
    promptTokensMean: mean(ok.flatMap((o) => (o.promptTokens === null ? [] : [o.promptTokens]))),
    completionTokensMean: mean(ok.flatMap((o) => (o.completionTokens === null ? [] : [o.completionTokens]))),
    failReasons: histogram(obs.flatMap((o) => (!o.ok && o.reason !== null ? [o.reason] : []))),
    formatModes: histogram(ok.flatMap((o) => (o.formatMode === null ? [] : [o.formatMode]))),
  };
}

// ===================== Bang markdown =====================

/** Dinh dang so kieu Viet (dau phay). null -> "–". */
export function fmt(x: number | null, digits = 2): string {
  return x === null ? '–' : x.toFixed(digits).replace('.', ',');
}
export function fmtPct(x: number | null): string {
  return x === null ? '–' : `${(x * 100).toFixed(1).replace('.', ',')}%`;
}

export function mdTable(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null>>): string {
  const cell = (v: string | number | null) => (v === null ? '–' : String(v));
  const lines = [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ];
  return lines.join('\n');
}
