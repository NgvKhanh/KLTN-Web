// Anh chup qua khu + nhan cho viec hoc / danh gia mo hinh canh bao tre han (RISK_MODULE.md §7.1). HAM THUAN.
//
// Voi moi the co han va moi moc h trong {7, 3, 1} ngay: tim cac thoi diem t ma han CO HIEU LUC luc t (D_t) cach t dung h ngay
// (han co the doi nhieu lan -> do tren tung khoang ma mot gia tri han con hieu luc), giu t neu luc do the dang mo.
// Nhan y = 1 neu the xong SAU D_t (lan vao DONE dau tien sau t), hoac toi cuoi du lieu van chua xong ma D_t da qua; y = 0 neu
// xong truoc / dung D_t. Chua xong ma D_t con o sau cuoi du lieu -> chua biet ket qua -> bo.
// Dac trung tinh bang DUNG extractFeatures cua module (mode replay) - khong co duong tinh rieng cho viec hoc.

import { createHash } from 'node:crypto';
import { DAY_MS, dueAt, isOpenAt, type RiskCardHistory } from '../modules/risk/risk.history';
import { buildRiskContext, extractFeatures, estimatePoints, type ExtractedFeatures, type RiskPriors } from '../modules/risk/risk.features';

export const HORIZONS = [7, 3, 1] as const;

export interface SnapshotRow {
  seed: number;
  cardId: string;
  horizon: number;
  t: Date;
  y: 0 | 1;
  features: ExtractedFeatures;
}

/** Lan vao DONE dau tien SAU t (khong co nhat ky trang thai: completedAt neu > t). */
export function completionAfter(card: RiskCardHistory, t: Date): Date | null {
  for (const e of card.statusEvents) if (e.at.getTime() > t.getTime() && e.to === 'DONE') return e.at;
  if (card.statusEvents.length === 0 && card.completedAt !== null && card.completedAt.getTime() > t.getTime()) return card.completedAt;
  return null;
}

/** Nhan cua anh chup luc t; null = chua biet (§7.1). */
export function labelAt(card: RiskCardHistory, t: Date, end: Date): 0 | 1 | null {
  const due = dueAt(card, t);
  if (due === null) return null;
  const done = completionAfter(card, t);
  if (done !== null && done.getTime() <= end.getTime()) return done.getTime() > due.getTime() ? 1 : 0;
  return due.getTime() < end.getTime() ? 1 : null;
}

/** Cac thoi diem t (<= end, the dang mo) sao cho D_t - t = h ngay, tren tung khoang hieu luc cua moi gia tri han. */
export function snapshotTimes(card: RiskCardHistory, horizonDays: number, end: Date): Date[] {
  const versions: { from: number; due: Date | null }[] = [{ from: card.createdAt.getTime(), due: dueAt(card, card.createdAt) }];
  for (const e of card.dueEvents) {
    if (e.at.getTime() < card.createdAt.getTime()) continue;
    versions.push({ from: e.at.getTime(), due: e.to });
  }
  const out: Date[] = [];
  versions.forEach((v, i) => {
    if (v.due === null) return;
    const until = i + 1 < versions.length ? versions[i + 1]!.from : Number.POSITIVE_INFINITY;
    const t = v.due.getTime() - horizonDays * DAY_MS;
    if (t < v.from || t >= until || t > end.getTime()) return;
    const at = new Date(t);
    if (isOpenAt(card, at)) out.push(at);
  });
  return out;
}

export function snapshotsOfWorld(
  seed: number,
  cards: readonly RiskCardHistory[],
  end: Date,
  priors: RiskPriors,
  horizons: readonly number[] = HORIZONS
): SnapshotRow[] {
  const rows: SnapshotRow[] = [];
  const ordered = [...cards].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const card of ordered) {
    for (const h of horizons) {
      for (const t of snapshotTimes(card, h, end)) {
        const y = labelAt(card, t, end);
        if (y === null) continue;
        const features = extractFeatures(card, buildRiskContext(cards, t, priors, 'replay'));
        if (features === null) continue;
        rows.push({ seed, cardId: card.id, horizon: h, t, y, features });
      }
    }
  }
  return rows;
}

/**
 * Gia tri du phong luu trong tep mo hinh (§5.3 (7)(8)): ti le tre va so ngay / diem GOP tren cac the da xong co han cua tap hoc
 * (khong suy giam). Chi tinh tu TAP HOC.
 */
export function computePriors(worlds: readonly { cards: readonly RiskCardHistory[] }[]): RiskPriors {
  let late = 0;
  let n = 0;
  let dpp = 0;
  let m = 0;
  for (const w of worlds) {
    for (const c of w.cards) {
      if (c.completedAt === null || c.dueDate === null) continue;
      n += 1;
      if (c.completedAt.getTime() > c.dueDate.getTime()) late += 1;
      const start = c.startDate ?? c.members.reduce<Date | null>((a, x) => (a === null || x.createdAt < a ? x.createdAt : a), null) ?? c.createdAt;
      const days = Math.max(0.25, (c.completedAt.getTime() - start.getTime()) / DAY_MS);
      dpp += days / (c.storyPoints ?? estimatePoints(c.checklist.length));
      m += 1;
    }
  }
  if (n === 0 || m === 0) throw new RangeError('tap hoc khong co the nao da xong co han');
  return { lateRate: late / n, daysPerPoint: dpp / m };
}

/** Ma bam cua tap anh chup (dong bang + ghi vao tep mo hinh). */
export function hashRows(rows: readonly SnapshotRow[]): string {
  const h = createHash('sha256');
  for (const r of rows) h.update(`${r.seed}|${r.cardId}|${r.horizon}|${r.t.toISOString()}|${r.y}|${r.features.vector.join(',')}\n`);
  return h.digest('hex');
}
