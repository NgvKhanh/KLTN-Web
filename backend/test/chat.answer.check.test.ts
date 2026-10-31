// Bộ kiểm câu trả lời tự do (bước C) - hàm thuần: chặn bịa SỐ và bịa TÊN, cho phép cách nói tự nhiên của tiếng Việt.
import { describe, expect, it } from 'vitest';
import { MAX_ANSWER_CHARS, collectFacts, validateAnswer } from '../src/modules/chat/v2/answer/answer.check';

const RESULTS = [
  { tool: 'aggregate_tasks', data: { totalCards: 7, highestCount: 3, rows: [{ id: 'cmts0yh12345', label: 'Nguyễn Lan', count: 3 }, { id: 'cmtq9zz777', label: 'Trần Tuấn', count: 2 }, { id: 'u3', label: 'Nam', count: 0 }] } },
  { tool: 'query_tasks', data: { total: 2, cards: [{ id: 'cmtsaaa999', title: 'Login UI', dueDate: '2026-10-09T16:59:00.000Z', columnName: 'Đang làm' }, { id: 'c2', title: 'API thanh toán', dueDate: null, columnName: 'Cần làm' }] } },
];
const facts = collectFacts(RESULTS, ['Ai đang giữ nhiều việc nhất trong 7 ngày qua?']);
const ok = (t: string) => expect(validateAnswer(t, facts), t).toMatchObject({ ok: true });
const bad = (t: string, reason: string) => expect(validateAnswer(t, facts), t).toMatchObject({ ok: false, reason });

describe('câu trả lời hợp lệ', () => {
  it.each([
    'Có 7 việc chưa xong. Nguyễn Lan đang giữ nhiều nhất với 3 việc.',
    'Việc “Login UI” hạn lúc 23:59 ngày 09/10 (giờ Việt Nam).',
    '- Nguyễn Lan: 3 việc\n- Trần Tuấn: 2 việc',
    '1. Login UI\n2. API thanh toán',
    'Hạn vào thứ Sáu, thứ Hai hoặc thứ Ba đều có thể.',
    'Việc này do Nam làm, hiện chưa có việc nào khác.',
    'Trong 7 ngày qua, Trần Tuấn giữ ít việc hơn Nguyễn Lan.',
    'Thẻ API thanh toán nằm ở cột Cần làm và chưa có hạn.',
    'Chào bạn! Mình là trợ lý TaskFlow.',
    // từ thường ngày trùng số đếm khi bỏ dấu (sau/sáu, nam/năm, làm/lăm) không bị chặn nhầm
    'Việc này xong sau khi Trần Tuấn review, nam giới không liên quan.',
    // xuống dòng bắt đầu một câu mới: từ mở đầu thông dụng của dòng sau không bị coi là tên riêng giữa câu
    'Kết quả như sau\nTổng cộng có 7 việc',
  ])('cho qua: %s', (t) => ok(t));

  it('câu có thể xuống dòng và gạch đầu dòng; trả về đúng văn bản đã chuẩn hóa NFC', () => {
    const r = validateAnswer('  Có 7 việc.\n- Nguyễn Lan: 3 việc  ', facts);
    expect(r).toEqual({ ok: true, text: 'Có 7 việc.\n- Nguyễn Lan: 3 việc' });
  });
});

describe('bịa SỐ bị chặn', () => {
  it.each([
    ['Có 12 việc chưa xong.', 'NUMBER'], ['Nguyễn Lan giữ 4 việc.', 'NUMBER'],
    ['Có 2,5 việc mỗi người.', 'DECIMAL'], ['Tổng cộng 1.500 việc.', 'DECIMAL'],
    ['Có bảy việc chưa xong.', 'NUMBER_WORD'], ['Mỗi người một việc.', 'NUMBER_WORD'], ['Khoảng vài chục việc.', 'NUMBER_WORD'],
    ['Có ٣ việc.', 'NUMBER'],
  ])('%s', (t, reason) => bad(t, reason));

  it('id nội bộ KHÔNG làm sạch tập số hợp lệ (chữ số trong cuid không được dùng làm "số liệu")', () => {
    expect(validateAnswer('Có 12345 việc.', facts)).toMatchObject({ ok: false, reason: 'NUMBER' });
    expect(validateAnswer('Có 999 việc.', facts)).toMatchObject({ ok: false, reason: 'NUMBER' });
  });

  it('ngày giờ phải theo GIỜ VIỆT NAM, không phải giờ UTC trong dữ liệu (16:59Z = 23:59 ngày 09/10 giờ VN)', () => {
    ok('Hạn lúc 23:59 ngày 09/10.');
    bad('Hạn lúc 16:59 ngày 09/10.', 'NUMBER');
  });

  it('số nằm trong CÂU HỎI của người dùng được phép nhắc lại (7 ngày qua)', () => {
    ok('Trong 7 ngày qua có 2 việc.');
    expect(validateAnswer('Trong 30 ngày qua có 2 việc.', facts)).toMatchObject({ ok: false, reason: 'NUMBER' });
  });
});

describe('bịa TÊN bị chặn', () => {
  it.each([
    ['Việc này do Minh làm.', 'PROPER_NOUN'], ['Hùng đang giữ nhiều việc nhất.', 'PROPER_NOUN'],
    ['Thẻ Đăng ký tài khoản đang trễ.', 'PROPER_NOUN'], ['Việc “Đăng ký” quá hạn.', 'QUOTE'],
    ['Việc “Login UI mới” quá hạn.', 'QUOTE'],
  ])('%s', (t, reason) => bad(t, reason));

  it('đoạn trong ngoặc kép phải khớp nguyên văn một chuỗi trong dữ liệu (không phân biệt hoa thường / dấu)', () => {
    ok('Thẻ “login ui” và thẻ “API THANH TOÁN” đều chưa xong.');
    ok('Thẻ “Thanh toán” chưa xong.');
  });
});

describe('tên người trùng số đếm', () => {
  it('người tên Ba / Hai có trong dữ liệu không bị coi là số viết bằng chữ; "ba" thường thì vẫn bị chặn', () => {
    const f2 = collectFacts([{ rows: [{ id: 'u1', label: 'Ba' }, { id: 'u2', label: 'Hai' }] }]);
    expect(validateAnswer('Việc này do Ba làm, Hai kiểm tra.', f2)).toMatchObject({ ok: true });
    expect(validateAnswer('Có ba việc.', f2)).toMatchObject({ ok: false, reason: 'NUMBER_WORD' });
    expect(validateAnswer('Có sáu việc.', f2)).toMatchObject({ ok: false, reason: 'NUMBER_WORD' });
  });
});

describe('hình thức', () => {
  it.each([
    ['**Có** 7 việc.', 'MARKUP'], ['Xem https://evil.example để biết thêm.', 'MARKUP'], ['Xem www.evil.example.', 'MARKUP'], ['[Login UI](x) còn mở.', 'MARKUP'],
    ['Liên hệ a@b.com.', 'MARKUP'], ['Hạn lúc 2026-10-09T16:59:00.000Z.', 'TIMESTAMP'], ['Viết lúc 2026-10-07T01:00:00Z.', 'TIMESTAMP'], ['<b>7</b> việc', 'MARKUP'], ['Có `7` việc.', 'MARKUP'], ['', 'EMPTY'], ['   ', 'EMPTY'],
  ])('%j', (t, reason) => bad(t, reason));

  it('quá dài → TOO_LONG', () => { bad('Có việc. '.repeat(MAX_ANSWER_CHARS), 'TOO_LONG'); });
  it('mốc ISO bị loại với lời nhắc RIÊNG (nói ngày dd/mm, giờ Việt Nam) chứ không bị báo nhầm là số thập phân; ngày thuần YYYY-MM-DD trong dữ liệu thì được', () => {
    const r = validateAnswer('Hạn lúc 2026-10-09T16:59:00.000Z.', facts);
    expect(r).toMatchObject({ ok: false, reason: 'TIMESTAMP' });
    if (!r.ok) expect(r.detail).toContain('GIỜ VIỆT NAM');
    ok('Hạn ngày 09/10.');
  });

  it('lý do trả về nói rõ cần sửa gì để mô hình viết lại', () => {
    const r = validateAnswer('Có 12 việc.', facts);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.detail).toContain('“12”'); expect(r.detail).toContain('groupBy'); }
    const n = validateAnswer('Việc này do Minh làm.', facts);
    if (!n.ok) expect(n.detail).toContain('“Minh”');
  });
});

describe('bộ gom sự thật', () => {
  it('không có kết quả nào: chỉ lời nói chung được qua (chào hỏi, giới thiệu), mọi số và tên đều bị chặn', () => {
    const empty = collectFacts([]);
    expect(validateAnswer('Chào bạn! Mình giúp tra cứu và thao tác trên bảng công việc.', empty)).toMatchObject({ ok: true });
    expect(validateAnswer('Có 3 việc.', empty)).toMatchObject({ ok: false, reason: 'NUMBER' });
    expect(validateAnswer('Việc của Lan.', empty)).toMatchObject({ ok: false, reason: 'PROPER_NOUN' });
  });
});
