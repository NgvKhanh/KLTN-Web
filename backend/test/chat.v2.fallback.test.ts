// Đường LÙI của chatbot v2 khi AI (Gemini) không dùng được. Sự cố thật 09/10/2026: "thêm cho tôi một thẻ ở danh sách 1. thẻ tên là kkk"
// gặp lỗi AI, rơi xuống bộ luật v1 và nhận câu "Trợ lý chưa tạo, sửa hay giao việc được" - sai sự thật (v2 tạo thẻ được) và không nêu lý do.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import { handleV2Message, looksLikeWriteCommand } from '../src/modules/chat/v2/chat.v2.service';
import { V2SessionStore } from '../src/modules/chat/v2/chat.v2.session';
import type { ModelFailReason, ModelStep } from '../src/modules/chat/v2/chat.v2.llm';
import { actionContext, seedActions } from './chat.actions.fixture';

const mocks = vi.hoisted(() => ({ call: vi.fn(), available: vi.fn(() => false) }));
vi.mock('../src/modules/chat/v2/chat.v2.llm', async (original) => ({ ...(await original<object>()), callChatModel: mocks.call, v2LlmAvailable: mocks.available }));
beforeEach(() => { mocks.call.mockReset(); mocks.available.mockReturnValue(false); });

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');
const asks = (folded: string) => /\?|(?:^|\s)(?:nao|gi|ai|bao nhieu|khi nao)(?:\s|$)/.test(folded);
const isWrite = (message: string) => { const f = fold(message); return looksLikeWriteCommand(f, asks(f)); };
const failing = (reason: ModelFailReason) => vi.fn<ModelStep>().mockResolvedValue({ ok: false, reason });
const onBoard = (b: { id: string }) => ({ kind: 'BOARD' as const, boardId: b.id });
const planRows = () => prisma.chatActionPlan.count();

describe('looksLikeWriteCommand: nhận diện lệnh ghi nói thẳng ở đầu câu', () => {
  it.each([
    'Thêm cho tôi một thẻ ở danh sách 1. thẻ tên là kkk',
    'thêm task Họp tuần', 'Bổ sung các việc còn thiếu cho giai đoạn kiểm thử', 'Mở rộng bảng với phần marketing',
    'Đổi tên thẻ Login UI thành Đăng nhập', 'Đặt hạn thẻ Login UI là thứ sáu', 'Gán thẻ Login UI cho Lan', 'Giao thẻ Login UI cho Lan',
    'Đánh dấu thẻ Login UI là xong', 'Cập nhật hạn thẻ Login UI', 'Di chuyển thẻ Login UI sang Đang làm', 'Kéo thẻ Login UI sang Đang làm',
    // các động từ cũ vẫn nhận ra
    'Tạo cột Kiểm thử', 'Chuyển Login UI sang Đang làm', 'Xóa thẻ Login UI', 'Hãy thêm thẻ Họp tuần', 'Vui lòng giao việc này cho Lan',
    'Thêm thẻ Họp tuần giúp tôi', 'Tôi muốn thêm một cột mới',
    // bước D: động từ ghi mới
    'Bỏ Lan khỏi thẻ Login UI', 'Gỡ nhãn Gấp khỏi thẻ Login UI', 'Rút Lan khỏi thẻ Login UI', 'Viết bình luận vào thẻ Login UI: ok', 'Lưu trữ thẻ Login UI', 'Đặt ngày bắt đầu thẻ Login UI là 10/10', 'Bình luận vào thẻ Login UI: xong rồi',
  ])('lệnh ghi: %s', (message) => { expect(isWrite(message)).toBe(true); });

  it.each([
    'Gần đây có gì thay đổi?', 'Gán cho ai nhiều việc nhất?', 'Cập nhật mới nhất của bảng này là gì?', 'Giao diện nào hay nhất?',
    'Giao diện bảng này có mấy cột?', 'Bảng này có những ai?', 'Việc nào của tôi sắp đến hạn?', 'Thêm bao nhiêu thẻ trong tuần này?',
    // cố ý KHÔNG chặn sớm: "Đưa" do mô hình xử lý, công cụ ghi chỉ được cấp cho người sửa được (chat.actions.safety.test.ts)
    'Đưa Login UI sang Đang làm',
    'Bình luận nào mới nhất?', 'Viết gì trong mô tả thẻ Login UI?', 'Bỏ hạn nào quá lâu rồi?',
  ])('không phải lệnh ghi: %s', (message) => { expect(isWrite(message)).toBe(false); });
});

describe('AI lỗi giữa LỆNH ghi: nói rõ chưa thay đổi gì, không rơi xuống v1', () => {
  it.each(['HTTP', 'INVALID'] as const)('lệnh "thêm..." + lỗi %s → câu chung, không có câu sai sự thật của v1', async (reason) => {
    const f = await seedActions();
    const reply = await handleV2Message(f.owner.id, { message: 'thêm cho tôi một thẻ ở danh sách 1. thẻ tên là kkk', scope: onBoard(f.alpha) }, actionContext({ step: failing(reason) }));
    expect(reply.mode).toBe('BASIC');
    expect(reply.answer.text).toBe('Trợ lý chưa xử lý được lệnh này nên chưa thay đổi gì. Hãy thử lại sau.');
    expect(reply.answer.text).not.toContain('chưa tạo, sửa hay giao việc');
    expect(await planRows()).toBe(0);
    expect(await prisma.card.count({ where: { title: 'kkk' } })).toBe(0);
  });

  it.each([
    ['QUOTA', 'AI đã hết hạn mức hoặc đang quá tải'], ['BUDGET', 'AI đã hết hạn mức hoặc đang quá tải'],
    ['TIMEOUT', 'AI phản hồi quá chậm'], ['NETWORK', 'không kết nối được tới AI'],
  ] as const)('lệnh ghi + lỗi %s → nêu đúng nguyên nhân', async (reason, why) => {
    const f = await seedActions();
    const reply = await handleV2Message(f.owner.id, { message: 'Thêm thẻ Họp tuần', scope: onBoard(f.alpha) }, actionContext({ step: failing(reason) }));
    expect(reply.answer.text).toBe(`Trợ lý chưa xử lý được lệnh này vì ${why} nên chưa thay đổi gì. Hãy thử lại sau ít phút.`);
    expect(await prisma.card.count({ where: { title: 'Họp tuần' } })).toBe(0);
  });

  it('lệnh có động từ ghi Ở GIỮA câu (không bắt đầu bằng động từ) cũng không rơi xuống v1 khi AI lỗi', async () => {
    const f = await seedActions();
    const reply = await handleV2Message(f.owner.id, { message: 'Trong bảng này hãy đưa Login UI sang Đang làm và thêm thẻ kkk', scope: onBoard(f.alpha) }, actionContext({ step: failing('QUOTA') }));
    expect(reply.answer.text).toContain('hết hạn mức');
    expect(reply.answer.text).toContain('chưa thay đổi gì');
    expect(await planRows()).toBe(0);
  });
});

describe('chặn sớm lệnh "mềm" (thêm, gán...) cho người không được ghi hoặc khi không có AI', () => {
  it('VIEWER nói "Thêm thẻ ..." → báo chỉ có quyền xem, không gọi mô hình', async () => {
    const f = await seedActions();
    const step = vi.fn<ModelStep>();
    const reply = await handleV2Message(f.viewer.id, { message: 'Thêm thẻ kkk', scope: onBoard(f.alpha) }, actionContext({ step }));
    expect(reply.answer.text).toContain('Bạn chỉ có quyền xem bảng này');
    expect(step).not.toHaveBeenCalled();
  });

  it('không có AI: "Thêm thẻ ..." được báo cần bật AI, không đoán bằng luật', async () => {
    const f = await seedActions();
    const reply = await handleV2Message(f.owner.id, { message: 'Thêm thẻ kkk', scope: onBoard(f.alpha) }, actionContext({ available: false }));
    expect(reply.answer.text).toContain('Cần bật AI để thực hiện thao tác');
    expect(await prisma.card.count({ where: { title: 'kkk' } })).toBe(0);
  });
});

describe('AI lỗi giữa CÂU HỎI: chế độ cơ bản có ghi chú lý do, không nói sai về chức năng', () => {
  it('câu hỏi bộ luật cơ bản hiểu được vẫn trả lời, kèm ghi chú vì sao đang ở chế độ cơ bản', async () => {
    const f = await seedActions();
    const reply = await handleV2Message(f.owner.id, { message: 'Việc nào của tôi sắp đến hạn?', scope: onBoard(f.alpha) }, actionContext({ step: failing('QUOTA') }));
    expect(reply.mode).toBe('BASIC');
    expect(reply.answer.notes.join(' ')).toContain('AI chưa phản hồi (AI đã hết hạn mức hoặc đang quá tải) nên đây là kết quả của chế độ cơ bản.');
  });

  it('câu bộ luật không hiểu (UNSUPPORTED của v1) → câu mới nêu lý do AI, không còn "chưa tạo, sửa hay giao việc được"', async () => {
    const f = await seedActions();
    const reply = await handleV2Message(f.owner.id, { message: 'Hôm nay thời tiết ở Hà Nội thế nào hả bạn', scope: onBoard(f.alpha) }, actionContext({ step: failing('TIMEOUT') }));
    expect(reply.answer.kind).toBe('UNSUPPORTED');
    expect(reply.answer.text).toContain('Chế độ cơ bản chưa hiểu câu này và AI phản hồi quá chậm');
    expect(reply.answer.text).not.toContain('chưa tạo, sửa hay giao việc');
  });

  it('lỗi chung (HTTP) không bịa lý do; vẫn có ghi chú chế độ cơ bản', async () => {
    const f = await seedActions();
    const reply = await handleV2Message(f.owner.id, { message: 'Hôm nay thời tiết ở Hà Nội thế nào hả bạn', scope: onBoard(f.alpha) }, actionContext({ step: failing('HTTP') }));
    expect(reply.answer.text).toBe('Chế độ cơ bản chưa hiểu câu này. Hãy thử lại sau ít phút, hoặc hỏi theo các mẫu gợi ý bên dưới. Chưa thay đổi gì.');
    expect(reply.answer.notes).toContain('AI chưa phản hồi nên đây là kết quả của chế độ cơ bản.');
  });

  it('AI không được cấu hình (không có lượt gọi nào thất bại) → KHÔNG thêm ghi chú lỗi AI', async () => {
    const f = await seedActions();
    const reply = await handleV2Message(f.owner.id, { message: 'Hôm nay thời tiết ở Hà Nội thế nào hả bạn', scope: onBoard(f.alpha) }, { now: actionContext().now, sessions: new V2SessionStore(), available: false });
    expect(reply.answer.notes.join(' ')).not.toContain('AI chưa phản hồi');
  });
});
