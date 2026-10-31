// Dung bao cao markdown cho bo danh gia lop 2 (buoc 9, ASSIGN_MODULE.md §10.10/§11). TOAN HAM THUAN: nhan ket qua da
// chay, tra ve chuoi -> test duoc truc tiep (test/assign.evalplanreport.test.ts). Dung lai het do dinh dang da co o
// buoc 7 (evalMetrics, evalAssignStats, evalAssignReport) - khong viet lai.

import { fmt, fmtPct, mdTable } from './evalMetrics';
import { comparePaired, summarizeSeeds } from './evalAssignStats';
import { datasetFingerprint, fmtDiff, fmtMeanCI, verdict } from './evalAssignReport';
import type { PlanArmId, PlanBatchSummary } from './evalPlanRun';

export interface PlanReportMeta {
  date: string;
  seeds: readonly number[];
  /** sha256 tong cua cac bo du lieu (xem datasetFingerprint) - de biet so lieu ung voi dung bo du lieu nao. */
  datasetSha256: string;
  batchDays: readonly number[];
  batchK: number;
  loadPenalty: number;
}

export interface PlanArmResult {
  id: PlanArmId;
  label: string;
  /** Mot tong hop (da gop cac dot) cho moi hat giong, CUNG thu tu voi meta.seeds. */
  perSeed: readonly PlanBatchSummary[];
}

type Getter = (s: PlanBatchSummary) => number;
const seriesOf = (r: PlanArmResult, get: Getter): number[] => r.perSeed.map(get);
const meanOf = (r: PlanArmResult, get: Getter): number => summarizeSeeds(seriesOf(r, get)).mean;

const maxShareOf: Getter = (s) => s.maxShare;
const pOnTimeOf: Getter = (s) => s.pOnTime;

function need(results: readonly PlanArmResult[], id: PlanArmId): PlanArmResult {
  const r = results.find((x) => x.id === id);
  if (!r) throw new Error(`thieu nhanh "${id}" trong ket qua`);
  return r;
}

/** Bang mo ta day du: moi nhanh mot dong, moi chi so da tinh o evalPlanRun.ts. */
export function descriptiveTable(results: readonly PlanArmResult[]): string {
  const rows = results.map((r) => [
    r.label,
    fmtPct(meanOf(r, maxShareOf)),
    fmt(meanOf(r, (s) => s.gini), 3),
    fmtMeanCI(seriesOf(r, pOnTimeOf)),
    fmt(meanOf(r, (s) => s.regret), 3),
    fmtPct(meanOf(r, (s) => s.top1)),
    fmtPct(meanOf(r, (s) => s.risky)),
    fmtPct(meanOf(r, (s) => s.unassigned)),
  ]);
  return mdTable(
    ['Cách chia', 'Người nhiều nhất', 'Gini', 'P(đúng hạn) [95% CI]', 'Hối tiếc', 'Top-1', 'Rủi ro (<0,5)', 'Không ai nhận'],
    rows
  );
}

/** Nam phep so sanh CHINH da dang ky truoc buoc 9b (nhanh 1 - nhanh 2). */
export const PRIMARY_PLAN_COMPARISONS: readonly (readonly [PlanArmId, PlanArmId])[] = [
  ['planned', 'independent'],
  ['planned', 'roundRobin'],
  ['planned', 'plannedCap'],
  ['planned', 'plannedPenalty10'],
  ['planned', 'oracleGreedy'],
];

/** Bang so sanh cap tren hai chi so CHINH (nguoi nhieu nhat: thap hon tot hon; P(dung han): cao hon tot hon). */
export function comparisonTable(results: readonly PlanArmResult[], pairs: readonly (readonly [PlanArmId, PlanArmId])[]): string {
  const rows = pairs.map(([a, b]) => {
    const ra = need(results, a);
    const rb = need(results, b);
    const share = comparePaired(seriesOf(ra, maxShareOf), seriesOf(rb, maxShareOf));
    const p = comparePaired(seriesOf(ra, pOnTimeOf), seriesOf(rb, pOnTimeOf));
    return [`${ra.label} − ${rb.label}`, fmtDiff(share), verdict(share, false), fmtDiff(p), verdict(p, true)];
  });
  return mdTable(
    ['Phép so sánh (nhánh 1 − nhánh 2)', 'Δ người nhiều nhất [95% CI]', 'Kết luận (tập trung)', 'Δ P(đúng hạn) [95% CI]', 'Kết luận (đúng hạn)'],
    rows
  );
}

export interface KSweepPoint {
  k: number;
  planned: PlanArmResult;
  independent: PlanArmResult;
}

/** Quet cỡ dot K (mo ta, khong phai so sanh chinh): "cach da cai" so voi "doc lap" o vai cỡ dot khac nhau. */
export function kSweepTable(points: readonly KSweepPoint[]): string {
  const rows = points.map((p) => [
    String(p.k),
    fmtPct(meanOf(p.planned, maxShareOf)),
    fmt(meanOf(p.planned, (s) => s.gini), 3),
    fmtMeanCI(seriesOf(p.planned, pOnTimeOf)),
    fmtPct(meanOf(p.independent, maxShareOf)),
    fmtMeanCI(seriesOf(p.independent, pOnTimeOf)),
  ]);
  return mdTable(
    ['Cỡ đợt K', 'Người nhiều nhất (đã cài)', 'Gini (đã cài)', 'P(đúng hạn) (đã cài)', 'Người nhiều nhất (độc lập)', 'P(đúng hạn) (độc lập)'],
    rows
  );
}

/** DROP so voi NEUTRAL cho nhanh "da cai" (mo ta - noi lai quyet dinh con treo tu buoc 4b/7b, o goc nhin ca dot). */
export function missingPolicyTable(drop: PlanArmResult, neutral: PlanArmResult): string {
  const share = comparePaired(seriesOf(neutral, maxShareOf), seriesOf(drop, maxShareOf));
  const gini = comparePaired(
    neutral.perSeed.map((s) => s.gini),
    drop.perSeed.map((s) => s.gini)
  );
  const p = comparePaired(seriesOf(neutral, pOnTimeOf), seriesOf(drop, pOnTimeOf));
  return mdTable(
    ['So sánh (NEUTRAL − DROP)', 'Δ người nhiều nhất [95% CI]', 'Δ Gini [95% CI]', 'Δ P(đúng hạn) [95% CI]', 'Kết luận (đúng hạn)'],
    [['NEUTRAL − DROP, nhánh "đã cài"', fmtDiff(share), fmtDiff(gini), fmtDiff(p), verdict(p, true)]]
  );
}

export interface PlanReportInput {
  meta: PlanReportMeta;
  main: readonly PlanArmResult[];
  kSweep?: readonly KSweepPoint[];
  missingPolicy?: { drop: PlanArmResult; neutral: PlanArmResult };
}

export { datasetFingerprint };

/** Bao cao buoc 9: mo ta cac cach chia, so sanh cap da dang ky truoc, quet cỡ dot, DROP/NEUTRAL. */
export function buildPlanReport(input: PlanReportInput): string {
  const { meta, main, kSweep, missingPolicy } = input;
  const n = meta.seeds.length;
  const out: string[] = [];
  out.push('# Đánh giá module gợi ý phân công — lớp 2: chia việc cho cả danh sách (bước 9)');
  out.push('');
  out.push(
    `Ngày chạy ${meta.date} · ${n} hạt giống (${meta.seeds[0]}–${meta.seeds[n - 1]}) · ` +
      `mỗi hạt giống gộp ${meta.batchDays.length} đợt (ngày quyết định ${meta.batchDays.join(', ')}), cỡ đợt K = ${meta.batchK} thẻ · ` +
      `hệ số phạt tải của thế giới ${fmt(meta.loadPenalty, 2)} · sha256 dữ liệu \`${meta.datasetSha256.slice(0, 16)}…\``
  );
  if (n < 20) out.push('', `> **Cảnh báo**: chỉ ${n} hạt giống (< 20) — khoảng tin cậy kém tin cậy, chỉ dùng để chạy thử.`);
  out.push('');
  out.push('## 1. Mô tả bảy cách chia');
  out.push('');
  out.push(descriptiveTable(main));
  out.push('');
  out.push(
    '*Người nhiều nhất* và *Gini* đo mức tập trung việc (số thẻ mỗi người nhận) — chỉ số chính của bước này cùng với *P(đúng hạn)*. ' +
      '*P(đúng hạn)* là xác suất đúng hạn kỳ vọng (mô hình kết quả của bộ sinh) của người được chọn, tính với tải **lúc giao**, trung bình trên các hạt giống kèm khoảng tin cậy bootstrap 95%. ' +
      '*Hối tiếc* = kỹ năng ẩn người giỏi nhất họ bốc trừ kỹ năng người được chọn. *Rủi ro* = tỉ lệ thẻ có P(đúng hạn) < 0,5.'
  );
  out.push('');
  out.push('## 2. So sánh cặp đã đăng ký trước (nhánh 1 − nhánh 2, cùng thẻ, cùng may rủi)');
  out.push('');
  out.push(comparisonTable(main, PRIMARY_PLAN_COMPARISONS));
  out.push('');
  out.push(
    `Năm phép so sánh chính được chọn trước khi chạy trên ${n} hạt giống này. Hai chỉ số chính tách riêng, không gộp thành một số: ` +
      '"người nhiều nhất" thấp hơn là tốt hơn (đỡ dồn tải); "P(đúng hạn)" cao hơn là tốt hơn. Kết luận chỉ dựa vào việc khoảng tin cậy có chứa 0 hay không.'
  );
  if (kSweep && kSweep.length > 0) {
    out.push('', '## 3. Quét cỡ đợt K (mô tả, không phải so sánh chính)', '', kSweepTable(kSweep));
  }
  if (missingPolicy) {
    out.push(
      '',
      '## 4. Thành phần thiếu dữ liệu: DROP so với NEUTRAL (mô tả — nối lại quyết định còn treo từ bước 4b/7b)',
      '',
      missingPolicyTable(missingPolicy.drop, missingPolicy.neutral),
      '',
      'Bước 7b đã đo sự khác biệt DROP/NEUTRAL cho **người mới** ở góc nhìn từng thẻ (không phân biệt được, xem nhật ký 7b); ' +
        'bảng này chỉ đo lại ở góc nhìn **cả đợt** trên ba chỉ số chính, không tính lại chỉ số người mới.'
    );
  }
  out.push('');
  out.push('## Giới hạn (đọc trước khi trích dẫn)');
  out.push('');
  out.push(
    '- Mô phỏng không có khái niệm "danh sách" riêng trong một bảng: một **đợt chia việc** ở đây là một lát cắt K thẻ kế tiếp theo thời gian, ' +
      'không phân biệt thẻ thuộc bảng/danh sách nào (vì `planAssignments` cũng không dùng thông tin đó để chấm điểm).\n' +
      '- *Tối ưu tham lam* cần biết kỹ năng ẩn và chọn tốt nhất **tại từng thẻ theo đúng thứ tự xử lý** — không phải lời giải tối ưu toàn cục cho cả đợt (không giải bài toán ghép tối ưu kiểu Hungary); khoảng cách với nhánh này là cận trên tham khảo, không phải khoảng cách tới lời giải tốt nhất có thể.\n' +
      `- Mỗi hạt giống là một đơn vị độc lập cho khoảng tin cậy (không tính trên từng thẻ); mỗi hạt giống đã gộp trung bình ${meta.batchDays.length} đợt.\n` +
      '- Mọi số liệu nằm trong thế giới giả định của bộ sinh (ASSIGN_MODULE.md §7); chứng minh thuật toán hoạt động như thiết kế, không chứng minh hiệu quả ngoài đời.'
  );
  return out.join('\n');
}
