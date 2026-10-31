// Buoc 19 (ASSIGN_MODULE.md §17.10 "Gini lop 2", §17.12): danh gia lai LOP 2 - chia viec ca dot - khi co thanh phan Ho so. MO TA:
// §17.10 khong dang ky tieu chi dat / khong dat cho lop 2, nen bao cao chi co so lieu + khoang tin cay, KHONG ket luan "tot hon".
// Cung 20 hat giong lop 2 cua buoc 9 (3001-3020 - buoc 9 chi dung de MO TA, khong chon tham so nao), cung cac dot (ngay 90/150/210,
// K = 12), ho so tu khai sinh voi cau hinh MAC DINH da dang ky truoc (§17.10). HAM THUAN, tat dinh; CLI o evalPlanDeclared.ts.
//
// DOC ky nang an (qua evalPlanRun / evalPlanBatches) - CHI nam trong scripts/.

import { DEFAULT_WEIGHTS, LEGACY_WEIGHTS_V1, type Weights } from '../modules/assign/assign.score';
import type { DeclaredDataset } from './evalDeclaredRun';
import { comparePaired } from './evalAssignStats';
import { fmtDiff, fmtMeanCI, verdict } from './evalAssignReport';
import { fmt, fmtPct, mdTable } from './evalMetrics';
import { PLAN_BATCH_DAYS, PLAN_BATCH_K } from './evalPlanBatches';
import { PLAN_ARMS, runPlanArmOnDataset, type PlanArmId, type PlanBatchSummary } from './evalPlanRun';

/** W1 = the gioi mac dinh (co lich su truoc dot); W2 = "nhom moi" (xoa trang moi the giao truoc ngay quyet dinh). */
export type PlanWorld = 'W1' | 'W2';
export const PLAN_WORLDS: readonly PlanWorld[] = ['W1', 'W2'];

export interface PlanDeclaredConfig {
  id: 'full3' | 'full4';
  label: string;
  weights: Weights;
  /** Co dua ho so tu khai vao anh chup khong. */
  withProfiles: boolean;
}

/** Hai cau hinh bo cham: nhu buoc 9 (so lieu da cong bo) va nhu san pham tu buoc 16 (mac dinh moi + ho so). */
export const PLAN_DECLARED_CONFIGS: readonly PlanDeclaredConfig[] = [
  { id: 'full3', label: '3 thành phần (như bước 9, không hồ sơ)', weights: LEGACY_WEIGHTS_V1, withProfiles: false },
  { id: 'full4', label: '4 thành phần (mặc định mới + hồ sơ tự khai)', weights: DEFAULT_WEIGHTS, withProfiles: true },
];

/** Cach chia do: cach san pham dang dung + phuong an "phat 10 diem" con treo tu buoc 9 (xem no co doi khi co Ho so khong). */
export const PLAN_DECLARED_ARMS: readonly PlanArmId[] = ['planned', 'plannedPenalty10'];

export interface PlanDeclaredResult {
  world: PlanWorld;
  configId: PlanDeclaredConfig['id'];
  arm: PlanArmId;
  /** Mot tong hop (da gop cac dot) cho moi hat giong, CUNG thu tu voi datasets. */
  perSeed: PlanBatchSummary[];
}

export function planDeclaredSeries(
  datasets: readonly DeclaredDataset[],
  config: PlanDeclaredConfig,
  world: PlanWorld,
  arm: PlanArmId
): PlanBatchSummary[] {
  return datasets.map((ds) => {
    const s = runPlanArmOnDataset(ds.data, arm, PLAN_BATCH_DAYS, PLAN_BATCH_K, {
      weights: config.weights,
      coldStart: world === 'W2',
      ...(config.withProfiles ? { declared: ds.items } : {}),
    });
    if (!s) throw new Error(`${config.id}/${arm}/${world}: khong cat duoc dot nao tu hat giong ${ds.seed}`);
    return s;
  });
}

/** Moi to hop (the gioi x cau hinh x cach chia). */
export function planDeclaredExperiment(datasets: readonly DeclaredDataset[]): PlanDeclaredResult[] {
  const out: PlanDeclaredResult[] = [];
  for (const world of PLAN_WORLDS) {
    for (const arm of PLAN_DECLARED_ARMS) {
      for (const config of PLAN_DECLARED_CONFIGS) {
        out.push({ world, configId: config.id, arm, perSeed: planDeclaredSeries(datasets, config, world, arm) });
      }
    }
  }
  return out;
}

// ---------- Bao cao ----------

export interface PlanDeclaredMeta {
  date: string;
  seeds: readonly number[];
  datasetSha256: string;
  profilesSha256: string;
}

type Getter = (s: PlanBatchSummary) => number;
const series = (r: PlanDeclaredResult, get: Getter) => r.perSeed.map(get);
const meanOf = (r: PlanDeclaredResult, get: Getter) => {
  const xs = series(r, get);
  return xs.reduce((a, b) => a + b, 0) / xs.length;
};
const armLabel = (arm: PlanArmId) => PLAN_ARMS.find((a) => a.id === arm)!.label;

function need(results: readonly PlanDeclaredResult[], world: PlanWorld, configId: PlanDeclaredConfig['id'], arm: PlanArmId): PlanDeclaredResult {
  const r = results.find((x) => x.world === world && x.configId === configId && x.arm === arm);
  if (!r) throw new Error(`thieu ket qua ${world}/${configId}/${arm}`);
  return r;
}

/** Bang mo ta cua MOT the gioi: moi (cach chia, cau hinh) mot dong. */
export function planDeclaredTable(results: readonly PlanDeclaredResult[], world: PlanWorld): string {
  const rows: string[][] = [];
  for (const arm of PLAN_DECLARED_ARMS) {
    for (const config of PLAN_DECLARED_CONFIGS) {
      const r = need(results, world, config.id, arm);
      rows.push([
        armLabel(arm),
        config.label,
        fmtPct(meanOf(r, (s) => s.maxShare)),
        fmt(meanOf(r, (s) => s.gini), 3),
        fmtMeanCI(series(r, (s) => s.pOnTime)),
        fmt(meanOf(r, (s) => s.regret), 3),
        fmtPct(meanOf(r, (s) => s.top1)),
      ]);
    }
  }
  return mdTable(['Cách chia', 'Bộ chấm', 'Người nhiều nhất', 'Gini', 'P(đúng hạn) [95% CI]', 'Hối tiếc', 'Top-1'], rows);
}

/** 4 thanh phan − 3 thanh phan cho tung (the gioi, cach chia), ghep cap theo hat giong. */
export function planDeclaredDiffTable(results: readonly PlanDeclaredResult[]): string {
  const rows: string[][] = [];
  for (const world of PLAN_WORLDS) {
    for (const arm of PLAN_DECLARED_ARMS) {
      const a = need(results, world, 'full4', arm);
      const b = need(results, world, 'full3', arm);
      const share = comparePaired(series(a, (s) => s.maxShare), series(b, (s) => s.maxShare));
      const gini = comparePaired(series(a, (s) => s.gini), series(b, (s) => s.gini));
      const p = comparePaired(series(a, (s) => s.pOnTime), series(b, (s) => s.pOnTime));
      rows.push([world, armLabel(arm), fmtDiff(share), fmtDiff(gini), fmtDiff(p), verdict(p, true)]);
    }
  }
  return mdTable(
    ['Thế giới', 'Cách chia', 'Δ người nhiều nhất [95% CI]', 'Δ Gini [95% CI]', 'Δ P(đúng hạn) [95% CI]', 'Đúng hạn (4 − 3 thành phần)'],
    rows
  );
}

export function buildPlanDeclaredReport(meta: PlanDeclaredMeta, results: readonly PlanDeclaredResult[]): string {
  const n = meta.seeds.length;
  const out: string[] = [];
  out.push('# Đánh giá lớp 2 (chia việc cả đợt) khi có thành phần Hồ sơ — bước 19');
  out.push('');
  out.push(
    `Ngày chạy ${meta.date} · ${n} hạt giống (${meta.seeds[0]}–${meta.seeds[n - 1]}, cùng bộ của bước 9) · mỗi hạt giống gộp ` +
      `${PLAN_BATCH_DAYS.length} đợt (ngày ${PLAN_BATCH_DAYS.join(', ')}), K = ${PLAN_BATCH_K} thẻ · hồ sơ tự khai theo cấu hình mặc định ` +
      `đã đăng ký (§17.10) · sha256 dữ liệu \`${meta.datasetSha256.slice(0, 16)}…\`, hồ sơ \`${meta.profilesSha256.slice(0, 16)}…\``
  );
  if (n < 20) out.push('', `> **Cảnh báo**: chỉ ${n} hạt giống (< 20) — chỉ dùng để chạy thử.`);
  out.push('');
  out.push(
    '> **Mô tả, không phải kiểm định**: §17.10 chỉ ghi "Gini lớp 2 (bước 19)" trong nhóm chỉ số *phụ*, không đăng ký tiêu chí đạt / không ' +
      'đạt cho lớp 2. Cột "Đúng hạn" chỉ đọc khoảng tin cậy có chứa 0 hay không.'
  );
  for (const world of PLAN_WORLDS) {
    out.push('');
    out.push(world === 'W1' ? '## 1. W1 — thế giới mặc định (có lịch sử trước đợt)' : '## 2. W2 — nhóm mới (không ai có lịch sử / tải trước đợt)');
    out.push('');
    out.push(planDeclaredTable(results, world));
  }
  out.push('');
  out.push('## 3. Chênh lệch 4 thành phần − 3 thành phần (cùng thẻ, cùng hạt giống)');
  out.push('');
  out.push(planDeclaredDiffTable(results));
  out.push('');
  out.push('## Giới hạn');
  out.push('');
  out.push(
    '- Cùng các giới hạn của bước 9 (đợt = lát cắt K thẻ theo thời gian; thế giới giả định của bộ sinh, §7).\n' +
      '- Hồ sơ tự khai là **mô phỏng** với mức trung thực mặc định (30% không khai, 15% khai quá / khai thiếu, một nửa cụm từ trùng từ ' +
      'của thẻ); bước 15 cho thấy lợi ích của Hồ sơ đổi mạnh theo các giả định này — số ở đây chỉ đúng cho đúng một điểm của đường cong.\n' +
      '- W2 xoá trắng cả lịch sử lẫn tải trước đợt: mọi người bắt đầu như nhau, thành phần duy nhất phân biệt được họ lúc đầu đợt là Hồ sơ.'
  );
  return out.join('\n');
}
