// Dung bao cao markdown cho bo danh gia goi y phan cong (buoc 7, ASSIGN_MODULE.md §11). TOAN HAM THUAN: nhan ket qua da chay,
// tra ve chuoi -> test duoc truc tiep (test/assign.evalreport.test.ts). Dung lai mdTable / fmt / fmtPct cua evalMetrics.

import { createHash } from 'node:crypto';
import { fmt, fmtPct, mdTable } from './evalMetrics';
import { comparePaired, mean, summarizeSeeds, type PairedComparison } from './evalAssignStats';
import type { RunSummary } from './evalAssignRun';
import type { SimDataset } from './simGenerator';

export interface ArmResult {
  id: string;
  label: string;
  /** Mot tong hop cho moi hat giong, CUNG thu tu voi meta.seeds. */
  perSeed: readonly RunSummary[];
}

export interface ReportMeta {
  /** Ngay lap bao cao; thoi diem chay that cua tung thi nghiem nam trong experimentRuns. */
  date: string;
  seeds: readonly number[];
  /** sha256 tong cua cac bo du lieu (xem datasetFingerprint) - de biet so lieu ung voi dung bo du lieu nao. */
  datasetSha256: string;
  minDay: number;
  loadPenalty: number;
  sourceSha256?: string;
  nodeVersion?: string;
  experimentRuns?: Readonly<Record<string, string>>;
}

/** Giu lai thoi diem chay that khi dung lai cache, ke ca bao cao gop nhieu lan chay. */
export function provenanceLines(meta: ReportMeta): string[] {
  const out: string[] = [];
  if (meta.sourceSha256) out.push('', `sha256 mã nguồn \`${meta.sourceSha256}\`${meta.nodeVersion ? ` · Node ${meta.nodeVersion}` : ''}`);
  if (meta.experimentRuns) {
    out.push('', 'Thời điểm hoàn tất thí nghiệm (UTC):', '', ...Object.entries(meta.experimentRuns).map(
      ([name, time]) => `- \`${name}\`: ${time}`,
    ));
  }
  return out;
}

export type Getter = (s: RunSummary) => number | null;

/** Chuoi gia tri cua mot chi so tren cac hat giong (bo hat giong khong co gia tri). */
export function seriesOf(r: ArmResult, get: Getter): number[] {
  return r.perSeed.map(get).filter((x): x is number => x !== null);
}

const avg = (xs: number[]): number | null => (xs.length === 0 ? null : mean(xs));

/** Trung binh tren cac hat giong (null neu khong hat giong nao co gia tri). */
export function meanOver(r: ArmResult, get: Getter): number | null {
  return avg(seriesOf(r, get));
}

/** "0,442 [0,431; 0,453]" - trung binh kem khoang tin cay bootstrap 95% (chi tren nhieu hat giong). */
export function fmtMeanCI(xs: number[], digits = 3): string {
  if (xs.length === 0) return '–';
  if (xs.length < 2) return fmt(xs[0]!, digits);
  const s = summarizeSeeds(xs);
  return `${fmt(s.mean, digits)} [${fmt(s.lo, digits)}; ${fmt(s.hi, digits)}]`;
}

/** Co dau ro rang cho chenh lech: "+0,012" / "-0,004". */
export function fmtSigned(x: number, digits = 3): string {
  const s = fmt(Math.abs(x), digits);
  return x > 0 ? `+${s}` : x < 0 ? `-${s}` : s;
}

export function fmtDiff(c: PairedComparison, digits = 3): string {
  return `${fmtSigned(c.mean, digits)} [${fmtSigned(c.lo, digits)}; ${fmtSigned(c.hi, digits)}]`;
}

/** Ket luan tu dong theo khoang tin cay: khong doc "cam tinh" tu con so. `higherIsBetter` cho biet chieu tot cua chi so. */
export function verdict(c: PairedComparison, higherIsBetter: boolean): string {
  if (c.lo > 0) return higherIsBetter ? 'nhánh 1 tốt hơn' : 'nhánh 1 kém hơn';
  if (c.hi < 0) return higherIsBetter ? 'nhánh 1 kém hơn' : 'nhánh 1 tốt hơn';
  return 'chưa phân biệt được';
}

/** sha256 cua JSON bo du lieu (cung cach voi test dong bang cua bo sinh) va ma bam tong. */
export function datasetFingerprint(datasets: readonly SimDataset[]): { perSeed: string[]; combined: string } {
  const perSeed = datasets.map((d) => createHash('sha256').update(JSON.stringify(d)).digest('hex'));
  return { perSeed, combined: createHash('sha256').update(perSeed.join('\n')).digest('hex') };
}

/** Cac so sanh CHINH da dang ky truoc (nhanh dau tien la nhanh "dau tien" cua phep tru). */
export const PRIMARY_COMPARISONS: readonly (readonly [string, string])[] = [
  ['full', 'random'],
  ['full', 'most-free'],
  ['full', 'most-frequent'],
  ['full', 'exp-only'],
  ['full', 'load-only'],
];

function need(results: readonly ArmResult[], id: string): ArmResult {
  const r = results.find((x) => x.id === id);
  if (!r) throw new Error(`thieu nhanh "${id}" trong ket qua`);
  return r;
}

const pOn: Getter = (s) => s.pOnTime;
const regret: Getter = (s) => s.regret;

/** Bang so sanh cap (chi so chinh + hoi tiec) theo cac cap da dang ky. */
export function comparisonTable(results: readonly ArmResult[], pairs: readonly (readonly [string, string])[]): string {
  const rows = pairs.map(([a, b]) => {
    const ra = need(results, a);
    const rb = need(results, b);
    const p = comparePaired(seriesOf(ra, pOn), seriesOf(rb, pOn));
    const r = comparePaired(seriesOf(ra, regret), seriesOf(rb, regret));
    return [
      `${ra.label} − ${rb.label}`,
      fmtDiff(p),
      `${p.positive} / ${p.negative} / ${p.ties}`,
      verdict(p, true),
      fmtDiff(r),
      verdict(r, false),
    ];
  });
  return mdTable(
    ['Phép so sánh (nhánh 1 − nhánh 2)', 'Δ P(đúng hạn) [95% CI]', 'Hạt giống +/−/=', 'Kết luận (P đúng hạn)', 'Δ hối tiếc [95% CI]', 'Kết luận (hối tiếc)'],
    rows
  );
}

/** Bang chinh cua che do vong kin. */
export function closedLoopTable(results: readonly ArmResult[]): string {
  const rows = results.map((r) => [
    r.label,
    fmtMeanCI(seriesOf(r, pOn)),
    fmt(meanOver(r, regret), 3),
    fmtPct(meanOver(r, (s) => s.top1)),
    fmtPct(meanOver(r, (s) => s.top3)),
    fmt(meanOver(r, (s) => s.mrr), 3),
    fmt(meanOver(r, (s) => s.giniAssigned), 3),
    fmtPct(meanOver(r, (s) => s.maxShareAssigned)),
    fmt(meanOver(r, (s) => s.newcomerParity), 2),
    fmtPct(meanOver(r, (s) => s.onTimeRealised)),
  ]);
  return mdTable(
    ['Nhánh', 'P(đúng hạn) [95% CI]', 'Hối tiếc', 'Top-1', 'Top-3', 'MRR', 'Gini', 'Người nhiều nhất', 'Người mới (1 = công bằng)', 'Đúng hạn thực'],
    rows
  );
}

/** Bang cua che do HISTORY, kem cac dong tham chieu (phan cong that, ngau nhien ky vong) lay tu chinh cac lan chay. */
export function historyTable(results: readonly ArmResult[], refIds: readonly string[]): string {
  const armRow = (r: ArmResult) => [
    r.label,
    fmtMeanCI(seriesOf(r, pOn)),
    fmt(meanOver(r, regret), 3),
    fmtPct(meanOver(r, (s) => s.top1)),
    fmtPct(meanOver(r, (s) => s.top3)),
    fmt(meanOver(r, (s) => s.mrr), 3),
    fmt(meanOver(r, (s) => s.giniTop), 3),
    fmtPct(meanOver(r, (s) => s.maxShareTop)),
  ];
  const base = need(results, refIds[0]!);
  const rows: (string | number | null)[][] = results.map(armRow);
  // Phan cong THAT cua bo sinh va ngau nhien ky vong khong phu thuoc nhanh: doc tu mot nhanh bat ky
  rows.push([
    'Tham chiếu: phân công thật của bộ sinh',
    fmtMeanCI(seriesOf(base, (s) => s.pOnTimeAssigned)),
    fmt(meanOver(base, (s) => s.regretAssigned), 3),
    fmtPct(meanOver(base, (s) => s.top1Assigned)),
    '–',
    '–',
    fmt(meanOver(base, (s) => s.giniAssigned), 3),
    fmtPct(meanOver(base, (s) => s.maxShareAssigned)),
  ]);
  rows.push([
    'Tham chiếu: ngẫu nhiên (kỳ vọng)',
    fmtMeanCI(seriesOf(base, (s) => s.chancePOnTime)),
    fmt(meanOver(base, (s) => s.chanceRegret), 3),
    fmtPct(meanOver(base, (s) => s.chanceTop1)),
    '–',
    '–',
    '–',
    '–',
  ]);
  return mdTable(
    ['Nhánh', 'P(đúng hạn) [95% CI]', 'Hối tiếc', 'Top-1', 'Top-3', 'MRR', 'Gini (gợi ý)', 'Người nhiều nhất (gợi ý)'],
    rows
  );
}

export interface ArmsReportInput {
  meta: ReportMeta;
  /** Vong kin: cac nhanh chinh + cat bo + tham chieu, da xep theo thu tu hien ra. */
  closed: readonly ArmResult[];
  /** HISTORY: cac nhanh chinh + tham chieu. */
  history: readonly ArmResult[];
}

const CLOSED_MAIN_IDS = ['random', 'round-robin', 'most-free', 'most-frequent', 'exp-only', 'load-only', 'full'];
const ABLATION_IDS = ['full', 'no-avail', 'no-rel', 'no-exp', 'exp-only', 'rel-only', 'load-only'];

const pick = (results: readonly ArmResult[], ids: readonly string[]) => ids.map((id) => need(results, id));

/** Bao cao 7a: bang so sanh nhanh (vong kin), so sanh cap, cat bo, va doi chieu voi phat lai lich su co dinh. */
export function buildArmsReport(input: ArmsReportInput): string {
  const { meta, closed, history } = input;
  const n = meta.seeds.length;
  const refs = ['best-skill', 'oracle'].filter((id) => closed.some((r) => r.id === id));
  const mainRows = [...pick(closed, CLOSED_MAIN_IDS), ...pick(closed, refs)];
  const out: string[] = [];
  out.push('# Đánh giá module gợi ý phân công — so sánh các nhánh (bước 7a)');
  out.push('');
  out.push(
    `${meta.experimentRuns ? 'Ngày lập báo cáo' : 'Ngày chạy'} ${meta.date} · ${n} hạt giống (${meta.seeds[0]}–${meta.seeds[n - 1]}) · ` +
      `giai đoạn đánh giá từ ngày ${meta.minDay} · hệ số phạt tải của thế giới ${fmt(meta.loadPenalty, 2)} · ` +
      `sha256 dữ liệu \`${meta.datasetSha256.slice(0, 16)}…\``
  );
  out.push(...provenanceLines(meta));
  if (n < 20) out.push('', `> **Cảnh báo**: chỉ ${n} hạt giống (< 20) — khoảng tin cậy kém tin cậy, chỉ dùng để chạy thử.`);
  out.push('');
  out.push('## 1. Vòng kín: mỗi nhánh tự giao người xếp đầu, kết quả rút từ mô hình của bộ sinh');
  out.push('');
  out.push(closedLoopTable(mainRows));
  out.push('');
  out.push(
    '*P(đúng hạn)* là chỉ số chính: xác suất đúng hạn kỳ vọng của người được giao (mô hình kết quả của bộ sinh: kỹ năng ẩn + tải thật), ' +
      'trung bình trên các hạt giống, kèm khoảng tin cậy bootstrap 95% theo hạt giống. *Hối tiếc* = kỹ năng ẩn của người giỏi nhất họ bốc trừ kỹ năng của người được chọn (thấp = tốt). ' +
      '*Top-1/Top-3/MRR* tính theo người có kỹ năng ẩn cao nhất (không tính tải nên khả dụng không thể thắng ở đây). ' +
      '*Gini* và *người nhiều nhất* đo mức dồn việc (số việc mỗi người nhận); *người mới* = việc người vào muộn nhận / phần chia đều kỳ vọng. ' +
      '*Đúng hạn thực* = tỉ lệ đúng hạn của các thẻ đã xong đến cuối lịch sử.'
  );
  out.push('');
  out.push('## 2. So sánh cặp đã đăng ký trước (nhánh 1 − nhánh 2, cùng thẻ, cùng may rủi)');
  out.push('');
  out.push(comparisonTable(closed, PRIMARY_COMPARISONS));
  out.push('');
  out.push(
    'Năm phép so sánh chính được chọn trước khi chạy; các phép so sánh khác trong báo cáo chỉ mang tính mô tả. ' +
      `Cột "Hạt giống +/−/=" là số hạt giống (trên ${n}) mà nhánh 1 hơn / kém / bằng nhánh 2. Kết luận chỉ dựa vào việc khoảng tin cậy có chứa 0 hay không.`
  );
  out.push('');
  out.push('## 3. Nghiên cứu cắt bỏ (vòng kín)');
  out.push('');
  out.push(closedLoopTable(pick(closed, ABLATION_IDS)));
  out.push('');
  out.push(
    comparisonTable(closed, [
      ['no-avail', 'full'],
      ['no-rel', 'full'],
      ['no-exp', 'full'],
    ])
  );
  out.push('');
  out.push('## 4. Đối chiếu: phát lại lịch sử cố định (mỗi thẻ được xếp hạng trên lịch sử do bộ sinh tạo)');
  out.push('');
  out.push(historyTable([...pick(history, CLOSED_MAIN_IDS), ...pick(history, refs)], ['full']));
  out.push('');
  out.push(
    'Cách này đo được chất lượng xếp hạng nhưng gợi ý trước không ảnh hưởng thẻ sau nên **không** thấy được việc dồn về một người, ' +
      'tải tự điều chỉnh, hay người mới không được giao thì mãi không có lịch sử. So sánh với bảng 1 cho biết kết luận có phụ thuộc cách đánh giá hay không. ' +
      'Phát lại này cũng nhìn thấy các thẻ giao cùng ngày nhưng xử lý sau (như tải đang mở); vòng kín thì không.'
  );
  out.push('');
  out.push('## Giới hạn (đọc trước khi trích dẫn)');
  out.push('');
  out.push(
    '- Mọi số liệu nằm trong **thế giới giả định của tác giả** (xác suất đúng hạn 0,15 + 0,7·kỹ năng − phạt tải, 25% giao sai, 12% thẻ mơ hồ…). Chúng chứng minh thuật toán hoạt động như thiết kế trong thế giới đó, **không** chứng minh hiệu quả ngoài đời.\n' +
      `- Mỗi bộ chỉ có 6 người, khoảng 105 quyết định. Khoảng tin cậy tính trên ${n} hạt giống (mỗi hạt giống là một đơn vị độc lập), không tính trên từng thẻ.\n` +
      '- Tham số giữ đúng mặc định đã duyệt trước khi chạy; không chọn "cấu hình đẹp nhất" trên các hạt giống này.'
  );
  return out.join('\n');
}
