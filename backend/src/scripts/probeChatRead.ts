// Thu voi Gemini that cho CONG CU DOC (Phase 4): voi cau hoi mau ve tien do / chi tiet / cot / nhan / truong tuy chinh, vong DAU TIEN mo hinh co
// chon dung cong cu khong (hoac buoc resolve_entities can thiet truoc do)? Khong dung CSDL, khong ghi gi: chi goi mo hinh mot vong voi dung prompt
// + dung bo cong cu doc cua chat.v2.service (khong co cong cu ghi).
//
// Phan hai (--comments): sau khi co ket qua get_board_overview, mo hinh co viet nhan xet ngan (finish.comment) vuot qua bo kiem cua server khong?
//
// Chay:  npx tsx src/scripts/probeChatRead.ts [--delay=5000] [--out=duong/dan.json] [--only=route|comments]
import { writeFileSync } from 'node:fs';
import { env } from '../config/env';
import { vnToday } from '../modules/chat/chat.period';
import { callChatModel, v2LlmAvailable, type ModelMessage } from '../modules/chat/v2/chat.v2.llm';
import { numbersIn, systemPrompt } from '../modules/chat/v2/chat.v2.orchestrator';
import { validateComment } from '../modules/chat/chat.summary';

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const DELAY = Number(args.get('delay') ?? 5000);
const ONLY = args.get('only');
const CASE_IDS = (args.get('case') ?? '').split(',').filter(Boolean);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NOW = new Date('2026-10-07T03:00:00.000Z');

interface Call { name: string; arguments: Record<string, unknown> }
interface Case {
  id: string;
  question: string;
  /** Mot cach dung = mot ham nhan cac lenh goi o vong dau va tra true. */
  ok: (calls: Call[]) => boolean;
}
const has = (calls: Call[], name: string, test: (a: Record<string, unknown>) => boolean = () => true) => calls.some((c) => c.name === name && test(c.arguments));
const filtersOf = (a: Record<string, unknown>) => (a.filters ?? {}) as Record<string, unknown>;

const CASES: readonly Case[] = [
  { id: 'my-open-count', question: 'Tôi còn bao nhiêu task?', ok: (c) => has(c, 'query_tasks') || has(c, 'aggregate_tasks') },
  { id: 'overdue', question: 'Task nào đang quá hạn?', ok: (c) => has(c, 'query_tasks', (a) => filtersOf(a).overdue === true) },
  { id: 'this-week', question: 'Tuần này tôi phải làm gì?', ok: (c) => has(c, 'query_tasks') },
  { id: 'workload', question: 'Ai đang giữ nhiều việc nhất?', ok: (c) => has(c, 'aggregate_tasks', (a) => a.groupBy === 'ASSIGNEE') },
  { id: 'member-tasks', question: 'Lan đang làm những task nào?', ok: (c) => has(c, 'resolve_entities', (a) => a.kind === 'MEMBER') },
  { id: 'blocked', question: 'Task nào đang bị blocked?', ok: (c) => has(c, 'query_tasks', (a) => Array.isArray(filtersOf(a).statuses) && (filtersOf(a).statuses as string[]).includes('BLOCKED')) },
  { id: 'changes', question: 'Tuần này board thay đổi những gì?', ok: (c) => has(c, 'query_activities') },
  { id: 'who-moved', question: 'Ai vừa chuyển task Login sang Done?', ok: (c) => has(c, 'resolve_entities', (a) => a.kind === 'CARD') },
  { id: 'progress', question: 'Board này tiến độ bao nhiêu?', ok: (c) => has(c, 'get_board_overview') || has(c, 'aggregate_tasks', (a) => filtersOf(a).completion === 'ALL') },
  { id: 'summary', question: 'Tóm tắt tiến độ board tuần này.', ok: (c) => has(c, 'get_board_overview') },
  { id: 'card-status', question: 'Task Login đang thế nào?', ok: (c) => has(c, 'resolve_entities', (a) => a.kind === 'CARD') },
  { id: 'lists', question: 'Bảng này có những cột nào?', ok: (c) => has(c, 'query_catalog', (a) => a.kind === 'LISTS') || has(c, 'get_board_overview') },
  { id: 'labels', question: 'Có những nhãn nào trong bảng?', ok: (c) => has(c, 'query_catalog', (a) => a.kind === 'LABELS') },
  { id: 'fields', question: 'Bảng có những trường tùy chỉnh nào?', ok: (c) => has(c, 'query_catalog', (a) => a.kind === 'CUSTOM_FIELDS') },
  { id: 'priority-high', question: 'Có bao nhiêu việc ưu tiên Cao?', ok: (c) => has(c, 'resolve_entities', (a) => a.kind === 'FIELD_OPTION' || a.kind === 'CUSTOM_FIELD') || has(c, 'query_catalog', (a) => a.kind === 'CUSTOM_FIELDS') },
  { id: 'who-best', question: 'Ai phù hợp nhất để làm task Login UI?', ok: (c) => has(c, 'resolve_entities', (a) => a.kind === 'CARD') },
  { id: 'percent-done', question: 'Bao nhiêu phần trăm việc đã xong?', ok: (c) => has(c, 'get_board_overview') || has(c, 'aggregate_tasks', (a) => filtersOf(a).completion === 'ALL') },
];

const OVERVIEW = {
  board: { id: 'b1', name: 'Dự án Alpha' }, totalCards: 7, openCards: 6, doneCards: 1, donePercent: 14, overdueCards: 1, blockedCards: 0, unassignedOpenCards: 5,
  listCount: 3, labelCount: 2, memberCount: 3, customFieldCount: 1,
  lists: [
    { id: 'l1', name: 'Cần làm', status: 'TODO', totalCards: 5, openCards: 4, doneCards: 1 },
    { id: 'l2', name: 'Đang làm', status: 'IN_PROGRESS', totalCards: 2, openCards: 2, doneCards: 0 },
    { id: 'l3', name: 'Hoàn thành', status: 'DONE', totalCards: 0, openCards: 0, doneCards: 0 },
  ],
};
const COMMENT_QUESTIONS = ['Tóm tắt tiến độ bảng này và nhận xét ngắn', 'Board này tiến độ bao nhiêu? Cho tôi nhận xét.', 'Đánh giá nhanh tình hình bảng này giúp tôi', 'Tình hình bảng thế nào, có gì đáng lo không?'];

/** Vong 2: da co ket qua tong quan -> mo hinh finish + comment; comment phai qua validateComment voi tap so cua ket qua. */
async function commentProbe(): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  const sourceId = '11111111-1111-4111-8111-111111111111';
  const result = { tool: 'get_board_overview', source: { id: sourceId, generatedAt: NOW.toISOString(), scopeLabel: 'Dự án Alpha' }, data: OVERVIEW };
  const allowed = numbersIn(OVERVIEW);
  for (const question of COMMENT_QUESTIONS) {
    const messages: ModelMessage[] = [
      { role: 'system', content: systemPrompt(false) },
      { role: 'user', content: JSON.stringify({ question, now: NOW.toISOString(), todayVietnam: vnToday(NOW), selfId: 'u1', uiScope: { kind: 'BOARD', boardId: 'b1' }, conversationScope: { kind: 'BOARD', boardId: 'b1' }, selectedEntities: [{ kind: 'BOARD', id: 'b1', name: 'Dự án Alpha' }] }) },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_board_overview', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: JSON.stringify(result) },
    ];
    const res = await callChatModel(messages, 30_000, env.ai, false);
    const finish = res.ok ? res.calls.find((c) => c.name === 'finish') : undefined;
    const comment = (finish?.arguments as { comment?: unknown } | undefined)?.comment;
    if (!res.ok) rows.push({ question, llmFailed: true });
    else if (typeof comment !== 'string') rows.push({ question, finished: finish !== undefined, comment: null });
    else {
      const check = validateComment({ comment }, allowed, [{ userId: 'u1', name: 'Nguyễn Lan' }, { userId: 'u2', name: 'Trần Tuấn' }, { userId: 'u3', name: 'Chủ Bảng' }]);
      rows.push({ question, finished: true, comment, accepted: check.ok, reason: check.ok ? null : check.reason });
    }
    await sleep(DELAY);
  }
  return rows;
}

async function main() {
  if (!v2LlmAvailable()) {
    console.error('Chua cau hinh AI_BASE_URL / AI_API_KEY / AI_MODEL: khong thu Gemini that duoc.');
    process.exitCode = 1;
    return;
  }
  const rows: Array<Record<string, unknown>> = [];
  for (const c of ONLY === 'comments' ? [] : CASES.filter((x) => CASE_IDS.length === 0 || CASE_IDS.includes(x.id))) {
    const messages: ModelMessage[] = [
      { role: 'system', content: systemPrompt(false) },
      { role: 'user', content: JSON.stringify({ question: c.question, now: NOW.toISOString(), todayVietnam: vnToday(NOW), selfId: 'u1', uiScope: { kind: 'BOARD', boardId: 'b1' }, conversationScope: { kind: 'BOARD', boardId: 'b1' }, selectedEntities: [{ kind: 'BOARD', id: 'b1', name: 'Dự án Alpha' }] }) },
    ];
    const res = await callChatModel(messages, 30_000, env.ai, false);
    const calls: Call[] = res.ok ? res.calls.map((x) => ({ name: x.name, arguments: (x.arguments ?? {}) as Record<string, unknown> })) : [];
    const ok = res.ok && c.ok(calls);
    rows.push({ id: c.id, question: c.question, ok, llmFailed: !res.ok, ...(res.ok ? {} : { llmReason: res.reason }), calls: calls.map((x) => `${x.name}${x.arguments.kind ? `:${String(x.arguments.kind)}` : ''}`) });
    await sleep(DELAY);
  }
  const answered = rows.filter((r) => !r.llmFailed);
  const good = rows.filter((r) => r.ok).length;
  console.log(`READ ${good}/${rows.length} (bo qua ${rows.length - answered.length} ca loi nha cung cap)`);
  for (const r of rows) console.log(`  ${r.ok ? 'OK ' : r.llmFailed ? '?? ' : 'XX '} ${String(r.id).padEnd(14)} ${(r.calls as string[]).join(', ')}${r.llmReason ? ` [${String(r.llmReason)}]` : ''}`);
  let comments: Array<Record<string, unknown>> = [];
  if (ONLY !== 'route') {
    comments = await commentProbe();
    const answered = comments.filter((r) => !r.llmFailed);
    const withComment = answered.filter((r) => typeof r.comment === 'string');
    const accepted = withComment.filter((r) => r.accepted === true).length;
    console.log(`COMMENTS: ${withComment.length}/${answered.length} cau co nhan xet, ${accepted} qua bo kiem`);
    for (const r of comments) console.log(`  ${r.accepted === true ? 'OK ' : r.llmFailed ? '?? ' : r.comment === null ? '-- ' : 'XX '} ${String(r.question).slice(0, 44).padEnd(44)} ${JSON.stringify(r.comment ?? r.reason ?? null)}`);
  }
  const out = args.get('out');
  if (out) writeFileSync(out, JSON.stringify({ model: env.ai.model, correct: good, total: rows.length, rows, comments }, null, 2));
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : 'loi');
  process.exitCode = 1;
});
