// Buoc 7a - bo CHAY danh gia (evalAssignRun.ts). THUAN: khong cham CSDL.
// Hat giong phat trien 9xxx; bo hat giong danh gia 2001-2020 chi dung cho lan chay chinh thuc.
import { describe, expect, it } from 'vitest';
import { buildIdf } from '../src/modules/assign/assign.tfidf';
import { LEGACY_WEIGHTS_V1, rankCandidates, type RankedCandidate, type ScoreCard, type Weights } from '../src/modules/assign/assign.score';
import { MAIN_ARMS, scorerArm, type Arm, type ArmFeedback, type ArmInput } from '../src/scripts/evalAssignArms';
import {
  DEFAULT_MIN_DAY,
  EVAL_SEEDS,
  STREAM_SALTS,
  bestSkillArm,
  oracleArm,
  planDecisions,
  runArm,
  summarizeDecisions,
  type DecisionRecord,
  type Leader,
  type RunMode,
} from '../src/scripts/evalAssignRun';
import { streamSeed } from '../src/scripts/evalAssignStats';
import {
  DEFAULT_SIM,
  Rng,
  assignablePool,
  bestCandidate,
  generateSimulation,
  onTimeProbability,
  sampleOutcome,
  skillAt,
  type SimConfig,
  type SimDataset,
} from '../src/scripts/simGenerator';
import { replay, simDate } from '../src/scripts/simReplay';

const SMALL: Partial<SimConfig> = { boards: 3, cardsPerBoard: 14, days: 200 };
const gen = (seed: number, over: Partial<SimConfig> = {}) => generateSimulation({ ...DEFAULT_SIM, ...over, seed });
const arm = (id: string) => MAIN_ARMS.find((a) => a.id === id)!.make;
const full = arm('full');

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

/** Nhanh don gian: luon xep theo khoa (khong dung bo cham) - the gioi chi phu thuoc ho boi. */
const firstKeyArm = (): Arm => ({
  id: 'first',
  label: 'first',
  rank: ({ snapshot }) => ({ order: snapshot.candidates.map((c) => c.userId).sort(), ranked: null }),
});

/** Boc mot nhanh de "nhin trom" dau vao cua tung quyet dinh. */
function probeArm(onRank: (input: ArmInput) => void, inner: Arm = scorerArm({ id: 'probe', label: 'probe' })): Arm {
  return {
    id: 'probe',
    label: 'probe',
    rank(input) {
      onRank(input);
      return inner.rank(input);
    },
  };
}

describe('planDecisions', () => {
  const data = gen(9001);

  it('dung tap cua replay (giao tu minDay, ho boi >= 2), theo thoi gian, moi phan tu tro dung the', () => {
    const plan = planDecisions(data, DEFAULT_MIN_DAY);
    const expected = data.cards.filter(
      (c) => c.assignedDay >= DEFAULT_MIN_DAY && assignablePool(data.people, c.assignedDay, c.dueDay).length >= 2
    );
    expect(plan.length).toBe(expected.length);
    expect(new Set(plan.map((p) => p.card.key))).toEqual(new Set(expected.map((c) => c.key)));
    for (const p of plan) {
      expect(data.cards[p.cardIndex]).toBe(p.card);
      expect(p.card.assignedDay).toBeGreaterThanOrEqual(DEFAULT_MIN_DAY);
      expect(p.pool.length).toBeGreaterThanOrEqual(2);
    }
    for (let i = 1; i < plan.length; i += 1) {
      const a = plan[i - 1]!;
      const b = plan[i]!;
      expect(b.card.assignedDay).toBeGreaterThanOrEqual(a.card.assignedDay);
      if (b.card.assignedDay === a.card.assignedDay) expect(b.cardIndex).toBeGreaterThan(a.cardIndex); // cung ngay: theo thu tu trong bo
    }
  });

  it('bo qua the co ho boi chi 1 nguoi (nhom 2 nguoi, nguoi thu hai vao muon): khong co lua chon nao de danh gia', () => {
    const two = gen(9004, { people: 2 });
    const inPeriod = two.cards.filter((c) => c.assignedDay >= DEFAULT_MIN_DAY);
    const onePerson = inPeriod.filter((c) => assignablePool(two.people, c.assignedDay, c.dueDay).length === 1);
    expect(onePerson.length).toBeGreaterThan(20); // phep thu khong rong: nhieu the chi co mot nguoi
    const plan = planDecisions(two, DEFAULT_MIN_DAY);
    expect(plan.length).toBe(inPeriod.length - onePerson.length);
    expect(plan.length).toBeGreaterThan(0);
    for (const p of plan) expect(p.pool.length).toBeGreaterThanOrEqual(2);
  });

  it('minDay lon hon thi it quyet dinh hon; qua lon thi khong con gi', () => {
    expect(planDecisions(data, 0).length).toBeGreaterThan(planDecisions(data, 60).length);
    expect(planDecisions(data, 60).length).toBeGreaterThan(planDecisions(data, 200).length);
    expect(planDecisions(data, 10_000)).toEqual([]);
  });
});

describe('che do HISTORY khop replay() cu (moc doi chieu da qua cai loi o buoc 4 va 4b)', () => {
  function expectSame(data: SimDataset) {
    const old = replay(data);
    const r = runArm(data, full, { mode: 'HISTORY' }).summary;
    const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 12);
    expect(r.decisions).toBe(old.n);
    close(r.top1, old.hitScorer);
    close(r.regret, old.regretScorer);
    close(r.pOnTime, old.pOnTimeScorer);
    close(r.topNoHistory, old.topNoHistory);
    // "Nhanh" tham chieu cua replay: phan cong that + ngau nhien ky vong
    close(r.top1Assigned, old.hitActual);
    close(r.regretAssigned, old.regretActual);
    close(r.pOnTimeAssigned, old.pOnTimeActual);
    close(r.chanceTop1, old.hitRandom);
    close(r.chanceRegret, old.regretRandom);
    close(r.chancePOnTime, old.pOnTimeRandom);
    // Hai tran: nguoi ky nang cao nhat / toi uu
    const best = runArm(data, bestSkillArm, { mode: 'HISTORY' }).summary;
    const oracle = runArm(data, oracleArm, { mode: 'HISTORY' }).summary;
    close(best.pOnTime, old.pOnTimeBest);
    close(oracle.pOnTime, old.pOnTimeOracle);
    expect(best.top1).toBe(1);
    expect(best.regret).toBe(0);
    return old;
  }

  it('bo du lieu mac dinh (hat giong phat trien 9001)', () => {
    const old = expectSame(gen(9001));
    expect(old.n).toBeGreaterThan(80); // phep so sanh khong rong
  });

  it('hai bo nho khac (9002, 9003) va cau hinh khac', () => {
    expectSame(gen(9002, SMALL));
    expectSame(gen(9003, { people: 4, boards: 3, cardsPerBoard: 16, days: 220 }));
  });

  it('tuy chon trong so / chuan hoa / thieu du lieu / tham so duoc chuyen xuong DUNG nhu replay', () => {
    const data = gen(9002);
    const cases: { weights?: Weights; normalize?: 'MINMAX' | 'NONE'; missing?: 'DROP' | 'NEUTRAL'; params?: { k: number; halfLifeDays: number } }[] = [
      { weights: { experience: 1, reliability: 0, availability: 0, declared: 0 }, normalize: 'NONE' },
      // Voi MOT thanh phan duy nhat min-max chi la phep bien doi don dieu (thu tu khong doi) nen ca tren KHONG phan biet duoc NONE voi
      // MINMAX; ca duoi day (nhieu thanh phan) moi bat duoc viec `normalize` co duoc chuyen xuong hay khong
      { normalize: 'NONE' },
      { weights: { experience: 0.6, reliability: 0.4, availability: 0, declared: 0 } },
      { missing: 'NEUTRAL' },
      { params: { k: 2, halfLifeDays: 30 } },
    ];
    for (const c of cases) {
      const old = replay(data, c);
      const r = runArm(data, () => scorerArm({ id: 'x', label: 'x', ...c }), { mode: 'HISTORY' }).summary;
      expect(r.top1).toBeCloseTo(old.hitScorer, 12);
      expect(r.pOnTime).toBeCloseTo(old.pOnTimeScorer, 12);
      expect(r.regret).toBeCloseTo(old.regretScorer, 12);
    }
  });
});

describe('the gioi cua che do vong kin', () => {
  it('DOI CHIEU TUNG THE: giao dung nguoi cua bo sinh + dung ket qua cua bo sinh -> the gioi cuoi cung == bo du lieu goc; goi y trung HISTORY o moi quyet dinh khong co the cung ngay sau no', () => {
    const data = gen(9001);
    const owner = new Map(data.cards.map((c) => [c.key, c.assigneeKey]));
    const stub: Leader = { pick: ({ cardKey }) => owner.get(cardKey)! };
    const loop = runArm(data, full, { mode: 'LEADER', leader: stub, replayOutcomes: true, keepWorld: true });
    expect(loop.world!.cards).toEqual(data.cards);

    const history = runArm(data, full, { mode: 'HISTORY' });
    const topOf = new Map(history.decisions.map((d) => [d.cardKey, d.topKey]));
    const plan = planDecisions(data, DEFAULT_MIN_DAY);
    // Phat lai CO (HISTORY) nhin thay cac the giao CUNG NGAY nhung xu ly SAU (nhu tai dang mo); vong kin thi khong ->
    // chi so sanh nhung quyet dinh khong co the nao giao cung ngay o sau
    const comparable = new Set<string>();
    plan.forEach((p, i) => {
      if (!plan.slice(i + 1).some((q) => q.card.assignedDay === p.card.assignedDay)) comparable.add(p.card.key);
    });
    expect(comparable.size).toBeGreaterThan(plan.length * 0.5); // khong rong
    expect(comparable.size).toBeLessThan(plan.length); // va co ca truong hop khong so sanh duoc (neu khong thi khong can loai)
    let same = 0;
    for (const d of loop.decisions) {
      if (!comparable.has(d.cardKey)) continue;
      expect(d.topKey).toBe(topOf.get(d.cardKey));
      same += 1;
    }
    expect(same).toBe(comparable.size);
  });

  it('KHONG ro ri: o ARM / LEADER, quyet dinh i khong bao gio thay the duoc quyet dinh SAU no (lich su hay tai); o HISTORY thi co (kiem chung phep do bat duoc ro ri)', () => {
    const data = gen(9001);
    const plan = planDecisions(data, DEFAULT_MIN_DAY);
    const order = new Map(plan.map((p, i) => [p.card.key, i]));
    const leaks = (mode: RunMode, leader?: Leader) => {
      let n = 0;
      runArm(
        data,
        () =>
          probeArm((input) => {
            const me = order.get(input.card.id!)!;
            for (const cand of input.snapshot.candidates) {
              for (const h of cand.history) if ((order.get(h.cardId) ?? -1) > me) n += 1;
              for (const o of cand.openCards) if ((order.get(o.cardId) ?? -1) > me) n += 1;
            }
          }),
        { mode, leader }
      );
      return n;
    };
    const last: Leader = { pick: ({ ranked }) => ranked[ranked.length - 1]!.userId };
    expect(leaks('ARM')).toBe(0);
    expect(leaks('LEADER', last)).toBe(0);
    expect(leaks('HISTORY')).toBeGreaterThan(0); // phat lai cu co nhin thay the giao cung ngay sau no
  });

  it('cung ngay: the quyet dinh sau khong anh huong the quyet dinh truoc (tai cua nguoi vua nhan khong tinh viec chua giao)', () => {
    const data = gen(9001);
    const plan = planDecisions(data, DEFAULT_MIN_DAY);
    const seenAsOpen: string[][] = plan.map(() => []);
    const idx = new Map(plan.map((p, i) => [p.card.key, i]));
    runArm(
      data,
      () =>
        probeArm((input) => {
          const me = idx.get(input.card.id!)!;
          for (const cand of input.snapshot.candidates) for (const o of cand.openCards) seenAsOpen[me]!.push(o.cardId);
        }),
      { mode: 'ARM' }
    );
    // Co it nhat mot cap cung ngay, va the sau khong xuat hien trong tai cua the truoc; the truoc xuat hien (neu dang mo) o the sau
    const pair = plan.findIndex((p, i) => i > 0 && plan[i - 1]!.card.assignedDay === p.card.assignedDay);
    expect(pair).toBeGreaterThan(0);
    for (let i = 0; i < plan.length - 1; i += 1) {
      if (plan[i + 1]!.card.assignedDay !== plan[i]!.card.assignedDay) continue;
      expect(seenAsOpen[i]).not.toContain(plan[i + 1]!.card.key);
    }
  });

  it('the gioi cuoi cung nhat quan: the do nhanh quyet dinh mang nguoi da giao + ket qua hop le; the con lai KHONG bi sua; du lieu vao khong bi sua (dong bang)', () => {
    const data = deepFreeze(gen(9001));
    const r = runArm(data, full, { mode: 'ARM', keepWorld: true });
    const plan = planDecisions(data, DEFAULT_MIN_DAY);
    expect(r.decisions.length).toBe(plan.length);
    const decided = new Set<number>();
    r.decisions.forEach((d, k) => {
      const p = plan[k]!;
      expect(d.cardKey).toBe(p.card.key);
      decided.add(p.cardIndex);
      const w = r.world!.cards[p.cardIndex]!;
      expect(w.assigneeKey).toBe(d.assignedKey);
      expect(d.assignedKey).toBe(d.topKey); // ARM: nhanh tu giao nguoi xep dau
      expect(w.done).toBe(w.completedDay !== null);
      if (w.done) {
        expect(w.completedDay!).toBeGreaterThan(w.assignedDay);
        expect(w.completedDay!).toBeLessThanOrEqual(data.config.days);
        expect(w.onTime).toBe(w.completedDay! <= w.dueDay);
        expect(d.onTime).toBe(w.onTime);
      } else {
        expect(w.onTime).toBe(false);
        expect(d.onTime).toBeNull();
      }
    });
    data.cards.forEach((c, i) => {
      if (!decided.has(i)) expect(r.world!.cards[i]).toBe(c);
    });
    // Khong giu the gioi khi khong yeu cau
    expect(runArm(data, full, { mode: 'ARM' }).world).toBeNull();
  });

  it('nguoi duoc giao luon nam trong ho boi cua the do, va (ARM) dung nguoi xep dau; the gioi chi phu thuoc vao lua chon', () => {
    const data = gen(9002, SMALL);
    const r = runArm(data, arm('random'), { mode: 'ARM', minDay: 30 });
    for (const d of r.decisions) {
      expect(d.poolKeys).toContain(d.assignedKey);
      expect(d.assignedKey).toBe(d.topKey);
    }
    expect(r.summary.acceptance).toBe(1);
    expect(r.summary.top1Assigned).toBeCloseTo(r.summary.top1, 12);
    expect(r.summary.pOnTimeAssigned).toBeCloseTo(r.summary.pOnTime, 12);
  });
});

describe('may rui chung (so sanh cap) va mo hinh ket qua', () => {
  it('sampleOutcome: cung luong -> nguoi co xac suat cao hon LUON dung han neu nguoi thap hon dung han; dung han <=> so dau tien < xac suat', () => {
    const base = { load: 2, capacity: 4, assignedDay: 100, dueDay: 110, days: 1000, recent: false };
    let violations = 0;
    let lowHits = 0;
    let highHits = 0;
    for (let i = 0; i < 3000; i += 1) {
      const seed = streamSeed(1, i, 1);
      const low = sampleOutcome(new Rng(seed), { ...base, skill: 0.2 });
      const high = sampleOutcome(new Rng(seed), { ...base, skill: 0.8 });
      if (low.onTime && !high.onTime) violations += 1;
      if (low.onTime) lowHits += 1;
      if (high.onTime) highHits += 1;
      expect(low.onTime).toBe(new Rng(seed).next() < onTimeProbability(0.2, 2, 4));
      expect(high.onTime).toBe(new Rng(seed).next() < onTimeProbability(0.8, 2, 4));
      expect(low.completedDay).not.toBeNull(); // days lon: khong bi cat
    }
    expect(violations).toBe(0);
    expect(highHits).toBeGreaterThan(lowHits);
    // Ty le thuc gan xac suat ly thuyet (0,15 + 0,7 * 0,8 - 0,06 * 0 = 0,71)
    expect(highHits / 3000).toBeGreaterThan(0.67);
    expect(highHits / 3000).toBeLessThan(0.75);
  });

  it('sampleOutcome: viec chi co 1 ngay (han = ngay giao + 1): nhanh dung han LUON kip han, hoan thanh dung han chot', () => {
    // planned = max(1, han - ngay giao) = 1 -> ngay hoan thanh = ngay giao + max(1, ceil(1 x ...)) = ngay giao + 1 = han chot
    let onTimeBranch = 0;
    for (let i = 0; i < 2000; i += 1) {
      const seed = streamSeed(5, i, 1);
      const o = sampleOutcome(new Rng(seed), { skill: 0.2, load: 0, capacity: 4, assignedDay: 100, dueDay: 101, days: 1000, recent: false });
      if (new Rng(seed).next() < onTimeProbability(0.2, 0, 4)) {
        onTimeBranch += 1;
        expect(o.onTime).toBe(true);
        expect(o.completedDay).toBe(101);
      }
    }
    expect(onTimeBranch).toBeGreaterThan(500);
  });

  it('he so phat tai dung: tai <= nua suc chua khong bi phat; vuot thi tru theo he so; 0 -> khong phat', () => {
    expect(onTimeProbability(0.5, 2, 4)).toBeCloseTo(0.5, 12); // 0,15 + 0,35
    expect(onTimeProbability(0.5, 6, 4)).toBeCloseTo(0.5 - 0.06 * 4, 12);
    expect(onTimeProbability(0.5, 6, 4, 0.1)).toBeCloseTo(0.5 - 0.1 * 4, 12);
    expect(onTimeProbability(0.5, 6, 4, 0)).toBeCloseTo(0.5, 12);
    // Voi ky nang <= 1 tran that su cua mo hinh la 0,15 + 0,7 = 0,85: tran kep 0,95 KHONG BAO GIO cham toi trong the gioi hop le
    expect(onTimeProbability(1, 0, 4)).toBeCloseTo(0.85, 12);
    expect(onTimeProbability(2, 0, 4)).toBe(0.95); // kep tren chi co tac dung khi ky nang vuot khoang hop le
    expect(onTimeProbability(0, 50, 4, 1)).toBe(0.05); // kep duoi
    expect(onTimeProbability(0, 0, 4)).toBeCloseTo(0.15, 12);
  });

  it('loadPenalty cua bo chay: 0 -> xac suat = 0,15 + 0,7 * ky nang; phat cang lon thi xac suat cua CUNG nguoi cang thap', () => {
    const data = gen(9001);
    const byKey = new Map(data.cards.map((c) => [c.key, c]));
    const run = (loadPenalty: number) => runArm(data, firstKeyArm, { mode: 'HISTORY', loadPenalty }).decisions;
    const d0 = run(0);
    const dBig = run(0.5);
    let lower = 0;
    d0.forEach((d, i) => {
      const c = byKey.get(d.cardKey)!;
      const who = data.people.find((p) => p.key === d.topKey)!;
      const clean = Math.min(0.95, Math.max(0.05, 0.15 + 0.7 * skillAt(who, c.topic, c.assignedDay)));
      expect(d.pOnTimeTop).toBeCloseTo(clean, 12);
      expect(dBig[i]!.topKey).toBe(d.topKey);
      expect(dBig[i]!.pOnTimeTop).toBeLessThanOrEqual(d.pOnTimeTop + 1e-12);
      if (dBig[i]!.pOnTimeTop < d.pOnTimeTop - 1e-9) lower += 1;
    });
    expect(lower).toBeGreaterThan(0);
  });

  it('phat tai cang nang thi nhanh don het viec vao mot nguoi (nguoi hay lam nhat) cang thiet, o vong kin', () => {
    const data = gen(9002);
    const low = runArm(data, arm('most-frequent'), { mode: 'ARM', loadPenalty: 0 }).summary;
    const high = runArm(data, arm('most-frequent'), { mode: 'ARM', loadPenalty: 0.3 }).summary;
    expect(high.pOnTime).toBeLessThan(low.pOnTime);
    expect(high.maxShareAssigned).toBeGreaterThan(0.6); // don viec: chinh la hien tuong can do
  });

  it('assumedCapacity chi doi CAI BO CHAM THAY, khong doi the gioi (mo hinh ket qua dung suc chua that)', () => {
    const data = gen(9001);
    const a = runArm(data, firstKeyArm, { mode: 'HISTORY' }).summary;
    const b = runArm(data, firstKeyArm, { mode: 'HISTORY', assumedCapacity: 2 }).summary;
    expect(b).toEqual(a);
    const seen = (assumedCapacity?: number) => {
      const set = new Set<number>();
      runArm(
        data,
        () => {
          const inner = scorerArm({ id: 'c', label: 'c' });
          return { ...inner, rank: (input: ArmInput) => { const out = inner.rank(input); out.ranked!.forEach((r) => set.add(r.capacity)); return out; } };
        },
        { mode: 'HISTORY', assumedCapacity }
      );
      return [...set].sort();
    };
    expect(seen(2)).toEqual([2]);
    const trueCaps = [...new Set(data.people.map((p) => p.capacity))].sort();
    expect(seen()).toEqual(expect.arrayContaining([trueCaps[0]!]));
    expect(seen().every((c) => trueCaps.includes(c))).toBe(true);
  });
});

describe('truong nhom, phan hoi va che do LEADER', () => {
  const last: Leader = { pick: ({ ranked }) => ranked[ranked.length - 1]!.userId };

  function spyArm() {
    const calls: { top: string; chosenKey: string; ranked: boolean }[] = [];
    const inner = scorerArm({ id: 'spy', label: 'spy' });
    const a: Arm = {
      ...inner,
      observe: (f: ArmFeedback) => calls.push({ top: f.output.order[0]!, chosenKey: f.chosenKey, ranked: f.output.ranked !== null }),
    };
    return { arm: a, calls };
  }

  it('khong co truong nhom -> khong ai goi observe, leaderKey = null', () => {
    const data = gen(9002, SMALL);
    const { arm: a, calls } = spyArm();
    const r = runArm(data, () => a, { mode: 'ARM', minDay: 30 });
    expect(calls).toHaveLength(0);
    expect(r.decisions.every((d) => d.leaderKey === null)).toBe(true);
  });

  it('ARM + truong nhom: the gioi theo NHANH, phan hoi la nguoi truong nhom se chon (cho moi quyet dinh)', () => {
    const data = gen(9002, SMALL);
    const { arm: a, calls } = spyArm();
    const r = runArm(data, () => a, { mode: 'ARM', minDay: 30, leader: last });
    expect(calls).toHaveLength(r.decisions.length);
    r.decisions.forEach((d, i) => {
      expect(calls[i]!.chosenKey).toBe(d.leaderKey);
      expect(calls[i]!.top).toBe(d.topKey);
      expect(calls[i]!.ranked).toBe(true);
      expect(d.assignedKey).toBe(d.topKey);
    });
    expect(r.decisions.some((d) => d.leaderKey !== d.topKey)).toBe(true); // truong nhom "nguoc" that su co bat dong
  });

  it('LEADER: truong nhom giao viec that; nhanh chi goi y va nhan phan hoi', () => {
    const data = gen(9002, SMALL);
    const { arm: a, calls } = spyArm();
    const r = runArm(data, () => a, { mode: 'LEADER', minDay: 30, leader: last });
    expect(calls).toHaveLength(r.decisions.length);
    for (const d of r.decisions) {
      expect(d.assignedKey).toBe(d.leaderKey);
      expect(d.hitAssigned).toBe(d.assignedKey === d.bestKey);
    }
    const accepted = r.decisions.filter((d) => d.assignedKey === d.topKey).length;
    expect(r.summary.acceptance).toBeCloseTo(accepted / r.decisions.length, 12);
  });

  it('HISTORY + truong nhom: van la lich su cua bo sinh, truong nhom chi cho phan hoi', () => {
    const data = gen(9002, SMALL);
    const byKey = new Map(data.cards.map((c) => [c.key, c.assigneeKey]));
    const { arm: a, calls } = spyArm();
    const r = runArm(data, () => a, { mode: 'HISTORY', minDay: 30, leader: last });
    expect(calls).toHaveLength(r.decisions.length);
    for (const d of r.decisions) expect(d.assignedKey).toBe(byKey.get(d.cardKey));
  });

  it('LEADER: thanh cong DOC LAP voi nhanh - hai nhanh khac nhau thay CUNG mot the gioi (cung nguoi duoc giao, cung ket qua), chi khac goi y', () => {
    const data = gen(9002, SMALL);
    const a = runArm(data, arm('random'), { mode: 'LEADER', minDay: 30, leader: last });
    const b = runArm(data, full, { mode: 'LEADER', minDay: 30, leader: last });
    expect(a.decisions.map((d) => d.assignedKey)).toEqual(b.decisions.map((d) => d.assignedKey));
    expect(a.decisions.map((d) => d.leaderKey)).toEqual(b.decisions.map((d) => d.leaderKey));
    expect(a.decisions.map((d) => d.onTime)).toEqual(b.decisions.map((d) => d.onTime));
    expect(a.decisions.map((d) => d.pOnTimeAssigned)).toEqual(b.decisions.map((d) => d.pOnTimeAssigned));
    expect(a.decisions.map((d) => d.topKey)).not.toEqual(b.decisions.map((d) => d.topKey));
  });

  it('truong nhom nhin xep hang THAM CHIEU (cau hinh san pham), khong phai xep hang cua nhanh - de moi nhanh thay cung mot the gioi', () => {
    const small = gen(9002, SMALL);
    const inputs = new Map<string, ArmInput>();
    const expOnly = scorerArm({ id: 'e', label: 'e', weights: { experience: 1, reliability: 0, availability: 0, declared: 0 } });
    const probe: Arm = {
      ...expOnly,
      rank: (input) => {
        inputs.set(input.card.id!, input);
        return expOnly.rank(input);
      },
    };
    const seen: { cardKey: string; ranked: readonly RankedCandidate[] }[] = [];
    const leader: Leader = {
      pick: ({ cardKey, ranked }) => {
        seen.push({ cardKey, ranked });
        return ranked[0]!.userId;
      },
    };
    runArm(small, () => probe, { mode: 'ARM', minDay: 30, leader });
    expect(seen.length).toBeGreaterThan(10);
    let differsFromArm = 0;
    for (const { cardKey, ranked } of seen) {
      const input = inputs.get(cardKey)!;
      // Cau hinh san pham tu buoc 11 den buoc 16: ba trong so cu + Ho so = 0 (§17.6)
      const expected = rankCandidates(input.card, input.snapshot.candidates, {
        idf: input.snapshot.idf,
        now: input.snapshot.now,
        groupOnTimeRate: input.snapshot.mu,
        weights: LEGACY_WEIGHTS_V1,
      });
      expect(ranked).toEqual(expected);
      if (expOnly.rank(input).order.join() !== expected.map((r) => r.userId).join()) differsFromArm += 1;
    }
    expect(differsFromArm).toBeGreaterThan(0); // xep hang cua nhanh KHAC xep hang tham chieu -> phep so sanh khong vo nghia
  });

  it('truong nhom chon ngoai ho boi bi phat hien (khong am tham chay tiep)', () => {
    const data = gen(9002, SMALL);
    const bad: Leader = { pick: () => 'khong-ton-tai' };
    expect(() => runArm(data, full, { mode: 'ARM', minDay: 30, leader: bad })).toThrow(/ngoai ho boi/);
  });
});

describe('thoi diem cua quyet dinh', () => {
  it('quyet dinh duoc dua tai 10:00 sang ngay giao (giong replay); ngay bat dau 00:00, han chot 23:59', () => {
    const data = gen(9002, SMALL);
    const plan = planDecisions(data, 30);
    const seen = new Map<string, { now: number; start: number; due: number }>();
    runArm(
      data,
      () =>
        probeArm((input) => {
          seen.set(input.card.id!, {
            now: input.snapshot.now.getTime(),
            start: input.card.startDate!.getTime(),
            due: input.card.dueDate!.getTime(),
          });
        }),
      { mode: 'HISTORY', minDay: 30 }
    );
    expect(seen.size).toBe(plan.length);
    for (const p of plan) {
      const s = seen.get(p.card.key)!;
      expect(s.now).toBe(simDate(data.config.days, p.card.assignedDay, 10).getTime());
      expect(s.start).toBe(simDate(data.config.days, p.card.assignedDay, 0).getTime());
      expect(s.due).toBe(simDate(data.config.days, p.card.dueDay, 23, 59).getTime());
    }
  });
});

describe('luong ngau nhien RIENG cua tung the: kiem chung dung hat giong / chi so the / muc dich', () => {
  const data = gen(9001);
  const plan = planDecisions(data, DEFAULT_MIN_DAY);

  it('cac muc dich la cac so nguyen khac nhau (trung nhau thi ket qua, lua chon nhanh, truong nhom, ho so tu khai tuong quan ngam)', () => {
    const v = Object.values(STREAM_SALTS);
    expect(v).toHaveLength(4); // buoc 14: them luong ho so tu khai
    expect(new Set(v).size).toBe(4);
    for (const s of v) expect(Number.isInteger(s) && s >= 0).toBe(true);
  });

  it('ket qua cua the = luong (hat giong bo du lieu, vi tri the, "outcome"): dung han <=> so rut < xac suat; the tao gan day rut them mot so 0,55 truoc do', () => {
    const penalty = 0.3; // khac mac dinh: neu phat tai khong duoc chuyen vao phan rut ket qua thi xac suat lech va test rot
    const r = runArm(data, firstKeyArm, { mode: 'ARM', loadPenalty: penalty, keepWorld: true });
    let onTimeChecked = 0;
    let forcedOpen = 0;
    let recentChecked = 0;
    r.decisions.forEach((d, k) => {
      const { card, cardIndex } = plan[k]!;
      const rng = new Rng(streamSeed(data.config.seed, cardIndex, STREAM_SALTS.outcome));
      if (card.createdDay > data.config.days - data.config.openRecentDays) {
        if (rng.next() < 0.55) {
          expect(d.onTime).toBeNull();
          expect(r.world!.cards[cardIndex]!.done).toBe(false);
          forcedOpen += 1;
          return;
        }
        recentChecked += 1;
      }
      const u = rng.next();
      if (d.onTime !== null) {
        expect(d.onTime).toBe(u < d.pOnTimeAssigned);
        onTimeChecked += 1;
      }
    });
    expect(onTimeChecked).toBeGreaterThan(30);
    expect(forcedOpen).toBeGreaterThan(0);
    expect(recentChecked).toBeGreaterThan(0);
  });

  it('LEADER: ket qua rut theo nguoi THUC SU duoc giao (ky nang, tai, suc chua cua ho), khong phai nguoi xep dau', () => {
    const last: Leader = { pick: ({ ranked }) => ranked[ranked.length - 1]!.userId };
    // The gioi DAY viec (48 the moi bang) + phat tai 0,3 (du lon de tai lam doi xac suat ma chua chay xuong san 0,05): xac suat cua hai nguoi (nguoi xep dau va
    // nguoi duoc giao) khac nhau ro khi tai / suc chua cua ho khac nhau - neu khong, dot "dung suc chua cua nguoi xep dau" khong bi lo
    const dense = gen(9001, { cardsPerBoard: 48 });
    const densePlan = planDecisions(dense, DEFAULT_MIN_DAY);
    const r = runArm(dense, firstKeyArm, { mode: 'LEADER', leader: last, loadPenalty: 0.3 });
    let checked = 0;
    let differing = 0;
    r.decisions.forEach((d, k) => {
      const { card, cardIndex } = densePlan[k]!;
      if (card.createdDay > dense.config.days - dense.config.openRecentDays) return; // the gan day co them so rut 0,55 (kiem o test tren)
      if (d.onTime === null) return;
      const u = new Rng(streamSeed(dense.config.seed, cardIndex, STREAM_SALTS.outcome)).next();
      expect(d.onTime).toBe(u < d.pOnTimeAssigned);
      checked += 1;
      if (d.assignedKey !== d.topKey) differing += 1;
    });
    expect(checked).toBeGreaterThan(50);
    expect(differing).toBeGreaterThan(30); // phep thu khong vo nghia: nguoi duoc giao thuong KHAC nguoi xep dau
  });

  it('BIEN cua "the gan day": the tao dung ngay 270 (= 300 - 30) KHONG bi ep con mo, the tao ngay 271 thi co (hang so viet tay, khong chep lai cong thuc cua ma)', () => {
    const d = gen(9004);
    const p = planDecisions(d, DEFAULT_MIN_DAY);
    const r = runArm(d, firstKeyArm, { mode: 'ARM' });
    const rngOf = (cardIndex: number) => new Rng(streamSeed(d.config.seed, cardIndex, STREAM_SALTS.outcome));
    let onBoundary = 0;
    let lowOnBoundary = 0;
    let after = 0;
    p.forEach((x, k) => {
      const dec = r.decisions[k]!;
      if (x.card.createdDay === 270) {
        // KHONG "gan day": khong co so rut 0,55; so dau tien la so quyet dinh dung han; the xong truoc cuoi lich su nen luon co ket qua
        const u0 = rngOf(x.cardIndex).next();
        expect(dec.onTime).not.toBeNull();
        expect(dec.onTime).toBe(u0 < dec.pOnTimeAssigned);
        onBoundary += 1;
        if (u0 < 0.55) lowOnBoundary += 1;
      } else if (x.card.createdDay === 271) {
        const rng = rngOf(x.cardIndex);
        if (rng.next() < 0.55) expect(dec.onTime).toBeNull(); // bi ep con mo
        else expect(dec.onTime).toBe(rng.next() < dec.pOnTimeAssigned);
        after += 1;
      }
    });
    expect(onBoundary).toBeGreaterThan(0);
    expect(lowOnBoundary).toBeGreaterThan(0); // co the o bien ma dot bien se ep con mo
    expect(after).toBeGreaterThan(0);
  });

  it('luong dua cho NHANH la (hat giong, vi tri the, "arm"); luong dua cho TRUONG NHOM la (..., "leader")', () => {
    const armDraws: number[] = [];
    const leaderDraws: number[] = [];
    const recording: Arm = {
      id: 'rec',
      label: 'rec',
      rank: ({ snapshot, rng }) => {
        armDraws.push(rng.next());
        return { order: snapshot.candidates.map((c) => c.userId).sort(), ranked: null };
      },
    };
    const leader: Leader = {
      pick: ({ ranked, rng }) => {
        leaderDraws.push(rng.next());
        return ranked[0]!.userId;
      },
    };
    runArm(data, () => recording, { mode: 'ARM', leader });
    expect(armDraws).toHaveLength(plan.length);
    expect(leaderDraws).toHaveLength(plan.length);
    plan.forEach((p, i) => {
      expect(armDraws[i]).toBe(new Rng(streamSeed(data.config.seed, p.cardIndex, STREAM_SALTS.arm)).next());
      expect(leaderDraws[i]).toBe(new Rng(streamSeed(data.config.seed, p.cardIndex, STREAM_SALTS.leader)).next());
    });
  });

  it('replayOutcomes (chi de kiem thu) tu choi nguoi duoc giao khac nguoi cua bo sinh', () => {
    expect(() => runArm(data, firstKeyArm, { mode: 'ARM', replayOutcomes: true })).toThrow(/replayOutcomes/);
  });

  it('LEADER: hang / hoi tiec / dap an tot nhat tinh lai dung tu ky nang an, tach bach nguoi xep dau va nguoi duoc giao', () => {
    const small = gen(9002, SMALL);
    const orders = new Map<string, string[]>();
    const inner = scorerArm({ id: 'r', label: 'r' });
    const recorder: Arm = {
      ...inner,
      rank: (input) => {
        const out = inner.rank(input);
        orders.set(input.card.id!, out.order);
        return out;
      },
    };
    const lastKey: Leader = { pick: ({ ranked }) => ranked[ranked.length - 1]!.userId };
    const r = runArm(small, () => recorder, { mode: 'LEADER', minDay: 30, leader: lastKey });
    const byKey = new Map(small.cards.map((c) => [c.key, c]));
    let differs = 0;
    for (const d of r.decisions) {
      const c = byKey.get(d.cardKey)!;
      const skill = (k: string) => skillAt(small.people.find((p) => p.key === k)!, c.topic, c.assignedDay);
      const best = bestCandidate(small.people, c);
      expect(d.bestKey).toBe(best.key);
      expect(d.rankOfBest).toBe(orders.get(d.cardKey)!.indexOf(best.key) + 1);
      expect(d.regret).toBeCloseTo(best.skill - skill(d.topKey), 12);
      expect(d.regretAssigned).toBeCloseTo(best.skill - skill(d.assignedKey), 12);
      expect(d.hitAssigned).toBe(d.assignedKey === best.key);
      if (d.assignedKey !== d.topKey) differs += 1;
    }
    expect(differs).toBeGreaterThan(0);
  });
});

describe('an toan va tat dinh', () => {
  it('cung dau vao -> cung ket qua, tung quyet dinh (ke ca nhanh ngau nhien)', () => {
    const data = gen(9002, SMALL);
    for (const id of ['random', 'full', 'round-robin']) {
      const a = runArm(data, arm(id), { mode: 'ARM', minDay: 30 });
      const b = runArm(data, arm(id), { mode: 'ARM', minDay: 30 });
      expect(b).toEqual(a);
    }
    // ... va cac nhanh khac nhau cho ket qua khac nhau
    expect(runArm(data, arm('random'), { mode: 'ARM', minDay: 30 }).summary).not.toEqual(
      runArm(data, full, { mode: 'ARM', minDay: 30 }).summary
    );
  });

  it('nguoi vao muon = vao SAU khi giai doan danh gia bat dau (ngay vao > minDay); vao dung ngay minDay thi khong tinh', () => {
    const d = gen(9001);
    const joiner = d.people.find((q) => q.joinedDay > 0)!;
    const day = joiner.joinedDay;
    const parity = (minDay: number) => runArm(d, arm('random'), { mode: 'ARM', minDay }).summary.newcomerParity;
    expect(parity(day - 1)).not.toBeNull();
    expect(parity(day)).toBeNull();
    expect(parity(day + 1)).toBeNull();
  });

  it('tham so sai bi tu choi', () => {
    const data = gen(9002, SMALL);
    expect(() => runArm(data, full, { mode: 'X' as RunMode })).toThrow(RangeError);
    expect(() => runArm(data, full, { mode: 'LEADER' })).toThrow(/leader/);
    expect(() => runArm(data, full, { mode: 'ARM', minDay: -1 })).toThrow(RangeError);
    expect(() => runArm(data, full, { mode: 'ARM', minDay: 1.5 })).toThrow(RangeError);
    expect(() => runArm(data, full, { mode: 'ARM', loadPenalty: -0.1 })).toThrow(RangeError);
    expect(() => runArm(data, full, { mode: 'ARM', loadPenalty: Number.NaN })).toThrow(RangeError);
    expect(() => runArm(data, full, { mode: 'ARM', assumedCapacity: 0 })).toThrow(/assumedCapacity/);
    expect(() => runArm(data, full, { mode: 'ARM', assumedCapacity: 2.5 })).toThrow(/assumedCapacity/);
    expect(() => runArm(data, full, { mode: 'ARM', minDay: 10_000 })).toThrow(/khong co quyet dinh/);
  });

  it('nhanh tra ve thu tu khong phai hoan vi cua ho boi (thieu / trung / ngoai ho boi) bi phat hien', () => {
    const data = gen(9002, SMALL);
    const withOrder = (f: (keys: string[]) => string[]): (() => Arm) => () => ({
      id: 'bad',
      label: 'bad',
      rank: ({ snapshot }) => ({ order: f(snapshot.candidates.map((c) => c.userId)), ranked: null }),
    });
    for (const f of [
      (k: string[]) => k.slice(1), // thieu
      (k: string[]) => [k[0]!, ...k.slice(0, -1)], // trung, cung do dai
      (k: string[]) => [...k, 'khong-ton-tai'], // thua
      (k: string[]) => [...k.slice(1), 'khong-ton-tai'], // cung do dai nhung co nguoi la
    ]) {
      expect(() => runArm(data, withOrder(f), { mode: 'HISTORY', minDay: 30 })).toThrow(/hoan vi/);
    }
  });

  it('ghi lai trong so cua nhanh dung bo cham (cuoi moi quyet dinh); nhanh khac -> null', () => {
    const data = gen(9002, SMALL);
    const a = runArm(data, full, { mode: 'HISTORY', minDay: 30 });
    expect(a.finalWeights).toEqual(LEGACY_WEIGHTS_V1);
    expect(a.decisions.every((d) => d.weights !== null && d.weights.experience === 0.45)).toBe(true);
    const b = runArm(data, arm('random'), { mode: 'HISTORY', minDay: 30 });
    expect(b.finalWeights).toBeNull();
    expect(b.decisions.every((d) => d.weights === null)).toBe(true);
  });

  it('nhanh tham chieu can `oracle`; co oracle thi xep theo ky nang / xac suat (hoa -> khoa nho)', () => {
    const card: ScoreCard = { id: 'x', title: 't', description: '' };
    const cands = ['a', 'b', 'c'].map((k) => ({ userId: k, history: [], openCards: [] }));
    const snapshot = { now: new Date(), idf: buildIdf([]), mu: null, candidates: cands };
    const base = { card, snapshot, load: new Map<string, number>(), rng: new Rng(1) };
    expect(() => bestSkillArm().rank(base)).toThrow(/oracle/);
    expect(() => oracleArm().rank(base)).toThrow(/oracle/);
    const skill: Record<string, number> = { a: 0.2, b: 0.9, c: 0.9 };
    const p: Record<string, number> = { a: 0.7, b: 0.4, c: 0.7 };
    const oracle = { skillOf: (k: string) => skill[k]!, pOnTimeOf: (k: string) => p[k]! };
    expect(bestSkillArm().rank({ ...base, oracle }).order).toEqual(['b', 'c', 'a']);
    expect(oracleArm().rank({ ...base, oracle }).order).toEqual(['a', 'c', 'b']);
  });
});

describe('summarizeDecisions (so tinh tay)', () => {
  const rec = (o: Partial<DecisionRecord>): DecisionRecord => ({
    index: 0,
    cardKey: 'c',
    day: 100,
    poolKeys: ['a', 'b', 'c'],
    topKey: 'a',
    bestKey: 'a',
    rankOfBest: 1,
    regret: 0,
    pOnTimeTop: 0.5,
    topHasNoHistory: false,
    assignedKey: 'a',
    pOnTimeAssigned: 0.5,
    regretAssigned: 0,
    hitAssigned: true,
    leaderKey: null,
    onTime: null,
    chanceTop1: 1 / 3,
    chanceRegret: 0.2,
    chancePOnTime: 0.4,
    weights: null,
    ...o,
  });

  const ds: DecisionRecord[] = [
    rec({ rankOfBest: 1, regret: 0, pOnTimeTop: 0.6, topKey: 'a', assignedKey: 'a', pOnTimeAssigned: 0.6, hitAssigned: true, onTime: true }),
    rec({ rankOfBest: 2, regret: 0.1, pOnTimeTop: 0.5, topHasNoHistory: true, topKey: 'a', assignedKey: 'b', pOnTimeAssigned: 0.4, regretAssigned: 0.2, hitAssigned: false, onTime: false }),
    rec({ rankOfBest: 3, regret: 0.3, pOnTimeTop: 0.3, topKey: 'b', assignedKey: 'c', pOnTimeAssigned: 0.2, regretAssigned: 0.4, hitAssigned: false, onTime: null }),
    rec({ poolKeys: ['a', 'b'], rankOfBest: 1, regret: 0, pOnTimeTop: 0.7, topKey: 'a', assignedKey: 'a', pOnTimeAssigned: 0.7, hitAssigned: true, onTime: true, chanceTop1: 0.5 }),
  ];

  it('chat luong goi y', () => {
    const s = summarizeDecisions(ds);
    expect(s.decisions).toBe(4);
    expect(s.top1).toBeCloseTo(0.5, 12);
    expect(s.top3).toBeCloseTo(1, 12);
    expect(s.mrr).toBeCloseTo((1 + 1 / 2 + 1 / 3 + 1) / 4, 12);
    expect(s.regret).toBeCloseTo(0.1, 12);
    expect(s.pOnTime).toBeCloseTo(0.525, 12);
    expect(s.topNoHistory).toBeCloseTo(0.25, 12);
    expect(s.chanceTop1).toBeCloseTo(0.375, 12);
    expect(s.chanceRegret).toBeCloseTo(0.2, 12);
    expect(s.chancePOnTime).toBeCloseTo(0.4, 12);
  });

  it('do tap trung (Gini, phan cua nguoi nhieu nhat) cua goi y va cua viec thuc giao', () => {
    const s = summarizeDecisions(ds);
    // goi y: a 3, b 1, c 0 -> Gini 0,5; nguoi nhieu nhat 3/4
    expect(s.giniTop).toBeCloseTo(0.5, 12);
    expect(s.maxShareTop).toBeCloseTo(0.75, 12);
    // giao: a 2, b 1, c 1 -> Gini 1/6; nguoi nhieu nhat 1/2
    expect(s.giniAssigned).toBeCloseTo(1 / 6, 12);
    expect(s.maxShareAssigned).toBeCloseTo(0.5, 12);
  });

  it('viec thuc giao: tran, hoi tiec, xac suat, ket qua thuc (bo the chua xong), ti le chap nhan', () => {
    const s = summarizeDecisions(ds);
    expect(s.top1Assigned).toBeCloseTo(0.5, 12);
    expect(s.regretAssigned).toBeCloseTo(0.15, 12);
    expect(s.pOnTimeAssigned).toBeCloseTo(0.475, 12);
    expect(s.onTimeRealised).toBeCloseTo(2 / 3, 12);
    expect(s.acceptance).toBeCloseTo(0.5, 12);
    expect(summarizeDecisions(ds.map((d) => ({ ...d, onTime: null }))).onTimeRealised).toBeNull();
  });

  it('nguoi vao muon: (viec nhan) / (phan chia deu ky vong); khong co nguoi vao muon -> null', () => {
    // c co mat o 3 quyet dinh ho boi 3 nguoi (moi lan 1/3 -> 1) va nhan 1 viec -> 1,0
    expect(summarizeDecisions(ds, ['c']).newcomerParity).toBeCloseTo(1, 12);
    // b co mat o ca 4 quyet dinh: 3 x 1/3 + 1/2 = 1,5, nhan 1 viec -> 2/3
    expect(summarizeDecisions(ds, ['b']).newcomerParity).toBeCloseTo(2 / 3, 12);
    // hai nguoi: cong ca hai phia
    expect(summarizeDecisions(ds, ['b', 'c']).newcomerParity).toBeCloseTo((1 + 1) / (1.5 + 1), 12);
    expect(summarizeDecisions(ds, []).newcomerParity).toBeNull();
    expect(summarizeDecisions(ds, ['khong-co-mat']).newcomerParity).toBeNull();
    expect(summarizeDecisions(ds).newcomerParity).toBeNull();
  });

  it('khong co quyet dinh nao -> tu choi (khong tra ve NaN)', () => {
    expect(() => summarizeDecisions([])).toThrow(RangeError);
  });

  it('khong phu thuoc thu tu quyet dinh (nguoi chi xuat hien o ho boi cua quyet dinh SAU van duoc tinh la mot nguoi trong nhom)', () => {
    // Dao nguoc: quyet dinh dau tien gio chi co ho boi {a, b}; c chi xuat hien o cac quyet dinh sau
    const a = summarizeDecisions(ds, ['c']);
    const b = summarizeDecisions([...ds].reverse(), ['c']);
    for (const k of Object.keys(a) as (keyof typeof a)[]) {
      const x = a[k];
      const y = b[k];
      if (typeof x === 'number' && typeof y === 'number') expect(y).toBeCloseTo(x, 12);
      else expect(y).toBe(x);
    }
  });
});

describe('tinh chat tren nhieu cau hinh the gioi (bat bien cua so do)', () => {
  const configs: Partial<SimConfig>[] = [
    { people: 3, boards: 2, cardsPerBoard: 12, days: 120 },
    { people: 4, boards: 3, cardsPerBoard: 16, days: 150 },
    { people: 8, boards: 4, cardsPerBoard: 20, days: 200 },
  ];
  const last: Leader = { pick: ({ ranked }) => ranked[ranked.length - 1]!.userId };

  it('moi so do nam trong mien hop le, o ba che do, ba nhanh, 9 bo du lieu', () => {
    let runs = 0;
    for (const [ci, cfg] of configs.entries()) {
      for (const seed of [9101, 9102, 9103]) {
        const data = gen(seed + ci * 10, cfg);
        if (planDecisions(data, 30).length === 0) continue;
        for (const mode of ['HISTORY', 'ARM', 'LEADER'] as const) {
          for (const id of ['random', 'most-frequent', 'full']) {
            const r = runArm(data, arm(id), { mode, minDay: 30, leader: mode === 'LEADER' ? last : undefined });
            const s = r.summary;
            runs += 1;
            expect(s.decisions).toBe(planDecisions(data, 30).length);
            for (const v of [s.top1, s.top3, s.mrr, s.acceptance, s.topNoHistory, s.top1Assigned]) {
              expect(v).toBeGreaterThanOrEqual(0);
              expect(v).toBeLessThanOrEqual(1);
            }
            expect(s.top3).toBeGreaterThanOrEqual(s.top1);
            expect(s.mrr).toBeGreaterThanOrEqual(s.top1 - 1e-12);
            expect(s.mrr).toBeGreaterThan(0);
            expect(s.regret).toBeGreaterThanOrEqual(0);
            expect(s.regretAssigned).toBeGreaterThanOrEqual(0);
            for (const v of [s.pOnTime, s.pOnTimeAssigned, s.chancePOnTime]) {
              expect(v).toBeGreaterThanOrEqual(0.05 - 1e-12);
              expect(v).toBeLessThanOrEqual(0.95 + 1e-12);
            }
            for (const v of [s.giniTop, s.giniAssigned]) {
              expect(v).toBeGreaterThanOrEqual(0);
              expect(v).toBeLessThan(1);
            }
            for (const v of [s.maxShareTop, s.maxShareAssigned]) {
              expect(v).toBeGreaterThan(0);
              expect(v).toBeLessThanOrEqual(1);
            }
            if (s.newcomerParity !== null) expect(s.newcomerParity).toBeGreaterThanOrEqual(0);
            if (s.onTimeRealised !== null) {
              expect(s.onTimeRealised).toBeGreaterThanOrEqual(0);
              expect(s.onTimeRealised).toBeLessThanOrEqual(1);
            }
            if (mode === 'HISTORY') expect(s.onTimeRealised).toBeNull();
            if (mode === 'ARM') {
              expect(s.acceptance).toBe(1);
              expect(s.pOnTimeAssigned).toBeCloseTo(s.pOnTime, 12);
            }
            for (const d of r.decisions) {
              expect(d.poolKeys).toContain(d.topKey);
              expect(d.poolKeys).toContain(d.assignedKey);
              expect(d.poolKeys).toContain(d.bestKey);
              expect(d.rankOfBest).toBeGreaterThanOrEqual(1);
              expect(d.rankOfBest).toBeLessThanOrEqual(d.poolKeys.length);
            }
          }
        }
      }
    }
    expect(runs).toBeGreaterThanOrEqual(30); // khong bo qua het
  });
});

describe('bo hat giong danh gia', () => {
  it('20 hat giong lien tiep 2001-2020, khong trung hat giong phat trien 9xxx', () => {
    expect(EVAL_SEEDS).toHaveLength(20);
    expect(EVAL_SEEDS[0]).toBe(2001);
    expect(EVAL_SEEDS[19]).toBe(2020);
    expect(new Set(EVAL_SEEDS).size).toBe(20);
    expect(EVAL_SEEDS.every((s) => s < 9000)).toBe(true);
  });
});
