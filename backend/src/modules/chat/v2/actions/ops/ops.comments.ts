// BUOC F - BINH LUAN: sua / xoa binh luan CUA CHINH NGUOI DUNG (giong giao dien: chi tac gia moi sua / xoa duoc) va tra loi mot binh luan.
// Ghi giong het cardExtras.service (updateComment, deleteComment, addComment co parentId): xoa mem, tra loi gan vao binh luan GOC cua luong,
// thong bao "card.comment.reply" cho tac gia binh luan duoc tra loi + "card.comment" cho thanh vien the.

import { createHash } from 'node:crypto';
import { prisma } from '../../../../../config/prisma';
import { assertCardView } from '../../../../card/card.service';
import { fail, NO_CHANGE } from '../actions.guard.base';
import { foldWords, stripLeadingGeneric } from '../actions.text';
import type { GuardVerdict, StoredOp } from '../actions.types';
import { cardOf, PlanAbort, record, type OpOutcome } from '../actions.write.base';
import { chooseFrom, clip, q, type PoolItem } from './ops.common';
import { defineOp, isOpResult, type AnyHandler, type GuardCtx, type OpResolveResult, type ResolveCtx } from './ops.types';
import { COMMENT_NOUNS_VI, EDIT_VERBS, REMOVE_OR_DELETE_VERBS, verbThen } from './ops.words';

const sha = (text: string): string => createHash('sha256').update(text.trim()).digest('hex');
const REPLY_VERBS = [['tra', 'loi'], ['reply'], ['phan', 'hoi'], ['hoi', 'dap'], ['dap', 'lai']] as const;
const MAX_TEXT = 1000;
const AT_TEXT = 'Trợ lý chưa hỗ trợ nhắc tên (@) trong bình luận; hãy bỏ ký tự @ hoặc viết bình luận trực tiếp trên thẻ.';

const cardGuard = async (g: GuardCtx, op: StoredOp): Promise<GuardVerdict> => (op.ids.card === undefined ? fail('INVALID', `Thiếu thẻ cần thao tác. ${NO_CHANGE}`) : g.card(op.ids.card));

/** Cac cum trong `texts` deu co mat (tu cua chu) trong cau cua nguoi dung. */
function allIn(texts: ReadonlyArray<string | undefined>, words: readonly string[]): boolean {
  const have = new Set(words);
  return texts.every((t) => t === undefined || foldWords(t).every((w) => have.has(w)));
}

async function existingCard(rc: ResolveCtx, ref: Parameters<ResolveCtx['h']['cardTarget']>[0], doing: string) {
  const target = await rc.h.cardTarget(ref);
  if (isOpResult(target)) return target;
  if (target.local !== undefined || target.row === null || target.ids.card === undefined) {
    return { kind: 'FAIL', code: 'INVALID', text: `Thẻ mới tạo trong cùng lệnh chưa có bình luận nào để ${doing}. Chưa thay đổi gì.` } satisfies OpResolveResult;
  }
  return { ...target, ids: { card: target.ids.card }, row: target.row };
}

/** Binh luan con hieu luc cua the (moi nhat truoc). `mine`: chi cua nguoi dung. */
async function commentPool(cardId: string, userId: string, mine: boolean): Promise<Array<PoolItem & { userId: string; text: string; authorName: string; parentId: string | null }>> {
  const rows = await prisma.comment.findMany({
    where: { cardId, deletedAt: null, ...(mine ? { userId } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 200,
    select: { id: true, text: true, userId: true, parentId: true, user: { select: { name: true } } },
  });
  return rows.map((r) => ({ id: r.id, name: mine ? clip(r.text, 100) : `${r.user.name}: ${clip(r.text, 80)}`, userId: r.userId, text: r.text, authorName: r.user.name, parentId: r.parentId }));
}

async function pickComment(rc: ResolveCtx, cardId: string, cardTitle: string, match: string | undefined, mine: boolean) {
  const pool = await commentPool(cardId, rc.h.userId, mine);
  if (pool.length === 0) {
    return {
      kind: 'FAIL',
      code: 'NOT_FOUND',
      text: mine ? `Bạn chưa có bình luận nào trên thẻ ${q(cardTitle)} (chỉ sửa hoặc xóa được bình luận của chính bạn). Chưa thay đổi gì.` : `Thẻ ${q(cardTitle)} chưa có bình luận nào. Chưa thay đổi gì.`,
    } satisfies OpResolveResult;
  }
  const hit = chooseFrom({ rc, kind: 'comment', scope: cardId, text: match === undefined ? '' : stripLeadingGeneric(match), pool, where: ` trên thẻ ${q(cardTitle)}${mine ? ' (chỉ tính bình luận của bạn)' : ''}` });
  if ('kind' in hit) return hit;
  const full = pool.find((p) => p.id === hit.id);
  if (!full) return { kind: 'FAIL', code: 'NOT_FOUND', text: 'Không còn tìm thấy bình luận đã chọn. Chưa thay đổi gì.' } satisfies OpResolveResult;
  return full;
}

async function commentGuard(g: GuardCtx, op: StoredOp, mine: boolean): Promise<GuardVerdict> {
  const card = await cardGuard(g, op);
  if (!card.ok) return card;
  const row = op.ids.comment === undefined ? null : await prisma.comment.findFirst({ where: { id: op.ids.comment, cardId: op.ids.card, deletedAt: null }, select: { userId: true } });
  if (!row) return fail('NOT_FOUND', `Bình luận này không còn trên thẻ. ${NO_CHANGE}`);
  if (mine && row.userId !== g.userId) return fail('FORBIDDEN', `Chỉ tác giả mới sửa hoặc xóa được bình luận. ${NO_CHANGE}`);
  return { ok: true };
}

const done = (index: number, text: string, extra: Partial<OpOutcome> = {}): OpOutcome => ({ index, text, changed: true, ...extra });

const editComment = defineOp<'EDIT_COMMENT'>({
  type: 'EDIT_COMMENT',
  label: 'sửa bình luận',
  policy: { autoRun: false, confirm: ['TEXT_CONTENT'] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence: (words) => verbThen(words, [...EDIT_VERBS, ['chinh'], ['cap', 'nhat']], COMMENT_NOUNS_VI, [], 4),
  // noi dung moi VA phan chi ra binh luan (match) deu phai la chu nguoi dung go: khong de mo hinh tu chon binh luan nao bi sua
  grounded: (op, words) => allIn([op.text, op.match], words),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'sửa');
    if ('kind' in card) return card;
    const found = await pickComment(rc, card.ids.card, card.title, op.match, true);
    if ('kind' in found) return found;
    const text = op.text.trim();
    return rc.ok({
      type: 'EDIT_COMMENT',
      ids: { card: card.ids.card, comment: found.id },
      params: { text },
      before: { textHash: sha(found.text), text: clip(found.text, 300) },
      display: { cardTitle: card.title },
      ...(found.text.trim() === text ? { noop: `Bình luận đó đã đúng nội dung này rồi.` } : {}),
    });
  },
  async guard(g, op) {
    const base = await commentGuard(g, op, true);
    if (!base.ok) return base;
    const text = String(op.params.text ?? '');
    if (text.trim() === '' || text.length > MAX_TEXT) return fail('INVALID', `Bình luận phải từ 1 đến ${MAX_TEXT} ký tự. ${NO_CHANGE}`);
    return text.includes('@') ? fail('INVALID', `${AT_TEXT} ${NO_CHANGE}`) : { ok: true };
  },
  async verify(tx, ctx, op) {
    await tx.$queryRaw`SELECT id FROM "Comment" WHERE id = ${op.ids.comment} FOR UPDATE`;
    const row = await tx.comment.findFirst({ where: { id: op.ids.comment, cardId: op.ids.card, deletedAt: null }, select: { text: true, userId: true } });
    if (!row || row.userId !== ctx.userId) throw new PlanAbort('STALE', 'Bình luận không còn trên thẻ.');
    if (sha(row.text) !== op.before?.textHash) throw new PlanAbort('STALE', 'Bình luận đã được sửa kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong updateComment: chi doi noi dung, khong Activity / thong bao
    const card = cardOf(state, op);
    await tx.comment.update({ where: { id: op.ids.comment as string }, data: { text: String(op.params.text).trim() } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã sửa bình luận trên thẻ ${q(card.title)}.`, { cardId: card.id });
  },
  describe: (op, index) => ({ index, verb: 'Sửa bình luận', text: `trên thẻ ${q(op.display.cardTitle)}`, detail: `Từ: ${q(clip(String(op.before?.text ?? ''), 200))}\nThành: ${q(clip(String(op.params.text ?? ''), 400))}`, cardId: op.ids.card }),
  summary: (op) => `Đã sửa bình luận trên thẻ ${q(op.display.cardTitle)}.`,
  stale: 'Bình luận đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `comment:${op.ids.comment}`, effect: 'MODIFY' }],
});

const deleteComment = defineOp<'DELETE_COMMENT'>({
  type: 'DELETE_COMMENT',
  label: 'xóa bình luận',
  policy: { autoRun: false, confirm: ['DELETE'] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence: (words) => verbThen(words, REMOVE_OR_DELETE_VERBS, COMMENT_NOUNS_VI, [], 4),
  grounded: (op, words) => allIn([op.match], words),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'xóa');
    if ('kind' in card) return card;
    const found = await pickComment(rc, card.ids.card, card.title, op.match, true);
    if ('kind' in found) return found;
    return rc.ok({
      type: 'DELETE_COMMENT',
      ids: { card: card.ids.card, comment: found.id },
      params: {},
      before: { textHash: sha(found.text), text: clip(found.text, 300) },
      display: { cardTitle: card.title },
    });
  },
  guard: (g, op) => commentGuard(g, op, true),
  async verify(tx, ctx, op) {
    await tx.$queryRaw`SELECT id FROM "Comment" WHERE id = ${op.ids.comment} FOR UPDATE`;
    const row = await tx.comment.findFirst({ where: { id: op.ids.comment, cardId: op.ids.card, deletedAt: null }, select: { text: true, userId: true } });
    if (!row || row.userId !== ctx.userId) throw new PlanAbort('STALE', 'Bình luận không còn trên thẻ.');
    if (sha(row.text) !== op.before?.textHash) throw new PlanAbort('STALE', 'Bình luận đã được sửa kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong deleteComment: xoa mem (cau tra loi cua luong van con)
    const card = cardOf(state, op);
    await tx.comment.update({ where: { id: op.ids.comment as string }, data: { deletedAt: new Date() } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã xóa bình luận trên thẻ ${q(card.title)}.`, { cardId: card.id });
  },
  describe: (op, index) => ({
    index,
    verb: 'Xóa bình luận',
    text: `trên thẻ ${q(op.display.cardTitle)}`,
    detail: `${q(clip(String(op.before?.text ?? ''), 300))}\nBình luận của bạn sẽ biến mất khỏi thẻ và không khôi phục lại được ở giao diện.`,
    cardId: op.ids.card,
    danger: true,
  }),
  summary: (op) => `Đã xóa bình luận trên thẻ ${q(op.display.cardTitle)}.`,
  stale: 'Bình luận đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `comment:${op.ids.comment}`, effect: 'REMOVE' }],
});

const replyComment = defineOp<'REPLY_COMMENT'>({
  type: 'REPLY_COMMENT',
  label: 'trả lời bình luận',
  policy: { autoRun: false, confirm: ['TEXT_CONTENT'] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence: (words) => verbThen(words, REPLY_VERBS, COMMENT_NOUNS_VI, [], 4),
  grounded: (op, words) => allIn([op.text, op.match], words),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'trả lời');
    if ('kind' in card) return card;
    const found = await pickComment(rc, card.ids.card, card.title, op.match, false);
    if ('kind' in found) return found;
    return rc.ok({
      type: 'REPLY_COMMENT',
      ids: { card: card.ids.card, comment: found.id },
      params: { text: op.text.trim() },
      before: { textHash: sha(found.text), text: clip(found.text, 200), authorId: found.userId },
      display: { cardTitle: card.title, authorName: found.authorName },
    });
  },
  async guard(g, op) {
    const base = await commentGuard(g, op, false);
    if (!base.ok) return base;
    const text = String(op.params.text ?? '');
    if (text.trim() === '' || text.length > MAX_TEXT) return fail('INVALID', `Bình luận phải từ 1 đến ${MAX_TEXT} ký tự. ${NO_CHANGE}`);
    return text.includes('@') ? fail('INVALID', `${AT_TEXT} ${NO_CHANGE}`) : { ok: true };
  },
  async verify(tx, _ctx, op) {
    const row = await tx.comment.findFirst({ where: { id: op.ids.comment, cardId: op.ids.card, deletedAt: null }, select: { text: true } });
    if (!row) throw new PlanAbort('STALE', 'Bình luận cần trả lời không còn trên thẻ.');
    if (sha(row.text) !== op.before?.textHash) throw new PlanAbort('STALE', 'Bình luận cần trả lời đã được sửa kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong addComment co parentId: tra loi gan vao binh luan GOC cua luong (mot cap), Activity comment.create, thong bao tra loi + binh luan
    const card = cardOf(state, op);
    const target = await tx.comment.findFirst({ where: { id: op.ids.comment, cardId: card.id, deletedAt: null }, select: { id: true, userId: true, parentId: true } });
    if (!target) throw new PlanAbort('STALE', 'Bình luận cần trả lời không còn trên thẻ.');
    const text = String(op.params.text).trim();
    await tx.comment.create({ data: { cardId: card.id, userId: ctx.userId, text, parentId: target.parentId ?? target.id } });
    await record(tx, ctx, state, effects, { cardId: card.id, type: 'comment.create', data: { text: text.slice(0, 120) } });
    // nguoi viet binh luan duoc tra loi con xem duoc the khong (co the da bi moi ra khoi bang)
    let canView = false;
    try {
      await assertCardView(target.userId, card.id);
      canView = true;
    } catch {
      canView = false;
    }
    const repliedTo = canView ? [target.userId] : [];
    if (repliedTo.length > 0) effects.notifications.push({ type: 'card.comment.reply', actorId: ctx.userId, boardId: ctx.boardId, cardId: card.id, data: { cardTitle: card.title, text: text.slice(0, 120) }, to: { kind: 'USERS', ids: repliedTo } });
    effects.notifications.push({ type: 'card.comment', actorId: ctx.userId, boardId: ctx.boardId, cardId: card.id, data: { cardTitle: card.title, text: text.slice(0, 120) }, to: { kind: 'MEMBERS', cardId: card.id, exclude: repliedTo } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã trả lời bình luận của ${op.display.authorName as string} trên thẻ ${q(card.title)}.`, { cardId: card.id });
  },
  describe: (op, index) => ({
    index,
    verb: 'Trả lời bình luận',
    text: `của ${op.display.authorName as string} trên thẻ ${q(op.display.cardTitle)}`,
    detail: `Bình luận gốc: ${q(clip(String(op.before?.text ?? ''), 150))}\nTrả lời: ${q(clip(String(op.params.text ?? ''), 400))}`,
    cardId: op.ids.card,
  }),
  summary: (op) => `Đã trả lời bình luận trên thẻ ${q(op.display.cardTitle)}.`,
  stale: 'Bình luận cần trả lời đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `comment:${op.ids.comment}`, effect: 'MODIFY' }],
});

export const COMMENT_HANDLERS: AnyHandler[] = [editComment, deleteComment, replyComment];

