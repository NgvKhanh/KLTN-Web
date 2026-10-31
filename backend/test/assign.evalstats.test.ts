// Buoc 7a - thong ke cua bo danh gia (evalAssignStats.ts). THUAN: khong cham CSDL.
// (setup.ts van TRUNCATE truoc moi `it`.)
import { describe, expect, it } from 'vitest';
import {
  bootstrapMeanCI,
  comparePaired,
  gini,
  maxShare,
  mean,
  quantile,
  sd,
  streamSeed,
  summarizeSeeds,
} from '../src/scripts/evalAssignStats';
import { Rng } from '../src/scripts/simGenerator';

const corr = (x: number[], y: number[]) => {
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i += 1) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
};

describe('mean / sd / quantile', () => {
  it('trung binh va do lech chuan MAU (n - 1) theo so tinh tay', () => {
    expect(mean([1, 2, 3])).toBe(2);
    expect(mean([-1.5, 1.5])).toBe(0);
    // Vi du kinh dien: tong binh phuong lech = 32, chia n - 1 = 7
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(sd([5, 5, 5])).toBe(0);
  });

  it('quantile noi suy tuyen tinh: so tinh tay', () => {
    const xs = [1, 2, 3, 4];
    expect(quantile(xs, 0)).toBe(1);
    expect(quantile(xs, 1)).toBe(4);
    expect(quantile(xs, 0.5)).toBe(2.5);
    expect(quantile(xs, 0.25)).toBeCloseTo(1.75, 12);
    expect(quantile(xs, 0.95)).toBeCloseTo(3.85, 12);
    expect(quantile([7], 0.3)).toBe(7);
  });

  it('dau vao khong hop le bi tu choi (khong tra ve NaN am tham)', () => {
    expect(() => mean([])).toThrow(RangeError);
    expect(() => mean([1, Number.NaN])).toThrow(RangeError);
    expect(() => mean([1, Infinity])).toThrow(RangeError);
    expect(() => sd([1])).toThrow(RangeError);
    expect(() => quantile([], 0.5)).toThrow(RangeError);
    expect(() => quantile([1, 2], -0.1)).toThrow(RangeError);
    expect(() => quantile([1, 2], 1.1)).toThrow(RangeError);
    expect(() => quantile([1, 2], Number.NaN)).toThrow(RangeError);
  });
});

describe('gini / maxShare', () => {
  it('so tinh tay', () => {
    expect(gini([0, 0, 0, 10])).toBeCloseTo(0.75, 12); // mot nguoi nhan het: (n - 1) / n
    expect(gini([1, 1, 1, 1])).toBe(0);
    expect(gini([1, 2, 3, 4])).toBeCloseTo(0.25, 12); // 2 * 30 / (4 * 10) - 5 / 4
    expect(gini([5])).toBe(0);
    expect(gini([0, 0])).toBe(0); // khong ai nhan gi = chia deu
    expect(gini([3, 0])).toBeCloseTo(0.5, 12);
    expect(maxShare([1, 1, 2])).toBe(0.5);
    expect(maxShare([4])).toBe(1);
    expect(maxShare([0, 0, 0])).toBe(0);
  });

  it('tinh chat: khong doi khi hoan vi / doi thang, nam trong [0, (n-1)/n], dat can khi mot nguoi nhan het (200 ca ngau nhien)', () => {
    const rng = new Rng(4242);
    for (let t = 0; t < 200; t += 1) {
      const n = 2 + rng.int(9);
      const xs = Array.from({ length: n }, () => rng.int(20));
      const g = gini(xs);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual((n - 1) / n + 1e-12);
      const shuffled = [...xs].reverse();
      expect(gini(shuffled)).toBeCloseTo(g, 12);
      expect(gini(xs.map((x) => x * 7))).toBeCloseTo(g, 12);
      // Dua thanh mot nguoi nhan het -> cham can tren
      const hoarded = xs.map((_, i) => (i === 0 ? 50 : 0));
      expect(gini(hoarded)).toBeCloseTo((n - 1) / n, 12);
      const ms = maxShare(xs);
      expect(ms).toBeGreaterThanOrEqual(1 / n - 1e-12);
      expect(ms).toBeLessThanOrEqual(1);
    }
  });

  it('chuyen viec tu nguoi it sang nguoi nhieu chi lam Gini TANG (nguyen ly Pigou-Dalton)', () => {
    expect(gini([2, 6, 10])).toBeGreaterThan(gini([3, 6, 9]));
    expect(gini([3, 6, 9])).toBeGreaterThan(gini([4, 6, 8]));
  });

  it('dau vao khong hop le bi tu choi', () => {
    expect(() => gini([])).toThrow(RangeError);
    expect(() => gini([1, -1])).toThrow(RangeError);
    expect(() => gini([1, Number.NaN])).toThrow(RangeError);
    expect(() => maxShare([])).toThrow(RangeError);
    expect(() => maxShare([-1, 2])).toThrow(RangeError);
  });
});

describe('streamSeed - luong ngau nhien rieng cho tung the', () => {
  it('tat dinh; khac nhau theo hat giong, chi so va muc dich; khong trung tren 2000 chi so', () => {
    expect(streamSeed(20260920, 5, 1)).toBe(streamSeed(20260920, 5, 1));
    expect(streamSeed(20260920, 5, 1)).not.toBe(streamSeed(20260921, 5, 1));
    expect(streamSeed(20260920, 5, 1)).not.toBe(streamSeed(20260920, 6, 1));
    expect(streamSeed(20260920, 5, 1)).not.toBe(streamSeed(20260920, 5, 2));
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) seen.add(streamSeed(20260920, i, 1));
    expect(seen.size).toBe(2000);
    for (const v of seen) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });

  it('CHONG LOI DA DO: gieo LCG bang so nguyen KE NHAU thi gia tri dau tuong quan ~0,998; sau khi tron bit phai gan 0', () => {
    const n = 2000;
    // Cach ngay tho (khong tron bit) - de chung minh phep do nay THAT SU nhay voi loi
    const raw = Array.from({ length: n }, (_, i) => new Rng(1000 + i).next());
    const rawNext = Array.from({ length: n }, (_, i) => new Rng(1001 + i).next());
    expect(corr(raw, rawNext)).toBeGreaterThan(0.99);

    const first = (i: number, salt: number) => new Rng(streamSeed(20260920, i, salt)).next();
    const a = Array.from({ length: n }, (_, i) => first(i, 1));
    const b = Array.from({ length: n }, (_, i) => first(i + 1, 1));
    expect(Math.abs(corr(a, b))).toBeLessThan(0.06); // the ke nhau
    const c = Array.from({ length: n }, (_, i) => first(i, 2));
    expect(Math.abs(corr(a, c))).toBeLessThan(0.06); // hai muc dich tren cung mot the
    // Va phan bo dieu: trung binh ~0,5
    expect(mean(a)).toBeGreaterThan(0.47);
    expect(mean(a)).toBeLessThan(0.53);
  });

  it('lan truyen tot (tieu chi SAC): lat MOT bit dau vao thi trung binh ~16/32 bit dau ra doi, o ca ba dau vao', () => {
    // Phat hien khi cai loi: bo MOT trong hai vong tron cuoi van dat do tuong quan ke nhau (~0,01) nhung lan truyen cua bit hat
    // giong lech ro (toi 18,45 va 19,31 thay vi 15,9-16,1) - nen phai do dung tieu chi nay, khong chi do tuong quan.
    const rng = new Rng(777);
    const popcount = (x: number) => {
      let c = 0;
      let v = x >>> 0;
      while (v) {
        c += v & 1;
        v >>>= 1;
      }
      return c;
    };
    const cases: { name: string; bits: number; flip: (a: number[], b: number) => number[] }[] = [
      { name: 'seed', bits: 32, flip: (a, b) => [(a[0]! ^ (1 << b)) >>> 0, a[1]!, a[2]!] },
      { name: 'index', bits: 11, flip: (a, b) => [a[0]!, a[1]! ^ (1 << b), a[2]!] },
      { name: 'salt', bits: 2, flip: (a, b) => [a[0]!, a[1]!, a[2]! ^ (1 << b)] },
    ];
    const trials = 1500;
    for (const c of cases) {
      for (let b = 0; b < c.bits; b += 1) {
        let flipped = 0;
        for (let t = 0; t < trials; t += 1) {
          const a = [rng.int(2 ** 31) * 2 + rng.int(2), rng.int(2048), rng.int(4)];
          const f = c.flip(a, b);
          flipped += popcount(streamSeed(a[0]!, a[1]!, a[2]!) ^ streamSeed(f[0]!, f[1]!, f[2]!));
        }
        const mean = flipped / trials;
        expect(mean, `${c.name} bit ${b}`).toBeGreaterThan(15.4);
        expect(mean, `${c.name} bit ${b}`).toBeLessThan(16.6);
      }
    }
  });

  it('tham so sai bi tu choi', () => {
    expect(() => streamSeed(-1, 0, 0)).toThrow(RangeError);
    expect(() => streamSeed(1, 1.5, 0)).toThrow(RangeError);
    expect(() => streamSeed(1, 0, -3)).toThrow(RangeError);
    expect(() => streamSeed(1, 0, Number.NaN)).toThrow(RangeError);
  });
});

describe('bootstrapMeanCI', () => {
  const sample = Array.from({ length: 20 }, (_, i) => i / 19); // deu tren [0,1], sd ~0,304

  it('tat dinh: cung du lieu + cung hat giong = cung khoang; doi hat giong thi khoang doi nhe', () => {
    const a = bootstrapMeanCI(sample, { resamples: 2000, seed: 7 });
    const b = bootstrapMeanCI(sample, { resamples: 2000, seed: 7 });
    expect(a).toEqual(b);
    const c = bootstrapMeanCI(sample, { resamples: 2000, seed: 8 });
    expect(c.lo).not.toBe(a.lo);
    expect(Math.abs(c.lo - a.lo)).toBeLessThan(0.03);
  });

  it('trung binh nam trong khoang; khoang co do rong ~ 2 x 1,96 x sd / sqrt(n)', () => {
    const ci = bootstrapMeanCI(sample);
    expect(ci.mean).toBeCloseTo(0.5, 12);
    expect(ci.lo).toBeLessThan(ci.mean);
    expect(ci.hi).toBeGreaterThan(ci.mean);
    const expected = 2 * 1.96 * (sd(sample) / Math.sqrt(sample.length));
    expect(ci.hi - ci.lo).toBeGreaterThan(expected * 0.85);
    expect(ci.hi - ci.lo).toBeLessThan(expected * 1.15);
  });

  it('du lieu hang so -> khoang co do rong 0; du lieu doi xung quanh 0 -> khoang chua 0', () => {
    const flat = bootstrapMeanCI([0.4, 0.4, 0.4, 0.4, 0.4]);
    expect(flat).toEqual({ mean: 0.4, lo: 0.4, hi: 0.4 });
    const sym = bootstrapMeanCI([-2, -1, 0, 1, 2, -3, 3, -0.5, 0.5, 0]);
    expect(sym.lo).toBeLessThan(0);
    expect(sym.hi).toBeGreaterThan(0);
  });

  it('do phu thuc te (300 mau n = 20 tu phan bo deu, trung binh that 0,5): khoang 95% chua trung binh that 88-99% so lan', () => {
    const rng = new Rng(99);
    let covered = 0;
    const trials = 300;
    for (let t = 0; t < trials; t += 1) {
      const xs = Array.from({ length: 20 }, () => rng.next());
      const ci = bootstrapMeanCI(xs, { resamples: 400, seed: t });
      if (ci.lo <= 0.5 && 0.5 <= ci.hi) covered += 1;
    }
    expect(covered / trials).toBeGreaterThan(0.88);
    expect(covered / trials).toBeLessThan(0.99);
  });

  it('lay mau lai co the chon PHAN TU DAU va PHAN TU CUOI: ngoai lai o hai dau day deu keo can tren len', () => {
    // 9 so 0 va mot so 10: trung binh 1; trung binh lay lai = 10 * k / 10 voi k ~ Nhi thuc(10; 0,1) -> can tren 97,5% ~ 3
    const lastOut = [0, 0, 0, 0, 0, 0, 0, 0, 0, 10];
    const firstOut = [10, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const xs of [lastOut, firstOut]) {
      const ci = bootstrapMeanCI(xs, { resamples: 2000 });
      expect(ci.mean).toBeCloseTo(1, 12);
      expect(ci.lo).toBe(0);
      expect(ci.hi).toBeGreaterThan(2.4);
      expect(ci.hi).toBeLessThan(3.6);
    }
  });

  it('khoang 90% hep hon khoang 99%', () => {
    const c90 = bootstrapMeanCI(sample, { level: 0.9, resamples: 3000 });
    const c99 = bootstrapMeanCI(sample, { level: 0.99, resamples: 3000 });
    expect(c90.hi - c90.lo).toBeLessThan(c99.hi - c99.lo);
  });

  it('tham so sai bi tu choi', () => {
    expect(() => bootstrapMeanCI([1])).toThrow(RangeError);
    expect(() => bootstrapMeanCI([1, Number.NaN])).toThrow(RangeError);
    expect(() => bootstrapMeanCI(sample, { resamples: 99 })).toThrow(RangeError);
    expect(() => bootstrapMeanCI(sample, { resamples: 100.5 })).toThrow(RangeError);
    expect(() => bootstrapMeanCI(sample, { level: 0 })).toThrow(RangeError);
    expect(() => bootstrapMeanCI(sample, { level: 1 })).toThrow(RangeError);
    expect(() => bootstrapMeanCI(sample, { seed: -1 })).toThrow(RangeError);
  });
});

describe('comparePaired / summarizeSeeds', () => {
  it('so tinh tay: chenh lech, dem hat giong duong / am / bang', () => {
    const p = comparePaired([2, 3, 4, 5, 1], [1, 1, 1, 1, 1], { resamples: 500 });
    expect(p.n).toBe(5);
    expect(p.mean).toBeCloseTo(2, 12); // (1 + 2 + 3 + 4 + 0) / 5
    expect(p.positive).toBe(4);
    expect(p.negative).toBe(0);
    expect(p.ties).toBe(1);
    expect(p.lo).toBeLessThanOrEqual(p.mean);
    expect(p.hi).toBeGreaterThanOrEqual(p.mean);

    const q = comparePaired([1, 5, 3], [2, 2, 3], { resamples: 500 });
    expect(q.positive).toBe(1);
    expect(q.negative).toBe(1);
    expect(q.ties).toBe(1);
    expect(q.mean).toBeCloseTo(2 / 3, 12);
  });

  it('a va b giong het nhau -> chenh lech 0, khoang [0, 0]', () => {
    const xs = [0.3, 0.5, 0.7, 0.9];
    const p = comparePaired(xs, xs, { resamples: 500 });
    expect(p).toMatchObject({ mean: 0, lo: 0, hi: 0, positive: 0, negative: 0, ties: 4 });
  });

  it('phep dao a - b: doi cho thi doi dau va doi xung khoang', () => {
    const a = [0.5, 0.6, 0.4, 0.7, 0.55, 0.62];
    const b = [0.45, 0.5, 0.5, 0.6, 0.5, 0.5];
    const ab = comparePaired(a, b, { resamples: 1000, seed: 3 });
    const ba = comparePaired(b, a, { resamples: 1000, seed: 3 });
    expect(ba.mean).toBeCloseTo(-ab.mean, 12);
    expect(ba.positive).toBe(ab.negative);
    expect(ba.negative).toBe(ab.positive);
    // Cung hat giong -> cung cac lan lay mau -> khoang doi xung
    expect(ba.lo).toBeCloseTo(-ab.hi, 12);
    expect(ba.hi).toBeCloseTo(-ab.lo, 12);
  });

  it('khac do dai / thieu du lieu bi tu choi', () => {
    expect(() => comparePaired([1, 2], [1, 2, 3])).toThrow(RangeError);
    expect(() => comparePaired([1], [1])).toThrow(RangeError);
  });

  it('summarizeSeeds: n, trung binh, do lech chuan, khoang', () => {
    const xs = [0.2, 0.4, 0.6, 0.8];
    const s = summarizeSeeds(xs, { resamples: 500 });
    expect(s.n).toBe(4);
    expect(s.mean).toBeCloseTo(0.5, 12);
    expect(s.sd).toBeCloseTo(sd(xs), 12);
    expect(s.lo).toBeLessThan(s.mean);
    expect(s.hi).toBeGreaterThan(s.mean);
  });
});
