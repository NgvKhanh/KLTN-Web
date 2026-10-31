import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { executeChatTool } from '../src/modules/chat/v2/chat.v2.tools';
import type { ToolContext } from '../src/modules/chat/v2/chat.v2.scope';
import { withUiScope } from '../src/modules/chat/v2/chat.v2.scope';
import { normalizeRange } from '../src/modules/chat/v2/chat.v2.dates';
import { seedChatV2, V2_NOW, V2_RANGE } from './chat.v2.fixture';
import { updateCard } from '../src/modules/card/card.service';
import { addCardMember, removeCardMember } from '../src/modules/card/cardExtras.service';

type World = Awaited<ReturnType<typeof seedChatV2>>;
const context = (w: World): ToolContext => ({ userId: w.owner.id, now: V2_NOW, scope: { kind: 'BOARD', boardId: w.board.id } });

describe('chatbot v2 steps 1–3: tools on the real test database', () => {
  it('answers both parts of board 1234 with ties, zero members, multi-assignees and all unassigned pages', async () => {
    const w = await seedChatV2();
    const ctx = context(w);
    // trang chủ (MY) thì tìm bảng theo tên trên mọi bảng đọc được; trang bảng thì bị khóa trong bảng đó (xem chat.v2.ceiling.test.ts)
    const entity = await executeChatTool({ ...ctx, scope: { kind: 'MY' } }, 'resolve_entities', { kind: 'BOARD', text: '1234' });
    expect(entity.data.options[0].id).toBe(w.board.id); // Name wins over another board's numeric ID.
    const workload = await executeChatTool(ctx, 'aggregate_tasks', { groupBy: 'ASSIGNEE', pageSize: 1 });
    expect(workload.data.totalCards).toBe(30);
    expect(workload.data.highestCount).toBe(2);
    expect(workload.data.leaderIds.sort()).toEqual([w.lan.id, w.tuan.id].sort());
    expect(workload.data.outsideAssignments).toBe(1);
    expect(workload.data.deletedAccountAssignments).toBe(1);
    expect(workload.data.unassignedCards).toBe(25);
    expect(workload.data.hasMore).toBe(true);
    const allRows = await executeChatTool(ctx, 'aggregate_tasks', { groupBy: 'ASSIGNEE' });
    expect(allRows.data.rows.find((r) => r.id === w.zero.id)?.count).toBe(0);
    const first = await executeChatTool(ctx, 'query_tasks', { filters: { assignment: 'UNASSIGNED' } });
    const next = await executeChatTool(ctx, 'query_tasks', { filters: { assignment: 'UNASSIGNED' }, page: 2 });
    expect(first.data.total).toBe(25);
    expect(first.data.cards).toHaveLength(20);
    expect(next.data.cards).toHaveLength(5);
    expect(new Set([...first.data.cards, ...next.data.cards].map((c) => c.id)).size).toBe(25);
    expect(first.source.scope).toEqual(ctx.scope);
    const all = await executeChatTool(ctx, 'aggregate_tasks', { groupBy: 'ASSIGNEE', filters: { completion: 'ALL' } });
    expect(all.data.totalCards).toBe(31);
    expect(all.data.leaderIds).toEqual([w.tuan.id]);
  });

  it('resolves duplicate and unaccented entities, checks chosen IDs and respects explicit > conversation > UI scope', async () => {
    const w = await seedChatV2(); const ctx = context(w);
    const duplicate = await prisma.board.create({ data: { name: '1234', ownerId: w.owner.id, workspaceId: w.ws.id } });
    const my = { ...ctx, scope: { kind: 'MY' as const } };
    expect((await executeChatTool(my, 'resolve_entities', { kind: 'BOARD', text: '1234' })).data.status).toBe('CLARIFY');
    expect((await executeChatTool(ctx, 'resolve_entities', { kind: 'MEMBER', text: 'anh Tuan' })).data.options[0].id).toBe(w.tuan.id);
    expect((await executeChatTool(ctx, 'resolve_entities', { kind: 'COLUMN', text: 'Can lam' })).data.options[0].id).toBe(w.columnId);
    expect((await executeChatTool(ctx, 'resolve_entities', { kind: 'CARD', text: 'Việc chung' })).data.options[0].id).toBe(w.shared.id);
    expect((await executeChatTool(ctx, 'resolve_entities', { kind: 'BOARD', text: 'Riêng tư bí mật' })).data.status).toBe('NOT_FOUND');
    // thứ tự ưu tiên "nêu rõ > hội thoại > giao diện" áp dụng khi giao diện ở trang chủ (MY); từ trang bảng, trần phạm vi chặn việc ra ngoài bảng
    expect((await executeChatTool({ ...my, conversationScope: { kind: 'BOARD', boardId: duplicate.id } }, 'query_tasks', {})).data.total).toBe(0);
    expect((await executeChatTool({ ...my, conversationScope: { kind: 'BOARD', boardId: duplicate.id } }, 'query_tasks', { scope: ctx.scope })).data.total).toBe(30);
    expect((await executeChatTool(my, 'query_tasks', { scope: { kind: 'BOARD', boardId: duplicate.id } })).data.total).toBe(0);
    const changed = withUiScope({ ...ctx, conversationScope: { kind: 'BOARD', boardId: duplicate.id } }, { kind: 'WORKSPACE', workspaceId: w.ws.id });
    expect(changed.conversationScope).toBeUndefined();
  });

  it('returns recorded changes with distinct cards, correct VN boundaries and safe historical fields', async () => {
    const w = await seedChatV2(); const ctx = context(w);
    const history = await executeChatTool(ctx, 'query_activities', { range: V2_RANGE, mode: 'CHANGED_CARDS', pageSize: 2 });
    expect(history.data.eventCount).toBe(11);
    expect(history.data.changedCardCount).toBe(5);
    expect(history.data.total).toBe(5);
    expect(history.source.ranges).toEqual([{ from: '2026-09-30T17:00:00.000Z', to: '2026-10-04T17:00:00.000Z' }]);
    const all = await executeChatTool(ctx, 'query_activities', { range: V2_RANGE, mode: 'CHANGED_CARDS', pageSize: 100 });
    expect(all.data.cards.find((c) => c.id === w.a.id)).toMatchObject({ eventCount: 7, eventsTruncated: true });
    expect(all.data.cards.find((c) => c.id === w.moved.id)).toMatchObject({ title: null });
    expect(all.data.cards.find((c) => c.id === w.deleted.id)).toMatchObject({ title: null });
    expect(JSON.stringify(all)).not.toContain('KHÔNG-ĐƯỢC-LỘ');
    expect(JSON.stringify(all)).not.toContain('SNAPSHOT BÍ MẬT');
    expect(JSON.stringify(all)).not.toContain('TÊN MỚI RIÊNG TƯ');
    const due = await executeChatTool(ctx, 'query_activities', { range: V2_RANGE, types: ['card.due.set'] });
    expect(due.data.events[0].data).toEqual({ dueDate: '2026-10-02T03:00:00.000Z' }); // Never invent old value.
    const actor = await executeChatTool(ctx, 'query_activities', { range: V2_RANGE, actorIds: [w.lan.id] });
    expect(actor.data.eventCount).toBe(8);
  });

  it('intersects history with current task filters across the full set, not a truncated first page', async () => {
    const w = await seedChatV2(); const ctx = context(w);
    const tasks = await executeChatTool(ctx, 'query_tasks', { filters: { assignment: 'UNASSIGNED', overdue: true, changed: { range: V2_RANGE } } });
    expect(tasks.data.total).toBe(1);
    expect(tasks.data.cards[0].id).toBe(w.unassigned[24].id);
    const aggregate = await executeChatTool(ctx, 'aggregate_tasks', { groupBy: 'BOARD', filters: { assignment: 'UNASSIGNED', changed: { range: V2_RANGE } } });
    expect(aggregate.data.totalCards).toBe(tasks.data.total);
    const history = await executeChatTool(ctx, 'query_activities', { range: V2_RANGE, taskFilters: { assignment: 'UNASSIGNED', overdue: true } });
    expect(history.data.changedCardCount).toBe(1);
    expect(history.data.events[0].cardId).toBe(w.unassigned[24].id);
  });

  it('supports shared filters, labels, dates and grouping by board/column/status/day', async () => {
    const w = await seedChatV2(); const ctx = context(w);
    const label = await prisma.label.create({ data: { boardId: w.board.id, name: 'Gấp', color: '#ff0000', cards: { create: { cardId: w.a.id } } } });
    const filters = { assigneeIds: [w.lan.id], columnIds: [w.columnId], labelIds: [label.id], keyword: 'Việc', statuses: ['TODO'], date: { field: 'CREATED', range: V2_RANGE } };
    const tasks = await executeChatTool(ctx, 'query_tasks', { filters });
    expect(tasks.data.cards.map((c) => c.id)).toEqual([w.a.id]);
    for (const groupBy of ['BOARD', 'COLUMN', 'STATUS', 'DATE']) {
      const result = await executeChatTool(ctx, 'aggregate_tasks', { groupBy, filters, dateField: 'CREATED' });
      expect(result.data.totalCards).toBe(1);
      expect(result.data.rows[0].count).toBe(1);
    }
    const all = await executeChatTool(ctx, 'query_tasks', { filters: { completion: 'DONE', date: { field: 'COMPLETED', range: V2_RANGE } } });
    expect(all.data.cards.map((c) => c.id)).toEqual([w.done.id]);
  });

  it('pages catalogs, excludes public outsiders and does not disclose private workspaces through a guest board', async () => {
    const w = await seedChatV2(); const ctx = context(w);
    const boards = await executeChatTool({ ...ctx, scope: { kind: 'MY' } }, 'query_catalog', { kind: 'BOARDS', pageSize: 1 });
    expect(boards.data.total).toBe(2);
    expect(boards.data.hasMore).toBe(true);
    const members = await executeChatTool(ctx, 'query_catalog', { kind: 'MEMBERS' });
    expect(members.data.total).toBe(4);
    const spaces = await executeChatTool(ctx, 'query_catalog', { kind: 'WORKSPACES' });
    expect(spaces.data.rows[0]).toMatchObject({ id: w.ws.id, myRole: 'OWNER', boards: 1, members: 4 });
    await prisma.boardMember.create({ data: { boardId: w.secret.id, userId: w.owner.id, role: 'VIEWER' } });
    const guest = await executeChatTool({ userId: w.owner.id, now: V2_NOW, scope: { kind: 'BOARD', boardId: w.secret.id } }, 'query_catalog', { kind: 'MEMBERS' });
    expect(guest.data.total).toBe(2);
    const publicSearch = await executeChatTool(ctx, 'resolve_entities', { kind: 'BOARD', text: 'Công khai ngoài nhóm' });
    expect(publicSearch.data.status).toBe('NOT_FOUND');
  });

  it('rejects unauthorized scope/IDs, forged identity/raw where and rechecks access after revocation', async () => {
    const w = await seedChatV2(); const ctx = context(w);
    await expect(executeChatTool(ctx, 'query_tasks', { scope: { kind: 'BOARD', boardId: w.secret.id } })).rejects.toMatchObject({ statusCode: 403 });
    await expect(executeChatTool(ctx, 'query_tasks', { filters: { assigneeIds: [w.outsider.id] } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(executeChatTool(ctx, 'query_tasks', { filters: { cardIds: [w.moved.id] } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(executeChatTool(ctx, 'query_tasks', { userId: w.outsider.id })).rejects.toMatchObject({ statusCode: 400 });
    await expect(executeChatTool(ctx, 'query_tasks', { filters: { where: {} } })).rejects.toMatchObject({ statusCode: 400 });
    await expect(executeChatTool(ctx, 'query_tasks', { filters: { assignment: 'UNASSIGNED', assigneeIds: [w.lan.id] } })).rejects.toMatchObject({ statusCode: 400 });
    const member: ToolContext = { userId: w.lan.id, now: V2_NOW, scope: ctx.scope };
    expect((await executeChatTool(member, 'query_tasks', {})).data.total).toBe(30);
    await prisma.workspaceMember.updateMany({ where: { workspaceId: w.ws.id, userId: w.lan.id }, data: { deletedAt: V2_NOW } });
    await expect(executeChatTool(member, 'query_tasks', {})).rejects.toMatchObject({ statusCode: 403 });
    await prisma.workspace.update({ where: { id: w.ws.id }, data: { deletedAt: V2_NOW } });
    await expect(executeChatTool(ctx, 'query_tasks', {})).rejects.toMatchObject({ statusCode: 403 });
  });

  it('records due-date before/after and member removal without inventing a removal on retry', async () => {
    const w = await seedChatV2();
    await updateCard(w.owner.id, w.a.id, { dueDate: '2026-10-10T03:00:00.000Z' });
    const due = await prisma.activity.findFirstOrThrow({ where: { cardId: w.a.id, type: 'card.due.set', userId: w.owner.id }, orderBy: { createdAt: 'desc' } });
    expect(due.data).toMatchObject({ from: '2026-10-02T03:00:00.000Z', to: '2026-10-10T03:00:00.000Z' });
    await updateCard(w.owner.id, w.a.id, { dueDate: '2026-10-10T03:00:00.000Z' });
    expect(await prisma.activity.count({ where: { cardId: w.a.id, type: 'card.due.set', userId: w.owner.id } })).toBe(1);
    await updateCard(w.owner.id, w.a.id, { dueDate: null });
    expect((await prisma.activity.findFirstOrThrow({ where: { cardId: w.a.id, type: 'card.due.clear' } })).data).toMatchObject({ from: '2026-10-10T03:00:00.000Z', to: null });
    await removeCardMember(w.owner.id, w.a.id, w.lan.id);
    await removeCardMember(w.owner.id, w.a.id, w.lan.id);
    expect(await prisma.activity.count({ where: { cardId: w.a.id, type: 'member.remove' } })).toBe(1);
    const events = await executeChatTool(context(w), 'query_activities', { range: { from: '2020-01-01', to: '2099-12-31' }, types: ['member.remove'] });
    expect(events.data.events[0].data).toEqual({ memberId: w.lan.id, memberName: w.lan.name });
    await Promise.all([addCardMember(w.owner.id, w.a.id, w.lan.id), addCardMember(w.owner.id, w.a.id, w.lan.id)]);
    expect(await prisma.activity.count({ where: { cardId: w.a.id, type: 'member.add', userId: w.owner.id } })).toBe(1);
  });

  it('records the actual preceding due date when concurrent updates compete for the same card', async () => {
    const w = await seedChatV2();
    const targets = ['2026-10-11T03:00:00.000Z', '2026-10-12T03:00:00.000Z'];
    await Promise.all(targets.map((dueDate) => updateCard(w.owner.id, w.a.id, { dueDate })));
    const events = await prisma.activity.findMany({ where: { cardId: w.a.id, type: 'card.due.set', userId: w.owner.id }, select: { data: true } });
    const transitions = events.map((e) => e.data as { from: string; to: string });
    expect(transitions).toHaveLength(2);
    const first = transitions.find((e) => e.from === '2026-10-02T03:00:00.000Z')!;
    expect(first).toBeDefined();
    const second = transitions.find((e) => e.from === first.to)!;
    expect(second).toBeDefined();
    expect((await prisma.card.findUniqueOrThrow({ where: { id: w.a.id } })).dueDate?.toISOString()).toBe(second.to);
  });

  it('rejects nonexistent/reversed dates and preserves exclusive timestamp boundaries', () => {
    expect(() => normalizeRange({ from: '2026-02-30', to: '2026-03-01' })).toThrow('Ngày không hợp lệ');
    expect(() => normalizeRange({ from: '2026-10-05', to: '2026-10-04' })).toThrow('Khoảng thời gian');
    expect(normalizeRange({ from: '2026-10-01T00:00:00+07:00', to: '2026-10-02T00:00:00+07:00' }).to).toEqual(new Date('2026-10-01T17:00:00.000Z'));
  });
});
