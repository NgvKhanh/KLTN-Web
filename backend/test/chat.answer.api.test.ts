// Bước C - câu trả lời tự do của AI (finish.answer) trong luồng điều phối đầy đủ: qua bộ kiểm thì hiện, sai thì cho viết lại MỘT lần rồi bỏ.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import { handleV2Message } from '../src/modules/chat/v2/chat.v2.service';
import { conversationHistory, persistentMessage } from '../src/modules/chat/v2/chat.v2.history';
import { V2SessionStore } from '../src/modules/chat/v2/chat.v2.session';
import { modelTools } from '../src/modules/chat/v2/chat.v2.registry';
import { systemPrompt } from '../src/modules/chat/v2/chat.v2.orchestrator';
import type { ModelMessage } from '../src/modules/chat/v2/chat.v2.llm';
import { ACT_NOW, actionContext, script } from './chat.actions.fixture';
import { seedData } from './chat.data.fixture';

const mocks = vi.hoisted(() => ({ call: vi.fn(), available: vi.fn(() => false) }));
vi.mock('../src/modules/chat/v2/chat.v2.llm', async (original) => ({ ...(await original<object>()), callChatModel: mocks.call, v2LlmAvailable: mocks.available }));
beforeEach(() => { mocks.call.mockReset(); mocks.available.mockReturnValue(false); });

const MY = { kind: 'MY' as const };
type Steps = Parameters<typeof script>[0];
const sourcesOf = (messages: ModelMessage[]) => messages.filter((m) => m.role === 'tool').flatMap((m) => { const r = JSON.parse(m.content!); return r.source && r.tool !== 'resolve_entities' ? [r.source.id as string] : []; });
const finishWith = (answer: string, extra: Record<string, unknown> = {}) => (messages: ModelMessage[]) => [{ name: 'finish', arguments: { sourceIds: sourcesOf(messages), answer, ...extra } }];
const byAuthor = [{ name: 'query_data', arguments: { entity: 'COMMENT', groupBy: 'authorId' } }];
const ask = async (message: string, steps: Steps) => {
  const w = await seedData();
  const step = script(steps);
  const reply = await handleV2Message(w.owner.id, { message, scope: MY }, actionContext({ step, sessions: new V2SessionStore(), autoExecute: false }));
  return { w, step, reply };
};

describe('lược đồ và prompt', () => {
  it('finish nhận thêm `answer` (tối đa 1200 ký tự); mô hình được hướng dẫn cách viết và biết sẽ bị kiểm', () => {
    const finish = modelTools.find((t) => t.function.name === 'finish')!;
    const props = (finish.function.parameters as { properties: Record<string, { maxLength?: number }> }).properties;
    expect(props.answer.maxLength).toBe(1200);
    expect(props.comment.maxLength).toBe(300);
    expect(finish.function.description).toContain('Server kiểm và bỏ answer nếu sai');
    expect(systemPrompt(false)).toContain('finish.answer');
    expect(systemPrompt(false)).toContain('ANSWER_REJECTED');
  });
});

describe('câu trả lời hợp lệ', () => {
  it('hiện thành `aiAnswer` (cũng là answer.text), đứng cạnh khối dữ liệu do server dựng; số và tên khớp kết quả', async () => {
    const { reply, step } = await ask('Ai viết nhiều bình luận nhất?', [byAuthor, finishWith('Trần Tuấn viết nhiều bình luận nhất với 3 bình luận, tiếp theo là Nguyễn Lan với 2.')]);
    expect(reply.answer.aiAnswer).toEqual({ text: 'Trần Tuấn viết nhiều bình luận nhất với 3 bình luận, tiếp theo là Nguyễn Lan với 2.', source: 'AI' });
    expect(reply.answer.text).toBe(reply.answer.aiAnswer!.text);
    expect(reply.answer.kind).toBe('ANSWER');
    expect(reply.answer.blocks).toHaveLength(1);
    expect(reply.answer.notes).toEqual([]);
    expect(step).toHaveBeenCalledTimes(2);
  });

  it('số có trong CÂU HỎI của người dùng được nhắc lại, dù không có trong kết quả ("30 ngày")', async () => {
    const { reply } = await ask('Trong 30 ngày qua ai viết nhiều bình luận nhất?', [byAuthor, finishWith('Trần Tuấn viết nhiều bình luận nhất trong 30 ngày qua.')]);
    expect(reply.answer.aiAnswer?.text).toBe('Trần Tuấn viết nhiều bình luận nhất trong 30 ngày qua.');
  });

  it('chào hỏi không cần dữ liệu: finish với sourceIds rỗng + answer ngắn không số, không tên → được hiện, không có khối nào', async () => {
    const { reply } = await ask('Chào bạn, bạn làm được gì?', [[{ name: 'finish', arguments: { sourceIds: [], answer: 'Chào bạn! Mình giúp tra cứu và thao tác trên bảng công việc của bạn.' } }]]);
    expect(reply.answer.aiAnswer?.text).toContain('Chào bạn!');
    expect(reply.answer.kind).toBe('ANSWER');
    expect(reply.answer.blocks).toEqual([]);
  });

  it('ngày giờ nói theo GIỜ VIỆT NAM (16:59Z = 23:59 ngày 09/10) được chấp nhận; nói giờ UTC thì không', async () => {
    const step = (answer: string): Steps => [[{ name: 'query_data', arguments: { entity: 'CARD', fields: ['title', 'dueDate'], search: 'Báo cáo tuần' } }], finishWith(answer), finishWith(answer)];
    const good = await ask('Báo cáo tuần hạn khi nào?', step('Thẻ “Báo cáo tuần” hạn lúc 23:59 ngày 09/10.'));
    expect(good.reply.answer.aiAnswer?.text).toBe('Thẻ “Báo cáo tuần” hạn lúc 23:59 ngày 09/10.');
    const bad = await ask('Báo cáo tuần hạn khi nào?', step('Thẻ “Báo cáo tuần” hạn lúc 16:59 ngày 09/10.'));
    expect(bad.reply.answer.aiAnswer).toBeUndefined();
  });
});

describe('câu trả lời sai: cho viết lại MỘT lần', () => {
  it('số bịa → mô hình nhận ANSWER_REJECTED (kèm lý do cụ thể) → viết lại đúng → hiện; tổng 3 lượt gọi mô hình', async () => {
    let feedback = '';
    const { reply, step } = await ask('Ai viết nhiều bình luận nhất?', [
      byAuthor,
      finishWith('Trần Tuấn viết nhiều bình luận nhất với 12 bình luận.'),
      (messages) => { feedback = messages.filter((m) => m.role === 'tool').map((m) => m.content).at(-1)!; return finishWith('Trần Tuấn viết nhiều bình luận nhất với 3 bình luận.')(messages); },
    ]);
    expect(JSON.parse(feedback)).toMatchObject({ error: 'ANSWER_REJECTED', reason: 'NUMBER' });
    expect(JSON.parse(feedback).detail).toContain('“12”');
    expect(reply.answer.aiAnswer?.text).toBe('Trần Tuấn viết nhiều bình luận nhất với 3 bình luận.');
    expect(step).toHaveBeenCalledTimes(3);
  });

  it('viết lại vẫn sai → BỎ câu trả lời, vẫn hiện khối dữ liệu đúng, kèm ghi chú vì sao (không bao giờ hiện câu sai)', async () => {
    const { reply, step } = await ask('Ai viết nhiều bình luận nhất?', [byAuthor, finishWith('Hùng viết nhiều nhất.'), finishWith('Bảy bình luận là của Hùng.')]);
    expect(reply.answer.aiAnswer).toBeUndefined();
    expect(reply.answer.text).toBe('Kết quả từ dữ liệu bạn được phép xem:');
    expect(reply.answer.notes.join(' ')).toContain('không qua kiểm tra số liệu / tên');
    expect(reply.answer.blocks).toHaveLength(1);
    expect(step).toHaveBeenCalledTimes(3);
  });

  it.each([
    ['tên người không có trong kết quả', 'Việc này do Minh làm.', 'PROPER_NOUN'],
    ['số viết bằng chữ', 'Có bảy bình luận.', 'NUMBER_WORD'],
    ['liên kết', 'Xem https://evil.example để biết thêm.', 'MARKUP'],
    ['đoạn trích dẫn không có nguyên văn', 'Có bình luận “Đã duyệt toàn bộ”.', 'QUOTE'],
  ])('%s → ANSWER_REJECTED (%s)', async (_label, answer, reason) => {
    let feedback = '';
    await ask('Ai viết nhiều bình luận nhất?', [byAuthor, finishWith(answer), (messages) => { feedback = messages.filter((m) => m.role === 'tool').map((m) => m.content).at(-1)!; return finishWith('Trần Tuấn viết nhiều nhất.')(messages); }]);
    expect(JSON.parse(feedback)).toMatchObject({ error: 'ANSWER_REJECTED', reason });
  });

  it('ở vòng cuối (không còn vòng để viết lại) → bỏ ngay, không treo cuộc hội thoại', async () => {
    const { reply, step } = await ask('Ai viết nhiều bình luận nhất?', [byAuthor, [{ name: 'query_data', arguments: { entity: 'COMMENT', groupBy: 'boardId' } }], [{ name: 'query_data', arguments: { entity: 'COMMENT', groupBy: 'cardId' } }], finishWith('Có 99 bình luận.')]);
    expect(reply.answer.aiAnswer).toBeUndefined();
    expect(reply.answer.notes.join(' ')).toContain('không qua kiểm tra');
    expect(step).toHaveBeenCalledTimes(4);
  });

  it('không có dữ liệu mà bịa số / tên → bỏ; câu hỏi vẫn có phản hồi rõ ràng (không phải câu sai)', async () => {
    const { reply } = await ask('Có bao nhiêu thẻ?', [[{ name: 'finish', arguments: { sourceIds: [], answer: 'Có 7 thẻ của Lan.' } }], [{ name: 'finish', arguments: { sourceIds: [], answer: 'Có 7 thẻ của Lan.' } }]]);
    expect(reply.answer.aiAnswer).toBeUndefined();
    expect(reply.answer.kind).toBe('UNSUPPORTED');
  });

  it('answer dài quá 1200 ký tự bị schema từ chối (lỗi INVALID_ARGUMENTS gửi lại mô hình), không vào bộ kiểm', async () => {
    let feedback = '';
    const { reply } = await ask('Ai viết nhiều bình luận nhất?', [byAuthor, finishWith('Có việc. '.repeat(200)), (messages) => { feedback = messages.filter((m) => m.role === 'tool').map((m) => m.content).at(-1)!; return finishWith('Trần Tuấn viết nhiều nhất.')(messages); }]);
    expect(JSON.parse(feedback).error).toBe('INVALID_ARGUMENTS');
    expect(reply.answer.aiAnswer?.text).toBe('Trần Tuấn viết nhiều nhất.');
  });
});

describe('nhận xét ngắn (comment) vẫn hoạt động song song', () => {
  it('comment hợp lệ hiện như cũ; answer sai không làm mất comment', async () => {
    const { reply } = await ask('Có bao nhiêu bình luận?', [[{ name: 'query_data', arguments: { entity: 'COMMENT', groupBy: 'boardId' } }], (m) => [{ name: 'finish', arguments: { sourceIds: sourcesOf(m), answer: 'Có 99 bình luận.', comment: 'Có 5 bình luận trong 2 bảng.' } }], (m) => [{ name: 'finish', arguments: { sourceIds: sourcesOf(m), comment: 'Có 5 bình luận trong 2 bảng.' } }]]);
    expect(reply.answer.aiAnswer).toBeUndefined();
    expect(reply.answer.comment).toEqual({ text: 'Có 5 bình luận trong 2 bảng.', source: 'AI' });
  });
});

describe('lưu và mở lại lịch sử', () => {
  it('câu trả lời AI được lưu cùng khối dữ liệu; mở lại thấy đủ; mất quyền xem dữ liệu thì cả hai cùng bị che', async () => {
    const w = await seedData();
    const sessions = new V2SessionStore();
    const ctx = actionContext({ step: script([byAuthor, finishWith('Trần Tuấn viết nhiều bình luận nhất với 3 bình luận.')]), sessions, autoExecute: false });
    const reply = await persistentMessage(w.owner.id, { message: 'Ai viết nhiều bình luận nhất?', scope: MY }, ctx);
    const shown = (await conversationHistory(w.owner.id, reply.conversationId, undefined, ACT_NOW)).turns[0].reply!;
    expect(shown.answer.aiAnswer?.text).toContain('Trần Tuấn');
    await prisma.board.update({ where: { id: w.alpha.id }, data: { archivedAt: ACT_NOW } });
    const hidden = (await conversationHistory(w.owner.id, reply.conversationId, undefined, ACT_NOW)).turns[0].reply!;
    expect(hidden.answer.aiAnswer).toBeUndefined();
    expect(JSON.stringify(hidden)).not.toContain('Trần Tuấn viết nhiều');
  });
});
