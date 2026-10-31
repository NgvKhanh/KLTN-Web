// Phien hoi thoai tam trong bo nho tien trinh (CHATBOT_MODULE.md §9.1).
//
// HAM THUAN, khong DB, KHONG doc dong ho: moi lan goi nhan `nowMs` tu nguoi goi (controller)
// de test tat dinh. Chi luu y dinh / tham so / pham vi / nguoi da chon / cau hoi lai dang
// cho / truy van cuoi (cho "Xem them") - KHONG luu cau hoi goc, du lieu the hay vai tro.
// Khoi dong lai may chu (hoac tsx watch nap lai) thi mat het phien -> luot sau bao
// conversationReset.

import { randomUUID } from 'node:crypto';
import type { ChatScopeInput } from './chat.scope';
import type { CatalogQuestion, FinalQuestion, ResolvedQuery } from './chat.intent';
import type { FollowUpContext } from './chat.followup';

export const SESSION_TTL_MS = 30 * 60 * 1000;
export const MAX_SESSIONS_PER_USER = 5;
export const MAX_SESSIONS_TOTAL = 2000;

export type Parser = 'RULE' | 'LLM' | 'HYBRID';

/** Cau hoi lai dang cho nguoi dung bam chon (§9.3). */
export interface PendingChoice {
  /** MEMBER: chon nguoi; WORKSPACE: chon khong gian de hoi; TARGET: chon bang / khong gian khi trung ten (§18). */
  kind: 'MEMBER' | 'WORKSPACE' | 'TARGET';
  /** Cau hoi dang do (MEMBER / TARGET: da bo ten go - thay bang id se chon). */
  question: FinalQuestion | CatalogQuestion;
  /** Pham vi se dung khi nguoi dung chon (MEMBER: pham vi hien tai). */
  scopeInput: ChatScopeInput;
  optionIds: string[];
  parser: Parser;
}

/** Truy van cuoi da tra loi - de "Xem them" chay lai ma khong goi LLM. */
export interface LastQuery {
  resolved: ResolvedQuery;
  memberUserId: string | null;
  scopeInput: ChatScopeInput;
  parser: Parser;
}

export interface ChatSessionState {
  userId: string;
  /** Pham vi giao dien dang chon; doi pham vi -> khong ke thua ngu canh. */
  scopeKey: string;
  context: FollowUpContext | null;
  pending: PendingChoice | null;
  lastQuery: LastQuery | null;
  lastUsedAt: number;
}

export function scopeKeyOf(scope: ChatScopeInput): string {
  if (scope.kind === 'WORKSPACE') return `WORKSPACE:${scope.workspaceId}`;
  if (scope.kind === 'BOARD') return `BOARD:${scope.boardId}`;
  return 'MY';
}

export class ChatSessionStore {
  private readonly sessions = new Map<string, ChatSessionState>();

  constructor(
    private readonly opts: { ttlMs: number; maxPerUser: number; maxTotal: number } = {
      ttlMs: SESSION_TTL_MS,
      maxPerUser: MAX_SESSIONS_PER_USER,
      maxTotal: MAX_SESSIONS_TOTAL,
    }
  ) {}

  size(): number {
    return this.sessions.size;
  }

  /** Phien con han CUA DUNG nguoi nay; het han / cua nguoi khac / khong ton tai -> null. */
  get(id: string, userId: string, nowMs: number): ChatSessionState | null {
    const s = this.sessions.get(id);
    if (!s) return null;
    if (nowMs - s.lastUsedAt > this.opts.ttlMs) {
      this.sessions.delete(id);
      return null;
    }
    if (s.userId !== userId) return null;
    s.lastUsedAt = nowMs;
    return s;
  }

  create(userId: string, scopeKey: string, nowMs: number): { id: string; state: ChatSessionState } {
    this.sweep(nowMs);
    const mine = [...this.sessions.entries()].filter(([, s]) => s.userId === userId);
    if (mine.length >= this.opts.maxPerUser) this.evictOldest(mine, mine.length - this.opts.maxPerUser + 1);
    if (this.sessions.size >= this.opts.maxTotal) {
      this.evictOldest([...this.sessions.entries()], this.sessions.size - this.opts.maxTotal + 1);
    }
    const id = randomUUID();
    const state: ChatSessionState = { userId, scopeKey, context: null, pending: null, lastQuery: null, lastUsedAt: nowMs };
    this.sessions.set(id, state);
    return { id, state };
  }

  private sweep(nowMs: number): void {
    for (const [id, s] of this.sessions) if (nowMs - s.lastUsedAt > this.opts.ttlMs) this.sessions.delete(id);
  }

  private evictOldest(entries: [string, ChatSessionState][], count: number): void {
    entries
      .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)
      .slice(0, count)
      .forEach(([id]) => this.sessions.delete(id));
  }
}

/** Kho dung chung cua tien trinh (route that). Test tao kho rieng. */
export const chatSessions = new ChatSessionStore();
