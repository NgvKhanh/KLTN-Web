// BUOC E - DON DEP THE VA COT: xoa / khoi phuc / sao chep the, anh bia, luu tru / xoa / khoi phuc / sao chep / di chuyen / sap xep cot, chuyen het the,
// xoa het the trong cot, trang thai cot. Moi ham ghi PHAI giong het service cua giao dien (card.service, list.service): cung cot, cung vi tri, cung
// Activity, cung thong bao. Xoa va thao tac ca-cot luon xem truoc; cac thao tac chinh xac, hoan tac duoc (khoi phuc, sao chep, anh bia) co the tu chay.

import { createHash } from 'node:crypto';
import { prisma } from '../../../../../config/prisma';
import { initialStatusData, STATUS_LABEL, statusWrite } from '../../../../card/cardStatus';
import { cardMemberIds } from '../../../../notification/notification.service';
import { COLOR_HEX, colorLabel, colorMentioned, type ColorName } from '../actions.palette';
import { foldWords, hasAny, indexesOfAny, MOVE_VERBS, REMOVE_VERBS, stripLeadingGeneric, ARCHIVE_PHRASES, WRITE_VERBS, lastStatusMention, statusMentions } from '../actions.text';
import type { GuardVerdict, PlanItemView, StoredOp } from '../actions.types';
import { cardOf, PlanAbort, record, statusActivityType, type OpOutcome } from '../actions.write.base';
import { fail, liveList, NO_CHANGE } from '../actions.guard.base';
import { chooseFrom, q, type PoolItem } from './ops.common';
import { defineOp, isOpResult, type AnyHandler, type GuardCtx, type OpResolveResult, type ResolveCtx } from './ops.types';
import { ALL_CUES, CARD_NOUNS, COPY_VERBS, DELETE_VERBS, LIST_NOUNS_VI, mentions, ownTexts, RESTORE_VERBS, verbThen } from './ops.words';

const idsHash = (ids: readonly string[]): string => createHash('sha256').update(ids.join(',')).digest('hex');
const LIVE_CARD = { deletedAt: null, archivedAt: null } as const;
const LIVE_LIST = { deletedAt: null, archivedAt: null } as const;

// ---------------------------------------------------------------------------------------------------------------------
// Tro giup phan giai
// ---------------------------------------------------------------------------------------------------------------------

/** Mot cot CO SAN (khong phai cot do chinh ke hoach tao) -> id + ten, hoac ket qua dung som. */
async function existingList(rc: ResolveCtx, ref: Parameters<ResolveCtx['h']['listTarget']>[0], doing: string): Promise<{ id: string; name: string } | OpResolveResult> {
  const target = await rc.h.listTarget(ref);
  if (isOpResult(target)) return target;
  if (target.ids.list === undefined) return { kind: 'FAIL', code: 'INVALID', text: `Cột mới tạo trong cùng lệnh chưa có thẻ hay dữ liệu nào để ${doing}. Chưa thay đổi gì.` };
  return { id: target.ids.list, name: target.name };
}

async function existingCard(rc: ResolveCtx, ref: Parameters<ResolveCtx['h']['cardTarget']>[0], doing: string) {
  const target = await rc.h.cardTarget(ref);
  if (isOpResult(target)) return target;
  if (target.local !== undefined || target.row === null || target.ids.card === undefined) {
    return { kind: 'FAIL', code: 'INVALID', text: `Thẻ mới tạo trong cùng lệnh không cần ${doing}. Chưa thay đổi gì.` } satisfies OpResolveResult;
  }
  return { ...target, ids: { card: target.ids.card }, row: target.row };
}

async function archivedCards(boardId: string): Promise<PoolItem[]> {
  const rows = await prisma.card.findMany({
    where: { deletedAt: null, archivedAt: { not: null }, list: { boardId, ...LIVE_LIST } },
    orderBy: { archivedAt: 'desc' },
    select: { id: true, title: true, list: { select: { name: true } } },
    take: 300,
  });
  return rows.map((r) => ({ id: r.id, name: r.title, parentName: r.list.name }));
}

async function archivedLists(boardId: string): Promise<PoolItem[]> {
  const rows = await prisma.list.findMany({ where: { boardId, deletedAt: null, archivedAt: { not: null } }, orderBy: { archivedAt: 'desc' }, select: { id: true, name: true }, take: 100 });
  return rows.map((r) => ({ id: r.id, name: r.name }));
}

async function liveCardCount(listId: string): Promise<number> {
  return prisma.card.count({ where: { listId, ...LIVE_CARD } });
}

/** Cac the dang hoat dong cua cot theo THU TU hien thi (position, roi ngay tao). */
const liveCardsOf = (db: { card: typeof prisma.card }, listId: string) =>
  db.card.findMany({ where: { listId, ...LIVE_CARD }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });

const cardGuard = async (g: GuardCtx, op: StoredOp): Promise<GuardVerdict> => (op.ids.card === undefined ? fail('INVALID', `Thiếu thẻ cần thao tác. ${NO_CHANGE}`) : g.card(op.ids.card));

async function listGuard(boardId: string, listId: string | undefined, label = 'Cột') {
  return (await liveList(boardId, listId)) ? ({ ok: true } as const) : fail('NOT_FOUND', `${label} này không còn trong bảng. ${NO_CHANGE}`);
}

const done = (index: number, text: string, extra: Partial<OpOutcome> = {}): OpOutcome => ({ index, text, changed: true, ...extra });

// ---------------------------------------------------------------------------------------------------------------------
// THE: xoa / khoi phuc / sao chep / anh bia
// ---------------------------------------------------------------------------------------------------------------------

const deleteCard = defineOp<'DELETE_CARD'>({
  type: 'DELETE_CARD',
  label: 'xóa thẻ',
  policy: { autoRun: false, confirm: ['DELETE'] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence: (words, op) => verbThen(words, DELETE_VERBS, CARD_NOUNS, ownTexts(op.card)),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'xóa');
    if ('kind' in card) return card;
    const [comments, attachments, items] = await Promise.all([
      prisma.comment.count({ where: { cardId: card.ids.card, deletedAt: null } }),
      prisma.attachment.count({ where: { cardId: card.ids.card } }),
      prisma.checklistItem.count({ where: { checklist: { cardId: card.ids.card } } }),
    ]);
    return rc.ok({
      type: 'DELETE_CARD',
      ids: { card: card.ids.card },
      params: {},
      before: { title: card.title, listId: card.row.listId, listName: card.row.list.name },
      display: { cardTitle: card.title, listName: card.row.list.name, comments, attachments, items },
    });
  },
  guard: (g, op) => cardGuard(g, op),
  async verify(tx, ctx, op) {
    const row = await tx.card.findFirst({ where: { id: op.ids.card, ...LIVE_CARD, list: { boardId: ctx.boardId } }, select: { title: true } });
    if (!row) throw new PlanAbort('STALE', 'Thẻ không còn trong bảng.');
    if (row.title !== op.before?.title) throw new PlanAbort('STALE', 'Thẻ đã được đổi tên kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    const card = cardOf(state, op);
    // nguoi nhan thong bao doc TRUOC khi xoa (sau COMMIT the da bi xoa nen cardMemberIds se rong) - giong deleteCard
    const recipients = await cardMemberIds(card.id);
    await tx.card.update({ where: { id: card.id }, data: { deletedAt: new Date() } });
    // giong deleteCard: thong bao KHONG gan cardId (the da xoa, khong co gi de mo)
    effects.notifications.push({ type: 'card.deleted', actorId: ctx.userId, boardId: ctx.boardId, cardId: null, data: { cardTitle: card.title }, to: { kind: 'USERS', ids: recipients } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã xóa thẻ ${q(card.title)}.`);
  },
  describe(op, index): PlanItemView {
    const d = op.display;
    const parts = [
      typeof d.comments === 'number' && d.comments > 0 ? `${d.comments} bình luận` : '',
      typeof d.attachments === 'number' && d.attachments > 0 ? `${d.attachments} tệp đính kèm` : '',
      typeof d.items === 'number' && d.items > 0 ? `${d.items} mục checklist` : '',
    ].filter((p) => p !== '');
    return {
      index,
      verb: 'Xóa thẻ',
      text: q(d.cardTitle),
      detail: `Thẻ ở cột ${q(d.listName)}${parts.length > 0 ? `, có ${parts.join(', ')}` : ''}. Xóa là thẻ biến mất khỏi bảng và không khôi phục lại được ở giao diện (muốn giữ lại thì dùng lưu trữ).`,
      cardId: undefined,
      danger: true,
    };
  },
  summary: (op) => `Đã xóa thẻ ${q(op.display.cardTitle)}.`,
  stale: 'Thẻ đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `card:${op.ids.card}`, effect: 'REMOVE' }],
});

const restoreCard = defineOp<'RESTORE_CARD'>({
  type: 'RESTORE_CARD',
  label: 'khôi phục thẻ đã lưu trữ',
  policy: { autoRun: true, confirm: [] },
  // tham chieu toi the DA LUU TRU (khong nam trong tap the dang hoat dong) nen tu bo phan giai rieng; van khai o de nguon goc kiem chu co mat trong cau
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence: (words, op) => verbThen(words, RESTORE_VERBS, CARD_NOUNS, ownTexts(op.card)),
  async resolve(rc, op) {
    if (op.card.by !== 'TEXT') return { kind: 'FAIL', code: 'INVALID', text: 'Hãy nêu tên thẻ đã lưu trữ cần khôi phục. Chưa thay đổi gì.' };
    const pool = await archivedCards(rc.h.boardId);
    const hit = chooseFrom({ rc, kind: 'archivedCard', scope: rc.h.boardId, text: stripLeadingGeneric(op.card.text), pool, where: ' trong mục Lưu trữ của bảng' });
    if ('kind' in hit) return hit;
    return rc.ok({ type: 'RESTORE_CARD', ids: { archived: hit.id }, params: {}, before: { title: hit.name, listName: hit.parentName ?? '' }, display: { cardTitle: hit.name, listName: hit.parentName ?? '' } });
  },
  async guard(g, op) {
    const row = op.ids.archived === undefined ? null : await prisma.card.findFirst({ where: { id: op.ids.archived, deletedAt: null, archivedAt: { not: null }, list: { boardId: g.boardId, ...LIVE_LIST } }, select: { id: true } });
    return row ? { ok: true } : fail('NOT_FOUND', `Không tìm thấy thẻ đã lưu trữ này (có thể đã được khôi phục hoặc xóa). ${NO_CHANGE}`);
  },
  async verify(tx, ctx, op) {
    await tx.$queryRaw`SELECT id FROM "Card" WHERE id = ${op.ids.archived} FOR UPDATE`;
    const row = await tx.card.findFirst({ where: { id: op.ids.archived, deletedAt: null, archivedAt: { not: null }, list: { boardId: ctx.boardId, ...LIVE_LIST } }, select: { title: true } });
    if (!row) throw new PlanAbort('STALE', 'Thẻ đã lưu trữ không còn trong mục Lưu trữ của bảng.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    const id = op.ids.archived as string;
    const card = await tx.card.findFirst({ where: { id, deletedAt: null, archivedAt: { not: null } }, include: { list: { select: { id: true, name: true, status: true, boardId: true } } } });
    if (!card || card.list.boardId !== ctx.boardId) throw new PlanAbort('STALE', 'Thẻ đã lưu trữ không còn trong bảng.');
    const last = await tx.card.findFirst({ where: { listId: card.listId, ...LIVE_CARD }, orderBy: { position: 'desc' }, select: { position: true } });
    await tx.card.update({ where: { id }, data: { archivedAt: null, position: last ? last.position + 1 : 0 } });
    // cot co the da doi trang thai trong luc the nam trong kho luu tru -> the doi theo cot khi quay lai (nhu restoreCard)
    const listStatus = card.list.status;
    const changed = listStatus !== null && (await statusWrite(tx, { id }, listStatus)).count > 0;
    await record(tx, ctx, state, effects, { cardId: id, type: 'card.restore', data: {} });
    if (changed && listStatus !== null) await record(tx, ctx, state, effects, { cardId: id, type: statusActivityType(card.status, listStatus), data: { from: card.status, to: listStatus } });
    state.cards.set(id, { id, title: card.title, dueDate: card.dueDate, status: changed && listStatus !== null ? listStatus : card.status, listId: card.listId, listName: card.list.name, listStatus });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã khôi phục thẻ ${q(card.title)} về cuối cột ${q(card.list.name)}.`, { cardId: id });
  },
  describe: (op, index) => ({ index, verb: 'Khôi phục thẻ', text: q(op.display.cardTitle), detail: `Thẻ trở lại cuối cột ${q(op.display.listName)}.` }),
  summary: (op) => `Đã khôi phục thẻ ${q(op.display.cardTitle)}.`,
  stale: 'Thẻ đã lưu trữ đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `card:${op.ids.archived}`, effect: 'MODIFY' }],
});

const copyCard = defineOp<'COPY_CARD'>({
  type: 'COPY_CARD',
  label: 'sao chép thẻ',
  policy: { autoRun: true, confirm: [] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }, ...(op.toList !== undefined ? [{ name: 'toList' as const, kind: 'list' as const, ref: op.toList }] : [])],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : name === 'toList' && op.toList !== undefined ? { ...op, toList: ref } : op),
  licence: (words, op) => verbThen(words, COPY_VERBS, CARD_NOUNS, ownTexts(op.card)),
  grounded: (op, words) => op.title === undefined || foldWords(op.title).every((w) => words.includes(w)),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'sao chép');
    if ('kind' in card) return card;
    let toList: { id: string; name: string } | undefined;
    if (op.toList !== undefined) {
      const t = await existingList(rc, op.toList, 'sao chép thẻ vào');
      if ('kind' in t) return t;
      toList = t;
    }
    const newTitle = (op.title?.trim() || `${card.title} (bản sao)`).slice(0, 500);
    const targetName = toList?.name ?? card.row.list.name;
    return rc.ok({
      type: 'COPY_CARD',
      ids: { card: card.ids.card, ...(toList ? { toList: toList.id } : {}) },
      params: op.title !== undefined ? { title: op.title.trim() } : {},
      before: { title: card.title },
      display: { cardTitle: card.title, newTitle, listName: targetName },
    });
  },
  async guard(g, op) {
    const card = await cardGuard(g, op);
    if (!card.ok) return card;
    return op.ids.toList === undefined ? { ok: true } : listGuard(g.boardId, op.ids.toList, 'Cột đích');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    const src = cardOf(state, op);
    const full = await tx.card.findUnique({ where: { id: src.id }, include: { labels: true, members: true, checklists: { include: { items: true } } } });
    if (!full) throw new PlanAbort('STALE', 'Thẻ nguồn không còn tồn tại.');
    const targetListId = op.ids.toList ?? src.listId;
    const tl = await tx.list.findFirst({ where: { id: targetListId, boardId: ctx.boardId, ...LIVE_LIST } });
    if (!tl) throw new PlanAbort('STALE', 'Cột đích không còn trong bảng.');
    const last = await tx.card.findFirst({ where: { listId: targetListId, ...LIVE_CARD }, orderBy: { position: 'desc' }, select: { position: true } });
    const title = (op.params.title?.trim() || `${src.title} (bản sao)`).slice(0, 500);
    // giong copyCard: muc da tick trong ban sao co moc tick = luc sao chep (RISK_MODULE.md §9)
    const copiedAt = new Date();
    const created = await tx.card.create({
      data: {
        listId: targetListId,
        title,
        description: full.description,
        startDate: full.startDate,
        dueDate: full.dueDate,
        storyPoints: full.storyPoints,
        coverColor: full.coverColor,
        coverImageUrl: full.coverImageUrl,
        position: last ? last.position + 1 : 0,
        // Ban sao la the moi: trang thai theo cot dich (cot tu do -> TODO)
        ...initialStatusData(tl.status),
        ...(full.labels.length > 0 ? { labels: { create: full.labels.map((l) => ({ labelId: l.labelId })) } } : {}),
        ...(full.members.length > 0 ? { members: { create: full.members.map((m) => ({ userId: m.userId })) } } : {}),
        ...(full.checklists.length > 0
          ? {
              checklists: {
                create: full.checklists.map((cl) => ({
                  title: cl.title,
                  position: cl.position,
                  items: { create: cl.items.map((it) => ({ content: it.content, isDone: it.isDone, completedAt: it.isDone ? copiedAt : null, position: it.position, assigneeId: it.assigneeId, dueDate: it.dueDate })) },
                })),
              },
            }
          : {}),
      },
    });
    // giong copyCard: Activity ghi ten cot NGUON
    await record(tx, ctx, state, effects, { cardId: created.id, type: 'card.create', data: { listName: src.listName } });
    state.cards.set(created.id, { id: created.id, title: created.title, dueDate: created.dueDate, status: created.status, listId: targetListId, listName: tl.name, listStatus: tl.status });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã sao chép thẻ ${q(src.title)} thành ${q(created.title)} trong cột ${q(tl.name)}.`, { cardId: created.id, listId: targetListId });
  },
  describe: (op, index) => ({
    index,
    verb: 'Sao chép thẻ',
    text: q(op.display.cardTitle),
    detail: `Tạo thẻ ${q(op.display.newTitle as string)} trong cột ${q(op.display.listName)} (kèm mô tả, nhãn, người nhận, checklist).`,
    cardId: op.ids.card,
  }),
  summary: (op) => `Đã sao chép thẻ ${q(op.display.cardTitle)} thành ${q(op.display.newTitle as string)}.`,
  stale: 'Thẻ hoặc cột đích đã thay đổi kể từ lúc xem trước.',
});

const coverVerbs = [...WRITE_VERBS, ...REMOVE_VERBS, ['gan'], ['doi'], ['chon']] as const;
const setCardCover = defineOp<'SET_CARD_COVER'>({
  type: 'SET_CARD_COVER',
  label: 'đặt ảnh bìa cho thẻ',
  policy: { autoRun: true, confirm: [] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence(words) {
    const nouns = indexesOfAny(words, [['anh', 'bia'], ['bia'], ['cover']]);
    return indexesOfAny(words, coverVerbs).filter((v) => nouns.some((n) => n >= v && n - v <= 4));
  },
  // mau phai do CHINH nguoi dung noi; bo anh bia (NONE) thi phai co dong tu bo / xoa
  grounded: (op, words) => (op.color === 'NONE' ? hasAny(words, REMOVE_VERBS) : colorMentioned(op.color as ColorName, words)),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'đặt ảnh bìa');
    if ('kind' in card) return card;
    const full = await prisma.card.findUnique({ where: { id: card.ids.card }, select: { coverColor: true, coverImageUrl: true } });
    const hex = op.color === 'NONE' ? null : COLOR_HEX[op.color];
    const noop = full !== null && full.coverColor === hex && full.coverImageUrl === null ? { noop: hex === null ? `Thẻ ${q(card.title)} chưa có ảnh bìa nên không cần bỏ.` : `Ảnh bìa của thẻ ${q(card.title)} đã là màu này rồi.` } : {};
    return rc.ok({
      type: 'SET_CARD_COVER',
      ids: { card: card.ids.card },
      params: { color: hex },
      before: { color: full?.coverColor ?? null, image: full?.coverImageUrl ?? null },
      display: { cardTitle: card.title },
      ...noop,
    });
  },
  guard: (g, op) => cardGuard(g, op),
  async verify(tx, _ctx, op) {
    const row = await tx.card.findUnique({ where: { id: op.ids.card }, select: { coverColor: true, coverImageUrl: true } });
    if (!row || (row.coverColor ?? null) !== (op.before?.color ?? null) || (row.coverImageUrl ?? null) !== (op.before?.image ?? null)) throw new PlanAbort('STALE', 'Ảnh bìa của thẻ đã thay đổi kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong updateCard({ coverColor, coverImageUrl }): chi ghi cot; dat mau thi bo anh, bo bia thi bo ca hai
    const card = cardOf(state, op);
    const color = (op.params.color as string | null | undefined) ?? null;
    await tx.card.update({ where: { id: card.id }, data: { coverColor: color, coverImageUrl: null } });
    effects.boardIds.add(ctx.boardId);
    return done(index, color === null ? `Đã bỏ ảnh bìa của thẻ ${q(card.title)}.` : `Đã đặt ảnh bìa màu ${colorLabel(color)} cho thẻ ${q(card.title)}.`, { cardId: card.id });
  },
  describe: (op, index) => ({
    index,
    verb: op.params.color === null ? 'Bỏ ảnh bìa' : 'Đặt ảnh bìa',
    text: q(op.display.cardTitle),
    ...(op.params.color === null ? {} : { detail: `Màu ${colorLabel(op.params.color as string)}${op.before?.color ? ` (trước: ${colorLabel(op.before.color as string)})` : ''}` }),
    cardId: op.ids.card,
  }),
  summary: (op) => (op.params.color === null ? `Đã bỏ ảnh bìa của thẻ ${q(op.display.cardTitle)}.` : `Đã đặt ảnh bìa màu ${colorLabel(op.params.color as string)} cho thẻ ${q(op.display.cardTitle)}.`),
  stale: 'Ảnh bìa của thẻ đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `card:${op.ids.card}`, effect: 'MODIFY' }],
});

// ---------------------------------------------------------------------------------------------------------------------
// COT: luu tru / xoa / khoi phuc / sao chep / di chuyen / sap xep / trang thai
// ---------------------------------------------------------------------------------------------------------------------

const archiveList = defineOp<'ARCHIVE_LIST'>({
  type: 'ARCHIVE_LIST',
  label: 'lưu trữ cột',
  policy: { autoRun: false, confirm: ['ARCHIVE'] },
  slots: (op) => [{ name: 'list', kind: 'list', ref: op.list }],
  withRef: (op, name, ref) => (name === 'list' ? { ...op, list: ref } : op),
  licence(words, op) {
    const own = ownTexts(op.list);
    return verbThen(words, ARCHIVE_PHRASES, LIST_NOUNS_VI, own, 3);
  },
  async resolve(rc, op) {
    const list = await existingList(rc, op.list, 'lưu trữ');
    if ('kind' in list) return list;
    return rc.ok({ type: 'ARCHIVE_LIST', ids: { list: list.id }, params: {}, before: { listName: list.name }, display: { listName: list.name, cards: await liveCardCount(list.id) } });
  },
  guard: (g, op) => listGuard(g.boardId, op.ids.list),
  async apply({ tx, ctx, effects, index }, op) {
    // giong archiveList: cac the ben trong giu nguyen
    await tx.list.update({ where: { id: op.ids.list as string }, data: { archivedAt: new Date() } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã lưu trữ cột ${q(op.display.listName)}.`, { listId: op.ids.list });
  },
  describe: (op, index) => ({ index, verb: 'Lưu trữ cột', text: q(op.display.listName), detail: `Cột${typeof op.display.cards === 'number' && op.display.cards > 0 ? ` cùng ${op.display.cards} thẻ trong cột` : ''} sẽ ẩn khỏi bảng; khôi phục lại được trong mục Lưu trữ của bảng.` }),
  summary: (op) => `Đã lưu trữ cột ${q(op.display.listName)}. Khôi phục lại được trong mục Lưu trữ của bảng.`,
  stale: 'Cột đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `list:${op.ids.list}`, effect: 'REMOVE' }],
});

const deleteList = defineOp<'DELETE_LIST'>({
  type: 'DELETE_LIST',
  label: 'xóa cột',
  policy: { autoRun: false, confirm: ['DELETE', 'NEW_STRUCTURE'] },
  slots: (op) => [{ name: 'list', kind: 'list', ref: op.list }],
  withRef: (op, name, ref) => (name === 'list' ? { ...op, list: ref } : op),
  licence: (words, op) => verbThen(words, DELETE_VERBS, LIST_NOUNS_VI, ownTexts(op.list), 3),
  async resolve(rc, op) {
    const list = await existingList(rc, op.list, 'xóa');
    if ('kind' in list) return list;
    return rc.ok({ type: 'DELETE_LIST', ids: { list: list.id }, params: {}, before: { listName: list.name }, display: { listName: list.name, cards: await liveCardCount(list.id) } });
  },
  guard: (g, op) => listGuard(g.boardId, op.ids.list),
  async verify(tx, _ctx, op) {
    const row = await tx.list.findUnique({ where: { id: op.ids.list }, select: { name: true } });
    if (row?.name !== op.before?.listName) throw new PlanAbort('STALE', 'Cột đã được đổi tên kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, effects, index }, op) {
    await tx.list.update({ where: { id: op.ids.list as string }, data: { deletedAt: new Date() } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã xóa cột ${q(op.display.listName)}.`);
  },
  describe: (op, index) => ({
    index,
    verb: 'Xóa cột',
    text: q(op.display.listName),
    detail: `Cột${typeof op.display.cards === 'number' && op.display.cards > 0 ? ` cùng ${op.display.cards} thẻ trong cột` : ''} biến mất khỏi bảng và không khôi phục lại được ở giao diện (muốn giữ lại thì dùng lưu trữ).`,
    danger: true,
  }),
  summary: (op) => `Đã xóa cột ${q(op.display.listName)}.`,
  stale: 'Cột đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `list:${op.ids.list}`, effect: 'REMOVE' }],
});

const restoreList = defineOp<'RESTORE_LIST'>({
  type: 'RESTORE_LIST',
  label: 'khôi phục cột đã lưu trữ',
  policy: { autoRun: false, confirm: ['NEW_STRUCTURE'] },
  slots: (op) => [{ name: 'list', kind: 'list', ref: op.list }],
  withRef: (op, name, ref) => (name === 'list' ? { ...op, list: ref } : op),
  licence: (words, op) => verbThen(words, RESTORE_VERBS, LIST_NOUNS_VI, ownTexts(op.list), 3),
  async resolve(rc, op) {
    if (op.list.by !== 'TEXT') return { kind: 'FAIL', code: 'INVALID', text: 'Hãy nêu tên cột đã lưu trữ cần khôi phục. Chưa thay đổi gì.' };
    const hit = chooseFrom({ rc, kind: 'archivedList', scope: rc.h.boardId, text: stripLeadingGeneric(op.list.text), pool: await archivedLists(rc.h.boardId), where: ' trong mục Lưu trữ của bảng' });
    if ('kind' in hit) return hit;
    return rc.ok({ type: 'RESTORE_LIST', ids: { archived: hit.id }, params: {}, before: { listName: hit.name }, display: { listName: hit.name } });
  },
  async guard(g, op) {
    const row = op.ids.archived === undefined ? null : await prisma.list.findFirst({ where: { id: op.ids.archived, boardId: g.boardId, deletedAt: null, archivedAt: { not: null } }, select: { id: true } });
    return row ? { ok: true } : fail('NOT_FOUND', `Không tìm thấy cột đã lưu trữ này (có thể đã được khôi phục hoặc xóa). ${NO_CHANGE}`);
  },
  async verify(tx, ctx, op) {
    await tx.$queryRaw`SELECT id FROM "List" WHERE id = ${op.ids.archived} FOR UPDATE`;
    const row = await tx.list.findFirst({ where: { id: op.ids.archived, boardId: ctx.boardId, deletedAt: null, archivedAt: { not: null } }, select: { id: true } });
    if (!row) throw new PlanAbort('STALE', 'Cột đã lưu trữ không còn trong mục Lưu trữ của bảng.');
  },
  async apply({ tx, ctx, effects, index }, op) {
    // giong restoreList: dua ve CUOI bang
    const last = await tx.list.findFirst({ where: { boardId: ctx.boardId, ...LIVE_LIST }, orderBy: { position: 'desc' }, select: { position: true } });
    await tx.list.update({ where: { id: op.ids.archived as string }, data: { archivedAt: null, position: last ? last.position + 1 : 0 } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã khôi phục cột ${q(op.display.listName)} về cuối bảng.`, { listId: op.ids.archived });
  },
  describe: (op, index) => ({ index, verb: 'Khôi phục cột', text: q(op.display.listName), detail: 'Cột trở lại cuối bảng cùng các thẻ trong cột.' }),
  summary: (op) => `Đã khôi phục cột ${q(op.display.listName)}.`,
  stale: 'Cột đã lưu trữ đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `list:${op.ids.archived}`, effect: 'MODIFY' }],
});

const copyList = defineOp<'COPY_LIST'>({
  type: 'COPY_LIST',
  label: 'sao chép cột',
  policy: { autoRun: false, confirm: ['NEW_STRUCTURE'] },
  slots: (op) => [{ name: 'list', kind: 'list', ref: op.list }],
  withRef: (op, name, ref) => (name === 'list' ? { ...op, list: ref } : op),
  licence: (words, op) => verbThen(words, COPY_VERBS, LIST_NOUNS_VI, ownTexts(op.list), 3),
  async resolve(rc, op) {
    const list = await existingList(rc, op.list, 'sao chép');
    if ('kind' in list) return list;
    return rc.ok({ type: 'COPY_LIST', ids: { list: list.id }, params: {}, before: { listName: list.name }, display: { listName: list.name, newName: `${list.name} (bản sao)`.slice(0, 100), cards: await liveCardCount(list.id) } });
  },
  guard: (g, op) => listGuard(g.boardId, op.ids.list),
  async apply({ tx, ctx, effects, index }, op) {
    const src = await tx.list.findFirst({ where: { id: op.ids.list, boardId: ctx.boardId, ...LIVE_LIST } });
    if (!src) throw new PlanAbort('STALE', 'Cột nguồn không còn trong bảng.');
    const cards = await liveCardsOf(tx, src.id);
    // day cac cot phia sau ra 1 bac de chua ban sao (giong copyList)
    await tx.list.updateMany({ where: { boardId: ctx.boardId, ...LIVE_LIST, position: { gt: src.position } }, data: { position: { increment: 1 } } });
    const copy = await tx.list.create({
      data: {
        boardId: ctx.boardId,
        name: `${src.name} (bản sao)`.slice(0, 100),
        position: src.position + 1,
        status: src.status,
        cards: { create: cards.map((c, i) => ({ title: c.title, description: c.description, status: c.status, isDone: c.isDone, completedAt: c.completedAt, position: i })) },
      },
    });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã sao chép cột ${q(src.name)} thành ${q(copy.name)} (${cards.length} thẻ).`, { listId: copy.id });
  },
  describe: (op, index) => ({ index, verb: 'Sao chép cột', text: q(op.display.listName), detail: `Tạo cột ${q(op.display.newName as string)}${typeof op.display.cards === 'number' ? ` cùng ${op.display.cards} thẻ` : ''}, đặt ngay sau cột gốc.` }),
  summary: (op) => `Đã sao chép cột ${q(op.display.listName)}.`,
  stale: 'Cột đã thay đổi kể từ lúc xem trước.',
});

const PLACE_MENTIONS: Record<string, readonly (readonly string[])[]> = {
  FIRST: [['dau', 'tien'], ['len', 'dau'], ['o', 'dau'], ['dau'], ['truoc', 'het'], ['ben', 'trai'], ['first']],
  LAST: [['cuoi'], ['cuoi', 'cung'], ['ben', 'phai'], ['sau', 'cung'], ['last'], ['xuong', 'cuoi']],
  BEFORE: [['truoc']],
  AFTER: [['sau'], ['ke', 'sau'], ['ngay', 'sau']],
};
const placementMentioned = (placement: string, words: readonly string[]): boolean => hasAny(words, PLACE_MENTIONS[placement] ?? []);

const PLACE_TEXT: Record<string, string> = { FIRST: 'lên đầu bảng', LAST: 'xuống cuối bảng', BEFORE: 'đặt trước cột', AFTER: 'đặt sau cột' };

const moveList = defineOp<'MOVE_LIST'>({
  type: 'MOVE_LIST',
  label: 'di chuyển cột',
  policy: { autoRun: false, confirm: ['NEW_STRUCTURE'] },
  slots: (op) => [{ name: 'list', kind: 'list', ref: op.list }, ...(op.anchor !== undefined ? [{ name: 'anchor' as const, kind: 'list' as const, ref: op.anchor }] : [])],
  withRef: (op, name, ref) => (name === 'list' ? { ...op, list: ref } : name === 'anchor' && op.anchor !== undefined ? { ...op, anchor: ref } : op),
  licence(words, op) {
    const verbs = [...MOVE_VERBS, ['doi', 'vi', 'tri'], ['sap', 'xep'], ['dat'], ['keo'], ['xep'], ['dua']] as const;
    const at = verbThen(words, verbs, LIST_NOUNS_VI, ownTexts(op.list), 3);
    return at.length > 0 && placementMentioned(op.placement, words) ? at : [];
  },
  async resolve(rc, op) {
    const list = await existingList(rc, op.list, 'di chuyển');
    if ('kind' in list) return list;
    if ((op.placement === 'BEFORE' || op.placement === 'AFTER') && op.anchor === undefined) return { kind: 'FAIL', code: 'INVALID', text: 'Hãy nói rõ đặt cột trước hay sau cột nào. Chưa thay đổi gì.' };
    let anchor: { id: string; name: string } | undefined;
    if (op.placement === 'BEFORE' || op.placement === 'AFTER') {
      const a = await existingList(rc, op.anchor, 'làm mốc');
      if ('kind' in a) return a;
      if (a.id === list.id) return { kind: 'FAIL', code: 'INVALID', text: 'Cột mốc trùng với cột cần di chuyển. Chưa thay đổi gì.' };
      anchor = a;
    }
    const all = await prisma.list.findMany({ where: { boardId: rc.h.boardId, ...LIVE_LIST }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true } });
    const others = all.filter((l) => l.id !== list.id).map((l) => l.id);
    const current = all.findIndex((l) => l.id === list.id);
    let target: number;
    if (op.placement === 'FIRST') target = 0;
    else if (op.placement === 'LAST') target = others.length;
    else {
      const at = others.indexOf((anchor as { id: string }).id);
      target = op.placement === 'BEFORE' ? at : at + 1;
    }
    return rc.ok({
      type: 'MOVE_LIST',
      ids: { list: list.id, ...(anchor ? { anchor: anchor.id } : {}) },
      params: { placement: op.placement, target },
      before: { orderHash: idsHash(all.map((l) => l.id)), index: current },
      display: { listName: list.name, ...(anchor ? { anchorName: anchor.name } : {}) },
      ...(target === current ? { noop: `Cột ${q(list.name)} đã ở vị trí này rồi.` } : {}),
    });
  },
  guard: async (g, op) => {
    const list = await listGuard(g.boardId, op.ids.list);
    if (!list.ok) return list;
    return op.ids.anchor === undefined ? { ok: true } : listGuard(g.boardId, op.ids.anchor, 'Cột mốc');
  },
  async verify(tx, ctx, op) {
    const all = await tx.list.findMany({ where: { boardId: ctx.boardId, ...LIVE_LIST }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true } });
    if (idsHash(all.map((l) => l.id)) !== op.before?.orderHash) throw new PlanAbort('STALE', 'Thứ tự các cột đã thay đổi kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, effects, index }, op) {
    // giong updateList({ position }): dua cot toi vi tri roi danh so lai het
    const listId = op.ids.list as string;
    const others = await tx.list.findMany({ where: { boardId: ctx.boardId, ...LIVE_LIST, id: { not: listId } }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true } });
    const target = Math.min(Math.max((op.params.target as number) ?? 0, 0), others.length);
    const ordered = [...others.slice(0, target).map((l) => l.id), listId, ...others.slice(target).map((l) => l.id)];
    for (const [i, id] of ordered.entries()) await tx.list.update({ where: { id }, data: { position: i } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã di chuyển cột ${q(op.display.listName)} ${placeText(op)}.`, { listId });
  },
  describe: (op, index) => ({ index, verb: 'Di chuyển cột', text: q(op.display.listName), detail: placeText(op) }),
  summary: (op) => `Đã di chuyển cột ${q(op.display.listName)} ${placeText(op)}.`,
  stale: 'Thứ tự các cột đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `list:${op.ids.list}`, effect: 'MODIFY' }],
});

function placeText(op: StoredOp): string {
  const placement = String(op.params.placement ?? '');
  const base = PLACE_TEXT[placement] ?? '';
  return placement === 'BEFORE' || placement === 'AFTER' ? `${base} ${q(op.display.anchorName as string)}` : base;
}

const SORT_CUES: Record<string, readonly (readonly string[])[]> = {
  CREATED_DESC: [['moi', 'nhat'], ['moi', 'tao'], ['gan', 'day'], ['moi', 'len', 'tren']],
  CREATED_ASC: [['cu', 'nhat'], ['cu', 'len', 'tren'], ['dau', 'tien'], ['tao', 'truoc']],
  TITLE_ASC: [['ten'], ['abc'], ['alphabet'], ['a', 'z'], ['bang', 'chu', 'cai'], ['tieu', 'de']],
  DONE_LAST: [['xong'], ['hoan', 'thanh'], ['chua', 'xong'], ['done']],
};
const SORT_TEXT: Record<string, string> = {
  CREATED_DESC: 'thẻ mới tạo nhất lên trên',
  CREATED_ASC: 'thẻ cũ nhất lên trên',
  TITLE_ASC: 'theo tên A → Z',
  DONE_LAST: 'thẻ chưa xong lên trên, thẻ đã xong xuống dưới',
};

const sortList = defineOp<'SORT_LIST'>({
  type: 'SORT_LIST',
  label: 'sắp xếp thẻ trong cột',
  policy: { autoRun: false, confirm: ['BULK'] },
  slots: (op) => [{ name: 'list', kind: 'list', ref: op.list }],
  withRef: (op, name, ref) => (name === 'list' ? { ...op, list: ref } : op),
  licence(words, op) {
    const at = verbThen(words, [['sap', 'xep'], ['sort'], ['xep']], [...LIST_NOUNS_VI, ...CARD_NOUNS], ownTexts(op.list), 4);
    return at.length > 0 && hasAny(words, SORT_CUES[op.sortBy] ?? []) ? at : [];
  },
  async resolve(rc, op) {
    const list = await existingList(rc, op.list, 'sắp xếp');
    if ('kind' in list) return list;
    const cards = await liveCardsOf(prisma, list.id);
    if (cards.length < 2) return { kind: 'FAIL', code: 'NO_CHANGE', text: `Cột ${q(list.name)} có ${cards.length} thẻ nên không cần sắp xếp. Chưa thay đổi gì.` };
    const sorted = sortCards(cards, op.sortBy).map((c) => c.id);
    const current = cards.map((c) => c.id);
    return rc.ok({
      type: 'SORT_LIST',
      ids: { list: list.id },
      params: { sortBy: op.sortBy },
      before: { orderHash: idsHash(current), cards: cards.length },
      display: { listName: list.name, cards: cards.length },
      ...(idsHash(sorted) === idsHash(current) ? { noop: `Các thẻ trong cột ${q(list.name)} đã đúng thứ tự này rồi.` } : {}),
    });
  },
  guard: (g, op) => listGuard(g.boardId, op.ids.list),
  async verify(tx, _ctx, op) {
    const cards = await liveCardsOf(tx, op.ids.list as string);
    if (idsHash(cards.map((c) => c.id)) !== op.before?.orderHash) throw new PlanAbort('STALE', 'Các thẻ trong cột đã thay đổi kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, effects, index }, op) {
    const cards = await liveCardsOf(tx, op.ids.list as string);
    const sorted = sortCards(cards, String(op.params.sortBy));
    for (const [i, c] of sorted.entries()) await tx.card.update({ where: { id: c.id }, data: { position: i } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã sắp xếp ${cards.length} thẻ trong cột ${q(op.display.listName)} (${SORT_TEXT[String(op.params.sortBy)] ?? ''}).`, { listId: op.ids.list });
  },
  describe: (op, index) => ({ index, verb: 'Sắp xếp thẻ trong cột', text: q(op.display.listName), detail: `${SORT_TEXT[String(op.params.sortBy)] ?? ''}. Thứ tự hiện tại của ${op.display.cards as number} thẻ sẽ bị thay.` }),
  summary: (op) => `Đã sắp xếp thẻ trong cột ${q(op.display.listName)}.`,
  stale: 'Các thẻ trong cột đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `list:${op.ids.list}`, effect: 'MODIFY' }],
});

/** Giong sortListCards (list.service): created-desc / created-asc / title-asc (vi) / done (the chua xong len tren). Sap on dinh tu thu tu hien thi. */
function sortCards<T extends { createdAt: Date; title: string; isDone: boolean }>(cards: readonly T[], by: string): T[] {
  return [...cards].sort((a, b) => {
    switch (by) {
      case 'CREATED_DESC':
        return b.createdAt.getTime() - a.createdAt.getTime();
      case 'CREATED_ASC':
        return a.createdAt.getTime() - b.createdAt.getTime();
      case 'TITLE_ASC':
        return a.title.localeCompare(b.title, 'vi');
      case 'DONE_LAST':
        return Number(a.isDone) - Number(b.isDone);
      default:
        return 0;
    }
  });
}

const moveAllCards = defineOp<'MOVE_ALL_CARDS'>({
  type: 'MOVE_ALL_CARDS',
  label: 'chuyển hết thẻ của cột',
  policy: { autoRun: false, confirm: ['BULK'] },
  slots: (op) => [
    { name: 'list', kind: 'list', ref: op.list },
    { name: 'toList', kind: 'list', ref: op.toList },
  ],
  withRef: (op, name, ref) => (name === 'list' ? { ...op, list: ref } : name === 'toList' ? { ...op, toList: ref } : op),
  licence(words, op) {
    const verbs = [...MOVE_VERBS, ['doi'], ['dua'], ['don']] as const;
    // dong tu + (tat ca / het / toan bo ... ) + the, hoac "the cua cot X": phai co dau hieu "tat ca" va danh tu the
    if (!mentions(words, ALL_CUES) || !mentions(words, CARD_NOUNS)) return [];
    return verbThen(words, verbs, [...ALL_CUES, ...CARD_NOUNS, ...LIST_NOUNS_VI], ownTexts(op.list, op.toList), 4);
  },
  async resolve(rc, op) {
    const from = await existingList(rc, op.list, 'chuyển');
    if ('kind' in from) return from;
    const to = await existingList(rc, op.toList, 'nhận thẻ');
    if ('kind' in to) return to;
    if (from.id === to.id) return { kind: 'FAIL', code: 'INVALID', text: 'Cột nguồn và cột đích là một. Chưa thay đổi gì.' };
    const cards = await liveCardsOf(prisma, from.id);
    return rc.ok({
      type: 'MOVE_ALL_CARDS',
      ids: { list: from.id, toList: to.id },
      params: {},
      before: { orderHash: idsHash(cards.map((c) => c.id)), cards: cards.length },
      display: { listName: from.name, toListName: to.name, cards: cards.length },
      ...(cards.length === 0 ? { noop: `Cột ${q(from.name)} không có thẻ nào để chuyển.` } : {}),
    });
  },
  async guard(g, op) {
    const from = await listGuard(g.boardId, op.ids.list, 'Cột nguồn');
    return from.ok ? listGuard(g.boardId, op.ids.toList, 'Cột đích') : from;
  },
  async verify(tx, _ctx, op) {
    const cards = await liveCardsOf(tx, op.ids.list as string);
    if (idsHash(cards.map((c) => c.id)) !== op.before?.orderHash) throw new PlanAbort('STALE', 'Các thẻ trong cột nguồn đã thay đổi kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong moveAllCards: the cua cot nguon nam SAU the san co o cot dich; cot dich co trang thai -> cac the doi theo
    const target = await tx.list.findFirst({ where: { id: op.ids.toList, boardId: ctx.boardId, ...LIVE_LIST } });
    if (!target) throw new PlanAbort('STALE', 'Cột đích không còn trong bảng.');
    const targetCards = await tx.card.findMany({ where: { listId: target.id, ...LIVE_CARD }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true } });
    const moving = await tx.card.findMany({ where: { listId: op.ids.list as string, ...LIVE_CARD }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true, title: true, status: true } });
    const ordered = [...targetCards.map((c) => c.id), ...moving.map((c) => c.id)];
    for (const [i, id] of ordered.entries()) await tx.card.update({ where: { id }, data: { listId: target.id, position: i } });
    if (target.status) {
      await statusWrite(tx, { id: { in: moving.map((c) => c.id) } }, target.status);
      for (const c of moving) {
        if (c.status !== target.status) await record(tx, ctx, state, effects, { cardId: c.id, type: statusActivityType(c.status, target.status), data: { from: c.status, to: target.status } });
      }
    }
    for (const c of moving) effects.automations.push({ trigger: 'CARD_MOVED_TO_LIST', cardId: c.id, cardTitle: c.title, boardId: ctx.boardId, listId: target.id });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã chuyển ${moving.length} thẻ từ cột ${q(op.display.listName)} sang cột ${q(op.display.toListName)}.`, { listId: target.id });
  },
  describe: (op, index) => ({ index, verb: 'Chuyển hết thẻ', text: `${q(op.display.listName)} → ${q(op.display.toListName)}`, detail: `${op.display.cards as number} thẻ sẽ chuyển sang cuối cột đích${''}.` }),
  summary: (op) => `Đã chuyển ${op.display.cards as number} thẻ từ cột ${q(op.display.listName)} sang cột ${q(op.display.toListName)}.`,
  stale: 'Các thẻ trong cột đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [
    { key: `list:${op.ids.list}`, effect: 'MODIFY' },
    { key: `list:${op.ids.toList}`, effect: 'MODIFY' },
  ],
});

const deleteAllCards = defineOp<'DELETE_ALL_CARDS'>({
  type: 'DELETE_ALL_CARDS',
  label: 'xóa hết thẻ trong cột',
  policy: { autoRun: false, confirm: ['DELETE', 'BULK'] },
  slots: (op) => [{ name: 'list', kind: 'list', ref: op.list }],
  withRef: (op, name, ref) => (name === 'list' ? { ...op, list: ref } : op),
  licence(words, op) {
    if (!mentions(words, ALL_CUES)) return [];
    return verbThen(words, DELETE_VERBS, [...ALL_CUES, ...CARD_NOUNS], ownTexts(op.list), 4).filter(() => mentions(words, CARD_NOUNS));
  },
  async resolve(rc, op) {
    const list = await existingList(rc, op.list, 'xóa thẻ');
    if ('kind' in list) return list;
    const cards = await liveCardsOf(prisma, list.id);
    return rc.ok({
      type: 'DELETE_ALL_CARDS',
      ids: { list: list.id },
      params: {},
      before: { orderHash: idsHash(cards.map((c) => c.id)), cards: cards.length },
      display: { listName: list.name, cards: cards.length },
      ...(cards.length === 0 ? { noop: `Cột ${q(list.name)} không có thẻ nào để xóa.` } : {}),
    });
  },
  guard: (g, op) => listGuard(g.boardId, op.ids.list),
  async verify(tx, _ctx, op) {
    const cards = await liveCardsOf(tx, op.ids.list as string);
    if (idsHash(cards.map((c) => c.id)) !== op.before?.orderHash) throw new PlanAbort('STALE', 'Các thẻ trong cột đã thay đổi kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, effects, index }, op) {
    // giong deleteAllCards: xoa mem tat ca the dang hoat dong; khong thong bao
    const res = await tx.card.updateMany({ where: { listId: op.ids.list as string, ...LIVE_CARD }, data: { deletedAt: new Date() } });
    effects.boardIds.add(ctx.boardId);
    return { index, text: `Đã xóa ${res.count} thẻ trong cột ${q(op.display.listName)}.`, changed: res.count > 0, listId: op.ids.list };
  },
  describe: (op, index) => ({
    index,
    verb: 'Xóa hết thẻ trong cột',
    text: q(op.display.listName),
    detail: `${op.display.cards as number} thẻ trong cột sẽ biến mất khỏi bảng và không khôi phục lại được ở giao diện (cột vẫn giữ lại).`,
    danger: true,
  }),
  summary: (op) => `Đã xóa ${op.display.cards as number} thẻ trong cột ${q(op.display.listName)}.`,
  stale: 'Các thẻ trong cột đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `list:${op.ids.list}`, effect: 'MODIFY' }],
});

const setListStatus = defineOp<'SET_LIST_STATUS'>({
  type: 'SET_LIST_STATUS',
  label: 'đặt trạng thái cho cột',
  policy: { autoRun: false, confirm: ['BULK', 'NEW_STRUCTURE'] },
  slots: (op) => [{ name: 'list', kind: 'list', ref: op.list }],
  withRef: (op, name, ref) => (name === 'list' ? { ...op, list: ref } : op),
  licence(words, op) {
    if (mentions(words, [['trang', 'thai'], ['status']])) {
      return verbThen(words, [['dat'], ['doi'], ['chuyen'], ['cap', 'nhat'], ['gan'], ['bo'], ['xoa'], ['set']], [['trang', 'thai'], ...LIST_NOUNS_VI], ownTexts(op.list), 4);
    }
    // Khong noi "trang thai" nhung goi THANG ten trang thai cua cot (nhan o dau cot): "chuyen cot 2 tu dang lam sang chua lam".
    // Chi cho trang thai da duoc nhac; "chuyen het the cot A sang Dang lam" khong qua (giua dong tu va "cot" con "het the").
    if (op.status !== 'NONE' && statusMentions(words).some((m) => m.status === op.status)) {
      return verbThen(words, [['doi'], ['chuyen'], ['dat'], ['cap', 'nhat']], LIST_NOUNS_VI, [], 4, ['tu']);
    }
    return [];
  },
  // trang thai phai la trang thai DUOC NHAC (khong tu chon); NONE phai co cum bo / tu do / khong gan
  grounded: (op, words) =>
    op.status === 'NONE'
      ? hasAny(words, [['tu', 'do'], ['bo'], ['xoa'], ['khong', 'gan'], ['khong', 'co'], ['huy']])
      : lastStatusMention(words) === op.status || statusMentions(words).some((m) => m.status === op.status),
  async resolve(rc, op) {
    const list = await existingList(rc, op.list, 'đổi trạng thái');
    if ('kind' in list) return list;
    const row = await prisma.list.findUnique({ where: { id: list.id }, select: { status: true } });
    const to = op.status === 'NONE' ? null : op.status;
    const mismatched = to === null ? 0 : await prisma.card.count({ where: { listId: list.id, ...LIVE_CARD, status: { not: to } } });
    const same = (row?.status ?? null) === to;
    return rc.ok({
      type: 'SET_LIST_STATUS',
      ids: { list: list.id },
      params: { listStatus: to },
      before: { listStatus: row?.status ?? null, mismatched },
      display: { listName: list.name, cards: mismatched },
      ...(same && mismatched === 0 ? { noop: `Cột ${q(list.name)} đã có trạng thái này rồi.` } : {}),
    });
  },
  guard: (g, op) => listGuard(g.boardId, op.ids.list),
  async verify(tx, _ctx, op) {
    const row = await tx.list.findUnique({ where: { id: op.ids.list }, select: { status: true } });
    if ((row?.status ?? null) !== (op.before?.listStatus ?? null)) throw new PlanAbort('STALE', 'Trạng thái của cột đã thay đổi kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong setListStatus (list.service): status null -> chi bo trang thai cot, the giu nguyen; con lai cot + moi the dang hoat dong doi theo, ghi Activity tung the
    const listId = op.ids.list as string;
    const status = (op.params.listStatus as import('../../../../../generated/prisma/enums').CardStatus | null | undefined) ?? null;
    if (status === null) {
      await tx.list.update({ where: { id: listId }, data: { status: null } });
      effects.boardIds.add(ctx.boardId);
      return done(index, `Đã bỏ trạng thái của cột ${q(op.display.listName)} (cột tự do).`, { listId });
    }
    const where = { listId, ...LIVE_CARD };
    const changing = await tx.card.findMany({ where: { ...where, status: { not: status } }, select: { id: true, status: true } });
    await tx.list.update({ where: { id: listId }, data: { status } });
    await statusWrite(tx, where, status);
    for (const c of changing) await record(tx, ctx, state, effects, { cardId: c.id, type: statusActivityType(c.status, status), data: { from: c.status, to: status } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã đặt trạng thái cột ${q(op.display.listName)} thành “${STATUS_LABEL[status]}”${changing.length > 0 ? ` (${changing.length} thẻ đổi theo)` : ''}.`, { listId });
  },
  describe: (op, index) => ({
    index,
    verb: 'Đặt trạng thái cột',
    text: q(op.display.listName),
    detail: op.params.listStatus === null || op.params.listStatus === undefined ? 'Bỏ trạng thái của cột (thẻ giữ nguyên trạng thái).' : `Trạng thái cột: ${STATUS_LABEL[op.params.listStatus as keyof typeof STATUS_LABEL]}${typeof op.display.cards === 'number' && op.display.cards > 0 ? `; ${op.display.cards} thẻ trong cột sẽ đổi theo` : ''}.`,
  }),
  summary: (op) => `Đã đặt trạng thái cho cột ${q(op.display.listName)}.`,
  stale: 'Trạng thái của cột đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `list:${op.ids.list}`, effect: 'MODIFY' }],
});

export const CLEANUP_HANDLERS: AnyHandler[] = [
  deleteCard,
  restoreCard,
  copyCard,
  setCardCover,
  archiveList,
  deleteList,
  restoreList,
  copyList,
  moveList,
  sortList,
  moveAllCards,
  deleteAllCards,
  setListStatus,
];

