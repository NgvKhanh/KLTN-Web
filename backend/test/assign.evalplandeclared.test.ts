// Buoc 19 - danh gia lai lop 2 khi co thanh phan Ho so (evalPlanBatches BatchOptions + evalPlanDeclaredRun.ts). HAM THUAN.
import { describe, expect, it } from 'vitest';
import { planAssignments } from '../src/modules/assign/assign.plan';
import { DEFAULT_WEIGHTS, LEGACY_WEIGHTS_V1 } from '../src/modules/assign/assign.score';
import { prepare } from '../src/scripts/evalDeclaredRun';
import { cutBatch, PLAN_BATCH_DAYS, PLAN_BATCH_K } from '../src/scripts/evalPlanBatches';
import {
  buildPlanDeclaredReport,
  PLAN_DECLARED_ARMS,
  PLAN_DECLARED_CONFIGS,
  PLAN_WORLDS,
  planDeclaredDiffTable,
  planDeclaredExperiment,
  planDeclaredSeries,
  planDeclaredTable,
  type PlanDeclaredResult,
} from '../src/scripts/evalPlanDeclaredRun';
import { runArmOnBatch, runPlanArmOnDataset, type PlanBatchSummary } from '../src/scripts/evalPlanRun';

const DS = [prepare(9403), prepare(9404)]; // dev, ngoai 3001-3020
const full3 = PLAN_DECLARED_CONFIGS.find((c) => c.id === 'full3')!;
const full4 = PLAN_DECLARED_CONFIGS.find((c) => c.id === 'full4')!;

describe('cutBatch - tuy chon cua buoc 19', () => {
  const ds = DS[0]!;

  it('khong truyen gi = y nhu buoc 9: trong so LEGACY, ung vien KHONG co khoa declared; truyen {} cung vay', () => {
    const a = cutBatch(ds.data, 150, PLAN_BATCH_K)!;
    const b = cutBatch(ds.data, 150, PLAN_BATCH_K, {})!;
    expect(a.ctx.weights).toEqual(LEGACY_WEIGHTS_V1);
    expect(a.candidates.every((c) => !('declared' in c))).toBe(true);
    expect(b.candidates).toEqual(a.candidates);
    expect(b.ctx).toEqual(a.ctx);
  });

  it('co ho so + trong so: moi ung vien mang muc khai cua CHINH minh ([] = khong khai), ctx dung bo trong so da truyen', () => {
    const b = cutBatch(ds.data, 150, PLAN_BATCH_K, { declared: ds.items, weights: DEFAULT_WEIGHTS })!;
    expect(b.ctx.weights).toEqual(DEFAULT_WEIGHTS);
    for (const c of b.candidates) expect(c.declared, c.userId).toEqual(ds.items.get(c.userId) ?? null);
    expect(b.candidates.some((c) => (c.declared?.length ?? 0) > 0)).toBe(true);
    expect(b.candidates.some((c) => c.declared?.length === 0)).toBe(true); // co nguoi khong khai (pNone 0,3)
    // Ho so KHONG doi lich su / tai / the trong dot
    const plain = cutBatch(ds.data, 150, PLAN_BATCH_K)!;
    expect(b.cards).toEqual(plain.cards);
    expect(b.candidates.map((c) => [c.userId, c.history, c.openCards])).toEqual(plain.candidates.map((c) => [c.userId, c.history, c.openCards]));
  });

  it('coldStart (W2): khong ai co lich su hay the dang mo luc bat dau dot; the trong dot, ho boi, kho IDF giu nguyen', () => {
    const cold = cutBatch(ds.data, 150, PLAN_BATCH_K, { coldStart: true })!;
    const plain = cutBatch(ds.data, 150, PLAN_BATCH_K)!;
    // snapshotAsOf CO Y dua ca the xong SAU `now` vao history (bo cham tu bo - kiem chong ro ri tuong lai), nen "khong co lich su"
    // nghia la khong co the nao xong TRUOC `now`
    const usable = (b: typeof cold, c: (typeof cold.candidates)[number]) => c.history.filter((h) => h.completedAt.getTime() <= b.ctx.now.getTime());
    expect(plain.candidates.some((c) => usable(plain, c).length > 0)).toBe(true);
    expect(plain.candidates.some((c) => c.openCards.length > 0)).toBe(true);
    for (const c of cold.candidates) {
      expect(usable(cold, c), c.userId).toEqual([]);
      expect(c.openCards, c.userId).toEqual([]);
    }
    // The xong SAU dot (tuong lai) KHONG bi xoa trang: chi the giao truoc ngay quyet dinh
    expect(cold.candidates.some((c) => c.history.length > 0)).toBe(true);
    expect(cold.cards).toEqual(plain.cards);
    expect(cold.poolKeys).toEqual(plain.poolKeys);
    expect(cold.ctx.idf).toEqual(plain.ctx.idf);
  });

  it('coldStart chi xoa trang the giao TRUOC ngay quyet dinh: the giao CUNG ngay (ngoai dot) van la tai cua nguoi nhan', () => {
    // K = 1 de chac co the cung ngay nam ngoai dot (voi K = 12 rat hiem)
    let checked = 0;
    for (let day = 60; day <= 240 && checked < 3; day += 1) {
      const cold = cutBatch(ds.data, day, 1, { coldStart: true });
      if (!cold) continue;
      const inBatch = new Set(cold.cards.map((c) => c.id));
      for (const c of ds.data.cards.filter((x) => x.assignedDay === day && !inBatch.has(x.key) && cold.poolKeys.includes(x.assigneeKey))) {
        const cand = cold.candidates.find((x) => x.userId === c.assigneeKey)!;
        expect(cand.openCards.map((o) => o.cardId), `${day} ${c.key}`).toContain(c.key);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('"planned" tren dot CO ho so van DUNG BANG goi thang planAssignments() (moi ngay, ca hai the gioi)', () => {
    for (const day of PLAN_BATCH_DAYS) {
      for (const coldStart of [false, true]) {
        const batch = cutBatch(ds.data, day, PLAN_BATCH_K, { declared: ds.items, weights: DEFAULT_WEIGHTS, coldStart });
        if (!batch) continue;
        const viaProduct = planAssignments({ cards: batch.cards, candidates: batch.candidates, ctx: batch.ctx }).map((row) => row.assigneeId);
        expect(runArmOnBatch(batch, 'planned').map((r) => r.assigneeId), `${day} ${coldStart}`).toEqual(viaProduct);
      }
    }
  });
});

describe('planDeclaredSeries / planDeclaredExperiment', () => {
  it('3 thanh phan o W1 = DUNG so cua buoc 9 (runPlanArmOnDataset mac dinh), tung hat giong', () => {
    for (const arm of PLAN_DECLARED_ARMS) {
      const got = planDeclaredSeries(DS, full3, 'W1', arm);
      const want = DS.map((ds) => runPlanArmOnDataset(ds.data, arm, PLAN_BATCH_DAYS, PLAN_BATCH_K)!);
      expect(got, arm).toEqual(want);
    }
  });

  it('BAT BIEN §17.6: 4 thanh phan ma CHUA AI khai ho so -> chia viec y nhu 3 thanh phan (ca hai the gioi)', () => {
    for (const world of PLAN_WORLDS) {
      const noProfiles = DS.map((ds) => ({ ...ds, items: new Map(ds.data.people.map((p) => [p.key, []])) }));
      const got = planDeclaredSeries(noProfiles, full4, world, 'planned');
      const want = planDeclaredSeries(DS, full3, world, 'planned');
      expect(got.map((s) => [s.maxShare, s.gini, s.top1, s.regret]), world).toEqual(want.map((s) => [s.maxShare, s.gini, s.top1, s.regret]));
      for (let i = 0; i < got.length; i += 1) expect(Math.abs(got[i]!.pOnTime - want[i]!.pOnTime)).toBeLessThan(1e-12);
    }
  });

  it('ho so THAT su doi ket qua (4 thanh phan co ho so khac 3 thanh phan) va W2 khac W1', () => {
    const a = planDeclaredSeries(DS, full4, 'W1', 'planned');
    const b = planDeclaredSeries(DS, full3, 'W1', 'planned');
    expect(a).not.toEqual(b);
    expect(planDeclaredSeries(DS, full3, 'W2', 'planned')).not.toEqual(b);
  });

  it('experiment: du 2 the gioi x 2 cach chia x 2 cau hinh, moi ket qua mot so / hat giong', () => {
    const r = planDeclaredExperiment(DS);
    expect(r).toHaveLength(PLAN_WORLDS.length * PLAN_DECLARED_ARMS.length * PLAN_DECLARED_CONFIGS.length);
    expect(new Set(r.map((x) => `${x.world}/${x.arm}/${x.configId}`)).size).toBe(8);
    for (const x of r) expect(x.perSeed).toHaveLength(DS.length);
    // Moi o bang lay dung ket qua cua no
    const one = r.find((x) => x.world === 'W2' && x.arm === 'plannedPenalty10' && x.configId === 'full4')!;
    expect(one.perSeed).toEqual(planDeclaredSeries(DS, full4, 'W2', 'plannedPenalty10'));
  });
});

describe('bao cao (so gia, tinh tay)', () => {
  const S = (maxShare: number, gini: number, pOnTime: number): PlanBatchSummary => ({
    cards: 12,
    unassigned: 0,
    maxShare,
    gini,
    pOnTime,
    regret: 0.1,
    top1: 0.5,
    risky: 0.2,
  });
  const results: PlanDeclaredResult[] = [];
  for (const world of PLAN_WORLDS) {
    for (const arm of PLAN_DECLARED_ARMS) {
      // full3: pOnTime 0,40 / 0,42; full4: + (W1 0,01 moi hat giong, W2 0,05) -> chenh lech khong doi -> KTC suy bien = gia tri
      const up = world === 'W1' ? 0.01 : 0.05;
      results.push({ world, arm, configId: 'full3', perSeed: [S(0.4, 0.2, 0.4), S(0.3, 0.1, 0.42)] });
      results.push({ world, arm, configId: 'full4', perSeed: [S(0.5, 0.3, 0.4 + up), S(0.4, 0.2, 0.42 + up)] });
    }
  }

  it('bang mo ta: dung dong, dung o', () => {
    const t = planDeclaredTable(results, 'W1');
    expect(t).toContain('| Cộng thẻ vừa giao vào tải (cách đã cài) | 3 thành phần (như bước 9, không hồ sơ) | 35,0% | 0,150 |');
    expect(t).toContain('| Cộng thẻ vừa giao vào tải (cách đã cài) | 4 thành phần (mặc định mới + hồ sơ tự khai) | 45,0% | 0,250 |');
  });

  it('bang chenh lech: 4 − 3 theo hat giong, ket luan chi tu KTC', () => {
    const t = planDeclaredDiffTable(results);
    expect(t).toContain('| W1 | Cộng thẻ vừa giao vào tải (cách đã cài) | +0,100 [+0,100; +0,100] | +0,100 [+0,100; +0,100] | +0,010 [+0,010; +0,010] | nhánh 1 tốt hơn |');
    expect(t).toContain('| W2 | Cách trên + phạt 10 điểm mỗi thẻ đã nhận | +0,100 [+0,100; +0,100] | +0,100 [+0,100; +0,100] | +0,050 [+0,050; +0,050] | nhánh 1 tốt hơn |');
  });

  it('bao cao day du: tieu de, canh bao it hat giong, ghi ro "mo ta, khong phai kiem dinh", hai the gioi', () => {
    const r = buildPlanDeclaredReport({ date: '2026-09-28', seeds: [3001, 3002], datasetSha256: 'a'.repeat(64), profilesSha256: 'b'.repeat(64) }, results);
    expect(r).toContain('# Đánh giá lớp 2 (chia việc cả đợt) khi có thành phần Hồ sơ — bước 19');
    expect(r).toContain('chỉ 2 hạt giống');
    expect(r).toContain('Mô tả, không phải kiểm định');
    expect(r).toContain('## 1. W1');
    expect(r).toContain('## 2. W2');
    expect(r).toContain('`aaaaaaaaaaaaaaaa…`');
    expect(r).toContain('`bbbbbbbbbbbbbbbb…`');
  });
});
