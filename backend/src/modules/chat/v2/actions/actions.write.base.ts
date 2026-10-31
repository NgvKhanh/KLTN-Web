// NEN CUA LOP GHI (tep la, khong phu thuoc actions.write / registry thao tac): kieu dung chung, PlanAbort, quyen sua trong transaction,
// ghi Activity, tra the / cot cua thao tac. Cac nhom thao tac moi (actions/ops/*) va actions.write cung dung tep nay de khong tao vong import.

import type { Prisma } from '../../../../generated/prisma/client';
import type { CardStatus } from '../../../../generated/prisma/enums';
import type { Effects } from './actions.effects';
import type { ActionErrorCode, StoredOp } from './actions.types';

export type Tx = Prisma.TransactionClient;

/** Dung tien trinh ghi VA hoan tac toan bo transaction. `code` quyet dinh trang thai ket qua (STALE / FORBIDDEN...). */
export class PlanAbort extends Error {
  constructor(
    public readonly code: ActionErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'PlanAbort';
  }
}

export interface WriteContext {
  userId: string;
  boardId: string;
  /** Board Patch: khoa ca bang va kiem trung cot / the ngay trong transaction (nguoi khac co the vua them sau luc xem truoc). */
  patch?: boolean;
}

export interface CardState {
  id: string;
  title: string;
  dueDate: Date | null;
  status: CardStatus;
  listId: string;
  listName: string;
  /** Trang thai cua COT dang chua the (null = cot tu do). */
  listStatus: CardStatus | null;
}

export interface CreatedEntity {
  key: string;
  id: string;
  kind: 'LIST' | 'CARD';
  name: string;
}

export interface RunState {
  created: Map<string, CreatedEntity>;
  cards: Map<string, CardState>;
  /** Moc thoi gian Activity cuoi (de cac dong trong cung ke hoach co thu tu strictly tang). */
  lastActivityMs: number;
}

export const newRunState = (): RunState => ({ created: new Map(), cards: new Map(), lastActivityMs: 0 });

export interface OpOutcome {
  index: number;
  text: string;
  /** false: thao tac da dung roi (noop) hoac khong doi gi. */
  changed: boolean;
  cardId?: string;
  listId?: string;
}

export const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];
export const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * Nguoi dung co SUA duoc bang khong - doc trong CUNG transaction (dong bo voi du lieu dang ghi). Cung luat voi assertBoardAccess va
 * isBoardParticipant (hai ham do cho ket qua giong nhau): chu bang; thanh vien bang vai tro khac VIEWER; neu khong co membership thi thanh
 * vien khong gian khi bang o muc WORKSPACE. Dung cho CA nguoi ra lenh LAN nguoi duoc giao.
 */
export async function canEditInTx(tx: Tx, boardId: string, userId: string): Promise<boolean> {
  if ((await tx.user.count({ where: { id: userId, deletedAt: null } })) === 0) return false;
  const board = await tx.board.findFirst({ where: { id: boardId, deletedAt: null, archivedAt: null }, select: { ownerId: true, visibility: true, workspaceId: true } });
  if (!board) return false;
  if (board.ownerId === userId) return true;
  const membership = await tx.boardMember.findFirst({ where: { boardId, userId, deletedAt: null }, select: { role: true } });
  if (membership) return membership.role !== 'VIEWER';
  if (board.visibility !== 'WORKSPACE') return false;
  const ws = await tx.workspace.findFirst({ where: { id: board.workspaceId, deletedAt: null }, select: { ownerId: true } });
  if (!ws) return false;
  if (ws.ownerId === userId) return true;
  return (await tx.workspaceMember.count({ where: { workspaceId: board.workspaceId, userId, deletedAt: null } })) > 0;
}

/** CHU bang (giong assertBoardOwner): xoa, luu tru bang. Doc trong CUNG transaction. */
export async function isOwnerInTx(tx: Tx, boardId: string, userId: string): Promise<boolean> {
  return (await tx.board.count({ where: { id: boardId, deletedAt: null, archivedAt: null, ownerId: userId } })) > 0;
}

/**
 * Quyen QUAN LY bang (giong canManageBoard): chu bang, quan tri vien bang, chu hoac ADMIN cua khong gian chua bang. Doc trong CUNG transaction
 * de quyen vua bi thu hoi thi ke hoach hoan tac.
 */
export async function canManageInTx(tx: Tx, boardId: string, userId: string): Promise<boolean> {
  if ((await tx.user.count({ where: { id: userId, deletedAt: null } })) === 0) return false;
  const board = await tx.board.findFirst({ where: { id: boardId, deletedAt: null, archivedAt: null }, select: { ownerId: true, workspaceId: true } });
  if (!board) return false;
  if (board.ownerId === userId) return true;
  const membership = await tx.boardMember.findFirst({ where: { boardId, userId, deletedAt: null }, select: { role: true } });
  if (membership && (membership.role === 'ADMIN' || membership.role === 'OWNER')) return true;
  const ws = await tx.workspace.findFirst({ where: { id: board.workspaceId, deletedAt: null }, select: { ownerId: true } });
  if (!ws) return false;
  if (ws.ownerId === userId) return true;
  const wm = await tx.workspaceMember.findFirst({ where: { workspaceId: board.workspaceId, userId, deletedAt: null }, select: { role: true } });
  return wm?.role === 'OWNER' || wm?.role === 'ADMIN';
}

/** Ghi mot dong Activity TRONG transaction. Thoi gian tang dan nghiem ngat de lich su hien dung thu tu thao tac. */
export async function record(tx: Tx, ctx: WriteContext, state: RunState, effects: Effects, input: { cardId: string | null; type: string; data: Record<string, unknown> }): Promise<void> {
  state.lastActivityMs = Math.max(Date.now(), state.lastActivityMs + 1);
  await tx.activity.create({
    data: { boardId: ctx.boardId, cardId: input.cardId, userId: ctx.userId, type: input.type, data: input.data as object, createdAt: new Date(state.lastActivityMs) },
  });
  effects.activities.push({ type: input.type, cardId: input.cardId });
}

/** Loai Activity cho mot lan doi trang thai (giong logStatusChange): vao DONE = card.done, roi DONE = card.undone, con lai card.status. */
export const statusActivityType = (from: CardStatus, to: CardStatus): string => (to === 'DONE' ? 'card.done' : from === 'DONE' ? 'card.undone' : 'card.status');

export function cardOf(state: RunState, op: StoredOp): CardState {
  const id = op.ids.card ?? (op.local?.card !== undefined ? state.created.get(op.local.card)?.id : undefined);
  const card = id !== undefined ? state.cards.get(id) : undefined;
  if (!card) throw new PlanAbort('INVALID', 'Thao tác nhắc tới một thẻ không có trong kế hoạch.');
  return card;
}

export function listIdOf(state: RunState, op: StoredOp): string {
  const id = op.ids.list ?? (op.local?.list !== undefined ? state.created.get(op.local.list)?.id : undefined);
  if (id === undefined) throw new PlanAbort('INVALID', 'Thao tác nhắc tới một cột không có trong kế hoạch.');
  return id;
}

/** Vi tri ke tiep o cuoi cot (giong createCard / createList). */
export async function nextCardPosition(tx: Tx, listId: string): Promise<number> {
  const last = await tx.card.findFirst({ where: { listId, deletedAt: null, archivedAt: null }, orderBy: { position: 'desc' }, select: { position: true } });
  return last ? last.position + 1 : 0;
}
