// Ap dung ke hoach: tao BANG THAT tu BoardPlan nguoi dung da xem/sua (buoc 5).
//
// Ranh gioi tin cay #2 (AI_MODULE.md §3): BoardPlan di server -> trinh duyet -> server
// nen client co the sua BAT KY truong nao. Zod da kiem lai toan bo (validateBody); o day
// kiem lai them QUYEN (chu run, thanh vien workspace) va chot "chi ap dung 1 lan".
//
// KHONG dung lai createLabel/addChecklist/updateCard...: cac ham do dung `prisma` toan
// cuc (khong nhan `tx`), tu kiem quyen lai va tu phat socket moi lan goi -> khong nam
// trong transaction. Dung KY THUAT ghi long nhau cua createBoardFromTemplate.
//
// THU TU (bai hoc loi #3 cua v1): ghi DB THUAN trong transaction -> COMMIT -> moi
// den tac dung phu (nhat ky/socket) trong try/catch, de loi phu khong lam hong ket qua
// da thanh cong.

import type { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import { logActivity } from '../activity/activity.service';
import { assertWorkspaceAccess } from '../workspace/workspace.service';
import { guessListStatus, initialStatusData } from '../card/cardStatus';
import type { IsoDate } from './ai.dates';
import { boardPlanSchema, type BoardPlan } from './boardPlan.schema';

// ===================== Ngay -> thoi diem =====================
// Frontend hien ngay han bang GIO DIA PHUONG (CardItem: toLocaleDateString('vi-VN')) va
// luu bang cach doi gio dia phuong sang ISO (CardModal). Luu "23:59Z" se hien thanh NGAY
// HOM SAU (06:59) voi nguoi dung Viet Nam. Vi vay neo theo gio Viet Nam (UTC+7, khong co
// gio mua he) - dung bang thu nguoi dung tu chon ngay roi luu: bat dau 00:00, han 23:59.
// Day la cho DUY NHAT trong module doi chuoi ngay "YYYY-MM-DD" sang Date.
const VN_UTC_OFFSET = '+07:00';

export function startInstant(day: IsoDate): Date {
  return new Date(`${day}T00:00:00.000${VN_UTC_OFFSET}`);
}
export function dueInstant(day: IsoDate): Date {
  return new Date(`${day}T23:59:00.000${VN_UTC_OFFSET}`);
}

// ===================== Dem so lan nguoi dung sua =====================

/**
 * So truong nguoi dung da sua so voi ban AI de xuat (so lieu nghiem thu cua luan van:
 * "nguoi dung phai sua bao nhieu"). SERVER tu tinh, khong nhan tu client.
 * Dem: ten bang, mau bang; ten/mau/them/xoa nhan; ten danh sach (1 lan/danh sach, khong
 * nhan theo so the), them/xoa danh sach; voi tung the: tieu de, mo ta, tick, ngay bat dau,
 * ngay han, tap nhan, checklist, chuyen sang danh sach khac; the them moi / bi xoa (1 lan).
 * KHONG dem: canh bao, gia dinh, sourceLine, thu tu the.
 * Danh sach khong co id nen duoc khop theo the dau tien con ton tai trong ban goc
 * (khong co the nao thi khop theo ten).
 */
export function countPlanEdits(original: BoardPlan, edited: BoardPlan): number {
  let n = 0;
  if (original.board.name !== edited.board.name) n += 1;
  if (original.board.color !== edited.board.color) n += 1;

  // ---- nhan: khop theo key ----
  const origLabels = new Map(original.labels.map((l) => [l.key, l]));
  const editLabels = new Map(edited.labels.map((l) => [l.key, l]));
  for (const [key, l] of editLabels) {
    const o = origLabels.get(key);
    if (!o) n += 1;
    else {
      if (o.name !== l.name) n += 1;
      if (o.color !== l.color) n += 1;
    }
  }
  for (const key of origLabels.keys()) if (!editLabels.has(key)) n += 1;

  // ---- danh sach ----
  const origListOfRef = new Map<string, number>();
  const origCards = new Map<string, BoardPlan['lists'][number]['cards'][number]>();
  original.lists.forEach((l, i) =>
    l.cards.forEach((c) => {
      origListOfRef.set(c.ref, i);
      origCards.set(c.ref, c);
    })
  );
  const claimed = new Set<number>();
  const listMap: Array<number | null> = edited.lists.map((l) => {
    const anchor = l.cards.find((c) => origListOfRef.has(c.ref));
    let idx: number | null = anchor ? origListOfRef.get(anchor.ref)! : null;
    if (idx === null) {
      const byName = original.lists.findIndex((o, i) => o.name === l.name && !claimed.has(i));
      idx = byName >= 0 ? byName : null;
    }
    if (idx !== null && claimed.has(idx)) idx = null; // danh sach ban goc bi tach lam hai: phan sau la danh sach moi
    if (idx !== null) claimed.add(idx);
    return idx;
  });
  edited.lists.forEach((l, i) => {
    const o = listMap[i];
    if (o === null || o === undefined) n += 1; // danh sach moi
    else if (original.lists[o]!.name !== l.name) n += 1; // doi ten
  });
  original.lists.forEach((_l, i) => {
    if (!claimed.has(i)) n += 1; // danh sach bi xoa
  });

  // ---- the ----
  const seen = new Set<string>();
  edited.lists.forEach((l, li) =>
    l.cards.forEach((c) => {
      seen.add(c.ref);
      const o = origCards.get(c.ref);
      if (!o) {
        n += 1; // the them moi
        return;
      }
      if (listMap[li] !== origListOfRef.get(c.ref)) n += 1; // chuyen sang danh sach khac
      if (o.title !== c.title) n += 1;
      if (o.description !== c.description) n += 1;
      if (o.selected !== c.selected) n += 1;
      if (o.startDate !== c.startDate) n += 1;
      if (o.dueDate !== c.dueDate) n += 1;
      if (JSON.stringify([...o.labelKeys].sort()) !== JSON.stringify([...c.labelKeys].sort())) n += 1;
      if (JSON.stringify(o.checklist) !== JSON.stringify(c.checklist)) n += 1;
    })
  );
  for (const ref of origCards.keys()) if (!seen.has(ref)) n += 1; // the bi xoa

  return n;
}

// ===================== Tao bang =====================

export async function applyPlan(userId: string, runId: string, plan: BoardPlan) {
  // Khong phai run cua minh -> 404 (khong tiet lo run do co ton tai hay khong)
  const run = await prisma.aiRun.findFirst({ where: { id: runId, actorKey: userId } });
  if (!run) throw new AppError('Khong tim thay ke hoach', 404);
  if (run.appliedAt !== null) throw new AppError('Ke hoach nay da duoc ap dung', 409);
  if (!run.workspaceId) throw new AppError('Khong gian lam viec cua ke hoach nay khong con ton tai', 404);
  const workspaceId = run.workspaceId;

  // Nguoi dung co the da bi go khoi khong gian SAU khi sinh ke hoach
  await assertWorkspaceAccess(userId, workspaceId);

  // Chi tao the DUOC TICK; danh sach khong con the nao thi bo; chi tao nhan co the dung
  const lists = plan.lists
    .map((l) => ({ name: l.name, cards: l.cards.filter((c) => c.selected) }))
    .filter((l) => l.cards.length > 0);
  if (lists.length === 0) throw new AppError('Chua chon the nao de tao bang', 400);
  const usedLabelKeys = new Set(lists.flatMap((l) => l.cards.flatMap((c) => c.labelKeys)));
  const labels = plan.labels.filter((l) => usedLabelKeys.has(l.key));
  const cardCount = lists.reduce((sum, l) => sum + l.cards.length, 0);

  const original = boardPlanSchema.safeParse(run.plan);
  const editCount = original.success ? countPlanEdits(original.data, plan) : null;

  const board = await prisma.$transaction(
    async (tx) => {
      // "Nhan cho" NGUYEN TU: chi 1 yeu cau thang du bam dup / 2 tab cung luc (khoa dong cua
      // Postgres lam yeu cau sau thay appliedAt da co -> 0 dong). Nam TRONG transaction: neu
      // buoc sau loi thi viec nhan cho cung bi rollback, run van ap dung lai duoc.
      const claim = await tx.aiRun.updateMany({
        where: { id: run.id, actorKey: userId, appliedAt: null },
        data: { appliedAt: new Date() },
      });
      if (claim.count === 0) throw new AppError('Ke hoach nay da duoc ap dung', 409);

      const created = await tx.board.create({
        data: {
          ownerId: userId,
          workspaceId,
          name: plan.board.name,
          color: plan.board.color,
          members: { create: { userId, role: 'OWNER' } },
          lists: {
            // Cot do AI sinh ra la cot MOI -> doan trang thai theo ten nhu cot tao tay
            create: lists.map((l, li) => ({
              name: l.name,
              position: li,
              status: guessListStatus(l.name),
              cards: {
                create: l.cards.map((c, ci) => ({
                  ...initialStatusData(guessListStatus(l.name)),
                  title: c.title,
                  description: c.description === '' ? null : c.description,
                  position: ci,
                  startDate: c.startDate ? startInstant(c.startDate) : null,
                  dueDate: c.dueDate ? dueInstant(c.dueDate) : null,
                  ...(c.checklist.length > 0
                    ? {
                        checklists: {
                          create: { position: 0, items: { create: c.checklist.map((content, k) => ({ content, position: k })) } },
                        },
                      }
                    : {}),
                })),
              },
            })),
          },
        },
        include: {
          lists: { orderBy: { position: 'asc' }, include: { cards: { orderBy: { position: 'asc' }, select: { id: true } } } },
        },
      });

      // Nhan tao TUNG CAI (<= 10): createdAt cua cac ban ghi tao trong cung transaction
      // trung nhau nen khong the khop nhan voi key theo thu tu thoi gian.
      const labelIdByKey = new Map<string, string>();
      for (const l of labels) {
        const row = await tx.label.create({ data: { boardId: created.id, name: l.name, color: l.color }, select: { id: true } });
        labelIdByKey.set(l.key, row.id);
      }
      const links: Array<{ cardId: string; labelId: string }> = [];
      lists.forEach((l, li) =>
        l.cards.forEach((c, ci) => {
          for (const key of new Set(c.labelKeys)) {
            const labelId = labelIdByKey.get(key);
            if (labelId) links.push({ cardId: created.lists[li]!.cards[ci]!.id, labelId });
          }
        })
      );
      if (links.length > 0) await tx.cardLabel.createMany({ data: links });

      await tx.aiRun.update({
        where: { id: run.id },
        data: {
          boardId: created.id,
          appliedPlan: plan as unknown as Prisma.InputJsonValue,
          accepted: true,
          editCount,
        },
      });

      const { lists: _lists, ...record } = created;
      return record;
    },
    { timeout: 30_000, maxWait: 5_000 }
  );

  // ---- Sau COMMIT: tac dung phu. Loi o day KHONG duoc lam hong bang da tao thanh cong. ----
  try {
    await logActivity({ boardId: board.id, userId, type: 'ai.board.create', data: { cardCount, runId: run.id } });
  } catch {
    // bo qua: nhat ky chi la thong tin phu
  }

  return { board };
}
