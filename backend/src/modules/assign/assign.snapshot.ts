// Anh chup du lieu cho bo cham cap: DONG CSDL -> { idf, mu, ung vien } (ASSIGN_MODULE.md §4, §5.9).
// HAM THUAN: khong Prisma, khong doc dong ho - "bay gio" luon la tham so. Cung hinh dang voi snapshotAsOf()
// cua bo mo phong (scripts/simReplay.ts), nen hai duong (CSDL that / bo nho) di qua CUNG mot bo cham va
// test doi chieu duoc tung diem so.
//
// Quy tac "tai thoi diem now" - mot the la lich su hay dang mo khong chi tuy `isDone` ma tuy ca `now`:
//  - kho ngu lieu IDF: moi the DA CO luc now (createdAt <= now), ke ca the da luu tru;
//  - lien ket the-nguoi (CardMember) chi tinh neu da co luc now;
//  - LICH SU nguoi: the da xong den luc now (isDone + completedAt <= now), ke ca the da luu tru
//    (bang da luu tru chinh la "du an cu" cua hoi thoai);
//  - THE DANG MO cua nguoi: chua xong, HOAC xong SAU now; the da luu tru khong con chiem tai;
//  - the dang duoc cham khong bao gio nam trong lich su hay the dang mo cua ai (khong tu chong lan minh);
//  - mot dong hong (ngay khong hop le, suc chua khong hop le) bi bo chu khong nem loi: mot the loi khong
//    duoc lam mat goi y cua ca nhom. Chi `now` khong hop le la loi lap trinh -> RangeError.

import type { DeclaredItem } from './assign.declared';
import type { HistoryCard } from './assign.profile';
import { groupOnTimeRate, type CandidateInput, type OpenCard } from './assign.score';
import { countTerms } from './assign.text';
import { buildIdf, type Idf } from './assign.tfidf';

export interface SnapshotCard {
  id: string;
  title: string;
  description: string | null;
  createdAt: Date;
  startDate: Date | null;
  dueDate: Date | null;
  isDone: boolean;
  /** Bat bien cua he thong: isDone <-> completedAt != null. Dong vi pham (isDone ma khong co completedAt) bi bo. */
  completedAt: Date | null;
  /** The / danh sach / bang chua no da luu tru: van la lich su nhung khong con chiem tai. */
  archived: boolean;
}

export interface SnapshotMembership {
  cardId: string;
  userId: string;
  /** CardMember.createdAt - luc duoc gan. */
  createdAt: Date;
}

export interface SnapshotProfile {
  maxParallelCards: number;
  pausedUntil: Date | null;
}

export interface SnapshotInput {
  /** Moi the con hoat dong (chua xoa) cua khong gian lam viec - dung lam kho ngu lieu va lay lich su. */
  cards: readonly SnapshotCard[];
  memberships: readonly SnapshotMembership[];
  /** Id cac the tung bi bo danh dau xong roi danh dau lai (Activity `card.undone`). */
  reopened: ReadonlySet<string>;
  /** Theo userId. Khong co dong = dung mac dinh cua bo cham. */
  profiles: ReadonlyMap<string, SnapshotProfile>;
  /** Thu tu nay duoc giu; userId trung bi bo. */
  candidateIds: readonly string[];
  /** The dang cham; null = chua co the (vd xep ho). */
  targetCardId: string | null;
  now: Date;
  /**
   * Buoc 16: muc ho so tu khai DA CAT SAN (declaredItems) theo userId - chi nguoi bat "dung cho goi y". Khong truyen = khong ai co ho
   * so (ung vien khong co khoa `declared`); co truyen ma thieu nguoi -> `declared: null` (NO_PROFILE).
   */
  declared?: ReadonlyMap<string, readonly DeclaredItem[]>;
}

export interface Snapshot {
  idf: Idf;
  /** `muy`: ti le dung han cua ca nhom, null neu khong the nao co han. */
  mu: number | null;
  candidates: CandidateInput[];
}

const validDate = (d: Date | null | undefined): d is Date => d instanceof Date && Number.isFinite(d.getTime());

export function buildSnapshot(input: SnapshotInput): Snapshot {
  const { now } = input;
  if (!validDate(now)) throw new RangeError('now khong hop le');
  const nowMs = now.getTime();

  const idf = buildIdf(
    input.cards.filter((c) => validDate(c.createdAt) && c.createdAt.getTime() <= nowMs).map((c) => countTerms(c))
  );

  const byId = new Map<string, SnapshotCard>();
  const outcomes: { completedAt: Date; dueDate: Date | null; reopened: boolean }[] = [];
  for (const c of input.cards) {
    byId.set(c.id, c);
    if (c.isDone && validDate(c.completedAt)) {
      outcomes.push({ completedAt: c.completedAt, dueDate: c.dueDate, reopened: input.reopened.has(c.id) });
    }
  }
  const mu = groupOnTimeRate(outcomes, now);

  const byUser = new Map<string, SnapshotMembership[]>();
  for (const m of input.memberships) {
    if (!validDate(m.createdAt) || m.createdAt.getTime() > nowMs) continue;
    const list = byUser.get(m.userId);
    if (list) list.push(m);
    else byUser.set(m.userId, [m]);
  }

  const seen = new Set<string>();
  const candidates: CandidateInput[] = [];
  for (const userId of input.candidateIds) {
    if (seen.has(userId)) continue;
    seen.add(userId);

    const history: HistoryCard[] = [];
    const openCards: OpenCard[] = [];
    for (const m of byUser.get(userId) ?? []) {
      if (m.cardId === input.targetCardId) continue;
      const c = byId.get(m.cardId);
      if (!c) continue;
      if (c.isDone) {
        if (!validDate(c.completedAt)) continue;
        if (c.completedAt.getTime() <= nowMs) {
          history.push({
            cardId: c.id,
            title: c.title,
            description: c.description,
            completedAt: c.completedAt,
            dueDate: c.dueDate,
            reopened: input.reopened.has(c.id),
          });
          continue;
        }
        // Xong SAU now: luc now no van dang mo
      }
      if (!c.archived) openCards.push({ cardId: c.id, startDate: c.startDate, dueDate: c.dueDate });
    }

    const profile = input.profiles.get(userId);
    const cap = profile?.maxParallelCards;
    candidates.push({
      userId,
      history,
      openCards,
      // Suc chua khong hop le -> de bo cham dung mac dinh (bo cham nem loi neu nhan so <= 0)
      maxParallelCards: cap !== undefined && Number.isInteger(cap) && cap >= 1 ? cap : undefined,
      pausedUntil: profile?.pausedUntil ?? null,
      ...(input.declared ? { declared: input.declared.get(userId) ?? null } : {}),
    });
  }
  return { idf, mu, candidates };
}
