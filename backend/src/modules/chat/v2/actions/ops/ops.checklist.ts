// BUOC F - CHECKLIST: tick / bo tick, them / sua / xoa muc, doi ten / xoa checklist, giao nguoi, dat han cho muc, chuyen muc thanh the.
// Moi ham ghi giong het cardExtras.service (updateChecklistItem, addChecklistItem, deleteChecklistItem, updateChecklist, deleteChecklist,
// convertItemToCard). Muc / checklist duoc chi ra bang CHU nguoi dung go (`match`, `checklist`), khong bao gio bang id.

import { createHash } from 'node:crypto';
import { prisma } from '../../../../../config/prisma';
import { isBoardParticipant } from '../../../../board/board.service';
import { initialStatusData } from '../../../../card/cardStatus';
import { dueIso, formatDueDate, vnDayOfIso } from '../actions.dates';
import { fail, NO_CHANGE } from '../actions.guard.base';
import { foldWords, hasAny, indexesOfAny, phraseIndexes, RENAME_VERBS, REMOVE_VERBS, stripLeadingGeneric, CREATE_VERBS } from '../actions.text';
import type { GuardVerdict, StoredOp } from '../actions.types';
import { canEditInTx, cardOf, PlanAbort, record, type OpOutcome, type Tx } from '../actions.write.base';
import { chooseFrom, clip, q, type PoolItem } from './ops.common';
import { defineOp, isOpResult, type AnyHandler, type GuardCtx, type OpResolveResult, type ResolveCtx } from './ops.types';
import { EDIT_VERBS, mentions, REMOVE_OR_DELETE_VERBS, verbThen } from './ops.words';

const sha = (text: string): string => createHash('sha256').update(text.trim()).digest('hex');

const ITEM_NOUNS = [['muc'], ['viec', 'con'], ['cong', 'viec', 'con'], ['item'], ['subtask'], ['sub', 'task'], ['dong']] as const;
const CHECKLIST_NOUNS = [['checklist'], ['check', 'list']] as const;
/** Tu nam giua dong tu va danh tu cua checklist ("them VAO checklist"). */
const GLUE = ['vao', 'trong', 'cho', 'cua'] as const;
const TICK = [['tick'], ['check'], ['tich'], ['danh', 'dau', 'xong'], ['danh', 'dau', 'hoan', 'thanh'], ['danh', 'dau'], ['hoan', 'thanh'], ['hoan', 'tat'], ['xong'], ['done']] as const;
const UNTICK = [['bo', 'tick'], ['bo', 'check'], ['bo', 'tich'], ['bo', 'danh', 'dau'], ['bo', 'hoan', 'thanh'], ['untick'], ['uncheck'], ['mo', 'lai'], ['chua', 'xong'], ['chua', 'hoan', 'thanh'], ['huy', 'hoan', 'thanh']] as const;
const DONE_CUES = [['xong'], ['hoan', 'thanh'], ['hoan', 'tat'], ['done']] as const;
const ASSIGN_VERBS_LOCAL = [['giao'], ['gan'], ['phan', 'cong'], ['chi', 'dinh'], ['assign'], ['giao', 'viec']] as const;
const UNASSIGN_VERBS = [...REMOVE_VERBS, ['huy', 'giao'], ['bo', 'giao'], ['thu', 'hoi']] as const;
const DUE_VERBS_LOCAL = [['han'], ['deadline'], ['due'], ['dat', 'han'], ['doi', 'han'], ['bo', 'han'], ['xoa', 'han'], ['gia', 'han']] as const;
const CONVERT_VERBS = [['chuyen'], ['bien'], ['doi'], ['nang', 'cap'], ['tach'], ['convert'], ['dua']] as const;
const TO_CARD = [['thanh', 'the'], ['thanh', 'task'], ['thanh', 'card'], ['thanh', 'cong', 'viec'], ['thanh', 'viec']] as const;

const cardGuard = async (g: GuardCtx, op: StoredOp): Promise<GuardVerdict> => (op.ids.card === undefined ? fail('INVALID', `Thiếu thẻ cần thao tác. ${NO_CHANGE}`) : g.card(op.ids.card));

function allIn(texts: ReadonlyArray<string | string[] | undefined>, words: readonly string[]): boolean {
  const have = new Set(words);
  return texts.flat().every((t) => t === undefined || foldWords(t).every((w) => have.has(w)));
}

async function existingCard(rc: ResolveCtx, ref: Parameters<ResolveCtx['h']['cardTarget']>[0], doing: string) {
  const target = await rc.h.cardTarget(ref);
  if (isOpResult(target)) return target;
  if (target.local !== undefined || target.row === null || target.ids.card === undefined) {
    return { kind: 'FAIL', code: 'INVALID', text: `Thẻ mới tạo trong cùng lệnh chưa có checklist nào để ${doing}. Chưa thay đổi gì.` } satisfies OpResolveResult;
  }
  return { ...target, ids: { card: target.ids.card }, row: target.row };
}

interface ChecklistRow {
  id: string;
  title: string;
  items: Array<{ id: string; content: string; isDone: boolean; assigneeId: string | null; dueDate: Date | null }>;
}
async function checklistsOf(db: { checklist: typeof prisma.checklist }, cardId: string): Promise<ChecklistRow[]> {
  return db.checklist.findMany({
    where: { cardId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, title: true, items: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true, content: true, isDone: true, assigneeId: true, dueDate: true } } },
  });
}

/** Chon MOT checklist cua the: ten do nguoi dung noi; bo trong = the chi co mot checklist. */
async function pickChecklist(rc: ResolveCtx, cardId: string, cardTitle: string, text: string | undefined, all: ChecklistRow[]): Promise<ChecklistRow | OpResolveResult> {
  if (all.length === 0) return { kind: 'FAIL', code: 'NOT_FOUND', text: `Thẻ ${q(cardTitle)} chưa có checklist nào (hãy nhờ mình thêm checklist trước). Chưa thay đổi gì.` };
  const pool: PoolItem[] = all.map((c) => ({ id: c.id, name: c.title }));
  const hit = chooseFrom({ rc, kind: 'checklist', scope: cardId, text: text === undefined ? '' : stripLeadingGeneric(text), pool, where: ` trên thẻ ${q(cardTitle)}` });
  if ('kind' in hit) return hit;
  return all.find((c) => c.id === hit.id) as ChecklistRow;
}

/** Chon MOT muc (trong checklist `checklistText` neu co, khong thi trong moi checklist cua the). */
async function pickItem(rc: ResolveCtx, cardId: string, cardTitle: string, match: string, checklistText: string | undefined, all: ChecklistRow[]) {
  if (all.length === 0) return { kind: 'FAIL', code: 'NOT_FOUND', text: `Thẻ ${q(cardTitle)} chưa có checklist nào. Chưa thay đổi gì.` } satisfies OpResolveResult;
  let scope = all;
  if (checklistText !== undefined) {
    const one = await pickChecklist(rc, cardId, cardTitle, checklistText, all);
    if ('kind' in one) return one;
    scope = [one];
  }
  const multi = all.length > 1;
  const pool: Array<PoolItem & { checklist: ChecklistRow; item: ChecklistRow['items'][number] }> = scope.flatMap((c) => c.items.map((it) => ({ id: it.id, name: it.content, ...(multi ? { parentName: c.title } : {}), checklist: c, item: it })));
  if (pool.length === 0) return { kind: 'FAIL', code: 'NOT_FOUND', text: `Checklist trên thẻ ${q(cardTitle)} chưa có mục nào. Chưa thay đổi gì.` } satisfies OpResolveResult;
  const hit = chooseFrom({ rc, kind: 'item', scope: cardId, text: stripLeadingGeneric(match), pool, where: ` trên thẻ ${q(cardTitle)}` });
  if ('kind' in hit) return hit;
  return pool.find((p) => p.id === hit.id) as (typeof pool)[number];
}

async function itemGuard(g: GuardCtx, op: StoredOp): Promise<GuardVerdict> {
  const card = await cardGuard(g, op);
  if (!card.ok) return card;
  const row = op.ids.item === undefined ? null : await prisma.checklistItem.findFirst({ where: { id: op.ids.item, checklist: { cardId: op.ids.card } }, select: { id: true } });
  return row ? { ok: true } : fail('NOT_FOUND', `Mục checklist này không còn trên thẻ. ${NO_CHANGE}`);
}
async function checklistGuard(g: GuardCtx, op: StoredOp): Promise<GuardVerdict> {
  const card = await cardGuard(g, op);
  if (!card.ok) return card;
  const row = op.ids.checklist === undefined ? null : await prisma.checklist.findFirst({ where: { id: op.ids.checklist, cardId: op.ids.card }, select: { id: true } });
  return row ? { ok: true } : fail('NOT_FOUND', `Checklist này không còn trên thẻ. ${NO_CHANGE}`);
}

/** Khoa + doc lai muc trong transaction; sai gia tri cu -> STALE. */
async function lockItem(tx: Tx, op: StoredOp) {
  await tx.$queryRaw`SELECT id FROM "ChecklistItem" WHERE id = ${op.ids.item} FOR UPDATE`;
  const row = await tx.checklistItem.findFirst({ where: { id: op.ids.item, checklist: { cardId: op.ids.card } }, select: { id: true, content: true, isDone: true, assigneeId: true, dueDate: true, checklistId: true } });
  if (!row) throw new PlanAbort('STALE', 'Mục checklist không còn trên thẻ.');
  return row;
}

const done = (index: number, text: string, extra: Partial<OpOutcome> = {}): OpOutcome => ({ index, text, changed: true, ...extra });
const itemIds = (card: string, checklist: string, item: string) => ({ card, checklist, item });
const itemTargets = (op: StoredOp, effect: 'MODIFY' | 'REMOVE') => [
  { key: `item:${op.ids.item}`, effect },
  { key: `checklist:${op.ids.checklist}`, effect: 'MODIFY' as const },
];
const itemDisplay = (cardTitle: string, c: ChecklistRow, content: string) => ({ cardTitle, itemText: content, checklistTitle: c.title });

// ---------------------------------------------------------------------------------------------------------------------

const setItemDone = defineOp<'SET_CHECKLIST_ITEM_DONE'>({
  type: 'SET_CHECKLIST_ITEM_DONE',
  label: 'đánh dấu mục checklist',
  policy: { autoRun: true, confirm: [] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence(words, op) {
    const untick = mentions(words, UNTICK);
    if (op.done === false) return verbThen(words, UNTICK, ITEM_NOUNS, [op.match], 4);
    if (untick) return [];
    const lead = verbThen(words, TICK, ITEM_NOUNS, [op.match], 4);
    // "muc build xong roi": danh tu / ten muc dung truoc dau hieu xong
    const named = foldWords(op.match);
    const nounAt = [...indexesOfAny(words, ITEM_NOUNS), ...(named.length > 0 ? phraseIndexes(words, named) : [])];
    const trailing = nounAt.filter((n) => indexesOfAny(words, DONE_CUES).some((d) => d > n && d - n <= 6));
    return [...new Set([...lead, ...trailing])].sort((a, b) => a - b);
  },
  grounded: (op, words) => allIn([op.match, op.checklist], words) && (op.done === false ? mentions(words, UNTICK) : true),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'tick');
    if ('kind' in card) return card;
    const all = await checklistsOf(prisma, card.ids.card);
    const found = await pickItem(rc, card.ids.card, card.title, op.match, op.checklist, all);
    if ('kind' in found) return found;
    const done = op.done !== false;
    return rc.ok({
      type: 'SET_CHECKLIST_ITEM_DONE',
      ids: itemIds(card.ids.card, found.checklist.id, found.id),
      params: { done },
      before: { isDone: found.item.isDone, content: found.item.content },
      display: itemDisplay(card.title, found.checklist, found.item.content),
      ...(found.item.isDone === done ? { noop: done ? `Mục ${q(found.item.content)} đã được đánh dấu xong rồi.` : `Mục ${q(found.item.content)} chưa được đánh dấu nên chưa cần bỏ.` } : {}),
    });
  },
  guard: (g, op) => itemGuard(g, op),
  async verify(tx, _ctx, op) {
    const row = await lockItem(tx, op);
    if (row.isDone !== (op.before?.isDone ?? false)) throw new PlanAbort('STALE', 'Mục checklist đã đổi trạng thái kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong updateChecklistItem({ isDone }): chi doi isDone + moc tick, khong Activity / thong bao. Toi day trang thai
    // CHAC CHAN doi: thao tac "da tick roi" mang `noop` va bi bo qua truoc apply (actions.write.ts), con verify() da
    // khoa dong va bao dam isDone hien tai = before.isDone.
    const card = cardOf(state, op);
    const doneNow = op.params.done === true;
    await tx.checklistItem.update({ where: { id: op.ids.item as string }, data: { isDone: doneNow, completedAt: doneNow ? new Date() : null } });
    effects.boardIds.add(ctx.boardId);
    return done(index, op.params.done === true ? `Đã đánh dấu xong mục ${q(op.display.itemText as string)} trên thẻ ${q(card.title)}.` : `Đã bỏ đánh dấu mục ${q(op.display.itemText as string)} trên thẻ ${q(card.title)}.`, { cardId: card.id });
  },
  describe: (op, index) => ({
    index,
    verb: op.params.done === true ? 'Đánh dấu xong mục' : 'Bỏ đánh dấu mục',
    text: `${q(op.display.itemText as string)} trên thẻ ${q(op.display.cardTitle)}`,
    cardId: op.ids.card,
  }),
  summary: (op) => (op.params.done === true ? `Đã đánh dấu xong mục ${q(op.display.itemText as string)}.` : `Đã bỏ đánh dấu mục ${q(op.display.itemText as string)}.`),
  stale: 'Mục checklist đã thay đổi kể từ lúc xem trước.',
  targets: (op) => itemTargets(op, 'MODIFY'),
});

const addItems = defineOp<'ADD_CHECKLIST_ITEM'>({
  type: 'ADD_CHECKLIST_ITEM',
  label: 'thêm mục vào checklist',
  policy: { autoRun: false, confirm: ['TEXT_CONTENT'] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence: (words) => verbThen(words, [...CREATE_VERBS, ['bo', 'sung']], [...ITEM_NOUNS, ...CHECKLIST_NOUNS], [], 4, GLUE),
  grounded: (op, words) => allIn([op.items, op.checklist], words),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'thêm mục');
    if ('kind' in card) return card;
    const all = await checklistsOf(prisma, card.ids.card);
    const list = await pickChecklist(rc, card.ids.card, card.title, op.checklist, all);
    if ('kind' in list) return list;
    const items = op.items.map((i) => i.trim()).filter((i) => i !== '');
    if (items.length === 0) return { kind: 'FAIL', code: 'INVALID', text: 'Cần ít nhất một mục. Chưa thay đổi gì.' };
    return rc.ok({
      type: 'ADD_CHECKLIST_ITEM',
      ids: { card: card.ids.card, checklist: list.id },
      params: { items },
      before: { count: list.items.length, title: list.title },
      display: { cardTitle: card.title, checklistTitle: list.title },
    });
  },
  guard: async (g, op) => {
    const base = await checklistGuard(g, op);
    if (!base.ok) return base;
    const items = (op.params.items ?? []) as string[];
    return items.length < 1 || items.length > 20 || items.some((i) => i.trim() === '' || i.length > 500) ? fail('INVALID', `Cần từ 1 đến 20 mục, mỗi mục tối đa 500 ký tự. ${NO_CHANGE}`) : { ok: true };
  },
  async verify(tx, _ctx, op) {
    await tx.$queryRaw`SELECT id FROM "Checklist" WHERE id = ${op.ids.checklist} FOR UPDATE`;
    const row = await tx.checklist.findFirst({ where: { id: op.ids.checklist, cardId: op.ids.card }, select: { title: true } });
    if (!row) throw new PlanAbort('STALE', 'Checklist không còn trên thẻ.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong addChecklistItem lap lai: moi muc o cuoi (vi tri ke tiep)
    const card = cardOf(state, op);
    const checklistId = op.ids.checklist as string;
    const last = await tx.checklistItem.findFirst({ where: { checklistId }, orderBy: { position: 'desc' }, select: { position: true } });
    let position = last ? last.position + 1 : 0;
    const items = op.params.items as string[];
    for (const content of items) {
      await tx.checklistItem.create({ data: { checklistId, content: content.trim(), position } });
      position += 1;
    }
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã thêm ${items.length} mục vào checklist ${q(op.display.checklistTitle as string)} của thẻ ${q(card.title)}.`, { cardId: card.id });
  },
  describe: (op, index) => ({
    index,
    verb: 'Thêm mục vào checklist',
    text: `${q(op.display.checklistTitle as string)} của thẻ ${q(op.display.cardTitle)}`,
    detail: ((op.params.items ?? []) as string[]).map((i) => `• ${clip(i, 120)}`).join('\n'),
    cardId: op.ids.card,
  }),
  summary: (op) => `Đã thêm ${((op.params.items ?? []) as string[]).length} mục vào checklist ${q(op.display.checklistTitle as string)}.`,
  stale: 'Checklist đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `checklist:${op.ids.checklist}`, effect: 'MODIFY' }],
});

const editItem = defineOp<'EDIT_CHECKLIST_ITEM'>({
  type: 'EDIT_CHECKLIST_ITEM',
  label: 'sửa mục checklist',
  policy: { autoRun: false, confirm: ['TEXT_CONTENT'] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence: (words, op) => verbThen(words, [...EDIT_VERBS, ...RENAME_VERBS], ITEM_NOUNS, [op.match], 4),
  grounded: (op, words) => allIn([op.text, op.match, op.checklist], words),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'sửa mục');
    if ('kind' in card) return card;
    const all = await checklistsOf(prisma, card.ids.card);
    const found = await pickItem(rc, card.ids.card, card.title, op.match, op.checklist, all);
    if ('kind' in found) return found;
    const text = op.text.trim();
    return rc.ok({
      type: 'EDIT_CHECKLIST_ITEM',
      ids: itemIds(card.ids.card, found.checklist.id, found.id),
      params: { text },
      before: { content: found.item.content },
      display: itemDisplay(card.title, found.checklist, found.item.content),
      ...(found.item.content === text ? { noop: `Mục ${q(text)} đã có nội dung này rồi.` } : {}),
    });
  },
  async guard(g, op) {
    const base = await itemGuard(g, op);
    if (!base.ok) return base;
    const text = String(op.params.text ?? '');
    return text.trim() === '' || text.length > 500 ? fail('INVALID', `Nội dung mục phải từ 1 đến 500 ký tự. ${NO_CHANGE}`) : { ok: true };
  },
  async verify(tx, _ctx, op) {
    const row = await lockItem(tx, op);
    if (row.content !== op.before?.content) throw new PlanAbort('STALE', 'Mục checklist đã được sửa kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    const card = cardOf(state, op);
    await tx.checklistItem.update({ where: { id: op.ids.item as string }, data: { content: String(op.params.text).trim() } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã sửa mục ${q(op.display.itemText as string)} thành ${q(String(op.params.text))} trên thẻ ${q(card.title)}.`, { cardId: card.id });
  },
  describe: (op, index) => ({ index, verb: 'Sửa mục checklist', text: `trên thẻ ${q(op.display.cardTitle)}`, detail: `Từ: ${q(clip(String(op.before?.content ?? ''), 200))}\nThành: ${q(clip(String(op.params.text ?? ''), 300))}`, cardId: op.ids.card }),
  summary: (op) => `Đã sửa mục ${q(op.display.itemText as string)} thành ${q(String(op.params.text ?? ''))}.`,
  stale: 'Mục checklist đã thay đổi kể từ lúc xem trước.',
  targets: (op) => itemTargets(op, 'MODIFY'),
});

const deleteItem = defineOp<'DELETE_CHECKLIST_ITEM'>({
  type: 'DELETE_CHECKLIST_ITEM',
  label: 'xóa mục checklist',
  policy: { autoRun: false, confirm: ['DELETE'] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence: (words, op) => verbThen(words, REMOVE_OR_DELETE_VERBS, ITEM_NOUNS, [op.match], 4),
  grounded: (op, words) => allIn([op.match, op.checklist], words),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'xóa mục');
    if ('kind' in card) return card;
    const all = await checklistsOf(prisma, card.ids.card);
    const found = await pickItem(rc, card.ids.card, card.title, op.match, op.checklist, all);
    if ('kind' in found) return found;
    return rc.ok({
      type: 'DELETE_CHECKLIST_ITEM',
      ids: itemIds(card.ids.card, found.checklist.id, found.id),
      params: {},
      before: { content: found.item.content },
      display: itemDisplay(card.title, found.checklist, found.item.content),
    });
  },
  guard: (g, op) => itemGuard(g, op),
  async verify(tx, _ctx, op) {
    const row = await lockItem(tx, op);
    if (row.content !== op.before?.content) throw new PlanAbort('STALE', 'Mục checklist đã được sửa kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    const card = cardOf(state, op);
    await tx.checklistItem.delete({ where: { id: op.ids.item as string } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã xóa mục ${q(op.display.itemText as string)} khỏi checklist trên thẻ ${q(card.title)}.`, { cardId: card.id });
  },
  describe: (op, index) => ({
    index,
    verb: 'Xóa mục checklist',
    text: `${q(op.display.itemText as string)} trên thẻ ${q(op.display.cardTitle)}`,
    detail: 'Mục biến mất khỏi checklist và không khôi phục lại được ở giao diện.',
    cardId: op.ids.card,
    danger: true,
  }),
  summary: (op) => `Đã xóa mục ${q(op.display.itemText as string)} khỏi checklist.`,
  stale: 'Mục checklist đã thay đổi kể từ lúc xem trước.',
  targets: (op) => itemTargets(op, 'REMOVE'),
});

const renameChecklist = defineOp<'RENAME_CHECKLIST'>({
  type: 'RENAME_CHECKLIST',
  label: 'đổi tên checklist',
  policy: { autoRun: false, confirm: ['TEXT_CONTENT'] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence: (words) => verbThen(words, RENAME_VERBS, CHECKLIST_NOUNS, [], 4),
  grounded: (op, words) => allIn([op.title, op.checklist], words),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'đổi tên checklist');
    if ('kind' in card) return card;
    const all = await checklistsOf(prisma, card.ids.card);
    const list = await pickChecklist(rc, card.ids.card, card.title, op.checklist, all);
    if ('kind' in list) return list;
    const title = op.title.trim() || 'Việc cần làm';
    return rc.ok({
      type: 'RENAME_CHECKLIST',
      ids: { card: card.ids.card, checklist: list.id },
      params: { title },
      before: { title: list.title },
      display: { cardTitle: card.title, checklistTitle: list.title },
      ...(list.title === title ? { noop: `Checklist ${q(title)} đã có tên này rồi.` } : {}),
    });
  },
  async guard(g, op) {
    const base = await checklistGuard(g, op);
    if (!base.ok) return base;
    return String(op.params.title ?? '').length > 200 ? fail('INVALID', `Tên checklist tối đa 200 ký tự. ${NO_CHANGE}`) : { ok: true };
  },
  async verify(tx, _ctx, op) {
    const row = await tx.checklist.findFirst({ where: { id: op.ids.checklist, cardId: op.ids.card }, select: { title: true } });
    if (!row) throw new PlanAbort('STALE', 'Checklist không còn trên thẻ.');
    if (row.title !== op.before?.title) throw new PlanAbort('STALE', 'Checklist đã được đổi tên kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    const card = cardOf(state, op);
    await tx.checklist.update({ where: { id: op.ids.checklist as string }, data: { title: String(op.params.title) } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã đổi tên checklist ${q(op.display.checklistTitle as string)} thành ${q(String(op.params.title))}.`, { cardId: card.id });
  },
  describe: (op, index) => ({ index, verb: 'Đổi tên checklist', text: `${q(String(op.before?.title ?? ''))} → ${q(String(op.params.title ?? ''))}`, detail: `Trên thẻ ${q(op.display.cardTitle)}`, cardId: op.ids.card }),
  summary: (op) => `Đã đổi tên checklist ${q(String(op.before?.title ?? ''))} thành ${q(String(op.params.title ?? ''))}.`,
  stale: 'Checklist đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `checklist:${op.ids.checklist}`, effect: 'MODIFY' }],
});

const deleteChecklist = defineOp<'DELETE_CHECKLIST'>({
  type: 'DELETE_CHECKLIST',
  label: 'xóa checklist',
  policy: { autoRun: false, confirm: ['DELETE'] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence: (words) => verbThen(words, REMOVE_OR_DELETE_VERBS, CHECKLIST_NOUNS, [], 4),
  grounded: (op, words) => allIn([op.checklist], words),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'xóa checklist');
    if ('kind' in card) return card;
    const all = await checklistsOf(prisma, card.ids.card);
    const list = await pickChecklist(rc, card.ids.card, card.title, op.checklist, all);
    if ('kind' in list) return list;
    return rc.ok({
      type: 'DELETE_CHECKLIST',
      ids: { card: card.ids.card, checklist: list.id },
      params: {},
      before: { title: list.title, itemsHash: sha(list.items.map((i) => i.id).join(',')), count: list.items.length },
      display: { cardTitle: card.title, checklistTitle: list.title, items: list.items.length },
    });
  },
  guard: (g, op) => checklistGuard(g, op),
  async verify(tx, _ctx, op) {
    await tx.$queryRaw`SELECT id FROM "Checklist" WHERE id = ${op.ids.checklist} FOR UPDATE`;
    const row = await tx.checklist.findFirst({ where: { id: op.ids.checklist, cardId: op.ids.card }, select: { title: true, items: { select: { id: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] } } });
    if (!row) throw new PlanAbort('STALE', 'Checklist không còn trên thẻ.');
    if (row.title !== op.before?.title || sha(row.items.map((i) => i.id).join(',')) !== op.before?.itemsHash) throw new PlanAbort('STALE', 'Checklist đã thay đổi kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong deleteChecklist: xoa han checklist cung cac muc cua no
    const card = cardOf(state, op);
    await tx.checklist.delete({ where: { id: op.ids.checklist as string } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã xóa checklist ${q(op.display.checklistTitle as string)} khỏi thẻ ${q(card.title)}.`, { cardId: card.id });
  },
  describe: (op, index) => ({
    index,
    verb: 'Xóa checklist',
    text: `${q(op.display.checklistTitle as string)} trên thẻ ${q(op.display.cardTitle)}`,
    detail: `Checklist${typeof op.display.items === 'number' && op.display.items > 0 ? ` cùng ${op.display.items} mục` : ''} biến mất khỏi thẻ và không khôi phục lại được ở giao diện.`,
    cardId: op.ids.card,
    danger: true,
  }),
  summary: (op) => `Đã xóa checklist ${q(op.display.checklistTitle as string)}.`,
  stale: 'Checklist đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `checklist:${op.ids.checklist}`, effect: 'REMOVE' }],
});

const assignItem = defineOp<'ASSIGN_CHECKLIST_ITEM'>({
  type: 'ASSIGN_CHECKLIST_ITEM',
  label: 'giao mục checklist cho người',
  policy: { autoRun: true, confirm: [] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }, ...(op.member !== undefined ? [{ name: 'member' as const, kind: 'member' as const, ref: op.member }] : [])],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : name === 'member' && op.member !== undefined ? { ...op, member: ref } : op),
  licence(words, op) {
    return op.member !== undefined ? verbThen(words, ASSIGN_VERBS_LOCAL, ITEM_NOUNS, [op.match], 4, ['viec']) : verbThen(words, UNASSIGN_VERBS, ITEM_NOUNS, [op.match], 4, ['nguoi', 'phu', 'trach', 'giao', 'viec']);
  },
  grounded: (op, words) => allIn([op.match, op.checklist], words),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'giao mục');
    if ('kind' in card) return card;
    const all = await checklistsOf(prisma, card.ids.card);
    const found = await pickItem(rc, card.ids.card, card.title, op.match, op.checklist, all);
    if ('kind' in found) return found;
    let member: { id: string; name: string } | null = null;
    if (op.member !== undefined) {
      const m = await rc.h.pick('member', op.member);
      if (isOpResult(m)) return m;
      member = { id: m.id, name: m.name };
    }
    const same = (found.item.assigneeId ?? null) === (member?.id ?? null);
    return rc.ok({
      type: 'ASSIGN_CHECKLIST_ITEM',
      ids: { ...itemIds(card.ids.card, found.checklist.id, found.id), ...(member ? { member: member.id } : {}) },
      params: { assignee: member?.id ?? null },
      before: { assigneeId: found.item.assigneeId ?? null, content: found.item.content },
      display: { ...itemDisplay(card.title, found.checklist, found.item.content), ...(member ? { memberName: member.name } : {}) },
      ...(same ? { noop: member ? `Mục ${q(found.item.content)} đã được giao cho ${member.name} rồi.` : `Mục ${q(found.item.content)} chưa giao cho ai nên chưa cần bỏ.` } : {}),
    });
  },
  async guard(g, op) {
    const base = await itemGuard(g, op);
    if (!base.ok) return base;
    if (op.ids.member === undefined) return { ok: true };
    const person = await prisma.user.findFirst({ where: { id: op.ids.member, deletedAt: null }, select: { name: true } });
    if (!person) return fail('NOT_FOUND', `Người này không còn tài khoản hoạt động. ${NO_CHANGE}`);
    if (await isBoardParticipant(g.boardId, op.ids.member)) return { ok: true };
    const membership = await prisma.boardMember.findFirst({ where: { boardId: g.boardId, userId: op.ids.member, deletedAt: null }, select: { role: true } });
    return membership?.role === 'VIEWER'
      ? fail('VIEWER_ASSIGN', `${person.name} chỉ có quyền xem bảng này nên không giao việc được. ${NO_CHANGE}`)
      : fail('FORBIDDEN', `${person.name} không thuộc bảng này nên không giao việc được. ${NO_CHANGE}`);
  },
  async verify(tx, ctx, op) {
    const row = await lockItem(tx, op);
    if ((row.assigneeId ?? null) !== (op.before?.assigneeId ?? null)) throw new PlanAbort('STALE', 'Người phụ trách mục checklist đã thay đổi kể từ lúc xem trước.');
    if (op.ids.member !== undefined && !(await canEditInTx(tx, ctx.boardId, op.ids.member))) throw new PlanAbort('STALE', 'Người được giao không còn là thành viên của bảng.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong updateChecklistItem({ assigneeId }): chi doi cot, khong thong bao
    const card = cardOf(state, op);
    await tx.checklistItem.update({ where: { id: op.ids.item as string }, data: { assigneeId: op.ids.member ?? null } });
    effects.boardIds.add(ctx.boardId);
    const who = op.display.memberName as string | undefined;
    return done(index, who ? `Đã giao mục ${q(op.display.itemText as string)} cho ${who}.` : `Đã bỏ người phụ trách của mục ${q(op.display.itemText as string)}.`, { cardId: card.id });
  },
  describe: (op, index) => ({
    index,
    verb: op.ids.member ? 'Giao mục checklist' : 'Bỏ người khỏi mục',
    text: `${q(op.display.itemText as string)} trên thẻ ${q(op.display.cardTitle)}${op.display.memberName ? ` cho ${op.display.memberName as string}` : ''}`,
    cardId: op.ids.card,
  }),
  summary: (op) => (op.display.memberName ? `Đã giao mục ${q(op.display.itemText as string)} cho ${op.display.memberName as string}.` : `Đã bỏ người phụ trách của mục ${q(op.display.itemText as string)}.`),
  stale: 'Mục checklist đã thay đổi kể từ lúc xem trước.',
  targets: (op) => itemTargets(op, 'MODIFY'),
});

const itemDue = defineOp<'SET_CHECKLIST_ITEM_DUE'>({
  type: 'SET_CHECKLIST_ITEM_DUE',
  label: 'đặt hạn cho mục checklist',
  policy: { autoRun: true, confirm: [] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence: (words, op) => verbThen(words, DUE_VERBS_LOCAL, ITEM_NOUNS, [op.match], 5),
  grounded: (op, words) => allIn([op.match, op.checklist], words),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'đặt hạn');
    if ('kind' in card) return card;
    const resolution = rc.h.due?.resolution;
    if (resolution === undefined || resolution.kind === 'INVALID') return { kind: 'FAIL', code: 'INVALID', text: 'Ngày hạn không hợp lệ. Chưa thay đổi gì.' };
    if (rc.h.due?.llmDiffers) rc.warnings.push('Ngày hạn được lấy theo đúng câu của bạn (khác với ngày AI đề xuất).');
    const all = await checklistsOf(prisma, card.ids.card);
    const found = await pickItem(rc, card.ids.card, card.title, op.match, op.checklist, all);
    if ('kind' in found) return found;
    const before = found.item.dueDate ? found.item.dueDate.toISOString() : null;
    const due = resolution.kind === 'CLEAR' ? null : dueIso(resolution.date);
    let noop: string | undefined;
    if (due === null && before === null) noop = `Mục ${q(found.item.content)} chưa có hạn nên không cần bỏ.`;
    else if (due !== null && before !== null && vnDayOfIso(before) === vnDayOfIso(due)) noop = `Hạn của mục ${q(found.item.content)} đã là ${formatDueDate(vnDayOfIso(due))} rồi.`;
    return rc.ok({
      type: 'SET_CHECKLIST_ITEM_DUE',
      ids: itemIds(card.ids.card, found.checklist.id, found.id),
      params: { due },
      before: { due: before, content: found.item.content },
      display: itemDisplay(card.title, found.checklist, found.item.content),
      ...(noop !== undefined ? { noop } : {}),
    });
  },
  guard: (g, op) => itemGuard(g, op),
  async verify(tx, _ctx, op) {
    const row = await lockItem(tx, op);
    const now = row.dueDate ? row.dueDate.toISOString() : null;
    if (now !== (op.before?.due ?? null)) throw new PlanAbort('STALE', 'Hạn của mục checklist đã thay đổi kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong updateChecklistItem({ dueDate }): chi doi cot, khong nhac han / thong bao
    const card = cardOf(state, op);
    const due = (op.params.due as string | null | undefined) ?? null;
    await tx.checklistItem.update({ where: { id: op.ids.item as string }, data: { dueDate: due ? new Date(due) : null } });
    effects.boardIds.add(ctx.boardId);
    return done(index, due === null ? `Đã bỏ hạn của mục ${q(op.display.itemText as string)}.` : `Đã đặt hạn cho mục ${q(op.display.itemText as string)}: ${formatDueDate(vnDayOfIso(due))}.`, { cardId: card.id });
  },
  describe: (op, index) => ({
    index,
    verb: op.params.due === null ? 'Bỏ hạn của mục' : 'Đặt hạn cho mục',
    text: `${q(op.display.itemText as string)} trên thẻ ${q(op.display.cardTitle)}`,
    ...(op.params.due ? { detail: `${formatDueDate(vnDayOfIso(String(op.params.due)))}${op.before?.due ? ` (trước: ${formatDueDate(vnDayOfIso(String(op.before.due)))})` : ''}` } : {}),
    cardId: op.ids.card,
  }),
  summary: (op) => (op.params.due === null ? `Đã bỏ hạn của mục ${q(op.display.itemText as string)}.` : `Đã đặt hạn cho mục ${q(op.display.itemText as string)}: ${formatDueDate(vnDayOfIso(String(op.params.due)))}.`),
  stale: 'Hạn của mục checklist đã thay đổi kể từ lúc xem trước.',
  targets: (op) => itemTargets(op, 'MODIFY'),
});

const convertItem = defineOp<'CONVERT_ITEM_TO_CARD'>({
  type: 'CONVERT_ITEM_TO_CARD',
  label: 'chuyển mục checklist thành thẻ',
  policy: { autoRun: false, confirm: ['DELETE'] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence: (words, op) => (hasAny(words, TO_CARD) ? verbThen(words, CONVERT_VERBS, ITEM_NOUNS, [op.match], 4) : []),
  grounded: (op, words) => allIn([op.match, op.checklist], words),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'chuyển mục');
    if ('kind' in card) return card;
    const all = await checklistsOf(prisma, card.ids.card);
    const found = await pickItem(rc, card.ids.card, card.title, op.match, op.checklist, all);
    if ('kind' in found) return found;
    return rc.ok({
      type: 'CONVERT_ITEM_TO_CARD',
      ids: itemIds(card.ids.card, found.checklist.id, found.id),
      params: {},
      before: { content: found.item.content, listName: card.row.list.name },
      display: { ...itemDisplay(card.title, found.checklist, found.item.content), listName: card.row.list.name },
    });
  },
  guard: (g, op) => itemGuard(g, op),
  async verify(tx, _ctx, op) {
    const row = await lockItem(tx, op);
    if (row.content !== op.before?.content) throw new PlanAbort('STALE', 'Mục checklist đã được sửa kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong convertItemToCard: the moi o CUNG cot voi the cha (cuoi cot, trang thai theo cot), xoa muc, Activity card.create
    const parent = cardOf(state, op);
    const item = await tx.checklistItem.findUniqueOrThrow({ where: { id: op.ids.item as string }, select: { content: true } });
    const list = await tx.list.findFirstOrThrow({ where: { id: parent.listId }, select: { name: true, status: true } });
    const last = await tx.card.findFirst({ where: { listId: parent.listId, deletedAt: null, archivedAt: null }, orderBy: { position: 'desc' }, select: { position: true } });
    const created = await tx.card.create({ data: { listId: parent.listId, title: item.content.slice(0, 500), position: last ? last.position + 1 : 0, ...initialStatusData(list.status) } });
    await tx.checklistItem.delete({ where: { id: op.ids.item as string } });
    await record(tx, ctx, state, effects, { cardId: created.id, type: 'card.create', data: { listName: list.name } });
    state.cards.set(created.id, { id: created.id, title: created.title, dueDate: null, status: created.status, listId: parent.listId, listName: list.name, listStatus: list.status });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã chuyển mục ${q(item.content)} thành thẻ mới trong cột ${q(list.name)}.`, { cardId: created.id, listId: parent.listId });
  },
  describe: (op, index) => ({
    index,
    verb: 'Chuyển mục thành thẻ',
    text: `${q(op.display.itemText as string)} (trên thẻ ${q(op.display.cardTitle)})`,
    detail: `Tạo thẻ mới cùng tên trong cột ${q(op.display.listName)}; mục bị xóa khỏi checklist.`,
    cardId: op.ids.card,
  }),
  summary: (op) => `Đã chuyển mục ${q(op.display.itemText as string)} thành thẻ mới.`,
  stale: 'Mục checklist đã thay đổi kể từ lúc xem trước.',
  targets: (op) => itemTargets(op, 'REMOVE'),
});

export const CHECKLIST_HANDLERS: AnyHandler[] = [setItemDone, addItems, editItem, deleteItem, renameChecklist, deleteChecklist, assignItem, itemDue, convertItem];
