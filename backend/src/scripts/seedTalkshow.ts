// Do bo DEMO "Ban to chuc Talk show" vao CSDL dang cau hinh (mac dinh la DB dev). CHAY TAY, khong nam trong bo test:
//
//   npx tsx src/scripts/seedTalkshow.ts            don ban cu (neu co) roi tao lai
//   npx tsx src/scripts/seedTalkshow.ts --remove   chi go bo demo, khong tao moi
//
// Tao: 7 tai khoan moi @talkshow.test (kem khong gian ca nhan + ho so chuyen mon + CV .docx that), khong gian nhom "Ban to chuc
// Talk show" do truong nhom lam chu, bang talk show 14/11/2026 da chia san viec (nhan, truong tuy chinh, checklist, binh luan,
// nhat ky) va mot bang talk show CU da xong (lich su lam viec cho module goi y phan cong). Du lieu soan tay: talkshowData.ts.
//
// AN TOAN:
//   - 3 tai khoan CO SAN (gmail cua nhom) chi duoc TIM theo email: khong doi ten, mat khau, CV; chi ghi de ky nang + cong viec da
//     lam trong ho so tu khai (tao ho so neu chua co). --remove KHONG khoi phuc phan ho so nay.
//   - Phan don dep chi xoa tai khoan @talkshow.test va DUNG khong gian ten "Ban to chuc Talk show" ma truong nhom lam chu.
//   - Tep CV: chi xoa dung ten tep ghi trong ho so cua tai khoan @talkshow.test (khong bao gio xoa theo mau ten).
//   - Tu choi chay khi NODE_ENV=production. Chay tren host: DATABASE_URL trong backend/.env tro toi localhost:5432.

import crypto from 'node:crypto';
import fs from 'node:fs';
import JSZip from 'jszip';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { cvDiskPath } from '../config/upload';
import type { Prisma } from '../generated/prisma/client';
import type { CardStatus } from '../generated/prisma/enums';
import { extractDocument } from '../modules/ai/ai.document';
import { hashPassword } from '../utils/password';
import {
  AUTHORED_TODAY,
  EMAIL_DOMAIN,
  LABELS,
  MAIN_BOARD,
  MAIN_CARDS,
  PAST_BOARD,
  PAST_CARDS,
  PEOPLE,
  PHASES,
  PRIORITIES,
  WORKSPACE_NAME,
  type CardDef,
  type LabelName,
  type ListKey,
  type PersonKey,
  type TalkshowPerson,
} from './talkshowData';

export const DEFAULT_PASSWORD = 'Talkshow@2026';

type Tx = Prisma.TransactionClient;

// ===================== Thoi gian (gio Viet Nam) =====================

const VN_OFFSET_MS = 7 * 3600_000;
const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

/** 'YYYY-MM-DD' hoac 'YYYY-MM-DD HH:mm' theo gio VN -> Date. Thieu gio thi dung `defaultTime`. */
function vn(value: string, defaultTime = '00:00'): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(value);
  if (!m) throw new Error(`Mốc thời gian sai định dạng: "${value}"`);
  const [hh, mm] = m[4] !== undefined ? [m[4], m[5]!] : defaultTime.split(':');
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(hh), Number(mm)) - VN_OFFSET_MS);
  // Date.UTC tu "tran" ngay sai (31/02 -> 03/03): doi chieu lai de bat loi go nham.
  const back = new Date(date.getTime() + VN_OFFSET_MS);
  if (back.getUTCDate() !== Number(m[3]) || back.getUTCMonth() !== Number(m[2]) - 1) {
    throw new Error(`Ngày không tồn tại: "${value}"`);
  }
  return date;
}

const startOf = (s: string) => vn(s, '08:00');
const dueOf = (s: string) => vn(s, '23:59');
const doneOf = (s: string) => vn(s, '17:00');
const maxDate = (...ds: Date[]) => new Date(Math.max(...ds.map((d) => d.getTime())));
const minDate = (...ds: Date[]) => new Date(Math.min(...ds.map((d) => d.getTime())));

// ===================== Kiem tra du lieu soan tay =====================

const LIST_KEYS: readonly ListKey[] = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'BLOCKED', 'DONE'];

/** Bat loi go nham trong talkshowData.ts TRUOC khi dung toi CSDL. Tra ve danh sach loi (rong = hop le). */
export function validateTalkshowData(now: Date): string[] {
  const errors: string[] = [];
  const keys = new Set<PersonKey>();
  const emails = new Set<string>();
  for (const p of PEOPLE) {
    if (keys.has(p.key)) errors.push(`Trùng mã người "${p.key}"`);
    keys.add(p.key);
    const email = p.email.toLowerCase();
    if (emails.has(email)) errors.push(`Trùng email "${p.email}"`);
    emails.add(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)) errors.push(`Email sai định dạng: "${p.email}"`);
    if (!p.existing && !p.email.endsWith(`@${EMAIL_DOMAIN}`)) errors.push(`Tài khoản mới phải có đuôi @${EMAIL_DOMAIN}: ${p.email}`);
    if (p.existing && p.cv !== null) errors.push(`Không tạo CV cho tài khoản có sẵn: ${p.email}`);
    if (!p.existing && p.cv === null) errors.push(`Tài khoản mới phải có CV: ${p.email}`);
    if (p.capacity < 1 || p.capacity > 30) errors.push(`Sức chứa ngoài 1–30: ${p.key}`);
    if (p.skills.length === 0 || p.skills.join(', ').length > 2000) errors.push(`Kỹ năng rỗng hoặc quá 2000 ký tự: ${p.key}`);
    if (p.workItems.length === 0 || p.workItems.length > 30) errors.push(`Số công việc đã làm ngoài 1–30: ${p.key}`);
    for (const w of p.workItems) {
      if (w.title.length > 200 || w.description.length > 1000) errors.push(`Công việc đã làm quá dài: ${p.key} / ${w.title}`);
    }
  }
  if (PEOPLE[0]?.workspaceRole !== 'OWNER' || PEOPLE.filter((p) => p.workspaceRole === 'OWNER').length !== 1) {
    errors.push('Người đầu tiên phải là trưởng nhóm (OWNER) và chỉ có một OWNER');
  }

  const person = (k: PersonKey, where: string) => {
    if (!keys.has(k)) errors.push(`${where}: không có người "${k}"`);
  };
  const boardCreated = vn(MAIN_BOARD.createdAt);
  const titles = new Set<string>();
  for (const c of MAIN_CARDS) {
    const at = `Thẻ "${c.title}"`;
    if (titles.has(c.title)) errors.push(`${at}: trùng tiêu đề`);
    titles.add(c.title);
    if (c.title.length > 500 || c.description.length > 5000) errors.push(`${at}: tiêu đề/mô tả quá dài`);
    if (!LIST_KEYS.includes(c.list)) errors.push(`${at}: cột "${c.list}" không tồn tại`);
    if (c.members.length === 0) errors.push(`${at}: chưa giao cho ai`);
    if (new Set(c.members).size !== c.members.length) errors.push(`${at}: trùng người nhận`);
    c.members.forEach((m) => person(m, at));
    for (const l of c.labels) if (!(l in LABELS)) errors.push(`${at}: không có nhãn "${l}"`);
    if (!(c.phase in PHASES)) errors.push(`${at}: không có giai đoạn "${c.phase}"`);
    if (!(c.priority in PRIORITIES)) errors.push(`${at}: không có mức ưu tiên "${c.priority}"`);
    if (c.budget !== undefined && (!Number.isFinite(c.budget) || c.budget <= 0)) errors.push(`${at}: ngân sách phải > 0`);
    if (c.contact !== undefined && c.contact.trim() === '') errors.push(`${at}: đầu mối liên hệ rỗng`);
    try {
      const start = startOf(c.start);
      const due = dueOf(c.due);
      if (start > due) errors.push(`${at}: bắt đầu sau hạn`);
      if (start < boardCreated) errors.push(`${at}: bắt đầu trước khi tạo bảng`);
      if (c.list === 'DONE') {
        if (!c.done) errors.push(`${at}: thẻ Hoàn thành thiếu ngày xong`);
        else if (doneOf(c.done) > now || doneOf(c.done) < start) errors.push(`${at}: ngày xong phải trong [bắt đầu, bây giờ]`);
      } else if (c.done) {
        errors.push(`${at}: chỉ thẻ Hoàn thành mới có ngày xong`);
      }
      if (c.list !== 'TODO' && start > now) errors.push(`${at}: thẻ đã bắt đầu làm nhưng ngày bắt đầu ở tương lai`);
      if (c.movedAt !== undefined) {
        if (c.list !== 'IN_REVIEW' && c.list !== 'BLOCKED') errors.push(`${at}: movedAt chỉ dùng cho Chờ duyệt / Đang vướng`);
        const moved = vn(c.movedAt);
        if (moved > now || moved < start) errors.push(`${at}: movedAt phải trong [bắt đầu, bây giờ]`);
      }
      for (const [author, when, text] of c.comments ?? []) {
        person(author, `${at} (bình luận)`);
        if (vn(when) > now) errors.push(`${at}: bình luận ở tương lai`);
        if (text.trim() === '' || text.length > 5000) errors.push(`${at}: bình luận rỗng hoặc quá dài`);
      }
      for (const cl of c.checklists ?? []) {
        if (cl.title.trim() === '' || cl.title.length > 200) errors.push(`${at}: tên checklist rỗng hoặc quá dài`);
        for (const [content, , assignee, itemDue] of cl.items) {
          if (content.trim() === '' || content.length > 500) errors.push(`${at}: mục checklist rỗng hoặc quá dài`);
          if (assignee) person(assignee, `${at} (checklist)`);
          if (itemDue) dueOf(itemDue);
        }
      }
    } catch (err) {
      errors.push(`${at}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const pastCreated = vn(PAST_BOARD.createdAt);
  for (const [who, title, , start, due, done] of PAST_CARDS) {
    const at = `Thẻ cũ "${title}"`;
    person(who, at);
    try {
      const s = startOf(start);
      const d = dueOf(due);
      const x = doneOf(done);
      if (s > d) errors.push(`${at}: bắt đầu sau hạn`);
      if (s < pastCreated) errors.push(`${at}: bắt đầu trước khi tạo bảng cũ`);
      if (x < s || x > now) errors.push(`${at}: ngày xong phải trong [bắt đầu, bây giờ]`);
      if (x >= boardCreated) errors.push(`${at}: lịch sử phải xong trước khi bắt đầu talk show mới`);
    } catch (err) {
      errors.push(`${at}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return errors;
}

// ===================== CV .docx =====================

const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function para(text: string, opts: { style?: string; bullet?: boolean; bold?: boolean } = {}): string {
  const style = opts.style ? `<w:pStyle w:val="${opts.style}"/>` : '';
  const num = opts.bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '';
  const run = opts.bold ? '<w:rPr><w:b/></w:rPr>' : '';
  return `<w:p><w:pPr>${style}${num}</w:pPr><w:r>${run}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

const STYLES_XML =
  `${XML_HEAD}<w:styles ${W_NS}>` +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:color w:val="1F3864"/></w:rPr></w:style>' +
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="1F3864"/></w:rPr></w:style>' +
  '</w:styles>';

const NUMBERING_XML =
  `${XML_HEAD}<w:numbering ${W_NS}>` +
  '<w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="360" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>';

/** CV that (dinh dang OOXML toi thieu, Word mo duoc, mammoth doc duoc) cho mot nguoi moi. */
export async function buildCvDocx(p: TalkshowPerson): Promise<Buffer> {
  if (!p.cv) throw new Error(`${p.key} không có nội dung CV`);
  const cv = p.cv;
  const body = [
    para(p.name, { style: 'Title' }),
    para(cv.headline, { bold: true }),
    para(`Email: ${p.email} · Hà Nội`),
    para('MỤC TIÊU NGHỀ NGHIỆP', { style: 'Heading1' }),
    para(cv.objective),
    para('HỌC VẤN', { style: 'Heading1' }),
    para(cv.education),
    para('KINH NGHIỆM', { style: 'Heading1' }),
    ...cv.experiences.flatMap((e) => [para(`${e.title} (${e.time})`, { bold: true }), ...e.bullets.map((b) => para(b, { bullet: true }))]),
    para('KỸ NĂNG', { style: 'Heading1' }),
    ...p.skills.map((s) => para(s, { bullet: true })),
    para('CÔNG CỤ', { style: 'Heading1' }),
    para(cv.tools.join(', ')),
    para('THÀNH TÍCH', { style: 'Heading1' }),
    ...cv.achievements.map((a) => para(a, { bullet: true })),
  ].join('');

  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`
  );
  zip.file(
    '_rels/.rels',
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
  );
  zip.file(
    'word/document.xml',
    `${XML_HEAD}<w:document ${W_NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr></w:body></w:document>`
  );
  zip.file('word/numbering.xml', NUMBERING_XML);
  zip.file('word/styles.xml', STYLES_XML);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

/** "Trần Thu Hà" -> "CV_TranThuHa.docx" (ten tep hien thi khi tai ve). */
export function cvFileNameOf(name: string): string {
  const ascii = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9]+/g, '');
  return `CV_${ascii || 'thanhvien'}.docx`;
}

interface PreparedCv {
  key: PersonKey;
  fileName: string;
  storedName: string;
  size: number;
  text: string;
}

/** Sinh CV, TRICH CHU bang dung bo trich cua app (nhu luc nguoi dung tai len) roi ghi tep vao uploads/cv. */
async function prepareCvFiles(): Promise<PreparedCv[]> {
  const out: PreparedCv[] = [];
  try {
    for (const p of PEOPLE) {
      if (!p.cv) continue;
      const buffer = await buildCvDocx(p);
      const fileName = cvFileNameOf(p.name);
      const extracted = await extractDocument(buffer, fileName);
      const storedName = `${crypto.randomUUID()}.docx`;
      await fs.promises.writeFile(cvDiskPath(storedName), buffer);
      out.push({ key: p.key, fileName, storedName, size: buffer.length, text: extracted.text });
    }
  } catch (err) {
    removeCvFiles(out.map((c) => c.storedName));
    throw err;
  }
  return out;
}

/** Xoa DUNG cac tep da biet ten (khong bao gio xoa theo mau). Loi tung tep chi in canh bao. */
function removeCvFiles(storedNames: readonly string[]): void {
  for (const name of storedNames) {
    try {
      fs.rmSync(cvDiskPath(name), { force: true });
    } catch (err) {
      console.warn(`Canh bao: khong xoa duoc tep CV ${name}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

// ===================== Go bo demo =====================

export interface RemoveResult {
  users: number;
  workspaces: number;
  /** Tep CV can xoa SAU khi transaction thanh cong. */
  cvFiles: string[];
}

async function removeTalkshow(tx: Tx): Promise<RemoveResult> {
  const leader = await tx.user.findUnique({ where: { email: PEOPLE[0]!.email }, select: { id: true } });
  const workspaces = leader
    ? await tx.workspace.findMany({
        where: { ownerId: leader.id, name: WORKSPACE_NAME, isPersonal: false },
        select: { id: true },
      })
    : [];
  const workspaceIds = workspaces.map((w) => w.id);
  if (workspaceIds.length > 0) {
    // AssignRun dung SetNull (nhat ky song sot qua viec xoa) - day la nhat ky cua du lieu demo, de lai chi la rac mo coi.
    await tx.assignRun.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    // Cascade: bang, danh sach, the, thanh vien, nhan, truong tuy chinh, nhat ky, ho so lam viec trong khong gian.
    await tx.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  }

  const users = await tx.user.findMany({
    where: { email: { endsWith: `@${EMAIL_DOMAIN}` } },
    select: { id: true, assignProfile: { select: { cvStoredName: true } } },
  });
  const cvFiles = users.flatMap((u) => (u.assignProfile?.cvStoredName ? [u.assignProfile.cvStoredName] : []));
  if (users.length > 0) {
    // Cascade: khong gian ca nhan, ho so tu khai, binh luan, nhat ky... cua chinh tai khoan demo.
    await tx.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  }
  return { users: users.length, workspaces: workspaceIds.length, cvFiles };
}

// ===================== Tao demo =====================

const LIST_ORDER: Record<ListKey, number> = { TODO: 0, IN_PROGRESS: 1, IN_REVIEW: 2, BLOCKED: 3, DONE: 4 };

interface Ctx {
  tx: Tx;
  now: Date;
  userId: Record<PersonKey, string>;
  nameOf: Record<PersonKey, string>;
  activities: Prisma.ActivityCreateManyInput[];
}

interface BoardRefs {
  id: string;
  listId: Partial<Record<ListKey, string>>;
  listName: Partial<Record<ListKey, string>>;
  labelId: Record<LabelName, string>;
}

async function createBoard(
  ctx: Ctx,
  workspaceId: string,
  def: { name: string; color: string; createdAt: string; lists: readonly { key: ListKey; name: string }[] }
): Promise<BoardRefs> {
  const { tx } = ctx;
  const createdAt = vn(def.createdAt);
  const lead = PEOPLE[0]!;
  const board = await tx.board.create({
    data: {
      ownerId: ctx.userId[lead.key],
      workspaceId,
      name: def.name,
      color: def.color,
      visibility: 'WORKSPACE',
      createdAt,
    },
    select: { id: true },
  });

  const listId: Partial<Record<ListKey, string>> = {};
  const listName: Partial<Record<ListKey, string>> = {};
  for (const [i, l] of def.lists.entries()) {
    const list = await tx.list.create({
      data: { boardId: board.id, name: l.name, status: l.key as CardStatus, position: i, createdAt },
      select: { id: true },
    });
    listId[l.key] = list.id;
    listName[l.key] = l.name;
  }

  const labelId = {} as Record<LabelName, string>;
  for (const [name, color] of Object.entries(LABELS) as [LabelName, string][]) {
    const label = await tx.label.create({ data: { boardId: board.id, name, color, createdAt }, select: { id: true } });
    labelId[name] = label.id;
  }

  for (const p of PEOPLE) {
    await tx.boardMember.create({
      data: {
        boardId: board.id,
        userId: ctx.userId[p.key],
        role: p.workspaceRole,
        joinedAt: createdAt,
        createdAt,
      },
    });
  }
  return { id: board.id, listId, listName, labelId };
}

interface FieldRefs {
  phaseFieldId: string;
  phaseOption: Record<string, string>;
  priorityFieldId: string;
  priorityOption: Record<string, string>;
  budgetFieldId: string;
  contactFieldId: string;
}

async function createCustomFields(tx: Tx, boardId: string): Promise<FieldRefs> {
  const dropdown = async (name: string, position: number, options: Record<string, string>) => {
    const field = await tx.customField.create({
      data: {
        boardId,
        name,
        type: 'DROPDOWN',
        position,
        options: { create: Object.entries(options).map(([value, color], i) => ({ value, color, position: i })) },
      },
      select: { id: true, options: { select: { id: true, value: true } } },
    });
    return { id: field.id, option: Object.fromEntries(field.options.map((o) => [o.value, o.id])) };
  };
  const phase = await dropdown('Giai đoạn', 0, PHASES);
  const priority = await dropdown('Mức ưu tiên', 1, PRIORITIES);
  const budget = await tx.customField.create({
    data: { boardId, name: 'Ngân sách dự kiến (VNĐ)', type: 'NUMBER', position: 2 },
    select: { id: true },
  });
  const contact = await tx.customField.create({
    data: { boardId, name: 'Đầu mối liên hệ', type: 'TEXT', position: 3 },
    select: { id: true },
  });
  return {
    phaseFieldId: phase.id,
    phaseOption: phase.option,
    priorityFieldId: priority.id,
    priorityOption: priority.option,
    budgetFieldId: budget.id,
    contactFieldId: contact.id,
  };
}

/**
 * Do phuc tap (story point) cho the demo (RISK_MODULE.md §2: "bo sung gia tri cho du lieu seed"): suy tu thoi luong ke hoach
 * bat dau -> han (<= 1 ngay: 1, <= 3: 2, <= 6: 3, <= 10: 5, con lai: 8). Co y BO TRONG 1/3 so the (thu tu chia 3 du 2) de luat
 * uoc luong tu checklist cua module canh bao tre han cung duoc dung toi - giong du lieu that, khong ai cung nhap du. Tat dinh.
 */
export function storyPointsOf(start: Date, due: Date, index: number): number | null {
  if (index % 3 === 2) return null;
  const days = (due.getTime() - start.getTime()) / DAY_MS;
  if (days <= 1) return 1;
  if (days <= 3) return 2;
  if (days <= 6) return 3;
  if (days <= 10) return 5;
  return 8;
}

/** Ghi lai mot lan "keo the" giua hai cot dung nhu card.service: card.move + card.status / card.done. */
function logMove(ctx: Ctx, boardId: string, cardId: string, userId: string, at: Date, from: [string, ListKey], to: [string, ListKey]) {
  ctx.activities.push({ boardId, cardId, userId, type: 'card.move', data: { fromList: from[0], toList: to[0] }, createdAt: at });
  ctx.activities.push({
    boardId,
    cardId,
    userId,
    type: to[1] === 'DONE' ? 'card.done' : 'card.status',
    data: { from: from[1], to: to[1] },
    createdAt: new Date(at.getTime() + 1000),
  });
}

/**
 * Thoi diem tao the: 09:00 cua 3 ngay truoc khi bat dau, nhung viec cua cac giai doan sau da duoc tao san luc chot ke hoach
 * (`plannedAt`), va khong bao gio som hon luc tao bang. Moi the lech nhau 1 phut theo `index` de thu tu nhat ky on dinh.
 */
function createdAtOf(board: { createdAt: string; plannedAt: string }, start: Date, index: number): Date {
  const threeDaysBefore = start.getTime() - 3 * DAY_MS;
  const candidate = new Date(Math.floor((threeDaysBefore + VN_OFFSET_MS) / DAY_MS) * DAY_MS - VN_OFFSET_MS + 9 * HOUR_MS);
  const planned = new Date(vn(board.plannedAt).getTime() + index * 60_000);
  const floor = new Date(vn(board.createdAt).getTime() + (index + 1) * 60_000);
  return maxDate(floor, minDate(candidate, planned));
}

async function createMainCard(ctx: Ctx, board: BoardRefs, fields: FieldRefs, c: CardDef, index: number, position: number) {
  const { tx, now } = ctx;
  const lead = PEOPLE[0]!.key;
  const owner = c.members[0]!;
  const start = startOf(c.start);
  const due = dueOf(c.due);
  const createdAt = createdAtOf(MAIN_BOARD, start, index);
  const assignedAt = new Date(createdAt.getTime() + 30 * 60_000);
  const completedAt = c.done ? doneOf(c.done) : null;
  if (assignedAt > now) throw new Error(`Thẻ "${c.title}": thời điểm tạo rơi vào tương lai`);
  // Moc tick muc checklist da xong (ChecklistItem.completedAt, RISK_MODULE.md §9): rai deu tu 1 gio sau khi giao viec toi
  // luc the xong (the chua xong: toi luc seed), theo thu tu muc tren the - tat dinh, khong ngau nhien.
  const doneItemCount = (c.checklists ?? []).reduce((n, cl) => n + cl.items.filter(([, done]) => done).length, 0);
  const tickFrom = new Date(assignedAt.getTime() + HOUR_MS);
  const tickTo = maxDate(tickFrom, completedAt ?? now);
  let tickIndex = 0;
  const nextTick = () => {
    tickIndex += 1;
    return new Date(tickFrom.getTime() + ((tickTo.getTime() - tickFrom.getTime()) * tickIndex) / (doneItemCount + 1));
  };

  const fieldValues: Prisma.CardFieldValueUncheckedCreateWithoutCardInput[] = [
    { fieldId: fields.phaseFieldId, optionId: fields.phaseOption[c.phase]! },
    { fieldId: fields.priorityFieldId, optionId: fields.priorityOption[c.priority]! },
  ];
  if (c.budget !== undefined) fieldValues.push({ fieldId: fields.budgetFieldId, numberValue: c.budget });
  if (c.contact !== undefined) fieldValues.push({ fieldId: fields.contactFieldId, textValue: c.contact });

  const card = await tx.card.create({
    data: {
      listId: board.listId[c.list]!,
      title: c.title,
      description: c.description,
      status: c.list,
      isDone: c.list === 'DONE',
      completedAt,
      startDate: start,
      dueDate: due,
      storyPoints: storyPointsOf(start, due, index),
      coverColor: c.cover ?? null,
      position,
      createdAt,
      members: {
        create: c.members.map((m) => ({
          userId: ctx.userId[m],
          createdAt: assignedAt,
          assignedById: m === lead ? null : ctx.userId[lead],
        })),
      },
      labels: { create: c.labels.map((l) => ({ labelId: board.labelId[l] })) },
      fieldValues: { create: fieldValues },
      checklists: {
        create: (c.checklists ?? []).map((cl, ci) => ({
          title: cl.title,
          position: ci,
          createdAt: assignedAt,
          items: {
            create: cl.items.map(([content, done, assignee, itemDue], ii) => ({
              content,
              isDone: done,
              completedAt: done ? nextTick() : null,
              position: ii,
              assigneeId: assignee ? ctx.userId[assignee] : null,
              dueDate: itemDue ? dueOf(itemDue) : null,
              createdAt: assignedAt,
            })),
          },
        })),
      },
    },
    select: { id: true },
  });

  // ---- Nhat ky: tao the (o cot dau), giao viec, keo qua cac cot, binh luan ----
  const events: Date[] = [createdAt, assignedAt];
  const todoName = board.listName.TODO!;
  ctx.activities.push({ boardId: board.id, cardId: card.id, userId: ctx.userId[lead], type: 'card.create', data: { listName: todoName }, createdAt });
  for (const m of c.members) {
    ctx.activities.push({
      boardId: board.id,
      cardId: card.id,
      userId: ctx.userId[lead],
      type: 'member.add',
      data: { memberId: ctx.userId[m], memberName: ctx.nameOf[m] },
      createdAt: assignedAt,
    });
  }
  if (c.list !== 'TODO') {
    const begun = maxDate(start, new Date(assignedAt.getTime() + HOUR_MS));
    const inProgress: [string, ListKey] = [board.listName.IN_PROGRESS!, 'IN_PROGRESS'];
    logMove(ctx, board.id, card.id, ctx.userId[owner], begun, [todoName, 'TODO'], inProgress);
    events.push(begun);
    if (c.list !== 'IN_PROGRESS') {
      const target: [string, ListKey] = [board.listName[c.list]!, c.list];
      const movedAt = completedAt
        ? maxDate(completedAt, new Date(begun.getTime() + 60_000))
        : maxDate(vn(c.movedAt ?? c.start), new Date(begun.getTime() + HOUR_MS));
      if (movedAt > now) throw new Error(`Thẻ "${c.title}": lần chuyển cột rơi vào tương lai`);
      logMove(ctx, board.id, card.id, ctx.userId[owner], movedAt, inProgress, target);
      events.push(movedAt);
    }
  }
  for (const [author, when, text] of c.comments ?? []) {
    const at = vn(when);
    if (at < createdAt) throw new Error(`Thẻ "${c.title}": bình luận trước khi tạo thẻ`);
    await tx.comment.create({ data: { cardId: card.id, userId: ctx.userId[author], text, createdAt: at, updatedAt: at } });
    ctx.activities.push({
      boardId: board.id,
      cardId: card.id,
      userId: ctx.userId[author],
      type: 'comment.create',
      data: { text: text.slice(0, 120) },
      createdAt: at,
    });
    events.push(at);
  }
  // updatedAt la @updatedAt: Prisma tu dat = bay gio luc tao, nen ghi lai bang moc hoat dong cuoi cung cho dung thuc te.
  await tx.card.update({ where: { id: card.id }, data: { updatedAt: maxDate(...events) } });
}

async function createPastCards(ctx: Ctx, board: BoardRefs) {
  const lead = PEOPLE[0]!.key;
  const labelOf = new Map(PEOPLE.map((p) => [p.key, p.label]));
  const sorted = [...PAST_CARDS].sort((a, b) => dueOf(a[4]).getTime() - dueOf(b[4]).getTime());
  for (const [i, [who, title, description, startS, dueS, doneS]] of sorted.entries()) {
    const start = startOf(startS);
    const due = dueOf(dueS);
    const completedAt = doneOf(doneS);
    const createdAt = createdAtOf(PAST_BOARD, start, i);
    const assignedAt = new Date(createdAt.getTime() + 30 * 60_000);
    const card = await ctx.tx.card.create({
      data: {
        listId: board.listId.DONE!,
        title,
        description,
        status: 'DONE',
        isDone: true,
        completedAt,
        startDate: start,
        dueDate: due,
        storyPoints: storyPointsOf(start, due, i),
        position: i,
        createdAt,
        members: {
          create: { userId: ctx.userId[who], createdAt: assignedAt, assignedById: who === lead ? null : ctx.userId[lead] },
        },
        labels: { create: { labelId: board.labelId[labelOf.get(who)!] } },
      },
      select: { id: true },
    });
    const todoName = board.listName.TODO!;
    const inProgress: [string, ListKey] = [board.listName.IN_PROGRESS!, 'IN_PROGRESS'];
    const begun = maxDate(start, new Date(assignedAt.getTime() + HOUR_MS));
    ctx.activities.push(
      { boardId: board.id, cardId: card.id, userId: ctx.userId[lead], type: 'card.create', data: { listName: todoName }, createdAt },
      {
        boardId: board.id,
        cardId: card.id,
        userId: ctx.userId[lead],
        type: 'member.add',
        data: { memberId: ctx.userId[who], memberName: ctx.nameOf[who] },
        createdAt: assignedAt,
      }
    );
    logMove(ctx, board.id, card.id, ctx.userId[who], begun, [todoName, 'TODO'], inProgress);
    logMove(ctx, board.id, card.id, ctx.userId[who], maxDate(completedAt, new Date(begun.getTime() + 60_000)), inProgress, [
      board.listName.DONE!,
      'DONE',
    ]);
    await ctx.tx.card.update({ where: { id: card.id }, data: { updatedAt: completedAt } });
  }
}

export interface SeedResult {
  removed: RemoveResult;
  workspaceId: string;
  mainBoardId: string;
  pastBoardId: string;
  created: string[];
  counts: { mainCards: number; pastCards: number; byList: Record<ListKey, number> };
}

export async function seedTalkshow(password: string, now = new Date()): Promise<SeedResult> {
  const errors = validateTalkshowData(now);
  if (errors.length > 0) throw new Error(`Dữ liệu soạn tay có lỗi:\n  - ${errors.join('\n  - ')}`);

  // Tai khoan co san phai ton tai truoc (khong tu tao tai khoan gmail).
  const existing = await prisma.user.findMany({
    where: { email: { in: PEOPLE.filter((p) => p.existing).map((p) => p.email) } },
    select: { id: true, email: true, name: true, deletedAt: true },
  });
  for (const p of PEOPLE.filter((x) => x.existing)) {
    const row = existing.find((u) => u.email === p.email);
    if (!row) throw new Error(`Chưa có tài khoản ${p.email} trong CSDL - hãy đăng ký tài khoản này trước`);
    if (row.deletedAt) throw new Error(`Tài khoản ${p.email} đã bị xoá mềm`);
  }

  const passwordHash = await hashPassword(password);
  const cvs = await prepareCvFiles();

  let result: SeedResult;
  try {
    result = await prisma.$transaction(
      async (tx) => {
        const removed = await removeTalkshow(tx);
        const userId = {} as Record<PersonKey, string>;
        const nameOf = {} as Record<PersonKey, string>;
        const created: string[] = [];
        const memberSince = vn('2026-05-04 09:00');

        // ---------- Tai khoan + ho so chuyen mon ----------
        for (const p of PEOPLE) {
          const workItems = p.workItems.map((w) => ({ id: crypto.randomUUID(), title: w.title, description: w.description }));
          const skillsText = p.skills.join(', ');
          if (p.existing) {
            const row = existing.find((u) => u.email === p.email)!;
            userId[p.key] = row.id;
            nameOf[p.key] = row.name;
            // Chi ghi de ky nang + cong viec da lam; GIU NGUYEN CV va cong tac "dung cho goi y" cua chu tai khoan.
            await tx.userAssignProfile.upsert({
              where: { userId: row.id },
              create: { userId: row.id, skillsText, workItems },
              update: { skillsText, workItems },
            });
            continue;
          }
          const user = await tx.user.create({
            data: {
              email: p.email,
              name: p.name,
              passwordHash,
              emailVerifiedAt: vn('2026-05-04 08:00'),
              createdAt: vn('2026-05-04 08:00'),
            },
            select: { id: true },
          });
          userId[p.key] = user.id;
          nameOf[p.key] = p.name;
          created.push(p.email);
          await tx.workspace.create({
            data: {
              ownerId: user.id,
              name: `Không gian của ${p.name}`,
              isPersonal: true,
              createdAt: vn('2026-05-04 08:00'),
              members: { create: { userId: user.id, role: 'OWNER', createdAt: vn('2026-05-04 08:00') } },
            },
          });
          const cv = cvs.find((x) => x.key === p.key)!;
          await tx.userAssignProfile.create({
            data: {
              userId: user.id,
              skillsText,
              workItems,
              cvText: cv.text,
              cvFileName: cv.fileName,
              cvStoredName: cv.storedName,
              cvSize: cv.size,
              cvUploadedAt: vn('2026-05-04 08:30'),
            },
          });
        }

        // ---------- Khong gian nhom ----------
        const lead = PEOPLE[0]!;
        const workspace = await tx.workspace.create({
          data: { ownerId: userId[lead.key], name: WORKSPACE_NAME, createdAt: memberSince },
          select: { id: true },
        });
        for (const p of PEOPLE) {
          await tx.workspaceMember.create({
            data: { workspaceId: workspace.id, userId: userId[p.key], role: p.workspaceRole, createdAt: memberSince },
          });
          await tx.memberWorkProfile.create({
            data: { userId: userId[p.key], workspaceId: workspace.id, maxParallelCards: p.capacity },
          });
        }

        const ctx: Ctx = { tx, now, userId, nameOf, activities: [] };

        // ---------- Bang talk show cu (lich su) ----------
        const past = await createBoard(ctx, workspace.id, PAST_BOARD);
        await createPastCards(ctx, past);

        // ---------- Bang talk show chinh ----------
        const main = await createBoard(ctx, workspace.id, MAIN_BOARD);
        const fields = await createCustomFields(tx, main.id);
        // Vi tri trong moi cot: theo han (som truoc), hoa thi theo thu tu soan.
        const ordered = MAIN_CARDS.map((c, i) => ({ c, i })).sort(
          (a, b) => LIST_ORDER[a.c.list] - LIST_ORDER[b.c.list] || dueOf(a.c.due).getTime() - dueOf(b.c.due).getTime() || a.i - b.i
        );
        const positions = new Map<ListKey, number>();
        for (const { c, i } of ordered) {
          const pos = positions.get(c.list) ?? 0;
          positions.set(c.list, pos + 1);
          await createMainCard(ctx, main, fields, c, i, pos);
        }

        await tx.activity.createMany({ data: ctx.activities });

        const byList = Object.fromEntries(LIST_KEYS.map((k) => [k, MAIN_CARDS.filter((c) => c.list === k).length])) as Record<
          ListKey,
          number
        >;
        return {
          removed,
          workspaceId: workspace.id,
          mainBoardId: main.id,
          pastBoardId: past.id,
          created,
          counts: { mainCards: MAIN_CARDS.length, pastCards: PAST_CARDS.length, byList },
        };
      },
      { timeout: 180_000, maxWait: 10_000 }
    );
  } catch (err) {
    removeCvFiles(cvs.map((c) => c.storedName));
    throw err;
  }
  // Chi xoa tep CV cua ban CU sau khi ban moi da ghi xong.
  removeCvFiles(result.removed.cvFiles);
  return result;
}

export async function removeTalkshowDemo(): Promise<RemoveResult> {
  const removed = await prisma.$transaction((tx) => removeTalkshow(tx), { timeout: 60_000 });
  removeCvFiles(removed.cvFiles);
  return removed;
}

// ===================== Dong lenh =====================

function fail(message: string): never {
  console.error(`Loi: ${message}`);
  process.exit(1);
}

function describeDatabase(): string {
  try {
    const url = new URL(env.databaseUrl);
    return `${url.hostname}:${url.port || '5432'}${url.pathname}`;
  } catch {
    return '(khong doc duoc DATABASE_URL)';
  }
}

async function main() {
  if (env.isProduction) fail('khong chay o NODE_ENV=production');
  let remove = false;
  let password = DEFAULT_PASSWORD;
  for (const arg of process.argv.slice(2)) {
    if (arg === '--remove') remove = true;
    else if (arg.startsWith('--password=')) password = arg.slice('--password='.length);
    else fail(`tham so la "${arg}" (chi co --remove, --password=...)`);
  }
  if (password.length < 6 || password.length > 72) fail('mat khau phai dai 6-72 ky tu (giong luat dang ky)');

  console.log(`CSDL dich: ${describeDatabase()}`);
  if (remove) {
    const r = await removeTalkshowDemo();
    console.log(`Da go: ${r.users} tai khoan @${EMAIL_DOMAIN}, ${r.workspaces} khong gian "${WORKSPACE_NAME}", ${r.cvFiles.length} tep CV.`);
    console.log('(Ky nang / cong viec da lam ghi vao 3 tai khoan co san KHONG duoc khoi phuc.)');
    return;
  }

  const r = await seedTalkshow(password);
  if (r.removed.users + r.removed.workspaces > 0) {
    console.log(`Da don ban cu: ${r.removed.users} tai khoan, ${r.removed.workspaces} khong gian, ${r.removed.cvFiles.length} tep CV.`);
  }
  console.log(`Khong gian "${WORKSPACE_NAME}": ${PEOPLE.length} thanh vien.`);
  console.log(`Bang chinh: ${r.counts.mainCards} the - ${LIST_KEYS.map((k) => `${k} ${r.counts.byList[k]}`).join(', ')}.`);
  console.log(`Bang talk show cu: ${r.counts.pastCards} the da xong (lich su chuyen mon).`);
  console.log(`\nTai khoan moi (mat khau chung: ${password}):`);
  for (const p of PEOPLE) {
    console.log(`  ${p.email.padEnd(32)} ${(p.existing ? '(co san) ' : '') + p.name} - ${p.department}`);
  }
  console.log(`\nHom nay theo du lieu soan: ${AUTHORED_TODAY}. Go demo: npx tsx src/scripts/seedTalkshow.ts --remove`);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('Do du lieu that bai:', err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
