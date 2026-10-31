// Dung bao cao markdown cho chuong danh gia (buoc 10). Ham thuan: nhan cac dong ket qua da cham,
// tra chuoi -> test duoc (test/ai.eval.test.ts). evaluateAi.ts chi lo goi mang/cache/ghi file.

import type { Arm } from './evalArms';
import type { SampleGroup } from './evalDataset';
import {
  fmt,
  fmtPct,
  mdTable,
  metricsOf,
  modeAt,
  summarizeLlm,
  sumScores,
  type LlmObs,
  type ModeRow,
  type RunScore,
} from './evalMetrics';

export interface RunRow {
  arm: Arm;
  sampleId: string;
  group: SampleGroup;
  /** Lan chay 1..N (nhanh rule chi co lan 1). */
  run: number;
  score: RunScore;
  obs: LlmObs | null;
}

export interface ReportMeta {
  date: string;
  today: string;
  provider: string;
  model: string;
  runs: number;
  sampleCount: number;
  /** Tong so lan goi API that / lay tu cache. */
  apiCalls: number;
  cacheHits: number;
  /** Dung giua chung (vd 429): cac o con thieu khong co trong bang. */
  aborted: string | null;
}

export const MODE_THRESHOLDS_SWEEP = [0.2, 0.3, 0.4, 0.5, 0.6] as const;
const GROUPS: readonly SampleGroup[] = ['STRUCTURED', 'FREEFORM', 'NOISY'];
const ARM_ORDER: readonly Arm[] = ['rule', 'llm-only', 'llm-only-v2', 'hybrid'];
const ARM_LABEL: Record<Arm, string> = {
  rule: 'B0 chỉ bộ luật',
  'llm-only': 'B1 chỉ AI',
  'llm-only-v2': 'B1v2 chỉ AI (prompt làm rõ ngoại lệ cuối tuần)',
  hybrid: 'B2 kết hợp (sản phẩm)',
};

function metricCells(score: RunScore): string[] {
  const m = metricsOf(score);
  return [fmt(m.precision), fmt(m.recall), fmt(m.f1), fmt(m.cardsPerLine), fmtPct(m.dateRecall), fmtPct(m.explicitPrecision), fmtPct(m.badDateRate)];
}

const METRIC_HEADERS = ['Precision', 'Recall', 'F1', 'Thẻ/dòng', 'Ngày ghi rõ: tìm đúng', 'Ngày EXPLICIT: đúng', 'Thẻ có ngày xấu'];

function rowsOf(rows: readonly RunRow[], arm: Arm): RunRow[] {
  return rows.filter((r) => r.arm === arm);
}

function armSection(rows: readonly RunRow[], arm: Arm): string {
  const armRows = rowsOf(rows, arm);
  const table = [
    ...GROUPS.map((g) => {
      const part = armRows.filter((r) => r.group === g);
      const samples = new Set(part.map((r) => r.sampleId)).size;
      return [g, samples, ...metricCells(sumScores(part.map((r) => r.score)))];
    }),
    ['Tất cả', new Set(armRows.map((r) => r.sampleId)).size, ...metricCells(sumScores(armRows.map((r) => r.score)))],
  ];
  const out = [`### ${ARM_LABEL[arm]}`, '', mdTable(['Nhóm', 'Số mẫu', ...METRIC_HEADERS], table)];

  const runs = [...new Set(armRows.map((r) => r.run))].sort((a, b) => a - b);
  if (runs.length > 1) {
    const f1s = runs.map((run) => metricsOf(sumScores(armRows.filter((r) => r.run === run).map((r) => r.score))).f1);
    const known = f1s.filter((v): v is number => v !== null);
    if (known.length > 0) {
      out.push('', `F1 giữa ${runs.length} lần chạy: nhỏ nhất ${fmt(Math.min(...known), 3)}, lớn nhất ${fmt(Math.max(...known), 3)}.`);
    }
  }
  return out.join('\n');
}

function llmSection(rows: readonly RunRow[], arm: Arm): string | null {
  const obs = rowsOf(rows, arm).flatMap((r) => (r.obs === null ? [] : [r.obs]));
  if (obs.length === 0) return null;
  const s = summarizeLlm(obs);
  const hist = (h: Record<string, number>) =>
    Object.keys(h).length === 0
      ? '–'
      : Object.entries(h)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
  const table = [
    ['Số lần gọi', s.calls],
    ['Gọi thành công và đọc được', fmtPct(s.okRate)],
    ['JSON hợp lệ ngay lần đầu (không phải sửa)', fmtPct(s.strictRate)],
    ['Độ phủ lineVerdicts', fmtPct(s.verdictCoverage)],
    ['Thẻ AI đề xuất bị loại vì không truy vết được', fmtPct(s.droppedRate)],
    ['Kế hoạch dùng được bản nháp của AI (không lùi về bộ luật)', fmtPct(s.draftUsedRate)],
    ['Độ trễ p50 (ms)', s.latencyP50 ?? '–'],
    ['Độ trễ p95 (ms)', s.latencyP95 ?? '–'],
    ['Token vào trung bình', s.promptTokensMean === null ? '–' : Math.round(s.promptTokensMean)],
    ['Token ra trung bình', s.completionTokensMean === null ? '–' : Math.round(s.completionTokensMean)],
    ['Mức ép JSON được chấp nhận', hist(s.formatModes)],
    ['Lý do thất bại', hist(s.failReasons)],
  ];
  return [`### Lớp AI: ${ARM_LABEL[arm]}`, '', mdTable(['Chỉ số', 'Giá trị'], table)].join('\n');
}

export function buildReport(rows: readonly RunRow[], meta: ReportMeta, modeRows: readonly ModeRow[]): string {
  const arms = ARM_ORDER.filter((a) => rowsOf(rows, a).length > 0);
  const parts: string[] = [
    '# Kết quả đánh giá module AI',
    '',
    `- Ngày chạy: ${meta.date}; ngày giả định của bộ mẫu: ${meta.today}`,
    `- Bộ dữ liệu: ${meta.sampleCount} mẫu tự soạn, một người gán nhãn; số lần chạy mỗi mẫu: ${meta.runs}`,
    `- Nhà cung cấp AI: ${meta.provider || '–'} / ${meta.model || '–'}`,
    `- Gọi API thật: ${meta.apiCalls}; lấy từ cache: ${meta.cacheHits}`,
  ];
  if (meta.aborted !== null) parts.push(`- **CHƯA ĐỦ**: ${meta.aborted}`);

  // ---- Che do ----
  const modeTable = MODE_THRESHOLDS_SWEEP.map((t) => {
    const r = modeAt(modeRows, t);
    return [fmt(t, 1), `${r.correct}/${r.total}`, fmtPct(r.accuracy), r.wrong.length === 0 ? '–' : r.wrong.join(', ')];
  });
  parts.push(
    '',
    '## Nhận diện chế độ (detectMode)',
    '',
    'Mỗi mẫu có chế độ đúng do người gán nhãn đọc. Bảng quét ngưỡng tỉ lệ cấu trúc (ngưỡng đang dùng là 0,4).',
    '',
    mdTable(['Ngưỡng', 'Đúng', 'Độ chính xác', 'Mẫu sai'], modeTable)
  );

  // ---- Tung nhanh ----
  parts.push('', '## Chất lượng kế hoạch theo từng nhánh');
  for (const arm of arms) parts.push('', armSection(rows, arm));

  // ---- So sanh ----
  if (arms.length > 1) {
    const cmp = arms.map((arm) => [ARM_LABEL[arm], ...metricCells(sumScores(rowsOf(rows, arm).map((r) => r.score)))]);
    parts.push('', '## So sánh các nhánh (gộp tất cả mẫu)', '', mdTable(['Nhánh', ...METRIC_HEADERS], cmp));
  }

  // ---- Lop AI ----
  for (const arm of arms) {
    const sec = llmSection(rows, arm);
    if (sec !== null) parts.push('', sec);
  }

  parts.push(
    '',
    '## Cách đọc',
    '',
    '- Precision/Recall/F1 tính theo SỐ DÒNG: một dòng là đúng khi nó là việc cần làm theo nhãn vàng và có ít nhất một thẻ xuất phát từ nó. Thẻ không có dòng nguồn (AI tự thêm) tính là dương tính giả.',
    '- "Ngày ghi rõ: tìm đúng" = trong các dòng có ngày vàng, tỉ lệ dòng có thẻ mang đúng ngày. "Ngày EXPLICIT: đúng" = trong các dòng có thẻ tự nhận là ngày ghi rõ, tỉ lệ dòng mà ngày đó khớp nhãn vàng.',
    '- "Thẻ có ngày xấu": ngày không có thật, bắt đầu sau hạn, hoặc ngày tự xếp nằm ngoài khoảng dự án.',
    '- Nhánh chỉ-AI không có phương án dự phòng: một lần gọi lỗi là kế hoạch rỗng (mất recall).',
    '- Dữ liệu tự soạn, một người gán nhãn, không có độ đồng thuận giữa những người gán nhãn.'
  );
  return parts.join('\n') + '\n';
}
