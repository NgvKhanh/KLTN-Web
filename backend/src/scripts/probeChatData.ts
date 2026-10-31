// Thu voi Gemini that cho cong cu DOC TONG QUAT `query_data` (buoc B) va doan tra loi tu do `finish.answer` (buoc C). Khong dung CSDL, khong ghi gi:
// chi goi mo hinh voi dung prompt + dung bo cong cu doc cua chat.v2.service.
//
//   --only=route    : cau hoi ve NOI DUNG / dem / nhom -> vong DAU TIEN mo hinh co chon query_data (hoac resolve_entities can thiet) khong?
//   --only=answer   : sau khi co ket qua query_data (du lieu mau), mo hinh co viet finish.answer VUOT bo kiem (answer.check) khong?
//
// Chay:  npx tsx src/scripts/probeChatData.ts [--delay=5000] [--only=route|answer] [--out=duong/dan.json]
import { writeFileSync } from 'node:fs';
import { env } from '../config/env';
import { vnToday } from '../modules/chat/chat.period';
import { callChatModel, v2LlmAvailable, type ModelMessage } from '../modules/chat/v2/chat.v2.llm';
import { systemPrompt } from '../modules/chat/v2/chat.v2.orchestrator';
import { collectFacts, validateAnswer } from '../modules/chat/v2/answer/answer.check';

const args = new Map(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=') as [string, string]));
const DELAY = Number(args.get('delay') ?? 5000);
const ONLY = args.get('only');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NOW = new Date('2026-10-07T03:00:00.000Z');

interface Call { name: string; arguments: Record<string, unknown> }
const has = (calls: Call[], name: string, test: (a: Record<string, unknown>) => boolean = () => true) => calls.some((c) => c.name === name && test(c.arguments));
const dataOf = (a: Record<string, unknown>) => String(a.entity ?? '');

const ROUTE: ReadonlyArray<{ id: string; question: string; ok: (c: Call[]) => boolean }> = [
  { id: 'comment-search', question: 'Có bình luận nào nhắc tới thanh toán không?', ok: (c) => has(c, 'query_data', (a) => dataOf(a) === 'COMMENT') },
  { id: 'comment-by-person', question: 'Ai viết nhiều bình luận nhất?', ok: (c) => has(c, 'query_data', (a) => dataOf(a) === 'COMMENT' && a.groupBy === 'authorId') },
  { id: 'card-most-comments', question: 'Thẻ nào có nhiều bình luận nhất?', ok: (c) => has(c, 'query_data', (a) => dataOf(a) === 'COMMENT' && a.groupBy === 'cardId') },
  { id: 'description-search', question: 'Việc nào có mô tả nhắc đến đăng nhập?', ok: (c) => has(c, 'query_data', (a) => dataOf(a) === 'CARD') || has(c, 'query_tasks') },
  { id: 'checklist-open', question: 'Còn mục checklist nào chưa xong?', ok: (c) => has(c, 'query_data', (a) => dataOf(a) === 'CHECKLIST_ITEM') },
  { id: 'attachments', question: 'Có những tệp PDF nào được đính kèm?', ok: (c) => has(c, 'query_data', (a) => dataOf(a) === 'ATTACHMENT') },
  { id: 'created-per-day', question: 'Tuần này mỗi ngày tạo bao nhiêu thẻ?', ok: (c) => has(c, 'query_data', (a) => dataOf(a) === 'CARD' && a.groupBy === 'createdAt') || has(c, 'aggregate_tasks', (a) => a.groupBy === 'DATE') },
  { id: 'cards-no-comment', question: 'Thẻ nào chưa có bình luận nào?', ok: (c) => has(c, 'query_data', (a) => dataOf(a) === 'CARD') },
  { id: 'recent-comments', question: 'Bình luận mới nhất là gì?', ok: (c) => has(c, 'query_data', (a) => dataOf(a) === 'COMMENT') },
  // phai van chon cong cu CHUYEN BIET khi du dung
  { id: 'prefer-tasks', question: 'Việc nào của tôi quá hạn?', ok: (c) => has(c, 'query_tasks') && !has(c, 'query_data') },
  { id: 'prefer-overview', question: 'Board này tiến độ bao nhiêu?', ok: (c) => has(c, 'get_board_overview') || has(c, 'aggregate_tasks') },
];

const GROUPS_SAMPLE = {
  entity: 'COMMENT', mode: 'GROUPS', total: 2, page: 1, pageSize: 20, hasMore: false, matched: 3, columns: [], rows: [],
  groups: [{ id: 'u1', label: 'Trần Tuấn', count: 2 }, { id: 'u2', label: 'Nguyễn Lan', count: 1 }],
  groupBy: 'authorId', groupLabel: 'Người viết', bucket: null, highestCount: 2, topGroups: 1,
};
const SAMPLE = {
  entity: 'COMMENT', mode: 'ROWS', total: 3, page: 1, pageSize: 20, hasMore: false, matched: 3,
  columns: [{ key: 'text', label: 'Nội dung', type: 'text' }, { key: 'authorName', label: 'Người viết', type: 'text' }, { key: 'cardTitle', label: 'Thẻ', type: 'text' }, { key: 'createdAt', label: 'Lúc viết', type: 'date' }],
  rows: [
    { id: 'r1', cardId: 'c1', boardId: 'b1', cells: { text: 'Lỗi thanh toán khi thẻ hết hạn', authorName: 'Trần Tuấn', cardTitle: 'API thanh toán', createdAt: '2026-10-07T01:00:00.000Z' } },
    { id: 'r2', cardId: 'c1', boardId: 'b1', cells: { text: 'Đã sửa xong lỗi thanh toán', authorName: 'Trần Tuấn', cardTitle: 'API thanh toán', createdAt: '2026-10-07T02:00:00.000Z' } },
    { id: 'r3', cardId: 'c2', boardId: 'b1', cells: { text: 'Màu chủ đạo cần đổi', authorName: 'Nguyễn Lan', cardTitle: 'Thiết kế giao diện', createdAt: '2026-10-06T03:00:00.000Z' } },
  ],
  groups: [], groupBy: null, groupLabel: null, bucket: null, highestCount: 0, topGroups: 0,
};
/** Mỗi ca = câu hỏi + công cụ mô hình ĐÃ gọi (tham số) + kết quả dữ liệu mẫu tương ứng. */
const ANSWER_CASES: ReadonlyArray<{ question: string; args: Record<string, unknown>; data: typeof SAMPLE | typeof GROUPS_SAMPLE }> = [
  { question: 'Ai viết nhiều bình luận nhất?', args: { entity: 'COMMENT', groupBy: 'authorId' }, data: GROUPS_SAMPLE },
  { question: 'Mỗi người viết bao nhiêu bình luận?', args: { entity: 'COMMENT', groupBy: 'authorId' }, data: GROUPS_SAMPLE },
  { question: 'Tóm tắt các bình luận gần đây giúp tôi', args: { entity: 'COMMENT', fields: ['text', 'authorName', 'cardTitle', 'createdAt'] }, data: SAMPLE },
  { question: 'Có bình luận nào về thanh toán không, ai viết?', args: { entity: 'COMMENT', search: 'thanh toán', fields: ['text', 'authorName', 'cardTitle'] }, data: SAMPLE },
  { question: 'Thẻ nào được bình luận gần đây nhất?', args: { entity: 'COMMENT', fields: ['cardTitle', 'createdAt'], orderBy: [{ field: 'createdAt', dir: 'DESC' }] }, data: SAMPLE },
];

const userMessage = (question: string) => JSON.stringify({ question, now: NOW.toISOString(), todayVietnam: vnToday(NOW), selfId: 'u1', uiScope: { kind: 'BOARD', boardId: 'b1' }, conversationScope: { kind: 'BOARD', boardId: 'b1' }, selectedEntities: [{ kind: 'BOARD', id: 'b1', name: 'Dự án Alpha' }] });

async function routeProbe(): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const c of ROUTE) {
    const res = await callChatModel([{ role: 'system', content: systemPrompt(false) }, { role: 'user', content: userMessage(c.question) }], 30_000, env.ai, false);
    if (!res.ok) rows.push({ id: c.id, llmFailed: res.reason });
    else rows.push({ id: c.id, ok: c.ok(res.calls as Call[]), calls: res.calls.map((x) => `${x.name}(${JSON.stringify(x.arguments).slice(0, 140)})`) });
    await sleep(DELAY);
  }
  return rows;
}

/** Mô phỏng ĐÚNG luồng điều phối: lượt 1 → kiểm → nếu sai thì gửi ANSWER_REJECTED và cho viết lại MỘT lần (lượt 2) → kiểm lại. */
async function answerProbe(): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  const sourceId = '22222222-2222-4222-8222-222222222222';
  for (const c of ANSWER_CASES) {
    const result = { tool: 'query_data', source: { id: sourceId, generatedAt: NOW.toISOString(), scopeLabel: 'Dự án Alpha', scope: { kind: 'BOARD', boardId: 'b1' }, appliedInput: c.args, ranges: [] }, data: c.data };
    const facts = collectFacts([{ data: c.data, scope: 'Dự án Alpha', ranges: [] }, { now: NOW.toISOString() }], [c.question, vnToday(NOW)]);
    const messages: ModelMessage[] = [
      { role: 'system', content: systemPrompt(false) },
      { role: 'user', content: userMessage(c.question) },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'query_data', arguments: JSON.stringify(c.args) } }] },
      { role: 'tool', tool_call_id: 'c1', content: JSON.stringify(result) },
    ];
    const row: Record<string, unknown> = { question: c.question };
    for (const attempt of [1, 2]) {
      const res = await callChatModel(messages, 30_000, env.ai, false);
      await sleep(DELAY);
      if (!res.ok) { row.llmFailed = res.reason; break; }
      const finish = res.calls.find((x) => x.name === 'finish');
      const answer = (finish?.arguments as { answer?: unknown } | undefined)?.answer;
      if (finish === undefined || typeof answer !== 'string') { row.answer = null; row.calls = res.calls.map((x) => x.name); break; }
      const check = validateAnswer(answer, facts);
      row[`answer${attempt}`] = answer;
      if (check.ok) { row.passed = true; row.attempts = attempt; break; }
      row[`reject${attempt}`] = `${check.reason}: ${check.detail}`;
      row.passed = false;
      messages.push(res.message, { role: 'tool', tool_call_id: finish.id, content: JSON.stringify({ error: 'ANSWER_REJECTED', reason: check.reason, detail: check.detail, instruction: 'Gọi lại finish với answer đã sửa đúng lý do trên, hoặc bỏ answer (các khối dữ liệu vẫn được hiển thị).' }) });
    }
    rows.push(row);
  }
  return rows;
}

async function main() {
  if (!v2LlmAvailable()) { console.error('Chua cau hinh AI (AI_BASE_URL / AI_API_KEY / AI_MODEL).'); process.exit(1); }
  const out: Record<string, unknown> = { model: env.ai.model, at: new Date().toISOString() };
  if (ONLY === undefined || ONLY === 'route') {
    const rows = await routeProbe();
    const answered = rows.filter((r) => r.llmFailed === undefined);
    out.route = { rows, passed: answered.filter((r) => r.ok === true).length, answered: answered.length, llmFailed: rows.length - answered.length };
    console.log(`route: ${(out.route as { passed: number }).passed}/${answered.length} dung (loi nha cung cap: ${rows.length - answered.length})`);
    for (const r of rows) console.log(' ', r.llmFailed !== undefined ? 'LLM-LOI' : r.ok ? 'OK ' : 'SAI', r.id, JSON.stringify(r.calls ?? r.llmFailed));
  }
  if (ONLY === undefined || ONLY === 'answer') {
    const rows = await answerProbe();
    const answered = rows.filter((r) => r.llmFailed === undefined);
    out.answer = { rows, passedCheck: rows.filter((r) => r.passed === true).length, answered: rows.filter((r) => r.llmFailed === undefined && (r.answer1 !== undefined || r.answer !== undefined)).length };
    console.log(`answer: ${(out.answer as { passedCheck: number }).passedCheck}/${answered.length} qua bo kiem`);
    for (const r of rows) console.log(' ', r.llmFailed !== undefined ? 'LLM-LOI' : r.passed === true ? `QUA (lượt ${String(r.attempts)})` : 'TRUOT', JSON.stringify(r.question), JSON.stringify(r.answer2 ?? r.answer1 ?? r.answer ?? null), r.reject1 ? `| lượt 1 bị loại: ${String(r.reject1)}` : '', r.reject2 ? `| lượt 2 bị loại: ${String(r.reject2)}` : '');
  }
  const file = args.get('out');
  if (file) writeFileSync(file, JSON.stringify(out, null, 2));
}
void main();
