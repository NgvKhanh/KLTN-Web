// Bước D - 8 thao tác mới (sửa nội dung + dọn dẹp thẻ): hàm THUẦN (schema, giấy phép động từ, nguồn gốc, chính sách tự chạy, mâu thuẫn, chữ hiển thị).
import { describe, expect, it } from 'vitest';
import { ACTION_TYPES, AUTO_RUN_TYPES, CONTENT_TYPES, STRUCTURE_TYPES, proposeActionsSchema, PROPOSE_ACTIONS_PROVIDER_SCHEMA, type ActionOp } from '../src/modules/chat/v2/actions/actions.schema';
import { foldWords, licenceFor } from '../src/modules/chat/v2/actions/actions.text';
import { assessPlanProvenance, assessProvenance } from '../src/modules/chat/v2/actions/actions.provenance';
import { decideExecution, type DecisionInput } from '../src/modules/chat/v2/actions/actions.autorun';
import { dedupeOps } from '../src/modules/chat/v2/actions/actions.resolve';
import { describeOp, descriptionHash, OP_LABEL, staleReasonOf, summarizeExecuted } from '../src/modules/chat/v2/actions/actions.plan';
import { groundStart } from '../src/modules/chat/v2/actions/actions.dates';
import { slotsOf } from '../src/modules/chat/v2/actions/actions.refs';
import { shapePlan } from '../src/modules/chat/v2/actions/actions.graph';
import type { StoredOp } from '../src/modules/chat/v2/actions/actions.types';

const TODAY = '2026-10-07'; // thứ Tư
const T = (text: string) => ({ by: 'TEXT' as const, text });
const op = (o: unknown) => o as ActionOp;
const lic = (type: string, message: string) => licenceFor(type, foldWords(message));

describe('hợp đồng: 8 thao tác mới', () => {
  it('danh sách loại thao tác; 3 thao tác chính xác được tự chạy, nội dung / cấu trúc / lưu trữ thì không', () => {
    expect([...ACTION_TYPES].slice(10, 18)).toEqual(['SET_CARD_DESCRIPTION', 'SET_CARD_START', 'ADD_COMMENT', 'ADD_CHECKLIST', 'REMOVE_MEMBER', 'REMOVE_LABEL', 'RENAME_LIST', 'ARCHIVE_CARD']);
    expect([...AUTO_RUN_TYPES].slice(0, 10)).toEqual(['CREATE_CARD', 'RENAME_CARD', 'SET_CARD_DUE', 'MOVE_CARD', 'SET_CARD_STATUS', 'ASSIGN_MEMBER', 'ADD_LABEL', 'SET_CARD_START', 'REMOVE_MEMBER', 'REMOVE_LABEL']);
    expect([...CONTENT_TYPES]).toEqual(['SET_CARD_DESCRIPTION', 'ADD_COMMENT', 'ADD_CHECKLIST', 'EDIT_COMMENT', 'REPLY_COMMENT', 'ADD_CHECKLIST_ITEM', 'EDIT_CHECKLIST_ITEM', 'RENAME_CHECKLIST']);
    expect([...STRUCTURE_TYPES]).toEqual(['CREATE_LIST', 'RENAME_LIST']);
    for (const t of ACTION_TYPES) expect(OP_LABEL[t].length).toBeGreaterThan(3);
    expect(PROPOSE_ACTIONS_PROVIDER_SCHEMA.properties.operations.items.properties.type.enum).toEqual([...ACTION_TYPES]);
    for (const k of ['description', 'text', 'items', 'start']) expect(PROPOSE_ACTIONS_PROVIDER_SCHEMA.properties.operations.items.properties).toHaveProperty(k);
  });

  it.each([
    { type: 'SET_CARD_DESCRIPTION', card: T('Login'), description: 'Thiết kế màn hình đăng nhập' },
    { type: 'SET_CARD_START', card: T('Login'), start: { type: 'ABSOLUTE', date: '2026-10-10' } },
    { type: 'ADD_COMMENT', card: T('Login'), text: 'Đã review xong' },
    { type: 'ADD_CHECKLIST', card: T('Login'), title: 'Kiểm thử', items: ['Unit test', 'API test'] },
    { type: 'ADD_CHECKLIST', card: { by: 'PLAN', key: 'c1' }, items: ['a'] },
    { type: 'REMOVE_MEMBER', card: T('Login'), member: T('Lan') },
    { type: 'REMOVE_MEMBER', card: { by: 'CONTEXT', slot: 'LAST_CARD' }, member: { by: 'SELF' } },
    { type: 'REMOVE_LABEL', card: T('Login'), label: T('Gấp') },
    { type: 'RENAME_LIST', list: T('Cần làm'), name: 'Việc cần làm' },
    { type: 'ARCHIVE_CARD', card: T('Login') },
  ])('schema nhận: $type', (o) => { expect(proposeActionsSchema.safeParse({ operations: [o] }).success).toBe(true); });

  it.each([
    [{ type: 'SET_CARD_DESCRIPTION', card: T('Login'), description: '' }, 'mô tả rỗng'],
    [{ type: 'SET_CARD_DESCRIPTION', card: T('Login'), description: 'x'.repeat(1001) }, 'mô tả quá dài'],
    [{ type: 'ADD_COMMENT', card: T('Login'), text: 'x', cardId: 'abc' }, 'khóa lạ cardId'],
    [{ type: 'ADD_COMMENT', card: { by: 'ID', id: 'abc' }, text: 'x' }, 'tham chiếu bằng id'],
    [{ type: 'ADD_CHECKLIST', card: T('Login'), items: [] }, 'không có mục'],
    [{ type: 'ADD_CHECKLIST', card: T('Login'), items: Array.from({ length: 21 }, (_, i) => `m${i}`) }, '21 mục'],
    [{ type: 'REMOVE_MEMBER', card: T('Login'), member: { by: 'BEST' } }, 'BEST chỉ dành cho giao việc'],
    [{ type: 'REMOVE_MEMBER', card: T('Login'), userId: 'u1' }, 'khóa lạ userId'],
    [{ type: 'RENAME_LIST', list: T('A'), name: 'x'.repeat(101) }, 'tên cột quá dài'],
    [{ type: 'ARCHIVE_CARD', card: T('Login'), hard: true }, 'khóa lạ hard'],
    [{ type: 'PURGE_CARD', card: T('Login') }, 'không có thao tác xóa vĩnh viễn'],
    [{ type: 'SET_CARD_START', card: T('Login'), start: { type: 'ABSOLUTE', date: '10/10' } }, 'ngày sai khuôn'],
  ])('schema từ chối: %j (%s)', (o) => { expect(proposeActionsSchema.safeParse({ operations: [o] }).success).toBe(false); });

  it('ô tham chiếu: mỗi thao tác khai đủ thẻ / người / nhãn / cột (nguồn của provenance, đồ thị và bộ giải)', () => {
    const names = (o: unknown) => slotsOf(op(o)).map((s) => `${s.name}:${s.kind}`);
    expect(names({ type: 'REMOVE_MEMBER', card: T('a'), member: T('b') })).toEqual(['card:card', 'member:member']);
    expect(names({ type: 'REMOVE_LABEL', card: T('a'), label: T('b') })).toEqual(['card:card', 'label:label']);
    expect(names({ type: 'RENAME_LIST', list: T('a'), name: 'b' })).toEqual(['list:list']);
    for (const t of ['SET_CARD_DESCRIPTION', 'SET_CARD_START', 'ADD_COMMENT', 'ADD_CHECKLIST', 'ARCHIVE_CARD']) expect(names({ type: t, card: T('a') })).toEqual(['card:card']);
  });

  it('"tạo thẻ rồi thêm checklist cho nó": đồ thị nối ADD_CHECKLIST vào thẻ MỚI, chạy sau khi thẻ được tạo', () => {
    const shaped = shapePlan([op({ type: 'ADD_CHECKLIST', card: { by: 'CONTEXT', slot: 'LAST_CARD' }, items: ['a'] }), op({ type: 'CREATE_CARD', title: 'Deploy' })]);
    // thao tác tạo viết SAU vẫn chạy trước vì checklist phụ thuộc vào nó? CONTEXT chỉ nối vào thao tác tạo viết TRƯỚC - ở đây không nối, giữ thứ tự
    expect(shaped.ok).toBe(true);
    const ordered = shapePlan([op({ type: 'CREATE_CARD', title: 'Deploy' }), op({ type: 'ADD_CHECKLIST', card: { by: 'CONTEXT', slot: 'LAST_CARD' }, items: ['a'] })]);
    expect(ordered.ok && ordered.ops[1]).toMatchObject({ type: 'ADD_CHECKLIST', card: { by: 'PLAN' } });
  });
});

describe('giấy phép động từ: chỉ CÂU của người dùng mới cấp phép', () => {
  it.each([
    ['SET_CARD_DESCRIPTION', 'Đổi mô tả thẻ Login UI thành thiết kế màn hình'], ['SET_CARD_DESCRIPTION', 'Viết mô tả cho thẻ Login: cần làm sớm'], ['SET_CARD_DESCRIPTION', 'Mô tả thẻ Login UI: thiết kế màn hình'], ['SET_CARD_DESCRIPTION', 'Cập nhật mô tả của thẻ Login'],
    ['SET_CARD_START', 'Đặt ngày bắt đầu thẻ Login là 10/10'], ['SET_CARD_START', 'Thẻ Login bắt đầu từ thứ hai'], ['SET_CARD_START', 'Cho thẻ Login khởi công vào 12/10'],
    ['ADD_COMMENT', 'Thêm bình luận vào thẻ Login: đã review xong'], ['ADD_COMMENT', 'Viết bình luận cho thẻ Login rằng đã xong'], ['ADD_COMMENT', 'Bình luận vào thẻ Login: xong rồi'], ['ADD_COMMENT', 'Comment vào thẻ Login: ok'],
    ['ADD_CHECKLIST', 'Thêm checklist vào thẻ Login gồm: build, test'], ['ADD_CHECKLIST', 'Tạo checklist cho thẻ Deploy'], ['ADD_CHECKLIST', 'Thêm các việc con vào thẻ Login'],
    ['REMOVE_MEMBER', 'Bỏ Lan khỏi thẻ Login'], ['REMOVE_MEMBER', 'Gỡ Lan khỏi task Login UI'], ['REMOVE_MEMBER', 'Hủy giao thẻ Login cho Lan'], ['REMOVE_MEMBER', 'Thu hồi thẻ Login từ Lan'],
    ['REMOVE_LABEL', 'Bỏ nhãn Gấp khỏi thẻ Login'], ['REMOVE_LABEL', 'Gỡ label Backend khỏi thẻ Login'], ['REMOVE_LABEL', 'Xóa nhãn Gấp của thẻ Login'],
    ['RENAME_LIST', 'Đổi tên cột Cần làm thành Việc cần làm'], ['RENAME_LIST', 'Sửa tên danh sách Đang làm thành Đang thực hiện'],
    ['ARCHIVE_CARD', 'Lưu trữ thẻ Login UI'], ['ARCHIVE_CARD', 'Archive thẻ Login'],
  ])('%s được phép: %s', (type, message) => { expect(lic(type, message)).toMatchObject({ licensed: true, negated: false }); });

  it.each([
    ['SET_CARD_DESCRIPTION', 'Chuyển thẻ Login sang Đang làm'], ['SET_CARD_DESCRIPTION', 'Thẻ Login nằm ở cột nào'],
    ['SET_CARD_START', 'Đặt hạn thẻ Login là thứ sáu'], ['SET_CARD_START', 'Thẻ Login chưa bắt đầu'],
    ['ADD_COMMENT', 'Thêm thẻ Login vào cột Đang làm'], ['ADD_COMMENT', 'Đổi tên thẻ Login'],
    ['ADD_CHECKLIST', 'Thêm thẻ Deploy vào cột Cần làm'], ['ADD_CHECKLIST', 'Tạo cột Kiểm thử'],
    ['REMOVE_MEMBER', 'Giao thẻ Login cho Lan'], ['REMOVE_MEMBER', 'Bỏ hạn của thẻ Login'], ['REMOVE_MEMBER', 'Thêm Lan vào thẻ Login'],
    ['REMOVE_LABEL', 'Gắn nhãn Gấp vào thẻ Login'], ['REMOVE_LABEL', 'Bỏ hạn thẻ Login'],
    ['RENAME_LIST', 'Đổi tên thẻ Login thành Đăng nhập'], ['RENAME_LIST', 'Tạo cột Kiểm thử'],
    ['ARCHIVE_CARD', 'Chuyển thẻ Login sang Hoàn thành'], ['ARCHIVE_CARD', 'Xóa thẻ Login'],
  ])('%s KHÔNG được phép: %s', (type, message) => { expect(lic(type, message).licensed).toBe(false); });

  it.each([
    ['REMOVE_MEMBER', 'Đừng bỏ Lan khỏi thẻ Login'], ['ARCHIVE_CARD', 'Không lưu trữ thẻ Login'], ['ADD_COMMENT', 'Đừng thêm bình luận vào thẻ Login'],
    ['REMOVE_LABEL', 'Không gỡ nhãn Gấp khỏi thẻ Login'], ['RENAME_LIST', 'Đừng đổi tên cột Cần làm'], ['SET_CARD_DESCRIPTION', 'Không đổi mô tả thẻ Login'],
  ])('%s bị phủ định: %s', (type, message) => { expect(lic(type, message)).toMatchObject({ licensed: true, negated: true }); });
});

describe('nguồn gốc: nội dung phải là chữ CHÍNH người dùng gõ', () => {
  const today = TODAY;
  const verdict = (o: unknown, message: string) => assessProvenance(op(o), message, today).verdict;

  it('đủ giấy phép + nội dung có trong câu → lệnh trực tiếp', () => {
    expect(verdict({ type: 'ADD_COMMENT', card: T('Login UI'), text: 'đã review xong' }, 'Thêm bình luận vào thẻ Login UI: đã review xong')).toBe('USER_DIRECT');
    expect(verdict({ type: 'SET_CARD_DESCRIPTION', card: T('Login UI'), description: 'thiết kế màn hình đăng nhập' }, 'Đổi mô tả thẻ Login UI thành thiết kế màn hình đăng nhập')).toBe('USER_DIRECT');
    expect(verdict({ type: 'ADD_CHECKLIST', card: T('Login UI'), items: ['build', 'test'] }, 'Thêm checklist vào thẻ Login UI gồm: build, test')).toBe('USER_DIRECT');
    expect(verdict({ type: 'RENAME_LIST', list: T('Cần làm'), name: 'Việc cần làm' }, 'Đổi tên cột Cần làm thành Việc cần làm')).toBe('USER_DIRECT');
    expect(verdict({ type: 'REMOVE_MEMBER', card: T('Login UI'), member: T('Lan') }, 'Bỏ Lan khỏi thẻ Login UI')).toBe('USER_DIRECT');
  });

  it('mô hình tự viết / diễn đạt lại nội dung → UNGROUNDED (phải xem lại), không phải lệnh trực tiếp', () => {
    expect(verdict({ type: 'ADD_COMMENT', card: T('Login UI'), text: 'Công việc này đã được kiểm tra kỹ lưỡng và phê duyệt' }, 'Thêm bình luận vào thẻ Login UI: đã review xong')).toBe('UNGROUNDED');
    expect(verdict({ type: 'SET_CARD_DESCRIPTION', card: T('Login UI'), description: 'Màn hình đăng nhập gồm email, mật khẩu và nút quên mật khẩu' }, 'Đổi mô tả thẻ Login UI thành thiết kế màn hình')).toBe('UNGROUNDED');
    expect(verdict({ type: 'ADD_CHECKLIST', card: T('Login UI'), items: ['build', 'test', 'deploy lên production'] }, 'Thêm checklist vào thẻ Login UI gồm: build, test')).toBe('UNGROUNDED');
  });

  it('câu KHÔNG yêu cầu thao tác (hỏi thông tin, hay nhờ việc khác) → từ chối, không cho xem trước', () => {
    expect(verdict({ type: 'ARCHIVE_CARD', card: T('Login UI') }, 'Thẻ Login UI đang ở đâu?')).toBe('NOT_REQUESTED');
    expect(verdict({ type: 'REMOVE_MEMBER', card: T('Login UI'), member: T('Lan') }, 'Ai đang làm thẻ Login UI?')).toBe('NOT_REQUESTED');
    expect(verdict({ type: 'ADD_COMMENT', card: T('Login UI'), text: 'ok' }, 'Có bao nhiêu bình luận ở thẻ Login UI?')).not.toBe('USER_DIRECT');
    expect(verdict({ type: 'RENAME_LIST', list: T('Cần làm'), name: 'Xong' }, 'Cột Cần làm có bao nhiêu thẻ?')).toBe('NOT_REQUESTED');
  });

  it('chỉ dẫn nằm trong DỮ LIỆU ("làm theo mô tả của thẻ") không phải lệnh của người dùng', () => {
    expect(verdict({ type: 'REMOVE_MEMBER', card: T('Login UI'), member: T('Lan') }, 'Bỏ Lan khỏi thẻ Login UI theo mô tả của thẻ')).toBe('DELEGATED_TO_DATA');
    expect(verdict({ type: 'ARCHIVE_CARD', card: T('Login UI') }, 'Lưu trữ thẻ Login UI làm theo nội dung bình luận')).toBe('DELEGATED_TO_DATA');
  });

  it('ngày BẮT ĐẦU phải có mặt trong câu với vai trò bắt đầu (ngày hạn không được tính)', () => {
    const start = (message: string, date: string) => groundStart({ type: 'ABSOLUTE', date }, message, TODAY);
    expect(start('Đặt ngày bắt đầu thẻ Login là 10/10', '2026-10-10')).toMatchObject({ grounded: true, resolution: { kind: 'DATE', date: '2026-10-10' } });
    expect(start('Thẻ Login bắt đầu từ 12/10', '2026-10-12').grounded).toBe(true);
    expect(start('Đặt hạn thẻ Login là 10/10', '2026-10-10').grounded).toBe(false);
    // mô hình khai ngày khác ngày trong câu → dùng ngày trong câu
    expect(start('Đặt ngày bắt đầu thẻ Login là 10/10', '2026-10-15')).toMatchObject({ grounded: true, llmDiffers: true, resolution: { date: '2026-10-10' } });
    expect(groundStart({ type: 'NONE' }, 'Bỏ ngày bắt đầu của thẻ Login', TODAY)).toMatchObject({ grounded: true, resolution: { kind: 'CLEAR' } });
    expect(groundStart({ type: 'NONE' }, 'Thẻ Login nên làm sớm', TODAY).grounded).toBe(false);
    // một câu có CẢ hai: mỗi thao tác chỉ nhận ngày đúng vai trò của nó
    const both = 'Thẻ Login bắt đầu từ 10/10 và hạn 15/10';
    expect(groundStart({ type: 'ABSOLUTE', date: '2026-10-10' }, both, TODAY)).toMatchObject({ grounded: true, resolution: { date: '2026-10-10' } });
    expect(assessPlanProvenance([op({ type: 'SET_CARD_START', card: T('Login'), start: { type: 'ABSOLUTE', date: '2026-10-10' } }), op({ type: 'SET_CARD_DUE', card: T('Login'), due: { type: 'ABSOLUTE', date: '2026-10-15' } })], both, TODAY).verdict).toBe('USER_DIRECT');
  });
});

describe('chính sách tự chạy', () => {
  const base = (over: Partial<DecisionInput> = {}): DecisionInput => ({
    opTypes: ['SET_CARD_START'], provenance: { verdict: 'USER_DIRECT', failures: [] }, dueFuzzy: false, refsUnique: true,
    boardIds: ['b1'], inCeiling: true, guard: { ok: true }, autoExecute: true, ...over,
  });
  it.each(['SET_CARD_START', 'REMOVE_MEMBER', 'REMOVE_LABEL'])('%s: một thao tác chính xác từ lệnh trực tiếp → TỰ CHẠY, rủi ro thấp', (type) => {
    expect(decideExecution(base({ opTypes: [type] }))).toMatchObject({ mode: 'AUTO', risk: 'LOW', reasons: [] });
  });
  it.each([
    ['SET_CARD_DESCRIPTION', 'TEXT_CONTENT'], ['ADD_COMMENT', 'TEXT_CONTENT'], ['ADD_CHECKLIST', 'TEXT_CONTENT'], ['RENAME_LIST', 'NEW_STRUCTURE'], ['ARCHIVE_CARD', 'ARCHIVE'],
  ])('%s: LUÔN xem trước (lý do %s), rủi ro vừa, kể cả khi bật tự chạy và nguồn sạch', (type, reason) => {
    const d = decideExecution(base({ opTypes: [type] }));
    expect(d.mode).toBe('CONFIRM');
    if (d.mode === 'CONFIRM') { expect(d.reasons.map((r) => r.code)).toEqual([reason]); expect(d.risk).toBe('MEDIUM'); }
  });
  it('tạo thẻ + checklist: nhiều thao tác → MULTI_OP + TEXT_CONTENT, không có NEW_STRUCTURE giả', () => {
    const d = decideExecution(base({ opTypes: ['CREATE_CARD', 'ADD_CHECKLIST'] }));
    expect(d.mode === 'CONFIRM' && d.reasons.map((r) => r.code)).toEqual(['MULTI_OP', 'TEXT_CONTENT']);
  });
  it('tạo cột vẫn là NEW_STRUCTURE (không đổi hành vi cũ); luật vẫn chỉ STANDING_RULE', () => {
    expect(decideExecution(base({ opTypes: ['CREATE_LIST'] }))).toMatchObject({ mode: 'CONFIRM', reasons: [{ code: 'NEW_STRUCTURE' }] });
    const rule = decideExecution(base({ opTypes: ['CREATE_AUTOMATION_RULE'] }));
    expect(rule.mode === 'CONFIRM' && rule.reasons.map((r) => r.code)).toEqual(['STANDING_RULE']);
  });
  it('nguồn không sạch → xem trước dù thao tác thuộc nhóm tự chạy', () => {
    const d = decideExecution(base({ opTypes: ['REMOVE_MEMBER'], provenance: { verdict: 'DELEGATED_TO_DATA', failures: [] } }));
    expect(d.mode === 'CONFIRM' && d.reasons.map((r) => r.code)).toEqual(['DELEGATED_TO_DATA']);
    expect(decideExecution(base({ opTypes: ['SET_CARD_START'], autoExecute: false }))).toMatchObject({ mode: 'CONFIRM', risk: 'LOW', reasons: [{ code: 'AUTO_DISABLED' }] });
  });
});

describe('mâu thuẫn và trùng lặp giữa các thao tác', () => {
  const stored = (type: StoredOp['type'], ids: StoredOp['ids'], params: StoredOp['params'] = {}, title = 'Login UI', extra: Partial<StoredOp> = {}): StoredOp => ({ type, ids, params, before: null, display: { cardTitle: title }, ...extra });
  const card = { card: 'c1' };

  it('vừa giao vừa bỏ cùng người / cùng nhãn trên một thẻ → từ chối nói rõ', () => {
    const a = dedupeOps([stored('ASSIGN_MEMBER', { ...card, member: 'u1' }), stored('REMOVE_MEMBER', { ...card, member: 'u1' })]);
    expect(a.ok).toBe(false);
    expect(!a.ok && a.text).toContain('làm ngược nhau');
    expect(dedupeOps([stored('ADD_LABEL', { ...card, label: 'l1' }), stored('REMOVE_LABEL', { ...card, label: 'l1' })]).ok).toBe(false);
    // khác người / khác nhãn thì không mâu thuẫn
    expect(dedupeOps([stored('ASSIGN_MEMBER', { ...card, member: 'u1' }), stored('REMOVE_MEMBER', { ...card, member: 'u2' })]).ok).toBe(true);
  });
  it('lưu trữ một thẻ mà còn sửa chính thẻ đó trong cùng lệnh → từ chối; lưu trữ hai thẻ khác nhau thì được', () => {
    const r = dedupeOps([stored('RENAME_CARD', card, { title: 'B' }), stored('ARCHIVE_CARD', card)]);
    expect(!r.ok && r.text).toContain('vừa được lưu trữ vừa bị sửa');
    expect(dedupeOps([stored('ARCHIVE_CARD', card), stored('ADD_COMMENT', card, { text: 'x' })]).ok).toBe(false);
    expect(dedupeOps([stored('ARCHIVE_CARD', { card: 'c1' }), stored('ARCHIVE_CARD', { card: 'c2' }, {}, 'B')]).ok).toBe(true);
    const twice = dedupeOps([stored('ARCHIVE_CARD', card), stored('ARCHIVE_CARD', card)]);
    expect(twice.ok && twice.ops).toHaveLength(1);
  });
  it('hai mô tả / hai ngày bắt đầu khác nhau cho một thẻ → mâu thuẫn; giống hệt → bỏ bản sau', () => {
    expect(dedupeOps([stored('SET_CARD_DESCRIPTION', card, { description: 'a' }), stored('SET_CARD_DESCRIPTION', card, { description: 'b' })]).ok).toBe(false);
    const same = dedupeOps([stored('SET_CARD_START', card, { start: '2026-10-10T00:00:00.000Z' }), stored('SET_CARD_START', card, { start: '2026-10-10T00:00:00.000Z' })]);
    expect(same.ok && same.dropped).toBe(1);
    expect(dedupeOps([stored('SET_CARD_START', card, { start: '2026-10-10T00:00:00.000Z' }), stored('SET_CARD_START', card, { start: '2026-10-11T00:00:00.000Z' })]).ok).toBe(false);
  });
  it('hai bình luận khác nhau thì giữ cả hai; hai bình luận giống hệt thì bỏ bản sau', () => {
    expect(dedupeOps([stored('ADD_COMMENT', card, { text: 'a' }), stored('ADD_COMMENT', card, { text: 'b' })])).toMatchObject({ ok: true, dropped: 0 });
    expect(dedupeOps([stored('ADD_COMMENT', card, { text: 'a' }), stored('ADD_COMMENT', card, { text: 'a' })])).toMatchObject({ ok: true, dropped: 1 });
  });
  it('đổi tên một cột hai lần: khác tên → mâu thuẫn; giống → bỏ bản sau', () => {
    const rename = (name: string): StoredOp => ({ type: 'RENAME_LIST', ids: { list: 'l1' }, params: { name }, before: { listName: 'A' }, display: { listName: 'A' } });
    expect(dedupeOps([rename('B'), rename('C')]).ok).toBe(false);
    expect(dedupeOps([rename('B'), rename('B')])).toMatchObject({ ok: true, dropped: 1 });
  });
});

describe('chữ hiển thị (bản xem trước, kết quả, lý do cũ)', () => {
  const mk = (type: StoredOp['type'], over: Partial<StoredOp> = {}): StoredOp => ({ type, ids: { card: 'c1' }, params: {}, before: null, display: { cardTitle: 'Login UI' }, ...over });
  it('xem trước: mô tả nói rõ sẽ THAY mô tả cũ; bình luận / checklist hiện nguyên văn; lưu trữ nói khôi phục được', () => {
    const d = describeOp(mk('SET_CARD_DESCRIPTION', { params: { description: 'Thiết kế mới' }, before: { descriptionHash: 'x', descriptionLength: 40 } }), 0);
    expect(d).toMatchObject({ verb: 'Đổi mô tả', text: '“Login UI”', cardId: 'c1' });
    expect(d.detail).toContain('Nội dung mới: Thiết kế mới');
    expect(d.detail).toContain('Mô tả cũ 40 ký tự sẽ bị thay');
    expect(describeOp(mk('SET_CARD_DESCRIPTION', { params: { description: 'Mới' }, before: { descriptionHash: 'x', descriptionLength: 0 } }), 0).detail).not.toContain('Mô tả cũ');
    expect(describeOp(mk('ADD_COMMENT', { params: { text: 'Đã review xong' } }), 1)).toMatchObject({ verb: 'Viết bình luận', text: 'vào thẻ “Login UI”', detail: 'Đã review xong' });
    expect(describeOp(mk('ADD_CHECKLIST', { params: { title: 'Kiểm thử', items: ['Unit test', 'API test'] } }), 2)).toMatchObject({ verb: 'Thêm checklist', text: '“Kiểm thử” vào thẻ “Login UI”', detail: '• Unit test\n• API test' });
    expect(describeOp(mk('ADD_CHECKLIST', { params: { items: ['a'] } }), 2).text).toContain('“Việc cần làm”');
    expect(describeOp(mk('ARCHIVE_CARD'), 3).detail).toContain('khôi phục lại được');
    expect(describeOp(mk('RENAME_LIST', { ids: { list: 'l1' }, params: { name: 'Việc cần làm' }, before: { listName: 'Cần làm' } }), 4)).toMatchObject({ verb: 'Đổi tên cột', text: '“Cần làm” → “Việc cần làm”' });
    expect(describeOp(mk('REMOVE_MEMBER', { ids: { card: 'c1', member: 'u1' }, display: { cardTitle: 'Login UI', memberName: 'Nguyễn Lan' } }), 5)).toMatchObject({ verb: 'Bỏ người', text: 'Nguyễn Lan khỏi thẻ “Login UI”' });
    expect(describeOp(mk('REMOVE_LABEL', { display: { cardTitle: 'Login UI', labelName: 'Gấp' } }), 6)).toMatchObject({ verb: 'Gỡ nhãn', text: '“Gấp” khỏi thẻ “Login UI”' });
  });
  it('ngày bắt đầu hiện theo giờ Việt Nam; bỏ ngày bắt đầu có câu riêng', () => {
    const set = describeOp(mk('SET_CARD_START', { params: { start: '2026-10-09T17:00:00.000Z' }, before: { start: '2026-10-01T17:00:00.000Z' } }), 0);
    expect(set).toMatchObject({ verb: 'Đặt ngày bắt đầu' });
    expect(set.detail).toContain('10/10/2026');
    expect(set.detail).toContain('trước:');
    expect(describeOp(mk('SET_CARD_START', { params: { start: null } }), 0)).toMatchObject({ verb: 'Bỏ ngày bắt đầu' });
    expect(summarizeExecuted(mk('SET_CARD_START', { params: { start: null } }))).toBe('Đã bỏ ngày bắt đầu của thẻ “Login UI”.');
  });
  it('kết quả sau khi chạy', () => {
    expect(summarizeExecuted(mk('SET_CARD_DESCRIPTION'))).toBe('Đã đổi mô tả của thẻ “Login UI”.');
    expect(summarizeExecuted(mk('ADD_COMMENT'))).toBe('Đã viết bình luận vào thẻ “Login UI”.');
    expect(summarizeExecuted(mk('ADD_CHECKLIST', { params: { title: 'Kiểm thử', items: ['a', 'b', 'c'] } }))).toBe('Đã thêm checklist “Kiểm thử” (3 mục) vào thẻ “Login UI”.');
    expect(summarizeExecuted(mk('REMOVE_MEMBER', { display: { cardTitle: 'Login UI', memberName: 'Nguyễn Lan' } }))).toBe('Đã bỏ Nguyễn Lan khỏi thẻ “Login UI”.');
    expect(summarizeExecuted(mk('REMOVE_LABEL', { display: { cardTitle: 'Login UI', labelName: 'Gấp' } }))).toBe('Đã gỡ nhãn “Gấp” khỏi thẻ “Login UI”.');
    expect(summarizeExecuted(mk('RENAME_LIST', { params: { name: 'B' }, before: { listName: 'A' } }))).toBe('Đã đổi tên cột “A” thành “B”.');
    expect(summarizeExecuted(mk('ARCHIVE_CARD'))).toContain('Khôi phục lại được');
    expect(summarizeExecuted(mk('REMOVE_MEMBER', { noop: 'Lan chưa được giao thẻ nên chưa cần bỏ.' }))).toBe('Lan chưa được giao thẻ nên chưa cần bỏ.');
  });
  it('lý do kế hoạch cũ nêu đúng thứ đã đổi', () => {
    const seen = mk('SET_CARD_DESCRIPTION');
    expect(staleReasonOf(seen, seen)).toBe('Mô tả của thẻ đã thay đổi kể từ lúc xem trước.');
    expect(staleReasonOf(mk('SET_CARD_START'), mk('SET_CARD_START'))).toContain('Ngày bắt đầu');
    expect(staleReasonOf(mk('REMOVE_MEMBER'), mk('REMOVE_MEMBER'))).toContain('Thành viên');
    expect(staleReasonOf(mk('REMOVE_LABEL'), mk('REMOVE_LABEL'))).toContain('Nhãn');
    expect(staleReasonOf(mk('RENAME_LIST'), mk('RENAME_LIST'))).toContain('Cột đã được đổi tên');
  });
  it('dấu vân tay mô tả: bỏ khoảng trắng đầu/cuối, phân biệt nội dung; mô tả rỗng và null như nhau', () => {
    expect(descriptionHash('  abc \n')).toBe(descriptionHash('abc'));
    expect(descriptionHash('abc')).not.toBe(descriptionHash('abd'));
    expect(descriptionHash(null)).toBe(descriptionHash(''));
    expect(descriptionHash('x')).toMatch(/^[0-9a-f]{64}$/);
  });
});
