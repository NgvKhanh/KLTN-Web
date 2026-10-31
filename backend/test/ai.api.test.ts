import { describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { prisma } from '../src/config/prisma';
import { addDays } from '../src/modules/ai/ai.dates';
import { MAX_INPUT_TEXT_CHARS } from '../src/modules/ai/ai.schema';
import { getAiStatus, isLlmAvailable, todayInVietnam, truncateInput } from '../src/modules/ai/ai.service';
import { boardPlanSchema } from '../src/modules/ai/boardPlan.schema';
import { agent, makeUser, type TestUser } from './helpers';

// Buoc 4 (AI_MODULE.md §8): POST /api/ai/board-plans + GET /api/ai/status.
// Test tich hop qua HTTP tren DB THAT, va TRA THANG vao bang AiRun (khong chi tin JSON).
//
// LUU Y HA TANG: test/setup.ts TRUNCATE ca DB (ke ca user) truoc MOI `it`, con
// registerLimiter chi cho 10 dang ky / gio TINH THEO TUNG FILE. Vi vay cac kich ban
// can dang nhap duoc GOP vao it `it` (tong ~7 tai khoan), va ca test 429 dat CUOI
// (limiter giu trang thai trong process).

const TODAY = '2026-09-14';

const MARKETING = `# Kế hoạch Marketing ra mắt sản phẩm Q4/2026

## Thành viên
- Nguyễn Minh Anh (Trưởng nhóm)
- Trần Bảo Ngọc (Nội dung)

## Giai đoạn 1: Chuẩn bị
- Chốt thông điệp chiến dịch — Minh Anh — Hạn 20/10
- Thiết kế bộ nhận diện — Bảo Ngọc — Hạn 25/10
- Viết kịch bản video, trước thứ 6 tuần này

## Giai đoạn 2: Triển khai
- Chạy quảng cáo Facebook từ 1/11 đến 15/11
- Họp đánh giá cuối tháng 11
`;

function post(cookie: string | null, body: unknown) {
  const r = agent().post('/api/ai/board-plans');
  return (cookie ? r.set('Cookie', cookie) : r).send(body as object);
}
const ok = (u: TestUser, body: Record<string, unknown>) => post(u.cookie, { workspaceId: u.personalWorkspaceId, ...body });

// ===================== Ham thuan cua service (khong HTTP) =====================

describe('ai.service: todayInVietnam / truncateInput / isLlmAvailable', () => {
  it('"hom nay" tinh theo gio Viet Nam (UTC+7), KHONG theo UTC cua server va khong phu thuoc bien TZ (6 moc)', () => {
    const rows: Array<[string, string]> = [
      ['2026-09-18T16:59:59Z', '2026-09-18'], // 23:59:59 VN
      ['2026-09-18T17:00:00Z', '2026-09-19'], // 00:00:00 VN hom sau
      ['2026-12-31T17:00:00Z', '2027-01-01'], // qua nam
      ['2026-02-28T17:30:00Z', '2026-03-01'], // qua thang (nam thuong)
      ['2028-02-28T17:00:00Z', '2028-02-29'], // nam nhuan
      ['2026-09-14T00:00:00Z', '2026-09-14'],
    ];
    const wrong = rows
      .map(([iso, want]) => ({ iso, want, got: todayInVietnam(new Date(iso)) }))
      .filter((r) => r.want !== r.got);
    expect(wrong).toEqual([]);
  });

  it('truncateInput cat tai ranh gioi dong khi ranh gioi o nua sau; khong cat doi cap thay the; khong vuot max', () => {
    expect(truncateInput('abc', 10)).toEqual({ text: 'abc', truncated: false });
    expect(truncateInput('a'.repeat(10), 10)).toEqual({ text: 'a'.repeat(10), truncated: false }); // dung bien
    // xuong dong o nua sau (vi tri 6 >= 5): cat tai do
    expect(truncateInput(`${'a'.repeat(6)}\n${'b'.repeat(10)}`, 10)).toEqual({ text: 'aaaaaa', truncated: true });
    // xuong dong o nua dau (vi tri 2 < 5): cat thang tai max
    expect(truncateInput(`aa\n${'b'.repeat(20)}`, 10)).toEqual({ text: `aa\n${'b'.repeat(7)}`, truncated: true });
    // emoji la cap thay the 2 don vi: max = 5 khong duoc cat doi cap thu 3
    expect(truncateInput('😀'.repeat(6), 5)).toEqual({ text: '😀😀', truncated: true });
    // khoang trang cuoi bi bo
    expect(truncateInput(`ab   ${'c'.repeat(20)}`, 4)).toEqual({ text: 'ab', truncated: true });

    const sample = 'Viec so 1 can lam\n'.repeat(500) + '😀'.repeat(40);
    for (const max of [1, 2, 3, 50, 333, 1000, 5000]) {
      const r = truncateInput(sample, max);
      expect(r.text.length).toBeLessThanOrEqual(max);
      expect(sample.startsWith(r.text)).toBe(true);
      expect(r.truncated).toBe(true);
    }
  });

  it('LLM chi san sang khi DU CA BA: baseUrl, apiKey, model; getAiStatus khong lo khoa', () => {
    const cfg = { baseUrl: 'https://x.test/v1', apiKey: 'khoa-bi-mat', model: 'm', providerLabel: 'nha-cung-cap' };
    expect(isLlmAvailable(cfg)).toBe(true);
    expect(isLlmAvailable({ ...cfg, baseUrl: '' })).toBe(false);
    expect(isLlmAvailable({ ...cfg, apiKey: '' })).toBe(false);
    expect(isLlmAvailable({ ...cfg, model: '' })).toBe(false);
    expect(getAiStatus({ ...cfg, timeoutMs: 1, maxInputChars: 1 })).toEqual({
      llmAvailable: true,
      provider: 'nha-cung-cap',
      model: 'm',
    });
    expect(JSON.stringify(getAiStatus({ ...cfg, timeoutMs: 1, maxInputChars: 1 }))).not.toContain('khoa-bi-mat');
  });
});

// ===================== HTTP =====================

describe('POST /api/ai/board-plans: xac thuc, phan quyen, kiem tra dau vao', () => {
  it('401 khi chua dang nhap; 403 workspace cua nguoi khac; 404 workspace khong ton tai; KHONG ghi AiRun nao', async () => {
    const a = await makeUser();
    const b = await makeUser();

    expect((await post(null, { workspaceId: a.personalWorkspaceId, text: MARKETING })).status).toBe(401);
    expect((await agent().get('/api/ai/status')).status).toBe(401);
    expect((await post(b.cookie, { workspaceId: a.personalWorkspaceId, text: MARKETING })).status).toBe(403);
    expect((await post(a.cookie, { workspaceId: 'khong-co-workspace-nay', text: MARKETING })).status).toBe(404);

    expect(await prisma.aiRun.count()).toBe(0);
  });

  it('400 kem DUNG ten truong loi cho tung kieu du lieu sai (9 ca); van ban chi ky hieu -> 400; khong ghi AiRun', async () => {
    const a = await makeUser();
    const rows: Array<[string, Record<string, unknown>, string[]]> = [
      ['thieu ca hai truong bat buoc', {}, ['text', 'workspaceId']],
      ['van ban qua ngan', { text: 'ngan' }, ['text']],
      ['van ban 20001 ky tu', { text: 'x'.repeat(MAX_INPUT_TEXT_CHARS + 1) }, ['text']],
      ['projectEnd khong phai ngay that (2026-02-30)', { text: MARKETING, projectEnd: '2026-02-30' }, ['projectEnd']],
      ['projectStart sau projectEnd', { text: MARKETING, projectStart: '2026-11-30', projectEnd: '2026-11-01' }, ['projectEnd']],
      ['today sai dinh dang', { text: MARKETING, today: '14/09/2026' }, ['today']],
      ['mode ngoai tap', { text: MARKETING, mode: 'X' }, ['mode']],
      ['skipWeekend khong phai boolean', { text: MARKETING, skipWeekend: 'co' }, ['skipWeekend']],
      ['projectStart khong phai chuoi', { text: MARKETING, projectStart: 20261101 }, ['projectStart']],
    ];
    const wrong: unknown[] = [];
    for (const [name, extra, wantFields] of rows) {
      const body = 'workspaceId' in extra || name.startsWith('thieu') ? extra : { workspaceId: a.personalWorkspaceId, ...extra };
      const res = await post(a.cookie, body);
      const got = (res.body.errors ?? []).map((e: { field: string }) => e.field).sort();
      if (res.status !== 400 || JSON.stringify(got) !== JSON.stringify([...wantFields].sort())) {
        wrong.push({ name, status: res.status, got });
      }
    }
    expect(wrong).toEqual([]);

    // qua duoc Zod (>= 20 ky tu) nhung khong co noi dung that: 400 cua service, khong co "errors"
    const symbols = await post(a.cookie, { workspaceId: a.personalWorkspaceId, text: '-'.repeat(30) });
    expect(symbols.status).toBe(400);
    expect(symbols.body.message).toMatch(/khong co noi dung/);
    expect(await prisma.aiRun.count()).toBe(0);
  });
});

describe('POST /api/ai/board-plans: sinh ke hoach bang bo luat', () => {
  it('200 voi vi du Marketing: hinh dang phan hoi, AiRun trong DB dung tung cot, plan trong DB = plan tra ve, CHUA tao bang/danh sach/the nao', async () => {
    const a = await makeUser();
    const before = [await prisma.board.count(), await prisma.list.count(), await prisma.card.count()];

    const res = await ok(a, { text: MARKETING, today: TODAY });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;
    expect(Object.keys(data).sort()).toEqual(['llmUsed', 'modeAuto', 'plan', 'runId', 'stats']);
    expect(data.llmUsed).toBe(false);
    expect(data.modeAuto).toBe('STRUCTURED');
    expect(boardPlanSchema.safeParse(data.plan).success).toBe(true);

    expect(data.plan.board.name).toBe('Kế hoạch Marketing ra mắt sản phẩm Q4/2026');
    expect(data.plan.lists.map((l: { name: string; cards: unknown[] }) => `${l.name}:${l.cards.length}`)).toEqual([
      'Thành viên:2',
      'Giai đoạn 1: Chuẩn bị:3',
      'Giai đoạn 2: Triển khai:2',
    ]);
    expect(
      data.plan.lists.flatMap((l: { cards: Array<{ ref: string; selected: boolean; dueDate: string | null }> }) =>
        l.cards.map((c) => `${c.ref}:${c.selected ? 'x' : '-'}:${c.dueDate ?? '-'}`)
      )
    ).toEqual(['c1:-:-', 'c2:-:-', 'c3:x:2026-10-20', 'c4:x:2026-10-25', 'c5:x:2026-09-18', 'c6:x:2026-11-15', 'c7:x:2026-11-30']);
    expect(data.plan.warnings[0].code).toBe('LLM_UNAVAILABLE'); // buoc 4 chua co duong goi LLM
    expect(data.stats).toEqual({ totalCards: 7, selectedCards: 5, truncatedCards: 0, explicitCards: 5, scheduledCards: 0, undatedCards: 2 });

    // ---- tra thang vao DB ----
    const row = await prisma.aiRun.findUniqueOrThrow({ where: { id: data.runId } });
    expect(row).toMatchObject({
      userId: a.id,
      workspaceId: a.personalWorkspaceId,
      boardId: null, // chua ap dung
      actorKey: a.id,
      inputKind: 'TEXT',
      inputLines: 11,
      modeAuto: 'STRUCTURED',
      mode: 'STRUCTURED',
      structuredRatio: 1,
      llmUsed: false,
      provider: 'rule',
      model: '',
      promptTokens: null,
      completionTokens: null,
      latencyMs: null,
      llmFailReason: null,
      cardCount: 7,
      droppedCards: 0,
      verdictLines: 0,
      accepted: false,
      appliedPlan: null,
      appliedAt: null,
      editCount: null,
    });
    expect(row.inputText).toBe(MARKETING.trim());
    expect(row.inputChars).toBe(MARKETING.trim().length);
    expect(row.plan).toEqual(data.plan); // toEqual: jsonb cua Postgres sap xep lai thu tu khoa
    expect(row.warnings).toEqual(data.plan.warnings);
    expect(await prisma.aiRun.count()).toBe(1);

    // Buoc 4 CHUA tao bang that (viec cua buoc 5)
    expect([await prisma.board.count(), await prisma.list.count(), await prisma.card.count()]).toEqual(before);
  });

  it('ghi de che do, cua so du an, "hom nay" mac dinh theo gio Viet Nam, van ban dai bi cat tai ranh gioi dong', async () => {
    const a = await makeUser();

    // ghi de che do: may chon STRUCTURED, nguoi dung ep FREEFORM -> ca hai deu duoc ghi lai
    const forced = await ok(a, { text: MARKETING, today: TODAY, mode: 'FREEFORM' });
    expect(forced.status).toBe(200);
    expect(forced.body.data.plan.mode).toBe('FREEFORM');
    expect(forced.body.data.modeAuto).toBe('STRUCTURED');
    const forcedRow = await prisma.aiRun.findUniqueOrThrow({ where: { id: forced.body.data.runId } });
    expect([forcedRow.modeAuto, forcedRow.mode]).toEqual(['STRUCTURED', 'FREEFORM']);

    // cua so du an + skipWeekend duoc truyen xuong bo rai lich
    const win = await ok(a, { text: 'Việc một cần làm. Việc hai cần làm.', today: TODAY, projectStart: '2026-10-05', projectEnd: '2026-10-09' });
    expect(win.status).toBe(200);
    expect(
      win.body.data.plan.lists[0].cards.map((c: { startDate: string; dueDate: string }) => `${c.startDate}..${c.dueDate}`)
    ).toEqual(['2026-10-05..2026-10-07', '2026-10-08..2026-10-09']);
    expect(win.body.data.plan.warnings.map((w: { code: string }) => w.code)).not.toContain('DEFAULT_WINDOW');

    // khong gui `today`: server lay theo gio Viet Nam ("hom nay" = ngay VN, "ngay mai" = ngay VN + 1)
    const t0 = todayInVietnam(new Date());
    const dflt = await ok(a, { text: 'Việc A hôm nay. Việc B ngày mai. Việc C.' });
    const t1 = todayInVietnam(new Date());
    const [cardA, cardB] = dflt.body.data.plan.lists[0].cards as Array<{ dueDate: string }>;
    expect([t0, t1]).toContain(cardA!.dueDate);
    expect(cardB!.dueDate).toBe(addDays(cardA!.dueDate, 1));

    // Gioi han schema (MAX_INPUT_TEXT_CHARS) va gioi han phan tich (AI_MAX_INPUT_CHARS) mac
    // dinh BANG NHAU: van ban chua vuot gioi han khong con bi CAT LAN HAI nua (truoc day
    // 8000 > 6000 nen van ban gan 8000 ky tu luon bi cat them va bao INPUT_TRUNCATED sai lech
    // voi con so 8000 hien tren o nhap).
    if (env.ai.maxInputChars >= 7000) {
      // Dong DAI (~46 ky tu) de tong ~150 dong, khong cham gioi han 200 the cua STRUCTURED
      // (co test rieng o ai.build.test.ts) - tranh lan voi canh bao INPUT_TRUNCATED do cat THE.
      const lines: string[] = [];
      for (let i = 1, len = 0; len <= 7000; i += 1) {
        lines.push(`- Viec so ${i} can lam ${'x'.repeat(40)}`);
        len += lines[lines.length - 1]!.length + 1;
      }
      const long = lines.join('\n');
      expect(long.length).toBeLessThan(MAX_INPUT_TEXT_CHARS);
      const res = await ok(a, { text: long, today: TODAY });
      expect(res.status).toBe(200);
      const codes = res.body.data.plan.warnings.map((w: { code: string }) => w.code);
      expect(codes).not.toContain('INPUT_TRUNCATED');
      const row = await prisma.aiRun.findUniqueOrThrow({ where: { id: res.body.data.runId } });
      expect(row.inputText).toBe(long); // khong bi cat: gioi han phan tich >= gioi han schema
      expect(row.inputChars).toBe(long.length);
      expect(row.inputLines).toBe(lines.length);
      expect(res.body.data.stats.totalCards).toBe(lines.length);
    }
  });
});

describe('GET /api/ai/status va gioi han tan suat', () => {
  it('status khop cau hinh, khong lo khoa, khong bao gio 503', async () => {
    const a = await makeUser();
    const res = await agent().get('/api/ai/status').set('Cookie', a.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual(getAiStatus());
    expect(Object.keys(res.body.data).sort()).toEqual(['llmAvailable', 'model', 'provider']);
    expect(typeof res.body.data.llmAvailable).toBe('boolean');
    if (env.ai.apiKey) expect(JSON.stringify(res.body)).not.toContain(env.ai.apiKey);
  });

  // DAT CUOI FILE: limiter giu trang thai trong process nen ca nay lam anh huong cac ca sau.
  it('429 o luot thu 11 trong 10 phut (ke ca yeu cau sai dinh dang); tinh THEO USER: nguoi khac van goi duoc; /status khong bi chan', async () => {
    const c = await makeUser();
    const d = await makeUser();
    for (let i = 1; i <= 10; i += 1) {
      const r = await post(c.cookie, {});
      expect(r.status).toBe(400); // qua limiter roi moi bi validate tu choi
    }
    const blocked = await post(c.cookie, { workspaceId: c.personalWorkspaceId, text: MARKETING });
    expect(blocked.status).toBe(429);
    expect(blocked.body.success).toBe(false);

    expect((await agent().get('/api/ai/status').set('Cookie', c.cookie)).status).toBe(200);
    expect((await ok(d, { text: MARKETING, today: TODAY })).status).toBe(200); // user khac, cung IP
  });
});
