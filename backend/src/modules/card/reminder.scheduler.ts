import { env } from '../../config/env';
import { sendMail } from '../../config/mailer';
import { prisma } from '../../config/prisma';
import { dueReminderEmail } from '../auth/emailTemplates';
import { notifyDueReminder } from '../notification/notification.service';
import { getOrCreatePreference } from '../notification/notificationPreference.service';
import { emitToUser } from '../../realtime/socket';
import { assertBoardView } from '../board/board.service';
import { REMINDER_OFFSETS } from './card.schema';

// Vong quet nhac han: moi phut tim CardReminder chua gui (sentAt = null) ma
// da toi (hoac qua) moc "dueDate - offsetMinutes", roi bao trong-app + email.
const CHECK_INTERVAL_MS = 60_000;
const PAGE_SIZE = 200;
const MAX_PAGES_PER_TICK = 20; // an toan, tranh vong lap vo han

const OFFSET_LABELS: Record<number, string> = {
  10: '10 phút',
  60: '1 giờ',
  1440: '1 ngày',
};

let timer: ReturnType<typeof setInterval> | null = null;

// Loc CHINH XAC theo tung muc nhac (offsetMinutes chi co vai gia tri co dinh
// - REMINDER_OFFSETS) ngay trong cau truy van, thay vi loc tho theo 1 moc xa
// nhat roi gan dung sau khi doc ve: "da toi luc nhac" <=> dueDate - offset <=
// now <=> dueDate <= now + offset. Neu chi loc tho (vd dueDate <= now + 1440
// phut cho MOI muc), 1 luong lon reminder co dueDate xa (vi du 12 gio nua)
// nhung offset nho (10 phut) van lot qua bo loc ma chua thuc su den han, co
// the choan het "cho" cua trang dau (gioi han take) va che khuat nhung
// reminder KHAC da thuc su den han.
function duePageWhere(now: Date) {
  return {
    sentAt: null,
    OR: REMINDER_OFFSETS.map((offsetMinutes) => ({
      offsetMinutes,
      card: {
        deletedAt: null,
        archivedAt: null,
        isDone: false,
        dueDate: { not: null, lte: new Date(now.getTime() + offsetMinutes * 60_000) },
        list: {
          deletedAt: null,
          archivedAt: null,
          board: { deletedAt: null, archivedAt: null },
        },
      },
    })),
  };
}

async function fetchDuePage(now: Date) {
  return prisma.cardReminder.findMany({
    where: duePageWhere(now),
    include: {
      user: { select: { id: true, email: true, name: true } },
      card: {
        select: {
          id: true,
          title: true,
          dueDate: true,
          list: {
            select: {
              boardId: true,
              board: { select: { name: true } },
            },
          },
        },
      },
    },
    take: PAGE_SIZE,
  });
}

// Xuat rieng de test goi truc tiep 1 vong quet (khong phai doi setInterval).
export async function runOnce(): Promise<void> {
  const now = new Date();

  for (let page = 0; page < MAX_PAGES_PER_TICK; page += 1) {
    const candidates = await fetchDuePage(now);
    if (candidates.length === 0) break;

    let claimedAny = false;

    for (const r of candidates) {
      const dueDate = r.card.dueDate;
      if (!dueDate) continue;
      // Vong bao ve: truy van da loc chinh xac remindAt <= now, dong nay
      // chi phong khi do lech thoi gian nho giua luc query va luc xu ly.
      const remindAt = new Date(dueDate.getTime() - r.offsetMinutes * 60_000);
      if (remindAt > now) continue;

      const boardId = r.card.list.boardId;

      // Nguoi dat nhac co the da mat quyen xem bang tu luc dat toi luc nay
      // (bi xoa khoi bang, bang doi PRIVATE...) - kiem tra lai truoc khi gui,
      // khong de lo ten the/bang/han cho nguoi khong con quyen xem. Reminder
      // khong con hop le thi xoa hang han, khong giu lai (khong the "gui bu"
      // sau vi da qua thoi diem, va giu lai chi de vong sau lai kiem tra lai).
      try {
        await assertBoardView(r.userId, boardId);
      } catch {
        await prisma.cardReminder.delete({ where: { id: r.id } }).catch(() => {});
        continue;
      }

      const offsetLabel = OFFSET_LABELS[r.offsetMinutes] ?? `${r.offsetMinutes} phút`;

      // Cai dat thong bao ca nhan: co the da tat thong bao trong-app va/hoac
      // email rieng cho nhac han (van tinh la "da gui" - claim - du tat ca,
      // vi nhac han gan voi 1 thoi diem cu the, khong "gui bu" duoc sau).
      const pref = await getOrCreatePreference(r.userId);

      // Claim (CAS) + tao thong bao trong CUNG 1 transaction:
      // - Neu tao thong bao that bai (vd loi DB) hoac tien trinh dung giua
      //   chung, ca buoc claim cung bi rollback -> sentAt van null, vong quet
      //   sau se tu thu lai, khong "mat" reminder ma khong ai duoc bao.
      // - Dieu kien "card.dueDate = dueDate" (gia tri doc luc dau tick) khoa
      //   luon ca han: neu nguoi dung doi han ngay sau khi scheduler doc du
      //   lieu (thao tac doi han se reset sentAt ve null cho han moi), CAS se
      //   khong khop nua (dueDate trong DB da khac) -> khong claim, khong gui
      //   nham theo han cu, va reminder van sentAt=null de vong sau xet lai
      //   dung theo han moi.
      // Loi cua 1 reminder (vd tao thong bao that bai) khong duoc lam hong ca
      // vong quet - cac reminder KHAC trong cung trang/tick van phai duoc xu
      // ly tiep, nen bat loi rieng cho tung reminder thay vi de $transaction
      // nem thang ra ngoai vong lap.
      let claimed: boolean;
      try {
        claimed = await prisma.$transaction(async (tx) => {
          const claim = await tx.cardReminder.updateMany({
            where: { id: r.id, sentAt: null, card: { dueDate } },
            data: { sentAt: now },
          });
          if (claim.count === 0) return false;
          if (pref.dueReminderInApp) {
            await notifyDueReminder(tx, {
              userId: r.userId,
              cardId: r.cardId,
              boardId,
              data: {
                cardTitle: r.card.title,
                dueDate: dueDate.toISOString(),
                offsetLabel,
              },
            });
          }
          return true;
        });
      } catch (err) {
        console.error('[reminder] claim/tao thong bao that bai, se thu lai vong sau:', err);
        continue;
      }
      if (!claimed) continue;
      claimedAny = true;
      if (pref.dueReminderInApp) {
        emitToUser(r.userId, 'notification:new', {});
      }

      if (pref.dueReminderEmail) {
        try {
          const { subject, html } = dueReminderEmail({
            name: r.user.name,
            cardTitle: r.card.title,
            boardName: r.card.list.board.name,
            dueDate,
            offsetLabel,
            url: `${env.frontendUrl}/boards/${boardId}?card=${r.cardId}`,
          });
          await sendMail({ to: r.user.email, subject, html });
        } catch (err) {
          // Loi gui mail khong duoc lam hong vong quet (thong bao trong-app da co)
          console.error('[reminder] gui email that bai:', err);
        }
      }
    }

    // An toan: truy van da loc chinh xac nen binh thuong luon claim duoc it
    // nhat 1 dong khi candidates.length > 0. Neu khong (vd dung dam voi 1
    // tien trinh scheduler khac gianh het CAS) thi dung lai ngay, tranh doc
    // lai y het trang nay va lap vo han trong cung 1 tick.
    if (!claimedAny) break;
    // Trang chua day PAGE_SIZE nghia la da het ung vien.
    if (candidates.length < PAGE_SIZE) break;
  }
}

export function startReminderScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    runOnce().catch((err) => {
      console.error('[reminder] loi khi quet nhac han:', err);
    });
  }, CHECK_INTERVAL_MS);
  timer.unref();
}

export function stopReminderScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
