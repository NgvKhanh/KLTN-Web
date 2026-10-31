// Buoc 12 - thanh phan "Ho so" (ho so tu khai, ASSIGN_MODULE.md §17.3-17.5). HAM THUAN, khong can DB.
//  (1) cat muc: ky nang / cong viec / doan CV - tach, lam sach, bo trung, gioi han, thoi gian tuyen tinh;
//  (2) vectorizeKnown: bo tu chua tung thay (df = 0) truoc khi chuan hoa;
//  (3) gia tri Ho so = max cosine (>= simMin), bang chung, thu tu hoa, rieng tu cua CV;
//  (4) trong bo cham: co NO_PROFILE, khong gop vao tin cay, thieu du lieu THEO THANH PHAN (DROP / NEUTRAL / ZERO) - so tinh tay.
import { describe, expect, it } from 'vitest';
import {
  DECLARED_CHUNK_CHARS,
  DECLARED_EVIDENCE_LIMIT,
  DECLARED_MAX_CV_CHUNKS,
  DECLARED_MAX_SKILL_ITEMS,
  DECLARED_MAX_WORK_ITEMS,
  cvChunks,
  declaredItems,
  scoreDeclared,
  type DeclaredItem,
  type DeclaredProfile,
} from '../src/modules/assign/assign.declared';
import {
  COMPONENT_KEYS,
  DEFAULT_MISSING,
  LEGACY_WEIGHTS_V1,
  rankCandidates,
  scoreCandidate,
  type CandidateInput,
  type ScoreContext,
  type Weights,
} from '../src/modules/assign/assign.score';
import { countTerms } from '../src/modules/assign/assign.text';
import { buildIdf, cosine, vectorize, vectorizeKnown, type Idf } from '../src/modules/assign/assign.tfidf';
import { DEFAULT_SIM, generateSimulation, Rng } from '../src/scripts/simGenerator';
import { replayTargets } from '../src/scripts/simReplay';

const NOW = new Date('2026-09-20T00:00:00.000Z');
const DAY = 86_400_000;
const idfFor = (titles: string[]): Idf => buildIdf(titles.map((t) => countTerms({ title: t })));
/** Kho: alpha / beta / gamma moi tu df = 1, N = 3 -> idf = ln(4/2) + 1 nhu nhau cho ca ba. */
const IDF = idfFor(['alpha', 'beta', 'gamma']);
const qOf = (title: string) => vectorize(countTerms({ title }), IDF);
const items = (p: DeclaredProfile) => declaredItems(p);
const ids = (xs: readonly DeclaredItem[]) => xs.map((x) => x.itemId);

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !(v instanceof Date) && !(v instanceof Map)) {
    Object.freeze(v);
    for (const x of Object.values(v as object)) deepFreeze(x);
  }
  return v;
}

describe('hang so (§17.3)', () => {
  it('50 cum ky nang, 30 cong viec, doan CV <= 400 ky tu, 50 doan, 3 dong bang chung', () => {
    expect([DECLARED_MAX_SKILL_ITEMS, DECLARED_MAX_WORK_ITEMS, DECLARED_CHUNK_CHARS, DECLARED_MAX_CV_CHUNKS, DECLARED_EVIDENCE_LIMIT]).toEqual([
      50, 30, 400, 50, 3,
    ]);
  });
});

describe('declaredItems - cum ky nang', () => {
  it('tach theo xuong dong , ; • |, bo khoang trang thua va manh rong; giu chu goc lam tieu de', () => {
    const got = items({ skillsText: '  React ,Node   js; SQL\n• Docker | kiểm thử\n,, ;  ' });
    expect(got.map((x) => x.title)).toEqual(['React', 'Node js', 'SQL', 'Docker', 'kiểm thử']);
    expect(ids(got)).toEqual(['skill:0', 'skill:1', 'skill:2', 'skill:3', 'skill:4']);
    expect(got.every((x) => x.kind === 'SKILL')).toBe(true);
    // Dem nhu MO TA (khong nhan tieu de x2)
    expect(got[4]!.counts).toEqual(countTerms({ title: '', description: 'kiểm thử' }));
  });

  it('bo trung sau khi ha chu thuong + bo dau + gop khoang trang; giu lan xuat hien DAU', () => {
    const got = items({ skillsText: 'Kiểm thử, kiem   THU, KIỂM THỬ\nReact, react' });
    expect(got.map((x) => x.title)).toEqual(['Kiểm thử', 'React']);
    expect(ids(got)).toEqual(['skill:0', 'skill:1']);
  });

  it('cum khong con thuat ngu nao (qua ngan, hu tu, toan so) bi bo va KHONG chiem so thu tu', () => {
    const got = items({ skillsText: 'C, và, 2026, SQL' });
    expect(got.map((x) => [x.itemId, x.title])).toEqual([['skill:0', 'SQL']]);
  });

  it('toi da 50 cum (trung khong tinh vao gioi han)', () => {
    const phrases = Array.from({ length: 70 }, (_, i) => `ky nang so ${i} abc${i}`);
    const got = items({ skillsText: ['ky nang so 0 abc0', ...phrases].join(', ') });
    expect(got).toHaveLength(DECLARED_MAX_SKILL_ITEMS);
    expect(got[49]!.title).toBe('ky nang so 49 abc49');
  });
});

describe('declaredItems - cong viec da lam', () => {
  it('tieu de x2 + mo ta (nhu the), giu thu tu, toi da 30; muc khong co thuat ngu bi bo va danh so lien tuc', () => {
    const work = Array.from({ length: 35 }, (_, i) => ({ title: `  Du an ${i} websocket${i}  `, description: i === 0 ? 'realtime' : null }));
    work.splice(1, 0, { title: '   ', description: 'và' });
    const got = items({ workItems: work });
    expect(got).toHaveLength(29); // 30 muc dau (co mot muc rong) -> 29
    expect(got[0]!).toMatchObject({ kind: 'WORK', itemId: 'work:0', title: 'Du an 0 websocket0' });
    expect(got[0]!.counts).toEqual(countTerms({ title: '  Du an 0 websocket0  ', description: 'realtime' }));
    expect(got[1]!).toMatchObject({ itemId: 'work:1', title: 'Du an 1 websocket1' });
    expect(got[28]!.title).toBe('Du an 28 websocket28');
  });

  it('tieu de rong nhung mo ta co noi dung -> muc van dung, tieu de = null', () => {
    const got = items({ workItems: [{ title: '  ', description: 'toi uu truy van' }] });
    expect(got).toHaveLength(1);
    expect(got[0]!.title).toBeNull();
  });
});

describe('cvChunks / muc CV', () => {
  it('tach theo dong trong va gach dau dong, bo ky tu gach, gom manh lien nhau bang xuong dong', () => {
    const cv = 'Học vấn: ĐH Bách khoa\n\n- Làm React\n* Viết API Node\nTiếp dòng API\n\n\n• Sở thích: bóng đá';
    expect(cvChunks(cv)).toEqual(['Học vấn: ĐH Bách khoa\nLàm React\nViết API Node Tiếp dòng API\nSở thích: bóng đá']);
    // Dau gach khong kem dau cach (vd "-5%") khong phai gach dau dong; dong chi co gach van ngat manh nhung khong de lai gi
    expect(cvChunks('-5% chi phi\ntiep\n-\nabc')).toEqual(['-5% chi phi tiep\nabc']);
  });

  it('bien gom: dung 400 ky tu thi gom, 401 thi sang doan moi', () => {
    const a = 'a'.repeat(199);
    expect(cvChunks(`${a}\n\n${'b'.repeat(200)}`)).toEqual([`${a}\n${'b'.repeat(200)}`]);
    expect(cvChunks(`${a}\n\n${'b'.repeat(201)}`)).toEqual([a, 'b'.repeat(201)]);
  });

  it('manh dai cat O KHOANG TRANG (khong chat doi tu), moi doan <= 400; khong co khoang trang thi cat cung', () => {
    const words = 'word '.repeat(100).trim();
    const chunks = cvChunks(words);
    expect(chunks).toHaveLength(2);
    expect(chunks.every((c) => c.length <= DECLARED_CHUNK_CHARS)).toBe(true);
    expect(chunks.join(' ').split(/\s+/).every((w) => w === 'word')).toBe(true);
    expect(chunks.join(' ').split(/\s+/)).toHaveLength(100);
    expect(cvChunks('x'.repeat(1000)).map((c) => c.length)).toEqual([400, 400, 200]);
    // Tu 7 ky tu ("abcdef "): vi tri 400 roi GIUA tu -> phai lui ve khoang trang, khong chat doi tu
    const odd = cvChunks('abcdef '.repeat(100).trim());
    expect(odd.join(' ').split(/\s+/).every((w) => w === 'abcdef')).toBe(true);
    expect(odd[0]!.length).toBe(398);
  });

  it('chi lay 50 doan dau; CV rat dai (2 trieu ky tu) van xong nhanh - thoi gian tuyen tinh', () => {
    const para = (i: number) => `doan ${i} ` + 'noi dung '.repeat(42);
    const many = Array.from({ length: 80 }, (_, i) => para(i)).join('\n\n');
    const got = cvChunks(many);
    expect(got).toHaveLength(DECLARED_MAX_CV_CHUNKS);
    expect(got[0]!.startsWith('doan 0 ')).toBe(true);
    expect(got[49]!.startsWith('doan 49 ')).toBe(true);
    const t0 = Date.now();
    expect(cvChunks('ab '.repeat(700_000))).toHaveLength(DECLARED_MAX_CV_CHUNKS);
    expect(cvChunks('x'.repeat(2_000_000))).toHaveLength(DECLARED_MAX_CV_CHUNKS);
    expect(items({ cvText: 'noi dung '.repeat(250_000) })).toHaveLength(DECLARED_MAX_CV_CHUNKS);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it('muc CV: title LUON null, dem nhu mo ta; doan khong co thuat ngu bi bo', () => {
    const got = items({ cvText: 'Kinh nghiệm React\n\n' + 'x'.repeat(401) });
    expect(got.map((x) => [x.kind, x.itemId, x.title])).toEqual([['CV', 'cv:0', null]]);
    expect(got[0]!.counts).toEqual(countTerms({ title: '', description: 'Kinh nghiệm React' }));
  });
});

describe('declaredItems - tong the', () => {
  it('thu tu SKILL -> WORK -> CV; khong co ho so / cac o rong -> []', () => {
    const got = items({ cvText: 'python', workItems: [{ title: 'java' }], skillsText: 'golang' });
    expect(ids(got)).toEqual(['skill:0', 'work:0', 'cv:0']);
    for (const p of [null, undefined, {}, { skillsText: '', workItems: [], cvText: '' }, { skillsText: null, workItems: null, cvText: null }]) {
      expect(declaredItems(p as DeclaredProfile | null)).toEqual([]);
    }
  });

  it('khong sua dau vao (ho so dong bang)', () => {
    const p = deepFreeze({ skillsText: 'React, SQL', workItems: [{ title: 'API', description: 'Node' }], cvText: 'Docker' });
    expect(() => declaredItems(p)).not.toThrow();
  });
});

describe('vectorizeKnown (§17.4)', () => {
  it('bo thuat ngu df = 0 roi moi chuan hoa: "alpha zzz" = vec-to cua "alpha" (tinh tay), khac vectorize thuong', () => {
    const counts = countTerms({ title: '', description: 'alpha zzz' });
    const known = vectorizeKnown(counts, IDF);
    expect([...known.keys()]).toEqual(['alpha']);
    expect(known.get('alpha')).toBeCloseTo(1, 12);
    // vectorize thuong giu "zzz" va "alpha zzz" (idf LON NHAT = ln 4 + 1) -> alpha chi con 1,693 / sqrt(1,693^2 + 2 x 2,386^2)
    const idfA = Math.log(4 / 2) + 1;
    const idfZ = Math.log(4 / 1) + 1;
    expect(vectorize(counts, IDF).get('alpha')).toBeCloseTo(idfA / Math.sqrt(idfA ** 2 + 2 * idfZ ** 2), 12);
  });

  it('toan tu ngoai kho -> vec-to rong; khong co tu nao bi bo thi trung vectorize', () => {
    expect(vectorizeKnown(countTerms({ title: 'zzz qqq' }), IDF).size).toBe(0);
    const c = new Map([['alpha', 2], ['beta', 1]]);
    expect([...vectorizeKnown(c, IDF)]).toEqual([...vectorize(c, IDF)]);
  });
});

describe('scoreDeclared - gia tri va bang chung (§17.4)', () => {
  const q = qOf('alpha');

  it('so tinh tay: "alpha" = 1; "alpha gamma" = 1/sqrt(2) (bi-gram df = 0 bi bo); "beta" = 0 (khong tinh)', () => {
    const its = items({ skillsText: 'beta, alpha gamma', workItems: [{ title: 'alpha' }] });
    const r = scoreDeclared(q, its, IDF, 0.05);
    expect(r.value).toBeCloseTo(1, 12);
    expect(r.evidence.map((e) => [e.itemId, e.kind, e.title])).toEqual([
      ['work:0', 'WORK', 'alpha'],
      ['skill:1', 'SKILL', 'alpha gamma'],
    ]);
    expect(r.evidence[1]!.sim).toBeCloseTo(Math.SQRT1_2, 12);
    // Chi co muc vua phai: gia tri chinh la muc giong nhat
    expect(scoreDeclared(q, items({ skillsText: 'beta, alpha gamma' }), IDF, 0.05).value).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('khong co muc -> null (NO_PROFILE); co muc ma khong muc nao du giong -> 0 (khong NaN)', () => {
    expect(scoreDeclared(q, [], IDF, 0.05)).toEqual({ value: null, evidence: [] });
    for (const p of [{ skillsText: 'beta, gamma' }, { skillsText: 'zzz qqq, www' }]) {
      const r = scoreDeclared(q, items(p), IDF, 0.05);
      expect(r).toEqual({ value: 0, evidence: [] });
    }
  });

  it('nguong simMin: duoi nguong khong tinh; DUNG bang nguong van tinh; sim = 0 khong bao gio tinh du simMin = 0', () => {
    const its = items({ skillsText: 'alpha gamma' }); // sim = 1/sqrt(2)
    const sim = scoreDeclared(q, its, IDF, 0).value!;
    expect(sim).toBeCloseTo(Math.SQRT1_2, 12);
    expect(scoreDeclared(q, its, IDF, sim).value).toBe(sim);
    expect(scoreDeclared(q, its, IDF, sim + 1e-12)).toEqual({ value: 0, evidence: [] });
    const zero = scoreDeclared(q, items({ skillsText: 'beta' }), IDF, 0);
    expect(zero).toEqual({ value: 0, evidence: [] });
  });

  it('hoa do giong: WORK -> SKILL -> CV, cung loai thi theo vi tri; toi da 3 dong', () => {
    const its = items({ skillsText: 'alpha, alpha beta', workItems: [{ title: 'gamma' }, { title: 'alpha' }], cvText: 'alpha' });
    // "alpha" o SKILL, WORK, CV deu sim 1 (sau chuan hoa, du dem khac nhau)
    const r = scoreDeclared(q, its, IDF, 0.05);
    expect(r.evidence.map((e) => e.itemId)).toEqual(['work:1', 'skill:0', 'cv:0']);
    const twoSkills = items({ skillsText: 'gamma alpha, alpha gamma' }); // khac thu tu tu -> hai cum, cung do giong
    const t = scoreDeclared(q, twoSkills, IDF, 0.05);
    expect(t.evidence.map((e) => e.itemId)).toEqual(['skill:0', 'skill:1']);
  });

  it('muc CV KHONG BAO GIO mang chu ra ngoai, ke ca khi muc duoc dung tay co title', () => {
    const forged: DeclaredItem = { kind: 'CV', index: 0, itemId: 'cv:0', title: 'bi mat', counts: countTerms({ title: '', description: 'alpha' }) };
    expect(scoreDeclared(q, [forged], IDF, 0.05).evidence[0]!.title).toBeNull();
  });

  it('THEM muc khong bao gio lam gia tri giam; CHEP mot muc nhieu lan khong doi gia tri (300 tinh huong ngau nhien)', () => {
    const rng = new Rng(1212);
    const vocab = ['alpha', 'beta', 'gamma', 'zzz', 'delta', 'alpha beta'];
    const phrase = () => Array.from({ length: 1 + rng.int(3) }, () => rng.pick(vocab)).join(' ');
    for (let i = 0; i < 300; i += 1) {
      const card = qOf(phrase());
      const base = items({ skillsText: Array.from({ length: 1 + rng.int(4) }, phrase).join(', ') });
      const more = [...base, ...items({ cvText: phrase(), workItems: [{ title: phrase() }] })];
      const a = scoreDeclared(card, base, IDF, 0.05).value!;
      const b = scoreDeclared(card, more, IDF, 0.05).value!;
      expect(b).toBeGreaterThanOrEqual(a);
      const dup = [...base, ...base.map((x) => ({ ...x, index: x.index + 100, itemId: `skill:${x.index + 100}` }))];
      expect(scoreDeclared(card, dup, IDF, 0.05).value).toBe(a);
      expect(Number.isNaN(b)).toBe(false);
    }
  });
});

// ===================== Trong bo cham =====================

const CARD = { id: 'c', title: 'alpha' };
const CARD_IDF = idfFor(['alpha', 'beta', 'gamma', 'delta']);
const ctx = (over: Partial<ScoreContext> = {}): ScoreContext => ({ idf: CARD_IDF, now: NOW, groupOnTimeRate: 0.5, ...over });
const openCard = (id: string) => ({ cardId: id, startDate: null, dueDate: null });
const cand = (userId: string, profile: DeclaredProfile | null, open = 0, history: CandidateInput['history'] = []): CandidateInput => ({
  userId,
  history,
  openCards: Array.from({ length: open }, (_, i) => openCard(`${userId}-o${i}`)),
  declared: profile ? declaredItems(profile) : null,
});
const W: Weights = { experience: 0, reliability: 0, availability: 0.5, declared: 0.5 };

describe('bo cham: thanh phan Ho so, co NO_PROFILE, khong gop vao tin cay', () => {
  it('scoreCandidate: gia tri, trong so, bang chung Ho so; khong ho so -> null + NO_PROFILE (sau co lich su, truoc qua tai)', () => {
    const r = scoreCandidate(CARD, cand('p', { skillsText: 'alpha, beta' }), ctx({ weights: W }));
    expect(r.components.declared).toMatchObject({ value: 1, weight: 0.5, scaled: 1, share: 0.5 });
    expect(r.declaredEvidence).toEqual([{ kind: 'SKILL', itemId: 'skill:0', title: 'alpha', sim: 1 }]);
    expect(r.flags).toEqual(['NO_HISTORY']);
    // Co khai nhung KHONG khop: gia tri 0, KHONG phai NO_PROFILE
    const miss = scoreCandidate(CARD, cand('q', { skillsText: 'beta' }), ctx({ weights: W }));
    expect(miss.components.declared.value).toBe(0);
    expect(miss.flags).toEqual(['NO_HISTORY']);
    const none = scoreCandidate(CARD, cand('n', null, 5), ctx({ weights: W }));
    expect(none.components.declared.value).toBeNull();
    expect(none.declaredEvidence).toEqual([]);
    expect(none.flags).toEqual(['NO_HISTORY', 'NO_PROFILE', 'OVERLOADED']);
    // Ho so rong sau khi lam sach cung la NO_PROFILE
    expect(scoreCandidate(CARD, cand('e', { skillsText: ' , và' }), ctx()).flags).toContain('NO_PROFILE');
  });

  it('tin cay / confidence / bang chung lich su KHONG doi khi them ho so (chua kiem chung, §17.1)', () => {
    const hist = [{ cardId: 'h', title: 'alpha', description: null, completedAt: new Date(NOW.getTime() - 3 * DAY), dueDate: NOW, reopened: false }];
    const a = scoreCandidate(CARD, cand('u', null, 0, hist), ctx());
    const b = scoreCandidate(CARD, cand('u', { skillsText: 'alpha', cvText: 'alpha beta' }, 0, hist), ctx());
    expect([b.confidence, b.evidenceMass, b.fit]).toEqual([a.confidence, a.evidenceMass, a.fit]);
    expect(b.evidence).toEqual(a.evidence);
    // GIA TRI khong doi; ti trong thi doi (Ho so vao phep cong) - dung
    expect(b.components.reliability.value).toBe(a.components.reliability.value);
    expect(b.components.experience.value).toBe(a.components.experience.value);
    expect(b.components.declared.share).toBeGreaterThan(0);
    expect(b.components.reliability.share).toBeLessThan(a.components.reliability.share);
  });

  it('XEP HANG voi ba cach xu ly thieu Ho so - so tinh tay (kha dung 0,8 / 0,8 / 1 -> chuan hoa 0 / 0 / 1)', () => {
    // P khai khop (1), Q khai khong khop (0), R KHONG khai nhung ranh hon
    const people = [cand('P', { skillsText: 'alpha' }, 1), cand('Q', { skillsText: 'beta' }, 1), cand('R', null, 0)];
    const by = (missing: ScoreContext['missing']) => new Map(rankCandidates(CARD, people, ctx({ weights: W, missing })).map((r) => [r.userId, r]));
    // DROP: R chi con kha dung (1) -> 100; P = 0,5 x 0 + 0,5 x 1 = 50; Q = 0
    const drop = by({ declared: 'DROP' });
    expect([drop.get('R')!.score, drop.get('P')!.score, drop.get('Q')!.score]).toEqual([100, 50, 0]);
    expect(drop.get('R')!.components.declared.scaled).toBeNull();
    // NEUTRAL: R nhan trung binh Ho so (1 + 0) / 2 = 0,5 -> 0,5 x 1 + 0,5 x 0,5 = 75 (khong khai khong con "loi" tron)
    const neutral = by({ declared: 'NEUTRAL' });
    expect(neutral.get('R')!.score).toBeCloseTo(75, 9);
    expect(neutral.get('R')!.components.declared).toMatchObject({ value: null, scaled: 0.5 });
    expect(neutral.get('R')!.flags).toContain('NO_PROFILE');
    // ZERO (chi de do): R nhu nguoi khai khong khop -> 0,5 x 1 + 0 = 50; hoa P (50) -> userId
    const zero = rankCandidates(CARD, people, ctx({ weights: W, missing: { declared: 'ZERO' } }));
    expect(zero.map((r) => [r.userId, r.score])).toEqual([['P', 50], ['R', 50], ['Q', 0]]);
    expect(zero.find((r) => r.userId === 'R')!.components.declared).toMatchObject({ value: null, scaled: 0 });
    // ZERO dien 0 TRUOC chuan hoa: khi nguoi khai thap nhat > 0 (S = 1/sqrt 2), 0 cua R thanh day moi -> S giu 0,707 (khong ve 0)
    const z2 = rankCandidates(CARD, [cand('P', { skillsText: 'alpha' }), cand('S', { skillsText: 'alpha gamma' }), cand('R', null)], ctx({ weights: W, missing: { declared: 'ZERO' } }));
    const zs = new Map(z2.map((r) => [r.userId, r.components.declared.scaled]));
    expect(zs.get('S')).toBeCloseTo(Math.SQRT1_2, 12);
    expect([zs.get('P'), zs.get('R')]).toEqual([1, 0]);
    // Mac dinh (khong truyen) = NEUTRAL cho Ho so
    expect(rankCandidates(CARD, people, ctx({ weights: W })).map((r) => r.score)).toEqual(
      rankCandidates(CARD, people, ctx({ weights: W, missing: { declared: 'NEUTRAL' } })).map((r) => r.score)
    );
  });

  it('missing: mot gia tri ap cho CA BON thanh phan; ban ghi thieu khoa lay theo mac dinh; sai -> RangeError', () => {
    expect(DEFAULT_MISSING).toEqual({ experience: 'DROP', reliability: 'DROP', availability: 'DROP', declared: 'NEUTRAL' });
    const people = [cand('P', { skillsText: 'alpha' }, 1), cand('Q', { skillsText: 'beta' }, 1), cand('R', null, 0)];
    const score = (missing: ScoreContext['missing']) => rankCandidates(CARD, people, ctx({ weights: W, missing })).map((r) => [r.userId, r.score]);
    expect(score('DROP')).toEqual(score({ declared: 'DROP' }));
    expect(score('ZERO')).toEqual(score({ declared: 'ZERO' }));
    expect(score({})).toEqual(score(undefined));
    for (const bad of ['drop', 'X', { declared: 'MAYBE' }, { declard: 'DROP' }, { experience: 1 }, null, 5] as unknown[]) {
      expect(() => rankCandidates(CARD, people, ctx({ missing: bad as ScoreContext['missing'] })), JSON.stringify(bad)).toThrow(RangeError);
    }
  });

  it('khong chuan hoa (NONE): chi tra ket qua tho khi MOI thanh phan DROP; Ho so NEUTRAL thi van dien trung binh', () => {
    const people = [cand('P', { skillsText: 'alpha' }, 1), cand('Q', { skillsText: 'beta' }, 1), cand('R', null, 0)];
    const raw = rankCandidates(CARD, people, ctx({ weights: W, normalize: 'NONE', missing: 'DROP' }));
    for (const r of raw) {
      const single = scoreCandidate(CARD, people.find((p) => p.userId === r.userId)!, ctx({ weights: W }));
      expect(r.score).toBe(single.score);
    }
    const neutral = rankCandidates(CARD, people, ctx({ weights: W, normalize: 'NONE' }));
    const r = neutral.find((x) => x.userId === 'R')!;
    expect(r.components.declared.scaled).toBeCloseTo(0.5, 12); // trung binh gia tri THO (1 + 0) / 2
    expect(r.score).toBeCloseTo(100 * (0.5 * 1 + 0.5 * 0.5), 9);
  });

  it('khong phu thuoc thu tu ung vien; khong sua dau vao; moi thanh phan co mat trong ket qua', () => {
    const people = [cand('P', { skillsText: 'alpha', cvText: 'beta gamma' }, 1), cand('Q', { workItems: [{ title: 'gamma alpha' }] }, 2), cand('R', null, 0), cand('S', { skillsText: 'delta' })];
    const ref = rankCandidates(CARD, people, ctx({ weights: W }));
    for (const perm of [[3, 2, 1, 0], [1, 3, 0, 2], [2, 0, 3, 1]]) {
      expect(rankCandidates(CARD, perm.map((i) => people[i]!), ctx({ weights: W }))).toEqual(ref);
    }
    expect(() => rankCandidates(CARD, deepFreeze(people.map((p) => ({ ...p }))), ctx({ weights: W }))).not.toThrow();
    expect(Object.keys(ref[0]!.components)).toEqual([...COMPONENT_KEYS]);
  });

  it('KHONG ai co ho so -> xep hang va diem TRUNG TUNG BIT giua moi cach xu ly Ho so (bo mo phong, 3 hat giong)', () => {
    let n = 0;
    for (const seed of [DEFAULT_SIM.seed, 4, 5]) {
      const data = generateSimulation({ ...DEFAULT_SIM, seed });
      const drop = [...replayTargets(data, { missing: 'DROP' })];
      const dflt = [...replayTargets(data, { weights: LEGACY_WEIGHTS_V1 })]; // missing mac dinh: Ho so NEUTRAL
      drop.forEach((t, i) => {
        expect(dflt[i]!.ranked.map((r) => [r.userId, r.score])).toEqual(t.ranked.map((r) => [r.userId, r.score]));
        expect(t.ranked.every((r) => r.flags.includes('NO_PROFILE') && r.components.declared.scaled === null)).toBe(true);
        n += 1;
      });
    }
    expect(n).toBeGreaterThan(250);
  });
});
