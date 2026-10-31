// Buoc 5 - anh chup du lieu (assign.snapshot.ts): dong CSDL -> { idf, mu, ung vien }. HAM THUAN, khong can DB.
// Ba loai bao dam:
//  (1) tung quy tac "lich su / dang mo tai thoi diem now" (bien, dong hong, the dang cham);
//  (2) khong phu thuoc thu tu dau vao, khong sua dau vao;
//  (3) DOI CHIEU voi duong bo nho cua bo mo phong (snapshotAsOf, buoc 4b): hai duong phai cho CUNG ket qua xep hang.
import { describe, expect, it } from 'vitest';
import { rankCandidates } from '../src/modules/assign/assign.score';
import {
  buildSnapshot,
  type Snapshot,
  type SnapshotCard,
  type SnapshotInput,
  type SnapshotMembership,
} from '../src/modules/assign/assign.snapshot';
import { snapshotAsOf } from '../src/scripts/simReplay';
import { DEFAULT_SIM, Rng, assignablePool, availableAt, generateSimulation } from '../src/scripts/simGenerator';
import { simDayToDate, vnToday } from '../src/scripts/simSeed';

const NOW = new Date('2026-09-20T05:00:00.000Z');
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const ahead = (days: number) => new Date(NOW.getTime() + days * DAY);

let seq = 0;
function card(over: Partial<SnapshotCard> = {}): SnapshotCard {
  seq += 1;
  return {
    id: `c${seq}`,
    title: `The ${seq}`,
    description: null,
    createdAt: ago(100),
    startDate: null,
    dueDate: null,
    isDone: false,
    completedAt: null,
    archived: false,
    ...over,
  };
}
const done = (over: Partial<SnapshotCard> = {}) => card({ isDone: true, completedAt: ago(10), dueDate: ago(9), ...over });
const mem = (cardId: string, userId: string, createdAt: Date = ago(50)): SnapshotMembership => ({ cardId, userId, createdAt });

function build(over: Partial<SnapshotInput> = {}): Snapshot {
  return buildSnapshot({
    cards: [],
    memberships: [],
    reopened: new Set(),
    profiles: new Map(),
    candidateIds: ['u1'],
    targetCardId: null,
    now: NOW,
    ...over,
  });
}
const cand = (s: Snapshot, id: string) => s.candidates.find((c) => c.userId === id)!;
const ids = (xs: readonly { cardId: string }[]) => xs.map((x) => x.cardId).sort();

describe('buildSnapshot - lich su cua nguoi', () => {
  it('the da xong den luc now thanh lich su cua NGUOI DUOC GAN, kem tieu de / mo ta / han / co mo lai', () => {
    const c1 = done({ id: 'h1', title: 'Thiet ke dang nhap', description: 'mo ta', completedAt: ago(20), dueDate: ago(19) });
    const c2 = done({ id: 'h2', completedAt: ago(5), dueDate: null });
    const s = build({
      cards: [c1, c2],
      memberships: [mem('h1', 'u1'), mem('h2', 'u1')],
      reopened: new Set(['h1']),
    });
    const u = cand(s, 'u1');
    expect(ids(u.history)).toEqual(['h1', 'h2']);
    expect(u.history.find((h) => h.cardId === 'h1')).toEqual({
      cardId: 'h1',
      title: 'Thiet ke dang nhap',
      description: 'mo ta',
      completedAt: c1.completedAt,
      dueDate: c1.dueDate,
      reopened: true,
    });
    expect(u.history.find((h) => h.cardId === 'h2')).toMatchObject({ dueDate: null, reopened: false });
    expect(u.openCards).toEqual([]);
  });

  it('chi lay the CUA NGUOI DO: hai ung vien, moi nguoi mot bo the rieng; nguoi ngoai danh sach bi bo', () => {
    const a = done({ id: 'a1' });
    const b = done({ id: 'b1' });
    const z = done({ id: 'z1' });
    const s = build({
      cards: [a, b, z],
      memberships: [mem('a1', 'u1'), mem('b1', 'u2'), mem('z1', 'u9')],
      candidateIds: ['u1', 'u2'],
    });
    expect(ids(cand(s, 'u1').history)).toEqual(['a1']);
    expect(ids(cand(s, 'u2').history)).toEqual(['b1']);
    expect(s.candidates.map((c) => c.userId)).toEqual(['u1', 'u2']);
  });

  it('the co nhieu nguoi: moi nguoi deu duoc tinh vao lich su (chia se cong)', () => {
    const s = build({
      cards: [done({ id: 'm1' })],
      memberships: [mem('m1', 'u1'), mem('m1', 'u2')],
      candidateIds: ['u1', 'u2'],
    });
    expect(ids(cand(s, 'u1').history)).toEqual(['m1']);
    expect(ids(cand(s, 'u2').history)).toEqual(['m1']);
  });

  it('bien thoi gian: xong DUNG luc now van la lich su; xong sau now 1ms thi khong', () => {
    const at = done({ id: 'e1', completedAt: NOW });
    const after = done({ id: 'e2', completedAt: new Date(NOW.getTime() + 1) });
    const s = build({ cards: [at, after], memberships: [mem('e1', 'u1'), mem('e2', 'u1')] });
    expect(ids(cand(s, 'u1').history)).toEqual(['e1']);
  });

  it('the da luu tru van la lich su (du an cu) nhung khong chiem tai', () => {
    const s = build({
      cards: [done({ id: 'ar1', archived: true })],
      memberships: [mem('ar1', 'u1')],
    });
    expect(ids(cand(s, 'u1').history)).toEqual(['ar1']);
    expect(cand(s, 'u1').openCards).toEqual([]);
  });
});

describe('buildSnapshot - the dang mo tai thoi diem now', () => {
  it('chua xong va chua luu tru -> dang mo, kem ngay bat dau / han; khong vao lich su', () => {
    const c = card({ id: 'o1', startDate: ago(3), dueDate: ahead(4) });
    const s = build({ cards: [c], memberships: [mem('o1', 'u1')] });
    expect(cand(s, 'u1').openCards).toEqual([{ cardId: 'o1', startDate: c.startDate, dueDate: c.dueDate }]);
    expect(cand(s, 'u1').history).toEqual([]);
    // Khong co ngay -> null, khong phai undefined
    const s2 = build({ cards: [card({ id: 'o2' })], memberships: [mem('o2', 'u1')] });
    expect(cand(s2, 'u1').openCards).toEqual([{ cardId: 'o2', startDate: null, dueDate: null }]);
  });

  it('the chua xong nhung da luu tru khong con chiem tai', () => {
    const s = build({ cards: [card({ id: 'o3', archived: true })], memberships: [mem('o3', 'u1')] });
    expect(cand(s, 'u1').openCards).toEqual([]);
    expect(cand(s, 'u1').history).toEqual([]);
  });

  it('the xong SAU now thi luc now no van dang mo (phat lai lich su): co trong the dang mo, KHONG co trong lich su', () => {
    const c = done({ id: 'f1', completedAt: ahead(1), startDate: ago(5), dueDate: ahead(2) });
    const s = build({ cards: [c], memberships: [mem('f1', 'u1')] });
    expect(ids(cand(s, 'u1').openCards)).toEqual(['f1']);
    expect(cand(s, 'u1').history).toEqual([]);
    // ... nhung neu da luu tru thi khong chiem tai
    const s2 = build({ cards: [{ ...c, archived: true }], memberships: [mem('f1', 'u1')] });
    expect(cand(s2, 'u1').openCards).toEqual([]);
  });

  it('the dang cham khong bao gio tu chong len minh: bi loai khoi lich su lan the dang mo', () => {
    const open = card({ id: 't1' });
    const closed = done({ id: 't2' });
    const s = build({
      cards: [open, closed],
      memberships: [mem('t1', 'u1'), mem('t2', 'u1')],
      targetCardId: 't1',
    });
    expect(cand(s, 'u1').openCards).toEqual([]);
    expect(ids(cand(s, 'u1').history)).toEqual(['t2']);
    const s2 = build({ cards: [open, closed], memberships: [mem('t1', 'u1'), mem('t2', 'u1')], targetCardId: 't2' });
    expect(ids(cand(s2, 'u1').openCards)).toEqual(['t1']);
    expect(cand(s2, 'u1').history).toEqual([]);
  });
});

describe('buildSnapshot - dong hong bi bo, khong nem loi', () => {
  it('the xong ma khong co completedAt / completedAt khong hop le: khong vao lich su, khong chiem tai', () => {
    const noTime = card({ id: 'x1', isDone: true, completedAt: null });
    const badTime = card({ id: 'x2', isDone: true, completedAt: new Date('nope') });
    const ok = done({ id: 'x3' });
    const s = build({
      cards: [noTime, badTime, ok],
      memberships: [mem('x1', 'u1'), mem('x2', 'u1'), mem('x3', 'u1')],
    });
    expect(ids(cand(s, 'u1').history)).toEqual(['x3']);
    expect(cand(s, 'u1').openCards).toEqual([]);
  });

  it('lien ket co moc gan khong hop le, hoac tro toi the khong ton tai, bi bo', () => {
    const s = build({
      cards: [card({ id: 'k1' })],
      memberships: [
        mem('k1', 'u1', new Date('nope')),
        mem('khong-co-the-nay', 'u1'),
      ],
    });
    expect(cand(s, 'u1').openCards).toEqual([]);
    expect(cand(s, 'u1').history).toEqual([]);
  });

  it('the co createdAt khong hop le khong vao kho ngu lieu nhung khong lam hong ca anh chup', () => {
    const s = build({ cards: [card({ id: 'g1', title: 'alpha', createdAt: new Date('nope') }), card({ id: 'g2', title: 'alpha' })] });
    expect(s.idf.docCount).toBe(1);
  });

  it('`now` khong hop le la loi lap trinh -> RangeError', () => {
    expect(() => build({ now: new Date('nope') })).toThrow(RangeError);
    expect(() => build({ now: new Date(Number.NaN) })).toThrow(/now/);
  });
});

describe('buildSnapshot - lien ket the-nguoi tai thoi diem now', () => {
  it('lien ket tao SAU now bi bo (chua co luc do); tao DUNG luc now thi tinh', () => {
    const past = done({ id: 'p1', completedAt: ago(2) });
    const live = card({ id: 'p2' });
    const s = build({
      cards: [past, live],
      memberships: [mem('p1', 'u1', ahead(1)), mem('p2', 'u1', NOW)],
    });
    expect(cand(s, 'u1').history).toEqual([]);
    expect(ids(cand(s, 'u1').openCards)).toEqual(['p2']);
    const s2 = build({ cards: [live], memberships: [mem('p2', 'u1', new Date(NOW.getTime() + 1))] });
    expect(cand(s2, 'u1').openCards).toEqual([]);
  });
});

describe('buildSnapshot - ung vien, ho so lam viec', () => {
  it('giu thu tu ung vien, bo userId trung, nguoi khong co the nao van co mat voi mang rong', () => {
    const s = build({ candidateIds: ['u3', 'u1', 'u3', 'u2', 'u1'] });
    expect(s.candidates.map((c) => c.userId)).toEqual(['u3', 'u1', 'u2']);
    for (const c of s.candidates) {
      expect(c.history).toEqual([]);
      expect(c.openCards).toEqual([]);
    }
    expect(build({ candidateIds: [] }).candidates).toEqual([]);
  });

  it('suc chua va tam nghi lay tu ho so; khong co ho so -> suc chua bo trong (bo cham dung mac dinh), pausedUntil = null', () => {
    const until = ahead(3);
    const s = build({
      candidateIds: ['u1', 'u2'],
      profiles: new Map([['u1', { maxParallelCards: 3, pausedUntil: until }]]),
    });
    expect(cand(s, 'u1').maxParallelCards).toBe(3);
    expect(cand(s, 'u1').pausedUntil).toBe(until);
    expect(cand(s, 'u2').maxParallelCards).toBeUndefined();
    expect(cand(s, 'u2').pausedUntil).toBeNull();
    const s2 = build({ profiles: new Map([['u1', { maxParallelCards: 5, pausedUntil: null }]]) });
    expect(cand(s2, 'u1').pausedUntil).toBeNull();
  });

  it('suc chua khong hop le (0, am, le, NaN) bi bo de bo cham khong nem loi; 1 la hop le', () => {
    for (const bad of [0, -1, 2.5, Number.NaN, Infinity]) {
      const s = build({ profiles: new Map([['u1', { maxParallelCards: bad, pausedUntil: null }]]) });
      expect(cand(s, 'u1').maxParallelCards, String(bad)).toBeUndefined();
      // Va bo cham chay duoc tren ket qua do
      expect(() =>
        rankCandidates({ title: 'x' }, s.candidates, { idf: s.idf, now: NOW, groupOnTimeRate: s.mu })
      ).not.toThrow();
    }
    const one = build({ profiles: new Map([['u1', { maxParallelCards: 1, pausedUntil: null }]]) });
    expect(cand(one, 'u1').maxParallelCards).toBe(1);
  });
});

describe('buildSnapshot - muy (ti le dung han cua nhom) va kho ngu lieu', () => {
  it('muy tinh tren MOI the da xong co han (ke ca cua nguoi khong nam trong ung vien): 1 / 0,5 / 0', () => {
    const cards = [
      done({ id: 'y1', completedAt: ago(5), dueDate: ago(4) }), // dung han: 1
      done({ id: 'y2', completedAt: ago(5), dueDate: ago(6) }), // tre: 0
      done({ id: 'y3', completedAt: ago(5), dueDate: ago(4) }), // dung han nhung mo lai: 0,5
      done({ id: 'y4', completedAt: ago(5), dueDate: null }), // khong han: bo
      card({ id: 'y5', dueDate: ago(1) }), // chua xong: bo
    ];
    const s = build({ cards, reopened: new Set(['y3']), candidateIds: ['u1'] });
    expect(s.mu).toBeCloseTo((1 + 0 + 0.5) / 3, 12);
  });

  it('muy: khong the nao co han -> null; the xong sau now khong duoc tinh', () => {
    expect(build({ cards: [] }).mu).toBeNull();
    expect(build({ cards: [done({ id: 'n1', dueDate: null })] }).mu).toBeNull();
    const s = build({
      cards: [done({ id: 'n2', completedAt: ago(5), dueDate: ago(4) }), done({ id: 'n3', completedAt: ahead(2), dueDate: ahead(1) })],
    });
    expect(s.mu).toBe(1); // n3 (tre nhung xong sau now) khong lam muy tut xuong
  });

  it('kho ngu lieu = moi the DA CO luc now (ke ca da xong, da luu tru, khong ai nhan); the tao sau now khong tinh', () => {
    const s = build({
      cards: [
        card({ id: 'd1', title: 'alpha beta' }),
        done({ id: 'd2', title: 'alpha' }),
        card({ id: 'd3', title: 'alpha', archived: true }),
        card({ id: 'd4', title: 'gamma', createdAt: ahead(1) }),
        card({ id: 'd5', title: 'gamma', createdAt: new Date(NOW.getTime() + 1) }),
        card({ id: 'd6', title: 'delta', createdAt: NOW }),
      ],
    });
    expect(s.idf.docCount).toBe(4); // d1, d2, d3, d6 (d6 tao dung luc now)
    expect(s.idf.df.get('alpha')).toBe(3);
    expect(s.idf.df.get('beta')).toBe(1);
    expect(s.idf.df.get('delta')).toBe(1);
    expect(s.idf.df.has('gamma')).toBe(false);
  });
});

describe('buildSnapshot - bat bien chung', () => {
  const fixture = () => {
    const rng = new Rng(7);
    const cards: SnapshotCard[] = [];
    const memberships: SnapshotMembership[] = [];
    for (let i = 0; i < 40; i += 1) {
      const isDone = rng.chance(0.6);
      const c = card({
        id: `r${i}`,
        title: rng.pick(['thiet ke giao dien', 'viet api', 'kiem thu', 'trien khai may chu']),
        description: rng.chance(0.5) ? 'mo ta chi tiet' : null,
        isDone,
        completedAt: isDone ? ago(rng.int(60)) : null,
        dueDate: rng.chance(0.8) ? ago(rng.int(60) - 20) : null,
        archived: rng.chance(0.15),
        createdAt: ago(100 + rng.int(50)),
        startDate: rng.chance(0.5) ? ago(rng.int(40)) : null,
      });
      cards.push(c);
      memberships.push(mem(c.id, `u${1 + rng.int(4)}`, ago(70 + rng.int(20))));
      if (rng.chance(0.2)) memberships.push(mem(c.id, `u${1 + rng.int(4)}`, ago(70 + rng.int(20))));
    }
    const reopened = new Set(cards.filter(() => rng.chance(0.2)).map((c) => c.id));
    const profiles = new Map([['u2', { maxParallelCards: 3, pausedUntil: null }]]);
    return { cards, memberships, reopened, profiles };
  };
  const canon = (s: Snapshot) => ({
    mu: s.mu,
    docCount: s.idf.docCount,
    df: [...s.idf.df.entries()].sort(),
    candidates: s.candidates
      .map((c) => ({
        ...c,
        history: [...c.history].sort((a, b) => (a.cardId < b.cardId ? -1 : 1)),
        openCards: [...c.openCards].sort((a, b) => (a.cardId < b.cardId ? -1 : 1)),
      }))
      .sort((a, b) => (a.userId < b.userId ? -1 : 1)),
  });

  it('KHONG phu thuoc thu tu dau vao (cards / memberships / candidateIds xao tron 25 lan)', () => {
    const f = fixture();
    const candidateIds = ['u1', 'u2', 'u3', 'u4'];
    const base = canon(build({ ...f, candidateIds, targetCardId: 'r3' }));
    const rng = new Rng(99);
    const shuffle = <T,>(xs: readonly T[]): T[] => {
      const a = [...xs];
      for (let i = a.length - 1; i > 0; i -= 1) {
        const j = rng.int(i + 1);
        [a[i], a[j]] = [a[j]!, a[i]!];
      }
      return a;
    };
    for (let i = 0; i < 25; i += 1) {
      const s = build({
        cards: shuffle(f.cards),
        memberships: shuffle(f.memberships),
        reopened: f.reopened,
        profiles: f.profiles,
        candidateIds: shuffle(candidateIds),
        targetCardId: 'r3',
      });
      expect(canon(s)).toEqual(base);
    }
    // Va co du lieu that su (khong phai so sanh hai anh chup rong)
    expect(base.candidates.some((c) => c.history.length > 3)).toBe(true);
    expect(base.candidates.some((c) => c.openCards.length > 1)).toBe(true);
  });

  it('khong sua dau vao (mang / doi tuong dong bang van chay; ban sao JSON truoc = sau)', () => {
    const f = fixture();
    const frozen = {
      cards: Object.freeze(f.cards.map((c) => Object.freeze({ ...c }))) as readonly SnapshotCard[],
      memberships: Object.freeze(f.memberships.map((m) => Object.freeze({ ...m }))) as readonly SnapshotMembership[],
    };
    const before = JSON.stringify([f.cards, f.memberships, [...f.reopened]]);
    expect(() =>
      build({ ...frozen, reopened: f.reopened, profiles: f.profiles, candidateIds: Object.freeze(['u1', 'u2']) as readonly string[] })
    ).not.toThrow();
    expect(JSON.stringify([f.cards, f.memberships, [...f.reopened]])).toBe(before);
  });
});

describe('buildSnapshot - dua vao bo cham that', () => {
  it('nguoi da lam 3 the giong the moi len dau; nguoi chua co lich su bi co NO_HISTORY; bang chung chi tro toi the cua chinh ho', () => {
    const titles = ['Thiet ke giao dien dang nhap', 'Thiet ke giao dien dang ky', 'Thiet ke giao dien trang chu'];
    const cards: SnapshotCard[] = [
      ...titles.map((t, i) => done({ id: `A${i}`, title: t, completedAt: ago(30 + i), dueDate: ago(25 + i) })),
      done({ id: 'B0', title: 'Viet API thanh toan', completedAt: ago(20), dueDate: ago(15) }),
      card({ id: 'NEW', title: 'Thiet ke giao dien quen mat khau', dueDate: ahead(5) }),
    ];
    const s = build({
      cards,
      memberships: [mem('A0', 'ua'), mem('A1', 'ua'), mem('A2', 'ua'), mem('B0', 'ub')],
      candidateIds: ['ua', 'ub', 'uc'],
      targetCardId: 'NEW',
    });
    const ranked = rankCandidates(
      { id: 'NEW', title: 'Thiet ke giao dien quen mat khau', dueDate: ahead(5) },
      s.candidates,
      { idf: s.idf, now: NOW, groupOnTimeRate: s.mu }
    );
    expect(ranked[0]!.userId).toBe('ua');
    expect(ranked[0]!.evidence.length).toBeGreaterThan(0);
    for (const e of ranked[0]!.evidence) expect(['A0', 'A1', 'A2']).toContain(e.cardId);
    const uc = ranked.find((r) => r.userId === 'uc')!;
    expect(uc.flags).toContain('NO_HISTORY');
    expect(ranked.find((r) => r.userId === 'ub')!.evidence.every((e) => e.cardId === 'B0')).toBe(true);
  });
});

// ===================== Doi chieu voi duong bo nho (snapshotAsOf) =====================

describe('buildSnapshot - DOI CHIEU voi snapshotAsOf tren bo mo phong', () => {
  const data = generateSimulation(DEFAULT_SIM);
  // simReplay chup "hom nay" MOT LAN luc nap: dung cung cach de hai duong dung chung moc quy doi ngay
  const TODAY = vnToday();
  const at = (d: number, h = 0, m = 0) => simDayToDate(TODAY, data.config.days, d, h, m);

  // Bien bo sinh thanh dong "CSDL" giong het cach simSeed.ts ghi xuong
  const cards: SnapshotCard[] = data.cards.map((c) => ({
    id: c.key,
    title: c.title,
    description: c.description,
    createdAt: at(c.createdDay, 9),
    startDate: at(c.assignedDay, 0),
    dueDate: at(c.dueDay, 23, 59),
    isDone: c.done,
    completedAt: c.done && c.completedDay !== null ? at(c.completedDay, 17) : null,
    archived: false,
  }));
  const memberships: SnapshotMembership[] = data.cards.map((c) => ({
    cardId: c.key,
    userId: c.assigneeKey,
    createdAt: at(c.assignedDay, 10),
  }));
  const reopened = new Set(data.cards.filter((c) => c.done && c.reopened).map((c) => c.key));
  const profiles = new Map(data.people.map((p) => [p.key, { maxParallelCards: p.capacity, pausedUntil: null }]));

  function compare(day: number, hour: number, target: (typeof data.cards)[number], poolKeys: { key: string; capacity: number }[]) {
    const ref = snapshotAsOf(data, day, hour, poolKeys, target.key);
    const now = at(day, hour);
    const mine = buildSnapshot({
      cards,
      memberships,
      reopened,
      profiles,
      candidateIds: poolKeys.map((p) => p.key),
      targetCardId: target.key,
      now,
    });
    const scoreCard = {
      id: target.key,
      title: target.title,
      description: target.description,
      startDate: at(target.assignedDay),
      dueDate: at(target.dueDay, 23, 59),
    };
    expect(mine.mu).toBe(ref.mu);
    expect(mine.idf).toEqual(ref.idf);
    const rankRef = rankCandidates(scoreCard, ref.candidates, { idf: ref.idf, now: ref.now, groupOnTimeRate: ref.mu });
    const rankMine = rankCandidates(scoreCard, mine.candidates, { idf: mine.idf, now, groupOnTimeRate: mine.mu });
    expect(rankMine).toEqual(rankRef);
    return rankMine;
  }

  it('luc giao viec (cach phat lai o buoc 4b): ~30 the, xep hang giong het tung diem, tung co, tung bang chung', () => {
    let checked = 0;
    let withHistory = 0;
    for (const [i, c] of data.cards.entries()) {
      if (i % 4 !== 0 || c.assignedDay < 60) continue;
      const pool = assignablePool(data.people, c.assignedDay, c.dueDay);
      if (pool.length < 2) continue;
      const ranked = compare(c.assignedDay, 10, c, pool.map((p) => ({ key: p.key, capacity: p.capacity })));
      checked += 1;
      if (ranked.some((r) => r.evidence.length > 0)) withHistory += 1;
    }
    expect(checked).toBeGreaterThan(15);
    expect(withHistory).toBeGreaterThan(10); // khong phai so sanh hai ket qua rong
  });

  it('hom nay (the dang mo that): the xong luc 17:00 hom nay van dang mo luc 12:00 -> hai duong van khop', () => {
    const today = data.config.days;
    const pool = availableAt(data.people, today).map((p) => ({ key: p.key, capacity: p.capacity }));
    let checked = 0;
    let openShown = 0;
    for (const c of data.cards) {
      if (c.done) continue;
      const ranked = compare(today, 12, c, pool);
      checked += 1;
      if (ranked.some((r) => r.load > 0)) openShown += 1;
    }
    expect(checked).toBeGreaterThan(5);
    expect(openShown).toBeGreaterThan(0);
    // Mot the DA xong nhung xong SAU 12:00 hom nay: van phai khop (nhanh "xong sau now")
    const late = data.cards.filter((c) => c.done && c.completedDay === today);
    for (const c of late.slice(0, 5)) compare(today, 12, c, pool);
  });
});
