import { prisma } from '../../config/prisma';
import { emitToBoard } from '../../realtime/socket';
import { AppError } from '../../utils/AppError';
import { maskEmails } from '../../utils/privacy';
import { logActivity } from '../activity/activity.service';
import { runAutomationsForCard } from '../automation/automation.service';
import {
  assertBoardAccess,
  assertBoardView,
  isBoardParticipant,
} from '../board/board.service';
import { cardMemberIds, notify } from '../notification/notification.service';
import { assertListAccess, assertListView } from '../list/list.service';
import { memberWorkspaceIds } from '../workspace/workspace.service';
import { resetCardRemindersOnDueDateChange } from './cardReminder.service';
import { maskDeletedComments, VISIBLE_COMMENT_WHERE } from './commentThread';
import { isWatchingCard } from '../watch/watch.service';
import {
  firstListWithStatus,
  initialStatusData,
  logStatusChange,
  reopenStatus,
  statusWrite,
  type CardStatus,
} from './cardStatus';
import type {
  CreateCardInput,
  MoveCardInput,
  UpdateCardInput,
} from './card.schema';

const CARD_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  avatarUrl: true,
} as const;

// Dung rieng cho searchCards(): ket qua co the tra ve the tren bang PUBLIC
// ma nguoi goi khong phai thanh vien - khong duoc lo email cho khach xem nhu vay.
const SEARCH_USER_SELECT = {
  id: true,
  name: true,
  avatarUrl: true,
} as const;

// Sao chep 1 the (kem nhan, thanh vien, checklist + muc) sang cung/khac danh sach cung bang
export async function copyCard(
  userId: string,
  cardId: string,
  input: { title?: string; listId?: string }
) {
  const src = await assertCardAccess(userId, cardId);
  const boardId = src.list.boardId;
  const targetListId = input.listId ?? src.listId;

  const tl = await prisma.list.findFirst({
    where: { id: targetListId, deletedAt: null, archivedAt: null },
  });
  if (!tl || tl.boardId !== boardId) {
    throw new AppError('Danh sach dich khong hop le', 400);
  }

  const full = await prisma.card.findUnique({
    where: { id: cardId },
    include: {
      labels: true,
      members: true,
      checklists: { include: { items: true } },
    },
  });

  const last = await prisma.card.findFirst({
    where: { listId: targetListId, deletedAt: null, archivedAt: null },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  // Muc da tick trong ban sao: moc tick = LUC SAO CHEP (moc cu nam truoc luc the moi duoc tao,
  // se lam sai "tien do tai thoi diem t" cua module canh bao tre han - RISK_MODULE.md §9)
  const copiedAt = new Date();

  const created = await prisma.card.create({
    data: {
      listId: targetListId,
      title: (input.title?.trim() || `${src.title} (bản sao)`).slice(0, 500),
      description: src.description,
      startDate: src.startDate,
      dueDate: src.dueDate,
      storyPoints: src.storyPoints,
      coverColor: src.coverColor,
      coverImageUrl: src.coverImageUrl,
      position: last ? last.position + 1 : 0,
      // Ban sao la the moi: trang thai theo cot dich (cot tu do -> TODO)
      ...initialStatusData(tl.status),
      ...(full && full.labels.length > 0
        ? { labels: { create: full.labels.map((l) => ({ labelId: l.labelId })) } }
        : {}),
      ...(full && full.members.length > 0
        ? { members: { create: full.members.map((m) => ({ userId: m.userId })) } }
        : {}),
      ...(full && full.checklists.length > 0
        ? {
            checklists: {
              create: full.checklists.map((cl) => ({
                title: cl.title,
                position: cl.position,
                items: {
                  create: cl.items.map((it) => ({
                    content: it.content,
                    isDone: it.isDone,
                    completedAt: it.isDone ? copiedAt : null,
                    position: it.position,
                    assigneeId: it.assigneeId,
                    dueDate: it.dueDate,
                  })),
                },
              })),
            },
          }
        : {}),
    },
  });

  await logActivity({
    boardId,
    cardId: created.id,
    userId,
    type: 'card.create',
    data: { listName: src.list.name },
  });

  return created;
}

// Lay 1 the con hoat dong + kiem tra quyen. Tra ve card kem boardId (de ghi log).
export async function assertCardAccess(userId: string, cardId: string) {
  const card = await prisma.card.findFirst({
    where: { id: cardId, deletedAt: null, archivedAt: null },
    include: { list: { select: { boardId: true, name: true, status: true } } },
  });
  if (!card) {
    throw new AppError('Khong tim thay the', 404);
  }
  await assertListAccess(userId, card.listId);
  return card;
}

// Nhu tren nhung chi doi hoi QUYEN XEM (VIEWER cung qua duoc) - dung cho cac
// thiet lap ca nhan khong lam thay doi noi dung the: watch, nhac han rieng.
export async function assertCardView(userId: string, cardId: string) {
  const card = await prisma.card.findFirst({
    where: { id: cardId, deletedAt: null, archivedAt: null },
    include: { list: { select: { boardId: true, name: true } } },
  });
  if (!card) {
    throw new AppError('Khong tim thay the', 404);
  }
  await assertListView(userId, card.listId);
  return card;
}

// Tat ca cac the ma nguoi dung duoc gan lam thanh vien, tren moi bang
export async function listMyCards(userId: string) {
  // Chi lay the o bang nguoi dung CON quyen truy cap: chu bang / thanh vien bang
  // con hieu luc / thanh vien khong gian (bang WORKSPACE). Nguoi da bi thu hoi
  // quyen se khong con thay the du van con ban ghi CardMember cu.
  const myWorkspaceIds = await memberWorkspaceIds(userId);
  return prisma.card.findMany({
    where: {
      deletedAt: null,
      archivedAt: null,
      members: { some: { userId } },
      list: {
        deletedAt: null,
        archivedAt: null,
        board: {
          deletedAt: null,
          archivedAt: null,
          OR: [
            { ownerId: userId },
            { members: { some: { userId, deletedAt: null } } },
            { visibility: 'WORKSPACE', workspaceId: { in: myWorkspaceIds } },
          ],
        },
      },
    },
    orderBy: [{ dueDate: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      title: true,
      isDone: true,
      // Trang thai the + cot + mau bang: trang "Cong viec cua toi" hien huy hieu trang thai khi the lech cot va cham mau bang
      status: true,
      startDate: true,
      dueDate: true,
      // Thoi diem danh dau xong: trang Tong quan dem "xong tuan nay" va ti le dung han
      completedAt: true,
      coverColor: true,
      list: {
        select: {
          id: true,
          name: true,
          status: true,
          boardId: true,
          board: { select: { id: true, name: true, color: true } },
        },
      },
      labels: { include: { label: true } },
    },
  });
}

const CALENDAR_LIST_SELECT = {
  id: true,
  name: true,
  boardId: true,
  board: { select: { id: true, name: true, color: true } },
} as const;

// Cac the co KHOANG [startDate, dueDate] (hoac chi dueDate neu khong dat
// startDate) GIAO voi khoang [from, to] dang xem - tren cac bang minh la
// thanh vien. The chi co dueDate coi nhu 1 diem (startDate = dueDate).
export async function listCalendarCards(userId: string, from: Date, to: Date) {
  return prisma.card.findMany({
    where: {
      deletedAt: null,
      archivedAt: null,
      OR: [
        { startDate: null, dueDate: { gte: from, lte: to } },
        { startDate: { lte: to }, dueDate: { gte: from } },
      ],
      list: {
        deletedAt: null,
        archivedAt: null,
        board: {
          deletedAt: null,
          members: { some: { userId, deletedAt: null } },
        },
      },
    },
    orderBy: { dueDate: 'asc' },
    select: {
      id: true,
      title: true,
      isDone: true,
      startDate: true,
      dueDate: true,
      list: { select: CALENDAR_LIST_SELECT },
    },
  });
}

// Cac muc checklist co han trong khoang [from, to], tren cac bang minh la
// thanh vien - de hien thi cung luc voi the tren lich.
export async function listCalendarChecklistItems(
  userId: string,
  from: Date,
  to: Date
) {
  return prisma.checklistItem.findMany({
    where: {
      dueDate: { gte: from, lte: to },
      checklist: {
        card: {
          deletedAt: null,
          archivedAt: null,
          list: {
            deletedAt: null,
            archivedAt: null,
            board: {
              deletedAt: null,
              members: { some: { userId, deletedAt: null } },
            },
          },
        },
      },
    },
    orderBy: { dueDate: 'asc' },
    select: {
      id: true,
      content: true,
      isDone: true,
      dueDate: true,
      checklist: {
        select: {
          card: {
            select: {
              id: true,
              title: true,
              list: { select: CALENDAR_LIST_SELECT },
            },
          },
        },
      },
    },
  });
}

// Tim the theo tu khoa (tieu de + mo ta), tren moi bang nguoi dung co quyen truy cap
export async function searchCards(userId: string, query: string) {
  const term = query.trim();
  if (!term) return [];

  const myWorkspaceIds = await memberWorkspaceIds(userId);
  return prisma.card.findMany({
    where: {
      deletedAt: null,
      archivedAt: null,
      OR: [
        { title: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } },
      ],
      list: {
        deletedAt: null,
        archivedAt: null,
        board: {
          deletedAt: null,
          archivedAt: null,
          OR: [
            { ownerId: userId },
            { members: { some: { userId, deletedAt: null } } },
            { visibility: 'WORKSPACE', workspaceId: { in: myWorkspaceIds } },
            { visibility: 'PUBLIC' },
          ],
        },
      },
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 30,
    select: {
      id: true,
      title: true,
      isDone: true,
      dueDate: true,
      coverColor: true,
      list: {
        select: {
          id: true,
          name: true,
          boardId: true,
          board: { select: { id: true, name: true, color: true } },
        },
      },
      labels: { include: { label: true } },
      members: { include: { user: { select: SEARCH_USER_SELECT } } },
    },
  });
}

export async function getCardDetail(userId: string, cardId: string) {
  // assertCardView kiem tra CA danh sach cha con hoat dong (khong bi xoa/luu tru),
  // khac voi kiem assertBoardView truc tiep o day truoc day (bo sot list da xoa).
  const viewed = await assertCardView(userId, cardId);
  // Nguoi xem chi vi bang la PUBLIC (khong phai chu / thanh vien) khong duoc thay email that
  // cua thanh vien the va nguoi binh luan - giong GET .../members.
  const { insider } = await assertBoardView(userId, viewed.list.boardId);

  const card = await prisma.card.findFirst({
    where: { id: cardId, deletedAt: null, archivedAt: null },
    include: {
      list: { select: { id: true, name: true, boardId: true, status: true } },
      members: { include: { user: { select: CARD_USER_SELECT } } },
      labels: { include: { label: true } },
      checklists: {
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        include: {
          items: {
            orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
            include: {
              assignee: { select: { id: true, name: true, avatarUrl: true } },
            },
          },
        },
      },
      comments: {
        where: VISIBLE_COMMENT_WHERE,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: CARD_USER_SELECT } },
      },
      attachments: {
        orderBy: { createdAt: 'desc' },
        include: {
          uploader: { select: { id: true, name: true, avatarUrl: true } },
        },
      },
      activities: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      },
      fieldValues: true,
    },
  });
  if (!card) throw new AppError('Khong tim thay the', 404);
  const detail = {
    ...card,
    comments: maskDeletedComments(card.comments),
    isWatching: await isWatchingCard(userId, cardId),
  };
  return insider ? detail : maskEmails(detail);
}

export async function createCard(
  userId: string,
  listId: string,
  input: CreateCardInput
) {
  const list = await assertListAccess(userId, listId);

  const last = await prisma.card.findFirst({
    where: { listId, deletedAt: null, archivedAt: null },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  const position = last ? last.position + 1 : 0;

  const card = await prisma.card.create({
    data: { listId, title: input.title, position, ...initialStatusData(list.status) },
  });

  await logActivity({
    boardId: list.boardId,
    cardId: card.id,
    userId,
    type: 'card.create',
    data: { listName: list.name },
  });

  await runAutomationsForCard('CARD_CREATED', card.id, card.title, list.boardId, listId);

  // Tu dong hoa (vd SET_DONE) co the vua doi du lieu the - doc lai truoc khi
  // tra ve, tranh response cu (con isDone/... truoc khi tu dong hoa chay).
  return (await prisma.card.findUnique({ where: { id: card.id } })) ?? card;
}

type ConflictFields = {
  title?: string;
  description?: string | null;
  startDate?: string | null;
  dueDate?: string | null;
};

const dateMs = (v: Date | string | null | undefined): number | null =>
  v ? new Date(v).getTime() : null;

/**
 * Khoa lac quan theo truong cho updateCard(). Voi MOI truong dang duoc sua ma client
 * co gui gia tri goc (`expected`): neu gia tri hien tai trong DB khac gia tri goc VA
 * khac gia tri sap ghi -> nguoi khac da sua truong do. Tra ve gia tri hien tai cua
 * cac truong xung dot, hoac null neu khong co xung dot.
 *
 * Gia tri hien tai == gia tri sap ghi la KHONG xung dot (hai nguoi cung sua ra mot
 * ket qua - ghi lai khong mat gi). Truong khong duoc sua thi khong bao gio xung dot.
 */
export function findCardConflicts(
  current: {
    title: string;
    description: string | null;
    startDate: Date | null;
    dueDate: Date | null;
  },
  input: Pick<UpdateCardInput, 'title' | 'description' | 'startDate' | 'dueDate'>,
  expected: NonNullable<UpdateCardInput['expected']>
): ConflictFields | null {
  const out: ConflictFields = {};
  if (
    expected.title !== undefined &&
    input.title !== undefined &&
    current.title !== expected.title &&
    current.title !== input.title
  ) {
    out.title = current.title;
  }
  if (
    expected.description !== undefined &&
    input.description !== undefined &&
    current.description !== expected.description &&
    current.description !== input.description
  ) {
    out.description = current.description;
  }
  for (const key of ['startDate', 'dueDate'] as const) {
    if (expected[key] === undefined || input[key] === undefined) continue;
    const cur = dateMs(current[key]);
    if (cur !== dateMs(expected[key]) && cur !== dateMs(input[key])) {
      out[key] = current[key]?.toISOString() ?? null;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

export async function updateCard(
  userId: string,
  cardId: string,
  input: UpdateCardInput
) {
  const card = await assertCardAccess(userId, cardId);
  const boardId = card.list.boardId;

  // Quy yeu cau doi trang thai (status, hoac isDone = loi tat cua DONE) ve 1 lan ghi:
  //  - status / isDone=true -> chuyen sang `to` neu the chua o `to`;
  //  - isDone=false -> "mo lai": CHI khi the dang DONE.
  const statusReq: { to: CardStatus; onlyIfDone: boolean } | null =
    input.status !== undefined
      ? { to: input.status, onlyIfDone: false }
      : input.isDone === true
        ? { to: 'DONE', onlyIfDone: false }
        : input.isDone === false
          ? { to: reopenStatus(card.list.status), onlyIfDone: true }
          : null;
  const wantsChange =
    statusReq !== null &&
    (statusReq.onlyIfDone ? card.status === 'DONE' : card.status !== statusReq.to);

  // Lien ket 2 chieu: the dang o cot CO trang thai (khac trang thai moi) va bang
  // co cot mang trang thai moi -> chuyen the sang dau cot do (qua moveCard, nen
  // cung ghi nhat ky "chuyen the" va chay tu dong hoa nhu keo tha). The o cot tu
  // do, hoac bang khong co cot phu hop -> chi doi trang thai, the dung yen.
  const moveTo =
    statusReq !== null &&
    wantsChange &&
    card.list.status !== null &&
    card.list.status !== statusReq.to
      ? await firstListWithStatus(boardId, statusReq.to)
      : null;

  const expected = input.expected;
  const hasExpected = expected !== undefined && Object.keys(expected).length > 0;

  const { row: updated, change, previous } = await prisma.$transaction(async (tx) => {
    // Read the actual previous title/due date while holding the row lock, so
    // concurrent updates do not record an outdated before-value in Activity.
    // Co `expected` -> luon khoa: so sanh gia tri goc voi gia tri hien tai phai
    // nam CUNG giao dich voi lan ghi, neu khong 2 nguoi van lot qua nhau.
    if (
      (statusReq && !moveTo) ||
      input.title !== undefined ||
      input.dueDate !== undefined ||
      hasExpected
    ) {
      await tx.$queryRaw`SELECT id FROM "Card" WHERE id = ${cardId} FOR UPDATE`;
    }
    const previous = await tx.card.findUniqueOrThrow({
      where: { id: cardId },
      select: {
        status: true,
        title: true,
        dueDate: true,
        description: true,
        startDate: true,
      },
    });
    if (hasExpected) {
      // Khoa lac quan: nguoi khac da doi dung truong nay ke tu luc nguoi dung bat
      // dau sua -> tu choi, KHONG ghi de (client hien "giu ban nao"). Nem o day de
      // giao dich rollback, chua co hieu ung phu nao (nhat ky/thong bao) da chay.
      const conflicts = findCardConflicts(previous, input, expected);
      if (conflicts) {
        throw new AppError('The vua duoc nguoi khac cap nhat', 409, {
          code: 'CARD_CONFLICT',
          data: { fields: Object.keys(conflicts), current: conflicts },
        });
      }
    }
    let change: { from: CardStatus; to: CardStatus } | null = null;
    if (statusReq && !moveTo) {
      // CODE_REVIEW.md #13: khoa dong the (SELECT ... FOR UPDATE) roi doc trang thai
      // MOI NHAT truoc khi quyet dinh - snapshot `card` o tren doc TRUOC giao dich
      // nay, 1 request khac co the vua doi trang thai xen vao giua.
      const current = previous.status;
      const to = statusReq.onlyIfDone && current !== 'DONE' ? null : statusReq.to;
      if (to && to !== current) {
        await statusWrite(tx, { id: cardId }, to);
        change = { from: current, to };
      }
    }
    const row = await tx.card.update({
      where: { id: cardId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.startDate !== undefined
          ? { startDate: input.startDate ? new Date(input.startDate) : null }
          : {}),
        ...(input.dueDate !== undefined
          ? { dueDate: input.dueDate ? new Date(input.dueDate) : null }
          : {}),
        ...(input.coverColor !== undefined
          ? { coverColor: input.coverColor }
          : {}),
        ...(input.coverImageUrl !== undefined
          ? { coverImageUrl: input.coverImageUrl || null }
          : {}),
        ...(input.storyPoints !== undefined
          ? { storyPoints: input.storyPoints }
          : {}),
      },
    });
    return { row, change, previous };
  });

  const recipients = () => cardMemberIds(cardId);

  let finalCard = updated;
  if (statusReq && moveTo) {
    // moveCard tu doi trang thai theo cot dich + ghi nhat ky; day la thao tac
    // doi tay nen gui them thong bao "da hoan thanh" nhu tick truc tiep.
    finalCard =
      (await moveCard(
        userId,
        cardId,
        { listId: moveTo.id, position: 0 },
        { notifyDone: true }
      )) ?? updated;
  } else if (change) {
    await logStatusChange({
      boardId,
      cardId,
      cardTitle: input.title ?? card.title,
      userId,
      from: change.from,
      to: change.to,
      notifyDone: true,
    });
  }

  if (input.title !== undefined && input.title !== previous.title) {
    await logActivity({
      boardId,
      cardId,
      userId,
      type: 'card.rename',
      data: { from: previous.title, to: input.title },
    });
    await notify({
      recipients: await recipients(),
      actorId: userId,
      type: 'card.renamed',
      boardId,
      cardId,
      data: { cardTitle: input.title },
    });
  }
  if (input.dueDate !== undefined) {
    await resetCardRemindersOnDueDateChange(cardId, Boolean(input.dueDate));
    const to = input.dueDate ? new Date(input.dueDate).toISOString() : null;
    const from = previous.dueDate?.toISOString() ?? null;
    if (from !== to) await logActivity({
      boardId,
      cardId,
      userId,
      type: input.dueDate ? 'card.due.set' : 'card.due.clear',
      data: {
        from,
        to,
        ...(input.dueDate ? { dueDate: input.dueDate } : {}),
      },
    });
    if (input.dueDate && from !== to) {
      await notify({
        recipients: await recipients(),
        actorId: userId,
        type: 'card.due.set',
        boardId,
        cardId,
        data: { cardTitle: card.title, dueDate: input.dueDate },
      });
    }
  }

  emitToBoard(boardId, 'board:lists-changed');
  return finalCard;
}

export async function deleteCard(userId: string, cardId: string) {
  const card = await assertCardAccess(userId, cardId);
  const recipients = await cardMemberIds(cardId);
  await prisma.card.update({
    where: { id: cardId },
    data: { deletedAt: new Date() },
  });
  await notify({
    recipients,
    actorId: userId,
    type: 'card.deleted',
    boardId: card.list.boardId,
    data: { cardTitle: card.title },
  });
}

// Lay the (bat ke da luu tru) + kiem tra quyen sua bang chua no.
async function assertArchivedCard(userId: string, cardId: string) {
  const card = await prisma.card.findFirst({
    where: { id: cardId, deletedAt: null },
    include: { list: { select: { boardId: true, status: true } } },
  });
  if (!card) throw new AppError('Khong tim thay the', 404);
  await assertBoardAccess(userId, card.list.boardId);
  return card;
}

// Luu tru the (co the khoi phuc)
export async function archiveCard(userId: string, cardId: string) {
  const card = await assertCardAccess(userId, cardId);
  await prisma.card.update({
    where: { id: cardId },
    data: { archivedAt: new Date() },
  });
  await logActivity({
    boardId: card.list.boardId,
    cardId,
    userId,
    type: 'card.archive',
  });
}

// Khoi phuc the da luu tru -> dua ve cuoi danh sach. Cot co the da doi trang
// thai trong luc the nam trong kho luu tru -> the doi theo cot khi quay lai.
export async function restoreCard(userId: string, cardId: string) {
  const card = await assertArchivedCard(userId, cardId);
  const last = await prisma.card.findFirst({
    where: { listId: card.listId, deletedAt: null, archivedAt: null },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  const listStatus = card.list.status;
  const results = await prisma.$transaction([
    prisma.card.update({
      where: { id: cardId },
      data: { archivedAt: null, position: last ? last.position + 1 : 0 },
    }),
    ...(listStatus ? [statusWrite(prisma, { id: cardId }, listStatus)] : []),
  ]);
  await logActivity({
    boardId: card.list.boardId,
    cardId,
    userId,
    type: 'card.restore',
  });
  // updateMany co dieu kien: count = 0 nghia la the von da o dung trang thai
  const statusChanged =
    listStatus !== null && (results[1] as { count: number }).count > 0;
  if (listStatus && statusChanged) {
    await logStatusChange({
      boardId: card.list.boardId,
      cardId,
      cardTitle: card.title,
      userId,
      from: card.status,
      to: listStatus,
      notifyDone: false,
    });
  }
}

// Xoa han the da luu tru
export async function purgeCard(userId: string, cardId: string) {
  const card = await assertArchivedCard(userId, cardId);
  await prisma.card.update({
    where: { id: cardId },
    data: { deletedAt: new Date() },
  });
  emitToBoard(card.list.boardId, 'board:lists-changed');
}

/**
 * Keo tha the: chuyen sang danh sach `listId`, chen vao vi tri `position`.
 */
export async function moveCard(
  userId: string,
  cardId: string,
  input: MoveCardInput,
  // notifyDone: goi tu updateCard (doi tay trang thai) -> gui "da hoan thanh"
  opts: { notifyDone?: boolean } = {}
) {
  const card = await assertCardAccess(userId, cardId);

  const targetList = await prisma.list.findFirst({
    where: { id: input.listId, deletedAt: null, archivedAt: null },
    include: { board: { select: { id: true, name: true } } },
  });
  if (!targetList) {
    throw new AppError('Danh sach dich khong ton tai', 400);
  }
  await assertBoardAccess(userId, targetList.boardId);

  const sourceListId = card.listId;
  const sourceListName = card.list.name;
  const sourceBoardId = card.list.boardId;
  const crossBoard = sourceBoardId !== targetList.boardId;

  // Chuyen sang bang khac: don du lieu khong con hop le o bang dich - nhan
  // gan tren the / gan tren muc checklist khong con la thanh vien bang dich
  // thi go ra (khong xoa the); nhan cua the thuoc bang cu cung bi go vi
  // Label la rieng theo tung bang. Gia tri truong tuy chinh cung rieng theo
  // tung bang (CustomField.boardId) nen cung phai go, khong the giu lai vi
  // bang dich khong co dinh nghia truong tuong ung.
  // Phan DOC (thanh vien nao khong con hop le) lam truoc giao dich; phan GHI nam
  // trong giao dich ben duoi.
  let staleMemberIds: string[] = [];
  let staleItemIds: string[] = [];
  if (crossBoard) {
    const [members, items] = await Promise.all([
      prisma.cardMember.findMany({ where: { cardId }, select: { userId: true } }),
      prisma.checklistItem.findMany({
        where: { checklist: { cardId }, assigneeId: { not: null } },
        select: { id: true, assigneeId: true },
      }),
    ]);
    staleMemberIds = (
      await Promise.all(
        members.map(async (m) => ({
          userId: m.userId,
          stale: !(await isBoardParticipant(targetList.boardId, m.userId)),
        }))
      )
    )
      .filter((m) => m.stale)
      .map((m) => m.userId);

    const distinctAssigneeIds = [
      ...new Set(items.map((it) => it.assigneeId as string)),
    ];
    const staleAssigneeIds = new Set(
      (
        await Promise.all(
          distinctAssigneeIds.map(async (uid) => ({
            uid,
            stale: !(await isBoardParticipant(targetList.boardId, uid)),
          }))
        )
      )
        .filter((a) => a.stale)
        .map((a) => a.uid)
    );
    staleItemIds = items
      .filter((it) => staleAssigneeIds.has(it.assigneeId as string))
      .map((it) => it.id);
  }

  // Sang cot KHAC co trang thai -> the doi theo cot. Keo doi cho trong cung
  // cot thi khong dong toi trang thai (giu trang thai da doi tay neu co).
  const targetStatus =
    sourceListId !== input.listId ? targetList.status : null;

  // Doc danh sach the + danh lai vi tri phai nam TRONG giao dich va sau khi khoa cot:
  // truoc day doc ngoai giao dich nen 2 nguoi cung keo vao 1 cot dua tren cung 1 anh
  // chup cu -> vi tri trung nhau / nguoi sau ghi de thu tu cua nguoi truoc.
  const statusChanged = await prisma.$transaction(
    async (tx) => {
      // Khoa cot dich + cot nguon theo THU TU ID co dinh: 2 lan keo dong thoi di qua
      // cung cac cot se xep hang cho nhau, khong the khoa cheo (deadlock).
      // Dung khoa tu van (advisory) theo id cot chu KHONG khoa dong cua bang List:
      // doi ten / sap xep lai cot cap nhat nhieu dong List theo thu tu vi tri, khoa
      // dong theo thu tu id o day co the khoa cheo voi no. Khoa tu van tu nha khi
      // giao dich ket thuc va chi co tac dung giua cac lan keo the voi nhau.
      for (const listId of [...new Set([input.listId, sourceListId])].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${listId}, 0))`;
      }
      // Cot hien tai cua the (co the vua bi lan keo khac dua di noi khac trong luc cho khoa)
      const current = await tx.card.findUnique({
        where: { id: cardId },
        select: { listId: true },
      });
      const fromListId = current?.listId ?? sourceListId;

      const targetCards = await tx.card.findMany({
        where: {
          listId: input.listId,
          deletedAt: null,
          archivedAt: null,
          id: { not: cardId },
        },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, position: true },
      });
      const index = Math.min(Math.max(input.position, 0), targetCards.length);
      const ordered = [
        ...targetCards.slice(0, index),
        { id: cardId, position: -1 },
        ...targetCards.slice(index),
      ];
      // Chi ghi nhung the thuc su doi vi tri (do do khong lam nhay updatedAt cua
      // ca cot moi lan keo)
      for (let i = 0; i < ordered.length; i += 1) {
        const c = ordered[i];
        if (c.id === cardId) {
          await tx.card.update({
            where: { id: cardId },
            data: { position: i, listId: input.listId },
          });
        } else if (c.position !== i) {
          await tx.card.update({ where: { id: c.id }, data: { position: i } });
        }
      }

      // updateMany co dieu kien: count = 0 nghia la the von da o dung trang thai
      let changed = false;
      if (targetStatus) {
        const r = await statusWrite(tx, { id: cardId }, targetStatus);
        changed = r.count > 0;
      }

      if (fromListId !== input.listId) {
        const remaining = await tx.card.findMany({
          where: {
            listId: fromListId,
            deletedAt: null,
            archivedAt: null,
            id: { not: cardId },
          },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, position: true },
        });
        for (let i = 0; i < remaining.length; i += 1) {
          if (remaining[i].position !== i) {
            await tx.card.update({
              where: { id: remaining[i].id },
              data: { position: i },
            });
          }
        }
      }

      if (crossBoard) {
        await tx.cardLabel.deleteMany({
          where: { cardId, label: { boardId: { not: targetList.boardId } } },
        });
        await tx.cardFieldValue.deleteMany({
          where: { cardId, field: { boardId: { not: targetList.boardId } } },
        });
        if (staleMemberIds.length > 0) {
          await tx.cardMember.deleteMany({
            where: { cardId, userId: { in: staleMemberIds } },
          });
        }
        if (staleItemIds.length > 0) {
          await tx.checklistItem.updateMany({
            where: { id: { in: staleItemIds } },
            data: { assigneeId: null },
          });
        }
      }
      return changed;
    },
    // Moi lan ghi la 1 lenh rieng (chi nhung the doi vi tri) -> cot rat dai van can
    // nhieu thoi gian hon 5s mac dinh cua giao dich tuong tac.
    { timeout: 15_000 }
  );

  if (sourceListId !== input.listId) {
    await logActivity({
      boardId: targetList.boardId,
      cardId,
      userId,
      type: 'card.move',
      data: crossBoard
        ? {
            fromList: sourceListName,
            toList: targetList.name,
            toBoard: targetList.board.name,
          }
        : { fromList: sourceListName, toList: targetList.name },
    });
    if (statusChanged && targetStatus) {
      await logStatusChange({
        boardId: targetList.boardId,
        cardId,
        cardTitle: card.title,
        userId,
        from: card.status,
        to: targetStatus,
        // Keo tha: da co thong bao "card.moved" ben duoi, khong gui them
        notifyDone: opts.notifyDone ?? false,
      });
    }
    await notify({
      recipients: await cardMemberIds(cardId),
      actorId: userId,
      type: 'card.moved',
      boardId: targetList.boardId,
      cardId,
      data: {
        cardTitle: card.title,
        toList: crossBoard
          ? `${targetList.board.name} / ${targetList.name}`
          : targetList.name,
      },
    });
    await runAutomationsForCard(
      'CARD_MOVED_TO_LIST',
      cardId,
      card.title,
      targetList.boardId,
      input.listId
    );
  }

  // Ke ca keo trong cung danh sach (khong ghi log) van bao realtime.
  // Chuyen xuyen bang: bao ca 2 phia, phia nguon can biet the vua "bien mat".
  emitToBoard(targetList.boardId, 'board:lists-changed');
  if (crossBoard) {
    emitToBoard(sourceBoardId, 'board:lists-changed');
  }
  return prisma.card.findFirst({ where: { id: cardId } });
}
