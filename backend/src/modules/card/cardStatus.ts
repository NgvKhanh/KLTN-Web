// Trang thai cong viec cua the + lien ket voi cot (List.status).
//
// Quy tac (xem them schema.prisma, enum CardStatus):
//  - Bat bien: status = DONE <-> isDone = true <-> completedAt != null.
//    isDone/completedAt duoc GIU LAI vi module phan cong, thong ke, loc... dang
//    dung; moi thay doi trang thai phai di qua cac ham o day de 3 cot luon khop.
//  - The di vao cot co trang thai S -> the doi sang S. Cot null = cot tu do.
//  - completedAt chi ghi khi the chuyen VAO DONE, xoa khi the roi DONE.

import { prisma } from '../../config/prisma';
import type { Prisma } from '../../generated/prisma/client';
import type { CardStatus } from '../../generated/prisma/enums';
import { logActivity } from '../activity/activity.service';
import { cardMemberIds, notify } from '../notification/notification.service';

export type { CardStatus };

export const CARD_STATUSES = [
  'TODO',
  'IN_PROGRESS',
  'IN_REVIEW',
  'DONE',
  'BLOCKED',
] as const satisfies readonly CardStatus[];

export const STATUS_LABEL: Record<CardStatus, string> = {
  TODO: 'Chưa làm',
  IN_PROGRESS: 'Đang làm',
  IN_REVIEW: 'Chờ duyệt',
  DONE: 'Hoàn thành',
  BLOCKED: 'Bị chặn',
};

// ---------- Doan trang thai tu ten cot ----------

// Bo dau tieng Viet, chu thuong, chi giu chu/so, cach nhau 1 dau cach.
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Thu tu QUAN TRONG: kiem tu tren xuong, gap cum dau tien khop thi dung.
//  - IN_REVIEW truoc BLOCKED: "Dang cho duyet" la cho duyet, khong phai bi chan.
//  - TODO truoc DONE: "Chua hoan thanh" chua "hoan thanh" nhung la chua lam.
const GUESS_RULES: ReadonlyArray<readonly [CardStatus, readonly string[]]> = [
  ['IN_REVIEW', ['cho duyet', 'review', 'kiem thu', 'kiem tra', 'testing', 'qa', 'phan hoi']],
  ['BLOCKED', ['bi chan', 'tam hoan', 'tam dung', 'dang cho', 'blocked', 'on hold']],
  ['TODO', ['chua lam', 'chua xong', 'chua hoan thanh', 'chua bat dau', 'can lam', 'to do', 'todo', 'backlog']],
  ['IN_PROGRESS', ['dang lam', 'dang thuc hien', 'dang xu ly', 'dang viet', 'dang nghien cuu', 'dang phat trien', 'in progress', 'doing']],
  ['DONE', ['hoan thanh', 'hoan tat', 'xong', 'done', 'da dang', 'completed', 'finished']],
];

/**
 * Doan trang thai cho 1 cot MOI tu ten cua no. Khong khop cum nao -> null
 * (cot tu do). Chi dung luc tao cot; doi ten cot sau do KHONG doan lai.
 */
export function guessListStatus(name: string): CardStatus | null {
  // Dem them dau cach 2 dau de so khop theo ranh gioi tu ("done" khong khop "undone")
  const padded = ` ${normalizeName(name)} `;
  for (const [status, phrases] of GUESS_RULES) {
    if (phrases.some((p) => padded.includes(` ${p} `))) return status;
  }
  return null;
}

// ---------- Ghi trang thai (giu bat bien) ----------

/**
 * Du lieu trang thai cho 1 the MOI TAO trong cot co trang thai `listStatus`.
 * Cot tu do (null) -> TODO.
 */
export function initialStatusData(listStatus: CardStatus | null | undefined) {
  const status: CardStatus = listStatus ?? 'TODO';
  return status === 'DONE'
    ? { status, isDone: true, completedAt: new Date() }
    : { status, isDone: false, completedAt: null };
}

/**
 * Trang thai khi "mo lai" 1 the da xong (bo tick hoan thanh / automation
 * SET_DONE false): theo cot neu cot co trang thai khac DONE, khong thi TODO.
 */
export function reopenStatus(listStatus: CardStatus | null | undefined): CardStatus {
  return listStatus && listStatus !== 'DONE' ? listStatus : 'TODO';
}

type CardWriter = { card: Pick<Prisma.TransactionClient['card'], 'updateMany'> };

/**
 * Chuyen cac the khop `where` sang trang thai `to`, ghi CA 3 cot cung luc
 * (status/isDone/completedAt) nen bat bien luon dung. Chi dong vao the co
 * trang thai KHAC `to`: dong nao dang bi request khac sua se duoc Postgres
 * kiem lai dieu kien sau khi request kia xong -> 2 request cung chuyen sang
 * DONE khong ghi de completedAt cua nhau. Tra ve PrismaPromise nen dung duoc
 * ca trong $transaction([...]) dang mang lan transaction dang ham.
 *
 * Luu y: dong ma luc cau lenh bat dau CHUA khop dieu kien (vd dang TODO, request
 * khac dang doi sang DONE ma chua commit) se bi bo qua -> noi nao can quyet dinh
 * theo trang thai MOI NHAT (updateCard) phai khoa dong truoc (FOR UPDATE).
 */
export function statusWrite(db: CardWriter, where: Prisma.CardWhereInput, to: CardStatus) {
  return db.card.updateMany({
    where: { AND: [where, { status: { not: to } }] },
    data:
      to === 'DONE'
        ? { status: 'DONE', isDone: true, completedAt: new Date() }
        : { status: to, isDone: false, completedAt: null },
  });
}

// ---------- Nhat ky + thong bao ----------

export interface StatusChange {
  boardId: string;
  cardId: string;
  cardTitle: string;
  userId: string; // nguoi gay ra thay doi
  from: CardStatus;
  to: CardStatus;
  // Gui thong bao "da hoan thanh" cho thanh vien the? Chi khi doi tay / tu
  // dong hoa. Keo tha da co thong bao "card.moved" -> khong gui them.
  notifyDone: boolean;
}

/**
 * Ghi DUNG 1 dong nhat ky cho 1 lan doi trang thai:
 *  - vao DONE -> 'card.done', roi DONE -> 'card.undone' (giu ten cu: module
 *    phan cong dem so lan mo lai qua 'card.undone');
 *  - con lai -> 'card.status'.
 * Moi dong deu kem data { from, to }.
 */
export async function logStatusChange(c: StatusChange): Promise<void> {
  if (c.from === c.to) return;
  const type = c.to === 'DONE' ? 'card.done' : c.from === 'DONE' ? 'card.undone' : 'card.status';
  await logActivity({
    boardId: c.boardId,
    cardId: c.cardId,
    userId: c.userId,
    type,
    data: { from: c.from, to: c.to },
  });
  if (c.notifyDone && c.to === 'DONE') {
    await notify({
      recipients: await cardMemberIds(c.cardId),
      actorId: c.userId,
      type: 'card.marked.done',
      boardId: c.boardId,
      cardId: c.cardId,
      data: { cardTitle: c.cardTitle },
    });
  }
}

/**
 * Doi trang thai HANG LOAT cac the dang hoat dong trong 1 cot (khi doi trang
 * thai cot, hoac chuyen tat ca the sang cot khac): ghi 1 lan, nhat ky tung the.
 * Khong gui thong bao (tranh gui hang chuc thong bao cho 1 thao tac).
 */
export async function logBulkStatusChange(
  boardId: string,
  userId: string,
  cards: { id: string; title: string; status: CardStatus }[],
  to: CardStatus
): Promise<void> {
  for (const card of cards) {
    await logStatusChange({
      boardId,
      cardId: card.id,
      cardTitle: card.title,
      userId,
      from: card.status,
      to,
      notifyDone: false,
    });
  }
}

// Cot dau tien (theo vi tri, tu trai sang) cua bang mang trang thai `status`.
export async function firstListWithStatus(boardId: string, status: CardStatus) {
  return prisma.list.findFirst({
    where: { boardId, status, deletedAt: null, archivedAt: null },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
}
