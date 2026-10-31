import { randomUUID } from 'node:crypto';
import { AppError } from '../../../utils/AppError';
import type { ChatScopeInput } from '../chat.scope';
import type { EntityOption } from './chat.v2.entities';
import type { ToolName } from './chat.v2.schema';

export interface SavedQuery { blockId: string; tool: Exclude<ToolName, 'resolve_entities'>; input: Record<string, unknown>; page: number; hasMore: boolean }
export interface V2Session {
  id: string; userId: string; uiScope: ChatScopeInput; scope?: ChatScopeInput;
  bindings: EntityOption[]; queries: SavedQuery[]; lastQuestion?: string;
  legacyId?: string;
  legacyOptions?: { id: string; kind: 'USER' | 'WORKSPACE' | 'TARGET' }[];
  // PLAN_REF: dang cho nguoi dung chon doi tuong cho MOT ke hoach hanh dong (planId); chon xong khong goi lai LLM.
  pending?: { kind: 'ENTITY' | 'QUESTION' | 'PLAN_REF'; question: string; original: string; options: EntityOption[]; resolveInput?: Record<string, unknown>; planId?: string };
  touched: number;
}
export class V2SessionStore {
  private sessions = new Map<string, V2Session>();
  get(userId: string, id: string | undefined, now: Date): V2Session | undefined {
    for (const [key, s] of this.sessions) if (now.getTime() - s.touched >= 30 * 60_000) this.sessions.delete(key);
    const session = id ? this.sessions.get(id) : undefined;
    if (!session || session.userId !== userId) return undefined;
    session.touched = now.getTime(); return session;
  }
  require(userId: string, id: string, now: Date): V2Session {
    const s = this.get(userId, id, now);
    if (!s) throw new AppError('Hội thoại đã hết hạn. Hãy hỏi lại.', 404);
    return s;
  }
  create(userId: string, uiScope: ChatScopeInput, now: Date): V2Session {
    this.get(userId, undefined, now);
    const own = [...this.sessions.values()].filter((s) => s.userId === userId).sort((a, b) => a.touched - b.touched);
    while (own.length >= 5) this.sessions.delete(own.shift()!.id);
    if (this.sessions.size >= 2000) this.sessions.delete(this.sessions.keys().next().value!);
    const s: V2Session = { id: randomUUID(), userId, uiScope, bindings: [], queries: [], touched: now.getTime() };
    this.sessions.set(s.id, s); return s;
  }
  restore(saved: V2Session, now: Date): V2Session {
    // The database stores context and query inputs, never cached permissions/tool results.
    const session = { ...saved, touched: now.getTime(), legacyId: undefined, legacyOptions: undefined };
    this.get(session.userId, undefined, now);
    const own = [...this.sessions.values()].filter((s) => s.userId === session.userId && s.id !== session.id).sort((a, b) => a.touched - b.touched);
    while (own.length >= 5) this.sessions.delete(own.shift()!.id);
    if (this.sessions.size >= 2000) this.sessions.delete(this.sessions.keys().next().value!);
    this.sessions.set(session.id, session);
    return session;
  }
}
export const v2Sessions = new V2SessionStore();
