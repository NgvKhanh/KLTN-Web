import { prisma } from '../../config/prisma';
import { emitToBoard } from '../../realtime/socket';
import { AppError } from '../../utils/AppError';
import { assertBoardAccess, assertBoardView } from '../board/board.service';
import { assertCardAccess } from '../card/card.service';
import type {
  AddFieldOptionInput,
  CreateCustomFieldInput,
  SetCardFieldValueInput,
  UpdateCustomFieldInput,
  UpdateFieldOptionInput,
} from './customField.schema';

// ---------- Truong tuy chinh (pham vi 1 bang) ----------

export async function listCustomFields(userId: string, boardId: string) {
  await assertBoardView(userId, boardId);
  return prisma.customField.findMany({
    where: { boardId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: { options: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
  });
}

export async function createCustomField(
  userId: string,
  boardId: string,
  input: CreateCustomFieldInput
) {
  await assertBoardAccess(userId, boardId);

  const last = await prisma.customField.findFirst({
    where: { boardId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });

  const field = await prisma.customField.create({
    data: {
      boardId,
      name: input.name,
      type: input.type,
      position: last ? last.position + 1 : 0,
      ...(input.type === 'DROPDOWN' && input.options && input.options.length > 0
        ? {
            options: {
              create: input.options.map((o, i) => ({
                value: o.value,
                color: o.color ?? null,
                position: i,
              })),
            },
          }
        : {}),
    },
    include: { options: { orderBy: [{ position: 'asc' }, { id: 'asc' }] } },
  });
  emitToBoard(boardId, 'board:lists-changed');
  return field;
}

async function fieldOrThrow(fieldId: string) {
  const field = await prisma.customField.findUnique({ where: { id: fieldId } });
  if (!field) throw new AppError('Khong tim thay truong tuy chinh', 404);
  return field;
}

export async function updateCustomField(
  userId: string,
  fieldId: string,
  input: UpdateCustomFieldInput
) {
  const field = await fieldOrThrow(fieldId);
  await assertBoardAccess(userId, field.boardId);
  const updated = await prisma.customField.update({
    where: { id: fieldId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
    },
  });
  emitToBoard(field.boardId, 'board:lists-changed');
  return updated;
}

export async function deleteCustomField(userId: string, fieldId: string) {
  const field = await fieldOrThrow(fieldId);
  await assertBoardAccess(userId, field.boardId);
  await prisma.customField.delete({ where: { id: fieldId } });
  emitToBoard(field.boardId, 'board:lists-changed');
}

// ---------- Lua chon cho truong DROPDOWN ----------

export async function addFieldOption(
  userId: string,
  fieldId: string,
  input: AddFieldOptionInput
) {
  const field = await fieldOrThrow(fieldId);
  await assertBoardAccess(userId, field.boardId);
  if (field.type !== 'DROPDOWN') {
    throw new AppError('Chi truong kieu DROPDOWN moi co lua chon', 400);
  }
  const last = await prisma.customFieldOption.findFirst({
    where: { fieldId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  const option = await prisma.customFieldOption.create({
    data: {
      fieldId,
      value: input.value,
      color: input.color ?? null,
      position: last ? last.position + 1 : 0,
    },
  });
  emitToBoard(field.boardId, 'board:lists-changed');
  return option;
}

async function optionOrThrow(optionId: string) {
  const option = await prisma.customFieldOption.findUnique({
    where: { id: optionId },
    include: { field: true },
  });
  if (!option) throw new AppError('Khong tim thay lua chon', 404);
  return option;
}

export async function updateFieldOption(
  userId: string,
  optionId: string,
  input: UpdateFieldOptionInput
) {
  const option = await optionOrThrow(optionId);
  await assertBoardAccess(userId, option.field.boardId);
  const updated = await prisma.customFieldOption.update({
    where: { id: optionId },
    data: {
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
    },
  });
  emitToBoard(option.field.boardId, 'board:lists-changed');
  return updated;
}

export async function deleteFieldOption(userId: string, optionId: string) {
  const option = await optionOrThrow(optionId);
  await assertBoardAccess(userId, option.field.boardId);
  await prisma.customFieldOption.delete({ where: { id: optionId } });
  emitToBoard(option.field.boardId, 'board:lists-changed');
}

// ---------- Gia tri truen 1 the ----------

// Doi gia tri tho (khong ro kieu, tu JSON body) thanh cot phu hop voi
// CustomField.type; nem loi 400 neu kieu khong khop.
function valueColumnFor(
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'CHECKBOX' | 'DROPDOWN',
  value: string | number | boolean | null
) {
  if (value === null) {
    return { textValue: null, numberValue: null, dateValue: null, boolValue: null, optionId: null };
  }
  switch (type) {
    case 'TEXT':
      if (typeof value !== 'string') throw new AppError('Gia tri phai la chuoi', 400);
      return { textValue: value.slice(0, 2000), numberValue: null, dateValue: null, boolValue: null, optionId: null };
    case 'NUMBER':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new AppError('Gia tri phai la so', 400);
      }
      return { textValue: null, numberValue: value, dateValue: null, boolValue: null, optionId: null };
    case 'DATE': {
      if (typeof value !== 'string') throw new AppError('Gia tri phai la ngay (ISO string)', 400);
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) throw new AppError('Ngay khong hop le', 400);
      return { textValue: null, numberValue: null, dateValue: d, boolValue: null, optionId: null };
    }
    case 'CHECKBOX':
      if (typeof value !== 'boolean') throw new AppError('Gia tri phai la true/false', 400);
      return { textValue: null, numberValue: null, dateValue: null, boolValue: value, optionId: null };
    case 'DROPDOWN':
      if (typeof value !== 'string') throw new AppError('Gia tri phai la ma lua chon', 400);
      return { textValue: null, numberValue: null, dateValue: null, boolValue: null, optionId: value };
  }
}

export async function setCardFieldValue(
  userId: string,
  cardId: string,
  fieldId: string,
  input: SetCardFieldValueInput
) {
  const card = await assertCardAccess(userId, cardId);
  const field = await fieldOrThrow(fieldId);
  if (field.boardId !== card.list.boardId) {
    throw new AppError('Truong tuy chinh khong thuoc bang cua the nay', 400);
  }

  if (input.value === null) {
    await prisma.cardFieldValue.deleteMany({ where: { cardId, fieldId } });
    emitToBoard(field.boardId, 'board:lists-changed');
    return null;
  }

  const cols = valueColumnFor(field.type, input.value);

  if (field.type === 'DROPDOWN' && cols.optionId) {
    const option = await prisma.customFieldOption.findUnique({
      where: { id: cols.optionId },
    });
    if (!option || option.fieldId !== fieldId) {
      throw new AppError('Lua chon khong hop le', 400);
    }
  }

  const value = await prisma.cardFieldValue.upsert({
    where: { cardId_fieldId: { cardId, fieldId } },
    create: { cardId, fieldId, ...cols },
    update: cols,
  });
  emitToBoard(field.boardId, 'board:lists-changed');
  return value;
}
