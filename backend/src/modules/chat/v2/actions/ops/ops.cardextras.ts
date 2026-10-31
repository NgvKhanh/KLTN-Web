// BUOC H - MO RONG THE: gia tri truong tuy chinh, nhac han, theo doi (the / cot / bang), the mau (tao the tu mau, luu the lam mau).
// Ghi giong het service giao dien: customField.service.setCardFieldValue, cardReminder.service, watch.service, cardTemplate.service.

import { prisma } from '../../../../../config/prisma';
import { extractDatesFromLine } from '../../../../ai/ai.rules';
import { vnToday } from '../../../chat.period';
import { initialStatusData } from '../../../../card/cardStatus';
import { REMINDER_OFFSETS } from '../../../../card/card.schema';
import { fail, NO_CHANGE } from '../actions.guard.base';
import { CREATE_VERBS, foldWords, hasAny, indexesOfAny, stripLeadingGeneric } from '../actions.text';
import type { GuardVerdict, StoredOp } from '../actions.types';
import { cardOf, PlanAbort, record, type OpOutcome } from '../actions.write.base';
import { chooseFrom, clip, q, type PoolItem } from './ops.common';
import { defineOp, isOpResult, type AnyHandler, type GuardCtx, type OpResolveResult, type ResolveCtx } from './ops.types';
import { mentions, ownTexts, verbThen } from './ops.words';

const REMOVE_ANY = [['bo'], ['xoa'], ['huy'], ['go'], ['tat']] as const;

const cardGuard = async (g: GuardCtx, op: StoredOp): Promise<GuardVerdict> => (op.ids.card === undefined ? fail('INVALID', `Thiếu thẻ cần thao tác. ${NO_CHANGE}`) : g.card(op.ids.card));

function allIn(texts: ReadonlyArray<string | undefined>, words: readonly string[]): boolean {
  const have = new Set(words);
  return texts.every((t) => t === undefined || foldWords(t).every((w) => have.has(w)));
}

async function existingCard(rc: ResolveCtx, ref: Parameters<ResolveCtx['h']['cardTarget']>[0], doing: string) {
  const target = await rc.h.cardTarget(ref);
  if (isOpResult(target)) return target;
  if (target.local !== undefined || target.row === null || target.ids.card === undefined) {
    return { kind: 'FAIL', code: 'INVALID', text: `Thẻ mới tạo trong cùng lệnh chưa có gì để ${doing}. Chưa thay đổi gì.` } satisfies OpResolveResult;
  }
  return { ...target, ids: { card: target.ids.card }, row: target.row };
}

const done = (index: number, text: string, extra: Partial<OpOutcome> = {}): OpOutcome => ({ index, text, changed: true, ...extra });

// ---------------------------------------------------------------------------------------------------------------------
// Truong tuy chinh
// ---------------------------------------------------------------------------------------------------------------------

type FieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'CHECKBOX' | 'DROPDOWN';
interface FieldRow {
  id: string;
  name: string;
  type: FieldType;
  options: { id: string; value: string }[];
}
const TRUE_WORDS = ['true', 'co', 'bat', 'tick', 'xong', 'yes', 'dung', '1', 'check', 'danh'];
const FALSE_WORDS = ['false', 'khong', 'tat', 'bo', 'no', 'sai', '0', 'uncheck', 'chua'];

/** Doc gia tri nguoi dung noi thanh gia tri that cua cot theo kieu truong; null = khong doc duoc. */
function parseFieldValue(type: FieldType, raw: string, today: string): { text?: string; number?: number; date?: Date; bool?: boolean } | null {
  const value = raw.trim();
  switch (type) {
    case 'TEXT':
      return value === '' ? null : { text: value.slice(0, 2000) };
    case 'NUMBER': {
      const n = Number(value.replace(/\s+/g, '').replace(',', '.'));
      return Number.isFinite(n) && value !== '' ? { number: n } : null;
    }
    case 'CHECKBOX': {
      const words = foldWords(value);
      if (words.some((w) => TRUE_WORDS.includes(w)) && !words.some((w) => FALSE_WORDS.includes(w))) return { bool: true };
      if (words.some((w) => FALSE_WORDS.includes(w))) return { bool: false };
      return null;
    }
    case 'DATE': {
      const found = extractDatesFromLine(value, today)[0];
      return found ? { date: new Date(`${found.date}T00:00:00.000Z`) } : null;
    }
    case 'DROPDOWN':
      return value === '' ? null : { text: value };
  }
}

const setFieldValue = defineOp<'SET_FIELD_VALUE'>({
  type: 'SET_FIELD_VALUE',
  label: 'đặt giá trị trường tùy chỉnh',
  policy: {
    autoRun: true,
    confirm: [],
    // truong van ban tu do la noi dung nguoi khac se doc -> xem truoc; con lai (so, ngay, chon, tick) chinh xac -> tu chay
    confirmFor: (op) => (op.params.fieldType === 'TEXT' && op.params.clear !== true ? ['TEXT_CONTENT'] : []),
  },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence(words, op) {
    const verbs = [['dat'], ['doi'], ['dien'], ['chon'], ['cap', 'nhat'], ['sua'], ['gan'], ['set'], ['ghi'], ['nhap'], ['bo'], ['xoa'], ['tick'], ['danh', 'dau']] as const;
    const named = foldWords(op.field);
    const fieldAt = named.length > 0 ? indexesOfAny(words, [named]) : [];
    return indexesOfAny(words, verbs).filter((v) => fieldAt.some((n) => n > v && n - v <= 6));
  },
  // ten truong, gia tri (khong tu nghi) phai co trong cau; kiem tra theo kieu truong o buoc phan giai (grounding theo kieu)
  // ten truong phai co trong cau; gia tri (khi la chuoi / so / lua chon) cung phai la chu nguoi dung go; so phai la mot so trong cau
  grounded(op, words) {
    if (!allIn([op.field], words)) return false;
    if (op.clear === true || op.value === undefined) return true;
    const v = op.value.trim();
    const looksNumber = /^-?d+(?:[.,]d+)?$/.test(v);
    return looksNumber ? words.some((w) => w === v.replace(',', '.') || w === v.split(/[.,]/)[0]) : foldWords(v).every((w) => words.includes(w)) || foldWords(v).length === 0;
  },
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'đặt giá trị');
    if ('kind' in card) return card;
    const fields: FieldRow[] = (
      await prisma.customField.findMany({
        where: { boardId: rc.h.boardId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, type: true, options: { orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { id: true, value: true } } },
      })
    ).map((f) => ({ id: f.id, name: f.name, type: f.type as FieldType, options: f.options }));
    if (fields.length === 0) return { kind: 'FAIL', code: 'NOT_FOUND', text: 'Bảng này chưa có trường tùy chỉnh nào. Chưa thay đổi gì.' };
    const pool: PoolItem[] = fields.map((f) => ({ id: f.id, name: f.name }));
    const hit = chooseFrom({ rc, kind: 'field', scope: rc.h.boardId, text: stripLeadingGeneric(op.field), pool, where: ' của bảng' });
    if ('kind' in hit) return hit;
    const field = fields.find((f) => f.id === hit.id) as FieldRow;
    const current = await prisma.cardFieldValue.findUnique({ where: { cardId_fieldId: { cardId: card.ids.card, fieldId: field.id } } });
    const currentKey = current ? JSON.stringify([current.textValue, current.numberValue, current.dateValue?.toISOString() ?? null, current.boolValue, current.optionId]) : null;

    if (op.clear === true) {
      return rc.ok({
        type: 'SET_FIELD_VALUE',
        ids: { card: card.ids.card, field: field.id },
        params: { fieldType: field.type, clear: true },
        before: { key: currentKey },
        display: { cardTitle: card.title, fieldName: field.name },
        ...(current === null ? { noop: `Thẻ ${q(card.title)} chưa có giá trị cho trường ${q(field.name)} nên không cần xóa.` } : {}),
      });
    }
    if (op.value === undefined || op.value.trim() === '') return { kind: 'FAIL', code: 'INVALID', text: `Cần nói rõ giá trị của trường ${q(field.name)}. Chưa thay đổi gì.` };
    const parsed = parseFieldValue(field.type, op.value, vnToday(rc.h.now));
    if (parsed === null) return { kind: 'FAIL', code: 'INVALID', text: `Giá trị “${op.value}” không hợp lệ cho trường ${q(field.name)} (kiểu ${TYPE_VI[field.type]}). Chưa thay đổi gì.` };

    let optionId: string | null = null;
    let shown = op.value.trim();
    if (field.type === 'DROPDOWN') {
      const options: PoolItem[] = field.options.map((o) => ({ id: o.id, name: o.value }));
      const pick = chooseFrom({ rc, kind: 'option', scope: field.id, text: stripLeadingGeneric(op.value), pool: options, where: ` của trường ${q(field.name)}` });
      if ('kind' in pick) return pick;
      optionId = pick.id;
      shown = pick.name;
    }
    const value = field.type === 'NUMBER' ? parsed.number : field.type === 'CHECKBOX' ? parsed.bool : field.type === 'DATE' ? parsed.date?.toISOString() : optionId ?? parsed.text;
    const next = JSON.stringify([
      field.type === 'TEXT' ? (parsed.text ?? null) : null,
      field.type === 'NUMBER' ? (parsed.number ?? null) : null,
      field.type === 'DATE' ? (parsed.date?.toISOString() ?? null) : null,
      field.type === 'CHECKBOX' ? (parsed.bool ?? null) : null,
      field.type === 'DROPDOWN' ? optionId : null,
    ]);
    return rc.ok({
      type: 'SET_FIELD_VALUE',
      ids: { card: card.ids.card, field: field.id },
      params: { fieldType: field.type, value: value ?? null, shown },
      before: { key: currentKey },
      display: { cardTitle: card.title, fieldName: field.name, shown },
      ...(currentKey === next ? { noop: `Trường ${q(field.name)} của thẻ ${q(card.title)} đã là ${q(shown)} rồi.` } : {}),
    });
  },
  async guard(g, op) {
    const base = await cardGuard(g, op);
    if (!base.ok) return base;
    const field = op.ids.field === undefined ? null : await prisma.customField.findFirst({ where: { id: op.ids.field, boardId: g.boardId }, select: { type: true } });
    return field ? { ok: true } : fail('NOT_FOUND', `Trường tùy chỉnh này không còn thuộc bảng. ${NO_CHANGE}`);
  },
  async verify(tx, _ctx, op) {
    const field = await tx.customField.findFirst({ where: { id: op.ids.field }, select: { type: true } });
    if (!field) throw new PlanAbort('STALE', 'Trường tùy chỉnh không còn trong bảng.');
    const current = await tx.cardFieldValue.findUnique({ where: { cardId_fieldId: { cardId: op.ids.card as string, fieldId: op.ids.field as string } } });
    const key = current ? JSON.stringify([current.textValue, current.numberValue, current.dateValue?.toISOString() ?? null, current.boolValue, current.optionId]) : null;
    if (key !== (op.before?.key ?? null)) throw new PlanAbort('STALE', 'Giá trị trường của thẻ đã thay đổi kể từ lúc xem trước.');
    if (op.params.fieldType === 'DROPDOWN' && op.params.clear !== true) {
      const option = await tx.customFieldOption.findFirst({ where: { id: String(op.params.value), fieldId: op.ids.field as string }, select: { id: true } });
      if (!option) throw new PlanAbort('STALE', 'Lựa chọn của trường không còn tồn tại.');
    }
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong setCardFieldValue: null -> xoa gia tri; con lai upsert dung cot theo kieu truong
    const card = cardOf(state, op);
    const cardId = card.id;
    const fieldId = op.ids.field as string;
    if (op.params.clear === true) {
      await tx.cardFieldValue.deleteMany({ where: { cardId, fieldId } });
    } else {
      const type = op.params.fieldType as FieldType;
      const v = op.params.value;
      const cols = {
        textValue: type === 'TEXT' ? String(v) : null,
        numberValue: type === 'NUMBER' ? Number(v) : null,
        dateValue: type === 'DATE' ? new Date(String(v)) : null,
        boolValue: type === 'CHECKBOX' ? v === true : null,
        optionId: type === 'DROPDOWN' ? String(v) : null,
      };
      await tx.cardFieldValue.upsert({ where: { cardId_fieldId: { cardId, fieldId } }, create: { cardId, fieldId, ...cols }, update: cols });
    }
    effects.boardIds.add(ctx.boardId);
    return done(index, op.params.clear === true ? `Đã xóa giá trị trường ${q(op.display.fieldName as string)} của thẻ ${q(card.title)}.` : `Đã đặt trường ${q(op.display.fieldName as string)} của thẻ ${q(card.title)} thành ${q(op.display.shown as string)}.`, { cardId });
  },
  describe: (op, index) => ({
    index,
    verb: op.params.clear === true ? 'Xóa giá trị trường' : 'Đặt giá trị trường',
    text: `${q(op.display.fieldName as string)} của thẻ ${q(op.display.cardTitle)}`,
    ...(op.params.clear === true ? {} : { detail: clip(String(op.display.shown ?? ''), 300) }),
    cardId: op.ids.card,
  }),
  summary: (op) => (op.params.clear === true ? `Đã xóa giá trị trường ${q(op.display.fieldName as string)}.` : `Đã đặt trường ${q(op.display.fieldName as string)} thành ${q(op.display.shown as string)}.`),
  stale: 'Giá trị trường của thẻ đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `field:${op.ids.card}:${op.ids.field}`, effect: 'MODIFY' }],
});

const TYPE_VI: Record<FieldType, string> = { TEXT: 'văn bản', NUMBER: 'số', DATE: 'ngày', CHECKBOX: 'hộp kiểm', DROPDOWN: 'danh sách chọn' };

// ---------------------------------------------------------------------------------------------------------------------
// Nhac han
// ---------------------------------------------------------------------------------------------------------------------

const REMINDER_CUES: Record<number, readonly (readonly string[])[]> = {
  10: [['10', 'phut'], ['muoi', 'phut']],
  60: [['1', 'gio'], ['mot', 'gio'], ['60', 'phut']],
  1440: [['1', 'ngay'], ['mot', 'ngay'], ['24', 'gio'], ['hai', 'muoi', 'bon', 'gio']],
};
const REMINDER_TEXT: Record<number, string> = { 10: '10 phút', 60: '1 giờ', 1440: '1 ngày' };

const addReminder = defineOp<'ADD_REMINDER'>({
  type: 'ADD_REMINDER',
  label: 'đặt nhắc hạn cho thẻ',
  policy: { autoRun: true, confirm: [] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence: (words) => (mentions(words, [['nhac']]) ? indexesOfAny(words, [['nhac'], ['dat'], ['hen'], ['bao']]) : []),
  grounded: (op, words) => hasAny(words, REMINDER_CUES[op.minutes] ?? []),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'đặt nhắc');
    if ('kind' in card) return card;
    if (card.row.dueDate === null) return { kind: 'FAIL', code: 'INVALID', text: `Thẻ ${q(card.title)} chưa có hạn nên chưa đặt nhắc được. Hãy đặt hạn trước. Chưa thay đổi gì.` };
    const exists = await prisma.cardReminder.findUnique({ where: { cardId_userId_offsetMinutes: { cardId: card.ids.card, userId: rc.h.userId, offsetMinutes: op.minutes } } });
    return rc.ok({
      type: 'ADD_REMINDER',
      ids: { card: card.ids.card },
      params: { minutes: op.minutes },
      before: { exists: exists !== null },
      display: { cardTitle: card.title, when: REMINDER_TEXT[op.minutes] },
      ...(exists !== null ? { noop: `Bạn đã đặt nhắc ${REMINDER_TEXT[op.minutes]} trước hạn cho thẻ ${q(card.title)} rồi.` } : {}),
    });
  },
  async guard(g, op) {
    const base = await cardGuard(g, op);
    if (!base.ok) return base;
    return (REMINDER_OFFSETS as readonly number[]).includes(Number(op.params.minutes)) ? { ok: true } : fail('INVALID', `Mức nhắc không hợp lệ. ${NO_CHANGE}`);
  },
  async verify(tx, _ctx, op) {
    const card = await tx.card.findFirst({ where: { id: op.ids.card }, select: { dueDate: true } });
    if (!card?.dueDate) throw new PlanAbort('STALE', 'Thẻ không còn hạn nên không đặt nhắc được.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong addCardReminder: upsert theo (the, nguoi dung, muc nhac)
    const card = cardOf(state, op);
    const offsetMinutes = Number(op.params.minutes);
    await tx.cardReminder.upsert({ where: { cardId_userId_offsetMinutes: { cardId: card.id, userId: ctx.userId, offsetMinutes } }, create: { cardId: card.id, userId: ctx.userId, offsetMinutes }, update: {} });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã đặt nhắc ${REMINDER_TEXT[offsetMinutes]} trước hạn cho thẻ ${q(card.title)}.`, { cardId: card.id });
  },
  describe: (op, index) => ({ index, verb: 'Đặt nhắc hạn', text: `${q(op.display.cardTitle)}: nhắc ${op.display.when as string} trước hạn`, cardId: op.ids.card }),
  summary: (op) => `Đã đặt nhắc ${op.display.when as string} trước hạn cho thẻ ${q(op.display.cardTitle)}.`,
  stale: 'Thẻ đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `reminder:${op.ids.card}:${op.params.minutes}`, effect: 'MODIFY' }],
});

const removeReminder = defineOp<'REMOVE_REMINDER'>({
  type: 'REMOVE_REMINDER',
  label: 'bỏ nhắc hạn của thẻ',
  policy: { autoRun: true, confirm: [] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence: (words) => (mentions(words, [['nhac']]) ? indexesOfAny(words, REMOVE_ANY) : []),
  grounded: (op, words) => (op.minutes === undefined ? true : hasAny(words, REMINDER_CUES[op.minutes] ?? [])),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'bỏ nhắc');
    if ('kind' in card) return card;
    const mine = await prisma.cardReminder.findMany({ where: { cardId: card.ids.card, userId: rc.h.userId }, orderBy: { offsetMinutes: 'asc' }, select: { offsetMinutes: true } });
    const wanted = op.minutes === undefined ? mine.map((m) => m.offsetMinutes) : mine.filter((m) => m.offsetMinutes === op.minutes).map((m) => m.offsetMinutes);
    return rc.ok({
      type: 'REMOVE_REMINDER',
      ids: { card: card.ids.card },
      params: { minutes: op.minutes ?? null },
      before: { offsets: wanted },
      display: { cardTitle: card.title, when: wanted.map((m) => REMINDER_TEXT[m] ?? `${m} phút`).join(', ') },
      ...(wanted.length === 0 ? { noop: `Bạn chưa đặt nhắc hạn nào cho thẻ ${q(card.title)} nên chưa cần bỏ.` } : {}),
    });
  },
  guard: (g, op) => cardGuard(g, op),
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong removeCardReminder: chi nhac cua CHINH nguoi dung
    const card = cardOf(state, op);
    const offsets = ((op.before?.offsets ?? []) as number[]) ?? [];
    await tx.cardReminder.deleteMany({ where: { cardId: card.id, userId: ctx.userId, offsetMinutes: { in: offsets } } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã bỏ nhắc hạn của thẻ ${q(card.title)}.`, { cardId: card.id });
  },
  describe: (op, index) => ({ index, verb: 'Bỏ nhắc hạn', text: `${q(op.display.cardTitle)}${op.display.when ? ` (${op.display.when as string})` : ''}`, cardId: op.ids.card }),
  summary: (op) => `Đã bỏ nhắc hạn của thẻ ${q(op.display.cardTitle)}.`,
  stale: 'Thẻ đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `reminder:${op.ids.card}:${op.params.minutes ?? 'all'}`, effect: 'MODIFY' }],
});

// ---------------------------------------------------------------------------------------------------------------------
// Theo doi
// ---------------------------------------------------------------------------------------------------------------------

const setWatch = defineOp<'SET_WATCH'>({
  type: 'SET_WATCH',
  label: 'theo dõi hoặc bỏ theo dõi',
  policy: { autoRun: true, confirm: [] },
  slots: (op) => {
    if (op.target === 'CARD' && op.card !== undefined) return [{ name: 'card', kind: 'card', ref: op.card }];
    if (op.target === 'LIST' && op.list !== undefined) return [{ name: 'list', kind: 'list', ref: op.list }];
    return [];
  },
  withRef: (op, name, ref) => (name === 'card' && op.card !== undefined ? { ...op, card: ref } : name === 'list' && op.list !== undefined ? { ...op, list: ref } : op),
  licence(words, op) {
    const watch = [['theo', 'doi'], ['watch'], ['follow'], ['nhan', 'thong', 'bao']] as const;
    const unwatch = [['bo', 'theo', 'doi'], ['huy', 'theo', 'doi'], ['ngung', 'theo', 'doi'], ['unwatch'], ['unfollow'], ['thoi', 'theo', 'doi'], ['khong', 'theo', 'doi'], ['tat', 'theo', 'doi']] as const;
    if (op.watch === false) return indexesOfAny(words, unwatch);
    return mentions(words, unwatch) ? [] : indexesOfAny(words, watch);
  },
  async resolve(rc, op) {
    const watch = op.watch !== false;
    if (op.target === 'CARD') {
      if (op.card === undefined) return { kind: 'FAIL', code: 'INVALID', text: 'Hãy nói rõ theo dõi thẻ nào. Chưa thay đổi gì.' };
      const card = await existingCard(rc, op.card, 'theo dõi');
      if ('kind' in card) return card;
      const on = (await prisma.watch.count({ where: { userId: rc.h.userId, cardId: card.ids.card } })) > 0;
      return rc.ok({
        type: 'SET_WATCH',
        ids: { card: card.ids.card },
        params: { target: 'CARD', watch },
        before: { on },
        display: { targetName: card.title, targetKind: 'thẻ' },
        ...(on === watch ? { noop: watch ? `Bạn đang theo dõi thẻ ${q(card.title)} rồi.` : `Bạn chưa theo dõi thẻ ${q(card.title)} nên chưa cần bỏ.` } : {}),
      });
    }
    if (op.target === 'LIST') {
      if (op.list === undefined) return { kind: 'FAIL', code: 'INVALID', text: 'Hãy nói rõ theo dõi cột nào. Chưa thay đổi gì.' };
      const target = await rc.h.listTarget(op.list);
      if (isOpResult(target)) return target;
      if (target.ids.list === undefined) return { kind: 'FAIL', code: 'INVALID', text: 'Cột mới tạo trong cùng lệnh chưa theo dõi được. Chưa thay đổi gì.' };
      const on = (await prisma.watch.count({ where: { userId: rc.h.userId, listId: target.ids.list } })) > 0;
      return rc.ok({
        type: 'SET_WATCH',
        ids: { list: target.ids.list },
        params: { target: 'LIST', watch },
        before: { on },
        display: { targetName: target.name, targetKind: 'cột' },
        ...(on === watch ? { noop: watch ? `Bạn đang theo dõi cột ${q(target.name)} rồi.` : `Bạn chưa theo dõi cột ${q(target.name)} nên chưa cần bỏ.` } : {}),
      });
    }
    const board = await prisma.board.findUnique({ where: { id: rc.h.boardId }, select: { name: true } });
    const on = (await prisma.watch.count({ where: { userId: rc.h.userId, boardId: rc.h.boardId } })) > 0;
    return rc.ok({
      type: 'SET_WATCH',
      ids: {},
      params: { target: 'BOARD', watch },
      before: { on },
      display: { targetName: board?.name ?? '', targetKind: 'bảng' },
      ...(on === watch ? { noop: watch ? `Bạn đang theo dõi bảng ${q(board?.name)} rồi.` : `Bạn chưa theo dõi bảng ${q(board?.name)} nên chưa cần bỏ.` } : {}),
    });
  },
  async guard(g, op) {
    if (op.params.target === 'CARD') return cardGuard(g, op);
    if (op.params.target === 'LIST') {
      const row = op.ids.list === undefined ? null : await prisma.list.findFirst({ where: { id: op.ids.list, boardId: g.boardId, deletedAt: null, archivedAt: null }, select: { id: true } });
      return row ? { ok: true } : fail('NOT_FOUND', `Cột này không còn trong bảng. ${NO_CHANGE}`);
    }
    return { ok: true };
  },
  async apply({ tx, ctx, state, index }, op) {
    // giong setCardWatch / setListWatch / setBoardWatch: upsert hoac xoa dong Watch cua chinh nguoi dung
    const watch = op.params.watch === true;
    const target = String(op.params.target);
    const userId = ctx.userId;
    let outcome: Partial<OpOutcome> = {};
    if (target === 'CARD') {
      const card = cardOf(state, op);
      if (watch) await tx.watch.upsert({ where: { userId_cardId: { userId, cardId: card.id } }, create: { userId, cardId: card.id }, update: {} });
      else await tx.watch.deleteMany({ where: { userId, cardId: card.id } });
      outcome = { cardId: card.id };
    } else if (target === 'LIST') {
      const listId = op.ids.list as string;
      if (watch) await tx.watch.upsert({ where: { userId_listId: { userId, listId } }, create: { userId, listId }, update: {} });
      else await tx.watch.deleteMany({ where: { userId, listId } });
      outcome = { listId };
    } else {
      const boardId = ctx.boardId;
      if (watch) await tx.watch.upsert({ where: { userId_boardId: { userId, boardId } }, create: { userId, boardId }, update: {} });
      else await tx.watch.deleteMany({ where: { userId, boardId } });
    }
    return done(index, `${watch ? 'Đã bật theo dõi' : 'Đã bỏ theo dõi'} ${op.display.targetKind as string} ${q(op.display.targetName as string)}.`, outcome);
  },
  describe: (op, index) => ({ index, verb: op.params.watch === true ? 'Theo dõi' : 'Bỏ theo dõi', text: `${op.display.targetKind as string} ${q(op.display.targetName as string)}`, cardId: op.ids.card }),
  summary: (op) => `${op.params.watch === true ? 'Đã bật theo dõi' : 'Đã bỏ theo dõi'} ${op.display.targetKind as string} ${q(op.display.targetName as string)}.`,
  stale: 'Trạng thái theo dõi đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `watch:${op.params.target}:${op.ids.card ?? op.ids.list ?? 'board'}`, effect: 'MODIFY' }],
});

// ---------------------------------------------------------------------------------------------------------------------
// The mau
// ---------------------------------------------------------------------------------------------------------------------

const TEMPLATE_N = [['mau'], ['the', 'mau'], ['template'], ['mau', 'the']] as const;

const fromTemplate = defineOp<'CREATE_CARD_FROM_TEMPLATE'>({
  type: 'CREATE_CARD_FROM_TEMPLATE',
  label: 'tạo thẻ từ thẻ mẫu',
  policy: { autoRun: true, confirm: [] },
  slots: (op) => (op.list !== undefined ? [{ name: 'list', kind: 'list', ref: op.list }] : []),
  withRef: (op, name, ref) => (name === 'list' && op.list !== undefined ? { ...op, list: ref } : op),
  // "tao the TEN tu mau X": ten the nguoi dung dat (title) co the chen giua dong tu va danh tu "mau"
  licence: (words, op) => verbThen(words, [...CREATE_VERBS, ['dung'], ['ap', 'dung'], ['su', 'dung'], ['lay']], [...TEMPLATE_N], [], 8, ['tu', 'theo', 'the', 'moi', ...(op.title !== undefined ? foldWords(op.title) : [])]),
  grounded: (op, words) => allIn([op.template, op.title], words),
  async resolve(rc, op) {
    const templates = await prisma.cardTemplate.findMany({ where: { boardId: rc.h.boardId }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true } });
    if (templates.length === 0) return { kind: 'FAIL', code: 'NOT_FOUND', text: 'Bảng này chưa có thẻ mẫu nào. Chưa thay đổi gì.' };
    const hit = chooseFrom({ rc, kind: 'template', scope: rc.h.boardId, text: stripLeadingGeneric(op.template), pool: templates.map((t) => ({ id: t.id, name: t.name })), where: ' của bảng' });
    if ('kind' in hit) return hit;
    const list = await rc.h.listTarget(op.list);
    if (isOpResult(list)) return list;
    if (list.ids.list === undefined) return { kind: 'FAIL', code: 'INVALID', text: 'Hãy nói rõ cột có sẵn để tạo thẻ. Chưa thay đổi gì.' };
    const title = (op.title?.trim() || hit.name).slice(0, 500);
    return rc.ok({
      type: 'CREATE_CARD_FROM_TEMPLATE',
      ids: { list: list.ids.list, template: hit.id },
      params: { title },
      before: { templateName: hit.name },
      display: { listName: list.name, templateName: hit.name, newTitle: title },
    });
  },
  async guard(g, op) {
    const list = op.ids.list === undefined ? null : await prisma.list.findFirst({ where: { id: op.ids.list, boardId: g.boardId, deletedAt: null, archivedAt: null }, select: { id: true } });
    if (!list) return fail('NOT_FOUND', `Cột này không còn trong bảng. ${NO_CHANGE}`);
    const tpl = op.ids.template === undefined ? null : await prisma.cardTemplate.findFirst({ where: { id: op.ids.template, boardId: g.boardId }, select: { id: true } });
    return tpl ? { ok: true } : fail('NOT_FOUND', `Thẻ mẫu này không còn trong bảng. ${NO_CHANGE}`);
  },
  async verify(tx, ctx, op) {
    const tpl = await tx.cardTemplate.findFirst({ where: { id: op.ids.template, boardId: ctx.boardId }, select: { name: true } });
    if (!tpl) throw new PlanAbort('STALE', 'Thẻ mẫu không còn trong bảng.');
    if (tpl.name !== op.before?.templateName) throw new PlanAbort('STALE', 'Thẻ mẫu đã được đổi kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong applyCardTemplate: the moi o cuoi cot, mo ta + checklist lay tu mau, Activity card.create, tu dong hoa CARD_CREATED sau commit
    const listId = op.ids.list as string;
    const list = await tx.list.findFirst({ where: { id: listId, boardId: ctx.boardId, deletedAt: null, archivedAt: null }, select: { id: true, name: true, status: true } });
    if (!list) throw new PlanAbort('STALE', 'Cột không còn trong bảng.');
    const tpl = await tx.cardTemplate.findFirst({
      where: { id: op.ids.template, boardId: ctx.boardId },
      include: { checklists: { orderBy: { position: 'asc' }, include: { items: { orderBy: { position: 'asc' } } } } },
    });
    if (!tpl) throw new PlanAbort('STALE', 'Thẻ mẫu không còn trong bảng.');
    const last = await tx.card.findFirst({ where: { listId, deletedAt: null, archivedAt: null }, orderBy: { position: 'desc' }, select: { position: true } });
    const card = await tx.card.create({
      data: {
        listId,
        title: String(op.params.title),
        description: tpl.description,
        position: last ? last.position + 1 : 0,
        ...initialStatusData(list.status),
        checklists: { create: tpl.checklists.map((cl, i) => ({ title: cl.title, position: i, items: { create: cl.items.map((it, j) => ({ content: it.content, position: j })) } })) },
      },
    });
    await record(tx, ctx, state, effects, { cardId: card.id, type: 'card.create', data: { listName: list.name } });
    effects.automations.push({ trigger: 'CARD_CREATED', cardId: card.id, cardTitle: card.title, boardId: ctx.boardId, listId });
    state.cards.set(card.id, { id: card.id, title: card.title, dueDate: null, status: card.status, listId, listName: list.name, listStatus: list.status });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã tạo thẻ ${q(card.title)} từ thẻ mẫu ${q(tpl.name)} trong cột ${q(list.name)}.`, { cardId: card.id, listId });
  },
  describe: (op, index) => ({ index, verb: 'Tạo thẻ từ mẫu', text: `${q(op.display.newTitle as string)} trong cột ${q(op.display.listName)}`, detail: `Theo thẻ mẫu ${q(op.display.templateName as string)} (kèm mô tả và checklist của mẫu).` }),
  summary: (op) => `Đã tạo thẻ ${q(op.display.newTitle as string)} từ thẻ mẫu.`,
  stale: 'Thẻ mẫu hoặc cột đã thay đổi kể từ lúc xem trước.',
});

const saveTemplate = defineOp<'SAVE_CARD_AS_TEMPLATE'>({
  type: 'SAVE_CARD_AS_TEMPLATE',
  label: 'lưu thẻ làm thẻ mẫu',
  policy: { autoRun: false, confirm: ['NEW_STRUCTURE'] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  // "luu the LOGIN UI lam the mau": cau phai nhac toi mau VA dong tu luu / tao di cung the (danh tu the hoac chinh ten the)
  licence: (words, op) => (mentions(words, TEMPLATE_N) ? verbThen(words, [['luu'], ['tao'], ['dat'], ['bien'], ['chuyen']], [['the'], ['card'], ['task']], ownTexts(op.card), 4) : []),
  grounded: (op, words) => allIn([op.name], words),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'lưu làm mẫu');
    if ('kind' in card) return card;
    const name = (op.name?.trim() || card.title).slice(0, 100);
    return rc.ok({ type: 'SAVE_CARD_AS_TEMPLATE', ids: { card: card.ids.card }, params: { name }, before: { title: card.title }, display: { cardTitle: card.title, templateName: name } });
  },
  guard: (g, op) => cardGuard(g, op),
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong saveCardAsTemplate: chup tieu de (neu khong dat ten), mo ta, checklist + muc cua the vao mau cua bang; khong Activity
    const card = cardOf(state, op);
    const full = await tx.card.findUnique({ where: { id: card.id }, include: { checklists: { orderBy: { position: 'asc' }, include: { items: { orderBy: { position: 'asc' } } } } } });
    if (!full) throw new PlanAbort('STALE', 'Thẻ không còn tồn tại.');
    await tx.cardTemplate.create({
      data: {
        boardId: ctx.boardId,
        name: String(op.params.name) || full.title,
        description: full.description,
        checklists: { create: full.checklists.map((cl, i) => ({ title: cl.title, position: i, items: { create: cl.items.map((it, j) => ({ content: it.content, position: j })) } })) },
      },
    });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã lưu thẻ ${q(card.title)} làm thẻ mẫu ${q(String(op.params.name))}.`, { cardId: card.id });
  },
  describe: (op, index) => ({ index, verb: 'Lưu thẻ làm thẻ mẫu', text: `${q(op.display.cardTitle)} → mẫu ${q(op.display.templateName as string)}`, detail: 'Lưu tiêu đề (nếu không đặt tên khác), mô tả và checklist của thẻ làm mẫu cho cả bảng.', cardId: op.ids.card }),
  summary: (op) => `Đã lưu thẻ ${q(op.display.cardTitle)} làm thẻ mẫu ${q(op.display.templateName as string)}.`,
  stale: 'Thẻ đã thay đổi kể từ lúc xem trước.',
});

export const CARD_EXTRA_HANDLERS: AnyHandler[] = [setFieldValue, addReminder, removeReminder, setWatch, fromTemplate, saveTemplate];

