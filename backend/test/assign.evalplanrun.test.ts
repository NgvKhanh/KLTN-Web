// Buoc 9a - lop 2: bo chay danh gia (evalPlanRun.ts). HAM THUAN: khong cham CSDL.
import { describe, expect, it } from 'vitest';
import { planAssignments, urgencyOrder, type PlanCard } from '../src/modules/assign/assign.plan';
import { rankCandidates, type CandidateInput, type OpenCard, type ScoreContext } from '../src/modules/assign/assign.score';
import { countTerms } from '../src/modules/assign/assign.text';
import { buildIdf } from '../src/modules/assign/assign.tfidf';
import { makeRoundRobin, pickCapped, pickIndependent, pickPenalty, pickPlannedLikeProduct, runGreedyBatch } from '../src/scripts/evalPlanArms';
import { cutBatch, cutBatches, PLAN_BATCH_DAYS, PLAN_BATCH_K, type PlanBatch } from '../src/scripts/evalPlanBatches';
import { gini, maxShare, mean } from '../src/scripts/evalAssignStats';
import {
  meanSummaries,
  PLAN_ARMS,
  PLAN_EVAL_SEEDS,
  runArmOnBatch,
  runPlanArmOnDataset,
  scoreRows,
  summarizeBatch,
  type PlanArmRow,
  type ScoredPlanRow,
} from '../src/scripts/evalPlanRun';
import { DEFAULT_LOAD_PENALTY, DEFAULT_SIM, generateSimulation, onTimeProbability } from '../src/scripts/simGenerator';

const SEEDS = [9402, 9403]; // dev, ngoai 2001-2020 (lop 1) va 3001-3020 (lop 2 chinh thuc)

describe('PLAN_EVAL_SEEDS', () => {
  it('20 hat giong, tach khoi hat giong lop 1 (2001-2020) va hat giong dev (9xxx)', () => {
    expect(PLAN_EVAL_SEEDS).toHaveLength(20);
    expect(PLAN_EVAL_SEEDS[0]).toBe(3001);
    expect(PLAN_EVAL_SEEDS[19]).toBe(3020);
    expect(PLAN_EVAL_SEEDS.some((s) => s >= 2001 && s <= 2020)).toBe(false);
    expect(PLAN_EVAL_SEEDS.some((s) => s >= 9000)).toBe(false);
  });
});

describe('runArmOnBatch("planned") - phai DUNG BANG goi thang planAssignments() (khong phai ban sao)', () => {
  for (const seed of SEEDS) {
    for (const day of PLAN_BATCH_DAYS) {
      it(`hat giong ${seed}, ngay ${day}`, () => {
        const data = generateSimulation({ ...DEFAULT_SIM, seed });
        const batch = cutBatch(data, day, PLAN_BATCH_K);
        if (!batch) return; // khong du du lieu o diem nay - bo qua, cac to hop khac da phu du
        const viaArm = runArmOnBatch(batch, 'planned');
        const viaProduct = planAssignments({ cards: batch.cards, candidates: batch.candidates, ctx: batch.ctx }).map((row) => {
          const info = row.assigneeId === null ? undefined : row.ranked.find((r) => r.userId === row.assigneeId);
          return { cardId: row.card.id, assigneeId: row.assigneeId, load: info?.load ?? null, capacity: info?.capacity ?? null };
        });
        const viaGenericDriver = runGreedyBatch(batch.cards, batch.candidates, batch.ctx, pickPlannedLikeProduct);
        expect(viaArm).toEqual(viaProduct);
        expect(viaArm).toEqual(viaGenericDriver);
      });
    }
  }
});

describe('PLAN_ARMS / runArmOnBatch - moi nhanh chay duoc tren mot dot that, tra ve hoan vi hop le', () => {
  const data = generateSimulation({ ...DEFAULT_SIM, seed: SEEDS[0] });
  const batch = cutBatch(data, 150, PLAN_BATCH_K)!;

  it('7 nhanh, khoa duy nhat, dung id da khai bao', () => {
    expect(PLAN_ARMS).toHaveLength(7);
    expect(new Set(PLAN_ARMS.map((a) => a.id)).size).toBe(7);
  });

  for (const spec of PLAN_ARMS) {
    it(`nhanh "${spec.id}": ${PLAN_BATCH_K} dong, moi dong ung voi mot the trong dot, nguoi duoc chon (neu co) nam trong ho boi`, () => {
      const rows = runArmOnBatch(batch, spec.id);
      expect(rows).toHaveLength(PLAN_BATCH_K);
      expect(rows.map((r) => r.cardId)).toEqual(urgencyOrder(batch.cards).map((c) => c.id));
      for (const r of rows) {
        if (r.assigneeId !== null) expect(batch.poolKeys).toContain(r.assigneeId);
      }
    });
  }

  it('dispatch dung: moi id (tru "planned", "oracleGreedy" da co test rieng) goi dung ham chon VOI DUNG THAM SO (bat loi tron id / sai cong thuc tran / sai lambda)', () => {
    const cap = Math.ceil(batch.cards.length / batch.candidates.length);
    expect(runArmOnBatch(batch, 'independent')).toEqual(runGreedyBatch(batch.cards, batch.candidates, batch.ctx, pickIndependent));
    expect(runArmOnBatch(batch, 'plannedCap')).toEqual(runGreedyBatch(batch.cards, batch.candidates, batch.ctx, pickCapped(cap)));
    expect(runArmOnBatch(batch, 'plannedPenalty10')).toEqual(runGreedyBatch(batch.cards, batch.candidates, batch.ctx, pickPenalty(10)));
    expect(runArmOnBatch(batch, 'plannedPenalty20')).toEqual(runGreedyBatch(batch.cards, batch.candidates, batch.ctx, pickPenalty(20)));
    expect(runArmOnBatch(batch, 'roundRobin')).toEqual(
      runGreedyBatch(batch.cards, batch.candidates, batch.ctx, makeRoundRobin(batch.candidates.map((c) => c.userId)))
    );
    // Ba nhanh phat (10, 20, va cach chia "plannedCap") phai la BA CACH khac nhau, khong phai ba ten cho cung mot ham
    const p10 = runArmOnBatch(batch, 'plannedPenalty10');
    const p20 = runArmOnBatch(batch, 'plannedPenalty20');
    const capRows = runArmOnBatch(batch, 'plannedCap');
    expect(p10).not.toEqual(p20);
    expect(p10).not.toEqual(capRows);
  });
});

describe('runArmOnBatch("oracleGreedy") - doi chieu doc lap (tinh lai bang chinh onTimeProbability/skillAt cong khai)', () => {
  it('khop voi mot vong lap tham lam viet lai rieng trong test (khong dung chung ma nguon voi evalPlanRun.ts)', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: SEEDS[0], people: 3, boards: 2, cardsPerBoard: 20, days: 150 });
    const batch = cutBatch(data, 90, 4);
    if (!batch) throw new Error('bo du lieu thu nho khong cat duoc dot - chon lai tham so');

    // Vong lap doc lap: tai MOI buoc chon nguoi co P(dung han) THAT cao nhat, dung tai LUC GIAO (cong don qua vong lap nay).
    const given = new Map<string, OpenCard[]>(batch.candidates.map((c) => [c.userId, []]));
    const expected: (string | null)[] = [];
    for (const card of urgencyOrder(batch.cards)) {
      const pool = batch.candidates.map((c) => ({ ...c, openCards: [...c.openCards, ...given.get(c.userId)!] }));
      const byId = new Map(rankCandidates(card, pool, batch.ctx).map((r) => [r.userId, r]));
      let best: string | null = null;
      let bestP = -Infinity;
      for (const key of batch.poolKeys) {
        const info = byId.get(key)!;
        const p = onTimeProbability(batch.skillOf(key, card.id), info.load, info.capacity, DEFAULT_LOAD_PENALTY);
        if (best === null || p > bestP || (p === bestP && key < best)) {
          best = key;
          bestP = p;
        }
      }
      given.get(best!)!.push({ cardId: card.id, startDate: card.startDate, dueDate: card.dueDate });
      expected.push(best);
    }

    const rows = runArmOnBatch(batch, 'oracleGreedy');
    expect(rows.map((r) => r.assigneeId)).toEqual(expected);
  });

  it('twins (p1, p2 CUNG ky nang, suc chua nho) + p3 yeu hon: hoa o the dau, tai cong don lam DOI nguoi o the sau, roi hoa lai - kiem CA tai bao cao (bat mutant khi tai khong cong don / doc tai o info sai)', () => {
    const IDF2 = buildIdf(['alpha'].map((t) => countTerms({ title: t })));
    const CTX2: ScoreContext = { idf: IDF2, now: new Date('2026-01-01T00:00:00.000Z'), groupOnTimeRate: 0.5 };
    const win: [Date, Date] = [new Date('2026-01-01T00:00:00.000Z'), new Date('2026-01-06T00:00:00.000Z')];
    const pcard = (id: string, position: number): PlanCard => ({ id, title: 'alpha', description: null, startDate: win[0], dueDate: win[1], position });
    const candidates2: CandidateInput[] = [
      { userId: 'p1', history: [], openCards: [], maxParallelCards: 1 },
      { userId: 'p2', history: [], openCards: [], maxParallelCards: 1 },
      { userId: 'p3', history: [], openCards: [], maxParallelCards: 5 },
    ];
    const cards2: PlanCard[] = [pcard('ca', 0), pcard('cb', 1), pcard('cc', 2)];
    const batch2: PlanBatch = {
      seed: 1,
      day: 0,
      cards: cards2,
      candidates: candidates2,
      ctx: CTX2,
      poolKeys: ['p1', 'p2', 'p3'],
      skillOf: (userId) => (userId === 'p3' ? 0 : 0.5), // p1/p2 la sinh doi ve ky nang; p3 luon thua
      bestSkill: () => 0.5,
    };
    const rows = runArmOnBatch(batch2, 'oracleGreedy');
    // suc chua 1 -> vuot NUA suc chua (0,5) tu the thu 2 chong lan tro di -> the 1 hoa (chon p1), the 2 tai cua p1 keo
    // diem xuong nen p2 thang, the 3 lai hoa (ca hai deu tai 1) -> p1 thang lai (hoa thi userId nho hon)
    expect(rows.map((r) => r.assigneeId)).toEqual(['p1', 'p2', 'p1']);
    expect(rows.map((r) => r.load)).toEqual([0, 0, 1]);
  });
});

const fakeBatch = {
  bestSkill: (cardId: string) => ({ c1: 0.8, c2: 0.5 })[cardId]!,
  skillOf: (userId: string, cardId: string) =>
    ({ 'A|c1': 0.8, 'B|c1': 0.3, 'A|c2': 0.2, 'B|c2': 0.5 })[`${userId}|${cardId}`]!,
};

describe('scoreRows', () => {
  it('tinh dung bestSkill/chosenSkill/pOnTime (doi chieu voi onTimeProbability cong khai); assigneeId null -> ca ba deu null/0', () => {
    const rows: PlanArmRow[] = [
      { cardId: 'c1', assigneeId: 'A', load: 1, capacity: 5 },
      { cardId: 'c2', assigneeId: 'B', load: 2, capacity: 4 },
      { cardId: 'c1', assigneeId: null, load: null, capacity: null },
    ];
    const scored = scoreRows(rows, fakeBatch);
    expect(scored[0]).toMatchObject({ bestSkill: 0.8, chosenSkill: 0.8, pOnTime: onTimeProbability(0.8, 1, 5, DEFAULT_LOAD_PENALTY) });
    expect(scored[1]).toMatchObject({ bestSkill: 0.5, chosenSkill: 0.5, pOnTime: onTimeProbability(0.5, 2, 4, DEFAULT_LOAD_PENALTY) });
    expect(scored[2]).toMatchObject({ bestSkill: 0.8, chosenSkill: null, pOnTime: null });
  });

  it('dung loadPenalty tuy chinh khi truyen vao (tai=4, suc chua=5 -> vuot nua suc chua nen muc phat co anh huong)', () => {
    const rows: PlanArmRow[] = [{ cardId: 'c1', assigneeId: 'A', load: 4, capacity: 5 }];
    const scored = scoreRows(rows, fakeBatch, 0.2);
    expect(scored[0]!.pOnTime).toBeCloseTo(onTimeProbability(0.8, 4, 5, 0.2), 12);
    expect(scored[0]!.pOnTime).not.toBeCloseTo(onTimeProbability(0.8, 4, 5, DEFAULT_LOAD_PENALTY), 6);
  });
});

const sc = (cardId: string, assigneeId: string | null, bestSkill: number, chosenSkill: number | null, pOnTime: number | null): ScoredPlanRow => ({
  cardId,
  assigneeId,
  load: assigneeId === null ? null : 0,
  capacity: assigneeId === null ? null : 5,
  bestSkill,
  chosenSkill,
  pOnTime,
});

describe('summarizeBatch', () => {
  it('tinh tay tren vi du nho: 3 nguoi, 4 the (2 trung top1 + 1 trat top1 + 1 khong ai nhan) - LECH ti le (khong phai 50/50) de bat duoc loi dao dieu kien top1/risky', () => {
    const scored = [
      sc('x', 'A', 0.8, 0.8, 0.7), // trung top1, khong rui ro
      sc('y', 'A', 0.6, 0.4, 0.3), // trat top1, rui ro (< 0,5)
      sc('w', 'B', 0.5, 0.5, 0.9), // trung top1, khong rui ro
      sc('z', null, 0.9, null, null), // khong ai nhan
    ];
    const s = summarizeBatch(scored, ['A', 'B', 'C']);
    expect(s.cards).toBe(4);
    expect(s.unassigned).toBeCloseTo(1 / 4, 12);
    expect(s.maxShare).toBe(maxShare([2, 1, 0])); // A:2, B:1, C:0
    expect(s.gini).toBe(gini([2, 1, 0]));
    expect(s.pOnTime).toBeCloseTo(mean([0.7, 0.3, 0.9]), 12);
    expect(s.regret).toBeCloseTo(mean([0, 0.2, 0]), 12);
    expect(s.top1).toBeCloseTo(2 / 3, 12); // x, w trung; y trat
    expect(s.risky).toBeCloseTo(1 / 3, 12); // chi y co pOnTime < 0,5
  });

  it('khong ai duoc chon the nao -> pOnTime/regret/top1/risky = 0 (khong NaN), maxShare/gini = 0', () => {
    const s = summarizeBatch([sc('x', null, 0.5, null, null)], ['A', 'B']);
    expect(s).toMatchObject({ pOnTime: 0, regret: 0, top1: 0, risky: 0, maxShare: 0, gini: 0, unassigned: 1 });
  });

  it('mang rong hoac ho boi rong thi nem loi', () => {
    expect(() => summarizeBatch([], ['A'])).toThrow(RangeError);
    expect(() => summarizeBatch([sc('x', 'A', 0.5, 0.5, 0.5)], [])).toThrow(RangeError);
  });
});

describe('meanSummaries', () => {
  it('trung binh TUNG thanh phan (khong doc nham cot: gini/top1/risky/unassigned deu khac nhau giua hai dot)', () => {
    const a = summarizeBatch([sc('x', 'A', 1, 1, 0.8)], ['A']); // trung top1, khong rui ro
    const b = summarizeBatch([sc('x', 'A', 1, 0, 0.2)], ['A']); // trat top1, rui ro
    const m = meanSummaries([a, b]);
    expect(m.cards).toBe(1);
    expect(m.unassigned).toBe(0);
    expect(m.maxShare).toBe(1); // ca hai deu 1 nguoi nhan het
    expect(m.gini).toBe(0); // chi 1 nguoi trong ho boi -> gini luon 0 o ca hai dot
    expect(m.pOnTime).toBeCloseTo(0.5, 12);
    expect(m.regret).toBeCloseTo(0.5, 12);
    expect(m.top1).toBe(0.5); // (1 + 0) / 2
    expect(m.risky).toBe(0.5); // (0 + 1) / 2
  });

  it('mang rong nem loi', () => {
    expect(() => meanSummaries([])).toThrow(RangeError);
  });
});

describe('runPlanArmOnDataset', () => {
  it('null khi khong cat duoc dot nao', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: SEEDS[0] });
    expect(runPlanArmOnDataset(data, 'planned', [data.config.days + 1000], PLAN_BATCH_K)).toBeNull();
  });

  it('bang trung binh cua tung dot tinh rieng (doi chieu voi cutBatches + summarizeBatch goi truc tiep)', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: SEEDS[0] });
    const got = runPlanArmOnDataset(data, 'roundRobin', PLAN_BATCH_DAYS, PLAN_BATCH_K)!;
    const manual = meanSummaries(
      cutBatches(data, PLAN_BATCH_DAYS, PLAN_BATCH_K).map((b) => summarizeBatch(scoreRows(runArmOnBatch(b, 'roundRobin'), b), b.poolKeys))
    );
    expect(got).toEqual(manual);
  });
});
