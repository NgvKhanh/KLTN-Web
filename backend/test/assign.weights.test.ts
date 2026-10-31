// Buoc 5 + buoc 11 - bo trong so cua nhom (assign.weights.ts). HAM THUAN, khong can DB.
//  - kiem tra (weightIssues): bon khoa (mac dinh) va ba khoa kieu cu (API / CSDL cho toi buoc 16);
//  - phep chieu (projectOnto / projectWithin): luon hop le VA la diem hop le GAN NHAT (doi chieu vet can) - chuyen tu
//    assign.learn.test.ts (projectWeights) sang o buoc 11;
//  - nang cap bo ba trong so cu len bon khoa (upgradeLegacyWeights, §17.8).
import { describe, expect, it } from 'vitest';
import { DEFAULT_DECLARED_WEIGHT, DEFAULT_WEIGHTS, LEGACY_WEIGHTS_V1, type Weights } from '../src/modules/assign/assign.score';
import {
  LEGACY_DEFAULT_WEIGHTS,
  LEGACY_KEYS,
  WEIGHT_KEYS,
  WEIGHT_MAX,
  WEIGHT_MIN,
  WEIGHT_SUM_TOLERANCE,
  isDefaultWeights,
  legacyWeightIssues,
  pinLegacy,
  projectOnto,
  projectWithin,
  sameWeights,
  toLegacy,
  upgradeLegacyWeights,
  weightIssues,
  type LegacyWeights,
} from '../src/modules/assign/assign.weights';
import { Rng } from '../src/scripts/simGenerator';

const W = (experience: unknown, reliability: unknown, availability: unknown) => ({ experience, reliability, availability });
const W4 = (experience: number, reliability: number, availability: number, declared: number): Weights => ({
  experience,
  reliability,
  availability,
  declared,
});
const paths = (w: ReturnType<typeof W>) => legacyWeightIssues(w).map((i) => i.path);
const near = (a: Weights, b: Weights, eps = 1e-12) => WEIGHT_KEYS.every((k) => Math.abs(a[k] - b[k]) <= eps);
const sum4 = (w: Weights) => w.experience + w.reliability + w.availability + w.declared;

describe('hang so', () => {
  it('cac hang so dung gia tri thiet ke (§8: [0,05; 0,70]; tong = 1 voi sai so 1e-6; bon khoa, ba khoa kieu cu)', () => {
    expect(WEIGHT_MIN).toBe(0.05);
    expect(WEIGHT_MAX).toBe(0.7);
    expect(WEIGHT_SUM_TOLERANCE).toBe(1e-6);
    expect([...WEIGHT_KEYS]).toEqual(['experience', 'reliability', 'availability', 'declared']);
    expect([...LEGACY_KEYS]).toEqual(['experience', 'reliability', 'availability']);
  });

  it('mac dinh moi = (1 - d) x (0,45; 0,30; 0,25) + d voi d = 0,20 (§17.6); bo cu ghim o LEGACY_WEIGHTS_V1', () => {
    expect(DEFAULT_DECLARED_WEIGHT).toBe(0.2);
    expect(DEFAULT_WEIGHTS).toEqual({ experience: 0.36, reliability: 0.24, availability: 0.2, declared: 0.2 });
    const d = DEFAULT_DECLARED_WEIGHT;
    const family = W4((1 - d) * 0.45, (1 - d) * 0.3, (1 - d) * 0.25, d);
    expect(near(DEFAULT_WEIGHTS, family)).toBe(true);
    expect(weightIssues(DEFAULT_WEIGHTS)).toEqual([]);
    expect(LEGACY_WEIGHTS_V1).toEqual({ experience: 0.45, reliability: 0.3, availability: 0.25, declared: 0 });
    expect(LEGACY_DEFAULT_WEIGHTS).toEqual({ experience: 0.45, reliability: 0.3, availability: 0.25 });
    // Khong luu duoc qua API: Ho so = 0 duoi muc san
    expect(weightIssues(LEGACY_WEIGHTS_V1).map((i) => i.path)).toEqual(['declared']);
  });
});

describe('weightIssues - ba khoa kieu cu (dong CSDL truoc buoc 16): gia tri hop le', () => {
  it('bo mac dinh, cac bien [0,05; 0,70] va sai so cua tong deu duoc chap nhan', () => {
    expect(legacyWeightIssues(LEGACY_DEFAULT_WEIGHTS)).toEqual([]);
    expect(legacyWeightIssues(W(0.05, 0.25, 0.7))).toEqual([]);
    expect(legacyWeightIssues(W(0.7, 0.25, 0.05))).toEqual([]);
    expect(legacyWeightIssues(W(0.25, 0.7, 0.05))).toEqual([]);
    expect(legacyWeightIssues(W(1 / 3, 1 / 3, 1 / 3))).toEqual([]);
    // Tong lech nho hon sai so van qua (so thuc), lech hon thi khong
    expect(legacyWeightIssues(W(0.45 + WEIGHT_SUM_TOLERANCE / 2, 0.3, 0.25))).toEqual([]);
    expect(legacyWeightIssues(W(0.45 - WEIGHT_SUM_TOLERANCE / 2, 0.3, 0.25))).toEqual([]);
  });
});

describe('weightIssues - ba khoa kieu cu: tung loai loi', () => {
  it('duoi 0,05 / tren 0,70: bao dung truong sai, khong bao tong khi tong van bang 1', () => {
    expect(paths(W(0.04, 0.5, 0.46))).toEqual(['experience']);
    expect(paths(W(0.5, 0.04, 0.46))).toEqual(['reliability']);
    expect(paths(W(0.5, 0.46, 0.04))).toEqual(['availability']);
    expect(paths(W(0.71, 0.2, 0.09))).toEqual(['experience']);
    expect(paths(W(0.2, 0.71, 0.09))).toEqual(['reliability']);
    expect(paths(W(0.2, 0.09, 0.71))).toEqual(['availability']);
    // Cham sat bien nhung con nam ngoai
    expect(paths(W(0.7000001, 0.2, 0.0999999))).toEqual(['experience']);
    expect(paths(W(0.0499999, 0.5, 0.4500001))).toEqual(['experience']);
    // So am
    expect(paths(W(-0.1, 0.6, 0.5))).toEqual(['experience']);
  });

  it('tong khac 1: chi bao "sum" khi ca ba deu trong khoang; thong bao noi "ba trong so" nhu truoc buoc 11', () => {
    expect(paths(W(0.3, 0.3, 0.3))).toEqual(['sum']);
    expect(paths(W(0.4, 0.4, 0.4))).toEqual(['sum']);
    expect(paths(W(0.45 + 2 * WEIGHT_SUM_TOLERANCE, 0.3, 0.25))).toEqual(['sum']);
    expect(paths(W(0.45 - 2 * WEIGHT_SUM_TOLERANCE, 0.3, 0.25))).toEqual(['sum']);
    const [issue] = legacyWeightIssues(W(0.3, 0.3, 0.3));
    expect(issue!.message).toBe('tong ba trong so phai bang 1 (hien la 0.9)');
  });

  it('khong phai so huu han (NaN, Infinity, chuoi, null, thieu): bao dung truong do, khong nem loi, khong bao tong', () => {
    const bad: unknown[] = [Number.NaN, Infinity, -Infinity, '0.5', null, undefined, {}, [], true];
    for (const v of bad) {
      expect(paths(W(v, 0.3, 0.25)), String(v)).toEqual(['experience']);
      expect(paths(W(0.45, v, 0.25)), String(v)).toEqual(['reliability']);
      expect(paths(W(0.45, 0.3, v)), String(v)).toEqual(['availability']);
    }
    // Ca ba hong -> ba loi, van khong nem
    expect(paths(W(undefined, null, 'x'))).toEqual(['experience', 'reliability', 'availability']);
    // Thieu han khoa
    expect(paths({} as ReturnType<typeof W>)).toEqual(['experience', 'reliability', 'availability']);
  });

  it('nhieu loi cung luc duoc bao het mot lan (giao dien hien duoc tat ca)', () => {
    // 0,9 vuot tran, -0,1 duoi san, tong = 1,0 -> khong co loi tong
    expect(paths(W(0.9, -0.1, 0.2))).toEqual(['experience', 'reliability']);
    // Vua sai khoang vua sai tong
    expect(paths(W(0.9, 0.9, 0.9))).toEqual(['experience', 'reliability', 'availability', 'sum']);
  });

  it('thong bao noi ten thanh phan bang tieng Viet va nhac khoang cho phep', () => {
    const msg = (w: ReturnType<typeof W>) => legacyWeightIssues(w).map((i) => i.message).join(' | ');
    expect(msg(W(0.04, 0.5, 0.46))).toContain('kinh nghiem');
    expect(msg(W(0.5, 0.04, 0.46))).toContain('do tin cay');
    expect(msg(W(0.5, 0.46, 0.04))).toContain('kha dung');
    expect(msg(W(0.04, 0.5, 0.46))).toContain('0.05');
    expect(msg(W(0.04, 0.5, 0.46))).toContain('0.7');
    expect(msg(W(Number.NaN, 0.3, 0.25))).toContain('huu han');
  });
});

describe('weightIssues - doi chieu voi dinh nghia viet lai doc lap (500 bo ngau nhien, hat giong co dinh)', () => {
  const pick = (rng: Rng) => {
    const r = rng.next();
    if (r < 0.15) return rng.pick([0.05, 0.7, 0.04999, 0.70001, 0, 1, -0.2, 0.25, 0.3]);
    return rng.range(-0.1, 1.0);
  };

  it('ba khoa: rong <=> ca ba trong [0,05; 0,70] va |tong - 1| <= 1e-6; tap truong sai khop', () => {
    const rng = new Rng(20260920);
    let valid = 0;
    for (let i = 0; i < 500; i += 1) {
      const a = pick(rng);
      const b = pick(rng);
      const c = i % 3 === 0 ? 1 - a - b : pick(rng); // 1/3 so bo co tong = 1 de nhanh "hop le" duoc kiem tra that su
      const w = W(a, b, c);
      const got = legacyWeightIssues(w).map((x) => x.path);

      const want: string[] = [];
      [a, b, c].forEach((v, idx) => {
        if (v < 0.05 || v > 0.7) want.push(LEGACY_KEYS[idx]!);
      });
      if (Math.abs(a + b + c - 1) > 1e-6) want.push('sum');
      expect(got, JSON.stringify(w)).toEqual(want);
      if (want.length === 0) valid += 1;
    }
    // Phep thu phai co ca hai nhanh (khong bien thanh "toan bo deu sai")
    expect(valid).toBeGreaterThan(20);
    expect(valid).toBeLessThan(400);
  });

  it('bon khoa (mac dinh): cung dinh nghia tren ca bon, tong cua ca bon', () => {
    const rng = new Rng(11);
    let valid = 0;
    for (let i = 0; i < 500; i += 1) {
      const a = pick(rng);
      const b = pick(rng);
      const c = pick(rng);
      const d = i % 3 === 0 ? 1 - a - b - c : pick(rng);
      const w = { experience: a, reliability: b, availability: c, declared: d };
      const got = weightIssues(w).map((x) => x.path);
      const want: string[] = [];
      [a, b, c, d].forEach((v, idx) => {
        if (v < 0.05 || v > 0.7) want.push(WEIGHT_KEYS[idx]!);
      });
      if (Math.abs(a + b + c + d - 1) > 1e-6) want.push('sum');
      expect(got, JSON.stringify(w)).toEqual(want);
      if (want.length === 0) valid += 1;
    }
    expect(valid).toBeGreaterThan(5);
    expect(valid).toBeLessThan(400);
  });
});

describe('weightIssues - bon khoa', () => {
  it('thieu Ho so -> bao dung truong "declared" (bo ba khoa kieu cu khong lot qua kiem tra bon khoa)', () => {
    expect(weightIssues(LEGACY_DEFAULT_WEIGHTS).map((i) => i.path)).toEqual(['declared']);
    expect(weightIssues({ ...LEGACY_DEFAULT_WEIGHTS, declared: 0.2 }).map((i) => i.path)).toEqual(['sum']);
    expect(weightIssues(W4(0.5, 0.2, 0.2, 0.1))).toEqual([]);
    expect(weightIssues(W4(0.05, 0.05, 0.2, 0.7))).toEqual([]);
  });

  it('thong bao: ten "ho so", tong noi "bon trong so"', () => {
    expect(weightIssues(W4(0.3, 0.3, 0.3, 0.04))[0]!.message).toContain('ho so');
    expect(weightIssues(W4(0.3, 0.3, 0.3, 0.3))[0]!.message).toBe('tong bon trong so phai bang 1 (hien la 1.2)');
  });
});

describe('sameWeights / isDefaultWeights (bon khoa) va ban ba khoa kieu cu', () => {
  const base = W4(0.36, 0.24, 0.2, 0.2);
  it('bang nhau trong sai so 1e-9, khac neu lech hon; xet TUNG thanh phan (ca Ho so); doi xung', () => {
    expect(sameWeights(base, { ...base })).toBe(true);
    expect(sameWeights(base, { ...base, experience: base.experience + 5e-10 })).toBe(true);
    expect(sameWeights({ ...base, experience: base.experience + 5e-10 }, base)).toBe(true);
    for (const k of WEIGHT_KEYS) {
      expect(sameWeights(base, { ...base, [k]: base[k] + 1e-8 }), k).toBe(false);
      expect(sameWeights({ ...base, [k]: base[k] - 1e-8 }, base), k).toBe(false);
    }
  });

  it('isDefaultWeights: dung mac dinh moi; bo cu (Ho so = 0) khong con la mac dinh', () => {
    expect(isDefaultWeights(DEFAULT_WEIGHTS)).toBe(true);
    expect(isDefaultWeights(W4(0.36, 0.24, 0.2, 0.2))).toBe(true);
    expect(isDefaultWeights(LEGACY_WEIGHTS_V1)).toBe(false);
    expect(isDefaultWeights(W4(0.36, 0.24, 0.25, 0.15))).toBe(false);
  });

  it('pinLegacy gan Ho so = 0 (ban moi); toLegacy cat ve dung ba khoa (bo khoa la)', () => {
    const b3: LegacyWeights = { experience: 0.5, reliability: 0.3, availability: 0.2 };
    const pinned = pinLegacy(b3);
    expect(pinned).toEqual({ experience: 0.5, reliability: 0.3, availability: 0.2, declared: 0 });
    expect(pinned).not.toBe(b3);
    expect(toLegacy(W4(0.4, 0.3, 0.1, 0.2))).toEqual({ experience: 0.4, reliability: 0.3, availability: 0.1 });
    expect(Object.keys(toLegacy({ ...b3, declared: 0.2, custom: true } as unknown as Weights))).toEqual([...LEGACY_KEYS]);
    expect(Object.keys(pinLegacy({ ...b3, custom: true } as unknown as LegacyWeights))).toEqual([...WEIGHT_KEYS]);
  });
});

// ---------- Phep chieu ----------

type Idx = 0 | 1 | 2;
const nearArr = (a: readonly number[], b: readonly number[], eps = 1e-12) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]!) <= eps);
const total = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

describe('projectOnto - phep chieu len {tong = khoi, moi so trong [0,05; 0,70]}', () => {
  it('cac ca biet truoc (tinh tay), khoi = 1, ba so', () => {
    const cases: [string, number[], number[]][] = [
      ['da hop le thi giu nguyen', [0.45, 0.3, 0.25], [0.45, 0.3, 0.25]],
      ['tran o mot so: (0,75; 0,30; 0) -> (0,70; 0,25; 0,05)', [0.75, 0.3, 0], [0.7, 0.25, 0.05]],
      ['tong 0,8, mot so o tran: (0,70; 0,05; 0,05) -> (0,70; 0,15; 0,15)', [0.7, 0.05, 0.05], [0.7, 0.15, 0.15]],
      ['tong dung 1 nhung vuot tran: (0,05; 0,05; 0,90) -> (0,15; 0,15; 0,70)', [0.05, 0.05, 0.9], [0.15, 0.15, 0.7]],
      ['ba so bang nhau lon: (2; 2; 2) -> moi so 1/3', [2, 2, 2], [1 / 3, 1 / 3, 1 / 3]],
      ['ba so bang nhau am: (-1; -1; -1) -> moi so 1/3', [-1, -1, -1], [1 / 3, 1 / 3, 1 / 3]],
      ['mot so rat lon: (5; 0; 0) -> (0,70; 0,15; 0,15)', [5, 0, 0], [0.7, 0.15, 0.15]],
    ];
    for (const [label, input, want] of cases) {
      const got = projectOnto(input, 1);
      expect(nearArr(got, want), `${label}: ${JSON.stringify(got)}`).toBe(true);
    }
  });

  it('khoi khac 1 va so phan tu khac 3 (tinh tay)', () => {
    // khoi 0,8: (0; 0,7; 0,1) -> tau = 0,025 -> (0,05; 0,675; 0,075)
    expect(nearArr(projectOnto([0, 0.7, 0.1], 0.8), [0.05, 0.675, 0.075])).toBe(true);
    // bon so, khoi 1: (0,55; 0,25; 0,15; 0,20) -> tau = 0,0375
    expect(nearArr(projectOnto([0.55, 0.25, 0.15, 0.2], 1), [0.5125, 0.2125, 0.1125, 0.1625])).toBe(true);
    // hai so, khoi 0,3: (1; 1) -> (0,15; 0,15)
    expect(nearArr(projectOnto([1, 1], 0.3), [0.15, 0.15])).toBe(true);
    // bien kha thi: khoi = n * MIN va n * MAX
    expect(nearArr(projectOnto([0.3, 0.9, -1], 3 * WEIGHT_MIN), [0.05, 0.05, 0.05])).toBe(true);
    expect(nearArr(projectOnto([0.3, 0.9, -1], 3 * WEIGHT_MAX), [0.7, 0.7, 0.7])).toBe(true);
  });

  it('TAI SAO khong "kep roi chuan hoa": cach do lam vo bat bien §14, phep chieu thi khong', () => {
    const v = [0.7, 0.05, 0.05];
    const clamp = (x: number) => Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, x));
    const clamped = v.map(clamp);
    const naive = clamped.map((x) => x / total(clamped));
    expect(naive[0]).toBeGreaterThan(WEIGHT_MAX); // 0,875: vuot tran
    expect(legacyWeightIssues(W(...(naive as [number, number, number]))).length).toBeGreaterThan(0);
    const good = projectOnto(v, 1);
    expect(legacyWeightIssues(W(...(good as [number, number, number])))).toEqual([]);
    expect(good[0]).toBeLessThanOrEqual(WEIGHT_MAX + 1e-12);
  });

  it('LUON hop le tren 3000 dau vao ngau nhien rong [-2; 3], 2-5 so, khoi kha thi bat ky: moi so trong khoang, tong = khoi sai so 1e-12', () => {
    const rng = new Rng(20260920);
    for (let i = 0; i < 3000; i += 1) {
      const n = 2 + rng.int(4);
      const v = Array.from({ length: n }, () => rng.range(-2, 3));
      const mass = i % 2 === 0 ? 1 : rng.range(n * WEIGHT_MIN, Math.min(1, n * WEIGHT_MAX));
      const p = projectOnto(v, mass);
      for (const x of p) {
        expect(x, JSON.stringify(v)).toBeGreaterThanOrEqual(WEIGHT_MIN - 1e-12);
        expect(x, JSON.stringify(v)).toBeLessThanOrEqual(WEIGHT_MAX + 1e-12);
      }
      expect(Math.abs(total(p) - mass), JSON.stringify({ v, mass })).toBeLessThan(1e-12);
    }
  });

  it('la diem hop le GAN NHAT (doi chieu vet can luoi buoc 0,005 tren 300 dau vao, khoi 1 va khoi 0,8) - khong chi la "mot diem hop le"', () => {
    for (const mass of [1, 0.8]) {
      const grid: number[][] = [];
      for (let a = 0.05; a <= 0.7 + 1e-9; a += 0.005) {
        for (let b = 0.05; b <= 0.7 + 1e-9; b += 0.005) {
          const c = mass - a - b;
          if (c >= WEIGHT_MIN - 1e-9 && c <= WEIGHT_MAX + 1e-9) grid.push([a, b, c]);
        }
      }
      expect(grid.length).toBeGreaterThan(2000);
      const dist2 = (p: readonly number[], q: readonly number[]) => p.reduce((s, x, i) => s + (x - q[i]!) ** 2, 0);
      const rng = new Rng(7);
      for (let i = 0; i < 300; i += 1) {
        const v = [rng.range(-0.5, 1.5), rng.range(-0.5, 1.5), rng.range(-0.5, 1.5)];
        const p = projectOnto(v, mass);
        const best = Math.min(...grid.map((g) => dist2(v, g)));
        expect(dist2(v, p), JSON.stringify({ v, mass })).toBeLessThanOrEqual(best + 1e-9);
      }
    }
  });

  it('luy dang (chieu hai lan = mot lan) va bat bien theo hoan vi', () => {
    const rng = new Rng(11);
    const perms: [Idx, Idx, Idx][] = [
      [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
    ];
    for (let i = 0; i < 300; i += 1) {
      const xs = [rng.range(-1, 2), rng.range(-1, 2), rng.range(-1, 2)];
      const mass = i % 2 === 0 ? 1 : 0.75;
      const p = projectOnto(xs, mass);
      expect(nearArr(projectOnto(p, mass), p), `luy dang ${xs}`).toBe(true);
      for (const perm of perms) {
        const q = projectOnto([xs[perm[0]]!, xs[perm[1]]!, xs[perm[2]]!], mass);
        expect(q.map((g, j) => Math.abs(g - p[perm[j]]!)).every((d) => d < 1e-12), `hoan vi ${perm} cua ${xs}`).toBe(true);
      }
    }
  });

  it('dau vao khong huu han, rong, hoac khoi khong dat duoc bi tu choi bang RangeError (khong tra so rac)', () => {
    for (const bad of [Number.NaN, Infinity, -Infinity]) {
      expect(() => projectOnto([bad, 0.3, 0.7], 1)).toThrow(/huu han/);
      expect(() => projectOnto([0.3, bad, 0.7], 1)).toThrow(/huu han/);
      expect(() => projectOnto([0.3, 0.7, bad], 1)).toThrow(/huu han/);
      expect(() => projectOnto([0.3, 0.3, 0.4], bad)).toThrow(/khong dat duoc/);
    }
    expect(() => projectOnto([0.3, undefined as unknown as number, 0.7], 1)).toThrow(/huu han/);
    expect(() => projectOnto([], 1)).toThrow(/it nhat mot/);
    // 3 so: khoi phai trong [0,15; 2,1]
    expect(() => projectOnto([0.3, 0.3, 0.4], 0.149)).toThrow(/khong dat duoc/);
    expect(() => projectOnto([0.3, 0.3, 0.4], 2.101)).toThrow(/khong dat duoc/);
    // 1 so: chi khoi trong [0,05; 0,7]
    expect(() => projectOnto([0.5], 1)).toThrow(/khong dat duoc/);
    expect(nearArr(projectOnto([0.9], 0.6), [0.6])).toBe(true);
  });
});

describe('projectWithin - chieu rieng mot nhom khoa, giu nguyen phan con lai', () => {
  it('ba khoa lich su voi Ho so co dinh: khoi = 1 - Ho so; Ho so khong doi tung bit', () => {
    const out = projectWithin(W4(0, 0.7, 0.1, 0.2), LEGACY_KEYS);
    expect(near(out, W4(0.05, 0.675, 0.075, 0.2))).toBe(true);
    expect(out.declared).toBe(0.2);
    // Ho so = 0: dung phep chieu ba so khoi 1 (y nhu truoc buoc 11)
    const legacy = projectWithin(W4(0.75, 0.3, 0, 0), LEGACY_KEYS);
    expect(near(legacy, W4(0.7, 0.25, 0.05, 0))).toBe(true);
  });

  it('ca bon khoa: tong 1, Ho so cung dich chuyen', () => {
    expect(near(projectWithin(W4(0.55, 0.25, 0.15, 0.2), WEIGHT_KEYS), W4(0.5125, 0.2125, 0.1125, 0.1625))).toBe(true);
  });

  it('thu tu khoa khong anh huong; tra ban MOI, khong sua dau vao, khong keo khoa la', () => {
    const input = { ...W4(0.9, 0.1, 0.1, 0.2), extra: 1 } as Weights;
    const before = JSON.stringify(input);
    const a = projectWithin(input, ['experience', 'reliability', 'availability']);
    const b = projectWithin(input, ['availability', 'experience', 'reliability']);
    expect(near(a, b)).toBe(true);
    expect(JSON.stringify(input)).toBe(before);
    expect(a).not.toBe(input);
    expect(Object.keys(a)).toEqual([...WEIGHT_KEYS]);
  });

  it('khoa trung, khoa ngoai nhom khong huu han, khoi khong dat duoc -> RangeError', () => {
    expect(() => projectWithin(W4(0.4, 0.3, 0.1, 0.2), ['experience', 'experience', 'reliability'])).toThrow(/trung lap/);
    expect(() => projectWithin(W4(0.4, 0.3, 0.1, Number.NaN), LEGACY_KEYS)).toThrow(/declared phai la so huu han/);
    // Ho so 0,9 -> khoi 0,1 < 3 x 0,05
    expect(() => projectWithin(W4(0.4, 0.3, 0.1, 0.9), LEGACY_KEYS)).toThrow(/khong dat duoc/);
  });
});

describe('upgradeLegacyWeights - nang cap bo ba trong so cu len bon khoa (§17.8)', () => {
  it('mac dinh cu -> DUNG mac dinh moi (isDefaultWeights), khong can nhanh rieng', () => {
    const up = upgradeLegacyWeights(LEGACY_DEFAULT_WEIGHTS);
    expect(isDefaultWeights(up)).toBe(true);
    // DUNG hang so (khong phai 0,36000000000000004): dong CSDL va giao dien hien so tron; ban moi, khong chia se doi tuong
    expect(up).toEqual(DEFAULT_WEIGHTS);
    expect(up).not.toBe(DEFAULT_WEIGHTS);
    // Bo gan mac dinh nhung KHAC hon sai so 1e-9 thi khong bi keo ve mac dinh
    const close = upgradeLegacyWeights({ experience: 0.45 + 1e-7, reliability: 0.3 - 1e-7, availability: 0.25 });
    expect(isDefaultWeights(close)).toBe(false);
  });

  it('bo da chinh: ((1 - d) e, (1 - d) r, (1 - d) a, d) khi con hop le; cham san thi chieu ca bo (tinh tay)', () => {
    expect(near(upgradeLegacyWeights({ experience: 0.5, reliability: 0.3, availability: 0.2 }), W4(0.4, 0.24, 0.16, 0.2))).toBe(true);
    // 0,05 x 0,8 = 0,04 < san: (0,56; 0,20; 0,04; 0,20) -> kep 0,05, ba so con lai tru deu 0,01/3
    const t = 0.01 / 3;
    expect(near(upgradeLegacyWeights({ experience: 0.7, reliability: 0.25, availability: 0.05 }), W4(0.56 - t, 0.2 - t, 0.05, 0.2 - t))).toBe(true);
    // d khac mac dinh
    expect(near(upgradeLegacyWeights({ experience: 0.5, reliability: 0.3, availability: 0.2 }, 0.1), W4(0.45, 0.27, 0.18, 0.1))).toBe(true);
  });

  it('MOI bo ba hop le cu (2000 bo ngau nhien + moi goc bien 0,05 / 0,70) -> bo bon hop le; giu thu tu cua ba thanh phan lich su', () => {
    const rng = new Rng(2026);
    const olds: LegacyWeights[] = [
      { experience: 0.7, reliability: 0.25, availability: 0.05 },
      { experience: 0.05, reliability: 0.25, availability: 0.7 },
      { experience: 0.25, reliability: 0.05, availability: 0.7 },
      { experience: 0.7, reliability: 0.05, availability: 0.25 },
      { experience: 0.05, reliability: 0.7, availability: 0.25 },
      { experience: 0.25, reliability: 0.7, availability: 0.05 },
    ];
    while (olds.length < 2006) {
      const [e, r] = [rng.range(0.05, 0.7), rng.range(0.05, 0.7)];
      const a = 1 - e - r;
      if (a >= 0.05 && a <= 0.7) olds.push({ experience: e, reliability: r, availability: a });
    }
    for (const w of olds) {
      expect(legacyWeightIssues(w)).toEqual([]);
      for (const d of [WEIGHT_MIN, DEFAULT_DECLARED_WEIGHT, 0.4, WEIGHT_MAX]) {
        const up = upgradeLegacyWeights(w, d);
        expect(weightIssues(up), JSON.stringify({ w, d, up })).toEqual([]);
        expect(Math.abs(sum4(up) - 1)).toBeLessThan(1e-12);
        // Phep chieu tru deu roi kep -> khong dao thu tu hai thanh phan lich su
        for (const x of LEGACY_KEYS) {
          for (const y of LEGACY_KEYS) {
            if (w[x] > w[y] + 1e-12) expect(up[x], JSON.stringify({ w, d })).toBeGreaterThanOrEqual(up[y]);
          }
        }
      }
    }
  });

  it('bo cu khong hop le hoac d ngoai [0,05; 0,70] -> RangeError (dich vu kiem truoc; ham khong am tham sua)', () => {
    expect(() => upgradeLegacyWeights({ experience: 0.3, reliability: 0.3, availability: 0.3 })).toThrow(/khong hop le.*tong ba/);
    expect(() => upgradeLegacyWeights({ experience: 0.9, reliability: 0.05, availability: 0.05 })).toThrow(/khong hop le/);
    for (const d of [0, 0.049, 0.701, 1, Number.NaN, Infinity]) {
      expect(() => upgradeLegacyWeights(LEGACY_DEFAULT_WEIGHTS, d), String(d)).toThrow(/d phai nam trong/);
    }
    // Bien d dung san / tran van duoc
    expect(upgradeLegacyWeights(LEGACY_DEFAULT_WEIGHTS, 0.05).declared).toBeCloseTo(0.05, 12);
    expect(upgradeLegacyWeights(LEGACY_DEFAULT_WEIGHTS, 0.7).declared).toBeCloseTo(0.7, 12);
  });
});
