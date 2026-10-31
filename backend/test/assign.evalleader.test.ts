// Buoc 7b - truong nhom gia va nhanh CO HOC (evalAssignLeader.ts). THUAN: khong cham CSDL.
// Nhanh co hoc phai dung DUNG luat hoc cua san pham (assign.learn.ts), nen phan lon test doi chieu voi chinh cac ham do.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEARN_ETA, LEARN_MIN_FEEDBACK, learnStep } from '../src/modules/assign/assign.learn';
import { LEGACY_WEIGHTS_V1, type RankedCandidate, type Weights } from '../src/modules/assign/assign.score';
import {
  LEGACY_DEFAULT_WEIGHTS,
  LEGACY_KEYS,
  WEIGHT_MAX,
  WEIGHT_MIN,
  pinLegacy,
  projectWithin,
  type LegacyWeights,
} from '../src/modules/assign/assign.weights';
import type { Arm, ArmOutput } from '../src/scripts/evalAssignArms';
import { PERSONAS, biasedLeader, l1Distance, learningArm, learningTrace, withCompleteFlags } from '../src/scripts/evalAssignLeader';
import { streamSeed } from '../src/scripts/evalAssignStats';
import { Rng } from '../src/scripts/simGenerator';

type Comp = { value: number | null; scaled: number | null };
const c = (value: number | null, scaled: number | null = value): Comp => ({ value, scaled });

/** Mot ung vien da xep hang, chi voi cac truong ma truong nhom / bo hoc doc. */
function cand(userId: string, score: number | null, e: Comp, r: Comp, a: Comp): RankedCandidate {
  const comp = (x: Comp, weight: number) => ({ ...x, weight, share: weight });
  return {
    userId,
    rank: 1,
    score,
    rawScore: score,
    confidence: 0.5,
    confidenceLevel: 'FAIR',
    components: { experience: comp(e, 0.45), reliability: comp(r, 0.3), availability: comp(a, 0.25) },
    evidence: [],
    evidenceMass: 1,
    fit: 0.5,
    load: 0,
    capacity: 5,
    flags: [],
  };
}

const outputOf = (ranked: RankedCandidate[]): ArmOutput => ({ order: ranked.map((x) => x.userId), ranked });

describe('biasedLeader', () => {
  const A = cand('A', 90, c(0.9), c(0.1), c(0.1));
  const B = cand('B', 80, c(0.1), c(0.9), c(0.5));
  const C = cand('C', 70, c(0.5), c(0.5), c(0.9));
  const pick = (bias: LegacyWeights, list: RankedCandidate[], opts: { noise?: number; space?: 'SCALED' | 'RAW'; seed?: number } = {}) =>
    biasedLeader({ bias, noise: opts.noise ?? 0, space: opts.space }).pick({ cardKey: 'x', ranked: list, rng: new Rng(opts.seed ?? 1) });

  it('khong nhieu: chon nguoi co tien ich cao nhat - so tinh tay', () => {
    // bias (0,2; 0,3; 0,5): A 0,18 + 0,03 + 0,05 = 0,26 | B 0,02 + 0,27 + 0,25 = 0,54 | C 0,10 + 0,15 + 0,45 = 0,70
    expect(pick({ experience: 0.2, reliability: 0.3, availability: 0.5 }, [A, B, C])).toBe('C');
    expect(pick({ experience: 1, reliability: 0, availability: 0 }, [A, B, C])).toBe('A');
    expect(pick({ experience: 0, reliability: 1, availability: 0 }, [A, B, C])).toBe('B');
    expect(pick({ experience: 0, reliability: 0, availability: 1 }, [A, B, C])).toBe('C');
  });

  it('thanh phan thieu (null) duoc coi la 0,5', () => {
    const none = cand('N', 50, c(null), c(0.5), c(0.5));
    const low = cand('L', 60, c(0.4), c(0.5), c(0.5));
    const high = cand('H', 40, c(0.6), c(0.5), c(0.5));
    expect(pick({ experience: 1, reliability: 0, availability: 0 }, [low, none])).toBe('N'); // 0,5 > 0,4
    expect(pick({ experience: 1, reliability: 0, availability: 0 }, [high, none])).toBe('H'); // 0,6 > 0,5
  });

  it("khong gian dac trung: 'SCALED' (mac dinh) doc scaled, 'RAW' doc value", () => {
    const x = cand('X', 50, c(0.2, 0.9), c(0.5), c(0.5)); // tho thap, da chuan hoa cao
    const y = cand('Y', 50, c(0.8, 0.1), c(0.5), c(0.5)); // tho cao, da chuan hoa thap
    const bias: LegacyWeights = { experience: 1, reliability: 0, availability: 0 };
    expect(pick(bias, [x, y])).toBe('X');
    expect(pick(bias, [x, y], { space: 'SCALED' })).toBe('X');
    expect(pick(bias, [x, y], { space: 'RAW' })).toBe('Y');
  });

  it('hoa tien ich -> nguoi dung truoc trong danh sach (nguoi diem cao hon)', () => {
    const p = cand('P', 90, c(0.5), c(0.5), c(0.5));
    const q = cand('Q', 80, c(0.5), c(0.5), c(0.5));
    expect(pick(LEGACY_DEFAULT_WEIGHTS, [p, q])).toBe('P');
    expect(pick(LEGACY_DEFAULT_WEIGHTS, [q, p])).toBe('Q');
  });

  it('noise = 0 khong rut so ngau nhien nao; noise > 0 co rut', () => {
    const rng = new Rng(5);
    biasedLeader({ bias: LEGACY_DEFAULT_WEIGHTS, noise: 0 }).pick({ cardKey: 'x', ranked: [A, B, C], rng });
    expect(rng.next()).toBe(new Rng(5).next());
    const rng2 = new Rng(5);
    biasedLeader({ bias: LEGACY_DEFAULT_WEIGHTS, noise: 0.1 }).pick({ cardKey: 'x', ranked: [A, B, C], rng: rng2 });
    expect(rng2.next()).not.toBe(new Rng(5).next());
  });

  it('tien ich am (nhieu rat lon): van chon nguoi co tien ich LON NHAT, khong bi ket o nguoi dau danh sach', () => {
    // Rng kich ban: moi lan Box-Muller rut hai so (u1, u2); u2 = 0,5 -> cos(pi) = -1 nen nhieu = -sqrt(-2 ln(1 - u1)) < 0.
    // u1 = 0,9 / 0,1 / 0,5 cho nhieu -2,146 / -0,459 / -1,177; voi noise = 10 tien ich = 0,5 + 10 * nhieu:
    // A = -20,96 | B = -4,09 | C = -11,27 -> ca ba deu am, nguoi lon nhat la B (khong phai nguoi dau danh sach A)
    const script = [0.9, 0.5, 0.1, 0.5, 0.5, 0.5];
    let i = 0;
    const rng = { next: () => script[i++]! } as unknown as Rng;
    const same = (id: string) => cand(id, 50, c(0.5), c(0.5), c(0.5)); // dac trung nhu nhau: chi con nhieu quyet dinh
    const chosen = biasedLeader({ bias: LEGACY_DEFAULT_WEIGHTS, noise: 10 }).pick({ cardKey: 'x', ranked: [same('A'), same('B'), same('C')], rng });
    expect(chosen).toBe('B');
    expect(i).toBe(6); // moi ung vien rut dung hai so
  });

  it('co nhieu: tat dinh theo luong; hai nguoi bang nhau thi moi nguoi ~50%; nhieu lon thi khong con chac chan', () => {
    const P = cand('P', 90, c(0.5), c(0.5), c(0.5));
    const Q = cand('Q', 80, c(0.5), c(0.5), c(0.5));
    const a = pick(LEGACY_DEFAULT_WEIGHTS, [P, Q], { noise: 0.3, seed: 9 });
    expect(pick(LEGACY_DEFAULT_WEIGHTS, [P, Q], { noise: 0.3, seed: 9 })).toBe(a);
    let p = 0;
    for (let s = 1; s <= 4000; s += 1) if (pick(LEGACY_DEFAULT_WEIGHTS, [P, Q], { noise: 0.3, seed: streamSeed(41, s, 0) }) === 'P') p += 1;
    expect(p / 4000).toBeGreaterThan(0.46);
    expect(p / 4000).toBeLessThan(0.54);
    // Nguoi ro rang hon (A hon B ve kinh nghiem 0,8): nhieu nho thi hau nhu luon chon A, nhieu lon thi lan lon
    const bias: LegacyWeights = { experience: 1, reliability: 0, availability: 0 };
    const rate = (noise: number) => {
      let hit = 0;
      for (let s = 1; s <= 3000; s += 1) if (pick(bias, [A, B], { noise, seed: streamSeed(42, s, 0) }) === 'A') hit += 1;
      return hit / 3000;
    };
    expect(rate(0.05)).toBeGreaterThan(0.99);
    expect(rate(0.5)).toBeGreaterThan(0.6);
    expect(rate(0.5)).toBeLessThan(0.9);
    expect(rate(2)).toBeLessThan(rate(0.5));
  });

  it('nhieu la Gauss chuan (khong phai deu): do lech giua hai nguoi bang nhau co phan bo chuong (khoang 68% trong 1 do lech chuan)', () => {
    // Hai nguoi ma A hon B mot khoang d: P(A duoc chon) = Phi(d / (sigma * sqrt(2))). Voi d = sigma * sqrt(2) -> Phi(1) ~ 0,841
    const A2 = cand('A', 90, c(0.5 + 0.05 * Math.SQRT2), c(0.5), c(0.5));
    const B2 = cand('B', 80, c(0.5), c(0.5), c(0.5));
    const bias: LegacyWeights = { experience: 1, reliability: 0, availability: 0 };
    let hit = 0;
    const n = 6000;
    for (let s = 1; s <= n; s += 1) if (pick(bias, [A2, B2], { noise: 0.05, seed: streamSeed(43, s, 0) }) === 'A') hit += 1;
    expect(hit / n).toBeGreaterThan(0.81);
    expect(hit / n).toBeLessThan(0.87);
  });

  it('tham so sai bi tu choi', () => {
    const ok: LegacyWeights = { experience: 0.5, reliability: 0.3, availability: 0.2 };
    expect(() => biasedLeader({ bias: { ...ok, experience: 0.6 }, noise: 0 })).toThrow(/tong bang 1/);
    // Dung sai rat chat: lech 1e-7 da bi tu choi (khong chap nhan "gan bang 1")
    expect(() => biasedLeader({ bias: { experience: 0.5, reliability: 0.3, availability: 0.2000001 }, noise: 0 })).toThrow(/tong bang 1/);
    expect(() => biasedLeader({ bias: { experience: 0.5, reliability: 0.3, availability: 0.2 + 1e-12 }, noise: 0 })).not.toThrow();
    expect(() => biasedLeader({ bias: { experience: -0.1, reliability: 0.6, availability: 0.5 }, noise: 0 })).toThrow(RangeError);
    expect(() => biasedLeader({ bias: { ...ok, reliability: Number.NaN }, noise: 0 })).toThrow(RangeError);
    expect(() => biasedLeader({ bias: ok, noise: -0.1 })).toThrow(RangeError);
    expect(() => biasedLeader({ bias: ok, noise: Number.NaN })).toThrow(RangeError);
    expect(() => biasedLeader({ bias: ok, noise: 0, space: 'X' as 'RAW' })).toThrow(/SCALED/);
    expect(() => pick(ok, [])).toThrow(RangeError);
  });
});

describe('PERSONAS, l1Distance', () => {
  it('bon gu: ba gu co "loi" de hoc va mot doi chung trung mac dinh; moi gu la bo trong so HOP LE cua san pham', () => {
    expect(Object.keys(PERSONAS)).toEqual(['expert', 'reliable', 'free', 'control']);
    for (const p of Object.values(PERSONAS)) {
      expect(p.label.length).toBeGreaterThan(0);
      const { experience, reliability, availability } = p.bias;
      expect(experience + reliability + availability).toBeCloseTo(1, 12);
      for (const v of [experience, reliability, availability]) {
        expect(v).toBeGreaterThanOrEqual(WEIGHT_MIN);
        expect(v).toBeLessThanOrEqual(WEIGHT_MAX);
      }
      // Hop le -> phep chieu khong doi -> muc tieu cua duong hoi tu chinh la thien lech
      const target = projectWithin(pinLegacy(p.bias), LEGACY_KEYS);
      expect(l1Distance(target, p.bias)).toBeCloseTo(0, 9);
    }
    // Gu cua truong nhom gia chi co ba thanh phan tu lich su (buoc 7 khong co Ho so)
    expect(PERSONAS.control.bias).toEqual(LEGACY_DEFAULT_WEIGHTS);
    expect(PERSONAS.expert.bias.experience).toBe(0.7);
    expect(PERSONAS.reliable.bias.reliability).toBe(0.7);
    expect(PERSONAS.free.bias.availability).toBe(0.7);
  });

  it('l1Distance: so tinh tay, doi xung, 0 khi trung nhau, toi da 2', () => {
    const a: Weights = { experience: 0.5, reliability: 0.3, availability: 0.2 };
    const b: Weights = { experience: 0.2, reliability: 0.3, availability: 0.5 };
    expect(l1Distance(a, b)).toBeCloseTo(0.6, 12);
    expect(l1Distance(b, a)).toBeCloseTo(0.6, 12);
    expect(l1Distance(a, a)).toBe(0);
    expect(l1Distance({ experience: 1, reliability: 0, availability: 0 }, { experience: 0, reliability: 0, availability: 1 })).toBe(2);
  });
});

describe('learningArm - dung luat hoc cua san pham', () => {
  // Hai ung vien: TOP dung dau (diem cao hon han) nhung truong nhom se chon OTHER
  const TOP = cand('TOP', 80, c(0.9), c(0.9), c(0.1));
  const OTHER = cand('OTHER', 40, c(0.3), c(0.3), c(0.9));

  function feed(arm: ReturnType<typeof learningArm>, n: number, ranked: RankedCandidate[], chosen: string) {
    for (let i = 0; i < n; i += 1) arm.observe!({ output: outputOf(ranked), chosenKey: chosen });
  }

  it('trang thai ban dau: trong so mac dinh CUA BUOC 7 (LEGACY_WEIGHTS_V1, §17.6), chua co phan hoi; weights() la ban sao', () => {
    const arm = learningArm();
    expect(arm.id).toBe('learned');
    expect(arm.weights!()).toEqual(LEGACY_WEIGHTS_V1);
    expect(arm.stats()).toEqual({ feedback: 0, learned: 0 });
    arm.weights!().experience = 0;
    expect(arm.weights!()).toEqual(LEGACY_WEIGHTS_V1);
    const custom = learningArm({ initial: { experience: 0.3, reliability: 0.3, availability: 0.4, declared: 0 } });
    expect(custom.weights!().availability).toBe(0.4);
  });

  it('chua du so luot toi thieu (mac dinh 10 cua san pham) thi chi ghi nhan, khong hoc', () => {
    const arm = learningArm();
    feed(arm, LEARN_MIN_FEEDBACK - 1, [TOP, OTHER], 'OTHER'); // luot thu 1..9: feedbackCount < 10
    expect(arm.stats()).toEqual({ feedback: LEARN_MIN_FEEDBACK - 1, learned: 0 });
    expect(arm.weights!()).toEqual(LEGACY_WEIGHTS_V1);
    feed(arm, 1, [TOP, OTHER], 'OTHER'); // luot thu 10: du (dem SAU khi cong)
    expect(arm.stats()).toEqual({ feedback: LEARN_MIN_FEEDBACK, learned: 1 });
  });

  it('mot buoc hoc bang DUNG learnStep cua san pham (dac trung = gia tri da chuan hoa `scaled`)', () => {
    const arm = learningArm({ minFeedback: 1 });
    feed(arm, 1, [TOP, OTHER], 'OTHER');
    const expected = learnStep(
      LEGACY_WEIGHTS_V1,
      { experience: 0.9, reliability: 0.9, availability: 0.1 },
      { experience: 0.3, reliability: 0.3, availability: 0.9 },
      LEARN_ETA
    );
    const w = arm.weights!();
    expect(w.experience).toBeCloseTo(expected.experience, 12);
    expect(w.reliability).toBeCloseTo(expected.reliability, 12);
    expect(w.availability).toBeCloseTo(expected.availability, 12);
    // Keo ve phia thanh phan cua nguoi duoc chon (kha dung) va xa hai thanh phan cua nguoi xep dau
    expect(w.availability).toBeGreaterThan(LEGACY_WEIGHTS_V1.availability);
    expect(w.experience).toBeLessThan(LEGACY_WEIGHTS_V1.experience);
  });

  it('dac trung la `scaled`, khong phai `value` (gia tri tho)', () => {
    const top = cand('TOP', 80, c(0.05, 0.9), c(0.05, 0.9), c(0.99, 0.1)); // tho: kha dung cao; da chuan hoa: kha dung thap
    const other = cand('OTHER', 40, c(0.04, 0.3), c(0.04, 0.3), c(0.01, 0.9));
    const arm = learningArm({ minFeedback: 1 });
    feed(arm, 1, [top, other], 'OTHER');
    const expected = learnStep(
      LEGACY_WEIGHTS_V1,
      { experience: 0.9, reliability: 0.9, availability: 0.1 },
      { experience: 0.3, reliability: 0.3, availability: 0.9 }
    );
    expect(arm.weights!().availability).toBeCloseTo(expected.availability, 12);
  });

  it('giao dung nguoi xep dau: khong co loi de sua -> khong hoc, nhung van tinh la mot luot phan hoi', () => {
    const arm = learningArm({ minFeedback: 1 });
    feed(arm, 5, [TOP, OTHER], 'TOP');
    expect(arm.stats()).toEqual({ feedback: 5, learned: 0 });
    expect(arm.weights!()).toEqual(LEGACY_WEIGHTS_V1);
  });

  it('cac ly do KHONG hoc: hoa diem (TIE), thieu thanh phan, nguoi xep dau khong co diem, nguoi duoc chon ngoai danh sach', () => {
    const tieTop = cand('TOP', 60, c(0.9), c(0.9), c(0.1));
    const tieOther = cand('OTHER', 60, c(0.3), c(0.3), c(0.9));
    let arm = learningArm({ minFeedback: 1 });
    feed(arm, 3, [tieTop, tieOther], 'OTHER');
    expect(arm.stats().learned).toBe(0); // TIE: nguoi xep dau chi hon nho tie-break

    // Chi con MOT thanh phan chung (kha dung) -> MISSING_COMPONENT (§17.7: can it nhat 2)
    const missing = cand('OTHER', 40, c(null), c(null), c(0.9));
    arm = learningArm({ minFeedback: 1 });
    feed(arm, 3, [TOP, missing], 'OTHER');
    expect(arm.stats().learned).toBe(0); // MISSING_COMPONENT
    // Hai thanh phan chung (tin cay + kha dung) thi VAN hoc (buoc 13) - kinh nghiem giu nguyen
    const twoShared = cand('OTHER', 40, c(null), c(0.3), c(0.9));
    arm = learningArm({ minFeedback: 1 });
    feed(arm, 1, [TOP, twoShared], 'OTHER');
    expect(arm.stats().learned).toBe(1);
    expect(arm.weights!().experience).toBe(LEGACY_WEIGHTS_V1.experience);

    const noScoreTop = cand('TOP', null, c(0.9), c(0.9), c(0.1));
    arm = learningArm({ minFeedback: 1 });
    feed(arm, 3, [noScoreTop, OTHER], 'OTHER');
    expect(arm.stats().learned).toBe(0); // NO_TOP

    arm = learningArm({ minFeedback: 1 });
    feed(arm, 3, [TOP, OTHER], 'NGOAI-DANH-SACH');
    expect(arm.stats()).toEqual({ feedback: 3, learned: 0 }); // NOT_CANDIDATE
    expect(arm.weights!()).toEqual(LEGACY_WEIGHTS_V1);
  });

  it('tham so: eta lon di xa hon; minFeedback tuy chinh; trong so ban dau tuy chinh', () => {
    const slow = learningArm({ minFeedback: 1, eta: 0.02 });
    const fast = learningArm({ minFeedback: 1, eta: 0.2 });
    feed(slow, 1, [TOP, OTHER], 'OTHER');
    feed(fast, 1, [TOP, OTHER], 'OTHER');
    const move = (a: ReturnType<typeof learningArm>) => l1Distance(a.weights!(), LEGACY_WEIGHTS_V1);
    expect(move(fast)).toBeGreaterThan(move(slow) * 5);

    const three = learningArm({ minFeedback: 3 });
    feed(three, 2, [TOP, OTHER], 'OTHER');
    expect(three.stats().learned).toBe(0);
    feed(three, 1, [TOP, OTHER], 'OTHER');
    expect(three.stats().learned).toBe(1);

    const init: Weights = { experience: 0.2, reliability: 0.2, availability: 0.6, declared: 0 };
    const a = learningArm({ minFeedback: 1, initial: init });
    feed(a, 1, [TOP, OTHER], 'OTHER');
    const expected = learnStep(init, { experience: 0.9, reliability: 0.9, availability: 0.1 }, { experience: 0.3, reliability: 0.3, availability: 0.9 });
    expect(a.weights!().availability).toBeCloseTo(expected.availability, 12);
  });

  it('bat bien: sau rat nhieu phan hoi ngau nhien trong so van hop le (tong 1, moi so trong [0,05; 0,70])', () => {
    const rng = new Rng(2027);
    const arm = learningArm({ minFeedback: 1, eta: 0.3 });
    for (let i = 0; i < 400; i += 1) {
      const f = () => rng.next();
      const list = [
        cand('A', 10 + rng.int(90), c(f()), c(f()), c(f())),
        cand('B', 10 + rng.int(90), c(f()), c(f()), c(f())),
        cand('C', 10 + rng.int(90), c(f()), c(f()), c(f())),
      ].sort((x, y) => y.score! - x.score!);
      arm.observe!({ output: outputOf(list), chosenKey: list[rng.int(3)]!.userId });
      const w = arm.weights!();
      expect(w.experience + w.reliability + w.availability).toBeCloseTo(1, 9);
      for (const v of [w.experience, w.reliability, w.availability]) {
        expect(v).toBeGreaterThanOrEqual(WEIGHT_MIN - 1e-12);
        expect(v).toBeLessThanOrEqual(WEIGHT_MAX + 1e-12);
      }
    }
    expect(arm.stats().learned).toBeGreaterThan(50);
  });

  it('observe khong co ket qua cua bo cham thi bao loi ro rang', () => {
    const arm = learningArm();
    expect(() => arm.observe!({ output: { order: ['A'], ranked: null }, chosenKey: 'A' })).toThrow(/bo cham/);
    expect(() => arm.observe!({ output: { order: [], ranked: [] }, chosenKey: 'A' })).toThrow(/bo cham/);
  });
});

describe('learningTrace', () => {
  const w = (e: number, r: number, a: number): Weights => ({ experience: e, reliability: r, availability: a, declared: 0 });
  const target = w(0.15, 0.15, 0.7);
  const dec = (weights: Weights | null, topKey: string, leaderKey: string | null, topHasNoHistory = false) => ({ weights, topKey, leaderKey, topHasNoHistory });
  const ds = [
    dec(w(0.45, 0.3, 0.25), 'a', 'b', true),
    dec(w(0.4, 0.3, 0.3), 'a', 'a', true),
    dec(w(0.35, 0.25, 0.4), 'b', 'b'),
    dec(w(0.3, 0.2, 0.5), 'c', 'a'),
    dec(w(0.2, 0.2, 0.6), 'a', 'a'),
    dec(w(0.15, 0.15, 0.7), 'b', 'b', true),
  ];
  const complete = [true, false, true, true, false, true];

  it('duong hoi tu: phan tu 0 la LUC BAN DAU (chua co quyet dinh), roi sau tung quyet dinh - so tinh tay', () => {
    const t = learningTrace(ds, target, complete);
    // Luc ban dau (mac dinh 0,45 / 0,30 / 0,25): |0,45-0,15| + |0,30-0,15| + |0,25-0,70| = 0,30 + 0,15 + 0,45 = 0,90
    // Sau quyet dinh 0 (trong so chua doi): 0,90 | 1: 0,25+0,15+0,40 = 0,80 | 2: 0,20+0,10+0,30 = 0,60
    // 3: 0,15+0,05+0,20 = 0,40 | 4: 0,05+0,05+0,10 = 0,20 | 5: 0
    const expected = [0.9, 0.9, 0.8, 0.6, 0.4, 0.2, 0];
    expect(t.distance).toHaveLength(ds.length + 1);
    expected.forEach((v, i) => expect(t.distance[i]).toBeCloseTo(v, 12));
    for (let i = 1; i < t.distance.length; i += 1) expect(t.distance[i]!).toBeLessThanOrEqual(t.distance[i - 1]! + 1e-12);
  });

  it('ti le chap nhan theo ba phan (n = 6 -> hai quyet dinh moi phan) va toan bo', () => {
    const t = learningTrace(ds, target, complete);
    // ba dau: quyet dinh 0,1 -> (a vs b: khong), (a vs a: co) = 1/2 ; ba cuoi: quyet dinh 4,5 -> (a,a) co, (b,b) co = 2/2 ; toan bo: 4/6
    expect(t.acceptFirstThird).toBeCloseTo(0.5, 12);
    expect(t.acceptLastThird).toBeCloseTo(1, 12);
    expect(t.acceptAll).toBeCloseTo(4 / 6, 12);
  });

  it('ti le chap nhan CHI tren quyet dinh du du lieu: mau so la cac quyet dinh co co, moi phan tinh rieng', () => {
    const t = learningTrace(ds, target, complete);
    // ba dau (quyet dinh 0, 1): chi quyet dinh 0 du du lieu, (a vs b) khong chap nhan -> 0/1 = 0
    expect(t.acceptFirstThirdComplete).toBe(0);
    // ba cuoi (quyet dinh 4, 5): chi quyet dinh 5 du du lieu, (b vs b) chap nhan -> 1/1 = 1
    expect(t.acceptLastThirdComplete).toBe(1);
    // Khong quyet dinh nao du du lieu trong mot phan -> null (khong phai 0 hay NaN)
    const none = learningTrace(ds, target, [false, false, true, true, false, false]);
    expect(none.acceptFirstThirdComplete).toBeNull();
    expect(none.acceptLastThirdComplete).toBeNull();
    // Tat ca du du lieu -> bang ti le chung
    const all = learningTrace(ds, target, ds.map(() => true));
    expect(all.acceptFirstThirdComplete).toBeCloseTo(all.acceptFirstThird, 12);
    expect(all.acceptLastThirdComplete).toBeCloseTo(all.acceptLastThird, 12);
  });

  it('ti le nguoi xep dau la nguoi moi (chua co lich su): ba dau / ba cuoi', () => {
    const t = learningTrace(ds, target, complete);
    expect(t.newcomerTopFirstThird).toBeCloseTo(1, 12); // quyet dinh 0, 1 deu la nguoi moi
    expect(t.newcomerTopLastThird).toBeCloseTo(0.5, 12); // quyet dinh 5 la nguoi moi, quyet dinh 4 khong
  });

  it('n khong chia het cho 3: phan dau va cuoi cung dung floor(n / 3), phan du nam giua', () => {
    const t = learningTrace(ds.slice(0, 5), target, complete.slice(0, 5)); // floor(5/3) = 1: dau = quyet dinh 0, cuoi = quyet dinh 4
    expect(t.acceptFirstThird).toBe(0); // a vs b
    expect(t.acceptLastThird).toBe(1); // a vs a
    expect(t.newcomerTopFirstThird).toBe(1);
    expect(t.newcomerTopLastThird).toBe(0);
  });

  it('trong so ban dau tuy chinh; dau vao sai bi tu choi', () => {
    expect(learningTrace(ds, target, complete, target).distance[0]).toBe(0);
    expect(() => learningTrace(ds.slice(0, 2), target, complete.slice(0, 2))).toThrow(/3 quyet dinh/);
    expect(() => learningTrace([...ds.slice(0, 2), dec(null, 'a', 'a')], target, [true, true, true])).toThrow(/khong co trong so/);
    expect(() => learningTrace([...ds.slice(0, 2), dec(w(0.3, 0.3, 0.4), 'a', null)], target, [true, true, true])).toThrow(/truong nhom/);
    expect(() => learningTrace(ds, target, complete.slice(0, 5))).toThrow(/co "du du lieu"/);
  });
});

describe('withCompleteFlags', () => {
  const full = (id: string) => cand(id, 50, c(0.5), c(0.5), c(0.5));
  const holey = (id: string) => cand(id, 50, c(null), c(0.5), c(0.5)); // thieu kinh nghiem (nguoi moi)
  const fake = (lists: RankedCandidate[][]): Arm => {
    let i = 0;
    return {
      id: 'fake',
      label: 'fake',
      rank: () => {
        const ranked = lists[i++]!;
        return { order: ranked.map((r) => r.userId), ranked };
      },
      weights: () => ({ ...LEGACY_WEIGHTS_V1 }),
    };
  };
  const input = { card: { title: 't', description: '' }, snapshot: { now: new Date(), idf: { docCount: 0, df: new Map() }, mu: null, candidates: [] }, load: new Map<string, number>(), rng: new Rng(1) };

  it('ghi co theo tung lan xep hang: true khi MOI ung vien du ba thanh phan, false neu chi mot nguoi thieu', () => {
    const arm = withCompleteFlags(fake([[full('a'), full('b')], [full('a'), holey('b')], [holey('a'), holey('b')], [full('a')]]));
    for (let i = 0; i < 4; i += 1) arm.rank(input);
    expect(arm.completeFlags()).toEqual([true, false, false, true]);
  });

  it('completeFlags() tra ve ban sao; ket qua xep hang va cac phuong thuc khac cua nhanh duoc giu nguyen', () => {
    const list = [full('a'), full('b')];
    const inner = fake([list]);
    const arm = withCompleteFlags(inner);
    const out = arm.rank(input);
    expect(out.order).toEqual(['a', 'b']);
    expect(out.ranked).toBe(list);
    expect(arm.id).toBe('fake');
    expect(arm.weights!()).toEqual(LEGACY_WEIGHTS_V1);
    arm.completeFlags().push(false);
    expect(arm.completeFlags()).toEqual([true]);
  });

  it('boc nhanh co hoc van giu observe / stats (cung trang thai)', () => {
    const TOP = cand('TOP', 80, c(0.9), c(0.9), c(0.1));
    const OTHER = cand('OTHER', 40, c(0.3), c(0.3), c(0.9));
    const arm = withCompleteFlags(learningArm({ minFeedback: 1 }));
    arm.observe!({ output: outputOf([TOP, OTHER]), chosenKey: 'OTHER' });
    expect(arm.stats()).toEqual({ feedback: 1, learned: 1 });
    expect(arm.weights!().availability).toBeGreaterThan(LEGACY_WEIGHTS_V1.availability);
  });

  it('"du du lieu" tinh tren gia tri da chuan hoa `scaled` (co gia tri that nhung scaled null hoac nguoc lai cho ket qua dung)', () => {
    // NEUTRAL: gia tri that null nhung scaled = trung binh -> coi la DU (khong ai thieu o buoc cong diem)
    const neutral = cand('n', 50, c(null, 0.5), c(0.5), c(0.5));
    // Gia tri that co nhung scaled null (khong co trong the gioi thuc, nhung dinh nghia phai dua vao scaled)
    const odd = cand('o', 50, c(0.4, null), c(0.5), c(0.5));
    const arm = withCompleteFlags(fake([[full('a'), neutral], [full('a'), odd]]));
    arm.rank(input);
    arm.rank(input);
    expect(arm.completeFlags()).toEqual([true, false]);
  });

  it('nhanh khong dung bo cham (khong co ranked) thi bao loi', () => {
    const noRanked: Arm = { id: 'x', label: 'x', rank: () => ({ order: ['a'], ranked: null }) };
    expect(() => withCompleteFlags(noRanked).rank(input)).toThrow(/bo cham/);
  });
});

describe('chot chan kien truc: truong nhom / nhanh co hoc khong duoc thay ky nang an', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/scripts/evalAssignLeader.ts'), 'utf8');
  it('evalAssignLeader.ts khong import simGenerator / simVocab / simReplay / simSeed', () => {
    const imports = src.split('\n').filter((l) => /^\s*(import|export)\b.*\bfrom\b/.test(l) || /^\} from /.test(l));
    expect(imports.length).toBeGreaterThan(0);
    for (const l of imports) expect(l).not.toMatch(/sim(Generator|Vocab|Replay|Seed)/);
  });
});
