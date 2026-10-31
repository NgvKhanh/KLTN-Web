// Buoc 14 - bo sinh ho so tu khai cho mo phong (simDeclared.ts) + tuy chon bo chay (ho so trong anh chup, the gioi "nhom moi",
// dem the da xong cua nguoi tot nhat). THUAN: khong cham CSDL. ASSIGN_MODULE.md §17.10.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { declaredItems } from '../src/modules/assign/assign.declared';
import { DEFAULT_WEIGHTS, LEGACY_WEIGHTS_V1, type Weights } from '../src/modules/assign/assign.score';
import { countTerms } from '../src/modules/assign/assign.text';
import { scorerArm } from '../src/scripts/evalAssignArms';
import { runArm, STREAM_SALTS, DEFAULT_MIN_DAY } from '../src/scripts/evalAssignRun';
import {
  CV_FILLER,
  DECLARED_VOCAB,
  DEFAULT_DECLARED_SIM,
  declaredItemsByPerson,
  generateDeclaredProfiles,
} from '../src/scripts/simDeclared';
import { DEFAULT_SIM, generateSimulation, skillAt, type SimDataset } from '../src/scripts/simGenerator';
import { snapshotAsOf } from '../src/scripts/simReplay';
import { GENERIC_DESC, GENERIC_TITLES, SYNONYMS, TOPICS } from '../src/scripts/simVocab';

const SEED = 9901; // thu nghiem, ngoai moi dai da dang ky
const gen = (seed = SEED, over: Partial<typeof DEFAULT_SIM> = {}) => generateSimulation({ ...DEFAULT_SIM, seed, ...over });
const termsOf = (t: string) => [...countTerms({ title: '', description: t }).keys()];

describe('generateDeclaredProfiles - hang so va tinh tat dinh', () => {
  it('num mac dinh dung gia tri dang ky truoc (§17.10); luong ngau nhien rieng (muoi 4, khac ba luong cu)', () => {
    expect(DEFAULT_DECLARED_SIM).toEqual({ theta: 0.5, pOver: 0.15, pUnder: 0.15, overlap: 0.5, pNone: 0.3, liarKey: null });
    expect(STREAM_SALTS.declared).toBe(4);
    expect(new Set(Object.values(STREAM_SALTS)).size).toBe(4);
    expect(DECLARED_VOCAB).toHaveLength(TOPICS.length);
  });

  it('tat dinh theo (hat giong, cau hinh); hat giong khac -> ho so khac; KHONG sua bo du lieu', () => {
    const data = gen();
    const before = JSON.stringify(data);
    const a = generateDeclaredProfiles(data);
    expect(JSON.stringify([...generateDeclaredProfiles(gen())])).toBe(JSON.stringify([...a]));
    expect(JSON.stringify([...generateDeclaredProfiles(gen(SEED + 1))])).not.toBe(JSON.stringify([...a]));
    expect(JSON.stringify(data)).toBe(before);
    expect([...a.keys()]).toEqual(data.people.map((p) => p.key));
  });

  it('DONG BANG: ma bam ho so cua 20 hat giong xac nhan 4001-4020 (cau hinh mac dinh) - doi bo sinh ho so la phai thay co y', () => {
    const h = createHash('sha256');
    for (let seed = 4001; seed <= 4020; seed += 1) h.update(JSON.stringify([...generateDeclaredProfiles(gen(seed))]));
    expect(h.digest('hex')).toBe('e2f1d7e9aca42da045d2d352ae42c5355a2587eaae11e5d363b799f8ffaf3c0d');
  });

  it('tham so sai -> RangeError; liarKey la -> RangeError', () => {
    const data = gen();
    for (const k of ['theta', 'pOver', 'pUnder', 'overlap', 'pNone'] as const) {
      for (const v of [-0.01, 1.01, Number.NaN]) expect(() => generateDeclaredProfiles(data, { [k]: v }), `${k}=${v}`).toThrow(RangeError);
    }
    expect(() => generateDeclaredProfiles(data, { liarKey: 'khong-co' })).toThrow(/liarKey/);
  });
});

describe('generateDeclaredProfiles - y nghia tung num', () => {
  const data = gen(SEED, { people: 12 });

  it('khong khai quá / thieu: chu de khai DUNG bang {ky nang an LUC VAO NHOM >= theta}', () => {
    const exact = generateDeclaredProfiles(data, { pOver: 0, pUnder: 0, pNone: 0 });
    let people = 0;
    for (const p of data.people) {
      const want = TOPICS.map((_, t) => t).filter((t) => skillAt(p, t, p.joinedDay) >= 0.5);
      expect(exact.get(p.key)!.topics, p.key).toEqual(want);
      if (want.length > 0) people += 1;
    }
    expect(people).toBeGreaterThan(6);
    // theta = 0 -> khai moi chu de; theta = 1 -> gan nhu khong ai (ky nang an < 1)
    expect([...generateDeclaredProfiles(data, { theta: 0, pOver: 0, pUnder: 0, pNone: 0 }).values()].every((x) => x.topics.length === TOPICS.length)).toBe(true);
  });

  it('pNone = 1 -> khong ai khai (tru nguoi co tinh khai qua); pNone = 0 -> ai co chu de manh deu khai', () => {
    const liar = data.people[3]!.key;
    const none = generateDeclaredProfiles(data, { pNone: 1, liarKey: liar });
    for (const [k, v] of none) {
      if (k === liar) expect(v.topics).toHaveLength(TOPICS.length);
      else expect(v).toEqual({ profile: null, topics: [] });
    }
  });

  it('CUNG MAY RUI giua cac muc cua mot num: tang pOver chi THEM chu de, chu de cu giu nguyen cum ky nang', () => {
    const lo = generateDeclaredProfiles(data, { pOver: 0, pNone: 0 });
    const hi = generateDeclaredProfiles(data, { pOver: 0.6, pNone: 0 });
    let added = 0;
    for (const p of data.people) {
      const a = lo.get(p.key)!;
      const b = hi.get(p.key)!;
      expect(a.topics.every((t) => b.topics.includes(t)), p.key).toBe(true);
      added += b.topics.length - a.topics.length;
      if (a.profile && b.profile) {
        const aSkills = a.profile.skillsText!.split(', ');
        const bSkills = b.profile.skillsText!.split(', ');
        expect(aSkills.every((s) => bSkills.includes(s)), p.key).toBe(true);
      }
    }
    expect(added).toBeGreaterThan(3);
  });

  it('overlap = 1 -> moi cum ky nang lay tu tu vung CUA THE (doi tuong cua chu de); overlap = 0 -> tu bo tu rieng', () => {
    const card = generateDeclaredProfiles(data, { overlap: 1, pNone: 0 });
    const own = generateDeclaredProfiles(data, { overlap: 0, pNone: 0 });
    for (const p of data.people) {
      const c = card.get(p.key)!;
      if (!c.profile) continue;
      const allowedCard = new Set(c.topics.flatMap((t) => TOPICS[t]!.objects));
      expect(c.profile.skillsText!.split(', ').every((s) => allowedCard.has(s)), p.key).toBe(true);
      const o = own.get(p.key)!;
      const allowedOwn = new Set(o.topics.flatMap((t) => DECLARED_VOCAB[t]!));
      expect(o.profile!.skillsText!.split(', ').every((s) => allowedOwn.has(s)), p.key).toBe(true);
    }
  });

  it('ho so co du ba phan: 2 cum / chu de, 1-2 cong viec / chu de, CV = ky nang + cong viec + dong don', () => {
    const all = generateDeclaredProfiles(data, { pNone: 0 });
    for (const [, v] of all) {
      if (!v.profile) continue;
      expect(v.profile.skillsText!.split(', ')).toHaveLength(2 * v.topics.length);
      expect(v.profile.workItems!.length).toBeGreaterThanOrEqual(v.topics.length);
      expect(v.profile.workItems!.length).toBeLessThanOrEqual(2 * v.topics.length);
      expect(v.profile.cvText).toContain('Kỹ năng:');
      expect(declaredItems(v.profile).some((i) => i.kind === 'CV')).toBe(true);
    }
    expect(CV_FILLER.length).toBeGreaterThanOrEqual(3);
  });
});

describe('bo tu khai RIENG khong trung tu vung cua bo sinh the (§17.10: neu trung, Ho so "biet dap an")', () => {
  it('khong mot thuat ngu nao cua DECLARED_VOCAB xuat hien trong tu vung the (TOPICS, tu dong nghia, tieu de / mo ta chung)', () => {
    const cardText = [
      ...TOPICS.flatMap((t) => [...t.verbs, ...t.objects, ...t.details, ...t.descWords]),
      ...Object.entries(SYNONYMS).flatMap(([k, v]) => [k, ...v]),
      ...GENERIC_TITLES,
      ...GENERIC_DESC,
    ];
    const cardTerms = new Set(cardText.flatMap(termsOf));
    const own = DECLARED_VOCAB.flatMap((xs) => xs.flatMap(termsOf));
    expect(own.length).toBeGreaterThan(80);
    expect(own.filter((t) => cardTerms.has(t))).toEqual([]);
  });

  it('va tren the that cua bo sinh: khong the nao chua thuat ngu cua bo tu rieng (3 hat giong)', () => {
    const own = new Set(DECLARED_VOCAB.flatMap((xs) => xs.flatMap(termsOf)));
    for (const seed of [SEED, 4001, 2001]) {
      for (const c of gen(seed).cards) {
        const hit = [...countTerms(c).keys()].filter((t) => own.has(t));
        expect(hit, c.key).toEqual([]);
      }
    }
  });
});

describe('bo chay: ho so trong anh chup, nhom moi (W2), dem the cua nguoi tot nhat (W3)', () => {
  const data: SimDataset = gen();
  const items = declaredItemsByPerson(generateDeclaredProfiles(data));

  it('snapshotAsOf: co muc khai -> ung vien mang `declared` dung nguoi; khong truyen -> khong co khoa (y nhu truoc)', () => {
    const pool = data.people.map((p) => ({ key: p.key, capacity: p.capacity }));
    const withItems = snapshotAsOf(data, 150, 10, pool, null, items);
    for (const c of withItems.candidates) expect(c.declared).toBe(items.get(c.userId));
    const plain = snapshotAsOf(data, 150, 10, pool, null);
    expect(plain.candidates.every((c) => !('declared' in c))).toBe(true);
    expect(snapshotAsOf(data, 150, 10, pool, null, new Map()).candidates.every((c) => c.declared === null)).toBe(true);
  });

  it('trong so Ho so = 0 (bo cu) -> co ho so hay khong, MOI quyet dinh nhu nhau; bo moi -> ho so co tac dung', () => {
    const run = (weights: Weights, declared?: typeof items) =>
      runArm(data, () => scorerArm({ id: 'x', label: 'x', weights }), { mode: 'ARM', declared });
    const a = run(LEGACY_WEIGHTS_V1);
    const b = run(LEGACY_WEIGHTS_V1, items);
    expect(b.decisions.map((d) => d.topKey)).toEqual(a.decisions.map((d) => d.topKey));
    expect(b.summary).toEqual(a.summary);
    const c = run(DEFAULT_WEIGHTS, items);
    expect(c.decisions.map((d) => d.topKey)).not.toEqual(a.decisions.map((d) => d.topKey));
  });

  it('coldStart (W2): the giao truoc minDay bi xoa trang -> luc bat dau KHONG ai co lich su; the tu minDay giu nguyen', () => {
    const full = LEGACY_WEIGHTS_V1;
    const w2 = runArm(data, () => scorerArm({ id: 'x', label: 'x', weights: full }), { mode: 'ARM', coldStart: true, keepWorld: true });
    const w1 = runArm(data, () => scorerArm({ id: 'x', label: 'x', weights: full }), { mode: 'ARM', keepWorld: true });
    expect(w2.decisions[0]!.topHasNoHistory).toBe(true);
    expect(w2.decisions[0]!.bestDoneCount).toBe(0);
    expect(w1.decisions[0]!.bestDoneCount).toBeGreaterThan(0);
    data.cards.forEach((c, i) => {
      const x = w2.world!.cards[i]!;
      if (c.assignedDay < DEFAULT_MIN_DAY) expect([x.assigneeKey, x.done, x.completedDay]).toEqual(['', false, null]);
      expect(x.key).toBe(c.key); // vi tri the khong doi (khoa cua luong ngau nhien)
    });
    expect(w2.summary.topNoHistory).toBeGreaterThan(w1.summary.topNoHistory);
    // HISTORY + coldStart: chi xoa trang the truoc minDay, cac the con lai la cua bo sinh
    const h = runArm(data, () => scorerArm({ id: 'x', label: 'x' }), { mode: 'HISTORY', coldStart: true, keepWorld: true });
    data.cards.forEach((c, i) => {
      if (c.assignedDay >= DEFAULT_MIN_DAY) expect(h.world!.cards[i]).toEqual(c);
    });
  });

  it('bestDoneCount = so the nguoi tot nhat da xong TINH DEN luc quyet dinh (doi chieu tinh lai tu the gioi cuoi)', () => {
    const r = runArm(data, () => scorerArm({ id: 'x', label: 'x' }), { mode: 'ARM', keepWorld: true });
    let checked = 0;
    for (const d of r.decisions.slice(0, 40)) {
      const want = r.world!.cards.filter((c) => c.assigneeKey === d.bestKey && c.done && c.completedDay !== null && c.completedDay < d.day).length;
      // the xong DUNG ngay quyet dinh (17:00) sau gio quyet dinh (10:00) khong tinh
      expect(d.bestDoneCount, d.cardKey).toBe(want);
      checked += 1;
    }
    expect(checked).toBe(40);
  });
});
