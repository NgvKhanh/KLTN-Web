import { describe, expect, it } from 'vitest';
import {
  LEGACY_KEYS,
  WEIGHT_KEYS,
  WEIGHT_MAX_PCT,
  WEIGHT_MIN_PCT,
  fromPct,
  historyPct,
  pctSum,
  rebalance,
  samePct,
  toPct,
  type WeightsPct,
} from './assignWeights';

const P = (experience: number, reliability: number, availability: number, declared: number): WeightsPct => ({
  experience,
  reliability,
  availability,
  declared,
});
const W = (experience: number, reliability: number, availability: number, declared: number) => ({ experience, reliability, availability, declared });

/** Mot bo phan tram hop le: tong 100, moi so trong [5; 70]. */
function valid(p: WeightsPct): boolean {
  return pctSum(p) === 100 && WEIGHT_KEYS.every((k) => Number.isInteger(p[k]) && p[k] >= WEIGHT_MIN_PCT && p[k] <= WEIGHT_MAX_PCT);
}

// Bo sinh so ngau nhien tat dinh (LCG) - khong dung Math.random de test lap lai duoc
function lcg(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)) };
}

const ALL_VALID: WeightsPct[] = [];
for (let a = WEIGHT_MIN_PCT; a <= WEIGHT_MAX_PCT; a += 1) {
  for (let b = WEIGHT_MIN_PCT; b <= WEIGHT_MAX_PCT; b += 1) {
    for (let c = WEIGHT_MIN_PCT; c <= WEIGHT_MAX_PCT; c += 1) {
      const d = 100 - a - b - c;
      if (d >= WEIGHT_MIN_PCT && d <= WEIGHT_MAX_PCT) ALL_VALID.push(P(a, b, c, d));
    }
  }
}

const DEFAULT = P(36, 24, 20, 20);

describe('hang so', () => {
  it('khop luat cua may chu: moi thanh trong [5%; 70%], bon thanh cong lai 100%; ba khoa lich su', () => {
    expect(WEIGHT_MIN_PCT).toBe(5);
    expect(WEIGHT_MAX_PCT).toBe(70);
    expect([...WEIGHT_KEYS]).toEqual(['experience', 'reliability', 'availability', 'declared']);
    expect([...LEGACY_KEYS]).toEqual(['experience', 'reliability', 'availability']);
    // So bo 4 so nguyen trong [5; 70] tong 100 = C(83,3) - 4*C(17,3) = 91881 - 2720
    expect(ALL_VALID.length).toBe(89161);
  });
});

describe('toPct - trong so may chu (so thuc) -> phan tram nguyen, tong 100', () => {
  it('bo mac dinh 0,36 / 0,24 / 0,20 / 0,20 -> 36 / 24 / 20 / 20; bo cu (Ho so san 0,05) giu nguyen', () => {
    expect(toPct(W(0.36, 0.24, 0.2, 0.2))).toEqual(DEFAULT);
    expect(toPct(W(0.4, 0.3, 0.25, 0.05))).toEqual(P(40, 30, 25, 5));
  });

  it('trong so DA HOC thuong le: phuong phap phan du lon nhat (30,6 / 24,45 / 25,3 / 19,65 -> 31 / 24 / 25 / 20)', () => {
    // floors 30/24/25/19 = 98; phan du .6, .45, .3, .65 -> hai phan du lon nhat (.65 Ho so, .6 kinh nghiem) moi +1
    expect(toPct(W(0.306, 0.2445, 0.253, 0.1965))).toEqual(P(31, 24, 25, 20));
  });

  it('cham bien: (0,70; 0,15; 0,10; 0,05) giu nguyen; sai so 1e-12 khong lam roi xuong 4%', () => {
    expect(toPct(W(0.7, 0.15, 0.1, 0.05))).toEqual(P(70, 15, 10, 5));
    expect(toPct(W(0.7, 0.15, 0.1, 0.05 - 1e-12))).toEqual(P(70, 15, 10, 5));
  });

  it('dau vao bat thuong van cho bo hop le: tong khac 1 duoc quy ve 100; toan 0 / NaN chia deu (25 x 4)', () => {
    expect(toPct(W(0.5, 0.5, 0.5, 0.5))).toEqual(P(25, 25, 25, 25));
    expect(toPct(W(0, 0, 0, 0))).toEqual(P(25, 25, 25, 25));
    expect(toPct(W(Number.NaN, 0.3, 0.3, 0.3))).toEqual(P(25, 25, 25, 25));
    expect(valid(toPct(W(3, 1, 1, 1)))).toBe(true);
    expect(valid(toPct(W(1, 0, 0, 0)))).toBe(true);
  });

  it('VONG TRON chinh xac cho MOI bo hop le (moi so 5..70, tong 100): toPct(fromPct(p)) = p', () => {
    for (const p of ALL_VALID) {
      const back = toPct(fromPct(p));
      if (!samePct(back, p)) expect(back, JSON.stringify(p)).toEqual(p);
    }
  });

  it('luon ra bo hop le tren 3000 bo thuc ngau nhien nam trong khoang cua may chu', () => {
    const r = lcg(20260928);
    for (let i = 0; i < 3000; i += 1) {
      const base = ALL_VALID[r.int(0, ALL_VALID.length - 1)]!;
      // Nhieu nho quanh mot bo hop le (nhu ket qua hoc: le nhung van trong khoang, tong ~ 1)
      const w = W(
        base.experience / 100 + (r.next() - 0.5) * 0.004,
        base.reliability / 100 + (r.next() - 0.5) * 0.004,
        base.availability / 100 + (r.next() - 0.5) * 0.004,
        base.declared / 100 + (r.next() - 0.5) * 0.004
      );
      const p = toPct(w);
      expect(valid(p), JSON.stringify({ w, p })).toBe(true);
    }
  });
});

describe('historyPct - moc lich su (co / khong co Ho so)', () => {
  it('du bon khoa -> nhu toPct', () => {
    expect(historyPct(W(0.36, 0.24, 0.2, 0.2))).toEqual(DEFAULT);
    expect(historyPct(W(0.306, 0.2445, 0.253, 0.1965))).toEqual(toPct(W(0.306, 0.2445, 0.253, 0.1965)));
  });

  it('moc TRUOC buoc 16 (Ho so null) -> chi ba khoa lich su, tong 100, KHONG kep va khong bia so Ho so', () => {
    const h = historyPct({ experience: 0.45, reliability: 0.3, availability: 0.25, declared: null });
    expect(h).toEqual({ experience: 45, reliability: 30, availability: 25 });
    expect('declared' in h).toBe(false);
    // Da hoc: 38,33 / 30,11 / 31,56 -> 38 / 30 / 32 (phan du lon nhat)
    expect(historyPct({ experience: 0.38333, reliability: 0.30111, availability: 0.31556, declared: null })).toEqual({
      experience: 38,
      reliability: 30,
      availability: 32,
    });
    // Khong kep ve [5; 70] (moc cu la so da luu, khong phai bo se gui len)
    expect(historyPct({ experience: 0.72, reliability: 0.26, availability: 0.02, declared: null })).toEqual({
      experience: 72,
      reliability: 26,
      availability: 2,
    });
  });
});

describe('rebalance - keo mot thanh, CAC thanh con lai chia phan du theo ti le', () => {
  it('cac ca tinh tay (tu mac dinh 36 / 24 / 20 / 20)', () => {
    // Con lai 40 chia 24 : 20 : 20 -> 15 / 12,5 / 12,5 -> hoa phan du -> khoa dung truoc (kha dung) nhan +1
    expect(rebalance(DEFAULT, 'experience', 60)).toEqual(P(60, 15, 13, 12));
    // Keo xuong san: con lai 95 -> 35,625 / 29,6875 / 29,6875 -> 35 / 30 / 30
    expect(rebalance(DEFAULT, 'experience', 5)).toEqual(P(5, 35, 30, 30));
    // Keo len tran: con lai 30 -> 11,25 / 9,375 / 9,375 -> 11 / 10 / 9
    expect(rebalance(DEFAULT, 'experience', 70)).toEqual(P(70, 11, 10, 9));
    // Thanh Ho so 20 -> 40: con lai 60 chia 36 : 24 : 20 -> 27 / 18 / 15
    expect(rebalance(DEFAULT, 'declared', 40)).toEqual(P(27, 18, 15, 40));
  });

  it('kep o SAN: thanh nho nhan 5, phan con lai chia lai cho cac thanh khac theo ti le', () => {
    // (5, 70, 20, 5), kinh nghiem -> 30: con lai 70; chia thang 70 : 20 : 5 cho Ho so 3,7 < 5 -> Ho so = 5, 65 chia 70 : 20
    // -> 50,56 / 14,44 -> 51 / 14
    expect(rebalance(P(5, 70, 20, 5), 'experience', 30)).toEqual(P(30, 51, 14, 5));
  });

  it('kep o TRAN: thanh lon nhan 70, phan con lai chia lai cho cac thanh khac theo ti le', () => {
    // (20, 65, 10, 5), kinh nghiem -> 5: con lai 95; chia thang 65 : 10 : 5 cho tin cay 77,2 > 70 -> 70, 25 chia 10 : 5
    // -> 16,67 / 8,33 -> 17 / 8
    expect(rebalance(P(20, 65, 10, 5), 'experience', 5)).toEqual(P(5, 70, 17, 8));
  });

  it('gia tri keo bi kep va lam tron: 3 -> 5, 90 -> 70, 60,4 -> 60, 60,6 -> 61; khong phai so thi giu nguyen (khong sinh NaN)', () => {
    expect(rebalance(DEFAULT, 'experience', 3).experience).toBe(5);
    expect(rebalance(DEFAULT, 'experience', 90).experience).toBe(70);
    expect(rebalance(DEFAULT, 'experience', 60.4).experience).toBe(60);
    expect(rebalance(DEFAULT, 'experience', 60.6).experience).toBe(61);
    expect(rebalance(DEFAULT, 'experience', -50).experience).toBe(5);
    for (const bad of [Number.NaN, Infinity, -Infinity]) expect(rebalance(DEFAULT, 'experience', bad), String(bad)).toEqual(DEFAULT);
  });

  it('cac thanh con lai bang 0 (du lieu bat thuong) -> coi nhu 5, chia deu; ket qua van hop le', () => {
    expect(rebalance(P(100, 0, 0, 0), 'experience', 40)).toEqual(P(40, 20, 20, 20));
    const r = rebalance(P(60, 40, 0, 0), 'experience', 50);
    expect(valid(r)).toBe(true);
    // 50 chia 40 : 5 : 5 -> 40 / 5 / 5
    expect(r).toEqual(P(50, 40, 5, 5));
    // Co so (60; 0; 0), can chia 95: neu KHONG nang 0 len 5 thi hai thanh 0 dung o 5, thanh kia kep 70 -> tong 80, phan du 15 bi rai
    // deu -> 75% (vuot tran). Nang len 5: 70 + 12,5 + 12,5
    const big = rebalance(P(40, 60, 0, 0), 'experience', 5);
    expect(big).toEqual(P(5, 70, 13, 12));
    expect(valid(big)).toBe(true);
  });

  it('KHONG lam thay doi neu keo ve dung gia tri hien tai (moi bo hop le thu 7, moi thanh)', () => {
    for (let i = 0; i < ALL_VALID.length; i += 7) {
      const p = ALL_VALID[i]!;
      for (const k of WEIGHT_KEYS) {
        const out = rebalance(p, k, p[k]);
        if (!samePct(out, p)) expect(out, `${JSON.stringify(p)} ${k}`).toEqual(p);
      }
    }
  });

  it('luon ra bo hop le, thanh dang keo dung bang gia tri (da kep), 5000 tinh huong ngau nhien (ke ca gia tri ngoai [5; 70])', () => {
    const r = lcg(7);
    for (let i = 0; i < 5000; i += 1) {
      const cur = ALL_VALID[r.int(0, ALL_VALID.length - 1)]!;
      const key = WEIGHT_KEYS[r.int(0, 3)]!;
      const value = r.int(-20, 120) + r.next();
      const out = rebalance(cur, key, value);
      expect(valid(out), JSON.stringify({ cur, key, value, out })).toBe(true);
      expect(out[key], JSON.stringify({ cur, key, value })).toBe(Math.min(70, Math.max(5, Math.round(value))));
    }
  });

  it('ti le cac thanh con lai duoc giu gan dung (lech toi da 1 diem %) khi khong thanh nao cham bien', () => {
    const r = lcg(11);
    let checked = 0;
    for (let n = 0; n < 3000; n += 1) {
      const cur = ALL_VALID[r.int(0, ALL_VALID.length - 1)]!;
      const key = WEIGHT_KEYS[r.int(0, 3)]!;
      const out = rebalance(cur, key, r.int(5, 70));
      const others = WEIGHT_KEYS.filter((k) => k !== key);
      if (others.some((k) => out[k] === WEIGHT_MIN_PCT || out[k] === WEIGHT_MAX_PCT)) continue;
      const base = others.reduce((s, k) => s + cur[k], 0);
      for (const k of others) {
        const expectK = ((100 - out[key]) * cur[k]) / base;
        expect(Math.abs(out[k] - expectK), JSON.stringify({ cur, key, out })).toBeLessThan(1);
      }
      checked += 1;
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe('fromPct / pctSum / samePct', () => {
  it('fromPct chia 100; bon so cong lai 1 sai so 1e-12 (may chu chap nhan 1e-6)', () => {
    expect(fromPct(DEFAULT)).toEqual(W(0.36, 0.24, 0.2, 0.2));
    for (let i = 0; i < ALL_VALID.length; i += 97) {
      const f = fromPct(ALL_VALID[i]!);
      expect(Math.abs(f.experience + f.reliability + f.availability + f.declared - 1)).toBeLessThan(1e-12);
    }
  });

  it('pctSum, samePct', () => {
    expect(pctSum(DEFAULT)).toBe(100);
    expect(pctSum(P(1, 2, 3, 4))).toBe(10);
    expect(samePct(DEFAULT, P(36, 24, 20, 20))).toBe(true);
    for (const k of WEIGHT_KEYS) expect(samePct(DEFAULT, { ...DEFAULT, [k]: 21 } as WeightsPct)).toBe(false);
  });
});
