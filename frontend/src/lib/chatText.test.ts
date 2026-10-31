import { AxiosError, type AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';
import type { ChatCard } from '../types/chat';
import {
  appendCards,
  cardLink,
  chatErrorText,
  defaultScopeFor,
  formatDate,
  formatDateTime,
  formatTime,
  MAX_QUESTION_CHARS,
  parserText,
  QUICK_QUESTIONS,
  remainingCards,
  sameScope,
  understoodText,
} from './chatText';

const httpError = (status: number | null) =>
  new AxiosError(
    'loi',
    'ERR',
    undefined,
    undefined,
    status === null ? undefined : ({ status, data: { success: false, message: 'Khong dau' } } as AxiosResponse)
  );

const card = (id: string): ChatCard => ({
  id,
  title: id,
  boardId: 'b1',
  boardName: 'B',
  listName: 'L',
  status: 'TODO',
  dueDate: null,
  completedAt: null,
  overdue: false,
  checklistDone: 0,
  checklistTotal: 0,
  assignees: [],
});

describe('chatText', () => {
  it('understoodText / parserText: dong "Trợ lý hiểu là" dung ten DA nhan dien, bo tham so rong', () => {
    const u = { intent: 'MY_TASKS', period: 'NEXT_7_DAYS', focus: 'OPEN', memberName: null, parser: 'RULE' } as const;
    expect(understoodText(u)).toBe('việc của bạn · chưa xong · 7 ngày tới');
    expect(understoodText({ ...u, intent: 'MEMBER_TASKS', memberName: 'Trần Lan', focus: 'OVERDUE', period: null })).toBe('việc của Trần Lan · quá hạn');
    expect(understoodText({ ...u, intent: 'MEMBER_TASKS', memberName: null, focus: null, period: null })).toBe('việc của một thành viên');
    expect(understoodText({ ...u, intent: 'TEAM_SUMMARY', focus: null, period: 'LAST_WEEK' })).toBe('tiến độ nhóm · tuần trước');
    expect(understoodText({ ...u, intent: 'TEAM_WORKLOAD', focus: null, period: null })).toBe('số việc của từng người');
    expect(understoodText({ ...u, intent: 'MY_PRIORITIES', focus: 'DONE', period: 'TODAY' })).toBe('nên làm gì trước · đã xong · hôm nay');
    expect(understoodText({ ...u, intent: 'UNSUPPORTED', focus: 'BLOCKED', period: 'TOMORROW' })).toBe('câu hỏi chưa hỗ trợ · bị chặn · ngày mai');
    expect([parserText('RULE'), parserText('HYBRID'), parserText('LLM')]).toEqual(['bộ luật', 'AI + bộ luật', 'AI']);
  });

  it('understoodText cho cau danh muc (§18): ten bang / khong gian / cot DA nhan dien; khong co ten thi chi con ten loai', () => {
    const u = { intent: 'MY_BOARDS', period: null, focus: null, memberName: null, parser: 'RULE' } as const;
    expect(understoodText(u)).toBe('các bảng của bạn');
    expect(understoodText({ ...u, targetName: 'Kỹ thuật' })).toBe('các bảng của bạn · Kỹ thuật');
    expect(understoodText({ ...u, intent: 'MY_WORKSPACES' })).toBe('các không gian của bạn');
    expect(understoodText({ ...u, intent: 'MEMBER_LIST' })).toBe('thành viên');
    expect(understoodText({ ...u, intent: 'MEMBER_LIST', targetName: 'Sprint 12' })).toBe('thành viên · Sprint 12');
    expect(understoodText({ ...u, intent: 'CARD_COUNTS' })).toBe('số thẻ');
    expect(understoodText({ ...u, intent: 'CARD_COUNTS', targetName: 'Sprint 12', columnName: 'Đang làm' })).toBe('số thẻ · Sprint 12 · cột Đang làm');
    expect(understoodText({ ...u, intent: 'CARD_COUNTS', targetName: null, columnName: 'Xong' })).toBe('số thẻ · cột Xong');
    // truong moi la tuy chon: phan hoi cu (khong co targetName / columnName) van dung
    expect(understoodText({ intent: 'MY_TASKS', period: null, focus: 'OPEN', memberName: null, parser: 'RULE' })).toBe('việc của bạn · chưa xong');
  });

  it('QUICK_QUESTIONS: 5 cau, cau cuoi la cau danh muc; khong trung nhau; vua khung 500 ky tu', () => {
    expect(QUICK_QUESTIONS).toHaveLength(5);
    expect(QUICK_QUESTIONS[4]).toBe('Tôi đang ở bao nhiêu bảng?');
    expect(new Set(QUICK_QUESTIONS).size).toBe(5);
    for (const q of QUICK_QUESTIONS) expect(q.length).toBeLessThanOrEqual(MAX_QUESTION_CHARS);
  });

  it('defaultScopeFor: trang bang -> Bảng; /workspaces/:id (ke ca trang con) -> Không gian; con lai -> Việc của tôi', () => {
    const rows: Array<[string, unknown]> = [
      ['/boards/b1', { kind: 'BOARD', boardId: 'b1' }],
      ['/boards/b1/', { kind: 'BOARD', boardId: 'b1' }],
      ['/boards', { kind: 'MY' }],
      ['/public/boards/b1', { kind: 'MY' }],
      ['/workspaces/ws2', { kind: 'WORKSPACE', workspaceId: 'ws2' }],
      ['/workspaces/ws2/settings', { kind: 'WORKSPACE', workspaceId: 'ws2' }],
      ['/home', { kind: 'MY' }],
      ['/my-cards', { kind: 'MY' }],
      ['/', { kind: 'MY' }],
    ];
    for (const [path, want] of rows) expect(defaultScopeFor(path), path).toEqual(want);
  });

  it('sameScope so loai + id', () => {
    expect(sameScope({ kind: 'MY' }, { kind: 'MY' })).toBe(true);
    expect(sameScope({ kind: 'BOARD', boardId: 'a' }, { kind: 'BOARD', boardId: 'a' })).toBe(true);
    expect(sameScope({ kind: 'BOARD', boardId: 'a' }, { kind: 'BOARD', boardId: 'b' })).toBe(false);
    expect(sameScope({ kind: 'WORKSPACE', workspaceId: 'a' }, { kind: 'WORKSPACE', workspaceId: 'b' })).toBe(false);
    expect(sameScope({ kind: 'WORKSPACE', workspaceId: 'a' }, { kind: 'MY' })).toBe(false);
  });

  it('cardLink: /boards/:id?card=:id, ma hoa URL', () => {
    expect(cardLink({ id: 'c1', boardId: 'b1' })).toBe('/boards/b1?card=c1');
    expect(cardLink({ id: 'c/1?', boardId: 'b 1' })).toBe('/boards/b%201?card=c%2F1%3F');
  });

  it('ngay gio theo GIO VIET NAM (khong theo mui gio may): bien 16:59Z / 17:00Z, them nam khi khac nam', () => {
    const ref = '2026-09-30T03:05:00.000Z';
    expect(formatDateTime('2026-09-30T16:59:00.000Z', ref)).toBe('30/09 23:59');
    expect(formatDateTime('2026-09-30T17:00:00.000Z', ref)).toBe('01/10 00:00');
    expect(formatDateTime('2027-01-02T02:00:00.000Z', ref)).toBe('02/01/2027 09:00');
    expect(formatDateTime('2026-12-31T17:30:00.000Z', ref)).toBe('01/01/2027 00:30'); // UTC con 2026, VN da sang 2027
    expect(formatDate('2026-10-05T00:00:00.000Z', ref)).toBe('05/10');
    expect(formatDate('2027-10-05T00:00:00.000Z', ref)).toBe('05/10/2027');
    expect(formatTime(ref)).toBe('10:05');
    expect(formatTime('2026-09-30T17:00:00.000Z')).toBe('00:00');
  });

  it('remainingCards / appendCards: chi cau tra loi co danh sach moi "Xem thêm"; gop trang bo the trung', () => {
    expect(remainingCards({ kind: 'ANSWER', total: 13 }, 10)).toBe(3);
    expect(remainingCards({ kind: 'ANSWER', total: 10 }, 10)).toBe(0);
    expect(remainingCards({ kind: 'ANSWER', total: 5 }, 10)).toBe(0); // du lieu giam giua hai trang
    expect(remainingCards({ kind: 'CLARIFY', total: 9 }, 0)).toBe(0);
    expect(remainingCards({ kind: 'UNSUPPORTED', total: 9 }, 0)).toBe(0);
    const merged = appendCards([card('a'), card('b')], [card('b'), card('c')]);
    expect(merged.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('chatErrorText: thong diep co dau theo ma HTTP va loai yeu cau; 404 o /choice, /more = hoi thoai het han', () => {
    const rows: Array<[unknown, 'MESSAGE' | 'CHOICE' | 'MORE', string, boolean]> = [
      [httpError(429), 'MESSAGE', 'Bạn hỏi hơi nhiều trong thời gian ngắn. Hãy thử lại sau ít phút.', false],
      [httpError(403), 'MESSAGE', 'Bạn không có quyền xem phạm vi này. Hãy chọn phạm vi khác.', false],
      [httpError(404), 'MESSAGE', 'Không tìm thấy không gian hoặc bảng này. Hãy chọn phạm vi khác.', false],
      [httpError(404), 'CHOICE', 'Hội thoại đã hết hạn. Hãy hỏi lại câu hỏi.', true],
      [httpError(404), 'MORE', 'Hội thoại đã hết hạn. Hãy hỏi lại câu hỏi.', true],
      [httpError(400), 'MESSAGE', 'Câu hỏi chưa hợp lệ. Hãy viết lại ngắn hơn.', false],
      [httpError(400), 'CHOICE', 'Lựa chọn này không còn dùng được. Hãy hỏi lại.', false],
      [httpError(400), 'MORE', 'Không còn gì để xem thêm. Hãy hỏi lại.', false],
      [httpError(500), 'MESSAGE', 'Trợ lý chưa trả lời được. Hãy thử lại.', false],
      [httpError(null), 'MESSAGE', 'Không kết nối được máy chủ. Hãy kiểm tra mạng rồi thử lại.', false],
      [new Error('lap trinh'), 'MORE', 'Trợ lý chưa trả lời được. Hãy thử lại.', false],
    ];
    for (const [err, kind, text, gone] of rows) {
      expect(chatErrorText(err, kind), `${kind} ${(err as AxiosError).response?.status}`).toEqual({ text, conversationGone: gone });
    }
  });

  it('chatErrorText cho thao tac (ACTION) va 409: moi thong diep deu noi ro chua thay doi gi / nut cu het tac dung; khong lam mat hoi thoai', () => {
    const rows: Array<[unknown, 'MESSAGE' | 'CHOICE' | 'MORE' | 'ACTION', string]> = [
      [httpError(403), 'ACTION', 'Bạn không có quyền thực hiện thao tác này, hoặc trợ lý đang tắt chức năng thay đổi dữ liệu. Chưa thay đổi gì.'],
      [httpError(409), 'ACTION', 'Kế hoạch đã thay đổi hoặc đang được xử lý. Chưa thay đổi gì thêm; hãy gửi lại lệnh nếu cần.'],
      [httpError(404), 'ACTION', 'Không tìm thấy kế hoạch này (có thể đã hết hạn). Hãy gửi lại lệnh.'],
      [httpError(400), 'ACTION', 'Yêu cầu không hợp lệ nên chưa thay đổi gì. Hãy gửi lại lệnh.'],
      [httpError(429), 'ACTION', 'Bạn hỏi hơi nhiều trong thời gian ngắn. Hãy thử lại sau ít phút.'],
      [httpError(409), 'CHOICE', 'Bạn đã chuyển sang trang khác nên lựa chọn này không còn dùng được. Hãy hỏi lại ở trang này.'],
      [httpError(409), 'MORE', 'Bạn đã chuyển sang trang khác nên lựa chọn này không còn dùng được. Hãy hỏi lại ở trang này.'],
    ];
    for (const [err, kind, text] of rows) {
      // lỗi ở bước thao tác không bao giờ coi là "hội thoại đã mất" (kế hoạch nằm ở CSDL)
      expect(chatErrorText(err, kind), `${kind} ${(err as AxiosError).response?.status}`).toEqual({ text, conversationGone: false });
    }
  });
});
