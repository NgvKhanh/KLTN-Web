// Buoc 9a - lop 2: dung bao cao (evalPlanReport.ts). THUAN: khong cham CSDL. Kiem SO TINH TAY tren du lieu dung san -
// bang so lieu la thu duoc dua vao luan van nen dinh dang / dau / ket luan phai dung.
import { describe, expect, it } from 'vitest';
import {
  PRIMARY_PLAN_COMPARISONS,
  buildPlanReport,
  comparisonTable,
  datasetFingerprint,
  descriptiveTable,
  kSweepTable,
  missingPolicyTable,
  type KSweepPoint,
  type PlanArmResult,
  type PlanReportMeta,
} from '../src/scripts/evalPlanReport';
import { PLAN_EVAL_SEEDS, type PlanArmId, type PlanBatchSummary } from '../src/scripts/evalPlanRun';
import { DEFAULT_SIM, generateSimulation } from '../src/scripts/simGenerator';

// Ma bam DONG BANG cua 20 bo du lieu danh gia LOP 2 (3001-3020). Doi ma nay = bo sinh (hoac danh sach hat giong) da
// doi -> MOI SO LIEU cua buoc 9 phai chay lai; khong sua cho xanh.
const FROZEN_PLAN_EVAL_SHA256 = '72ccdf3344cc168f231ad9b11df5431e70339cd3db4ea864f0d2c79a036577f5';

const s = (over: Partial<PlanBatchSummary> = {}): PlanBatchSummary => ({
  cards: 12,
  unassigned: 0,
  maxShare: 0.3,
  gini: 0.25,
  pOnTime: 0.5,
  regret: 0.2,
  top1: 0.4,
  risky: 0.3,
  ...over,
});
const arm = (id: PlanArmId, label: string, perSeed: PlanBatchSummary[]): PlanArmResult => ({ id, label, perSeed });

const meta = (n: number): PlanReportMeta => ({
  date: '2026-09-22',
  seeds: PLAN_EVAL_SEEDS.slice(0, n),
  datasetSha256: 'deadbeef'.repeat(8),
  batchDays: [90, 150, 210],
  batchK: 12,
  loadPenalty: 0.06,
});

describe('datasetFingerprint (lop 2)', () => {
  it('DONG BANG: 20 bo du lieu danh gia 3001-3020 khong duoc doi', () => {
    const ds = PLAN_EVAL_SEEDS.map((seed) => generateSimulation({ ...DEFAULT_SIM, seed }));
    expect(datasetFingerprint(ds).combined).toBe(FROZEN_PLAN_EVAL_SHA256);
  });
});

describe('descriptiveTable', () => {
  it('moi nhanh mot dong, trung binh dung tren cac hat giong', () => {
    const results = [
      arm('planned', 'Cách đã cài', [s({ maxShare: 0.3, pOnTime: 0.5 }), s({ maxShare: 0.5, pOnTime: 0.7 })]),
      arm('roundRobin', 'Chia vòng tròn', [s({ maxShare: 0.2, pOnTime: 0.3 }), s({ maxShare: 0.2, pOnTime: 0.3 })]),
    ];
    const text = descriptiveTable(results);
    // Neo dung O (nguoi nhieu nhat la COT THU HAI, ngay sau ten) - khong chi kiem "co xuat hien o dau do trong bang",
    // vi 40,0% con trung voi gia tri MAC DINH cua cot Top-1 (0,4) o ca hai dong, de bo lot mutant doc nham cot.
    expect(text).toContain('| Cách đã cài | 40,0% |'); // trung binh maxShare: (0,3+0,5)/2 = 0,4
    expect(text).toContain('| Chia vòng tròn | 20,0% |'); // maxShare: (0,2+0,2)/2 = 0,2
  });
});

describe('PRIMARY_PLAN_COMPARISONS', () => {
  it('dung 5 phep so sanh, tat ca deu so voi "planned"', () => {
    expect(PRIMARY_PLAN_COMPARISONS).toHaveLength(5);
    for (const [a] of PRIMARY_PLAN_COMPARISONS) expect(a).toBe('planned');
    expect(new Set(PRIMARY_PLAN_COMPARISONS.map(([, b]) => b)).size).toBe(5); // 5 nhanh doi chieu khac nhau
  });
});

describe('comparisonTable', () => {
  it('nguoi nhieu nhat THAP hon la tot hon; P(dung han) CAO hon la tot hon - hai chieu NGUOC nhau', () => {
    // "planned" thap hon maxShare va cao hon pOnTime so voi "independent" o CA HAI hat giong -> ket luan chac chan
    const planned = arm('planned', 'Cách đã cài', [s({ maxShare: 0.3, pOnTime: 0.6 }), s({ maxShare: 0.35, pOnTime: 0.55 })]);
    const independent = arm('independent', 'Chấm riêng từng thẻ', [s({ maxShare: 0.5, pOnTime: 0.4 }), s({ maxShare: 0.55, pOnTime: 0.42 })]);
    const text = comparisonTable([planned, independent], [['planned', 'independent']]);
    expect(text).toContain('Cách đã cài − Chấm riêng từng thẻ');
    expect(text.match(/nhánh 1 tốt hơn/g)).toHaveLength(2); // ca tap trung (thap hon) lan dung han (cao hon)
  });

  it('thieu nhanh trong ket qua thi nem loi VOI DUNG THONG DIEP (khong phai loi ngam do doc undefined)', () => {
    expect(() => comparisonTable([arm('planned', 'x', [s(), s()])], [['planned', 'roundRobin']])).toThrow(/thieu nhanh/);
  });
});

describe('kSweepTable', () => {
  it('moi K mot dong, dung ca cot "da cai" va "doc lap"', () => {
    const points: KSweepPoint[] = [
      { k: 6, planned: arm('planned', 'p', [s({ maxShare: 0.4 }), s({ maxShare: 0.4 })]), independent: arm('independent', 'i', [s({ maxShare: 0.6 }), s({ maxShare: 0.6 })]) },
      { k: 24, planned: arm('planned', 'p', [s({ maxShare: 0.3 }), s({ maxShare: 0.3 })]), independent: arm('independent', 'i', [s({ maxShare: 0.5 }), s({ maxShare: 0.5 })]) },
    ];
    const text = kSweepTable(points);
    expect(text).toContain('| 6 |');
    expect(text).toContain('| 24 |');
    expect(text).toContain('40,0%');
    expect(text).toContain('60,0%');
  });
});

describe('missingPolicyTable', () => {
  it('mot dong duy nhat, dung ten hai nhanh trong tieu de; maxShare va Gini phai la HAI cot khac nhau (khong doc nham cot)', () => {
    const drop = arm('planned', 'DROP', [s({ maxShare: 0.3, gini: 0.2, pOnTime: 0.5 }), s({ maxShare: 0.3, gini: 0.2, pOnTime: 0.5 })]);
    // Chenh lech maxShare (+0,020) va Gini (+0,050) CO Y chon khac nhau de phat hien loi doc nham cot
    const neutral = arm('planned', 'NEUTRAL', [s({ maxShare: 0.32, gini: 0.25, pOnTime: 0.51 }), s({ maxShare: 0.32, gini: 0.25, pOnTime: 0.51 })]);
    const text = missingPolicyTable(drop, neutral);
    expect(text).toContain('NEUTRAL − DROP');
    expect(text).toContain('+0,020'); // chenh lech maxShare tinh tay: 0,32-0,30
    expect(text).toContain('+0,050'); // chenh lech Gini tinh tay: 0,25-0,20
  });
});

const SEVEN_IDS: PlanArmId[] = ['independent', 'planned', 'plannedCap', 'plannedPenalty10', 'plannedPenalty20', 'roundRobin', 'oracleGreedy'];
const allArms = (n: number): PlanArmResult[] => SEVEN_IDS.map((id, k) => arm(id, `Nhánh ${id}`, Array.from({ length: n }, (_, i) => s({ pOnTime: 0.3 + 0.02 * k + 0.001 * i }))));

describe('buildPlanReport', () => {
  it('du cac muc; canh bao khi < 20 hat giong, khong canh bao khi du 20', () => {
    const few = buildPlanReport({ meta: meta(3), main: allArms(3) });
    expect(few).toContain('**Cảnh báo**');
    const full = buildPlanReport({ meta: meta(20), main: allArms(20) });
    expect(full).not.toContain('**Cảnh báo**');
    for (const h of ['## 1. ', '## 2. ', '## Giới hạn']) expect(full).toContain(h);
    expect(full).not.toContain('## 3. '); // khong truyen kSweep/missingPolicy thi khong co muc 3/4
    // Noi dung THAT cua allArms() phai co mat (khong phai bang rong / khong goi ham dung bao cao con)
    expect(full).toContain('Nhánh planned');
    expect(full).toContain('Nhánh oracleGreedy');
  });

  it('co kSweep/missingPolicy thi them muc 3 va 4', () => {
    const points: KSweepPoint[] = [{ k: 12, planned: arm('planned', 'p', [s(), s()]), independent: arm('independent', 'i', [s(), s()]) }];
    const text = buildPlanReport({
      meta: meta(3),
      main: allArms(3),
      kSweep: points,
      missingPolicy: { drop: arm('planned', 'DROP', [s(), s()]), neutral: arm('planned', 'NEUTRAL', [s(), s()]) },
    });
    expect(text).toContain('## 3. Quét cỡ đợt K');
    expect(text).toContain('## 4. Thành phần thiếu dữ liệu');
  });
});
