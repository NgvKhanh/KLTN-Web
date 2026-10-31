// BUOC G - TEP DINH KEM: gan tep nguoi dung vua chon o khung chat vao the (ADD_ATTACHMENT) va go tep khoi the (DELETE_ATTACHMENT).
// Mo hinh KHONG bao gio chi ra tep hay duong dan: chi CAC TEP NGUOI DUNG DINH KEM VAO CHINH TIN NHAN NAY (kho tam, uploads/chat.uploads) moi duoc gan.
// Ghi giong het cardExtras.service.addAttachment / deleteAttachment: dong Attachment, Activity attachment.add, thong bao card.attachment.added,
// go tep thi bo anh bia neu tep do dang lam anh bia va xoa tep tren dia SAU COMMIT.

import { prisma } from '../../../../../config/prisma';
import { adoptCardAttachmentFile, trustedAttachmentContentType } from '../../../../../config/upload';
import { fail, NO_CHANGE } from '../actions.guard.base';
import { foldWords, stripLeadingGeneric } from '../actions.text';
import type { GuardVerdict, StoredOp } from '../actions.types';
import { cardOf, PlanAbort, record, type OpOutcome } from '../actions.write.base';
import { resolveStaged, stagedPath, type StagedUploadRef } from '../../uploads/chat.uploads';
import { chooseFrom, q } from './ops.common';
import { defineOp, isOpResult, type AnyHandler, type GuardCtx, type OpResolveResult, type ResolveCtx } from './ops.types';
import { CARD_NOUNS, FILE_NOUNS, REMOVE_OR_DELETE_VERBS, verbThen } from './ops.words';

const STRONG_VERBS = [['dinh', 'kem'], ['dinh'], ['upload'], ['tai', 'len'], ['attach'], ['dinh', 'kem', 'vao']] as const;
const WEAK_VERBS = [['gan'], ['them'], ['dua'], ['dat'], ['luu'], ['gui'], ['bo'], ['nem']] as const;
const GLUE = ['vao', 'cho', 'len', 'nay', 'do', 'dang', 'vua', 'moi'] as const;

const formatBytes = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / (1024 * 1024)).toFixed(1)} MB`);

function allIn(texts: ReadonlyArray<string | undefined>, words: readonly string[]): boolean {
  const have = new Set(words);
  return texts.every((t) => t === undefined || foldWords(t).every((w) => have.has(w)));
}
const cardGuard = async (g: GuardCtx, op: StoredOp): Promise<GuardVerdict> => (op.ids.card === undefined ? fail('INVALID', `Thiếu thẻ cần thao tác. ${NO_CHANGE}`) : g.card(op.ids.card));

async function existingCard(rc: ResolveCtx, ref: Parameters<ResolveCtx['h']['cardTarget']>[0], doing: string) {
  const target = await rc.h.cardTarget(ref);
  if (isOpResult(target)) return target;
  if (target.local !== undefined || target.row === null || target.ids.card === undefined) {
    return { kind: 'FAIL', code: 'INVALID', text: `Thẻ mới tạo trong cùng lệnh chưa có tệp nào để ${doing}. Chưa thay đổi gì.` } satisfies OpResolveResult;
  }
  return { ...target, ids: { card: target.ids.card }, row: target.row };
}

const addAttachment = defineOp<'ADD_ATTACHMENT'>({
  type: 'ADD_ATTACHMENT',
  label: 'đính kèm tệp vào thẻ',
  policy: { autoRun: false, confirm: ['FILE'] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence(words) {
    // "dinh kem ... vao the X" (cho phep danh tu the) hoac "them / gan ... TEP vao the X" (bat buoc danh tu tep: "them the X" khong phai dinh kem)
    const strong = verbThen(words, STRONG_VERBS, [...FILE_NOUNS, ...CARD_NOUNS], [], 6, GLUE);
    const weak = verbThen(words, WEAK_VERBS, FILE_NOUNS, [], 4, GLUE);
    return [...new Set([...strong, ...weak])].sort((a, b) => a - b);
  },
  grounded: (op, words) => allIn([op.file], words),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'đính kèm');
    if ('kind' in card) return card;
    const staged = rc.h.uploads;
    if (staged.length === 0) {
      return { kind: 'FAIL', code: 'INVALID', text: 'Bạn chưa đính kèm tệp nào ở khung chat. Hãy bấm nút kẹp giấy để chọn tệp rồi gửi lại lệnh. Chưa thay đổi gì.' };
    }
    let chosen: StagedUploadRef[] = [...staged];
    if (op.file !== undefined) {
      const wanted = foldWords(stripLeadingGeneric(op.file));
      chosen = staged.filter((f) => wanted.every((w) => foldWords(f.name).includes(w)));
      if (chosen.length === 0) return { kind: 'FAIL', code: 'NOT_FOUND', text: `Không thấy tệp “${op.file}” trong các tệp bạn vừa đính kèm (${staged.map((f) => f.name).join(', ')}). Chưa thay đổi gì.` };
    }
    return rc.ok({
      type: 'ADD_ATTACHMENT',
      ids: { card: card.ids.card },
      params: { files: chosen.map((f) => ({ id: f.id, name: f.name, size: f.size, ext: f.ext })) },
      before: { count: chosen.length },
      display: { cardTitle: card.title },
    });
  },
  async guard(g, op) {
    const base = await cardGuard(g, op);
    if (!base.ok) return base;
    const files = (op.params.files ?? []) as StagedUploadRef[];
    if (files.length < 1 || files.length > 5) return fail('INVALID', `Mỗi lần gắn từ 1 đến 5 tệp. ${NO_CHANGE}`);
    try {
      await resolveStaged(g.userId, files.map((f) => f.id), null);
    } catch {
      return fail('NOT_FOUND', `Tệp đính kèm không còn (đã hết hạn hoặc không phải của bạn). Hãy chọn lại tệp và gửi lại lệnh. ${NO_CHANGE}`);
    }
    return { ok: true };
  },
  async verify(_tx, ctx, op) {
    const files = (op.params.files ?? []) as StagedUploadRef[];
    try {
      await resolveStaged(ctx.userId, files.map((f) => f.id), null);
    } catch {
      throw new PlanAbort('STALE', 'Tệp đính kèm đã hết hạn hoặc bị bỏ đi kể từ lúc xem trước.');
    }
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong addAttachment: dong Attachment (uploader = nguoi dung), Activity attachment.add, thong bao card.attachment.added cho thanh vien the
    const card = cardOf(state, op);
    const files = (op.params.files ?? []) as StagedUploadRef[];
    for (const file of files) {
      const adopted = adoptCardAttachmentFile(stagedPath(file.id), file.ext);
      effects.files.adopted.push(adopted.publicPath);
      await tx.attachment.create({
        data: { cardId: card.id, uploaderId: ctx.userId, name: file.name, url: adopted.publicPath, mime: trustedAttachmentContentType(file.name), size: file.size },
      });
      effects.files.release.push(file.id);
      await record(tx, ctx, state, effects, { cardId: card.id, type: 'attachment.add', data: { name: file.name } });
      effects.notifications.push({ type: 'card.attachment.added', actorId: ctx.userId, boardId: ctx.boardId, cardId: card.id, data: { cardTitle: card.title, name: file.name }, to: { kind: 'MEMBERS', cardId: card.id, exclude: [] } });
    }
    effects.boardIds.add(ctx.boardId);
    const names = files.map((f) => q(f.name)).join(', ');
    return { index, text: `Đã đính kèm ${files.length === 1 ? 'tệp' : `${files.length} tệp`} ${names} vào thẻ ${q(card.title)}.`, changed: true, cardId: card.id } satisfies OpOutcome;
  },
  describe: (op, index) => {
    const files = (op.params.files ?? []) as StagedUploadRef[];
    return {
      index,
      verb: 'Đính kèm tệp',
      text: `${files.map((f) => q(f.name)).join(', ')} vào thẻ ${q(op.display.cardTitle)}`,
      detail: files.map((f) => `• ${f.name} (${formatBytes(f.size)})`).join('\n'),
      cardId: op.ids.card,
    };
  },
  summary: (op) => `Đã đính kèm ${((op.params.files ?? []) as StagedUploadRef[]).length} tệp vào thẻ ${q(op.display.cardTitle)}.`,
  stale: 'Tệp đính kèm hoặc thẻ đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `card:${op.ids.card}`, effect: 'MODIFY' }],
});

const deleteAttachment = defineOp<'DELETE_ATTACHMENT'>({
  type: 'DELETE_ATTACHMENT',
  label: 'xóa tệp đính kèm',
  policy: { autoRun: false, confirm: ['DELETE'] },
  slots: (op) => [{ name: 'card', kind: 'card', ref: op.card }],
  withRef: (op, name, ref) => (name === 'card' ? { ...op, card: ref } : op),
  licence(words) {
    return verbThen(words, REMOVE_OR_DELETE_VERBS, [...FILE_NOUNS, ['dinh', 'kem']], [], 4, GLUE);
  },
  grounded: (op, words) => allIn([op.match], words),
  async resolve(rc, op) {
    const card = await existingCard(rc, op.card, 'xóa');
    if ('kind' in card) return card;
    const rows = await prisma.attachment.findMany({ where: { cardId: card.ids.card }, orderBy: { createdAt: 'desc' }, select: { id: true, name: true, size: true, url: true } });
    if (rows.length === 0) return { kind: 'FAIL', code: 'NOT_FOUND', text: `Thẻ ${q(card.title)} chưa có tệp đính kèm nào. Chưa thay đổi gì.` };
    const hit = chooseFrom({ rc, kind: 'attachment', scope: card.ids.card, text: op.match === undefined ? '' : stripLeadingGeneric(op.match), pool: rows.map((r) => ({ id: r.id, name: r.name })), where: ` trên thẻ ${q(card.title)}` });
    if ('kind' in hit) return hit;
    const row = rows.find((r) => r.id === hit.id) as (typeof rows)[number];
    return rc.ok({
      type: 'DELETE_ATTACHMENT',
      ids: { card: card.ids.card, attachment: row.id },
      params: {},
      before: { name: row.name, url: row.url, size: row.size },
      display: { cardTitle: card.title, fileName: row.name },
    });
  },
  async guard(g, op) {
    const base = await cardGuard(g, op);
    if (!base.ok) return base;
    const row = op.ids.attachment === undefined ? null : await prisma.attachment.findFirst({ where: { id: op.ids.attachment, cardId: op.ids.card }, select: { id: true } });
    return row ? { ok: true } : fail('NOT_FOUND', `Tệp đính kèm này không còn trên thẻ. ${NO_CHANGE}`);
  },
  async verify(tx, _ctx, op) {
    await tx.$queryRaw`SELECT id FROM "Attachment" WHERE id = ${op.ids.attachment} FOR UPDATE`;
    const row = await tx.attachment.findFirst({ where: { id: op.ids.attachment, cardId: op.ids.card }, select: { url: true } });
    if (!row) throw new PlanAbort('STALE', 'Tệp đính kèm không còn trên thẻ.');
    if (row.url !== op.before?.url) throw new PlanAbort('STALE', 'Tệp đính kèm đã thay đổi kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, state, effects, index }, op) {
    // giong deleteAttachment: xoa dong, bo anh bia neu tep nay dang lam anh bia; tep tren dia xoa SAU COMMIT
    const card = cardOf(state, op);
    const url = String(op.before?.url ?? '');
    await tx.attachment.delete({ where: { id: op.ids.attachment as string } });
    await tx.card.updateMany({ where: { id: card.id, coverImageUrl: url }, data: { coverImageUrl: null } });
    effects.files.remove.push(url);
    effects.boardIds.add(ctx.boardId);
    return { index, text: `Đã xóa tệp ${q(op.display.fileName as string)} khỏi thẻ ${q(card.title)}.`, changed: true, cardId: card.id };
  },
  describe: (op, index) => ({
    index,
    verb: 'Xóa tệp đính kèm',
    text: `${q(op.display.fileName as string)} trên thẻ ${q(op.display.cardTitle)}`,
    detail: 'Tệp biến mất khỏi thẻ và bị xóa khỏi máy chủ, không khôi phục lại được.',
    cardId: op.ids.card,
    danger: true,
  }),
  summary: (op) => `Đã xóa tệp ${q(op.display.fileName as string)}.`,
  stale: 'Tệp đính kèm đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `attachment:${op.ids.attachment}`, effect: 'REMOVE' }],
});

export const ATTACHMENT_HANDLERS: AnyHandler[] = [addAttachment, deleteAttachment];

