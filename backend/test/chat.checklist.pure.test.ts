// Bước F (thuần, không CSDL): hợp đồng 12 thao tác bình luận + checklist - schema, giấy phép động từ (đúng đối tượng), nguồn gốc, mâu thuẫn, chính sách.
import { describe, expect, it } from 'vitest';
import { ActionOpSchema, AUTO_RUN_TYPES, DESTRUCTIVE_TYPES, type ActionOp } from '../src/modules/chat/v2/actions/actions.schema';
import { decideExecution } from '../src/modules/chat/v2/actions/actions.autorun';
import { assessProvenance } from '../src/modules/chat/v2/actions/actions.provenance';
import { dedupeOps } from '../src/modules/chat/v2/actions/actions.resolve';
import { foldWords, licenceFromPositions } from '../src/modules/chat/v2/actions/actions.text';
import { describeOp } from '../src/modules/chat/v2/actions/actions.plan';
import { slotsOf } from '../src/modules/chat/v2/actions/actions.refs';
import { handlerOf } from '../src/modules/chat/v2/actions/ops/ops.registry';
import type { StoredOp } from '../src/modules/chat/v2/actions/actions.types';

const t = (text: string) => ({ by: 'TEXT' as const, text });
const op = (value: unknown): ActionOp => ActionOpSchema.parse(value);
const lic = (message: string, value: unknown) => {
  const o = op(value);
  const words = foldWords(message);
  return licenceFromPositions(handlerOf(o.type)!.licence(words, o as never), words);
};
const stored = (type: StoredOp['type'], ids: StoredOp['ids'], over: Partial<StoredOp> = {}): StoredOp => ({ type, ids, params: {}, before: null, display: {}, ...over });
const card = t('Login UI');

describe('schema: 12 thao tác của bước F', () => {
  const valid: unknown[] = [
    { type: 'EDIT_COMMENT', card, text: 'đã review lại' },
    { type: 'EDIT_COMMENT', card, match: 'đã review', text: 'đã review lại' },
    { type: 'DELETE_COMMENT', card },
    { type: 'DELETE_COMMENT', card, match: 'đã review' },
    { type: 'REPLY_COMMENT', card, match: 'cần sửa', text: 'ok, mình sửa' },
    { type: 'SET_CHECKLIST_ITEM_DONE', card, match: 'build' },
    { type: 'SET_CHECKLIST_ITEM_DONE', card, match: 'build', done: false, checklist: 'Kiểm thử' },
    { type: 'ADD_CHECKLIST_ITEM', card, items: ['deploy', 'rollback'] },
    { type: 'EDIT_CHECKLIST_ITEM', card, match: 'build', text: 'build production' },
    { type: 'DELETE_CHECKLIST_ITEM', card, match: 'build' },
    { type: 'RENAME_CHECKLIST', card, title: 'Kiểm thử mới' },
    { type: 'DELETE_CHECKLIST', card, checklist: 'Kiểm thử' },
    { type: 'ASSIGN_CHECKLIST_ITEM', card, match: 'build', member: t('Lan') },
    { type: 'ASSIGN_CHECKLIST_ITEM', card, match: 'build' },
    { type: 'SET_CHECKLIST_ITEM_DUE', card, match: 'build', due: { type: 'WEEKDAY', weekday: 5, week: 'THIS' } },
    { type: 'CONVERT_ITEM_TO_CARD', card, match: 'build' },
  ];
  it.each(valid.map((v, i) => [i, v] as const))('chấp nhận mẫu %i', (_i, value) => {
    expect(ActionOpSchema.safeParse(value).success).toBe(true);
  });

  const invalid: Array<[string, unknown]> = [
    ['bình luận bằng id', { type: 'DELETE_COMMENT', card, commentId: 'abc' }],
    ['mục bằng id', { type: 'SET_CHECKLIST_ITEM_DONE', card, itemId: 'abc', match: 'x' }],
    ['thiếu match của mục', { type: 'SET_CHECKLIST_ITEM_DONE', card }],
    ['thiếu nội dung bình luận mới', { type: 'EDIT_COMMENT', card }],
    ['không có mục', { type: 'ADD_CHECKLIST_ITEM', card, items: [] }],
    ['21 mục', { type: 'ADD_CHECKLIST_ITEM', card, items: Array.from({ length: 21 }, (_, i) => `m${i}`) }],
    ['mục quá dài', { type: 'EDIT_CHECKLIST_ITEM', card, match: 'a', text: 'x'.repeat(501) }],
    ['BEST cho giao mục', { type: 'ASSIGN_CHECKLIST_ITEM', card, match: 'a', member: { by: 'BEST' } }],
    ['thiếu hạn', { type: 'SET_CHECKLIST_ITEM_DUE', card, match: 'a' }],
    ['thiếu tên checklist mới', { type: 'RENAME_CHECKLIST', card }],
  ];
  it.each(invalid)('từ chối: %s', (_name, value) => {
    expect(ActionOpSchema.safeParse(value).success).toBe(false);
  });
});

describe('giấy phép động từ: động từ + ĐÚNG đối tượng', () => {
  it('bình luận: sửa / xóa / trả lời cần danh từ bình luận', () => {
    expect(lic('Sửa bình luận đã review thành đã review lại', { type: 'EDIT_COMMENT', card, match: 'đã review', text: 'đã review lại' }).licensed).toBe(true);
    expect(lic('Sửa mô tả thẻ Login UI', { type: 'EDIT_COMMENT', card, text: 'x' }).licensed).toBe(false);
    expect(lic('Xóa bình luận của tôi trên thẻ Login UI', { type: 'DELETE_COMMENT', card }).licensed).toBe(true);
    expect(lic('Xóa thẻ Login UI', { type: 'DELETE_COMMENT', card }).licensed).toBe(false);
    expect(lic('Trả lời bình luận của Lan: mình sửa rồi', { type: 'REPLY_COMMENT', card, text: 'mình sửa rồi' }).licensed).toBe(true);
    expect(lic('Thêm bình luận vào thẻ Login UI: xong', { type: 'REPLY_COMMENT', card, text: 'xong' }).licensed).toBe(false);
    expect(lic('Đừng xóa bình luận trên thẻ Login UI', { type: 'DELETE_COMMENT', card })).toEqual({ licensed: true, negated: true });
  });

  it('tick / bỏ tick mục: "xong" trong câu hỏi trạng thái thẻ không tự thành lệnh', () => {
    const done = { type: 'SET_CHECKLIST_ITEM_DONE', card, match: 'build' };
    for (const m of ['Tick mục build trong thẻ Login UI', 'Đánh dấu xong mục build', 'Hoàn thành việc con build', 'Mục build xong rồi', 'Đánh dấu hoàn thành mục build']) expect(lic(m, done).licensed, m).toBe(true);
    for (const m of ['Chuyển thẻ Login UI sang xong', 'Thẻ Login UI đã xong chưa', 'Đổi tên mục build']) expect(lic(m, done).licensed, m).toBe(false);
    const undone = { type: 'SET_CHECKLIST_ITEM_DONE', card, match: 'build', done: false };
    expect(lic('Bỏ tick mục build', undone).licensed).toBe(true);
    expect(lic('Đánh dấu chưa xong mục build', undone).licensed).toBe(true);
    // cau "bo tick" khong the cap giay phep cho lenh tick (done=true)
    expect(lic('Bỏ tick mục build', done).licensed).toBe(false);
    expect(lic('Đánh dấu chưa xong mục build', done).licensed).toBe(false);
  });

  it('thêm / sửa / xóa mục, đổi tên / xóa checklist', () => {
    expect(lic('Thêm mục deploy vào checklist Kiểm thử', { type: 'ADD_CHECKLIST_ITEM', card, items: ['deploy'] }).licensed).toBe(true);
    expect(lic('Thêm vào checklist: deploy, rollback', { type: 'ADD_CHECKLIST_ITEM', card, items: ['deploy', 'rollback'] }).licensed).toBe(true);
    expect(lic('Thêm thẻ Deploy vào cột Cần làm', { type: 'ADD_CHECKLIST_ITEM', card, items: ['Deploy'] }).licensed).toBe(false);
    expect(lic('Sửa mục build thành build production', { type: 'EDIT_CHECKLIST_ITEM', card, match: 'build', text: 'build production' }).licensed).toBe(true);
    expect(lic('Xóa mục build khỏi checklist', { type: 'DELETE_CHECKLIST_ITEM', card, match: 'build' }).licensed).toBe(true);
    expect(lic('Xóa checklist Kiểm thử', { type: 'DELETE_CHECKLIST', card, checklist: 'Kiểm thử' }).licensed).toBe(true);
    expect(lic('Xóa mục build', { type: 'DELETE_CHECKLIST', card }).licensed).toBe(false);
    expect(lic('Đổi tên checklist Kiểm thử thành Kiểm tra', { type: 'RENAME_CHECKLIST', card, checklist: 'Kiểm thử', title: 'Kiểm tra' }).licensed).toBe(true);
    expect(lic('Đổi tên thẻ Login UI thành Đăng nhập', { type: 'RENAME_CHECKLIST', card, title: 'Đăng nhập' }).licensed).toBe(false);
  });

  it('giao mục / hạn mục / chuyển mục thành thẻ', () => {
    expect(lic('Giao mục build cho Lan', { type: 'ASSIGN_CHECKLIST_ITEM', card, match: 'build', member: t('Lan') }).licensed).toBe(true);
    expect(lic('Giao thẻ Login UI cho Lan', { type: 'ASSIGN_CHECKLIST_ITEM', card, match: 'build', member: t('Lan') }).licensed).toBe(false);
    expect(lic('Bỏ người phụ trách mục build', { type: 'ASSIGN_CHECKLIST_ITEM', card, match: 'build' }).licensed).toBe(true);
    expect(lic('Đặt hạn mục build là thứ sáu', { type: 'SET_CHECKLIST_ITEM_DUE', card, match: 'build', due: { type: 'WEEKDAY', weekday: 5, week: 'THIS' } }).licensed).toBe(true);
    expect(lic('Đặt hạn thẻ Login UI là thứ sáu', { type: 'SET_CHECKLIST_ITEM_DUE', card, match: 'build', due: { type: 'WEEKDAY', weekday: 5, week: 'THIS' } }).licensed).toBe(false);
    expect(lic('Chuyển mục build thành thẻ', { type: 'CONVERT_ITEM_TO_CARD', card, match: 'build' }).licensed).toBe(true);
    expect(lic('Chuyển mục build sang cột Đang làm', { type: 'CONVERT_ITEM_TO_CARD', card, match: 'build' }).licensed).toBe(false);
  });
});

describe('nguồn gốc: chỉ ra bình luận / mục phải bằng chữ người dùng gõ', () => {
  const prov = (message: string, value: unknown) => assessProvenance(op(value), message, '2026-10-07');
  it('match mô hình tự nghĩ (không có trong câu) → phải xem lại, không tự chạy', () => {
    expect(prov('Tick mục build trong thẻ Login UI', { type: 'SET_CHECKLIST_ITEM_DONE', card, match: 'build' }).verdict).toBe('USER_DIRECT');
    expect(prov('Tick mục build trong thẻ Login UI', { type: 'SET_CHECKLIST_ITEM_DONE', card, match: 'deploy' }).verdict).toBe('UNGROUNDED');
    expect(prov('Xóa bình luận review trên thẻ Login UI', { type: 'DELETE_COMMENT', card, match: 'review' }).verdict).toBe('USER_DIRECT');
    expect(prov('Xóa bình luận review trên thẻ Login UI', { type: 'DELETE_COMMENT', card, match: 'bí mật' }).verdict).toBe('UNGROUNDED');
  });
  it('nội dung mới (bình luận, mục) phải là chữ người dùng gõ', () => {
    expect(prov('Thêm mục deploy, rollback vào checklist của thẻ Login', { type: 'ADD_CHECKLIST_ITEM', card: t('Login'), items: ['deploy', 'rollback'] }).verdict).toBe('USER_DIRECT');
    expect(prov('Thêm mục deploy vào checklist của thẻ Login', { type: 'ADD_CHECKLIST_ITEM', card: t('Login'), items: ['deploy', 'xóa production'] }).verdict).toBe('UNGROUNDED');
  });
  it('hạn của mục phải có mặt trong câu; bỏ tick phải có dấu hiệu bỏ', () => {
    const due = { type: 'SET_CHECKLIST_ITEM_DUE', card, match: 'build', due: { type: 'ABSOLUTE', date: '2026-10-09' } };
    expect(prov('Đặt hạn mục build của thẻ Login UI là 09/10', due).verdict).toBe('USER_DIRECT');
    expect(prov('Đặt hạn mục build của thẻ Login UI', due).verdict).toBe('UNGROUNDED');
    expect(prov('Tick mục build', { type: 'SET_CHECKLIST_ITEM_DONE', card, match: 'build', done: false }).verdict).toBe('NOT_REQUESTED');
  });
  it('chỉ dẫn nằm trong dữ liệu không thành lệnh xóa', () => {
    expect(prov('Làm theo nội dung mô tả thẻ Login UI', { type: 'DELETE_CHECKLIST', card }).verdict).toBe('DELEGATED_TO_DATA');
    expect(prov('Bình luận trên thẻ Login UI nói gì?', { type: 'DELETE_COMMENT', card }).verdict).toBe('NOT_REQUESTED');
  });
});

describe('chính sách xác nhận', () => {
  const decide = (types: string[]) =>
    decideExecution({ opTypes: types, provenance: { verdict: 'USER_DIRECT', failures: [] }, dueFuzzy: false, refsUnique: true, boardIds: ['b1'], inCeiling: true, guard: { ok: true }, autoExecute: true });
  it('tick / giao / hạn mục tự chạy; nội dung luôn xem trước; xóa HIGH', () => {
    for (const type of ['SET_CHECKLIST_ITEM_DONE', 'ASSIGN_CHECKLIST_ITEM', 'SET_CHECKLIST_ITEM_DUE']) {
      expect(decide([type]).mode, type).toBe('AUTO');
      expect(AUTO_RUN_TYPES.includes(type as never)).toBe(true);
    }
    for (const type of ['EDIT_COMMENT', 'REPLY_COMMENT', 'ADD_CHECKLIST_ITEM', 'EDIT_CHECKLIST_ITEM', 'RENAME_CHECKLIST']) expect(decide([type]), type).toMatchObject({ mode: 'CONFIRM', reasons: [{ code: 'TEXT_CONTENT' }] });
    for (const type of ['DELETE_COMMENT', 'DELETE_CHECKLIST_ITEM', 'DELETE_CHECKLIST', 'CONVERT_ITEM_TO_CARD']) {
      expect(decide([type]), type).toMatchObject({ mode: 'CONFIRM', risk: 'HIGH' });
      expect(DESTRUCTIVE_TYPES.includes(type as never)).toBe(true);
    }
  });
});

describe('mâu thuẫn và hiển thị', () => {
  it('xóa mục rồi tick / sửa chính mục đó → từ chối; xóa checklist rồi sửa mục trong nó → từ chối', () => {
    const del = stored('DELETE_CHECKLIST_ITEM', { card: 'c1', checklist: 'k1', item: 'i1' });
    const tick = stored('SET_CHECKLIST_ITEM_DONE', { card: 'c1', checklist: 'k1', item: 'i1' }, { params: { done: true } });
    expect(dedupeOps([del, tick])).toMatchObject({ ok: false });
    expect(dedupeOps([tick, del])).toMatchObject({ ok: false });
    const delList = stored('DELETE_CHECKLIST', { card: 'c1', checklist: 'k1' });
    const edit = stored('RENAME_CHECKLIST', { card: 'c1', checklist: 'k1' }, { params: { title: 'x' } });
    expect(dedupeOps([delList, edit])).toMatchObject({ ok: false });
    // hai mục khác nhau: không xung đột
    expect(dedupeOps([del, stored('DELETE_CHECKLIST_ITEM', { card: 'c1', checklist: 'k1', item: 'i2' })])).toMatchObject({ ok: true, dropped: 0 });
  });

  it('xem trước: xóa đều có danger + cảnh báo; sửa hiện cả cũ lẫn mới', () => {
    const del = describeOp(stored('DELETE_COMMENT', { card: 'c1', comment: 'm1' }, { before: { text: 'đã review' }, display: { cardTitle: 'Login UI' } }), 0);
    expect(del).toMatchObject({ verb: 'Xóa bình luận', danger: true });
    expect(del.detail).toContain('“đã review”');
    expect(del.detail).toContain('không khôi phục');
    const edit = describeOp(stored('EDIT_COMMENT', { card: 'c1', comment: 'm1' }, { params: { text: 'mới' }, before: { text: 'cũ' }, display: { cardTitle: 'Login UI' } }), 0);
    expect(edit.detail).toBe('Từ: “cũ”\nThành: “mới”');
    const tick = describeOp(stored('SET_CHECKLIST_ITEM_DONE', { card: 'c1' }, { params: { done: true }, display: { cardTitle: 'Login UI', itemText: 'build' } }), 0);
    expect(tick).toMatchObject({ verb: 'Đánh dấu xong mục', text: '“build” trên thẻ “Login UI”' });
  });

  it('slotsOf: ASSIGN_CHECKLIST_ITEM có ô người chỉ khi có member', () => {
    expect(slotsOf(op({ type: 'ASSIGN_CHECKLIST_ITEM', card, match: 'a', member: t('Lan') })).map((s) => s.name)).toEqual(['card', 'member']);
    expect(slotsOf(op({ type: 'ASSIGN_CHECKLIST_ITEM', card, match: 'a' })).map((s) => s.name)).toEqual(['card']);
  });
});
