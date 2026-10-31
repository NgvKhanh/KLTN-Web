// Dinh dang bao cao danh gia thanh phan "Ho so" (buoc 15). HAM THUAN: chi dung chuoi tu so lieu da tinh.

import type { RunSummary } from './evalAssignRun';
import { fmtDiff, fmtMeanCI, verdict } from './evalAssignReport';
import { comparePaired, mean } from './evalAssignStats';
import {
  CURVES,
  D_RULE_TOLERANCE,
  D_RULE_W1_MARGIN,
  MAIN_ARM_IDS,
  type CurvePoint,
  type DChoice,
  type DSweepRow,
  type LiarResult,
  type MainArmId,
  type MainResult,
  type MissingRow,
  type PrimaryResult,
  type World,
} from './evalDeclaredRun';

const fmt = (x: number, digits = 3) => x.toFixed(digits).replace('.', ',');
const pct = (x: number) => `${fmt(100 * x, 1)}%`;

export const ARM_LABEL: Record<MainArmId, string> = {
  'full-3': 'Đầy đủ-3 (không Hồ sơ)',
  'full-4': 'Đầy đủ-4 (có Hồ sơ)',
  'declared-only': 'Chỉ Hồ sơ',
  random: 'Ngẫu nhiên',
  'exp-only': 'Chỉ kinh nghiệm',
  oracle: 'Tham chiếu: tối ưu',
};

const WORLD_LABEL: Record<World, string> = { W1: 'W1 — mặc định', W2: 'W2 — nhóm mới' };

export function dSweepTable(rows: readonly DSweepRow[], choice: DChoice): string {
  const base = rows.find((r) => r.d === 0)!;
  const out = [
    '| d | P(đúng hạn) W1 | P(đúng hạn) W2 | W1 − (d = 0) | Thoả luật |',
    '|---|---|---|---|---|',
  ];
  for (const r of rows) {
    const w1diff = r.d === 0 ? '–' : fmtDiff(comparePaired(r.w1, base.w1));
    const mark = r.d === choice.d ? '**chọn**' : choice.eligible.includes(r.d) ? 'thoả' : choice.admissible.includes(r.d) ? 'qua W1' : 'kém W1';
    out.push(`| ${fmt(r.d, 2)} | ${fmtMeanCI(r.w1)} | ${fmtMeanCI(r.w2)} | ${w1diff} | ${mark} |`);
  }
  return out.join('\n');
}

export function primaryTable(prims: readonly PrimaryResult[]): string {
  const out = ['| # | So sánh | Thế giới | Chênh lệch [KTC 95%] | Tiêu chí (cận dưới >) | Kết quả |', '|---|---|---|---|---|---|'];
  for (const p of prims) {
    const c = p.comparison;
    out.push(
      `| ${p.id} | ${p.label} | ${p.world} | ${fmtDiff(c)} (${c.positive}/${c.n} hạt giống hơn) | ${p.threshold === 0 ? '0' : fmt(p.threshold)} | ${p.pass ? '**ĐẠT**' : 'KHÔNG ĐẠT'} |`
    );
  }
  return out.join('\n');
}

const avgOf = (xs: readonly (number | null)[]): string => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length === 0 ? '–' : fmt(mean(v), 2);
};

export function descriptiveTable(summaries: Record<MainArmId, RunSummary[]>): string {
  const out = [
    '| Nhánh | P(đúng hạn) [KTC 95%] | Top-1 | Hối tiếc | Gini việc | Người nhiều nhất | Người vào muộn (1 = đều) | Người mới đứng đầu |',
    '|---|---|---|---|---|---|---|---|',
  ];
  for (const id of MAIN_ARM_IDS) {
    const s = summaries[id];
    const m = (f: (x: RunSummary) => number) => mean(s.map(f));
    out.push(
      `| ${ARM_LABEL[id]} | ${fmtMeanCI(s.map((x) => x.pOnTimeAssigned))} | ${pct(m((x) => x.top1Assigned))} | ${fmt(m((x) => x.regretAssigned))} | ${fmt(
        m((x) => x.giniAssigned)
      )} | ${pct(m((x) => x.maxShareAssigned))} | ${avgOf(s.map((x) => x.newcomerParity))} | ${pct(m((x) => x.topNoHistory))} |`
    );
  }
  return out.join('\n');
}

/** Diem hoa von cua mot duong cong: muc DAU TIEN (theo chieu tang) ma day-du-4 KHONG con hon day-du-3 (trung binh chenh lech <= 0). */
export function breakEven(points: readonly CurvePoint[]): number | null {
  const p = points.find((x) => x.diff.mean <= 0);
  return p ? p.value : null;
}

const KNOB_LABEL: Record<keyof typeof CURVES, string> = {
  pOver: 'Xác suất khai quá (pOver)',
  overlap: 'Độ trùng từ với thẻ (overlap)',
  pNone: 'Tỉ lệ người không khai (pNone)',
};

export function curveTable(knob: keyof typeof CURVES, world: World, points: readonly CurvePoint[]): string {
  const out = [
    `| ${KNOB_LABEL[knob]} | P(đúng hạn) đầy đủ-4 | Đầy đủ-4 − đầy đủ-3 [KTC 95%] | Kết luận |`,
    '|---|---|---|---|',
  ];
  for (const p of points) out.push(`| ${fmt(p.value, 2)} | ${fmtMeanCI(p.full4)} | ${fmtDiff(p.diff)} | ${verdict(p.diff, true)} |`);
  const be = breakEven(points);
  out.push('');
  out.push(`${WORLD_LABEL[world]}: điểm hoà vốn (mức đầu tiên mà đầy đủ-4 không còn hơn trung bình) = ${be === null ? 'không có trong dải quét' : fmt(be, 2)}.`);
  return out.join('\n');
}

export function liarTable(results: readonly LiarResult[]): string {
  const out = [
    '| Thế giới | P(đúng hạn) có người khai quá − trung thực [KTC 95%] | Phần việc người đó nhận: trung thực | có khai quá | đầy đủ-3 |',
    '|---|---|---|---|---|',
  ];
  for (const r of results) {
    out.push(`| ${WORLD_LABEL[r.world]} | ${fmtDiff(r.diff)} | ${pct(mean(r.shareHonest))} | ${pct(mean(r.shareLiar))} | ${pct(mean(r.shareFull3))} |`);
  }
  return out.join('\n');
}

export function missingTable(rows: readonly MissingRow[]): string {
  const out = ['| Thế giới | Người không khai = | P(đúng hạn) [KTC 95%] | − NEUTRAL [KTC 95%] | Người vào muộn (1 = đều) |', '|---|---|---|---|---|'];
  for (const r of rows) {
    const neutral = rows.find((x) => x.world === r.world && x.policy === 'NEUTRAL')!;
    const diff = r.policy === 'NEUTRAL' ? '–' : fmtDiff(comparePaired(r.pOnTime, neutral.pOnTime));
    out.push(`| ${WORLD_LABEL[r.world]} | ${r.policy}${r.policy === 'NEUTRAL' ? ' (mặc định)' : ''} | ${fmtMeanCI(r.pOnTime)} | ${diff} | ${avgOf(r.newcomerParity)} |`);
  }
  return out.join('\n');
}

export interface DeclaredMeta {
  date: string;
  seeds: readonly number[];
  datasetSha256: string;
  profileSha256: string;
}

const metaLine = (m: DeclaredMeta) =>
  `Ngày chạy ${m.date} · ${m.seeds.length} hạt giống (${m.seeds[0]}–${m.seeds[m.seeds.length - 1]}) · sha256 dữ liệu \`${m.datasetSha256.slice(0, 16)}…\` · sha256 hồ sơ \`${m.profileSha256.slice(0, 16)}…\``;

export function buildDevReport(meta: DeclaredMeta, rows: readonly DSweepRow[], choice: DChoice): string {
  return [
    '# Chọn trọng số mặc định của thành phần Hồ sơ (bước 15 — pha DEV)',
    '',
    metaLine(meta),
    '',
    `Luật đăng ký trước (§17.10): \`d\` **nhỏ nhất** có P(đúng hạn) ở W2 trong phạm vi ${fmt(D_RULE_TOLERANCE)} của giá trị tốt nhất **và** không kém \`d = 0\` quá ${fmt(D_RULE_W1_MARGIN)} ở W1. **Cách đọc chốt trước khi chạy pha này** (khi chạy thử 2 hạt giống lộ ra hai điều kiện có thể không có giao nếu lấy "tốt nhất" trên mọi \`d\`): (1) chỉ giữ các \`d\` qua điều kiện W1 (luôn có \`d = 0\`); (2) lấy W2 tốt nhất trong tập đó; (3) chọn \`d\` nhỏ nhất trong phạm vi ${fmt(D_RULE_TOLERANCE)} của giá trị đó. Chỉ số: xác suất đúng hạn kỳ vọng của người được giao, vòng kín, trung bình theo hạt giống.`,
    '',
    dSweepTable(rows, choice),
    '',
    `- \`d\` cho W2 cao nhất trên mọi \`d\`: ${fmt(choice.bestW2D, 2)}; qua điều kiện W1: ${choice.admissible.map((x) => fmt(x, 2)).join(', ')}; trong phạm vi W2: ${choice.eligible.map((x) => fmt(x, 2)).join(', ')}.`,
    `- **Chọn \`d\` = ${fmt(choice.d, 2)}**${choice.d === 0 ? ` — kết luận: thành phần Hồ sơ KHÔNG đáng đưa vào mặc định; sản phẩm để mức sàn ${fmt(choice.productD, 2)} để nhóm tự học.` : '.'}`,
    '- Đây là hạt giống DEV (chọn tham số). Số liệu để trích dẫn là pha XÁC NHẬN trên 4001–4020 (`eval-declared-result.md`).',
  ].join('\n');
}

export interface ConfirmReportInput {
  meta: DeclaredMeta;
  main: MainResult;
  curves: { knob: keyof typeof CURVES; world: World; points: CurvePoint[] }[];
  liar: LiarResult[];
  missing: MissingRow[];
}

export function buildConfirmReport(input: ConfirmReportInput): string {
  const { meta, main } = input;
  const passed = main.primary.filter((p) => p.pass).length;
  const out = [
    '# Đánh giá thành phần Hồ sơ (hồ sơ tự khai) — bước 15, pha XÁC NHẬN',
    '',
    metaLine(meta),
    '',
    `Cấu hình chốt TRƯỚC khi chạy: \`d\` = ${fmt(main.d, 2)} (chọn trên hạt giống dev 9801–9820), trọng số mặc định (1 − d)·(0,45; 0,30; 0,25) + d; hồ sơ sinh theo núm mặc định §17.10 (θ 0,5 · khai quá 0,15 · khai thiếu 0,15 · trùng từ 0,5 · không khai 0,3). Chạy MỘT lần; không chỉnh gì sau khi thấy số.`,
    '',
    '## Bốn so sánh chính (đăng ký trước)',
    '',
    primaryTable(main.primary),
    '',
    `**${passed}/${main.primary.length} so sánh đạt tiêu chí.** W3: ${main.w3.seedsWithCold}/${meta.seeds.length} hạt giống có quyết định lạnh, trung bình ${fmt(mean(main.w3.cards.length ? main.w3.cards : [0]), 1)} thẻ lạnh / hạt giống (xác định trên thế giới của đầy đủ-3, đo hai nhánh trên cùng các thẻ).`,
    '',
    '## Mô tả theo thế giới',
    '',
    '### W1 — mặc định',
    '',
    descriptiveTable(main.summaries.W1),
    '',
    '### W2 — nhóm mới (không ai có lịch sử khi bắt đầu)',
    '',
    descriptiveTable(main.summaries.W2),
    '',
    '## Đường cong theo mức trung thực của người khai',
    '',
  ];
  for (const c of input.curves) {
    out.push(`### ${KNOB_LABEL[c.knob]} — ${WORLD_LABEL[c.world]}`, '', curveTable(c.knob, c.world, c.points), '');
  }
  out.push(
    '## Một người cố tình khai mọi chủ đề',
    '',
    'Người khai quá = người có kỹ năng ẩn trung bình thấp nhất lúc vào nhóm (trường hợp xấu nhất); mọi người khác giữ hồ sơ như trên.',
    '',
    liarTable(input.liar),
    '',
    '## Người không khai: DROP / NEUTRAL / ZERO',
    '',
    missingTable(input.missing),
    '',
    '## Giới hạn (phải nêu trong luận văn)',
    '',
    '- Kết quả phụ thuộc giả định người ta khai trung thực tới đâu và từ khai trùng từ của thẻ tới đâu — vì vậy báo **đường cong**, không một con số.',
    '- Vẫn là thế giới mô phỏng (§7): chứng minh thuật toán hoạt động như thiết kế, không chứng minh hiệu quả ngoài đời.',
    '- Chưa làm (khác đăng ký §17.10): so sánh "max" với "trung bình 2 mục cao nhất"; học trọng số với trưởng nhóm giả tin / không tin hồ sơ; Gini lớp 2 để bước 19.',
    '- Mỗi hạt giống là một đơn vị độc lập cho khoảng tin cậy (bootstrap cặp 10 000 lần).'
  );
  return out.join('\n');
}
