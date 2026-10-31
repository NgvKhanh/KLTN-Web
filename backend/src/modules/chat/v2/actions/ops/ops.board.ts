// BUOC I - QUAN TRI BANG: doi ten, hien thi, sao, luu tru / xoa bang, link moi, nhan (tao / sua / xoa), luat tu dong hoa (bat / tat / xoa), thanh vien
// (them / bo / doi quyen), truong tuy chinh (tao / doi ten / xoa / them lua chon). Ghi giong het service giao dien (board.service, boardMember.service,
// boardShare.service, label.service, automation.service, customField.service). Cac thao tac QUAN TRI (thanh vien, quyen, hien thi, link, luu tru / xoa
// bang) luon xem truoc, rui ro CAO, khong tron voi viec o the / cot (xem actions.graph). Quyen: dung ham assert cua giao dien + kiem lai trong transaction.

import crypto from 'node:crypto';
import { prisma } from '../../../../../config/prisma';
import { removeBoardBackgroundFile } from '../../../../../config/upload';
import { emitToBoard, emitToUser, evictUserFromBoardRoom, reconcileBoardRoomAccess } from '../../../../../realtime/socket';
import { AppError } from '../../../../../utils/AppError';
import { assertBoardManage, assertBoardOwner } from '../../../../board/board.service';
import { fail, NO_CHANGE } from '../actions.guard.base';
import { colorLabel, colorMentioned, COLOR_HEX } from '../actions.palette';
import { CREATE_VERBS, foldWords, hasAny, indexesOfAny, RENAME_VERBS, stripLeadingGeneric, type Phrase } from '../actions.text';
import type { GuardVerdict, StoredOp } from '../actions.types';
import { canManageInTx, isOwnerInTx, PlanAbort, type OpOutcome } from '../actions.write.base';
import { chooseFrom, clip, q, type PoolItem } from './ops.common';
import { defineOp, isOpResult, type AnyHandler, type GuardCtx, type OpResolveResult, type ResolveCtx } from './ops.types';
import { DELETE_VERBS, mentions, ownTexts, verbThen } from './ops.words';

const BOARD_NOUNS: readonly Phrase[] = [['bang'], ['board']];
const LABEL_NOUNS: readonly Phrase[] = [['nhan'], ['label'], ['tag']];
const RULE_NOUNS: readonly Phrase[] = [['luat'], ['quy', 'tac'], ['rule'], ['automation'], ['tu', 'dong', 'hoa']];
const FIELD_NOUNS: readonly Phrase[] = [['truong'], ['field'], ['cot', 'du', 'lieu'], ['thuoc', 'tinh']];
const MEMBER_NOUNS: readonly Phrase[] = [['thanh', 'vien'], ['nguoi'], ['member'], ['quyen']];
const LINK_NOUNS: readonly Phrase[] = [['link'], ['lien', 'ket'], ['duong', 'dan']];
/** Tu dem co the nam giua dong tu va danh tu ("doi ten CUA bang", "tao nhan MOI", "them nguoi VAO bang"). */
const GLUE: readonly string[] = ['cua', 'nay', 'do', 'ten', 'la', 'thanh', 'vao', 'cho', 'moi', 'han', 'sang', 'lam', 'mau'];

const ROLE_VI: Record<string, string> = { ADMIN: 'Quản trị viên', MEMBER: 'Thành viên', VIEWER: 'Chỉ xem', OWNER: 'Chủ bảng' };
const VIS_VI: Record<string, string> = {
  PRIVATE: 'Riêng tư (chỉ thành viên của bảng)',
  WORKSPACE: 'Không gian làm việc (mọi thành viên của không gian)',
  PUBLIC: 'Công khai (ai có link cũng xem được, chỉ đọc)',
};
const FIELD_TYPE_VI: Record<string, string> = { TEXT: 'văn bản', NUMBER: 'số', DATE: 'ngày', CHECKBOX: 'hộp kiểm', DROPDOWN: 'danh sách chọn' };

const done = (index: number, text: string): OpOutcome => ({ index, text, changed: true });
const nameKey = (s: string): string => foldWords(s).join(' ');

function allIn(texts: ReadonlyArray<string | readonly string[] | undefined>, words: readonly string[]): boolean {
  const have = new Set(words);
  return texts.flat().every((t) => t === undefined || foldWords(t).every((w) => have.has(w)));
}

async function boardInfo(boardId: string) {
  return prisma.board.findUniqueOrThrow({ where: { id: boardId }, select: { id: true, name: true, ownerId: true, visibility: true, workspaceId: true, inviteToken: true } });
}

// ---- quyen: cung ham assert cua giao dien; chi doi cau chu cho dung nghia ("khong du quyen QUAN TRI", khong phai "chi xem") ----
async function guardWith(assert: () => Promise<unknown>, forbidden: string): Promise<GuardVerdict> {
  try {
    await assert();
    return { ok: true };
  } catch (e) {
    if (e instanceof AppError && e.statusCode === 404) return fail('NOT_FOUND', `Không tìm thấy bảng này (có thể đã bị xóa hoặc lưu trữ). ${NO_CHANGE}`);
    if (e instanceof AppError && e.statusCode === 403) return fail('FORBIDDEN', `${forbidden} ${NO_CHANGE}`);
    throw e;
  }
}
const manageGuard = (g: GuardCtx): Promise<GuardVerdict> => guardWith(() => assertBoardManage(g.userId, g.boardId), 'Chỉ chủ bảng hoặc quản trị viên mới làm được thao tác này.');
const ownerGuard = (g: GuardCtx): Promise<GuardVerdict> => guardWith(() => assertBoardOwner(g.userId, g.boardId), 'Chỉ chủ bảng mới làm được thao tác này.');

// ---------------------------------------------------------------------------------------------------------------------
// Bang
// ---------------------------------------------------------------------------------------------------------------------

const renameBoard = defineOp<'RENAME_BOARD'>({
  type: 'RENAME_BOARD',
  label: 'đổi tên bảng',
  policy: { autoRun: false, confirm: ['NEW_STRUCTURE'] },
  slots: () => [],
  withRef: (op) => op,
  licence: (words) => verbThen(words, RENAME_VERBS, BOARD_NOUNS, [], 4, GLUE),
  grounded: (op, words) => allIn([op.name], words),
  async resolve(rc, op) {
    const board = await boardInfo(rc.h.boardId);
    const name = op.name.trim();
    return rc.ok({
      type: 'RENAME_BOARD',
      ids: {},
      params: { name },
      before: { name: board.name },
      display: { boardName: board.name },
      ...(board.name === name ? { noop: `Bảng đã có tên “${name}” rồi.` } : {}),
    });
  },
  async guard(_g, op) {
    const name = String(op.params.name ?? '');
    return name.trim() === '' || name.length > 100 ? fail('INVALID', `Tên bảng phải từ 1 đến 100 ký tự. ${NO_CHANGE}`) : { ok: true };
  },
  async verify(tx, ctx, op) {
    const row = await tx.board.findFirst({ where: { id: ctx.boardId }, select: { name: true } });
    if (row?.name !== op.before?.name) throw new PlanAbort('STALE', 'Bảng đã được đổi tên kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, effects, index }, op) {
    // giong updateBoard({ name }): chi doi ten; bao realtime "board:meta-changed"
    await tx.board.update({ where: { id: ctx.boardId }, data: { name: String(op.params.name) } });
    effects.afterCommit.push(() => emitToBoard(ctx.boardId, 'board:meta-changed'));
    return done(index, `Đã đổi tên bảng ${q(String(op.before?.name))} thành ${q(String(op.params.name))}.`);
  },
  describe: (op, index) => ({ index, verb: 'Đổi tên bảng', text: `${q(String(op.before?.name ?? ''))} → ${q(String(op.params.name ?? ''))}` }),
  summary: (op) => `Đã đổi tên bảng thành ${q(String(op.params.name ?? ''))}.`,
  stale: 'Bảng đã thay đổi kể từ lúc xem trước.',
  targets: () => [{ key: 'board:meta', effect: 'MODIFY' }],
});

const VISIBILITY_CUES: Record<string, readonly Phrase[]> = {
  PRIVATE: [['rieng', 'tu'], ['private'], ['chi', 'thanh', 'vien']],
  WORKSPACE: [['khong', 'gian'], ['workspace'], ['nhom']],
  PUBLIC: [['cong', 'khai'], ['public'], ['ai', 'co', 'link'], ['moi', 'nguoi']],
};

const setVisibility = defineOp<'SET_BOARD_VISIBILITY'>({
  type: 'SET_BOARD_VISIBILITY',
  label: 'đổi chế độ hiển thị của bảng',
  policy: { autoRun: false, confirm: ['ADMIN'], admin: true },
  slots: () => [],
  withRef: (op) => op,
  licence: (words, op) =>
    hasAny(words, VISIBILITY_CUES[op.visibility] ?? [])
      ? verbThen(words, [['doi'], ['dat'], ['chuyen'], ['cho'], ['dua'], ['cap', 'nhat'], ['chinh'], ['sua'], ['bat'], ['mo']], [...BOARD_NOUNS, ['hien', 'thi'], ['che', 'do'], ['rieng', 'tu'], ['cong', 'khai'], ['public'], ['private']], [], 6, GLUE)
      : [],
  async resolve(rc, op) {
    const board = await boardInfo(rc.h.boardId);
    return rc.ok({
      type: 'SET_BOARD_VISIBILITY',
      ids: {},
      params: { visibility: op.visibility },
      before: { visibility: board.visibility },
      display: { boardName: board.name },
      ...(board.visibility === op.visibility ? { noop: `Bảng ${q(board.name)} đã ở chế độ này rồi.` } : {}),
    });
  },
  guard: (g) => manageGuard(g),
  async verify(tx, ctx, op) {
    if (!(await canManageInTx(tx, ctx.boardId, ctx.userId))) throw new PlanAbort('FORBIDDEN', 'Bạn không còn quyền quản trị bảng này.');
    const row = await tx.board.findFirst({ where: { id: ctx.boardId }, select: { visibility: true } });
    if (row?.visibility !== op.before?.visibility) throw new PlanAbort('STALE', 'Chế độ hiển thị của bảng đã thay đổi kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, effects, index }, op) {
    // giong updateBoard({ visibility }): doi che do, bao realtime; thanh vien khong gian nhan "board:access-changed"; don nguoi mat quyen xem khoi phong socket
    const board = await tx.board.findUniqueOrThrow({ where: { id: ctx.boardId }, select: { workspaceId: true } });
    await tx.board.update({ where: { id: ctx.boardId }, data: { visibility: op.params.visibility as 'PRIVATE' | 'WORKSPACE' | 'PUBLIC' } });
    const wsMembers = await tx.workspaceMember.findMany({ where: { workspaceId: board.workspaceId, deletedAt: null }, select: { userId: true } });
    effects.afterCommit.push(async () => {
      emitToBoard(ctx.boardId, 'board:meta-changed');
      for (const m of wsMembers) emitToUser(m.userId, 'board:access-changed');
      await reconcileBoardRoomAccess(ctx.boardId);
    });
    return done(index, `Đã đổi chế độ hiển thị của bảng thành “${VIS_VI[String(op.params.visibility)] ?? String(op.params.visibility)}”.`);
  },
  describe: (op, index) => ({
    index,
    verb: 'Đổi chế độ hiển thị',
    text: `bảng ${q(op.display.boardName as string)}`,
    detail: `${VIS_VI[String(op.before?.visibility ?? '')] ?? ''} → ${VIS_VI[String(op.params.visibility ?? '')] ?? ''}`,
  }),
  summary: (op) => `Đã đổi chế độ hiển thị của bảng thành ${VIS_VI[String(op.params.visibility)] ?? ''}.`,
  stale: 'Chế độ hiển thị của bảng đã thay đổi kể từ lúc xem trước.',
  targets: () => [{ key: 'board:visibility', effect: 'MODIFY' }],
});

const STAR_WORDS: readonly Phrase[] = [['sao'], ['star'], ['unstar'], ['yeu', 'thich']];

const starBoard = defineOp<'STAR_BOARD'>({
  type: 'STAR_BOARD',
  label: 'gắn sao bảng',
  policy: { autoRun: true, confirm: [] },
  slots: () => [],
  withRef: (op) => op,
  // "sao" tran = dau sao; "sao chep" (copy) va "tai sao" (why) khong phai
  licence(words) {
    const star = indexesOfAny(words, STAR_WORDS).filter((i) => words[i + 1] !== 'chep' && words[i - 1] !== 'tai');
    if (star.length === 0 || !mentions(words, BOARD_NOUNS)) return [];
    return indexesOfAny(words, [['gan'], ['dat'], ['danh', 'dau'], ['bo'], ['xoa'], ['go'], ['them'], ['star'], ['unstar'], ['yeu', 'thich'], ['cho']]);
  },
  async resolve(rc, op) {
    const starred = op.starred !== false;
    const board = await boardInfo(rc.h.boardId);
    const has = (await prisma.boardStar.count({ where: { userId: rc.h.userId, boardId: rc.h.boardId } })) > 0;
    return rc.ok({
      type: 'STAR_BOARD',
      ids: {},
      params: { starred },
      before: { starred: has },
      display: { boardName: board.name },
      ...(has === starred ? { noop: starred ? `Bảng ${q(board.name)} đã có sao rồi.` : `Bảng ${q(board.name)} chưa có sao nên không cần bỏ.` } : {}),
    });
  },
  guard: async () => ({ ok: true }),
  async apply({ tx, ctx, index }, op) {
    // giong setBoardStar: dong BoardStar rieng cua nguoi dung
    if (op.params.starred === true) {
      await tx.boardStar.upsert({ where: { userId_boardId: { userId: ctx.userId, boardId: ctx.boardId } }, create: { userId: ctx.userId, boardId: ctx.boardId }, update: {} });
    } else {
      await tx.boardStar.deleteMany({ where: { userId: ctx.userId, boardId: ctx.boardId } });
    }
    return done(index, op.params.starred === true ? `Đã gắn sao cho bảng ${q(op.display.boardName as string)}.` : `Đã bỏ sao của bảng ${q(op.display.boardName as string)}.`);
  },
  describe: (op, index) => ({ index, verb: op.params.starred === true ? 'Gắn sao bảng' : 'Bỏ sao bảng', text: q(op.display.boardName as string) }),
  summary: (op) => (op.params.starred === true ? 'Đã gắn sao cho bảng.' : 'Đã bỏ sao của bảng.'),
  stale: 'Trạng thái sao đã thay đổi kể từ lúc xem trước.',
  targets: () => [{ key: 'board:star', effect: 'MODIFY' }],
});

/** Luu tru / xoa bang: nguoi dung phai GO DUNG ten bang (khong "bang nay"), de mot cau mo ho khong the dan toi viec khong hoan tac duoc. */
async function typedBoardName(rc: ResolveCtx, confirmName: string, doing: string): Promise<{ id: string; name: string } | OpResolveResult> {
  const board = await boardInfo(rc.h.boardId);
  if (nameKey(confirmName) !== nameKey(board.name)) {
    return { kind: 'FAIL', code: 'INVALID', text: `Để ${doing}, hãy nêu ĐÚNG tên bảng: “${board.name}”. Chưa thay đổi gì.` };
  }
  return { id: board.id, name: board.name };
}

const archiveBoard = defineOp<'ARCHIVE_BOARD'>({
  type: 'ARCHIVE_BOARD',
  label: 'lưu trữ bảng',
  policy: { autoRun: false, confirm: ['ADMIN', 'ARCHIVE'], admin: true },
  slots: () => [],
  withRef: (op) => op,
  licence: (words) => verbThen(words, [['luu', 'tru'], ['archive'], ['cat', 'vao', 'kho']], BOARD_NOUNS, [], 4, GLUE),
  grounded: (op, words) => allIn([op.confirmName], words),
  async resolve(rc, op) {
    const board = await typedBoardName(rc, op.confirmName, 'lưu trữ bảng');
    if ('kind' in board) return board;
    return rc.ok({ type: 'ARCHIVE_BOARD', ids: {}, params: {}, before: { name: board.name }, display: { boardName: board.name } });
  },
  guard: (g) => ownerGuard(g),
  async verify(tx, ctx, op) {
    if (!(await isOwnerInTx(tx, ctx.boardId, ctx.userId))) throw new PlanAbort('FORBIDDEN', 'Chỉ chủ bảng mới lưu trữ được bảng.');
    const row = await tx.board.findFirst({ where: { id: ctx.boardId }, select: { name: true } });
    if (row?.name !== op.before?.name) throw new PlanAbort('STALE', 'Bảng đã được đổi tên kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, effects, index }, op) {
    // giong archiveBoard: dat archivedAt; moi thanh vien dang mo bang bi day ve trang chu
    const members = await tx.boardMember.findMany({ where: { boardId: ctx.boardId, deletedAt: null }, select: { userId: true } });
    await tx.board.update({ where: { id: ctx.boardId }, data: { archivedAt: new Date() } });
    effects.afterCommit.push(() => {
      for (const m of members) emitToUser(m.userId, 'board:removed', { boardId: ctx.boardId });
    });
    return done(index, `Đã lưu trữ bảng ${q(op.display.boardName as string)}. Chủ bảng khôi phục lại được ở mục bảng đã lưu trữ.`);
  },
  describe: (op, index) => ({
    index,
    verb: 'Lưu trữ bảng',
    text: q(op.display.boardName as string),
    detail: 'Bảng biến mất khỏi danh sách của mọi thành viên cho tới khi chủ bảng khôi phục.',
  }),
  summary: (op) => `Đã lưu trữ bảng ${q(op.display.boardName as string)}.`,
  stale: 'Bảng đã thay đổi kể từ lúc xem trước.',
  targets: () => [{ key: 'board:whole', effect: 'REMOVE' }],
});

const deleteBoard = defineOp<'DELETE_BOARD'>({
  type: 'DELETE_BOARD',
  label: 'xóa bảng',
  policy: { autoRun: false, confirm: ['ADMIN', 'DELETE'], admin: true },
  slots: () => [],
  withRef: (op) => op,
  licence: (words) => verbThen(words, DELETE_VERBS, BOARD_NOUNS, [], 4, GLUE),
  grounded: (op, words) => allIn([op.confirmName], words),
  async resolve(rc, op) {
    const board = await typedBoardName(rc, op.confirmName, 'xóa bảng');
    if ('kind' in board) return board;
    const [lists, cards] = await Promise.all([
      prisma.list.count({ where: { boardId: board.id, deletedAt: null } }),
      prisma.card.count({ where: { list: { boardId: board.id, deletedAt: null }, deletedAt: null } }),
    ]);
    return rc.ok({ type: 'DELETE_BOARD', ids: {}, params: {}, before: { name: board.name }, display: { boardName: board.name, lists, cards } });
  },
  guard: (g) => ownerGuard(g),
  async verify(tx, ctx, op) {
    if (!(await isOwnerInTx(tx, ctx.boardId, ctx.userId))) throw new PlanAbort('FORBIDDEN', 'Chỉ chủ bảng mới xóa được bảng.');
    const row = await tx.board.findFirst({ where: { id: ctx.boardId }, select: { name: true } });
    if (row?.name !== op.before?.name) throw new PlanAbort('STALE', 'Bảng đã được đổi tên kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, effects, index }, op) {
    // giong deleteBoard: xoa mem + go anh nen SAU commit. Them: bao moi thanh vien dang mo bang ve trang chu (giao dien tu dieu huong sau khi xoa, o day thi khong)
    const board = await tx.board.findUniqueOrThrow({ where: { id: ctx.boardId }, select: { backgroundImage: true } });
    const members = await tx.boardMember.findMany({ where: { boardId: ctx.boardId, deletedAt: null }, select: { userId: true } });
    await tx.board.update({ where: { id: ctx.boardId }, data: { deletedAt: new Date() } });
    effects.afterCommit.push(() => {
      removeBoardBackgroundFile(board.backgroundImage);
      for (const m of members) emitToUser(m.userId, 'board:removed', { boardId: ctx.boardId });
    });
    return done(index, `Đã xóa bảng ${q(op.display.boardName as string)}.`);
  },
  describe: (op, index) => ({
    index,
    verb: 'Xóa bảng',
    text: q(op.display.boardName as string),
    detail: `Bảng cùng ${op.display.lists as number} cột và ${op.display.cards as number} thẻ biến mất với MỌI thành viên và không khôi phục lại được ở giao diện (muốn giữ lại thì dùng lưu trữ bảng).`,
    danger: true,
  }),
  summary: (op) => `Đã xóa bảng ${q(op.display.boardName as string)}.`,
  stale: 'Bảng đã thay đổi kể từ lúc xem trước.',
  targets: () => [{ key: 'board:whole', effect: 'REMOVE' }],
});

const setInviteLink = defineOp<'SET_INVITE_LINK'>({
  type: 'SET_INVITE_LINK',
  label: 'bật hoặc tắt link mời',
  policy: { autoRun: false, confirm: ['ADMIN'], admin: true },
  slots: () => [],
  withRef: (op) => op,
  licence: (words, op) =>
    verbThen(words, op.enabled ? [['bat'], ['tao'], ['mo'], ['kich', 'hoat'], ['cap']] : [['tat'], ['thu', 'hoi'], ['huy'], ['xoa'], ['vo', 'hieu'], ['dong'], ['ngung']], LINK_NOUNS, [], 4, GLUE),
  async resolve(rc, op) {
    const board = await boardInfo(rc.h.boardId);
    const has = board.inviteToken !== null;
    return rc.ok({
      type: 'SET_INVITE_LINK',
      ids: {},
      params: { enabled: op.enabled },
      before: { enabled: has },
      display: { boardName: board.name },
      ...(has === op.enabled ? { noop: op.enabled ? `Link mời của bảng ${q(board.name)} đang bật rồi.` : `Link mời của bảng ${q(board.name)} đang tắt rồi.` } : {}),
    });
  },
  guard: (g) => manageGuard(g),
  async verify(tx, ctx, op) {
    if (!(await canManageInTx(tx, ctx.boardId, ctx.userId))) throw new PlanAbort('FORBIDDEN', 'Bạn không còn quyền quản trị bảng này.');
    const row = await tx.board.findFirst({ where: { id: ctx.boardId }, select: { inviteToken: true } });
    if ((row?.inviteToken !== null) !== (op.before?.enabled === true)) throw new PlanAbort('STALE', 'Link mời của bảng đã thay đổi kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, index }, op) {
    // giong createInviteToken / disableInviteToken; token KHONG hien trong chat (xem va sao chep o nut Chia se cua bang)
    if (op.params.enabled === true) {
      let token = '';
      for (let i = 0; i < 5; i += 1) {
        token = crypto.randomBytes(15).toString('base64url');
        if ((await tx.board.count({ where: { inviteToken: token } })) === 0) break;
      }
      await tx.board.update({ where: { id: ctx.boardId }, data: { inviteToken: token } });
      return done(index, 'Đã bật link mời. Xem và sao chép link ở nút Chia sẻ của bảng.');
    }
    await tx.board.update({ where: { id: ctx.boardId }, data: { inviteToken: null } });
    return done(index, 'Đã tắt link mời: link đã chia sẻ trước đó không còn dùng được.');
  },
  describe: (op, index) => ({
    index,
    verb: op.params.enabled === true ? 'Bật link mời' : 'Tắt link mời',
    text: `bảng ${q(op.display.boardName as string)}`,
    detail: op.params.enabled === true ? 'Ai có link đều gửi được yêu cầu tham gia bảng.' : 'Link đã chia sẻ trước đó sẽ không còn dùng được.',
  }),
  summary: (op) => (op.params.enabled === true ? 'Đã bật link mời của bảng.' : 'Đã tắt link mời của bảng.'),
  stale: 'Link mời của bảng đã thay đổi kể từ lúc xem trước.',
  targets: () => [{ key: 'board:invite', effect: 'MODIFY' }],
});

// ---------------------------------------------------------------------------------------------------------------------
// Nhan
// ---------------------------------------------------------------------------------------------------------------------

const createLabel = defineOp<'CREATE_LABEL'>({
  type: 'CREATE_LABEL',
  label: 'tạo nhãn',
  policy: { autoRun: false, confirm: ['NEW_STRUCTURE'] },
  slots: () => [],
  withRef: (op) => op,
  licence: (words) => verbThen(words, CREATE_VERBS, LABEL_NOUNS, [], 4, GLUE),
  grounded: (op, words) => allIn([op.name], words) && colorMentioned(op.color, words),
  async resolve(rc, op) {
    const name = op.name.trim();
    const existing = await prisma.label.findMany({ where: { boardId: rc.h.boardId }, select: { name: true } });
    return rc.ok({
      type: 'CREATE_LABEL',
      ids: {},
      params: { name, color: COLOR_HEX[op.color] },
      before: null,
      display: { labelName: name, colorName: colorLabel(COLOR_HEX[op.color]) },
      ...(existing.some((l) => nameKey(l.name) === nameKey(name)) ? { noop: `Bảng đã có nhãn ${q(name)} rồi.` } : {}),
    });
  },
  async guard(_g, op) {
    const name = String(op.params.name ?? '');
    return name.length < 1 || name.length > 50 ? fail('INVALID', `Tên nhãn phải từ 1 đến 50 ký tự. ${NO_CHANGE}`) : { ok: true };
  },
  async apply({ tx, ctx, effects, index }, op) {
    // giong createLabel: mot dong Label moi (ten da cat khoang trang), bao realtime
    await tx.label.create({ data: { boardId: ctx.boardId, name: String(op.params.name), color: String(op.params.color) } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã tạo nhãn ${q(String(op.params.name))} màu ${op.display.colorName as string}.`);
  },
  describe: (op, index) => ({ index, verb: 'Tạo nhãn', text: q(String(op.params.name ?? '')), detail: `Màu ${op.display.colorName as string}` }),
  summary: (op) => `Đã tạo nhãn ${q(String(op.params.name ?? ''))}.`,
  stale: 'Nhãn của bảng đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `label:new:${nameKey(String(op.params.name ?? ''))}`, effect: 'MODIFY' }],
});

const updateLabel = defineOp<'UPDATE_LABEL'>({
  type: 'UPDATE_LABEL',
  label: 'sửa nhãn',
  policy: { autoRun: false, confirm: ['TEXT_CONTENT'] },
  slots: (op) => [{ name: 'label', kind: 'label', ref: op.label }],
  withRef: (op, name, ref) => (name === 'label' ? { ...op, label: ref } : op),
  licence: (words) => verbThen(words, [...RENAME_VERBS, ['doi'], ['sua'], ['dat'], ['cap', 'nhat'], ['chinh']], LABEL_NOUNS, [], 4, GLUE),
  grounded: (op, words) => allIn([op.name], words) && (op.color === undefined || colorMentioned(op.color, words)),
  async resolve(rc, op) {
    if (op.name === undefined && op.color === undefined) return { kind: 'FAIL', code: 'INVALID', text: 'Cần nói rõ đổi tên hay đổi màu nhãn. Chưa thay đổi gì.' };
    const label = await rc.h.pick('label', op.label);
    if (isOpResult(label)) return label;
    const row = await prisma.label.findFirst({ where: { id: label.id, boardId: rc.h.boardId }, select: { name: true, color: true } });
    if (!row) return { kind: 'FAIL', code: 'NOT_FOUND', text: 'Nhãn không còn trong bảng. Chưa thay đổi gì.' };
    const name = op.name?.trim();
    const color = op.color !== undefined ? COLOR_HEX[op.color] : undefined;
    const same = (name === undefined || name === row.name) && (color === undefined || color.toLowerCase() === row.color.toLowerCase());
    const shown = row.name !== '' ? row.name : colorLabel(row.color);
    return rc.ok({
      type: 'UPDATE_LABEL',
      ids: { label: label.id },
      params: { ...(name !== undefined ? { name } : {}), ...(color !== undefined ? { color } : {}) },
      before: { name: row.name, color: row.color },
      display: { labelName: shown },
      ...(same ? { noop: `Nhãn ${q(shown)} đã đúng như vậy rồi.` } : {}),
    });
  },
  async guard(g, op) {
    const row = op.ids.label === undefined ? null : await prisma.label.findFirst({ where: { id: op.ids.label, boardId: g.boardId }, select: { id: true } });
    if (!row) return fail('NOT_FOUND', `Nhãn này không còn thuộc bảng. ${NO_CHANGE}`);
    const name = op.params.name as string | undefined;
    return name !== undefined && (name.length < 1 || name.length > 50) ? fail('INVALID', `Tên nhãn phải từ 1 đến 50 ký tự. ${NO_CHANGE}`) : { ok: true };
  },
  async verify(tx, ctx, op) {
    const row = await tx.label.findFirst({ where: { id: op.ids.label, boardId: ctx.boardId }, select: { name: true, color: true } });
    if (!row) throw new PlanAbort('STALE', 'Nhãn không còn trong bảng.');
    if (row.name !== op.before?.name || row.color !== op.before?.color) throw new PlanAbort('STALE', 'Nhãn đã thay đổi kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, effects, index }, op) {
    // giong updateLabel: chi doi ten va / hoac mau
    await tx.label.update({
      where: { id: op.ids.label as string },
      data: { ...(op.params.name !== undefined ? { name: String(op.params.name) } : {}), ...(op.params.color !== undefined ? { color: String(op.params.color) } : {}) },
    });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã sửa nhãn ${q(op.display.labelName as string)}.`);
  },
  describe: (op, index) => ({
    index,
    verb: 'Sửa nhãn',
    text: q(op.display.labelName as string),
    detail: [
      op.params.name !== undefined ? `Tên: ${q(String(op.before?.name ?? ''))} → ${q(String(op.params.name))}` : '',
      op.params.color !== undefined ? `Màu: ${colorLabel(String(op.before?.color ?? ''))} → ${colorLabel(String(op.params.color))}` : '',
    ]
      .filter((l) => l !== '')
      .join('\n'),
  }),
  summary: (op) => `Đã sửa nhãn ${q(op.display.labelName as string)}.`,
  stale: 'Nhãn đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `label:${op.ids.label}`, effect: 'MODIFY' }],
});

const deleteLabel = defineOp<'DELETE_LABEL'>({
  type: 'DELETE_LABEL',
  label: 'xóa nhãn khỏi bảng',
  policy: { autoRun: false, confirm: ['DELETE'] },
  slots: (op) => [{ name: 'label', kind: 'label', ref: op.label }],
  withRef: (op, name, ref) => (name === 'label' ? { ...op, label: ref } : op),
  // "xoa nhan Gap khoi THE Login" la go nhan khoi mot the (REMOVE_LABEL), khong phai xoa nhan khoi bang
  licence: (words) => (mentions(words, [['khoi', 'the'], ['tren', 'the'], ['o', 'the']]) ? [] : verbThen(words, DELETE_VERBS, LABEL_NOUNS, [], 4, GLUE)),
  async resolve(rc, op) {
    const label = await rc.h.pick('label', op.label);
    if (isOpResult(label)) return label;
    const cards = await prisma.cardLabel.count({ where: { labelId: label.id, card: { deletedAt: null } } });
    return rc.ok({ type: 'DELETE_LABEL', ids: { label: label.id }, params: {}, before: { name: label.name }, display: { labelName: label.name, cards } });
  },
  async guard(g, op) {
    const row = op.ids.label === undefined ? null : await prisma.label.findFirst({ where: { id: op.ids.label, boardId: g.boardId }, select: { id: true } });
    return row ? { ok: true } : fail('NOT_FOUND', `Nhãn này không còn thuộc bảng. ${NO_CHANGE}`);
  },
  async verify(tx, ctx, op) {
    const row = await tx.label.findFirst({ where: { id: op.ids.label, boardId: ctx.boardId }, select: { id: true } });
    if (!row) throw new PlanAbort('STALE', 'Nhãn không còn trong bảng.');
  },
  async apply({ tx, ctx, effects, index }, op) {
    // giong deleteLabel: xoa han nhan (cac the dang gan nhan mat nhan)
    await tx.label.delete({ where: { id: op.ids.label as string } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã xóa nhãn ${q(op.display.labelName as string)} khỏi bảng.`);
  },
  describe: (op, index) => ({
    index,
    verb: 'Xóa nhãn khỏi bảng',
    text: q(op.display.labelName as string),
    detail: `Nhãn biến mất khỏi CẢ BẢNG${typeof op.display.cards === 'number' && op.display.cards > 0 ? ` và khỏi ${op.display.cards} thẻ đang gắn nhãn` : ''}; không khôi phục lại được.`,
    danger: true,
  }),
  summary: (op) => `Đã xóa nhãn ${q(op.display.labelName as string)}.`,
  stale: 'Nhãn đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `label:${op.ids.label}`, effect: 'REMOVE' }],
});

// ---------------------------------------------------------------------------------------------------------------------
// Luat tu dong hoa (bat / tat / xoa luat co san; tao luat moi da co o Phase 7)
// ---------------------------------------------------------------------------------------------------------------------

async function pickRule(rc: ResolveCtx, match: string | undefined) {
  const rules = await prisma.automationRule.findMany({ where: { boardId: rc.h.boardId }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, isEnabled: true } });
  if (rules.length === 0) return { kind: 'FAIL', code: 'NOT_FOUND', text: 'Bảng này chưa có luật tự động hóa nào. Chưa thay đổi gì.' } satisfies OpResolveResult;
  const pool: PoolItem[] = rules.map((r) => ({ id: r.id, name: r.name }));
  const hit = chooseFrom({ rc, kind: 'rule', scope: rc.h.boardId, text: stripLeadingGeneric(match ?? ''), pool, where: ' của bảng' });
  if ('kind' in hit) return hit;
  return rules.find((r) => r.id === hit.id) as (typeof rules)[number];
}

const toggleRule = defineOp<'TOGGLE_AUTOMATION_RULE'>({
  type: 'TOGGLE_AUTOMATION_RULE',
  label: 'bật hoặc tắt luật tự động hóa',
  policy: { autoRun: false, confirm: ['STANDING_RULE'] },
  slots: () => [],
  withRef: (op) => op,
  licence: (words, op) => verbThen(words, op.enabled ? [['bat'], ['kich', 'hoat'], ['mo'], ['cho', 'chay']] : [['tat'], ['dung'], ['ngung'], ['vo', 'hieu']], RULE_NOUNS, [], 4, GLUE),
  grounded: (op, words) => allIn([op.match], words),
  async resolve(rc, op) {
    const rule = await pickRule(rc, op.match);
    if ('kind' in rule) return rule;
    return rc.ok({
      type: 'TOGGLE_AUTOMATION_RULE',
      ids: { rule: rule.id },
      params: { enabled: op.enabled },
      before: { enabled: rule.isEnabled, name: rule.name },
      display: { ruleName: rule.name },
      ...(rule.isEnabled === op.enabled ? { noop: op.enabled ? `Luật ${q(rule.name)} đang bật rồi.` : `Luật ${q(rule.name)} đang tắt rồi.` } : {}),
    });
  },
  async guard(g, op) {
    const row = op.ids.rule === undefined ? null : await prisma.automationRule.findFirst({ where: { id: op.ids.rule, boardId: g.boardId }, select: { id: true } });
    return row ? { ok: true } : fail('NOT_FOUND', `Luật này không còn trong bảng. ${NO_CHANGE}`);
  },
  async verify(tx, ctx, op) {
    const row = await tx.automationRule.findFirst({ where: { id: op.ids.rule, boardId: ctx.boardId }, select: { isEnabled: true } });
    if (!row) throw new PlanAbort('STALE', 'Luật không còn trong bảng.');
    if (row.isEnabled !== (op.before?.enabled === true)) throw new PlanAbort('STALE', 'Trạng thái của luật đã thay đổi kể từ lúc xem trước.');
  },
  async apply({ tx, index }, op) {
    // giong updateAutomationRule({ isEnabled }): chi doi co bat / tat
    await tx.automationRule.update({ where: { id: op.ids.rule as string }, data: { isEnabled: op.params.enabled === true } });
    return done(index, op.params.enabled === true ? `Đã bật luật ${q(op.display.ruleName as string)}.` : `Đã tắt luật ${q(op.display.ruleName as string)}.`);
  },
  describe: (op, index) => ({
    index,
    verb: op.params.enabled === true ? 'Bật luật tự động hóa' : 'Tắt luật tự động hóa',
    text: q(op.display.ruleName as string),
    detail: op.params.enabled === true ? 'Luật chạy lại mỗi khi điều kiện xảy ra, bằng quyền của người đã tạo luật.' : 'Luật ngừng chạy cho tới khi được bật lại.',
  }),
  summary: (op) => (op.params.enabled === true ? `Đã bật luật ${q(op.display.ruleName as string)}.` : `Đã tắt luật ${q(op.display.ruleName as string)}.`),
  stale: 'Luật đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `rule:${op.ids.rule}`, effect: 'MODIFY' }],
});

const deleteRule = defineOp<'DELETE_AUTOMATION_RULE'>({
  type: 'DELETE_AUTOMATION_RULE',
  label: 'xóa luật tự động hóa',
  policy: { autoRun: false, confirm: ['DELETE', 'STANDING_RULE'] },
  slots: () => [],
  withRef: (op) => op,
  licence: (words) => verbThen(words, DELETE_VERBS, RULE_NOUNS, [], 4, GLUE),
  grounded: (op, words) => allIn([op.match], words),
  async resolve(rc, op) {
    const rule = await pickRule(rc, op.match);
    if ('kind' in rule) return rule;
    return rc.ok({ type: 'DELETE_AUTOMATION_RULE', ids: { rule: rule.id }, params: {}, before: { name: rule.name }, display: { ruleName: rule.name } });
  },
  async guard(g, op) {
    const row = op.ids.rule === undefined ? null : await prisma.automationRule.findFirst({ where: { id: op.ids.rule, boardId: g.boardId }, select: { id: true } });
    return row ? { ok: true } : fail('NOT_FOUND', `Luật này không còn trong bảng. ${NO_CHANGE}`);
  },
  async verify(tx, ctx, op) {
    const row = await tx.automationRule.findFirst({ where: { id: op.ids.rule, boardId: ctx.boardId }, select: { id: true } });
    if (!row) throw new PlanAbort('STALE', 'Luật không còn trong bảng.');
  },
  async apply({ tx, index }, op) {
    // giong deleteAutomationRule: xoa luat (cung cac hanh dong cua no)
    await tx.automationRule.delete({ where: { id: op.ids.rule as string } });
    return done(index, `Đã xóa luật ${q(op.display.ruleName as string)}.`);
  },
  describe: (op, index) => ({ index, verb: 'Xóa luật tự động hóa', text: q(op.display.ruleName as string), detail: 'Luật biến mất khỏi bảng và không khôi phục lại được.', danger: true }),
  summary: (op) => `Đã xóa luật ${q(op.display.ruleName as string)}.`,
  stale: 'Luật đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `rule:${op.ids.rule}`, effect: 'REMOVE' }],
});

// ---------------------------------------------------------------------------------------------------------------------
// Thanh vien bang
// ---------------------------------------------------------------------------------------------------------------------

const ROLE_CUES: Record<string, readonly Phrase[]> = {
  ADMIN: [['quan', 'tri'], ['admin']],
  MEMBER: [['thanh', 'vien'], ['member'], ['binh', 'thuong']],
  VIEWER: [['chi', 'xem'], ['viewer'], ['xem'], ['quan', 'sat']],
};

const addMember = defineOp<'ADD_BOARD_MEMBER'>({
  type: 'ADD_BOARD_MEMBER',
  label: 'thêm thành viên vào bảng',
  policy: { autoRun: false, confirm: ['ADMIN'], admin: true },
  slots: () => [],
  withRef: (op) => op,
  // email la cua CHINH nguoi dung go; cau phai noi toi bang / thanh vien
  licence: (words, op) =>
    mentions(words, [...BOARD_NOUNS, ...MEMBER_NOUNS])
      ? verbThen(words, [...CREATE_VERBS, ['moi'], ['cho'], ['add'], ['invite']], [...MEMBER_NOUNS, ...BOARD_NOUNS], [op.email], 6, [...GLUE, 'ho', 'tai', 'khoan', 'email'])
      : [],
  grounded: (op, words) => allIn([op.email.split(/[@.]/)], words) && (op.role === undefined || op.role === 'MEMBER' || hasAny(words, ROLE_CUES[op.role] ?? [])),
  async resolve(rc, op) {
    const role = op.role ?? 'MEMBER';
    const email = op.email.trim().toLowerCase();
    // chi them thang nguoi DA co tai khoan da xac minh (giong addBoardMember); con lai giao dien moi bang email: tro ly khong gui email
    const user = await prisma.user.findFirst({ where: { email, deletedAt: null }, select: { id: true, name: true, emailVerifiedAt: true } });
    if (!user || user.emailVerifiedAt === null) {
      return { kind: 'FAIL', code: 'NOT_FOUND', text: `Không thêm trực tiếp được ${email} (chưa có tài khoản đã xác minh). Để mời qua email hãy dùng nút Chia sẻ của bảng. Chưa thay đổi gì.` };
    }
    const board = await boardInfo(rc.h.boardId);
    const existing = await prisma.boardMember.findUnique({ where: { boardId_userId: { boardId: rc.h.boardId, userId: user.id } }, select: { deletedAt: true } });
    if ((existing && existing.deletedAt === null) || board.ownerId === user.id) {
      return { kind: 'FAIL', code: 'CONFLICT', text: `${user.name} đã là thành viên của bảng. Muốn đổi quyền hãy nói “đổi quyền ${user.name} thành …”. Chưa thay đổi gì.` };
    }
    return rc.ok({ type: 'ADD_BOARD_MEMBER', ids: { member: user.id }, params: { role }, before: { existed: existing !== null }, display: { memberName: user.name, boardName: board.name } });
  },
  guard: (g) => manageGuard(g),
  async verify(tx, ctx, op) {
    if (!(await canManageInTx(tx, ctx.boardId, ctx.userId))) throw new PlanAbort('FORBIDDEN', 'Bạn không còn quyền quản trị bảng này.');
    const row = await tx.boardMember.findUnique({ where: { boardId_userId: { boardId: ctx.boardId, userId: op.ids.member as string } }, select: { deletedAt: true } });
    if (row && row.deletedAt === null) throw new PlanAbort('STALE', 'Người này vừa được thêm vào bảng.');
    const user = await tx.user.count({ where: { id: op.ids.member as string, deletedAt: null, emailVerifiedAt: { not: null } } });
    if (user === 0) throw new PlanAbort('STALE', 'Tài khoản này không còn hoạt động.');
  },
  async apply({ tx, ctx, effects, index }, op) {
    // giong addBoardMember (nguoi co tai khoan da xac minh): them / kich hoat lai dong thanh vien, thong bao board.member.added, bao realtime
    const userId = op.ids.member as string;
    const role = op.params.role as 'ADMIN' | 'MEMBER' | 'VIEWER';
    const existing = await tx.boardMember.findUnique({ where: { boardId_userId: { boardId: ctx.boardId, userId } }, select: { id: true } });
    if (existing) await tx.boardMember.update({ where: { id: existing.id }, data: { deletedAt: null, role, joinedAt: new Date() } });
    else await tx.boardMember.create({ data: { boardId: ctx.boardId, userId, role } });
    const board = await tx.board.findUniqueOrThrow({ where: { id: ctx.boardId }, select: { name: true } });
    effects.notifications.push({ type: 'board.member.added', actorId: ctx.userId, boardId: ctx.boardId, cardId: null, data: { boardName: board.name }, to: { kind: 'USERS', ids: [userId] } });
    effects.afterCommit.push(() => {
      emitToBoard(ctx.boardId, 'board:members-changed');
      emitToUser(userId, 'board:access-changed');
    });
    return done(index, `Đã thêm ${op.display.memberName as string} vào bảng với quyền ${ROLE_VI[role]}.`);
  },
  describe: (op, index) => ({
    index,
    verb: 'Thêm thành viên',
    text: `${op.display.memberName as string} vào bảng ${q(op.display.boardName as string)}`,
    detail: `Quyền: ${ROLE_VI[String(op.params.role)] ?? ''}`,
  }),
  summary: (op) => `Đã thêm ${op.display.memberName as string} vào bảng.`,
  stale: 'Danh sách thành viên của bảng đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `member:${op.ids.member}`, effect: 'MODIFY' }],
});

/** Mot thanh vien duoc them TRUC TIEP vao bang (co dong BoardMember, khong phai chu bang). */
async function directMember(rc: ResolveCtx, ref: Parameters<ResolveCtx['h']['pick']>[1], doing: string) {
  const hit = await rc.h.pick('member', ref);
  if (isOpResult(hit)) return hit;
  const row = await prisma.boardMember.findFirst({ where: { boardId: rc.h.boardId, userId: hit.id, deletedAt: null }, select: { role: true } });
  if (!row) {
    return { kind: 'FAIL', code: 'INVALID', text: `${hit.name} không được thêm trực tiếp vào bảng (có thể là thành viên qua không gian làm việc) nên không ${doing} được ở đây. Chưa thay đổi gì.` } satisfies OpResolveResult;
  }
  if (row.role === 'OWNER') return { kind: 'FAIL', code: 'INVALID', text: `${hit.name} là chủ bảng nên không ${doing} được. Chưa thay đổi gì.` } satisfies OpResolveResult;
  return { id: hit.id, name: hit.name, role: row.role as string };
}

const removeMember = defineOp<'REMOVE_BOARD_MEMBER'>({
  type: 'REMOVE_BOARD_MEMBER',
  label: 'bỏ thành viên khỏi bảng',
  policy: { autoRun: false, confirm: ['ADMIN', 'DELETE'], admin: true },
  slots: (op) => [{ name: 'member', kind: 'member', ref: op.member }],
  withRef: (op, name, ref) => (name === 'member' ? { ...op, member: ref } : op),
  // "bo Lan KHOI BANG" (khong phai "khoi the": do la REMOVE_MEMBER)
  licence: (words, op) =>
    mentions(words, [['khoi', 'bang'], ['khoi', 'board']])
      ? verbThen(words, [...DELETE_VERBS, ['bo'], ['loai'], ['kick'], ['moi', 'ra'], ['cho', 'ra']], MEMBER_NOUNS, ownTexts(op.member), 4, [...GLUE, 'ra'])
      : [],
  async resolve(rc, op) {
    const m = await directMember(rc, op.member, 'bỏ');
    if (isOpResult(m)) return m;
    const cards = await prisma.cardMember.count({ where: { userId: m.id, card: { deletedAt: null, list: { boardId: rc.h.boardId } } } });
    return rc.ok({ type: 'REMOVE_BOARD_MEMBER', ids: { member: m.id }, params: {}, before: { role: m.role }, display: { memberName: m.name, cards } });
  },
  guard: (g) => manageGuard(g),
  async verify(tx, ctx, op) {
    if (!(await canManageInTx(tx, ctx.boardId, ctx.userId))) throw new PlanAbort('FORBIDDEN', 'Bạn không còn quyền quản trị bảng này.');
    const row = await tx.boardMember.findFirst({ where: { boardId: ctx.boardId, userId: op.ids.member, deletedAt: null }, select: { role: true } });
    if (!row || row.role === 'OWNER') throw new PlanAbort('STALE', 'Người này không còn là thành viên của bảng.');
  },
  async apply({ tx, ctx, effects, index }, op) {
    // giong removeBoardMember: xoa mem thanh vien + go khoi cac the + don yeu cau tham gia dang cho; bao realtime, don khoi phong socket, thong bao
    const userId = op.ids.member as string;
    const membership = await tx.boardMember.findFirst({ where: { boardId: ctx.boardId, userId, deletedAt: null }, select: { id: true } });
    if (!membership) throw new PlanAbort('STALE', 'Người này không còn là thành viên của bảng.');
    await tx.boardMember.update({ where: { id: membership.id }, data: { deletedAt: new Date() } });
    await tx.cardMember.deleteMany({ where: { userId, card: { list: { boardId: ctx.boardId } } } });
    await tx.boardJoinRequest.deleteMany({ where: { boardId: ctx.boardId, userId, status: 'PENDING' } });
    const board = await tx.board.findUniqueOrThrow({ where: { id: ctx.boardId }, select: { name: true } });
    if (userId !== ctx.userId) {
      effects.notifications.push({ type: 'board.member.removed', actorId: ctx.userId, boardId: ctx.boardId, cardId: null, data: { boardName: board.name }, to: { kind: 'USERS', ids: [userId] } });
    }
    effects.afterCommit.push(async () => {
      emitToBoard(ctx.boardId, 'board:members-changed');
      emitToUser(userId, 'board:removed', { boardId: ctx.boardId });
      emitToUser(userId, 'board:access-changed');
      await evictUserFromBoardRoom(userId, ctx.boardId);
    });
    return done(index, `Đã bỏ ${op.display.memberName as string} khỏi bảng.`);
  },
  describe: (op, index) => ({
    index,
    verb: 'Bỏ thành viên khỏi bảng',
    text: op.display.memberName as string,
    detail: `Người này mất quyền vào bảng${typeof op.display.cards === 'number' && op.display.cards > 0 ? ` và bị gỡ khỏi ${op.display.cards} thẻ đang được giao` : ''}.`,
    danger: true,
  }),
  summary: (op) => `Đã bỏ ${op.display.memberName as string} khỏi bảng.`,
  stale: 'Danh sách thành viên của bảng đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `member:${op.ids.member}`, effect: 'REMOVE' }],
});

const changeRole = defineOp<'CHANGE_MEMBER_ROLE'>({
  type: 'CHANGE_MEMBER_ROLE',
  label: 'đổi quyền thành viên',
  policy: { autoRun: false, confirm: ['ADMIN'], admin: true },
  slots: (op) => [{ name: 'member', kind: 'member', ref: op.member }],
  withRef: (op, name, ref) => (name === 'member' ? { ...op, member: ref } : op),
  licence: (words, op) =>
    hasAny(words, ROLE_CUES[op.role] ?? [])
      ? verbThen(words, [['doi'], ['dat'], ['cap'], ['cho'], ['nang'], ['ha'], ['chuyen'], ['gan'], ['set'], ['change'], ['make'], ['lam']], [['quyen'], ...MEMBER_NOUNS], ownTexts(op.member), 6, [...GLUE, 'cua'])
      : [],
  async resolve(rc, op) {
    const m = await directMember(rc, op.member, 'đổi quyền');
    if (isOpResult(m)) return m;
    return rc.ok({
      type: 'CHANGE_MEMBER_ROLE',
      ids: { member: m.id },
      params: { role: op.role },
      before: { role: m.role },
      display: { memberName: m.name },
      ...(m.role === op.role ? { noop: `${m.name} đã có quyền ${ROLE_VI[op.role]} rồi.` } : {}),
    });
  },
  guard: (g) => manageGuard(g),
  async verify(tx, ctx, op) {
    if (!(await canManageInTx(tx, ctx.boardId, ctx.userId))) throw new PlanAbort('FORBIDDEN', 'Bạn không còn quyền quản trị bảng này.');
    const row = await tx.boardMember.findFirst({ where: { boardId: ctx.boardId, userId: op.ids.member, deletedAt: null }, select: { role: true } });
    if (!row || row.role === 'OWNER') throw new PlanAbort('STALE', 'Người này không còn là thành viên của bảng.');
    if (row.role !== op.before?.role) throw new PlanAbort('STALE', 'Quyền của thành viên đã thay đổi kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, effects, index }, op) {
    // giong changeMemberRole: doi vai tro (khong doi duoc chu bang), thong bao board.role.changed, bao realtime
    const userId = op.ids.member as string;
    const membership = await tx.boardMember.findFirst({ where: { boardId: ctx.boardId, userId, deletedAt: null }, select: { id: true } });
    if (!membership) throw new PlanAbort('STALE', 'Người này không còn là thành viên của bảng.');
    await tx.boardMember.update({ where: { id: membership.id }, data: { role: op.params.role as 'ADMIN' | 'MEMBER' | 'VIEWER' } });
    const board = await tx.board.findUniqueOrThrow({ where: { id: ctx.boardId }, select: { name: true } });
    effects.notifications.push({ type: 'board.role.changed', actorId: ctx.userId, boardId: ctx.boardId, cardId: null, data: { boardName: board.name, role: op.params.role }, to: { kind: 'USERS', ids: [userId] } });
    effects.afterCommit.push(() => emitToBoard(ctx.boardId, 'board:members-changed'));
    return done(index, `Đã đổi quyền của ${op.display.memberName as string} thành ${ROLE_VI[String(op.params.role)] ?? ''}.`);
  },
  describe: (op, index) => ({
    index,
    verb: 'Đổi quyền thành viên',
    text: op.display.memberName as string,
    detail: `${ROLE_VI[String(op.before?.role ?? '')] ?? ''} → ${ROLE_VI[String(op.params.role ?? '')] ?? ''}`,
  }),
  summary: (op) => `Đã đổi quyền của ${op.display.memberName as string} thành ${ROLE_VI[String(op.params.role)] ?? ''}.`,
  stale: 'Quyền của thành viên đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `member:${op.ids.member}`, effect: 'MODIFY' }],
});

// ---------------------------------------------------------------------------------------------------------------------
// Truong tuy chinh (cau truc; gia tri tren the o ops.cardextras)
// ---------------------------------------------------------------------------------------------------------------------

async function pickField(rc: ResolveCtx, text: string) {
  const fields = await prisma.customField.findMany({ where: { boardId: rc.h.boardId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], select: { id: true, name: true, type: true } });
  if (fields.length === 0) return { kind: 'FAIL', code: 'NOT_FOUND', text: 'Bảng này chưa có trường tùy chỉnh nào. Chưa thay đổi gì.' } satisfies OpResolveResult;
  const hit = chooseFrom({ rc, kind: 'field', scope: rc.h.boardId, text: stripLeadingGeneric(text), pool: fields.map((f) => ({ id: f.id, name: f.name })), where: ' của bảng' });
  if ('kind' in hit) return hit;
  return fields.find((f) => f.id === hit.id) as (typeof fields)[number];
}
async function fieldGuard(g: GuardCtx, op: StoredOp): Promise<GuardVerdict> {
  const row = op.ids.field === undefined ? null : await prisma.customField.findFirst({ where: { id: op.ids.field, boardId: g.boardId }, select: { id: true } });
  return row ? { ok: true } : fail('NOT_FOUND', `Trường tùy chỉnh này không còn thuộc bảng. ${NO_CHANGE}`);
}

const createField = defineOp<'CREATE_CUSTOM_FIELD'>({
  type: 'CREATE_CUSTOM_FIELD',
  label: 'tạo trường tùy chỉnh',
  policy: { autoRun: false, confirm: ['NEW_STRUCTURE'] },
  slots: () => [],
  withRef: (op) => op,
  licence: (words) => verbThen(words, CREATE_VERBS, FIELD_NOUNS, [], 4, GLUE),
  grounded: (op, words) => allIn([op.name, op.options], words),
  async resolve(rc, op) {
    const name = op.name.trim();
    const options = (op.options ?? []).map((o) => o.trim());
    if (op.fieldType !== 'DROPDOWN' && options.length > 0) return { kind: 'FAIL', code: 'INVALID', text: 'Chỉ trường kiểu danh sách chọn mới có lựa chọn. Chưa thay đổi gì.' };
    if (new Set(options.map(nameKey)).size !== options.length) return { kind: 'FAIL', code: 'INVALID', text: 'Các lựa chọn của trường không được trùng nhau. Chưa thay đổi gì.' };
    const taken = await prisma.customField.findMany({ where: { boardId: rc.h.boardId }, select: { name: true } });
    if (taken.some((f) => nameKey(f.name) === nameKey(name))) return { kind: 'FAIL', code: 'CONFLICT', text: `Bảng đã có trường ${q(name)}. Hãy dùng tên khác. Chưa thay đổi gì.` };
    return rc.ok({ type: 'CREATE_CUSTOM_FIELD', ids: {}, params: { name, fieldType: op.fieldType, options }, before: null, display: { fieldName: name } });
  },
  async guard(_g, op) {
    const name = String(op.params.name ?? '');
    const options = (op.params.options ?? []) as string[];
    return name.length < 1 || name.length > 60 || options.length > 20 || options.some((o) => o.length < 1 || o.length > 60)
      ? fail('INVALID', `Tên trường và lựa chọn tối đa 60 ký tự, tối đa 20 lựa chọn. ${NO_CHANGE}`)
      : { ok: true };
  },
  async verify(tx, ctx, op) {
    const taken = await tx.customField.findMany({ where: { boardId: ctx.boardId }, select: { name: true } });
    if (taken.some((f) => nameKey(f.name) === nameKey(String(op.params.name)))) throw new PlanAbort('STALE', `Bảng vừa có thêm trường “${String(op.params.name)}”.`);
  },
  async apply({ tx, ctx, effects, index }, op) {
    // giong createCustomField: cuoi danh sach truong; kieu DROPDOWN kem cac lua chon (mau de trong)
    const last = await tx.customField.findFirst({ where: { boardId: ctx.boardId }, orderBy: { position: 'desc' }, select: { position: true } });
    const options = (op.params.options ?? []) as string[];
    await tx.customField.create({
      data: {
        boardId: ctx.boardId,
        name: String(op.params.name),
        type: op.params.fieldType as 'TEXT' | 'NUMBER' | 'DATE' | 'CHECKBOX' | 'DROPDOWN',
        position: last ? last.position + 1 : 0,
        ...(op.params.fieldType === 'DROPDOWN' && options.length > 0 ? { options: { create: options.map((value, i) => ({ value, color: null, position: i })) } } : {}),
      },
    });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã tạo trường ${q(String(op.params.name))} (${FIELD_TYPE_VI[String(op.params.fieldType)] ?? ''}).`);
  },
  describe: (op, index) => {
    const options = (op.params.options ?? []) as string[];
    return {
      index,
      verb: 'Tạo trường tùy chỉnh',
      text: q(String(op.params.name ?? '')),
      detail: `Kiểu: ${FIELD_TYPE_VI[String(op.params.fieldType)] ?? ''}${options.length > 0 ? `\n${options.map((o) => `• ${clip(o, 60)}`).join('\n')}` : ''}`,
    };
  },
  summary: (op) => `Đã tạo trường ${q(String(op.params.name ?? ''))}.`,
  stale: 'Các trường của bảng đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `field:new:${nameKey(String(op.params.name ?? ''))}`, effect: 'MODIFY' }],
});

const renameField = defineOp<'RENAME_CUSTOM_FIELD'>({
  type: 'RENAME_CUSTOM_FIELD',
  label: 'đổi tên trường tùy chỉnh',
  policy: { autoRun: false, confirm: ['NEW_STRUCTURE'] },
  slots: () => [],
  withRef: (op) => op,
  licence: (words) => verbThen(words, RENAME_VERBS, FIELD_NOUNS, [], 4, GLUE),
  grounded: (op, words) => allIn([op.field, op.name], words),
  async resolve(rc, op) {
    const field = await pickField(rc, op.field);
    if ('kind' in field) return field;
    const name = op.name.trim();
    const others = await prisma.customField.findMany({ where: { boardId: rc.h.boardId, id: { not: field.id } }, select: { name: true } });
    if (others.some((f) => nameKey(f.name) === nameKey(name))) return { kind: 'FAIL', code: 'CONFLICT', text: `Bảng đã có trường ${q(name)}. Hãy dùng tên khác. Chưa thay đổi gì.` };
    return rc.ok({
      type: 'RENAME_CUSTOM_FIELD',
      ids: { field: field.id },
      params: { name },
      before: { name: field.name },
      display: { fieldName: field.name },
      ...(field.name === name ? { noop: `Trường ${q(name)} đã có tên này rồi.` } : {}),
    });
  },
  async guard(g, op) {
    const base = await fieldGuard(g, op);
    if (!base.ok) return base;
    const name = String(op.params.name ?? '');
    return name.length < 1 || name.length > 60 ? fail('INVALID', `Tên trường phải từ 1 đến 60 ký tự. ${NO_CHANGE}`) : { ok: true };
  },
  async verify(tx, ctx, op) {
    const row = await tx.customField.findFirst({ where: { id: op.ids.field, boardId: ctx.boardId }, select: { name: true } });
    if (!row) throw new PlanAbort('STALE', 'Trường không còn trong bảng.');
    if (row.name !== op.before?.name) throw new PlanAbort('STALE', 'Trường đã được đổi tên kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, effects, index }, op) {
    // giong updateCustomField({ name })
    await tx.customField.update({ where: { id: op.ids.field as string }, data: { name: String(op.params.name) } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã đổi tên trường ${q(String(op.before?.name))} thành ${q(String(op.params.name))}.`);
  },
  describe: (op, index) => ({ index, verb: 'Đổi tên trường', text: `${q(String(op.before?.name ?? ''))} → ${q(String(op.params.name ?? ''))}` }),
  summary: (op) => `Đã đổi tên trường thành ${q(String(op.params.name ?? ''))}.`,
  stale: 'Trường đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `field:${op.ids.field}`, effect: 'MODIFY' }],
});

const deleteField = defineOp<'DELETE_CUSTOM_FIELD'>({
  type: 'DELETE_CUSTOM_FIELD',
  label: 'xóa trường tùy chỉnh',
  policy: { autoRun: false, confirm: ['DELETE'] },
  slots: () => [],
  withRef: (op) => op,
  licence: (words) => verbThen(words, DELETE_VERBS, FIELD_NOUNS, [], 4, GLUE),
  grounded: (op, words) => allIn([op.field], words),
  async resolve(rc, op) {
    const field = await pickField(rc, op.field);
    if ('kind' in field) return field;
    const values = await prisma.cardFieldValue.count({ where: { fieldId: field.id, card: { deletedAt: null } } });
    return rc.ok({ type: 'DELETE_CUSTOM_FIELD', ids: { field: field.id }, params: {}, before: { name: field.name }, display: { fieldName: field.name, values } });
  },
  guard: (g, op) => fieldGuard(g, op),
  async verify(tx, ctx, op) {
    const row = await tx.customField.findFirst({ where: { id: op.ids.field, boardId: ctx.boardId }, select: { id: true } });
    if (!row) throw new PlanAbort('STALE', 'Trường không còn trong bảng.');
  },
  async apply({ tx, ctx, effects, index }, op) {
    // giong deleteCustomField: xoa truong (cung gia tri tren cac the va cac lua chon)
    await tx.customField.delete({ where: { id: op.ids.field as string } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã xóa trường ${q(op.display.fieldName as string)}.`);
  },
  describe: (op, index) => ({
    index,
    verb: 'Xóa trường tùy chỉnh',
    text: q(op.display.fieldName as string),
    detail: `Trường biến mất khỏi bảng${typeof op.display.values === 'number' && op.display.values > 0 ? ` cùng giá trị của nó trên ${op.display.values} thẻ` : ''}; không khôi phục lại được.`,
    danger: true,
  }),
  summary: (op) => `Đã xóa trường ${q(op.display.fieldName as string)}.`,
  stale: 'Trường đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `field:${op.ids.field}`, effect: 'REMOVE' }],
});

const addFieldOption = defineOp<'ADD_FIELD_OPTION'>({
  type: 'ADD_FIELD_OPTION',
  label: 'thêm lựa chọn cho trường',
  policy: { autoRun: false, confirm: ['NEW_STRUCTURE'] },
  slots: () => [],
  withRef: (op) => op,
  licence: (words, op) => {
    const named = foldWords(op.field);
    return mentions(words, [...FIELD_NOUNS, ...(named.length > 0 ? [named] : [])])
      ? verbThen(words, CREATE_VERBS, [...FIELD_NOUNS, ['lua', 'chon'], ['gia', 'tri'], ['option']], [op.value], 6, GLUE)
      : [];
  },
  grounded: (op, words) => allIn([op.field, op.value], words),
  async resolve(rc, op) {
    const field = await pickField(rc, op.field);
    if ('kind' in field) return field;
    if (field.type !== 'DROPDOWN') return { kind: 'FAIL', code: 'INVALID', text: `Trường ${q(field.name)} không phải kiểu danh sách chọn nên không có lựa chọn. Chưa thay đổi gì.` };
    const value = op.value.trim();
    const options = await prisma.customFieldOption.findMany({ where: { fieldId: field.id }, select: { value: true } });
    return rc.ok({
      type: 'ADD_FIELD_OPTION',
      ids: { field: field.id },
      params: { value },
      before: { count: options.length },
      display: { fieldName: field.name },
      ...(options.some((o) => nameKey(o.value) === nameKey(value)) ? { noop: `Trường ${q(field.name)} đã có lựa chọn ${q(value)} rồi.` } : {}),
    });
  },
  async guard(g, op) {
    const base = await fieldGuard(g, op);
    if (!base.ok) return base;
    const value = String(op.params.value ?? '');
    return value.length < 1 || value.length > 60 ? fail('INVALID', `Lựa chọn phải từ 1 đến 60 ký tự. ${NO_CHANGE}`) : { ok: true };
  },
  async verify(tx, ctx, op) {
    const row = await tx.customField.findFirst({ where: { id: op.ids.field, boardId: ctx.boardId }, select: { type: true } });
    if (row?.type !== 'DROPDOWN') throw new PlanAbort('STALE', 'Trường không còn là danh sách chọn.');
    const count = await tx.customFieldOption.count({ where: { fieldId: op.ids.field as string } });
    if (count !== op.before?.count) throw new PlanAbort('STALE', 'Các lựa chọn của trường đã thay đổi kể từ lúc xem trước.');
  },
  async apply({ tx, ctx, effects, index }, op) {
    // giong addFieldOption: cuoi danh sach lua chon, khong mau
    const last = await tx.customFieldOption.findFirst({ where: { fieldId: op.ids.field as string }, orderBy: { position: 'desc' }, select: { position: true } });
    await tx.customFieldOption.create({ data: { fieldId: op.ids.field as string, value: String(op.params.value), color: null, position: last ? last.position + 1 : 0 } });
    effects.boardIds.add(ctx.boardId);
    return done(index, `Đã thêm lựa chọn ${q(String(op.params.value))} cho trường ${q(op.display.fieldName as string)}.`);
  },
  describe: (op, index) => ({ index, verb: 'Thêm lựa chọn', text: `${q(String(op.params.value ?? ''))} cho trường ${q(op.display.fieldName as string)}` }),
  summary: (op) => `Đã thêm lựa chọn ${q(String(op.params.value ?? ''))}.`,
  stale: 'Trường đã thay đổi kể từ lúc xem trước.',
  targets: (op) => [{ key: `field:${op.ids.field}`, effect: 'MODIFY' }],
});

export const BOARD_HANDLERS: AnyHandler[] = [
  renameBoard,
  setVisibility,
  starBoard,
  archiveBoard,
  deleteBoard,
  setInviteLink,
  createLabel,
  updateLabel,
  deleteLabel,
  toggleRule,
  deleteRule,
  addMember,
  removeMember,
  changeRole,
  createField,
  renameField,
  deleteField,
  addFieldOption,
];
