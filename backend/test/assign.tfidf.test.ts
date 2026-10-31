// Buoc 3 - TF-IDF va cosine (assign.tfidf.ts). HAM THUAN: khong cham CSDL.
// Doi chieu voi cong thuc trong ASSIGN_MODULE.md §5.2, kem "oracle" doc lap (tinh cosine tren vec-to
// CHUA chuan hoa) de bat sai sot chuan hoa.
import { describe, expect, it } from 'vitest';
import { buildIdf, cosine, idfOf, vectorize, type SparseVector } from '../src/modules/assign/assign.tfidf';

const m = (o: Record<string, number>) => new Map(Object.entries(o));

function freezeDeep<T>(v: T): T {
  if (v instanceof Map) {
    for (const [k, x] of v) freezeDeep(k), freezeDeep(x);
    // Map dong bang van sua duoc qua .set(); thay cac phuong thuc ghi de neu ma nao goi se nem loi
    const boom = () => {
      throw new TypeError('sua Map dau vao');
    };
    Object.assign(v, { set: boom, delete: boom, clear: boom });
  } else if (v && typeof v === 'object') {
    Object.freeze(v);
    for (const x of Object.values(v as object)) freezeDeep(x);
  }
  return v;
}

const norm = (v: SparseVector) => Math.sqrt([...v.values()].reduce((a, b) => a + b * b, 0));

describe('Buoc 3 - IDF', () => {
  it('dung cong thuc ln((N+1)/(df+1))+1; df dem SU CO MAT, the rong van tinh vao N; tu la co idf lon nhat', () => {
    const idf = buildIdf([m({ a: 1, b: 2 }), m({ a: 5 }), m({})]);
    expect(idf.docCount).toBe(3);
    expect(idf.df.get('a')).toBe(2);
    expect(idf.df.get('b')).toBe(1); // xuat hien 2 lan trong 1 the van la df = 1
    expect(idfOf(idf, 'a')).toBeCloseTo(Math.log(4 / 3) + 1, 12);
    expect(idfOf(idf, 'b')).toBeCloseTo(Math.log(4 / 2) + 1, 12);
    expect(idfOf(idf, 'chua-tung-thay')).toBeCloseTo(Math.log(4 / 1) + 1, 12);

    // Giam dan theo df, tu la (df = 0) lon nhat, tat ca >= 1
    const docs = Array.from({ length: 10 }, (_, i) => m(Object.fromEntries(Array.from({ length: i + 1 }, (_, k) => [`t${k}`, 1]))));
    const big = buildIdf(docs); // t0 o 10 the, t1 o 9 the ... t9 o 1 the
    let prev = 0;
    for (let k = 0; k < 10; k += 1) {
      const v = idfOf(big, `t${k}`);
      expect(v, `t${k}`).toBeGreaterThan(prev); // df giam -> idf tang
      expect(v).toBeGreaterThanOrEqual(1);
      prev = v;
    }
    expect(idfOf(big, 'la')).toBeGreaterThan(prev);

    // Kho rong: khong chia 0, idf = 1
    const empty = buildIdf([]);
    expect(empty.docCount).toBe(0);
    expect(idfOf(empty, 'x')).toBe(1);
    // Thuat ngu co so lan 0 / am KHONG tinh la "co mat"
    const z = buildIdf([m({ a: 0, b: -1, c: 1 })]);
    expect(z.df.has('a')).toBe(false);
    expect(z.df.has('b')).toBe(false);
    expect(z.df.get('c')).toBe(1);
    // Nhan mot iterable bat ky (khong chi mang)
    expect(buildIdf(new Set([m({ a: 1 })])).docCount).toBe(1);
  });
});

describe('Buoc 3 - vectorize', () => {
  it('chuan hoa do dai 1; tf lay log; tu hiem nang hon tu pho bien; bo so lan khong hop le; dau vao khong bi sua', () => {
    const idf = buildIdf([m({ hiem: 1, chung: 1 }), m({ chung: 1 }), m({ chung: 1 }), m({ chung: 1 })]);

    const v = vectorize(m({ hiem: 1, chung: 1 }), idf);
    expect(norm(v)).toBeCloseTo(1, 12);
    // Cung so lan: tu hiem (idf lon) phai nang hon tu pho bien
    expect(v.get('hiem')!).toBeGreaterThan(v.get('chung')!);
    // Ti le trong so = ti le idf (tf bang nhau) - kiem theo cong thuc, khong theo mot so ma
    expect(v.get('hiem')! / v.get('chung')!).toBeCloseTo(idfOf(idf, 'hiem') / idfOf(idf, 'chung'), 12);

    // TF lay log: 4 lan = (1 + ln 4) lan mot lan (truoc chuan hoa)
    const one = vectorize(m({ chung: 1, hiem: 1 }), idf);
    const four = vectorize(m({ chung: 4, hiem: 1 }), idf);
    const ratioOne = one.get('chung')! / one.get('hiem')!;
    const ratioFour = four.get('chung')! / four.get('hiem')!;
    expect(ratioFour / ratioOne).toBeCloseTo(1 + Math.log(4), 12);
    // ...va TF khong tuyen tinh: 100 lan chua bang 100x
    expect(ratioFour / ratioOne).toBeLessThan(4);

    // Tu chua tung thay van vec-to hoa duoc (dung idf lon nhat)
    const unseen = vectorize(m({ la: 1 }), idf);
    expect(unseen.get('la')).toBeCloseTo(1, 12);

    // Rong / khong hop le -> vec-to rong, khong NaN
    expect(vectorize(m({}), idf).size).toBe(0);
    expect(vectorize(m({ a: 0, b: -3, c: Number.NaN, d: Number.POSITIVE_INFINITY }), idf).size).toBe(0);
    expect(vectorize(m({ a: 0, ok: 2 }), idf).size).toBe(1);
    // Moi trong so hop le
    for (const w of v.values()) {
      expect(Number.isFinite(w)).toBe(true);
      expect(w).toBeGreaterThan(0);
      expect(w).toBeLessThanOrEqual(1);
    }

    // Dau vao dong bang: khong sua, ket qua tat dinh
    const counts = freezeDeep(m({ hiem: 2, chung: 1 }));
    const frozenIdf = freezeDeep(buildIdf([m({ hiem: 1 })]));
    expect([...vectorize(counts, frozenIdf)]).toEqual([...vectorize(m({ hiem: 2, chung: 1 }), buildIdf([m({ hiem: 1 })]))]);
    // Thu tu chen tat dinh (cosine tong theo thu tu nay)
    expect([...vectorize(m({ x: 1, y: 1, z: 1 }), idf).keys()]).toEqual(['x', 'y', 'z']);
  });
});

describe('Buoc 3 - cosine', () => {
  it('trong [0,1]; doi xung; tu tuong quan = 1; roi nhau = 0; rong = 0; trung voi oracle khong chuan hoa', () => {
    const idf = buildIdf([m({ a: 1, b: 1 }), m({ b: 1, c: 1 }), m({ c: 1 })]);
    const va = vectorize(m({ a: 1, b: 1 }), idf);
    const vb = vectorize(m({ b: 1, c: 1 }), idf);
    const vc = vectorize(m({ c: 1 }), idf);
    const vd = vectorize(m({ d: 1 }), idf);
    const empty: SparseVector = new Map();

    expect(cosine(va, va)).toBeCloseTo(1, 12);
    expect(cosine(va, vb)).toBeCloseTo(cosine(vb, va), 15); // doi xung
    expect(cosine(va, vd)).toBe(0); // roi nhau
    expect(cosine(va, empty)).toBe(0);
    expect(cosine(empty, va)).toBe(0);
    expect(cosine(empty, empty)).toBe(0);
    expect(cosine(va, vb)).toBeGreaterThan(0);
    expect(cosine(va, vb)).toBeLessThan(1);
    // Cang chung nhieu thi cang giong: (b,c) gan (c) hon (a,b)
    expect(cosine(vb, vc)).toBeGreaterThan(cosine(va, vc));

    // Oracle: cosine tinh tren vec-to CHUA chuan hoa (tich vo huong / (|u||v|))
    const raw = (c: Record<string, number>) =>
      new Map(Object.entries(c).map(([t, n]) => [t, (1 + Math.log(n)) * idfOf(idf, t)] as const));
    const naive = (u: Map<string, number>, v: Map<string, number>) => {
      let dot = 0;
      for (const [t, x] of u) dot += x * (v.get(t) ?? 0);
      const nu = Math.sqrt([...u.values()].reduce((s, x) => s + x * x, 0));
      const nv = Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0));
      return dot / (nu * nv);
    };
    const A = { a: 1, b: 2 };
    const B = { b: 1, c: 3 };
    expect(cosine(vectorize(m(A), idf), vectorize(m(B), idf))).toBeCloseTo(naive(raw(A), raw(B)), 12);

    // Ket qua khong bao gio vuot 1 vi sai so lam tron
    for (let i = 1; i <= 40; i += 1) {
      const c = Object.fromEntries(Array.from({ length: i }, (_, k) => [`w${k}`, 1 + (k % 3)]));
      const v = vectorize(m(c), idf);
      const s = cosine(v, v);
      expect(s).toBeLessThanOrEqual(1);
      expect(s).toBeGreaterThan(1 - 1e-9);
    }
  });

  it('tinh chat tren 300 cap vec-to ngau nhien (hat giong co dinh)', () => {
    let s = 7;
    const next = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const vocab = Array.from({ length: 12 }, (_, i) => `t${i}`);
    const doc = () => {
      const o: Record<string, number> = {};
      const k = 1 + Math.floor(next() * 6);
      for (let i = 0; i < k; i += 1) o[vocab[Math.floor(next() * vocab.length)]!] = 1 + Math.floor(next() * 4);
      return m(o);
    };
    const idf = buildIdf(Array.from({ length: 30 }, doc));
    let nonZero = 0;
    for (let i = 0; i < 300; i += 1) {
      const a = vectorize(doc(), idf);
      const b = vectorize(doc(), idf);
      const ab = cosine(a, b);
      expect(ab).toBeGreaterThanOrEqual(0);
      expect(ab).toBeLessThanOrEqual(1);
      expect(Number.isNaN(ab)).toBe(false);
      expect(ab).toBeCloseTo(cosine(b, a), 12); // doi xung
      expect(cosine(a, a)).toBeCloseTo(1, 12);
      if (ab > 0) nonZero += 1;
    }
    expect(nonZero).toBeGreaterThan(150); // bo sinh khong tra ve toan cap roi nhau
  });
});
