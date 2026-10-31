import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import { env } from '../../../config/env';
import { prisma } from '../../../config/prisma';
import { Prisma } from '../../../generated/prisma/client';
import { AppError } from '../../../utils/AppError';
import { liveCardWhere, type ChatScopeInput } from '../chat.scope';
import { resolveExecutionContext } from './chat.v2.scope';
import { v2Sessions, type V2Session } from './chat.v2.session';
import { plansByIds } from './actions/actions.plan.repo';
import { cancelPlan, confirmPlan, viewFromRow, type PlanDecision } from './actions/actions.service';
import { bindEntity } from './chat.v2.orchestrator';
import { handleV2Message, handleV2Choice, handleV2More, type V2ServiceContext } from './chat.v2.service';
import { v2Reply } from './chat.v2.answer';
import { v2MessageSchema, v2ChoiceSchema, v2MoreSchema, v2ConfirmSchema, type V2Reply, type V2Block } from './chat.v2.contract';

export const historyListSchema = z.object({ page: z.coerce.number().int().min(1).max(10000).default(1) }).strict();
export const historyTurnsSchema = z.object({ before: z.coerce.number().int().positive().optional() }).strict();
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
interface Access {
  scopes: ChatScopeInput[]; boards: string[]; cards: string[]; users: string[];
  rosters: { scope: ChatScopeInput; ids: string[] }[];
}

async function owned(userId: string, id: string) {
  const row = await prisma.chatConversation.findFirst({ where: { id, userId } });
  if (!row) throw new AppError('Không tìm thấy hội thoại.', 404);
  return row;
}
async function resume(userId: string, id: string, context: V2ServiceContext): Promise<V2Session> {
  const row = await owned(userId, id);
  const store = context.sessions ?? v2Sessions;
  const cached = store.get(userId, id, context.now);
  // Another device/process may have advanced this thread. The database is authoritative.
  return cached && isDeepStrictEqual(savedState(cached), row.state) ? cached : store.restore(row.state as unknown as V2Session, context.now);
}

async function accessFor(s: V2Session, reply: V2Reply | null, now: Date): Promise<Access> {
  const scopes = new Map<string, ChatScopeInput>();
  const addScope = (scope: ChatScopeInput) => scopes.set(JSON.stringify(scope), scope);
  const boards = new Set<string>(), cards = new Set<string>(), users = new Set<string>();
  const rosters: Access['rosters'] = [];
  const blocks = reply?.answer.blocks;
  if (!blocks?.length) addScope(s.scope ?? s.uiScope);
  for (const b of blocks ?? []) {
    if (b.status !== 'OK') continue;
    addScope(b.source.scope);
    if (b.tool === 'query_catalog') {
      if (b.data.kind === 'BOARDS') for (const row of b.data.rows) boards.add(row.id);
      if (b.data.kind === 'WORKSPACES') for (const row of b.data.rows) addScope({ kind: 'WORKSPACE', workspaceId: row.id });
      if (b.data.kind === 'MEMBERS') rosters.push({ scope: b.source.scope, ids: b.data.rows.map((r) => r.id) });
    }
    if (b.tool === 'aggregate_tasks' && b.data.groupBy === 'BOARD') for (const row of b.data.rows) boards.add(row.id);
    if (b.tool === 'aggregate_tasks' && b.data.groupBy === 'ASSIGNEE') rosters.push({ scope: b.source.scope, ids: b.data.rows.map((r) => r.id) });
    if (b.tool === 'query_data' && b.data.mode === 'GROUPS') {
      const ids = b.data.groups.flatMap((g) => (g.id === null ? [] : [g.id]));
      if (b.data.groupBy === 'boardId') ids.forEach((id) => boards.add(id));
      if (b.data.groupBy === 'cardId') ids.forEach((id) => cards.add(id));
      if (b.data.groupBy === 'assigneeId' || b.data.groupBy === 'authorId' || b.data.groupBy === 'uploaderId') rosters.push({ scope: b.source.scope, ids });
    }
  }
  // Historical text must not expose card snapshots after a card moves to a private board.
  function visit(value: unknown): void {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
    if (typeof row.boardId === 'string') boards.add(row.boardId);
    if (row.redacted !== true && typeof row.cardId === 'string') cards.add(row.cardId);
    if (typeof row.id === 'string' && typeof row.title === 'string' && typeof row.boardId === 'string') cards.add(row.id);
    if (Array.isArray(row.assignees)) for (const person of row.assignees) {
      if (person && typeof person === 'object' && typeof person.id === 'string') users.add(person.id);
    }
    if (row.actor && typeof row.actor === 'object' && 'id' in row.actor && typeof row.actor.id === 'string') users.add(row.actor.id);
    Object.values(row).forEach(visit);
  }
  visit(reply?.answer);
  for (const option of s.pending?.options ?? []) {
    if (option.kind === 'BOARD') boards.add(option.id);
    if (option.kind === 'WORKSPACE') addScope({ kind: 'WORKSPACE', workspaceId: option.id });
    if (option.kind === 'MEMBER') users.add(option.id);
  }
  for (const scope of scopes.values()) {
    try {
      const ctx = await resolveExecutionContext({ userId: s.userId, now, scope });
      const rows = await prisma.board.findMany({ where: ctx.scope.boardWhere, select: { id: true } });
      rows.forEach((row) => boards.add(row.id));
      if (!blocks?.length) rosters.push({ scope, ids: ctx.roster.map((r) => r.userId) });
    } catch (e) { if (!(e instanceof AppError) || e.statusCode >= 500) throw e; }
  }
  return { scopes: [...scopes.values()], boards: [...boards], cards: [...cards], users: [...users], rosters };
}
function savedState(s: V2Session) {
  // v1 sessions are ephemeral. Keep the v2 board context, but never persist a v1 handle.
  const { legacyId: _legacyId, legacyOptions: _legacyOptions, touched: _touched, ...state } = s;
  return json(state);
}
async function append(s: V2Session, question: string, reply: V2Reply | null, error: string | null, now: Date) {
  const access = await accessFor(s, reply, now);
  await prisma.$transaction(async (tx) => {
    await tx.chatConversation.upsert({ where: { id: s.id },
      create: { id: s.id, userId: s.userId, title: question.trim().slice(0, 80), state: savedState(s) },
      update: { state: savedState(s), updatedAt: new Date() },
    });
    await tx.chatTurn.create({ data: { conversationId: s.id, question, ...(reply ? { reply: json(reply) } : {}), error, access: json(access) } });
  });
}
export async function persistentMessage(userId: string, input: z.infer<typeof v2MessageSchema>, context: V2ServiceContext) {
  const store = context.sessions ?? v2Sessions;
  const s = input.conversationId ? await resume(userId, input.conversationId, context) : store.create(userId, input.scope, context.now);
  let reply: V2Reply;
  try { reply = await handleV2Message(userId, { ...input, conversationId: s.id }, context); }
  catch (e) {
    const error = e instanceof AppError && e.statusCode < 500 ? e.message : 'Không thể trả lời câu hỏi lúc này. Hãy thử lại.';
    await append(s, input.message, null, error, context.now);
    throw e;
  }
  await append(s, input.message, reply, null, context.now);
  return reply;
}
export async function persistentChoice(userId: string, input: z.infer<typeof v2ChoiceSchema>, context: V2ServiceContext) {
  const s = await resume(userId, input.conversationId, context);
  const option = s.pending?.options.find((o) => o.id === input.optionId);
  const reply = await handleV2Choice(userId, input, context);
  await append(s, `Chọn: ${option?.name ?? 'đối tượng'}`, reply, null, context.now);
  return reply;
}
/** Ap dung / huy bang NUT: ghi mot luot lich su rieng ("Ap dung: ...") de mo lai hoi thoai thay duoc ket qua. Khong goi LLM. */
async function recordDecision(s: V2Session, decision: PlanDecision, question: string, now: Date): Promise<V2Reply> {
  for (const entity of decision.bind) bindEntity(s, entity);
  const reply = v2Reply(s, now, [], 'AI', decision.text, [], { action: { kind: 'RESULT', result: decision.result } });
  await append(s, question, reply, null, now);
  return reply;
}
export async function persistentConfirm(userId: string, planId: string, input: z.infer<typeof v2ConfirmSchema>, context: V2ServiceContext): Promise<V2Reply> {
  // Công tắc tổng: tắt CHAT_ACTIONS là dừng MỌI thao tác ghi của trợ lý, kể cả kế hoạch đã xem trước từ trước đó.
  if (!(context.actions ?? env.chatActions)) throw new AppError('Trợ lý đang tắt chức năng thay đổi dữ liệu nên chưa áp dụng được. Chưa thay đổi gì.', 403);
  const s = await resume(userId, input.conversationId, context);
  const decision = await confirmPlan({ userId, planId, conversationId: s.id, checksum: input.checksum, scope: input.scope, now: context.now });
  return recordDecision(s, decision, `Áp dụng: ${decision.label}`, context.now);
}
export async function persistentCancel(userId: string, planId: string, conversationId: string, context: V2ServiceContext): Promise<V2Reply> {
  const s = await resume(userId, conversationId, context);
  const decision = await cancelPlan({ userId, planId, conversationId: s.id, now: context.now });
  return recordDecision(s, decision, `Hủy: ${decision.label}`, context.now);
}
function mergeRows<T extends { id: string }>(a: T[], b: T[]): T[] { return [...new Map([...a, ...b].map((row) => [row.id, row])).values()]; }
function mergeBlock(a: V2Block, b: V2Block): V2Block {
  if (a.status !== 'OK' || b.status !== 'OK' || a.tool !== b.tool) return b;
  if (a.tool === 'query_tasks' && b.tool === 'query_tasks') return { ...b, data: { ...b.data, cards: mergeRows(a.data.cards, b.data.cards) } };
  if (a.tool === 'aggregate_tasks' && b.tool === 'aggregate_tasks') return { ...b, data: { ...b.data, rows: mergeRows(a.data.rows, b.data.rows) } };
  if (a.tool === 'query_data' && b.tool === 'query_data') return { ...b, data: { ...b.data, rows: mergeRows(a.data.rows, b.data.rows), groups: [...new Map([...a.data.groups, ...b.data.groups].map((g) => [g.id ?? g.label, g])).values()] } };
  if (a.tool === 'query_activities' && b.tool === 'query_activities') return { ...b, data: { ...b.data, cards: mergeRows(a.data.cards, b.data.cards), events: mergeRows(a.data.events, b.data.events) } } as V2Block;
  if (a.tool === 'query_catalog' && b.tool === 'query_catalog') {
    if (a.data.kind === 'BOARDS' && b.data.kind === 'BOARDS') return { ...b, data: { ...b.data, rows: mergeRows(a.data.rows, b.data.rows) } };
    if (a.data.kind === 'WORKSPACES' && b.data.kind === 'WORKSPACES') return { ...b, data: { ...b.data, rows: mergeRows(a.data.rows, b.data.rows) } };
    if (a.data.kind === 'MEMBERS' && b.data.kind === 'MEMBERS') return { ...b, data: { ...b.data, rows: mergeRows(a.data.rows, b.data.rows) } };
  }
  return b;
}
export async function persistentMore(userId: string, input: z.infer<typeof v2MoreSchema>, context: V2ServiceContext) {
  const s = await resume(userId, input.conversationId, context);
  const reply = await handleV2More(userId, input, context);
  const last = await prisma.chatTurn.findFirst({ where: { conversationId: s.id, reply: { not: Prisma.DbNull } }, orderBy: { id: 'desc' } });
  if (!last?.reply) throw new AppError('Không tìm thấy phần trả lời đã lưu.', 404);
  const previous = last.reply as unknown as V2Reply;
  const merged: V2Reply = input.blockId ? { ...previous, answer: { ...previous.answer,
    blocks: previous.answer.blocks?.map((b) => {
      const incoming = reply.answer.blocks?.find((n) => n.id === b.id);
      return incoming ? mergeBlock(b, incoming) : b;
    }),
  } } : { ...previous, answer: { ...previous.answer, ...reply.answer, cards: mergeRows(previous.answer.cards, reply.answer.cards) } };
  const access = await accessFor(s, merged, context.now);
  await prisma.$transaction([
    prisma.chatTurn.update({ where: { id: last.id }, data: { reply: json(merged), access: json(access) } }),
    prisma.chatConversation.update({ where: { id: s.id }, data: { state: savedState(s), updatedAt: new Date() } }),
  ]);
  return reply;
}
/** Trang ma cau hoi CUOI CUNG cua hoi thoai duoc gui tu (chi kind + id, khong lo them trang thai phien). */
function savedUiScope(state: unknown): ChatScopeInput {
  const ui = (state as { uiScope?: { kind?: string; boardId?: unknown; workspaceId?: unknown } } | null)?.uiScope;
  if (ui?.kind === 'BOARD' && typeof ui.boardId === 'string') return { kind: 'BOARD', boardId: ui.boardId };
  if (ui?.kind === 'WORKSPACE' && typeof ui.workspaceId === 'string') return { kind: 'WORKSPACE', workspaceId: ui.workspaceId };
  return { kind: 'MY' };
}
export async function listConversations(userId: string, page: number) {
  const rows = await prisma.chatConversation.findMany({ where: { userId }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 21,
    select: { id: true, title: true, createdAt: true, updatedAt: true, state: true, _count: { select: { turns: true } } },
  });
  // `scope`: giao dien chi khoi phuc hoi thoai KHI MO TRO LY khi hoi thoai do thuoc dung bang / trang dang mo
  return { page, hasMore: rows.length > 20, conversations: rows.slice(0, 20).map(({ _count, state, ...row }) => ({ ...row, turnCount: _count.turns, scope: savedUiScope(state) })) };
}
export async function conversationHistory(userId: string, id: string, before: number | undefined, now: Date) {
  const conversation = await owned(userId, id);
  const state = conversation.state as unknown as V2Session;
  const rows = await prisma.chatTurn.findMany({ where: { conversationId: id, ...(before ? { id: { lt: before } } : {}) }, orderBy: { id: 'desc' }, take: 51 });
  const hasMore = rows.length > 50;
  const ctx = await resolveExecutionContext({ userId, now, scope: { kind: 'MY' } });
  const readable = new Set((await prisma.board.findMany({ where: ctx.scope.boardWhere, select: { id: true } })).map((b) => b.id));
  const permissions = new Map<string, ReturnType<typeof resolveExecutionContext>>();
  const scopeContext = (scope: ChatScopeInput) => {
    const key = JSON.stringify(scope);
    if (!permissions.has(key)) permissions.set(key, resolveExecutionContext({ userId, now, scope }));
    return permissions.get(key)!;
  };
  async function permitted(access: Access): Promise<boolean> {
    if (access.boards.some((b) => !readable.has(b))) return false;
    try {
      for (const scope of access.scopes) await scopeContext(scope);
      for (const roster of access.rosters) {
        const current = new Set((await scopeContext(roster.scope)).roster.map((p) => p.userId));
        if (roster.ids.some((id) => !current.has(id))) return false;
      }
    } catch (e) { if (e instanceof AppError && e.statusCode < 500) return false; throw e; }
    if (access.cards.length && await prisma.card.count({ where: { AND: [liveCardWhere(ctx.scope.boardWhere), { id: { in: access.cards } }] } }) !== access.cards.length) return false;
    if (access.users.length && await prisma.user.count({ where: { id: { in: access.users }, deletedAt: null } }) !== access.users.length) return false;
    return true;
  }
  // Ban xem truoc da luu chi la anh chup: phu TRANG THAI THAT (da ap dung / huy / het han) de nut cu khong bat lai.
  const planIds = rows.flatMap((row) => { const a = (row.reply as unknown as V2Reply | null)?.answer.action; return a?.kind === 'PLAN' ? [a.plan.planId] : []; });
  const livePlans = await plansByIds(userId, planIds);
  const turns = [];
  for (const row of rows.slice(0, 50).reverse()) {
    let reply = row.reply as unknown as V2Reply | null;
    if (reply && !await permitted(row.access as unknown as Access)) {
      reply = v2Reply(state, now, [], 'BASIC', 'Nội dung trả lời đã lưu không còn được phép xem hoặc dữ liệu liên quan đã bị xóa.');
      reply.answer.kind = 'ANSWER'; delete reply.answer.clarify;
    } else if (reply) {
      reply.answer.blocks = reply.answer.blocks?.map((b) => b.status === 'OK' ? { ...b, pagination: { ...b.pagination,
        hasMore: b.pagination.hasMore && state.queries.some((q) => q.blockId === b.id && q.hasMore && q.page === b.pagination.page),
      } } : b);
      const saved = reply.answer.action;
      if (saved?.kind === 'PLAN') { const live = livePlans.get(saved.plan.planId); if (live) reply.answer.action = viewFromRow(live, now); }
      // v1 page/choice handles cannot survive a backend restart; display saved data only.
      if (!reply.answer.blocks) { reply.answer.total = reply.answer.cards.length; delete reply.answer.clarify; }
      if (row.id !== rows[0]?.id || before) delete reply.answer.clarify;
    }
    turns.push({ id: row.id, question: row.question, reply, error: row.error, createdAt: row.createdAt });
  }
  return { conversation: { id, title: conversation.title, updatedAt: conversation.updatedAt }, turns, hasMore, before: turns[0]?.id ?? null };
}
