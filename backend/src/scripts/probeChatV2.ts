// Explicit live probe. Sends only synthetic tool results; never reads the database.
import { callChatModel, type ModelMessage } from '../modules/chat/v2/chat.v2.llm';

async function main() {
  if (!process.argv.includes('--live')) throw new Error('Use --live to authorize an actual provider request');
  const messages: ModelMessage[] = [
    { role: 'system', content: 'Capability probe only. First call resolve_entities with kind BOARD and text demo. After its result call query_tasks and aggregate_tasks (groupBy ASSIGNEE) in the SAME turn using provided scope. After both results call finish referencing their source IDs.' },
    { role: 'user', content: 'Probe with mock results only.' },
  ];
  for (let round = 0; round < 3; round++) {
    const r = await callChatModel(messages, 20_000, undefined, false);
    console.log(JSON.stringify({ round, ok: r.ok, ...(r.ok ? { adapter: r.adapter, tools: r.calls.map((c) => c.name), usage: r.usage } : { reason: r.reason }) }));
    if (!r.ok) { process.exitCode = 1; return; }
    messages.push(r.message);
    for (const c of r.calls) {
      const id = c.name === 'query_tasks' ? '11111111-1111-4111-8111-111111111111' : '22222222-2222-4222-8222-222222222222';
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(c.name === 'resolve_entities'
        ? { status: 'RESOLVED', scope: { kind: 'BOARD', boardId: 'probe-board' } }
        : { source: { id }, total: 0, cards: [], rows: [] }) });
    }
  }
}
void main().catch(() => { console.error('Probe failed'); process.exitCode = 1; });
