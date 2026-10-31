// Do du lieu mo phong (simGenerator.ts) vao Postgres de DEMO duoc trong san pham.
// Tach khoi CLI (seedSimulation.ts) de test goi thang duoc tren DB test.
//
// AN TOAN: moi thu tao ra deu gan voi tai khoan @sim.local; phan don dep chi
// xoa dung nhung tai khoan do va thu ho so huu - khong cham vao du lieu that.
// Chay lai nhieu lan la an toan: luon don sach ban cu roi tao ban moi, trong
// MOT transaction (loi giua chung thi ban cu con nguyen).

import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { hashPassword } from '../utils/password';
import { type SimCard, type SimDataset } from './simGenerator';

export const SIM_EMAIL_DOMAIN = 'sim.local';
export const SIM_WORKSPACE_NAME = 'Nhóm đồ án (mô phỏng)';
export const SIM_DEFAULT_PASSWORD = 'Password123';

// Lich su ghi theo gio Viet Nam (UTC+7), dung quy uoc cua module AI (§5.3):
// moc "bat dau" 00:00, "han" 23:59 gio VN - frontend hien theo gio dia phuong.
const VN_OFFSET_MS = 7 * 3600 * 1000;
const DAY_MS = 86_400_000;

type Db = PrismaClient | Prisma.TransactionClient;

/** Ngay hom nay theo gio Viet Nam, dang YYYY-MM-DD. Dung Intl nen khong phu thuoc bien TZ. */
export function vnToday(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Doi "ngay so `day`" cua bo mo phong (ngay `totalDays` = hom nay) sang thoi
 * diem that, gio Viet Nam. `hour`/`minute` la gio trong ngay theo gio VN.
 */
export function simDayToDate(
  today: string,
  totalDays: number,
  day: number,
  hour = 0,
  minute = 0
): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!m) throw new Error(`today phai dang YYYY-MM-DD, nhan duoc "${today}"`);
  const vnMidnightUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - VN_OFFSET_MS;
  return new Date(
    vnMidnightUtc - (totalDays - day) * DAY_MS + hour * 3600_000 + minute * 60_000
  );
}

export interface RemoveResult {
  users: number;
  workspaces: number;
}

/** Xoa toan bo du lieu mo phong cu. Chi dung toi tai khoan @sim.local va thu ho so huu. */
export async function removeSimulation(db: Db): Promise<RemoveResult> {
  const users = await db.user.findMany({
    where: { email: { endsWith: `@${SIM_EMAIL_DOMAIN}` } },
    select: { id: true },
  });
  if (users.length === 0) return { users: 0, workspaces: 0 };

  const userIds = users.map((u) => u.id);
  const workspaces = await db.workspace.findMany({
    where: { ownerId: { in: userIds } },
    select: { id: true },
  });
  const workspaceIds = workspaces.map((w) => w.id);

  // AssignRun dung SetNull (nhat ky phai song sot qua viec xoa) - o day ta MUON
  // xoa vi chung la nhat ky cua du lieu gia, neu de lai chi la rac mo coi.
  await db.assignRun.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  // Xoa user keo theo (Cascade): khong gian, bang, danh sach, the, thanh vien,
  // nhat ky hoat dong, ho so lam viec, trong so.
  await db.user.deleteMany({ where: { id: { in: userIds } } });

  return { users: userIds.length, workspaces: workspaceIds.length };
}

export interface SeedOptions {
  /** Ngay "hom nay" theo gio VN, YYYY-MM-DD. Mac dinh: hom nay that. */
  today?: string;
  password?: string;
}

export interface SeedResult {
  workspaceId: string;
  userIds: Record<string, string>;
  boardIds: Record<string, string>;
  cardIds: Record<string, string>;
  removed: RemoveResult;
  counts: { users: number; boards: number; cards: number; activities: number };
}

const BOARD_COLORS = ['#0079BF', '#519839', '#B04632', '#89609E', '#00AECC'];
const LIST_NAMES = ['Cần làm', 'Đang làm', 'Hoàn thành'] as const;

/** Nguoi giao viec = chinh nguoi nhan -> tu nhan: assignedById phai la null (xem schema). */
function assignerOf(card: SimCard): string | null {
  return card.assignedByKey === card.assigneeKey ? null : card.assignedByKey;
}

export async function seedSimulation(
  prisma: PrismaClient,
  data: SimDataset,
  opts: SeedOptions = {}
): Promise<SeedResult> {
  const today = opts.today ?? vnToday();
  const days = data.config.days;
  const at = (day: number, hour = 0, minute = 0) => simDayToDate(today, days, day, hour, minute);
  const passwordHash = await hashPassword(opts.password ?? SIM_DEFAULT_PASSWORD);
  const owner = data.people[0];
  if (!owner) throw new Error('Bo du lieu khong co nguoi nao');

  return prisma.$transaction(
    async (tx) => {
      const removed = await removeSimulation(tx);

      // ---------- Tai khoan + khong gian ca nhan (giong luc dang ky that) ----------
      const userIds: Record<string, string> = {};
      for (const p of data.people) {
        const user = await tx.user.create({
          data: {
            email: p.email,
            name: p.name,
            passwordHash,
            emailVerifiedAt: at(p.joinedDay, 8),
            createdAt: at(p.joinedDay, 8),
          },
          select: { id: true },
        });
        userIds[p.key] = user.id;
        await tx.workspace.create({
          data: {
            ownerId: user.id,
            name: `Không gian của ${p.name}`,
            isPersonal: true,
            members: { create: { userId: user.id, role: 'OWNER' } },
          },
        });
      }

      // ---------- Khong gian nhom + ho so lam viec ----------
      const workspace = await tx.workspace.create({
        data: { ownerId: userIds[owner.key]!, name: SIM_WORKSPACE_NAME, createdAt: at(0, 8) },
        select: { id: true },
      });
      for (const p of data.people) {
        await tx.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: userIds[p.key]!,
            role: p.key === owner.key ? 'OWNER' : 'MEMBER',
            createdAt: at(p.joinedDay, 9),
            // Nguoi da roi nhom: bi go khoi khong gian (xoa mem) tu ngay ho roi
            deletedAt: p.leftDay === null ? null : at(p.leftDay, 9),
          },
        });
        await tx.memberWorkProfile.create({
          data: {
            userId: userIds[p.key]!,
            workspaceId: workspace.id,
            maxParallelCards: p.capacity,
          },
        });
      }

      // ---------- Bang + danh sach + thanh vien bang ----------
      const boardIds: Record<string, string> = {};
      const listIds: Record<string, string[]> = {};
      for (const [bi, b] of data.boards.entries()) {
        const board = await tx.board.create({
          data: {
            ownerId: userIds[owner.key]!,
            workspaceId: workspace.id,
            name: b.name,
            color: BOARD_COLORS[bi % BOARD_COLORS.length]!,
            createdAt: at(b.startDay, 9),
          },
          select: { id: true },
        });
        boardIds[b.key] = board.id;

        listIds[b.key] = [];
        for (const [li, name] of LIST_NAMES.entries()) {
          const list = await tx.list.create({
            data: { boardId: board.id, name, position: li, createdAt: at(b.startDay, 9) },
            select: { id: true },
          });
          listIds[b.key]!.push(list.id);
        }

        for (const p of data.people) {
          // Chi nguoi da co mat trong khoang thoi gian cua bang moi la thanh vien
          const present = p.joinedDay <= b.endDay + 3 && (p.leftDay === null || p.leftDay > b.startDay);
          if (!present) continue;
          await tx.boardMember.create({
            data: {
              boardId: board.id,
              userId: userIds[p.key]!,
              role: p.key === owner.key ? 'OWNER' : 'MEMBER',
              joinedAt: at(Math.max(p.joinedDay, b.startDay), 9),
              createdAt: at(Math.max(p.joinedDay, b.startDay), 9),
              deletedAt: p.leftDay === null ? null : at(p.leftDay, 9),
            },
          });
        }
      }

      // ---------- The + nguoi duoc gan + nhat ky ----------
      const cardIds: Record<string, string> = {};
      const positions = new Map<string, number>();
      const nameOf = new Map(data.people.map((p) => [p.key, p.name]));
      const activities: Prisma.ActivityCreateManyInput[] = [];

      for (const c of data.cards) {
        const boardId = boardIds[c.boardKey]!;
        const listId = listIds[c.boardKey]![c.listIndex]!;
        const posKey = `${c.boardKey}/${c.listIndex}`;
        const position = positions.get(posKey) ?? 0;
        positions.set(posKey, position + 1);

        const createdAt = at(c.createdDay, 9);
        const assignedAt = at(c.assignedDay, 10);
        const completedAt = c.done && c.completedDay !== null ? at(c.completedDay, 17) : null;
        const assignerKey = assignerOf(c);

        const card = await tx.card.create({
          data: {
            listId,
            title: c.title,
            description: c.description,
            status: c.done ? 'DONE' : 'TODO',
            isDone: c.done,
            completedAt,
            startDate: at(c.assignedDay, 0),
            dueDate: at(c.dueDay, 23, 59),
            position,
            createdAt,
            updatedAt: completedAt ?? assignedAt,
            members: {
              create: {
                userId: userIds[c.assigneeKey]!,
                createdAt: assignedAt,
                assignedById: assignerKey === null ? null : userIds[assignerKey]!,
              },
            },
          },
          select: { id: true },
        });
        cardIds[c.key] = card.id;

        const ownerId = userIds[owner.key]!;
        const assigneeId = userIds[c.assigneeKey]!;
        activities.push(
          {
            boardId,
            cardId: card.id,
            userId: ownerId,
            type: 'card.create',
            data: { listName: LIST_NAMES[0] },
            createdAt,
          },
          {
            boardId,
            cardId: card.id,
            userId: assignerKey === null ? assigneeId : userIds[assignerKey]!,
            type: 'member.add',
            // Giong nhat ky that sau buoc 1: co ca memberId lan memberName
            data: { memberId: assigneeId, memberName: nameOf.get(c.assigneeKey)! },
            createdAt: assignedAt,
          }
        );
        if (c.done && c.completedDay !== null) {
          if (c.reopened) {
            // Bi mo lai trong cung ngay: xong -> mo lai -> xong. Cot completedAt
            // chi giu lan cuoi, con lich su mo lai nam o day (schema.prisma).
            activities.push(
              { boardId, cardId: card.id, userId: assigneeId, type: 'card.done', data: {}, createdAt: at(c.completedDay, 9) },
              { boardId, cardId: card.id, userId: assigneeId, type: 'card.undone', data: {}, createdAt: at(c.completedDay, 11) }
            );
          }
          activities.push({
            boardId,
            cardId: card.id,
            userId: assigneeId,
            type: 'card.done',
            data: {},
            createdAt: completedAt!,
          });
        }
      }

      await tx.activity.createMany({ data: activities });

      return {
        workspaceId: workspace.id,
        userIds,
        boardIds,
        cardIds,
        removed,
        counts: {
          users: data.people.length,
          boards: data.boards.length,
          cards: data.cards.length,
          activities: activities.length,
        },
      };
    },
    { timeout: 120_000, maxWait: 10_000 }
  );
}
