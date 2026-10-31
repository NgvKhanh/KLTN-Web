import { describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import { agent } from './helpers';
import { seedChatV2, V2_NOW } from './chat.v2.fixture';
import { V2SessionStore } from '../src/modules/chat/v2/chat.v2.session';
import { persistentMessage } from '../src/modules/chat/v2/chat.v2.history';

vi.mock('../src/modules/chat/v2/chat.v2.llm', async (original) => ({ ...await original<object>(), v2LlmAvailable: () => false }));
const MY = { kind: 'MY' as const };
const QUESTION = 'Trong bảng 1234 công việc nào đã được phân công và những công việc nào chưa được phân công?';
const history = (id: string, cookie: string) => agent().get(`/api/chat/v2/conversations/${id}`).set('Cookie', cookie);
async function ask(cookie: string, message = QUESTION, conversationId?: string) {
  const response = await agent().post('/api/chat/v2/messages').set('Cookie', cookie).send({ message, scope: MY, ...(conversationId ? { conversationId } : {}) });
  expect(response.status).toBe(200); return response.body.data;
}

describe('persistent chatbot history', () => {
  it('saves separate threads, reads only the signed-in user history and protects detail/resume endpoints', async () => {
    const f = await seedChatV2();
    expect((await agent().get('/api/chat/v2/conversations')).status).toBe(401);
    const first = await ask(f.owner.cookie);
    const second = await ask(f.owner.cookie, 'bảng 1234 gồm những ai');
    expect(second.conversationId).not.toBe(first.conversationId);
    const list = await agent().get('/api/chat/v2/conversations').set('Cookie', f.owner.cookie);
    expect(list.body.data.conversations.map((c: { id: string }) => c.id)).toEqual([second.conversationId, first.conversationId]);
    expect(list.body.data.conversations[0].turnCount).toBe(1);
    const read = await history(first.conversationId, f.owner.cookie);
    expect(read.status).toBe(200); expect(read.body.data.turns[0].question).toBe(QUESTION);
    expect(read.body.data.turns[0].reply.answer.blocks.map((b: { data: { total: number } }) => b.data.total)).toEqual([6, 25]);
    const outsider = await agent().get('/api/chat/v2/conversations').set('Cookie', f.outsider.cookie);
    expect(outsider.body.data.conversations).toEqual([]);
    expect((await history(first.conversationId, f.outsider.cookie)).status).toBe(404);
    expect((await agent().post('/api/chat/v2/messages').set('Cookie', f.outsider.cookie).send({ message: 'tiếp tục', scope: MY, conversationId: first.conversationId })).status).toBe(404);
  });
  it('restores context and pagination after the in-memory store is lost and saves all loaded rows', async () => {
    const f = await seedChatV2();
    const first = await persistentMessage(f.owner.id, { message: QUESTION, scope: MY }, { now: V2_NOW, sessions: new V2SessionStore(), available: false });
    const block = first.answer.blocks![1];
    const more = await agent().post('/api/chat/v2/messages/more').set('Cookie', f.owner.cookie).send({ conversationId: first.conversationId, blockId: block.id, page: 2 });
    expect(more.status).toBe(200);
    const read = await history(first.conversationId, f.owner.cookie);
    expect(read.body.data.turns).toHaveLength(1);
    expect(read.body.data.turns[0].reply.answer.blocks[1].data.cards).toHaveLength(25);
    const next = await persistentMessage(f.owner.id, { message: 'những việc nào chưa được gán?', scope: MY, conversationId: first.conversationId }, { now: V2_NOW, sessions: new V2SessionStore(), available: false });
    expect(next.conversationId).toBe(first.conversationId);
    const b = next.answer.blocks![0];
    expect(b.status === 'OK' && b.source.scope).toEqual({ kind: 'BOARD', boardId: f.board.id });
    expect((await history(first.conversationId, f.owner.cookie)).body.data.turns).toHaveLength(2);
  });
  it('lists the page each conversation was last asked from (board / home), without leaking session state', async () => {
    const f = await seedChatV2();
    const onBoard = await agent().post('/api/chat/v2/messages').set('Cookie', f.owner.cookie).send({ message: 'bảng này gồm những ai', scope: { kind: 'BOARD', boardId: f.board.id } });
    expect(onBoard.status).toBe(200);
    const home = await ask(f.owner.cookie, 'bảng 1234 gồm những ai');
    const list = await agent().get('/api/chat/v2/conversations').set('Cookie', f.owner.cookie);
    const byId = new Map<string, Record<string, unknown>>(list.body.data.conversations.map((c: { id: string }) => [c.id, c as Record<string, unknown>]));
    expect(byId.get(onBoard.body.data.conversationId)?.scope).toEqual({ kind: 'BOARD', boardId: f.board.id });
    expect(byId.get(home.conversationId)?.scope).toEqual({ kind: 'MY' });
    // chi tra loai trang + id, khong tra trang thai phien (bindings, queries...)
    for (const c of list.body.data.conversations) expect(c).not.toHaveProperty('state');
  });
  it('restores a pending clarification after a restart', async () => {
    const f = await seedChatV2();
    const first = await persistentMessage(f.owner.id, { message: 'Trong bảng 1234 công việc nào đã thay đổi?', scope: MY }, { now: V2_NOW, sessions: new V2SessionStore(), available: false });
    expect(first.answer.kind).toBe('CLARIFY');
    const second = await persistentMessage(f.owner.id, { message: 'tuần này', scope: MY, conversationId: first.conversationId }, { now: V2_NOW, sessions: new V2SessionStore(), available: false });
    expect(second.answer.blocks![0].tool).toBe('query_activities');
    expect(second.conversationId).toBe(first.conversationId);
  });
  it('uses the latest persisted context across independent backend stores', async () => {
    const f = await seedChatV2();
    const a = { now: V2_NOW, sessions: new V2SessionStore(), available: false };
    const b = { ...a, sessions: new V2SessionStore() };
    const first = await persistentMessage(f.owner.id, { message: 'bảng 1234 gồm những ai', scope: MY }, a);
    const input = { scope: MY, conversationId: first.conversationId };
    await persistentMessage(f.owner.id, { ...input, message: 'Trong bảng 1234 công việc nào đã thay đổi?' }, b);
    const next = await persistentMessage(f.owner.id, { ...input, message: 'tuần này' }, a);
    expect(next.answer.blocks![0].tool).toBe('query_activities');
  });
  it('retains failed questions without exposing internal errors or another user data', async () => {
    const f = await seedChatV2();
    const response = await agent().post('/api/chat/v2/messages').set('Cookie', f.owner.cookie).send({ message: 'Việc nào?', scope: { kind: 'BOARD', boardId: f.secret.id } });
    expect(response.status).toBe(403);
    const list = await agent().get('/api/chat/v2/conversations').set('Cookie', f.owner.cookie);
    const thread = list.body.data.conversations[0];
    expect(thread.turnCount).toBe(1);
    const read = await history(thread.id, f.owner.cookie);
    expect(read.body.data.turns[0]).toMatchObject({ question: 'Việc nào?', reply: null });
    expect(typeof read.body.data.turns[0].error).toBe('string');
    expect(JSON.stringify(read.body.data)).not.toMatch(/TIÊU ĐỀ BÍ MẬT|password|DATABASE_URL/);
  });
  it('hides stored answers when board access is revoked or a displayed card moves to a private board', async () => {
    const f = await seedChatV2();
    const lan = await ask(f.lan.cookie);
    await prisma.card.update({ where: { id: f.unassigned[0].id }, data: { listId: f.secret.lists[0].id } });
    const moved = await history(lan.conversationId, f.lan.cookie);
    expect(moved.status).toBe(200);
    expect(moved.body.data.turns[0].reply.answer.blocks).toEqual([]);
    expect(JSON.stringify(moved.body.data)).not.toContain(f.unassigned[0].title);
    await prisma.board.update({ where: { id: f.board.id }, data: { visibility: 'PRIVATE' } });
    const revoked = await history(lan.conversationId, f.lan.cookie);
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.turns[0].reply.answer.text).toContain('không còn được phép xem');
    expect(JSON.stringify(revoked.body.data)).not.toContain('Việc của Lan');
  });
  it('paginates long conversations without losing or repeating turns', async () => {
    const f = await seedChatV2();
    const first = await ask(f.owner.cookie, 'bảng 1234 gồm những ai');
    const original = await prisma.chatTurn.findFirstOrThrow({ where: { conversationId: first.conversationId } });
    await prisma.chatTurn.createMany({ data: Array.from({ length: 55 }, (_, i) => ({ conversationId: first.conversationId, question: `Câu ${i}`, reply: original.reply!, access: original.access })) });
    const recent = (await history(first.conversationId, f.owner.cookie)).body.data;
    expect(recent.turns).toHaveLength(50); expect(recent.hasMore).toBe(true);
    const older = await agent().get(`/api/chat/v2/conversations/${first.conversationId}`).query({ before: recent.before }).set('Cookie', f.owner.cookie);
    expect(older.body.data.turns).toHaveLength(6); expect(older.body.data.hasMore).toBe(false);
    const ids = [...older.body.data.turns, ...recent.turns].map((t: { id: number }) => t.id);
    expect(new Set(ids).size).toBe(56);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });
});
