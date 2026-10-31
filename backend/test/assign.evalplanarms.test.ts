// Buoc 9a - lop 2: cac "cach chia" doi chung (evalPlanArms.ts). HAM THUAN: khong cham CSDL.
// Phan pick* dung RankedCandidate GIA (tu xay, khong qua rankCandidates that) de tinh tay chinh xac, tach rieng khoi
// cong thuc cham diem cua lop 1 (da co test rieng o assign.score.test.ts). Phan runGreedyBatch dung du lieu that.
import { describe, expect, it } from 'vitest';
import type { PlanCard } from '../src/modules/assign/assign.plan';
import {
  makeRoundRobin,
  pickCapped,
  pickIndependent,
  pickPenalty,
  pickPlannedLikeProduct,
  runGreedyBatch,
  type PlanArmContext,
} from '../src/scripts/evalPlanArms';
import type { CandidateInput, ComponentScore, Flag, RankedCandidate } from '../src/modules/assign/assign.score';
import { buildIdf, type Idf } from '../src/modules/assign/assign.tfidf';
import { countTerms } from '../src/modules/assign/assign.text';
import type { HistoryCard } from '../src/modules/assign/assign.profile';

const NOW = new Date('2026-09-22T00:00:00.000Z');
const DAY = 86_400_000;
const at = (d: number) => new Date(NOW.getTime() + d * DAY);

const ZERO: ComponentScore = { value: null, weight: 0, scaled: null, share: 0 };

/** RankedCandidate GIA: chi dien dung nhung truong cac pick* thuc su doc (userId, score, flags); phan con lai la
 * gia tri trung lap hop le de dung kieu, khong anh huong ket qua. */
function fakeRanked(userId: string, score: number | null, flags: Flag[] = []): RankedCandidate {
  return {
    userId,
    score,
    rawScore: score,
    confidence: 0,
    confidenceLevel: 'THIN',
    components: { experience: ZERO, reliability: ZERO, availability: ZERO },
    evidence: [],
    evidenceMass: 0,
    fit: 0,
    load: 0,
    capacity: 5,
    flags,
    rank: 1,
  };
}

const ctxOf = (over: Partial<PlanArmContext> = {}): PlanArmContext => ({ ranked: [], blind: [], counts: new Map(), ...over });

describe('pickIndependent', () => {
  it('chon nguoi xep dau trong BLIND (bo qua ranked cong don) - ca hai mang gia da SAP THEO DIEM, dung nhu rankCandidates that tra ve', () => {
    const blind = [fakeRanked('B', 90), fakeRanked('A', 80)];
    const ranked = [fakeRanked('A', 95), fakeRanked('B', 10)]; // gia lap da cong don: neu dung ranked se ra A, dung blind phai ra B
    expect(pickIndependent(ctxOf({ blind, ranked }))).toBe('B');
  });

  it('bo qua nguoi tam nghi hoac khong diem; khong ai du dieu kien -> null', () => {
    const blind = [fakeRanked('A', 90, ['PAUSED']), fakeRanked('B', null), fakeRanked('C', 50)];
    expect(pickIndependent(ctxOf({ blind }))).toBe('C');
    expect(pickIndependent(ctxOf({ blind: [fakeRanked('A', 90, ['PAUSED']), fakeRanked('B', null)] }))).toBeNull();
  });
});

describe('pickPlannedLikeProduct', () => {
  it('dung nguoi xep dau du dieu kien trong RANKED (cong don) - dung luat cua planAssignments', () => {
    const ranked = [fakeRanked('A', 90, ['PAUSED']), fakeRanked('B', 70), fakeRanked('C', 60)];
    expect(pickPlannedLikeProduct(ctxOf({ ranked }))).toBe('B');
  });
});

describe('pickCapped', () => {
  it('uu tien nguoi CHUA cham tran, tinh tam trong danh sach da xep hang', () => {
    const ranked = [fakeRanked('A', 90), fakeRanked('B', 80), fakeRanked('C', 70)];
    const pick = pickCapped(1);
    expect(pick(ctxOf({ ranked, counts: new Map([['A', 1]]) }))).toBe('B'); // A da cham tran 1 -> bo qua
    expect(pick(ctxOf({ ranked, counts: new Map() }))).toBe('A');
  });

  it('het ca nhom cham tran -> fallback ve nguoi du dieu kien tot nhat, KHONG bo trong (tran chi la uu tien mem)', () => {
    const ranked = [fakeRanked('A', 90), fakeRanked('B', 80)];
    const pick = pickCapped(1);
    expect(pick(ctxOf({ ranked, counts: new Map([['A', 1], ['B', 1]]) }))).toBe('A');
  });

  it('khong ai du dieu kien (tam nghi/khong diem) -> null du tran con cho', () => {
    const ranked = [fakeRanked('A', null), fakeRanked('B', 80, ['PAUSED'])];
    expect(pickCapped(5)(ctxOf({ ranked }))).toBeNull();
  });

  it('tu choi cap khong hop le', () => {
    expect(() => pickCapped(0)).toThrow(RangeError);
    expect(() => pickCapped(-1)).toThrow(RangeError);
    expect(() => pickCapped(NaN)).toThrow(RangeError);
    expect(() => pickCapped(Infinity)).toThrow(RangeError);
  });
});

describe('pickPenalty', () => {
  it('tinh tay: diem tru lambda*so the da nhan, ai cao hon sau khi tru thi thang', () => {
    // A=80 da nhan 2 the (80 - 10*2=60); B=70 chua nhan the nao (70-0=70) -> B thang
    const ranked = [fakeRanked('A', 80), fakeRanked('B', 70)];
    const counts = new Map([['A', 2]]);
    expect(pickPenalty(10)(ctxOf({ ranked, counts }))).toBe('B');
    // lambda nho hon: A=80-5*2=70 = B=70 -> hoa thi theo userId ('A' < 'B')
    expect(pickPenalty(5)(ctxOf({ ranked, counts }))).toBe('A');
  });

  it('bo qua nguoi tam nghi/khong diem; khong ai du dieu kien -> null', () => {
    const ranked = [fakeRanked('A', 80, ['PAUSED']), fakeRanked('B', null)];
    expect(pickPenalty(10)(ctxOf({ ranked }))).toBeNull();
  });

  it('tu choi lambda am hoac khong huu han; lambda = 0 la HOP LE (khong phat)', () => {
    expect(() => pickPenalty(-1)).toThrow(RangeError);
    expect(() => pickPenalty(NaN)).toThrow(RangeError);
    expect(() => pickPenalty(Infinity)).toThrow(RangeError);
    expect(() => pickPenalty(0)).not.toThrow();
    // lambda = 0: khong ai bi tru diem -> ai diem cao hon thang, dung nhu khong co phat
    const ranked = [fakeRanked('A', 80), fakeRanked('B', 70)];
    expect(pickPenalty(0)(ctxOf({ ranked, counts: new Map([['A', 5]]) }))).toBe('A');
  });
});

describe('makeRoundRobin', () => {
  it('chia vong tron theo thu tu KHOA da sap (tat dinh, khong phu thuoc thu tu truyen vao)', () => {
    const pick = makeRoundRobin(['c', 'a', 'b']);
    const ctx = ctxOf();
    expect([pick(ctx), pick(ctx), pick(ctx), pick(ctx)]).toEqual(['a', 'b', 'c', 'a']);
  });

  it('mang rong -> luon null; moi lan goi makeRoundRobin() la mot con tro rieng', () => {
    expect(makeRoundRobin([])(ctxOf())).toBeNull();
    const p1 = makeRoundRobin(['a', 'b']);
    const p2 = makeRoundRobin(['a', 'b']);
    p1(ctxOf());
    expect(p2(ctxOf())).toBe('a'); // p2 khong bi anh huong boi p1
  });
});

// ===================== runGreedyBatch (du lieu that qua rankCandidates) =====================

const IDF: Idf = buildIdf(['alpha', 'beta', 'alpha beta'].map((t) => countTerms({ title: t })));
const CTX = { idf: IDF, now: NOW, groupOnTimeRate: 0.5 };
const hist = (cardId: string, title: string, age: number): HistoryCard => ({ cardId, title, completedAt: at(-age), dueDate: at(-age + 1) });
const cand = (userId: string, history: HistoryCard[] = []): CandidateInput => ({ userId, history, openCards: [] });
const pc = (id: string, dueDate: Date, position = 0): PlanCard => ({ id, title: 'alpha', description: null, startDate: at(0), dueDate, position });

describe('runGreedyBatch', () => {
  it('hai nguoi lich su GIONG HET (twins): the vua chia cong vao tai lam nguoi kia thang o the sau -> luan phien A, B, A', () => {
    const candidates = [cand('A', [hist('a1', 'alpha', 10)]), cand('B', [hist('b1', 'alpha', 10)])];
    const cards = [pc('x', at(5)), pc('y', at(5), 1), pc('z', at(5), 2)];
    const rows = runGreedyBatch(cards, candidates, CTX, pickPlannedLikeProduct);
    expect(rows.map((r) => r.assigneeId)).toEqual(['A', 'B', 'A']); // hoa thi userId nho hon truoc ('A' < 'B')
    // Tai bao cao (load) TANG DAN cho A giua lan nhan thu nhat (the x, tai 0) va lan thu hai (the z, tai >= 1)
    const aLoads = rows.filter((r) => r.assigneeId === 'A').map((r) => r.load);
    expect(aLoads[1]).toBeGreaterThan(aLoads[0]!);
  });

  it('KHONG sua dau vao cards/candidates', () => {
    const candidates = Object.freeze([cand('A'), cand('B')].map((c) => Object.freeze(c)));
    const cards = Object.freeze([pc('x', at(5)), pc('y', at(5), 1)].map((c) => Object.freeze(c)));
    expect(() => runGreedyBatch(cards, candidates, CTX, pickIndependent)).not.toThrow();
  });

  it('twins + pickIndependent (het BATCH that qua runGreedyBatch): khong cong don tai nen CA BA the deu ve tay A (khac han pickPlannedLikeProduct luan phien) - kiem dung ca `blind` la mang KHONG cong don duoc noi dung', () => {
    const candidates = [cand('A', [hist('a1', 'alpha', 10)]), cand('B', [hist('b1', 'alpha', 10)])];
    const cards = [pc('x', at(5)), pc('y', at(5), 1), pc('z', at(5), 2)];
    const rows = runGreedyBatch(cards, candidates, CTX, pickIndependent);
    expect(rows.map((r) => r.assigneeId)).toEqual(['A', 'A', 'A']);
  });

  it('pick() tra ve nguoi ngoai ho boi thi nem loi VOI DUNG THONG DIEP (bao ve khoi loi ngam trong pick tuy chinh)', () => {
    const candidates = [cand('A')];
    const cards = [pc('x', at(5))];
    expect(() => runGreedyBatch(cards, candidates, CTX, () => 'khong-ton-tai')).toThrow(/ngoai ho boi/);
  });
});
