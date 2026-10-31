// Buoc 6a - hoc trong so (assign.learn.ts). HAM THUAN, khong can DB.
// Bon loai bao dam:
//  (1) phep CHIEU (tu buoc 11 nam o assign.weights.ts - test o assign.weights.test.ts);
//  (2) mot buoc hoc di dung huong, dung do lon, khong bao gio pha bat bien; tu buoc 11 chi chinh ba thanh phan tu lich su,
//      trong so Ho so giu nguyen;
//  (3) quyet dinh "co hoc khong" - tung ly do khong hoc va THU TU kiem tra;
//  (4) mot "truong nhom gia" co thien lech co dinh: trong so hoc duoc phai BAM THEO (so do truoc khi viet expect).
// Ca cu (truoc buoc 11) dung LEGACY_WEIGHTS_V1 (Ho so = 0): ket qua phai y nhu truoc.
import { describe, expect, it } from 'vitest';
import {
  LEARN_ETA,
  LEARN_MIN_FEEDBACK,
  LEARN_MIN_SHARED,
  learnStep,
  learningDecision,
  parseRunCandidates,
  sharedComponents,
  type Features,
  type LearnCandidate,
  type LearnInput,
} from '../src/modules/assign/assign.learn';
import { DEFAULT_WEIGHTS, LEGACY_WEIGHTS_V1, type Weights } from '../src/modules/assign/assign.score';
import {
  LEGACY_KEYS,
  WEIGHT_KEYS,
  legacyWeightIssues,
  projectWithin,
  weightIssues,
} from '../src/modules/assign/assign.weights';
import { Rng } from '../src/scripts/simGenerator';

const W = (experience: number, reliability: number, availability: number, declared = 0): Weights => ({
  experience,
  reliability,
  availability,
  declared,
});
const near = (a: Weights, b: Weights, eps = 1e-12) => WEIGHT_KEYS.every((k) => Math.abs(a[k] - b[k]) <= eps);

// Oracle diem: chia cho tong trong so cua cac thanh phan THUC SU tham gia diem.
const featureScore = (w: Weights, x: Features): number => {
  const present = WEIGHT_KEYS.filter((k) => x[k] !== undefined);
  return 100 * present.reduce((s, k) => s + w[k] * x[k]!, 0) / present.reduce((s, k) => s + w[k], 0);
};

describe('hang so hoc', () => {
  it('eta 0,05 (§5.8) va chi hoc tu phan hoi thu 10 (§8 chot chan 1)', () => {
    expect(LEARN_ETA).toBe(0.05);
    expect(LEARN_MIN_FEEDBACK).toBe(10);
  });
});

describe('learnStep - mot buoc cap nhat (bo trong so kieu cu: Ho so = 0)', () => {
  const TOP: Features = { experience: 1, reliability: 0.5, availability: 0 };
  const CHOSEN: Features = { experience: 0, reliability: 0.5, availability: 1 };

  it('do lon dung: w + eta * (x_chon - x_dau); (0,45; 0,30; 0,25) voi hieu (-1; 0; +1) -> (0,40; 0,30; 0,30)', () => {
    expect(near(learnStep(LEGACY_WEIGHTS_V1, TOP, CHOSEN), W(0.4, 0.3, 0.3))).toBe(true);
    // Doi vai tro (chon lai la nguoi hon o kinh nghiem) -> di nguoc lai
    expect(near(learnStep(LEGACY_WEIGHTS_V1, CHOSEN, TOP), W(0.5, 0.3, 0.2))).toBe(true);
    // eta tuy chinh: buoc gap doi
    expect(near(learnStep(LEGACY_WEIGHTS_V1, TOP, CHOSEN, 0.1), W(0.35, 0.3, 0.35))).toBe(true);
  });

  it('dung HUONG: thanh phan nguoi duoc chon hon thi tang, kem hon thi giam, bang nhau thi giu', () => {
    const w = W(1 / 3, 1 / 3, 1 / 3);
    const next = learnStep(w, { experience: 0.8, reliability: 0.5, availability: 0.2 }, { experience: 0.2, reliability: 0.5, availability: 0.8 });
    expect(next.experience).toBeLessThan(w.experience);
    expect(next.availability).toBeGreaterThan(w.availability);
    expect(next.reliability).toBeCloseTo(w.reliability, 12);
    expect(near(next, W(1 / 3 - 0.03, 1 / 3, 1 / 3 + 0.03))).toBe(true);
  });

  it('hai nguoi giong het nhau -> khong doi; nguoi duoc chon hon o CA BA thanh phan -> phep chieu tru deu, ket qua van la w', () => {
    expect(near(learnStep(LEGACY_WEIGHTS_V1, TOP, TOP), LEGACY_WEIGHTS_V1)).toBe(true);
    const zero: Features = { experience: 0, reliability: 0, availability: 0 };
    const one: Features = { experience: 1, reliability: 1, availability: 1 };
    expect(near(learnStep(LEGACY_WEIGHTS_V1, zero, one), LEGACY_WEIGHTS_V1)).toBe(true);
  });

  it('cham tran / san thi phep chieu giu bat bien: (0,70; 0,25; 0,05) + eta * (+1; +1; -1) -> (0,70; 0,25; 0,05)', () => {
    const out = learnStep(W(0.7, 0.25, 0.05), { experience: 0, reliability: 0, availability: 1 }, { experience: 1, reliability: 1, availability: 0 });
    expect(near(out, W(0.7, 0.25, 0.05))).toBe(true);
  });

  it('eta va dac trung khong hop le bi tu choi', () => {
    for (const eta of [0, -0.05, Number.NaN, Infinity]) {
      expect(() => learnStep(LEGACY_WEIGHTS_V1, TOP, CHOSEN, eta), String(eta)).toThrow(RangeError);
    }
    // Kem THONG DIEP cua chinh learnStep (khong phai cua phep chieu phia sau): phat hien dung cho, dung ten thanh phan
    expect(() => learnStep(LEGACY_WEIGHTS_V1, { ...TOP, experience: Number.NaN }, CHOSEN)).toThrow(/experience khong hop le/);
    expect(() => learnStep(LEGACY_WEIGHTS_V1, TOP, { ...CHOSEN, availability: Infinity })).toThrow(/availability khong hop le/);
    expect(() => learnStep(W(Number.NaN, 0.5, 0.5), TOP, CHOSEN)).toThrow(/experience khong hop le/);
  });

  it('LUON tra bo trong so hop le tren 2000 tinh huong ngau nhien (w hop le bat ky, dac trung [0,1]); Ho so van = 0', () => {
    const rng = new Rng(99);
    const feat = (): Features => ({ experience: rng.next(), reliability: rng.next(), availability: rng.next() });
    for (let i = 0; i < 2000; i += 1) {
      const w = projectWithin(W(rng.range(-1, 2), rng.range(-1, 2), rng.range(-1, 2)), LEGACY_KEYS);
      const out = learnStep(w, feat(), feat(), rng.chance(0.3) ? rng.range(0.01, 0.5) : LEARN_ETA);
      expect(legacyWeightIssues(out), JSON.stringify({ w, out })).toEqual([]);
      expect(out.declared).toBe(0);
    }
  });
});

describe('buoc 13 (§17.7): hoc tren S = cac thanh phan CA HAI nguoi deu co', () => {
  it('phan hoi chon nguoi thieu lich su phai THU HEP khoang cach diem, khong tang tu 35 len 35,1625', () => {
    const top: Features = { experience: 1, reliability: 1, availability: 0.8, declared: 0.2 };
    const chosen: Features = { availability: 0.7, declared: 0.2 };
    const topScore = featureScore(DEFAULT_WEIGHTS, top);
    const chosenScore = featureScore(DEFAULT_WEIGHTS, chosen);
    expect([topScore, chosenScore]).toEqual([80, 45]);
    const decision = learningDecision({
      weights: DEFAULT_WEIGHTS,
      feedbackCount: 10,
      topUserId: 'top',
      chosenUserId: 'chosen',
      candidates: [
        { userId: 'top', score: topScore, features: top },
        { userId: 'chosen', score: chosenScore, features: chosen },
      ],
    });
    if (!decision.learn) throw new Error('phan hoi nay phai hoc');
    expect(featureScore(decision.next, top) - featureScore(decision.next, chosen)).toBeLessThan(35);
    expect(decision.next.availability).toBeGreaterThan(DEFAULT_WEIGHTS.availability);
    expect(decision.next.declared).toBeLessThan(DEFAULT_WEIGHTS.declared);
    expect([decision.next.experience, decision.next.reliability]).toEqual([0.36, 0.24]);
    expect(weightIssues(decision.next)).toEqual([]);
  });

  it('nhieu mau thieu du lieu: moi buoc hoc khong tang khoang cach diem top - chosen', () => {
    const rng = new Rng(61006);
    let checked = 0;
    for (let i = 0; i < 1500; i += 1) {
      const w = projectWithin(W(rng.next(), rng.next(), rng.next(), rng.next()), WEIGHT_KEYS);
      const features = (): Features => Object.fromEntries(WEIGHT_KEYS.filter(() => rng.chance(0.75)).map((k) => [k, rng.next()]));
      const top = features();
      const chosen = features();
      if (sharedComponents(top, chosen).length < 2) continue;
      const before = featureScore(w, top) - featureScore(w, chosen);
      const next = learnStep(w, top, chosen);
      const after = featureScore(next, top) - featureScore(next, chosen);
      expect(after, JSON.stringify({ w, top, chosen, before, after })).toBeLessThanOrEqual(before + 1e-10);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(800);
  });

  it('sharedComponents: theo thu tu co dinh, chi so huu han, can o CA HAI', () => {
    expect(sharedComponents({ declared: 0.1, experience: 1, availability: 0 }, { availability: 1, declared: 0, reliability: 0.2 })).toEqual(['availability', 'declared']);
    expect(sharedComponents({ experience: Number.NaN, reliability: 1 }, { experience: 0, reliability: 0 })).toEqual(['reliability']);
    expect(sharedComponents({}, { experience: 1 })).toEqual([]);
    expect(LEARN_MIN_SHARED).toBe(2);
  });

  it('S = 2 (thieu tin cay o mot nguoi): chinh kinh nghiem + kha dung trong khoi 1 - 0,30; tin cay va Ho so KHONG doi (tinh tay)', () => {
    const out = learnStep(LEGACY_WEIGHTS_V1, { experience: 1, availability: 0 }, { experience: 0, reliability: 0.9, availability: 1 });
    // D_top = 0,70, D_chosen = 1: delta = (-1; +0,70); chieu giu khoi 0,70 -> (-0,0425; +0,0425).
    expect(near(out, W(0.4075, 0.3, 0.2925, 0))).toBe(true);
    expect(out.reliability).toBe(0.3);
  });

  it('S co Ho so: kinh nghiem + Ho so trong khoi 1 - (0,24 + 0,20) = 0,56 (tinh tay)', () => {
    const out = learnStep(DEFAULT_WEIGHTS, { experience: 1, declared: 0 }, { experience: 0, declared: 1 });
    expect(near(out, W(0.31, 0.24, 0.2, 0.25))).toBe(true);
    expect([out.reliability, out.availability]).toEqual([0.24, 0.2]);
  });

  it('S = 4: luat cu mo rong - (0,36; 0,24; 0,20; 0,20) + 0,05 x (-1; 0; +1; +1) -> tong 1,05 -> tru deu 0,0125 (tinh tay)', () => {
    const out = learnStep(DEFAULT_WEIGHTS, { experience: 1, reliability: 0.5, availability: 0, declared: 0 }, { experience: 0, reliability: 0.5, availability: 1, declared: 1 });
    expect(near(out, W(0.2975, 0.2275, 0.2375, 0.2375))).toBe(true);
  });

  it('|S| < 2 -> learnStep tu choi; learningDecision tra MISSING_COMPONENT (moi nguoi du nhieu thanh phan nhung CHUNG chi 1)', () => {
    expect(() => learnStep(DEFAULT_WEIGHTS, { availability: 0 }, { availability: 1, experience: 1 })).toThrow(/it nhat 2 thanh phan chung/);
    const d = learningDecision({
      weights: DEFAULT_WEIGHTS,
      feedbackCount: 10,
      topUserId: 'a',
      chosenUserId: 'b',
      candidates: [
        { userId: 'a', score: 60, features: { experience: 1, reliability: 1, availability: 0 } },
        { userId: 'b', score: 40, features: { availability: 1, declared: 1 } },
      ],
    });
    expect(d).toEqual({ learn: false, reason: 'MISSING_COMPONENT' });
  });

  it('gia tri DIEN bang NEUTRAL (value null) khong duoc hoc - tru khi bat includeFilled (chi de do)', () => {
    const run = [
      { userId: 'a', score: 60, components: { experience: { value: 0.9, scaled: 1 }, availability: { value: 0.2, scaled: 0 }, declared: { value: null, scaled: 0.5 } } },
      { userId: 'b', score: 40, components: { experience: { value: 0.1, scaled: 0 }, availability: { value: 1, scaled: 1 }, declared: { value: 0.8, scaled: 1 } } },
    ];
    expect(parseRunCandidates(run)[0]!.features).toEqual({ experience: 1, availability: 0 });
    expect(parseRunCandidates(run, { includeFilled: true })[0]!.features).toEqual({ experience: 1, availability: 0, declared: 0.5 });
    const base = { weights: DEFAULT_WEIGHTS, feedbackCount: 10, topUserId: 'a', chosenUserId: 'b' };
    const strict = learningDecision({ ...base, candidates: parseRunCandidates(run) });
    const filled = learningDecision({ ...base, candidates: parseRunCandidates(run, { includeFilled: true }) });
    if (!strict.learn || !filled.learn) throw new Error('phai hoc');
    expect(strict.next.declared).toBe(0.2); // Ho so ngoai S
    expect(filled.next.declared).toBeGreaterThan(0.2); // Ho so trong S
  });

  it('NEUTRAL van nam trong mau so diem, du khong duoc dung lam bang chung hoc', () => {
    const comp = (value: number | null, scaled: number | null = value) => ({ value, scaled });
    const topScoreFeatures: Features = { experience: 0.8, reliability: 1, availability: 0.2, declared: 0.5 };
    const chosenScoreFeatures: Features = { experience: 0.7, availability: 0.2, declared: 0.2 };
    const candidates = parseRunCandidates([
      { userId: 'a', score: featureScore(DEFAULT_WEIGHTS, topScoreFeatures), components: {
        experience: comp(0.8), reliability: comp(1), availability: comp(0.2), declared: comp(null, 0.5),
      } },
      { userId: 'b', score: featureScore(DEFAULT_WEIGHTS, chosenScoreFeatures), components: {
        experience: comp(0.7), reliability: comp(null), availability: comp(0.2), declared: comp(0.2),
      } },
    ]);
    expect(candidates[0]!.features!.declared).toBeUndefined();
    expect(candidates[0]!.scoreComponents).toEqual(WEIGHT_KEYS);
    const decision = learningDecision({ weights: DEFAULT_WEIGHTS, feedbackCount: 10, topUserId: 'a', chosenUserId: 'b', candidates });
    if (!decision.learn) throw new Error('phan hoi nay phai hoc');
    const before = candidates[0]!.score! - candidates[1]!.score!;
    const after = featureScore(decision.next, topScoreFeatures) - featureScore(decision.next, chosenScoreFeatures);
    expect(after).toBeLessThan(before);
    expect(decision.next.experience).toBeGreaterThan(DEFAULT_WEIGHTS.experience);
    expect([decision.next.reliability, decision.next.declared]).toEqual([0.24, 0.2]);
  });

  it('3000 tinh huong ngau nhien (S bat ky, >= 2): hop le, ngoai S giu tung bit, tong trong S giu nguyen', () => {
    const rng = new Rng(1313);
    const KEYS = ['experience', 'reliability', 'availability', 'declared'] as const;
    let checked = 0;
    for (let i = 0; i < 3000; i += 1) {
      const w = projectWithin(W(rng.range(-1, 2), rng.range(-1, 2), rng.range(-1, 2), rng.range(-1, 2)), WEIGHT_KEYS);
      const feat = () => Object.fromEntries(KEYS.filter(() => rng.chance(0.75)).map((k) => [k, rng.next()]));
      const top = feat();
      const chosen = feat();
      const S = sharedComponents(top, chosen);
      if (S.length < 2) continue;
      const out = learnStep(w, top, chosen, rng.chance(0.3) ? rng.range(0.01, 0.5) : LEARN_ETA);
      expect(weightIssues(out), JSON.stringify({ w, out })).toEqual([]);
      for (const k of KEYS) if (!S.includes(k)) expect(out[k]).toBe(w[k]);
      const sum = (x: Weights) => S.reduce((s, k) => s + x[k], 0);
      expect(Math.abs(sum(out) - sum(w))).toBeLessThan(1e-9);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(1500);
  });
});

describe('learnStep - bo bon trong so (§17.7): chi chinh ba thanh phan tu lich su, trong khoi 1 - Ho so', () => {
  const TOP: Features = { experience: 1, reliability: 0.5, availability: 0 };
  const CHOSEN: Features = { experience: 0, reliability: 0.5, availability: 1 };

  it('mac dinh moi (0,36; 0,24; 0,20; 0,20) voi hieu (-1; 0; +1) -> (0,31; 0,24; 0,25; 0,20) (tinh tay)', () => {
    const out = learnStep(DEFAULT_WEIGHTS, TOP, CHOSEN);
    expect(near(out, W(0.31, 0.24, 0.25, 0.2))).toBe(true);
    expect(weightIssues(out)).toEqual([]);
  });

  it('cham san khi khoi < 1: (0,10; 0,60; 0,10; 0,20) + 0,1 * (-1; +1; 0) -> (0,05; 0,675; 0,075; 0,20) (tinh tay: tau = 0,025)', () => {
    const out = learnStep(W(0.1, 0.6, 0.1, 0.2), { experience: 1, reliability: 0, availability: 0 }, { experience: 0, reliability: 1, availability: 0 }, 0.1);
    expect(near(out, W(0.05, 0.675, 0.075, 0.2))).toBe(true);
  });

  it('nguoi duoc chon hon o CA BA thanh phan: ba trong so tru deu ve cho cu, Ho so KHONG bi keo (chieu ca bo thi Ho so tut xuong 0,1625)', () => {
    const w = W(0.5, 0.2, 0.1, 0.2);
    const zero: Features = { experience: 0, reliability: 0, availability: 0 };
    const one: Features = { experience: 1, reliability: 1, availability: 1 };
    expect(near(learnStep(w, zero, one), w)).toBe(true);
    // Doi chung: phep chieu CA BO (4 khoa) cho ket qua khac - chung minh ca nay phan biet duoc hai cach
    const global = projectWithin(W(0.55, 0.25, 0.15, 0.2), WEIGHT_KEYS);
    expect(near(global, W(0.5125, 0.2125, 0.1125, 0.1625))).toBe(true);
  });

  it('2000 tinh huong ngau nhien: luon hop le (4 khoa), Ho so giu nguyen tung bit, tong ba thanh phan = 1 - Ho so', () => {
    const rng = new Rng(4242);
    const feat = (): Features => ({ experience: rng.next(), reliability: rng.next(), availability: rng.next() });
    for (let i = 0; i < 2000; i += 1) {
      const d = rng.range(0.05, 0.7);
      const w = projectWithin(W(rng.range(-1, 2), rng.range(-1, 2), rng.range(-1, 2), d), LEGACY_KEYS);
      expect(weightIssues(w), JSON.stringify(w)).toEqual([]);
      const out = learnStep(w, feat(), feat(), rng.chance(0.3) ? rng.range(0.01, 0.5) : LEARN_ETA);
      expect(weightIssues(out), JSON.stringify({ w, out })).toEqual([]);
      expect(out.declared).toBe(d);
      expect(Math.abs(out.experience + out.reliability + out.availability - (1 - d))).toBeLessThan(1e-12);
    }
  });

  it('Ho so khong phai so huu han -> loi (khong am tham tinh khoi bang NaN)', () => {
    expect(() => learnStep(W(0.4, 0.3, 0.3, Number.NaN), TOP, CHOSEN)).toThrow(RangeError);
  });
});

describe('learningDecision - co hoc khong, vi sao khong', () => {
  const cand = (userId: string, score: number | null, features: Features | null): LearnCandidate => ({ userId, score, features });
  const A = cand('a', 60, { experience: 1, reliability: 0.5, availability: 0 });
  const B = cand('b', 40, { experience: 0, reliability: 0.5, availability: 1 });
  const C = cand('c', 10, null);
  const base = (over: Partial<LearnInput> = {}): LearnInput => ({
    weights: LEGACY_WEIGHTS_V1,
    feedbackCount: 10,
    topUserId: 'a',
    chosenUserId: 'b',
    candidates: [A, B, C],
    ...over,
  });

  it('du dieu kien -> LEARNED, kem trong so moi = learnStep', () => {
    const d = learningDecision(base());
    expect(d.learn).toBe(true);
    if (!d.learn) throw new Error('khong hoc');
    expect(d.reason).toBe('LEARNED');
    expect(near(d.next, learnStep(LEGACY_WEIGHTS_V1, A.features!, B.features!))).toBe(true);
    expect(near(d.next, W(0.4, 0.3, 0.3))).toBe(true);
    // Bo bon trong so: cung luat, Ho so giu nguyen
    const d4 = learningDecision(base({ weights: DEFAULT_WEIGHTS }));
    if (!d4.learn) throw new Error('khong hoc');
    expect(near(d4.next, W(0.31, 0.24, 0.25, 0.2))).toBe(true);
  });

  it('tung ly do khong hoc', () => {
    const reason = (over: Partial<LearnInput>) => {
      const d = learningDecision(base(over));
      expect(d.learn, JSON.stringify(over)).toBe(false);
      return d.reason;
    };
    expect(reason({ topUserId: null })).toBe('NO_TOP');
    expect(reason({ chosenUserId: 'a' })).toBe('ACCEPTED');
    expect(reason({ feedbackCount: 9 })).toBe('TOO_EARLY');
    expect(reason({ chosenUserId: 'khong-co' })).toBe('NOT_CANDIDATE');
    expect(reason({ topUserId: 'khong-co' })).toBe('NOT_CANDIDATE');
    expect(reason({ chosenUserId: 'c' })).toBe('MISSING_COMPONENT'); // C thieu thanh phan
    expect(reason({ candidates: [cand('a', 60, null), B] })).toBe('MISSING_COMPONENT'); // nguoi xep dau thieu
    expect(reason({ candidates: [cand('a', null, A.features), B] })).toBe('MISSING_COMPONENT');
    expect(reason({ candidates: [A, cand('b', null, B.features)] })).toBe('MISSING_COMPONENT');
    expect(reason({ candidates: [A, cand('b', 60, B.features)] })).toBe('TIE'); // diem bang nhau (hon nho tie-break)
    expect(reason({ candidates: [cand('a', 30, A.features), B] })).toBe('TIE'); // nhat ky ky la: nguoi xep dau diem THAP hon
    expect(reason({ candidates: [A, cand('b', 40, A.features)] })).toBe('NO_CHANGE'); // hai nguoi giong het nhau
  });

  it('bien so luot: 9 -> TOO_EARLY, 10 -> hoc (mac dinh); minFeedback tuy chinh; ACCEPTED thang TOO_EARLY', () => {
    expect(learningDecision(base({ feedbackCount: 9 })).reason).toBe('TOO_EARLY');
    expect(learningDecision(base({ feedbackCount: 10 })).reason).toBe('LEARNED');
    expect(learningDecision(base({ feedbackCount: 11 })).reason).toBe('LEARNED');
    expect(learningDecision(base({ feedbackCount: 2, minFeedback: 3 })).reason).toBe('TOO_EARLY');
    expect(learningDecision(base({ feedbackCount: 3, minFeedback: 3 })).reason).toBe('LEARNED');
    expect(learningDecision(base({ feedbackCount: 0, chosenUserId: 'a' })).reason).toBe('ACCEPTED');
    expect(learningDecision(base({ feedbackCount: 0, topUserId: null })).reason).toBe('NO_TOP');
  });

  it('THU TU kiem tra co dinh: TOO_EARLY truoc NOT_CANDIDATE truoc MISSING_COMPONENT truoc TIE', () => {
    expect(learningDecision(base({ feedbackCount: 1, chosenUserId: 'khong-co' })).reason).toBe('TOO_EARLY');
    expect(learningDecision(base({ chosenUserId: 'khong-co', candidates: [cand('a', 60, null)] })).reason).toBe('NOT_CANDIDATE');
    expect(learningDecision(base({ candidates: [cand('a', 50, null), cand('b', 50, B.features)] })).reason).toBe('MISSING_COMPONENT');
  });

  it('khong sua dau vao; eta tuy chinh duoc chuyen xuong', () => {
    const input = base();
    const frozen = { ...input, candidates: Object.freeze([...input.candidates]) as readonly LearnCandidate[] };
    const before = JSON.stringify(frozen);
    const d = learningDecision(frozen);
    expect(JSON.stringify(frozen)).toBe(before);
    expect(d.learn).toBe(true);
    const big = learningDecision({ ...input, eta: 0.1 });
    if (!big.learn) throw new Error('khong hoc');
    expect(near(big.next, W(0.35, 0.3, 0.35))).toBe(true);
  });
});

describe('parseRunCandidates - doc lai AssignRun.candidates', () => {
  const comp = (value: number | null, scaled: number | null) => ({ value, scaled, share: 0.3 });
  const good = (userId: string, score: number | null = 50) => ({
    userId,
    rank: 1,
    score,
    components: { experience: comp(0.7, 1), reliability: comp(1, 0.5), availability: comp(0.4, 0) },
    evidence: [],
  });

  it('lay diem va DAC TRUNG theo `scaled` (khong phai `value`), giu thu tu, bo qua khoa la', () => {
    const out = parseRunCandidates([good('a', 61.5), good('b')]);
    expect(out).toEqual([
      { userId: 'a', score: 61.5, features: { experience: 1, reliability: 0.5, availability: 0 }, scoreComponents: LEGACY_KEYS },
      { userId: 'b', score: 50, features: { experience: 1, reliability: 0.5, availability: 0 }, scoreComponents: LEGACY_KEYS },
    ]);
  });

  it('JSON cu (ba thanh phan, truoc buoc 11) van hoc duoc: khong doi hoi thanh phan Ho so (buoc 13 moi xet no)', () => {
    const out = parseRunCandidates([good('a')]);
    expect(out[0]!.features).not.toBeNull();
    // Co them khoa `declared` (tu buoc 12) cung khong lam hong dac trung cua ba thanh phan
    const withDeclared = { ...good('b'), components: { ...good('b').components, declared: comp(null, 0.5) } };
    expect(parseRunCandidates([withDeclared])[0]!.features).toEqual({ experience: 1, reliability: 0.5, availability: 0 });
  });

  it('thanh phan thieu gia tri that (value = null, vd dien NEUTRAL) hoac khong co scaled -> CHI thanh phan do vang; khong co components -> null', () => {
    const missingValue = { ...good('a'), components: { ...good('a').components, reliability: comp(null, 0.5) } };
    const missingScaled = { ...good('b'), components: { ...good('b').components, availability: comp(0.4, null) } };
    const noComponent = { userId: 'c', score: 5 };
    const badScore = good('d', null);
    const out = parseRunCandidates([missingValue, missingScaled, noComponent, badScore]);
    expect(out.map((c) => [c.userId, c.features])).toEqual([
      ['a', { experience: 1, availability: 0 }],
      ['b', { experience: 1, reliability: 0.5 }],
      ['c', null],
      ['d', { experience: 1, reliability: 0.5, availability: 0 }],
    ]);
    // Thanh phan hong (khong phai doi tuong) cung chi vang rieng no
    expect(parseRunCandidates([{ ...good('e'), components: { ...good('e').components, experience: 'x' } }])[0]!.features).toEqual({ reliability: 0.5, availability: 0 });
    expect(out[3]!.score).toBeNull();
    expect(parseRunCandidates([{ ...good('e'), score: 'cao' }])[0]!.score).toBeNull();
    expect(parseRunCandidates([{ ...good('f'), score: Number.NaN }])[0]!.score).toBeNull();
  });

  it('dong hong bi bo, khong nem loi; khong phai mang -> rong', () => {
    for (const bad of [null, undefined, {}, 'x', 42]) expect(parseRunCandidates(bad)).toEqual([]);
    const out = parseRunCandidates([null, 'x', 7, [], { rank: 1 }, { userId: 42 }, good('ok')]);
    expect(out.map((c) => c.userId)).toEqual(['ok']);
  });
});

// ===================== Truong nhom gia co thien lech =====================
// Thu nghiem (chay ngoai kho ma truoc khi viet expect, hat giong co dinh): moi vong co 4 ung vien voi ba dac trung ngau nhien
// trong [0,1]; he thong xep theo w . x, "truong nhom" chon theo thien lech CO DINH b . x (+ nhieu). Khong nhieu: L1 giua trong
// so hoc duoc va thien lech 0,50 -> 0,03 / 0,90 -> 0,02 / 0,80 -> 0,03 (8/8 hat giong), dong y top-1 76-88% -> 98-99%, chi ~25 trong
// 300 vong thuc su cap nhat. Truong nhom nhieu (+-0,15): L1 -> 0,10-0,16, dong y 66-78% -> 76-78%.
// Ba thanh phan tu lich su, Ho so = 0 (dung nhu truoc buoc 11).

interface SimResult {
  end: Weights;
  distStart: number;
  distEnd: number;
  agreeFirst: number;
  agreeLast: number;
  learned: number;
}

function simulate(seed: number, bias: Weights, rounds: number, noise: number): SimResult {
  const rng = new Rng(seed);
  let w: Weights = { ...LEGACY_WEIGHTS_V1 };
  const l1 = (a: Weights, b: Weights) => LEGACY_KEYS.reduce((s, k) => s + Math.abs(a[k] - b[k]), 0);
  const dot = (p: Weights, x: Features) => LEGACY_KEYS.reduce((s, k) => s + p[k] * x[k], 0);
  let agreeFirst = 0;
  let agreeLast = 0;
  let learned = 0;
  for (let r = 0; r < rounds; r += 1) {
    const xs: Features[] = Array.from({ length: 4 }, () => ({ experience: rng.next(), reliability: rng.next(), availability: rng.next() }));
    const order = xs.map((_, i) => i).sort((a, b) => dot(w, xs[b]!) - dot(w, xs[a]!));
    const top = order[0]!;
    const leader = xs
      .map((x, i) => ({ i, s: dot(bias, x) + (noise ? rng.range(-noise, noise) : 0) }))
      .sort((a, b) => b.s - a.s)[0]!.i;
    if (r < 100 && leader === top) agreeFirst += 1;
    if (r >= rounds - 100 && leader === top) agreeLast += 1;
    const candidates: LearnCandidate[] = xs.map((x, i) => ({ userId: `u${i}`, score: dot(w, x) * 100, features: x }));
    const d = learningDecision({ weights: w, feedbackCount: r + 1, topUserId: `u${top}`, chosenUserId: `u${leader}`, candidates });
    if (d.learn) {
      w = d.next;
      learned += 1;
      expect(legacyWeightIssues(w), `vong ${r}`).toEqual([]); // moi buoc trung gian deu hop le
      expect(w.declared).toBe(0);
    }
  }
  return { end: w, distStart: l1(LEGACY_WEIGHTS_V1, bias), distEnd: l1(w, bias), agreeFirst, agreeLast, learned };
}

describe('truong nhom gia co thien lech co dinh: trong so hoc duoc BAM THEO', () => {
  const SEEDS = [1009, 2018, 3027, 4036, 5045, 6054, 7063, 8072];
  const BIASES: [string, Weights][] = [
    ['thien lech kinh nghiem', W(0.7, 0.15, 0.15)],
    ['thien lech kha dung', W(0.15, 0.15, 0.7)],
    ['thien lech tin cay', W(0.15, 0.7, 0.15)],
  ];

  it('nhat quan (khong nhieu): 8/8 hat giong, L1 cuoi < 0,1 va < 25% luc dau, dong y top-1 ~99% o 100 vong cuoi (so voi 66-88% ban dau)', () => {
    for (const [name, bias] of BIASES) {
      for (const seed of SEEDS) {
        const r = simulate(seed, bias, 300, 0);
        expect(r.distEnd, `${name} ${seed}`).toBeLessThan(0.1);
        expect(r.distEnd, `${name} ${seed}`).toBeLessThan(0.25 * r.distStart);
        expect(r.agreeLast, `${name} ${seed}`).toBeGreaterThanOrEqual(90);
        expect(r.agreeLast, `${name} ${seed}`).toBeGreaterThan(r.agreeFirst);
        expect(r.learned, `${name} ${seed}`).toBeGreaterThan(5); // co hoc that
        expect(r.learned, `${name} ${seed}`).toBeLessThan(120); // va khong "hoc" o moi vong
      }
    }
  });

  it('truong nhom khong nhat quan (nhieu +-0,15): van gan thien lech hon luc dau o >= 7/8 hat giong va giam >= mot nua khoang cach trung binh', () => {
    for (const [name, bias] of BIASES) {
      const rows = SEEDS.map((s) => simulate(s, bias, 300, 0.15));
      const closer = rows.filter((r) => r.distEnd < r.distStart).length;
      const meanStart = rows.reduce((a, r) => a + r.distStart, 0) / rows.length;
      const meanEnd = rows.reduce((a, r) => a + r.distEnd, 0) / rows.length;
      expect(closer, name).toBeGreaterThanOrEqual(7);
      expect(meanEnd, name).toBeLessThan(0.5 * meanStart);
    }
  });

  it('DOI CHUNG: truong nhom chon dung theo trong so mac dinh (khong nhieu) -> KHONG hoc gi, trong so giu nguyen', () => {
    for (const seed of SEEDS) {
      const r = simulate(seed, LEGACY_WEIGHTS_V1, 300, 0);
      expect(r.learned, String(seed)).toBe(0);
      expect(near(r.end, LEGACY_WEIGHTS_V1), String(seed)).toBe(true);
      expect(r.agreeFirst).toBe(100);
    }
  });
});
