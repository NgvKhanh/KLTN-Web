// Bao cao danh gia module canh bao tre han (RISK_MODULE.md §13). Chay trong backend/:
//   npm run eval:risk                      -> hat giong DEV (6101-6120), ghi eval-risk-dev.md (tham do, chon tham so)
//   npm run eval:risk -- --phase=confirm   -> hat giong XAC NHAN (6201-6220), ghi eval-risk-result.md - CHAY DUNG MOT LAN (buoc 8)
// Mo hinh chinh doc tu tep model/risk-model.v1.json (khong hoc lai); tap hoc dung lai tu hat giong ghi trong tep va PHAI cung
// ma bam - lech nghia la tep mo hinh cu hon bo mo phong / dac trung -> chay lai `npm run risk:train`.
// `--sim=v2` (buoc 11-12, §20): mo hinh model/risk-model.v2.json tren the gioi v2 (dev 7101-7120, xac nhan 7201-7220) ->
// eval-risk-dev-v2.md / eval-risk-result-v2.md; ban xac nhan v2 co them P5 (do ben tren the gioi v1) va P6 (tat tung co che).

import fs from 'node:fs';
import path from 'node:path';
import { FEATURE_NAMES, type ExtractedFeatures } from '../modules/risk/risk.features';
import { assessWithModel, assessWithRules, modelInput, type NamedModel, type RiskAssessment } from '../modules/risk/risk.explain';
import { predictProbability, validateModelFile, type RiskModelFile } from '../modules/risk/risk.model';
import { Rng } from './simGenerator';
import { comparePaired, summarizeSeeds, type Interval } from './evalAssignStats';
import {
  ARMS,
  buildEvalSet,
  buildPredictors,
  buildTrainSet,
  metricsOf,
  runTimeline,
  scoreRows,
  timelineSummary,
  trainArm,
  type ArmName,
  type SeedMetrics,
  type WorldRows,
} from './riskEval';
import { calibrationTable, ece, type Scored } from './riskMetrics';
import { MECHANISMS, seedsOf, type Mechanism } from './riskSimV2';
import { HORIZONS, hashRows } from './riskSnapshots';
import { MODEL_PATHS, MODEL_SPECS, modelArg, type ModelKey } from './trainRisk';

export const ARM_LABEL: Readonly<Record<ArmName, string>> = {
  logreg: 'Mô hình chính (logistic, ràng buộc dấu)',
  logregFree: 'Logistic không ràng buộc dấu',
  rules: 'Luật cố định (§6.4)',
  timeOnly: 'Chỉ thời gian còn lại',
  timeProgress: 'Thời gian còn lại + tiến độ',
  timeStatus: 'Thời gian còn lại + trạng thái',
  noActivity: 'Bỏ tần suất hoạt động',
  noPeople: 'Bỏ lịch sử người được giao',
  noSimilar: 'Bỏ thẻ tương tự',
  baseRate: 'Luôn trả tỉ lệ trễ của tập học',
};

const REASON_LABEL: Readonly<Record<string, string>> = {
  BEHIND_SCHEDULE: 'Chậm so với tiến độ kỳ vọng',
  LITTLE_TIME: 'Còn ít thời gian',
  HIGH_COMPLEXITY: 'Độ phức tạp cao (≥ 5 điểm)',
  SUBTASKS_LEFT: 'Checklist còn nhiều mục',
  BLOCKED: 'Đang / từng bị chặn',
  ASSIGNEE_LATE_HISTORY: 'Người được giao hay trễ',
  ASSIGNEE_SLOW: 'Theo tốc độ thường ngày không kịp',
  NO_ASSIGNEE: 'Chưa có ai được giao',
  SIMILAR_LATE: 'Thẻ tương tự hay trễ',
};

const MECH_LABEL: Readonly<Record<Mechanism, string>> = {
  M1: 'M1 thẻ chưa người nhận + tự nhận việc',
  M2: 'M2 trì hoãn + bỏ quên',
  M3: 'M3 kỷ luật trạng thái + đánh dấu Xong muộn',
  M4: 'M4 checklist + story point theo nhóm',
  M6: 'M6 lập kế hoạch trước',
};

const vn = (x: number, d = 3) => x.toFixed(d).replace('.', ',');
const signed = (x: number, d = 3) => `${x >= 0 ? '+' : ''}${vn(x, d)}`;
const ci = (s: Interval, d = 3) => `${vn(s.mean, d)} [${vn(s.lo, d)}; ${vn(s.hi, d)}]`;
const ciSigned = (s: Interval, d = 3) => `${signed(s.mean, d)} [${signed(s.lo, d)}; ${signed(s.hi, d)}]`;
const pct = (x: number | null) => (x === null ? '—' : `${vn(100 * x, 1)}%`);
const verdict = (s: Interval) => (s.lo > 0 ? 'nhánh 1 tốt hơn' : s.hi < 0 ? 'nhánh 1 kém hơn' : 'chưa phân biệt được');

function nonNull(xs: (number | null)[]): number[] {
  return xs.filter((x): x is number => x !== null && Number.isFinite(x));
}

/** ECE gop moi anh chup cua cac hat giong + khoang tin cay bootstrap THEO HAT GIONG (lay mau lai ca hat giong, gop roi tinh). */
export function pooledEce(perSeed: readonly Scored[][], resamples = 2000, seed = 20261026): Interval {
  const point = ece(perSeed.flat());
  const rng = new Rng(seed);
  const vals: number[] = [];
  for (let b = 0; b < resamples; b += 1) {
    const pick: Scored[] = [];
    for (let i = 0; i < perSeed.length; i += 1) pick.push(...perSeed[rng.int(perSeed.length)]!);
    vals.push(ece(pick));
  }
  vals.sort((a, b) => a - b);
  return { mean: point, lo: vals[Math.floor(0.025 * (resamples - 1))]!, hi: vals[Math.ceil(0.975 * (resamples - 1))]! };
}

/**
 * Doc tep mo hinh; tep phai hoc dung bo mo phong (`training.sim`, vang mat = v1) va dung tap dac trung (`training.features`,
 * vang mat = du 15) cua mo hinh `key`.
 */
export function loadModelFile(key: ModelKey, file: string = MODEL_PATHS[key]): RiskModelFile {
  const spec = MODEL_SPECS[key];
  const model = validateModelFile(JSON.parse(fs.readFileSync(file, 'utf8')));
  if ((model.training.sim ?? 'v1') !== spec.sim) throw new Error(`${path.basename(file)} khong hoc tren bo mo phong ${spec.sim}`);
  // Tap dau vao that su dung: v3 ghi o training.features (tep 15 cot), v4 la chinh `features` (tep gon), v1/v2 du 15
  const used: readonly string[] = model.training.features ?? model.features;
  if (used.length !== spec.features.length || used.some((n, i) => n !== spec.features[i])) {
    throw new Error(`${path.basename(file)} khong dung tap dac trung cua mo hinh ${key}`);
  }
  return model;
}

/**
 * Cac phep so sanh cua bao cao (nhanh 1, nhanh 2, nhan). Mo hinh tap con (v3, v4): cac nhanh "bo bot dac trung" cua 15 dac trung
 * khong con y nghia -> chi P1, P2 (moc so P2 theo spec: "thoi gian + tien do", v4: "thoi gian + trang thai") + mo ta.
 */
export function comparisonPairs(key: ModelKey): [ArmName, ArmName, string][] {
  const spec = MODEL_SPECS[key];
  if (spec.features.length >= FEATURE_NAMES.length) {
    return [
      ['logreg', 'rules', 'P1'],
      ['logreg', 'timeProgress', 'P2'],
      ['logreg', 'noActivity', 'P4'],
      ['logreg', 'logregFree', 'phụ'],
      ['logreg', 'noPeople', 'phụ'],
      ['logreg', 'noSimilar', 'phụ'],
      ['logreg', 'timeOnly', 'phụ'],
      ['logreg', 'baseRate', 'phụ'],
    ];
  }
  const p2Arm = spec.p2Arm ?? 'timeProgress';
  return [
    ['logreg', 'rules', 'P1'],
    ['logreg', p2Arm, 'P2'],
    ...(p2Arm !== 'timeProgress' ? ([['logreg', 'timeProgress', 'phụ']] as [ArmName, ArmName, string][]) : []),
    ['logreg', 'timeOnly', 'phụ'],
    ['logreg', 'baseRate', 'phụ'],
  ];
}

/** Hat giong danh gia: dev chung theo bo mo phong; xac nhan rieng tung mo hinh (v3 dung dai moi 7301-7320, §21.4). */
export function evalSeedsOf(key: ModelKey, phase: 'dev' | 'confirm'): number[] {
  const spec = MODEL_SPECS[key];
  return phase === 'dev' ? seedsOf(spec.sim).dev : [...spec.confirm];
}

export function runEvaluation(phase: 'dev' | 'confirm', log: (s: string) => void = console.log, key: ModelKey = 'v1') {
  const t0 = Date.now();
  const spec = MODEL_SPECS[key];
  const sim = spec.sim;
  const model = loadModelFile(key);
  const train = buildTrainSet(model.training.seeds, sim);
  if (hashRows(train.rows) !== model.training.sha256) {
    throw new Error('tap hoc dung lai KHONG khop ma bam trong tep mo hinh - chay lai `npm run risk:train`');
  }
  const predictors = buildPredictors(model, train.rows, model.train);
  const seeds = evalSeedsOf(key, phase);
  const evalSet = buildEvalSet(seeds, model.priors, sim);
  log(`${phase}: ${seeds.length} hat giong, ${evalSet.reduce((a, w) => a + w.rows.length, 0)} anh chup; ${Date.now() - t0} ms`);

  const scored = {} as Record<ArmName, Scored[][]>;
  const perSeed = {} as Record<ArmName, SeedMetrics[]>;
  for (const arm of ARMS) {
    scored[arm] = evalSet.map((w) => scoreRows(w.rows, predictors[arm]));
    perSeed[arm] = scored[arm].map(metricsOf);
  }
  const aucOf = (arm: ArmName) => perSeed[arm].map((m) => m.auc ?? Number.NaN);

  const byHorizon = HORIZONS.map((h) => ({
    h,
    auc: summarizeSeeds(nonNull(evalSet.map((w) => metricsOf(scoreRows(w.rows.filter((r) => r.horizon === h), predictors.logreg)).auc))),
    rows: evalSet.reduce((a, w) => a + w.rows.filter((r) => r.horizon === h).length, 0),
  }));

  // Mo phong bo quet theo ngay: mo hinh chinh va luat co dinh
  const reasonCount: Record<string, number> = {};
  let warnTotal = 0;
  const modelAssess = (f: ExtractedFeatures): RiskAssessment => {
    const a = assessWithModel(model, model.version, f);
    if (a.score >= 51) {
      warnTotal += 1;
      for (const r of a.reasons) reasonCount[r.code] = (reasonCount[r.code] ?? 0) + 1;
    }
    return a;
  };
  const timelines = {
    logreg: evalSet.map((w) => timelineSummary(runTimeline(w.world, model.priors, modelAssess))),
    rules: evalSet.map((w) => timelineSummary(runTimeline(w.world, model.priors, assessWithRules))),
  };
  log(`xong mo phong bo quet; ${Date.now() - t0} ms`);

  const subset = spec.features.length < FEATURE_NAMES.length;
  const pairs = comparisonPairs(key);
  const comparisons = pairs.map(([a, b, tag]) => ({ a, b, tag, auc: comparePaired(aucOf(a), aucOf(b)), brier: comparePaired(perSeed[a].map((m) => m.brier), perSeed[b].map((m) => m.brier)) }));
  const eceLogreg = pooledEce(scored.logreg);

  // P4v3 (§21.4): so voi mo hinh lien truoc (15 dac trung) tren CUNG anh chup - hai mo hinh hoc tren cung hat giong nen cung priors
  let vsPrevious: { version: string; auc: Interval; diff: ReturnType<typeof comparePaired>; pass: boolean } | null = null;
  if (subset && spec.previous) {
    const prev = loadModelFile(spec.previous);
    if (JSON.stringify(prev.priors) !== JSON.stringify(model.priors)) throw new Error('priors hai mo hinh khac nhau - khong so tren cung anh chup duoc');
    const aPrev = aucPerSeed(evalSet, prev);
    const diff = comparePaired(aucOf('logreg'), aPrev);
    vsPrevious = { version: prev.version, auc: summarizeSeeds(aPrev), diff, pass: diff.mean >= -0.02 };
  }

  return { phase, key, sim, seeds, model, train, evalSet, perSeed, scored, byHorizon, timelines, reasonCount, warnTotal, comparisons, eceLogreg, vsPrevious, ms: Date.now() - t0 };
}

const aucPerSeed = (worlds: readonly WorldRows[], m: NamedModel) =>
  worlds.map((w) => metricsOf(scoreRows(w.rows, (f) => predictProbability(m, modelInput(m, f)))).auc ?? Number.NaN);

/**
 * P5 (§20.4): do ben - AUC `logreg-v2` − `logreg-v1` cham tren the gioi v1 XAC NHAN (6201-6220), ghep cap theo hat giong.
 * Moi mo hinh dung priors cua chinh no (nhu khi chay that). Dat khi trung binh chenh lech >= -0,02.
 */
export function runRobustnessP5(v2: RiskModelFile, v1: RiskModelFile = loadModelFile('v1')) {
  const seeds = seedsOf('v1').confirm;
  const a2 = aucPerSeed(buildEvalSet(seeds, v2.priors, 'v1'), v2);
  const a1 = aucPerSeed(buildEvalSet(seeds, v1.priors, 'v1'), v1);
  const diff = comparePaired(a2, a1);
  return { seeds, v2: summarizeSeeds(a2), v1: summarizeSeeds(a1), diff, pass: diff.mean >= -0.02 };
}

/**
 * P6 (§20.4, chi mo ta): voi tung co che - hoc lai tren 7001-7040 voi co che do TAT (cung lambda + rang buoc dau cua mo hinh v2),
 * cham tren 7201-7220 cung tat co che do. Cho biet ket luan dua vao gia dinh nao.
 */
export function runMechanismAblation(v2: RiskModelFile, log: (s: string) => void = console.log) {
  const seeds = seedsOf('v2');
  return MECHANISMS.map((mechanism) => {
    const t0 = Date.now();
    const train = buildTrainSet(seeds.train, 'v2', [mechanism]);
    const m = trainArm(train.rows, FEATURE_NAMES, v2.train);
    const evalSet = buildEvalSet(seeds.confirm, train.priors, 'v2', [mechanism]);
    const scored = evalSet.map((w) => scoreRows(w.rows, (f) => predictProbability(m, f.vector)));
    const rows = scored.reduce((a, s) => a + s.length, 0);
    const late = scored.reduce((a, s) => a + s.filter((x) => x.y === 1).length, 0);
    const auc = summarizeSeeds(nonNull(scored.map((s) => metricsOf(s).auc)));
    log(`  P6 tat ${mechanism}: AUC ${auc.mean.toFixed(3)}; ${Date.now() - t0} ms`);
    return { mechanism, auc, ece: ece(scored.flat()), rows, lateRate: late / rows, weights: m.weights };
  });
}

export interface V2Extras {
  p5: ReturnType<typeof runRobustnessP5>;
  p6: ReturnType<typeof runMechanismAblation>;
}

export function renderReport(r: ReturnType<typeof runEvaluation>, date: string, extras?: V2Extras): string {
  const L: string[] = [];
  const { model } = r;
  const k = r.key;
  const tag = (t: string) => (k !== 'v1' && t !== 'phụ' ? `${t}${k}` : t);
  const rowsTotal = r.evalSet.reduce((a, w) => a + w.rows.length, 0);
  const posTotal = r.evalSet.reduce((a, w) => a + w.rows.filter((x) => x.y === 1).length, 0);
  const step = ({ v1: [5, 8], v2: [11, 12], v3: [16, 17], v4: [21, 22] } as const)[k][r.phase === 'dev' ? 0 : 1];
  const title =
    `${r.phase === 'dev' ? 'thăm dò trên hạt giống dev' : 'chính thức trên hạt giống xác nhận'} (bước ${step})` +
    ({ v1: '', v2: ' — bộ mô phỏng v2', v3: ' — mô hình 4 yếu tố (bộ mô phỏng v2)', v4: ' — mô hình trạng thái + số ngày còn lại (bộ mô phỏng v2)' } as const)[k];
  L.push(`# Đánh giá module cảnh báo nguy cơ trễ hạn — ${title}`, '');
  L.push(
    `Ngày chạy ${date} · ${r.seeds.length} hạt giống (${r.seeds[0]}–${r.seeds.at(-1)}) · ${rowsTotal} ảnh chụp (${pct(posTotal / rowsTotal)} trễ) · ` +
      `mô hình \`${model.version}\`, λ = ${String(model.train.lambda).replace('.', ',')}, học trên ${model.training.rows} ảnh chụp của ${model.training.seeds.length} thế giới · ` +
      `sha256 tập học \`${model.training.sha256.slice(0, 16)}…\``,
    ''
  );

  L.push('## 1. Các nhánh trên ảnh chụp quá khứ (mốc 7 / 3 / 1 ngày trước hạn)', '');
  L.push('| Nhánh | AUC [95% CI] | Brier | Log-loss | ECE gộp | Chính xác @51 | Phủ @51 | Chính xác @76 | Phủ @76 |', '|---|---|---|---|---|---|---|---|---|');
  for (const arm of ARMS) {
    const m = r.perSeed[arm];
    const mean = (xs: (number | null)[]) => {
      const v = nonNull(xs);
      return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    const aucS = summarizeSeeds(nonNull(m.map((x) => x.auc)));
    L.push(
      `| ${ARM_LABEL[arm]} | ${ci(aucS)} | ${vn(mean(m.map((x) => x.brier))!)} | ${vn(mean(m.map((x) => x.logLoss))!)} | ${vn(ece(r.scored[arm].flat()))} | ` +
        `${pct(mean(m.map((x) => x.precision51)))} | ${pct(mean(m.map((x) => x.recall51)))} | ${pct(mean(m.map((x) => x.precision76)))} | ${pct(mean(m.map((x) => x.recall76)))} |`
    );
  }
  L.push(
    '',
    '*AUC*: xác suất nhánh chấm một ảnh chụp trễ cao hơn một ảnh chụp đúng hạn (0,5 = đoán bừa), trung bình trên các hạt giống, kèm khoảng tin cậy bootstrap 95%. ' +
      '*Brier* và *log-loss* càng nhỏ càng tốt. *ECE gộp*: sai số hiệu chỉnh trên toàn bộ ảnh chụp (10 khoảng). ' +
      '*Chính xác @51*: trong các ảnh chụp có điểm ≥ 51 (mức Cảnh báo), bao nhiêu % thật sự trễ; *Phủ @51*: trong các ảnh chụp trễ, bao nhiêu % có điểm ≥ 51.',
    ''
  );

  L.push(
    ({ v1: '## 2. Bốn so sánh chính đăng ký trước (§13)', v2: '## 2. Các so sánh chính đăng ký trước (§20.4)', v3: '## 2. Các so sánh chính đăng ký trước (§21.4)', v4: '## 2. Các so sánh chính đăng ký trước (§22.4)' } as const)[k],
    ''
  );
  L.push('| # | So sánh (nhánh 1 − nhánh 2) | Δ AUC [95% CI] | Kết luận | Đạt? |', '|---|---|---|---|---|');
  for (const c of r.comparisons.filter((x) => x.tag !== 'phụ')) {
    L.push(`| ${tag(c.tag)} | ${ARM_LABEL[c.a]} − ${ARM_LABEL[c.b]} | ${ciSigned(c.auc)} | ${verdict(c.auc)} (${c.auc.positive}/${c.auc.n} hạt giống dương) | ${c.auc.lo > 0 ? 'ĐẠT' : 'KHÔNG ĐẠT'} |`);
  }
  L.push(`| ${tag('P3')} | ECE gộp của mô hình chính ≤ 0,05 | ${ci(r.eceLogreg)} | — | ${r.eceLogreg.mean <= 0.05 ? 'ĐẠT' : 'KHÔNG ĐẠT'} |`);
  if (r.vsPrevious) {
    const p = r.vsPrevious;
    L.push(
      `| ${tag('P4')} | \`${model.version}\` − \`${p.version}\`${k === 'v3' ? ' (15 đặc trưng)' : ''}, cùng ảnh chụp | ${ciSigned(p.diff)} | ` +
        `${model.version} ${ci(summarizeSeeds(nonNull(r.perSeed.logreg.map((m) => m.auc))))} · ${p.version} ${ci(p.auc)} | ${p.pass ? 'ĐẠT' : 'KHÔNG ĐẠT'} |`
    );
  }
  if (extras) {
    const p5 = extras.p5;
    L.push(
      `| P5 | \`logreg-v2\` − \`logreg-v1\` trên thế giới **v1** xác nhận (${p5.seeds[0]}–${p5.seeds.at(-1)}) | ${ciSigned(p5.diff)} | ` +
        `v2 ${ci(p5.v2)} · v1 ${ci(p5.v1)} | ${p5.pass ? 'ĐẠT' : 'KHÔNG ĐẠT'} |`
    );
  }
  L.push('');
  L.push(
    `${['P1', 'P2', ...(r.vsPrevious ? [] : ['P4'])].map(tag).join(', ')} đạt khi khoảng tin cậy của chênh lệch AUC (ghép cặp theo hạt giống) nằm hẳn trên 0. ` +
      `${tag('P3')} đo ECE **gộp** mọi ảnh chụp (ECE từng hạt giống chỉ ~240 dòng nên bị lệch lên do mẫu nhỏ); khoảng tin cậy lấy mẫu lại theo hạt giống.`,
    ''
  );
  if (r.vsPrevious) {
    L.push(
      `${tag('P4')} đạt khi **trung bình** chênh lệch ≥ −0,02: ` +
        (k === 'v3'
          ? 'rút gọn còn 4 yếu tố không làm tụt quá 0,02 AUC so với mô hình 15 đặc trưng. '
          : `thay "tiến độ so với kỳ vọng" bằng trạng thái + số ngày còn lại không làm tụt quá 0,02 AUC so với \`${r.vsPrevious.version}\`. `) +
        'Hai mô hình học trên cùng hạt giống nên dùng chung priors và chấm trên cùng ảnh chụp.',
      ''
    );
  }
  if (k === 'v2') {
    const p4 = r.comparisons.find((c) => c.tag === 'P4')!;
    L.push(
      p4.auc.lo > 0
        ? 'P4v2 đạt **vì** bộ mô phỏng v2 có cơ chế M2 (trì hoãn / bỏ quên): khi đó "lâu không hoạt động" đúng là dấu hiệu trễ. ' +
            'Đây là kết quả **phụ thuộc giả định** của bộ mô phỏng, không phải bằng chứng trên dữ liệu thật (§20.4).'
        : 'P4v2 không đạt: kể cả khi bộ mô phỏng có trì hoãn / bỏ quên (M2), thêm tần suất hoạt động không làm AUC tăng rõ so với bản bỏ nó.',
      ''
    );
  }
  if (extras) {
    L.push(
      'P5 đạt khi **trung bình** chênh lệch ≥ −0,02 (mô hình v2 không được tụt quá 0,02 AUC trên kiểu nhóm cũ); mỗi mô hình dùng priors ' +
        'của chính nó, như khi chạy thật.',
      ''
    );
  }

  L.push('## 3. So sánh phụ (mô tả)', '');
  L.push('| So sánh (nhánh 1 − nhánh 2) | Δ AUC [95% CI] | Δ Brier [95% CI] | Kết luận (AUC) |', '|---|---|---|---|');
  for (const c of r.comparisons.filter((x) => x.tag === 'phụ')) {
    L.push(`| ${ARM_LABEL[c.a]} − ${ARM_LABEL[c.b]} | ${ciSigned(c.auc)} | ${ciSigned(c.brier)} | ${verdict(c.auc)} |`);
  }
  L.push('', 'Brier nhỏ hơn là tốt hơn (Δ Brier âm = nhánh 1 tốt hơn).', '');

  L.push('## 4. Mô hình chính theo mốc trước hạn', '');
  L.push('| Mốc | Ảnh chụp | AUC [95% CI] |', '|---|---|---|');
  for (const h of r.byHorizon) L.push(`| ${h.h} ngày | ${h.rows} | ${ci(h.auc)} |`);
  L.push('');

  L.push('## 5. Mô phỏng bộ quét theo ngày (§8.3: báo "có nguy cơ" một lần khi ≥ Cảnh báo, vùng đệm ≤ 40, đổi hạn thì đặt lại)', '');
  L.push('| Chỉ số | Mô hình chính | Luật cố định |', '|---|---|---|');
  const tl = (arm: 'logreg' | 'rules', k: keyof ReturnType<typeof timelineSummary>, d = 3) => {
    const v = nonNull(r.timelines[arm].map((s) => s[k]));
    return v.length >= 2 ? ci(summarizeSeeds(v), d) : '—';
  };
  L.push(`| Lần báo / người / tuần | ${tl('logreg', 'notificationsPerPersonWeek')} | ${tl('rules', 'notificationsPerPersonWeek')} |`);
  L.push(`| Độ phủ: thẻ rốt cuộc trễ được báo trước hạn | ${tl('logreg', 'coverage')} | ${tl('rules', 'coverage')} |`);
  L.push(`| Báo trước hạn (trung vị ngày, lần báo đầu) | ${tl('logreg', 'medianLeadDays', 2)} | ${tl('rules', 'medianLeadDays', 2)} |`);
  L.push(`| Báo nhầm: thẻ được báo mà xong đúng hạn (hạn lúc báo) | ${tl('logreg', 'falseAlarmRate')} | ${tl('rules', 'falseAlarmRate')} |`);
  L.push(`| Lần đánh giá ≥ Cảnh báo không có lý do hiển thị | ${tl('logreg', 'emptyReasonRate')} | ${tl('rules', 'emptyReasonRate')} |`);
  L.push(
    '',
    'Quét lúc 09:00 mỗi ngày (bộ quét thật chạy 30 phút một lần), chỉ thẻ đang mở có hạn trong 14 ngày tới; thẻ đã quá hạn không tính (luôn 100%). ' +
      '"Lần báo" đếm theo thẻ — mỗi lần là một thông báo cho **mỗi** người nhận (người được giao, chủ / quản trị bảng, người theo dõi).',
    ''
  );

  L.push('## 6. Lý do hiển thị của mô hình chính (trong các lần đánh giá ≥ Cảnh báo)', '');
  L.push('| Lý do | Tỉ lệ xuất hiện |', '|---|---|');
  for (const [code, n] of Object.entries(r.reasonCount).sort((a, b) => b[1] - a[1])) {
    L.push(`| ${REASON_LABEL[code] ?? code} | ${pct(n / Math.max(1, r.warnTotal))} |`);
  }
  L.push('', `Trên ${r.warnTotal} lần đánh giá ≥ 51 điểm của bộ quét (mô hình chính). Một lần đánh giá có tối đa 3 lý do.`, '');

  L.push('## 7. Hệ số của mô hình chính (sau chuẩn hoá z, ràng buộc dấu)', '');
  L.push('| Đặc trưng | Chiều lẽ thường | Hệ số |', '|---|---|---|');
  const usedFeatures = new Set<string>(model.training.features ?? model.features);
  model.features.forEach((n, j) => {
    const sgn = model.train.signs?.[j];
    L.push(`| \`${n}\` | ${sgn === 1 ? '+' : sgn === -1 ? '−' : 'tự do'} | ${usedFeatures.has(n) ? signed(model.weights[j]!, 4) : '— (không dùng)'} |`);
  });
  L.push(`| hệ số chặn | — | ${signed(model.bias, 4)} |`, '');
  L.push('Hệ số bằng 0 = dữ liệu muốn đặc trưng đó đi **ngược** chiều lẽ thường (thường do tương quan với đặc trưng khác), ràng buộc dấu giữ ở 0.', '');

  L.push('## 8. Bảng hiệu chỉnh (mô hình chính, gộp)', '');
  L.push('| Khoảng điểm | Ảnh chụp | Xác suất dự đoán TB | Tỉ lệ trễ thật |', '|---|---|---|---|');
  for (const b of calibrationTable(r.scored.logreg.flat())) {
    if (b.n === 0) continue;
    L.push(`| ${Math.round(100 * b.from)}–${Math.round(100 * b.to)} | ${b.n} | ${vn(b.meanP!)} | ${vn(b.lateRate!)} |`);
  }
  L.push('');
  if (extras) {
    L.push('## 9. P6 — tắt từng cơ chế (chỉ mô tả, §20.4)', '');
    L.push(
      `| Cơ chế tắt | AUC [95% CI] trên ${r.seeds[0]}–${r.seeds.at(-1)} (cùng tắt) | ECE gộp | Tỉ lệ trễ (ảnh chụp) | Hệ số khác 0 |`,
      '|---|---|---|---|---|'
    );
    const nonzero = (w: readonly number[]) => FEATURE_NAMES.filter((_, j) => w[j] !== 0).map((n) => `\`${n}\``).join(', ');
    L.push(`| (không tắt — mô hình chính) | ${ci(summarizeSeeds(nonNull(r.perSeed.logreg.map((m) => m.auc))))} | ${vn(ece(r.scored.logreg.flat()))} | ${pct(posTotal / rowsTotal)} | ${nonzero(model.weights)} |`);
    for (const x of extras.p6) {
      L.push(`| ${MECH_LABEL[x.mechanism]} | ${ci(x.auc)} | ${vn(x.ece)} | ${pct(x.lateRate)} | ${nonzero(x.weights)} |`);
    }
    L.push(
      '',
      'Mỗi dòng học lại trên 7001–7040 với cơ chế đó **tắt** (cùng λ, cùng ràng buộc dấu) rồi chấm trên thế giới xác nhận cũng tắt cơ chế đó. ' +
        'Hệ số một đặc trưng về 0 khi tắt một cơ chế nghĩa là tín hiệu của đặc trưng đó đến từ cơ chế ấy.',
      ''
    );
  }
  L.push(`## ${extras ? 10 : 9}. Cách đọc`, '');
  L.push(
    k !== 'v1'
      ? 'Số liệu đo trên **bộ mô phỏng vòng đời v2** (§20): mỗi thế giới rút một bộ thói quen nhóm ẩn trong khoảng rộng (M1–M4, M6), từ nhóm ' +
          'ngăn nắp tới nhóm lỏng lẻo; đúng / trễ hạn vẫn sinh ra từ quá trình làm việc từng ngày. Hai thống kê hoạt động của CSDL dev nằm ' +
          'ngoài dải các thế giới học (giới hạn đã chấp nhận ngày 27/10, §20.4) nên kết luận không áp dụng cho kiểu "bảng tạo rồi bỏ dở". ' +
          'Kết quả **không** chứng minh độ chính xác khi dùng thật (§7.3).' +
          (k === 'v3' ? ' Mô hình chỉ dùng 4 yếu tố (§21.2); các đặc trưng khác vẫn được tính nhưng hệ số cố định 0.' : '') +
          (k === 'v4'
            ? ' Mô hình dùng trạng thái hiện tại + số ngày còn lại thay cho "tiến độ so với kỳ vọng" (§22.2); mức nguy cơ của từng trạng thái do mô hình tự học.'
            : '')
      : 'Số liệu đo trên **bộ mô phỏng vòng đời** (§7.2): đúng / trễ hạn sinh ra từ quá trình làm việc từng ngày với tốc độ, độ chăm, khối lượng thật bị ẩn. ' +
          'Kết quả cho thấy mô hình rút được tín hiệu từ dấu vết hoạt động **như thiết kế**; nó **không** chứng minh độ chính xác khi dùng thật (§7.3).',
    ''
  );
  return L.join('\n');
}

if (require.main === module) {
  const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const phase = arg('phase') === 'confirm' ? 'confirm' : 'dev';
  const key = modelArg();
  const suffix = key === 'v1' ? '' : `-${key}`;
  const out = arg('out') ?? (phase === 'dev' ? `eval-risk-dev${suffix}.md` : `eval-risk-result${suffix}.md`);
  const r = runEvaluation(phase, console.log, key);
  const extras = key === 'v2' && phase === 'confirm' ? { p5: runRobustnessP5(r.model), p6: runMechanismAblation(r.model) } : undefined;
  const date = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.resolve(out), `${renderReport(r, date, extras)}\n`, 'utf8');
  console.log(`da ghi ${out} (${r.ms} ms)`);
}
