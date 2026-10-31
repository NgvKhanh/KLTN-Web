import axios from 'axios';
import { matchPath } from 'react-router-dom';
import type {
  ChatAnswer,
  ChatCard,
  ChatFocus,
  ChatIntent,
  ChatParser,
  ChatPeriod,
  ChatScope,
  ChatUnderstood,
  PriorityReason,
} from '../types/chat';

// Chu hien thi + ham thuan cua tro ly (CHATBOT_MODULE.md §13). Khong goi API, khong doc DOM.

/** API chan o 500 ky tu (sau khi cat khoang trang). */
export const MAX_QUESTION_CHARS = 500;

/** Nut cau hoi nhanh: 4 nhom cau hoi ve viec + 1 cau ve bang (danh muc, §18). */
export const QUICK_QUESTIONS = [
  'Việc nào của tôi sắp đến hạn?',
  'Hôm nay tôi nên xử lý gì trước?',
  'Tuần này nhóm hoàn thành gì, còn vướng gì?',
  'Ai đang có nhiều việc?',
  'Tôi đang ở bao nhiêu bảng?',
];

/** Ke hoach cu bi thay boi mot lenh moi (khop errorText('SUPERSEDED') o server). */
export const SUPERSEDED_TEXT = 'Đã có lệnh mới hơn nên kế hoạch này bị thay thế. Chưa thay đổi gì.';

export const PRIVACY_NOTE = 'AI có thể nhận câu hỏi, tên bảng/thành viên, tiêu đề, hạn, trạng thái và nhật ký liên quan mà bạn được phép xem.';

/** Mui gio cua moi dinh nghia "hôm nay / tuần này" o server (§5). */
const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';

const INTENT_TEXT: Record<ChatIntent, string> = {
  MY_TASKS: 'việc của bạn',
  MY_PRIORITIES: 'nên làm gì trước',
  MEMBER_TASKS: 'việc của một thành viên',
  TEAM_SUMMARY: 'tiến độ nhóm',
  TEAM_WORKLOAD: 'số việc của từng người',
  MY_BOARDS: 'các bảng của bạn',
  MY_WORKSPACES: 'các không gian của bạn',
  MEMBER_LIST: 'thành viên',
  CARD_COUNTS: 'số thẻ',
  UNSUPPORTED: 'câu hỏi chưa hỗ trợ',
  NONE: 'câu hỏi chưa hỗ trợ',
};

const PERIOD_TEXT: Record<ChatPeriod, string> = {
  TODAY: 'hôm nay',
  TOMORROW: 'ngày mai',
  THIS_WEEK: 'tuần này',
  NEXT_WEEK: 'tuần sau',
  LAST_WEEK: 'tuần trước',
  NEXT_7_DAYS: '7 ngày tới',
};

const FOCUS_TEXT: Record<ChatFocus, string> = {
  OPEN: 'chưa xong',
  OVERDUE: 'quá hạn',
  DONE: 'đã xong',
  BLOCKED: 'bị chặn',
};

const PARSER_TEXT: Record<ChatParser, string> = {
  RULE: 'bộ luật',
  HYBRID: 'AI + bộ luật',
  LLM: 'AI',
};

export const REASON_TEXT: Record<PriorityReason, string> = {
  OVERDUE: 'Quá hạn',
  DUE_TODAY: 'Hạn hôm nay',
  DUE_SOON: 'Hạn trong 3 ngày',
  LATER: 'Còn lại',
};

/**
 * Dong "Trợ lý hiểu là: …" - vd "việc của Trần Lan · quá hạn"; cau danh muc: "số thẻ · Sprint 12 · cột Đang làm"
 * (ten bang / khong gian / cot la ten DA nhan dien tu danh muc cua server, khong phai chuoi nguoi dung go).
 */
export function understoodText(u: ChatUnderstood): string {
  if (u.summary) return u.summary;
  const subject = u.intent === 'MEMBER_TASKS' && u.memberName ? `việc của ${u.memberName}` : INTENT_TEXT[u.intent];
  const parts = [subject];
  if (u.targetName) parts.push(u.targetName);
  if (u.columnName) parts.push(`cột ${u.columnName}`);
  if (u.focus) parts.push(FOCUS_TEXT[u.focus]);
  if (u.period) parts.push(PERIOD_TEXT[u.period]);
  return parts.join(' · ');
}

export function parserText(parser: ChatParser): string {
  return PARSER_TEXT[parser];
}

// ===================== Pham vi =====================

/** Pham vi mac dinh theo trang dang mo (§13): trang bang -> Bảng; /workspaces/:id -> Không gian; con lai -> Việc của tôi. */
export function defaultScopeFor(pathname: string): ChatScope {
  const board = matchPath('/boards/:boardId', pathname);
  if (board?.params.boardId) return { kind: 'BOARD', boardId: board.params.boardId };
  const ws = matchPath({ path: '/workspaces/:workspaceId', end: false }, pathname);
  if (ws?.params.workspaceId) return { kind: 'WORKSPACE', workspaceId: ws.params.workspaceId };
  return { kind: 'MY' };
}

export function sameScope(a: ChatScope, b: ChatScope): boolean {
  if (a.kind === 'WORKSPACE' && b.kind === 'WORKSPACE') return a.workspaceId === b.workspaceId;
  if (a.kind === 'BOARD' && b.kind === 'BOARD') return a.boardId === b.boardId;
  return a.kind === b.kind;
}

// ===================== The =====================

export function cardLink(card: Pick<ChatCard, 'id' | 'boardId'>): string {
  return `/boards/${encodeURIComponent(card.boardId)}?card=${encodeURIComponent(card.id)}`;
}

function vnParts(iso: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: VN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

/** "30/09 17:00" (gio Viet Nam); khac nam voi `ref` thi them nam: "02/01/2027 09:00". */
export function formatDateTime(iso: string, ref: string): string {
  const d = vnParts(iso);
  const year = d.year === vnParts(ref).year ? '' : `/${d.year}`;
  return `${d.day}/${d.month}${year} ${d.hour}:${d.minute}`;
}

/** "30/09" (gio Viet Nam); khac nam voi `ref` thi them nam. */
export function formatDate(iso: string, ref: string): string {
  const d = vnParts(iso);
  return d.year === vnParts(ref).year ? `${d.day}/${d.month}` : `${d.day}/${d.month}/${d.year}`;
}

/** "10:05" (gio Viet Nam) - thoi diem truy van. */
export function formatTime(iso: string): string {
  const d = vnParts(iso);
  return `${d.hour}:${d.minute}`;
}

/** Con the chua hien o danh sach chinh? (so the da tai < tong). */
export function remainingCards(answer: Pick<ChatAnswer, 'kind' | 'total'>, shown: number): number {
  return answer.kind === 'ANSWER' ? Math.max(0, answer.total - shown) : 0;
}

/** Gop trang moi vao danh sach da hien, bo the trung (du lieu co the doi giua hai trang). */
export function appendCards(shown: readonly ChatCard[], next: readonly ChatCard[]): ChatCard[] {
  const seen = new Set(shown.map((c) => c.id));
  return [...shown, ...next.filter((c) => !seen.has(c.id))];
}

// ===================== Loi =====================

export type ChatRequestKind = 'MESSAGE' | 'CHOICE' | 'MORE' | 'ACTION';

/**
 * Thong diep loi tieng Viet co dau theo ma HTTP (server tra thong diep khong dau).
 * `conversationGone` = hoi thoai phia server khong con (het han / may chu khoi dong lai).
 */
export function chatErrorText(err: unknown, kind: ChatRequestKind): { text: string; conversationGone: boolean } {
  const plain = (text: string) => ({ text, conversationGone: false });
  if (!axios.isAxiosError(err)) return plain('Trợ lý chưa trả lời được. Hãy thử lại.');
  if (!err.response) return plain('Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.');
  const status = err.response.status;
  if (status === 429) return plain('Bạn hỏi hơi nhiều trong thời gian ngắn. Hãy thử lại sau ít phút.');
  if (status === 403) {
    return plain(kind === 'ACTION'
      ? 'Bạn không có quyền thực hiện thao tác này, hoặc trợ lý đang tắt chức năng thay đổi dữ liệu. Chưa thay đổi gì.'
      : 'Bạn không có quyền xem phạm vi này. Hãy chọn phạm vi khác.');
  }
  // 409: kế hoạch đổi / đang chạy (ACTION) hoặc nút của một lượt ở trang khác (CHOICE, MORE) - luôn chưa ghi gì
  if (status === 409) {
    return plain(kind === 'ACTION'
      ? 'Kế hoạch đã thay đổi hoặc đang được xử lý. Chưa thay đổi gì thêm; hãy gửi lại lệnh nếu cần.'
      : 'Bạn đã chuyển sang trang khác nên lựa chọn này không còn dùng được. Hãy hỏi lại ở trang này.');
  }
  if (status === 404) {
    if (kind === 'ACTION') return plain('Không tìm thấy kế hoạch này (có thể đã hết hạn). Hãy gửi lại lệnh.');
    return kind === 'MESSAGE'
      ? plain('Không tìm thấy không gian hoặc bảng này. Hãy chọn phạm vi khác.')
      : { text: 'Hội thoại đã hết hạn. Hãy hỏi lại câu hỏi.', conversationGone: true };
  }
  if (status === 400) {
    if (kind === 'ACTION') return plain('Yêu cầu không hợp lệ nên chưa thay đổi gì. Hãy gửi lại lệnh.');
    if (kind === 'CHOICE') return plain('Lựa chọn này không còn dùng được. Hãy hỏi lại.');
    if (kind === 'MORE') return plain('Không còn gì để xem thêm. Hãy hỏi lại.');
    return plain('Câu hỏi chưa hợp lệ. Hãy viết lại ngắn hơn.');
  }
  return plain('Trợ lý chưa trả lời được. Hãy thử lại.');
}
