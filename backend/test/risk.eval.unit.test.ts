// Buoc 5 module canh bao tre han (RISK_MODULE.md §13): loi danh gia + tep mo hinh. Test THUAN.
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CORE_FEATURES,
  FEATURE_NAMES,
  FEATURE_SIGNS,
  HIDDEN_FEATURES,
  INPUT_SIGNS,
  STATUS_TIME_INPUTS,
  inputValue,
  inputVector,
  type ExtractedFeatures,
} from '../src/modules/risk/risk.features';
import { FEATURE_GROUP, assessWithModel, modelInput } from '../src/modules/risk/risk.explain';
import { predictProbability } from '../src/modules/risk/risk.model';
import { DAY_MS, type RiskCardHistory } from '../src/modules/risk/risk.history';
import { levelOf } from '../src/modules/risk/risk.levels';
import { validateModelFile } from '../src/modules/risk/risk.model';
import type { RiskAssessment } from '../src/modules/risk/risk.explain';
import {
  ARMS,
  ARM_FEATURES,
  buildEvalSet,
  buildPredictors,
  buildTrainSet,
  expandModel,
  metricsOf,
  project,
  runTimeline,
  timelineSummary,
  trainArm,
} from '../src/scripts/riskEval';
import { comparisonPairs, evalSeedsOf, loadModelFile, pooledEce } from '../src/scripts/evalRisk';
import { RISK_SIM_DAYS, generateRiskWorld, type RiskWorld } from '../src/scripts/riskSim';
import { generateRiskWorldV2, seedsOf } from '../src/scripts/riskSimV2';
import { LAMBDA_GRID, MODEL_PATH, MODEL_PATHS, MODEL_SPECS, modelArg, simArg, trainRiskModel } from '../src/scripts/trainRisk';
import type { SnapshotRow } from '../src/scripts/riskSnapshots';

describe('nhánh đánh giá', () => {
  it('project lấy đúng cột theo tên đặc trưng', () => {
    const v = FEATURE_NAMES.map((_, i) => i * 10);
    expect(project(v, ['logDaysLeft', 'progressGap'])).toEqual([10, 0]);
  });

  it('tập đặc trưng của từng nhánh', () => {
    expect(ARM_FEATURES.noActivity.some((f) => HIDDEN_FEATURES.has(f))).toBe(false);
    expect(ARM_FEATURES.noActivity).toHaveLength(13);
    expect(ARM_FEATURES.noPeople).not.toContain('paceRatio');
    expect(ARM_FEATURES.noPeople).toHaveLength(11);
    expect(ARM_FEATURES.noSimilar).toEqual(FEATURE_NAMES.filter((f) => f !== 'similarLateRate'));
    expect(ARM_FEATURES.timeOnly).toEqual(['logDaysLeft']);
    expect(ARM_FEATURES.timeStatus).toEqual(['logDaysLeft', 'blocked', 'statusInProgress', 'statusInReview']);
    expect(ARMS).toHaveLength(10);
  });

  // Du lieu nho tu dung: y = 1 khi progressGap lon; logDaysLeft TUONG QUAN DUONG voi y (trai le thuong) de thay rang buoc dau
  const rows: SnapshotRow[] = Array.from({ length: 80 }, (_, i) => {
    const gap = ((i * 37) % 80) / 80 - 0.3;
    const y = (gap > 0.15 ? 1 : 0) as 0 | 1;
    const values = Object.fromEntries(FEATURE_NAMES.map((n) => [n, 0])) as Record<(typeof FEATURE_NAMES)[number], number>;
    values.progressGap = gap;
    values.logDaysLeft = y + ((i * 13) % 7) / 10;
    return { seed: 1, cardId: `c${i}`, horizon: 3, t: new Date(0), y, features: { values, vector: FEATURE_NAMES.map((n) => values[n]), detail: {} as never } };
  });
  const opts = { lambda: 0.001, iterations: 300, learningRate: 0.1 };

  it('trainArm mặc định ràng buộc dấu theo FEATURE_SIGNS; constrained = false thì không', () => {
    const names = ['progressGap', 'logDaysLeft'] as const;
    const c = trainArm(rows, names, opts);
    expect(c.weights[1]).toBe(0); // logDaysLeft phai <= 0
    expect(c.weights[0]).toBeGreaterThan(0);
    const free = trainArm(rows, names, opts, false);
    expect(free.weights[1]).toBeGreaterThan(0);
  });

  it('buildPredictors: đủ 9 nhánh, luật = điểm/100, tỉ lệ nền = tỉ lệ trễ tập học, logreg dùng đúng mô hình đưa vào', () => {
    const full = trainArm(rows, FEATURE_NAMES, opts);
    const p = buildPredictors(full, rows, opts);
    expect(Object.keys(p).sort()).toEqual([...ARMS].sort());
    const base = rows.reduce((a, r) => a + r.y, 0) / rows.length;
    expect(p.baseRate(rows[0]!.features)).toBe(base);
    const fakeRule = { ...rows[0]!.features, values: { ...rows[0]!.features.values, progressGap: 0.5 }, detail: { daysLeft: 9, blockedDays: 0, daysSinceActivity: 0, points: 3, workspaceLateRate: 0 } } as unknown as ExtractedFeatures;
    expect(p.rules(fakeRule)).toBe(0.3);
    const free = trainArm(rows, FEATURE_NAMES, opts, false);
    expect(p.logregFree(rows[3]!.features)).toBeCloseTo(1 / (1 + Math.exp(-(free.bias + FEATURE_NAMES.reduce((a, _, j) => a + free.weights[j]! * ((rows[3]!.features.vector[j]! - free.mean[j]!) / free.std[j]!), 0)))), 12);
  });

  it('metricsOf gom đúng các chỉ số', () => {
    const m = metricsOf([{ p: 0.9, y: 1 }, { p: 0.2, y: 0 }, { p: 0.6, y: 0 }]);
    expect(m.auc).toBe(1);
    expect(m.rows).toBe(3);
    expect(m.positives).toBe(1);
    expect(m.precision51).toBe(0.5);
    expect(m.recall51).toBe(1);
    expect(m.logLoss).toBeCloseTo((-Math.log(0.9) - Math.log(0.8) - Math.log(0.4)) / 3, 12);
  });

  it('pooledEce: điểm = ECE gộp; khoảng chứa điểm; tất định', () => {
    const perSeed = [[{ p: 0.9, y: 1 as const }, { p: 0.1, y: 0 as const }], [{ p: 0.7, y: 0 as const }, { p: 0.3, y: 1 as const }], [{ p: 0.5, y: 1 as const }]];
    const a = pooledEce(perSeed, 500);
    expect(a.lo).toBeLessThanOrEqual(a.hi);
    expect(pooledEce(perSeed, 500)).toEqual(a);
  });
});

// ---------- Bo quet theo ngay: the gioi + diem tu dung tay ----------
describe('runTimeline - logic báo của bộ quét (§8.3)', () => {
  const now = Date.parse('2026-06-30T00:00:00.000Z');
  const start = now - RISK_SIM_DAYS * DAY_MS;
  const day = (d: number, h = 0) => new Date(start + d * DAY_MS + h * 3_600_000);
  const base = (over: Partial<RiskCardHistory> & { id: string }): RiskCardHistory => ({
    title: over.id, description: null, createdAt: day(0), startDate: null, dueDate: null, status: 'TODO', completedAt: null, storyPoints: null,
    members: [], statusEvents: [], dueEvents: [], checklist: [], activityAt: [], ...over,
  });
  // A: han 17h ngay 20 -> vao cua so 14 ngay tu luot quet 09h ngay 7 (09h ngay 6 con thieu 8 gio); xong tre ngay 22.
  const A = base({ id: 'A', dueDate: day(20, 17), status: 'DONE', completedAt: day(22), statusEvents: [{ at: day(22), from: 'TODO', to: 'DONE' }] });
  // B: han ngay 40 doi thanh 45 luc ngay 33; xong dung han ngay 44.
  const B = base({ id: 'B', dueDate: day(45, 17), status: 'DONE', completedAt: day(44), statusEvents: [{ at: day(44), from: 'TODO', to: 'DONE' }],
    dueEvents: [{ at: day(33, 12), from: day(40, 17), to: day(45, 17) }] });
  // C: han ngay 60, xong DUNG han ngay 55 -> duoc bao ngay 50 la bao nham.
  const C = base({ id: 'C', dueDate: day(60, 17), status: 'DONE', completedAt: day(55), statusEvents: [{ at: day(55), from: 'TODO', to: 'DONE' }] });
  // D: han ngay 80, LUI sang 85 luc ngay 78 (sau khi da bao ngay 75); xong ngay 90 -> tre. Bao truoc tinh theo han LUC BAO (80).
  const D = base({ id: 'D', dueDate: day(85, 17), status: 'DONE', completedAt: day(90), statusEvents: [{ at: day(90), from: 'TODO', to: 'DONE' }],
    dueEvents: [{ at: day(78, 12), from: day(80, 17), to: day(85, 17) }] });
  const world: RiskWorld = { seed: 0, now: new Date(now), people: [{ id: 'p', speed: 1, diligence: 1, batchTicker: false, commentRate: 0 }], cards: [A, B, C, D], hidden: {} };

  // Diem theo (han, ngay): A len 55 (bao) -> 52 -> 45 -> 52 (KHONG bao: chua xuong <= 40) -> 38 (dat lai) -> 60 (bao) -> 80 (Nguy cap:
  // KHONG bao them tu 30/10 - thong bao khong noi muc, chi "co nguy co" 1 lan) -> 85
  const scriptA: Record<number, number> = { 6: 99, 7: 55, 8: 52, 9: 45, 10: 52, 11: 38, 12: 60, 13: 80, 14: 85 };
  // B: 70 ngay 30 (bao), 72 ngay 31, 45 ngay 32-33 (KHONG xuong <= 40 -> vung dem khong dat lai); doi han ngay 33 -> 60 ngay 34
  // (bao LAI chi vi doi han); khong ly do o ngay 34
  const scriptB: Record<number, number> = { 30: 70, 31: 72, 32: 45, 33: 45, 34: 60 };
  const assess = (f: ExtractedFeatures): RiskAssessment => {
    const d = Math.floor((Date.parse(f.detail.t) - start) / DAY_MS);
    const isA = f.detail.dueAt === day(20, 17).toISOString();
    const isC = f.detail.dueAt === day(60, 17).toISOString();
    const isD = f.detail.dueAt === day(80, 17).toISOString() || f.detail.dueAt === day(85, 17).toISOString();
    const score = (isA ? scriptA[d] : isC ? (d === 50 ? 70 : 10) : isD ? (d === 75 ? 70 : 10) : scriptB[d]) ?? 10;
    const reasons = !isA && d === 34 ? [] : [{ code: 'LITTLE_TIME' as const, params: { daysLeft: 1 } }];
    return { probability: score / 100, score, level: levelOf(score), reasons, modelVersion: 'x' };
  };
  const s = runTimeline(world, { lateRate: 0.3, daysPerPoint: 1 }, assess);

  it('đếm lần báo: vùng đệm ≤ 40, lên Nguy cấp KHÔNG báo thêm, đổi hạn đặt lại', () => {
    // A: ngay 7, 12 (sau dat lai o ngay 11) = 2 - ngay 13 len Nguy cap khong bao (30/10); diem 99 "ngay 6" khong bao gio duoc quet;
    // B: ngay 30, 34 (sau doi han) = 2; C: ngay 50 = 1; D: ngay 75 = 1
    expect(s.notifications).toBe(6);
  });

  it('độ phủ, báo trước, báo nhầm', () => {
    expect(s.lateCards).toBe(2); // A, D
    expect(s.warnedLate).toBe(2);
    expect(s.leadDays).toHaveLength(2);
    expect(s.leadDays[0]).toBeCloseTo(13 + 8 / 24, 12); // A: bao luc 09:00 ngay 7, han 17:00 ngay 20
    expect(s.leadDays[1]).toBeCloseTo(5 + 8 / 24, 12); // D: bao 09:00 ngay 75, han LUC BAO 17:00 ngay 80 (khong phai 85)
    expect(s.warnedCards).toBe(4);
    // B: luc bao lan dau (ngay 30) han con la ngay 40, xong ngay 44 -> TRE so voi han luc bao (khong phai bao nham) du rot
    // cuoc dung han moi; C: xong truoc han -> bao nham
    expect(s.falseAlarms).toBe(1);
  });

  it('lần đánh giá ≥ Cảnh báo và lần không có lý do', () => {
    // A: 7, 8, 10, 12, 13, 14 (>= 51) = 6; B: 30, 31, 34 = 3; C: 50 = 1; D: 75 = 1
    expect(s.warnAssessments).toBe(11);
    expect(s.emptyReasons).toBe(1);
  });

  it('tóm tắt', () => {
    const t = timelineSummary(s);
    expect(t.coverage).toBe(1);
    expect(t.notificationsPerPersonWeek).toBeCloseTo(6 / (RISK_SIM_DAYS / 7), 12);
    expect(t.emptyReasonRate).toBeCloseTo(1 / 11, 12);
    expect(t.falseAlarmRate).toBeCloseTo(1 / 4, 12);
    expect(t.medianLeadDays).toBeCloseTo(9 + 8 / 24, 12);
  });
});

describe('tệp mô hình đã commit', () => {
  const file = validateModelFile(JSON.parse(fs.readFileSync(MODEL_PATH, 'utf8')));

  it('hợp lệ, có ràng buộc dấu đúng FEATURE_SIGNS, λ thuộc lưới', () => {
    expect(file.version).toBe('logreg-v1');
    expect(file.train.signs).toEqual(FEATURE_NAMES.map((n) => FEATURE_SIGNS[n]));
    expect([0.001, 0.01, 0.1, 1]).toContain(file.train.lambda);
  });

  it('TÁI LẬP: học lại từ đầu ra đúng tệp đã commit, giống từng byte', () => {
    const again = trainRiskModel(() => {});
    expect(`${JSON.stringify(again, null, 2)}\n`).toBe(fs.readFileSync(MODEL_PATH, 'utf8'));
  }, 120_000);
});

// Buoc 11 (§20.3): mo hinh hoc tren bo mo phong v2, tep rieng; tep v1 khong doi
describe('tệp mô hình v2', () => {
  const file = loadModelFile('v2');

  it('hợp lệ: logreg-v2, đánh dấu sim v2, học trên 7001–7040, ràng buộc dấu, λ thuộc lưới', () => {
    expect(file.version).toBe('logreg-v2');
    expect(file.training.sim).toBe('v2');
    expect(file.training.seeds).toEqual(seedsOf('v2').train);
    expect(file.metrics?.devSeeds).toEqual(seedsOf('v2').dev);
    expect(file.train.signs).toEqual(FEATURE_NAMES.map((n) => FEATURE_SIGNS[n]));
    expect(LAMBDA_GRID).toContain(file.train.lambda);
    expect(MODEL_PATHS.v1).toBe(MODEL_PATH);
  });

  it('tệp v1 không có khoá sim; đọc tệp sai phiên bản thì báo lỗi', () => {
    expect('sim' in loadModelFile('v1').training).toBe(false);
    expect(() => loadModelFile('v2', MODEL_PATHS.v1)).toThrow(/v2/);
    expect(() => loadModelFile('v1', MODEL_PATHS.v2)).toThrow(/v1/);
  });

  it('buildTrainSet / buildEvalSet sinh thế giới đúng phiên bản và đúng cơ chế tắt', () => {
    const t = buildTrainSet([7001], 'v2', ['M6']);
    expect(t.worlds[0]).toEqual(generateRiskWorldV2(7001, ['M6']));
    const e = buildEvalSet([7201], t.priors, 'v2', ['M1', 'M2']);
    expect(e[0]!.world).toEqual(generateRiskWorldV2(7201, ['M1', 'M2']));
    expect(buildEvalSet([6201], t.priors)[0]!.world).toEqual(generateRiskWorld(6201));
  });

  it('--sim: mặc định v1, nhận v2, giá trị lạ thì báo lỗi', () => {
    expect(simArg(['node', 'trainRisk.ts'])).toBe('v1');
    expect(simArg(['node', 'trainRisk.ts', '--sim=v2'])).toBe('v2');
    expect(() => simArg(['--sim=v3'])).toThrow(RangeError);
  });

  it('TÁI LẬP v2: học lại từ đầu ra đúng tệp đã commit, giống từng byte', () => {
    const again = trainRiskModel(() => {}, 'v2');
    expect(`${JSON.stringify(again, null, 2)}\n`).toBe(fs.readFileSync(MODEL_PATHS.v2, 'utf8'));
  }, 180_000);
});

// Buoc 16 (§21): mo hinh 4 yeu to - hoc tren tap con, mo rong thanh 15 cot voi he so 0 o cot khong dung
describe('mô hình 4 yếu tố (v3)', () => {
  const file = loadModelFile('v3');
  const core = new Set<string>(CORE_FEATURES);

  it('4 yếu tố = 6 đặc trưng, đúng thứ tự FEATURE_NAMES', () => {
    expect(CORE_FEATURES).toEqual(FEATURE_NAMES.filter((n) => core.has(n)));
    expect(CORE_FEATURES).toEqual(['progressGap', 'logSubtasksDone', 'logSubtasksLeft', 'assigneeLateRate', 'noAssignee', 'paceRatio']);
  });

  it('expandModel: đặt hệ số đúng cột, cột không dùng có trung bình 0 / độ lệch 1 / hệ số 0; đủ 15 thì trả nguyên', () => {
    const sub = { mean: [0.2, 1.5], std: [0.5, 2], weights: [-0.4, 0.9], bias: 1.1 };
    const m = expandModel(sub, ['logSubtasksDone', 'paceRatio']);
    const j = (n: (typeof FEATURE_NAMES)[number]) => FEATURE_NAMES.indexOf(n);
    expect([m.mean[j('logSubtasksDone')], m.std[j('logSubtasksDone')], m.weights[j('logSubtasksDone')]]).toEqual([0.2, 0.5, -0.4]);
    expect([m.mean[j('paceRatio')], m.std[j('paceRatio')], m.weights[j('paceRatio')]]).toEqual([1.5, 2, 0.9]);
    expect([m.mean[j('progressGap')], m.std[j('progressGap')], m.weights[j('progressGap')]]).toEqual([0, 1, 0]);
    expect(m.bias).toBe(1.1);
    expect(m.weights).toHaveLength(FEATURE_NAMES.length);
    const full = { mean: [1], std: [1], weights: [1], bias: 0 };
    expect(expandModel(full as never, FEATURE_NAMES)).toBe(full);
    expect(() => expandModel(sub, ['paceRatio', 'paceRatio'])).toThrow(RangeError);
    expect(() => expandModel(sub, ['progressGap'])).toThrow(RangeError);
  });

  it('tệp v3 hợp lệ: logreg-v3, mô phỏng v2, chỉ 6 đặc trưng có hệ số, cùng hạt giống + priors với v2', () => {
    expect(file.version).toBe('logreg-v3');
    expect(file.training.sim).toBe('v2');
    expect(file.training.features).toEqual([...CORE_FEATURES]);
    FEATURE_NAMES.forEach((n, j) => {
      if (core.has(n)) return;
      expect([file.mean[j], file.std[j], file.weights[j]], n).toEqual([0, 1, 0]);
    });
    expect(CORE_FEATURES.some((n) => file.weights[FEATURE_NAMES.indexOf(n)] !== 0)).toBe(true);
    const v2 = loadModelFile('v2');
    expect(file.training.seeds).toEqual(v2.training.seeds);
    expect(file.priors).toEqual(v2.priors);
    expect(LAMBDA_GRID).toContain(file.train.lambda);
  });

  it('đọc nhầm tệp giữa v2 và v3 → báo lỗi (khác tập đặc trưng)', () => {
    expect(() => loadModelFile('v3', MODEL_PATHS.v2)).toThrow(/v3/);
    expect(() => loadModelFile('v2', MODEL_PATHS.v3)).toThrow(/v2/);
  });

  it('--model: v1 / v2 / v3; không có thì theo --sim; giá trị lạ thì báo lỗi', () => {
    expect(modelArg(['node', 'x', '--model=v3'])).toBe('v3');
    expect(modelArg(['node', 'x', '--sim=v2'])).toBe('v2');
    expect(modelArg(['node', 'x'])).toBe('v1');
    expect(modelArg(['node', 'x', '--model=v4'])).toBe('v4');
    expect(() => modelArg(['--model=v9'])).toThrow(RangeError);
    expect(MODEL_SPECS.v3.previous).toBe('v2');
  });

  it('hạt giống đánh giá: dev chung 7101–7120; xác nhận v3 là dải mới 7301–7320, v2 vẫn 7201–7220', () => {
    expect(evalSeedsOf('v3', 'dev')).toEqual(seedsOf('v2').dev);
    expect(evalSeedsOf('v3', 'confirm')).toEqual(Array.from({ length: 20 }, (_, i) => 7301 + i));
    expect(evalSeedsOf('v2', 'confirm')).toEqual(seedsOf('v2').confirm);
    expect(evalSeedsOf('v1', 'confirm')).toEqual(seedsOf('v1').confirm);
  });

  it('TÁI LẬP v3: học lại từ đầu ra đúng tệp đã commit, giống từng byte', () => {
    const again = trainRiskModel(() => {}, 'v3');
    expect(`${JSON.stringify(again, null, 2)}\n`).toBe(fs.readFileSync(MODEL_PATHS.v3, 'utf8'));
  }, 180_000);
});

// Buoc 21 (§22): trang thai + so ngay con lai thay tien do; dau vao theo TEN, tep gon chi ghi 9 dau vao
describe('mô hình trạng thái + số ngày còn lại (v4)', () => {
  const file = loadModelFile('v4');

  it('đầu vào theo tên: 15 đặc trưng trùng đúng vector cũ; hai ô trạng thái lấy từ trạng thái lúc t', () => {
    const rows = buildTrainSet([7001], 'v2').rows;
    const statuses = new Set<string>();
    for (const r of rows) {
      expect(inputVector(r.features, FEATURE_NAMES)).toEqual(r.features.vector);
      const st = r.features.detail.status;
      statuses.add(st);
      expect(inputValue(r.features, 'statusInProgress')).toBe(st === 'IN_PROGRESS' ? 1 : 0);
      expect(inputValue(r.features, 'statusInReview')).toBe(st === 'IN_REVIEW' ? 1 : 0);
    }
    expect([...statuses].sort()).toEqual(expect.arrayContaining(['IN_PROGRESS', 'TODO']));
  });

  it('tệp v4 gọn: đúng 9 đầu vào, chiều theo INPUT_SIGNS, cùng hạt giống + priors với v3, không ghi training.features', () => {
    expect(file.version).toBe('logreg-v4');
    expect(file.features).toEqual([...STATUS_TIME_INPUTS]);
    expect(file.weights).toHaveLength(9);
    expect(file.train.signs).toEqual(STATUS_TIME_INPUTS.map((n) => INPUT_SIGNS[n]));
    expect(file.training.features).toBeUndefined();
    expect(file.training.sim).toBe('v2');
    const v3 = loadModelFile('v3');
    expect(file.training.seeds).toEqual(v3.training.seeds);
    expect(file.priors).toEqual(v3.priors);
    expect(MODEL_SPECS.v4).toMatchObject({ previous: 'v3', p2Arm: 'timeStatus', compact: true });
  });

  it('chấm theo tên: xác suất = sigmoid trên đúng 9 đầu vào; hai ô trạng thái không thành lý do', () => {
    const f = buildEvalSet([7101], file.priors, 'v2')[0]!.rows.find((r) => r.features.detail.status === 'IN_PROGRESS')!.features;
    const x = modelInput(file, f);
    expect(x).toEqual(inputVector(f, STATUS_TIME_INPUTS));
    expect(x[STATUS_TIME_INPUTS.indexOf('statusInProgress')]).toBe(1);
    const a = assessWithModel(file, file.version, f);
    expect(a.probability).toBe(predictProbability(file, x));
    expect('statusInProgress' in FEATURE_GROUP || 'statusInReview' in FEATURE_GROUP).toBe(false);
  });

  it('đọc nhầm tệp giữa v3 và v4 → báo lỗi', () => {
    expect(() => loadModelFile('v4', MODEL_PATHS.v3)).toThrow(/v4/);
    expect(() => loadModelFile('v3', MODEL_PATHS.v4)).toThrow(/v3/);
  });

  it('phép so sánh: P2 của v4 so với "thời gian + trạng thái" (kèm "thời gian + tiến độ" để mô tả); v3 vẫn "thời gian + tiến độ"', () => {
    const tagOf = (k: Parameters<typeof comparisonPairs>[0]) => comparisonPairs(k).map(([, b, t]) => `${t}:${b}`);
    expect(tagOf('v4')).toEqual(['P1:rules', 'P2:timeStatus', 'phụ:timeProgress', 'phụ:timeOnly', 'phụ:baseRate']);
    expect(tagOf('v3')).toEqual(['P1:rules', 'P2:timeProgress', 'phụ:timeOnly', 'phụ:baseRate']);
    expect(tagOf('v2')).toContain('P4:noActivity');
  });

  it('hạt giống xác nhận v4 là dải mới 7401–7420', () => {
    expect(evalSeedsOf('v4', 'confirm')).toEqual(Array.from({ length: 20 }, (_, i) => 7401 + i));
    expect(evalSeedsOf('v4', 'dev')).toEqual(seedsOf('v2').dev);
  });

  it('TÁI LẬP v4: học lại từ đầu ra đúng tệp đã commit, giống từng byte', () => {
    const again = trainRiskModel(() => {}, 'v4');
    expect(`${JSON.stringify(again, null, 2)}\n`).toBe(fs.readFileSync(MODEL_PATHS.v4, 'utf8'));
  }, 180_000);
});
