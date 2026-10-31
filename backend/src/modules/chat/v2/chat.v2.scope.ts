import { prisma } from '../../../config/prisma';
import { AppError } from '../../../utils/AppError';
import { chatScopeSchema } from '../chat.schema';
import { resolveScope, loadRoster, type ChatScopeInput, type ResolvedScope } from '../chat.scope';
import type { RosterMember } from '../chat.members';

/** Server-owned context. No roles, names or saved permissions are accepted from tool inputs. */
export interface ToolContext {
  userId: string;
  now: Date;
  scope: ChatScopeInput;
  conversationScope?: ChatScopeInput;
}
export interface ExecutionContext {
  scope: ResolvedScope;
  scopeInput: ChatScopeInput;
  now: Date;
  roster: RosterMember[];
}
/** The future session layer calls this when the UI scope changes. Keep only server-owned identity/time. */
export function withUiScope(ctx: ToolContext, next: ChatScopeInput): ToolContext {
  const scope = chatScopeSchema.parse(next);
  const changed = JSON.stringify(scope) !== JSON.stringify(chatScopeSchema.parse(ctx.scope));
  return { ...ctx, scope, conversationScope: changed ? undefined : ctx.conversationScope };
}
async function accessibleRoster(scope: ResolvedScope): Promise<RosterMember[]> {
  if (scope.kind !== 'MY') return loadRoster(scope);
  const boards = await prisma.board.findMany({
    where: scope.boardWhere,
    select: {
      ownerId: true, visibility: true,
      members: { where: { deletedAt: null }, select: { userId: true } },
      workspace: { select: { ownerId: true, members: { where: { deletedAt: null }, select: { userId: true } } } },
    },
  });
  const ids = new Set<string>([scope.userId]);
  for (const b of boards) {
    ids.add(b.ownerId);
    for (const m of b.members) ids.add(m.userId);
    if (b.visibility === 'WORKSPACE') {
      ids.add(b.workspace.ownerId);
      for (const m of b.workspace.members) ids.add(m.userId);
    }
  }
  return (await prisma.user.findMany({ where: { id: { in: [...ids] }, deletedAt: null }, select: { id: true, name: true } }))
    .map((u) => ({ userId: u.id, name: u.name }));
}
export const OUT_OF_CEILING = 'Trợ lý chỉ làm việc trong phạm vi bạn đang mở. Hãy mở trang chủ để làm việc với bảng khác.';

/**
 * TRẦN PHẠM VI (chatbot theo trang). `ctx.scope` là phạm vi của giao diện: ở trang bảng là BOARD, ở trang khác là MY. Phạm vi
 * một công cụ yêu cầu (đầu vào `scope`, bảng đã chọn trong hội thoại, hoặc mặc định MY của resolve_entities) KHÔNG BAO GIỜ vượt
 * ra ngoài trần: BOARD → chỉ đúng bảng đó (MY / WORKSPACE yêu cầu bị kẹp về bảng; BOARD khác → từ chối); WORKSPACE → chỉ các bảng
 * của không gian đó; MY → không giới hạn thêm (vẫn chỉ các bảng đọc được).
 */
export async function resolveExecutionContext(ctx: ToolContext, explicit?: ChatScopeInput): Promise<ExecutionContext> {
  if (!Number.isFinite(ctx.now.getTime())) throw new AppError('Thời điểm truy vấn không hợp lệ', 400);
  const active = await prisma.user.count({ where: { id: ctx.userId, deletedAt: null } });
  if (!active) throw new AppError('Phiên người dùng không hợp lệ', 401);
  const ui = chatScopeSchema.parse(ctx.scope);
  let scopeInput = chatScopeSchema.parse(explicit ?? ctx.conversationScope ?? ctx.scope);
  if (ui.kind === 'BOARD') {
    if (scopeInput.kind === 'BOARD' && scopeInput.boardId !== ui.boardId) throw new AppError(OUT_OF_CEILING, 403);
    scopeInput = ui;
  } else if (ui.kind === 'WORKSPACE') {
    if (scopeInput.kind === 'WORKSPACE' && scopeInput.workspaceId !== ui.workspaceId) throw new AppError(OUT_OF_CEILING, 403);
    if (scopeInput.kind === 'MY') scopeInput = ui;
  }
  const scope = await resolveScope(ctx.userId, scopeInput);
  if (ui.kind === 'WORKSPACE' && scopeInput.kind === 'BOARD') {
    // bảng yêu cầu phải thuộc không gian của trần
    scope.boardWhere = { AND: [scope.boardWhere, (await resolveScope(ctx.userId, ui)).boardWhere] };
  }
  // Do not include boards left behind by a soft-deleted workspace.
  scope.boardWhere = { AND: [scope.boardWhere, { workspace: { deletedAt: null } }] };
  scope.boardCount = await prisma.board.count({ where: scope.boardWhere });
  if (scope.kind === 'BOARD' && scope.boardCount === 0) throw new AppError('Không tìm thấy bảng trong phạm vi được phép', 403);
  return { scope, scopeInput, now: new Date(ctx.now), roster: await accessibleRoster(scope) };
}
export function assertRosterIds(ids: readonly string[] | undefined, ctx: ExecutionContext): void {
  if (!ids) return;
  const allowed = new Set(ctx.roster.map((m) => m.userId));
  if (ids.some((id) => !allowed.has(id))) throw new AppError('Không tìm thấy thành viên trong phạm vi được phép', 400);
}
