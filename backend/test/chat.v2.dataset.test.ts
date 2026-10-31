import { describe, expect, it } from 'vitest';
import { CHAT_V2_EVAL_CASES } from '../src/scripts/chatV2EvalDataset';
import { executeChatTool } from '../src/modules/chat/v2/chat.v2.tools';
import { seedChatV2, V2_NOW } from './chat.v2.fixture';

describe('chatbot v2 frozen dataset: gold tool plans before AI implementation', () => {
  it('keeps dev/test questions disjoint and runs labeled plans against independently seeded data', async () => {
    const w = await seedChatV2();
    const ctx = { userId: w.owner.id, now: V2_NOW, scope: { kind: 'BOARD' as const, boardId: w.board.id } };
    const ids = CHAT_V2_EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const dev = new Set(CHAT_V2_EVAL_CASES.filter((c) => c.split === 'dev').map((c) => c.question));
    expect(CHAT_V2_EVAL_CASES.filter((c) => c.split === 'test').every((c) => !dev.has(c.question))).toBe(true);
    for (const c of CHAT_V2_EVAL_CASES) {
      expect(c.plans.length).toBe(c.expected.length);
      for (let i = 0; i < c.plans.length; i++) {
        const input = JSON.parse(JSON.stringify(c.plans[i].input).replaceAll('$LAN', w.lan.id).replaceAll('$TUAN', w.tuan.id));
        const output = await executeChatTool(ctx, c.plans[i].tool, input);
        expect(output.data, c.id).toMatchObject(c.expected[i]);
      }
    }
  });
});
