// Cau noi tiep + cau tu nhac minh (CHATBOT_MODULE.md §9.2).
import { describe, expect, it } from 'vitest';
import { resolveSlots, type ParsedQuestion } from '../src/modules/chat/chat.intent';
import { applyFollowUp, type FollowUpContext, type FollowUpResult } from '../src/modules/chat/chat.followup';
import { parseByRules } from '../src/modules/chat/chat.rules';

const P = (over: Partial<ParsedQuestion>): ParsedQuestion => ({
  intent: 'NONE',
  period: null,
  focus: null,
  member: null,
  ...over,
});
const CTX = (over: Partial<FollowUpContext>): FollowUpContext => ({
  intent: 'MY_TASKS',
  period: null,
  focus: null,
  memberUserId: null,
  ...over,
});
const Q = (
  intent: string,
  period: string | null,
  focus: string | null,
  memberText: string | null,
  memberUserId: string | null,
  inherited: boolean
): FollowUpResult =>
  ({ kind: 'QUESTION', inherited, question: { intent, period, focus, memberText, memberUserId } }) as FollowUpResult;
const UNSUPPORTED: FollowUpResult = { kind: 'UNSUPPORTED' };

describe('applyFollowUp', () => {
  it('bang §9.2 + nguoi hoi tu nhac minh', () => {
    const memberCtx = CTX({ intent: 'MEMBER_TASKS', focus: 'DONE', period: 'THIS_WEEK', memberUserId: 'u-lan' });
    const cases: [string, ParsedQuestion, FollowUpContext | null, FollowUpResult][] = [
      // Y dinh cu the = cau hoi moi, KHONG ke thua (ke ca khi co ngu canh)
      ['y dinh moi', P({ intent: 'MY_TASKS', focus: 'OVERDUE' }), memberCtx, Q('MY_TASKS', null, 'OVERDUE', null, null, false)],
      ['ten go moi', P({ intent: 'MEMBER_TASKS', member: 'Minh' }), null, Q('MEMBER_TASKS', null, null, 'Minh', null, false)],
      ['MEMBER_TASKS ve "tôi" -> MY_TASKS', P({ intent: 'MEMBER_TASKS', member: 'tôi', focus: 'DONE' }), null, Q('MY_TASKS', null, 'DONE', null, null, false)],
      ['MY_PRIORITIES + "mình" giu nguyen', P({ intent: 'MY_PRIORITIES', member: 'mình' }), null, Q('MY_PRIORITIES', null, null, null, null, false)],
      ['TEAM_SUMMARY + "tôi" -> MY_TASKS', P({ intent: 'TEAM_SUMMARY', member: 'tôi' }), null, Q('MY_TASKS', null, null, null, null, false)],
      ['"Minh" khong dau la TEN, khong phai "mình"', P({ intent: 'MEMBER_TASKS', member: 'minh' }), null, Q('MEMBER_TASKS', null, null, 'minh', null, false)],
      ['UNSUPPORTED', P({ intent: 'UNSUPPORTED' }), memberCtx, UNSUPPORTED],
      // NONE
      ['NONE khong ngu canh', P({ period: 'NEXT_WEEK' }), null, UNSUPPORTED],
      ['NONE khong tham so', P({}), memberCtx, UNSUPPORTED],
      ['NONE doi ky, giu nguoi + tinh trang', P({ period: 'LAST_WEEK' }), memberCtx, Q('MEMBER_TASKS', 'LAST_WEEK', 'DONE', null, 'u-lan', true)],
      ['NONE doi tinh trang, giu ky', P({ focus: 'OVERDUE' }), memberCtx, Q('MEMBER_TASKS', 'THIS_WEEK', 'OVERDUE', null, 'u-lan', true)],
      ['NONE nguoi moi -> MEMBER_TASKS, bo nguoi cu', P({ member: 'Minh' }), memberCtx, Q('MEMBER_TASKS', 'THIS_WEEK', 'DONE', 'Minh', null, true)],
      [
        'NONE nguoi moi sau cau ca nhan',
        P({ member: 'Minh' }),
        CTX({ intent: 'MY_TASKS', focus: 'OVERDUE' }),
        Q('MEMBER_TASKS', null, 'OVERDUE', 'Minh', null, true),
      ],
      ['NONE "còn tôi?" sau cau ve nguoi khac', P({ member: 'tôi' }), memberCtx, Q('MY_TASKS', 'THIS_WEEK', 'DONE', null, null, true)],
      [
        'NONE "còn tôi?" sau cau uu tien',
        P({ member: 'tôi' }),
        CTX({ intent: 'MY_PRIORITIES' }),
        Q('MY_PRIORITIES', null, null, null, null, true),
      ],
      [
        'NONE "còn tôi?" sau cau nhom',
        P({ member: 'tôi' }),
        CTX({ intent: 'TEAM_SUMMARY', focus: 'BLOCKED' }),
        Q('MY_TASKS', null, 'BLOCKED', null, null, true),
      ],
      [
        'NONE sau cau luong viec',
        P({ period: 'TODAY' }),
        CTX({ intent: 'TEAM_WORKLOAD' }),
        Q('TEAM_WORKLOAD', 'TODAY', null, null, null, true),
      ],
    ];
    for (const [name, parsed, prev, expected] of cases) {
      expect(applyFollowUp(Object.freeze(parsed), prev ? Object.freeze(prev) : null), name).toEqual(expected);
    }
  });

  it('noi day du: bo luat -> cau noi tiep -> tham so hieu luc', () => {
    const roster = [
      { userId: 'u-lan', name: 'Nguyễn Thị Lan' },
      { userId: 'u-minh', name: 'Hoàng Minh' },
    ];
    const run = (question: string, prev: FollowUpContext | null) => {
      const r = applyFollowUp(parseByRules(question, roster), prev);
      return r.kind === 'QUESTION' ? { ...resolveSlots(r.question), memberText: r.question.memberText } : r;
    };

    // "Việc nào của tôi sắp đến hạn?" -> "còn tuần sau thì sao?" -> viec dang mo, han tuan sau
    const first = applyFollowUp(parseByRules('Việc nào của tôi sắp đến hạn?', roster), null);
    expect(first.kind).toBe('QUESTION');
    const prev = first.kind === 'QUESTION' ? { ...first.question, memberUserId: null } : null;
    expect(run('còn tuần sau thì sao?', prev)).toEqual({
      intent: 'MY_TASKS',
      period: 'NEXT_WEEK',
      focus: 'OPEN',
      ignoredSlots: [],
      memberText: null,
    });
    // "Lan đã xong gì tuần này?" (nhan dien xong = u-lan) -> "còn Minh?"
    const lanCtx = CTX({ intent: 'MEMBER_TASKS', focus: 'DONE', period: 'THIS_WEEK', memberUserId: 'u-lan' });
    expect(run('còn Minh thì sao?', lanCtx)).toEqual({
      intent: 'MEMBER_TASKS',
      period: 'THIS_WEEK',
      focus: 'DONE',
      ignoredSlots: [],
      memberText: 'minh',
    });
    // "tuần sau" voi viec DA XONG -> ky tuong lai bi bo qua, bao ra
    expect(run('tuần sau?', lanCtx)).toEqual({
      intent: 'MEMBER_TASKS',
      period: 'THIS_WEEK',
      focus: 'DONE',
      ignoredSlots: ['period'],
      memberText: null,
    });
    expect(run('Thời tiết hôm nay thế nào?', null)).toEqual(UNSUPPORTED);
  });

  it('y dinh danh muc (§18): luon la cau MOI (khong ke thua, khong bi ngu canh doi thanh cau khac), sau do khong noi tiep duoc', () => {
    const memberCtx = CTX({ intent: 'MEMBER_TASKS', focus: 'DONE', period: 'THIS_WEEK', memberUserId: 'u-lan' });
    const cases: [string, ParsedQuestion, FollowUpContext | null][] = [
      ['khong ten, khong ngu canh', P({ intent: 'MY_BOARDS' }), null],
      ['co ngu canh cau hoi ve nguoi', P({ intent: 'MY_BOARDS', period: 'NEXT_WEEK', focus: 'OVERDUE', member: 'Lan' }), memberCtx],
      ['ten bang + cot', P({ intent: 'CARD_COUNTS', target: 'Dự án Demo', column: 'Đang làm' }), memberCtx],
      ['chi ten khong gian', P({ intent: 'MEMBER_LIST', target: 'Nhóm A' }), null],
      ['khong gian cua toi', P({ intent: 'MY_WORKSPACES', member: 'tôi' }), CTX({ intent: 'TEAM_WORKLOAD' })],
    ];
    for (const [name, parsed, prev] of cases) {
      const r = applyFollowUp(Object.freeze(parsed), prev ? Object.freeze(prev) : null);
      expect(r, name).toEqual({
        kind: 'CATALOG',
        question: { intent: parsed.intent, target: parsed.target ?? null, column: parsed.column ?? null, targetId: null },
      });
      // tham so thoi gian / tinh trang / nguoi cua LLM khong lot vao cau hoi danh muc
      expect(JSON.stringify(r), name).not.toMatch(/period|focus|memberText|memberUserId/);
    }
    // Sau cau danh muc dich vu xoa ngu canh -> "còn tuần sau thì sao?" khong co gi de ke thua
    expect(applyFollowUp(parseByRules('còn tuần sau thì sao?', []), null)).toEqual(UNSUPPORTED);
  });
});
