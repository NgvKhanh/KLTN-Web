// Cat mot "DOT CHIA VIEC" (batch) ra khoi bo mo phong cho bo danh gia lop 2 (buoc 9, ASSIGN_MODULE.md §10.10/§11).
//
// Mo phong KHONG co khai niem "danh sach" rieng trong mot bang nhu san pham that: o day mot dot duoc xap xi bang mot
// LAT CAT K the ke tiep theo thoi gian (giao tu ngay `day` tro di) - vi ban than planAssignments cung khong dung
// thong tin bang/danh sach de cham diem, day la cach xap xi hop ly cho cau hoi "cong cu can tai mot dot K the tot den
// dau", nhung KHONG tai hien viec admin thuong mo tinh nang nay cho danh sach nho cua MOT bang cu the (gioi han da
// ghi trong bao cao, xem ASSIGN_MODULE.md nhat ky buoc 9).
//
// The gioi con lai (`rest`) BO CAC THE TRONG DOT truoc khi chup anh - neu khong, lich su/ket qua that cua CHINH cac
// the do (do bo sinh giao lich su) se ro vao "tai/lich su truoc dot", lam sai lech phep so sanh (dang le la the
// CHUA CO NGUOI NHAN). Rut ra tu logic da co san o test/assign.plan.test.ts (danh gia gioi han uu troi nguoi manh);
// tep nay la NGUON DUY NHAT, test kia se goi lai thay vi chep tay.
//
// DOC ky nang an (topic, skillAt) - CHI nam trong scripts/, module assign/ khong bao gio import tep nay.

import type { DeclaredItem } from '../modules/assign/assign.declared';
import type { PlanCard } from '../modules/assign/assign.plan';
import { LEGACY_WEIGHTS_V1, type CandidateInput, type ScoreContext, type Weights } from '../modules/assign/assign.score';
import { blankCard } from './evalAssignRun';
import { assignablePool, skillAt, type SimCard, type SimDataset, type SimPerson } from './simGenerator';
import { simDate, snapshotAsOf } from './simReplay';

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Cac diem do mac dinh cua bo danh gia lop 2 (buoc 9): ba "ngay quyet dinh" trai deu tren 300 ngay lich su, cỡ dot
 * 12 the - ke thua tu do tham do bo dieu tra o buoc 8 (§10.10) de so sanh duoc voi so cu. NGUON DUY NHAT: moi noi
 * dung dot chia (test, CLI) import hang so nay thay vi go lai. */
export const PLAN_BATCH_DAYS: readonly number[] = [90, 150, 210];
export const PLAN_BATCH_K = 12;

export interface PlanBatch {
  seed: number;
  /** Ngay quyet dinh (so ngay cua bo mo phong) - "hom nay" cua dot nay. */
  day: number;
  cards: readonly PlanCard[];
  /** Ung vien + tai/lich su TRUOC dot (rut tu the gioi da bo cac the trong dot). */
  candidates: readonly CandidateInput[];
  ctx: ScoreContext;
  /** Khoa cua moi nguoi trong ho boi, da sap (tien ich cho gini/maxShare). */
  poolKeys: readonly string[];
  /** Ky nang AN cua `userId` o chu de cua the `cardId`, tai ngay quyet dinh. Nem loi neu cardId khong thuoc dot. */
  skillOf(userId: string, cardId: string): number;
  /** Ky nang AN cao nhat trong ho boi cho the `cardId` (dap an "tot nhat"). */
  bestSkill(cardId: string): number;
}

/** Buoc 19: tuy chon cua mot dot. Khong truyen gi = dung nhu buoc 9 (so lieu da cong bo tai hien tung chu so). */
export interface BatchOptions {
  /** Muc ho so tu khai da cat san theo khoa nguoi (simDeclared.ts) - dua vao anh chup (ung vien co khoa `declared`). */
  declared?: ReadonlyMap<string, readonly DeclaredItem[]>;
  /** Bo trong so cua bo cham; mac dinh LEGACY_WEIGHTS_V1 (bo cua buoc 9). */
  weights?: Weights;
  /** The gioi W2 "nhom moi": xoa trang moi the giao TRUOC ngay quyet dinh -> khong ai co lich su hay tai luc bat dau dot. */
  coldStart?: boolean;
}

/**
 * Cat mot dot K the: lay K the co `assignedDay >= day` SOM NHAT (theo ngay giao, roi khoa - tat dinh), giu nguyen do
 * dai ke hoach cua tung the (han - ngay giao goc). Tra `null` neu khong du K the (het lich su) hoac ho boi < 3 nguoi.
 */
export function cutBatch(data: SimDataset, day: number, k: number, opts: BatchOptions = {}): PlanBatch | null {
  if (!Number.isInteger(day) || day < 0) throw new RangeError('cutBatch: day phai la so nguyen >= 0');
  if (!Number.isInteger(k) || k < 1) throw new RangeError('cutBatch: k phai la so nguyen >= 1');

  const picked = data.cards
    .filter((c) => c.assignedDay >= day)
    .sort((a, b) => a.assignedDay - b.assignedDay || cmpStr(a.key, b.key))
    .slice(0, k);
  if (picked.length < k) return null;

  const days = data.config.days;
  const at = (d: number, h = 0, m = 0) => simDate(days, d, h, m);
  const dueOf = (c: SimCard) => day + Math.max(1, c.dueDay - c.assignedDay);
  const cards: PlanCard[] = picked.map((c, i) => ({
    id: c.key,
    title: c.title,
    description: c.description,
    startDate: at(day),
    dueDate: at(dueOf(c), 23, 59),
    position: i,
  }));

  const maxDue = Math.max(...picked.map(dueOf));
  const pool = assignablePool(data.people, day, maxDue);
  if (pool.length < 3) return null;

  const batchKeys = new Set(picked.map((c) => c.key));
  const restCards = data.cards.filter((c) => !batchKeys.has(c.key));
  const rest: SimDataset = { ...data, cards: opts.coldStart ? restCards.map((c) => (c.assignedDay < day ? blankCard(c) : c)) : restCards };
  const snap = snapshotAsOf(rest, day, 10, pool.map((p) => ({ key: p.key, capacity: p.capacity })), null, opts.declared);

  const simCardById = new Map(picked.map((c) => [c.key, c]));
  const peopleByKey = new Map<string, SimPerson>(pool.map((p) => [p.key, p]));
  const skillOf = (userId: string, cardId: string): number => {
    const person = peopleByKey.get(userId);
    const card = simCardById.get(cardId);
    if (!person) throw new RangeError(`cutBatch.skillOf: nguoi ngoai ho boi: ${userId}`);
    if (!card) throw new RangeError(`cutBatch.skillOf: the ngoai dot: ${cardId}`);
    return skillAt(person, card.topic, day);
  };
  const bestSkill = (cardId: string): number => Math.max(...pool.map((p) => skillOf(p.key, cardId)));

  return {
    seed: data.config.seed,
    day,
    cards,
    candidates: snap.candidates,
    // Ghim bo trong so cua buoc 9 (§17.6): so lieu da cong bo tai hien dung khi mac dinh cua san pham doi
    ctx: { idf: snap.idf, now: snap.now, groupOnTimeRate: snap.mu, weights: opts.weights ?? LEGACY_WEIGHTS_V1 },
    poolKeys: pool.map((p) => p.key).sort(cmpStr),
    skillOf,
    bestSkill,
  };
}

/** Cat nhieu dot (moi `day` mot dot cung cỡ `k`), bo qua nhung ngay khong du du lieu. */
export function cutBatches(data: SimDataset, batchDays: readonly number[], k: number, opts: BatchOptions = {}): PlanBatch[] {
  const out: PlanBatch[] = [];
  for (const day of batchDays) {
    const b = cutBatch(data, day, k, opts);
    if (b) out.push(b);
  }
  return out;
}
