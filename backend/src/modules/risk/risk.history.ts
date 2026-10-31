// Dung lai "the trong nhu the nao luc t" tu lich su (RISK_MODULE.md §5.1). HAM THUAN: khong Prisma, khong doc dong ho -
// "bay gio" luon la tham so `t`. Cung mot bo ham cho ca CSDL that (risk.repo.ts) lan bo mo phong (scripts/riskSim.ts), nen
// dac trung luc hoc va luc chay that di qua DUNG mot duong (nguyen tac 1, §3).
//
// Quy tac chung: chi doc su kien co moc <= t. Su kien SAU t chi duoc dung de suy NGUOC gia tri truoc no (vd han luc t = `from`
// cua lan doi han dau tien sau t) - khong bao gio de lay gia tri xay ra sau t.

export type RiskStatus = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | 'BLOCKED';

export const DAY_MS = 86_400_000;

/** Mot lan doi trang thai (Activity card.status / card.done / card.undone, data { from, to }). */
export interface RiskStatusEvent {
  at: Date;
  from: RiskStatus;
  to: RiskStatus;
}

/** Mot lan dat / doi / bo han (Activity card.due.set / card.due.clear, data { from, to }). */
export interface RiskDueEvent {
  at: Date;
  from: Date | null;
  to: Date | null;
}

export interface RiskChecklistItem {
  createdAt: Date;
  isDone: boolean;
  /** null ma isDone = true: muc tick truoc khi co cot nay ("khong ro luc nao", §5.1). */
  completedAt: Date | null;
}

export interface RiskMembership {
  userId: string;
  /** CardMember.createdAt - luc duoc giao. */
  createdAt: Date;
}

/** Toan bo nhung gi module can biet ve MOT the (gia tri hien tai + dong thoi gian). */
export interface RiskCardHistory {
  id: string;
  title: string;
  description: string | null;
  createdAt: Date;
  startDate: Date | null;
  /** Han HIEN TAI (sau moi lan doi). */
  dueDate: Date | null;
  /** Trang thai HIEN TAI. */
  status: RiskStatus;
  /** Lan xong GAN NHAT (bat bien he thong: status = DONE <-> completedAt != null). */
  completedAt: Date | null;
  storyPoints: number | null;
  members: readonly RiskMembership[];
  /** Sap theo `at` tang dan (ham ben duoi KHONG tu sap - repo / bo mo phong chiu trach nhiem). */
  statusEvents: readonly RiskStatusEvent[];
  dueEvents: readonly RiskDueEvent[];
  checklist: readonly RiskChecklistItem[];
  /** Moc cua moi dong Activity gan voi the (cua bat ky ai) - dung cho tan suat hoat dong. Sap tang dan. */
  activityAt: readonly Date[];
}

/** live = cham luc chay that (t = bay gio): doc thang isDone. replay = anh chup qua khu: chi tin moc tick. */
export type RiskMode = 'live' | 'replay';

const ms = (d: Date) => d.getTime();

/** Han co hieu luc luc t (§5.1). null = luc do the khong co han. */
export function dueAt(card: RiskCardHistory, t: Date): Date | null {
  let last: RiskDueEvent | null = null;
  let firstAfter: RiskDueEvent | null = null;
  for (const e of card.dueEvents) {
    if (ms(e.at) <= ms(t)) last = e;
    else if (firstAfter === null) firstAfter = e;
  }
  if (last) return last.to;
  if (firstAfter) return firstAfter.from;
  return card.dueDate;
}

/**
 * The da xong (o trang thai DONE) luc t chua. Dua vao dong thoi gian trang thai neu co; khong co thi dua vao completedAt.
 * Mot the xong roi mo lai: completedAt la lan xong CUOI, nen khoang "xong lan dau -> mo lai" chi thay duoc qua su kien.
 */
export function isDoneAt(card: RiskCardHistory, t: Date): boolean {
  let last: RiskStatusEvent | null = null;
  for (const e of card.statusEvents) if (ms(e.at) <= ms(t)) last = e;
  if (last) return last.to === 'DONE';
  return card.completedAt !== null && ms(card.completedAt) <= ms(t);
}

/** The ton tai va chua xong luc t. */
export function isOpenAt(card: RiskCardHistory, t: Date): boolean {
  return ms(card.createdAt) <= ms(t) && !isDoneAt(card, t);
}

/**
 * Trang thai luc t. Khong co su kien nao <= t: lay `from` cua su kien dau tien sau t, hoac trang thai hien tai neu chua tung doi.
 * Du lieu thieu nhat ky trang thai (vd the tao thang o cot "Xong") co the cho ra DONE trong khi the con mo luc t -> coi la
 * IN_PROGRESS (dang lam truoc khi xong) - quy uoc ghi o RISK_MODULE.md §5.1.
 */
export function statusAt(card: RiskCardHistory, t: Date): RiskStatus {
  let last: RiskStatusEvent | null = null;
  let firstAfter: RiskStatusEvent | null = null;
  for (const e of card.statusEvents) {
    if (ms(e.at) <= ms(t)) last = e;
    else if (firstAfter === null) firstAfter = e;
  }
  const s = last ? last.to : firstAfter ? firstAfter.from : card.status;
  if (s === 'DONE' && isOpenAt(card, t)) return 'IN_PROGRESS';
  return s;
}

/**
 * Trang thai ngay truoc lan bi chan gan nhat <= t (dung de tinh tien do khi dang bi chan). Khong ro -> TODO.
 * Khong co su kien BLOCKED -> BLOCKED: logStatusChange bo qua from === to.
 */
export function statusBeforeBlockAt(card: RiskCardHistory, t: Date): RiskStatus {
  let before: RiskStatus = 'TODO';
  for (const e of card.statusEvents) {
    if (ms(e.at) > ms(t)) break;
    if (e.to === 'BLOCKED') before = e.from;
  }
  return before === 'DONE' ? 'IN_PROGRESS' : before;
}

/** Nhung nguoi da duoc giao luc t (nguoi bi go khoi the khong dung lai duoc - gioi han da ghi). */
export function membersAt(card: RiskCardHistory, t: Date): RiskMembership[] {
  return card.members.filter((m) => ms(m.createdAt) <= ms(t));
}

/** Moc bat dau S (§5.1): startDate neu co; khong thi luc giao nguoi dau tien (<= t); khong nua thi luc tao the. */
export function startAt(card: RiskCardHistory, t: Date): Date {
  if (card.startDate) return card.startDate;
  let first: Date | null = null;
  for (const m of card.members) {
    if (ms(m.createdAt) <= ms(t) && (first === null || ms(m.createdAt) < ms(first))) first = m.createdAt;
  }
  return first ?? card.createdAt;
}

/**
 * Checklist luc t. live: doc thang isDone cua moi muc da tao. replay: muc "da tick ma khong ro luc nao" (du lieu cu) bi BO HAN khoi
 * ca tu lan mau - chi giu phan biet chac; muc tick sau t tinh la chua xong.
 */
export function checklistAt(card: RiskCardHistory, t: Date, mode: RiskMode): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const it of card.checklist) {
    if (ms(it.createdAt) > ms(t)) continue;
    if (mode === 'live') {
      total += 1;
      if (it.isDone) done += 1;
      continue;
    }
    if (it.isDone && it.completedAt === null) continue;
    total += 1;
    if (it.completedAt !== null && ms(it.completedAt) <= ms(t)) done += 1;
  }
  return { done, total };
}

/** Tong so ngay o trang thai Bi chan trong [from, t], ke ca khoang dang bi chan do dang. */
export function blockedDaysBetween(card: RiskCardHistory, from: Date, t: Date): number {
  if (ms(t) <= ms(from)) return 0;
  let total = 0;
  let current: RiskStatus = statusAt(card, from);
  let since = ms(from);
  for (const e of card.statusEvents) {
    if (ms(e.at) <= ms(from)) continue;
    if (ms(e.at) > ms(t)) break;
    if (current === 'BLOCKED') total += ms(e.at) - since;
    current = e.to;
    since = ms(e.at);
  }
  if (current === 'BLOCKED') total += ms(t) - since;
  return total / DAY_MS;
}

/** Moc cac "su kien hoat dong" <= t: moi dong Activity + moi lan tick muc checklist biet moc (§5.3 (10)). */
export function activityTimesUntil(card: RiskCardHistory, t: Date): number[] {
  const out: number[] = [];
  for (const a of card.activityAt) if (ms(a) <= ms(t)) out.push(ms(a));
  for (const it of card.checklist) if (it.completedAt !== null && ms(it.completedAt) <= ms(t)) out.push(ms(it.completedAt));
  return out;
}

/**
 * Ket qua cua 1 the luc t, dung cho lich su nguoi va the tuong tu (§5.3 (7)(9)):
 *  - da xong <= t va luc xong co han: tre = xong sau han co hieu luc LUC XONG;
 *  - con mo luc t ma han co hieu luc da qua: tinh la TRE (khong thi nguoi dang om viec qua han lai trong nhu dung han);
 *  - con lai: chua co ket qua (null).
 * `at` = moc ket qua (luc xong, hoac han da qua) - dung cho suy giam theo thoi gian.
 */
export function outcomeAt(card: RiskCardHistory, t: Date): { late: boolean; at: Date } | null {
  if (ms(card.createdAt) > ms(t)) return null;
  if (isDoneAt(card, t)) {
    const doneAt = lastDoneAt(card, t);
    if (doneAt === null) return null;
    const due = dueAt(card, doneAt);
    if (due === null) return null;
    return { late: ms(doneAt) > ms(due), at: doneAt };
  }
  const due = dueAt(card, t);
  if (due !== null && ms(due) < ms(t)) return { late: true, at: due };
  return null;
}

/** Lan vao DONE gan nhat <= t. Khong co su kien: dung completedAt neu <= t. */
export function lastDoneAt(card: RiskCardHistory, t: Date): Date | null {
  let at: Date | null = null;
  for (const e of card.statusEvents) {
    if (ms(e.at) > ms(t)) break;
    if (e.to === 'DONE') at = e.at;
  }
  if (at) return at;
  return card.completedAt !== null && ms(card.completedAt) <= ms(t) ? card.completedAt : null;
}
