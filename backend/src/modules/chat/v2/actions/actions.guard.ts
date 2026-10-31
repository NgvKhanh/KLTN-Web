// QUYEN + NGHIEP VU cua tung thao tac (CHATBOT_V2_ACTIONS_PLAN.md §8). Dieu kien 8 cua chinh sach auto-run: backend LUON kiem lai
// truoc khi chay, ke ca khi nguoi dung da bam "Ap dung" - quyen co the vua doi giua hai buoc.
//
// KHONG viet lai quyen: goi dung cac ham `assert*` ma giao dien / API dang dung (board.service, card.service). VIEWER bi chan o
// assertBoardAccess; nguoi nhan phai qua isBoardParticipant (VIEWER bi loai - CODE_REVIEW #9). Ket qua tra ve ma + cau tieng Viet
// (cac ham assert nem AppError tieng Viet khong dau).

import { prisma } from '../../../../config/prisma';
import { assertBoardAccess, isBoardParticipant } from '../../../board/board.service';
import { assertCardAccess } from '../../../card/card.service';
import { MAX_CHECKLIST_ITEMS, MAX_RULE_ACTIONS, MAX_TEXT_CHARS } from './actions.schema';
import { attempt, fail, liveList, mapServiceError, NO_CHANGE } from './actions.guard.base';
import { handlerOf } from './ops/ops.registry';
import type { GuardVerdict, StoredOp } from './actions.types';

export { mapServiceError };

/** Quyen SUA bang + tai khoan con hoat dong (VIEWER / nguoi ngoai bi chan o assertBoardAccess). Moi ke hoach chi can kiem MOT lan. */
export async function guardBoard(userId: string, boardId: string): Promise<GuardVerdict> {
  const active = await prisma.user.count({ where: { id: userId, deletedAt: null } });
  if (active === 0) return fail('FORBIDDEN', 'Tài khoản không còn hoạt động.');
  return attempt(() => assertBoardAccess(userId, boardId));
}

/**
 * Luat tu dong hoa (Phase 7): quyen SUA bang da kiem o guardBoard. Them: cot kich hoat con song, nhan thuoc bang, nguoi duoc giao la thanh vien CO QUYEN SUA
 * (engine bo qua luc chay neu khong con la thanh vien - nhung luc TAO luat phai dung, giong createAutomationRule), so hanh dong 1..5.
 */
async function guardRule(boardId: string, op: StoredOp): Promise<GuardVerdict> {
  const rule = op.params.rule;
  if (rule === undefined || rule.actions.length < 1 || rule.actions.length > MAX_RULE_ACTIONS) return fail('INVALID', `Luật cần từ 1 đến ${MAX_RULE_ACTIONS} việc. ${NO_CHANGE}`);
  if (rule.name.trim() === '' || rule.name.length > 200) return fail('INVALID', `Tên luật phải từ 1 đến 200 ký tự. ${NO_CHANGE}`);
  if (rule.trigger === 'CARD_MOVED_TO_LIST' && op.ids.list === undefined) return fail('INVALID', `Luật “khi thẻ được chuyển vào cột” cần có cột. ${NO_CHANGE}`);
  if (op.ids.list !== undefined && !(await liveList(boardId, op.ids.list))) return fail('NOT_FOUND', `Cột này không còn trong bảng. ${NO_CHANGE}`);
  for (const a of rule.actions) {
    if (a.type === 'ADD_LABEL') {
      const label = a.labelId ? await prisma.label.findFirst({ where: { id: a.labelId, boardId }, select: { id: true } }) : null;
      if (!label) return fail('NOT_FOUND', `Nhãn này không thuộc bảng. ${NO_CHANGE}`);
    }
    if (a.type === 'ASSIGN_MEMBER') {
      const memberId = a.userId;
      if (memberId === undefined) return fail('INVALID', `Thiếu người cần giao. ${NO_CHANGE}`);
      const person = await prisma.user.findFirst({ where: { id: memberId, deletedAt: null }, select: { name: true } });
      if (!person) return fail('NOT_FOUND', `Người này không còn tài khoản hoạt động. ${NO_CHANGE}`);
      if (!(await isBoardParticipant(boardId, memberId))) {
        const membership = await prisma.boardMember.findFirst({ where: { boardId, userId: memberId, deletedAt: null }, select: { role: true } });
        return membership?.role === 'VIEWER'
          ? fail('VIEWER_ASSIGN', `${person.name} chỉ có quyền xem bảng này nên luật không giao việc cho họ được. ${NO_CHANGE}`)
          : fail('FORBIDDEN', `${person.name} không thuộc bảng này nên luật không giao việc cho họ được. ${NO_CHANGE}`);
      }
    }
  }
  return { ok: true };
}

/**
 * Kiem tra MOT thao tac. Thao tac nham vao cot / the do CHINH ke hoach tao (`op.local`) thi bo qua kiem tra "con ton tai trong bang"
 * (chua co id) - nhung moi dieu kien khac (quyen, nhan / nguoi thuoc bang, ten hop le) van kiem. `skipBoard`: nguoi goi da kiem quyen
 * bang roi (guardPlan). `checked`: cac the da kiem trong cung ke hoach (khong kiem lai).
 */
export async function guardOp(args: { userId: string; boardId: string; op: StoredOp; skipBoard?: boolean; checked?: Set<string> }): Promise<GuardVerdict> {
  const { userId, boardId, op } = args;

  if (args.skipBoard !== true) {
    const board = await guardBoard(userId, boardId);
    if (!board.ok) return board;
  }

  if (op.type === 'CREATE_LIST') {
    const name = op.params.name ?? '';
    return name.trim() === '' || name.length > 100 ? fail('INVALID', `Tên cột phải từ 1 đến 100 ký tự. ${NO_CHANGE}`) : { ok: true };
  }

  if (op.type === 'CREATE_AUTOMATION_RULE') return guardRule(boardId, op);

  if (op.type === 'CREATE_CARD') {
    if (op.local?.list === undefined && !(await liveList(boardId, op.ids.list))) return fail('NOT_FOUND', `Cột này không còn trong bảng. ${NO_CHANGE}`);
    const title = op.params.title ?? '';
    if (title.trim() === '' || title.length > 500) return fail('INVALID', `Tiêu đề thẻ phải từ 1 đến 500 ký tự. ${NO_CHANGE}`);
    return { ok: true };
  }

  // Buoc D: doi ten cot (khong nham vao the nao)
  if (op.type === 'RENAME_LIST') {
    const name = op.params.name ?? '';
    if (name.trim() === '' || name.length > 100) return fail('INVALID', `Tên cột phải từ 1 đến 100 ký tự. ${NO_CHANGE}`);
    return (await liveList(boardId, op.ids.list)) ? { ok: true } : fail('NOT_FOUND', `Cột này không còn trong bảng. ${NO_CHANGE}`);
  }

  // thao tac mo rong (actions/ops): moi nhom tu kiem quyen + nghiep vu; `g.card` kiem the + thuoc dung bang (giong nhanh cu ben duoi)
  const handler = handlerOf(op.type);
  if (handler !== undefined) {
    return handler.guard(
      {
        userId,
        boardId,
        ...(args.checked !== undefined ? { checked: args.checked } : {}),
        card: async (cardId) => {
          if (args.checked?.has(cardId) === true) return { ok: true };
          try {
            const card = await assertCardAccess(userId, cardId);
            if (card.list.boardId !== boardId) return fail('OUT_OF_SCOPE', `Thẻ này không thuộc bảng của kế hoạch. ${NO_CHANGE}`);
          } catch (e) {
            return mapServiceError(e);
          }
          args.checked?.add(cardId);
          return { ok: true };
        },
      },
      op
    );
  }

  // moi thao tac con lai nham vao MOT the
  const cardId = op.ids.card;
  if (cardId === undefined && op.local?.card === undefined) return fail('INVALID', `Thiếu thẻ cần thao tác. ${NO_CHANGE}`);
  if (cardId !== undefined && args.checked?.has(cardId) !== true) {
    let cardBoardId: string;
    try {
      const card = await assertCardAccess(userId, cardId);
      cardBoardId = card.list.boardId;
    } catch (e) {
      return mapServiceError(e);
    }
    // the phai thuoc DUNG bang cua ke hoach (mot ke hoach chi cham mot bang)
    if (cardBoardId !== boardId) return fail('OUT_OF_SCOPE', `Thẻ này không thuộc bảng của kế hoạch. ${NO_CHANGE}`);
    args.checked?.add(cardId);
  }

  switch (op.type) {
    case 'RENAME_CARD': {
      const title = op.params.title ?? '';
      return title.trim() === '' || title.length > 500 ? fail('INVALID', `Tiêu đề thẻ phải từ 1 đến 500 ký tự. ${NO_CHANGE}`) : { ok: true };
    }
    case 'MOVE_CARD': {
      // cot dich phai con song va CUNG bang: cam chuyen xuyen bang (moveCard cho phep, chatbot thi khong)
      if (op.local?.list === undefined && !(await liveList(boardId, op.ids.list))) {
        return fail('OUT_OF_SCOPE', `Cột đích không thuộc bảng này (trợ lý không chuyển thẻ sang bảng khác). ${NO_CHANGE}`);
      }
      return { ok: true };
    }
    case 'ASSIGN_MEMBER': {
      const memberId = op.ids.member;
      if (memberId === undefined) return fail('INVALID', `Thiếu người cần giao. ${NO_CHANGE}`);
      const person = await prisma.user.findFirst({ where: { id: memberId, deletedAt: null }, select: { name: true } });
      if (!person) return fail('NOT_FOUND', `Người này không còn tài khoản hoạt động. ${NO_CHANGE}`);
      if (await isBoardParticipant(boardId, memberId)) return { ok: true };
      const membership = await prisma.boardMember.findFirst({ where: { boardId, userId: memberId, deletedAt: null }, select: { role: true } });
      return membership?.role === 'VIEWER'
        ? fail('VIEWER_ASSIGN', `${person.name} chỉ có quyền xem bảng này nên không giao việc được. ${NO_CHANGE}`)
        : fail('FORBIDDEN', `${person.name} không thuộc bảng này nên không giao việc được. ${NO_CHANGE}`);
    }
    case 'ADD_LABEL': {
      const label = op.ids.label ? await prisma.label.findFirst({ where: { id: op.ids.label, boardId }, select: { id: true } }) : null;
      return label ? { ok: true } : fail('NOT_FOUND', `Nhãn này không thuộc bảng. ${NO_CHANGE}`);
    }
    case 'REMOVE_LABEL': {
      const label = op.ids.label ? await prisma.label.findFirst({ where: { id: op.ids.label, boardId }, select: { id: true } }) : null;
      return label ? { ok: true } : fail('NOT_FOUND', `Nhãn này không thuộc bảng. ${NO_CHANGE}`);
    }
    // bo nguoi khoi the khong can nguoi do con la thanh vien bang (nguoi da roi bang van go duoc khoi the)
    case 'REMOVE_MEMBER':
      return op.ids.member === undefined ? fail('INVALID', `Thiếu người cần bỏ. ${NO_CHANGE}`) : { ok: true };
    case 'SET_CARD_DESCRIPTION': {
      const d = op.params.description ?? '';
      return d.trim() === '' || d.length > MAX_TEXT_CHARS ? fail('INVALID', `Mô tả phải từ 1 đến ${MAX_TEXT_CHARS} ký tự. ${NO_CHANGE}`) : { ok: true };
    }
    case 'ADD_COMMENT': {
      const text = op.params.text ?? '';
      if (text.trim() === '' || text.length > MAX_TEXT_CHARS) return fail('INVALID', `Bình luận phải từ 1 đến ${MAX_TEXT_CHARS} ký tự. ${NO_CHANGE}`);
      // nhac ten (@) gui thong bao rieng cho nguoi duoc nhac: chua ho tro qua tro ly
      return text.includes('@') ? fail('INVALID', `Trợ lý chưa hỗ trợ nhắc tên (@) trong bình luận; hãy bỏ ký tự @ hoặc viết bình luận trực tiếp trên thẻ. ${NO_CHANGE}`) : { ok: true };
    }
    case 'ADD_CHECKLIST': {
      const items = op.params.items ?? [];
      if (items.length < 1 || items.length > MAX_CHECKLIST_ITEMS || items.some((i) => i.trim() === '' || i.length > 500)) return fail('INVALID', `Checklist cần từ 1 đến ${MAX_CHECKLIST_ITEMS} mục, mỗi mục tối đa 500 ký tự. ${NO_CHANGE}`);
      return (op.params.title ?? '').length > 200 ? fail('INVALID', `Tên checklist tối đa 200 ký tự. ${NO_CHANGE}`) : { ok: true };
    }
    case 'SET_CARD_DUE':
    case 'SET_CARD_START':
    case 'SET_CARD_STATUS':
    case 'ARCHIVE_CARD':
      return { ok: true };
    default:
      return fail('INVALID', `Thao tác không hợp lệ. ${NO_CHANGE}`);
  }
}

export type PlanGuardVerdict = GuardVerdict | { ok: false; code: Extract<GuardVerdict, { ok: false }>['code']; text: string; index: number };

/**
 * Kiem quyen + nghiep vu cho TOAN BO ke hoach. Mot thao tac bi tu choi -> ca ke hoach bi tu choi (khong ai chay mot phan). Quyen bang
 * kiem mot lan; ke hoach nhieu thao tac noi ro la thao tac nao bi chan.
 */
export async function guardPlan(args: { userId: string; boardId: string; ops: readonly StoredOp[] }): Promise<PlanGuardVerdict> {
  const board = await guardBoard(args.userId, args.boardId);
  if (!board.ok) return board;
  const checked = new Set<string>();
  for (const [index, op] of args.ops.entries()) {
    const verdict = await guardOp({ userId: args.userId, boardId: args.boardId, op, skipBoard: true, checked });
    if (!verdict.ok) {
      return { ok: false, code: verdict.code, index, text: args.ops.length > 1 ? `Thao tác ${index + 1}: ${verdict.text}` : verdict.text };
    }
  }
  return { ok: true };
}
