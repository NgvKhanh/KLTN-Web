import { prisma } from '../../config/prisma';
import { emitToBoard } from '../../realtime/socket';
import { AppError } from '../../utils/AppError';
import { logActivity } from '../activity/activity.service';
import { assertBoardAccess, isBoardParticipant } from '../board/board.service';
import { notify } from '../notification/notification.service';
import { logStatusChange, reopenStatus, statusWrite } from '../card/cardStatus';
import type {
  CreateAutomationRuleInput,
  UpdateAutomationRuleInput,
} from './automation.schema';

const ACTIONS_INCLUDE = { actions: { orderBy: { position: 'asc' as const } } };

async function assertLabelOnBoard(labelId: string, boardId: string) {
  const label = await prisma.label.findUnique({
    where: { id: labelId },
    select: { boardId: true },
  });
  if (!label || label.boardId !== boardId) {
    throw new AppError('Nhan khong thuoc bang nay', 400);
  }
}

async function assertUserOnBoard(userId: string, boardId: string) {
  if (!(await isBoardParticipant(boardId, userId))) {
    throw new AppError('Nguoi dung khong phai thanh vien bang nay', 400);
  }
}

async function assertActionsValid(
  actions: CreateAutomationRuleInput['actions'],
  boardId: string
) {
  for (const a of actions) {
    if (a.type === 'ADD_LABEL' && a.labelId) {
      await assertLabelOnBoard(a.labelId, boardId);
    }
    if (a.type === 'ASSIGN_MEMBER' && a.userId) {
      await assertUserOnBoard(a.userId, boardId);
    }
  }
}

// ---------- CRUD ----------

export async function listAutomationRules(userId: string, boardId: string) {
  await assertBoardAccess(userId, boardId);
  return prisma.automationRule.findMany({
    where: { boardId },
    orderBy: { createdAt: 'desc' },
    include: ACTIONS_INCLUDE,
  });
}

export async function createAutomationRule(
  userId: string,
  boardId: string,
  input: CreateAutomationRuleInput
) {
  await assertBoardAccess(userId, boardId);

  if (input.triggerListId) {
    const list = await prisma.list.findFirst({
      where: { id: input.triggerListId, boardId, deletedAt: null },
      select: { id: true },
    });
    if (!list) throw new AppError('Danh sach khong thuoc bang nay', 400);
  }
  await assertActionsValid(input.actions, boardId);

  return prisma.automationRule.create({
    data: {
      boardId,
      createdById: userId,
      name: input.name,
      isEnabled: input.isEnabled ?? true,
      triggerType: input.triggerType,
      triggerListId: input.triggerListId ?? null,
      actions: {
        create: input.actions.map((a, i) => ({
          position: i,
          type: a.type,
          boolValue: a.boolValue ?? null,
          labelId: a.labelId ?? null,
          userId: a.userId ?? null,
        })),
      },
    },
    include: ACTIONS_INCLUDE,
  });
}

async function ruleOrThrow(ruleId: string) {
  const rule = await prisma.automationRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new AppError('Khong tim thay luat tu dong hoa', 404);
  return rule;
}

export async function updateAutomationRule(
  userId: string,
  ruleId: string,
  input: UpdateAutomationRuleInput
) {
  const rule = await ruleOrThrow(ruleId);
  await assertBoardAccess(userId, rule.boardId);

  const mergedTriggerType = input.triggerType ?? rule.triggerType;
  const mergedTriggerListId =
    input.triggerListId !== undefined ? input.triggerListId : rule.triggerListId;
  if (mergedTriggerType === 'CARD_MOVED_TO_LIST' && !mergedTriggerListId) {
    throw new AppError(
      'Can chon danh sach dich khi kich hoat theo "chuyen vao danh sach"',
      400
    );
  }
  if (mergedTriggerListId) {
    const list = await prisma.list.findFirst({
      where: { id: mergedTriggerListId, boardId: rule.boardId, deletedAt: null },
      select: { id: true },
    });
    if (!list) throw new AppError('Danh sach khong thuoc bang nay', 400);
  }
  if (input.actions) {
    await assertActionsValid(input.actions, rule.boardId);
  }

  return prisma.$transaction(async (tx) => {
    if (input.actions) {
      await tx.automationAction.deleteMany({ where: { ruleId } });
    }
    return tx.automationRule.update({
      where: { id: ruleId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.isEnabled !== undefined ? { isEnabled: input.isEnabled } : {}),
        ...(input.triggerType !== undefined ? { triggerType: input.triggerType } : {}),
        ...(input.triggerListId !== undefined
          ? { triggerListId: input.triggerListId }
          : {}),
        ...(input.actions
          ? {
              actions: {
                create: input.actions.map((a, i) => ({
                  position: i,
                  type: a.type,
                  boolValue: a.boolValue ?? null,
                  labelId: a.labelId ?? null,
                  userId: a.userId ?? null,
                })),
              },
            }
          : {}),
      },
      include: ACTIONS_INCLUDE,
    });
  });
}

export async function deleteAutomationRule(userId: string, ruleId: string) {
  const rule = await ruleOrThrow(ruleId);
  await assertBoardAccess(userId, rule.boardId);
  await prisma.automationRule.delete({ where: { id: ruleId } });
}

// ---------- Thuc thi khi co su kien ----------

type TriggerType = 'CARD_CREATED' | 'CARD_MOVED_TO_LIST';

// Goi tu card.service.ts sau khi tao/chuyen the. KHONG BAO GIO nem loi ra
// ngoai - 1 luat/hanh dong loi khong duoc lam hong thao tac chinh (tao/chuyen
// the) dang dien ra.
export async function runAutomationsForCard(
  trigger: TriggerType,
  cardId: string,
  cardTitle: string,
  boardId: string,
  listId: string
): Promise<void> {
  try {
    const rules = await prisma.automationRule.findMany({
      where: {
        boardId,
        isEnabled: true,
        triggerType: trigger,
        ...(trigger === 'CARD_CREATED'
          ? { OR: [{ triggerListId: null }, { triggerListId: listId }] }
          : { triggerListId: listId }),
      },
      include: ACTIONS_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });

    for (const rule of rules) {
      try {
        for (const action of rule.actions) {
          await runAction(rule.createdById, action, cardId, cardTitle, boardId);
        }
      } catch (err) {
        console.error(`[automation] luat "${rule.name}" (${rule.id}) chay loi:`, err);
      }
    }
  } catch (err) {
    console.error('[automation] loi khi tim luat tu dong hoa:', err);
  }
}

async function runAction(
  actorId: string,
  action: { type: string; boolValue: boolean | null; labelId: string | null; userId: string | null },
  cardId: string,
  cardTitle: string,
  boardId: string
): Promise<void> {
  if (action.type === 'SET_DONE') {
    // Danh dau xong = chuyen trang thai sang DONE; bo danh dau = "mo lai" (theo
    // cot neu cot co trang thai khac DONE, khong thi TODO). KHONG di chuyen the
    // (tu dong hoa khong bao gio di chuyen the - tranh vong lap giua cac luat).
    const isDone = action.boolValue ?? true;
    const card = await prisma.card.findUnique({
      where: { id: cardId },
      select: { status: true, list: { select: { status: true } } },
    });
    if (!card || (card.status === 'DONE') === isDone) return;
    const to = isDone ? 'DONE' : reopenStatus(card.list.status);
    // Ghi co dieu kien (giu bat bien status/isDone/completedAt); count = 0 nghia
    // la request khac vua doi xong truoc -> khong ghi nhat ky trung.
    const res = await statusWrite(
      prisma,
      isDone ? { id: cardId } : { id: cardId, status: 'DONE' },
      to
    );
    if (res.count === 0) return;
    await logStatusChange({
      boardId,
      cardId,
      cardTitle,
      userId: actorId,
      from: card.status,
      to,
      notifyDone: true,
    });
    emitToBoard(boardId, 'board:lists-changed');
    return;
  }

  if (action.type === 'ADD_LABEL' && action.labelId) {
    const label = await prisma.label.findUnique({ where: { id: action.labelId } });
    if (!label || label.boardId !== boardId) return; // nhan da bi xoa/doi bang tu luc tao luat
    await prisma.cardLabel.upsert({
      where: { cardId_labelId: { cardId, labelId: action.labelId } },
      create: { cardId, labelId: action.labelId },
      update: {},
    });
    emitToBoard(boardId, 'board:lists-changed');
    return;
  }

  if (action.type === 'ASSIGN_MEMBER' && action.userId) {
    if (!(await isBoardParticipant(boardId, action.userId))) return; // khong con la thanh vien bang
    await prisma.cardMember.upsert({
      where: { cardId_userId: { cardId, userId: action.userId } },
      create: { cardId, userId: action.userId, assignedById: actorId },
      update: {},
    });
    await logActivity({
      boardId,
      cardId,
      userId: actorId,
      type: 'member.add',
      data: { memberId: action.userId },
    });
    await notify({
      recipients: [action.userId],
      actorId,
      type: 'card.member.added',
      boardId,
      cardId,
      data: { cardTitle },
    });
    emitToBoard(boardId, 'board:lists-changed');
  }
}
