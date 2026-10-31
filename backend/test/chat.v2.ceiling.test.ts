// Trần phạm vi THEO TRANG của chatbot v2 (cả đọc lẫn ghi):
//   trang chủ (MY)  → đọc / ghi mọi bảng mình tham gia;
//   trang không gian → chỉ các bảng của không gian đó;
//   trang bảng       → chỉ đúng bảng đó, KHÔNG ra được bảng khác dù mô hình, hội thoại hay yêu cầu nêu rõ bảng khác.
import { describe, expect, it } from 'vitest';
import { executeChatTool } from '../src/modules/chat/v2/chat.v2.tools';
import { OUT_OF_CEILING, type ToolContext } from '../src/modules/chat/v2/chat.v2.scope';
import { ACT_NOW, seedActions, type ActionWorld } from './chat.actions.fixture';

const ctx = (f: ActionWorld, scope: ToolContext['scope'], extra: Partial<ToolContext> = {}): ToolContext => ({ userId: f.owner.id, now: ACT_NOW, scope, ...extra });
const board = (b: { id: string }) => ({ kind: 'BOARD' as const, boardId: b.id });
const MY = { kind: 'MY' as const };

describe('trang bảng: khóa cứng trong bảng đó', () => {
  it('đọc thẻ không nêu phạm vi → chỉ thẻ của bảng đang mở', async () => {
    const f = await seedActions();
    const alpha = await executeChatTool(ctx(f, board(f.alpha)), 'query_tasks', {});
    expect(alpha.data.total).toBe(5);
    expect(alpha.source.scope).toEqual(board(f.alpha));
    expect(JSON.stringify(alpha.data)).not.toMatch(/Login Beta|Chỉ có ở Beta|Thẻ bí mật|Thẻ công khai/);
  });

  it('yêu cầu nêu phạm vi rộng hơn (trang chủ / không gian) bị KẸP về bảng đang mở, không rò dữ liệu bảng khác', async () => {
    const f = await seedActions();
    const wide = await executeChatTool(ctx(f, board(f.alpha)), 'query_tasks', { scope: MY });
    expect(wide.data.total).toBe(5);
    expect(wide.source.scope).toEqual(board(f.alpha));
    const ws = await executeChatTool(ctx(f, board(f.alpha)), 'query_tasks', { scope: { kind: 'WORKSPACE', workspaceId: f.ws.id } });
    expect(ws.data.total).toBe(5);
    const byBoard = await executeChatTool(ctx(f, board(f.alpha)), 'aggregate_tasks', { groupBy: 'BOARD', scope: MY });
    expect(byBoard.data.rows.map((r) => r.id)).toEqual([f.alpha.id]);
  });

  it('nêu rõ BẢNG KHÁC → bị từ chối 403 với lý do trần phạm vi (đọc thẻ, đếm, nhật ký, danh mục)', async () => {
    const f = await seedActions();
    const c = ctx(f, board(f.alpha));
    const other = { scope: board(f.beta) };
    const range = { from: '2026-10-01', to: '2026-10-07' };
    for (const call of [
      () => executeChatTool(c, 'query_tasks', other),
      () => executeChatTool(c, 'aggregate_tasks', { ...other, groupBy: 'STATUS' }),
      () => executeChatTool(c, 'query_activities', { ...other, range }),
      () => executeChatTool(c, 'query_catalog', { ...other, kind: 'MEMBERS' }),
      () => executeChatTool(c, 'resolve_entities', { ...other, kind: 'CARD', text: 'Login Beta' }),
    ]) await expect(call()).rejects.toMatchObject({ statusCode: 403, message: OUT_OF_CEILING });
  });

  it('phạm vi lưu trong hội thoại lệch với trang hiện tại cũng không đọc được bảng kia (đóng an toàn, không "kẹp" im lặng)', async () => {
    const f = await seedActions();
    const stale = ctx(f, board(f.alpha), { conversationScope: board(f.beta) });
    await expect(executeChatTool(stale, 'query_tasks', {})).rejects.toMatchObject({ statusCode: 403, message: OUT_OF_CEILING });
    // cùng bảng thì dùng bình thường
    const same = await executeChatTool(ctx(f, board(f.alpha), { conversationScope: board(f.alpha) }), 'query_tasks', {});
    expect(same.data.total).toBe(5);
  });

  it('tìm theo tên: chỉ thấy bảng đang mở; thẻ / cột / nhãn / thành viên chỉ của bảng này', async () => {
    const f = await seedActions();
    const c = ctx(f, board(f.alpha));
    expect((await executeChatTool(c, 'resolve_entities', { kind: 'BOARD', text: 'Dự án Beta' })).data.status).toBe('NOT_FOUND');
    expect((await executeChatTool(c, 'resolve_entities', { kind: 'BOARD', text: 'Dự án Alpha' })).data).toMatchObject({ status: 'RESOLVED' });
    const login = await executeChatTool(c, 'resolve_entities', { kind: 'CARD', text: 'Login' });
    expect(login.data.options.map((o) => o.name).sort()).toEqual(['Login API', 'Login UI']);
    expect((await executeChatTool(c, 'resolve_entities', { kind: 'CARD', text: 'Chỉ có ở Beta' })).data.status).toBe('NOT_FOUND');
    expect((await executeChatTool(c, 'resolve_entities', { kind: 'COLUMN', text: 'Đang làm' })).data.options).toHaveLength(1);
    expect((await executeChatTool(c, 'resolve_entities', { kind: 'LABEL', text: 'Backend' })).data.options.map((o) => o.id)).toEqual([f.backend.id]);
  });

  it('danh mục bảng / không gian trong trang bảng chỉ có bảng này', async () => {
    const f = await seedActions();
    const c = ctx(f, board(f.alpha));
    const boards = await executeChatTool(c, 'query_catalog', { kind: 'BOARDS' });
    if (boards.data.kind !== 'BOARDS') throw new Error('Wrong catalog');
    expect(boards.data.rows.map((r) => r.id)).toEqual([f.alpha.id]);
    const members = await executeChatTool(c, 'query_catalog', { kind: 'MEMBERS' });
    if (members.data.kind !== 'MEMBERS') throw new Error('Wrong catalog');
    expect(members.data.rows.map((r) => r.id).sort()).toEqual([f.owner.id, f.lan.id, f.tuan.id, f.viewer.id].sort());
  });
});

describe('trang không gian và trang chủ', () => {
  it('trang không gian: đọc mọi bảng của không gian, kẹp yêu cầu rộng hơn, chặn không gian khác', async () => {
    const f = await seedActions();
    const c = ctx(f, { kind: 'WORKSPACE', workspaceId: f.ws.id });
    expect((await executeChatTool(c, 'query_tasks', {})).data.total).toBe(7); // Alpha 5 + Beta 2
    expect((await executeChatTool(c, 'query_tasks', { scope: MY })).data.total).toBe(7);
    expect((await executeChatTool(c, 'query_tasks', { scope: board(f.beta) })).data.total).toBe(2);
    expect((await executeChatTool(c, 'query_tasks', { scope: board(f.alpha) })).data.total).toBe(5);
    await expect(executeChatTool(c, 'query_tasks', { scope: { kind: 'WORKSPACE', workspaceId: f.outsider.personalWorkspaceId } })).rejects.toMatchObject({ statusCode: 403 });
    // bảng không đọc được (của người khác) cũng không vào được qua trần không gian
    await expect(executeChatTool(c, 'query_tasks', { scope: board(f.secret) })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('trang chủ: không giới hạn thêm - đọc mọi bảng mình tham gia, nhưng không bao giờ bảng riêng tư của người khác hay bảng công khai', async () => {
    const f = await seedActions();
    const c = ctx(f, MY);
    expect((await executeChatTool(c, 'query_tasks', {})).data.total).toBe(7);
    expect((await executeChatTool(c, 'query_tasks', { scope: board(f.beta) })).data.total).toBe(2);
    const all = JSON.stringify((await executeChatTool(c, 'query_tasks', {})).data);
    expect(all).not.toMatch(/Thẻ bí mật|Thẻ công khai/);
    await expect(executeChatTool(c, 'query_tasks', { scope: board(f.secret) })).rejects.toMatchObject({ statusCode: 403 });
    await expect(executeChatTool(c, 'query_tasks', { scope: board(f.publicBoard) })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('quyền vẫn được kiểm lại mỗi lần: thành viên không đọc được bảng PRIVATE dù đang ở trang không gian', async () => {
    const f = await seedActions();
    const c: ToolContext = { userId: f.tuan.id, now: ACT_NOW, scope: { kind: 'WORKSPACE', workspaceId: f.ws.id } };
    expect((await executeChatTool(c, 'query_tasks', {})).data.total).toBe(5); // chỉ Alpha (Beta là PRIVATE, tuan không thuộc)
    await expect(executeChatTool(c, 'query_tasks', { scope: board(f.beta) })).rejects.toMatchObject({ statusCode: 403 });
  });
});
