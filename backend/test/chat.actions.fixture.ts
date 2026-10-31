// Dữ liệu thế giới cho test lớp HÀNH ĐỘNG của chatbot v2 (CHATBOT_V2_ACTIONS_PLAN.md).
//
// ACT_NOW = Thứ Tư 07/10/2026 10:00 giờ Việt Nam: "thứ sáu" = 09/10, "ngày mai" = 08/10, "cuối tuần" = Chủ nhật 11/10.
// Hai bảng cùng chứa thẻ tên "Login ..." (Alpha, Beta) để chứng minh trần phạm vi: ở trang bảng Alpha, "Login" không bao giờ khớp thẻ của Beta.
import { vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import { makeDirectUser } from './helpers';
import { V2SessionStore } from '../src/modules/chat/v2/chat.v2.session';
import type { ModelMessage, ModelResult, ModelStep } from '../src/modules/chat/v2/chat.v2.llm';
import type { PatchPlanner } from '../src/modules/chat/v2/actions/actions.patch.context';

export const ACT_NOW = new Date('2026-10-07T03:00:00.000Z');
export const minutesAfter = (m: number) => new Date(ACT_NOW.getTime() + m * 60_000);

export async function seedActions() {
  const owner = await makeDirectUser('Chủ Bảng');
  const lan = await makeDirectUser('Nguyễn Lan');
  const tuan = await makeDirectUser('Trần Tuấn');
  const viewer = await makeDirectUser('Người Xem');
  const outsider = await makeDirectUser('Người Ngoài');
  const ws = await prisma.workspace.create({
    data: {
      name: 'Nhóm hành động',
      ownerId: owner.id,
      members: {
        create: [
          { userId: owner.id, role: 'OWNER' },
          ...[lan, tuan, viewer].map((u) => ({ userId: u.id, role: 'MEMBER' as const })),
        ],
      },
    },
  });
  const alpha = await prisma.board.create({
    data: {
      name: 'Dự án Alpha',
      workspaceId: ws.id,
      ownerId: owner.id,
      visibility: 'WORKSPACE',
      // viewer là thành viên không gian NHƯNG bị hạ xuống VIEWER ở riêng bảng này (quyền ở bảng thắng quyền không gian)
      members: { create: [{ userId: viewer.id, role: 'VIEWER' }] },
      lists: {
        create: [
          { name: 'Cần làm', position: 0, status: 'TODO' },
          { name: 'Đang làm', position: 1, status: 'IN_PROGRESS' },
          { name: 'Hoàn thành', position: 2, status: 'DONE' },
        ],
      },
    },
    include: { lists: { orderBy: { position: 'asc' } } },
  });
  const [todo, doing, done] = alpha.lists;
  const card = (listId: string, title: string, extra: Record<string, unknown> = {}) =>
    prisma.card.create({ data: { listId, title, ...extra } });
  const design = await card(todo.id, 'Thiết kế giao diện');
  const payment = await card(todo.id, 'API thanh toán');
  const loginUi = await card(todo.id, 'Login UI');
  const loginApi = await card(doing.id, 'Login API');
  const report = await card(doing.id, 'Báo cáo tuần', { dueDate: new Date('2026-10-09T16:59:00.000Z') });
  const backend = await prisma.label.create({ data: { boardId: alpha.id, name: 'Backend', color: '#0079BF' } });
  const urgent = await prisma.label.create({ data: { boardId: alpha.id, name: 'Gấp', color: '#EB5A46' } });

  // bảng thứ hai của cùng chủ: cùng tên thẻ "Login Beta", chỉ owner + lan
  const beta = await prisma.board.create({
    data: {
      name: 'Dự án Beta',
      workspaceId: ws.id,
      ownerId: owner.id,
      visibility: 'PRIVATE',
      members: { create: [{ userId: lan.id, role: 'MEMBER' }] },
      lists: { create: [{ name: 'Cần làm', position: 0, status: 'TODO' }, { name: 'Đang làm', position: 1, status: 'IN_PROGRESS' }] },
    },
    include: { lists: { orderBy: { position: 'asc' } } },
  });
  const loginBeta = await card(beta.lists[0].id, 'Login Beta');
  const betaOnly = await card(beta.lists[0].id, 'Chỉ có ở Beta');

  // bảng của người ngoài (riêng tư) và bảng công khai: chatbot không đọc, không ghi
  const secret = await prisma.board.create({
    data: { name: 'Bảng bí mật', workspaceId: outsider.personalWorkspaceId, ownerId: outsider.id, visibility: 'PRIVATE', lists: { create: { name: 'Cột bí mật' } } },
    include: { lists: true },
  });
  const secretCard = await card(secret.lists[0].id, 'Thẻ bí mật');
  const publicBoard = await prisma.board.create({
    data: { name: 'Bảng công khai', workspaceId: outsider.personalWorkspaceId, ownerId: outsider.id, visibility: 'PUBLIC', lists: { create: { name: 'Công khai' } } },
    include: { lists: true },
  });
  const publicCard = await card(publicBoard.lists[0].id, 'Thẻ công khai');

  return {
    owner, lan, tuan, viewer, outsider, ws, alpha, beta, secret, publicBoard,
    todo, doing, done, betaTodo: beta.lists[0], betaDoing: beta.lists[1],
    design, payment, loginUi, loginApi, report, loginBeta, betaOnly, secretCard, publicCard, backend, urgent,
  };
}
export type ActionWorld = Awaited<ReturnType<typeof seedActions>>;

type Call = { name: string; arguments: unknown };
/** LLM giả: mỗi lượt trả các lệnh gọi công cụ cho sẵn (hoặc suy ra từ transcript). Hết kịch bản -> lỗi như khi LLM hỏng. */
export function script(steps: Array<Call[] | ((messages: ModelMessage[]) => Call[])>): ModelStep {
  let round = 0;
  return vi.fn(async (messages: ModelMessage[]): Promise<ModelResult> => {
    const action = steps[round++];
    if (!action) return { ok: false, reason: 'INVALID' };
    const calls = (typeof action === 'function' ? action(messages) : action).map((c, i) => ({ ...c, id: `call-${round}-${i}` }));
    return {
      ok: true,
      calls,
      adapter: 'NATIVE',
      usage: { input: 11, output: 7 },
      message: { role: 'assistant', content: null, tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) },
    };
  });
}

// --- Cách viết đề xuất tượng trưng gọn trong test ---
export const text = (t: string) => ({ by: 'TEXT' as const, text: t });
export const propose = (...operations: unknown[]): Call[] => [{ name: 'propose_actions', arguments: { operations } }];
export const lastCard = { by: 'CONTEXT' as const, slot: 'LAST_CARD' as const };

export interface ActionContextOptions {
  step?: ModelStep;
  now?: Date;
  autoExecute?: boolean;
  actions?: boolean;
  available?: boolean;
  sessions?: V2SessionStore;
  /** Bo lap ke hoach Board Patch gia (mac dinh khong tiem: se goi LLM that neu co cau hinh). */
  patchPlanner?: PatchPlanner;
}
export function actionContext(opts: ActionContextOptions = {}) {
  return {
    now: opts.now ?? ACT_NOW,
    sessions: opts.sessions ?? new V2SessionStore(),
    available: opts.available ?? !!opts.step,
    actions: opts.actions ?? true,
    autoExecute: opts.autoExecute ?? true,
    ...(opts.step ? { step: opts.step } : {}),
    ...(opts.patchPlanner ? { patchPlanner: opts.patchPlanner } : {}),
  };
}
