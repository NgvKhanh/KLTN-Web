// Dung cau tra loi theo mau + nhan uu tien (CHATBOT_MODULE.md §6.4, §6.6, §8.3, §12.2). Ham thuan.
import { describe, expect, it } from 'vitest';
import type { ChatFocus, ChatPeriod, ResolvedQuery } from '../src/modules/chat/chat.intent';
import { CHAT_FOCUSES, CHAT_PERIODS, PAGE_SIZE, resolveSlots } from '../src/modules/chat/chat.intent';
import { applyFollowUp, type FollowUpContext } from '../src/modules/chat/chat.followup';
import { priorityReason } from '../src/modules/chat/chat.priority';
import { parseByRules } from '../src/modules/chat/chat.rules';
import type { ListResult, WorkloadResult } from '../src/modules/chat/chat.queries';
import {
  MAX_CLARIFY_OPTIONS,
  QUICK_QUESTIONS,
  renderAnswer,
  renderAskWho,
  renderClarifyMember,
  renderClarifyWorkspace,
  renderMemberNotFound,
  renderUnsupported,
  scopeLabel,
  SUGGESTIONS,
  type ChatAnswer,
  type ScopeInfo,
} from '../src/modules/chat/chat.answer';

const NOW = new Date('2026-09-30T03:00:00.000Z');
const WS: ScopeInfo = { kind: 'WORKSPACE', workspaceName: 'Nhóm A', boardName: null, boardCount: 3, isLeader: false };
const BOARD: ScopeInfo = { kind: 'BOARD', workspaceName: 'Nhóm A', boardName: 'Bảng X', boardCount: 1, isLeader: false };
const MY: ScopeInfo = { kind: 'MY', workspaceName: null, boardName: null, boardCount: 5, isLeader: false };

const q = (over: Partial<ResolvedQuery>): ResolvedQuery => ({ intent: 'MY_TASKS', period: null, focus: null, ignoredSlots: [], ...over });
const list = (counts: ListResult['counts'], over: Partial<ListResult> = {}): ListResult => ({
  kind: 'LIST',
  counts,
  cards: [],
  total: counts.total ?? counts.open ?? 0,
  page: 1,
  sections: [],
  ...over,
});
const render = (query: ResolvedQuery, result: ListResult | WorkloadResult, scope: ScopeInfo = MY, memberName: string | null = null) =>
  renderAnswer({ query, scope, result, memberName, now: NOW });

describe('priorityReason', () => {
  it('moc: < now qua han; < 00:00 mai hom nay; < 00:00 ngay thu 4 trong 3 ngay; con lai / khong han', () => {
    const b = { now: NOW, tomorrow: new Date('2026-09-30T17:00:00.000Z'), day4: new Date('2026-10-03T17:00:00.000Z') };
    const cases: [Date | null, string][] = [
      [new Date(NOW.getTime() - 1), 'OVERDUE'],
      [NOW, 'DUE_TODAY'],
      [new Date(b.tomorrow.getTime() - 1), 'DUE_TODAY'],
      [b.tomorrow, 'DUE_SOON'],
      [new Date(b.day4.getTime() - 1), 'DUE_SOON'],
      [b.day4, 'LATER'],
      [null, 'LATER'],
    ];
    for (const [due, reason] of cases) expect(priorityReason(due, b), String(due?.toISOString())).toBe(reason);
  });
});

describe('renderAnswer - cau dan', () => {
  it('danh sach theo tinh trang: cua toi / cua mot nguoi / cua nhom; so 0; "trong do qua han" chi voi viec chua xong', () => {
    const cases: [ResolvedQuery, ListResult['counts'], ScopeInfo, string | null, string][] = [
      [q({ focus: 'OPEN', period: 'NEXT_7_DAYS' }), { total: 3, overdue: 0 }, MY, null, 'Bạn có 3 việc sắp đến hạn trong 7 ngày tới.'],
      [q({ focus: 'OPEN' }), { total: 5, overdue: 2 }, MY, null, 'Bạn có 5 việc chưa xong, trong đó 2 việc đã quá hạn.'],
      [q({ focus: 'OPEN', period: 'THIS_WEEK' }), { total: 1, overdue: 0 }, MY, null, 'Bạn có 1 việc chưa xong có hạn tuần này.'],
      [q({ focus: 'OVERDUE' }), { total: 0, overdue: 0 }, MY, null, 'Bạn không có việc nào quá hạn.'],
      [q({ focus: 'OVERDUE' }), { total: 4, overdue: 4 }, MY, null, 'Bạn có 4 việc quá hạn.'],
      [q({ focus: 'DONE', period: 'LAST_WEEK' }), { total: 4, overdue: 0 }, MY, null, 'Bạn có 4 việc đã hoàn thành tuần trước.'],
      [q({ focus: 'BLOCKED' }), { total: 0, overdue: 0 }, MY, null, 'Bạn không có việc nào đang bị chặn.'],
      [q({ intent: 'MEMBER_TASKS', focus: 'BLOCKED' }), { total: 2, overdue: 1 }, WS, 'Trần Lan', 'Trần Lan có 2 việc đang bị chặn.'],
      [q({ intent: 'TEAM_SUMMARY', focus: 'OVERDUE' }), { total: 6, overdue: 6 }, WS, null, 'Nhóm có 6 việc quá hạn.'],
      [q({ intent: 'TEAM_SUMMARY', focus: 'BLOCKED' }), { total: 0, overdue: 0 }, BOARD, null, 'Bảng này không có việc nào đang bị chặn.'],
      [
        q({ intent: 'MEMBER_TASKS', period: 'LAST_WEEK' }),
        { open: 6, overdue: 1, doneInPeriod: 2 },
        WS,
        'Nguyễn Thị Lan',
        'Nguyễn Thị Lan có 6 việc chưa xong, trong đó 1 việc quá hạn; đã hoàn thành 2 việc tuần trước.',
      ],
      [
        q({ intent: 'MEMBER_TASKS', period: 'THIS_WEEK' }),
        { open: 0, overdue: 0, doneInPeriod: 0 },
        WS,
        'Minh',
        'Minh có 0 việc chưa xong; đã hoàn thành 0 việc tuần này.',
      ],
      [
        q({ intent: 'TEAM_SUMMARY', period: 'THIS_WEEK' }),
        { open: 10, dueInPeriod: 4, overdue: 2, blocked: 1, unassignedOpen: 4, doneInPeriod: 3 },
        WS,
        null,
        'Tuần này, nhóm đã hoàn thành 3 việc. Hiện còn 10 việc chưa xong: 2 quá hạn, 1 bị chặn, 4 chưa giao cho ai.',
      ],
      [
        q({ intent: 'TEAM_SUMMARY', period: 'NEXT_WEEK' }),
        { open: 10, dueInPeriod: 5, overdue: 2, blocked: 1, unassignedOpen: 0 },
        BOARD,
        null,
        'Tuần sau có 5 việc đến hạn. Hiện còn 10 việc chưa xong: 2 quá hạn, 1 bị chặn, 0 chưa giao cho ai.',
      ],
      [
        q({ intent: 'TEAM_SUMMARY', period: 'TODAY' }),
        { open: 1, dueInPeriod: 0, overdue: 0, blocked: 0, unassignedOpen: 0, doneInPeriod: 2 },
        BOARD,
        null,
        'Hôm nay, bảng này đã hoàn thành 2 việc. Hiện còn 1 việc chưa xong: 0 quá hạn, 0 bị chặn, 0 chưa giao cho ai.',
      ],
    ];
    for (const [query, counts, scope, name, text] of cases) {
      const a = render(query, list(counts), scope, name);
      expect(a.text, text).toBe(text);
      expect([a.kind, a.pageSize, a.generatedAt]).toEqual(['ANSWER', PAGE_SIZE, NOW.toISOString()]);
    }
  });

  it('MY_PRIORITIES: khong viec / chi con viec bi chan / co viec sat han / khong sat han', () => {
    const P = q({ intent: 'MY_PRIORITIES' });
    const text = (c: ListResult['counts']) => render(P, list(c)).text;
    expect(text({ total: 0, overdue: 0, dueToday: 0, dueSoon: 0, blocked: 0 })).toBe('Bạn không có việc nào đang mở.');
    expect(text({ total: 0, overdue: 0, dueToday: 0, dueSoon: 0, blocked: 2 })).toBe(
      'Bạn không có việc nào sẵn sàng để làm; 2 việc đang bị chặn cần gỡ chặn.'
    );
    expect(text({ total: 7, overdue: 1, dueToday: 2, dueSoon: 0, blocked: 1 })).toBe(
      'Bạn có 7 việc đang mở. Nên làm trước: 1 việc quá hạn, 2 việc hạn hôm nay. Ngoài ra có 1 việc đang bị chặn, nên gỡ chặn trước.'
    );
    expect(text({ total: 3, overdue: 0, dueToday: 0, dueSoon: 3, blocked: 0 })).toBe(
      'Bạn có 3 việc đang mở. Nên làm trước: 3 việc hạn trong 3 ngày tới.'
    );
    expect(text({ total: 2, overdue: 0, dueToday: 0, dueSoon: 0, blocked: 0 })).toBe('Bạn có 2 việc đang mở. Chưa có việc nào sát hạn.');
    const a = render(P, list({ total: 1, overdue: 0, dueToday: 0, dueSoon: 0, blocked: 1 }, { sections: [{ key: 'BLOCKED', total: 1, cards: [] }] }));
    expect(a.sections.map((s) => s.label)).toEqual(['Cần gỡ chặn']);
    expect(a.notes).toContain('Thứ tự dựa trên hạn chót và trạng thái; thẻ chưa có trường độ ưu tiên.');
  });

  it('con so, nhan danh sach phu, ghi chu va goi y', () => {
    const team = render(
      q({ intent: 'TEAM_SUMMARY', period: 'LAST_WEEK' }),
      list(
        { open: 9, dueInPeriod: 1, overdue: 2, blocked: 3, unassignedOpen: 4, doneInPeriod: 5 },
        { sections: [{ key: 'DONE', total: 5, cards: [] }, { key: 'OVERDUE', total: 2, cards: [] }, { key: 'BLOCKED', total: 3, cards: [] }] }
      ),
      WS
    );
    expect(team.facts).toEqual([
      { key: 'open', label: 'Chưa xong', value: 9 },
      { key: 'doneInPeriod', label: 'Hoàn thành tuần trước', value: 5 },
      { key: 'dueInPeriod', label: 'Đến hạn tuần trước', value: 1 },
      { key: 'overdue', label: 'Quá hạn', value: 2 },
      { key: 'blocked', label: 'Bị chặn', value: 3 },
      { key: 'unassignedOpen', label: 'Chưa giao, chưa xong', value: 4 },
    ]);
    expect(team.sections.map((s) => [s.key, s.label, s.total])).toEqual([
      ['DONE', 'Đã hoàn thành tuần trước', 5],
      ['OVERDUE', 'Quá hạn', 2],
      ['BLOCKED', 'Bị chặn', 3],
    ]);
    expect(team.notes).toEqual([]);
    expect(team.suggestions).toContain('Ai đang có nhiều việc?');
    expect(team.scopeLabel).toBe('Tính trên 3 bảng bạn xem được trong không gian “Nhóm A”.');

    const member = render(q({ intent: 'MEMBER_TASKS', period: 'THIS_WEEK', ignoredSlots: ['period'] }), list({ open: 1, overdue: 0, doneInPeriod: 0 }), WS, 'Lan');
    expect(member.notes).toEqual([
      'Việc đã hoàn thành chỉ tính được tới hiện tại nên trợ lý dùng tuần này.',
      'Chỉ gồm việc ở các bảng bạn xem được, có thể chưa phải toàn bộ việc của Lan.',
      'Chưa tính các mục checklist được giao riêng cho từng người.',
    ]);
    // goi y cho MEMBER_TASKS la cau noi tiep - khong chua ten nguoi
    expect(member.suggestions.join(' ')).not.toContain('Lan');
    expect(member.ignoredSlots).toEqual(['period']);

    const generic = render(q({ focus: 'OVERDUE', ignoredSlots: ['period', 'member'] }), list({ total: 0, overdue: 0 }));
    expect(generic.notes.slice(0, 2)).toEqual([
      'Trợ lý chưa lọc theo thời gian cho loại câu hỏi này.',
      'Trợ lý chưa lọc theo người cho loại câu hỏi này.',
    ]);
    expect(scopeLabel(MY)).toBe('Tính trên 5 bảng bạn xem được.');
    expect(scopeLabel(BOARD)).toBe('Tính trên bảng “Bảng X”.');
  });

  it('TEAM_WORKLOAD: cau dan, dong nguoi ngoai danh sach, ghi chu ho so chi khi la truong nhom', () => {
    const rows = [
      { userId: 'a', name: 'An', open: 4, overdue: 1 },
      { userId: 'b', name: 'Bình', open: 0, overdue: 0 },
    ];
    const r: WorkloadResult = { kind: 'WORKLOAD', rows, outsideAssignments: 3, unassignedOpen: 2, showProfile: false };
    const a = render(q({ intent: 'TEAM_WORKLOAD', ignoredSlots: ['period'] }), r, WS);
    expect(a.text).toBe(
      'Số việc chưa xong của từng người (2 người). Nhiều nhất: An với 4 việc. Có 2 việc chưa giao cho ai. Có 3 lượt giao cho người ngoài danh sách thành viên hiện tại.'
    );
    expect(a.rows).toEqual(rows);
    expect(a.facts.map((f) => [f.key, f.value])).toEqual([['unassignedOpen', 2], ['outsideAssignments', 3]]);
    expect(a.notes.join(' ')).not.toContain('hồ sơ làm việc');
    expect(a.notes[0]).toBe('Trợ lý chưa lọc theo thời gian cho loại câu hỏi này.');

    const leader = render(q({ intent: 'TEAM_WORKLOAD' }), { ...r, showProfile: true, outsideAssignments: 0, unassignedOpen: 0 }, { ...WS, isLeader: true });
    expect(leader.text).toBe('Số việc chưa xong của từng người (2 người). Nhiều nhất: An với 4 việc.');
    expect(leader.notes.join(' ')).toContain('hồ sơ làm việc');

    const idle = render(q({ intent: 'TEAM_WORKLOAD' }), { ...r, rows: rows.map((x) => ({ ...x, open: 0 })), outsideAssignments: 0, unassignedOpen: 0 }, WS);
    expect(idle.text).toBe('Số việc chưa xong của từng người (2 người).');
    const one = render(q({ intent: 'TEAM_WORKLOAD' }), { ...r, rows: [], outsideAssignments: 1, unassignedOpen: 1 }, WS);
    expect(one.text).toBe(
      'Chưa có ai trong danh sách thành viên của phạm vi này. Có 1 việc chưa giao cho ai. Có 1 lượt giao cho người ngoài danh sách thành viên hiện tại.'
    );
    const empty = render(q({ intent: 'TEAM_WORKLOAD' }), { ...r, rows: [], outsideAssignments: 0, unassignedOpen: 0 }, WS);
    expect(empty.text).toBe('Chưa có ai trong danh sách thành viên của phạm vi này.');
  });

  it('tinh chat tren 600 bo so lieu ngau nhien: moi con so trong cau dan deu co trong so lieu da tinh', () => {
    let seed = 99;
    const rnd = (n: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % n;
    };
    const intents: ResolvedQuery['intent'][] = ['MY_TASKS', 'MY_PRIORITIES', 'MEMBER_TASKS', 'TEAM_SUMMARY', 'TEAM_WORKLOAD'];
    const scopes = [MY, WS, BOARD];
    for (let n = 0; n < 600; n++) {
      const intent = intents[rnd(intents.length)];
      const focus: ChatFocus | null = rnd(3) === 0 ? null : CHAT_FOCUSES[rnd(CHAT_FOCUSES.length)];
      const period: ChatPeriod | null = rnd(3) === 0 ? null : CHAT_PERIODS[rnd(CHAT_PERIODS.length)];
      const v = () => rnd(3) === 0 ? 0 : rnd(250);
      const query = q({ intent, focus: intent === 'MY_PRIORITIES' || intent === 'TEAM_WORKLOAD' ? null : focus, period });
      let answer: ChatAnswer;
      let allowed: number[];
      if (intent === 'TEAM_WORKLOAD') {
        const rows = Array.from({ length: rnd(5) }, (_, i) => ({ userId: `u${i}`, name: `Người ${String.fromCharCode(65 + i)}`, open: v(), overdue: v() }));
        rows.sort((a, b) => b.open - a.open);
        const r: WorkloadResult = { kind: 'WORKLOAD', rows, outsideAssignments: v(), unassignedOpen: v(), showProfile: rnd(2) === 0 };
        answer = render(query, r, scopes[1 + rnd(2)]);
        allowed = [...answer.facts.map((f) => f.value), ...rows.map((x) => x.open), rows.length];
      } else {
        const counts: ListResult['counts'] = { total: v(), open: v(), overdue: v(), blocked: v(), dueToday: v(), dueSoon: v(), unassignedOpen: v(), dueInPeriod: v() };
        // chat.queries luon tinh doneInPeriod cho tong quan mot nguoi; tong quan nhom co khi khong (ky tuong lai)
        if (intent === 'MEMBER_TASKS' || rnd(2) === 0) counts.doneInPeriod = v();
        answer = render(query, list(counts), scopes[rnd(3)], 'Lan');
        allowed = answer.facts.map((f) => f.value);
      }
      // "3 ngày tới" / "7 ngày tới" la ten moc thoi gian, khong phai con so dem
      const numbers = answer.text.replace(/[37] ngày tới/g, '').match(/[0-9]+/g) ?? [];
      for (const num of numbers) expect(allowed, `${answer.text} | ${JSON.stringify(answer.facts)}`).toContain(Number(num));
      expect(answer.text.length).toBeGreaterThan(0);
    }
  });
});

describe('hoi lai / khong ho tro / khong tim thay', () => {
  it('Y ban la ai: toi da 8 lua chon + goi y go them ho; chon khong gian; hoi ten; khong tim thay; chua ho tro', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ userId: `u${i}`, name: `Lan ${i}` }));
    const c = renderClarifyMember('Lan', many, WS, NOW);
    expect(c.kind).toBe('CLARIFY');
    expect(c.text).toBe('Có nhiều người khớp với “Lan” trong không gian “Nhóm A”. Ý bạn là ai?');
    expect(c.clarify?.options).toHaveLength(MAX_CLARIFY_OPTIONS);
    expect(c.clarify?.options[0]).toEqual({ id: 'u0', label: 'Lan 0', kind: 'USER' });
    expect(c.notes).toEqual(['Hãy gõ thêm họ để thu hẹp danh sách.']);
    expect(renderClarifyMember('Lan', many.slice(0, 2), WS, NOW).notes).toEqual([]);

    const w = renderClarifyWorkspace([{ id: 'w1', name: 'Nhóm A' }, { id: 'w2', name: 'Khong gian cua toi' }], MY, NOW);
    expect([w.kind, w.text, w.clarify?.options.map((o) => [o.id, o.kind])]).toEqual([
      'CLARIFY',
      'Bạn muốn xem trong không gian nào?',
      [['w1', 'WORKSPACE'], ['w2', 'WORKSPACE']],
    ]);
    const who = renderAskWho(WS, NOW);
    expect([who.kind, who.clarify?.options]).toEqual(['CLARIFY', []]);

    const nf = renderMemberNotFound('Hùng', BOARD, NOW);
    expect([nf.kind, nf.text]).toEqual(['ANSWER', 'Không tìm thấy “Hùng” trong bảng “Bảng X”.']);
    expect(nf.text).not.toMatch(/tồn tại|không gian khác/);

    const un = renderUnsupported(MY, NOW);
    expect(un.kind).toBe('UNSUPPORTED');
    expect(un.suggestions).toEqual([...QUICK_QUESTIONS]);
    expect(un.text).toContain('chưa tạo, sửa hay giao việc');
    for (const a of [c, w, who, nf, un]) expect([a.facts, a.cards, a.sections, a.generatedAt]).toEqual([[], [], [], NOW.toISOString()]);
  });
});

describe('cau hoi goi y / cau hoi nhanh', () => {
  // Loi tim thay khi thu tren trinh duyet (buoc 6): nut goi y "Còn việc quá hạn thì sao?" sau cau hoi ve
  // Trần Lan bi bo luat hieu la "việc CỦA TÔI quá hạn" ("việc" la tu chi viec -> khong con la cau noi
  // tiep) -> mat nguoi dang hoi. Moi cau goi y phai duoc bo luat hieu DUNG y dinh no hua.
  it('moi cau goi y (sau tung loai cau tra loi) + cau hoi nhanh qua bo luat + cau noi tiep ra dung truy van', () => {
    const roster = [
      { userId: 'u-lan1', name: 'Nguyễn Thị Lan' },
      { userId: 'u-lan2', name: 'Trần Lan' },
    ];
    type Want = { intent: ResolvedQuery['intent']; period: ChatPeriod | null; focus: ChatFocus | null; member: string | null };
    const want = (intent: Want['intent'], focus: ChatFocus | null = null, period: ChatPeriod | null = null, member: string | null = null): Want => ({ intent, period, focus, member });
    const rows: Array<[ResolvedQuery['intent'] | 'QUICK', string, Want]> = [
      ['MY_TASKS', 'Hôm nay tôi nên xử lý gì trước?', want('MY_PRIORITIES')],
      ['MY_TASKS', 'Việc nào của tôi quá hạn?', want('MY_TASKS', 'OVERDUE')],
      ['MY_TASKS', 'Tuần này tôi đã xong những gì?', want('MY_TASKS', 'DONE', 'THIS_WEEK')],
      ['MY_PRIORITIES', 'Việc nào của tôi sắp đến hạn?', want('MY_TASKS', 'OPEN', 'NEXT_7_DAYS')],
      ['MY_PRIORITIES', 'Việc nào của tôi đang bị chặn?', want('MY_TASKS', 'BLOCKED')],
      // noi tiep: GIU nguoi da chon o luot truoc
      ['MEMBER_TASKS', 'Còn quá hạn thì sao?', want('MEMBER_TASKS', 'OVERDUE', null, 'u-lan2')],
      ['MEMBER_TASKS', 'Còn tuần trước thì sao?', want('MEMBER_TASKS', null, 'LAST_WEEK', 'u-lan2')],
      ['TEAM_SUMMARY', 'Nhóm có việc nào bị chặn?', want('TEAM_SUMMARY', 'BLOCKED')],
      ['TEAM_SUMMARY', 'Ai đang có nhiều việc?', want('TEAM_WORKLOAD')],
      ['TEAM_SUMMARY', 'Còn tuần trước thì sao?', want('TEAM_SUMMARY', null, 'LAST_WEEK')],
      ['TEAM_WORKLOAD', 'Nhóm có việc nào quá hạn?', want('TEAM_SUMMARY', 'OVERDUE')],
      ['TEAM_WORKLOAD', 'Nhóm có việc nào bị chặn?', want('TEAM_SUMMARY', 'BLOCKED')],
      ['QUICK', 'Việc nào của tôi sắp đến hạn?', want('MY_TASKS', 'OPEN', 'NEXT_7_DAYS')],
      ['QUICK', 'Hôm nay tôi nên xử lý gì trước?', want('MY_PRIORITIES')],
      ['QUICK', 'Tuần này nhóm hoàn thành gì, còn vướng gì?', want('TEAM_SUMMARY', null, 'THIS_WEEK')],
      ['QUICK', 'Ai đang có nhiều việc?', want('TEAM_WORKLOAD')],
    ];
    // bang phai phu DU moi cau dang dung (them cau goi y moi ma quen them vao day -> do)
    const listed = (src: ResolvedQuery['intent'] | 'QUICK') => rows.filter((r) => r[0] === src).map((r) => r[1]);
    for (const intent of Object.keys(SUGGESTIONS) as ResolvedQuery['intent'][]) expect(listed(intent), intent).toEqual([...SUGGESTIONS[intent]]);
    // cau hoi nhanh THU NAM ("Tôi đang ở bao nhiêu bảng?") la y dinh danh muc: test o chat.catalog.answer.test
    expect(listed('QUICK')).toEqual([...QUICK_QUESTIONS.slice(0, 4)]);

    const wrong: unknown[] = [];
    for (const [src, text, w] of rows) {
      const prev: FollowUpContext | null =
        src === 'QUICK' ? null : { intent: src, period: null, focus: null, memberUserId: src === 'MEMBER_TASKS' ? 'u-lan2' : null };
      const fu = applyFollowUp(parseByRules(text, roster), prev);
      if (fu.kind !== 'QUESTION') {
        wrong.push({ src, text, got: fu.kind });
        continue;
      }
      const r = resolveSlots(fu.question);
      const got: Want = { intent: r.intent, period: r.period, focus: r.focus, member: fu.question.memberUserId };
      if (JSON.stringify(got) !== JSON.stringify(w)) wrong.push({ src, text, got, want: w });
    }
    expect(wrong).toEqual([]);
    // chot chong "xanh gia": cau cu thuc su hong
    const old = applyFollowUp(parseByRules('Còn việc quá hạn thì sao?', roster), { intent: 'MEMBER_TASKS', period: null, focus: null, memberUserId: 'u-lan2' });
    expect(old.kind === 'QUESTION' && old.question.intent).toBe('MY_TASKS');
  });
});
