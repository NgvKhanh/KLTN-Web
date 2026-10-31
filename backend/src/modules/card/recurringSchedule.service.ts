import { prisma } from '../../config/prisma';
import type { Prisma } from '../../generated/prisma/client';
import { AppError } from '../../utils/AppError';
import { logActivity } from '../activity/activity.service';
import { runAutomationsForCard } from '../automation/automation.service';
import { assertListAccess, assertListView } from '../list/list.service';
import { initialStatusData } from './cardStatus';
import {
  nextOccurrenceAfter,
  nextOccurrenceOnOrAfter,
  type RecurrenceRule,
} from './recurringSchedule.dates';
import type {
  CreateRecurringScheduleInput,
  UpdateRecurringScheduleInput,
} from './recurringSchedule.schema';

const PAGE_SIZE = 100;
const MAX_PAGES_PER_TICK = 10;

// Prisma Client thuong HOAC client trong 1 transaction
type Db = typeof prisma | Prisma.TransactionClient;

function ruleOf(s: {
  frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timeOfDay: string;
}): RecurrenceRule {
  return {
    frequency: s.frequency,
    dayOfWeek: s.dayOfWeek,
    dayOfMonth: s.dayOfMonth,
    timeOfDay: s.timeOfDay,
  };
}

async function scheduleOrThrow(scheduleId: string) {
  const schedule = await prisma.recurringCardSchedule.findUnique({
    where: { id: scheduleId },
  });
  if (!schedule) throw new AppError('Khong tim thay lich the dinh ky', 404);
  return schedule;
}

async function assertCardTemplateOnSameBoard(
  cardTemplateId: string | undefined | null,
  boardId: string
) {
  if (!cardTemplateId) return;
  const tpl = await prisma.cardTemplate.findUnique({
    where: { id: cardTemplateId },
    select: { boardId: true },
  });
  if (!tpl || tpl.boardId !== boardId) {
    throw new AppError('Mau the khong thuoc bang nay', 400);
  }
}

export async function listSchedulesForList(userId: string, listId: string) {
  await assertListView(userId, listId);
  return prisma.recurringCardSchedule.findMany({
    where: { listId },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createSchedule(
  userId: string,
  listId: string,
  input: CreateRecurringScheduleInput
) {
  const list = await assertListAccess(userId, listId);
  await assertCardTemplateOnSameBoard(input.cardTemplateId, list.boardId);

  const startDate = input.startDate ? new Date(input.startDate) : new Date();
  const endDate = input.endDate ? new Date(input.endDate) : null;
  if (endDate && endDate <= startDate) {
    throw new AppError('Ngay dung phai sau ngay bat dau', 400);
  }

  const rule: RecurrenceRule = {
    frequency: input.frequency,
    dayOfWeek: input.dayOfWeek ?? null,
    dayOfMonth: input.dayOfMonth ?? null,
    timeOfDay: input.timeOfDay,
  };
  const now = new Date();
  const nextRunAt = nextOccurrenceOnOrAfter(startDate > now ? startDate : now, rule);

  return prisma.recurringCardSchedule.create({
    data: {
      listId,
      createdById: userId,
      title: input.title,
      description: input.description ?? null,
      cardTemplateId: input.cardTemplateId ?? null,
      frequency: input.frequency,
      dayOfWeek: rule.dayOfWeek,
      dayOfMonth: rule.dayOfMonth,
      timeOfDay: input.timeOfDay,
      startDate,
      endDate,
      nextRunAt,
    },
  });
}

export async function updateSchedule(
  userId: string,
  scheduleId: string,
  input: UpdateRecurringScheduleInput
) {
  const schedule = await scheduleOrThrow(scheduleId);
  const list = await assertListAccess(userId, schedule.listId);

  if (input.cardTemplateId !== undefined) {
    await assertCardTemplateOnSameBoard(input.cardTemplateId, list.boardId);
  }

  const mergedFrequency = input.frequency ?? schedule.frequency;
  const mergedDayOfWeek =
    input.dayOfWeek !== undefined ? input.dayOfWeek : schedule.dayOfWeek;
  const mergedDayOfMonth =
    input.dayOfMonth !== undefined ? input.dayOfMonth : schedule.dayOfMonth;
  if (mergedFrequency === 'WEEKLY' && mergedDayOfWeek == null) {
    throw new AppError('Can chon thu trong tuan khi lap lai theo tuan', 400);
  }
  if (mergedFrequency === 'MONTHLY' && mergedDayOfMonth == null) {
    throw new AppError('Can chon ngay trong thang khi lap lai theo thang', 400);
  }

  const mergedStartDate = input.startDate
    ? new Date(input.startDate)
    : schedule.startDate;
  const mergedEndDate =
    input.endDate !== undefined
      ? input.endDate
        ? new Date(input.endDate)
        : null
      : schedule.endDate;
  if (mergedEndDate && mergedEndDate <= mergedStartDate) {
    throw new AppError('Ngay dung phai sau ngay bat dau', 400);
  }

  // Doi lich lap lai (tan suat/thu/ngay/gio/ngay bat dau) -> tinh lai lan
  // chay ke tiep tu bay gio (khong dung "startDate" cu de tranh don du lieu cu).
  const recurrenceChanged =
    input.frequency !== undefined ||
    input.dayOfWeek !== undefined ||
    input.dayOfMonth !== undefined ||
    input.timeOfDay !== undefined ||
    input.startDate !== undefined;

  const mergedTimeOfDay = input.timeOfDay ?? schedule.timeOfDay;
  const rule: RecurrenceRule = {
    frequency: mergedFrequency,
    dayOfWeek: mergedDayOfWeek,
    dayOfMonth: mergedDayOfMonth,
    timeOfDay: mergedTimeOfDay,
  };

  // Chi TINH LAI (va GHI) nextRunAt khi that su can - doi quy luat lap lai,
  // hoac mo tam dung sau khi da qua han. Cac lan sua khac (vd chi doi tieu
  // de) KHONG duoc dua nextRunAt vao data update: neu luon ghi (du la ghi
  // lai dung gia tri schedule.nextRunAt da doc tu dau ham), 1 request sua
  // noi dung xen giua luc scheduler vua claim + tien nextRunAt se de "de"
  // gia tri CU cua no, xoa mat viec scheduler vua tien - lan quet sau lai
  // thay "den han" va tao trung the cho ky vua xu ly xong.
  const now = new Date();
  let nextRunAt: Date | undefined;
  if (recurrenceChanged) {
    const from = mergedStartDate > now ? mergedStartDate : now;
    nextRunAt = nextOccurrenceOnOrAfter(from, rule);
  } else if (
    input.isPaused === false &&
    schedule.isPaused &&
    schedule.nextRunAt < now
  ) {
    // Mo tam dung nhung lan chay du kien da qua -> tinh lai tu bay gio,
    // tranh don mot chuoi lan chay bi lo trong luc tam dung.
    nextRunAt = nextOccurrenceOnOrAfter(now, rule);
  }

  return prisma.recurringCardSchedule.update({
    where: { id: scheduleId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined
        ? { description: input.description || null }
        : {}),
      ...(input.cardTemplateId !== undefined
        ? { cardTemplateId: input.cardTemplateId }
        : {}),
      ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
      ...(input.dayOfWeek !== undefined ? { dayOfWeek: input.dayOfWeek } : {}),
      ...(input.dayOfMonth !== undefined ? { dayOfMonth: input.dayOfMonth } : {}),
      ...(input.timeOfDay !== undefined ? { timeOfDay: input.timeOfDay } : {}),
      ...(input.startDate !== undefined ? { startDate: mergedStartDate } : {}),
      ...(input.endDate !== undefined ? { endDate: mergedEndDate } : {}),
      ...(input.isPaused !== undefined ? { isPaused: input.isPaused } : {}),
      ...(nextRunAt !== undefined ? { nextRunAt } : {}),
    },
  });
}

export async function deleteSchedule(userId: string, scheduleId: string) {
  const schedule = await scheduleOrThrow(scheduleId);
  await assertListAccess(userId, schedule.listId);
  await prisma.recurringCardSchedule.delete({ where: { id: scheduleId } });
}

// ---------- Scheduler ----------

// Xuat rieng de test goi truc tiep 1 vong quet.
export async function runOnce(): Promise<void> {
  const now = new Date();

  for (let page = 0; page < MAX_PAGES_PER_TICK; page += 1) {
    const candidates = await prisma.recurringCardSchedule.findMany({
      where: {
        isPaused: false,
        nextRunAt: { lte: now },
      },
      take: PAGE_SIZE,
    });
    if (candidates.length === 0) break;

    let progressed = false;

    for (const s of candidates) {
      // Dieu kien CAS dung chung cho moi buoc "nhan xu ly" lich nay trong
      // vong nay: khop dung ban ghi da doc (nextRunAt + updatedAt lam "phien
      // ban") VA con dang hoat dong. Neu nguoi dung tam dung HOAC sua bat ky
      // truong nao (updateSchedule luon cap nhat updatedAt) giua luc doc
      // candidates va luc nay, dieu kien khong khop nua -> count=0, bo qua
      // an toan thay vi dung du lieu cu (s) da loi thoi.
      const claimWhere = {
        id: s.id,
        nextRunAt: s.nextRunAt,
        updatedAt: s.updatedAt,
        isPaused: false,
      };

      // Da qua ngay dung han -> khong tao the nua, tam dung han de khong bi
      // quet lai moi vong sau.
      if (s.endDate && s.nextRunAt > s.endDate) {
        await prisma.recurringCardSchedule.updateMany({
          where: claimWhere,
          data: { isPaused: true },
        });
        progressed = true;
        continue;
      }

      progressed = true;
      const rule = ruleOf(s);

      // Nguoi tao co the da mat quyen sua danh sach nay (bi xoa khoi bang,
      // bang doi quyen...) tu luc dat lich toi luc nay - kiem tra lai truoc
      // khi tao the, khong tao "le" trong bang ma ho khong con quyen.
      let list: { boardId: string } | null = null;
      try {
        list = await assertListAccess(s.createdById, s.listId);
      } catch {
        await prisma.recurringCardSchedule.updateMany({
          where: claimWhere,
          data: { isPaused: true },
        });
        continue;
      }

      const nextRunAt = nextOccurrenceAfter(s.nextRunAt, rule);
      const boardId = list.boardId;

      // Claim (CAS theo nextRunAt + updatedAt + isPaused cu, xem claimWhere o
      // tren) + tao the trong CUNG 1 transaction: neu 2 tien trinh scheduler
      // cung doc duoc lich nay o cung 1 vong, hoac nguoi dung vua tam
      // dung/sua lich giua luc doc va luc nay, chi 1 ben claim thanh cong
      // (updateMany chi khop dung 1 lan, ben kia/lan sua sau count=0). Neu
      // tao the that bai giua chung, ca claim cung roll back - nextRunAt van
      // la gia tri cu de vong sau thu lai, khong "mat" 1 lan chay ma khong ai
      // tao the, va cung khong tao "the ma" (claim thanh cong nhung
      // nextRunAt khong tien) do dam voi tien trinh khac.
      let createdCardId: string | null = null;
      try {
        const claimed = await prisma.$transaction(async (tx) => {
          const claim = await tx.recurringCardSchedule.updateMany({
            where: claimWhere,
            data: { lastRunAt: now, nextRunAt },
          });
          if (claim.count === 0) return false;
          const card = await createCardFromSchedule(tx, s);
          createdCardId = card.id;
          return true;
        });
        if (!claimed) continue;
      } catch (err) {
        console.error('[recurring] claim/tao the that bai, se thu lai vong sau:', err);
        continue;
      }

      // Da commit thanh cong (the chac chan da duoc tao, chi 1 lan) - ghi log
      // + chay tu dong hoa SAU transaction, khong nam trong do (day la buoc
      // best-effort, giong het cach card.service.ts xu ly the tao thu cong;
      // loi o day khong duoc "hoi to" lam mat the da tao).
      if (createdCardId) {
        await logActivity({
          boardId,
          cardId: createdCardId,
          userId: s.createdById,
          type: 'card.create',
          data: { fromRecurringSchedule: true, scheduleTitle: s.title },
        });
        await runAutomationsForCard(
          'CARD_CREATED',
          createdCardId,
          s.title,
          boardId,
          s.listId
        );
      }
    }

    if (!progressed) break;
    if (candidates.length < PAGE_SIZE) break;
  }
}

async function createCardFromSchedule(
  db: Db,
  schedule: Awaited<ReturnType<typeof scheduleOrThrow>>
): Promise<{ id: string }> {
  const last = await db.card.findFirst({
    where: { listId: schedule.listId, deletedAt: null, archivedAt: null },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  let description = schedule.description;
  let checklistsCreate:
    | { title: string; position: number; items: { create: { content: string; position: number }[] } }[]
    | undefined;

  if (schedule.cardTemplateId) {
    const tpl = await db.cardTemplate.findUnique({
      where: { id: schedule.cardTemplateId },
      include: {
        checklists: {
          orderBy: { position: 'asc' },
          include: { items: { orderBy: { position: 'asc' } } },
        },
      },
    });
    if (tpl) {
      description = tpl.description;
      checklistsCreate = tpl.checklists.map((cl, i) => ({
        title: cl.title,
        position: i,
        items: {
          create: cl.items.map((it, j) => ({ content: it.content, position: j })),
        },
      }));
    }
  }

  const list = await db.list.findUnique({
    where: { id: schedule.listId },
    select: { status: true },
  });

  return db.card.create({
    data: {
      listId: schedule.listId,
      title: schedule.title.slice(0, 500),
      description,
      position: last ? last.position + 1 : 0,
      ...initialStatusData(list?.status),
      checklists: checklistsCreate ? { create: checklistsCreate } : undefined,
    },
    select: { id: true },
  });
}
