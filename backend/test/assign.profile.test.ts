// Buoc 3 - ho so nguoi (assign.profile.ts) + chuoi tach tu -> TF-IDF tren du lieu mo phong.
// HAM THUAN: khong cham CSDL (setup.ts van TRUNCATE truoc moi `it`).
import { describe, expect, it } from 'vitest';
import {
  HALF_LIFE_DAYS,
  buildProfile,
  decay,
  topTerms,
  type HistoryCard,
} from '../src/modules/assign/assign.profile';
import { countTerms } from '../src/modules/assign/assign.text';
import { buildIdf, idfOf, vectorize } from '../src/modules/assign/assign.tfidf';
import { DEFAULT_SIM, generateSimulation } from '../src/scripts/simGenerator';
import { neighbourAccuracy } from '../src/scripts/simTextEval';

const DAY = 86_400_000;
const NOW = new Date('2026-09-20T00:00:00.000Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const idfOf3 = () => buildIdf([{ title: 'alpha' }, { title: 'beta' }, { title: 'gamma' }].map((c) => countTerms(c)));

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

describe('Buoc 3 - suy giam theo thoi gian', () => {
  it('0,5^(d/H): 1 o d=0, 0,5 o d=H, 0,25 o d=2H; don dieu; tuoi am kep ve 0; tham so sai bi tu choi', () => {
    expect(HALF_LIFE_DAYS).toBe(90);
    expect(decay(0)).toBe(1);
    expect(decay(90)).toBeCloseTo(0.5, 12);
    expect(decay(180)).toBeCloseTo(0.25, 12);
    expect(decay(45)).toBeCloseTo(Math.SQRT1_2, 12);
    // Nua doi tuy chinh
    expect(decay(30, 30)).toBeCloseTo(0.5, 12);
    expect(decay(10, 10)).toBeCloseTo(0.5, 12);
    // Giam dan, luon trong (0,1]
    let prev = 2;
    for (let d = 0; d <= 2000; d += 25) {
      const v = decay(d);
      expect(v).toBeLessThan(prev);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
    // Moc o tuong lai (lech dong ho) khong duoc cho trong so > 1
    expect(decay(-5)).toBe(1);
    expect(decay(-1e9)).toBe(1);
    // Tham so sai la loi lap trinh
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => decay(1, bad), `halfLife=${bad}`).toThrow(RangeError);
    }
    expect(() => decay(Number.NaN)).toThrow(RangeError);
    expect(() => decay(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('Buoc 3 - buildProfile va topTerms', () => {
  it('trong so theo tuoi; sap xep moi nhat truoc, hoa thi theo cardId; bo dong hong; khong sua dau vao', () => {
    const idf = idfOf3();
    const history: HistoryCard[] = [
      { cardId: 'c-old', title: 'alpha', completedAt: ago(90) },
      { cardId: 'c-new-b', title: 'beta', completedAt: ago(10) },
      { cardId: 'c-new-a', title: 'gamma', completedAt: ago(10) }, // cung luc voi c-new-b -> theo cardId
      { cardId: 'c-bad', title: 'alpha', completedAt: new Date('khong phai ngay') },
      { cardId: 'c-future', title: 'beta', completedAt: new Date(NOW.getTime() + 3 * DAY) },
    ];
    const frozen = deepFreeze(history.map((h) => ({ ...h })));
    const p = buildProfile('u1', frozen, idf, NOW);

    expect(p.userId).toBe('u1');
    // c-bad bi bo; con lai xep theo thoi diem giam dan, hoa thi cardId tang dan
    expect(p.entries.map((e) => e.cardId)).toEqual(['c-future', 'c-new-a', 'c-new-b', 'c-old']);
    const byId = new Map(p.entries.map((e) => [e.cardId, e]));
    expect(byId.get('c-old')!.ageDays).toBeCloseTo(90, 9);
    expect(byId.get('c-old')!.weight).toBeCloseTo(0.5, 9);
    expect(byId.get('c-new-a')!.weight).toBeCloseTo(decay(10), 12);
    // The "tuong lai": tuoi 0, trong so 1 (khong vuot 1)
    expect(byId.get('c-future')!.ageDays).toBe(0);
    expect(byId.get('c-future')!.weight).toBe(1);
    // Vec-to khop vectorize(countTerms) doc lap
    expect([...byId.get('c-old')!.vec]).toEqual([...vectorize(countTerms({ title: 'alpha' }), idf)]);
    // ...voi the co HAI thuat ngu (tieu de + mo ta): chuan hoa chi triet tieu trong so khi co MOT thuat ngu,
    // nen phai kiem ca ti le - neu buildProfile doi trong so tieu de thi ti le nay lech.
    const two = { cardId: 't', title: 'alpha', description: 'beta', completedAt: ago(1) };
    const v2 = buildProfile('u', [two], idf, NOW).entries[0]!.vec;
    expect([...v2]).toEqual([...vectorize(countTerms(two), idf)]);
    expect(v2.get('alpha')! / v2.get('beta')!).toBeCloseTo(((1 + Math.log(2)) * idfOf(idf, 'alpha')) / (1 * idfOf(idf, 'beta')), 12);

    // Dau vao khong bi sua; cung dau vao -> cung ket qua (khong phu thuoc thu tu mang)
    const shuffled = [...frozen].reverse();
    expect(buildProfile('u1', shuffled, idf, NOW).entries.map((e) => e.cardId)).toEqual(p.entries.map((e) => e.cardId));

    // Lich su rong -> ho so rong, khong loi; nhung tham so sai van bi tu choi
    expect(buildProfile('u2', [], idf, NOW).entries).toEqual([]);
    expect(() => buildProfile('u2', [], idf, new Date('x'))).toThrow(RangeError);
    expect(() => buildProfile('u2', [], idf, NOW, 0)).toThrow(RangeError);
    expect(() => buildProfile('u2', history, idf, NOW, -3)).toThrow(RangeError);
    // Nua doi tuy chinh duoc dung that
    const short = buildProfile('u1', [{ cardId: 'x', title: 'alpha', completedAt: ago(30) }], idf, NOW, 30);
    expect(short.entries[0]!.weight).toBeCloseTo(0.5, 9);
  });

  it('topTerms: tong (trong so thoi gian x trong so thuat ngu); the moi nang hon the cu; hoa diem theo thu tu chu', () => {
    const idf = idfOf3();
    // Hai the, moi the chi co MOT thuat ngu -> vec-to chuan hoa = 1.0: ket qua doc duoc bang mat
    const p = buildProfile(
      'u',
      [
        { cardId: 'a', title: 'alpha', completedAt: ago(90) }, // trong so 0,5
        { cardId: 'b', title: 'beta', completedAt: ago(0) }, // trong so 1
      ],
      idf,
      NOW
    );
    const t = topTerms(p, 5);
    expect(t.map((x) => x.term)).toEqual(['beta', 'alpha']);
    expect(t[0]!.weight).toBeCloseTo(1, 12);
    expect(t[1]!.weight).toBeCloseTo(0.5, 9);

    // Cung noi dung: the MOI hon phai nang hon
    const same = buildProfile(
      'u',
      [
        { cardId: 'old', title: 'alpha', completedAt: ago(180) },
        { cardId: 'new', title: 'beta', completedAt: ago(1) },
      ],
      idf,
      NOW
    );
    expect(topTerms(same, 1)[0]!.term).toBe('beta');

    // Cong don: cung mot thuat ngu o hai the -> trong so cong lai
    const twice = buildProfile(
      'u',
      [
        { cardId: '1', title: 'alpha', completedAt: ago(0) },
        { cardId: '2', title: 'alpha', completedAt: ago(90) },
      ],
      idf,
      NOW
    );
    expect(topTerms(twice, 1)[0]!.weight).toBeCloseTo(1.5, 9);

    // Hoa diem -> theo thu tu chu (tat dinh): hai the cung tuoi, cung trong so
    const tie = buildProfile(
      'u',
      [
        { cardId: '1', title: 'gamma', completedAt: ago(5) },
        { cardId: '2', title: 'alpha', completedAt: ago(5) },
      ],
      idf,
      NOW
    );
    expect(topTerms(tie, 2).map((x) => x.term)).toEqual(['alpha', 'gamma']);

    // n: 0 -> rong; lon hon so thuat ngu -> tra het; khong hop le -> nem loi
    expect(topTerms(p, 0)).toEqual([]);
    expect(topTerms(p, 100)).toHaveLength(2);
    for (const bad of [-1, 1.5, Number.NaN]) expect(() => topTerms(p, bad), String(bad)).toThrow(RangeError);
    expect(topTerms(buildProfile('u', [], idf, NOW), 5)).toEqual([]);
  });

  it('topTerms trung voi oracle doc lap tren mot ho so nhieu the (hat giong co dinh)', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: 3 });
    const idf = buildIdf(data.cards.map((c) => countTerms(c)));
    const mine = data.cards.filter((c) => c.assigneeKey === 'p1' && c.done);
    expect(mine.length).toBeGreaterThan(10);
    const history: HistoryCard[] = mine.map((c, i) => ({
      cardId: c.key,
      title: c.title,
      description: c.description,
      completedAt: ago(i * 7),
    }));
    const profile = buildProfile('p1', history, idf, NOW);
    const got = topTerms(profile, 15);

    // Oracle: tu tinh tu dau, khong dung buildProfile/topTerms
    const acc = new Map<string, number>();
    for (const h of history) {
      const ageDays = (NOW.getTime() - h.completedAt.getTime()) / DAY;
      const w = Math.pow(0.5, ageDays / 90);
      for (const [term, x] of vectorize(countTerms(h), idf)) acc.set(term, (acc.get(term) ?? 0) + w * x);
    }
    const want = [...acc].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 15);
    expect(got.map((x) => x.term)).toEqual(want.map((x) => x[0]));
    got.forEach((x, i) => expect(x.weight).toBeCloseTo(want[i]![1], 10));
    // Giam dan
    for (let i = 1; i < got.length; i += 1) expect(got[i]!.weight).toBeLessThanOrEqual(got[i - 1]!.weight);
  });
});

describe('Buoc 3 - chuoi tach tu -> TF-IDF co phan biet duoc chu de tren du lieu mo phong', () => {
  // Chi chung minh chuoi xu ly KHONG HONG: tu vung mo phong chi co 8 chu de nen con so la CAN TREN tren
  // mot thi truong do choi, khong phai do tot tren van ban that (xem simTextEval.ts). Nguong dat duoi
  // muc do duoc (top-1 93,9-99,1% tren 7 hat giong; ngau nhien ~13%) de bat hong hoc chu khong khop so.
  it('lang gieng gan nhat cung chu de an: top-1 >= 85%, P@5 >= 70%, hon xa ngau nhien (4 hat giong)', () => {
    for (const seed of [1, 2, 3, 4]) {
      const data = generateSimulation({ ...DEFAULT_SIM, seed });
      const r = neighbourAccuracy(data, (c) => countTerms(c));
      expect(r.queries, `seed ${seed}`).toBeGreaterThan(80);
      expect(r.chance, `seed ${seed}`).toBeLessThan(0.25);
      expect(r.top1, `seed ${seed} top-1`).toBeGreaterThanOrEqual(0.85);
      expect(r.p5, `seed ${seed} P@5`).toBeGreaterThanOrEqual(0.7);
      expect(r.top1 - r.chance, `seed ${seed}`).toBeGreaterThan(0.6);
    }
  });

  it('phep do tu no duoc kiem: chuoi hong (chi thuat ngu vo nghia) roi ve muc ngau nhien', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: 1 });
    // Moi the mang MOT thuat ngu ngau nhien-nhung-tat-dinh khong lien quan chu de -> phai ~ ngau nhien
    const broken = neighbourAccuracy(data, (c) => new Map([[`t${(c.key.charCodeAt(1) * 7 + c.key.length) % 5}`, 1]]));
    expect(broken.top1).toBeLessThan(0.5);
    // ... va bo qua the mo ho khi lam truy van
    const ambiguous = data.cards.filter((c) => c.ambiguous).length;
    expect(ambiguous).toBeGreaterThan(0);
    expect(neighbourAccuracy(data, (c) => countTerms(c)).queries).toBe(data.cards.length - ambiguous);
  });
});
