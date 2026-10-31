// Bước E (thuần, không CSDL): hợp đồng 13 thao tác dọn dẹp thẻ / cột - schema, giấy phép động từ (đúng đối tượng), nguồn gốc, mâu thuẫn, bảng màu.
import { describe, expect, it } from 'vitest';
import { ACTION_TYPES, ActionOpSchema, AUTO_RUN_TYPES, DESTRUCTIVE_TYPES, proposeActionsSchema, type ActionOp } from '../src/modules/chat/v2/actions/actions.schema';
import { colorLabel, colorMentioned, COLOR_HEX, COLOR_NAMES } from '../src/modules/chat/v2/actions/actions.palette';
import { assessProvenance } from '../src/modules/chat/v2/actions/actions.provenance';
import { dedupeOps } from '../src/modules/chat/v2/actions/actions.resolve';
import { foldWords, licenceFromPositions } from '../src/modules/chat/v2/actions/actions.text';
import { decideExecution } from '../src/modules/chat/v2/actions/actions.autorun';
import { describeOp, OP_LABEL } from '../src/modules/chat/v2/actions/actions.plan';
import { slotsOf } from '../src/modules/chat/v2/actions/actions.refs';
import { EXTENDED_TYPES, handlerOf, LEGACY_TYPES } from '../src/modules/chat/v2/actions/ops/ops.registry';
import type { StoredOp } from '../src/modules/chat/v2/actions/actions.types';

const t = (text: string) => ({ by: 'TEXT' as const, text });
const op = (value: unknown): ActionOp => ActionOpSchema.parse(value);
const lic = (message: string, value: unknown) => {
  const o = op(value);
  const words = foldWords(message);
  return licenceFromPositions(handlerOf(o.type)!.licence(words, o as never), words);
};
const stored = (type: StoredOp['type'], ids: StoredOp['ids'], over: Partial<StoredOp> = {}): StoredOp => ({ type, ids, params: {}, before: null, display: {}, ...over });

describe('registry: mọi loại thao tác đều có chủ', () => {
  it('ACTION_TYPES = 18 thao tác cũ + thao tác mở rộng, không sót, không trùng', () => {
    const all = [...ACTION_TYPES] as string[];
    expect(new Set(all).size).toBe(all.length);
    expect([...LEGACY_TYPES, ...EXTENDED_TYPES].sort()).toEqual([...all].sort());
  });

  it('mỗi thao tác mở rộng có nhãn ngắn, chính sách và hàm đủ bộ', () => {
    for (const type of EXTENDED_TYPES) {
      const h = handlerOf(type)!;
      expect(h.label.length, type).toBeGreaterThan(3);
      expect(OP_LABEL[type], type).toBe(h.label);
      for (const fn of ['slots', 'withRef', 'licence', 'resolve', 'guard', 'apply', 'describe', 'summary'] as const) expect(typeof h[fn], `${type}.${fn}`).toBe('function');
      // xóa: không bao giờ tự chạy
      if (DESTRUCTIVE_TYPES.includes(type as never)) expect(h.policy, type).toMatchObject({ autoRun: false, confirm: expect.arrayContaining(['DELETE']) });
      // AUTO_RUN_TYPES khớp chính sách của handler
      expect(AUTO_RUN_TYPES.includes(type as never), type).toBe(h.policy.autoRun);
    }
  });
});

describe('schema: 13 thao tác của bước E', () => {
  const valid: unknown[] = [
    { type: 'DELETE_CARD', card: t('Login') },
    { type: 'RESTORE_CARD', card: t('Login') },
    { type: 'COPY_CARD', card: t('Login'), toList: t('Đang làm'), title: 'Login (2)' },
    { type: 'SET_CARD_COVER', card: t('Login'), color: 'RED' },
    { type: 'SET_CARD_COVER', card: t('Login'), color: 'NONE' },
    { type: 'ARCHIVE_LIST', list: t('Cần làm') },
    { type: 'DELETE_LIST', list: t('5') },
    { type: 'RESTORE_LIST', list: t('Cũ') },
    { type: 'COPY_LIST', list: t('Cần làm') },
    { type: 'MOVE_LIST', list: t('Đang làm'), placement: 'FIRST' },
    { type: 'MOVE_LIST', list: t('Đang làm'), placement: 'AFTER', anchor: t('Cần làm') },
    { type: 'SORT_LIST', list: t('Cần làm'), sortBy: 'TITLE_ASC' },
    { type: 'MOVE_ALL_CARDS', list: t('A'), toList: t('B') },
    { type: 'DELETE_ALL_CARDS', list: t('A') },
    { type: 'SET_LIST_STATUS', list: t('A'), status: 'DONE' },
    { type: 'SET_LIST_STATUS', list: t('A'), status: 'NONE' },
  ];
  it.each(valid.map((v, i) => [i, v] as const))('chấp nhận mẫu %i', (_i, value) => {
    expect(ActionOpSchema.safeParse(value).success).toBe(true);
  });

  const invalid: Array<[string, unknown]> = [
    ['id thay vì tham chiếu', { type: 'DELETE_CARD', cardId: 'abc' }],
    ['khóa lạ', { type: 'DELETE_LIST', list: t('A'), force: true }],
    ['màu ngoài bảng', { type: 'SET_CARD_COVER', card: t('A'), color: '#ff0000' }],
    ['vị trí lạ', { type: 'MOVE_LIST', list: t('A'), placement: 'MIDDLE' }],
    ['kiểu sắp xếp lạ', { type: 'SORT_LIST', list: t('A'), sortBy: 'RANDOM' }],
    ['thiếu cột đích', { type: 'MOVE_ALL_CARDS', list: t('A') }],
    ['trạng thái lạ', { type: 'SET_LIST_STATUS', list: t('A'), status: 'LATER' }],
    ['xóa vĩnh viễn', { type: 'PURGE_CARD', card: t('A') }],
  ];
  it.each(invalid)('từ chối: %s', (_name, value) => {
    expect(ActionOpSchema.safeParse(value).success).toBe(false);
  });

  it('proposeActionsSchema bỏ khóa null mô hình hay điền thừa (anchor: null)', () => {
    const parsed = proposeActionsSchema.safeParse({ operations: [{ type: 'MOVE_LIST', list: t('A'), placement: 'LAST', anchor: null }] });
    expect(parsed.success).toBe(true);
  });
});

describe('giấy phép động từ: động từ phải đi cùng ĐÚNG đối tượng của thao tác', () => {
  it('DELETE_CARD: "xóa" + thẻ / tên thẻ; không cấp phép cho "xóa nhãn khỏi thẻ" hay "xóa cột"', () => {
    const o = { type: 'DELETE_CARD', card: t('Login UI') };
    for (const m of ['Xóa thẻ Login UI', 'xoá task Login UI đi', 'Xóa Login UI', 'xóa giúp tôi cái thẻ Login UI', 'Delete card Login UI']) expect(lic(m, o), m).toEqual({ licensed: true, negated: false });
    for (const m of ['Xóa nhãn Gấp khỏi thẻ Login UI', 'Bỏ Lan khỏi thẻ Login UI', 'Thẻ Login UI là gì', 'Xóa bình luận trong thẻ Login UI', 'Chuyển thẻ Login UI sang Done']) expect(lic(m, o).licensed, m).toBe(false);
    expect(lic('Đừng xóa thẻ Login UI', o)).toEqual({ licensed: true, negated: true });
  });

  it('DELETE_LIST / ARCHIVE_LIST / RESTORE_LIST / COPY_LIST: động từ + danh từ cột (hoặc tên cột)', () => {
    expect(lic('xoá danh sách 5 cho tôi', { type: 'DELETE_LIST', list: t('5') }).licensed).toBe(true);
    expect(lic('Xóa cột Cần làm', { type: 'DELETE_LIST', list: t('Cần làm') }).licensed).toBe(true);
    expect(lic('xóa thẻ ở danh sách 5', { type: 'DELETE_LIST', list: t('5') }).licensed).toBe(false);
    expect(lic('Lưu trữ cột Hoàn thành', { type: 'ARCHIVE_LIST', list: t('Hoàn thành') }).licensed).toBe(true);
    expect(lic('Lưu trữ thẻ Login UI', { type: 'ARCHIVE_LIST', list: t('Login UI') }).licensed).toBe(false); // "thẻ" chen giữa: đó là lệnh lưu trữ THẺ, không phải cột
    expect(lic('Lưu trữ thẻ Login UI', { type: 'ARCHIVE_LIST', list: t('Cần làm') }).licensed).toBe(false);
    expect(lic('Khôi phục cột Cũ', { type: 'RESTORE_LIST', list: t('Cũ') }).licensed).toBe(true);
    expect(lic('Sao chép cột Cần làm', { type: 'COPY_LIST', list: t('Cần làm') }).licensed).toBe(true);
    expect(lic('Sao chép thẻ Login', { type: 'COPY_LIST', list: t('Cần làm') }).licensed).toBe(false);
  });

  it('DELETE_ALL_CARDS / MOVE_ALL_CARDS: phải có dấu hiệu "tất cả / hết" VÀ danh từ thẻ', () => {
    const del = { type: 'DELETE_ALL_CARDS', list: t('Cần làm') };
    expect(lic('Xóa hết thẻ trong cột Cần làm', del).licensed).toBe(true);
    expect(lic('xóa tất cả các task của cột Cần làm', del).licensed).toBe(true);
    expect(lic('Xóa cột Cần làm', del).licensed).toBe(false);
    expect(lic('Xóa thẻ Login UI', del).licensed).toBe(false);
    const move = { type: 'MOVE_ALL_CARDS', list: t('Cần làm'), toList: t('Đang làm') };
    expect(lic('Chuyển tất cả thẻ của cột Cần làm sang cột Đang làm', move).licensed).toBe(true);
    expect(lic('Chuyển thẻ Login sang cột Đang làm', move).licensed).toBe(false);
  });

  it('MOVE_LIST: cần dấu hiệu vị trí đúng với placement; SORT_LIST: cần tiêu chí đúng', () => {
    expect(lic('Đưa cột Đang làm lên đầu bảng', { type: 'MOVE_LIST', list: t('Đang làm'), placement: 'FIRST' }).licensed).toBe(true);
    expect(lic('Đưa cột Đang làm xuống cuối bảng', { type: 'MOVE_LIST', list: t('Đang làm'), placement: 'LAST' }).licensed).toBe(true);
    expect(lic('Đưa cột Đang làm xuống cuối bảng', { type: 'MOVE_LIST', list: t('Đang làm'), placement: 'FIRST' }).licensed).toBe(false);
    expect(lic('Di chuyển cột Đang làm sau cột Cần làm', { type: 'MOVE_LIST', list: t('Đang làm'), placement: 'AFTER', anchor: t('Cần làm') }).licensed).toBe(true);
    expect(lic('Sắp xếp thẻ trong cột Cần làm theo tên A-Z', { type: 'SORT_LIST', list: t('Cần làm'), sortBy: 'TITLE_ASC' }).licensed).toBe(true);
    expect(lic('Sắp xếp thẻ trong cột Cần làm theo tên A-Z', { type: 'SORT_LIST', list: t('Cần làm'), sortBy: 'CREATED_DESC' }).licensed).toBe(false);
  });

  it('COPY_CARD / RESTORE_CARD: động từ + thẻ; "mở lại thẻ" (đổi trạng thái) KHÔNG phải khôi phục', () => {
    expect(lic('Sao chép thẻ Login UI', { type: 'COPY_CARD', card: t('Login UI') }).licensed).toBe(true);
    expect(lic('Nhân bản task Login UI sang cột Đang làm', { type: 'COPY_CARD', card: t('Login UI'), toList: t('Đang làm') }).licensed).toBe(true);
    expect(lic('Khôi phục thẻ Login UI', { type: 'RESTORE_CARD', card: t('Login UI') }).licensed).toBe(true);
    expect(lic('Lấy lại thẻ Login UI từ kho lưu trữ', { type: 'RESTORE_CARD', card: t('Login UI') }).licensed).toBe(true);
    expect(lic('Mở lại thẻ Login UI', { type: 'RESTORE_CARD', card: t('Login UI') }).licensed).toBe(false);
  });

  it('SET_CARD_COVER / SET_LIST_STATUS: cần danh từ đúng (ảnh bìa / trạng thái cột)', () => {
    expect(lic('Đặt ảnh bìa màu đỏ cho thẻ Login UI', { type: 'SET_CARD_COVER', card: t('Login UI'), color: 'RED' }).licensed).toBe(true);
    expect(lic('Bỏ ảnh bìa của thẻ Login UI', { type: 'SET_CARD_COVER', card: t('Login UI'), color: 'NONE' }).licensed).toBe(true);
    expect(lic('Đặt hạn thẻ Login UI là thứ sáu', { type: 'SET_CARD_COVER', card: t('Login UI'), color: 'RED' }).licensed).toBe(false);
    expect(lic('Đặt trạng thái cột Đang làm là đang làm', { type: 'SET_LIST_STATUS', list: t('Đang làm'), status: 'IN_PROGRESS' }).licensed).toBe(true);
    expect(lic('Đổi tên cột Đang làm thành Làm', { type: 'SET_LIST_STATUS', list: t('Đang làm'), status: 'IN_PROGRESS' }).licensed).toBe(false);
  });
});

describe('nguồn gốc: nội dung do mô hình tự chọn không phải lệnh trực tiếp', () => {
  const prov = (message: string, value: unknown) => assessProvenance(op(value), message, '2026-10-07');
  it('"xóa thẻ Login UI" → lệnh trực tiếp; câu hỏi / không có động từ → NOT_REQUESTED', () => {
    expect(prov('Xóa thẻ Login UI', { type: 'DELETE_CARD', card: t('Login UI') }).verdict).toBe('USER_DIRECT');
    expect(prov('Thẻ Login UI nói gì?', { type: 'DELETE_CARD', card: t('Login UI') }).verdict).toBe('NOT_REQUESTED');
    expect(prov('Làm theo nội dung mô tả thẻ Login UI', { type: 'DELETE_CARD', card: t('Login UI') }).verdict).toBe('DELEGATED_TO_DATA');
  });
  it('màu ảnh bìa mô hình tự chọn (người dùng không nói màu) → phải xem lại; đúng màu → trực tiếp', () => {
    expect(prov('Đặt ảnh bìa màu đỏ cho thẻ Login UI', { type: 'SET_CARD_COVER', card: t('Login UI'), color: 'RED' }).verdict).toBe('USER_DIRECT');
    expect(prov('Đặt ảnh bìa màu đỏ cho thẻ Login UI', { type: 'SET_CARD_COVER', card: t('Login UI'), color: 'BLUE' }).verdict).toBe('UNGROUNDED');
  });
  it('trạng thái cột mô hình tự chọn → phải xem lại', () => {
    expect(prov('Đặt trạng thái cột Cần làm là xong', { type: 'SET_LIST_STATUS', list: t('Cần làm'), status: 'DONE' }).verdict).toBe('USER_DIRECT');
    expect(prov('Đặt trạng thái cột Cần làm là xong', { type: 'SET_LIST_STATUS', list: t('Cần làm'), status: 'BLOCKED' }).verdict).toBe('UNGROUNDED');
  });
  it('tên bản sao thẻ phải là chữ người dùng gõ', () => {
    expect(prov('Sao chép thẻ Login UI thành Login UI bản hai', { type: 'COPY_CARD', card: t('Login UI'), title: 'Login UI bản hai' }).verdict).toBe('USER_DIRECT');
    expect(prov('Sao chép thẻ Login UI', { type: 'COPY_CARD', card: t('Login UI'), title: 'Một cái tên mô hình tự nghĩ' }).verdict).toBe('UNGROUNDED');
  });
});

describe('chính sách xác nhận', () => {
  const decide = (types: string[]) =>
    decideExecution({
      opTypes: types,
      provenance: { verdict: 'USER_DIRECT', failures: [] },
      dueFuzzy: false,
      refsUnique: true,
      boardIds: ['b1'],
      inCeiling: true,
      guard: { ok: true },
      autoExecute: true,
    });
  it('xóa / cả cột / cấu trúc luôn xem trước kèm lý do; xóa là rủi ro CAO; khôi phục / sao chép thẻ / ảnh bìa tự chạy được', () => {
    expect(decide(['DELETE_CARD'])).toMatchObject({ mode: 'CONFIRM', risk: 'HIGH', reasons: [{ code: 'DELETE' }] });
    expect(decide(['DELETE_LIST'])).toMatchObject({ mode: 'CONFIRM', risk: 'HIGH' });
    const all = decide(['DELETE_ALL_CARDS']);
    expect(all).toMatchObject({ mode: 'CONFIRM', risk: 'HIGH' });
    expect(all.mode === 'CONFIRM' && all.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['DELETE', 'BULK']));
    expect(decide(['MOVE_ALL_CARDS'])).toMatchObject({ mode: 'CONFIRM', reasons: [{ code: 'BULK' }] });
    expect(decide(['SORT_LIST'])).toMatchObject({ mode: 'CONFIRM', reasons: [{ code: 'BULK' }] });
    expect(decide(['MOVE_LIST'])).toMatchObject({ mode: 'CONFIRM', reasons: [{ code: 'NEW_STRUCTURE' }] });
    expect(decide(['ARCHIVE_LIST'])).toMatchObject({ mode: 'CONFIRM', reasons: [{ code: 'ARCHIVE' }] });
    for (const type of ['RESTORE_CARD', 'COPY_CARD', 'SET_CARD_COVER']) expect(decide([type]).mode, type).toBe('AUTO');
  });
});

describe('mâu thuẫn trong một kế hoạch', () => {
  it('xóa thẻ rồi lại sửa chính thẻ đó → từ chối; xóa hai lần cùng thẻ → bỏ bản trùng', () => {
    const del = stored('DELETE_CARD', { card: 'c1' }, { display: { cardTitle: 'A' } });
    const rename = stored('RENAME_CARD', { card: 'c1' }, { params: { title: 'B' }, display: { cardTitle: 'A' } });
    expect(dedupeOps([del, rename])).toMatchObject({ ok: false });
    expect(dedupeOps([rename, del])).toMatchObject({ ok: false });
    expect(dedupeOps([del, { ...del }])).toMatchObject({ ok: true, dropped: 1 });
    // hai thẻ khác nhau: không xung đột
    expect(dedupeOps([del, stored('DELETE_CARD', { card: 'c2' }, { display: { cardTitle: 'B' } })])).toMatchObject({ ok: true, dropped: 0 });
  });
  it('lưu trữ cột rồi xóa chính cột đó → từ chối', () => {
    const a = stored('ARCHIVE_LIST', { list: 'l1' });
    const d = stored('DELETE_LIST', { list: 'l1' });
    expect(dedupeOps([a, d])).toMatchObject({ ok: false });
  });
});

describe('hiển thị bản xem trước', () => {
  it('xóa thẻ / xóa cột / xóa hết thẻ đều đánh dấu danger và nói rõ không khôi phục được', () => {
    const items = [
      describeOp(stored('DELETE_CARD', { card: 'c1' }, { display: { cardTitle: 'Login', listName: 'Cần làm', comments: 2, attachments: 0, items: 3 } }), 0),
      describeOp(stored('DELETE_LIST', { list: 'l1' }, { display: { listName: '5', cards: 4 } }), 0),
      describeOp(stored('DELETE_ALL_CARDS', { list: 'l1' }, { display: { listName: '5', cards: 4 } }), 0),
    ];
    for (const item of items) {
      expect(item.danger).toBe(true);
      expect(item.detail).toContain('không khôi phục');
    }
    expect(items[0].detail).toContain('2 bình luận');
    expect(items[0].detail).toContain('3 mục checklist');
    expect(items[0].detail).not.toContain('tệp đính kèm');
  });

  it('slotsOf: thao tác mở rộng khai báo đúng ô tham chiếu', () => {
    expect(slotsOf(op({ type: 'MOVE_ALL_CARDS', list: t('A'), toList: t('B') })).map((s) => s.name)).toEqual(['list', 'toList']);
    expect(slotsOf(op({ type: 'MOVE_LIST', list: t('A'), placement: 'AFTER', anchor: t('B') })).map((s) => s.name)).toEqual(['list', 'anchor']);
    expect(slotsOf(op({ type: 'DELETE_CARD', card: t('A') })).map((s) => s.name)).toEqual(['card']);
  });
});

describe('bảng màu', () => {
  it('10 màu có hex trùng giao diện, tên tiếng Việt, nhận diện trong câu', () => {
    expect(COLOR_NAMES).toHaveLength(10);
    expect(COLOR_HEX.RED).toBe('#f87168');
    expect(colorLabel('#f87168')).toBe('đỏ');
    expect(colorLabel('#123456')).toBe('#123456');
    expect(colorLabel(null)).toBe('không có');
    expect(colorMentioned('RED', foldWords('màu đỏ'))).toBe(true);
    expect(colorMentioned('GREEN', foldWords('xanh lá cây'))).toBe(true);
    expect(colorMentioned('BLUE', foldWords('xanh dương'))).toBe(true);
    // "xanh" trơn là mơ hồ: không tự nhận là xanh dương hay xanh lá
    expect(colorMentioned('BLUE', foldWords('màu xanh'))).toBe(false);
    expect(colorMentioned('GREEN', foldWords('màu xanh'))).toBe(false);
  });
});
