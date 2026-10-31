import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPlan, DEFAULT_BOARD_NAME, DEFAULT_LIST_NAME, type BuildOptions } from '../src/modules/ai/ai.build';
import { analyzeText, type PlanMode } from '../src/modules/ai/ai.rules';
import { BOARD_COLORS, boardPlanSchema, limitsForMode, type BoardPlan } from '../src/modules/ai/boardPlan.schema';

// Buoc 4 (AI_MODULE.md §5): chuyen ket qua bo luat thanh BoardPlan (duong rule-only).
// Moi gia tri mong doi duoc LAY tu lan chay that (script tham do) roi doi chieu bang
// mat truoc khi viet vao day. Ham thuan, hom nay co dinh = 2026-09-14 (THU HAI).
// Chay them nhieu mui gio (xem dau file ai.rules.test.ts - Windows bo qua ten IANA):
//   TZ=UTC npx vitest run test/ai.build.test.ts ; TZ=PST8PDT ...
// test/setup.ts TRUNCATE DB truoc MOI `it` (~0.4 giay) nen cac ca duoc gop thanh bang.

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

function build(text: string, over: Partial<BuildOptions> = {}) {
  const findings = analyzeText(text, TODAY);
  const mode: PlanMode = over.mode ?? findings.mode;
  const r = buildPlan(findings, { mode, today: TODAY, skipWeekend: true, ...over });
  return { ...r, findings };
}

/** Dang van ban gon cua ke hoach: "[x] c3 L6 tieu de | bat-dau..han NE" (N/E/S = nguon ngay). */
function outline(plan: BoardPlan): string[] {
  return plan.lists.flatMap((l) => [
    `# ${l.name}`,
    ...l.cards.map(
      (c) =>
        `${c.selected ? '[x]' : '[ ]'} ${c.ref} L${c.sourceLine} ${c.title} | ${c.startDate ?? '-'}..${c.dueDate ?? '-'} ${c.startOrigin[0]}${c.dueOrigin[0]}` +
        (c.checklist.length ? ` +[${c.checklist.join('; ')}]` : '')
    ),
  ]);
}
const codes = (plan: BoardPlan) => plan.warnings.map((w) => `${w.code}${w.ref ? '@' + w.ref : ''}`);
function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}
const bullets = (n: number, f: (i: number) => string = (i) => `Viec so ${i}`) =>
  Array.from({ length: n }, (_, i) => `- ${f(i + 1)}`).join('\n');

// ===================== Ke hoach Marketing that =====================

describe('buildPlan: ke hoach Marketing that (STRUCTURED)', () => {
  it('tieu de cap 1 -> ten bang; tieu de -> danh sach; gach dau dong -> the; ngay EXPLICIT; muc Thanh vien bo tick san', () => {
    const { plan, stats } = build(MARKETING);
    expect(plan.mode).toBe('STRUCTURED');
    expect(plan.board.name).toBe('Kế hoạch Marketing ra mắt sản phẩm Q4/2026');
    expect(plan.board.color).toBe('#519839');
    expect(outline(plan)).toEqual([
      '# Thành viên',
      '[ ] c1 L3 Nguyễn Minh Anh (Trưởng nhóm) | -..- NN',
      '[ ] c2 L4 Trần Bảo Ngọc (Nội dung) | -..- NN',
      '# Giai đoạn 1: Chuẩn bị',
      '[x] c3 L6 Chốt thông điệp chiến dịch — Minh Anh — Hạn 20/10 | -..2026-10-20 NE',
      '[x] c4 L7 Thiết kế bộ nhận diện — Bảo Ngọc — Hạn 25/10 | -..2026-10-25 NE',
      '[x] c5 L8 Viết kịch bản video, trước thứ 6 tuần này | -..2026-09-18 NE',
      '# Giai đoạn 2: Triển khai',
      '[x] c6 L10 Chạy quảng cáo Facebook từ 1/11 đến 15/11 | 2026-11-01..2026-11-15 EE',
      '[x] c7 L11 Họp đánh giá cuối tháng 11 | -..2026-11-30 NE',
    ]);
    expect(codes(plan)).toEqual(['YEAR_INFERRED@c3', 'YEAR_INFERRED@c4', 'YEAR_INFERRED@c6', 'YEAR_INFERRED@c7', 'FUZZY_DATE@c7']);
    expect(plan.assumptions).toEqual(['Mỗi gạch đầu dòng được coi là một thẻ.']);
    expect(stats).toEqual({ totalCards: 7, selectedCards: 5, truncatedCards: 0, explicitCards: 5, scheduledCards: 0, undatedCards: 2 });
    // Ten nguoi nam nguyen trong tieu de the (khong anh xa nguoi - AI_MODULE.md §2)
    expect(plan.lists[1]!.cards[0]!.title).toContain('Minh Anh');
  });

  it('cung ket qua bat ke xuong dong kieu Windows / dong trong thua; dau vao dong bang khong bi sua; tat dinh', () => {
    const a = build(MARKETING).plan;
    const b = build(MARKETING.replace(/\n/g, '\r\n\r\n')).plan;
    // dong trong khong duoc danh so nen so dong (sourceLine) khong doi
    expect(outline(b)).toEqual(outline(a));

    const frozen = deepFreeze(analyzeText(MARKETING, TODAY));
    const opts: BuildOptions = { mode: 'STRUCTURED', today: TODAY, skipWeekend: true };
    expect(buildPlan(frozen, opts)).toEqual(buildPlan(frozen, opts)); // khong nem loi tren dau vao dong bang
  });
});

// ===================== Quy tac cau truc =====================

describe('buildPlan: quy tac chuyen doi cau truc', () => {
  it('gach dau dong thut vao -> checklist cua the cha; toi da 10 muc, moi muc toi da 500 ky tu', () => {
    const nested = build('# Khoá luận\n## Viết\n- Viết chương 1\n  - Tổng quan\n  - Mục tiêu\n    - Phạm vi\n- Viết chương 2 hạn 30/10\n  - Cơ sở lý thuyết');
    expect(outline(nested.plan)).toEqual([
      '# Viết',
      '[x] c1 L3 Viết chương 1 | -..- NN +[Tổng quan; Mục tiêu; Phạm vi]',
      '[x] c2 L7 Viết chương 2 hạn 30/10 | -..2026-10-30 NE +[Cơ sở lý thuyết]',
    ]);

    const many = build(`- Cha\n${Array.from({ length: 12 }, (_, i) => `  - Con ${i + 1}`).join('\n')}`).plan;
    expect(many.lists[0]!.cards[0]!.checklist).toHaveLength(10);
    expect(many.lists[0]!.cards[0]!.checklist[9]).toBe('Con 10');

    const longItem = build(`- Cha\n  - ${'x'.repeat(700)}`).plan;
    expect(longItem.lists[0]!.cards[0]!.checklist[0]).toHaveLength(500);
  });

  it('danh sach chi duoc tao khi co the; gach dau dong dung truoc moi tieu de vao danh sach mac dinh (5 ca)', () => {
    const rows: Array<[string, string, string[], string]> = [
      // ten, van ban, outline mong doi, ten bang
      [
        'chi co tieu de -> phuong an du phong: moi tieu de la 1 the, tieu de cap 1 la ten bang',
        '# Ke hoach\n## Giai doan 1\n## Giai doan 2\n## Giai doan 3',
        [`# ${DEFAULT_LIST_NAME}`, '[x] c1 L2 Giai doan 1 | -..- NN', '[x] c2 L3 Giai doan 2 | -..- NN', '[x] c3 L4 Giai doan 3 | -..- NN'],
        'Ke hoach',
      ],
      [
        'gach dau dong truoc tieu de + hai tieu de cap 1 (khong ai la tieu de tai lieu)',
        '- Viec mo dau\n- Viec hai\n# Phan A\n- A1\n- A2\n# Phan B\n- B1',
        [`# ${DEFAULT_LIST_NAME}`, '[x] c1 L1 Viec mo dau | -..- NN', '[x] c2 L2 Viec hai | -..- NN', '# Phan A', '[x] c3 L4 A1 | -..- NN', '[x] c4 L5 A2 | -..- NN', '# Phan B', '[x] c5 L7 B1 | -..- NN'],
        DEFAULT_BOARD_NAME,
      ],
      [
        'tieu de cap 1 khong phai tieu de DAU TIEN thi khong la ten bang',
        '## Phan\n# Tieu de\n- x\n- y',
        ['# Tieu de', '[x] c1 L3 x | -..- NN', '[x] c2 L4 y | -..- NN'],
        DEFAULT_BOARD_NAME,
      ],
      [
        'tieu de khong co the di kem bi bo (khong sinh danh sach rong)',
        '# Tai lieu\n## Rong\n## Co viec\n- Lam A\n- Lam B',
        ['# Co viec', '[x] c1 L4 Lam A | -..- NN', '[x] c2 L5 Lam B | -..- NN'],
        'Tai lieu',
      ],
      [
        'van xuoi trong tai lieu co cau truc bi bo qua',
        '# Ten\nDoan gioi thieu dai.\n## Viec\n- A\nGhi chu them.\n- B',
        ['# Viec', '[x] c1 L4 A | -..- NN', '[x] c2 L6 B | -..- NN'],
        'Ten',
      ],
    ];
    const wrong = rows
      .map(([name, text, want, boardName]) => {
        const { plan } = build(text);
        return { name, got: outline(plan), boardName: plan.board.name, want, wantBoard: boardName };
      })
      .filter((r) => JSON.stringify([r.got, r.boardName]) !== JSON.stringify([r.want, r.wantBoard]));
    expect(wrong.map((w) => ({ name: w.name, got: w.got, boardName: w.boardName }))).toEqual([]);
  });

  it('muc Thanh vien / Nhan su / Tham du duoc BO TICK san (khong xoa) - ke ca khong dau, hoa thuong', () => {
    const { plan, stats } = build('# Du an X\n## Nhân sự tham gia\n- An\n- Binh\n## DANH SÁCH THAM DỰ\n- Cuong\n## Members\n- Dung\n## Việc\n- Làm A');
    expect(outline(plan)).toEqual([
      '# Nhân sự tham gia',
      '[ ] c1 L3 An | -..- NN',
      '[ ] c2 L4 Binh | -..- NN',
      '# DANH SÁCH THAM DỰ',
      '[ ] c3 L6 Cuong | -..- NN',
      '# Members',
      '[ ] c4 L8 Dung | -..- NN',
      '# Việc',
      '[x] c5 L10 Làm A | -..- NN',
    ]);
    expect(stats.selectedCards).toBe(1);
    // "nhom" / "team" khong nam trong danh sach nhan dien -> khong bo tick nham danh sach viec
    const teamTasks = build('## Team Marketing\n- Viet bai\n- Chay ads').plan;
    expect(teamTasks.lists[0]!.cards.every((c) => c.selected)).toBe(true);
  });

  it('van xuoi: STRUCTURED bo qua, FREEFORM moi cau 1 the; ten bang FREEFORM lay tu cau dau (bo dau cham, toi da 60 ky tu)', () => {
    const hoiThao =
      'Tổ chức hội thảo khoa học cấp khoa vào 15/11. Cần chuẩn bị nội dung báo cáo, mời 3 diễn giả, lo hậu cần phòng ốc và làm truyền thông trước 2 tuần. Nhóm có 4 người.';
    const { plan } = build(hoiThao);
    expect(plan.mode).toBe('FREEFORM');
    expect(plan.board.name).toBe('Tổ chức hội thảo khoa học cấp khoa vào 15/11');
    expect(plan.lists.map((l) => l.name)).toEqual([DEFAULT_LIST_NAME]);
    expect(plan.lists[0]!.cards.map((c) => c.title)).toEqual([
      'Tổ chức hội thảo khoa học cấp khoa vào 15/11',
      'Cần chuẩn bị nội dung báo cáo, mời 3 diễn giả, lo hậu cần phòng ốc và làm truyền thông trước 2 tuần',
      'Nhóm có 4 người',
    ]);
    expect(plan.assumptions).toEqual(['Mỗi câu văn xuôi được coi là một thẻ vì chưa có AI để chọn câu nào là việc cần làm.']);

    const longFirst = build(`${'Rất dài '.repeat(20)}xong.\nMột.\nHai.`).plan.board.name;
    expect(longFirst.length).toBeLessThanOrEqual(60);
    expect(longFirst.endsWith(' ')).toBe(false);
  });

  it('nguoi dung ghi de che do: gia dinh phan anh DUNG nhung gi da xay ra (3 ca)', () => {
    // STRUCTURED ep FREEFORM: khong co cau van xuoi nao -> van chi noi ve gach dau dong
    expect(build(MARKETING, { mode: 'FREEFORM' }).plan.assumptions).toEqual(['Mỗi gạch đầu dòng được coi là một thẻ.']);
    // FREEFORM ep STRUCTURED: khong co gach dau dong -> phuong an du phong moi dong 1 the
    const forced = build('Làm khoá luận. Nộp vào tháng 12. Bảo vệ tháng 1.', { mode: 'STRUCTURED' }).plan;
    expect(forced.assumptions).toEqual(['Văn bản không có gạch đầu dòng nên mỗi dòng được coi là một thẻ.']);
    expect(forced.lists[0]!.cards.map((c) => c.title)).toEqual(['Làm khoá luận', 'Nộp vào tháng 12', 'Bảo vệ tháng 1']);
    // van xuoi bi bo qua co ghi ro
    expect(build('# Ten\nDoan gioi thieu.\n## Viec\n- A\n- B').plan.assumptions).toEqual([
      'Mỗi gạch đầu dòng được coi là một thẻ.',
      'Đoạn văn xuôi không được chuyển thành thẻ.',
    ]);
  });

  it('ten bang / mau bang xac dinh: cung ten -> cung mau, mau luon nam trong bang mau', () => {
    const a = build('# Ten co dinh\n- x\n- y').plan.board;
    const b = build('# Ten co dinh\n- khac\n- hoan toan').plan.board;
    expect(a).toEqual(b);
    const colors = new Set(
      Array.from({ length: 40 }, (_, i) => build(`# Bang so ${i}\n- x\n- y`).plan.board.color)
    );
    expect([...colors].every((c) => (BOARD_COLORS as readonly string[]).includes(c))).toBe(true);
    expect(colors.size).toBeGreaterThan(3); // khong don sac
  });
});

// ===================== Ngay thang + rai lich =====================

describe('buildPlan: ngay thang, canh bao va chinh sach rai lich', () => {
  it('ngay bat dau sau han chot -> doi cho + canh bao; moc mo va ngay tuong doi co canh bao rieng; gia dinh "hom nay"', () => {
    const { plan } = build('- Xong tu 15/11 den 1/11\n- Nop cuoi thang sau\n- Hop trong 2 tuan\n- Viec khong ngay');
    expect(outline(plan)).toEqual([
      `# ${DEFAULT_LIST_NAME}`,
      '[x] c1 L1 Xong tu 15/11 den 1/11 | 2026-11-01..2026-11-15 EE',
      '[x] c2 L2 Nop cuoi thang sau | -..2026-10-31 NE',
      '[x] c3 L3 Hop trong 2 tuan | -..2026-09-28 NE',
      '[x] c4 L4 Viec khong ngay | -..- NN',
    ]);
    expect(codes(plan)).toEqual(['DATE_ORDER_FIXED@c1', 'YEAR_INFERRED@c1', 'FUZZY_DATE@c2', 'RELATIVE_FROM_TODAY@c3']);
    expect(plan.assumptions).toContain('Ngày hôm nay được tính là 14/09/2026.');
  });

  it('CHINH SACH rai lich: STRUCTURED khong bia ngay tru khi co projectEnd; FREEFORM luon rai; the bo tick khong bao gio bi rai', () => {
    const doc = '# Tai lieu\n## Thanh vien\n- An\n## Viec\n- A\n- B han 30/10\n- C';
    // khong co projectEnd: A va C giu nguyen chua co ngay
    expect(outline(build(doc).plan)).toEqual([
      '# Thanh vien',
      '[ ] c1 L3 An | -..- NN',
      '# Viec',
      '[x] c2 L5 A | -..- NN',
      '[x] c3 L6 B han 30/10 | -..2026-10-30 NE',
      '[x] c4 L7 C | -..- NN',
    ]);
    // co projectEnd: chi A va C (the duoc tick, chua co ngay) duoc rai; B EXPLICIT va An (bo tick) khong bi dung
    const withEnd = build(doc, { projectEnd: '2026-09-25' });
    expect(outline(withEnd.plan)).toEqual([
      '# Thanh vien',
      '[ ] c1 L3 An | -..- NN',
      '# Viec',
      '[x] c2 L5 A | 2026-09-14..2026-09-18 SS',
      '[x] c3 L6 B han 30/10 | -..2026-10-30 NE',
      '[x] c4 L7 C | 2026-09-21..2026-09-25 SS',
    ]);
    expect(codes(withEnd.plan)).toEqual(['YEAR_INFERRED@c3']); // co ngay ket thuc -> khong canh bao cua so mac dinh
    expect(withEnd.stats).toMatchObject({ explicitCards: 1, scheduledCards: 2, undatedCards: 1 });

    // FREEFORM: rai ke ca khi khong co projectEnd, kem canh bao cua so mac dinh
    const free = build('Việc một. Việc hai. Việc ba.');
    expect(free.plan.lists[0]!.cards.every((c) => c.dueOrigin === 'SCHEDULED')).toBe(true);
    expect(codes(free.plan)).toEqual(['DEFAULT_WINDOW']);
  });

  it('projectStart / skipWeekend duoc truyen xuong bo rai lich', () => {
    const cards = (over: Partial<BuildOptions>) =>
      build('Việc một. Việc hai.', over).plan.lists[0]!.cards.map((c) => `${c.startDate}..${c.dueDate}`);
    expect(cards({ projectStart: '2026-10-05', projectEnd: '2026-10-09' })).toEqual(['2026-10-05..2026-10-07', '2026-10-08..2026-10-09']);
    // tinh ca T7/CN: cua so 2026-09-19 (T7) .. 2026-09-20 (CN)
    expect(cards({ projectStart: '2026-09-19', projectEnd: '2026-09-20', skipWeekend: false })).toEqual(['2026-09-19..2026-09-19', '2026-09-20..2026-09-20']);
  });

  it('cung 1 ma canh bao tren hon 10 the -> gop thanh 1 canh bao co so luong; tu 10 tro xuong giu tung the', () => {
    const doc = (n: number) => bullets(n, (i) => `Viec ${i} han 20/10`);
    const ten = build(doc(10)).plan;
    expect(ten.warnings.filter((w) => w.code === 'YEAR_INFERRED')).toHaveLength(10);
    const eleven = build(doc(11)).plan;
    const agg = eleven.warnings.filter((w) => w.code === 'YEAR_INFERRED');
    expect(agg).toHaveLength(1);
    expect(agg[0]!.message).toMatch(/^11 thẻ: /);
    expect(agg[0]!.ref).toBe('c1');
  });
});

// ===================== Gioi han + dinh dang =====================

describe('buildPlan: gioi han so luong va do dai', () => {
  it('FREEFORM toi da 25 the, STRUCTURED toi da 200, toi da 8 / 20 danh sach - cat kem canh bao dau tien va dem the bi cat', () => {
    const sentences = Array.from({ length: 30 }, (_, i) => `Việc số ${i + 1} cần làm xong.`).join(' ');
    const free = build(sentences);
    expect(free.plan.mode).toBe('FREEFORM');
    expect(free.plan.lists[0]!.cards).toHaveLength(25);
    expect(free.plan.lists[0]!.cards[24]!.title).toBe('Việc số 25 cần làm xong');
    expect(free.stats).toMatchObject({ totalCards: 25, truncatedCards: 5 });
    expect(free.plan.warnings[0]!.code).toBe('INPUT_TRUNCATED');
    expect(free.plan.warnings[0]!.message).toMatch(/25 thẻ.*bỏ 5 thẻ/);

    const big = build(bullets(250));
    expect(big.plan.mode).toBe('STRUCTURED');
    expect(big.stats).toMatchObject({ totalCards: 200, truncatedCards: 50 });
    expect(boardPlanSchema.safeParse(big.plan).success).toBe(true);

    // 12 muc moi muc 1 viec, ep FREEFORM (toi da 8 danh sach) -> 4 danh sach/4 the bi cat
    const twelve = Array.from({ length: 12 }, (_, i) => `## Muc ${i + 1}\n- Viec ${i + 1}`).join('\n');
    const cappedLists = build(twelve, { mode: 'FREEFORM' });
    expect(cappedLists.plan.lists).toHaveLength(8);
    expect(cappedLists.stats).toMatchObject({ totalCards: 8, truncatedCards: 4 });
    const okLists = build(twelve); // STRUCTURED cho phep 20 danh sach
    expect(okLists.plan.lists).toHaveLength(12);
  });

  it('tieu de the > 500 ky tu duoc cat; ten danh sach / ten bang > 100 ky tu duoc cat; ke hoach van hop le', () => {
    const { plan } = build(`# ${'B'.repeat(150)}\n## ${'L'.repeat(150)}\n- ${'a'.repeat(600)}\n- b\n- c`);
    expect(plan.board.name).toHaveLength(100);
    expect(plan.lists[0]!.name).toHaveLength(100);
    expect(plan.lists[0]!.cards[0]!.title).toHaveLength(500);
    expect(boardPlanSchema.safeParse(plan).success).toBe(true);
  });

  // CODE_REVIEW.md #11: emoji dung ngay bien 500 ky tu truoc day bi cat DOI (nua
  // surrogate le) - Zod van nhan nhung Postgres tu choi luu JSONB (500 cho ca request).
  it('tieu de the co emoji dung tai bien 500 ky tu: bo ca emoji, KHONG cat doi thanh surrogate le', () => {
    const { plan } = build(`- ${'x'.repeat(499)}😀`);
    const title = plan.lists[0]!.cards[0]!.title;
    expect(title).toBe('x'.repeat(499));
    expect(title.length).toBeLessThanOrEqual(500);
    // Khong con surrogate mo coi (nua dau khong co nua sau di kem, hoac nguoc lai)
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(loneSurrogate.test(title)).toBe(false);
    expect(boardPlanSchema.safeParse(plan).success).toBe(true);
  });
});

// ===================== Fuzz: 500 van ban ngau nhien =====================

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('buildPlan: 500 van ban sinh ngau nhien (hat giong co dinh) luon cho ke hoach hop le', () => {
  it('khong bao gio nem loi; luon qua boardPlanSchema; ref c1..cn; sourceLine hop le; dung gioi han; tat dinh; STRUCTURED khong rai lich khi khong co projectEnd', () => {
    const rnd = makeRng(20260919);
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
    const pick = <T,>(xs: readonly T[]) => xs[int(0, xs.length - 1)]!;
    const words = ['Viết', 'báo cáo', 'Nguyễn Minh Anh', 'Thành viên', 'nhân sự', 'tham dự', 'họp', 'nhóm', '😀', 'x'.repeat(30), 'café', 'Ǆ', 'đề cương', 'Chốt', 'thiết kế'];
    const dates = ['20/10', 'hạn 15/11', 'từ 15/11 đến 1/11', 'thứ 6 tuần này', 'cuối tháng sau', 'trong 2 tuần', '31/02', 'ngày mai', '2026-12-05', '24/7', 'https://x.com/12/11', 'cuối năm', ''];
    const phrase = () => Array.from({ length: int(1, 8) }, () => pick(words)).join(' ') + ' ' + pick(dates);
    const line = () => {
      const t = rnd();
      if (t < 0.15) return `${'#'.repeat(int(1, 4))} ${phrase()}`;
      if (t < 0.5) return `${' '.repeat(int(0, 3) * 2)}${pick(['-', '*', '•', '1.', '2)', '+'])} ${phrase()}`;
      if (t < 0.75) return `${phrase()}.`;
      if (t < 0.82) return '';
      if (t < 0.87) return pick(['---', '***', '-', '...']);
      if (t < 0.9) return '-'.repeat(int(1, 3)) + ' ' + 'z'.repeat(int(200, 700));
      return `**${phrase()}**`;
    };

    const violations: string[] = [];
    let built = 0;
    for (let iter = 0; iter < 500; iter += 1) {
      const text = Array.from({ length: int(1, 45) }, line).join(pick(['\n', '\r\n']));
      const findings = analyzeText(text, TODAY);
      if (findings.lines.length === 0) continue;
      const frozen = deepFreeze(findings);
      for (const mode of [findings.mode, 'STRUCTURED', 'FREEFORM'] as const) {
        const start = rnd() < 0.3 ? '2026-09-20' : null;
        const end = rnd() < 0.4 ? '2026-11-30' : null;
        const opts: BuildOptions = { mode, today: TODAY, projectStart: start, projectEnd: end, skipWeekend: rnd() < 0.7 };
        const tag = `#${iter} mode=${mode} end=${end} skip=${opts.skipWeekend}`;
        const bad = (m: string) => violations.push(`${tag}: ${m} :: ${JSON.stringify(text.slice(0, 80))}`);
        try {
          const r = buildPlan(frozen, opts);
          built += 1;
          if (JSON.stringify(r) !== JSON.stringify(buildPlan(frozen, opts))) bad('khong tat dinh');
          const parsedOk = boardPlanSchema.safeParse(r.plan);
          if (!parsedOk.success) {
            bad(`khong qua schema: ${JSON.stringify(parsedOk.error.issues.slice(0, 2))}`);
            continue;
          }
          const cards = r.plan.lists.flatMap((l) => l.cards);
          const limits = limitsForMode(mode);
          if (r.plan.mode !== mode) bad('sai che do');
          if (cards.length > limits.maxTotalCards) bad('vuot gioi han the');
          if (r.plan.lists.length > limits.maxLists) bad('vuot gioi han danh sach');
          if (r.plan.warnings.length > 50) bad('qua 50 canh bao');
          cards.forEach((c, i) => {
            if (c.ref !== `c${i + 1}`) bad(`ref ${c.ref} != c${i + 1}`);
            if (c.sourceLine === null || c.sourceLine < 1 || c.sourceLine > findings.lines.length) bad(`sourceLine ${c.sourceLine} ngoai 1..${findings.lines.length}`);
            if (c.title.trim() === '') bad('tieu de rong');
            if (!c.selected && (c.startOrigin === 'SCHEDULED' || c.dueOrigin === 'SCHEDULED')) bad('the bo tick bi rai lich');
          });
          if (r.stats.totalCards !== cards.length) bad('stats.totalCards sai');
          if (r.stats.selectedCards !== cards.filter((c) => c.selected).length) bad('stats.selectedCards sai');
          if (mode === 'STRUCTURED' && end === null && r.stats.scheduledCards !== 0) bad('STRUCTURED bia ngay khi khong co projectEnd');
        } catch (e) {
          bad(`nem loi: ${(e as Error).message}`);
        }
      }
    }
    expect(violations).toEqual([]);
    expect(built).toBeGreaterThan(1200); // du van ban dau vao co noi dung de phep thu co nghia
  });
});

// ===================== Ky luat ma nguon =====================

describe('ky luat ma nguon cua ai.build.ts va ai.schema.ts', () => {
  const ROOT = path.resolve(__dirname, '../src/modules/ai');
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  for (const file of ['ai.build.ts', 'ai.schema.ts']) {
    it(`${file}: khong ghep chuoi vao regex, khong regex "khop moi ky tu", khong dung gio dia phuong, khong doc dong ho`, () => {
      const src = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
      expect(src).not.toMatch(/\bRegExp\s*\(/);
      expect(src).not.toContain('.*');
      expect(src).not.toContain('.+');
      expect(src).not.toMatch(/\.(get|set)(Date|Day|Month|FullYear|Hours|Minutes|Seconds|Milliseconds|TimezoneOffset)\s*\(/);
      expect(src).not.toMatch(/toLocale\w*String/);
      expect(src).not.toMatch(/Date\.now\s*\(/);
      expect(src).not.toMatch(/new\s+Date\s*\(/);
    });
  }
});
