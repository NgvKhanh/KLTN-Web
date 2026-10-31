// Bước I - quản trị bảng: đổi tên, hiển thị, sao, lưu trữ / xóa bảng, link mời, nhãn, luật tự động hóa, thành viên + quyền, trường tùy chỉnh.
// Mỗi thao tác được so SONG SONG với service giao diện trên dữ liệu song sinh (bảng Alpha làm qua chatbot, bảng Beta làm qua service).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import { handleV2Message } from '../src/modules/chat/v2/chat.v2.service';
import { persistentConfirm, persistentMessage } from '../src/modules/chat/v2/chat.v2.history';
import { V2SessionStore } from '../src/modules/chat/v2/chat.v2.session';
import type { V2Reply } from '../src/modules/chat/v2/chat.v2.contract';
import { archiveBoard, deleteBoard, setBoardStar, updateBoard } from '../src/modules/board/board.service';
import { addBoardMember, changeMemberRole, removeBoardMember } from '../src/modules/board/boardMember.service';
import { createInviteToken, disableInviteToken } from '../src/modules/board/boardShare.service';
import { createLabel, deleteLabel, updateLabel } from '../src/modules/label/label.service';
import { deleteAutomationRule, updateAutomationRule } from '../src/modules/automation/automation.service';
import { addFieldOption, createCustomField, deleteCustomField, updateCustomField } from '../src/modules/customField/customField.service';
import { ActionOpSchema, type ActionOp } from '../src/modules/chat/v2/actions/actions.schema';
import { shapePlan } from '../src/modules/chat/v2/actions/actions.graph';
import { assessProvenance } from '../src/modules/chat/v2/actions/actions.provenance';
import { foldWords, licenceFromPositions } from '../src/modules/chat/v2/actions/actions.text';
import { handlerOf } from '../src/modules/chat/v2/actions/ops/ops.registry';
import { canManageInTx, isOwnerInTx } from '../src/modules/chat/v2/actions/actions.write.base';
import type { StoredOp } from '../src/modules/chat/v2/actions/actions.types';
import { makeDirectUser } from './helpers';
import { ACT_NOW, actionContext, propose, script, seedActions, text, type ActionWorld } from './chat.actions.fixture';

const mocks = vi.hoisted(() => ({ board: vi.fn(), user: vi.fn(), reconcile: vi.fn(), evict: vi.fn() }));
vi.mock('../src/realtime/socket', async (original) => ({
  ...(await original<object>()),
  emitToBoard: mocks.board,
  emitToUser: mocks.user,
  reconcileBoardRoomAccess: mocks.reconcile,
  evictUserFromBoardRoom: mocks.evict,
}));
beforeEach(() => {
  mocks.board.mockClear();
  mocks.user.mockClear();
  mocks.reconcile.mockClear();
  mocks.evict.mockClear();
});

type Who = { id: string };
const onBoard = (f: ActionWorld) => ({ kind: 'BOARD' as const, boardId: f.alpha.id });
function resultOf(reply: V2Reply) {
  const a = reply.answer.action;
  if (a?.kind !== 'RESULT') throw new Error(`cần RESULT nhưng nhận ${JSON.stringify(a ?? null)} / "${reply.answer.text}"`);
  return a.result;
}
function planOf(reply: V2Reply) {
  const a = reply.answer.action;
  if (a?.kind !== 'PLAN') throw new Error(`cần PLAN nhưng nhận ${JSON.stringify(a ?? null)} / "${reply.answer.text}"`);
  return a.plan;
}
const askAs = (who: Who, f: ActionWorld, message: string, ...ops: unknown[]) => handleV2Message(who.id, { message, scope: onBoard(f) }, actionContext({ step: script([propose(...ops)]) }));
async function previewAs(who: Who, f: ActionWorld, message: string, ops: unknown[]) {
  const sessions = new V2SessionStore();
  const scope = onBoard(f);
  const reply = await persistentMessage(who.id, { message, scope }, actionContext({ step: script([propose(...ops)]), sessions }));
  const plan = planOf(reply);
  return { plan, confirm: () => persistentConfirm(who.id, plan.planId, { conversationId: reply.conversationId, checksum: plan.checksum, scope }, actionContext({ sessions, now: ACT_NOW })) };
}
const op = (value: unknown): ActionOp => ActionOpSchema.parse(value);
const t = (s: string) => ({ by: 'TEXT' as const, text: s });
const lic = (message: string, value: unknown) => {
  const o = op(value);
  const words = foldWords(message);
  return licenceFromPositions(handlerOf(o.type)!.licence(words, o as never), words);
};
const prov = (message: string, value: unknown) => assessProvenance(op(value), message, '2026-10-07');

const ownerRow = (f: ActionWorld) => prisma.boardMember.create({ data: { boardId: f.alpha.id, userId: f.owner.id, role: 'OWNER' } });
const member = (f: ActionWorld, userId: string, role: 'ADMIN' | 'MEMBER' | 'VIEWER', boardId = f.alpha.id) => prisma.boardMember.create({ data: { boardId, userId, role } });
const alphaRow = (f: ActionWorld) => prisma.board.findUniqueOrThrow({ where: { id: f.alpha.id } });
const betaRow = (f: ActionWorld) => prisma.board.findUniqueOrThrow({ where: { id: f.beta.id } });

describe('thuần: giấy phép + nguồn gốc + hình dạng kế hoạch', () => {
  it('đổi tên bảng cần "đổi tên" + "bảng"; đổi tên cột không cấp phép', () => {
    const o = { type: 'RENAME_BOARD', name: 'Alpha mới' };
    expect(lic('Đổi tên bảng này thành Alpha mới', o).licensed).toBe(true);
    expect(lic('Đổi tên cột Cần làm thành Alpha mới', o).licensed).toBe(false);
    expect(prov('Đổi tên bảng này thành Alpha mới', o).verdict).toBe('USER_DIRECT');
    expect(prov('Đổi tên bảng này thành Beta', o).verdict).toBe('UNGROUNDED');
  });

  it('sao: "gắn sao bảng" có, "sao chép bảng" / "tại sao" không', () => {
    const o = { type: 'STAR_BOARD' };
    expect(lic('Gắn sao cho bảng này', o).licensed).toBe(true);
    expect(lic('Sao chép bảng này', o).licensed).toBe(false);
    expect(lic('Tại sao bảng này chậm', o).licensed).toBe(false);
  });

  it('lưu trữ / xóa bảng cần danh từ "bảng" ngay sau động từ: "xóa thẻ ... trong bảng" không cấp phép', () => {
    expect(lic('Lưu trữ bảng Dự án Alpha', { type: 'ARCHIVE_BOARD', confirmName: 'Dự án Alpha' }).licensed).toBe(true);
    expect(lic('Lưu trữ thẻ Login UI', { type: 'ARCHIVE_BOARD', confirmName: 'Dự án Alpha' }).licensed).toBe(false);
    expect(lic('Xóa bảng Dự án Alpha', { type: 'DELETE_BOARD', confirmName: 'Dự án Alpha' }).licensed).toBe(true);
    expect(lic('Xóa thẻ Login UI trong bảng Dự án Alpha', { type: 'DELETE_BOARD', confirmName: 'Dự án Alpha' }).licensed).toBe(false);
    expect(prov('Xóa bảng này đi', { type: 'DELETE_BOARD', confirmName: 'Dự án Alpha' }).verdict).toBe('UNGROUNDED');
  });

  it('xóa nhãn khỏi BẢNG khác gỡ nhãn khỏi THẺ', () => {
    expect(lic('Xóa nhãn Gấp', { type: 'DELETE_LABEL', label: t('Gấp') }).licensed).toBe(true);
    expect(lic('Xóa nhãn Gấp khỏi thẻ Login UI', { type: 'DELETE_LABEL', label: t('Gấp') }).licensed).toBe(false);
  });

  it('đổi quyền: vai trò trong lệnh phải trùng vai trò mô hình đề xuất', () => {
    const viewer = { type: 'CHANGE_MEMBER_ROLE', member: t('Nguyễn Lan'), role: 'VIEWER' };
    expect(lic('Đổi quyền của Nguyễn Lan thành chỉ xem', viewer).licensed).toBe(true);
    expect(lic('Đổi quyền của Nguyễn Lan thành quản trị viên', viewer).licensed).toBe(false);
    expect(lic('Cho Nguyễn Lan làm quản trị viên', { ...viewer, role: 'ADMIN' }).licensed).toBe(true);
  });

  it('thêm / bỏ thành viên: email phải do chính người dùng gõ; "bỏ khỏi thẻ" không phải bỏ khỏi bảng', () => {
    const add = { type: 'ADD_BOARD_MEMBER', email: 'lan@test.local' };
    expect(lic('Thêm lan@test.local vào bảng này', add).licensed).toBe(true);
    expect(prov('Thêm lan@test.local vào bảng này', add).verdict).toBe('USER_DIRECT');
    // email do mô hình tự nghĩ ra: câu của người dùng không hề yêu cầu thêm người đó → từ chối cả kế hoạch
    expect(prov('Thêm lan@test.local vào bảng này', { ...add, email: 'tuan@test.local' }).verdict).toBe('NOT_REQUESTED');
    expect(prov('Thêm lan@test.local vào bảng này', { ...add, role: 'ADMIN' }).verdict).toBe('UNGROUNDED');
    expect(lic('Bỏ Nguyễn Lan khỏi bảng này', { type: 'REMOVE_BOARD_MEMBER', member: t('Nguyễn Lan') }).licensed).toBe(true);
    expect(lic('Bỏ Nguyễn Lan khỏi thẻ Login UI', { type: 'REMOVE_BOARD_MEMBER', member: t('Nguyễn Lan') }).licensed).toBe(false);
  });

  it('"gỡ / bỏ" là cách nói thường ngày khi xóa bình luận, mục checklist, tệp (Gemini thật nói "Gỡ tệp ...")', () => {
    const file = { type: 'DELETE_ATTACHMENT', card: t('Login UI'), match: 'thiết kế.pdf' };
    expect(lic('Gỡ tệp thiết kế.pdf khỏi thẻ Login UI', file).licensed).toBe(true);
    expect(lic('Bỏ file thiết kế.pdf khỏi thẻ Login UI', file).licensed).toBe(true);
    expect(lic('Đính kèm tệp thiết kế.pdf vào thẻ Login UI', file).licensed).toBe(false);
    expect(lic('Bỏ bình luận “đã review xong” của thẻ Login UI', { type: 'DELETE_COMMENT', card: t('Login UI'), match: 'đã review xong' }).licensed).toBe(true);
    expect(lic('Bỏ mục viết test khỏi checklist của thẻ Login UI', { type: 'DELETE_CHECKLIST_ITEM', card: t('Login UI'), match: 'viết test' }).licensed).toBe(true);
    // "bỏ qua" không phải xóa
    expect(lic('Bỏ qua bình luận của thẻ Login UI', { type: 'DELETE_COMMENT', card: t('Login UI') }).licensed).toBe(false);
  });

  it('câu thật của người dùng: "xóa CHO TÔI cột 5", "lưu trữ cho mình cột ..." (chữ "cho" giữa động từ và danh từ)', () => {
    const list = { type: 'DELETE_LIST', list: t('5') };
    expect(lic('xoá cho tôi cột "5"', list).licensed).toBe(true);
    expect(lic('xoá cột 5" cho tôi', list).licensed).toBe(true);
    expect(lic('hãy xóa giùm tôi cột 5 đi', list).licensed).toBe(true);
    expect(lic('lưu trữ cho mình cột 5', { type: 'ARCHIVE_LIST', list: t('5') }).licensed).toBe(true);
    expect(prov('đổi tên cho tôi cột Cần làm thành Việc cần làm', { type: 'RENAME_LIST', list: t('Cần làm'), name: 'Việc cần làm' }).verdict).toBe('USER_DIRECT');
    // vẫn không cấp phép khi giữa động từ và danh từ còn từ chỉ ĐỐI TƯỢNG khác
    expect(lic('Xóa cho tôi thẻ Login UI trong bảng Dự án Alpha', { type: 'DELETE_BOARD', confirmName: 'Dự án Alpha' }).licensed).toBe(false);
    expect(lic('Xóa thẻ Login UI khỏi cột 5', list).licensed).toBe(false);
  });

  it('trạng thái cột: "chuyển cột 2 từ đang làm sang chưa làm" (không nói "trạng thái" nhưng gọi thẳng tên trạng thái)', () => {
    const o = { type: 'SET_LIST_STATUS', list: t('2'), status: 'TODO' };
    expect(lic('chuyển cột 2 từ đang làm sang chưa làm', o).licensed).toBe(true);
    expect(prov('chuyển cột 2 từ đang làm sang chưa làm', o).verdict).toBe('USER_DIRECT');
    expect(lic('đổi cột 2 sang chưa làm', o).licensed).toBe(true);
    // trạng thái mô hình đề xuất phải là trạng thái người dùng NHẮC; "chuyển hết thẻ" là chuyển thẻ, không phải đổi trạng thái cột
    expect(lic('chuyển cột 2 từ đang làm sang chưa làm', { ...o, status: 'DONE' }).licensed).toBe(false);
    expect(lic('chuyển hết thẻ cột 2 sang chưa làm', o).licensed).toBe(false);
    expect(lic('Chuyển thẻ Login sang chưa làm', o).licensed).toBe(false);
  });

  it('luật / trường: động từ + danh từ đúng loại', () => {
    expect(lic('Tắt luật tự động hóa đánh dấu xong', { type: 'TOGGLE_AUTOMATION_RULE', match: 'đánh dấu xong', enabled: false }).licensed).toBe(true);
    expect(lic('Bật luật đánh dấu xong', { type: 'TOGGLE_AUTOMATION_RULE', match: 'đánh dấu xong', enabled: false }).licensed).toBe(false);
    expect(lic('Tạo trường Mức độ kiểu danh sách chọn gồm Thấp, Cao', { type: 'CREATE_CUSTOM_FIELD', name: 'Mức độ', fieldType: 'DROPDOWN', options: ['Thấp', 'Cao'] }).licensed).toBe(true);
    expect(lic('Thêm lựa chọn Khẩn vào trường Ưu tiên', { type: 'ADD_FIELD_OPTION', field: 'Ưu tiên', value: 'Khẩn' }).licensed).toBe(true);
    expect(lic('Tạo nhãn Khẩn cấp màu đỏ', { type: 'CREATE_LABEL', name: 'Khẩn cấp', color: 'RED' }).licensed).toBe(true);
    expect(prov('Tạo nhãn Khẩn cấp', { type: 'CREATE_LABEL', name: 'Khẩn cấp', color: 'RED' }).verdict).toBe('UNGROUNDED');
  });

  it('quản trị không trộn với việc ở thẻ / cột; xóa / lưu trữ bảng đứng một mình; quản trị với quản trị thì được', () => {
    const add = op({ type: 'ADD_BOARD_MEMBER', email: 'a@b.co' });
    const role = op({ type: 'CHANGE_MEMBER_ROLE', member: t('Lan'), role: 'VIEWER' });
    const del = op({ type: 'DELETE_BOARD', confirmName: 'Alpha' });
    const card = op({ type: 'CREATE_CARD', title: 'X' });
    expect(shapePlan([add, card])).toMatchObject({ ok: false, code: 'ADMIN_NOT_ALONE' });
    expect(shapePlan([del, role])).toMatchObject({ ok: false, code: 'ADMIN_NOT_ALONE' });
    expect(shapePlan([add, role]).ok).toBe(true);
    expect(shapePlan([op({ type: 'RENAME_BOARD', name: 'B' }), card]).ok).toBe(true);
  });
});

describe('RENAME_BOARD / STAR_BOARD', () => {
  it('đổi tên bảng: luôn xem trước, ghi giống updateBoard, báo realtime', async () => {
    const f = await seedActions();
    const p = await previewAs(f.owner, f, 'Đổi tên bảng này thành Alpha mới', [{ type: 'RENAME_BOARD', name: 'Alpha mới' }]);
    expect(p.plan.items[0]).toMatchObject({ verb: 'Đổi tên bảng', text: '“Dự án Alpha” → “Alpha mới”' });
    expect(p.plan.reasons.map((r) => r.code)).toContain('NEW_STRUCTURE');
    expect(resultOf(await p.confirm()).summary).toBe('Đã đổi tên bảng “Dự án Alpha” thành “Alpha mới”.');
    await updateBoard(f.owner.id, f.beta.id, { name: 'Alpha mới' });
    expect((await alphaRow(f)).name).toBe('Alpha mới');
    expect((await alphaRow(f)).name).toBe((await betaRow(f)).name);
    expect(mocks.board).toHaveBeenCalledWith(f.alpha.id, 'board:meta-changed');
  });

  it('đã đúng tên → nói rõ, không ghi; thành viên chỉ sửa được vẫn đổi tên được (như giao diện)', async () => {
    const f = await seedActions();
    expect(resultOf(await askAs(f.owner, f, 'Đổi tên bảng này thành Dự án Alpha', { type: 'RENAME_BOARD', name: 'Dự án Alpha' })).summary).toBe('Bảng đã có tên “Dự án Alpha” rồi.');
    await member(f, f.lan.id, 'MEMBER');
    const p = await previewAs(f.lan, f, 'Đổi tên bảng này thành Alpha hai', [{ type: 'RENAME_BOARD', name: 'Alpha hai' }]);
    expect(resultOf(await p.confirm()).status).toBe('EXECUTED');
    expect((await alphaRow(f)).name).toBe('Alpha hai');
  });

  it('gắn / bỏ sao: tự chạy, giống setBoardStar, riêng của người dùng; đã đúng → nói rõ', async () => {
    const f = await seedActions();
    const star = await askAs(f.owner, f, 'Gắn sao cho bảng này', { type: 'STAR_BOARD' });
    expect(resultOf(star)).toMatchObject({ status: 'EXECUTED', autoExecuted: true, summary: 'Đã gắn sao cho bảng “Dự án Alpha”.' });
    await setBoardStar(f.owner.id, f.beta.id, true);
    expect(await prisma.boardStar.count({ where: { userId: f.owner.id, boardId: { in: [f.alpha.id, f.beta.id] } } })).toBe(2);
    expect(resultOf(await askAs(f.owner, f, 'Gắn sao cho bảng này', { type: 'STAR_BOARD' })).summary).toBe('Bảng “Dự án Alpha” đã có sao rồi.');
    expect(resultOf(await askAs(f.owner, f, 'Bỏ sao bảng này', { type: 'STAR_BOARD', starred: false })).summary).toBe('Đã bỏ sao của bảng “Dự án Alpha”.');
    await setBoardStar(f.owner.id, f.beta.id, false);
    expect(await prisma.boardStar.count({ where: { boardId: { in: [f.alpha.id, f.beta.id] } } })).toBe(0);
    expect(await prisma.boardStar.count({ where: { userId: f.lan.id } })).toBe(0);
  });
});

describe('SET_BOARD_VISIBILITY / SET_INVITE_LINK - chỉ quản trị', () => {
  it('đổi hiển thị: luôn xem trước, rủi ro CAO, ghi giống updateBoard, báo thành viên không gian + dọn phòng socket', async () => {
    const f = await seedActions();
    const p = await previewAs(f.owner, f, 'Đổi bảng này sang công khai', [{ type: 'SET_BOARD_VISIBILITY', visibility: 'PUBLIC' }]);
    expect(p.plan.risk).toBe('HIGH');
    expect(p.plan.reasons.map((r) => r.code)).toContain('ADMIN');
    expect(p.plan.items[0].detail).toContain('Công khai');
    expect(resultOf(await p.confirm()).status).toBe('EXECUTED');
    expect((await alphaRow(f)).visibility).toBe('PUBLIC');
    const chatCalls = { meta: mocks.board.mock.calls.filter((c) => c[0] === f.alpha.id && c[1] === 'board:meta-changed').length, access: mocks.user.mock.calls.filter((c) => c[1] === 'board:access-changed').length, reconcile: mocks.reconcile.mock.calls.length };
    mocks.board.mockClear();
    mocks.user.mockClear();
    mocks.reconcile.mockClear();
    await updateBoard(f.owner.id, f.beta.id, { visibility: 'PUBLIC' });
    expect((await betaRow(f)).visibility).toBe('PUBLIC');
    expect(chatCalls).toEqual({ meta: 1, access: mocks.user.mock.calls.filter((c) => c[1] === 'board:access-changed').length, reconcile: 1 });
    expect(mocks.reconcile).toHaveBeenCalledWith(f.beta.id);
  });

  it('thành viên thường (không phải quản trị) bị từ chối ngay, không ghi gì; quản trị bảng thì được', async () => {
    const f = await seedActions();
    await member(f, f.lan.id, 'MEMBER');
    await member(f, f.tuan.id, 'ADMIN');
    const denied = await askAs(f.lan, f, 'Đổi bảng này sang riêng tư', { type: 'SET_BOARD_VISIBILITY', visibility: 'PRIVATE' });
    expect(denied.answer.text).toContain('Chỉ chủ bảng hoặc quản trị viên');
    expect((await alphaRow(f)).visibility).toBe('WORKSPACE');
    const p = await previewAs(f.tuan, f, 'Đổi bảng này sang riêng tư', [{ type: 'SET_BOARD_VISIBILITY', visibility: 'PRIVATE' }]);
    expect(resultOf(await p.confirm()).status).toBe('EXECUTED');
    expect((await alphaRow(f)).visibility).toBe('PRIVATE');
  });

  it('link mời: bật tạo token (không lộ trong chat), tắt xóa token; giống createInviteToken / disableInviteToken', async () => {
    const f = await seedActions();
    const on = await previewAs(f.owner, f, 'Bật link mời của bảng này', [{ type: 'SET_INVITE_LINK', enabled: true }]);
    const result = resultOf(await on.confirm());
    expect(result.summary).toBe('Đã bật link mời. Xem và sao chép link ở nút Chia sẻ của bảng.');
    const token = (await alphaRow(f)).inviteToken;
    expect(token).toMatch(/^[A-Za-z0-9_-]{20}$/);
    expect(JSON.stringify(result)).not.toContain(token as string);
    expect(await createInviteToken(f.owner.id, f.beta.id)).toMatch(/^[A-Za-z0-9_-]{20}$/);
    expect(resultOf(await askAs(f.owner, f, 'Bật link mời của bảng này', { type: 'SET_INVITE_LINK', enabled: true })).summary).toBe('Link mời của bảng “Dự án Alpha” đang bật rồi.');

    const off = await previewAs(f.owner, f, 'Tắt link mời của bảng này', [{ type: 'SET_INVITE_LINK', enabled: false }]);
    expect(resultOf(await off.confirm()).summary).toBe('Đã tắt link mời: link đã chia sẻ trước đó không còn dùng được.');
    await disableInviteToken(f.owner.id, f.beta.id);
    expect((await alphaRow(f)).inviteToken).toBeNull();
    expect((await betaRow(f)).inviteToken).toBeNull();
  });
});

describe('ARCHIVE_BOARD / DELETE_BOARD - chỉ chủ bảng, phải gõ đúng tên', () => {
  it('lưu trữ: sai tên bị từ chối; đúng tên xem trước, rủi ro CAO; ghi giống archiveBoard; báo mọi thành viên', async () => {
    const f = await seedActions();
    await ownerRow(f);
    await member(f, f.lan.id, 'MEMBER');
    const wrong = await askAs(f.owner, f, 'Lưu trữ bảng này', { type: 'ARCHIVE_BOARD', confirmName: 'Alpha' });
    expect(wrong.answer.text).toContain('ĐÚNG tên bảng: “Dự án Alpha”');
    expect((await alphaRow(f)).archivedAt).toBeNull();

    const p = await previewAs(f.owner, f, 'Lưu trữ bảng Dự án Alpha', [{ type: 'ARCHIVE_BOARD', confirmName: 'Dự án Alpha' }]);
    expect(p.plan.risk).toBe('HIGH');
    expect(p.plan.reasons.map((r) => r.code)).toEqual(expect.arrayContaining(['ADMIN', 'ARCHIVE']));
    expect(resultOf(await p.confirm()).status).toBe('EXECUTED');
    expect((await alphaRow(f)).archivedAt).not.toBeNull();
    await archiveBoard(f.owner.id, f.beta.id);
    expect((await betaRow(f)).archivedAt).not.toBeNull();
    for (const uid of [f.owner.id, f.lan.id, f.viewer.id]) expect(mocks.user).toHaveBeenCalledWith(uid, 'board:removed', { boardId: f.alpha.id });
  });

  it('quản trị viên (không phải chủ) không lưu trữ / xóa được', async () => {
    const f = await seedActions();
    await member(f, f.lan.id, 'ADMIN');
    const a = await askAs(f.lan, f, 'Lưu trữ bảng Dự án Alpha', { type: 'ARCHIVE_BOARD', confirmName: 'Dự án Alpha' });
    expect(a.answer.text).toContain('Chỉ chủ bảng mới làm được');
    const d = await askAs(f.lan, f, 'Xóa bảng Dự án Alpha', { type: 'DELETE_BOARD', confirmName: 'Dự án Alpha' });
    expect(d.answer.text).toContain('Chỉ chủ bảng mới làm được');
    const row = await alphaRow(f);
    expect([row.archivedAt, row.deletedAt]).toEqual([null, null]);
  });

  it('xóa bảng: xem trước có cảnh báo + số cột / thẻ; ghi giống deleteBoard; xóa mềm', async () => {
    const f = await seedActions();
    await member(f, f.lan.id, 'MEMBER');
    const p = await previewAs(f.owner, f, 'Xóa bảng Dự án Alpha', [{ type: 'DELETE_BOARD', confirmName: 'Dự án Alpha' }]);
    expect(p.plan.risk).toBe('HIGH');
    expect(p.plan.items[0]).toMatchObject({ verb: 'Xóa bảng', danger: true });
    expect(p.plan.items[0].detail).toContain('3 cột và 5 thẻ');
    expect(resultOf(await p.confirm()).summary).toBe('Đã xóa bảng “Dự án Alpha”.');
    await deleteBoard(f.owner.id, f.beta.id);
    expect((await alphaRow(f)).deletedAt).not.toBeNull();
    expect((await betaRow(f)).deletedAt).not.toBeNull();
    expect(await prisma.card.count({ where: { listId: f.todo.id, deletedAt: null } })).toBe(3);
    expect(mocks.user).toHaveBeenCalledWith(f.lan.id, 'board:removed', { boardId: f.alpha.id });
  });

  it('thao tác đứng một mình: kèm việc khác bị từ chối; quyền / tên đổi giữa xem trước và áp dụng → không ghi', async () => {
    const f = await seedActions();
    const mixed = await askAs(f.owner, f, 'Tạo thẻ Mới trong cột Cần làm rồi xóa bảng Dự án Alpha', { type: 'CREATE_CARD', title: 'Mới', list: text('Cần làm') }, { type: 'DELETE_BOARD', confirmName: 'Dự án Alpha' });
    expect(mixed.answer.text).toContain('cần được làm riêng');
    expect((await alphaRow(f)).deletedAt).toBeNull();

    const p = await previewAs(f.owner, f, 'Lưu trữ bảng Dự án Alpha', [{ type: 'ARCHIVE_BOARD', confirmName: 'Dự án Alpha' }]);
    await prisma.board.update({ where: { id: f.alpha.id }, data: { name: 'Alpha đã đổi' } });
    const r = resultOf(await p.confirm());
    expect(r.status).toBe('STALE');
    expect((await alphaRow(f)).archivedAt).toBeNull();
  });
});

describe('nhãn - giống label.service', () => {
  it('tạo nhãn: luôn xem trước; ghi giống createLabel; trùng tên → nói rõ', async () => {
    const f = await seedActions();
    const p = await previewAs(f.owner, f, 'Tạo nhãn Khẩn cấp màu đỏ', [{ type: 'CREATE_LABEL', name: 'Khẩn cấp', color: 'RED' }]);
    expect(p.plan.items[0]).toMatchObject({ verb: 'Tạo nhãn', text: '“Khẩn cấp”', detail: 'Màu đỏ' });
    expect(resultOf(await p.confirm()).summary).toBe('Đã tạo nhãn “Khẩn cấp” màu đỏ.');
    await createLabel(f.owner.id, f.beta.id, { name: 'Khẩn cấp', color: '#f87168' });
    const shape = async (boardId: string) => (await prisma.label.findMany({ where: { boardId, name: 'Khẩn cấp' } })).map((l) => [l.name, l.color]);
    expect(await shape(f.alpha.id)).toEqual([['Khẩn cấp', '#f87168']]);
    expect(await shape(f.alpha.id)).toEqual(await shape(f.beta.id));
    expect(mocks.board).toHaveBeenCalledWith(f.alpha.id, 'board:lists-changed');
    expect(resultOf(await askAs(f.owner, f, 'Tạo nhãn Gấp màu đỏ', { type: 'CREATE_LABEL', name: 'Gấp', color: 'RED' })).summary).toBe('Bảng đã có nhãn “Gấp” rồi.');
  });

  it('sửa tên / màu nhãn: giống updateLabel; đã đúng → nói rõ; thiếu cả tên lẫn màu → hỏi lại', async () => {
    const f = await seedActions();
    const twin = await prisma.label.create({ data: { boardId: f.beta.id, name: 'Gấp', color: '#EB5A46' } });
    const p = await previewAs(f.owner, f, 'Đổi tên nhãn Gấp thành Khẩn', [{ type: 'UPDATE_LABEL', label: text('Gấp'), name: 'Khẩn' }]);
    expect(p.plan.items[0].detail).toBe('Tên: “Gấp” → “Khẩn”');
    expect(resultOf(await p.confirm()).status).toBe('EXECUTED');
    await updateLabel(f.owner.id, twin.id, { name: 'Khẩn' });
    expect((await prisma.label.findUniqueOrThrow({ where: { id: f.urgent.id } })).name).toBe('Khẩn');
    expect((await prisma.label.findUniqueOrThrow({ where: { id: twin.id } })).name).toBe('Khẩn');

    const color = await previewAs(f.owner, f, 'Đổi màu nhãn Backend thành tím', [{ type: 'UPDATE_LABEL', label: text('Backend'), color: 'PURPLE' }]);
    expect(color.plan.items[0].detail).toContain('→ tím');
    expect(resultOf(await color.confirm()).status).toBe('EXECUTED');
    expect((await prisma.label.findUniqueOrThrow({ where: { id: f.backend.id } })).color).toBe('#9f8fef');

    const noop = await askAs(f.owner, f, 'Đổi tên nhãn Backend thành Backend', { type: 'UPDATE_LABEL', label: text('Backend'), name: 'Backend' });
    expect(resultOf(noop).summary).toBe('Nhãn “Backend” đã đúng như vậy rồi.');
    const empty = await askAs(f.owner, f, 'Đổi nhãn Backend', { type: 'UPDATE_LABEL', label: text('Backend') });
    expect(empty.answer.text).toContain('Cần nói rõ đổi tên hay đổi màu');
  });

  it('xóa nhãn khỏi bảng: cảnh báo số thẻ; giống deleteLabel; thẻ mất nhãn', async () => {
    const f = await seedActions();
    await prisma.cardLabel.create({ data: { cardId: f.loginUi.id, labelId: f.backend.id } });
    const twin = await prisma.label.create({ data: { boardId: f.beta.id, name: 'Backend', color: '#0079BF' } });
    await prisma.cardLabel.create({ data: { cardId: f.loginBeta.id, labelId: twin.id } });
    const p = await previewAs(f.owner, f, 'Xóa nhãn Backend', [{ type: 'DELETE_LABEL', label: text('Backend') }]);
    expect(p.plan.items[0]).toMatchObject({ verb: 'Xóa nhãn khỏi bảng', danger: true });
    expect(p.plan.items[0].detail).toContain('khỏi 1 thẻ');
    expect(resultOf(await p.confirm()).summary).toBe('Đã xóa nhãn “Backend” khỏi bảng.');
    await deleteLabel(f.owner.id, twin.id);
    expect(await prisma.label.count({ where: { id: { in: [f.backend.id, twin.id] } } })).toBe(0);
    expect(await prisma.cardLabel.count({ where: { cardId: { in: [f.loginUi.id, f.loginBeta.id] } } })).toBe(0);
  });
});

describe('luật tự động hóa có sẵn - giống automation.service', () => {
  const makeRule = (boardId: string, createdById: string, listId: string, name: string) =>
    prisma.automationRule.create({ data: { boardId, createdById, name, triggerType: 'CARD_MOVED_TO_LIST', triggerListId: listId, actions: { create: [{ type: 'SET_DONE', position: 0, boolValue: true }] } } });

  it('tắt / bật luật: luôn xem trước (luật chạy lâu dài); giống updateAutomationRule; đã đúng → nói rõ', async () => {
    const f = await seedActions();
    const rule = await makeRule(f.alpha.id, f.owner.id, f.done.id, 'Khi thẻ vào Hoàn thành thì đánh dấu xong');
    const twin = await makeRule(f.beta.id, f.owner.id, f.betaDoing.id, 'Khi thẻ vào Đang làm thì đánh dấu xong');
    const p = await previewAs(f.owner, f, 'Tắt luật tự động hóa đánh dấu xong', [{ type: 'TOGGLE_AUTOMATION_RULE', match: 'đánh dấu xong', enabled: false }]);
    expect(p.plan.risk).toBe('HIGH');
    expect(p.plan.items[0]).toMatchObject({ verb: 'Tắt luật tự động hóa' });
    expect(resultOf(await p.confirm()).summary).toBe('Đã tắt luật “Khi thẻ vào Hoàn thành thì đánh dấu xong”.');
    await updateAutomationRule(f.owner.id, twin.id, { isEnabled: false });
    expect((await prisma.automationRule.findUniqueOrThrow({ where: { id: rule.id } })).isEnabled).toBe(false);
    expect((await prisma.automationRule.findUniqueOrThrow({ where: { id: twin.id } })).isEnabled).toBe(false);
    expect(resultOf(await askAs(f.owner, f, 'Tắt luật đánh dấu xong', { type: 'TOGGLE_AUTOMATION_RULE', match: 'đánh dấu xong', enabled: false })).summary).toBe('Luật “Khi thẻ vào Hoàn thành thì đánh dấu xong” đang tắt rồi.');
  });

  it('xóa luật: giống deleteAutomationRule; bảng chưa có luật → nói rõ; nhiều luật khớp → nút chọn', async () => {
    const f = await seedActions();
    const none = await askAs(f.owner, f, 'Xóa luật đánh dấu xong', { type: 'DELETE_AUTOMATION_RULE', match: 'đánh dấu xong' });
    expect(none.answer.text).toContain('chưa có luật tự động hóa nào');
    const a = await makeRule(f.alpha.id, f.owner.id, f.done.id, 'Luật hoàn thành A');
    await makeRule(f.alpha.id, f.owner.id, f.doing.id, 'Luật hoàn thành B');
    const twin = await makeRule(f.beta.id, f.owner.id, f.betaDoing.id, 'Luật hoàn thành A');
    const ambiguous = await askAs(f.owner, f, 'Xóa luật hoàn thành', { type: 'DELETE_AUTOMATION_RULE', match: 'hoàn thành' });
    expect(ambiguous.answer.clarify?.options.map((o) => o.label).sort()).toEqual(['Luật hoàn thành A', 'Luật hoàn thành B']);
    const p = await previewAs(f.owner, f, 'Xóa luật hoàn thành A', [{ type: 'DELETE_AUTOMATION_RULE', match: 'hoàn thành A' }]);
    expect(p.plan.items[0]).toMatchObject({ verb: 'Xóa luật tự động hóa', danger: true });
    expect(resultOf(await p.confirm()).summary).toBe('Đã xóa luật “Luật hoàn thành A”.');
    await deleteAutomationRule(f.owner.id, twin.id);
    expect(await prisma.automationRule.count({ where: { id: { in: [a.id, twin.id] } } })).toBe(0);
    expect(await prisma.automationAction.count({ where: { ruleId: { in: [a.id, twin.id] } } })).toBe(0);
    expect(await prisma.automationRule.count({ where: { boardId: f.alpha.id } })).toBe(1);
  });
});

describe('thành viên + quyền - giống boardMember.service', () => {
  it('thêm người đã có tài khoản: xem trước, ghi giống addBoardMember, thông báo board.member.added', async () => {
    const f = await seedActions();
    const newcomer = await makeDirectUser('Người Mới');
    const twin = await makeDirectUser('Người Song Sinh');
    const p = await previewAs(f.owner, f, `Thêm ${newcomer.email} vào bảng này với quyền chỉ xem`, [{ type: 'ADD_BOARD_MEMBER', email: newcomer.email, role: 'VIEWER' }]);
    expect(p.plan.risk).toBe('HIGH');
    expect(p.plan.items[0]).toMatchObject({ verb: 'Thêm thành viên', detail: 'Quyền: Chỉ xem' });
    expect(resultOf(await p.confirm()).summary).toBe('Đã thêm Người Mới vào bảng với quyền Chỉ xem.');
    expect(await addBoardMember(f.owner.id, f.beta.id, { email: twin.email, role: 'VIEWER' })).toMatchObject({ kind: 'member' });
    const shape = async (boardId: string, userId: string) => {
      const m = await prisma.boardMember.findUniqueOrThrow({ where: { boardId_userId: { boardId, userId } } });
      const n = await prisma.notification.findMany({ where: { userId, boardId, type: 'board.member.added' } });
      return { role: m.role, deletedAt: m.deletedAt, notifications: n.map((x) => [x.actorId, x.data]) };
    };
    const [a, b] = [await shape(f.alpha.id, newcomer.id), await shape(f.beta.id, twin.id)];
    expect(a.role).toBe('VIEWER');
    expect(a.notifications).toEqual([[f.owner.id, { boardName: 'Dự án Alpha' }]]);
    expect({ ...a, notifications: a.notifications.length }).toEqual({ ...b, notifications: b.notifications.length });
    expect(mocks.board).toHaveBeenCalledWith(f.alpha.id, 'board:members-changed');
    expect(mocks.user).toHaveBeenCalledWith(newcomer.id, 'board:access-changed');
  });

  it('thêm người: email chưa có tài khoản / đã là thành viên → từ chối rõ, không gửi email', async () => {
    const f = await seedActions();
    await member(f, f.lan.id, 'MEMBER');
    const unknown = await askAs(f.owner, f, 'Thêm nobody@test.local vào bảng này', { type: 'ADD_BOARD_MEMBER', email: 'nobody@test.local' });
    expect(unknown.answer.text).toContain('chưa có tài khoản đã xác minh');
    const exists = await askAs(f.owner, f, `Thêm ${f.lan.email} vào bảng này`, { type: 'ADD_BOARD_MEMBER', email: f.lan.email });
    expect(exists.answer.text).toContain('đã là thành viên của bảng');
  });

  it('thêm lại người đã rời bảng: kích hoạt lại đúng dòng cũ với vai trò mới', async () => {
    const f = await seedActions();
    const old = await prisma.boardMember.create({ data: { boardId: f.alpha.id, userId: f.tuan.id, role: 'MEMBER', deletedAt: new Date('2026-09-01T00:00:00.000Z') } });
    const p = await previewAs(f.owner, f, `Thêm ${f.tuan.email} vào bảng này với quyền quản trị viên`, [{ type: 'ADD_BOARD_MEMBER', email: f.tuan.email, role: 'ADMIN' }]);
    expect(resultOf(await p.confirm()).status).toBe('EXECUTED');
    expect(await prisma.boardMember.findUniqueOrThrow({ where: { id: old.id } })).toMatchObject({ role: 'ADMIN', deletedAt: null });
    expect(await prisma.boardMember.count({ where: { boardId: f.alpha.id, userId: f.tuan.id } })).toBe(1);
  });

  it('đổi quyền: giống changeMemberRole (+ thông báo); không đổi được chủ bảng; đã đúng vai trò → nói rõ; thành viên thường bị từ chối', async () => {
    const f = await seedActions();
    await ownerRow(f);
    await member(f, f.lan.id, 'ADMIN');
    await member(f, f.tuan.id, 'MEMBER');
    const p = await previewAs(f.owner, f, 'Đổi quyền của Nguyễn Lan thành chỉ xem', [{ type: 'CHANGE_MEMBER_ROLE', member: text('Nguyễn Lan'), role: 'VIEWER' }]);
    expect(p.plan.items[0]).toMatchObject({ verb: 'Đổi quyền thành viên', text: 'Nguyễn Lan', detail: 'Quản trị viên → Chỉ xem' });
    expect(resultOf(await p.confirm()).summary).toBe('Đã đổi quyền của Nguyễn Lan thành Chỉ xem.');
    await changeMemberRole(f.owner.id, f.beta.id, f.lan.id, { role: 'VIEWER' });
    const roleOf = async (boardId: string) => (await prisma.boardMember.findUniqueOrThrow({ where: { boardId_userId: { boardId, userId: f.lan.id } } })).role;
    expect(await roleOf(f.alpha.id)).toBe('VIEWER');
    expect(await roleOf(f.alpha.id)).toBe(await roleOf(f.beta.id));
    const notices = await prisma.notification.findMany({ where: { userId: f.lan.id, type: 'board.role.changed' }, orderBy: { createdAt: 'asc' } });
    expect(notices.map((n) => n.data)).toEqual([{ boardName: 'Dự án Alpha', role: 'VIEWER' }, { boardName: 'Dự án Beta', role: 'VIEWER' }]);

    expect((await askAs(f.owner, f, 'Đổi quyền của Chủ Bảng thành chỉ xem', { type: 'CHANGE_MEMBER_ROLE', member: text('Chủ Bảng'), role: 'VIEWER' })).answer.text).toContain('là chủ bảng nên không đổi quyền được');
    expect(resultOf(await askAs(f.owner, f, 'Đặt Trần Tuấn làm thành viên', { type: 'CHANGE_MEMBER_ROLE', member: text('Trần Tuấn'), role: 'MEMBER' })).summary).toBe('Trần Tuấn đã có quyền Thành viên rồi.');
    expect((await askAs(f.tuan, f, 'Đổi quyền của Nguyễn Lan thành quản trị viên', { type: 'CHANGE_MEMBER_ROLE', member: text('Nguyễn Lan'), role: 'ADMIN' })).answer.text).toContain('Chỉ chủ bảng hoặc quản trị viên');
  });

  it('bỏ thành viên: cảnh báo số thẻ; giống removeBoardMember (gỡ khỏi thẻ, dọn yêu cầu tham gia, thông báo, đuổi khỏi phòng socket)', async () => {
    const f = await seedActions();
    await member(f, f.lan.id, 'MEMBER');
    await prisma.cardMember.create({ data: { cardId: f.loginUi.id, userId: f.lan.id, assignedById: f.owner.id } });
    await prisma.cardMember.create({ data: { cardId: f.loginBeta.id, userId: f.lan.id, assignedById: f.owner.id } });
    await prisma.boardJoinRequest.create({ data: { boardId: f.alpha.id, userId: f.lan.id, status: 'PENDING' } });
    const p = await previewAs(f.owner, f, 'Bỏ Nguyễn Lan khỏi bảng này', [{ type: 'REMOVE_BOARD_MEMBER', member: text('Nguyễn Lan') }]);
    expect(p.plan.items[0]).toMatchObject({ verb: 'Bỏ thành viên khỏi bảng', danger: true });
    expect(p.plan.items[0].detail).toContain('gỡ khỏi 1 thẻ');
    expect(resultOf(await p.confirm()).summary).toBe('Đã bỏ Nguyễn Lan khỏi bảng.');
    await removeBoardMember(f.owner.id, f.beta.id, f.lan.id);
    const gone = async (boardId: string, cardId: string) => ({
      member: (await prisma.boardMember.findUniqueOrThrow({ where: { boardId_userId: { boardId, userId: f.lan.id } } })).deletedAt !== null,
      card: await prisma.cardMember.count({ where: { cardId, userId: f.lan.id } }),
      pending: await prisma.boardJoinRequest.count({ where: { boardId, userId: f.lan.id, status: 'PENDING' } }),
    });
    expect(await gone(f.alpha.id, f.loginUi.id)).toEqual({ member: true, card: 0, pending: 0 });
    expect(await gone(f.beta.id, f.loginBeta.id)).toEqual({ member: true, card: 0, pending: 0 });
    expect(await prisma.notification.count({ where: { userId: f.lan.id, type: 'board.member.removed' } })).toBe(2);
    expect(mocks.user).toHaveBeenCalledWith(f.lan.id, 'board:removed', { boardId: f.alpha.id });
    expect(mocks.evict).toHaveBeenCalledWith(f.lan.id, f.alpha.id);
  });

  it('người chỉ vào bảng qua không gian (không có dòng thành viên) → báo rõ, không đoán', async () => {
    const f = await seedActions();
    const reply = await askAs(f.owner, f, 'Bỏ Nguyễn Lan khỏi bảng này', { type: 'REMOVE_BOARD_MEMBER', member: text('Nguyễn Lan') });
    expect(reply.answer.text).toContain('không được thêm trực tiếp vào bảng');
  });

  it('quyền quản trị bị thu hồi giữa xem trước và áp dụng → không ghi gì', async () => {
    const f = await seedActions();
    await member(f, f.lan.id, 'ADMIN');
    const p = await previewAs(f.lan, f, 'Đổi bảng này sang riêng tư', [{ type: 'SET_BOARD_VISIBILITY', visibility: 'PRIVATE' }]);
    await prisma.boardMember.updateMany({ where: { boardId: f.alpha.id, userId: f.lan.id }, data: { role: 'MEMBER' } });
    const r = resultOf(await p.confirm());
    expect(r.status).toBe('FAILED');
    expect((await alphaRow(f)).visibility).toBe('WORKSPACE');
  });
});

describe('trường tùy chỉnh (cấu trúc) - giống customField.service', () => {
  const dropdown = async (boardId: string, name: string, options: string[]) => {
    const field = await prisma.customField.create({ data: { boardId, name, type: 'DROPDOWN', position: 0 } });
    for (const [i, value] of options.entries()) await prisma.customFieldOption.create({ data: { fieldId: field.id, value, position: i } });
    return field;
  };
  const shape = async (boardId: string) =>
    (await prisma.customField.findMany({ where: { boardId }, orderBy: { position: 'asc' }, include: { options: { orderBy: { position: 'asc' } } } })).map((x) => [x.name, x.type, x.position, x.options.map((o) => [o.value, o.position, o.color])]);

  it('tạo trường danh sách chọn kèm lựa chọn: giống createCustomField', async () => {
    const f = await seedActions();
    const p = await previewAs(f.owner, f, 'Tạo trường Mức độ kiểu danh sách chọn gồm Thấp, Cao', [{ type: 'CREATE_CUSTOM_FIELD', name: 'Mức độ', fieldType: 'DROPDOWN', options: ['Thấp', 'Cao'] }]);
    expect(p.plan.items[0]).toMatchObject({ verb: 'Tạo trường tùy chỉnh', detail: 'Kiểu: danh sách chọn\n• Thấp\n• Cao' });
    expect(resultOf(await p.confirm()).summary).toBe('Đã tạo trường “Mức độ” (danh sách chọn).');
    await createCustomField(f.owner.id, f.beta.id, { name: 'Mức độ', type: 'DROPDOWN', options: [{ value: 'Thấp' }, { value: 'Cao' }] });
    expect(await shape(f.alpha.id)).toEqual([['Mức độ', 'DROPDOWN', 0, [['Thấp', 0, null], ['Cao', 1, null]]]]);
    expect(await shape(f.alpha.id)).toEqual(await shape(f.beta.id));
    const dup = await askAs(f.owner, f, 'Tạo trường Mức độ kiểu văn bản', { type: 'CREATE_CUSTOM_FIELD', name: 'Mức độ', fieldType: 'TEXT' });
    expect(dup.answer.text).toContain('Bảng đã có trường “Mức độ”');
    const bad = await askAs(f.owner, f, 'Tạo trường Điểm kiểu số gồm Thấp', { type: 'CREATE_CUSTOM_FIELD', name: 'Điểm', fieldType: 'NUMBER', options: ['Thấp'] });
    expect(bad.answer.text).toContain('Chỉ trường kiểu danh sách chọn');
  });

  it('đổi tên / thêm lựa chọn / xóa trường: giống updateCustomField, addFieldOption, deleteCustomField', async () => {
    const f = await seedActions();
    const field = await dropdown(f.alpha.id, 'Ưu tiên', ['Thấp', 'Cao']);
    const twin = await dropdown(f.beta.id, 'Ưu tiên', ['Thấp', 'Cao']);
    const rename = await previewAs(f.owner, f, 'Đổi tên trường Ưu tiên thành Độ ưu tiên', [{ type: 'RENAME_CUSTOM_FIELD', field: 'Ưu tiên', name: 'Độ ưu tiên' }]);
    expect(resultOf(await rename.confirm()).summary).toBe('Đã đổi tên trường “Ưu tiên” thành “Độ ưu tiên”.');
    await updateCustomField(f.owner.id, twin.id, { name: 'Độ ưu tiên' });
    const add = await previewAs(f.owner, f, 'Thêm lựa chọn Khẩn vào trường Độ ưu tiên', [{ type: 'ADD_FIELD_OPTION', field: 'Độ ưu tiên', value: 'Khẩn' }]);
    expect(resultOf(await add.confirm()).summary).toBe('Đã thêm lựa chọn “Khẩn” cho trường “Độ ưu tiên”.');
    await addFieldOption(f.owner.id, twin.id, { value: 'Khẩn' });
    expect(await shape(f.alpha.id)).toEqual([['Độ ưu tiên', 'DROPDOWN', 0, [['Thấp', 0, null], ['Cao', 1, null], ['Khẩn', 2, null]]]]);
    expect(await shape(f.alpha.id)).toEqual(await shape(f.beta.id));
    expect(resultOf(await askAs(f.owner, f, 'Thêm lựa chọn Khẩn vào trường Độ ưu tiên', { type: 'ADD_FIELD_OPTION', field: 'Độ ưu tiên', value: 'Khẩn' })).summary).toBe('Trường “Độ ưu tiên” đã có lựa chọn “Khẩn” rồi.');

    await prisma.cardFieldValue.create({ data: { cardId: f.loginUi.id, fieldId: field.id, optionId: (await prisma.customFieldOption.findFirstOrThrow({ where: { fieldId: field.id, value: 'Cao' } })).id } });
    const del = await previewAs(f.owner, f, 'Xóa trường Độ ưu tiên', [{ type: 'DELETE_CUSTOM_FIELD', field: 'Độ ưu tiên' }]);
    expect(del.plan.items[0]).toMatchObject({ verb: 'Xóa trường tùy chỉnh', danger: true });
    expect(del.plan.items[0].detail).toContain('trên 1 thẻ');
    expect(resultOf(await del.confirm()).summary).toBe('Đã xóa trường “Độ ưu tiên”.');
    await deleteCustomField(f.owner.id, twin.id);
    expect(await shape(f.alpha.id)).toEqual([]);
    expect(await shape(f.beta.id)).toEqual([]);
    expect(await prisma.cardFieldValue.count({ where: { fieldId: field.id } })).toBe(0);
    expect(await prisma.customFieldOption.count({ where: { fieldId: field.id } })).toBe(0);
  });

  it('lựa chọn cho trường không phải danh sách chọn → từ chối; bảng chưa có trường → nói rõ', async () => {
    const f = await seedActions();
    expect((await askAs(f.owner, f, 'Xóa trường Điểm', { type: 'DELETE_CUSTOM_FIELD', field: 'Điểm' })).answer.text).toContain('chưa có trường tùy chỉnh nào');
    await prisma.customField.create({ data: { boardId: f.alpha.id, name: 'Điểm', type: 'NUMBER', position: 0 } });
    const reply = await askAs(f.owner, f, 'Thêm lựa chọn Cao vào trường Điểm', { type: 'ADD_FIELD_OPTION', field: 'Điểm', value: 'Cao' });
    expect(reply.answer.text).toContain('không phải kiểu danh sách chọn');
  });

  it('người chỉ xem không tạo / xóa được trường', async () => {
    const f = await seedActions();
    const reply = await askAs(f.viewer, f, 'Tạo trường Mức độ kiểu văn bản', { type: 'CREATE_CUSTOM_FIELD', name: 'Mức độ', fieldType: 'TEXT' });
    expect(reply.answer.text).toContain('chỉ có quyền xem');
    expect(await prisma.customField.count({ where: { boardId: f.alpha.id } })).toBe(0);
  });
});

describe('kiểm lại TRONG transaction (lớp phòng thủ thứ hai, sau bước dựng lại + kiểm quyền trước giao dịch)', () => {
  it('canManageInTx / isOwnerInTx đồng nghĩa với canManageBoard / assertBoardOwner', async () => {
    const f = await seedActions();
    await member(f, f.lan.id, 'ADMIN');
    await member(f, f.tuan.id, 'MEMBER');
    const can = (userId: string) => prisma.$transaction((tx) => canManageInTx(tx, f.alpha.id, userId));
    const owns = (userId: string) => prisma.$transaction((tx) => isOwnerInTx(tx, f.alpha.id, userId));
    expect([await can(f.owner.id), await can(f.lan.id), await can(f.tuan.id), await can(f.viewer.id), await can(f.outsider.id)]).toEqual([true, true, false, false, false]);
    expect([await owns(f.owner.id), await owns(f.lan.id)]).toEqual([true, false]);
    // quản trị viên của KHÔNG GIAN quản lý được mọi bảng trong không gian, kể cả khi vai trò ở bảng chỉ là thành viên
    await prisma.workspaceMember.updateMany({ where: { workspaceId: f.ws.id, userId: f.tuan.id }, data: { role: 'ADMIN' } });
    expect(await can(f.tuan.id)).toBe(true);
    await prisma.board.update({ where: { id: f.alpha.id }, data: { archivedAt: new Date() } });
    expect(await can(f.owner.id)).toBe(false);
    expect(await owns(f.owner.id)).toBe(false);
  });

  it('verify của từng thao tác: giá trị cũ đã đổi → STALE; mất quyền → FORBIDDEN', async () => {
    const f = await seedActions();
    await member(f, f.tuan.id, 'MEMBER');
    const ctx = { userId: f.owner.id, boardId: f.alpha.id };
    const stored = (type: StoredOp['type'], before: StoredOp['before'], ids: StoredOp['ids'] = {}): StoredOp => ({ type, ids, params: {}, before, display: {} });
    const run = (o: StoredOp, c = ctx) => prisma.$transaction((tx) => handlerOf(o.type)!.verify!(tx, c, o));
    await expect(run(stored('ARCHIVE_BOARD', { name: 'Tên cũ' }))).rejects.toMatchObject({ code: 'STALE' });
    await expect(run(stored('DELETE_BOARD', { name: 'Tên cũ' }))).rejects.toMatchObject({ code: 'STALE' });
    await expect(run(stored('RENAME_BOARD', { name: 'Tên cũ' }))).rejects.toMatchObject({ code: 'STALE' });
    await expect(run(stored('SET_BOARD_VISIBILITY', { visibility: 'PUBLIC' }))).rejects.toMatchObject({ code: 'STALE' });
    await expect(run(stored('SET_INVITE_LINK', { enabled: true }))).rejects.toMatchObject({ code: 'STALE' });
    await expect(run(stored('CHANGE_MEMBER_ROLE', { role: 'ADMIN' }, { member: f.tuan.id }))).rejects.toMatchObject({ code: 'STALE' });
    await expect(run(stored('ARCHIVE_BOARD', { name: 'Dự án Alpha' }), { userId: f.tuan.id, boardId: f.alpha.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(run(stored('SET_BOARD_VISIBILITY', { visibility: 'WORKSPACE' }), { userId: f.tuan.id, boardId: f.alpha.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(run(stored('REMOVE_BOARD_MEMBER', { role: 'MEMBER' }, { member: f.tuan.id }), { userId: f.tuan.id, boardId: f.alpha.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(run(stored('ARCHIVE_BOARD', { name: 'Dự án Alpha' }))).resolves.toBeUndefined();
  });
});
