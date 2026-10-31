// Buoc 4b - chuan hoa trong nhom ung vien (phuong an A) o rankCandidates. HAM THUAN: khong cham CSDL.
// So tinh tay (thẻ giong het -> sim = 1 nen khong phu thuoc idf), bat bien theo thang, hai chinh sach
// thieu du lieu, va tinh chat tren tinh huong ngau nhien. KHONG go dau thoat backslash-u trong noi dung.
import { describe, expect, it } from 'vitest';
import type { HistoryCard } from '../src/modules/assign/assign.profile';
import {
  rankCandidates,
  scoreCandidate,
  type CandidateInput,
  type ComponentScore,
  type MissingPolicy,
  type Normalization,
  type OpenCard,
  type RankedCandidate,
  type ScoreCard,
  type ScoreContext,
  type Weights,
} from '../src/modules/assign/assign.score';
import { countTerms } from '../src/modules/assign/assign.text';
import { buildIdf, type Idf } from '../src/modules/assign/assign.tfidf';
import { DEFAULT_SIM, generateSimulation } from '../src/scripts/simGenerator';
import { componentSpread, replay } from '../src/scripts/simReplay';

const DAY = 86_400_000;
const NOW = new Date('2026-09-20T00:00:00.000Z');
const at = (d: number) => new Date(NOW.getTime() + d * DAY);
const ago = (d: number) => at(-d);

const idfFor = (titles: string[]): Idf => buildIdf(titles.map((t) => countTerms({ title: t })));
const IDF = idfFor(['alpha', 'beta', 'gamma', 'delta', 'alpha beta', 'alpha gamma']);
const ctx = (over: Partial<ScoreContext> = {}): ScoreContext => ({ idf: IDF, now: NOW, groupOnTimeRate: 0.5, ...over });
const hist = (cardId: string, title: string, age: number, over: Partial<HistoryCard> = {}): HistoryCard => ({
  cardId,
  title,
  completedAt: ago(age),
  dueDate: ago(age - 1),
  ...over,
});
const open = (cardId: string, start: Date | null = null, due: Date | null = null): OpenCard => ({ cardId, startDate: start, dueDate: due });
const cand = (userId: string, history: HistoryCard[] = [], openCards: OpenCard[] = [], over: Partial<CandidateInput> = {}): CandidateInput => ({
  userId,
  history,
  openCards,
  ...over,
});
const CARD: ScoreCard = { id: 'new', title: 'alpha' };
const KEYS = ['experience', 'reliability', 'availability'] as const;

/** Ba ung vien co gia tri tho tinh tay duoc (the giong het, tuoi 0, muy 0,5, suc chua 5). */
const X = () => cand('X', [hist('x1', 'alpha', 0), hist('x2', 'alpha', 0), hist('x3', 'alpha', 0)]);
const Y = () => cand('Y', [hist('y1', 'alpha', 0)], [open('yo')]);
const Z = () => cand('Z', [hist('z1', 'alpha', 0), hist('z2', 'alpha', 0)], [open('zo1'), open('zo2'), open('zo3')]);
/** Nguoi moi: khong co lich su, khong co viec dang mo. */
const N = () => cand('N');

const byId = (r: RankedCandidate[]) => new Map(r.map((x) => [x.userId, x]));
const scaledOf = (r: RankedCandidate) => KEYS.map((k) => r.components[k].scaled);
const valueOf = (r: RankedCandidate) => KEYS.map((k) => r.components[k].value);

describe('Buoc 4b - chuan hoa min-max trong nhom (so tinh tay)', () => {
  it('ba ung vien: gia tri tho, gia tri chuan hoa, diem tuong doi va diem tho khop tinh tay; thu tu DOI so voi cong tho', () => {
    // Tho (kinh nghiem / tin cay / kha dung): X 0,6 / 0,75 / 1 ; Y 1/3 / 0,625 / 0,8 ; Z 0,5 / 0,7 / 0,4
    //   X: 3 the giong het -> e = 3 -> 3/5 ; tin cay (3 + 1,5)/(3 + 3) ; khong the mo nao -> 1
    //   Y: 1 the -> 1/3 ; (1 + 1,5)/4 ; 1 the mo -> 1 - 1/5
    //   Z: 2 the -> 2/4 ; (2 + 1,5)/5 ; 3 the mo -> 1 - 3/5
    // Chuan hoa: kn: X 1, Y 0, Z (0,5 - 1/3)/(0,6 - 1/3) = 0,625 ; tc: X 1, Y 0, Z (0,7 - 0,625)/0,125 = 0,6 ;
    //            kd: X 1, Y (0,8 - 0,4)/0,6 = 2/3, Z 0
    const mm = rankCandidates(CARD, [Z(), X(), Y()], ctx()); // KHONG chi dinh normalize -> mac dinh MINMAX
    expect(mm.map((r) => r.userId)).toEqual(['X', 'Z', 'Y']);
    const m = byId(mm);

    expect(valueOf(m.get('X')!)).toEqual([expect.closeTo(0.6, 12), expect.closeTo(0.75, 12), 1]);
    expect(valueOf(m.get('Y')!)).toEqual([expect.closeTo(1 / 3, 12), expect.closeTo(0.625, 12), expect.closeTo(0.8, 12)]);
    expect(valueOf(m.get('Z')!)).toEqual([expect.closeTo(0.5, 12), expect.closeTo(0.7, 12), expect.closeTo(0.4, 12)]);

    expect(scaledOf(m.get('X')!)).toEqual([1, 1, 1]);
    expect(scaledOf(m.get('Y')!)).toEqual([0, 0, expect.closeTo(2 / 3, 12)]);
    expect(scaledOf(m.get('Z')!)).toEqual([expect.closeTo(0.625, 12), expect.closeTo(0.6, 12), 0]);

    expect(m.get('X')!.score).toBeCloseTo(100, 9);
    expect(m.get('Z')!.score).toBeCloseTo(100 * (0.45 * 0.625 + 0.3 * 0.6), 9); // 46,125
    expect(m.get('Y')!.score).toBeCloseTo(100 * 0.25 * (2 / 3), 9); // 16,667
    // Diem THO theo §5.7 khong doi khi chuan hoa
    expect(m.get('X')!.rawScore).toBeCloseTo(100 * (0.45 * 0.6 + 0.3 * 0.75 + 0.25), 9); // 74,5
    expect(m.get('Y')!.rawScore).toBeCloseTo(53.75, 9);
    expect(m.get('Z')!.rawScore).toBeCloseTo(53.5, 9);
    // Ti trong = trong so (ca ba thanh phan deu co)
    expect(KEYS.map((k) => m.get('Z')!.components[k].share)).toEqual([expect.closeTo(0.45, 12), expect.closeTo(0.3, 12), expect.closeTo(0.25, 12)]);

    // Cong tho: Y (53,75) hon Z (53,5) - THU TU KHAC HAN chuan hoa (Z 46,1 hon Y 16,7)
    const raw = rankCandidates(CARD, [Z(), X(), Y()], ctx({ normalize: 'NONE' }));
    expect(raw.map((r) => r.userId)).toEqual(['X', 'Y', 'Z']);
    expect(byId(raw).get('Y')!.score).toBeCloseTo(53.75, 9);
    expect(byId(raw).get('Z')!.score).toBeCloseTo(53.5, 9);
    // Chi dinh 'MINMAX' ro rang cho ket qua GIONG het mac dinh
    expect(rankCandidates(CARD, [Z(), X(), Y()], ctx({ normalize: 'MINMAX' }))).toEqual(mm);
  });

  it('suy bien: nhom khong phan biet duoc -> 0,5 (khong doi thu tu); mot ung vien -> 0,5; van giu diem tho', () => {
    // Hai nguoi giong het nhau ve moi thanh phan
    const twin = rankCandidates(CARD, [cand('b', [hist('b1', 'alpha', 0)]), cand('a', [hist('a1', 'alpha', 0)])], ctx());
    expect(twin.map((r) => r.userId)).toEqual(['a', 'b']); // hoa het -> userId
    for (const r of twin) {
      expect(scaledOf(r)).toEqual([0.5, 0.5, 0.5]);
      expect(r.score).toBeCloseTo(50, 9);
    }
    // Mot ung vien duy nhat: moi thanh phan trung tinh -> 50, nhung rawScore van la diem tho §5.7
    const solo = rankCandidates(CARD, [Y()], ctx())[0]!;
    expect(solo.score).toBeCloseTo(50, 9);
    expect(solo.rawScore).toBeCloseTo(53.75, 9);
    expect(solo.rawScore).toBeCloseTo(scoreCandidate(CARD, Y(), ctx()).score!, 12);

    // Gia tri bang nhau o mot thanh phan nhung khac o thanh phan khac: thanh phan bang nhau khong doi thu tu
    const sameExp = rankCandidates(
      CARD,
      [cand('busy', [hist('h1', 'alpha', 0)], [open('o1'), open('o2')]), cand('free', [hist('h2', 'alpha', 0)])],
      ctx()
    );
    expect(sameExp.map((r) => r.userId)).toEqual(['free', 'busy']);
    expect(sameExp[0]!.score).toBeCloseTo(100 * (0.45 * 0.5 + 0.3 * 0.5 + 0.25 * 1), 9); // 62,5
    expect(sameExp[1]!.score).toBeCloseTo(100 * (0.45 * 0.5 + 0.3 * 0.5 + 0.25 * 0), 9); // 37,5
  });

  it('BAT BIEN THEO THANG: doi suc chua (5 -> 10) doi thang cua kha dung nhung KHONG doi ket qua chuan hoa; cong tho thi doi', () => {
    // Bon nguoi khong lich su -> chi con kha dung. Tai 0..3.
    const team = (cap: number) =>
      [0, 1, 2, 3].map((n) =>
        cand(`c${n}`, [], Array.from({ length: n }, (_, i) => open(`o${n}-${i}`)), { maxParallelCards: cap })
      );
    const at5 = rankCandidates(CARD, team(5), ctx());
    const at10 = rankCandidates(CARD, team(10), ctx());
    expect(at5.map((r) => r.userId)).toEqual(['c0', 'c1', 'c2', 'c3']);
    expect(at10.map((r) => r.userId)).toEqual(['c0', 'c1', 'c2', 'c3']);
    const want = [1, 2 / 3, 1 / 3, 0];
    at5.forEach((r, i) => expect(r.components.availability.scaled!).toBeCloseTo(want[i]!, 12));
    at10.forEach((r, i) => expect(r.components.availability.scaled!).toBeCloseTo(want[i]!, 12));
    at5.forEach((r, i) => expect(r.score!).toBeCloseTo(100 * want[i]!, 9));
    // Gia tri THO thi khac nhau theo suc chua (0,8 vs 0,9...)
    expect(at5[1]!.components.availability.value).toBeCloseTo(0.8, 12);
    expect(at10[1]!.components.availability.value).toBeCloseTo(0.9, 12);
    // Khong chuan hoa: diem la 100 x gia tri tho -> phu thuoc suc chua
    const raw10 = rankCandidates(CARD, team(10), ctx({ normalize: 'NONE' }));
    expect(raw10[1]!.score!).toBeCloseTo(90, 9);
    expect(raw10[3]!.score!).toBeCloseTo(70, 9);
  });
});

describe('Buoc 4b - thanh phan thieu du lieu: DROP (nguyen tac 4) va NEUTRAL', () => {
  it('DROP: nguoi moi chi con kha dung (co the dong hang nhat nhom); NEUTRAL: thay bang trung binh nhom', () => {
    // Nguoi moi N: kha dung 1 (khong viec mo). Cot kha dung: X 1, Y 0,8, Z 0,4, N 1 -> N chuan hoa = 1.
    const drop = rankCandidates(CARD, [Z(), N(), X(), Y()], ctx({ missing: 'DROP' }));
    const d = byId(drop);
    // N chi co kha dung -> diem = 100 x 1 = 100 -> DONG HANG voi X (100); X thang nho do tin cay cao hon (0,5 > 0)
    expect(drop.map((r) => r.userId)).toEqual(['X', 'N', 'Z', 'Y']);
    expect(d.get('N')!.score).toBeCloseTo(100, 9);
    expect(d.get('X')!.score).toBeCloseTo(100, 9);
    expect(d.get('N')!.components.experience.scaled).toBeNull();
    expect(d.get('N')!.components.reliability.scaled).toBeNull();
    expect(d.get('N')!.components.availability.share).toBe(1);
    expect(d.get('N')!.flags).toEqual(['NO_HISTORY', 'NO_PROFILE']);
    // Nguoi co du lieu khong bi anh huong boi viec N vang mat o hai cot kia
    expect(d.get('Z')!.score).toBeCloseTo(46.125, 9);
    expect(d.get('Y')!.score).toBeCloseTo(100 * 0.25 * (2 / 3), 9);

    // NEUTRAL: kinh nghiem = trung binh (1, 0, 0,625) ; tin cay = trung binh (1, 0, 0,6)
    const neutral = rankCandidates(CARD, [Z(), N(), X(), Y()], ctx({ missing: 'NEUTRAL' }));
    const n = byId(neutral);
    expect(neutral.map((r) => r.userId)).toEqual(['X', 'N', 'Z', 'Y']);
    const nn = n.get('N')!;
    expect(nn.components.experience.value).toBeNull(); // gia tri THO van la "chua co du lieu"
    expect(nn.components.experience.scaled!).toBeCloseTo((1 + 0 + 0.625) / 3, 12);
    expect(nn.components.reliability.scaled!).toBeCloseTo((1 + 0 + 0.6) / 3, 12);
    expect(nn.score!).toBeCloseTo(100 * (0.45 * ((1 + 0.625) / 3) + 0.3 * ((1 + 0.6) / 3) + 0.25 * 1), 9); // 65,375
    expect(KEYS.map((k) => nn.components[k].share)).toEqual([expect.closeTo(0.45, 12), expect.closeTo(0.3, 12), expect.closeTo(0.25, 12)]);
    expect(nn.flags).toEqual(['NO_HISTORY', 'NO_PROFILE']); // van la nguoi moi, chi la khong bi thoi phong
    // Nguoi co du lieu khong doi
    expect(n.get('X')!.score).toBeCloseTo(100, 9);
    expect(n.get('Z')!.score).toBeCloseTo(46.125, 9);
    // rawScore cua N van la diem tho §5.7 (chi kha dung)
    expect(nn.rawScore).toBeCloseTo(100, 9);
  });

  it('khong ai co thanh phan do -> bo cho moi nguoi, ke ca khi NEUTRAL (khong co gi de lay trung binh)', () => {
    for (const missing of ['DROP', 'NEUTRAL'] as const) {
      const r = rankCandidates(CARD, [X(), Y(), Z(), N()], ctx({ groupOnTimeRate: null, missing }));
      const m = byId(r);
      for (const x of r) {
        expect(x.components.reliability.value, `${missing} ${x.userId}`).toBeNull();
        expect(x.components.reliability.scaled, `${missing} ${x.userId}`).toBeNull();
        expect(x.components.reliability.share).toBe(0);
      }
      // Diem chi con kinh nghiem (0,45) + kha dung (0,25): X = 100, Z = 100 x (0,45 x 0,625)/0,7
      expect(m.get('X')!.score).toBeCloseTo(100, 9);
      expect(m.get('Z')!.score!).toBeCloseTo((100 * 0.45 * 0.625) / 0.7, 9);
      expect(m.get('Y')!.score!).toBeCloseTo((100 * 0.25 * (2 / 3)) / 0.7, 9);
    }
  });

  it('co NO_DATA di theo DIEM CUOI (khong theo diem tho): NEUTRAL go co, DROP giu co va xuong cuoi', () => {
    const onlyExp: Weights = { experience: 1, reliability: 0, availability: 0, declared: 0 };
    // DROP: N khong co kinh nghiem -> khong thanh phan nao co trong so -> score null + NO_DATA, xuong cuoi
    const drop = rankCandidates(CARD, [N(), X(), Y(), Z()], ctx({ weights: onlyExp, missing: 'DROP' }));
    expect(drop.map((r) => r.userId)).toEqual(['X', 'Z', 'Y', 'N']);
    expect(drop[3]!.score).toBeNull();
    expect(drop[3]!.flags).toEqual(['NO_HISTORY', 'NO_PROFILE', 'NO_DATA']);
    expect(drop[0]!.score).toBeCloseTo(100, 9);
    expect(drop[1]!.score).toBeCloseTo(62.5, 9); // Z: kinh nghiem chuan hoa 0,625
    expect(drop[2]!.score).toBeCloseTo(0, 9);
    // NEUTRAL: N duoc gan trung binh (1 + 0 + 0,625)/3 -> co diem, khong con NO_DATA, xep giua Z va Y
    const neutral = rankCandidates(CARD, [N(), X(), Y(), Z()], ctx({ weights: onlyExp, missing: 'NEUTRAL' }));
    expect(neutral.map((r) => r.userId)).toEqual(['X', 'Z', 'N', 'Y']);
    const nn = byId(neutral).get('N')!;
    expect(nn.score).toBeCloseTo((100 * 1.625) / 3, 9);
    expect(nn.flags).toEqual(['NO_HISTORY', 'NO_PROFILE']);
    // rawScore cua N van null (khong co thanh phan tho nao co trong so) - khong bi chuan hoa che di
    expect(nn.rawScore).toBeNull();
  });
});

describe('Buoc 4b - lua chon khong doi voi cham mot nguoi va tuy chon sai bi tu choi', () => {
  it('scoreCandidate bo qua normalize/missing (khong co "nhom"); tuy chon la la RangeError', () => {
    const base = scoreCandidate(CARD, Y(), ctx());
    for (const normalize of ['MINMAX', 'NONE'] as const) {
      for (const missing of ['DROP', 'NEUTRAL'] as const) {
        expect(scoreCandidate(CARD, Y(), ctx({ normalize, missing }))).toEqual(base);
      }
    }
    expect(base.score).toBe(base.rawScore);
    expect(KEYS.map((k) => base.components[k].scaled)).toEqual(KEYS.map((k) => base.components[k].value));

    const bads: [string, Partial<ScoreContext>][] = [
      ['normalize la', { normalize: 'ZSCORE' as Normalization }],
      ['normalize rong', { normalize: '' as Normalization }],
      ['missing la', { missing: 'IMPUTE' as MissingPolicy }],
      ['missing rong', { missing: '' as MissingPolicy }],
    ];
    for (const [name, over] of bads) {
      expect(() => scoreCandidate(CARD, Y(), ctx(over)), name).toThrow(RangeError);
      expect(() => rankCandidates(CARD, [Y()], ctx(over)), name).toThrow(RangeError);
      expect(() => rankCandidates(CARD, [], ctx(over)), `rong: ${name}`).toThrow(RangeError);
    }
  });
});

describe('Buoc 4b - tinh chat tren tinh huong ngau nhien (hat giong co dinh)', () => {
  it('moi to hop normalize x missing: bat bien cua gia tri tho, chuan hoa, diem, ti trong, co va thu tu', () => {
    let s = 20260921;
    const next = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const pick = <T,>(a: readonly T[]) => a[Math.floor(next() * a.length)]!;
    const words = ['alpha', 'beta', 'gamma', 'delta', 'omega'];
    const text = () => Array.from({ length: 1 + Math.floor(next() * 3) }, () => pick(words)).join(' ');
    const idf = idfFor(Array.from({ length: 10 }, text));

    const combos: [Normalization, MissingPolicy][] = [
      ['MINMAX', 'DROP'],
      ['MINMAX', 'NEUTRAL'],
      ['NONE', 'DROP'],
      ['NONE', 'NEUTRAL'],
    ];
    let minmaxChecked = 0;
    let neutralImputed = 0;
    let nullScores = 0;
    for (let n = 0; n < 150; n += 1) {
      const card: ScoreCard = { id: 'q', title: text(), startDate: next() < 0.5 ? at(Math.floor(next() * 20)) : null, dueDate: next() < 0.5 ? at(Math.floor(next() * 30)) : null };
      const people: CandidateInput[] = Array.from({ length: 1 + Math.floor(next() * 6) }, (_, i) =>
        cand(
          `u${i}`,
          Array.from({ length: Math.floor(next() * 7) }, (_, j) => {
            const age = Math.floor(next() * 300);
            return { cardId: `h${i}-${j}`, title: text(), completedAt: ago(age), dueDate: next() < 0.8 ? ago(age + Math.floor(next() * 14 - 6)) : null, reopened: next() < 0.2 };
          }),
          Array.from({ length: Math.floor(next() * 7) }, (_, j) => open(`o${i}-${j}`, next() < 0.6 ? at(Math.floor(next() * 30 - 5)) : null, next() < 0.6 ? at(Math.floor(next() * 30 - 5)) : null)),
          { maxParallelCards: 1 + Math.floor(next() * 6) }
        )
      );
      // Co ca trong so "chi kinh nghiem" / "chi tin cay" de xuat hien diem rong (NO_DATA) - neu khong, kha dung luon
      // co du lieu va nhanh NO_DATA khong bao gio duoc kiem
      const wMode = next();
      const weights: Weights =
        wMode < 0.25
          ? { experience: 1, reliability: 0, availability: 0, declared: 0 }
          : wMode < 0.4
            ? { experience: 0, reliability: 1, availability: 0, declared: 0 }
            : { experience: next(), reliability: next(), availability: next() + 0.01, declared: 0 };
      const mu = next() < 0.85 ? next() : null;

      for (const [normalize, missing] of combos) {
        const c = ctx({ idf, groupOnTimeRate: mu, weights, normalize, missing });
        const ranked = rankCandidates(card, people, c);
        expect(ranked).toHaveLength(people.length);
        expect(rankCandidates(card, people, c)).toEqual(ranked); // tat dinh
        const tag = `${normalize}/${missing} #${n}`;

        // Gia tri THO va diem THO khong doi voi tuy chon: bang ket qua cham tung nguoi
        for (const r of ranked) {
          const single = scoreCandidate(card, people.find((p) => p.userId === r.userId)!, ctx({ idf, groupOnTimeRate: mu, weights }));
          expect(r.rawScore, tag).toBe(single.score);
          expect(valueOf(r), tag).toEqual(valueOf({ ...single, rank: 0 }));
          expect(r.confidence, tag).toBe(single.confidence);
        }

        // Tung thanh phan
        KEYS.forEach((k) => {
          const cols = ranked.map((r) => r.components[k]);
          const present = cols.filter((x): x is ComponentScore & { value: number } => x.value !== null);
          const scaledPresent = present.map((x) => x.scaled);
          if (missing === 'DROP') {
            cols.forEach((x) => expect(x.scaled === null, tag).toBe(x.value === null));
          } else if (present.length > 0) {
            cols.forEach((x) => expect(x.scaled, tag).not.toBeNull()); // NEUTRAL: ai cung co gia tri
          } else {
            cols.forEach((x) => expect(x.scaled, tag).toBeNull()); // khong ai co -> khong co gi de lay trung binh
          }
          if (normalize === 'NONE') {
            present.forEach((x) => expect(x.scaled, tag).toBe(x.value));
          } else if (present.length > 0) {
            const vals = present.map((x) => x.value);
            const lo = Math.min(...vals);
            const hi = Math.max(...vals);
            for (const x of present) {
              expect(x.scaled!, tag).toBeGreaterThanOrEqual(0);
              expect(x.scaled!, tag).toBeLessThanOrEqual(1);
              expect(x.scaled!, tag).toBeCloseTo(hi > lo ? (x.value - lo) / (hi - lo) : 0.5, 12);
            }
            if (hi > lo) {
              expect(Math.min(...scaledPresent.map((v) => v!)), tag).toBeCloseTo(0, 12);
              expect(Math.max(...scaledPresent.map((v) => v!)), tag).toBeCloseTo(1, 12);
            }
            minmaxChecked += 1;
          }
          if (missing === 'NEUTRAL' && present.length > 0) {
            const known = scaledPresent as number[];
            const mean = known.reduce((a, b) => a + b, 0) / known.length;
            cols.filter((x) => x.value === null).forEach((x) => {
              expect(x.scaled!, tag).toBeCloseTo(mean, 12);
              neutralImputed += 1;
            });
          }
        });

        // Diem, ti trong va co
        const w = [weights.experience, weights.reliability, weights.availability];
        for (const r of ranked) {
          const sc = KEYS.map((k) => r.components[k].scaled);
          const d = sc.reduce<number>((a, v, i) => (v === null ? a : a + w[i]!), 0);
          const num = sc.reduce<number>((a, v, i) => (v === null ? a : a + w[i]! * v), 0);
          if (d > 0) {
            expect(r.score!, tag).toBeCloseTo((100 * num) / d, 9);
            expect(r.score!, tag).toBeGreaterThanOrEqual(0);
            expect(r.score!, tag).toBeLessThanOrEqual(100);
            expect(r.flags.includes('NO_DATA'), tag).toBe(false);
            expect(KEYS.reduce((a, k) => a + r.components[k].share, 0), tag).toBeCloseTo(1, 9);
          } else {
            expect(r.score, tag).toBeNull();
            expect(r.flags.includes('NO_DATA'), tag).toBe(true);
            expect(KEYS.every((k) => r.components[k].share === 0), tag).toBe(true);
            nullScores += 1;
          }
        }

        // Thu tu: diem giam dan, null xuong cuoi, hoa thi do tin cay roi userId; rank 1..n
        ranked.forEach((r, i) => {
          expect(r.rank, tag).toBe(i + 1);
          if (i === 0) return;
          const a = ranked[i - 1]!;
          if (a.score === null) expect(r.score, tag).toBeNull();
          else if (r.score !== null) {
            expect(a.score, tag).toBeGreaterThanOrEqual(r.score);
            if (a.score === r.score) {
              expect(a.confidence, tag).toBeGreaterThanOrEqual(r.confidence);
              if (a.confidence === r.confidence) expect(a.userId < r.userId, tag).toBe(true);
            }
          }
        });

        // Khong phu thuoc thu tu dau vao
        const shuffled = [...people].sort(() => next() - 0.5);
        const again = rankCandidates(card, shuffled, c);
        expect(again.map((r) => r.userId), tag).toEqual(ranked.map((r) => r.userId));
        expect(again.map((r) => r.score), tag).toEqual(ranked.map((r) => r.score));
      }
    }
    // Bo sinh co du cac truong hop
    expect(minmaxChecked).toBeGreaterThan(300);
    expect(neutralImputed).toBeGreaterThan(20);
    expect(nullScores).toBeGreaterThan(5);
  });
});

describe('Buoc 4b - tac dung tren du lieu mo phong (chot chan "chuan hoa co ich")', () => {
  it('top-1 khi chuan hoa hon cong tho o MOI hat giong; anh huong thuc te cua ba thanh phan bang trong so danh nghia', () => {
    // Do duoc tren 7 hat giong: top-1 26,0% -> 35,9%, hat giong nao cung tang (27->43, 33->50, 29->38, 23->29,
    // 18->28, 25->34, 26->29); anh huong thuc te 23/9/67% -> 45/29/25% (trong so danh nghia 45/30/25).
    const seeds = [1, 2, 3, 4];
    const data = seeds.map((seed) => generateSimulation({ ...DEFAULT_SIM, seed }));
    const gains: number[] = [];
    for (const [i, d] of data.entries()) {
      const raw = replay(d, { normalize: 'NONE' });
      const scaled = replay(d);
      expect(scaled.hitScorer, `seed ${seeds[i]}`).toBeGreaterThan(raw.hitScorer);
      expect(scaled.regretScorer, `seed ${seeds[i]}`).toBeLessThan(raw.regretScorer);
      gains.push(scaled.hitScorer - raw.hitScorer);
    }
    expect(gains.reduce((a, b) => a + b, 0) / gains.length).toBeGreaterThan(0.06);

    // Xac suat dung han KY VONG (mo hinh ket qua cua bo sinh, co xet tai): chuan hoa cung khong lam te di, va cac moc
    // tham chieu co thu tu dung: ngau nhien < bo cham < ky nang cao nhat <= toi uu, moi so trong [0,05; 0,95]
    const rawP = data.map((d) => replay(d, { normalize: 'NONE' }).pOnTimeScorer);
    const dflt = data.map((d) => replay(d));
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(dflt.map((r) => r.pOnTimeScorer))).toBeGreaterThan(mean(rawP) + 0.02);
    for (const [i, r] of dflt.entries()) {
      const tag = `seed ${seeds[i]}`;
      for (const p of [r.pOnTimeScorer, r.pOnTimeActual, r.pOnTimeRandom, r.pOnTimeBest, r.pOnTimeOracle]) {
        expect(p, tag).toBeGreaterThanOrEqual(0.05);
        expect(p, tag).toBeLessThanOrEqual(0.95);
      }
      expect(r.pOnTimeScorer, tag).toBeGreaterThan(r.pOnTimeRandom);
      expect(r.pOnTimeBest, tag).toBeGreaterThan(r.pOnTimeScorer);
      expect(r.pOnTimeOracle, tag).toBeGreaterThanOrEqual(r.pOnTimeBest); // toi uu = max, nen khong the thap hon ai
      expect(r.pOnTimeOracle, tag).toBeGreaterThanOrEqual(r.pOnTimeActual);
    }

    const infl = (opts: Parameters<typeof componentSpread>[1], key: 'sd' | 'scaledSd') => {
      const sp = componentSpread(data, opts);
      const w = { experience: 0.45, reliability: 0.3, availability: 0.25 };
      const v = { experience: w.experience * sp.experience[key], reliability: w.reliability * sp.reliability[key], availability: w.availability * sp.availability[key] };
      const t = v.experience + v.reliability + v.availability;
      return { experience: v.experience / t, reliability: v.reliability / t, availability: v.availability / t };
    };
    const before = infl({ normalize: 'NONE' }, 'sd');
    expect(before.availability).toBeGreaterThan(0.5); // truoc: kha dung quyet dinh > 1/2 thu tu
    expect(before.reliability).toBeLessThan(0.15);
    const after = infl({}, 'scaledSd');
    expect(after.availability).toBeLessThan(0.4); // sau: gan trong so danh nghia 0,25
    expect(after.experience).toBeGreaterThan(0.35);
    expect(after.reliability).toBeGreaterThan(0.2);
  });

  it('NEUTRAL dua nguoi chua co lich su ve khong con "dung dau vuot ti le"; DROP van cho ho dung dau', () => {
    // Do duoc (7 hat giong): NO_HISTORY chiem ~1,5% ung vien; DROP -> 3,3% so the dung dau, NEUTRAL -> 0,1%.
    const data = [1, 2, 3, 4].map((seed) => generateSimulation({ ...DEFAULT_SIM, seed }));
    const share = (missing: MissingPolicy) => data.reduce((s, d) => s + replay(d, { missing }).topNoHistory, 0) / data.length;
    const drop = share('DROP');
    const neutral = share('NEUTRAL');
    expect(drop).toBeGreaterThan(0.005); // van con nguoi moi dung dau (khong bi triet)
    expect(neutral).toBeLessThan(drop);
    expect(neutral).toBeLessThan(0.02);
    // Do chinh xac gan nhu khong doi giua hai cach
    const acc = (missing: MissingPolicy) => data.reduce((s, d) => s + replay(d, { missing }).hitScorer, 0) / data.length;
    expect(Math.abs(acc('NEUTRAL') - acc('DROP'))).toBeLessThan(0.03);
  });
});
