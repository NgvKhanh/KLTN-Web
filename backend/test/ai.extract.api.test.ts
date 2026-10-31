import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UPLOAD_ROOT } from '../src/config/upload';
import { env } from '../src/config/env';
import { prisma } from '../src/config/prisma';
import { MAX_INPUT_TEXT_CHARS } from '../src/modules/ai/ai.schema';
import { boardPlanSchema } from '../src/modules/ai/boardPlan.schema';
import { agent, makeUser, type TestUser } from './helpers';
import { buildDocx, buildPdf, para } from './fixtures/ai/documents';

// Buoc 7 (AI_MODULE.md §6): POST /api/ai/documents/extract - tai tep .docx/.pdf, nhan chu de sua
// roi moi gui sang POST /api/ai/board-plans. Test tich hop qua HTTP tren DB THAT + tien trinh con THAT.
//
// LUU Y HA TANG: test/setup.ts TRUNCATE ca DB (ke ca user) truoc MOI `it`, registerLimiter chi cho
// 10 dang ky / gio TINH THEO TUNG FILE, va limiter giu trang thai trong process -> gop kich ban
// vao it `it` (tong ~5 tai khoan) va dat ca test 429 o CUOI file.

afterEach(() => {
  vi.unstubAllGlobals();
});

const MB = 1024 * 1024;
const TODAY = '2026-09-14';
const FIXTURES = path.resolve(__dirname, 'fixtures/ai');

const RICH_TEXT = [
  '# Kế hoạch Marketing Q4/2026',
  '## Giai đoạn 1: Chuẩn bị',
  '- Chốt thông điệp chiến dịch, hạn 20/10',
  '  - Soạn bản nháp',
  '  - Duyệt với giám đốc',
  '- Thiết kế bộ nhận diện, hạn 25/10',
  '## Giai đoạn 2: Triển khai',
  '1. Chạy quảng cáo Facebook từ 1/11 đến 15/11',
  '2. Họp đánh giá cuối tháng 11',
  'Việc | Hạn',
  'Viết kịch bản | 18/9',
  'Ghi chú: ngân sách 50 triệu.',
].join('\n');

function upload(user: TestUser | null, file: Buffer | null, filename = 'a.docx', field = 'file') {
  let r = agent().post('/api/ai/documents/extract');
  if (user) r = r.set('Cookie', user.cookie);
  if (file) r = r.attach(field, file, filename);
  else r = r.field('note', 'khong co tep');
  return r;
}
const generate = (user: TestUser, body: Record<string, unknown>) =>
  agent()
    .post('/api/ai/board-plans')
    .set('Cookie', user.cookie)
    .send({ workspaceId: user.personalWorkspaceId, today: TODAY, ...body });

/** Tat ca tep hien co duoi thu muc upload (de chung minh khong ghi xuong dia). */
function listUploads(dir = UPLOAD_ROOT): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listUploads(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

// ===================== Xac thuc, kiem tra dau vao =====================

describe('POST /api/ai/documents/extract: xac thuc + kiem tra tep', () => {
  it('401 khi chua dang nhap; 400 kem thong diep dung cho 9 loai tep/yeu cau sai + 2 tep cung luc (dung 10 lan = han muc); KHONG ghi tep nao xuong dia; khong ghi AiRun', async () => {
    const u = await makeUser();
    const before = listUploads().sort();

    expect((await upload(null, await buildDocx())).status).toBe(401);

    const rows: Array<[string, () => ReturnType<typeof upload>, RegExp]> = [
      ['khong gui tep (chi co truong khac)', () => upload(u, null), /Chưa chọn tệp/],
      ['sai ten truong (doc thay vi file)', async () => upload(u, await buildDocx(), 'a.docx', 'doc'), /Sai tên trường/],
      ['duoi .exe', () => upload(u, Buffer.from('MZ\x90\x00'), 'virus.exe'), /Chỉ hỗ trợ tệp \.docx hoặc \.pdf/],
      ['exe doi duoi .docx', () => upload(u, Buffer.from(`MZ${'x'.repeat(200)}`), 'baocao.docx'), /không phải DOCX/],
      ['PDF that mang duoi .docx', () => upload(u, buildPdf([['a']]), 'baocao.docx'), /không phải DOCX/],
      ['Word cu / docx khoa mat khau', () => upload(u, Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(100)]), 'a.docx'), /Word cũ/],
      ['tep 6MB', () => upload(u, Buffer.alloc(6 * MB, 0x25), 'to.pdf'), /quá lớn \(tối đa 5MB\)/],
      ['PDF hong', () => upload(u, Buffer.from(`%PDF-1.4\n${'x'.repeat(300)}`), 'hong.pdf'), /Không đọc được tệp/],
      ['PDF khoa mat khau', () => upload(u, buildPdf([['bi mat']], { encrypted: true }), 'khoa.pdf'), /Tệp PDF bị khóa mật khẩu/],
    ];
    const wrong: unknown[] = [];
    for (const [name, send, msg] of rows) {
      const res = await send();
      if (res.status !== 400 || res.body.success !== false || !msg.test(res.body.message ?? '')) {
        wrong.push({ name, status: res.status, message: res.body.message });
      }
    }
    expect(wrong).toEqual([]);

    // 2 tep cung luc cung bi tu choi (chi nhan 1). Day la yeu cau thu 10 (9 hang + 1) = dung han muc 10/10 phut
    const two = await agent()
      .post('/api/ai/documents/extract')
      .set('Cookie', u.cookie)
      .attach('file', await buildDocx(), 'a.docx')
      .attach('file', await buildDocx(), 'b.docx');
    expect(two.status).toBe(400);

    expect(listUploads().sort()).toEqual(before); // memoryStorage: khong file nao xuong dia
    expect(await prisma.aiRun.count()).toBe(0);
  });
});

// ===================== Luong chinh: trich chu -> sua -> sinh ke hoach =====================

describe('trich chu roi sinh ke hoach (luong tep cua module AI)', () => {
  it('DOCX -> chu co cau truc -> sinh ke hoach STRUCTURED, AiRun luu inputKind=DOCX va dung chu da gui; PDF tieng Viet; chu trich duoc luon gui lai duoc', async () => {
    const u = await makeUser();

    const docx = await upload(u, await buildDocx(), 'Kế hoạch marketing.docx');
    expect(docx.status).toBe(200);
    expect(docx.body.success).toBe(true);
    expect(Object.keys(docx.body.data).sort()).toEqual(['chars', 'inputKind', 'pages', 'text', 'truncated']);
    expect(docx.body.data).toEqual({ inputKind: 'DOCX', text: RICH_TEXT, chars: RICH_TEXT.length, truncated: false, pages: null });

    const pdf = await upload(u, fs.readFileSync(path.join(FIXTURES, 'plan.vi.pdf')), 'plan.PDF');
    expect(pdf.status).toBe(200);
    expect(pdf.body.data).toMatchObject({ inputKind: 'PDF', truncated: false, pages: 1 });
    expect(pdf.body.data.text).toContain('Kế hoạch Marketing Q4/2026');
    expect(pdf.body.data.text).toContain('Chạy quảng cáo Facebook từ 1/11 đến 15/11');

    // nguoi dung SUA chu (them 1 viec) roi moi sinh ke hoach; gui kem nguon tep
    const edited = `${docx.body.data.text}\n- Viec them tay cua nguoi dung`;
    const gen = await generate(u, { text: edited, inputKind: 'DOCX' });
    expect(gen.status).toBe(200);
    expect(gen.body.data.modeAuto).toBe('STRUCTURED');
    const plan = gen.body.data.plan;
    expect(boardPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.board.name).toBe('Kế hoạch Marketing Q4/2026');
    expect(plan.lists.map((l: { name: string }) => l.name)).toEqual(['Giai đoạn 1: Chuẩn bị', 'Giai đoạn 2: Triển khai']);
    const dueDates = plan.lists.flatMap((l: { cards: Array<{ dueDate: string | null }> }) => l.cards.map((c) => c.dueDate));
    expect(dueDates).toContain('2026-10-20');
    expect(dueDates).toContain('2026-11-15');

    const row = await prisma.aiRun.findUniqueOrThrow({ where: { id: gen.body.data.runId } });
    expect(row.inputKind).toBe('DOCX');
    expect(row.inputText).toBe(edited);

    // khong khai inputKind -> TEXT; khai PDF -> PDF
    const noKind = await generate(u, { text: edited });
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: noKind.body.data.runId } })).inputKind).toBe('TEXT');
    const asPdf = await generate(u, { text: pdf.body.data.text, inputKind: 'PDF' });
    expect(asPdf.status).toBe(200);
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: asPdf.body.data.runId } })).inputKind).toBe('PDF');

    // chu trich tu tep DAI luon du nho de gui lai: nhieu doan van -> bi cat <= MAX_INPUT_TEXT_CHARS va sinh ke hoach duoc
    const many = await upload(
      u,
      await buildDocx({ body: Array.from({ length: 20_000 }, (_, i) => para(`Viec so ${i + 1} can lam`)).join('') }),
      'dai.docx'
    );
    expect(many.status).toBe(200);
    expect(many.body.data.truncated).toBe(true);
    expect(many.body.data.chars).toBeLessThanOrEqual(MAX_INPUT_TEXT_CHARS);
    const big = await generate(u, { text: many.body.data.text, inputKind: 'DOCX' });
    expect(big.status).toBe(200);
    // Gioi han trich tep va gioi han phan tich mac dinh BANG NHAU (deu MAX_INPUT_TEXT_CHARS):
    // chu da cat o buoc trich tep KHONG bi cat THEO KY TU them lan hai o buoc sinh ke hoach nua.
    // (Van con canh bao khac ma code cung la INPUT_TRUNCATED vi van ban qua nhieu dong bi cat
    // BOT SO THE toi da cua FREEFORM - khong lien quan gioi han ky tu dang sua o day.)
    expect(
      big.body.data.plan.warnings.some((w: { message: string }) => w.message.includes('ký tự nên chỉ phần đầu'))
    ).toBe(false);

    // ---- kiem tra dau vao cua endpoint sinh ke hoach (moi o buoc 7) ----
    const before = await prisma.aiRun.count();
    const badKind = await generate(u, { text: edited, inputKind: 'EXE' });
    expect(badKind.status).toBe(400);
    expect(badKind.body.errors.map((e: { field: string }) => e.field)).toEqual(['inputKind']);
    const withNul = await generate(u, { text: `Viec mot can lam\u0000 va viec hai can lam nua`, inputKind: 'PDF' });
    expect(withNul.status).toBe(400); // truoc day NUL qua Zod roi lam Postgres loi 500
    expect(withNul.body.errors.map((e: { field: string }) => e.field)).toEqual(['text']);
    expect(await prisma.aiRun.count()).toBe(before);
  });

  it('endpoint trich tep KHONG BAO GIO goi LLM (du da cau hinh khoa) va khong ghi bang nao trong DB', async () => {
    const original = { ...env.ai };
    const u = await makeUser();
    try {
      Object.assign(env.ai, { baseUrl: 'https://llm.test/v1', apiKey: 'khoa-bi-mat', model: 'm' });
      const calls: string[] = [];
      vi.stubGlobal('fetch', async (url: string) => {
        calls.push(String(url));
        throw new Error('khong duoc goi mang');
      });
      const before = [await prisma.aiRun.count(), await prisma.board.count(), await prisma.card.count()];
      const docx = await upload(u, await buildDocx(), 'a.docx');
      const pdf = await upload(u, buildPdf([['Viec can lam']]), 'a.pdf');
      expect([docx.status, pdf.status]).toEqual([200, 200]);
      expect(calls).toEqual([]);
      expect([await prisma.aiRun.count(), await prisma.board.count(), await prisma.card.count()]).toEqual(before);
    } finally {
      Object.assign(env.ai, original);
    }
  });
});

// ===================== Gioi han tan suat (dat CUOI file: limiter giu trang thai) =====================

describe('rate limit cua endpoint trich tep', () => {
  it('10 lan / 10 phut / nguoi dung (ke ca yeu cau sai); lan thu 11 -> 429 TRUOC khi multer nhan tep; nguoi dung khac khong bi anh huong', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const statuses: number[] = [];
    for (let i = 0; i < 10; i += 1) statuses.push((await upload(a, Buffer.from('xin chao'), 'a.txt')).status);
    expect(statuses).toEqual(Array(10).fill(400));

    const limited = await upload(a, Buffer.from('xin chao'), 'a.txt');
    expect(limited.status).toBe(429); // tep .txt: neu multer chay truoc limiter thi da bi 400 o fileFilter
    // ngay ca tep hop le cung bi chan (han muc tinh theo nguoi dung, khong theo noi dung)
    expect((await upload(a, await buildDocx(), 'a.docx')).status).toBe(429);

    expect((await upload(b, await buildDocx(), 'a.docx')).status).toBe(200);
  });
});
