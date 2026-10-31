// Bước G - tệp đính kèm qua khung chat: kho tạm (tải lên, hết hạn, chủ sở hữu), ADD_ATTACHMENT (xem trước → Áp dụng, giống addAttachment),
// DELETE_ATTACHMENT (giống deleteAttachment, xóa tệp trên đĩa SAU commit), chống gắn tệp của người khác / hết hạn, dọn tệp khi hoàn tác.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import { cardAttachmentDiskPath } from '../src/config/upload';
import { handleV2Message } from '../src/modules/chat/v2/chat.v2.service';
import { persistentConfirm, persistentMessage } from '../src/modules/chat/v2/chat.v2.history';
import { V2SessionStore } from '../src/modules/chat/v2/chat.v2.session';
import type { V2Reply } from '../src/modules/chat/v2/chat.v2.contract';
import { addAttachment, deleteAttachment } from '../src/modules/card/cardExtras.service';
import { ActionOpSchema, type ActionOp } from '../src/modules/chat/v2/actions/actions.schema';
import { discardAdopted, newEffects } from '../src/modules/chat/v2/actions/actions.effects';
import { assessProvenance } from '../src/modules/chat/v2/actions/actions.provenance';
import { foldWords, licenceFromPositions } from '../src/modules/chat/v2/actions/actions.text';
import { handlerOf } from '../src/modules/chat/v2/actions/ops/ops.registry';
import { CHAT_STAGING_DIR, STAGED_TTL_MS, discardStaged, listStagedFor, registerStaged, resolveStaged, stagedPath, sweepStaging } from '../src/modules/chat/v2/uploads/chat.uploads';
import { agent, makeUser } from './helpers';
import { ACT_NOW, actionContext, propose, script, seedActions, text, type ActionWorld } from './chat.actions.fixture';

const mocks = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock('../src/realtime/socket', async (original) => ({ ...(await original<object>()), emitToBoard: mocks.emit }));
beforeEach(() => mocks.emit.mockClear());

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

/** Ghi một tệp vào kho tạm như multer sẽ làm, rồi đăng ký metadata. */
async function stage(userId: string, name = 'bao-cao.pdf', content = 'noi dung', now = ACT_NOW) {
  const id = randomUUID();
  const disk = path.join(CHAT_STAGING_DIR, id);
  fs.writeFileSync(disk, content);
  const file = { filename: id, path: disk, size: Buffer.byteLength(content), originalname: name } as unknown as Express.Multer.File;
  return registerStaged(userId, file, now);
}
async function previewAttach(f: ActionWorld, message: string, uploadIds: string[], op: unknown) {
  const sessions = new V2SessionStore();
  const scope = onBoard(f);
  const reply = await persistentMessage(f.owner.id, { message, scope, uploadIds }, actionContext({ step: script([propose(op)]), sessions }));
  const plan = planOf(reply);
  return { reply, plan, confirm: () => persistentConfirm(f.owner.id, plan.planId, { conversationId: reply.conversationId, checksum: plan.checksum, scope }, actionContext({ sessions, now: ACT_NOW })) };
}
const op = (value: unknown): ActionOp => ActionOpSchema.parse(value);
const t = (s: string) => ({ by: 'TEXT' as const, text: s });
const lic = (message: string, value: unknown) => {
  const o = op(value);
  const words = foldWords(message);
  return licenceFromPositions(handlerOf(o.type)!.licence(words, o as never), words);
};

describe('hợp đồng thuần', () => {
  it('schema: ADD_ATTACHMENT chỉ có card + file (tên); không có ô nào để điền đường dẫn / id tệp', () => {
    expect(ActionOpSchema.safeParse({ type: 'ADD_ATTACHMENT', card: t('Login') }).success).toBe(true);
    expect(ActionOpSchema.safeParse({ type: 'ADD_ATTACHMENT', card: t('Login'), file: 'báo cáo' }).success).toBe(true);
    for (const bad of [{ type: 'ADD_ATTACHMENT', card: t('A'), path: '/etc/passwd' }, { type: 'ADD_ATTACHMENT', card: t('A'), uploadId: 'x' }, { type: 'ADD_ATTACHMENT', card: t('A'), url: 'http://x' }]) {
      expect(ActionOpSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('giấy phép: "đính kèm file này vào thẻ", "thêm tệp vào thẻ" có; "thêm thẻ vào cột", "tạo thẻ" không', () => {
    const add = { type: 'ADD_ATTACHMENT', card: t('Login UI') };
    for (const m of ['Đính kèm file này vào thẻ Login UI', 'Thêm tệp báo cáo vào thẻ Login UI', 'Gắn file vào thẻ Login UI', 'Đính kèm vào thẻ Login UI', 'Upload tài liệu lên thẻ Login UI']) expect(lic(m, add).licensed, m).toBe(true);
    for (const m of ['Thêm thẻ Deploy vào cột Cần làm', 'Tạo thẻ Login UI', 'Chuyển thẻ Login UI sang Done', 'Thẻ Login UI có tệp nào']) expect(lic(m, add).licensed, m).toBe(false);
    const del = { type: 'DELETE_ATTACHMENT', card: t('Login UI') };
    expect(lic('Xóa file báo cáo khỏi thẻ Login UI', del).licensed).toBe(true);
    expect(lic('Xóa thẻ Login UI', del).licensed).toBe(false);
  });

  it('nguồn gốc: tên tệp mô hình tự nghĩ → phải xem lại; không có động từ → không được yêu cầu', () => {
    const prov = (message: string, value: unknown) => assessProvenance(op(value), message, '2026-10-07');
    expect(prov('Đính kèm file báo cáo vào thẻ Login UI', { type: 'ADD_ATTACHMENT', card: t('Login UI'), file: 'báo cáo' }).verdict).toBe('USER_DIRECT');
    expect(prov('Đính kèm file báo cáo vào thẻ Login UI', { type: 'ADD_ATTACHMENT', card: t('Login UI'), file: 'mật khẩu' }).verdict).toBe('UNGROUNDED');
    expect(prov('Thẻ Login UI có file nào?', { type: 'ADD_ATTACHMENT', card: t('Login UI') }).verdict).toBe('NOT_REQUESTED');
  });
});

describe('kho tạm', () => {
  it('đăng ký → chỉ chủ sở hữu thấy; hết hạn bị dọn; mỗi người tối đa 10 tệp', async () => {
    const f = await seedActions();
    const a = await stage(f.owner.id, 'a.pdf');
    expect(a).toMatchObject({ name: 'a.pdf', ext: '.pdf', userId: f.owner.id });
    expect((await listStagedFor(f.owner.id, ACT_NOW)).map((u) => u.id)).toEqual([a.id]);
    expect(await listStagedFor(f.lan.id, ACT_NOW)).toEqual([]);
    await expect(resolveStaged(f.lan.id, [a.id], ACT_NOW)).rejects.toMatchObject({ statusCode: 404 });
    await expect(resolveStaged(f.owner.id, [a.id], new Date(ACT_NOW.getTime() + STAGED_TTL_MS + 1000))).rejects.toMatchObject({ statusCode: 404 });
    expect(await sweepStaging(new Date(ACT_NOW.getTime() + STAGED_TTL_MS + 1000))).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(stagedPath(a.id))).toBe(false);

    const many: string[] = [];
    for (let i = 0; i < 10; i += 1) many.push((await stage(f.owner.id, `f${i}.txt`)).id);
    await expect(stage(f.owner.id, 'f11.txt')).rejects.toMatchObject({ statusCode: 400 });
    expect(many).toHaveLength(10);
  });

  it('bỏ tệp: chỉ chủ sở hữu xóa được', async () => {
    const f = await seedActions();
    const a = await stage(f.owner.id);
    expect(await discardStaged(f.lan.id, a.id)).toBe(false);
    expect(fs.existsSync(stagedPath(a.id))).toBe(true);
    expect(await discardStaged(f.owner.id, a.id)).toBe(true);
    expect(fs.existsSync(stagedPath(a.id))).toBe(false);
  });

  it('đường dẫn lạ không bao giờ ra khỏi kho tạm', () => {
    expect(() => stagedPath('../../etc/passwd')).toThrow();
    expect(() => stagedPath('abc')).toThrow();
  });
});

describe('HTTP: /api/chat/v2/uploads', () => {
  it('cần đăng nhập; tải lên được → trả id + tên + kích thước; đuôi lạ bị từ chối; xóa của người khác không được', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    expect((await agent().post('/api/chat/v2/uploads').attach('file', Buffer.from('x'), 'a.txt')).status).toBe(401);
    const ok = await agent().post('/api/chat/v2/uploads').set('Cookie', owner.cookie).attach('file', Buffer.from('hello'), 'ghi-chu.txt');
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ name: 'ghi-chu.txt', size: 5 });
    expect(typeof ok.body.data.id).toBe('string');
    const exe = await agent().post('/api/chat/v2/uploads').set('Cookie', owner.cookie).attach('file', Buffer.from('MZ'), 'virus.exe');
    expect(exe.status).toBe(400);
    expect((await agent().delete(`/api/chat/v2/uploads/${ok.body.data.id}`).set('Cookie', other.cookie)).body.data.removed).toBe(false);
    expect(fs.existsSync(stagedPath(ok.body.data.id))).toBe(true);
    expect((await agent().delete(`/api/chat/v2/uploads/${ok.body.data.id}`).set('Cookie', owner.cookie)).body.data.removed).toBe(true);
    expect(fs.existsSync(stagedPath(ok.body.data.id))).toBe(false);
  });
});

describe('ADD_ATTACHMENT - luôn xem trước, giống addAttachment', () => {
  it('xem trước liệt kê tên + kích thước (lý do FILE) → Áp dụng: dòng Attachment, tệp vào thư mục thẻ, tệp tạm được dọn, Activity + thông báo như thao tác tay', async () => {
    const f = await seedActions();
    const twin = await prisma.card.create({ data: { listId: f.todo.id, title: 'Thẻ đối chứng' } });
    for (const c of [f.loginUi, twin]) await prisma.cardMember.create({ data: { cardId: c.id, userId: f.lan.id } });
    const up = await stage(f.owner.id, 'bao-cao.pdf', 'noi dung bao cao');
    const p = await previewAttach(f, 'Đính kèm file này vào thẻ Login UI', [up.id], { type: 'ADD_ATTACHMENT', card: text('Login UI') });
    expect(p.plan).toMatchObject({ requiresConfirmation: true, risk: 'MEDIUM', reasons: [{ code: 'FILE' }], items: [{ verb: 'Đính kèm tệp', text: '“bao-cao.pdf” vào thẻ “Login UI”', detail: expect.stringContaining('bao-cao.pdf') }] });
    expect(await prisma.attachment.count()).toBe(0);
    expect(resultOf(await p.confirm())).toMatchObject({ status: 'EXECUTED', summary: 'Đã đính kèm tệp “bao-cao.pdf” vào thẻ “Login UI”.' });
    const att = await prisma.attachment.findFirstOrThrow({ where: { cardId: f.loginUi.id } });
    expect(att).toMatchObject({ name: 'bao-cao.pdf', uploaderId: f.owner.id, size: 16, mime: 'application/pdf' });
    expect(att.url).toMatch(/^\/uploads\/cards\/[0-9a-f-]+\.pdf$/);
    expect(fs.readFileSync(cardAttachmentDiskPath(att.url), 'utf8')).toBe('noi dung bao cao');
    expect(fs.existsSync(stagedPath(up.id))).toBe(false);

    // so voi service that tren the doi chung
    const fakeFile = { originalname: 'bao-cao.pdf', mimetype: 'application/pdf', size: 16, filename: `${randomUUID()}.pdf` } as Express.Multer.File;
    fs.writeFileSync(cardAttachmentDiskPath(fakeFile.filename), 'noi dung bao cao');
    const real = await addAttachment(f.owner.id, twin.id, fakeFile);
    expect({ name: real.name, mime: real.mime, size: real.size, uploaderId: real.uploaderId }).toEqual({ name: att.name, mime: att.mime, size: att.size, uploaderId: att.uploaderId });
    const log = async (cardId: string) => (await prisma.activity.findMany({ where: { cardId, type: 'attachment.add' } })).map((x) => ({ userId: x.userId, data: x.data }));
    expect(await log(f.loginUi.id)).toEqual(await log(twin.id));
    const notes = async (cardId: string) => (await prisma.notification.findMany({ where: { cardId, type: 'card.attachment.added' } })).map((n) => ({ userId: n.userId, actorId: n.actorId, name: (n.data as { name?: string }).name }));
    expect(await notes(f.loginUi.id)).toEqual([{ userId: f.lan.id, actorId: f.owner.id, name: 'bao-cao.pdf' }]);
    expect(await notes(f.loginUi.id)).toEqual(await notes(twin.id));
  });

  it('không đính kèm tệp nào → nói rõ cách làm, không ghi gì', async () => {
    const f = await seedActions();
    const reply = await handleV2Message(f.owner.id, { message: 'Đính kèm file này vào thẻ Login UI', scope: onBoard(f) }, actionContext({ step: script([propose({ type: 'ADD_ATTACHMENT', card: text('Login UI') })]) }));
    expect(reply.answer.text).toContain('nút kẹp giấy');
    expect(await prisma.attachment.count()).toBe(0);
  });

  it('tệp của NGƯỜI KHÁC hoặc đã hết hạn → lỗi rõ ràng, tệp không bị gắn', async () => {
    const f = await seedActions();
    const theirs = await stage(f.lan.id, 'cua-lan.pdf');
    await expect(handleV2Message(f.owner.id, { message: 'Đính kèm file này vào thẻ Login UI', scope: onBoard(f), uploadIds: [theirs.id] }, actionContext({ step: script([propose({ type: 'ADD_ATTACHMENT', card: text('Login UI') })]) }))).rejects.toMatchObject({ statusCode: 404 });
    const old = await stage(f.owner.id, 'cu.pdf', 'x', new Date(ACT_NOW.getTime() - STAGED_TTL_MS - 5000));
    await expect(handleV2Message(f.owner.id, { message: 'Đính kèm file này vào thẻ Login UI', scope: onBoard(f), uploadIds: [old.id] }, actionContext({ step: script([propose({ type: 'ADD_ATTACHMENT', card: text('Login UI') })]) }))).rejects.toMatchObject({ statusCode: 404 });
    expect(await prisma.attachment.count()).toBe(0);
  });

  it('nhiều tệp: chọn một tệp theo tên; không có trong các tệp vừa đính kèm → nói rõ', async () => {
    const f = await seedActions();
    const a = await stage(f.owner.id, 'bao-cao-tuan.pdf');
    const b = await stage(f.owner.id, 'hop-dong.docx');
    const reply = await handleV2Message(f.owner.id, { message: 'Đính kèm file hợp đồng vào thẻ Login UI', scope: onBoard(f), uploadIds: [a.id, b.id] }, actionContext({ step: script([propose({ type: 'ADD_ATTACHMENT', card: text('Login UI'), file: 'hợp đồng' })]), autoExecute: true }));
    const plan = planOf(reply);
    expect(plan.items[0].text).toBe('“hop-dong.docx” vào thẻ “Login UI”');
    const none = await handleV2Message(f.owner.id, { message: 'Đính kèm file ảnh vào thẻ Login UI', scope: onBoard(f), uploadIds: [a.id, b.id] }, actionContext({ step: script([propose({ type: 'ADD_ATTACHMENT', card: text('Login UI'), file: 'ảnh' })]) }));
    expect(none.answer.text).toContain('Không thấy tệp “ảnh”');
  });

  it('tệp tạm hết hạn GIỮA xem trước và Áp dụng → STALE, không gắn; tệp tạm không bị mất tích âm thầm', async () => {
    const f = await seedActions();
    const up = await stage(f.owner.id, 'a.pdf');
    const p = await previewAttach(f, 'Đính kèm file này vào thẻ Login UI', [up.id], { type: 'ADD_ATTACHMENT', card: text('Login UI') });
    await discardStaged(f.owner.id, up.id);
    expect(resultOf(await p.confirm()).status).not.toBe('EXECUTED');
    expect(await prisma.attachment.count()).toBe(0);
  });

  it('người chỉ-xem không gắn được; discardAdopted gỡ tệp đã chép khi hoàn tác', async () => {
    const f = await seedActions();
    const up = await stage(f.viewer.id, 'a.pdf');
    const viewer = await handleV2Message(f.viewer.id, { message: 'Đính kèm file này vào thẻ Login UI', scope: onBoard(f), uploadIds: [up.id] }, actionContext({ step: script([propose({ type: 'ADD_ATTACHMENT', card: text('Login UI') })]) }));
    expect(viewer.answer.action).toBeUndefined();
    expect(await prisma.attachment.count()).toBe(0);

    const filename = `${randomUUID()}.pdf`;
    fs.writeFileSync(cardAttachmentDiskPath(filename), 'x');
    const effects = newEffects();
    effects.files.adopted.push(`/uploads/cards/${filename}`);
    discardAdopted(effects);
    await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(cardAttachmentDiskPath(filename))).toBe(false);
  });
});

describe('DELETE_ATTACHMENT - luôn xem trước (HIGH), giống deleteAttachment', () => {
  it('xem trước có cảnh báo → Áp dụng: xóa dòng, bỏ ảnh bìa nếu tệp đó là ảnh bìa, xóa tệp trên đĩa sau commit', async () => {
    const f = await seedActions();
    const mk = async (cardId: string, name: string) => {
      const filename = `${randomUUID()}.png`;
      fs.writeFileSync(cardAttachmentDiskPath(filename), 'png');
      return prisma.attachment.create({ data: { cardId, uploaderId: f.owner.id, name, url: `/uploads/cards/${filename}`, mime: 'image/png', size: 3 } });
    };
    const twin = await prisma.card.create({ data: { listId: f.todo.id, title: 'Thẻ đối chứng' } });
    const a = await mk(f.loginUi.id, 'so-do.png');
    const b = await mk(twin.id, 'so-do.png');
    await prisma.card.update({ where: { id: f.loginUi.id }, data: { coverImageUrl: a.url } });
    await prisma.card.update({ where: { id: twin.id }, data: { coverImageUrl: b.url } });
    const sessions = new V2SessionStore();
    const scope = onBoard(f);
    const reply = await persistentMessage(f.owner.id, { message: 'Xóa file so-do.png khỏi thẻ Login UI', scope }, actionContext({ step: script([propose({ type: 'DELETE_ATTACHMENT', card: text('Login UI'), match: 'so-do.png' })]), sessions }));
    const plan = planOf(reply);
    expect(plan).toMatchObject({ risk: 'HIGH', items: [{ verb: 'Xóa tệp đính kèm', danger: true }] });
    expect(plan.reasons.map((r) => r.code)).toContain('DELETE');
    const done = await persistentConfirm(f.owner.id, plan.planId, { conversationId: reply.conversationId, checksum: plan.checksum, scope }, actionContext({ sessions, now: ACT_NOW }));
    expect(resultOf(done).status).toBe('EXECUTED');
    await deleteAttachment(f.owner.id, b.id);
    await new Promise((r) => setTimeout(r, 50));
    for (const [att, cardId] of [[a, f.loginUi.id], [b, twin.id]] as const) {
      expect(await prisma.attachment.findUnique({ where: { id: att.id } })).toBeNull();
      expect((await prisma.card.findUniqueOrThrow({ where: { id: cardId } })).coverImageUrl).toBeNull();
      expect(fs.existsSync(cardAttachmentDiskPath(att.url))).toBe(false);
    }
  });

  it('thẻ không có tệp / không có tệp tên đó → nói rõ', async () => {
    const f = await seedActions();
    const none = await handleV2Message(f.owner.id, { message: 'Xóa file khỏi thẻ Login UI', scope: onBoard(f) }, actionContext({ step: script([propose({ type: 'DELETE_ATTACHMENT', card: text('Login UI') })]) }));
    expect(none.answer.text).toContain('chưa có tệp đính kèm nào');
    await prisma.attachment.create({ data: { cardId: f.loginUi.id, uploaderId: f.owner.id, name: 'a.pdf', url: '/uploads/cards/none.pdf', mime: 'application/pdf', size: 1 } });
    const missing = await handleV2Message(f.owner.id, { message: 'Xóa file b.pdf khỏi thẻ Login UI', scope: onBoard(f) }, actionContext({ step: script([propose({ type: 'DELETE_ATTACHMENT', card: text('Login UI'), match: 'b.pdf' })]) }));
    expect(missing.answer.text).toContain('Không tìm thấy tệp đính kèm');
  });
});
