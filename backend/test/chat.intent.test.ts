// Hop dong y dinh + tham so cua chatbot (CHATBOT_MODULE.md §4, §5.2).
import { describe, expect, it } from 'vitest';
import {
  ANSWER_INTENTS,
  CATALOG_INTENTS,
  CHAT_FOCUSES,
  CHAT_INTENTS,
  CHAT_PERIODS,
  INTENT_JSON_SCHEMA,
  MAX_MEMBER_CHARS,
  isAnswerIntent,
  isCatalogIntent,
  isFuturePeriod,
  parseLlmIntent,
  resolveSlots,
  type FinalQuestion,
  type ResolvedQuery,
} from '../src/modules/chat/chat.intent';

describe('luoc do gui LLM khop voi Zod', () => {
  it('khoa, enum va rang buoc cua INTENT_JSON_SCHEMA trung hang so; khong co null / maxLength', () => {
    const s = INTENT_JSON_SCHEMA;
    expect(s.additionalProperties).toBe(false);
    expect([...s.required].sort()).toEqual(['column', 'focus', 'intent', 'member', 'period', 'target']);
    expect(Object.keys(s.properties).sort()).toEqual(['column', 'focus', 'intent', 'member', 'period', 'target']);
    expect(s.properties.intent.enum).toEqual([...CHAT_INTENTS]);
    expect(s.properties.period.enum).toEqual([...CHAT_PERIODS, 'NONE']);
    expect(s.properties.focus.enum).toEqual([...CHAT_FOCUSES, 'NONE']);
    expect(s.properties.member.type).toBe('string');
    expect([s.properties.target.type, s.properties.column.type]).toEqual(['string', 'string']);
    const text = JSON.stringify(s);
    expect(text).not.toContain('null');
    expect(text).not.toContain('maxLength');
    expect(text).not.toContain('anyOf');

    // 5 y dinh tra loi + 4 y dinh danh muc (§18) + 2 gia tri dac biet, khong trung
    expect(new Set(CHAT_INTENTS).size).toBe(CHAT_INTENTS.length);
    expect(CHAT_INTENTS.filter((i) => !isAnswerIntent(i))).toEqual([...CATALOG_INTENTS, 'UNSUPPORTED', 'NONE']);
    expect(CHAT_INTENTS.filter(isCatalogIntent)).toEqual([...CATALOG_INTENTS]);
    expect(ANSWER_INTENTS.every(isAnswerIntent)).toBe(true);
    expect(CHAT_PERIODS.filter(isFuturePeriod)).toEqual(['TOMORROW', 'NEXT_WEEK', 'NEXT_7_DAYS']);
  });

  it('parseLlmIntent: doi NONE / "" thanh null, cat khoang trang; sai hinh dang -> null, khong nem loi', () => {
    const ok = (over: Record<string, unknown> = {}) => ({
      intent: 'MEMBER_TASKS',
      period: 'THIS_WEEK',
      focus: 'DONE',
      member: 'Lan',
      ...over,
    });
    expect(parseLlmIntent(ok())).toEqual({ intent: 'MEMBER_TASKS', period: 'THIS_WEEK', focus: 'DONE', member: 'Lan' });
    expect(parseLlmIntent(ok({ period: 'NONE', focus: 'NONE', member: '' }))).toEqual({
      intent: 'MEMBER_TASKS',
      period: null,
      focus: null,
      member: null,
    });
    expect(parseLlmIntent(ok({ member: '   chị Lan  ' }))?.member).toBe('chị Lan');
    expect(parseLlmIntent(ok({ member: '   ' }))?.member).toBeNull();
    expect(parseLlmIntent(ok({ member: 'x'.repeat(MAX_MEMBER_CHARS) }))?.member).toHaveLength(MAX_MEMBER_CHARS);

    const bad: unknown[] = [
      ok({ member: 'x'.repeat(MAX_MEMBER_CHARS + 1) }),
      ok({ intent: 'DELETE_CARD' }),
      ok({ intent: 'none' }), // phan biet hoa thuong
      ok({ period: 'NEXT_MONTH' }),
      ok({ focus: null }),
      ok({ member: null }),
      ok({ extra: 1 }), // strict: khong nhan khoa la
      { intent: 'MY_TASKS', period: 'NONE', focus: 'NONE' }, // thieu member
      null,
      undefined,
      'MY_TASKS',
      [ok()],
      42,
    ];
    for (const raw of bad) expect(parseLlmIntent(raw), JSON.stringify(raw)).toBeNull();
  });
});

describe('resolveSlots - mac dinh va tham so bi bo qua (§4.4, §5.2)', () => {
  const q = (over: Partial<FinalQuestion>): FinalQuestion => ({
    intent: 'MY_TASKS',
    period: null,
    focus: null,
    memberText: null,
    memberUserId: null,
    ...over,
  });
  const r = (over: Partial<ResolvedQuery>): ResolvedQuery => ({
    intent: 'MY_TASKS',
    period: null,
    focus: null,
    ignoredSlots: [],
    ...over,
  });

  it('bang day du theo tung y dinh', () => {
    const cases: [string, FinalQuestion, ResolvedQuery][] = [
      // MY_TASKS
      ['MY_TASKS mac dinh = dang mo, khong loc ngay', q({}), r({ focus: 'OPEN' })],
      ['sap den han = OPEN + 7 ngay', q({ focus: 'OPEN', period: 'NEXT_7_DAYS' }), r({ focus: 'OPEN', period: 'NEXT_7_DAYS' })],
      ['OPEN giu ky ca qua khu', q({ period: 'LAST_WEEK' }), r({ focus: 'OPEN', period: 'LAST_WEEK' })],
      ['DONE thieu ky -> tuan nay', q({ focus: 'DONE' }), r({ focus: 'DONE', period: 'THIS_WEEK' })],
      ['DONE tuan truoc', q({ focus: 'DONE', period: 'LAST_WEEK' }), r({ focus: 'DONE', period: 'LAST_WEEK' })],
      ['DONE hom nay', q({ focus: 'DONE', period: 'TODAY' }), r({ focus: 'DONE', period: 'TODAY' })],
      [
        'DONE + ky tuong lai -> tuan nay, ghi bo qua',
        q({ focus: 'DONE', period: 'NEXT_WEEK' }),
        r({ focus: 'DONE', period: 'THIS_WEEK', ignoredSlots: ['period'] }),
      ],
      [
        'DONE + ngay mai -> tuan nay, ghi bo qua',
        q({ focus: 'DONE', period: 'TOMORROW' }),
        r({ focus: 'DONE', period: 'THIS_WEEK', ignoredSlots: ['period'] }),
      ],
      [
        'DONE + 7 ngay toi -> tuan nay, ghi bo qua',
        q({ focus: 'DONE', period: 'NEXT_7_DAYS' }),
        r({ focus: 'DONE', period: 'THIS_WEEK', ignoredSlots: ['period'] }),
      ],
      ['OVERDUE khong co ky', q({ focus: 'OVERDUE' }), r({ focus: 'OVERDUE' })],
      [
        'OVERDUE bo qua ky',
        q({ focus: 'OVERDUE', period: 'THIS_WEEK' }),
        r({ focus: 'OVERDUE', ignoredSlots: ['period'] }),
      ],
      ['BLOCKED bo qua ky', q({ focus: 'BLOCKED', period: 'TODAY' }), r({ focus: 'BLOCKED', ignoredSlots: ['period'] })],
      [
        'MY_TASKS bo qua ten nguoi',
        q({ memberText: 'Lan', focus: 'OVERDUE' }),
        r({ focus: 'OVERDUE', ignoredSlots: ['member'] }),
      ],
      // MY_PRIORITIES
      ['MY_PRIORITIES khong tham so', q({ intent: 'MY_PRIORITIES' }), r({ intent: 'MY_PRIORITIES' })],
      ['MY_PRIORITIES "hom nay" la ngam dinh', q({ intent: 'MY_PRIORITIES', period: 'TODAY' }), r({ intent: 'MY_PRIORITIES' })],
      [
        'MY_PRIORITIES bo qua ky khac + focus + ten',
        q({ intent: 'MY_PRIORITIES', period: 'NEXT_WEEK', focus: 'DONE', memberUserId: 'u1' }),
        r({ intent: 'MY_PRIORITIES', ignoredSlots: ['period', 'focus', 'member'] }),
      ],
      // MEMBER_TASKS
      [
        'MEMBER_TASKS tong quan: viec xong trong tuan nay',
        q({ intent: 'MEMBER_TASKS', memberText: 'Lan' }),
        r({ intent: 'MEMBER_TASKS', period: 'THIS_WEEK' }),
      ],
      [
        'MEMBER_TASKS tong quan tuan truoc',
        q({ intent: 'MEMBER_TASKS', memberUserId: 'u1', period: 'LAST_WEEK' }),
        r({ intent: 'MEMBER_TASKS', period: 'LAST_WEEK' }),
      ],
      [
        'MEMBER_TASKS tong quan + ky tuong lai -> tuan nay',
        q({ intent: 'MEMBER_TASKS', memberText: 'Lan', period: 'NEXT_WEEK' }),
        r({ intent: 'MEMBER_TASKS', period: 'THIS_WEEK', ignoredSlots: ['period'] }),
      ],
      [
        'MEMBER_TASKS + focus OPEN',
        q({ intent: 'MEMBER_TASKS', memberText: 'Lan', focus: 'OPEN' }),
        r({ intent: 'MEMBER_TASKS', focus: 'OPEN' }),
      ],
      [
        'MEMBER_TASKS + OVERDUE bo qua ky',
        q({ intent: 'MEMBER_TASKS', memberText: 'Lan', focus: 'OVERDUE', period: 'LAST_WEEK' }),
        r({ intent: 'MEMBER_TASKS', focus: 'OVERDUE', ignoredSlots: ['period'] }),
      ],
      [
        'MEMBER_TASKS thieu ten van khong ghi bo qua (dich vu se hoi lai)',
        q({ intent: 'MEMBER_TASKS' }),
        r({ intent: 'MEMBER_TASKS', period: 'THIS_WEEK' }),
      ],
      // TEAM_SUMMARY
      ['TEAM_SUMMARY mac dinh tuan nay', q({ intent: 'TEAM_SUMMARY' }), r({ intent: 'TEAM_SUMMARY', period: 'THIS_WEEK' })],
      [
        'TEAM_SUMMARY ky tuong lai van giu',
        q({ intent: 'TEAM_SUMMARY', period: 'NEXT_WEEK' }),
        r({ intent: 'TEAM_SUMMARY', period: 'NEXT_WEEK' }),
      ],
      [
        'TEAM_SUMMARY + BLOCKED',
        q({ intent: 'TEAM_SUMMARY', focus: 'BLOCKED', period: 'THIS_WEEK' }),
        r({ intent: 'TEAM_SUMMARY', focus: 'BLOCKED', ignoredSlots: ['period'] }),
      ],
      [
        'TEAM_SUMMARY + DONE thieu ky',
        q({ intent: 'TEAM_SUMMARY', focus: 'DONE' }),
        r({ intent: 'TEAM_SUMMARY', focus: 'DONE', period: 'THIS_WEEK' }),
      ],
      [
        'TEAM_SUMMARY bo qua ten',
        q({ intent: 'TEAM_SUMMARY', memberText: 'Lan' }),
        r({ intent: 'TEAM_SUMMARY', period: 'THIS_WEEK', ignoredSlots: ['member'] }),
      ],
      // TEAM_WORKLOAD
      ['TEAM_WORKLOAD khong tham so', q({ intent: 'TEAM_WORKLOAD' }), r({ intent: 'TEAM_WORKLOAD' })],
      [
        'TEAM_WORKLOAD bo qua moi tham so',
        q({ intent: 'TEAM_WORKLOAD', period: 'TODAY', focus: 'OPEN', memberText: 'Lan' }),
        r({ intent: 'TEAM_WORKLOAD', ignoredSlots: ['period', 'focus', 'member'] }),
      ],
    ];
    for (const [name, input, expected] of cases) {
      const frozen = Object.freeze({ ...input });
      expect(resolveSlots(frozen), name).toEqual(expected);
    }
  });
});
