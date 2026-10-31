import { matchPath } from 'react-router-dom';
import type { ChatScope } from '../types/chat';

// Pham vi cua tro ly THEO TRANG dang mo (tran pham vi, CHATBOT_V2_ACTIONS_PLAN.md §4.1):
//   - trang bang (/boards/:boardId) -> chi lam viec trong dung bang do, khong ra duoc bang khac (doc lan ghi);
//   - moi trang con lai (trang chu, khong gian, tim kiem...) -> moi bang ban tham gia (backend van kiem quyen tung bang).
// Ham thuan: khong goi API, khong doc DOM.

export function assistantScopeFor(pathname: string): ChatScope {
  const board = matchPath('/boards/:boardId', pathname);
  return board?.params.boardId ? { kind: 'BOARD', boardId: board.params.boardId } : { kind: 'MY' };
}

/** Nhan ngan canh tieu de panel. */
export function scopeChipText(scope: ChatScope): string {
  return scope.kind === 'BOARD' ? 'Trong bảng đang mở' : 'Mọi bảng của bạn';
}

/** Chu giai thich khi re chuot / doc man hinh. */
export function scopeChipTitle(scope: ChatScope): string {
  return scope.kind === 'BOARD'
    ? 'Trợ lý chỉ đọc và thay đổi trong bảng này. Mở trang chủ để làm việc với bảng khác.'
    : 'Trợ lý làm việc với mọi bảng bạn tham gia. Nêu tên bảng trong câu lệnh để thao tác trên bảng đó.';
}

/** Ke hoach thuoc bang khac voi trang dang mo? (trang bang: khoa cung; trang khac: khong gioi han them). */
export function planOutOfScope(scope: ChatScope, planBoardId: string): boolean {
  return scope.kind === 'BOARD' && scope.boardId !== planBoardId;
}

/**
 * Pham vi gui kem nut "chon" / "xem them": chi khi dang o trang bang (khi do nut cua luot cu o trang khac phai bi vo hieu).
 * O trang chu khong gui: tran khong han che gi them.
 */
export function guardScope(scope: ChatScope): ChatScope | undefined {
  return scope.kind === 'BOARD' ? scope : undefined;
}
