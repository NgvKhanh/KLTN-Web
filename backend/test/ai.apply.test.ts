import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { addDays } from '../src/modules/ai/ai.dates';
import { countPlanEdits, dueInstant, startInstant } from '../src/modules/ai/ai.apply';
import type { BoardPlan } from '../src/modules/ai/boardPlan.schema';
import { addWorkspaceMember, agent, makeUser, makeWorkspace, type TestUser } from './helpers';

// Buoc 5 (AI_MODULE.md §8): POST /api/ai/board-plans/:runId/apply -> tao BANG THAT.
// Moi gia tri mong doi duoc LAY tu lan chay that (script tham do) roi doi chieu bang mat.
// Test tich hop qua HTTP tren DB THAT va TRA THANG vao bang (khong chi tin JSON).
//
// LUU Y HA TANG: test/setup.ts TRUNCATE ca DB (ke ca user) truoc MOI `it` va registerLimiter
// chi cho 10 dang ky / file -> kich ban can dang nhap duoc GOP vao it `it` (tong 6 tai khoan);
// ca test 429 dat CUOI file (limiter giu trang thai trong process).

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

type Plan = BoardPlan;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const cardOf = (plan: Plan, ref: string) => plan.lists.flatMap((l) => l.cards).find((c) => c.ref === ref)!;

async function generate(u: TestUser, workspaceId = u.personalWorkspaceId) {
  const res = await agent().post('/api/ai/board-plans').set('Cookie', u.cookie).send({ workspaceId, text: MARKETING, today: TODAY });
  if (res.status !== 200) throw new Error(`Sinh ke hoach that bai: ${res.status} ${JSON.stringify(res.body)}`);
  return { runId: res.body.data.runId as string, plan: res.body.data.plan as Plan };
}
const apply = (u: TestUser | null, runId: string, plan: unknown) => {
  const r = agent().post(`/api/ai/board-plans/${runId}/apply`);
  return (u ? r.set('Cookie', u.cookie) : r).send({ plan } as object);
};

// ===================== Ham thuan =====================

const pc = (ref: string, over: Partial<Plan['lists'][number]['cards'][number]> = {}): Plan['lists'][number]['cards'][number] => ({
  ref,
  title: `The ${ref}`,
  description: '',
  sourceLine: 1,
  selected: true,
  startDate: null,
  startOrigin: 'NONE',
  dueDate: null,
  dueOrigin: 'NONE',
  labelKeys: [],
  checklist: [],
  ...over,
});
function basePlan(): Plan {
  return {
    mode: 'STRUCTURED',
    board: { name: 'Bang', color: '#0079BF' },
    labels: [
      { key: 'l1', name: 'Gap', color: '#f87168' },
      { key: 'l2', name: 'Xanh', color: '#4bce97' },
    ],
    lists: [
      { name: 'A', cards: [pc('c1', { labelKeys: ['l1', 'l2'] }), pc('c2')] },
      { name: 'B', cards: [pc('c3', { checklist: ['a', 'b'] })] },
    ],
    warnings: [],
    assumptions: ['Gia dinh'],
  };
}

describe('ai.apply: countPlanEdits va doi ngay sang thoi diem', () => {
  it('dem dung so truong nguoi dung da sua (29 ca): tung loai sua dem 1 lan; doi ten danh sach KHONG nhan theo so the', () => {
    const rows: Array<[string, (p: Plan) => void, number]> = [
      ['khong sua gi', () => {}, 0],
      ['ten bang', (p) => { p.board.name = 'Bang moi'; }, 1],
      ['mau bang', (p) => { p.board.color = '#D29034'; }, 1],
      ['ten + mau bang', (p) => { p.board.name = 'X'; p.board.color = '#D29034'; }, 2],
      ['tieu de the', (p) => { cardOf(p, 'c2').title = 'Sua'; }, 1],
      ['mo ta the', (p) => { cardOf(p, 'c2').description = 'Ghi chu'; }, 1],
      ['bo tick the', (p) => { cardOf(p, 'c2').selected = false; }, 1],
      ['them ngay bat dau', (p) => { cardOf(p, 'c2').startDate = '2026-10-01'; }, 1],
      ['doi ngay han', (p) => { cardOf(p, 'c2').dueDate = '2026-10-02'; }, 1],
      ['doi thu tu nhan cua the (khong doi tap nhan)', (p) => { cardOf(p, 'c1').labelKeys = ['l2', 'l1']; }, 0],
      ['bot 1 nhan cua the', (p) => { cardOf(p, 'c1').labelKeys = ['l1']; }, 1],
      ['them 1 muc checklist', (p) => { cardOf(p, 'c2').checklist = ['a']; }, 1],
      ['them checklist 2 muc vao the chua co (chi 1 lan, khong nhan theo so muc)', (p) => { cardOf(p, 'c1').checklist = ['x', 'y']; }, 1],
      ['doi thu tu 2 muc checklist', (p) => { cardOf(p, 'c3').checklist = ['b', 'a']; }, 1],
      ['hai truong tren cung 1 the', (p) => { cardOf(p, 'c2').title = 'Sua'; cardOf(p, 'c2').selected = false; }, 2],
      ['doi ten danh sach co 2 the (chi 1 lan)', (p) => { p.lists[0]!.name = 'A2'; }, 1],
      ['chuyen the sang danh sach khac', (p) => { p.lists[1]!.cards.push(p.lists[0]!.cards.pop()!); }, 1],
      ['xoa 1 the', (p) => { p.lists[0]!.cards.pop(); }, 1],
      ['them 1 the moi (ref moi)', (p) => { p.lists[0]!.cards.push(pc('c9')); }, 1],
      ['them danh sach moi co 2 the moi (1 + 2)', (p) => { p.lists.push({ name: 'C', cards: [pc('c8'), pc('c9')] }); }, 3],
      ['xoa danh sach B cung the cua no (1 danh sach + 1 the)', (p) => { p.lists.pop(); }, 2],
      ['danh sach A bi tach lam hai (danh sach moi + 1 the chuyen)', (p) => { p.lists.splice(1, 0, { name: 'A-tach', cards: [p.lists[0]!.cards.pop()!] }); }, 2],
      ['xoa het the cua danh sach A nhung giu danh sach (khop theo ten)', (p) => { p.lists[0]!.cards = []; }, 2],
      ['them nhan moi', (p) => { p.labels.push({ key: 'l3', name: 'Moi', color: '#f5cd47' }); }, 1],
      ['doi ten nhan', (p) => { p.labels[0]!.name = 'Khac'; }, 1],
      ['doi mau nhan', (p) => { p.labels[0]!.color = '#f5cd47'; }, 1],
      ['xoa nhan l2 kem go khoi the (nhan 1 + the 1)', (p) => { p.labels.pop(); cardOf(p, 'c1').labelKeys = ['l1']; }, 2],
      ['thay doi canh bao / gia dinh / sourceLine KHONG tinh', (p) => { p.warnings = [{ code: 'FUZZY_DATE', message: 'x' }]; p.assumptions = []; cardOf(p, 'c1').sourceLine = 7; }, 0],
      ['doi mode khong tinh (khong phai truong nguoi dung sua)', (p) => { p.mode = 'FREEFORM'; }, 0],
    ];
    const wrong = rows
      .map(([name, mutate, want]) => {
        const edited = clone(basePlan());
        mutate(edited);
        return { name, want, got: countPlanEdits(basePlan(), edited) };
      })
      .filter((r) => r.want !== r.got);
    expect(wrong).toEqual([]);
  });

  it('countPlanEdits khong sua hai dau vao va doi xung voi "khong doi" (ban thanh chinh no = 0)', () => {
    const a = Object.freeze(clone(basePlan()));
    expect(countPlanEdits(a as Plan, a as Plan)).toBe(0);
  });

  it('ngay -> thoi diem: bat dau 00:00, han 23:59 GIO VIET NAM; hien lai o VN dung NGAY da chon ca nam 2028 (nam nhuan)', () => {
    expect(startInstant('2026-11-01').toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(dueInstant('2026-10-20').toISOString()).toBe('2026-10-20T16:59:00.000Z');

    const vnDay = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }); // YYYY-MM-DD
    const wrong: string[] = [];
    for (let i = 0; i < 366; i += 1) {
      const day = addDays('2028-01-01', i);
      if (vnDay(startInstant(day)) !== day) wrong.push(`start ${day} -> ${vnDay(startInstant(day))}`);
      if (vnDay(dueInstant(day)) !== day) wrong.push(`due ${day} -> ${vnDay(dueInstant(day))}`);
      // han cua ngay D van nam TRUOC bat dau cua ngay D+1
      if (!(dueInstant(day).getTime() < startInstant(addDays(day, 1)).getTime())) wrong.push(`thu tu ${day}`);
      // khoang ngay: han - bat dau cung ngay = 23 gio 59 phut
      if (dueInstant(day).getTime() - startInstant(day).getTime() !== (23 * 60 + 59) * 60_000) wrong.push(`khoang ${day}`);
    }
    expect(wrong).toEqual([]);
    // Cach "ngay tho" (23:59Z) se lech sang hom sau o VN - day chinh la loi ma quyet dinh nay tranh
    expect(vnDay(new Date('2026-10-20T23:59:00.000Z'))).toBe('2026-10-21');
  });
});

// ===================== HTTP: tao bang =====================

describe('POST /api/ai/board-plans/:runId/apply: tao bang that', () => {
  it('201: bang, thanh vien OWNER, danh sach, the, ngay (gio VN), checklist, nhan, AiRun, nhat ky - tra thang DB; the/danh sach/nhan khong dung KHONG duoc tao', async () => {
    const u = await makeUser();
    const { runId, plan: original } = await generate(u);
    expect(await prisma.board.count()).toBe(0); // buoc sinh ke hoach KHONG tao bang

    const plan = clone(original);
    plan.board.name = 'Marketing Q4 (da sua)';
    plan.labels = [
      { key: 'l1', name: 'Truyen thong', color: '#f87168' },
      { key: 'l2', name: 'Khong dung', color: '#4bce97' }, // khong the nao tick dung -> khong duoc tao
    ];
    cardOf(plan, 'c3').labelKeys = ['l1', 'l1']; // trung khoa: van chi 1 lien ket
    cardOf(plan, 'c4').labelKeys = ['l1'];
    cardOf(plan, 'c5').checklist = ['Quay', 'Dung'];
    cardOf(plan, 'c6').title = 'Chay quang cao (sua)';
    cardOf(plan, 'c7').description = 'Ghi chu them';

    const res = await apply(u, runId, plan);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe('Da tao bang tu ke hoach AI');
    expect(Object.keys(res.body.data)).toEqual(['board']);
    const boardId = res.body.data.board.id as string;
    // Cung hinh dang voi createBoard (frontend goi thang upsertBoard)
    expect(res.body.data.board).toMatchObject({
      ownerId: u.id,
      workspaceId: u.personalWorkspaceId,
      name: 'Marketing Q4 (da sua)',
      color: plan.board.color,
      visibility: 'PRIVATE',
      deletedAt: null,
      archivedAt: null,
    });

    // ---- tra thang DB ----
    const board = await prisma.board.findUniqueOrThrow({
      where: { id: boardId },
      include: {
        members: true,
        labels: true,
        lists: {
          orderBy: { position: 'asc' },
          include: {
            cards: {
              orderBy: { position: 'asc' },
              include: { labels: true, checklists: { include: { items: { orderBy: { position: 'asc' } } } } },
            },
          },
        },
      },
    });
    expect(board).toMatchObject({ ownerId: u.id, workspaceId: u.personalWorkspaceId, name: 'Marketing Q4 (da sua)', visibility: 'PRIVATE' });
    expect(board.members.map((m) => [m.role, m.userId])).toEqual([['OWNER', u.id]]); // dung 1 thanh vien OWNER
    expect(board.labels.map((l) => [l.name, l.color])).toEqual([['Truyen thong', '#f87168']]); // chi nhan duoc dung den

    // Danh sach "Thanh vien" chi co the bo tick san -> KHONG duoc tao
    expect(board.lists.map((l) => [l.position, l.name])).toEqual([
      [0, 'Giai đoạn 1: Chuẩn bị'],
      [1, 'Giai đoạn 2: Triển khai'],
    ]);
    const summary = board.lists.map((l) =>
      l.cards.map(
        (c) =>
          `${c.position} ${c.title} | ${c.startDate?.toISOString() ?? '-'}..${c.dueDate?.toISOString() ?? '-'} | desc=${c.description ?? '-'} | labels=${c.labels.length} | cl=${
            c.checklists.map((k) => `${k.title}:${k.items.map((i) => `${i.position}=${i.content}`).join('/')}`).join(',') || '-'
          }`
      )
    );
    expect(summary).toEqual([
      [
        '0 Chốt thông điệp chiến dịch — Minh Anh — Hạn 20/10 | -..2026-10-20T16:59:00.000Z | desc=- | labels=1 | cl=-',
        '1 Thiết kế bộ nhận diện — Bảo Ngọc — Hạn 25/10 | -..2026-10-25T16:59:00.000Z | desc=- | labels=1 | cl=-',
        '2 Viết kịch bản video, trước thứ 6 tuần này | -..2026-09-18T16:59:00.000Z | desc=- | labels=0 | cl=Việc cần làm:0=Quay/1=Dung',
      ],
      [
        '0 Chay quang cao (sua) | 2026-10-31T17:00:00.000Z..2026-11-15T16:59:00.000Z | desc=- | labels=0 | cl=-',
        '1 Họp đánh giá cuối tháng 11 | -..2026-11-30T16:59:00.000Z | desc=Ghi chu them | labels=0 | cl=-',
      ],
    ]);
    // Cac thoi diem do khi hien o VN ra dung ngay nguoi dung thay tren ke hoach
    const vnDay = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
    const c6 = board.lists[1]!.cards[0]!;
    expect([vnDay(c6.startDate!), vnDay(c6.dueDate!)]).toEqual(['2026-11-01', '2026-11-15']);

    // gan nhan: c3 va c4 (khoa trung chi 1 lien ket), khong the nao khac
    const links = await prisma.cardLabel.findMany({ include: { card: { select: { title: true } } } });
    expect(links.map((l) => l.card.title.slice(0, 12)).sort()).toEqual(['Chốt thông điệp'.slice(0, 12), 'Thiết kế bộ nh'.slice(0, 12)].sort());
    expect(await prisma.card.count()).toBe(5);

    // ---- AiRun ----
    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({ boardId, accepted: true, editCount: 8 });
    expect(run.appliedAt).not.toBeNull();
    // 8 = ten bang 1 + 2 nhan them 2 + gan nhan c3,c4 2 + checklist c5 1 + tieu de c6 1 + mo ta c7 1
    expect(isDeepStrictEqual(run.appliedPlan, plan)).toBe(true); // luu DUNG ban nguoi dung gui (jsonb sap lai khoa nen so bang isDeepStrictEqual)
    expect(run.plan).toEqual(original); // ban AI de xuat KHONG BAO GIO bi ghi de

    // ---- nhat ky: dung 1 dong tren bang moi ----
    const acts = await prisma.activity.findMany({ where: { boardId } });
    expect(acts.map((a) => [a.type, a.userId, a.cardId, a.data])).toEqual([['ai.board.create', u.id, null, { runId, cardCount: 5 }]]);
  });

  it('the bo tick duoc tick lai thi danh sach do duoc tao; 2 request DONG THOI chi 1 thang (201 + 409, dung 1 bang); ap dung lai sau do -> 409', async () => {
    const u = await makeUser();
    const { runId, plan: original } = await generate(u);
    const plan = clone(original);
    cardOf(plan, 'c1').selected = true; // tick lai 1 the thanh vien -> danh sach "Thanh vien" duoc tao (1 the)

    const [a, b] = await Promise.all([apply(u, runId, plan), apply(u, runId, plan)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = [a, b].find((r) => r.status === 409)!;
    expect(loser.body).toEqual({ success: false, message: 'Ke hoach nay da duoc ap dung' });

    expect(await prisma.board.count()).toBe(1);
    const lists = await prisma.list.findMany({ orderBy: { position: 'asc' }, include: { _count: { select: { cards: true } } } });
    expect(lists.map((l) => [l.name, l._count.cards])).toEqual([
      ['Thành viên', 1],
      ['Giai đoạn 1: Chuẩn bị', 3],
      ['Giai đoạn 2: Triển khai', 2],
    ]);
    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.editCount).toBe(1); // tick lai dung 1 the
    expect(await prisma.activity.count({ where: { type: 'ai.board.create' } })).toBe(1); // chi ben thang ghi nhat ky

    const again = await apply(u, runId, plan);
    expect(again.status).toBe(409);
    expect(await prisma.board.count()).toBe(1);
  });
});

// ===================== HTTP: phan quyen + kiem tra dau vao =====================

describe('POST /api/ai/board-plans/:runId/apply: phan quyen va kiem tra dau vao', () => {
  it('401 / 404 (run cua nguoi khac, run khong ton tai) / 403 (bi go khoi khong gian sau khi sinh ke hoach) / 400 (dau vao sai) - va cac yeu cau hong KHONG lam mat luot ap dung cua run', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { runId, plan } = await generate(a);

    expect((await apply(null, runId, plan)).status).toBe(401);
    expect((await apply(b, runId, plan)).status).toBe(404); // run cua nguoi khac: khong tiet lo co ton tai
    expect((await apply(a, 'khong-co-run-nay', plan)).status).toBe(404);

    // ---- 403: b la thanh vien khong gian chung, sinh ke hoach, roi bi go ----
    const ws = await makeWorkspace(a);
    await addWorkspaceMember(a, ws.id, b.email);
    const shared = await generate(b, ws.id);
    await prisma.workspaceMember.updateMany({ where: { workspaceId: ws.id, userId: b.id }, data: { deletedAt: new Date() } });
    expect((await apply(b, shared.runId, shared.plan)).status).toBe(403);

    // ---- 400 ----
    const noneSelected = clone(plan);
    noneSelected.lists.forEach((l) => l.cards.forEach((c) => (c.selected = false)));
    const rNone = await apply(a, runId, noneSelected);
    expect(rNone.status).toBe(400);
    expect(rNone.body.message).toMatch(/Chua chon the nao/);

    const badDate = clone(plan);
    cardOf(badDate, 'c3').dueDate = '2026-02-30';
    const rDate = await apply(a, runId, badDate);
    expect(rDate.status).toBe(400);
    expect(rDate.body.errors.map((e: { field: string }) => e.field)).toEqual(['plan.lists.1.cards.0.dueDate']);

    const extraKey = { ...clone(plan), stats: { totalCards: 999 } };
    const rExtra = await apply(a, runId, extraKey);
    expect(rExtra.status).toBe(400);

    const unknownLabel = clone(plan);
    cardOf(unknownLabel, 'c3').labelKeys = ['khong-co'];
    expect((await apply(a, runId, unknownLabel)).status).toBe(400);

    const rMissing = await agent().post(`/api/ai/board-plans/${runId}/apply`).set('Cookie', a.cookie).send({});
    expect(rMissing.status).toBe(400);
    expect(rMissing.body.errors.map((e: { field: string }) => e.field)).toEqual(['plan']);

    // ---- moi yeu cau tren deu KHONG tao bang va KHONG lam mat luot cua run ----
    expect(await prisma.board.count()).toBe(0);
    expect((await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } })).appliedAt).toBeNull();
    expect((await apply(a, runId, plan)).status).toBe(201);
  });
});

describe('POST /api/ai/board-plans/:runId/apply: an toan giao dich', () => {
  it('loi DB giua chung (ky tu NUL) -> 500, ROLLBACK ca viec "nhan cho": run chua ap dung, khong co bang/nhat ky, ap dung lai bang ke hoach dung thanh cong', async () => {
    const u = await makeUser();
    const { runId, plan } = await generate(u);
    const bad = clone(plan);
    cardOf(bad, 'c3').title = 'Co ky tu NUL \u0000 o giua'; // qua Zod nhung Postgres tu choi 0x00

    const res = await apply(u, runId, bad);
    expect(res.status).toBe(500);

    expect(await prisma.board.count()).toBe(0);
    expect(await prisma.list.count()).toBe(0);
    expect(await prisma.card.count()).toBe(0);
    expect(await prisma.activity.count()).toBe(0);
    const run = await prisma.aiRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({ appliedAt: null, boardId: null, accepted: false, editCount: null, appliedPlan: null });

    const retry = await apply(u, runId, plan);
    expect(retry.status).toBe(201);
    expect(await prisma.board.count()).toBe(1);
  });
});

// ===================== Ky luat ma nguon =====================

describe('ky luat ma nguon cua ai.apply.ts', () => {
  const src = fs
    .readFileSync(path.resolve(__dirname, '../src/modules/ai/ai.apply.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('khong ghep chuoi vao regex, khong regex "khop moi ky tu", khong ham gio dia phuong, khong doc dong ho; ngay chi doi sang Date o dung 2 cho co neo +07:00', () => {
    expect(src).not.toMatch(/\bRegExp\s*\(/);
    expect(src).not.toContain('.*');
    expect(src).not.toContain('.+');
    expect(src).not.toMatch(/\.(get|set)(Date|Day|Month|FullYear|Hours|Minutes|Seconds|Milliseconds|TimezoneOffset)\s*\(/);
    expect(src).not.toMatch(/Date\.now\s*\(/);
    expect(src).not.toMatch(/toLocale\w*String/);
    // 'T00:00:00.000' va 'T23:59:00.000' phai di kem hang so neo mui gio, khong bao gio 'Z'
    expect(src).toMatch(/T00:00:00\.000\$\{VN_UTC_OFFSET\}/);
    expect(src).toMatch(/T23:59:00\.000\$\{VN_UTC_OFFSET\}/);
    expect(src).not.toMatch(/T\d\d:\d\d:\d\d\.\d+Z/);
  });
});

// ===================== Gioi han tan suat (DAT CUOI FILE) =====================

describe('gioi han tan suat cua apply', () => {
  it('429 o luot thu 31 trong 10 phut (ke ca yeu cau sai dinh dang) va TACH BIET voi limiter sinh ke hoach', async () => {
    const c = await makeUser();
    for (let i = 1; i <= 30; i += 1) {
      const r = await agent().post('/api/ai/board-plans/x/apply').set('Cookie', c.cookie).send({});
      expect(r.status).toBe(400); // qua limiter roi moi bi validate tu choi
    }
    const blocked = await agent().post('/api/ai/board-plans/x/apply').set('Cookie', c.cookie).send({});
    expect(blocked.status).toBe(429);
    expect(blocked.body.success).toBe(false);

    // limiter sinh ke hoach la bo dem RIENG: van goi duoc
    const gen = await agent()
      .post('/api/ai/board-plans')
      .set('Cookie', c.cookie)
      .send({ workspaceId: c.personalWorkspaceId, text: MARKETING, today: TODAY });
    expect(gen.status).toBe(200);
  });
});
