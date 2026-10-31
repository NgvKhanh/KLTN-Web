// Bao cao markdown cua bo danh gia chatbot (CHATBOT_MODULE.md §14.4). HAM THUAN.

import { foldText } from '../modules/ai/ai.rules';
import {
  fullMatchCI,
  INTENT_LABELS,
  pairedFull,
  summarizeArm,
  type ArmId,
  type Outcome,
  type PredLabel,
  type ScoredRun,
} from './chatEvalCore';
import type { ChatEvalItem } from './chatEvalDataset';
import { fmt, fmtPct, mdTable, percentile } from './evalMetrics';

export interface LlmCallObs {
  itemId: string;
  run: number;
  ok: boolean;
  /** Loai loi (HTTP_4XX, TIMEOUT, BAD_JSON, INVALID_SHAPE...) khi ok = false. */
  reason: string | null;
  formatMode: string | null;
  latencyMs: number;
  promptTokens: number | null;
  completionTokens: number | null;
  fromCache: boolean;
}

export interface ChatReportMeta {
  date: string;
  split: string;
  runs: number;
  arms: ArmId[];
  provider: string;
  model: string;
  datasetVersion: string;
  promptVersion: string;
  rulesVersion: string;
  apiCalls: number;
  cacheHits: number;
  aborted: string | null;
}

export function describeOutcome(o: Outcome): string {
  switch (o.kind) {
    case 'QUERY':
      return [o.intent, o.focus ?? '–', o.period ?? '–', o.member ?? '–'].join(' · ') + (o.ignored.length > 0 ? ` (bỏ qua ${o.ignored.join(', ')})` : '');
    case 'CLARIFY_MEMBER':
      return `hỏi lại: ${o.candidates.join(', ')}`;
    case 'CATALOG':
      return `${o.intent} · ${o.target ?? '–'} · ${o.column ?? '–'}`;
    case 'CLARIFY_TARGET':
      return `${o.intent} · hỏi lại bảng/không gian: ${o.candidates.join(', ')}`;
    case 'TARGET_NOT_FOUND':
      return `${o.intent} · không tìm thấy (${o.what})`;
    case 'ASK_WORKSPACE':
      return `${o.intent} · hỏi "không gian nào?"`;
    case 'LLM_FAILED':
      return `LLM lỗi (${o.reason})`;
    default:
      return o.kind;
  }
}

const pct = (r: { rate: number | null; hits: number; n: number }) => (r.n === 0 ? '–' : `${fmtPct(r.rate)} (${r.hits}/${r.n})`);

/** Cau go khong dau (tinh tu dong, khong can gan nhan). */
export function isPlain(question: string): boolean {
  const lower = question.normalize('NFC').toLowerCase();
  return foldText(lower) === lower;
}

function mean(xs: readonly number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function buildChatReport(
  meta: ChatReportMeta,
  byArm: ReadonlyMap<ArmId, readonly ScoredRun[]>,
  items: readonly ChatEvalItem[],
  llmObs: readonly LlmCallObs[],
  /** Id cac cau cua vong 1 (hoi quy): co thi bao cao them bang "cau cu / cau danh muc moi". */
  legacyIds: ReadonlySet<string> = new Set()
): string {
  const ids = items.map((i) => i.id);
  const arms = meta.arms.filter((a) => byArm.has(a));
  const out: string[] = [];
  out.push('# Đánh giá chatbot trợ lý — hiểu câu hỏi (B0 luật / B1 chỉ LLM / B2 lai)');
  out.push('');
  out.push(
    mdTable(
      ['Mục', 'Giá trị'],
      [
        ['Ngày chạy', meta.date],
        ['Tập', `${meta.split} (${items.length} câu)`],
        ['Số lần chạy nhánh có LLM', meta.runs],
        ['Nhà cung cấp / model', meta.model === '' ? '– (chỉ bộ luật)' : `${meta.provider} / ${meta.model}`],
        ['Phiên bản bộ dữ liệu / prompt / luật', `${meta.datasetVersion} / ${meta.promptVersion} / ${meta.rulesVersion}`],
        ['Gọi API / lấy từ bộ đệm', `${meta.apiCalls} / ${meta.cacheHits}`],
      ]
    )
  );
  if (meta.aborted !== null) out.push('', `> **Dừng giữa chừng**: ${meta.aborted}`);

  // ---- Tong quan ----
  out.push('', '## Tổng quan theo nhánh', '');
  out.push(
    'Khớp hoàn toàn = đúng cả loại kết quả, ý định, thời gian, tình trạng và người (tham số bị bỏ qua chấm riêng). ' +
      'Khoảng tin cậy 95% bootstrap theo câu hỏi (10 000 lần lấy mẫu lại).',
    ''
  );
  const rows: (string | number | null)[][] = [];
  for (const arm of arms) {
    const runs = byArm.get(arm)!;
    const s = summarizeArm(runs);
    const ci = fullMatchCI(runs, ids);
    rows.push([
      arm,
      pct(s.intent),
      fmt(s.macroF1, 3),
      pct(s.period),
      pct(s.focus),
      pct(s.member),
      pct(s.target),
      `${pct(s.full)}${ci ? ` [${fmtPct(ci.lo)}; ${fmtPct(ci.hi)}]` : ''}`,
      pct(s.ignored),
      pct(s.clarify),
      s.llmFailed,
    ]);
  }
  out.push(
    mdTable(
      ['Nhánh', 'Ý định', 'Macro-F1', 'Thời gian', 'Tình trạng', 'Người', 'Bảng / không gian / cột', 'Khớp hoàn toàn [KTC 95%]', 'Tham số bỏ qua', 'Hỏi lại đúng', 'LLM lỗi'],
      rows
    )
  );

  // ---- So sanh cap ----
  const pairs: [ArmId, ArmId][] = [
    ['B1', 'B0'],
    ['B2', 'B1'],
    ['B2', 'B0'],
  ];
  const pairRows = pairs
    .filter(([a, b]) => byArm.has(a) && byArm.has(b))
    .map(([a, b]) => {
      const c = pairedFull(byArm.get(a)!, byArm.get(b)!, ids);
      return c === null
        ? [`${a} − ${b}`, '–', '–', '–']
        : [`${a} − ${b}`, `${c.mean >= 0 ? '+' : ''}${fmt(c.mean * 100, 1)} điểm %`, `[${fmt(c.lo * 100, 1)}; ${fmt(c.hi * 100, 1)}]`, `${c.positive} / ${c.negative} / ${c.ties}`];
    });
  if (pairRows.length > 0) {
    out.push('', '## So sánh cặp (cùng câu hỏi)', '');
    out.push(mdTable(['Chênh lệch khớp hoàn toàn', 'Trung bình', 'KTC 95%', 'Số câu hơn / kém / bằng'], pairRows));
  }

  // ---- F1 theo nhan + ma tran nham ----
  out.push('', '## F1 theo nhãn ý định', '');
  out.push(
    mdTable(
      ['Nhãn', ...arms],
      INTENT_LABELS.map((label) => [label, ...arms.map((a) => fmt(summarizeArm(byArm.get(a)!).perLabelF1[label], 3))])
    )
  );
  const cols: PredLabel[] = [...INTENT_LABELS, 'LLM_FAILED'];
  for (const arm of arms) {
    const conf = summarizeArm(byArm.get(arm)!).confusion;
    out.push('', `### Ma trận nhầm — ${arm} (hàng: nhãn vàng, cột: dự đoán)`, '');
    out.push(mdTable(['Vàng \\ Dự đoán', ...cols], INTENT_LABELS.map((g) => [g, ...cols.map((p) => conf[g][p])])));
  }

  // ---- Theo nhom + nhan phu ----
  const groups = [...new Set(items.map((i) => i.group))];
  const fullOf = (arm: ArmId, keep: (i: ChatEvalItem) => boolean) => {
    const keepIds = new Set(items.filter(keep).map((i) => i.id));
    const runs = byArm.get(arm)!.filter((r) => keepIds.has(r.itemId));
    return runs.length === 0 ? '–' : `${fmtPct(runs.filter((r) => r.score.full).length / runs.length)} (${keepIds.size} câu)`;
  };
  if (legacyIds.size > 0 && items.some((i) => legacyIds.has(i.id)) && items.some((i) => !legacyIds.has(i.id))) {
    out.push('', '## Câu cũ (hồi quy) và câu danh mục mới', '');
    out.push(
      'Câu cũ (nhóm A–H) đã lộ ở vòng 1 nên chỉ là **hồi quy** (prompt đã đổi); số liệu chính của vòng 2 là câu danh mục mới (nhóm I–M).',
      ''
    );
    out.push(
      mdTable(
        ['Bộ câu', ...arms],
        [
          ['câu cũ — hồi quy', ...arms.map((a) => fullOf(a, (i) => legacyIds.has(i.id)))],
          ['câu mới — danh mục', ...arms.map((a) => fullOf(a, (i) => !legacyIds.has(i.id)))],
        ]
      )
    );
  }
  out.push('', '## Khớp hoàn toàn theo nhóm câu hỏi', '');
  out.push(mdTable(['Nhóm', ...arms], groups.map((g) => [g, ...arms.map((a) => fullOf(a, (i) => i.group === g))])));
  const tags = [...new Set(items.flatMap((i) => i.tags))].sort();
  out.push('', '## Khớp hoàn toàn theo loại khó', '');
  out.push(
    mdTable(
      ['Loại', ...arms],
      [
        ['gõ không dấu', ...arms.map((a) => fullOf(a, (i) => isPlain(i.question)))],
        ['câu nối tiếp (có ngữ cảnh trước)', ...arms.map((a) => fullOf(a, (i) => i.prev !== null))],
        ...tags.map((t) => [t, ...arms.map((a) => fullOf(a, (i) => i.tags.includes(t)))]),
      ]
    )
  );

  // ---- LLM ----
  if (llmObs.length > 0) {
    const ok = llmObs.filter((o) => o.ok);
    const hist = (xs: string[]) => {
      const h = new Map<string, number>();
      for (const x of xs) h.set(x, (h.get(x) ?? 0) + 1);
      return [...h].map(([k, v]) => `${k} ${v}`).join(', ') || '–';
    };
    out.push('', '## Lớp LLM (dùng chung cho B1 và B2)', '');
    out.push(
      mdTable(
        ['Chỉ số', 'Giá trị'],
        [
          ['Lượt gọi (câu × lần chạy)', llmObs.length],
          ['Thành công', `${fmtPct(ok.length / llmObs.length)} (${ok.length}/${llmObs.length})`],
          ['Lỗi theo loại', hist(llmObs.filter((o) => !o.ok).map((o) => o.reason ?? '?'))],
          ['Mức ép JSON được chấp nhận', hist(ok.map((o) => o.formatMode ?? '?'))],
          ['Độ trễ p50 / p95 (ms, lượt thành công)', `${percentile(ok.map((o) => o.latencyMs), 50) ?? '–'} / ${percentile(ok.map((o) => o.latencyMs), 95) ?? '–'}`],
          ['Token vào / ra trung bình', `${fmt(mean(ok.flatMap((o) => (o.promptTokens === null ? [] : [o.promptTokens]))), 0)} / ${fmt(mean(ok.flatMap((o) => (o.completionTokens === null ? [] : [o.completionTokens]))), 0)}`],
        ]
      )
    );
  }

  // ---- Cau sai ----
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const arm of arms) {
    const wrong = byArm.get(arm)!.filter((r) => !r.score.full);
    out.push('', `## Câu sai — ${arm} (${wrong.length})`, '');
    if (wrong.length === 0) {
      out.push('Không có.');
      continue;
    }
    out.push(
      mdTable(
        ['Câu', 'Lần', 'Câu hỏi', 'Vàng', 'Dự đoán'],
        wrong.map((r) => [r.itemId, r.run, (byId.get(r.itemId)?.question ?? '').split('|').join('/'), describeOutcome(r.gold), describeOutcome(r.pred)])
      )
    );
  }
  return `${out.join('\n')}\n`;
}
