// Opt-in smoke check against Gemini using synthetic data in the LOCAL TEST database only.
// Not included in vitest. No production records, questions, keys or cookies are printed.
import { readFileSync, writeFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { loadAndAssertTestDatabaseUrl } from './dbSafety';

async function main() {
  if (!process.argv.includes('--live')) throw new Error('Use --live for provider requests');
  const ai = parse(readFileSync('.env', 'utf8'));
  loadAndAssertTestDatabaseUrl();
  for (const key of ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL', 'AI_TIMEOUT_MS']) if (ai[key]) process.env[key] = ai[key];
  const { V2_NOW } = await import('./chat.v2.fixture');
  const { prisma } = await import('../src/config/prisma');
  const { handleV2Message } = await import('../src/modules/chat/v2/chat.v2.service');
  const { V2SessionStore } = await import('../src/modules/chat/v2/chat.v2.session');
  const { callChatModel } = await import('../src/modules/chat/v2/chat.v2.llm');
  const numeric = await prisma.board.findUniqueOrThrow({ where: { id: '1234' } });
  const board = await prisma.board.findFirstOrThrow({ where: { ownerId: numeric.ownerId, name: '1234', deletedAt: null } });
  const lan = await prisma.user.findFirstOrThrow({ where: { name: 'Nguyễn Lan', workspaceMembers: { some: { workspaceId: board.workspaceId } } } });
  const tuan = await prisma.user.findFirstOrThrow({ where: { name: 'Trần Tuấn', workspaceMembers: { some: { workspaceId: board.workspaceId } } } });
  const fixture = { owner: { id: board.ownerId }, board, lan, tuan };
  const requests = [
    { name: 'assigned-unassigned', question: 'trong bảng 1234 công việc nào đã được phân công và những công việc nào chưa được phân công' },
    { name: 'workload-unassigned', question: 'Trong bảng 1234 ai đang có số lượng công việc lớn hơn và những công việc nào chưa được chia cho các thành viên?' },
    { name: 'changes-needs-time', question: 'Trong bảng 1234 công việc nào đã được thay đổi?' },
    { name: 'changes-week', question: 'Trong bảng 1234 công việc nào đã thay đổi tuần này?' },
  ];
  const report: unknown[] = [];
  try {
    for (const item of requests) {
      const turns: unknown[] = [];
      const step: typeof callChatModel = async (messages, timeout) => {
        const r = await callChatModel(messages, timeout, undefined, false);
        turns.push(r.ok ? { adapter: r.adapter, calls: r.calls.map((c) => ({ name: c.name, arguments: c.arguments })), usage: r.usage } : { reason: r.reason });
        return r;
      };
      const started = Date.now();
      const reply = await handleV2Message(fixture.owner.id, { message: item.question, scope: { kind: 'MY' } }, { now: V2_NOW, sessions: new V2SessionStore(), available: true, step });
      const entry = { name: item.name, mode: reply.mode, kind: reply.answer.kind, elapsedMs: Date.now() - started,
        blocks: reply.answer.blocks?.map((b) => b.status !== 'OK' ? { status: b.status } : { tool: b.tool, correctBoard: b.source.scope.kind === 'BOARD' && b.source.scope.boardId === fixture.board.id, total: b.data.total,
          ...(b.tool === 'aggregate_tasks' ? { leadersCorrect: b.data.leaderIds.length === 2 && b.data.leaderIds.includes(fixture.lan.id) && b.data.leaderIds.includes(fixture.tuan.id), highestCount: b.data.highestCount, totalCards: b.data.totalCards } : {}),
          ...(b.tool === 'query_activities' ? { eventCount: b.data.eventCount, changedCardCount: b.data.changedCardCount } : {}),
        }), turns };
      report.push(entry); console.log(JSON.stringify(entry));
    }
    writeFileSync('eval-chat-v2-smoke.json', JSON.stringify({ time: new Date().toISOString(), samplesPerQuestion: 1, syntheticData: true, report }, null, 2));
  } finally { await prisma.$disconnect(); }
}
void main().catch(() => { console.error('Live smoke failed'); process.exitCode = 1; });
