// Tang doc CSDL cho module canh bao tre han (RISK_MODULE.md §8, §9). Moi phep tinh nam o ham thuan (risk.history /
// risk.features); tep nay chi doc Prisma va CHUYEN dong CSDL + nhat ky thanh RiskCardHistory (toRiskHistory - ham thuan,
// test rieng).

import { prisma } from '../../config/prisma';
import type { RiskCardHistory, RiskDueEvent, RiskStatus, RiskStatusEvent } from './risk.history';
import { DAY_MS } from './risk.history';
import type { RiskLevel } from './risk.levels';

/** Pham vi quet (§8.1): han trong (bay gio - 30 ngay, bay gio + 14 ngay]. */
export const SCAN_AHEAD_DAYS = 14;
export const SCAN_OVERDUE_DAYS = 30;

const STATUSES: ReadonlySet<string> = new Set<RiskStatus>(['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'BLOCKED']);
const STATUS_TYPES: ReadonlySet<string> = new Set(['card.status', 'card.done', 'card.undone']);
const DUE_TYPES: ReadonlySet<string> = new Set(['card.due.set', 'card.due.clear']);

export interface ActivityRow {
  type: string;
  data: unknown;
  createdAt: Date;
}

export interface CardRow {
  id: string;
  title: string;
  description: string | null;
  createdAt: Date;
  startDate: Date | null;
  dueDate: Date | null;
  status: string;
  completedAt: Date | null;
  storyPoints: number | null;
  members: { userId: string; createdAt: Date }[];
  checklists: { items: { createdAt: Date; isDone: boolean; completedAt: Date | null }[] }[];
}

function parseDate(v: unknown): Date | null | undefined {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : undefined;
}

/**
 * Dong CSDL + nhat ky cua the -> RiskCardHistory. Chiu duoc du lieu cu:
 *  - su kien trang thai chi nhan khi data co { from, to } hop le; su kien han chi nhan khi co CA HAI khoa from / to (null hop le);
 *  - dong thoi gian khong khop gia tri hien tai (su kien cuoi != trang thai / han hien tai - vd doi hang loat khong ghi nhat ky,
 *    nhat ky cu thieu truong) -> BO dong thoi gian do, chi dung gia tri hien tai (an toan hon dung lai sai).
 * Moi dong Activity cua the (moi loai) deu la mot "su kien hoat dong" (§5.3 (10)).
 */
export function toRiskHistory(card: CardRow, activities: readonly ActivityRow[]): RiskCardHistory {
  const sorted = [...activities].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const statusEvents: RiskStatusEvent[] = [];
  const dueEvents: RiskDueEvent[] = [];
  for (const a of sorted) {
    const d = (a.data ?? {}) as Record<string, unknown>;
    if (STATUS_TYPES.has(a.type) && typeof d.from === 'string' && typeof d.to === 'string' && STATUSES.has(d.from) && STATUSES.has(d.to) && d.from !== d.to) {
      statusEvents.push({ at: a.createdAt, from: d.from as RiskStatus, to: d.to as RiskStatus });
    } else if (DUE_TYPES.has(a.type) && 'from' in d && 'to' in d) {
      const from = parseDate(d.from);
      const to = parseDate(d.to);
      if (from !== undefined && to !== undefined) dueEvents.push({ at: a.createdAt, from, to });
    }
  }
  const status = STATUSES.has(card.status) ? (card.status as RiskStatus) : 'TODO';
  const statusOk = statusEvents.length === 0 || statusEvents.at(-1)!.to === status;
  const lastDue = dueEvents.at(-1)?.to ?? null;
  const dueOk = dueEvents.length === 0 || (lastDue?.getTime() ?? null) === (card.dueDate?.getTime() ?? null);
  return {
    id: card.id,
    title: card.title,
    description: card.description,
    createdAt: card.createdAt,
    startDate: card.startDate,
    dueDate: card.dueDate,
    status,
    completedAt: card.completedAt,
    storyPoints: card.storyPoints,
    members: card.members.map((m) => ({ userId: m.userId, createdAt: m.createdAt })),
    statusEvents: statusOk ? statusEvents : [],
    dueEvents: dueOk ? dueEvents : [],
    checklist: card.checklists.flatMap((c) => c.items.map((i) => ({ createdAt: i.createdAt, isDone: i.isDone, completedAt: i.completedAt }))),
    activityAt: sorted.map((a) => a.createdAt),
  };
}

export interface ScanCandidate {
  cardId: string;
  title: string;
  dueDate: Date;
  boardId: string;
  boardName: string;
  workspaceId: string;
  risk: { level: RiskLevel; notifiedLevel: RiskLevel | null; dueDateUsed: Date; computedAt: Date; notifiedAt: Date | null } | null;
}

/** The can cham luc `now`: chua xong, con hoat dong (the / cot / bang chua xoa, chua luu tru), han trong pham vi quet. */
export async function readScanCandidates(now: Date): Promise<ScanCandidate[]> {
  const rows = await prisma.card.findMany({
    where: {
      isDone: false,
      deletedAt: null,
      archivedAt: null,
      dueDate: { gt: new Date(now.getTime() - SCAN_OVERDUE_DAYS * DAY_MS), lte: new Date(now.getTime() + SCAN_AHEAD_DAYS * DAY_MS) },
      list: { deletedAt: null, archivedAt: null, board: { deletedAt: null, archivedAt: null } },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      list: { select: { boardId: true, board: { select: { name: true, workspaceId: true } } } },
      risk: { select: { level: true, notifiedLevel: true, dueDateUsed: true, computedAt: true, notifiedAt: true } },
    },
    orderBy: { id: 'asc' },
  });
  return rows.map((r) => ({
    cardId: r.id,
    title: r.title,
    dueDate: r.dueDate!,
    boardId: r.list.boardId,
    boardName: r.list.board.name,
    workspaceId: r.list.board.workspaceId,
    risk: r.risk,
  }));
}

/**
 * Lich su cua CA khong gian (giong module phan cong: chi cung khong gian - rieng tu): moi the chua xoa ke ca da luu tru
 * (bang cu da luu tru chinh la "du an cu"), kem nguoi duoc giao, checklist va nhat ky.
 */
export async function readWorkspaceHistories(workspaceId: string): Promise<RiskCardHistory[]> {
  const cards = await prisma.card.findMany({
    where: { deletedAt: null, list: { deletedAt: null, board: { workspaceId, deletedAt: null } } },
    select: {
      id: true,
      title: true,
      description: true,
      createdAt: true,
      startDate: true,
      dueDate: true,
      status: true,
      completedAt: true,
      storyPoints: true,
      members: { select: { userId: true, createdAt: true } },
      checklists: { select: { items: { select: { createdAt: true, isDone: true, completedAt: true } } } },
    },
    orderBy: { id: 'asc' },
  });
  if (cards.length === 0) return [];
  const activities = await prisma.activity.findMany({
    where: { cardId: { in: cards.map((c) => c.id) } },
    select: { cardId: true, type: true, data: true, createdAt: true },
  });
  const byCard = new Map<string, ActivityRow[]>();
  for (const a of activities) {
    if (a.cardId === null) continue;
    const list = byCard.get(a.cardId) ?? [];
    list.push(a);
    byCard.set(a.cardId, list);
  }
  return cards.map((c) => toRiskHistory(c, byCard.get(c.id) ?? []));
}
