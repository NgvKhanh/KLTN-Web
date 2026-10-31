// Trich van ban tu tep .docx / .pdf (buoc 7, AI_MODULE.md §6).
//
// KHONG BAO GIO GOI LLM. Luong file: tai len -> trich chu -> nguoi dung SUA trong o nhap ->
// moi bam sinh ke hoach (endpoint sinh ke hoach nhan chu, khong nhan tep).
//
// TEP LA DU LIEU KHONG TIN CAY (docx thuc chat la file zip -> co the la "zip bomb"; pdf co
// the dung san de treo/ngon RAM bo doc). Phong thu nhieu lop:
//   1. Doi tuong + noi dung phai KHOP: .pdf phai co "%PDF-", .docx phai la zip co
//      word/document.xml. Tep .exe doi duoi, .doc cu, docx khoa mat khau deu bi 400.
//   2. Ngay tai TIEN TRINH CHA, doc muc luc cua zip (khong giai nen): tong dung luong sau
//      giai nen / so muc qua lon -> 400 truoc khi mo tep.
//   3. Bo doc chay trong TIEN TRINH CON: gioi han heap, timeout (kill), gioi han dau ra,
//      toi da vai tien trinh cung luc. Con chet/ket thi API van song.
//   4. Tep chi nam trong bo nho (multer memoryStorage) - khong bao gio ghi xuong dia.
//
// Giu CAU TRUC cua Word (tieu de, gach dau dong long nhau, danh sach danh so, bang) bang
// cach doi HTML cua mammoth thanh chu co ky hieu "# ", "- ", "1. " - dung dang ai.rules.ts
// nhan biet. Lay chu tho (extractRawText) se lam mat het cau truc va moi ke hoach thanh FREEFORM.
//
// KY LUAT (nhu ai.rules.ts): moi regex la hang literal, khong ghep chuoi vao regex, khong
// `.*`/`.+`, khong quet chuoi nguoi dung bang regex co the bung no.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { AI_DOCUMENT_MAX_BYTES } from '../../config/upload';
import { AppError } from '../../utils/AppError';
import { MAX_INPUT_TEXT_CHARS } from './ai.schema';
import { truncateInput } from './ai.service';

export type DocumentKind = 'DOCX' | 'PDF';

export const DOCUMENT_LIMITS = {
  /** Kich thuoc tep tai len (multer cung dung hang so nay - MOT nguon duy nhat). */
  maxBytes: AI_DOCUMENT_MAX_BYTES,
  /** Tong dung luong KHAI BAO sau giai nen cua zip; vuot = nghi zip bomb. */
  maxUncompressedBytes: 50 * 1024 * 1024,
  maxZipEntries: 1000,
  maxPages: 50,
  /** Chu tra ve toi da = gioi han cua endpoint sinh ke hoach, de luon gui lai duoc. */
  maxChars: MAX_INPUT_TEXT_CHARS,
  /** Tien trinh con cat HTML/chu o muc nay (tep khong lo van chi lay phan dau). */
  maxHtmlChars: 1_500_000,
  maxPdfChars: 300_000,
  timeoutMs: 15_000,
  maxHeapMb: 192,
  maxOutputBytes: 4_000_000,
  /** So tien trinh con doc tep dong thoi (moi cai co the ton ~200MB). */
  maxConcurrent: 2,
} as const;
export type DocumentLimits = { -readonly [K in keyof typeof DOCUMENT_LIMITS]: number };

export interface ExtractedDocument {
  inputKind: DocumentKind;
  /** Van ban da chuan hoa, toi da `maxChars` ky tu. */
  text: string;
  chars: number;
  /** true neu bi cat vi BAT KY ly do nao (so ky tu, so trang, tep qua dai). */
  truncated: boolean;
  /** Tong so trang cua PDF; null voi DOCX. */
  pages: number | null;
}

const bad = (message: string): AppError => new AppError(message, 400);

// ===================== 1. Kiem tra doi tuong + noi dung =====================

// Tep Word cu (.doc) va docx BI KHOA MAT KHAU deu la container OLE, khong phai zip.
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ZIP_LOCAL_MAGIC = [0x50, 0x4b, 0x03, 0x04];

const startsWith = (buf: Buffer, magic: number[]) => magic.every((b, i) => buf[i] === b);

/** Xac dinh loai tep tu duoi + noi dung; noi dung PHAI khop duoi. Nem 400 neu khong. */
export function detectDocumentKind(buffer: Buffer, filename: string): DocumentKind {
  const ext = path.extname(filename).toLowerCase();
  if (ext !== '.pdf' && ext !== '.docx') throw bad('Chỉ hỗ trợ tệp .docx hoặc .pdf');
  if (buffer.length === 0) throw bad('Tệp rỗng');

  if (ext === '.pdf') {
    // Dac ta cho phep rac truoc "%PDF-" trong 1024 byte dau
    if (!buffer.subarray(0, 1024).includes('%PDF-')) {
      throw bad('Nội dung tệp không phải PDF (sai đuôi tệp hoặc tệp hỏng)');
    }
    return 'PDF';
  }
  if (startsWith(buffer, OLE_MAGIC)) {
    throw bad('Tệp là định dạng Word cũ (.doc) hoặc bị khóa mật khẩu. Hãy lưu lại thành .docx không mật khẩu');
  }
  if (!startsWith(buffer, ZIP_LOCAL_MAGIC)) {
    throw bad('Nội dung tệp không phải DOCX (sai đuôi tệp hoặc tệp hỏng)');
  }
  return 'DOCX';
}

// ===================== 2. Doc muc luc zip (KHONG giai nen) =====================

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;

export interface ZipSummary {
  entries: number;
  /** Tong dung luong sau giai nen theo KHAI BAO trong muc luc. */
  totalUncompressed: number;
  hasDocumentXml: boolean;
}

/**
 * Doc muc luc trung tam (central directory) cua zip de chan zip bomb va tep zip khong phai
 * Word truoc khi giai nen. Kich thuoc la gia tri KHAI BAO: ke tan cong co the khai gian, nen
 * day chi la lop chan re tien; lop chan that la tien trinh con (heap/timeout).
 * Zip64 khong duoc ho tro (Word ~5MB khong bao gio can).
 */
export function inspectZip(buf: Buffer, maxEntries: number, maxUncompressed: number): ZipSummary {
  const invalid = () => bad('Tệp DOCX không hợp lệ hoặc bị hỏng');
  if (buf.length < 22) throw invalid();

  let eocd = -1;
  const lowest = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= lowest; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw invalid();

  const total = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw bad('Tệp DOCX quá phức tạp (zip64 không được hỗ trợ)');
  }
  if (total > maxEntries) throw bad(`Tệp DOCX có quá nhiều thành phần (tối đa ${maxEntries})`);
  if (cdOffset + cdSize > eocd) throw invalid();

  let pos = cdOffset;
  let sum = 0;
  let hasDocumentXml = false;
  for (let k = 0; k < total; k += 1) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CENTRAL_SIG) throw invalid();
    const size = buf.readUInt32LE(pos + 24);
    if (size === 0xffffffff) throw bad('Tệp DOCX quá phức tạp (zip64 không được hỗ trợ)');
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    if (pos + 46 + nameLen > buf.length) throw invalid();
    sum += size;
    if (sum > maxUncompressed) {
      throw bad(`Tệp DOCX giải nén ra quá lớn (tối đa ${Math.round(maxUncompressed / 1048576)}MB)`);
    }
    if (buf.toString('utf8', pos + 46, pos + 46 + nameLen) === 'word/document.xml') hasDocumentXml = true;
    pos += 46 + nameLen + extraLen + commentLen;
  }
  if (!hasDocumentXml) throw bad('Tệp zip này không phải tài liệu Word (thiếu word/document.xml)');
  return { entries: total, totalUncompressed: sum, hasDocumentXml };
}

// ===================== 3. HTML (mammoth) -> chu co cau truc =====================

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
// Gioi han do dai moi nhom -> quet tuyen tinh, khong bung no
const ENTITY_RE = /&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,6});/g;
const HEADING_TAG_RE = /^h[1-6]$/;

function decodeEntities(s: string): string {
  return s.replace(ENTITY_RE, (whole, body: string) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Ten the (chu thuong) va co dong/mo. Tra null neu khong phai the (vd "<" le loi). */
function parseTag(raw: string): { name: string; closing: boolean } {
  const closing = raw.startsWith('/');
  const inner = closing ? raw.slice(1) : raw;
  let end = 0;
  while (end < inner.length && inner[end] !== ' ' && inner[end] !== '/' && inner[end] !== '\n' && inner[end] !== '\t') end += 1;
  return { name: inner.slice(0, end).toLowerCase(), closing };
}

/**
 * HTML cua mammoth (h1-h6, p, ul/ol/li long nhau, table, br) -> chu thuong:
 *   <h2>  -> "## ..."      <li> trong <ul> -> "- ..." (thut 2 khoang trang moi cap)
 *   <li> trong <ol> -> "1. ..."     <tr> -> "o | o | o" (chi bang ngoai cung)
 * The la bi bo (giu chu ben trong). Quet tung ky tu, khong regex tren du lieu nguoi dung.
 */
export function htmlToStructuredText(html: string): string {
  const out: string[] = [];
  let line = '';
  let prefix = '';
  const lists: Array<{ ordered: boolean; n: number }> = [];
  let tableDepth = 0;
  let cellOpen = false;
  let row: string[] = [];

  const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();
  // Chi xoa tien to khi da THUC SU ghi ra 1 dong: <li><p>..</p></li> khong duoc mat dau "- "
  const flush = () => {
    const text = collapse(line);
    if (text !== '') {
      out.push(prefix + text);
      prefix = '';
    }
    line = '';
  };
  // Trong o bang moi the khoi chi la khoang cach: chu vao cung 1 o
  const inCell = () => tableDepth > 0 && cellOpen;

  let i = 0;
  while (i < html.length) {
    if (html[i] !== '<') {
      const next = html.indexOf('<', i);
      const end = next < 0 ? html.length : next;
      line += decodeEntities(html.slice(i, end));
      i = end;
      continue;
    }
    const close = html.indexOf('>', i);
    if (close < 0) break; // the bi cat cut (do gioi han do dai): bo phan dang do
    const { name, closing } = parseTag(html.slice(i + 1, close).trim());
    i = close + 1;

    if (HEADING_TAG_RE.test(name)) {
      if (inCell()) {
        line += ' ';
      } else if (closing) {
        flush();
        prefix = '';
      } else {
        flush();
        prefix = `${'#'.repeat(Number(name[1]))} `;
      }
    } else if (name === 'ul' || name === 'ol') {
      if (inCell()) {
        line += ' ';
      } else {
        flush();
        prefix = '';
        if (closing) lists.pop();
        else lists.push({ ordered: name === 'ol', n: 0 });
      }
    } else if (name === 'li') {
      if (inCell()) {
        line += ' ';
      } else if (closing) {
        flush();
        prefix = '';
      } else {
        flush();
        const list = lists[lists.length - 1];
        if (list) {
          list.n += 1;
          prefix = `${'  '.repeat(lists.length - 1)}${list.ordered ? `${list.n}. ` : '- '}`;
        }
      }
    } else if (name === 'table') {
      if (closing) {
        tableDepth = Math.max(0, tableDepth - 1);
      } else {
        if (tableDepth === 0) flush();
        tableDepth += 1;
      }
    } else if (name === 'tr') {
      if (tableDepth === 1) {
        if (closing) {
          const text = row.filter((c) => c !== '').join(' | ');
          if (text !== '') out.push(text);
          row = [];
        }
      } else if (tableDepth > 1) {
        line += ' ';
      }
    } else if (name === 'td' || name === 'th') {
      if (tableDepth === 1) {
        if (closing) {
          row.push(collapse(line));
          line = '';
          cellOpen = false;
        } else {
          line = '';
          cellOpen = true;
        }
      } else if (tableDepth > 1) {
        line += ' ';
      }
    } else if (name === 'p' || name === 'br' || name === 'div') {
      if (inCell()) line += ' ';
      else flush();
    }
    // moi the khac (strong, em, a, span, img, sup...) chi la trang tri: bo the, giu chu
  }
  flush();
  return out.join('\n');
}

// ===================== 4. Chuan hoa van ban trich duoc =====================

// Ky tu dau dong ma Word/PDF hay xuat: chuyen thanh "- " de bo luat nhan ra la gach dau dong.
// Gom ca vung ky tu rieng (U+F0xx) cua font Symbol/Wingdings ma Word dung cho bullet.
const BULLET_GLYPHS = new Set([
  '•', '‣', '⁃', '◦', '▪', '▫', '●', '○', '■', '□',
  '➢', '➤', '➔', '·', '\uF0B7', '\uF0A7', '\uF0D8', '\uF0FC', '\uF076', '\uF0A8', '\uF0B0',
]);
const ZERO_WIDTH = new Set(['\u200B', '\u200C', '\u200D', '\u2060', '\uFEFF', '\u00AD']);
const SPACE_LIKE = new Set(['\u00A0', '\u2007', '\u202F', '\u3000', '\t']);
const MAX_INDENT = 10;

/**
 * Lam sach chu trich duoc: NFC (PDF hay tra chu Viet dang to hop), bo NUL + ky tu dieu khien
 * (NUL lam Postgres tu choi khi luu AiRun.inputText), bo ky tu do rong, doi khoang trang dac
 * biet, doi ky tu bullet ve "- ", gop dong trong. Giu thut le dau dong (bieu thi cap long).
 */
export function normalizeExtractedText(text: string): string {
  let cleaned = '';
  // "\r\n" la MOT xuong dong (neu de "\r" va "\n" xu ly rieng se sinh dong trong giua moi dong)
  for (const ch of text.replace(/\r\n/g, '\n').normalize('NFC')) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '\n') cleaned += '\n';
    else if (ch === '\r' || ch === '\u2028' || ch === '\u2029' || ch === '\f') cleaned += '\n';
    else if (SPACE_LIKE.has(ch)) cleaned += ' ';
    else if (ZERO_WIDTH.has(ch)) continue;
    else if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
    else cleaned += ch;
  }

  const lines: string[] = [];
  for (const raw of cleaned.split('\n')) {
    const trimmed = raw.trimEnd();
    const body = trimmed.trimStart();
    if (body === '') {
      if (lines.length > 0 && lines[lines.length - 1] !== '') lines.push('');
      continue;
    }
    const indent = ' '.repeat(Math.min(trimmed.length - body.length, MAX_INDENT));
    let content = body.replace(/ {2,}/g, ' ');
    const first = content[0]!;
    if (BULLET_GLYPHS.has(first)) {
      content = content.slice(1).trimStart();
      if (content === '') continue;
      content = `- ${content}`;
    }
    lines.push(indent + content);
  }
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.join('\n');
}

// ===================== 5. Tien trinh con =====================

// Script chay trong `node -e`: nhan tep qua stdin (nhi phan), tra JSON tren stdout. stdout la
// KENH GIAO THUC nen moi console.* bi tat (pdf.js hay in canh bao). Tham so: kind, duong dan
// mammoth, duong dan pdf-parse, so trang toi da, cat HTML, cat chu PDF.
const WORKER_SOURCE = String.raw`
const kind = process.argv[1];
const mammothPath = process.argv[2];
const pdfPath = process.argv[3];
const maxPages = Number(process.argv[4]);
const maxHtmlChars = Number(process.argv[5]);
const maxPdfChars = Number(process.argv[6]);
for (const k of ['log', 'info', 'warn', 'debug', 'error']) console[k] = () => {};
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  const done = (payload, code) => process.stdout.write(JSON.stringify(payload), () => process.exit(code));
  try {
    const buffer = Buffer.concat(chunks);
    if (kind === 'DOCX') {
      const mammoth = require(mammothPath);
      // Khong doc noi dung anh: mac dinh mammoth nhung anh dang base64 vao HTML
      const result = await mammoth.convertToHtml({ buffer }, { convertImage: mammoth.images.imgElement(() => Promise.resolve({ src: '' })) });
      const html = result.value;
      return done({ ok: true, content: html.length > maxHtmlChars ? html.slice(0, maxHtmlChars) : html, cut: html.length > maxHtmlChars, pages: null }, 0);
    }
    const pdf = require(pdfPath);
    const parser = new pdf.PDFParse({ data: new Uint8Array(buffer), isEvalSupported: false, verbosity: 0 });
    try {
      const info = await parser.getInfo();
      const total = info.total;
      const res = await parser.getText({ first: Math.min(total, maxPages), pageJoiner: '\n' });
      const text = res.text;
      return done({ ok: true, content: text.length > maxPdfChars ? text.slice(0, maxPdfChars) : text, cut: text.length > maxPdfChars || total > maxPages, pages: total }, 0);
    } finally {
      await parser.destroy().catch(() => {});
    }
  } catch (e) {
    done({ ok: false, reason: e && e.name === 'PasswordException' ? 'PASSWORD' : 'PARSE' }, 1);
  }
});
`;

interface WorkerResult {
  content: string;
  cut: boolean;
  pages: number | null;
}

function runWorker(kind: DocumentKind, buffer: Buffer, limits: DocumentLimits): Promise<WorkerResult> {
  return new Promise<WorkerResult>((resolve, reject) => {
    const unreadable = () =>
      bad('Không đọc được tệp. Hãy dùng tệp .docx/.pdf không khóa mật khẩu, còn nguyên vẹn và không quá phức tạp');
    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${limits.maxHeapMb}`,
        '-e',
        WORKER_SOURCE,
        kind,
        require.resolve('mammoth'),
        require.resolve('pdf-parse'),
        String(limits.maxPages),
        String(limits.maxHtmlChars),
        String(limits.maxPdfChars),
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }
    );

    let settled = false;
    let output = '';
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle(() => reject(bad('Đọc tệp quá lâu. Hãy dùng tệp nhỏ hơn hoặc đơn giản hơn')));
    }, limits.timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      output += chunk;
      // Chan ca dau ra: con bi chiem quyen khong duoc lam day bo nho tien trinh cha
      if (output.length > limits.maxOutputBytes) {
        child.kill('SIGKILL');
        settle(() => reject(unreadable()));
      }
    });
    child.once('error', () => settle(() => reject(unreadable())));
    child.once('close', (code) =>
      settle(() => {
        let message: { ok?: unknown; content?: unknown; cut?: unknown; pages?: unknown; reason?: unknown };
        try {
          message = JSON.parse(output);
        } catch {
          reject(unreadable());
          return;
        }
        if (message.ok === false && message.reason === 'PASSWORD') {
          reject(bad('Tệp PDF bị khóa mật khẩu. Hãy gỡ mật khẩu rồi tải lại'));
          return;
        }
        if (code !== 0 || message.ok !== true || typeof message.content !== 'string') {
          reject(unreadable());
          return;
        }
        resolve({
          content: message.content,
          cut: message.cut === true,
          pages: typeof message.pages === 'number' ? message.pages : null,
        });
      })
    );
    // Con chet som co the dong stdin truoc khi ghi xong: close/error o tren xu ly ket qua
    child.stdin.on('error', () => {});
    child.stdin.end(buffer);
  });
}

// ===================== 6. Ham chinh =====================

let running = 0;

/**
 * Doc mot tep .docx/.pdf da nam trong bo nho. Nem AppError 400 (tep khong hop le / khong doc
 * duoc / khong co chu), 429 (dang co qua nhieu tien trinh doc tep). `overrides` chi de test.
 */
export async function extractDocument(
  buffer: Buffer,
  filename: string,
  overrides: Partial<DocumentLimits> = {}
): Promise<ExtractedDocument> {
  const limits: DocumentLimits = { ...DOCUMENT_LIMITS, ...overrides };
  if (buffer.length > limits.maxBytes) {
    throw bad(`Tệp quá lớn (tối đa ${Math.round(limits.maxBytes / 1048576)}MB)`);
  }
  const kind = detectDocumentKind(buffer, filename);
  if (kind === 'DOCX') inspectZip(buffer, limits.maxZipEntries, limits.maxUncompressedBytes);

  if (running >= limits.maxConcurrent) {
    throw new AppError('Hệ thống đang đọc tệp khác, hãy thử lại sau ít giây', 429);
  }
  running += 1;
  let result: WorkerResult;
  try {
    result = await runWorker(kind, buffer, limits);
  } finally {
    running -= 1;
  }

  const text = normalizeExtractedText(kind === 'DOCX' ? htmlToStructuredText(result.content) : result.content);
  if (text === '') {
    throw bad('Tệp không có văn bản đọc được (PDF quét ảnh cần chuyển thành văn bản trước)');
  }
  const cut = truncateInput(text, limits.maxChars);
  return {
    inputKind: kind,
    text: cut.text,
    chars: cut.text.length,
    truncated: cut.truncated || result.cut,
    pages: result.pages,
  };
}
