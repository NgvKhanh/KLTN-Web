// Buoc 3 module canh bao tre han (RISK_MODULE.md §6): muc, hoi quy logistic, luat co dinh, ly do. Test THUAN.
import { describe, expect, it } from 'vitest';
import { FEATURE_NAMES, FEATURE_SIGNS, HIDDEN_FEATURES, type ExtractedFeatures, type FeatureDetail, type FeatureValues } from '../src/modules/risk/risk.features';
import { levelOf, scoreOf } from '../src/modules/risk/risk.levels';
import {
  contributions,
  fitStandardizer,
  logLoss,
  predictProbability,
  sigmoid,
  trainLogistic,
  validateModelFile,
  type LogisticModel,
  type TrainRow,
} from '../src/modules/risk/risk.model';
import { ruleScore, ruleTerms } from '../src/modules/risk/risk.rules';
import {
  FEATURE_GROUP,
  MAX_REASONS,
  assessWithModel,
  assessWithRules,
  pickReasons,
  type ReasonCode,
} from '../src/modules/risk/risk.explain';

describe('mức nguy cơ - ngưỡng user đặt', () => {
  it.each([
    [0, 'SAFE'], [25, 'SAFE'], [26, 'WATCH'], [50, 'WATCH'], [51, 'WARNING'], [75, 'WARNING'], [76, 'CRITICAL'], [100, 'CRITICAL'],
  ])('%i → %s', (s, l) => expect(levelOf(s)).toBe(l));
  it('điểm ngoài 0–100 hoặc không nguyên → RangeError', () => {
    for (const bad of [-1, 101, 50.5, Number.NaN]) expect(() => levelOf(bad)).toThrow(RangeError);
  });
  it('scoreOf: làm tròn, kẹp, từ chối NaN', () => {
    expect(scoreOf(0.2549)).toBe(25);
    expect(scoreOf(0.2551)).toBe(26);
    expect(scoreOf(0.7649)).toBe(76);
    expect(scoreOf(1.2)).toBe(100);
    expect(scoreOf(-0.1)).toBe(0);
    expect(() => scoreOf(Number.NaN)).toThrow(RangeError);
  });
});

describe('hồi quy logistic', () => {
  it('sigmoid ổn định số', () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(800)).toBe(1);
    expect(sigmoid(-800)).toBe(0);
    expect(sigmoid(2) + sigmoid(-2)).toBeCloseTo(1, 15);
  });

  it('chuẩn hoá: trung bình, độ lệch chuẩn tổng thể; cột hằng → std 1; lỗi đầu vào', () => {
    const s = fitStandardizer([[1, 5], [3, 5], [5, 5]]);
    expect(s.mean).toEqual([3, 5]);
    expect(s.std[0]).toBeCloseTo(Math.sqrt(8 / 3), 12);
    expect(s.std[1]).toBe(1);
    expect(() => fitStandardizer([])).toThrow(RangeError);
    expect(() => fitStandardizer([[1, 2], [1]])).toThrow(RangeError);
  });

  it('một rồi hai vòng gradient tính tay (λ = 0,5; không phạt b)', () => {
    const rows: TrainRow[] = [{ x: [0], y: 0 }, { x: [2], y: 1 }];
    // mean 1, std 1 -> z = -1, +1. Vong 1: p = 0,5 ca hai; grad_w = -0,5, grad_b = 0 -> w = 0,05; b = 0
    const one = trainLogistic(rows, { lambda: 0.5, iterations: 1, learningRate: 0.1 });
    expect(one.weights[0]).toBeCloseTo(0.05, 15);
    expect(one.bias).toBe(0);
    // Vong 2: grad_w = (sigma(0,05) - 1 - sigma(-0,05)) / 2 + 2*0,5*0,05
    const g = (sigmoid(0.05) - 1 - sigmoid(-0.05)) / 2 + 2 * 0.5 * 0.05;
    const two = trainLogistic(rows, { lambda: 0.5, iterations: 2, learningRate: 0.1 });
    expect(two.weights[0]).toBeCloseTo(0.05 - 0.1 * g, 15);
    expect(two.bias).toBeCloseTo(0, 15);
  });

  it('b không bị phạt: dữ liệu toàn nhãn 1 thì b tăng như nhau bất kể λ', () => {
    const rows: TrainRow[] = [{ x: [0], y: 1 }, { x: [2], y: 1 }];
    const a = trainLogistic(rows, { lambda: 0, iterations: 50, learningRate: 0.1 });
    const b = trainLogistic(rows, { lambda: 10, iterations: 50, learningRate: 0.1 });
    expect(a.bias).toBeGreaterThan(0);
    expect(b.bias).toBeCloseTo(a.bias, 1);
  });

  // Du lieu 2 chieu: chieu 0 lien quan nhan, chieu 1 la nhieu
  const data: TrainRow[] = Array.from({ length: 60 }, (_, i) => {
    const x0 = (i % 10) / 2;
    const x1 = ((i * 7) % 11) / 3;
    return { x: [x0, x1], y: x0 + ((i * 13) % 5) / 4 > 2.6 ? 1 : 0 };
  });

  it('học được chiều liên quan, log-loss giảm xuống dưới ln 2', () => {
    const m = trainLogistic(data, { lambda: 0.001, iterations: 2000, learningRate: 0.1 });
    expect(m.weights[0]).toBeGreaterThan(1);
    expect(Math.abs(m.weights[1]!)).toBeLessThan(Math.abs(m.weights[0]!));
    expect(logLoss(m, data)).toBeLessThan(Math.log(2) - 0.2);
  });

  it('ràng buộc dấu: hệ số sai chiều bị kéo về đúng 0 sau mỗi bước, chiều đúng giữ nguyên', () => {
    const rows: TrainRow[] = [{ x: [0], y: 0 }, { x: [2], y: 1 }];
    // khong rang buoc: w > 0 (vong 1 = 0,05). Dau -1: sau vong 1 bi keo ve 0, mai mai 0
    expect(trainLogistic(rows, { lambda: 0, iterations: 1, learningRate: 0.1, signs: [-1] }).weights[0]).toBe(0);
    expect(trainLogistic(rows, { lambda: 0, iterations: 200, learningRate: 0.1, signs: [-1] }).weights[0]).toBe(0);
    expect(trainLogistic(rows, { lambda: 0, iterations: 1, learningRate: 0.1, signs: [1] }).weights[0]).toBeCloseTo(0.05, 15);
    expect(trainLogistic(rows, { lambda: 0, iterations: 1, learningRate: 0.1, signs: [0] }).weights[0]).toBeCloseTo(0.05, 15);
  });

  it('ràng buộc dấu trên dữ liệu 2 chiều: chiều liên quan vẫn học được, chiều bị cấm = 0', () => {
    const free = trainLogistic(data, { lambda: 0.001, iterations: 800, learningRate: 0.1 });
    const forbid = Math.sign(free.weights[1]!) === 1 ? -1 : 1;
    const m = trainLogistic(data, { lambda: 0.001, iterations: 800, learningRate: 0.1, signs: [1, forbid] });
    expect(m.weights[1]).toBe(0);
    expect(m.weights[0]).toBeGreaterThan(1);
  });

  it('signs sai dạng → RangeError', () => {
    expect(() => trainLogistic(data, { lambda: 0, iterations: 1, learningRate: 0.1, signs: [1] })).toThrow(RangeError);
    expect(() => trainLogistic(data, { lambda: 0, iterations: 1, learningRate: 0.1, signs: [1, 2] })).toThrow(RangeError);
  });

  it('tất định: học hai lần ra cùng hệ số từng bit', () => {
    const a = trainLogistic(data, { lambda: 0.01, iterations: 300, learningRate: 0.1 });
    const b = trainLogistic(data, { lambda: 0.01, iterations: 300, learningRate: 0.1 });
    expect(a).toEqual(b);
  });

  it('λ lớn hơn → hệ số nhỏ hơn', () => {
    const a = trainLogistic(data, { lambda: 0.001, iterations: 500, learningRate: 0.1 });
    const b = trainLogistic(data, { lambda: 1, iterations: 500, learningRate: 0.1 });
    expect(Math.abs(b.weights[0]!)).toBeLessThan(Math.abs(a.weights[0]!));
  });

  it('đóng góp + b = logit; dự đoán khớp sigmoid', () => {
    const m: LogisticModel = { mean: [1, 2], std: [2, 4], weights: [0.5, -1], bias: 0.3 };
    const c = contributions(m, [5, 2]);
    expect(c).toEqual([1, -0]);
    expect(predictProbability(m, [5, 2])).toBeCloseTo(sigmoid(1.3), 15);
    expect(() => predictProbability(m, [1])).toThrow(RangeError);
  });

  it('tham số / dữ liệu học không hợp lệ → RangeError', () => {
    const ok: TrainRow[] = [{ x: [1], y: 1 }];
    expect(() => trainLogistic(ok, { lambda: -1, iterations: 1, learningRate: 0.1 })).toThrow(RangeError);
    expect(() => trainLogistic(ok, { lambda: 0, iterations: 0, learningRate: 0.1 })).toThrow(RangeError);
    expect(() => trainLogistic(ok, { lambda: 0, iterations: 1.5, learningRate: 0.1 })).toThrow(RangeError);
    expect(() => trainLogistic(ok, { lambda: 0, iterations: 1, learningRate: 0 })).toThrow(RangeError);
    expect(() => trainLogistic([{ x: [1], y: 2 as 1 }], { lambda: 0, iterations: 1, learningRate: 0.1 })).toThrow(RangeError);
    expect(() => trainLogistic([{ x: [Number.NaN], y: 1 }], { lambda: 0, iterations: 1, learningRate: 0.1 })).toThrow(RangeError);
  });
});

describe('validateModelFile', () => {
  const d = FEATURE_NAMES.length;
  const good = () => ({
    version: 'logreg-v1',
    features: [...FEATURE_NAMES],
    mean: new Array(d).fill(0),
    std: new Array(d).fill(1),
    weights: FEATURE_NAMES.map((n) => 0.1 * (FEATURE_SIGNS[n] || 1)),
    bias: -1,
    train: { lambda: 0.01, iterations: 2000, learningRate: 0.1 },
    priors: { lateRate: 0.3, daysPerPoint: 1.5 },
    training: { seeds: [1], rows: 10, positives: 3, sha256: 'x' },
  });
  it('tệp hợp lệ → trả lại', () => expect(validateModelFile(good()).version).toBe('logreg-v1'));
  it('đầu vào theo tên (§22.2): tệp gọn có ô trạng thái hợp lệ; đổi thứ tự tên kèm hệ số vẫn hợp lệ', () => {
    const compact = { ...good(), features: ['logDaysLeft', 'statusInProgress'], mean: [1, 0.3], std: [0.5, 0.4], weights: [-0.2, -0.4] };
    expect(validateModelFile(compact).features).toEqual(['logDaysLeft', 'statusInProgress']);
    const g = good();
    const rev = { ...g, features: [...g.features].reverse(), weights: [...g.weights].reverse() };
    expect(validateModelFile(rev).features[0]).toBe('logEvents7d');
  });
  it.each([
    ['không phải đối tượng', () => null],
    ['thiếu version', () => ({ ...good(), version: '' })],
    ['tên đầu vào lạ', () => ({ ...good(), features: ['abc', ...FEATURE_NAMES.slice(1)] })],
    // chi sai o cho trung ten (moi thu khac hop le) - bat dung loi trung
    ['tên đầu vào trùng', () => ({ ...good(), features: ['logDaysLeft', 'logDaysLeft'], mean: [0, 0], std: [1, 1], weights: [-0.1, -0.1] })],
    ['danh sách đầu vào rỗng', () => ({ ...good(), features: [], mean: [], std: [], weights: [] })],
    ['số hệ số khác số đầu vào', () => ({ ...good(), features: FEATURE_NAMES.slice(1) })],
    ['ô trạng thái sai chiều (Đang làm làm tăng nguy cơ)', () => ({ ...good(), features: ['statusInProgress'], mean: [0], std: [1], weights: [0.3] })],
    ['weights có NaN', () => ({ ...good(), weights: [Number.NaN, ...new Array(d - 1).fill(0)] })],
    ['weights thiếu phần tử', () => ({ ...good(), weights: [1] })],
    ['hệ số sai chiều lẽ thường (logDaysLeft > 0)', () => ({ ...good(), weights: FEATURE_NAMES.map((n) => (n === 'logDaysLeft' ? 0.2 : 0)) })],
    ['std = 0', () => ({ ...good(), std: new Array(d).fill(0) })],
    ['bias vô hạn', () => ({ ...good(), bias: Number.POSITIVE_INFINITY })],
    ['priors thiếu', () => ({ ...good(), priors: undefined })],
    ['lateRate > 1', () => ({ ...good(), priors: { lateRate: 1.5, daysPerPoint: 1 } })],
    ['daysPerPoint ≤ 0', () => ({ ...good(), priors: { lateRate: 0.3, daysPerPoint: 0 } })],
  ])('%s → lỗi', (_, make) => expect(() => validateModelFile(make())).toThrow());
});

// ---------- Dac trung dung tay cho luat va ly do ----------
const DEFAULT_DETAIL: FeatureDetail = {
  t: '2026-03-10T00:00:00.000Z',
  dueAt: '2026-03-15T00:00:00.000Z',
  startAt: '2026-03-01T00:00:00.000Z',
  status: 'IN_PROGRESS',
  expectedProgress: 0.5,
  actualProgress: 0.5,
  progressSource: 'STATUS',
  daysLeft: 5,
  points: 3,
  pointsEstimated: false,
  subtasksDone: 0,
  subtasksTotal: 0,
  blockedDays: 0,
  assignees: [{ userId: 'u', lateRate: 0.3, outcomeCount: 4, lateCount: 1, daysPerPoint: 1, doneCount: 3 }],
  workspaceLateRate: 0.3,
  workspaceDaysPerPoint: 1,
  needDays: 1.5,
  similar: { count: 2, lateCount: 1, rate: 0.3 },
  daysSinceActivity: 0,
  events7d: 3,
};
function fx(values: Partial<FeatureValues> = {}, detail: Partial<FeatureDetail> = {}): ExtractedFeatures {
  const v = Object.fromEntries(FEATURE_NAMES.map((n) => [n, 0])) as FeatureValues;
  Object.assign(v, { assigneeLateRate: 0.3, similarLateRate: 0.3 }, values);
  return { values: v, vector: FEATURE_NAMES.map((n) => v[n]), detail: { ...DEFAULT_DETAIL, ...detail } };
}

describe('luật cố định §6.4 - từng khoản', () => {
  it('thẻ bình thường → 0 điểm', () => expect(ruleScore(fx())).toBe(0));
  it.each([
    ['chậm 50%', fx({ progressGap: 0.5 }), 'BEHIND_SCHEDULE', 30],
    ['chậm âm không trừ', fx({ progressGap: -0.4 }), 'BEHIND_SCHEDULE', 0],
    ['còn 1 ngày', fx({}, { daysLeft: 1 }), 'LITTLE_TIME', 20],
    ['còn 3 ngày', fx({}, { daysLeft: 3 }), 'LITTLE_TIME', 10],
    ['còn 3,01 ngày', fx({}, { daysLeft: 3.01 }), 'LITTLE_TIME', 0],
    ['đang chặn 2 ngày', fx({ blocked: 1 }, { blockedDays: 2 }), 'BLOCKED', 24],
    ['chặn lâu bị kẹp', fx({ blocked: 1 }, { blockedDays: 30 }), 'BLOCKED', 30],
    ['từng chặn, nay hết', fx({ blocked: 0 }, { blockedDays: 3 }), 'BLOCKED', 6],
    ['chưa ai nhận', fx({ noAssignee: 1 }), 'NO_ASSIGNEE', 15],
    ['người nhận trễ hơn nhóm 0,2', fx({ assigneeLateRate: 0.5 }), 'ASSIGNEE_LATE_HISTORY', 6],
    ['người nhận đúng hạn hơn nhóm', fx({ assigneeLateRate: 0.1 }), 'ASSIGNEE_LATE_HISTORY', 0],
    ['thẻ tương tự trễ hơn nhóm 0,5', fx({ similarLateRate: 0.8 }), 'SIMILAR_LATE', 10],
    ['2 ngày không hoạt động', fx({}, { daysSinceActivity: 2 }), 'INACTIVE', 0],
    ['4 ngày không hoạt động', fx({}, { daysSinceActivity: 4 }), 'INACTIVE', 6],
    ['20 ngày không hoạt động', fx({}, { daysSinceActivity: 20 }), 'INACTIVE', 15],
    ['8 điểm', fx({}, { points: 8 }), 'HIGH_COMPLEXITY', 10],
    ['5 điểm', fx({}, { points: 5 }), 'HIGH_COMPLEXITY', 5],
    ['3 điểm', fx({}, { points: 3 }), 'HIGH_COMPLEXITY', 0],
  ] as const)('%s', (_, f, key, expected) => {
    expect(ruleTerms(f)[key]).toBeCloseTo(expected, 12);
  });
  it('cộng dồn rồi kẹp 100', () => {
    const f = fx({ progressGap: 1, blocked: 1, noAssignee: 1 }, { daysLeft: 0.5, blockedDays: 9 });
    expect(ruleScore(f)).toBe(100);
    expect(ruleScore(fx({ progressGap: 0.5 }, { daysLeft: 3 }))).toBe(40);
  });
});

describe('chọn lý do', () => {
  const groups = (o: Partial<Record<ReasonCode, number>>) => new Map(Object.entries(o) as [ReasonCode, number][]);

  it('chỉ nhóm > ngưỡng, xếp giảm dần, tối đa 3', () => {
    const f = fx({ noAssignee: 1 }, { expectedProgress: 0.8, actualProgress: 0.2, blockedDays: 2, subtasksTotal: 4, subtasksDone: 1 });
    const r = pickReasons(groups({ LITTLE_TIME: 0.5, BEHIND_SCHEDULE: 2, BLOCKED: 0.1, NO_ASSIGNEE: 1, SUBTASKS_LEFT: 0.3, HIGH_COMPLEXITY: -1 }), f, 0.1);
    expect(r.map((x) => x.code)).toEqual(['BEHIND_SCHEDULE', 'NO_ASSIGNEE', 'LITTLE_TIME']);
    expect(r).toHaveLength(MAX_REASONS);
    expect(r[0]!.params).toEqual({ expectedPct: 80, actualPct: 20 });
  });

  it('hoà điểm → theo thứ tự cố định', () => {
    const r = pickReasons(groups({ HIGH_COMPLEXITY: 1, LITTLE_TIME: 1 }), fx({}, { points: 5 }), 0);
    expect(r.map((x) => x.code)).toEqual(['LITTLE_TIME', 'HIGH_COMPLEXITY']);
  });

  it('nhóm không đủ dữ liệu bị bỏ, lấy nhóm kế tiếp', () => {
    const f = fx({}, {
      expectedProgress: 0.2, actualProgress: 0.5, // khong cham -> BEHIND_SCHEDULE bo
      assignees: [{ userId: 'u', lateRate: 0.3, outcomeCount: 0, lateCount: 0, daysPerPoint: 1, doneCount: 0 }], // nguoi moi
      similar: { count: 0, lateCount: 0, rate: 0.3 },
      subtasksDone: 3, subtasksTotal: 3,
    });
    const r = pickReasons(groups({ BEHIND_SCHEDULE: 5, ASSIGNEE_LATE_HISTORY: 4, ASSIGNEE_SLOW: 3.5, SIMILAR_LATE: 3, SUBTASKS_LEFT: 2.5, NO_ASSIGNEE: 2, BLOCKED: 1.5, LITTLE_TIME: 1 }), f, 0);
    expect(r.map((x) => x.code)).toEqual(['LITTLE_TIME']);
  });

  it('tham số từng lý do', () => {
    const f = fx({ blocked: 1 }, { blockedDays: 2.04, daysLeft: 1.26, points: 5, pointsEstimated: true, subtasksDone: 1, subtasksTotal: 6, needDays: 3.96,
      assignees: [
        { userId: 'a', lateRate: 0.5, outcomeCount: 4, lateCount: 3, daysPerPoint: 2, doneCount: 2 },
        { userId: 'b', lateRate: 0.2, outcomeCount: 6, lateCount: 1, daysPerPoint: 1, doneCount: 0 },
      ],
      similar: { count: 5, lateCount: 4, rate: 0.6 } });
    const all = groups({ BLOCKED: 9, LITTLE_TIME: 8, HIGH_COMPLEXITY: 7 });
    expect(pickReasons(all, f, 0)).toEqual([
      { code: 'BLOCKED', params: { days: 2, current: true } },
      { code: 'LITTLE_TIME', params: { daysLeft: 1.3 } },
      { code: 'HIGH_COMPLEXITY', params: { points: 5, estimated: true } },
    ]);
    expect(pickReasons(groups({ SUBTASKS_LEFT: 3, ASSIGNEE_LATE_HISTORY: 2, ASSIGNEE_SLOW: 1 }), f, 0)).toEqual([
      { code: 'SUBTASKS_LEFT', params: { done: 1, total: 6 } },
      { code: 'ASSIGNEE_LATE_HISTORY', params: { lateCount: 4, outcomeCount: 10 } },
      { code: 'ASSIGNEE_SLOW', params: { needDays: 4, daysLeft: 1.3 } },
    ]);
    expect(pickReasons(groups({ SIMILAR_LATE: 1 }), f, 0)).toEqual([{ code: 'SIMILAR_LATE', params: { lateCount: 4, count: 5 } }]);
  });

  it('chưa ai nhận: không bao giờ có lý do về người; có NO_ASSIGNEE', () => {
    const f = fx({ noAssignee: 1 }, { assignees: [] });
    const r = pickReasons(groups({ ASSIGNEE_LATE_HISTORY: 5, ASSIGNEE_SLOW: 4, NO_ASSIGNEE: 1 }), f, 0);
    expect(r.map((x) => x.code)).toEqual(['NO_ASSIGNEE']);
    expect(pickReasons(groups({ NO_ASSIGNEE: 3 }), fx(), 0)).toEqual([]);
  });

  it('độ phức tạp chỉ là lý do khi ≥ 5 điểm', () => {
    expect(pickReasons(groups({ HIGH_COMPLEXITY: 2 }), fx({}, { points: 3, pointsEstimated: true }), 0)).toEqual([]);
    expect(pickReasons(groups({ HIGH_COMPLEXITY: 2 }), fx({}, { points: 5 }), 0)).toEqual([{ code: 'HIGH_COMPLEXITY', params: { points: 5, estimated: false } }]);
  });

  it('từng bị chặn nhưng nay không: current = false; chưa từng chặn → bỏ', () => {
    expect(pickReasons(groups({ BLOCKED: 1 }), fx({}, { blockedDays: 1 }), 0)).toEqual([{ code: 'BLOCKED', params: { days: 1, current: false } }]);
    expect(pickReasons(groups({ BLOCKED: 1 }), fx(), 0)).toEqual([]);
  });
});

describe('assessWithModel / assessWithRules', () => {
  const d = FEATURE_NAMES.length;
  const model = (w: Partial<Record<(typeof FEATURE_NAMES)[number], number>>, bias = 0): LogisticModel => ({
    mean: new Array(d).fill(0),
    std: new Array(d).fill(1),
    weights: FEATURE_NAMES.map((n) => w[n] ?? 0),
    bias,
  });

  it('tệp gọn đầu vào theo tên (§22.2): chấm đúng tên, lý do ghép đúng đặc trưng, ô trạng thái không thành lý do', () => {
    // logDaysLeft = ln(1+1) = 0,693: z = (0,693 - 2) / 1 = -1,307, dong gop = -0,5 * -1,307 = +0,65 -> LITTLE_TIME
    // statusInProgress = 1 (fx mac dinh Dang lam): z = (1 - 0,5) / 0,5 = 1, dong gop = -0,4 -> khong phai ly do
    const compact = { features: ['logDaysLeft', 'statusInProgress'], mean: [2, 0.5], std: [1, 0.5], weights: [-0.5, -0.4], bias: 0.2 };
    const f = fx({ logDaysLeft: Math.log(2) }, { daysLeft: 1 });
    const a = assessWithModel(compact, 'logreg-v4', f);
    expect(a.probability).toBeCloseTo(sigmoid(0.2 + -0.5 * (Math.log(2) - 2) + -0.4 * 1), 12);
    expect(a.reasons.map((r) => r.code)).toEqual(['LITTLE_TIME']);
  });

  it('điểm = round(100·σ(logit)), mức theo ngưỡng, lý do theo đóng góp', () => {
    const f = fx({ progressGap: 0.6, noAssignee: 1 }, { expectedProgress: 0.8, actualProgress: 0.2, assignees: [] });
    const a = assessWithModel(model({ progressGap: 3, noAssignee: 0.5 }, -1.5), 'logreg-v1', f);
    // logit = -1,5 + 3*0,6 + 0,5*1 = 0,8 -> sigma = 0,69 -> 69 diem -> Canh bao
    expect(a.probability).toBeCloseTo(sigmoid(0.8), 15);
    expect(a.score).toBe(69);
    expect(a.level).toBe('WARNING');
    expect(a.reasons.map((r) => r.code)).toEqual(['BEHIND_SCHEDULE', 'NO_ASSIGNEE']);
    expect(a.modelVersion).toBe('logreg-v1');
  });

  it('FEATURE_GROUP không có đặc trưng ẩn nào (đây là chỗ DUY NHẤT chặn tần suất hoạt động khỏi lý do)', () => {
    for (const h of HIDDEN_FEATURES) expect(FEATURE_GROUP[h]).toBeUndefined();
    for (const n of FEATURE_NAMES) if (!HIDDEN_FEATURES.has(n)) expect(FEATURE_GROUP[n], n).toBeDefined();
  });

  it('luật: khoản điểm nhỏ (> 0) vẫn là lý do', () => {
    const a = assessWithRules(fx({}, { blockedDays: 1 }));
    expect(a.score).toBe(2);
    expect(a.reasons).toEqual([{ code: 'BLOCKED', params: { days: 1, current: false } }]);
  });

  it('tần suất hoạt động đẩy điểm lên nhưng KHÔNG BAO GIỜ thành lý do', () => {
    const f = fx({ logDaysSinceActivity: 3, logEvents7d: -2 });
    const a = assessWithModel(model({ logDaysSinceActivity: 2, logEvents7d: -1 }), 'v', f);
    expect(a.score).toBe(100);
    expect(a.reasons).toEqual([]);
  });

  it('đóng góp âm (làm giảm nguy cơ) không thành lý do', () => {
    const f = fx({ progressGap: -0.5 }, { expectedProgress: 0.8, actualProgress: 0.2 });
    expect(assessWithModel(model({ progressGap: 3 }), 'v', f).reasons).toEqual([]);
  });

  it('nhóm có nhiều đặc trưng: cộng đóng góp cả nhóm trước khi so ngưỡng 0,1', () => {
    const f = fx({ logSubtasksDone: 0.06, logSubtasksLeft: 0.06 }, { subtasksDone: 1, subtasksTotal: 3 });
    const a = assessWithModel(model({ logSubtasksDone: 1, logSubtasksLeft: 1 }), 'v', f);
    expect(a.reasons.map((r) => r.code)).toEqual(['SUBTASKS_LEFT']);
    const only = assessWithModel(model({ logSubtasksLeft: 1 }), 'v', f);
    expect(only.reasons).toEqual([]);
  });

  it('thẻ quá hạn: 100 / Nguy cấp / OVERDUE với số ngày quá hạn, bất kể mô hình', () => {
    const f = fx({}, { t: '2026-03-17T12:00:00.000Z', dueAt: '2026-03-15T00:00:00.000Z', daysLeft: 0 });
    for (const a of [assessWithModel(model({}, -10), 'v', f), assessWithRules(f)]) {
      expect(a).toEqual({ probability: 1, score: 100, level: 'CRITICAL', reasons: [{ code: 'OVERDUE', params: { days: 2.5 } }], modelVersion: 'overdue' });
    }
    // dung han (t = han) chua tinh la qua han
    expect(assessWithModel(model({}, -10), 'v', fx({}, { t: DEFAULT_DETAIL.dueAt, dueAt: DEFAULT_DETAIL.dueAt })).modelVersion).toBe('v');
  });

  it('luật: điểm = ruleScore, xác suất = điểm/100, không bao giờ lấy INACTIVE làm lý do', () => {
    const f = fx({ progressGap: 0.5 }, { expectedProgress: 0.9, actualProgress: 0.4, daysSinceActivity: 30 });
    const a = assessWithRules(f);
    expect(a.score).toBe(ruleScore(f));
    expect(a.score).toBe(45);
    expect(a.probability).toBe(0.45);
    expect(a.level).toBe('WATCH');
    expect(a.reasons.map((r) => r.code)).toEqual(['BEHIND_SCHEDULE']);
    expect(a.modelVersion).toBe('rules-v1');
  });
});
