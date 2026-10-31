// Dung cau tra loi theo MAU (CHATBOT_MODULE.md §6.4, §12.2).
//
// HAM THUAN: nhan so lieu da tinh (chat.queries) + thong tin pham vi, tra ve doi tuong
// cau tra loi. Moi con so trong cau dan deu lay tu so lieu da dem - khong co so nao duoc
// "viet ra" o day (co test kiem). LLM KHONG tham gia buoc nay.

import type { ChatFocus, ChatPeriod, ChatSlot, ResolvedQuery } from './chat.intent';
import { PAGE_SIZE } from './chat.intent';
import type { RosterMember } from './chat.members';
import type { CardSection, ChatCard, CountKey, ListResult, QueryResult, WorkloadResult, WorkloadRow } from './chat.queries';

/** Thong tin pham vi can cho cau chu (khong kem dieu kien truy van). */
export interface ScopeInfo {
  kind: 'MY' | 'WORKSPACE' | 'BOARD';
  workspaceName: string | null;
  boardName: string | null;
  boardCount: number;
  isLeader: boolean;
}

export interface ChatFact {
  key: string;
  label: string;
  value: number;
}

export interface ChatSectionOut {
  key: CardSection['key'];
  label: string;
  total: number;
  cards: ChatCard[];
}

export interface ClarifyOption {
  id: string;
  label: string;
  /** USER: chon nguoi; WORKSPACE: chon khong gian de hoi; TARGET: chon bang / khong gian khi trung ten (§18). */
  kind: 'USER' | 'WORKSPACE' | 'TARGET';
}

/** Mot dong cua bang ket qua danh muc (§18): `boardId` co -> dong la lien ket mo bang. */
export interface ChatTableRow {
  cells: (string | number)[];
  boardId?: string;
}

/** Bang chung cua cau tra loi danh muc: toi da MAX_TABLE_ROWS dong, khong phan trang. */
export interface ChatTable {
  columns: string[];
  rows: ChatTableRow[];
  /** Tong so dong co that (>= rows.length neu bi cat). */
  total: number;
}

/** Nhan xet AI (chi tong ket nhom, §11): giao dien hien o o rieng, tach khoi so lieu. */
export interface ChatComment {
  text: string;
  source: 'AI';
}

export interface ChatAnswer {
  kind: 'ANSWER' | 'CLARIFY' | 'UNSUPPORTED';
  text: string;
  scopeLabel: string;
  generatedAt: string;
  facts: ChatFact[];
  cards: ChatCard[];
  total: number;
  page: number;
  pageSize: number;
  sections: ChatSectionOut[];
  rows?: WorkloadRow[];
  /** Chi cau tra loi danh muc (§18). */
  table?: ChatTable;
  ignoredSlots: ChatSlot[];
  notes: string[];
  clarify?: { question: string; options: ClarifyOption[] };
  suggestions: string[];
  /** Chi co khi LLM viet duoc nhan xet qua kiem tra (chat.summary). */
  comment?: ChatComment;
}

/** Toi da bay nhieu lua chon trong mot cau hoi lai. */
export const MAX_CLARIFY_OPTIONS = 8;

// ===================== Chu =====================

const PERIOD_TEXT: Record<ChatPeriod, string> = {
  TODAY: 'hôm nay',
  TOMORROW: 'ngày mai',
  THIS_WEEK: 'tuần này',
  NEXT_WEEK: 'tuần sau',
  LAST_WEEK: 'tuần trước',
  NEXT_7_DAYS: 'trong 7 ngày tới',
};

/** Nhan ky nhu cau tra loi dung ("tuần này") - cung nhan gui LLM o luot nhan xet. */
export function periodText(period: ChatPeriod): string {
  return PERIOD_TEXT[period];
}

/** Cau hoi nhanh cho cac nhom (giao dien co ban sao y). Moi cau co test di qua bo luat. */
export const QUICK_QUESTIONS: readonly string[] = [
  'Việc nào của tôi sắp đến hạn?',
  'Hôm nay tôi nên xử lý gì trước?',
  'Tuần này nhóm hoàn thành gì, còn vướng gì?',
  'Ai đang có nhiều việc?',
  'Tôi đang ở bao nhiêu bảng?',
];

const CHECKLIST_NOTE = 'Chưa tính các mục checklist được giao riêng cho từng người.';

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function quote(s: string): string {
  return `“${s}”`;
}

export function scopeLabel(scope: ScopeInfo): string {
  if (scope.kind === 'BOARD') return `Tính trên bảng ${quote(scope.boardName ?? '')}.`;
  if (scope.kind === 'WORKSPACE') {
    return `Tính trên ${scope.boardCount} bảng bạn xem được trong không gian ${quote(scope.workspaceName ?? '')}.`;
  }
  return `Tính trên ${scope.boardCount} bảng bạn xem được.`;
}

export function scopeWhere(scope: ScopeInfo): string {
  if (scope.kind === 'BOARD') return `bảng ${quote(scope.boardName ?? '')}`;
  if (scope.kind === 'WORKSPACE') return `không gian ${quote(scope.workspaceName ?? '')}`;
  return 'các bảng bạn xem được';
}

/** Mo ta nhom viec theo tinh trang + ky: "chưa xong", "quá hạn", "đã hoàn thành tuần này"... */
function descriptor(focus: ChatFocus, period: ChatPeriod | null): string {
  switch (focus) {
    case 'OPEN':
      if (period === 'NEXT_7_DAYS') return 'sắp đến hạn trong 7 ngày tới';
      return period ? `chưa xong có hạn ${PERIOD_TEXT[period]}` : 'chưa xong';
    case 'DONE':
      return `đã hoàn thành ${PERIOD_TEXT[period ?? 'THIS_WEEK']}`;
    case 'OVERDUE':
      return 'quá hạn';
    case 'BLOCKED':
      return 'đang bị chặn';
  }
}

function factLabel(key: CountKey, period: ChatPeriod | null): string {
  const p = PERIOD_TEXT[period ?? 'THIS_WEEK'];
  switch (key) {
    case 'total':
      return 'Tổng số';
    case 'open':
      return 'Chưa xong';
    case 'overdue':
      return 'Quá hạn';
    case 'blocked':
      return 'Bị chặn';
    case 'doneInPeriod':
      return `Hoàn thành ${p}`;
    case 'dueInPeriod':
      return `Đến hạn ${p}`;
    case 'unassignedOpen':
      return 'Chưa giao, chưa xong';
    case 'dueToday':
      return 'Hạn hôm nay';
    case 'dueSoon':
      return 'Hạn trong 3 ngày tới';
  }
}

const FACT_ORDER: CountKey[] = [
  'total',
  'open',
  'doneInPeriod',
  'dueInPeriod',
  'overdue',
  'dueToday',
  'dueSoon',
  'blocked',
  'unassignedOpen',
];

function factsOf(r: ListResult, period: ChatPeriod | null): ChatFact[] {
  return FACT_ORDER.filter((k) => r.counts[k] !== undefined).map((k) => ({
    key: k,
    label: factLabel(k, period),
    value: r.counts[k] ?? 0,
  }));
}

function sectionLabel(key: CardSection['key'], intent: ResolvedQuery['intent'], period: ChatPeriod | null): string {
  if (key === 'DONE') return `Đã hoàn thành ${PERIOD_TEXT[period ?? 'THIS_WEEK']}`;
  if (key === 'OVERDUE') return 'Quá hạn';
  return intent === 'MY_PRIORITIES' ? 'Cần gỡ chặn' : 'Bị chặn';
}

function ignoredNotes(q: ResolvedQuery): string[] {
  const donePeriod = q.focus === 'DONE' || (q.intent === 'MEMBER_TASKS' && q.focus === null);
  return q.ignoredSlots.map((slot) => {
    if (slot === 'period' && donePeriod) {
      return 'Việc đã hoàn thành chỉ tính được tới hiện tại nên trợ lý dùng tuần này.';
    }
    const what = slot === 'period' ? 'thời gian' : slot === 'focus' ? 'tình trạng' : 'người';
    return `Trợ lý chưa lọc theo ${what} cho loại câu hỏi này.`;
  });
}

export function base(scope: ScopeInfo, now: Date, kind: ChatAnswer['kind'], text: string): ChatAnswer {
  return {
    kind,
    text,
    scopeLabel: scopeLabel(scope),
    generatedAt: now.toISOString(),
    facts: [],
    cards: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    sections: [],
    ignoredSlots: [],
    notes: [],
    suggestions: [],
  };
}

// ===================== Cau dan theo y dinh =====================

function teamSubject(scope: ScopeInfo): string {
  return scope.kind === 'BOARD' ? 'Bảng này' : 'Nhóm';
}

function listText(q: ResolvedQuery, r: ListResult, scope: ScopeInfo, memberName: string | null): string {
  const c = r.counts;
  switch (q.intent) {
    case 'MY_PRIORITIES': {
      const total = c.total ?? 0;
      const blocked = c.blocked ?? 0;
      const blockedText = blocked > 0 ? ` Ngoài ra có ${blocked} việc đang bị chặn, nên gỡ chặn trước.` : '';
      if (total === 0) {
        return blocked > 0
          ? `Bạn không có việc nào sẵn sàng để làm; ${blocked} việc đang bị chặn cần gỡ chặn.`
          : 'Bạn không có việc nào đang mở.';
      }
      const parts: string[] = [];
      if ((c.overdue ?? 0) > 0) parts.push(`${c.overdue} việc quá hạn`);
      if ((c.dueToday ?? 0) > 0) parts.push(`${c.dueToday} việc hạn hôm nay`);
      if ((c.dueSoon ?? 0) > 0) parts.push(`${c.dueSoon} việc hạn trong 3 ngày tới`);
      const urgent = parts.length > 0 ? ` Nên làm trước: ${parts.join(', ')}.` : ' Chưa có việc nào sát hạn.';
      return `Bạn có ${total} việc đang mở.${urgent}${blockedText}`;
    }
    case 'MEMBER_TASKS':
    case 'MY_TASKS':
    case 'TEAM_SUMMARY': {
      const subject =
        q.intent === 'MY_TASKS' ? 'Bạn' : q.intent === 'MEMBER_TASKS' ? (memberName ?? 'Người này') : teamSubject(scope);
      if (q.focus === null && q.intent === 'MEMBER_TASKS') {
        const overdue = (c.overdue ?? 0) > 0 ? `, trong đó ${c.overdue} việc quá hạn` : '';
        return `${subject} có ${c.open ?? 0} việc chưa xong${overdue}; đã hoàn thành ${c.doneInPeriod ?? 0} việc ${PERIOD_TEXT[q.period ?? 'THIS_WEEK']}.`;
      }
      if (q.focus === null) {
        // TEAM_SUMMARY tong quan
        const p = PERIOD_TEXT[q.period ?? 'THIS_WEEK'];
        const head =
          c.doneInPeriod !== undefined
            ? `${capitalize(p)}, ${subject.toLowerCase()} đã hoàn thành ${c.doneInPeriod} việc`
            : `${capitalize(p)} có ${c.dueInPeriod ?? 0} việc đến hạn`;
        return `${head}. Hiện còn ${c.open ?? 0} việc chưa xong: ${c.overdue ?? 0} quá hạn, ${c.blocked ?? 0} bị chặn, ${c.unassignedOpen ?? 0} chưa giao cho ai.`;
      }
      const d = descriptor(q.focus, q.period);
      const total = c.total ?? 0;
      if (total === 0) return `${subject} không có việc nào ${d}.`;
      const overdue = q.focus === 'OPEN' && (c.overdue ?? 0) > 0 ? `, trong đó ${c.overdue} việc đã quá hạn` : '';
      return `${subject} có ${total} việc ${d}${overdue}.`;
    }
    case 'TEAM_WORKLOAD':
      return '';
  }
}

function listNotes(q: ResolvedQuery, memberName: string | null): string[] {
  const notes = ignoredNotes(q);
  if (q.intent === 'MY_PRIORITIES') {
    notes.push('Thứ tự dựa trên hạn chót và trạng thái; thẻ chưa có trường độ ưu tiên.');
  }
  if (q.intent === 'MEMBER_TASKS') {
    notes.push(`Chỉ gồm việc ở các bảng bạn xem được, có thể chưa phải toàn bộ việc của ${memberName ?? 'người này'}.`);
  }
  if (q.intent === 'MY_TASKS' || q.intent === 'MY_PRIORITIES' || q.intent === 'MEMBER_TASKS') notes.push(CHECKLIST_NOTE);
  return notes;
}

/**
 * Cau hoi goi y sau moi loai cau tra loi. Moi cau PHAI duoc bo luat hieu dung y dinh no hua (co
 * test): "Còn việc quá hạn thì sao?" tung bi hieu la viec CUA TOI vi "việc" la tu chi viec - cau
 * noi tiep khong duoc chua tu do (§10.1 luat 4).
 */
export const SUGGESTIONS: Readonly<Record<ResolvedQuery['intent'], readonly string[]>> = {
  MY_TASKS: ['Hôm nay tôi nên xử lý gì trước?', 'Việc nào của tôi quá hạn?', 'Tuần này tôi đã xong những gì?'],
  MY_PRIORITIES: ['Việc nào của tôi sắp đến hạn?', 'Việc nào của tôi đang bị chặn?'],
  // Cau noi tiep: ke thua nguoi da chon, khong can go (va khong gui) lai ten
  MEMBER_TASKS: ['Còn quá hạn thì sao?', 'Còn tuần trước thì sao?'],
  TEAM_SUMMARY: ['Nhóm có việc nào bị chặn?', 'Ai đang có nhiều việc?', 'Còn tuần trước thì sao?'],
  // (bo "Việc nào chưa giao?": chua co danh sach the chua giao, chi ra ban tong ket nhom)
  TEAM_WORKLOAD: ['Nhóm có việc nào quá hạn?', 'Nhóm có việc nào bị chặn?'],
};

function workloadAnswer(q: ResolvedQuery, r: WorkloadResult, scope: ScopeInfo, now: Date): ChatAnswer {
  const parts: string[] = [];
  if (r.rows.length === 0) {
    parts.push('Chưa có ai trong danh sách thành viên của phạm vi này.');
  } else {
    parts.push(`Số việc chưa xong của từng người (${r.rows.length} người).`);
    const top = r.rows[0];
    if (top.open > 0) parts.push(`Nhiều nhất: ${top.name} với ${top.open} việc.`);
  }
  if (r.unassignedOpen > 0) parts.push(`Có ${r.unassignedOpen} việc chưa giao cho ai.`);
  if (r.outsideAssignments > 0) {
    parts.push(`Có ${r.outsideAssignments} lượt giao cho người ngoài danh sách thành viên hiện tại.`);
  }
  const notes = [
    ...ignoredNotes(q),
    'Đây là số thẻ chưa xong, khác với "tải" của gợi ý phân công (tính theo khoảng ngày chồng lấn).',
  ];
  if (r.showProfile) {
    notes.push('Giới hạn việc song song và ngày tạm nghỉ lấy từ hồ sơ làm việc của từng người trong không gian này.');
  }
  return {
    ...base(scope, now, 'ANSWER', parts.join(' ')),
    facts: [
      { key: 'unassignedOpen', label: 'Chưa giao, chưa xong', value: r.unassignedOpen },
      { key: 'outsideAssignments', label: 'Lượt giao cho người ngoài danh sách', value: r.outsideAssignments },
    ],
    rows: r.rows,
    ignoredSlots: q.ignoredSlots,
    notes,
    suggestions: [...SUGGESTIONS.TEAM_WORKLOAD],
  };
}

/** Cau tra loi cho mot truy van da chay. `memberName` = ten DA nhan dien (tu CSDL). */
export function renderAnswer(input: {
  query: ResolvedQuery;
  scope: ScopeInfo;
  result: QueryResult;
  memberName?: string | null;
  now: Date;
}): ChatAnswer {
  const { query: q, scope, result, now } = input;
  if (result.kind === 'WORKLOAD') return workloadAnswer(q, result, scope, now);
  const memberName = input.memberName ?? null;
  return {
    ...base(scope, now, 'ANSWER', listText(q, result, scope, memberName)),
    facts: factsOf(result, q.period),
    cards: result.cards,
    total: result.total,
    page: result.page,
    sections: result.sections.map((s) => ({ ...s, label: sectionLabel(s.key, q.intent, q.period) })),
    ignoredSlots: q.ignoredSlots,
    notes: listNotes(q, memberName),
    suggestions: [...SUGGESTIONS[q.intent]],
  };
}

// ===================== Hoi lai / khong ho tro / khong tim thay =====================

/** Nhieu nguoi khop ten go -> "Ý bạn là ai?" (§8.3). */
export function renderClarifyMember(typed: string, candidates: readonly RosterMember[], scope: ScopeInfo, now: Date): ChatAnswer {
  const shown = candidates.slice(0, MAX_CLARIFY_OPTIONS);
  const question = 'Ý bạn là ai?';
  const answer = base(scope, now, 'CLARIFY', `Có nhiều người khớp với ${quote(typed)} trong ${scopeWhere(scope)}. ${question}`);
  answer.clarify = { question, options: shown.map((m) => ({ id: m.userId, label: m.name, kind: 'USER' as const })) };
  if (candidates.length > shown.length) answer.notes = ['Hãy gõ thêm họ để thu hẹp danh sách.'];
  return answer;
}

/** Hoi ve nhom / nguoi khac o pham vi ca nhan -> chon khong gian (§7.2). */
export function renderClarifyWorkspace(
  options: readonly { id: string; name: string }[],
  scope: ScopeInfo,
  now: Date
): ChatAnswer {
  const question = 'Bạn muốn xem trong không gian nào?';
  const answer = base(scope, now, 'CLARIFY', question);
  answer.clarify = { question, options: options.slice(0, MAX_CLARIFY_OPTIONS).map((w) => ({ id: w.id, label: w.name, kind: 'WORKSPACE' as const })) };
  return answer;
}

/** MEMBER_TASKS nhung khong noi ten ai. */
export function renderAskWho(scope: ScopeInfo, now: Date): ChatAnswer {
  const question = 'Bạn muốn hỏi về ai?';
  const answer = base(scope, now, 'CLARIFY', `${question} Hãy nhập tên, ví dụ ${quote('Lan đang làm gì?')}.`);
  answer.clarify = { question, options: [] };
  return answer;
}

/** Khong tim thay ten go trong pham vi - KHONG noi nguoi do co ton tai o noi khac hay khong. */
export function renderMemberNotFound(typed: string, scope: ScopeInfo, now: Date): ChatAnswer {
  const answer = base(scope, now, 'ANSWER', `Không tìm thấy ${quote(typed)} trong ${scopeWhere(scope)}.`);
  answer.suggestions = ['Ai đang có nhiều việc?'];
  return answer;
}

export function renderUnsupported(scope: ScopeInfo, now: Date): ChatAnswer {
  const answer = base(
    scope,
    now,
    'UNSUPPORTED',
    'Trợ lý hiện chỉ trả lời về việc của bạn, việc của một thành viên, tiến độ nhóm, số việc của từng người, cùng số bảng, không gian, thành viên và số thẻ theo bảng hoặc cột. Trợ lý chưa tạo, sửa hay giao việc được.'
  );
  answer.suggestions = [...QUICK_QUESTIONS];
  return answer;
}
