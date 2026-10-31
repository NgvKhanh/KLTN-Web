// Buoc 7a - cac nhanh cua bo danh gia (evalAssignArms.ts). THUAN: khong cham CSDL.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LEGACY_WEIGHTS_V1,
  rankCandidates,
  type CandidateInput,
  type ScoreCard,
  type Weights,
} from '../src/modules/assign/assign.score';
import type { HistoryCard } from '../src/modules/assign/assign.profile';
import { buildIdf } from '../src/modules/assign/assign.tfidf';
import {
  ABLATION_ARMS,
  MAIN_ARMS,
  mostFreeArm,
  mostFrequentArm,
  randomArm,
  roundRobinArm,
  scorerArm,
  withoutComponent,
  type ArmInput,
  type ArmSnapshot,
} from '../src/scripts/evalAssignArms';
import { DEFAULT_SIM, Rng, assignablePool, generateSimulation } from '../src/scripts/simGenerator';
import { simDate, snapshotAsOf } from '../src/scripts/simReplay';

// ---------- Du lieu tay de tinh ra dap an bang tay ----------

const NOW = new Date('2026-06-01T10:00:00.000Z');
const DAY = 86_400_000;
const at = (n: number) => new Date(NOW.getTime() + n * DAY);

const hist = (id: string, completedAt: Date): HistoryCard => ({ cardId: id, title: `viec ${id}`, description: '', completedAt, dueDate: null });

/** `done` the da xong TRUOC now va `future` the "xong" SAU now (bo cham va cac nhanh phai bo qua). */
const cand = (userId: string, done: number, future = 0): CandidateInput => ({
  userId,
  history: [
    ...Array.from({ length: done }, (_, i) => hist(`${userId}-d${i}`, at(-10 - i))),
    ...Array.from({ length: future }, (_, i) => hist(`${userId}-f${i}`, at(5 + i))),
  ],
  openCards: [],
  maxParallelCards: 5,
});

const snap = (cands: CandidateInput[]): ArmSnapshot => ({ now: NOW, idf: buildIdf([]), mu: 0.5, candidates: cands });

const card: ScoreCard = { id: 'target', title: 'viec moi', description: '' };

function input(cands: CandidateInput[], load: Record<string, number> = {}, seed = 1): ArmInput {
  return { card, snapshot: snap(cands), load: new Map(Object.entries(load)), rng: new Rng(seed) };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !(value instanceof Date) && !(value instanceof Map)) {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

// ---------- Du lieu mo phong that (hat giong phat trien 9xxx, KHONG nam trong bo hat giong danh gia 2001-2020) ----------

function realInputs(seed: number, howMany: number): ArmInput[] {
  const data = generateSimulation({ ...DEFAULT_SIM, seed });
  const out: ArmInput[] = [];
  for (const c of data.cards.filter((x) => x.assignedDay >= 120)) {
    const pool = assignablePool(data.people, c.assignedDay, c.dueDay);
    if (pool.length < 2) continue;
    const s = snapshotAsOf(data, c.assignedDay, 10, pool.map((p) => ({ key: p.key, capacity: p.capacity })), c.key);
    const scoreCard: ScoreCard = {
      id: c.key,
      title: c.title,
      description: c.description,
      startDate: simDate(data.config.days, c.assignedDay),
      dueDate: simDate(data.config.days, c.dueDay, 23, 59),
    };
    const ref = rankCandidates(scoreCard, s.candidates, { idf: s.idf, now: s.now, groupOnTimeRate: s.mu });
    out.push({ card: scoreCard, snapshot: s, load: new Map(ref.map((r) => [r.userId, r.load])), rng: new Rng(out.length + 1) });
    if (out.length >= howMany) break;
  }
  return out;
}

describe('danh muc nhanh', () => {
  it('bay nhanh chinh dung thu tu, bon nhanh cat bo, nhan khong rong, id khong trung', () => {
    expect(MAIN_ARMS.map((a) => a.id)).toEqual([
      'random',
      'round-robin',
      'most-free',
      'most-frequent',
      'exp-only',
      'load-only',
      'full',
    ]);
    expect(ABLATION_ARMS.map((a) => a.id)).toEqual(['rel-only', 'no-avail', 'no-rel', 'no-exp']);
    const all = [...MAIN_ARMS, ...ABLATION_ARMS];
    expect(new Set(all.map((a) => a.id)).size).toBe(all.length);
    for (const spec of all) {
      expect(spec.label.length).toBeGreaterThan(0);
      const arm = spec.make();
      expect(arm.id).toBe(spec.id);
      expect(arm.label).toBe(spec.label);
    }
  });

  it('make() tra ve ban MOI moi lan (khong dung chung con tro chia vong tron giua hai lan chay)', () => {
    const spec = MAIN_ARMS.find((a) => a.id === 'round-robin')!;
    const a = spec.make();
    const b = spec.make();
    const cands = [cand('p1', 0), cand('p2', 0), cand('p3', 0)];
    expect(a.rank(input(cands)).order[0]).toBe('p1');
    expect(a.rank(input(cands)).order[0]).toBe('p2'); // a da tien
    expect(b.rank(input(cands)).order[0]).toBe('p1'); // b chua bi anh huong
  });

  it('trong so cua cac nhanh dung bo cham: 1/0/0, 0/0/1, mac dinh; cat bo chia lai cho tong bang 1', () => {
    const w = (id: string) => [...MAIN_ARMS, ...ABLATION_ARMS].find((a) => a.id === id)!.make().weights!();
    expect(w('exp-only')).toEqual({ experience: 1, reliability: 0, availability: 0, declared: 0 });
    expect(w('load-only')).toEqual({ experience: 0, reliability: 0, availability: 1, declared: 0 });
    expect(w('rel-only')).toEqual({ experience: 0, reliability: 1, availability: 0, declared: 0 });
    // Nhanh "day du" ghim bo cu 0,45 / 0,30 / 0,25 (Ho so = 0) - so lieu buoc 7 khong doi theo mac dinh moi (§17.6)
    expect(w('full')).toEqual(LEGACY_WEIGHTS_V1);
    const noAvail = w('no-avail');
    expect(noAvail.experience).toBeCloseTo(0.6, 12);
    expect(noAvail.reliability).toBeCloseTo(0.4, 12);
    expect(noAvail.availability).toBe(0);
    for (const id of ['no-avail', 'no-rel', 'no-exp']) {
      const x = w(id);
      expect(x.experience + x.reliability + x.availability).toBeCloseTo(1, 12);
      expect(x.declared).toBe(0);
    }
    // Nhanh khong dung bo cham thi khong co trong so
    expect(MAIN_ARMS[0]!.make().weights).toBeUndefined();
  });
});

describe('withoutComponent', () => {
  it('bo mot thanh phan, chia lai hai cai con (so tinh tay)', () => {
    const a = withoutComponent(LEGACY_WEIGHTS_V1, 'availability');
    expect(a.experience).toBeCloseTo(0.45 / 0.75, 12);
    expect(a.reliability).toBeCloseTo(0.3 / 0.75, 12);
    expect(a.availability).toBe(0);
    const r = withoutComponent(LEGACY_WEIGHTS_V1, 'reliability');
    expect(r.experience).toBeCloseTo(0.45 / 0.7, 12);
    expect(r.availability).toBeCloseTo(0.25 / 0.7, 12);
    expect(r.reliability).toBe(0);
    const e = withoutComponent(LEGACY_WEIGHTS_V1, 'experience');
    expect(e.reliability).toBeCloseTo(0.3 / 0.55, 12);
    expect(e.availability).toBeCloseTo(0.25 / 0.55, 12);
    expect(e.experience).toBe(0);
  });

  it('khong sua dau vao; hai thanh phan con deu bang 0 thi tu choi', () => {
    const w: Weights = deepFreeze({ experience: 1, reliability: 0, availability: 0, declared: 0 });
    expect(withoutComponent(w, 'availability')).toEqual({ experience: 1, reliability: 0, availability: 0, declared: 0 });
    expect(() => withoutComponent(w, 'experience')).toThrow(/tong > 0/);
  });

  it('chi cho bo trong so khong co Ho so: Ho so khac 0 se bi bo mat im lang nen nem loi', () => {
    expect(() => withoutComponent({ ...LEGACY_WEIGHTS_V1, declared: 0.2 }, 'availability')).toThrow(/declared = 0/);
  });
});

describe('nhanh ngau nhien', () => {
  const cands = ['p1', 'p2', 'p3', 'p4'].map((k) => cand(k, 0));

  it('la hoan vi cua ho boi; cung luong -> cung thu tu; khac luong -> (thuong) khac', () => {
    const a = randomArm().rank(input(cands, {}, 5)).order;
    const b = randomArm().rank(input(cands, {}, 5)).order;
    expect(a).toEqual(b);
    expect([...a].sort()).toEqual(['p1', 'p2', 'p3', 'p4']);
    let differ = 0;
    for (let s = 6; s < 26; s += 1) if (randomArm().rank(input(cands, {}, s)).order.join() !== a.join()) differ += 1;
    expect(differ).toBeGreaterThan(10);
  });

  it('thu tu dau vao khong quan trong (chi luong ngau nhien quyet dinh)', () => {
    const reversed = [...cands].reverse();
    for (let s = 1; s <= 10; s += 1) {
      expect(randomArm().rank(input(reversed, {}, s)).order).toEqual(randomArm().rank(input(cands, {}, s)).order);
    }
  });

  it('nguoi dung dau xap xi deu (3000 luong): moi nguoi 20-30%', () => {
    const first = new Map<string, number>();
    for (let s = 0; s < 3000; s += 1) {
      const k = randomArm().rank(input(cands, {}, s + 100)).order[0]!;
      first.set(k, (first.get(k) ?? 0) + 1);
    }
    for (const k of ['p1', 'p2', 'p3', 'p4']) {
      expect(first.get(k)! / 3000).toBeGreaterThan(0.2);
      expect(first.get(k)! / 3000).toBeLessThan(0.3);
    }
  });

  it('thu tu cac vi tri sau cung deu: khong thien lech (nguoi cuoi danh sach khong hay bi day xuong cuoi)', () => {
    const lastCount = new Map<string, number>();
    for (let s = 0; s < 3000; s += 1) {
      const k = randomArm().rank(input(cands, {}, s + 7000)).order[3]!;
      lastCount.set(k, (lastCount.get(k) ?? 0) + 1);
    }
    for (const k of ['p1', 'p2', 'p3', 'p4']) expect(lastCount.get(k)! / 3000).toBeGreaterThan(0.2);
  });
});

describe('nhanh chia vong tron', () => {
  it('lan luot theo khoa, het vong thi quay ve dau', () => {
    const arm = roundRobinArm();
    const cands = [cand('p3', 0), cand('p1', 0), cand('p2', 0)]; // thu tu dau vao khong quan trong
    const picks = Array.from({ length: 7 }, () => arm.rank(input(cands)).order[0]);
    expect(picks).toEqual(['p1', 'p2', 'p3', 'p1', 'p2', 'p3', 'p1']);
  });

  it('thu tu day du la vong tron bat dau tu nguoi ke tiep', () => {
    const arm = roundRobinArm();
    const cands = [cand('p1', 0), cand('p2', 0), cand('p3', 0), cand('p4', 0)];
    expect(arm.rank(input(cands)).order).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(arm.rank(input(cands)).order).toEqual(['p2', 'p3', 'p4', 'p1']);
    expect(arm.rank(input(cands)).order).toEqual(['p3', 'p4', 'p1', 'p2']);
  });

  it('nguoi vang mat khoi ho boi bi bo qua; nguoi vua duoc goi ma nay khong con thi van tien dung', () => {
    const arm = roundRobinArm();
    expect(arm.rank(input([cand('p1', 0), cand('p2', 0), cand('p3', 0)])).order[0]).toBe('p1');
    // p2 vang mat: sau p1 la p3
    expect(arm.rank(input([cand('p1', 0), cand('p3', 0)])).order[0]).toBe('p3');
    // last = p3; ho boi moi khong con p3 lan p4: ke tiep theo khoa lon hon 'p3' -> khong co -> quay ve dau
    expect(arm.rank(input([cand('p1', 0), cand('p2', 0)])).order[0]).toBe('p1');
    // last = p1; p2 la nguoi ke tiep du p2 vua hien tro lai
    expect(arm.rank(input([cand('p1', 0), cand('p2', 0), cand('p3', 0)])).order[0]).toBe('p2');
  });

  it('nguoi giu con tro roi khoi ho boi: nguoi co khoa lon hon ke tiep duoc chon', () => {
    const arm = roundRobinArm();
    arm.rank(input([cand('p2', 0), cand('p4', 0)])); // last = p2
    expect(arm.rank(input([cand('p3', 0), cand('p4', 0), cand('p5', 0)])).order[0]).toBe('p3'); // p3 > p2
  });
});

describe('nhanh nguoi ranh nhat / hay lam nhat', () => {
  it('ranh nhat: it the dang mo nhat truoc, hoa -> khoa nho hon; dem tho khong chia cho suc chua', () => {
    const cands = [cand('p1', 0), cand('p2', 0), cand('p3', 0), cand('p4', 0)];
    const order = mostFreeArm().rank(input(cands, { p1: 2, p2: 0, p3: 2, p4: 0 })).order;
    expect(order).toEqual(['p2', 'p4', 'p1', 'p3']);
    // Nguoi thieu trong ban do tai coi nhu 0
    expect(mostFreeArm().rank(input(cands, { p1: 1, p2: 1, p3: 1 })).order[0]).toBe('p4');
    // Dem THO, khong chia cho suc chua: p1 (2 the / suc chua 3, kha dung 0,33) van truoc p2 (3 the / suc chua 30, kha dung 0,9)
    const withCap = [{ ...cand('p1', 0), maxParallelCards: 3 }, { ...cand('p2', 0), maxParallelCards: 30 }];
    expect(mostFreeArm().rank(input(withCap, { p1: 2, p2: 3 })).order).toEqual(['p1', 'p2']);
  });

  it('hay lam nhat: nhieu the DA XONG nhat truoc (the xong SAU now khong tinh), hoa -> khoa nho hon', () => {
    const cands = [cand('p1', 3), cand('p2', 1), cand('p3', 3), cand('p4', 0, 9)];
    expect(mostFrequentArm().rank(input(cands)).order).toEqual(['p1', 'p3', 'p2', 'p4']);
    // Nguoi co 9 the "xong sau now" van chi tinh la 0 -> cuoi bang
    expect(mostFrequentArm().rank(input([cand('p9', 0, 9), cand('p1', 1)])).order).toEqual(['p1', 'p9']);
  });

  it('ca hai deu la hoan vi va khong sua dau vao (dau vao dong bang)', () => {
    const cands = deepFreeze([cand('p1', 2), cand('p2', 5), cand('p3', 5)]);
    const load = new Map([['p1', 1], ['p2', 2], ['p3', 0]]);
    for (const arm of [mostFreeArm(), mostFrequentArm(), roundRobinArm(), randomArm()]) {
      const out = arm.rank({ card, snapshot: snap(cands), load, rng: new Rng(3) });
      expect([...out.order].sort()).toEqual(['p1', 'p2', 'p3']);
      expect(out.ranked).toBeNull();
    }
  });
});

describe('nhanh dung bo cham', () => {
  const inputs = realInputs(9001, 25);

  it('co du 25 tinh huong that de thu', () => {
    expect(inputs.length).toBe(25);
  });

  it('bang dung ket qua rankCandidates voi cung boi canh (MINMAX / DROP la mac dinh cua san pham)', () => {
    let differsFromNone = 0;
    for (const inp of inputs) {
      const out = scorerArm({ id: 'x', label: 'x' }).rank(inp);
      const direct = rankCandidates(inp.card, inp.snapshot.candidates, {
        idf: inp.snapshot.idf,
        now: inp.snapshot.now,
        groupOnTimeRate: inp.snapshot.mu,
        weights: LEGACY_WEIGHTS_V1,
        normalize: 'MINMAX',
        missing: 'DROP',
      });
      expect(out.order).toEqual(direct.map((r) => r.userId));
      expect(out.ranked).toEqual(direct);
      const none = rankCandidates(inp.card, inp.snapshot.candidates, {
        idf: inp.snapshot.idf,
        now: inp.snapshot.now,
        groupOnTimeRate: inp.snapshot.mu,
        normalize: 'NONE',
      });
      if (none.map((r) => r.userId).join() !== out.order.join()) differsFromNone += 1;
    }
    // Phep so sanh khong vo nghia: chuan hoa THAT SU doi thu tu o mot so tinh huong
    expect(differsFromNone).toBeGreaterThan(0);
  });

  it('tuy chon normalize duoc chuyen xuong DUNG: NONE == rankCandidates NONE, va khac MINMAX o it nhat mot tinh huong', () => {
    let differs = 0;
    for (const inp of inputs) {
      const none = scorerArm({ id: 'n', label: 'n', normalize: 'NONE' }).rank(inp);
      const direct = rankCandidates(inp.card, inp.snapshot.candidates, {
        idf: inp.snapshot.idf,
        now: inp.snapshot.now,
        groupOnTimeRate: inp.snapshot.mu,
        weights: LEGACY_WEIGHTS_V1,
        normalize: 'NONE',
      });
      expect(none.order).toEqual(direct.map((r) => r.userId));
      if (none.order.join() !== scorerArm({ id: 'd', label: 'd' }).rank(inp).order.join()) differs += 1;
    }
    expect(differs).toBeGreaterThan(0);
  });

  it('trong so khac nhau cho thu tu khac nhau; tuy chon normalize / missing / params duoc chuyen xuong', () => {
    let expDiffersLoad = 0;
    let neutralDiffers = 0;
    let paramsDiffer = 0;
    for (const inp of inputs) {
      const e = scorerArm({ id: 'e', label: 'e', weights: { experience: 1, reliability: 0, availability: 0, declared: 0 } }).rank(inp).order;
      const l = scorerArm({ id: 'l', label: 'l', weights: { experience: 0, reliability: 0, availability: 1, declared: 0 } }).rank(inp).order;
      if (e.join() !== l.join()) expDiffersLoad += 1;
      const drop = scorerArm({ id: 'd', label: 'd' }).rank(inp).order;
      const neutral = scorerArm({ id: 'n', label: 'n', missing: 'NEUTRAL' }).rank(inp).order;
      if (drop.join() !== neutral.join()) neutralDiffers += 1;
      const k1 = scorerArm({ id: 'k', label: 'k', params: { k: 1, halfLifeDays: 7 } }).rank(inp).order;
      if (k1.join() !== drop.join()) paramsDiffer += 1;
    }
    expect(expDiffersLoad).toBeGreaterThan(0);
    expect(neutralDiffers).toBeGreaterThan(0);
    expect(paramsDiffer).toBeGreaterThan(0);
  });

  it('weights() tra ve BAN SAO: sua ket qua khong lam doi nhanh', () => {
    const arm = scorerArm({ id: 'x', label: 'x' });
    const w = arm.weights!();
    w.experience = 0;
    expect(arm.weights!()).toEqual(LEGACY_WEIGHTS_V1);
    // ... va sua doi tuong trong so truyen vao khong lam doi nhanh da tao
    const src: Weights = { experience: 0.5, reliability: 0.3, availability: 0.2, declared: 0 };
    const arm2 = scorerArm({ id: 'y', label: 'y', weights: src });
    src.experience = 0;
    expect(arm2.weights!().experience).toBe(0.5);
  });
});

describe('moi nhanh tren du lieu that', () => {
  const inputs = realInputs(9002, 20);

  it('luon tra ve hoan vi cua ho boi, tat dinh, khong sua dau vao (dong bang)', () => {
    const frozen = inputs.map((i) => ({ ...i, snapshot: deepFreeze({ ...i.snapshot, candidates: [...i.snapshot.candidates] }) }));
    for (const spec of [...MAIN_ARMS, ...ABLATION_ARMS]) {
      const arm = spec.make();
      for (const inp of frozen) {
        const out = arm.rank(inp);
        const pool = inp.snapshot.candidates.map((c) => c.userId).sort();
        expect([...out.order].sort()).toEqual(pool);
        expect(new Set(out.order).size).toBe(out.order.length);
      }
      // cung dau vao + cung luong + ban moi -> cung ket qua
      const a = spec.make().rank({ ...inputs[0]!, rng: new Rng(11) }).order;
      const b = spec.make().rank({ ...inputs[0]!, rng: new Rng(11) }).order;
      expect(a).toEqual(b);
    }
  });
});

describe('chot chan kien truc: nhanh khong duoc thay ky nang an', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/scripts/evalAssignArms.ts'), 'utf8');
  const importLines = src.split('\n').filter((l) => /^\s*(import|export)\b.*\bfrom\b/.test(l) || /^\} from /.test(l));

  it('evalAssignArms.ts khong import simGenerator / simVocab / simReplay / simSeed', () => {
    expect(importLines.length).toBeGreaterThan(0);
    for (const l of importLines) expect(l).not.toMatch(/sim(Generator|Vocab|Replay|Seed)/);
    expect(src).not.toMatch(/from '\.\/sim/);
  });

  it('nhanh thuong khong cham vao `oracle` (chi nhanh tham chieu o evalAssignRun.ts)', () => {
    // Khai bao kieu `oracle?: Oracle` thi duoc; truy cap thuoc tinh `oracle.` / `oracle!.` thi khong
    expect(src).not.toMatch(/\boracle!?\??\./);
    expect(src).not.toMatch(/\.skillOf\(|\.pOnTimeOf\(/);
    // ... va khong co tu "skills" (mang ky nang an cua SimPerson)
    expect(src).not.toMatch(/\.skills\b|\bskillAt\b/);
  });
});
