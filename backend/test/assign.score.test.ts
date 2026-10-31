// Buoc 4 - bo cham cap (viec, nguoi) (assign.score.ts). HAM THUAN: khong cham CSDL.
// (setup.ts van TRUNCATE truoc moi `it`, nen cac ca duoc gop thanh bang cho nhanh.)
//
// Cong thuc §5.4-5.7 duoc doi chieu bang SO TINH TAY (sim = 1 nen khong phu thuoc idf) va bang
// "oracle" tinh lai tu cac ham nguyen thuy (cosine, decay), khong dung chinh bo cham de tinh ky vong.
// KHONG go dau thoat backslash-u trong noi dung (cong cu doi thanh ky tu that).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HistoryCard } from '../src/modules/assign/assign.profile';
import {
  CONFIDENCE_FAIR_BELOW,
  CONFIDENCE_THIN_BELOW,
  DEFAULT_PARAMS,
  DEFAULT_WEIGHTS,
  LEGACY_WEIGHTS_V1,
  confidenceLevelOf,
  groupOnTimeRate,
  outcomeKindOf,
  outcomeValue,
  rankCandidates,
  scoreCandidate,
  type CandidateInput,
  type CandidateScore,
  type OpenCard,
  type ScoreCard,
  type ScoreContext,
  type Weights,
} from '../src/modules/assign/assign.score';
import { countTerms } from '../src/modules/assign/assign.text';
import { buildIdf, cosine, vectorize, type Idf } from '../src/modules/assign/assign.tfidf';
import { DEFAULT_SIM, generateSimulation } from '../src/scripts/simGenerator';
import { componentSpread, replay, replayTargets } from '../src/scripts/simReplay';

const DAY = 86_400_000;
const NOW = new Date('2026-09-20T00:00:00.000Z');
/** now + d ngay (d am = trong qua khu). */
const at = (d: number) => new Date(NOW.getTime() + d * DAY);
const ago = (d: number) => at(-d);

const idfFor = (titles: string[]): Idf => buildIdf(titles.map((t) => countTerms({ title: t })));
const IDF = idfFor(['alpha', 'beta', 'gamma', 'delta', 'alpha beta', 'alpha gamma']);
const ctx = (over: Partial<ScoreContext> = {}): ScoreContext => ({
  idf: IDF,
  now: NOW,
  groupOnTimeRate: 0.5,
  ...over,
});

/** The da xong `age` ngay truoc, han 1 ngay SAU luc xong (dung han) tru khi ghi de. */
const hist = (cardId: string, title: string, age: number, over: Partial<HistoryCard> = {}): HistoryCard => ({
  cardId,
  title,
  completedAt: ago(age),
  dueDate: ago(age - 1),
  ...over,
});
const cand = (userId: string, history: HistoryCard[] = [], openCards: OpenCard[] = [], over: Partial<CandidateInput> = {}): CandidateInput => ({
  userId,
  history,
  openCards,
  ...over,
});
const open = (cardId: string, start: Date | null, due: Date | null): OpenCard => ({ cardId, startDate: start, dueDate: due });
const CARD: ScoreCard = { id: 'new', title: 'alpha' };

function deepFreeze<T>(v: T): T {
  if (v instanceof Map) {
    const boom = () => {
      throw new TypeError('sua Map dau vao');
    };
    Object.assign(v, { set: boom, delete: boom, clear: boom });
  } else if (v && typeof v === 'object' && !(v instanceof Date)) {
    Object.freeze(v);
    for (const x of Object.values(v as object)) deepFreeze(x);
  }
  return v;
}

/** Moi so trong mot ket qua (de bat NaN / vo han). */
function numbersOf(x: unknown, out: number[] = []): number[] {
  if (typeof x === 'number') out.push(x);
  else if (x instanceof Date) return out;
  else if (Array.isArray(x)) x.forEach((y) => numbersOf(y, out));
  else if (x && typeof x === 'object') Object.values(x).forEach((y) => numbersOf(y, out));
  return out;
}

describe('Buoc 4 - ket qua cua mot the da xong', () => {
  it('dung han <=> completedAt <= dueDate (bang nhau van dung han); tre 1ms la LATE; mo lai chi ha xuong 0,5; khong han loai', () => {
    const due = at(0);
    expect(outcomeKindOf({ completedAt: due, dueDate: due })).toBe('ON_TIME');
    expect(outcomeKindOf({ completedAt: new Date(due.getTime() + 1), dueDate: due })).toBe('LATE');
    expect(outcomeKindOf({ completedAt: new Date(due.getTime() - 1), dueDate: due })).toBe('ON_TIME');
    expect(outcomeKindOf({ completedAt: at(-1), dueDate: due, reopened: true })).toBe('ON_TIME_REOPENED');
    // Tre thi tre, du co bi mo lai hay khong
    expect(outcomeKindOf({ completedAt: at(1), dueDate: due, reopened: true })).toBe('LATE');
    expect(outcomeKindOf({ completedAt: at(1), dueDate: due, reopened: false })).toBe('LATE');
    for (const d of [null, undefined, new Date('khong hop le')]) {
      expect(outcomeKindOf({ completedAt: due, dueDate: d }), String(d)).toBe('NO_DUE');
    }
    expect(outcomeValue('ON_TIME')).toBe(1);
    expect(outcomeValue('ON_TIME_REOPENED')).toBe(0.5);
    expect(outcomeValue('LATE')).toBe(0);
    expect(outcomeValue('NO_DUE')).toBeNull();
  });

  it('groupOnTimeRate: trung binh outcome; bo qua the khong han, the xong SAU now, ngay hong; khong co gi -> null', () => {
    const cards = [
      { completedAt: ago(10), dueDate: ago(9) }, // 1
      { completedAt: ago(10), dueDate: ago(11) }, // 0 (tre)
      { completedAt: ago(10), dueDate: ago(9), reopened: true }, // 0,5
      { completedAt: ago(10), dueDate: null }, // bo (khong han)
      { completedAt: at(5), dueDate: at(9) }, // bo (xong SAU now)
      { completedAt: new Date('x'), dueDate: ago(1) }, // bo (ngay hong)
    ];
    expect(groupOnTimeRate(cards, NOW)).toBeCloseTo(0.5, 12);
    expect(groupOnTimeRate([], NOW)).toBeNull();
    expect(groupOnTimeRate([{ completedAt: ago(1), dueDate: null }], NOW)).toBeNull();
    // Nhan mot iterable bat ky
    expect(groupOnTimeRate(new Set([cards[0]!]), NOW)).toBe(1);
    expect(() => groupOnTimeRate(cards, new Date('x'))).toThrow(RangeError);
  });
});

describe('Buoc 4 - kinh nghiem (§5.4)', () => {
  it('so tinh tay voi the giong het (sim = 1): e/(e+2) theo tuoi va so the; toi da K the', () => {
    const one = scoreCandidate(CARD, cand('u', [hist('a', 'alpha', 0)]), ctx());
    expect(one.components.experience.value).toBeCloseTo(1 / 3, 12); // fit 1, e 1
    expect(one.evidenceMass).toBeCloseTo(1, 12);
    expect(one.fit).toBeCloseTo(1, 12);
    expect(one.evidence).toHaveLength(1);
    expect(one.evidence[0]).toMatchObject({ cardId: 'a', title: 'alpha', outcome: 'ON_TIME' });
    expect(one.evidence[0]!.sim).toBeCloseTo(1, 12);
    expect(one.evidence[0]!.weight).toBeCloseTo(1, 12);
    // Bang chung mang dung ngay cua the cu (de giao dien hien "xong luc nao, han luc nao")
    expect(one.evidence[0]!.completedAt).toEqual(ago(0));
    expect(one.evidence[0]!.dueDate).toEqual(ago(-1));

    // 90 ngay -> trong so 0,5 -> e = 0,5 -> 0,5 / 2,5 = 0,2 (fit van 1: khong phu thuoc so luong)
    const old = scoreCandidate(CARD, cand('u', [hist('a', 'alpha', 90)]), ctx());
    expect(old.evidenceMass).toBeCloseTo(0.5, 9);
    expect(old.fit).toBeCloseTo(1, 12);
    expect(old.components.experience.value).toBeCloseTo(0.2, 9);

    // 5 the giong het hom nay: 5/7; them the thu 6, 7, 8 KHONG doi gi (K = 5)
    const five = Array.from({ length: 5 }, (_, i) => hist(`c${i}`, 'alpha', 0));
    const eight = Array.from({ length: 8 }, (_, i) => hist(`c${i}`, 'alpha', 0));
    expect(scoreCandidate(CARD, cand('u', five), ctx()).components.experience.value).toBeCloseTo(5 / 7, 12);
    const s8 = scoreCandidate(CARD, cand('u', eight), ctx());
    expect(s8.components.experience.value).toBeCloseTo(5 / 7, 12);
    expect(s8.evidence).toHaveLength(5);
    expect(DEFAULT_PARAMS.k).toBe(5);

    // Cang nhieu bang chung cang cao, don dieu
    const vals = [1, 2, 3, 4, 5].map((n) =>
      scoreCandidate(CARD, cand('u', eight.slice(0, n)), ctx()).components.experience.value!
    );
    for (let i = 1; i < vals.length; i += 1) expect(vals[i]!).toBeGreaterThan(vals[i - 1]!);
  });

  it('chon K the GIONG NHAT (oracle cosine), hoa thi the moi hon truoc roi cardId; simMin va sim = 0', () => {
    const idf = idfFor(['alpha', 'alpha beta', 'alpha beta gamma', 'alpha beta gamma delta', 'beta', 'gamma', 'delta']);
    const titles = ['alpha beta gamma delta', 'alpha beta gamma', 'beta', 'alpha beta', 'alpha', 'gamma'];
    const history = titles.map((t, i) => hist(`h${i}`, t, 5 + i));
    const q = vectorize(countTerms(CARD), idf);
    const oracle = history
      .map((h) => ({ id: h.cardId, sim: cosine(q, vectorize(countTerms(h), idf)) }))
      .filter((x) => x.sim > 0)
      .sort((a, b) => b.sim - a.sim);
    expect(oracle.length).toBe(4); // 'beta' va 'gamma' roi hang voi 'alpha' (sim = 0)

    const k2 = scoreCandidate(CARD, cand('u', history), ctx({ idf, params: { k: 2 } }));
    expect(k2.evidence.map((e) => e.cardId)).toEqual(oracle.slice(0, 2).map((x) => x.id));
    const all = scoreCandidate(CARD, cand('u', history), ctx({ idf, params: { k: 10 } }));
    expect(all.evidence.map((e) => e.cardId)).toEqual(oracle.map((x) => x.id)); // the sim = 0 KHONG vao bang chung
    // Bang chung giam dan theo sim
    for (let i = 1; i < all.evidence.length; i += 1) {
      expect(all.evidence[i]!.sim).toBeLessThanOrEqual(all.evidence[i - 1]!.sim);
    }

    // simMin loai the it giong: dat sat sim cua the giong thu hai
    const cut = (oracle[0]!.sim + oracle[1]!.sim) / 2;
    const strict = scoreCandidate(CARD, cand('u', history), ctx({ idf, params: { k: 10, simMin: cut } }));
    expect(strict.evidence.map((e) => e.cardId)).toEqual([oracle[0]!.id]);

    // Sim = 0 khong bao gio la bang chung, ke ca khi simMin = 0
    const none = scoreCandidate(CARD, cand('u', [hist('x', 'beta', 1), hist('y', 'gamma', 1)]), ctx({ idf, params: { simMin: 0 } }));
    expect(none.evidence).toEqual([]);
    expect(none.flags).toContain('NO_SIMILAR');
    expect(none.flags).not.toContain('NO_HISTORY');
    expect(none.components.experience.value).toBe(0); // da tim va khong thay -> 0 (co du lieu)
    expect(none.fit).toBe(0);
    expect(none.evidenceMass).toBe(0);
    expect(none.components.reliability.value).toBeCloseTo(0.5, 12); // lui ve trung binh nhom
    expect(none.confidence).toBe(0);
    expect(none.confidenceLevel).toBe('THIN');

    // Hoa sim: cung noi dung -> the MOI hon truoc, roi cardId
    const tie = scoreCandidate(
      CARD,
      cand('u', [hist('b', 'alpha', 10), hist('a', 'alpha', 10), hist('c', 'alpha', 3)]),
      ctx({ params: { k: 3 } })
    );
    expect(tie.evidence.map((e) => e.cardId)).toEqual(['c', 'a', 'b']);
  });

  it('fit va evidence tach nhau; cong thuc khop oracle tren hai the co sim va tuoi khac nhau', () => {
    const idf = idfFor(['alpha', 'alpha beta', 'alpha gamma', 'beta']);
    const h1 = hist('h1', 'alpha beta', 20);
    const h2 = hist('h2', 'alpha gamma', 200);
    const q = vectorize(countTerms(CARD), idf);
    const s1 = cosine(q, vectorize(countTerms(h1), idf));
    const s2 = cosine(q, vectorize(countTerms(h2), idf));
    const w1 = Math.pow(0.5, 20 / 90);
    const w2 = Math.pow(0.5, 200 / 90);
    const e = w1 + w2;
    const fit = (w1 * s1 + w2 * s2) / e;
    const r = scoreCandidate(CARD, cand('u', [h1, h2]), ctx({ idf }));
    expect(r.evidenceMass).toBeCloseTo(e, 12);
    expect(r.fit).toBeCloseTo(fit, 12);
    expect(r.components.experience.value).toBeCloseTo((fit * e) / (e + 2), 12);
    expect(r.confidence).toBeCloseTo(e / (e + 3), 12);

    // Mot the CUC khop nhung rat cu: fit cao, evidence thap -> kinh nghiem thap hon nhieu the vua khop moi hon
    const ancient = scoreCandidate(CARD, cand('u', [hist('x', 'alpha', 720)]), ctx({ idf }));
    expect(ancient.fit).toBeCloseTo(1, 12);
    const fresh = scoreCandidate(CARD, cand('u', [hist('a', 'alpha beta', 5), hist('b', 'alpha gamma', 6), hist('c', 'alpha beta', 7)]), ctx({ idf }));
    expect(fresh.fit).toBeLessThan(1);
    expect(fresh.components.experience.value!).toBeGreaterThan(ancient.components.experience.value!);
  });
});

describe('Buoc 4 - tin cay (§5.5)', () => {
  it('so tinh tay: (v.outcome + m.muy) / (v + m) voi m = 3; dung han / tre / mo lai', () => {
    const rel = (h: HistoryCard[], mu: number | null = 0.5) =>
      scoreCandidate(CARD, cand('u', h), ctx({ groupOnTimeRate: mu })).components.reliability.value;
    // 1 the giong het hom nay: v = 1
    expect(rel([hist('a', 'alpha', 0)])).toBeCloseTo((1 * 1 + 3 * 0.5) / (1 + 3), 12); // 0,625
    expect(rel([hist('a', 'alpha', 0, { dueDate: ago(1) })])).toBeCloseTo((0 + 3 * 0.5) / (1 + 3), 12); // tre: 0,375
    expect(rel([hist('a', 'alpha', 0, { reopened: true })])).toBeCloseTo((0.5 + 3 * 0.5) / (1 + 3), 12); // 0,5
    // Hai the, mot dung han mot tre: (1 + 0 + 1,5) / (2 + 3) = 0,5
    expect(rel([hist('a', 'alpha', 0), hist('b', 'alpha', 0, { dueDate: ago(1) })])).toBeCloseTo(0.5, 12);
    // v_i = w_i.sim_i: the tre CU (trong so 0,5) ha it hon the dung han MOI: (1 + 0 + 1,5) / (1,5 + 3)
    expect(rel([hist('a', 'alpha', 0), hist('b', 'alpha', 90, { dueDate: ago(91) })])).toBeCloseTo(2.5 / 4.5, 9);
    // Nguoi moi lam 1 the dung han KHONG thanh 100%: bi keo ve trung binh nhom
    expect(rel([hist('a', 'alpha', 0)])!).toBeLessThan(0.7);
    // Nhieu bang chung dung han -> tien toi 1 (khong bi ghim o trung binh)
    const many = Array.from({ length: 5 }, (_, i) => hist(`m${i}`, 'alpha', 0));
    expect(rel(many)!).toBeGreaterThan(rel([many[0]!])!);
    expect(rel(many)!).toBeCloseTo((5 + 1.5) / (5 + 3), 12);
  });

  it('khop oracle khi sim < 1 va tuoi khac nhau (v = w.sim): moi to hop ket qua cua hai the', () => {
    // Voi sim = 1 va tuoi 0 thi v = 1 nen sai o v hoac o sim khong lo ra; ca nay ep sim < 1 va w < 1
    const idf = idfFor(['alpha', 'alpha beta', 'alpha gamma', 'alpha delta', 'beta']);
    const q = vectorize(countTerms(CARD), idf);
    const kinds = ['ON_TIME', 'ON_TIME_REOPENED', 'LATE'] as const;
    const build = (id: string, title: string, age: number, kind: (typeof kinds)[number]): HistoryCard =>
      kind === 'LATE'
        ? hist(id, title, age, { dueDate: ago(age + 1) })
        : hist(id, title, age, { reopened: kind === 'ON_TIME_REOPENED' });
    let checked = 0;
    for (const kA of kinds) {
      for (const kB of kinds) {
        for (const [ageA, ageB] of [[3, 60], [60, 3], [0, 200]] as const) {
          const a = build('A', 'alpha beta', ageA, kA);
          const b = build('B', 'alpha gamma', ageB, kB);
          const val = (k: string) => (k === 'ON_TIME' ? 1 : k === 'ON_TIME_REOPENED' ? 0.5 : 0);
          const vA = Math.pow(0.5, ageA / 90) * cosine(q, vectorize(countTerms(a), idf));
          const vB = Math.pow(0.5, ageB / 90) * cosine(q, vectorize(countTerms(b), idf));
          const mu = 0.7;
          const want = (vA * val(kA) + vB * val(kB) + 3 * mu) / (vA + vB + 3);
          const got = scoreCandidate(CARD, cand('u', [a, b]), ctx({ idf, groupOnTimeRate: mu })).components.reliability.value;
          expect(got, `${kA}/${kB} tuoi ${ageA}/${ageB}`).toBeCloseTo(want, 12);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(27);
    // Hai the co CUNG ket qua nhung khac tuoi va sim: the moi + khop nhieu hon phai keo tin cay manh hon
    const newLate = scoreCandidate(CARD, cand('u', [build('A', 'alpha beta', 0, 'LATE'), build('B', 'alpha gamma', 90, 'ON_TIME')]), ctx({ idf }));
    const oldLate = scoreCandidate(CARD, cand('u', [build('A', 'alpha beta', 90, 'LATE'), build('B', 'alpha gamma', 0, 'ON_TIME')]), ctx({ idf }));
    expect(newLate.components.reliability.value!).toBeLessThan(oldLate.components.reliability.value!);
  });

  it('the khong dat han bi loai khoi phep tinh; muy = null -> khong co du lieu; khong co lich su -> khong co du lieu', () => {
    // The khong han: khong co v nao -> lui het ve muy
    const noDue = scoreCandidate(CARD, cand('u', [hist('a', 'alpha', 0, { dueDate: null })]), ctx({ groupOnTimeRate: 0.4 }));
    expect(noDue.components.reliability.value).toBeCloseTo(0.4, 12);
    expect(noDue.evidence[0]!.outcome).toBe('NO_DUE');
    expect(noDue.components.experience.value).toBeCloseTo(1 / 3, 12); // van tinh vao KINH NGHIEM
    // Tron the co han va khong han: the khong han khong anh huong tin cay
    const a = scoreCandidate(CARD, cand('u', [hist('a', 'alpha', 0)]), ctx());
    const b = scoreCandidate(CARD, cand('u', [hist('a', 'alpha', 0), hist('n', 'alpha', 0, { dueDate: null })]), ctx());
    expect(b.components.reliability.value).toBeCloseTo(a.components.reliability.value!, 12);

    const noMu = scoreCandidate(CARD, cand('u', [hist('a', 'alpha', 0)]), ctx({ groupOnTimeRate: null }));
    expect(noMu.components.reliability.value).toBeNull();
    expect(noMu.components.reliability.share).toBe(0);
    expect(noMu.components.experience.value).not.toBeNull();

    const noHist = scoreCandidate(CARD, cand('u'), ctx());
    expect(noHist.components.reliability.value).toBeNull();
    expect(noHist.components.experience.value).toBeNull();
  });
});

describe('Buoc 4 - kha dung (§5.6)', () => {
  const avail = (c: ScoreCard, openCards: OpenCard[], over: Partial<CandidateInput> = {}) =>
    scoreCandidate(c, cand('u', [], openCards, over), ctx());

  it('1 - load/cap; chi dem the CHONG LAN cua so; the qua han van chiem cho; the khong ngay coi nhu dang chay', () => {
    const card: ScoreCard = { id: 'new', title: 'alpha', startDate: at(5), dueDate: at(15) };
    expect(avail(card, []).components.availability.value).toBe(1);
    // chong lan mot phan / nam trong / bao trum / cham dau mut
    const overlapping = [open('o1', at(3), at(6)), open('o2', at(8), at(9)), open('o3', at(0), at(30)), open('o4', at(15), at(20)), open('o5', at(0), at(5))];
    const r = avail(card, overlapping);
    expect(r.load).toBe(5);
    // Khong chong lan: ket thuc truoc / bat dau sau cua so
    const disjoint = [open('d1', at(0), at(4)), open('d2', at(16), at(20))];
    expect(avail(card, disjoint).load).toBe(0);

    // Qua han van chiem cho (keo dai den now): chi tinh voi cua so co chua `now`
    const overdue = [open('od', ago(30), ago(10))];
    expect(avail(card, overdue).load).toBe(0); // cua so bat dau sau 5 ngay
    expect(avail({ id: 'new', title: 'alpha' }, overdue).load).toBe(1); // cua so mac dinh bat dau tu now
    // Khong ngay: coi nhu dang chay tu lau va chua co han -> chong lan moi cua so
    expect(avail(card, [open('u1', null, null)]).load).toBe(1);
    expect(avail(card, [open('u2', null, at(2))]).load).toBe(0); // co han som, hoac chua toi now -> ket thuc truoc cua so
    expect(avail(card, [open('u3', at(20), null)]).load).toBe(0); // bat dau sau cua so
    // Ngay dao nguoc (bat dau > han) duoc coi la doan [han, bat dau]
    expect(avail(card, [open('rev', at(9), at(7))]).load).toBe(1);
    // ...va phai la DOAN giua hai ngay: bat dau 20, han 8 -> [8, 20] chong lan [5, 15]. Khong doi cho thi
    // [20, ...] bat dau sau cua so -> 0; ca truoc do (9, 7) khong phan biet duoc vi ca hai cach deu chong lan
    expect(avail(card, [open('rev2', at(20), at(8))]).load).toBe(1);
    expect(avail(card, [open('rev3', at(40), at(30))]).load).toBe(0); // dao nguoc nhung van ngoai cua so
  });

  it('cua so mac dinh: thieu ca hai ngay -> [now, now+14]; chi han -> [min(now,han), han]; chi bat dau -> [bd, bd+14]', () => {
    const startOfWindow = (c: ScoreCard, days: number) =>
      avail(c, [open('x', at(days), at(days))]).load; // the mot diem tai `days`
    const none: ScoreCard = { id: 'new', title: 'alpha' };
    expect(startOfWindow(none, 0)).toBe(1); // dung now
    expect(startOfWindow(none, 14)).toBe(1); // cham dau mut ben phai
    expect(startOfWindow(none, 15)).toBe(0);
    // The DANG MO co han tu hom qua (qua han) van chiem cho den now -> van chong lan cua so bat dau tu now
    expect(startOfWindow(none, -1)).toBe(1);
    const dueOnly: ScoreCard = { id: 'new', title: 'alpha', dueDate: at(3) };
    expect(startOfWindow(dueOnly, 3)).toBe(1);
    expect(startOfWindow(dueOnly, 4)).toBe(0);
    expect(startOfWindow(dueOnly, 1)).toBe(1); // mep TRAI: cua so bat dau tu now (khong phai tu han)
    expect(startOfWindow(dueOnly, 0)).toBe(1);
    const startOnly: ScoreCard = { id: 'new', title: 'alpha', startDate: at(10) };
    expect(startOfWindow(startOnly, 24)).toBe(1);
    expect(startOfWindow(startOnly, 25)).toBe(0);
    expect(startOfWindow(startOnly, 9)).toBe(0);
    // Han da qua: cua so la [han, han]
    const past: ScoreCard = { id: 'new', title: 'alpha', dueDate: ago(2) };
    expect(startOfWindow(past, -2)).toBe(1);
    // Ngay dao nguoc cua the moi duoc doi cho
    const reversed: ScoreCard = { id: 'new', title: 'alpha', startDate: at(9), dueDate: at(2) };
    expect(startOfWindow(reversed, 5)).toBe(1);
    // Ngay khong hop le coi nhu khong co
    const bad: ScoreCard = { id: 'new', title: 'alpha', startDate: new Date('x'), dueDate: new Date('y') };
    expect(startOfWindow(bad, 10)).toBe(1);
  });

  it('cong thuc, OVERLOADED, suc chua, the dang xet khong tu chong lan minh, tam nghi', () => {
    const card: ScoreCard = { id: 'new', title: 'alpha', startDate: at(5), dueDate: at(15) };
    const overlap = (n: number) => Array.from({ length: n }, (_, i) => open(`o${i}`, at(6), at(9)));
    // Mac dinh suc chua 5
    expect(avail(card, overlap(2)).components.availability.value).toBeCloseTo(0.6, 12);
    expect(avail(card, overlap(2)).capacity).toBe(5);
    expect(avail(card, overlap(2), { maxParallelCards: 4 }).components.availability.value).toBeCloseTo(0.5, 12);
    // Cham suc chua -> 0 va OVERLOADED; vuot suc chua cung the (khong am)
    for (const n of [5, 6, 9]) {
      const r = avail(card, overlap(n));
      expect(r.components.availability.value, `load ${n}`).toBe(0);
      expect(r.flags, `load ${n}`).toContain('OVERLOADED');
    }
    expect(avail(card, overlap(4)).flags).not.toContain('OVERLOADED');
    // The dang xet co trong danh sach mo cua ung vien: khong tu dem chinh no
    expect(avail(card, [open('new', at(6), at(9)), open('o1', at(6), at(9))]).load).toBe(1);
    // Suc chua khong hop le
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => avail(card, [], { maxParallelCards: bad }), String(bad)).toThrow(RangeError);
    }

    // Tam nghi: pausedUntil >= luc bat dau cua so -> 0 va PAUSED; bang moc cung tinh; truoc do thi khong
    expect(avail(card, [], { pausedUntil: at(5) }).components.availability.value).toBe(0);
    expect(avail(card, [], { pausedUntil: at(5) }).flags).toContain('PAUSED');
    expect(avail(card, [], { pausedUntil: at(20) }).flags).toContain('PAUSED');
    const before = avail(card, [], { pausedUntil: new Date(at(5).getTime() - 1) });
    expect(before.components.availability.value).toBe(1);
    expect(before.flags).not.toContain('PAUSED');
    expect(avail(card, [], { pausedUntil: null }).flags).not.toContain('PAUSED');
    // Tam nghi khong lam mat so the dang mo (van hien tai)
    expect(avail(card, overlap(2), { pausedUntil: at(9) }).load).toBe(2);
  });
});

describe('Buoc 4 - diem tong va do tin cay (§5.7)', () => {
  it('so tinh tay: 100 x tong(w.diem) / tong(w) tren thanh phan CO du lieu; ti trong thuc te', () => {
    // kinh nghiem 1/3, tin cay 0,625 (muy 0,5), kha dung: 1 the mo chong lan / cap 5 = 0,8
    const c = cand('u', [hist('a', 'alpha', 0)], [open('o', null, null)]);
    const r = scoreCandidate(CARD, c, ctx());
    expect(r.load).toBe(1);
    expect(r.components.availability.value).toBeCloseTo(0.8, 12);
    expect(r.score).toBeCloseTo(100 * (0.45 * (1 / 3) + 0.3 * 0.625 + 0.25 * 0.8), 9); // 53,75
    expect(r.score).toBeCloseTo(53.75, 9);
    // Mac dinh moi 0,36 / 0,24 / 0,20 / Ho so 0,20 (§17.6): Ho so chua tinh (buoc 12) nen bi bo va chia lai -> ti trong THUC
    // SU van la 0,45 / 0,30 / 0,25, diem y nhu truoc buoc 11
    expect(r.components.experience).toMatchObject({ weight: 0.36 });
    expect(r.components.experience.share + r.components.reliability.share + r.components.availability.share).toBeCloseTo(1, 12);
    expect(r.components.experience.share).toBeCloseTo(0.45, 12);
    expect(r.components.reliability.share).toBeCloseTo(0.3, 12);
    expect(r.components.availability.share).toBeCloseTo(0.25, 12);
    expect(DEFAULT_WEIGHTS).toEqual({ experience: 0.36, reliability: 0.24, availability: 0.2, declared: 0.2 });
    const legacy = scoreCandidate(CARD, c, ctx({ weights: LEGACY_WEIGHTS_V1 }));
    expect(legacy.score).toBeCloseTo(53.75, 12);
    expect(legacy.components.experience).toMatchObject({ weight: 0.45, share: 0.45 });
    expect(r.flags).toEqual(['NO_PROFILE']); // khong khai ho so (buoc 12)

    // Trong so tuy chinh (khong can tong 1): 1 / 0 / 1 -> trung binh cua kinh nghiem va kha dung
    const w: Weights = { experience: 1, reliability: 0, availability: 1, declared: 0 };
    const rw = scoreCandidate(CARD, c, ctx({ weights: w }));
    expect(rw.score).toBeCloseTo((100 * (1 / 3 + 0.8)) / 2, 9);
    expect(rw.components.reliability.share).toBe(0);
  });

  it('thieu du lieu: NO_HISTORY -> chi con kha dung; NO_DATA khi khong thanh phan co trong so nao; diem khong bi keo xuong', () => {
    const noHist = scoreCandidate(CARD, cand('u', [], [open('o', null, null), open('p', null, null)]), ctx());
    expect(noHist.flags).toEqual(['NO_HISTORY', 'NO_PROFILE']);
    expect(noHist.components.experience.value).toBeNull();
    expect(noHist.components.reliability.value).toBeNull();
    expect(noHist.components.availability.share).toBe(1);
    expect(noHist.score).toBeCloseTo(100 * 0.6, 9); // chi khai dung: 1 - 2/5
    expect(noHist.evidence).toEqual([]);
    expect(noHist.evidenceMass).toBe(0);
    expect(noHist.confidence).toBe(0);

    // NO_DATA: cac thanh phan co du lieu deu co trong so 0
    const nd = scoreCandidate(CARD, cand('u'), ctx({ weights: { experience: 1, reliability: 1, availability: 0, declared: 0 } }));
    expect(nd.score).toBeNull();
    expect(nd.flags).toEqual(['NO_HISTORY', 'NO_PROFILE', 'NO_DATA']);
    // ...nhung cung nguoi do co lich su thi co diem
    const withHist = scoreCandidate(CARD, cand('u', [hist('a', 'alpha', 0)]), ctx({ weights: { experience: 1, reliability: 1, availability: 0, declared: 0 } }));
    expect(withHist.score).not.toBeNull();
    // Co lich su nhung thieu muy: reliability vang, diem chi con kinh nghiem + kha dung
    const noMu = scoreCandidate(CARD, cand('u', [hist('a', 'alpha', 0)]), ctx({ groupOnTimeRate: null }));
    expect(noMu.score).toBeCloseTo((100 * (0.45 * (1 / 3) + 0.25 * 1)) / 0.7, 9);
  });

  it('do tin cay = e/(e+3) va ba muc hien thi (ranh gioi 0,25 va 0,6)', () => {
    expect(CONFIDENCE_THIN_BELOW).toBe(0.25);
    expect(CONFIDENCE_FAIR_BELOW).toBe(0.6);
    expect(confidenceLevelOf(0)).toBe('THIN');
    expect(confidenceLevelOf(0.2499999)).toBe('THIN');
    expect(confidenceLevelOf(0.25)).toBe('FAIR');
    expect(confidenceLevelOf(0.5999999)).toBe('FAIR');
    expect(confidenceLevelOf(0.6)).toBe('GOOD');
    expect(confidenceLevelOf(0.99)).toBe('GOOD');
    // e = 1 -> 1/4 = 0,25 chinh xac -> FAIR; e = 0,5 (mot the 90 ngay) -> 1/7 -> THIN
    const c1 = scoreCandidate(CARD, cand('u', [hist('a', 'alpha', 0)]), ctx());
    expect(c1.confidence).toBe(0.25);
    expect(c1.confidenceLevel).toBe('FAIR');
    const c2 = scoreCandidate(CARD, cand('u', [hist('a', 'alpha', 90)]), ctx());
    expect(c2.confidence).toBeCloseTo(0.5 / 3.5, 9);
    expect(c2.confidenceLevel).toBe('THIN');
    // Nhieu bang chung moi -> GOOD
    const five = Array.from({ length: 5 }, (_, i) => hist(`c${i}`, 'alpha', 0));
    const c5 = scoreCandidate(CARD, cand('u', five), ctx());
    expect(c5.confidence).toBeCloseTo(5 / 8, 12);
    expect(c5.confidenceLevel).toBe('GOOD');
    // confidenceScale tuy chinh
    expect(scoreCandidate(CARD, cand('u', five), ctx({ params: { confidenceScale: 5 } })).confidence).toBeCloseTo(0.5, 12);
  });
});

describe('Buoc 4 - chong roi ri tuong lai', () => {
  it('the da xong SAU now va chinh the dang xet khong bao gio duoc dung', () => {
    const past = [hist('a', 'alpha', 10), hist('b', 'alpha beta', 30)];
    const future = [hist('f1', 'alpha', -3), hist('f2', 'alpha', -100, { dueDate: at(-99) })];
    const self = hist('new', 'alpha', 5); // chinh the dang xet
    const base = scoreCandidate(CARD, cand('u', past), ctx());
    const withFuture = scoreCandidate(CARD, cand('u', [...past, ...future, self]), ctx());
    expect(withFuture).toEqual(base);
    expect(withFuture.evidence.map((e) => e.cardId)).not.toContain('f1');

    // Neu CHI co the tuong lai -> coi nhu khong co lich su
    const onlyFuture = scoreCandidate(CARD, cand('u', future), ctx());
    expect(onlyFuture.flags).toContain('NO_HISTORY');
    // Xong dung luc `now` thi dung duoc (<=)
    const exactly = scoreCandidate(CARD, cand('u', [hist('e', 'alpha', 0)]), ctx());
    expect(exactly.evidence).toHaveLength(1);
    // Ngay hong bi bo
    const bad = scoreCandidate(CARD, cand('u', [{ cardId: 'x', title: 'alpha', completedAt: new Date('x') }]), ctx());
    expect(bad.flags).toContain('NO_HISTORY');
  });
});

describe('Buoc 4 - xep hang', () => {
  it('diem giam dan, null xuong cuoi, hoa thi do tin cay roi userId; khong phu thuoc thu tu dau vao; rank 1..n', () => {
    const c = (id: string, load: number, hasHist = true) =>
      cand(id, hasHist ? [hist(`${id}-h`, 'alpha', 0)] : [], Array.from({ length: load }, (_, i) => open(`${id}-o${i}`, null, null)));
    const list = [c('bob', 3), c('amy', 0), c('cat', 1), c('dan', 2)];
    const ranked = rankCandidates(CARD, list, ctx());
    // Cung kinh nghiem va tin cay -> chi khac kha dung: it tai hon xep truoc
    expect(ranked.map((r) => r.userId)).toEqual(['amy', 'cat', 'dan', 'bob']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < ranked.length; i += 1) expect(ranked[i]!.score!).toBeLessThanOrEqual(ranked[i - 1]!.score!);

    // Khong phu thuoc thu tu dau vao
    let s = 5;
    const next = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let t = 0; t < 30; t += 1) {
      const shuffled = [...list].sort(() => next() - 0.5);
      expect(rankCandidates(CARD, shuffled, ctx()).map((r) => r.userId)).toEqual(['amy', 'cat', 'dan', 'bob']);
    }

    // Hoa diem: cung diem -> do tin cay cao hon truoc; cung ca hai -> userId
    const same = rankCandidates(CARD, [c('zed', 1), c('abe', 1)], ctx());
    expect(same.map((r) => r.userId)).toEqual(['abe', 'zed']);
    expect(same[0]!.score).toBe(same[1]!.score);
    // Cung diem, do tin cay khac: hai nguoi cung diem tong nhung bang chung khac (tinh bang trong so chi kha dung)
    const w: Weights = { experience: 0, reliability: 0, availability: 1, declared: 0 };
    const a1 = cand('lo', [hist('l', 'alpha', 90)]); // e = 0,5 -> tin cay thap
    const a2 = cand('hi', [hist('h1', 'alpha', 0), hist('h2', 'alpha', 0)]); // e = 2 -> tin cay cao hon
    const eq = rankCandidates(CARD, [a1, a2], ctx({ weights: w }));
    expect(eq[0]!.score).toBe(eq[1]!.score);
    expect(eq.map((r) => r.userId)).toEqual(['hi', 'lo']);

    // Khong co diem (NO_DATA) xuong cuoi, du userId dung dau bang chu cai
    const wNull: Weights = { experience: 1, reliability: 0, availability: 0, declared: 0 };
    const withNull = rankCandidates(CARD, [cand('aaa'), cand('zzz', [hist('z', 'alpha', 0)])], ctx({ weights: wNull }));
    expect(withNull.map((r) => r.userId)).toEqual(['zzz', 'aaa']);
    expect(withNull[1]!.score).toBeNull();
    expect(withNull[1]!.flags).toContain('NO_DATA');

    // MOI hoan vi cua 5 ung vien (2 khong co diem + 3 co diem) cho CUNG thu tu. Bo so sanh sai mot nhanh "null"
    // se tro nen khong nhat quan va ket qua phu thuoc thu tu ma sort goi no - mot thu tu dau vao co the tinh co ra dung.
    const perms = <T,>(a: T[]): T[][] =>
      a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map((p) => [x, ...p]));
    const five = [
      cand('n2'), // khong lich su -> khong co diem (chi tinh kinh nghiem)
      cand('h1', [hist('a1', 'alpha', 0)]), // 1/3
      cand('n1'),
      cand('h2', [hist('b1', 'alpha', 0), hist('b2', 'alpha', 0), hist('b3', 'alpha', 0)]), // 3/5
      cand('h3', [hist('c1', 'alpha', 0), hist('c2', 'alpha', 0)]), // 2/4
    ];
    const allPerms = perms(five);
    expect(allPerms).toHaveLength(120);
    for (const p of allPerms) {
      const r = rankCandidates(CARD, p, ctx({ weights: wNull }));
      expect(r.map((x) => x.userId), p.map((x) => x.userId).join(',')).toEqual(['h2', 'h3', 'h1', 'n1', 'n2']);
      expect(r.map((x) => x.score === null)).toEqual([false, false, false, true, true]);
      expect(r.map((x) => x.rank)).toEqual([1, 2, 3, 4, 5]);
    }

    // Danh sach rong, mot nguoi, userId trung, dau vao dong bang
    expect(rankCandidates(CARD, [], ctx())).toEqual([]);
    expect(rankCandidates(CARD, [c('solo', 0)], ctx())[0]!.rank).toBe(1);
    expect(() => rankCandidates(CARD, [c('dup', 0), c('dup', 1)], ctx())).toThrow(RangeError);
    const frozenList = deepFreeze([c('a', 1), c('b', 0)]);
    const frozenCard = deepFreeze({ ...CARD });
    const frozenCtx = deepFreeze(ctx({ idf: idfFor(['alpha', 'beta']) }));
    expect(() => rankCandidates(frozenCard, frozenList, frozenCtx)).not.toThrow();
    // Voi normalize: 'NONE' (duong tinh tho §5.7 nguyen van) rankCandidates cho ket qua GIONG het scoreCandidate tung
    // nguoi. (Mac dinh la 'MINMAX' nen diem tuong doi trong nhom khac diem tho - xem assign.normalize.test.ts.)
    const single = scoreCandidate(CARD, list[0]!, ctx());
    const fromRank = rankCandidates(CARD, list, ctx({ normalize: 'NONE' })).find((r) => r.userId === 'bob')!;
    const { rank: _rank, ...rest } = fromRank;
    void _rank;
    expect(rest).toEqual(single);
  });
});

describe('Buoc 4 - tham so, trong so va boi canh sai bi tu choi', () => {
  it('RangeError cho tham so / trong so / now / muy khong hop le', () => {
    const c = cand('u', [hist('a', 'alpha', 1)]);
    const bads: [string, Partial<ScoreContext>][] = [
      ['k = 0', { params: { k: 0 } }],
      ['k le', { params: { k: 2.5 } }],
      ['simMin < 0', { params: { simMin: -0.1 } }],
      ['simMin > 1', { params: { simMin: 1.1 } }],
      ['evidenceSaturation < 0', { params: { evidenceSaturation: -1 } }],
      ['shrinkage = 0', { params: { shrinkage: 0 } }],
      ['confidenceScale = 0', { params: { confidenceScale: 0 } }],
      ['halfLife = 0', { params: { halfLifeDays: 0 } }],
      ['defaultWindow < 0', { params: { defaultWindowDays: -1 } }],
      ['trong so am', { weights: { experience: -1, reliability: 1, availability: 1, declared: 0 } }],
      ['trong so NaN', { weights: { experience: Number.NaN, reliability: 1, availability: 1, declared: 0 } }],
      ['tat ca trong so 0', { weights: { experience: 0, reliability: 0, availability: 0, declared: 0 } }],
      ['Ho so am', { weights: { experience: 0.4, reliability: 0.3, availability: 0.3, declared: -0.1 } }],
      ['Ho so NaN', { weights: { experience: 0.4, reliability: 0.3, availability: 0.3, declared: Number.NaN } }],
      // Bo ba khoa kieu cu (test / script khong qua tsc): loi ngay, khong am tham coi Ho so = 0
      ['thieu Ho so', { weights: { experience: 0.45, reliability: 0.3, availability: 0.25 } as unknown as Weights }],
      ['now hong', { now: new Date('x') }],
      ['muy > 1', { groupOnTimeRate: 1.5 }],
      ['muy < 0', { groupOnTimeRate: -0.1 }],
      ['muy NaN', { groupOnTimeRate: Number.NaN }],
    ];
    for (const [name, over] of bads) {
      expect(() => scoreCandidate(CARD, c, ctx(over)), name).toThrow(RangeError);
      expect(() => rankCandidates(CARD, [c], ctx(over)), `rank: ${name}`).toThrow(RangeError);
      // Ke ca khi KHONG co ung vien (buildProfile khong che duoc viec kiem tra boi canh)
      expect(() => rankCandidates(CARD, [], ctx(over)), `rank rong: ${name}`).toThrow(RangeError);
    }
    // Ranh gioi hop le: evidenceSaturation = 0 khong chia 0; muy = 0 va 1
    for (const p of [{ evidenceSaturation: 0 }, { simMin: 0 }, { simMin: 1 }]) {
      const r = scoreCandidate(CARD, c, ctx({ params: p }));
      expect(numbersOf(r).every(Number.isFinite), JSON.stringify(p)).toBe(true);
    }
    for (const mu of [0, 1]) expect(scoreCandidate(CARD, c, ctx({ groupOnTimeRate: mu })).score).not.toBeNull();
  });
});

describe('Buoc 4 - tinh chat tren 300 tinh huong ngau nhien (hat giong co dinh)', () => {
  it('diem trong [0,100]; thanh phan trong [0,1]; ti trong cong lai 1; bang chung hop le; khong NaN; tat dinh', () => {
    let s = 20260920;
    const next = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const pick = <T,>(a: readonly T[]) => a[Math.floor(next() * a.length)]!;
    const words = ['alpha', 'beta', 'gamma', 'delta', 'omega', 'sigma'];
    const text = () => Array.from({ length: 1 + Math.floor(next() * 4) }, () => pick(words)).join(' ');
    const idf = idfFor(Array.from({ length: 12 }, text));

    let withScore = 0;
    let noHistory = 0;
    let overloaded = 0;
    for (let n = 0; n < 300; n += 1) {
      const card: ScoreCard = {
        id: 'q',
        title: text(),
        description: next() < 0.5 ? text() : null,
        startDate: next() < 0.6 ? at(Math.floor(next() * 40 - 10)) : null,
        dueDate: next() < 0.6 ? at(Math.floor(next() * 40 - 10)) : null,
      };
      const history: HistoryCard[] = Array.from({ length: Math.floor(next() * 13) }, (_, i) => {
        const age = Math.floor(next() * 500 - 30); // co ca the "tuong lai"
        return {
          cardId: `h${i}`,
          title: text(),
          description: next() < 0.3 ? text() : null,
          completedAt: ago(age),
          dueDate: next() < 0.75 ? ago(age + Math.floor(next() * 20 - 10)) : null,
          reopened: next() < 0.2,
        };
      });
      const openCards: OpenCard[] = Array.from({ length: Math.floor(next() * 9) }, (_, i) =>
        open(`o${i}`, next() < 0.7 ? at(Math.floor(next() * 40 - 20)) : null, next() < 0.7 ? at(Math.floor(next() * 40 - 20)) : null)
      );
      const input = cand('u', history, openCards, {
        maxParallelCards: 1 + Math.floor(next() * 6),
        pausedUntil: next() < 0.1 ? at(Math.floor(next() * 30 - 10)) : null,
      });
      const weights: Weights = { experience: next(), reliability: next(), availability: next() + 0.01, declared: 0 };
      const c = ctx({ idf, groupOnTimeRate: next() < 0.85 ? next() : null, weights });

      const r: CandidateScore = scoreCandidate(card, input, c);
      expect(scoreCandidate(card, input, c)).toEqual(r); // tat dinh
      expect(numbersOf(r).every(Number.isFinite)).toBe(true);
      if (r.score !== null) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
        const shares = r.components.experience.share + r.components.reliability.share + r.components.availability.share;
        expect(shares).toBeCloseTo(1, 9);
        withScore += 1;
      } else {
        expect(r.flags).toContain('NO_DATA');
      }
      for (const comp of Object.values(r.components)) {
        if (comp.value !== null) {
          expect(comp.value).toBeGreaterThanOrEqual(0);
          expect(comp.value).toBeLessThanOrEqual(1);
        } else {
          expect(comp.share).toBe(0);
        }
      }
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThan(1);
      expect(r.confidenceLevel).toBe(confidenceLevelOf(r.confidence));
      expect(r.evidence.length).toBeLessThanOrEqual(DEFAULT_PARAMS.k);
      let mass = 0;
      for (let i = 0; i < r.evidence.length; i += 1) {
        const e = r.evidence[i]!;
        expect(e.sim).toBeGreaterThan(0);
        expect(e.sim).toBeLessThanOrEqual(1);
        expect(e.sim).toBeGreaterThanOrEqual(DEFAULT_PARAMS.simMin);
        expect(e.weight).toBeGreaterThan(0);
        expect(e.weight).toBeLessThanOrEqual(1);
        expect(e.completedAt.getTime()).toBeLessThanOrEqual(NOW.getTime()); // khong the tuong lai
        if (i > 0) expect(e.sim).toBeLessThanOrEqual(r.evidence[i - 1]!.sim);
        mass += e.weight;
      }
      expect(r.evidenceMass).toBeCloseTo(mass, 9);
      expect(r.load).toBeLessThanOrEqual(openCards.length);
      expect(r.flags.includes('NO_HISTORY')).toBe(r.evidence.length === 0 && r.components.experience.value === null);
      if (r.flags.includes('NO_HISTORY')) {
        noHistory += 1;
        expect(r.components.experience.value).toBeNull();
        expect(r.components.reliability.value).toBeNull();
      }
      if (r.flags.includes('OVERLOADED')) {
        overloaded += 1;
        expect(r.load).toBeGreaterThanOrEqual(r.capacity);
      }
    }
    // Bo sinh co du cac truong hop
    expect(withScore).toBeGreaterThan(250);
    expect(noHistory).toBeGreaterThan(5);
    expect(overloaded).toBeGreaterThan(5);
  });
});

describe('Buoc 4 - chot chan kien truc va kiem tra nhanh tren du lieu mo phong', () => {
  it('cac tep loi chi import lan nhau va ai.rules: khong Prisma, khong cau hinh, khong simGenerator/simVocab/scripts', () => {
    const pure = ['assign.text', 'assign.tfidf', 'assign.profile', 'assign.declared', 'assign.score'];
    const allowed = new Set(['./assign.text', './assign.tfidf', './assign.profile', './assign.declared', '../ai/ai.rules']);
    let imports = 0;
    for (const f of pure) {
      const src = readFileSync(`src/modules/assign/${f}.ts`, 'utf8');
      const specs = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
      for (const sp of specs) {
        expect(allowed.has(sp), `${f} import "${sp}"`).toBe(true);
        imports += 1;
      }
      // Danh sach import cho phep o tren la phep kiem chinh (quet ca chu thich se khop chu "Prisma" trong
      // ghi chu). Chan them cach lach: require() va import() dong.
      expect(src, f).not.toMatch(/\brequire\s*\(|\bimport\s*\(/);
    }
    expect(imports).toBeGreaterThanOrEqual(6);
  });

  it('replayTargets va componentSpread nhat quan: dung tap tinh huong, xep hang du ho boi, do phan tan hop le', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: 3 });
    const targets = [...replayTargets(data)];
    expect(targets.length).toBeGreaterThan(90);
    for (const t of targets) {
      expect(t.card.assignedDay).toBeGreaterThanOrEqual(60);
      expect(t.pool.length).toBeGreaterThanOrEqual(2);
      expect(t.ranked.map((r) => r.userId).sort()).toEqual(t.pool.map((p) => p.key).sort()); // du ho boi, khong trung
      expect(t.ranked.map((r) => r.rank)).toEqual(t.ranked.map((_, i) => i + 1));
      expect(t.pool.some((p) => p.key === t.best.key)).toBe(true);
      expect(t.skillOf(t.best.key)).toBeCloseTo(t.best.skill, 12);
    }
    // minDay loc dung
    const late = [...replayTargets(data, { minDay: 200 })];
    expect(late.length).toBeGreaterThan(0);
    expect(late.length).toBeLessThan(targets.length);
    expect(late.every((t) => t.card.assignedDay >= 200)).toBe(true);
    // replay() dem dung so muc tieu do replayTargets sinh ra
    expect(replay(data).n).toBe(targets.length);

    const sp = componentSpread([data]);
    for (const k of ['experience', 'reliability', 'availability'] as const) {
      const s = sp[k];
      expect(s.n, k).toBeGreaterThan(50);
      expect(s.mean).toBeGreaterThanOrEqual(0);
      expect(s.mean).toBeLessThanOrEqual(1);
      expect(s.sd).toBeGreaterThanOrEqual(0);
      expect(s.range).toBeGreaterThanOrEqual(s.sd); // khoang luon >= do lech chuan
      expect(Math.abs(s.corrWithSkill)).toBeLessThanOrEqual(1);
    }
    // Trong so chi kha dung: moi the co du lieu kha dung (khong ai bi thieu) nen n = so muc tieu
    expect(componentSpread([data], { weights: { experience: 0, reliability: 0, availability: 1, declared: 0 } }).availability.n).toBe(targets.length);
  });

  it('phat lai lich su: kinh nghiem + tin cay hon ngau nhien o MOI hat giong (chot chan "bo cham khong vo nghia")', () => {
    // Chi la kiem tra nhanh, KHONG phai danh gia (khong nhanh nen, khong khoang tin cay): do duoc top-1 26,0-55,6% va hoi tiec
    // 0,138-0,197 tren 7 hat giong, so voi ngau nhien ~19,5% va 0,26-0,35. Nguong dat duoi cac muc do do.
    const weights: Weights = { experience: 0.6, reliability: 0.4, availability: 0, declared: 0 };
    const seeds = [DEFAULT_SIM.seed, 1, 2, 3, 4, 5, 6];
    const rows = seeds.map((seed) => replay(generateSimulation({ ...DEFAULT_SIM, seed }), { weights }));
    for (const [i, r] of rows.entries()) {
      expect(r.n, `seed ${seeds[i]}`).toBeGreaterThan(90);
      expect(r.hitScorer, `seed ${seeds[i]} top-1`).toBeGreaterThan(r.hitRandom + 0.03);
      expect(r.regretScorer, `seed ${seeds[i]} hoi tiec`).toBeLessThan(r.regretRandom - 0.04);
    }
    const mean = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
    expect(mean((r) => r.hitScorer)).toBeGreaterThan(0.33);
    expect(mean((r) => r.hitRandom)).toBeLessThan(0.21);
  });

  it('buoc 11: thanh phan Ho so CHUA tinh -> trong so Ho so bat ky khong doi diem, ti trong, thu tu (ca scoreCandidate va rankCandidates)', () => {
    const people = [
      cand('a', [hist('a1', 'alpha', 0)], [open('o', null, null)]),
      cand('b', [hist('b1', 'alpha beta', 30), hist('b2', 'gamma', 5)]),
      cand('c', [], [open('p', null, null), open('q', null, null)]),
    ];
    const base: Weights = { experience: 0.5, reliability: 0.3, availability: 0.2, declared: 0 };
    const strip = (r: CandidateScore) => ({ score: r.score, shares: Object.values(r.components).map((x) => x.share) });
    for (const declared of [0.05, 0.2, 0.7, 5]) {
      const w = { ...base, declared };
      for (const p of people) {
        const x = strip(scoreCandidate(CARD, p, ctx({ weights: w })));
        const y = strip(scoreCandidate(CARD, p, ctx({ weights: base })));
        expect(x.score, `${p.userId} d=${declared}`).toBeCloseTo(y.score!, 9);
        x.shares.forEach((v, i) => expect(v).toBeCloseTo(y.shares[i]!, 12));
      }
      for (const normalize of ['MINMAX', 'NONE'] as const) {
        const rx = rankCandidates(CARD, people, ctx({ weights: w, normalize }));
        const ry = rankCandidates(CARD, people, ctx({ weights: base, normalize }));
        expect(rx.map((r) => r.userId)).toEqual(ry.map((r) => r.userId));
        rx.forEach((r, i) => expect(r.score).toBeCloseTo(ry[i]!.score!, 9));
      }
    }
    // Chi co trong so o Ho so: khong thanh phan nao co du lieu duoc tinh -> NO_DATA (khong chia cho 0)
    const onlyDeclared = scoreCandidate(CARD, people[0]!, ctx({ weights: { experience: 0, reliability: 0, availability: 0, declared: 1 } }));
    expect(onlyDeclared.score).toBeNull();
    expect(onlyDeclared.flags).toContain('NO_DATA');
  });

  it('buoc 11 (§17.6): mac dinh MOI xep hang Y NHU bo cu 0,45 / 0,30 / 0,25 tren bo mo phong (moi the, moi ung vien)', () => {
    let n = 0;
    for (const seed of [DEFAULT_SIM.seed, 1, 2]) {
      const data = generateSimulation({ ...DEFAULT_SIM, seed });
      const legacy = [...replayTargets(data)]; // mac dinh cua bo phat lai = LEGACY_WEIGHTS_V1
      const fresh = [...replayTargets(data, { weights: DEFAULT_WEIGHTS })];
      expect(fresh.length).toBe(legacy.length);
      legacy.forEach((t, i) => {
        const f = fresh[i]!;
        expect(f.ranked.map((r) => r.userId), `${seed} ${t.card.key}`).toEqual(t.ranked.map((r) => r.userId));
        f.ranked.forEach((r, j) => {
          const old = t.ranked[j]!;
          if (old.score === null) expect(r.score).toBeNull();
          else expect(Math.abs(r.score! - old.score)).toBeLessThan(1e-9);
          expect(r.components.experience.weight).toBe(0.36);
          expect(old.components.experience.weight).toBe(0.45);
        });
        n += 1;
      });
    }
    expect(n).toBeGreaterThan(250);
  });
});
