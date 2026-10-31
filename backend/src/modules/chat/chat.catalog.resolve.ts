// Nhan dien ten bang / khong gian / cot cua mot cau hoi danh muc (CHATBOT_MODULE.md §18.4).
//
// HAM THUAN, khong DB: nhan pham vi + cau hoi + danh muc ten, tra ve mot trong ba: da xac dinh (bang / khong gian / cot cu
// the), nhieu ung vien (hoi lai bang nut), hoac khong tim thay. Dich vu (chat.catalog) dung ket qua nay de chay truy van; bo
// danh gia (scripts/chatEvalCore) dung CHINH ham nay de cham diem - nen hai ben khong the lech nhau.

import { matchEntity, type BoardEntity, type ColumnEntity, type EntityCatalog, type NamedEntity } from './chat.entities';
import type { CatalogIntent, CatalogQuestion } from './chat.intent';

export type CatalogTarget = { type: 'BOARD'; board: BoardEntity } | { type: 'WORKSPACE'; workspace: NamedEntity };

/** Phan cua ResolvedScope ma buoc nhan dien can (ResolvedScope thoa cau truc nay). */
export interface ResolveScope {
  kind: 'MY' | 'WORKSPACE' | 'BOARD';
  workspace: { id: string; name: string } | null;
  board: { id: string; name: string } | null;
}

export type NotFoundWhat = 'BOARD_OR_WORKSPACE' | 'WORKSPACE' | 'COLUMN';

export type CatalogResolution =
  /** `targetName`: ten bang / khong gian DA nhan dien truoc khi cot khong khop (null neu chua co). */
  | { kind: 'NOT_FOUND'; typed: string; what: NotFoundWhat; targetName: string | null }
  /** Nhieu bang / khong gian khop ten -> nut chon (kind TARGET). */
  | { kind: 'CLARIFY'; typed: string; refs: CatalogTarget[] }
  | {
      kind: 'RESOLVED';
      /** Bang / khong gian da nhan dien; null = dung pham vi. */
      target: CatalogTarget | null;
      /** CARD_COUNTS: cac cot khop ten da go; null = khong loc cot. */
      columns: ColumnEntity[] | null;
      /** Ten cot da nhan dien (mot ten duy nhat -> ten that, nhieu ten -> chuoi go). */
      columnName: string | null;
      /** Ghi chu tham so bi bo qua. */
      notes: string[];
    };

export const targetId = (r: CatalogTarget): string => (r.type === 'BOARD' ? r.board.id : r.workspace.id);
export const targetName = (r: CatalogTarget): string => (r.type === 'BOARD' ? r.board.name : r.workspace.name);

/** Nhan cua nut chon: "Bảng tên (không gian)" / "Không gian tên". */
export function targetLabel(r: CatalogTarget): string {
  return r.type === 'BOARD' ? `Bảng ${r.board.name} (${r.board.workspaceName})` : `Không gian ${r.workspace.name}`;
}

function resolveTargetText(
  typed: string,
  intent: CatalogIntent,
  catalog: EntityCatalog
): { kind: 'NOT_FOUND' } | { kind: 'ONE'; ref: CatalogTarget } | { kind: 'MANY'; refs: CatalogTarget[] } {
  // MY_BOARDS chi loc theo khong gian; cac y dinh khac nhan bang HOAC khong gian
  const boards = intent === 'MY_BOARDS' ? null : matchEntity(typed, catalog.boards);
  const spaces = matchEntity(typed, catalog.workspaces);
  const tiers = [boards, spaces].flatMap((m) => (m === null || m.kind === 'NONE' ? [] : [m.tier]));
  if (tiers.length === 0) return { kind: 'NOT_FOUND' };
  // Bac khop chac nhat thang: trung ca ten cua mot bang khong bi "hoa" thanh nhieu lua chon boi mot khong gian chi khop mot phan
  const best = Math.min(...tiers);
  const refs: CatalogTarget[] = [];
  if (boards !== null && boards.kind !== 'NONE' && boards.tier === best) {
    for (const board of boards.kind === 'ONE' ? [boards.item] : boards.items) refs.push({ type: 'BOARD', board });
  }
  if (spaces.kind !== 'NONE' && spaces.tier === best) {
    for (const workspace of spaces.kind === 'ONE' ? [spaces.item] : spaces.items) refs.push({ type: 'WORKSPACE', workspace });
  }
  return refs.length === 1 ? { kind: 'ONE', ref: refs[0] } : { kind: 'MANY', refs };
}

/** Bang / khong gian mac dinh theo pham vi (khi cau hoi khong nhac ten). */
export function scopeDefaultTarget(scope: ResolveScope, catalog: EntityCatalog): CatalogTarget | null {
  if (scope.kind === 'BOARD' && scope.board) {
    const found = catalog.boards.find((b) => b.id === scope.board!.id);
    if (found) return { type: 'BOARD', board: found };
    return scope.workspace
      ? { type: 'BOARD', board: { id: scope.board.id, name: scope.board.name, workspaceId: scope.workspace.id, workspaceName: scope.workspace.name } }
      : null;
  }
  if (scope.kind === 'WORKSPACE' && scope.workspace) return { type: 'WORKSPACE', workspace: { id: scope.workspace.id, name: scope.workspace.name } };
  return null;
}

/** Mot cau hoi danh muc voi ten go / id da chon -> bang, khong gian, cot cu the TRONG danh muc cua pham vi (§18.4). */
export function resolveCatalogQuestion(scope: ResolveScope, question: CatalogQuestion, catalog: EntityCatalog): CatalogResolution {
  const { intent } = question;
  const notes: string[] = [];

  // ---- ten bang / khong gian ----
  let target: CatalogTarget | null = null;
  const usesTarget = intent === 'MEMBER_LIST' || intent === 'CARD_COUNTS' || (intent === 'MY_BOARDS' && scope.kind === 'MY');
  if (question.targetId !== null) {
    const board = catalog.boards.find((b) => b.id === question.targetId);
    const workspace = catalog.workspaces.find((w) => w.id === question.targetId);
    target = board ? { type: 'BOARD', board } : workspace ? { type: 'WORKSPACE', workspace } : null;
    if (target === null) return { kind: 'NOT_FOUND', typed: 'lựa chọn của bạn', what: 'BOARD_OR_WORKSPACE', targetName: null };
  } else if (question.target !== null && usesTarget) {
    const r = resolveTargetText(question.target, intent, catalog);
    if (r.kind === 'NOT_FOUND') {
      return { kind: 'NOT_FOUND', typed: question.target, what: intent === 'MY_BOARDS' ? 'WORKSPACE' : 'BOARD_OR_WORKSPACE', targetName: null };
    }
    if (r.kind === 'MANY') return { kind: 'CLARIFY', typed: question.target, refs: r.refs };
    target = r.ref;
  } else if (question.target !== null) {
    notes.push('Trợ lý bỏ qua tên bảng / không gian vì loại câu hỏi này không dùng tới, hoặc bạn đang xem trong phạm vi hẹp hơn.');
  }
  if (target === null && intent === 'MEMBER_LIST') target = scopeDefaultTarget(scope, catalog);
  if (target === null && intent === 'MEMBER_LIST') {
    return { kind: 'NOT_FOUND', typed: 'bảng hoặc không gian bạn hỏi', what: 'BOARD_OR_WORKSPACE', targetName: null };
  }

  // ---- ten cot (chi CARD_COUNTS) ----
  let columns: ColumnEntity[] | null = null;
  let columnName: string | null = null;
  if (question.column !== null && intent !== 'CARD_COUNTS') {
    notes.push('Trợ lý chưa lọc theo cột cho loại câu hỏi này.');
  } else if (question.column !== null) {
    const boardOfScope = target?.type === 'BOARD' ? target.board.id : scope.kind === 'BOARD' && scope.board ? scope.board.id : null;
    const boardIdsOfWorkspace =
      target?.type === 'WORKSPACE' ? new Set(catalog.boards.filter((b) => b.workspaceId === target.workspace.id).map((b) => b.id)) : null;
    const pool = catalog.columns.filter((c) =>
      boardOfScope !== null ? c.boardId === boardOfScope : boardIdsOfWorkspace !== null ? boardIdsOfWorkspace.has(c.boardId) : true
    );
    const m = matchEntity(question.column, pool);
    if (m.kind === 'NONE') return { kind: 'NOT_FOUND', typed: question.column, what: 'COLUMN', targetName: target ? targetName(target) : null };
    columns = m.kind === 'ONE' ? [m.item] : m.items;
    const names = [...new Set(columns.map((c) => c.name.toLowerCase()))];
    columnName = names.length === 1 ? columns[0].name : question.column;
  }
  return { kind: 'RESOLVED', target, columns, columnName, notes };
}
