// Phase 6 - tích hợp phân công vào chatbot v2: công cụ đọc suggest_assignee, giao việc cho "người phù hợp nhất" ({by:BEST}) và chia các việc
// chưa có người (ASSIGN_UNASSIGNED). Thuật toán là của module phân công (gọi lại, không viết lại); ở đây kiểm: nguồn gốc câu lệnh, luôn xem trước,
// không lộ bằng chứng / CV, ghim người được chọn (không gọi lại khi áp dụng), recordOutcome CHỈ sau khi bấm Áp dụng, giới hạn tốc độ, STALE.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import * as assignService from '../src/modules/assign/assign.service';
import { suggestForCard } from '../src/modules/assign/assign.service';
import { recordAssignOutcomes, resetAssignBudget, takeAssignBudget, wholeScore } from '../src/modules/chat/v2/actions/actions.assign';
import { ASSIGN_HIGH_OPS, decideExecution, riskOf } from '../src/modules/chat/v2/actions/actions.autorun';
import { executePlan } from '../src/modules/chat/v2/actions/actions.executor';
import { prepare } from '../src/modules/chat/v2/actions/actions.preflight';
import { ActionOpSchema, ProposeActionsInput } from '../src/modules/chat/v2/actions/actions.schema';
import { foldWords, licenceFor } from '../src/modules/chat/v2/actions/actions.text';
import type { StoredOp } from '../src/modules/chat/v2/actions/actions.types';
import { persistentCancel, persistentConfirm, persistentMessage } from '../src/modules/chat/v2/chat.v2.history';
import type { V2Reply } from '../src/modules/chat/v2/chat.v2.contract';
import { V2SessionStore } from '../src/modules/chat/v2/chat.v2.session';
import { executeChatTool } from '../src/modules/chat/v2/chat.v2.tools';
import { ACT_NOW, actionContext, propose, script, seedActions, text } from './chat.actions.fixture';
import { giveHistory, mkCard, newTarget, SIMILAR } from './assignFixtures';

const mocks = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock('../src/realtime/socket', async (original) => ({ ...(await original<object>()), emitToBoard: mocks.emit }));

beforeEach(() => {
  resetAssignBudget();
  mocks.emit.mockClear();
  vi.restoreAllMocks();
  tick = 0;
});

const BEST = { by: 'BEST' as const };
const TITLE = 'Thiet ke giao dien quen mat khau';
const onBoard = (boardId: string) => ({ kind: 'BOARD' as const, boardId });
type World = Awaited<ReturnType<typeof seedWorld>>;

/** Alpha có lịch sử: Lan giỏi "thiết kế giao diện", Tuấn giỏi "API"; thẻ cần giao: TITLE (chưa có người). */
async function seedWorld() {
  const f = await seedActions();
  await giveHistory(f.done.id, f.lan.id);
  await giveHistory(f.done.id, f.tuan.id, ['Viet API thanh toan', 'Viet API don hang', 'Viet API khach hang']);
  const target = await newTarget(f.todo.id);
  await prisma.assignRun.deleteMany();
  return { ...f, target };
}

let tick = 0;
async function ask(f: World, userId: string, message: string, operations: unknown[], opts: { autoExecute?: boolean; now?: Date; sessions?: V2SessionStore } = {}) {
  const sessions = opts.sessions ?? new V2SessionStore();
  tick += 1;
  const now = opts.now ?? new Date(ACT_NOW.getTime() + tick * 1000);
  const scope = onBoard(f.alpha.id);
  const reply = await persistentMessage(userId, { message, scope }, actionContext({ step: script([propose(...operations)]), sessions, now, ...(opts.autoExecute !== undefined ? { autoExecute: opts.autoExecute } : {}) }));
  return { reply, sessions, scope };
}
const apply = (userId: string, reply: V2Reply, sessions: V2SessionStore, scope: ReturnType<typeof onBoard>, now = new Date(ACT_NOW.getTime() + 120_000)) =>
  persistentConfirm(userId, planOf(reply).planId, { conversationId: reply.conversationId, checksum: planOf(reply).checksum, scope }, actionContext({ sessions, now }));
function planOf(reply: V2Reply) {
  const a = reply.answer.action;
  if (a?.kind !== 'PLAN') throw new Error(`cần PLAN nhưng nhận ${JSON.stringify(a ?? null)} / "${reply.answer.text}"`);
  return a.plan;
}
function resultOf(reply: V2Reply) {
  const a = reply.answer.action;
  if (a?.kind !== 'RESULT') throw new Error(`cần RESULT nhưng nhận ${JSON.stringify(a ?? null)} / "${reply.answer.text}"`);
  return a.result;
}
const members = async (cardId: string) => (await prisma.cardMember.findMany({ where: { cardId } })).map((m) => m.userId);
const BEST_MSG = `Giao thẻ ${TITLE} cho người phù hợp nhất`;
const bestOp = (title = TITLE) => ({ type: 'ASSIGN_MEMBER', card: text(title), member: BEST });
const splitOp = (list = 'Cần làm') => ({ type: 'ASSIGN_UNASSIGNED', list: text(list) });
const SPLIT_MSG = 'Chia các việc chưa có người trong cột Cần làm cho nhóm';

// ---------------------------------------------------------------------------------------------------------------------
describe('hàm thuần: lược đồ, nguồn gốc câu lệnh, chính sách, ngân sách', () => {
  it('{by:BEST} chỉ hợp lệ ở member của ASSIGN_MEMBER; ở thẻ / cột / nhãn / người khác bị lược đồ từ chối', () => {
    expect(ActionOpSchema.safeParse({ type: 'ASSIGN_MEMBER', card: text('A'), member: BEST }).success).toBe(true);
    expect(ActionOpSchema.safeParse({ type: 'ASSIGN_MEMBER', card: BEST, member: text('Lan') }).success).toBe(false);
    expect(ActionOpSchema.safeParse({ type: 'MOVE_CARD', card: text('A'), toList: BEST }).success).toBe(false);
    expect(ActionOpSchema.safeParse({ type: 'ADD_LABEL', card: text('A'), label: BEST }).success).toBe(false);
    expect(ActionOpSchema.safeParse({ type: 'ASSIGN_UNASSIGNED', list: BEST }).success).toBe(false);
    expect(ActionOpSchema.safeParse({ type: 'ASSIGN_UNASSIGNED', list: text('Cần làm') }).success).toBe(true);
    expect(ActionOpSchema.safeParse({ type: 'ASSIGN_UNASSIGNED', list: text('Cần làm'), member: BEST }).success).toBe(false); // khóa lạ
    expect(ProposeActionsInput.safeParse({ operations: [{ type: 'ASSIGN_MEMBER', card: text('A'), member: { by: 'BEST', userId: 'x' } }] }).success).toBe(false); // không điền được id
  });

  it('giấy phép: BEST cần cụm "phù hợp nhất / tốt nhất / thích hợp / gợi ý"; chia cột cần động từ chia / giao VÀ dấu hiệu "chưa có người"', () => {
    const prepared = (message: string, op: unknown) => prepare([ActionOpSchema.parse(op)], message, '2026-10-07');
    const verdict = (message: string, op: unknown) => {
      const r = prepared(message, op);
      if (!r.ok) throw new Error(r.text);
      return r.prepared.prov.verdict;
    };
    expect(verdict('Giao Login UI cho người phù hợp nhất', bestOp('Login UI'))).toBe('USER_DIRECT');
    expect(verdict('Giao Login UI cho người tốt nhất', bestOp('Login UI'))).toBe('USER_DIRECT');
    expect(verdict('Gợi ý người giao Login UI', bestOp('Login UI'))).not.toBe('NOT_REQUESTED');
    // người dùng gọi TÊN mà mô hình lại dùng BEST → không được đổi người nhận
    expect(verdict('Giao Login UI cho Lan', bestOp('Login UI'))).toBe('NOT_REQUESTED');
    expect(verdict('Chia các việc chưa có người trong cột Cần làm cho nhóm', splitOp())).toBe('USER_DIRECT');
    expect(verdict('Phân công những việc chưa giao ở cột Cần làm', splitOp())).toBe('USER_DIRECT');
    expect(verdict('Giao Login UI cho Lan', splitOp('Login UI'))).toBe('NOT_REQUESTED');
    expect(verdict('Chia việc cho cả nhóm', splitOp())).toBe('NOT_REQUESTED'); // không nói "chưa có người"
    expect(licenceFor('ASSIGN_UNASSIGNED', foldWords('Đừng chia các việc chưa có người'))).toMatchObject({ licensed: true, negated: true });
  });

  it('người nhận do MÁY chọn → LUÔN xem trước (kể cả bật tự chạy, kể cả chỉ một thao tác), lý do AI_CHOSEN_TARGET; từ 4 thao tác → rủi ro CAO', () => {
    const base = { provenance: { verdict: 'USER_DIRECT' as const, failures: [] }, dueFuzzy: false, refsUnique: true, boardIds: ['b'], inCeiling: true, guard: { ok: true } as const, autoExecute: true };
    const direct = decideExecution({ ...base, opTypes: ['ASSIGN_MEMBER'] });
    expect(direct.mode).toBe('AUTO'); // người dùng tự gọi tên: vẫn tự chạy như Phase 1
    const aiPick = decideExecution({ ...base, opTypes: ['ASSIGN_MEMBER'], aiChosen: true });
    expect(aiPick).toMatchObject({ mode: 'CONFIRM', risk: 'MEDIUM', reasons: [{ code: 'AI_CHOSEN_TARGET' }] });
    expect(decideExecution({ ...base, opTypes: Array(ASSIGN_HIGH_OPS - 1).fill('ASSIGN_MEMBER'), aiChosen: true })).toMatchObject({ mode: 'CONFIRM', risk: 'MEDIUM' });
    expect(decideExecution({ ...base, opTypes: Array(ASSIGN_HIGH_OPS).fill('ASSIGN_MEMBER'), aiChosen: true })).toMatchObject({ mode: 'CONFIRM', risk: 'HIGH' });
    expect(riskOf(ASSIGN_HIGH_OPS, [{ code: 'MULTI_OP', text: '' }])).toBe('MEDIUM'); // nhiều thao tác do NGƯỜI nêu: ngưỡng cũ (8)
  });

  it('ngân sách gợi ý: cửa sổ trượt theo người dùng và theo loại; hết lượt thì từ chối, qua cửa sổ thì có lại', () => {
    const t = ACT_NOW.getTime();
    for (let i = 0; i < 30; i += 1) expect(takeAssignBudget('SUGGEST', 'u1', t + i)).toBe(true);
    expect(takeAssignBudget('SUGGEST', 'u1', t + 31)).toBe(false);
    expect(takeAssignBudget('SUGGEST', 'u2', t + 31)).toBe(true); // người khác không bị ảnh hưởng
    expect(takeAssignBudget('PLAN', 'u1', t + 31)).toBe(true); // loại khác có ngân sách riêng
    expect(takeAssignBudget('SUGGEST', 'u1', t + 10 * 60_000 + 5)).toBe(true); // qua cửa sổ 10 phút
    for (let i = 0; i < 9; i += 1) takeAssignBudget('PLAN', 'u3', t);
    expect(takeAssignBudget('PLAN', 'u3', t)).toBe(true);
    expect(takeAssignBudget('PLAN', 'u3', t)).toBe(false); // chia việc: 10 lượt / 10 phút
  });

  it('recordAssignOutcomes: chỉ ứng viên xếp ĐẦU (rank 1) của luợt BEST có runId và THỰC SỰ vừa được giao; mọi trường hợp khác bỏ qua', async () => {
    const spy = vi.spyOn(assignService, 'recordOutcome').mockResolvedValue({} as never);
    const choice = (over: Partial<NonNullable<StoredOp['choice']>> = {}) => ({ source: 'BEST' as const, runId: 'run-1', rank: 1, score: 80, confidenceLevel: 'GOOD' as const, flags: [], alternatives: [], ...over });
    const op = (c?: NonNullable<StoredOp['choice']>, member: string | null = 'u9'): StoredOp => ({ type: 'ASSIGN_MEMBER', ids: { card: 'c1', ...(member ? { member } : {}) }, params: {}, before: null, display: {}, ...(c ? { choice: c } : {}) });
    const ops = [op(choice()), op(choice({ rank: 2 })), op(choice({ runId: null })), op(choice({ source: 'PLAN' })), op(undefined), op(choice(), null), op(choice())];
    const changed = [true, true, true, true, true, true, false]; // thao tác cuối "không đổi gì" (đã được giao từ trước)
    expect(await recordAssignOutcomes({ userId: 'owner', ops, changed, now: ACT_NOW })).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith('owner', 'run-1', 'u9', ACT_NOW);
  });

  it('recordAssignOutcomes: lỗi khi ghi KHÔNG làm hỏng kết quả (chỉ ghi log)', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(assignService, 'recordOutcome').mockRejectedValue(new Error('hỏng'));
    const op: StoredOp = { type: 'ASSIGN_MEMBER', ids: { card: 'c1', member: 'u1' }, params: {}, before: null, display: {}, choice: { source: 'BEST', runId: 'r', rank: 1, score: 1, confidenceLevel: 'GOOD', flags: [], alternatives: [] } };
    await expect(recordAssignOutcomes({ userId: 'o', ops: [op], changed: [true], now: ACT_NOW })).resolves.toBe(0);
    expect(log).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('suggest_assignee (công cụ ĐỌC): xếp hạng, không lộ bằng chứng / CV', () => {
  const tool = (f: World, userId: string, input: Record<string, unknown>, scope: { kind: 'BOARD'; boardId: string } | { kind: 'MY' } = onBoard(f.alpha.id)) =>
    executeChatTool({ userId, now: ACT_NOW, scope }, 'suggest_assignee', input);

  it('trả hạng 1 là người có lịch sử giống nhất; khớp đúng kết quả của module phân công', async () => {
    const f = await seedWorld();
    const { data } = await tool(f, f.owner.id, { cardId: f.target.id });
    const direct = await suggestForCard(f.owner.id, f.target.id, ACT_NOW);
    expect(data.candidates[0]).toMatchObject({ rank: 1, user: { id: f.lan.id, name: 'Nguyễn Lan' }, assigned: false });
    expect(data.candidates.map((c) => c.user.id)).toEqual(direct.candidates.slice(0, 3).map((c) => c.user.id));
    expect(data).toMatchObject({ card: { id: f.target.id, title: TITLE, boardName: 'Dự án Alpha', columnName: 'Cần làm' }, candidateCount: direct.candidateCount });
  });

  it('KHÔNG lộ bằng chứng (tiêu đề thẻ cũ), hồ sơ, CV, thành phần điểm, email; chỉ có đúng các khóa cho phép', async () => {
    const f = await seedWorld();
    const result = await tool(f, f.owner.id, { cardId: f.target.id, top: 5 });
    const everything = JSON.stringify(result);
    for (const title of [...SIMILAR, 'Viet API thanh toan']) expect(everything).not.toContain(title);
    for (const word of ['evidence', 'declaredEvidence', 'cvAvailable', 'components', 'rawScore', 'avatarUrl', 'runId']) expect(everything).not.toContain(word);
    for (const u of await prisma.user.findMany({ select: { email: true } })) expect(everything).not.toContain(u.email);
    expect(Object.keys(result.data.candidates[0]).sort()).toEqual(['assigned', 'capacity', 'confidenceLevel', 'flags', 'load', 'rank', 'score', 'user']);
    expect(Object.keys(result.data).sort()).toEqual(['candidateCount', 'candidates', 'card']);
  });

  it('top giới hạn 1-5; quyền: VIEWER / người ngoài bị chặn; thẻ ngoài phạm vi (bảng khác) = "không tìm thấy"', async () => {
    const f = await seedWorld();
    expect((await tool(f, f.owner.id, { cardId: f.target.id, top: 1 })).data.candidates).toHaveLength(1);
    await expect(tool(f, f.owner.id, { cardId: f.target.id, top: 6 })).rejects.toBeDefined();
    await expect(tool(f, f.viewer.id, { cardId: f.target.id })).rejects.toMatchObject({ statusCode: 403 });
    await expect(tool(f, f.outsider.id, { cardId: f.target.id })).rejects.toMatchObject({ statusCode: 403 });
    await expect(tool(f, f.owner.id, { cardId: f.loginBeta.id })).rejects.toMatchObject({ statusCode: 400, message: 'Không tìm thấy công việc trong phạm vi được phép' });
  });

  it('giới hạn tốc độ: hết 30 lượt / 10 phút → 429 với câu tiếng Việt; người khác không bị ảnh hưởng', async () => {
    const f = await seedWorld();
    for (let i = 0; i < 30; i += 1) takeAssignBudget('SUGGEST', f.owner.id, ACT_NOW.getTime());
    await expect(tool(f, f.owner.id, { cardId: f.target.id })).rejects.toMatchObject({ statusCode: 429, message: expect.stringContaining('quá nhiều lần') });
    expect((await tool(f, f.lan.id, { cardId: f.target.id })).data.candidates.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('giao việc cho "người phù hợp nhất" ({by:BEST})', () => {
  it('xem trước ghi rõ người do máy chọn + điểm + ứng viên khác; CSDL chưa đổi; Áp dụng giao đúng người và GHI KẾT QUẢ luợt gợi ý', async () => {
    const f = await seedWorld();
    const { reply, sessions, scope } = await ask(f, f.owner.id, BEST_MSG, [bestOp()]);
    const preview = planOf(reply);
    expect(preview).toMatchObject({ status: 'PROPOSED', opCount: 1, requiresConfirmation: true, risk: 'MEDIUM', reasons: [{ code: 'AI_CHOSEN_TARGET' }] });
    expect(preview.items[0]).toMatchObject({ verb: 'Giao thẻ', text: `“${TITLE}” cho Nguyễn Lan`, choice: { source: 'BEST', rank: 1, confidenceLevel: expect.any(String) } });
    expect(preview.items[0].choice?.alternatives.length).toBeGreaterThan(0);
    expect(JSON.stringify(preview)).not.toContain('runId'); // runId chỉ dùng nội bộ
    expect(await members(f.target.id)).toEqual([]);
    const runs = await prisma.assignRun.findMany();
    expect(runs).toHaveLength(1);
    const stored = await prisma.chatActionPlan.findUniqueOrThrow({ where: { id: preview.planId } });
    expect(JSON.stringify(stored.plan)).toContain(`"runId":"${runs[0].id}"`); // kế hoạch đã lưu ghim đúng luợt gợi ý để ghi kết quả khi Áp dụng
    expect(runs[0]).toMatchObject({ cardId: f.target.id, topUserId: f.lan.id, decidedAt: null, chosenUserId: null, actorKey: f.owner.id });

    expect(resultOf(await apply(f.owner.id, reply, sessions, scope))).toMatchObject({ status: 'EXECUTED', summary: `Đã giao thẻ “${TITLE}” cho Nguyễn Lan.` });
    expect(await members(f.target.id)).toEqual([f.lan.id]);
    const after = await prisma.assignRun.findMany();
    expect(after).toHaveLength(1); // áp dụng KHÔNG gọi lại gợi ý (người đã được ghim): không có luợt thứ hai
    expect(after[0]).toMatchObject({ chosenUserId: f.lan.id, accepted: true });
    expect(after[0].decidedAt).not.toBeNull();
  });

  it('bấm Áp dụng hai lần: chỉ giao và ghi kết quả MỘT lần', async () => {
    const f = await seedWorld();
    const { reply, sessions, scope } = await ask(f, f.owner.id, BEST_MSG, [bestOp()]);
    const spy = vi.spyOn(assignService, 'recordOutcome');
    await apply(f.owner.id, reply, sessions, scope);
    const again = resultOf(await apply(f.owner.id, reply, sessions, scope));
    expect(again).toMatchObject({ status: 'EXECUTED', alreadyApplied: true });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await prisma.cardMember.count({ where: { cardId: f.target.id } })).toBe(1);
  });

  it('KHÔNG BAO GIỜ tự chạy: bật tự chạy + một thao tác vẫn phải xem trước; chưa bấm thì chưa giao và chưa ghi kết quả', async () => {
    const f = await seedWorld();
    const { reply } = await ask(f, f.owner.id, BEST_MSG, [bestOp()], { autoExecute: true });
    expect(planOf(reply)).toMatchObject({ status: 'PROPOSED', requiresConfirmation: true });
    expect(await members(f.target.id)).toEqual([]);
    expect((await prisma.assignRun.findMany())[0].decidedAt).toBeNull();
  });

  it('Hủy / hết hạn / kế hoạch cũ: KHÔNG ghi kết quả (không thổi phồng tỉ lệ chấp nhận)', async () => {
    const f = await seedWorld();
    const cancelled = await ask(f, f.owner.id, BEST_MSG, [bestOp()]);
    await persistentCancel(f.owner.id, planOf(cancelled.reply).planId, cancelled.reply.conversationId, actionContext({ sessions: cancelled.sessions }));
    const expired = await ask(f, f.owner.id, BEST_MSG, [bestOp()]);
    expect(resultOf(await apply(f.owner.id, expired.reply, expired.sessions, expired.scope, new Date(ACT_NOW.getTime() + 11 * 60_000))).status).toBe('EXPIRED');
    const stale = await ask(f, f.owner.id, BEST_MSG, [bestOp()]);
    await prisma.card.update({ where: { id: f.target.id }, data: { title: 'Đã bị đổi tên' } });
    expect(resultOf(await apply(f.owner.id, stale.reply, stale.sessions, stale.scope)).status).toBe('STALE');
    expect(await members(f.target.id)).toEqual([]);
    const runs = await prisma.assignRun.findMany();
    expect(runs).toHaveLength(3);
    expect(runs.every((r) => r.decidedAt === null && r.chosenUserId === null)).toBe(true);
  });

  it('câu của người dùng GỌI TÊN mà mô hình dùng BEST → từ chối, không gọi module phân công, không tạo luợt gợi ý', async () => {
    const f = await seedWorld();
    const spy = vi.spyOn(assignService, 'suggestForCard');
    const { reply } = await ask(f, f.owner.id, `Giao thẻ ${TITLE} cho Tuấn`, [bestOp()]);
    expect(reply.answer.action).toBeUndefined();
    expect(reply.answer.text).toContain('chưa thấy câu của bạn yêu cầu');
    expect(spy).not.toHaveBeenCalled();
    expect(await prisma.assignRun.count()).toBe(0);
    expect(await members(f.target.id)).toEqual([]);
  });

  it('ứng viên xếp đầu đã ở trong thẻ → chọn người kế tiếp; khi đó KHÔNG ghi kết quả (đó là lựa chọn của máy, không phải của người dùng)', async () => {
    const f = await seedWorld();
    await prisma.cardMember.create({ data: { cardId: f.target.id, userId: f.lan.id } });
    const { reply, sessions, scope } = await ask(f, f.owner.id, BEST_MSG, [bestOp()]);
    const item = planOf(reply).items[0];
    expect(item.text).not.toContain('Nguyễn Lan');
    expect(item.choice?.rank).toBeGreaterThan(1);
    await apply(f.owner.id, reply, sessions, scope);
    expect((await members(f.target.id)).sort()).toHaveLength(2);
    const run = (await prisma.assignRun.findMany())[0];
    expect(run.decidedAt).toBeNull();
  });

  it('phòng thủ thêm: dù module phân công xếp người chỉ có quyền XEM lên đầu, người đó không bao giờ được chọn', async () => {
    const f = await seedWorld();
    const real = await suggestForCard(f.owner.id, f.target.id, ACT_NOW);
    const viewerFirst = { ...real.candidates[0], rank: 1, user: { id: f.viewer.id, name: 'Người Xem', avatarUrl: null } };
    vi.spyOn(assignService, 'suggestForCard').mockResolvedValue({ ...real, candidates: [viewerFirst, ...real.candidates.map((c, i) => ({ ...c, rank: i + 2 }))] });
    const { reply } = await ask(f, f.owner.id, BEST_MSG, [bestOp()]);
    expect(planOf(reply).status).toBe('PROPOSED'); // không bị guard VIEWER_ASSIGN chặn vì đã bỏ người chỉ-xem
    expect(planOf(reply).items[0].text).not.toContain('Người Xem');
    expect(planOf(reply).items[0].choice?.rank).toBeGreaterThan(1);
  });

  it('điểm hiện cho người dùng là SỐ NGUYÊN (module phân công trả số thực như 72.49999999999999): người chọn và ứng viên khác', async () => {
    expect([wholeScore(72.49999999999999), wholeScore(50.00000000000014), wholeScore(27.5), wholeScore(null)]).toEqual([72, 50, 28, null]);
    const f = await seedWorld();
    const real = await suggestForCard(f.owner.id, f.target.id, ACT_NOW);
    const skew = real.candidates.map((c, i) => ({ ...c, score: i === 0 ? 72.49999999999999 : 50.00000000000014 - i }));
    vi.spyOn(assignService, 'suggestForCard').mockResolvedValue({ ...real, candidates: skew });
    const { reply } = await ask(f, f.owner.id, BEST_MSG, [bestOp()]);
    const choice = planOf(reply).items[0].choice;
    expect(choice?.score).toBe(72);
    expect(choice?.alternatives.every((a) => a.score === null || Number.isInteger(a.score))).toBe(true);
    expect(JSON.stringify(planOf(reply).items)).not.toMatch(/"score":\d+\.\d/);
  });

  it('phòng thủ thêm: người đang TẠM NGHỈ dù được xếp đầu cũng không được chọn; người chọn thay thế (hạng > 1) không mang theo luợt gợi ý', async () => {
    const f = await seedWorld();
    const real = await suggestForCard(f.owner.id, f.target.id, ACT_NOW);
    const [top, ...rest] = real.candidates;
    const pausedFirst = { ...top, rank: 1, flags: [...top.flags, 'PAUSED' as const] };
    vi.spyOn(assignService, 'suggestForCard').mockResolvedValue({ ...real, candidates: [pausedFirst, ...rest.map((c, i) => ({ ...c, rank: i + 2 }))] });
    const { reply } = await ask(f, f.owner.id, BEST_MSG, [bestOp()]);
    const item = planOf(reply).items[0];
    expect(item.text).not.toContain(top.user.name);
    expect(item.choice?.rank).toBeGreaterThan(1);
    const stored = await prisma.chatActionPlan.findUniqueOrThrow({ where: { id: planOf(reply).planId } });
    expect(JSON.stringify(stored.plan)).toContain('"runId":null'); // chỉ người xếp ĐẦU mới gắn với luợt gợi ý
    expect(JSON.stringify(stored.plan)).not.toContain(real.runId);
  });

  it('phòng thủ thêm: kế hoạch có người do máy chọn mà bị chạy với cờ tự chạy vẫn KHÔNG ghi kết quả gợi ý', async () => {
    const f = await seedWorld();
    const { reply } = await ask(f, f.owner.id, BEST_MSG, [bestOp()]);
    const row = await prisma.chatActionPlan.findUniqueOrThrow({ where: { id: planOf(reply).planId } });
    const out = await executePlan({ row, now: new Date(ACT_NOW.getTime() + 120_000), autoExecuted: true, scope: onBoard(f.alpha.id) });
    expect(out.status).toBe('EXECUTED');
    expect(await members(f.target.id)).toEqual([f.lan.id]);
    expect((await prisma.assignRun.findMany())[0].decidedAt).toBeNull();
  });

  it('thẻ vừa tạo trong CÙNG lệnh chưa có lịch sử → từ chối rõ ràng; gợi ý hết lượt → RATE_LIMITED, không ghi gì', async () => {
    const f = await seedWorld();
    const created = await ask(f, f.owner.id, 'Tạo thẻ Việc mới trong Cần làm rồi giao cho người phù hợp nhất', [
      { type: 'CREATE_CARD', title: 'Việc mới', list: text('Cần làm') },
      { type: 'ASSIGN_MEMBER', card: text('Việc mới'), member: BEST },
    ]);
    expect(created.reply.answer.text).toContain('chưa có lịch sử');
    for (let i = 0; i < 30; i += 1) takeAssignBudget('SUGGEST', f.owner.id, ACT_NOW.getTime() + tick * 1000 + 1000);
    const limited = await ask(f, f.owner.id, BEST_MSG, [bestOp()]);
    expect(limited.reply.answer.text).toContain('quá nhiều lần');
    expect(await prisma.chatActionPlan.findMany({ where: { errorCode: 'RATE_LIMITED' } })).toHaveLength(1);
    expect(await members(f.target.id)).toEqual([]);
  });

  it('nhiều thẻ cùng lệnh: mỗi thẻ có luợt gợi ý riêng, mỗi người được ghim; Áp dụng ghi kết quả cho từng luợt', async () => {
    const f = await seedWorld();
    const second = await mkCard(f.todo.id, { title: 'Viet API xuat bao cao', dueDate: new Date(Date.now() + 5 * 86_400_000), startDate: new Date(Date.now() - 86_400_000) });
    const { reply, sessions, scope } = await ask(f, f.owner.id, `Giao thẻ ${TITLE} và thẻ Viet API xuat bao cao cho người phù hợp nhất`, [bestOp(), bestOp('Viet API xuat bao cao')]);
    expect(planOf(reply)).toMatchObject({ opCount: 2, reasons: expect.arrayContaining([{ code: 'AI_CHOSEN_TARGET', text: expect.any(String) }, { code: 'MULTI_OP', text: expect.any(String) }]) });
    expect(await prisma.assignRun.count()).toBe(2);
    await apply(f.owner.id, reply, sessions, scope);
    expect(await members(f.target.id)).toEqual([f.lan.id]);
    expect((await members(second.id)).length).toBe(1);
    expect(await prisma.assignRun.count({ where: { decidedAt: { not: null } } })).toBe(2);
  });

  it('đo đạc: ChatActionPlan ghi loại thao tác, lý do và kết quả', async () => {
    const f = await seedWorld();
    const { reply, sessions, scope } = await ask(f, f.owner.id, BEST_MSG, [bestOp()]);
    await apply(f.owner.id, reply, sessions, scope);
    const [row] = await prisma.chatActionPlan.findMany();
    expect(row).toMatchObject({ status: 'EXECUTED', opTypes: ['ASSIGN_MEMBER'], proposedOps: 1, requiresConfirmation: true, autoExecuted: false, executionSuccess: true });
    expect(row.reasons).toMatchObject([{ code: 'AI_CHOSEN_TARGET' }]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('chia các việc chưa có người nhận (ASSIGN_UNASSIGNED)', () => {
  const unassignedIn = async (listId: string) => prisma.card.findMany({ where: { listId, deletedAt: null, archivedAt: null, members: { none: {} } } });

  it('khai triển thành nhiều ASSIGN_MEMBER do máy chọn; Áp dụng giao đủ; KHÔNG tạo luợt gợi ý, KHÔNG ghi kết quả (không có luợt nào)', async () => {
    const f = await seedWorld();
    const spy = vi.spyOn(assignService, 'recordOutcome');
    const before = await unassignedIn(f.todo.id); // design, payment, loginUi, target
    expect(before).toHaveLength(4);
    const { reply, sessions, scope } = await ask(f, f.owner.id, SPLIT_MSG, [splitOp()]);
    const preview = planOf(reply);
    expect(preview).toMatchObject({ status: 'PROPOSED', opCount: 4, risk: 'HIGH', requiresConfirmation: true });
    expect(preview.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['AI_CHOSEN_TARGET', 'MULTI_OP']));
    expect(preview.items.every((i) => i.verb === 'Giao thẻ' && i.choice?.source === 'PLAN')).toBe(true);
    expect(JSON.stringify(preview)).not.toContain('Người Xem'); // người chỉ-xem không nhận việc
    expect((await unassignedIn(f.todo.id)).length).toBe(4); // chưa giao gì

    expect(resultOf(await apply(f.owner.id, reply, sessions, scope))).toMatchObject({ status: 'EXECUTED', opCount: 4, summary: 'Đã áp dụng 4 thay đổi trên bảng “Dự án Alpha”.' });
    expect(await unassignedIn(f.todo.id)).toHaveLength(0);
    const people = new Set((await prisma.cardMember.findMany({ where: { cardId: { in: before.map((c) => c.id) } } })).map((m) => m.userId));
    expect(people.has(f.viewer.id)).toBe(false);
    expect(await prisma.assignRun.count()).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect(mocks.emit).toHaveBeenCalledTimes(1);
  });

  it('phòng thủ thêm: dù module chia việc chọn người chỉ có quyền XEM cho một dòng, dòng đó không được giao và được báo rõ', async () => {
    const f = await seedWorld();
    const real = await assignService.planForList(f.owner.id, f.todo.id, ACT_NOW);
    const rows = real.rows.map((r, i) => (i === 0 && r.assignee ? { ...r, assignee: { ...r.assignee, user: { id: f.viewer.id, name: 'Người Xem', avatarUrl: null } } } : r));
    vi.spyOn(assignService, 'planForList').mockResolvedValue({ ...real, rows });
    const { reply } = await ask(f, f.owner.id, SPLIT_MSG, [splitOp()]);
    const preview = planOf(reply);
    expect(preview.opCount).toBe(3);
    expect(JSON.stringify(preview)).not.toContain('Người Xem');
    expect(preview.warnings.join(' ')).toContain('1 việc chưa chia được');
  });

  it('người đang TẠM NGHỈ không nhận việc và cũng không hiện trong "ứng viên khác"', async () => {
    const f = await seedWorld();
    await prisma.memberWorkProfile.create({ data: { userId: f.tuan.id, workspaceId: f.alpha.workspaceId, pausedUntil: new Date(ACT_NOW.getTime() + 30 * 86_400_000) } });
    const { reply } = await ask(f, f.owner.id, SPLIT_MSG, [splitOp()]);
    const preview = planOf(reply);
    expect(preview.opCount).toBe(4);
    expect(preview.items.some((i) => i.text.includes('Trần Tuấn'))).toBe(false);
    expect(preview.items.some((i) => (i.choice?.alternatives ?? []).some((a) => a.name === 'Trần Tuấn'))).toBe(false);
  });

  it('ít hơn 4 thẻ → rủi ro TRUNG BÌNH; cột không có việc chưa giao → NO_CHANGE, không ghi gì', async () => {
    const f = await seedWorld();
    await prisma.cardMember.createMany({ data: [f.design, f.payment, f.loginUi].map((c) => ({ cardId: c.id, userId: f.tuan.id })) });
    const small = await ask(f, f.owner.id, SPLIT_MSG, [splitOp()]);
    expect(planOf(small.reply)).toMatchObject({ opCount: 1, risk: 'MEDIUM' });
    await prisma.cardMember.create({ data: { cardId: f.target.id, userId: f.lan.id } });
    const none = await ask(f, f.owner.id, SPLIT_MSG, [splitOp()]);
    expect(none.reply.answer.action).toBeUndefined();
    expect(none.reply.answer.text).toContain('không có việc nào chưa có người nhận');
    expect(await prisma.chatActionPlan.findMany({ where: { errorCode: 'NO_CHANGE' } })).toHaveLength(1);
  });

  it('quá nhiều việc: chỉ chia tối đa 15 việc gấp nhất và nói rõ phần còn lại', async () => {
    const f = await seedWorld();
    for (let i = 0; i < 16; i += 1) await mkCard(f.todo.id, { title: `Viec them so ${i}`, dueDate: new Date(Date.now() + (i + 1) * 86_400_000) });
    const { reply } = await ask(f, f.owner.id, SPLIT_MSG, [splitOp()]);
    const preview = planOf(reply);
    expect(preview.opCount).toBe(15);
    expect(preview.warnings.join(' ')).toContain('mình chỉ chia 15 việc gấp nhất');
    expect(preview.warnings.join(' ')).toContain('còn lại');
  });

  it('câu KHÔNG nói "chưa có người" / không có động từ chia-giao → từ chối; cột mới tạo cùng lệnh → từ chối', async () => {
    const f = await seedWorld();
    const wrong = await ask(f, f.owner.id, 'Chia việc cho cả nhóm trong cột Cần làm', [splitOp()]);
    expect(wrong.reply.answer.action).toBeUndefined();
    expect(wrong.reply.answer.text).toContain('chưa thấy câu của bạn yêu cầu');
    const fresh = await ask(f, f.owner.id, 'Tạo cột Kiểm thử rồi chia các việc chưa có người trong cột Kiểm thử cho nhóm', [{ type: 'CREATE_LIST', key: 'k', name: 'Kiểm thử' }, { type: 'ASSIGN_UNASSIGNED', list: { by: 'PLAN', key: 'k' } }]);
    expect(fresh.reply.answer.text).toContain('chưa có việc nào để chia');
    expect(await prisma.list.count({ where: { name: 'Kiểm thử' } })).toBe(0);
  });

  it('kế hoạch cũ: có người vừa giao tay một thẻ trong danh sách → STALE, không giao gì', async () => {
    const f = await seedWorld();
    const { reply, sessions, scope } = await ask(f, f.owner.id, SPLIT_MSG, [splitOp()]);
    await prisma.cardMember.create({ data: { cardId: f.design.id, userId: f.tuan.id } });
    expect(resultOf(await apply(f.owner.id, reply, sessions, scope)).status).toBe('STALE');
    expect((await unassignedIn(f.todo.id)).length).toBe(3);
  });

  it('giới hạn tốc độ chia việc: 10 lượt / 10 phút → RATE_LIMITED', async () => {
    const f = await seedWorld();
    for (let i = 0; i < 10; i += 1) takeAssignBudget('PLAN', f.owner.id, ACT_NOW.getTime() + 60_000);
    const { reply } = await ask(f, f.owner.id, SPLIT_MSG, [splitOp()], { now: new Date(ACT_NOW.getTime() + 60_000) });
    expect(reply.answer.text).toContain('quá nhiều lần');
    expect(await unassignedIn(f.todo.id)).toHaveLength(4);
  });

  it('mất quyền sửa giữa hai bước → FAILED/FORBIDDEN, không giao gì', async () => {
    const f = await seedWorld();
    const { reply, sessions, scope } = await ask(f, f.lan.id, SPLIT_MSG, [splitOp()]);
    await prisma.boardMember.create({ data: { boardId: f.alpha.id, userId: f.lan.id, role: 'VIEWER' } });
    expect(resultOf(await apply(f.lan.id, reply, sessions, scope))).toMatchObject({ status: 'FAILED', error: { code: 'FORBIDDEN' } });
    expect(await unassignedIn(f.todo.id)).toHaveLength(4);
  });
});
