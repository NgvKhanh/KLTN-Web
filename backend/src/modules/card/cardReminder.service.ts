import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { assertCardView } from './card.service';
import { REMINDER_OFFSETS } from './card.schema';

// Nhan het han: nguoi dung tu dat truoc bao nhieu phut minh muon duoc nhac.
// Rieng tu (khong dung chung giua cac thanh vien the). Chi doi hoi quyen XEM
// the (VIEWER cung dat duoc) vi day la thiet lap ca nhan, khong sua noi dung.

export async function listCardReminders(userId: string, cardId: string) {
  await assertCardView(userId, cardId);
  return prisma.cardReminder.findMany({
    where: { cardId, userId },
    orderBy: { offsetMinutes: 'asc' },
  });
}

export async function addCardReminder(
  userId: string,
  cardId: string,
  offsetMinutes: number
) {
  const card = await assertCardView(userId, cardId);
  if (!card.dueDate) {
    throw new AppError('The chua co ngay het han de dat nhac', 400);
  }
  if (!(REMINDER_OFFSETS as readonly number[]).includes(offsetMinutes)) {
    throw new AppError('Muc nhac khong hop le', 400);
  }
  return prisma.cardReminder.upsert({
    where: { cardId_userId_offsetMinutes: { cardId, userId, offsetMinutes } },
    create: { cardId, userId, offsetMinutes },
    update: {},
  });
}

export async function removeCardReminder(
  userId: string,
  cardId: string,
  offsetMinutes: number
) {
  await assertCardView(userId, cardId);
  await prisma.cardReminder.deleteMany({
    where: { cardId, userId, offsetMinutes },
  });
}

// Goi khi dueDate cua the thay doi (card.service.ts / updateCard):
// - dueDate bi bo -> xoa het nhac han (khong con moc thoi gian de tinh)
// - dueDate doi sang gia tri khac -> nhac lai tu dau (sentAt = null) cho moc moi
export async function resetCardRemindersOnDueDateChange(
  cardId: string,
  hasNewDueDate: boolean
): Promise<void> {
  if (hasNewDueDate) {
    await prisma.cardReminder.updateMany({
      where: { cardId },
      data: { sentAt: null },
    });
  } else {
    await prisma.cardReminder.deleteMany({ where: { cardId } });
  }
}
