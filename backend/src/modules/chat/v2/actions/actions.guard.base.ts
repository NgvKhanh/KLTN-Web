// NEN CUA LOP KIEM QUYEN (tep la): ham tra loi tu choi + doi AppError cua service sang loi co ma. Dung chung cho actions.guard va cac nhom thao tac
// moi (actions/ops/*) de khong tao vong import.

import { prisma } from '../../../../config/prisma';
import { AppError } from '../../../../utils/AppError';
import type { GuardVerdict } from './actions.types';

export const NO_CHANGE = 'Chưa thay đổi gì.';

export const fail = (code: Extract<GuardVerdict, { ok: false }>['code'], text: string): GuardVerdict => ({ ok: false, code, text });

/** AppError cua service/assert -> loi co ma. Loi 5xx / khong phai AppError duoc nem lai (khong nuot loi he thong). */
export function mapServiceError(e: unknown): Extract<GuardVerdict, { ok: false }> {
  if (e instanceof AppError && e.statusCode === 403) {
    return { ok: false, code: 'FORBIDDEN', text: `Bạn chỉ có quyền xem (hoặc không còn quyền sửa) bảng này nên không thể thay đổi. ${NO_CHANGE}` };
  }
  if (e instanceof AppError && e.statusCode === 404) {
    return { ok: false, code: 'NOT_FOUND', text: `Không tìm thấy thẻ, cột hoặc bảng này (có thể đã bị xoá hoặc lưu trữ). ${NO_CHANGE}` };
  }
  if (e instanceof AppError && e.statusCode < 500) {
    return { ok: false, code: 'INVALID', text: `Không thực hiện được: ${e.message}. ${NO_CHANGE}` };
  }
  throw e;
}

export async function attempt(fn: () => Promise<unknown>): Promise<GuardVerdict> {
  try {
    await fn();
    return { ok: true };
  } catch (e) {
    return mapServiceError(e);
  }
}

export async function liveList(boardId: string, listId: string | undefined) {
  if (listId === undefined) return null;
  return prisma.list.findFirst({ where: { id: listId, boardId, deletedAt: null, archivedAt: null }, select: { id: true } });
}
