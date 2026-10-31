import { describe, expect, it, vi, beforeEach } from 'vitest';
import { prisma } from '../src/config/prisma';
import { agent } from './helpers';
import { seedChatV2, V2_NOW } from './chat.v2.fixture';
import { handleV2Message, handleV2Choice, handleV2More } from '../src/modules/chat/v2/chat.v2.service';
import { V2SessionStore } from '../src/modules/chat/v2/chat.v2.session';
import type { ModelStep, ModelResult, ModelMessage } from '../src/modules/chat/v2/chat.v2.llm';

const mocks = vi.hoisted(() => ({ call: vi.fn(), available: vi.fn(() => false) }));
vi.mock('../src/modules/chat/v2/chat.v2.llm', async (original) => ({ ...await original<object>(), callChatModel: mocks.call, v2LlmAvailable: mocks.available }));
beforeEach(() => { mocks.available.mockReturnValue(false); mocks.call.mockReset(); });
const MY = { kind: 'MY' as const };
const SENTENCE = 'trong bảng 1234 công việc nào đã được phân công và những công việc nào chưa được phân công';
const ASSIGNED_SENTENCE = 'trong bảng 1234 những công việc nào đã được gán thành viên và những công việc nào chưa được gán.';
function script(steps: Array<Array<{ name: string; arguments: unknown }> | ((messages: ModelMessage[]) => Array<{ name: string; arguments: unknown }>)>): ModelStep {
  let round = 0;
  return vi.fn(async (messages): Promise<ModelResult> => {
    const action = steps[round++];
    if (!action) return { ok: false, reason: 'INVALID' };
    const calls = (typeof action === 'function' ? action(messages) : action).map((c, i) => ({ ...c, id: `call-${round}-${i}` }));
    return { ok: true, calls, adapter: 'NATIVE', usage: { input: 10, output: 10 }, message: { role: 'assistant', content: null, tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) } };
  });
}
const finish = (messages: ModelMessage[]) => [{ name: 'finish', arguments: { sourceIds: messages.filter((m) => m.role === 'tool').flatMap((m) => {
  const r = JSON.parse(m.content!); return r.source && r.tool !== 'resolve_entities' ? [r.source.id] : [];
}) } }];
function context(step?: ModelStep) { return { now: V2_NOW, sessions: new V2SessionStore(), available: !!step, ...(step ? { step } : {}) }; }

describe('v2 API and orchestration', () => {
  it.each(['bảng 1234 gồm những ai', 'bảng 1234 bao gồm những ai?', 'bảng 1234 có những thành viên nào?'])('resolves the board name and reads its members without AI: %s', async (message) => {
    const f = await seedChatV2();
    const response = await agent().post('/api/chat/v2/messages').set('Cookie', f.owner.cookie).send({ message, scope: MY });
    expect(response.status).toBe(200);
    const reply = response.body.data;
    expect(reply.answer.kind).toBe('ANSWER');
    expect(reply.answer.blocks).toHaveLength(1);
    const b = reply.answer.blocks[0];
    expect(b).toMatchObject({ status: 'OK', tool: 'query_catalog', title: 'Danh sách thành viên', source: { scope: { kind: 'BOARD', boardId: f.board.id } }, data: { kind: 'MEMBERS', total: 4 } });
    expect(b.data.rows.map((r: { id: string }) => r.id).sort()).toEqual([f.owner.id, f.lan.id, f.tuan.id, f.zero.id].sort());
    expect(JSON.stringify(b.data.rows)).not.toContain(f.outsider.id);
    expect(JSON.stringify(b.data.rows)).not.toContain(f.gone.id);
  });
  it('binds the correct named board before the AI queries members, keeping long quoted names intact', async () => {
    const f = await seedChatV2();
    await prisma.board.update({ where: { id: f.board.id }, data: { name: 'Kế hoạch gồm các thành viên mới' } });
    const step = script([[{ name: 'query_catalog', arguments: { kind: 'MEMBERS' } }], finish]);
    const reply = await handleV2Message(f.owner.id, { message: 'Bảng “Kế hoạch gồm các thành viên mới” gồm những ai?', scope: MY }, context(step));
    expect(reply.mode).toBe('AI');
    const b = reply.answer.blocks![0];
    if (b.status !== 'OK' || b.tool !== 'query_catalog') throw new Error('Wrong tool');
    expect(b.source.scope).toEqual({ kind: 'BOARD', boardId: f.board.id });
    expect(b.data).toMatchObject({ kind: 'MEMBERS', total: 4 });
    expect(step).toHaveBeenCalledTimes(2);
  });
  it('answers the screenshot member question with fresh data when Gemini fails', async () => {
    const f = await seedChatV2();
    const step = vi.fn<ModelStep>().mockResolvedValue({ ok: false, reason: 'HTTP' });
    const reply = await handleV2Message(f.owner.id, { message: 'bảng 1234 gồm những ai', scope: MY }, context(step));
    expect(reply.mode).toBe('BASIC');
    expect(reply.answer.kind).toBe('ANSWER');
    const b = reply.answer.blocks![0];
    if (b.status !== 'OK' || b.tool !== 'query_catalog') throw new Error('Wrong tool');
    expect(b.data).toMatchObject({ kind: 'MEMBERS', total: 4 });
    expect(b.source.scope).toEqual({ kind: 'BOARD', boardId: f.board.id });
  });
  it('authenticates, advertises engine, rejects client plans/identity and unknown fields', async () => {
    expect((await agent().get('/api/chat/v2/status')).status).toBe(401);
    expect((await agent().post('/api/chat/v2/messages').send({ message: 'hi', scope: MY })).status).toBe(401);
    const f = await seedChatV2();
    const status = await agent().get('/api/chat/v2/status').set('Cookie', f.owner.cookie);
    expect(status.body.data).toEqual({ engine: 'v2', version: 'v2', llmAvailable: false, actions: false });
    for (const extra of [{ userId: f.owner.id }, { tools: [] }, { role: 'OWNER' }]) expect((await agent().post('/api/chat/v2/messages').set('Cookie', f.owner.cookie).send({ message: SENTENCE, scope: MY, ...extra })).status).toBe(400);
  });
  it.each([SENTENCE, ASSIGNED_SENTENCE])('answers assignment questions through HTTP without AI and paginates only selected block: %s', async (message) => {
    const f = await seedChatV2();
    const response = await agent().post('/api/chat/v2/messages').set('Cookie', f.owner.cookie).send({ message, scope: MY });
    expect(response.status).toBe(200);
    const reply = response.body.data;
    expect(reply.version).toBe('v2'); expect(reply.mode).toBe('BASIC');
    expect(reply.answer.blocks.map((b: { data: { total: number } }) => b.data.total)).toEqual([6, 25]);
    expect(reply.answer.blocks.every((b: { source: { scope: { boardId: string } } }) => b.source.scope.boardId === f.board.id)).toBe(true);
    const block = reply.answer.blocks[1];
    const more = await agent().post('/api/chat/v2/messages/more').set('Cookie', f.owner.cookie).send({ conversationId: reply.conversationId, blockId: block.id, page: 2 });
    expect(more.status).toBe(200); expect(more.body.data.answer.blocks).toHaveLength(1);
    expect(more.body.data.answer.blocks[0].data.cards).toHaveLength(5);
    expect(more.body.data.answer.blocks[0].pagination.hasMore).toBe(false);
    expect((await agent().post('/api/chat/v2/messages/more').set('Cookie', f.outsider.cookie).send({ conversationId: reply.conversationId, blockId: block.id, page: 2 })).status).toBe(404);
  });
  it.each([SENTENCE, ASSIGNED_SENTENCE])('keeps completed assigned work unless open work is explicit: %s', async (message) => {
    const f = await seedChatV2();
    const model = () => script([[
      { name: 'query_tasks', arguments: { filters: { completion: 'OPEN', assignment: 'ASSIGNED' } } },
      { name: 'query_tasks', arguments: { filters: { completion: 'OPEN', assignment: 'UNASSIGNED' } } },
    ], finish]);
    const all = await handleV2Message(f.owner.id, { message, scope: MY }, context(model()));
    const first = all.answer.blocks![0];
    if (first.status !== 'OK' || first.tool !== 'query_tasks') throw new Error('Wrong tool');
    expect(first.data.total).toBe(6); expect(first.source.appliedInput.filters).toMatchObject({ completion: 'ALL' });
    const open = await handleV2Message(f.owner.id, { message: `${message}, chỉ tính việc chưa xong`, scope: MY }, context(model()));
    const second = open.answer.blocks![0];
    if (second.status !== 'OK' || second.tool !== 'query_tasks') throw new Error('Wrong tool');
    expect(second.data.total).toBe(5); expect(second.source.appliedInput.filters).toMatchObject({ completion: 'OPEN' });
  });
  it('still answers assigned/unassigned when Gemini fails instead of falling back to the old unsupported answer', async () => {
    const f = await seedChatV2();
    const step = vi.fn<ModelStep>().mockResolvedValue({ ok: false, reason: 'HTTP' });
    const reply = await handleV2Message(f.owner.id, { message: ASSIGNED_SENTENCE, scope: MY }, context(step));
    expect(step).toHaveBeenCalledOnce();
    expect(reply.mode).toBe('BASIC');
    expect(reply.answer.kind).toBe('ANSWER');
    expect(reply.answer.blocks!.map((b) => b.status === 'OK' && b.tool === 'query_tasks' ? b.data.total : null)).toEqual([6, 25]);
    expect(reply.answer.blocks!.every((b) => b.status === 'OK' && b.source.scope.kind === 'BOARD' && b.source.scope.boardId === f.board.id)).toBe(true);
  });
  it('resolves name 1234 and combines workload+unassigned with all ties and source evidence', async () => {
    const f = await seedChatV2();
    const step = script([[{ name: 'resolve_entities', arguments: { kind: 'BOARD', text: '1234' } }], [
      { name: 'aggregate_tasks', arguments: { groupBy: 'ASSIGNEE' } }, { name: 'query_tasks', arguments: { filters: { assignment: 'UNASSIGNED' } } },
    ], finish]);
    const ctx = context(step);
    const reply = await handleV2Message(f.owner.id, { message: 'Trong bảng 1234 ai nhiều việc nhất và việc nào chưa giao?', scope: MY }, ctx);
    expect(reply.mode).toBe('AI');
    const b = reply.answer.blocks!;
    expect(b).toHaveLength(2);
    if (b[0].status !== 'OK' || b[0].tool !== 'aggregate_tasks' || b[1].status !== 'OK' || b[1].tool !== 'query_tasks') throw new Error('Wrong tools');
    expect(b[0].data.leaderIds.sort()).toEqual([f.lan.id, f.tuan.id].sort());
    expect(b[0].data.highestCount).toBe(2); expect(b[0].data.totalCards).toBe(30);
    expect(b[1].data.total).toBe(25); expect(b[1].data.cards).toHaveLength(20);
    expect(JSON.stringify(reply)).not.toMatch(/TIÊU ĐỀ BÍ MẬT|KHÔNG-ĐƯỢC-LỘ|SNAPSHOT/);
    const transcript = (step as ReturnType<typeof vi.fn>).mock.calls[2][0] as ModelMessage[];
    expect(transcript.filter((m) => m.role === 'tool')).toHaveLength(3);
  });
  it('asks about missing history time, accepts follow-up and counts cards rather than events', async () => {
    const f = await seedChatV2(); const ctx = context();
    const first = await handleV2Message(f.owner.id, { message: 'Trong bảng 1234 công việc nào đã được thay đổi?', scope: MY }, ctx);
    expect(first.answer.kind).toBe('CLARIFY');
    const next = await handleV2Message(f.owner.id, { message: 'tuần này', scope: MY, conversationId: first.conversationId }, ctx);
    const b = next.answer.blocks![0];
    expect(b.status).toBe('OK');
    if (b.status !== 'OK' || b.tool !== 'query_activities') throw new Error('Wrong tool');
    expect(b.data.changedCardCount).toBe(5); expect(b.data.eventCount).toBe(11);
    expect(JSON.stringify(next)).not.toMatch(/KHÔNG-ĐƯỢC-LỘ|SNAPSHOT BÍ MẬT|TÊN MỚI RIÊNG TƯ/);
  });
  it('revalidates ambiguity options and respects the selected board', async () => {
    const f = await seedChatV2();
    const second = await prisma.board.create({ data: { name: '1234', workspaceId: f.ws.id, ownerId: f.owner.id, visibility: 'PRIVATE' } });
    const ctx = context();
    const first = await handleV2Message(f.owner.id, { message: SENTENCE, scope: MY }, ctx);
    expect(first.answer.clarify!.options.map((o) => o.id).sort()).toEqual([f.board.id, second.id].sort());
    await expect(handleV2Choice(f.owner.id, { conversationId: first.conversationId, optionId: f.secret.id }, ctx)).rejects.toMatchObject({ statusCode: 400 });
    const next = await handleV2Choice(f.owner.id, { conversationId: first.conversationId, optionId: f.board.id }, ctx);
    expect(next.answer.kind).toBe('ANSWER');
    expect(next.answer.blocks!.filter((b) => b.status === 'OK')).toHaveLength(2);
  });
  it('reads new data for follow-ups, clears scope after UI changes and invalidates old blocks', async () => {
    const f = await seedChatV2(); const ctx = context();
    const first = await handleV2Message(f.owner.id, { message: SENTENCE, scope: MY }, ctx);
    const step = script([[{ name: 'query_tasks', arguments: { filters: { assignment: 'UNASSIGNED' } } }], finish]);
    await prisma.card.create({ data: { listId: f.columnId, title: 'Mới sau câu hỏi' } });
    const next = await handleV2Message(f.owner.id, { message: 'còn những việc chưa giao?', scope: MY, conversationId: first.conversationId }, { ...ctx, available: true, step });
    const b = next.answer.blocks![0];
    if (b.status !== 'OK' || b.tool !== 'query_tasks') throw new Error('Wrong tool');
    expect(b.data.total).toBe(26); expect(b.source.scope).toEqual({ kind: 'BOARD', boardId: f.board.id });
    await expect(handleV2More(f.owner.id, { conversationId: first.conversationId, blockId: first.answer.blocks![1].id, page: 2 }, ctx)).rejects.toMatchObject({ statusCode: 400 });
    const reset = await handleV2Message(f.owner.id, { message: 'việc chưa giao?', scope: { kind: 'BOARD', boardId: f.numericId.id }, conversationId: first.conversationId }, ctx);
    const last = reset.answer.blocks![0];
    if (last.status !== 'OK' || last.tool !== 'query_tasks') throw new Error('Wrong tool');
    expect(last.data.total).toBe(0);
  });
  it('revoked board access blocks next page and the next message before LLM', async () => {
    const f = await seedChatV2(); const ctx = context();
    const first = await handleV2Message(f.lan.id, { message: SENTENCE, scope: MY }, ctx);
    await prisma.board.update({ where: { id: f.board.id }, data: { visibility: 'PRIVATE' } });
    await expect(handleV2More(f.lan.id, { conversationId: first.conversationId, blockId: first.answer.blocks![1].id, page: 2 }, ctx)).rejects.toMatchObject({ statusCode: 403 });
    await expect(handleV2Message(f.lan.id, { message: 'còn việc gì?', scope: MY, conversationId: first.conversationId }, ctx)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('shows a failed subquery and retains successful counts instead of pretending a complete answer', async () => {
    const f = await seedChatV2(); const step = script([[
      { name: 'aggregate_tasks', arguments: { groupBy: 'ASSIGNEE', scope: { kind: 'BOARD', boardId: f.board.id } } },
      { name: 'query_tasks', arguments: { filters: { assigneeIds: [f.outsider.id] } } },
    ], finish]);
    const reply = await handleV2Message(f.owner.id, { message: 'workload and tasks', scope: { kind: 'BOARD', boardId: f.board.id } }, context(step));
    expect(reply.answer.blocks!.map((b) => b.status)).toEqual(['OK', 'ERROR']);
    expect(reply.answer.notes.join(' ')).toContain('chưa thành công');
    expect(JSON.stringify(reply)).not.toContain('Riêng tư bí mật');
  });
  it('validates planner arguments, prohibits unknown tools and rejects forged source IDs', async () => {
    const f = await seedChatV2();
    for (const steps of [
      [[{ name: 'execute_sql', arguments: { sql: 'select *' } }]],
      [[{ name: 'finish', arguments: { sourceIds: ['11111111-1111-4111-8111-111111111111'] } }]],
    ]) {
      const r = await handleV2Message(f.owner.id, { message: 'test', scope: MY }, context(script(steps)));
      expect(r.answer.blocks!.some((b) => b.status === 'ERROR')).toBe(true);
    }
    const step = script([[{ name: 'query_tasks', arguments: { role: 'OWNER' } }], [{ name: 'query_tasks', arguments: { scope: { kind: 'BOARD', boardId: f.board.id } } }], finish]);
    const reply = await handleV2Message(f.owner.id, { message: 'test', scope: { kind: 'BOARD', boardId: f.board.id } }, context(step));
    expect(reply.answer.blocks!.filter((b) => b.status === 'OK')).toHaveLength(1);
  });
  it('never accepts a guessed numeric board ID and enforces missing history time before model calls', async () => {
    const f = await seedChatV2();
    const step = script([[{ name: 'query_tasks', arguments: { scope: { kind: 'BOARD', boardId: '1234' } } }],
      [{ name: 'query_tasks', arguments: { filters: { assignment: 'UNASSIGNED' } } }], finish]);
    const ctx = context(step);
    const reply = await handleV2Message(f.owner.id, { message: 'Trong bảng 1234 việc nào chưa giao?', scope: MY }, ctx);
    const block = reply.answer.blocks![0];
    if (block.status !== 'OK' || block.tool !== 'query_tasks') throw new Error('Wrong tool');
    expect(block.source.scope).toEqual({ kind: 'BOARD', boardId: f.board.id }); expect(block.data.total).toBe(25);
    const shouldNotRun = vi.fn<ModelStep>();
    const vague = await handleV2Message(f.owner.id, { message: 'Trong bảng 1234 công việc nào đã thay đổi?', scope: MY }, context(shouldNotRun));
    expect(vague.answer.kind).toBe('CLARIFY'); expect(shouldNotRun).not.toHaveBeenCalled();
    // CHAT_ACTIONS tắt: lệnh ghi vẫn bị từ chối trước mọi lượt gọi mô hình (khi bật thì lệnh đi qua propose_actions - xem chat.actions.api.test.ts)
    const write = await handleV2Message(f.owner.id, { message: 'Đổi hạn giúp tôi trong bảng 1234', scope: MY }, { ...context(shouldNotRun), actions: false });
    expect(write.answer.kind).toBe('UNSUPPORTED'); expect(write.answer.text).toContain('chỉ đọc');
    expect(shouldNotRun).not.toHaveBeenCalled();
  });
  it('bounds loops, expires sessions, and keeps simple v1 fallback with safe pagination', async () => {
    const f = await seedChatV2();
    const repeat = script(Array.from({ length: 4 }, () => [{ name: 'query_tasks', arguments: {} }]));
    const repeated = await handleV2Message(f.owner.id, { message: 'test', scope: MY }, context(repeat));
    expect(repeated.answer.blocks!.some((b) => b.status === 'ERROR')).toBe(true);
    const ctx = context();
    const first = await handleV2Message(f.owner.id, { message: 'Việc của tôi?', scope: MY }, ctx);
    expect(first.mode).toBe('BASIC');
    const expired = { ...ctx, now: new Date(V2_NOW.getTime() + 31 * 60_000) };
    await expect(handleV2More(f.owner.id, { conversationId: first.conversationId, page: 2 }, expired)).rejects.toMatchObject({ statusCode: 404 });
    expect((await handleV2Message(f.owner.id, { message: 'Việc của tôi?', scope: MY, conversationId: first.conversationId }, expired)).conversationReset).toBe(true);
  });
});
