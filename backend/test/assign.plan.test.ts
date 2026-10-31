// Buoc 8a - lop 2: chia viec cho ca danh sach (assign.plan.ts). HAM THUAN: khong cham CSDL.
// (setup.ts van TRUNCATE truoc moi `it`.) Cac ca dung so TINH TAY tren du lieu dung san (moi nguoi / the chi mot chu de nen
// sim = 1, khong phu thuoc idf) va doi chieu ca voi rankCandidates cua lop 1; phan cuoi chay tren bo mo phong.
import { describe, expect, it } from 'vitest';
import { PLAN_MAX_CARDS, PLAN_VERSION, planAssignments, urgencyOrder, type PlanCard } from '../src/modules/assign/assign.plan';
import type { HistoryCard } from '../src/modules/assign/assign.profile';
import {
  rankCandidates,
  type CandidateInput,
  type OpenCard,
  type ScoreContext,
  type Weights,
} from '../src/modules/assign/assign.score';
import { countTerms } from '../src/modules/assign/assign.text';
import { buildIdf, type Idf } from '../src/modules/assign/assign.tfidf';
import { gini, maxShare, mean } from '../src/scripts/evalAssignStats';
import { cutBatches } from '../src/scripts/evalPlanBatches';
import { DEFAULT_SIM, Rng, generateSimulation } from '../src/scripts/simGenerator';

const DAY = 86_400_000;
const NOW = new Date('2026-09-20T00:00:00.000Z');
const at = (d: number) => new Date(NOW.getTime() + d * DAY);
const ago = (d: number) => at(-d);

const IDF: Idf = buildIdf(['alpha', 'beta', 'gamma', 'delta', 'alpha beta', 'alpha gamma'].map((t) => countTerms({ title: t })));
const CTX: ScoreContext = { idf: IDF, now: NOW, groupOnTimeRate: 0.5 };

/** The da xong `age` ngay truoc, han 1 ngay SAU luc xong (dung han). */
const hist = (cardId: string, title: string, age: number): HistoryCard => ({ cardId, title, completedAt: ago(age), dueDate: ago(age - 1) });
const cand = (userId: string, history: HistoryCard[] = [], openCards: OpenCard[] = [], over: Partial<CandidateInput> = {}): CandidateInput => ({
  userId,
  history,
  openCards,
  ...over,
});
/** The can chia: mac dinh cua so [now, now + 5 ngay], chu de 'alpha'. */
const pc = (id: string, over: Partial<PlanCard> = {}): PlanCard => ({
  id,
  title: 'alpha',
  description: null,
  startDate: at(0),
  dueDate: at(5),
  position: 0,
  ...over,
});
/** Hai nguoi co lich su GIONG HET nhau: chi tai va thu tu userId phan biet duoc ho. */
const twins = (): CandidateInput[] => [cand('A', [hist('a1', 'alpha', 10)]), cand('B', [hist('b1', 'alpha', 10)])];
/** A lam nhieu the giong, dung han; B chi lam viec khong lien quan -> A vuot troi ve kinh nghiem va tin cay. */
const strongA = (over: Partial<CandidateInput> = {}): CandidateInput[] => [
  cand('A', [hist('a1', 'alpha', 10), hist('a2', 'alpha', 20), hist('a3', 'alpha', 30)], [], over),
  cand('B', [hist('b1', 'delta', 10)]),
];
const idsOf = (rows: { assigneeId: string | null }[]) => rows.map((r) => r.assigneeId);

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
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

function shuffled<T>(xs: readonly T[], rng: Rng): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ===================== Thu tu xu ly =====================

describe('urgencyOrder', () => {
  it('han gap truoc; khong co han (hoac han hong) xuong cuoi; cung han thi theo vi tri trong danh sach, roi id; khong sua dau vao', () => {
    const cards = [
      pc('a', { dueDate: at(5), position: 0 }),
      pc('b', { dueDate: at(2), position: 3 }),
      pc('c', { dueDate: null, position: 0 }),
      pc('d', { dueDate: at(2), position: 1 }),
      pc('e', { dueDate: at(2), position: 1 }),
      pc('f', { dueDate: new Date('khong hop le'), position: 0 }),
    ];
    const before = cards.map((c) => c.id);
    const out = urgencyOrder(cards);
    expect(out.map((c) => c.id)).toEqual(['d', 'e', 'b', 'a', 'c', 'f']);
    expect(cards.map((c) => c.id)).toEqual(before); // dau vao khong bi sap xep lai
    expect(out).not.toBe(cards);
    expect(urgencyOrder([])).toEqual([]);
  });

  it('khong phu thuoc thu tu dau vao (moi hoan vi cho cung ket qua)', () => {
    const cards = [
      pc('a', { dueDate: at(3), position: 2 }),
      pc('b', { dueDate: at(3), position: 2 }),
      pc('c', { dueDate: null, position: 1 }),
      pc('d', { dueDate: at(1), position: 9 }),
    ];
    const expected = urgencyOrder(cards).map((c) => c.id);
    expect(expected).toEqual(['d', 'a', 'b', 'c']);
    const permute = (xs: PlanCard[]): PlanCard[][] =>
      xs.length <= 1 ? [xs] : xs.flatMap((x, i) => permute([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
    for (const p of permute(cards)) expect(urgencyOrder(p).map((c) => c.id)).toEqual(expected);
  });
});

// ===================== Vong lap tham lam =====================

describe('planAssignments - hanh vi', () => {
  it('the dau tien: xep hang DUNG BANG lop 1 (rankCandidates) va nguoi duoc chon la nguoi xep dau', () => {
    const candidates = [cand('A', [hist('a1', 'alpha', 10)]), cand('B', [hist('b1', 'delta', 10)]), cand('C')];
    const card = pc('c1');
    const rows = planAssignments({ cards: [card], candidates, ctx: CTX });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ranked).toEqual(rankCandidates(card, candidates, CTX));
    expect(rows[0]!.assigneeId).toBe(rows[0]!.ranked[0]!.userId);
    expect(rows[0]!.card).toBe(card);
  });

  it('the vua giao duoc CONG vao tai: hai nguoi ngang nhau thi luan phien A, B, A, B (so tinh tay: tai 0/1/1/2 va 0/0/1/1)', () => {
    const cards = ['c1', 'c2', 'c3', 'c4'].map((id, i) => pc(id, { position: i }));
    const rows = planAssignments({ cards, candidates: twins(), ctx: CTX });
    expect(idsOf(rows)).toEqual(['A', 'B', 'A', 'B']);
    const loadOf = (row: (typeof rows)[number], id: string) => row.ranked.find((r) => r.userId === id)!.load;
    expect(rows.map((r) => loadOf(r, 'A'))).toEqual([0, 1, 1, 2]);
    expect(rows.map((r) => loadOf(r, 'B'))).toEqual([0, 0, 1, 1]);
    // Cung dau vao NHUNG cham rieng tung the (khong cong tai): the nao cung ve A - chinh la chuyen "don het cho mot nguoi"
    const independent = cards.map((c) => rankCandidates(c, twins(), CTX)[0]!.userId);
    expect(independent).toEqual(['A', 'A', 'A', 'A']);
  });

  it('ba nguoi ngang nhau, sau the: moi nguoi dung hai the (A, B, C, A, B, C)', () => {
    const three = ['A', 'B', 'C'].map((u) => cand(u, [hist(`${u}1`, 'alpha', 10)]));
    const cards = Array.from({ length: 6 }, (_, i) => pc(`c${i}`, { position: i }));
    const rows = planAssignments({ cards, candidates: three, ctx: CTX });
    expect(idsOf(rows)).toEqual(['A', 'B', 'C', 'A', 'B', 'C']);
  });

  it('tai tinh THEO THOI GIAN: the o khoang khac khong chong lan thi khong cong tai (van ve A)', () => {
    const cards = [
      pc('near', { startDate: at(0), dueDate: at(5), position: 0 }),
      pc('far', { startDate: at(20), dueDate: at(25), position: 1 }),
    ];
    const rows = planAssignments({ cards, candidates: twins(), ctx: CTX });
    expect(idsOf(rows)).toEqual(['A', 'A']);
    expect(rows[1]!.ranked.find((r) => r.userId === 'A')!.load).toBe(0);
  });

  it('the ao giu DUNG khoang [bat dau, han] cua the da giao: the sau chi chong lan phan cuoi cua khoang van bi tinh tai', () => {
    // c1 o [0, 10], c2 o [8, 12]: chung nhau doan 8..10 -> sau khi A nhan c1, tai cua A voi c2 la 1 -> c2 ve B
    const cards = [
      pc('c1', { startDate: at(0), dueDate: at(10), position: 0 }),
      pc('c2', { startDate: at(8), dueDate: at(12), position: 1 }),
    ];
    const rows = planAssignments({ cards, candidates: twins(), ctx: CTX });
    expect(idsOf(rows)).toEqual(['A', 'B']);
    expect(rows[1]!.ranked.find((r) => r.userId === 'A')!.load).toBe(1);
  });

  it('the chi co ngay bat dau (khong han) chiem MOI thoi diem tu ngay do: khong chong lan cua so truoc no, chong lan cua so sau no', () => {
    const cards = [
      pc('e', { startDate: at(30), dueDate: null, position: 0 }),
      pc('l', { startDate: null, dueDate: null, position: 1 }), // cua so mac dinh [0, 14]: truoc ngay 30
      pc('m', { startDate: at(35), dueDate: null, position: 2 }), // cua so [35, 49]: sau ngay 30
    ];
    const rows = planAssignments({ cards, candidates: twins(), ctx: CTX });
    expect(rows.map((r) => r.card.id)).toEqual(['e', 'l', 'm']);
    expect(idsOf(rows)).toEqual(['A', 'A', 'B']);
    const loadA = rows.map((r) => r.ranked.find((x) => x.userId === 'A')!.load);
    // l: the e cua A bat dau ngay 30 nen khong chong lan [0, 14] (0); m: e (bat dau 30, khong han) va l (khong ngay) deu chong lan (2)
    expect(loadA).toEqual([0, 0, 2]);
  });

  it('the dang mo THAT cua ung vien van duoc tinh, cong voi the ao: A dang co 2 the chong lan thi B nhan truoc (B, B, roi hoa -> A)', () => {
    const busy = cand('A', [hist('a1', 'alpha', 10)], [
      { cardId: 'o1', startDate: at(-2), dueDate: at(3) },
      { cardId: 'o2', startDate: at(-1), dueDate: at(4) },
    ]);
    const cards = ['c1', 'c2', 'c3'].map((id, i) => pc(id, { position: i }));
    const rows = planAssignments({ cards, candidates: [busy, cand('B', [hist('b1', 'alpha', 10)])], ctx: CTX });
    expect(idsOf(rows)).toEqual(['B', 'B', 'A']);
    expect(rows.map((r) => r.ranked.find((x) => x.userId === 'A')!.load)).toEqual([2, 2, 2]); // the that cua A, khong doi
    expect(rows.map((r) => r.ranked.find((x) => x.userId === 'B')!.load)).toEqual([0, 1, 2]); // the ao cua B
  });

  it('the KHONG co ngay khi da giao thi chong lan moi khoang (dung nhu sau khi giao that, §5.6)', () => {
    const cards = [
      pc('z', { startDate: at(20), dueDate: at(25), position: 0 }), // co han -> xu ly TRUOC
      pc('p1', { startDate: null, dueDate: null, position: 0 }),
      pc('p2', { startDate: null, dueDate: null, position: 1 }),
    ];
    const rows = planAssignments({ cards, candidates: twins(), ctx: CTX });
    expect(rows.map((r) => r.card.id)).toEqual(['z', 'p1', 'p2']);
    // z o [20, 25], p1 o cua so mac dinh [0, 14]: khong chong lan -> A; p2: the p1 khong ngay cua A chong lan -> B
    expect(idsOf(rows)).toEqual(['A', 'A', 'B']);
    expect(rows[2]!.ranked.find((r) => r.userId === 'A')!.load).toBe(1);
  });

  it('nguoi vuot troi ve kinh nghiem va tin cay VAN nhan moi the: tai chi tac dong qua thanh phan kha dung (1 - tai / suc chua)', () => {
    // Day la GIOI HAN da do (§10.10): chuan hoa min-max lam moi chenh lech deu thanh 0..1, nen mot thanh phan (kha dung, trong
    // so 0,25) khong thang noi hai thanh phan con lai (0,75). Cho nen ban xem truoc PHAI canh bao qua tai va cho doi nguoi.
    const cards = Array.from({ length: 4 }, (_, i) => pc(`c${i}`, { position: i }));
    const rows = planAssignments({ cards, candidates: strongA(), ctx: CTX });
    expect(idsOf(rows)).toEqual(['A', 'A', 'A', 'A']);
    const availA = rows.map((r) => r.ranked.find((x) => x.userId === 'A')!.components.availability.value);
    expect(availA[0]).toBeCloseTo(1, 12);
    expect(availA[1]).toBeCloseTo(0.8, 12);
    expect(availA[2]).toBeCloseTo(0.6, 12);
    expect(availA[3]).toBeCloseTo(0.4, 12);
    // Suc chua 1: sau the dau A het cho -> cac the sau van ve A nhung mang co OVERLOADED de giao dien canh bao
    const tight = planAssignments({ cards, candidates: strongA({ maxParallelCards: 1 }), ctx: CTX });
    expect(idsOf(tight)).toEqual(['A', 'A', 'A', 'A']);
    expect(tight.map((r) => r.ranked.find((x) => x.userId === 'A')!.flags.includes('OVERLOADED'))).toEqual([false, true, true, true]);
  });

  it('nguoi dang tam nghi bi BO QUA (theo cua so cua TUNG the); nguoi khong con tam nghi o the sau lai duoc xet', () => {
    const cards = [
      pc('now', { startDate: at(0), dueDate: at(5) }),
      pc('later', { startDate: at(40), dueDate: at(45) }),
    ];
    // A tam nghi den ngay +30: the dau (cua so bat dau ngay 0) bi PAUSED; the sau (bat dau ngay 40) thi khong
    const rows = planAssignments({ cards, candidates: strongA({ pausedUntil: at(30) }), ctx: CTX });
    expect(rows[0]!.card.id).toBe('now');
    expect(rows[0]!.ranked.find((r) => r.userId === 'A')!.flags).toContain('PAUSED');
    expect(rows[0]!.assigneeId).toBe('B');
    expect(rows[1]!.ranked.find((r) => r.userId === 'A')!.flags).not.toContain('PAUSED');
    expect(rows[1]!.assigneeId).toBe('A');
  });

  it('moi nguoi deu tam nghi -> khong ai duoc chon (de trong, khong bia), va khong co tai ao nao phat sinh', () => {
    const paused = ['A', 'B'].map((u) => cand(u, [hist(`${u}1`, 'alpha', 10)], [], { pausedUntil: at(30) }));
    const rows = planAssignments({ cards: [pc('c1', { position: 0 }), pc('c2', { position: 1 })], candidates: paused, ctx: CTX });
    expect(idsOf(rows)).toEqual([null, null]);
    for (const r of rows) {
      expect(r.ranked).toHaveLength(2);
      expect(r.ranked.every((x) => x.flags.includes('PAUSED'))).toBe(true);
      expect(r.ranked.every((x) => x.load === 0)).toBe(true);
    }
  });

  it('nguoi khong co diem (NO_DATA) khong bao gio duoc chon; khong ai co diem -> de trong', () => {
    const expOnly: Weights = { experience: 1, reliability: 0, availability: 0, declared: 0 };
    const ctx: ScoreContext = { ...CTX, weights: expOnly };
    // 'a0' chua co lich su: khong co kinh nghiem, cac thanh phan con lai trong so 0 -> khong co diem
    const candidates = [cand('a0'), cand('b1', [hist('h', 'alpha', 10)])];
    const rows = planAssignments({ cards: [pc('c1', { position: 0 }), pc('c2', { position: 1 })], candidates, ctx });
    expect(rows[0]!.ranked.find((r) => r.userId === 'a0')!.score).toBeNull();
    expect(idsOf(rows)).toEqual(['b1', 'b1']);
    const none = planAssignments({ cards: [pc('c1')], candidates: [cand('a0'), cand('a1')], ctx });
    expect(idsOf(none)).toEqual([null]);
  });

  it('moi the dung mot lan, theo thu tu han gap; dong tra ve dung the dau vao', () => {
    const cards = [
      pc('late', { dueDate: at(9), position: 0 }),
      pc('soon', { dueDate: at(1), position: 5 }),
      pc('none', { dueDate: null, startDate: null, position: 0 }),
      pc('mid', { dueDate: at(4), position: 2 }),
    ];
    const rows = planAssignments({ cards, candidates: strongA(), ctx: CTX });
    expect(rows.map((r) => r.card.id)).toEqual(['soon', 'mid', 'late', 'none']);
    expect(new Set(rows.map((r) => r.card.id)).size).toBe(4);
    for (const r of rows) expect(cards).toContain(r.card);
    expect(numbersOf(rows).every((x) => Number.isFinite(x))).toBe(true);
  });

  it('ca bien: khong co the -> mang rong; khong ung vien -> de trong tung the; mot ung vien -> nhan het', () => {
    expect(planAssignments({ cards: [], candidates: twins(), ctx: CTX })).toEqual([]);
    const noOne = planAssignments({ cards: [pc('c1'), pc('c2', { position: 1 })], candidates: [], ctx: CTX });
    expect(idsOf(noOne)).toEqual([null, null]);
    expect(noOne.every((r) => r.ranked.length === 0)).toBe(true);
    const solo = planAssignments({ cards: [pc('c1'), pc('c2', { position: 1 }), pc('c3', { position: 2 })], candidates: [cand('A')], ctx: CTX });
    expect(idsOf(solo)).toEqual(['A', 'A', 'A']);
  });

  it('dau vao sai bi tu choi: trung id the, vi tri khong phai so, trung userId ung vien', () => {
    expect(() => planAssignments({ cards: [pc('x'), pc('x')], candidates: twins(), ctx: CTX })).toThrow(/trung id/);
    expect(() => planAssignments({ cards: [pc('x', { position: Number.NaN })], candidates: twins(), ctx: CTX })).toThrow(/vi tri/);
    expect(() => planAssignments({ cards: [pc('x', { position: Number.POSITIVE_INFINITY })], candidates: twins(), ctx: CTX })).toThrow(RangeError);
    expect(() => planAssignments({ cards: [pc('x')], candidates: [cand('A'), cand('A')], ctx: CTX })).toThrow(/trung userId/);
  });

  it('khong sua dau vao (dong bang toan bo) va tat dinh (hai lan chay cho ket qua y het)', () => {
    const cards = [pc('c1', { position: 0 }), pc('c2', { position: 1 })];
    const candidates = twins();
    candidates[0]!.openCards = [{ cardId: 'old', startDate: at(-2), dueDate: at(3) }];
    const input = { cards, candidates, ctx: CTX };
    const snapshot = JSON.stringify(input);
    deepFreeze(input);
    const first = planAssignments(input);
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(candidates[0]!.openCards).toHaveLength(1); // the ao khong bi ghi vao the dang mo that cua ung vien
    expect(planAssignments(input)).toEqual(first);
  });

  it('khong phu thuoc thu tu the va thu tu ung vien trong dau vao (20 lan xao tron tren tinh huong ngau nhien)', () => {
    const rng = new Rng(20260921);
    const titles = ['alpha', 'beta', 'gamma', 'delta', 'alpha beta', 'alpha gamma'];
    const candidates: CandidateInput[] = ['u1', 'u2', 'u3', 'u4', 'u5'].map((u, i) =>
      cand(
        u,
        Array.from({ length: 2 + rng.int(5) }, (_, k) => hist(`${u}-h${k}`, titles[rng.int(titles.length)]!, 5 + rng.int(60))),
        Array.from({ length: rng.int(3) }, (_, k) => ({ cardId: `${u}-o${k}`, startDate: at(-rng.int(5)), dueDate: at(1 + rng.int(12)) })),
        { maxParallelCards: 2 + (i % 4) }
      )
    );
    const cards = Array.from({ length: 9 }, (_, i) =>
      pc(`c${i}`, {
        title: titles[rng.int(titles.length)]!,
        startDate: rng.int(4) === 0 ? null : at(rng.int(6)),
        dueDate: rng.int(5) === 0 ? null : at(3 + rng.int(15)),
        position: rng.int(3),
      })
    );
    const base = planAssignments({ cards, candidates, ctx: CTX });
    const key = (rows: typeof base) => rows.map((r) => `${r.card.id}>${r.assigneeId}|${r.ranked.map((x) => x.userId).join(',')}`);
    for (let t = 0; t < 20; t += 1) {
      const again = planAssignments({ cards: shuffled(cards, rng), candidates: shuffled(candidates, rng), ctx: CTX });
      expect(key(again)).toEqual(key(base));
    }
    // Co nhieu nguoi duoc chon (tinh huong khong tam thuong)
    expect(new Set(idsOf(base)).size).toBeGreaterThan(1);
  });

  it('hang so cong bo: toi da 30 the / lan (ap dung o tang dich vu), phien ban cach chia', () => {
    expect(PLAN_MAX_CARDS).toBe(30);
    expect(PLAN_VERSION).toBe('greedy-v1');
  });
});

// ===================== Tren bo mo phong =====================

describe('planAssignments - tren bo du lieu mo phong (hat giong dev 93xx, khong nam trong 20 hat giong danh gia)', () => {
  const K = 12;
  const SEEDS = [9301, 9302, 9303, 9304, 9305, 9306, 9307, 9308, 9309, 9310, 9311, 9312];
  const DAYS = [90, 150, 210];

  // Cat dot bang ham thuan dung chung voi bo danh gia lop 2 (buoc 9: evalPlanBatches.ts) - khong lap lai logic o day.
  function batches() {
    const out: { plannedCounts: number[]; independentCounts: number[] }[] = [];
    for (const seed of SEEDS) {
      const data = generateSimulation({ ...DEFAULT_SIM, seed });
      for (const batch of cutBatches(data, DAYS, K)) {
        const { cards, candidates, ctx, poolKeys } = batch;
        const rows = planAssignments({ cards, candidates, ctx });

        // Bat bien: moi the dung mot lan, nguoi nhan nam trong ho boi, moi so huu han
        expect(rows).toHaveLength(K);
        expect(new Set(rows.map((r) => r.card.id)).size).toBe(K);
        const poolKeySet = new Set(poolKeys);
        for (const r of rows) {
          expect(r.assigneeId !== null && poolKeySet.has(r.assigneeId)).toBe(true);
          expect(r.ranked).toHaveLength(poolKeys.length);
        }
        expect(numbersOf(rows.map((r) => r.ranked)).every((x) => Number.isFinite(x))).toBe(true);

        const countsOf = (ids: (string | null)[]) => poolKeys.map((k) => ids.filter((i) => i === k).length);
        const independent = urgencyOrder(cards).map((c) => rankCandidates(c, candidates, ctx).find((r) => r.score !== null)!.userId);
        out.push({ plannedCounts: countsOf(idsOf(rows)), independentCounts: countsOf(independent) });
      }
    }
    return out;
  }

  it('cong tai ao lam GIAM dan viec dot bien: nguoi nhieu nhat va Gini thap hon ro rang so voi cham rieng tung the (do tham do: 35% vs 49%)', () => {
    const all = batches();
    expect(all.length).toBeGreaterThanOrEqual(30);
    const planMax = mean(all.map((b) => maxShare(b.plannedCounts)));
    const indMax = mean(all.map((b) => maxShare(b.independentCounts)));
    const planGini = mean(all.map((b) => gini(b.plannedCounts)));
    const indGini = mean(all.map((b) => gini(b.independentCounts)));
    expect(planMax).toBeLessThan(indMax - 0.05);
    expect(planGini).toBeLessThan(indGini - 0.05);
    // Chi la GIAM chu khong phai chia deu: nguoi nhieu nhat van hon phan chia deu (gioi han da ghi o §10.10)
    expect(planMax).toBeGreaterThan(1 / 6);
  });
});
