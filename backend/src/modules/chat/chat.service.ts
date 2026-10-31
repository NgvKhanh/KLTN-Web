// Dieu phoi mot luot hoi (CHATBOT_MODULE.md §3, §9, §12).
//
//   cau hoi -> hieu cau (bo luat + LLM, gop B2; LLM loi -> bo luat) -> cau noi tiep
//   -> kiem pham vi + quyen (DOC LAI moi luot) -> nhan dien nguoi -> tham so hieu luc
//   -> truy van -> dung cau tra loi theo mau -> (chi tong ket nhom) nhan xet AI tu so dem.
//
// Quyen va pham vi luon doc lai tu CSDL (resolveScope / loadRoster), ke ca o /choice va
// /more: phien chi giu y dinh, tham so, id nguoi da chon - khong giu quyen hay du lieu.
// /choice va /more KHONG goi LLM (§12.1).
// `now` do controller truyen vao (tep duy nhat doc dong ho). Khong ghi log noi dung.

import { AppError } from '../../utils/AppError';
import {
  periodText,
  renderAnswer,
  renderAskWho,
  renderClarifyMember,
  renderClarifyWorkspace,
  renderMemberNotFound,
  renderUnsupported,
  type ChatAnswer,
  type ScopeInfo,
} from './chat.answer';
import { answerCatalog, loadCatalog } from './chat.catalog';
import type { EntityCatalog } from './chat.entities';
import { applyFollowUp, type FollowUpContext } from './chat.followup';
import {
  isCatalogQuestion,
  resolveSlots,
  type CatalogQuestion,
  type ChatFocus,
  type ChatIntent,
  type ChatPeriod,
  type FinalQuestion,
  type ParsedQuestion,
} from './chat.intent';
import { chatLlmAvailable, defaultChatLlm, understandHybrid, type ChatLlmDeps } from './chat.llm';
import { resolveMemberRef, type RosterMember } from './chat.members';
import { runQuery } from './chat.queries';
import { parseByRules } from './chat.rules';
import {
  listChoosableWorkspaces,
  loadMyRoster,
  loadRoster,
  resolveScope,
  type ChatScopeInput,
  type ResolvedScope,
} from './chat.scope';
import { scopeKeyOf, type ChatSessionState, type ChatSessionStore, type Parser } from './chat.session';
import { requestSummaryComment } from './chat.summary';

/**
 * Bo "hieu cau hoi": nhan cau hoi + danh sach nguoi (chi o server, KHONG gui LLM) + ngu canh
 * luot truoc + thoi diem (cho ngan sach LLM). Khong bao gio nhan du lieu the.
 */
export type Understand = (
  question: string,
  roster: readonly RosterMember[],
  prev: FollowUpContext | null,
  now: Date,
  /** Danh muc ten bang / khong gian / cot cua pham vi (§18) - chi o server, KHONG gui LLM. */
  catalog: EntityCatalog
) => Promise<{ parsed: ParsedQuestion; parser: Parser }>;

/** Chi bo luat (nhanh B0). */
export const understandByRules: Understand = async (question, roster, _prev, _now, catalog) => ({
  parsed: parseByRules(question, roster, catalog),
  parser: 'RULE',
});

export interface ChatContext {
  now: Date;
  sessions: ChatSessionStore;
  /** Mac dinh: bo luat + LLM (understandHybrid) voi `llm`. */
  understand?: Understand;
  /** Mac dinh: cau hinh + ngan sach chung cua tien trinh (defaultChatLlm). */
  llm?: ChatLlmDeps;
}

export interface Understood {
  intent: ChatIntent;
  period: ChatPeriod | null;
  focus: ChatFocus | null;
  /** Ten DA nhan dien (tu CSDL), khong phai chuoi go. */
  memberName: string | null;
  /** Cau hoi danh muc (§18): ten bang / khong gian / cot DA nhan dien. */
  targetName?: string | null;
  columnName?: string | null;
  parser: Parser;
}

export interface ChatReply {
  conversationId: string;
  conversationReset?: true;
  understood: Understood;
  answer: ChatAnswer;
}

const TEAM_INTENTS: readonly ChatIntent[] = ['MEMBER_TASKS', 'TEAM_SUMMARY', 'TEAM_WORKLOAD'];
const CONVERSATION_GONE = 'Hoi thoai da het han hoac khong ton tai, hay hoi lai';
const BAD_CHOICE = 'Lua chon khong hop le';

export function scopeInfoOf(scope: ResolvedScope): ScopeInfo {
  return {
    kind: scope.kind,
    workspaceName: scope.workspace?.name ?? null,
    boardName: scope.board?.name ?? null,
    boardCount: scope.boardCount,
    isLeader: scope.isLeader,
  };
}

function scopeInputOf(scope: ResolvedScope): ChatScopeInput {
  if (scope.kind === 'BOARD' && scope.board) return { kind: 'BOARD', boardId: scope.board.id };
  if (scope.kind === 'WORKSPACE' && scope.workspace) return { kind: 'WORKSPACE', workspaceId: scope.workspace.id };
  return { kind: 'MY' };
}

function understoodOf(q: FinalQuestion, parser: Parser, memberName: string | null): Understood {
  const r = resolveSlots(q);
  return { intent: r.intent, period: r.period, focus: r.focus, memberName, parser };
}

/**
 * Tra loi mot cau hoi da qua buoc noi tiep, trong pham vi da kiem quyen. Ghi ngu canh +
 * truy van cuoi vao phien; tao cau hoi lai (dat `pending`) khi can.
 * `llm` = null -> khong goi LLM (tra loi cau hoi lai qua /choice, §12.1).
 */
async function answerQuestion(
  session: ChatSessionState,
  scope: ResolvedScope,
  question: FinalQuestion,
  parser: Parser,
  now: Date,
  llm: ChatLlmDeps | null
): Promise<{ understood: Understood; answer: ChatAnswer }> {
  const info = scopeInfoOf(scope);

  // Hoi ve nhom / nguoi khac o pham vi ca nhan -> chon khong gian (1 khong gian thi dung luon)
  if (scope.kind === 'MY' && TEAM_INTENTS.includes(question.intent)) {
    const options = await listChoosableWorkspaces(scope.userId);
    if (options.length === 1) {
      const only = await resolveScope(scope.userId, { kind: 'WORKSPACE', workspaceId: options[0].id });
      return answerQuestion(session, only, question, parser, now, llm);
    }
    session.pending = {
      kind: 'WORKSPACE',
      question,
      scopeInput: { kind: 'MY' },
      optionIds: options.map((o) => o.id),
      parser,
    };
    return { understood: understoodOf(question, parser, null), answer: renderClarifyWorkspace(options, info, now) };
  }

  const resolved = resolveSlots(question);
  const roster = scope.kind === 'MY' ? [] : await loadRoster(scope);
  let target: RosterMember | null = null;

  if (resolved.intent === 'MEMBER_TASKS') {
    if (question.memberText === null && question.memberUserId === null) {
      session.pending = null;
      return { understood: understoodOf(question, parser, null), answer: renderAskWho(info, now) };
    }
    const match = resolveMemberRef(question, roster);
    if (match.kind === 'NONE') {
      // Khong noi nguoi do co ton tai o noi khac hay khong (§8.3)
      return {
        understood: understoodOf(question, parser, null),
        answer: renderMemberNotFound(question.memberText ?? 'người bạn hỏi', info, now),
      };
    }
    if (match.kind === 'MANY') {
      session.pending = {
        kind: 'MEMBER',
        question: { ...question, memberText: null, memberUserId: null },
        scopeInput: scopeInputOf(scope),
        optionIds: match.members.map((m) => m.userId),
        parser,
      };
      return {
        understood: understoodOf(question, parser, null),
        answer: renderClarifyMember(question.memberText ?? '', match.members, info, now),
      };
    }
    target = match.member;
  }

  const result = await runQuery({ scope, now, page: 1 }, resolved, { target, roster });
  const answer = renderAnswer({ query: resolved, scope: info, result, memberName: target?.name ?? null, now });

  // Nhan xet AI (§11): chi tong ket nhom, chi khi luot nay LLM dung duoc (hieu cau khong phai
  // lui ve bo luat) - LLM vua loi thi goi lai cung vo ich va nguoi dung phai doi them.
  const kind = scope.kind;
  if (llm && parser !== 'RULE' && kind !== 'MY' && resolved.intent === 'TEAM_SUMMARY' && resolved.focus === null && result.kind === 'LIST') {
    const input = { periodLabel: periodText(resolved.period ?? 'THIS_WEEK'), scopeKind: kind, counts: result.counts };
    const comment = await requestSummaryComment(llm, input, roster, now.getTime());
    if (comment.ok) answer.comment = comment.comment;
  }

  // Ngu canh cho cau noi tiep: tham so NGUOI DUNG da noi (truoc mac dinh) + nguoi da nhan dien
  session.context = {
    intent: resolved.intent,
    period: question.period,
    focus: question.focus,
    memberUserId: target?.userId ?? null,
  };
  session.lastQuery = { resolved, memberUserId: target?.userId ?? null, scopeInput: scopeInputOf(scope), parser };
  session.pending = null;
  return { understood: understoodOf(question, parser, target?.name ?? null), answer };
}

function catalogUnderstood(q: CatalogQuestion, parser: Parser, targetName: string | null, columnName: string | null): Understood {
  return { intent: q.intent, period: null, focus: null, memberName: null, targetName, columnName, parser };
}

/**
 * Tra loi mot cau hoi danh muc (§18). MEMBER_LIST o pham vi ca nhan ma khong noi ten -> hoi khong gian (1 khong gian thi
 * dung luon); trung ten bang / khong gian -> nut chon (`pending` kieu TARGET). Sau cau tra loi danh muc ngu canh noi tiep bi
 * xoa (khong noi tiep duoc) va khong con "Xem them".
 */
async function answerCatalogQuestion(
  session: ChatSessionState,
  scope: ResolvedScope,
  question: CatalogQuestion,
  parser: Parser,
  now: Date,
  catalog?: EntityCatalog
): Promise<{ understood: Understood; answer: ChatAnswer }> {
  const info = scopeInfoOf(scope);
  if (question.intent === 'MEMBER_LIST' && scope.kind === 'MY' && question.target === null && question.targetId === null) {
    const options = await listChoosableWorkspaces(scope.userId);
    if (options.length === 1) {
      const only = await resolveScope(scope.userId, { kind: 'WORKSPACE', workspaceId: options[0].id });
      return answerCatalogQuestion(session, only, question, parser, now);
    }
    session.pending = { kind: 'WORKSPACE', question, scopeInput: { kind: 'MY' }, optionIds: options.map((o) => o.id), parser };
    return { understood: catalogUnderstood(question, parser, null, null), answer: renderClarifyWorkspace(options, info, now) };
  }
  const out = await answerCatalog(scope, info, question, now, catalog);
  session.context = null;
  session.lastQuery = null;
  session.pending = out.pendingTargets
    ? { kind: 'TARGET', question: { ...question, target: null }, scopeInput: scopeInputOf(scope), optionIds: out.pendingTargets, parser }
    : null;
  return { understood: catalogUnderstood(question, parser, out.targetName, out.columnName), answer: out.answer };
}

function openSession(
  ctx: ChatContext,
  userId: string,
  scopeInput: ChatScopeInput,
  conversationId: string | undefined
): { id: string; state: ChatSessionState; reset: boolean } {
  const nowMs = ctx.now.getTime();
  const key = scopeKeyOf(scopeInput);
  if (conversationId) {
    const state = ctx.sessions.get(conversationId, userId, nowMs);
    if (state) {
      if (state.scopeKey !== key) {
        // Doi pham vi: KHONG ke thua ngu canh / cau hoi lai / truy van cuoi
        state.scopeKey = key;
        state.context = null;
        state.pending = null;
        state.lastQuery = null;
      }
      return { id: conversationId, state, reset: false };
    }
  }
  const created = ctx.sessions.create(userId, key, nowMs);
  return { ...created, reset: conversationId !== undefined };
}

export async function handleMessage(
  userId: string,
  input: { message: string; scope: ChatScopeInput; conversationId?: string },
  ctx: ChatContext
): Promise<ChatReply> {
  // Kiem pham vi TRUOC khi tao / sua phien: sai quyen thi khong de lai gi
  const scope = await resolveScope(userId, input.scope);
  const { id, state, reset } = openSession(ctx, userId, input.scope, input.conversationId);
  state.pending = null; // cau hoi moi bo cau hoi lai dang cho

  const roster = scope.kind === 'MY' ? await loadMyRoster(userId) : await loadRoster(scope);
  const llm = ctx.llm ?? defaultChatLlm();
  const catalog = await loadCatalog(scope);
  const understand: Understand =
    ctx.understand ?? ((question, names, prev, now, cat) => understandHybrid(question, names, prev, now.getTime(), llm, cat));
  const { parsed, parser } = await understand(input.message, roster, state.context, ctx.now, catalog);
  const fu = applyFollowUp(parsed, state.context);

  const base = { conversationId: id, ...(reset ? { conversationReset: true as const } : {}) };
  if (fu.kind === 'UNSUPPORTED') {
    return {
      ...base,
      understood: { intent: 'UNSUPPORTED', period: null, focus: null, memberName: null, parser },
      answer: renderUnsupported(scopeInfoOf(scope), ctx.now),
    };
  }
  if (fu.kind === 'CATALOG') return { ...base, ...(await answerCatalogQuestion(state, scope, fu.question, parser, ctx.now, catalog)) };
  return { ...base, ...(await answerQuestion(state, scope, fu.question, parser, ctx.now, llm)) };
}

/** Tra loi cau hoi lai (chon nguoi / chon khong gian) - KHONG goi LLM (§9.3). */
export async function handleChoice(
  userId: string,
  input: { conversationId: string; userId?: string; workspaceId?: string; targetId?: string },
  ctx: ChatContext
): Promise<ChatReply> {
  const state = ctx.sessions.get(input.conversationId, userId, ctx.now.getTime());
  if (!state) throw new AppError(CONVERSATION_GONE, 404);
  const pending = state.pending;
  if (!pending) throw new AppError('Khong co cau hoi lai nao dang cho', 400);

  const chosen = pending.kind === 'MEMBER' ? input.userId : pending.kind === 'TARGET' ? input.targetId : input.workspaceId;
  if (!chosen || !pending.optionIds.includes(chosen)) throw new AppError(BAD_CHOICE, 400);

  const scopeInput: ChatScopeInput =
    pending.kind === 'WORKSPACE' ? { kind: 'WORKSPACE', workspaceId: chosen } : pending.scopeInput;
  const scope = await resolveScope(userId, scopeInput); // kiem lai quyen
  state.pending = null;
  if (isCatalogQuestion(pending.question)) {
    const cq: CatalogQuestion = pending.kind === 'TARGET' ? { ...pending.question, target: null, targetId: chosen } : pending.question;
    return { conversationId: input.conversationId, ...(await answerCatalogQuestion(state, scope, cq, pending.parser, ctx.now)) };
  }
  const question: FinalQuestion =
    pending.kind === 'MEMBER' ? { ...pending.question, memberText: null, memberUserId: chosen } : pending.question;
  return { conversationId: input.conversationId, ...(await answerQuestion(state, scope, question, pending.parser, ctx.now, null)) };
}

/** Trang tiep theo cua cau tra loi truoc - KHONG goi LLM, kiem lai pham vi va nguoi. */
export async function handleMore(
  userId: string,
  input: { conversationId: string; page: number },
  ctx: ChatContext
): Promise<ChatReply> {
  const state = ctx.sessions.get(input.conversationId, userId, ctx.now.getTime());
  if (!state) throw new AppError(CONVERSATION_GONE, 404);
  const last = state.lastQuery;
  if (!last) throw new AppError('Chua co cau tra loi nao de xem them', 400);

  const scope = await resolveScope(userId, last.scopeInput);
  const info = scopeInfoOf(scope);
  const roster = await loadRoster(scope);
  let target: RosterMember | null = null;
  if (last.memberUserId !== null) {
    const match = resolveMemberRef({ memberText: null, memberUserId: last.memberUserId }, roster);
    if (match.kind !== 'ONE') {
      return {
        conversationId: input.conversationId,
        understood: { intent: last.resolved.intent, period: last.resolved.period, focus: last.resolved.focus, memberName: null, parser: last.parser },
        answer: renderMemberNotFound('người bạn hỏi', info, ctx.now),
      };
    }
    target = match.member;
  }
  const result = await runQuery({ scope, now: ctx.now, page: input.page }, last.resolved, { target, roster });
  return {
    conversationId: input.conversationId,
    understood: {
      intent: last.resolved.intent,
      period: last.resolved.period,
      focus: last.resolved.focus,
      memberName: target?.name ?? null,
      parser: last.parser,
    },
    answer: renderAnswer({ query: last.resolved, scope: info, result, memberName: target?.name ?? null, now: ctx.now }),
  };
}

/** Co LLM hay khong (giao dien hien "Chế độ cơ bản"). KHONG BAO GIO tra 503 vi thieu khoa. */
export function getChatStatus(deps: ChatLlmDeps = defaultChatLlm()): { llmAvailable: boolean } {
  return { llmAvailable: chatLlmAvailable(deps.cfg) };
}
