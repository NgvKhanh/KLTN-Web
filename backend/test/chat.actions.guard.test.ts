// Lớp bảo vệ THỨ HAI của hành động: guard (quyền + nghiệp vụ), nhận chỗ nguyên tử của kế hoạch và phạm vi của bộ phân giải.
// Các test API/safety đi qua cả luồng nên các lớp này thường "được che" bởi lớp trước; ở đây gọi THẲNG từng hàm với dữ liệu xấu
// (id của bảng khác, người không thuộc bảng, kế hoạch hết hạn...) để chứng minh mỗi lớp tự đứng vững, không dựa vào lớp khác.
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { guardOp } from '../src/modules/chat/v2/actions/actions.guard';
import { cancelOpenPlans, claimPlan, createPlanRow, expireIfNeeded, findOwnedPlan, type NewPlan } from '../src/modules/chat/v2/actions/actions.plan.repo';
import { refSignature } from '../src/modules/chat/v2/actions/actions.refs';
import { resolveOp, type ResolveEnv } from '../src/modules/chat/v2/actions/actions.resolve';
import type { StoredOp, StoredPlan } from '../src/modules/chat/v2/actions/actions.types';
import { resolveExecutionContext } from '../src/modules/chat/v2/chat.v2.scope';
import { ACT_NOW, minutesAfter, seedActions, text } from './chat.actions.fixture';

const op = (over: Partial<StoredOp> & Pick<StoredOp, 'type'>): StoredOp => ({ ids: {}, params: {}, before: null, display: {}, ...over });

describe('guardOp: quyền + nghiệp vụ, kiểm lại từ đầu (không tin kế hoạch)', () => {
  it('thao tác hợp lệ của người có quyền sửa -> ok', async () => {
    const f = await seedActions();
    for (const o of [
      op({ type: 'RENAME_CARD', ids: { card: f.loginUi.id }, params: { title: 'Mới' } }),
      op({ type: 'SET_CARD_DUE', ids: { card: f.loginUi.id }, params: { due: null } }),
      op({ type: 'SET_CARD_STATUS', ids: { card: f.loginUi.id }, params: { status: 'DONE' } }),
      op({ type: 'MOVE_CARD', ids: { card: f.loginUi.id, list: f.doing.id } }),
      op({ type: 'ASSIGN_MEMBER', ids: { card: f.loginUi.id, member: f.lan.id } }),
      op({ type: 'ADD_LABEL', ids: { card: f.loginUi.id, label: f.backend.id } }),
      op({ type: 'CREATE_CARD', ids: { list: f.todo.id }, params: { title: 'Thẻ mới' } }),
    ]) expect(await guardOp({ userId: f.owner.id, boardId: f.alpha.id, op: o }), o.type).toEqual({ ok: true });
  });

  it('một kế hoạch chỉ tác động MỘT bảng: thẻ / cột / nhãn của bảng khác bị từ chối dù người dùng có quyền ở cả hai bảng', async () => {
    const f = await seedActions();
    const betaLabel = await prisma.label.create({ data: { boardId: f.beta.id, name: 'Nhãn Beta', color: '#61BD4F' } });
    // thẻ của Beta nhưng kế hoạch nói bảng Alpha
    expect(await guardOp({ userId: f.owner.id, boardId: f.alpha.id, op: op({ type: 'RENAME_CARD', ids: { card: f.loginBeta.id }, params: { title: 'x' } }) }))
      .toMatchObject({ ok: false, code: 'OUT_OF_SCOPE' });
    // chuyển thẻ Alpha sang cột của Beta (moveCard cho phép xuyên bảng, chatbot thì không)
    expect(await guardOp({ userId: f.owner.id, boardId: f.alpha.id, op: op({ type: 'MOVE_CARD', ids: { card: f.loginUi.id, list: f.betaDoing.id } }) }))
      .toMatchObject({ ok: false, code: 'OUT_OF_SCOPE' });
    // nhãn của bảng khác
    expect(await guardOp({ userId: f.owner.id, boardId: f.alpha.id, op: op({ type: 'ADD_LABEL', ids: { card: f.loginUi.id, label: betaLabel.id } }) }))
      .toMatchObject({ ok: false, code: 'NOT_FOUND' });
    // tạo thẻ vào cột của bảng khác
    expect(await guardOp({ userId: f.owner.id, boardId: f.alpha.id, op: op({ type: 'CREATE_CARD', ids: { list: f.betaTodo.id }, params: { title: 'x' } }) }))
      .toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('người thực hiện: VIEWER, người ngoài, tài khoản đã xóa đều bị chặn', async () => {
    const f = await seedActions();
    const rename = op({ type: 'RENAME_CARD', ids: { card: f.loginUi.id }, params: { title: 'x' } });
    expect(await guardOp({ userId: f.viewer.id, boardId: f.alpha.id, op: rename })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await guardOp({ userId: f.outsider.id, boardId: f.alpha.id, op: rename })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    await prisma.user.update({ where: { id: f.tuan.id }, data: { deletedAt: ACT_NOW } });
    expect(await guardOp({ userId: f.tuan.id, boardId: f.alpha.id, op: rename })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });

  it('người được giao: VIEWER -> VIEWER_ASSIGN; không thuộc bảng -> FORBIDDEN; tài khoản đã xóa -> NOT_FOUND', async () => {
    const f = await seedActions();
    const assign = (member: string) => op({ type: 'ASSIGN_MEMBER', ids: { card: f.loginUi.id, member } });
    expect(await guardOp({ userId: f.owner.id, boardId: f.alpha.id, op: assign(f.viewer.id) })).toMatchObject({ ok: false, code: 'VIEWER_ASSIGN' });
    expect(await guardOp({ userId: f.owner.id, boardId: f.alpha.id, op: assign(f.outsider.id) })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    await prisma.user.update({ where: { id: f.lan.id }, data: { deletedAt: ACT_NOW } });
    expect(await guardOp({ userId: f.owner.id, boardId: f.alpha.id, op: assign(f.lan.id) })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('bảng / thẻ / cột đã lưu trữ hoặc xóa -> NOT_FOUND; dữ liệu thiếu hoặc quá dài -> INVALID', async () => {
    const f = await seedActions();
    const rename = (title: string) => op({ type: 'RENAME_CARD', ids: { card: f.loginUi.id }, params: { title } });
    expect(await guardOp({ userId: f.owner.id, boardId: f.alpha.id, op: rename('   ') })).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await guardOp({ userId: f.owner.id, boardId: f.alpha.id, op: rename('x'.repeat(501)) })).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await guardOp({ userId: f.owner.id, boardId: f.alpha.id, op: op({ type: 'RENAME_CARD', params: { title: 'x' } }) })).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await guardOp({ userId: f.owner.id, boardId: f.alpha.id, op: op({ type: 'CREATE_CARD', ids: { list: f.todo.id }, params: { title: '' } }) })).toMatchObject({ ok: false, code: 'INVALID' });
    await prisma.list.update({ where: { id: f.todo.id }, data: { archivedAt: ACT_NOW } });
    expect(await guardOp({ userId: f.owner.id, boardId: f.alpha.id, op: op({ type: 'CREATE_CARD', ids: { list: f.todo.id }, params: { title: 'x' } }) })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await prisma.card.update({ where: { id: f.loginApi.id }, data: { archivedAt: ACT_NOW } });
    expect(await guardOp({ userId: f.owner.id, boardId: f.alpha.id, op: op({ type: 'RENAME_CARD', ids: { card: f.loginApi.id }, params: { title: 'x' } }) })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    await prisma.board.update({ where: { id: f.alpha.id }, data: { archivedAt: ACT_NOW } });
    expect(await guardOp({ userId: f.owner.id, boardId: f.alpha.id, op: rename('x') })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('kho kế hoạch: nhận chỗ nguyên tử, hết hạn, hủy', () => {
  const planInput = (f: Awaited<ReturnType<typeof seedActions>>, over: Partial<NewPlan> = {}): NewPlan => {
    const stored: StoredPlan = { version: 1, boardId: f.alpha.id, boardName: 'Dự án Alpha', message: 'm', symbolic: [], ops: [], presets: {}, warnings: [] };
    return {
      userId: f.owner.id, conversationId: '11111111-1111-4111-8111-111111111111', boardId: f.alpha.id, scopeKind: 'BOARD', prompt: 'm', plan: stored,
      checksum: 'a'.repeat(64), risk: 'LOW', requiresConfirmation: true, reasons: [], provenance: 'USER_DIRECT', status: 'PROPOSED', now: ACT_NOW,
      meta: { provider: 'test', model: 'test', adapter: 'NATIVE', promptTokens: 1, completionTokens: 1, latencyMs: 1 }, ...over,
    };
  };

  it('claimPlan: chỉ chủ kế hoạch, chỉ khi PROPOSED và còn hạn, và chỉ MỘT lần thắng', async () => {
    const f = await seedActions();
    const row = await createPlanRow(planInput(f));
    expect(row.expiresAt.getTime()).toBe(ACT_NOW.getTime() + 10 * 60_000);
    expect(await claimPlan(row.id, f.lan.id, ACT_NOW)).toBe(false); // người khác
    expect(await claimPlan(row.id, f.owner.id, minutesAfter(11))).toBe(false); // hết hạn
    expect((await findOwnedPlan(f.owner.id, row.id))?.status).toBe('PROPOSED');
    const wins = await Promise.all(Array.from({ length: 10 }, () => claimPlan(row.id, f.owner.id, minutesAfter(1))));
    expect(wins.filter(Boolean)).toHaveLength(1);
    expect(await claimPlan(row.id, f.owner.id, minutesAfter(1))).toBe(false); // đã EXECUTING
    expect((await findOwnedPlan(f.owner.id, row.id))?.status).toBe('EXECUTING');
  });

  it('expireIfNeeded chỉ đổi kế hoạch ĐANG MỞ và quá hạn; findOwnedPlan không cho người khác thấy', async () => {
    const f = await seedActions();
    const open = await createPlanRow(planInput(f));
    const choice = await createPlanRow(planInput(f, { status: 'NEEDS_CHOICE' }));
    const done = await createPlanRow(planInput(f, { status: 'FAILED', errorCode: 'NOT_FOUND' }));
    expect((await expireIfNeeded(open, minutesAfter(5))).status).toBe('PROPOSED');
    expect((await expireIfNeeded(open, minutesAfter(11))).status).toBe('EXPIRED');
    expect((await expireIfNeeded(choice, minutesAfter(11))).status).toBe('EXPIRED');
    expect((await expireIfNeeded(done, minutesAfter(11))).status).toBe('FAILED');
    expect(await findOwnedPlan(f.lan.id, open.id)).toBeNull();
  });

  it('cancelOpenPlans: chỉ kế hoạch ĐANG MỞ của đúng hội thoại và đúng người; giữ lại kế hoạch `except`', async () => {
    const f = await seedActions();
    const a = await createPlanRow(planInput(f));
    const b = await createPlanRow(planInput(f, { status: 'NEEDS_CHOICE' }));
    const keep = await createPlanRow(planInput(f));
    const otherConversation = await createPlanRow(planInput(f, { conversationId: '22222222-2222-4222-8222-222222222222' }));
    const otherUser = await createPlanRow(planInput(f, { userId: f.lan.id }));
    const finished = await createPlanRow(planInput(f, { status: 'EXECUTED' }));
    const count = await cancelOpenPlans(f.owner.id, '11111111-1111-4111-8111-111111111111', 'SUPERSEDED', ACT_NOW, { except: keep.id });
    expect(count).toBe(2);
    const statusOf = async (id: string) => (await prisma.chatActionPlan.findUniqueOrThrow({ where: { id } })).status;
    expect(await statusOf(a.id)).toBe('CANCELLED');
    expect(await statusOf(b.id)).toBe('CANCELLED');
    expect(await statusOf(keep.id)).toBe('PROPOSED');
    expect(await statusOf(otherConversation.id)).toBe('PROPOSED');
    expect(await statusOf(otherUser.id)).toBe('PROPOSED');
    expect(await statusOf(finished.id)).toBe('EXECUTED');
  });
});

describe('resolveOp: chỉ tìm trong bảng của kế hoạch, kể cả với ngữ cảnh "nó" và nút chọn', () => {
  async function envFor(f: Awaited<ReturnType<typeof seedActions>>, bindings: ResolveEnv['bindings'] = []): Promise<ResolveEnv> {
    const exec = await resolveExecutionContext({ userId: f.owner.id, now: ACT_NOW, scope: { kind: 'BOARD', boardId: f.alpha.id } });
    return { userId: f.owner.id, exec, boardId: f.alpha.id, bindings };
  }

  it('"nó" trỏ tới thẻ của bảng khác (ngữ cảnh hỏng / cũ) -> không tìm thấy, không thao tác thẻ ngoài bảng', async () => {
    const f = await seedActions();
    const foreign = await envFor(f, [{ id: f.loginBeta.id, name: 'Login Beta', kind: 'CARD' }]);
    const rename = { type: 'RENAME_CARD', card: { by: 'CONTEXT', slot: 'LAST_CARD' }, title: 'X' } as const;
    expect(await resolveOp(foreign, rename)).toMatchObject({ kind: 'FAIL', code: 'NOT_FOUND' });
    const own = await envFor(f, [{ id: f.loginUi.id, name: 'Login UI', kind: 'CARD' }]);
    const ok = await resolveOp(own, rename);
    expect(ok).toMatchObject({ kind: 'OK', op: { ids: { card: f.loginUi.id } } });
  });

  it('id đã chọn bằng nút (presets) cũng phải thuộc bảng: thẻ / cột / nhãn / người ngoài bảng -> không tìm thấy', async () => {
    const f = await seedActions();
    const env = await envFor(f);
    const betaLabel = await prisma.label.create({ data: { boardId: f.beta.id, name: 'Nhãn Beta', color: '#61BD4F' } });
    const byText = { by: 'TEXT' as const, text: 'Login UI' };
    // lựa chọn được ghim theo DẤU VÂN TAY của tham chiếu (loại + chữ đã bỏ dấu / từ chung)
    const card = refSignature('card', byText) as string;
    const toList = refSignature('list', text('Đang làm')) as string;
    const labelSig = refSignature('label', text('Nhãn Beta')) as string;
    const memberSig = refSignature('member', text('Người Ngoài')) as string;
    expect(card).toBe('card:t:login ui');
    expect(await resolveOp(env, { type: 'RENAME_CARD', card: byText, title: 'X' }, { [card]: f.loginBeta.id })).toMatchObject({ kind: 'FAIL', code: 'NOT_FOUND' });
    expect(await resolveOp(env, { type: 'MOVE_CARD', card: byText, toList: text('Đang làm') }, { [toList]: f.betaDoing.id })).toMatchObject({ kind: 'FAIL', code: 'NOT_FOUND' });
    expect(await resolveOp(env, { type: 'ADD_LABEL', card: byText, label: text('Nhãn Beta') }, { [labelSig]: betaLabel.id })).toMatchObject({ kind: 'FAIL', code: 'NOT_FOUND' });
    expect(await resolveOp(env, { type: 'ASSIGN_MEMBER', card: byText, member: text('Người Ngoài') }, { [memberSig]: f.outsider.id })).toMatchObject({ kind: 'FAIL', code: 'NOT_FOUND' });
    // đối chứng: cùng thao tác với id đúng bảng thì tìm thấy
    expect(await resolveOp(env, { type: 'MOVE_CARD', card: byText, toList: text('Đang làm') }, { [toList]: f.doing.id })).toMatchObject({ kind: 'OK' });
  });
});
