// Ho so lam viec cua mot nguoi dung tu cac the HO DA HOAN THANH (ASSIGN_MODULE.md §5.3-5.4).
// HAM THUAN: "hom nay" luon la tham so, khong doc dong ho, khong Prisma.
//
// Ho so KHONG gop lich su thanh MOT vec-to (§5.4: cach do pha loang - nguoi lam 50 the du loai
// trong giong moi thu mot cach nhat nhoa). Ho so giu tung the cu kem vec-to rieng va trong so thoi
// gian; buoc 4 lay k lang gieng gan nhat tren do. Ham topTerms() chi de HIEN THI/GO LOI ("nguoi nay
// hay lam nhung gi"), khong dung de cham diem.

import { countTerms, type CardText } from './assign.text';
import { type Idf, type SparseVector, vectorize } from './assign.tfidf';

/** Nua doi: mot the xong cach day chung nay ngay co trong so 0,5 (§5.3). */
export const HALF_LIFE_DAYS = 90;
const DAY_MS = 86_400_000;

export interface HistoryCard extends CardText {
  cardId: string;
  /** Thoi diem danh dau xong (Card.completedAt). */
  completedAt: Date;
  /** Han chot cua the (Card.dueDate). Khong co / null = the khong dat han (khong tinh vao do tin cay). */
  dueDate?: Date | null;
  /** The tung bi bo danh dau xong roi danh dau lai (Activity kieu card.undone): dau hieu lam chua dat. */
  reopened?: boolean;
}

export interface ProfileEntry {
  cardId: string;
  /** Tieu de the cu - de hien thi bang chung ("dua tren nhung the nay"). */
  title: string;
  vec: SparseVector;
  completedAt: Date;
  dueDate: Date | null;
  reopened: boolean;
  /** So ngay tu luc xong den `now`, >= 0 (moc o tuong lai bi kep ve 0: lech dong ho khong duoc thanh trong so > 1). */
  ageDays: number;
  /** decay(ageDays), trong (0,1]. */
  weight: number;
}

export interface PersonProfile {
  userId: string;
  /** Moi phan tu la mot the da xong. Xep theo moi nhat truoc, cung luc thi theo cardId: tat dinh. */
  entries: ProfileEntry[];
}

/** decay(d) = 0,5^(d/H). Tuoi am (moc o tuong lai) coi nhu 0. */
export function decay(ageDays: number, halfLifeDays: number = HALF_LIFE_DAYS): number {
  if (!Number.isFinite(halfLifeDays) || halfLifeDays <= 0) {
    throw new RangeError('halfLifeDays phai la so huu han > 0');
  }
  if (!Number.isFinite(ageDays)) throw new RangeError('ageDays phai la so huu han');
  return Math.pow(0.5, Math.max(0, ageDays) / halfLifeDays);
}

function validDate(d: Date): boolean {
  return d instanceof Date && Number.isFinite(d.getTime());
}

/**
 * Dung ho so tu lich su. The co `completedAt` khong hop le bi BO (khong nem loi: mot dong hong
 * khong duoc lam mat goi y cua ca nhom). `now` khong hop le la loi lap trinh -> nem RangeError.
 */
export function buildProfile(
  userId: string,
  history: readonly HistoryCard[],
  idf: Idf,
  now: Date,
  halfLifeDays: number = HALF_LIFE_DAYS
): PersonProfile {
  if (!validDate(now)) throw new RangeError('now khong hop le');
  // Kiem tra tham so mot lan o day thay vi de decay() nem giua chung (khi lich su rong se khong bao gio bi kiem)
  decay(0, halfLifeDays);

  const entries: ProfileEntry[] = [];
  for (const card of history) {
    if (!validDate(card.completedAt)) continue;
    const ageDays = Math.max(0, (now.getTime() - card.completedAt.getTime()) / DAY_MS);
    entries.push({
      cardId: card.cardId,
      title: card.title,
      vec: vectorize(countTerms(card), idf),
      completedAt: card.completedAt,
      dueDate: card.dueDate ?? null,
      reopened: card.reopened ?? false,
      ageDays,
      weight: decay(ageDays, halfLifeDays),
    });
  }
  entries.sort((a, b) => {
    const dt = b.completedAt.getTime() - a.completedAt.getTime();
    return dt !== 0 ? dt : a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0;
  });
  return { userId, entries };
}

/**
 * `n` thuat ngu noi bat nhat trong ho so: tong tren cac the cu cua (trong so thoi gian x trong so
 * thuat ngu trong vec-to). Hoa diem thi xep theo thuat ngu de ket qua tat dinh.
 */
export function topTerms(profile: PersonProfile, n: number): { term: string; weight: number }[] {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('n phai la so nguyen >= 0');
  const total = new Map<string, number>();
  for (const e of profile.entries) {
    for (const [term, w] of e.vec) total.set(term, (total.get(term) ?? 0) + e.weight * w);
  }
  return [...total.entries()]
    .map(([term, weight]) => ({ term, weight }))
    .sort((a, b) => b.weight - a.weight || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
    .slice(0, n);
}
