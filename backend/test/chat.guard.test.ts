// Ky luat ma nguon cua module chatbot (CHATBOT_MODULE.md §10.1, §3, §16).
// Doc chinh file nguon (bo comment) de ep tuan thu quy uoc - cung cach voi module AI.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../src/modules/chat');
const TEST_ROOT = __dirname;
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const sourceFiles = () => fs.readdirSync(ROOT).filter((f) => f.endsWith('.ts'));
const read = (f: string) => stripComments(fs.readFileSync(path.join(ROOT, f), 'utf8'));

/** Tep thuan: khong duoc keo CSDL / cau hinh / dich vu (bo danh gia chay khong can DB). */
const PURE_FILES = [
  'chat.intent.ts',
  'chat.entities.ts',
  'chat.catalog.answer.ts',
  'chat.catalog.resolve.ts',
  'chat.members.ts',
  'chat.rules.ts',
  'chat.followup.ts',
  'chat.priority.ts',
  'chat.answer.ts',
  'chat.session.ts',
];
/** Tep DUY NHAT duoc doc dong ho; moi tang duoi nhan `now` qua tham so. */
const CLOCK_FILE = 'chat.controller.ts';

// Cong cu ghi file co the doi chuoi thoat (backslash + u + 4 chu so) thanh KY TU THAT - NUL,
// khoang trang do rong, dau to hop roi... Kiem ca tep nguon lan tep test cua chatbot.
const isInvisible = (code: number) =>
  (code < 0x20 && code !== 0x0a && code !== 0x0d && code !== 0x09) ||
  (code >= 0x7f && code <= 0x9f) ||
  code === 0xa0 ||
  code === 0xad ||
  (code >= 0x2000 && code <= 0x200f) ||
  (code >= 0x2028 && code <= 0x202f) ||
  (code >= 0x205f && code <= 0x206f) ||
  code === 0x3000 ||
  code === 0xfeff ||
  (code >= 0xe000 && code <= 0xf8ff) ||
  (code >= 0x0300 && code <= 0x036f) ||
  (code >= 0xfe00 && code <= 0xfe0f);

describe('ky luat ma nguon module chatbot', () => {
  it('khong goi mang, khong ghep chuoi vao regex, khong ".*" / ".+", khong gio dia phuong, khong console, khong doc env', () => {
    const files = sourceFiles();
    expect(files).toEqual(expect.arrayContaining(['chat.period.ts', ...PURE_FILES]));
    for (const f of files) {
      const src = read(f);
      expect(src, `${f} goi fetch`).not.toMatch(/\bfetch\s*\(/);
      expect(src, `${f} dung RegExp()`).not.toMatch(/\bRegExp\s*\(/);
      expect(src, `${f} co ".*"`).not.toContain('.*');
      expect(src, `${f} co ".+"`).not.toContain('.+');
      expect(src, `${f} dung gio dia phuong`).not.toMatch(
        /\.(get|set)(Date|Day|Month|FullYear|Hours|Minutes|Seconds|Milliseconds|TimezoneOffset)\s*\(/
      );
      expect(src, `${f} dung toLocale*String`).not.toMatch(/toLocale\w*String/);
      expect(src, `${f} doc dong ho`).not.toMatch(/Date\.now\s*\(|performance\.now/);
      if (f !== CLOCK_FILE) expect(src, `${f} doc dong ho`).not.toMatch(/new\s+Date\s*\(\s*\)/);
      // §3: khong ghi log noi dung cau hoi / cau tra loi
      expect(src, `${f} co console`).not.toMatch(/\bconsole\./);
      expect(src, `${f} doc process.env`).not.toMatch(/process\.env/);
    }
  });

  it('tep thuan khong import CSDL / cau hinh / dich vu; chi chat.period duoc dung ai.service va ai.apply', () => {
    const pureModules = new Set(PURE_FILES.map((f) => `./${f.replace(/\.ts$/, '')}`));
    for (const f of PURE_FILES) {
      for (const m of read(f).matchAll(/import\s+(type\s+)?[^;]*?from\s+'([^']+)'/g)) {
        const typeOnly = m[1] !== undefined;
        const spec = m[2];
        // import type bi xoa luc chay -> lay kieu tu dau cung duoc (nhung van chi trong module chat)
        const ok = typeOnly
          ? spec.startsWith('./chat.')
          : spec === 'zod' ||
            spec === 'node:crypto' ||
            pureModules.has(spec) ||
            spec === '../ai/ai.rules' ||
            spec === '../ai/ai.dates';
        expect(ok, `${f} import ${typeOnly ? 'type ' : ''}${spec}`).toBe(true);
      }
    }
    // Dong ho: chi controller; va controller phai that su la noi tao `now` cho dich vu
    expect(read(CLOCK_FILE)).toMatch(/now:\s*new Date\(\)/);
    for (const f of sourceFiles().filter((x) => x !== 'chat.period.ts')) {
      expect(read(f), f).not.toMatch(/ai\.service|ai\.apply/);
    }
  });

  it('chi chat.llm goi lop LLM; chat.llm / chat.summary khong keo CSDL, pham vi, truy van, dich vu (bo danh gia buoc 7 chay khong can DB)', () => {
    const files = sourceFiles();
    expect(files).toEqual(expect.arrayContaining(['chat.llm.ts', 'chat.summary.ts']));
    for (const f of files) {
      if (f === 'chat.llm.ts') continue;
      expect(read(f), `${f} import ai.llm`).not.toMatch(/'\.\.\/ai\/ai\.llm'/);
      expect(read(f), `${f} goi callLlm`).not.toMatch(/\bcallLlm\s*\(/);
    }
    expect(read('chat.llm.ts')).toMatch(/\bcallLlm\s*\(/);
    // nhan xet chi di qua callChatLlm (ngan sach + nho muc ep JSON)
    expect(read('chat.summary.ts')).toMatch(/\bcallChatLlm\s*\(/);

    const pureModules = new Set(PURE_FILES.map((f) => `./${f.replace(/\.ts$/, '')}`));
    const allowedValues = new Set(['zod', '../../config/env', '../ai/ai.llm', './chat.llm']);
    for (const f of ['chat.llm.ts', 'chat.summary.ts']) {
      for (const m of read(f).matchAll(/import\s+(type\s+)?[^;]*?from\s+'([^']+)'/g)) {
        const typeOnly = m[1] !== undefined;
        const spec = m[2];
        const ok = typeOnly ? spec.startsWith('./chat.') || spec.startsWith('../ai/') : allowedValues.has(spec) || pureModules.has(spec);
        expect(ok, `${f} import ${typeOnly ? 'type ' : ''}${spec}`).toBe(true);
      }
    }
  });

  it('danh muc truy van (§18): chi DOC, khong SQL tho, khong lay truong nhay cam; LLM chi chon dong danh muc', () => {
    const catalog = read('chat.catalog.ts');
    // chi ten + vai tro: khong email / mo ta / token / mat khau (§18.3)
    expect(catalog).not.toMatch(/email|description|password|token|secret/i);
    // moi tep chat: khong ghi CSDL, khong SQL tho
    for (const f of sourceFiles()) {
      const src = read(f);
      expect(src, `${f} ghi CSDL`).not.toMatch(/prisma\.\w+\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/);
      expect(src, `${f} SQL tho`).not.toMatch(/\$queryRaw|\$executeRaw|\$queryRawUnsafe|\$executeRawUnsafe|\bPrisma\.sql\b/);
      expect(src, `${f} transaction`).not.toMatch(/\$transaction/);
    }
    // danh muc chi doc qua pham vi da kiem quyen: khong tu dat lai quyen doc, khong import lop LLM
    expect(catalog).not.toMatch(/readableBoardWhere|assertBoardView|isBoardParticipant|ai\.llm|chat\.llm/);
    expect(catalog).toMatch(/scope\.boardWhere/);
  });

  it('khong dung lai module phan cong (pham vi + truong du lieu khac chinh sach chatbot, §3.4 CHATBOT_PLAN)', () => {
    for (const f of sourceFiles()) expect(read(f), f).not.toMatch(/modules\/assign|\.\.\/assign\//);
    // Pham vi doc KHONG di qua assertBoardView (co nhanh PUBLIC) / isBoardParticipant (loai VIEWER)
    expect(read('chat.scope.ts')).not.toMatch(/assertBoardView|isBoardParticipant|assertBoardAccess/);
  });

  it('khong co ky tu vo hinh / dau to hop roi trong tep nguon va tep test chatbot', () => {
    const files = [
      ...sourceFiles().map((f) => path.join(ROOT, f)),
      ...fs
        .readdirSync(TEST_ROOT)
        .filter((f) => f.startsWith('chat.') && f.endsWith('.ts'))
        .map((f) => path.join(TEST_ROOT, f)),
    ];
    expect(files.length).toBeGreaterThanOrEqual(11);
    const found: string[] = [];
    for (const file of files) {
      const seen = new Set<string>();
      for (const ch of fs.readFileSync(file, 'utf8')) {
        const code = ch.codePointAt(0) ?? 0;
        if (isInvisible(code)) seen.add(`U+${code.toString(16).toUpperCase().padStart(4, '0')}`);
      }
      if (seen.size > 0) found.push(`${path.basename(file)}: ${[...seen].join(' ')}`);
    }
    expect(found).toEqual([]);
  });
});
