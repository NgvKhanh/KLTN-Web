import { describe, expect, it } from 'vitest';
import type { BoardPlan, PlanCard } from '../types/ai';
import {
  countCards,
  countSelected,
  formatViDate,
  isValidDay,
  planEdited,
  setBoardColor,
  setBoardName,
  setCardDate,
  setCardSelected,
  setCardTitle,
  setListName,
  setListSelected,
  validatePlan,
  warningsForCard,
} from './aiPlan';

// Logic THUAN sua ke hoach AI o man xem truoc. Ham nao cung phai tra ban sao (khong sua dau vao):
// dau vao duoc deepFreeze nen bat ky lan ghi nao cung nem loi.

function deepFreeze<T>(v: T): T {
  if (typeof v === 'object' && v !== null) {
    for (const x of Object.values(v)) deepFreeze(x);
    Object.freeze(v);
  }
  return v;
}

function card(ref: string, over: Partial<PlanCard> = {}): PlanCard {
  return {
    ref,
    title: `Việc ${ref}`,
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
  };
}

function makePlan(): BoardPlan {
  return deepFreeze({
    mode: 'STRUCTURED',
    board: { name: 'Bảng thử', color: '#519839' },
    labels: [],
    lists: [
      {
        name: 'Chuẩn bị',
        cards: [
          card('c1', { dueDate: '2026-10-20', dueOrigin: 'EXPLICIT' }),
          card('c2', { startDate: '2026-09-14', startOrigin: 'SCHEDULED', dueDate: '2026-09-16', dueOrigin: 'SCHEDULED' }),
        ],
      },
      { name: 'Triển khai', cards: [card('c3', { selected: false }), card('c4')] },
    ],
    warnings: [
      { code: 'LLM_UNAVAILABLE', message: 'Chưa dùng AI.' },
      { code: 'YEAR_INFERRED', message: 'Đã đoán năm.', ref: 'c1' },
      { code: 'FUZZY_DATE', message: 'Mốc mơ hồ.', ref: 'c1' },
      { code: 'YEAR_INFERRED', message: 'Đã đoán năm.', ref: 'c4' },
    ],
    assumptions: [],
  });
}

const find = (plan: BoardPlan, ref: string) => plan.lists.flatMap((l) => l.cards).find((c) => c.ref === ref)!;

describe('các hàm sửa kế hoạch: bản sao mới, không sửa đầu vào', () => {
  it('tên/màu bảng, tên danh sách, tick, tiêu đề: đúng giá trị, đúng chỗ, thẻ khác giữ NGUYÊN tham chiếu; ref/chỉ số lạ trả nguyên kế hoạch', () => {
    const plan = makePlan();

    const named = setBoardName(plan, 'Tên mới');
    expect(named.board).toEqual({ name: 'Tên mới', color: '#519839' });
    expect(named.lists).toBe(plan.lists); // không đụng tới danh sách

    expect(setBoardColor(plan, '#0079BF').board.color).toBe('#0079BF');

    const renamed = setListName(plan, 1, 'Đổi tên');
    expect(renamed.lists.map((l) => l.name)).toEqual(['Chuẩn bị', 'Đổi tên']);
    expect(renamed.lists[0]).toBe(plan.lists[0]);
    expect(setListName(plan, 9, 'x')).toBe(plan);
    expect(setListName(plan, -1, 'x')).toBe(plan);

    const unticked = setCardSelected(plan, 'c1', false);
    expect(find(unticked, 'c1').selected).toBe(false);
    expect(find(unticked, 'c2')).toBe(find(plan, 'c2')); // thẻ khác: cùng tham chiếu
    expect(unticked.lists[1]).toBe(plan.lists[1]); // danh sách khác: cùng tham chiếu
    expect(setCardSelected(plan, 'c1', true)).toBe(plan); // đã tick sẵn: không đổi gì
    expect(setCardSelected(plan, 'khong-co', false)).toBe(plan);

    const titled = setCardTitle(plan, 'c4', 'Tiêu đề khác');
    expect(find(titled, 'c4').title).toBe('Tiêu đề khác');
    expect(setCardTitle(plan, 'c4', 'Việc c4')).toBe(plan); // cùng giá trị
    expect(setCardTitle(plan, 'khong-co', 'x')).toBe(plan);

    // các trường KHÔNG được động tới
    expect({ ...find(titled, 'c4'), title: '' }).toEqual({ ...find(plan, 'c4'), title: '' });
    expect(titled.warnings).toBe(plan.warnings);
  });

  it('chọn/bỏ chọn cả danh sách; đếm thẻ và thẻ đã chọn', () => {
    const plan = makePlan();
    expect([countCards(plan), countSelected(plan)]).toEqual([4, 3]);

    const none = setListSelected(plan, 0, false);
    expect(none.lists[0]!.cards.map((c) => c.selected)).toEqual([false, false]);
    expect(none.lists[1]).toBe(plan.lists[1]);
    expect(countSelected(none)).toBe(1);

    const all = setListSelected(plan, 1, true);
    expect(all.lists[1]!.cards.map((c) => c.selected)).toEqual([true, true]);
    expect(all.lists[1]!.cards[1]).toBe(plan.lists[1]!.cards[1]); // thẻ đã tick sẵn giữ nguyên
    expect(countSelected(all)).toBe(4);
    expect(setListSelected(plan, 5, true)).toBe(plan);
  });
});

describe('setCardDate: ngày <-> nguồn luôn nhất quán (server kiểm chéo hai chiều)', () => {
  it('đặt ngày = ghi rõ; đổi ngày tự xếp = ghi rõ; nhập lại ĐÚNG ngày cũ giữ nguồn cũ; xoá = không có; hai ngày độc lập', () => {
    const plan = makePlan();

    // thẻ chưa có ngày -> có ngày: nguồn phải là EXPLICIT (không được để NONE)
    const set = setCardDate(plan, 'c4', 'dueDate', '2026-12-01');
    expect(find(set, 'c4')).toMatchObject({ dueDate: '2026-12-01', dueOrigin: 'EXPLICIT', startDate: null, startOrigin: 'NONE' });

    // ngày do bộ rải lịch xếp -> người dùng đổi: thành ghi rõ
    const changed = setCardDate(plan, 'c2', 'startDate', '2026-09-15');
    expect(find(changed, 'c2')).toMatchObject({ startDate: '2026-09-15', startOrigin: 'EXPLICIT', dueDate: '2026-09-16', dueOrigin: 'SCHEDULED' });

    // nhập lại đúng ngày đang có: không đổi gì, KHÔNG biến "tự xếp" thành "ghi rõ"
    expect(setCardDate(plan, 'c2', 'startDate', '2026-09-14')).toBe(plan);
    expect(find(plan, 'c2').startOrigin).toBe('SCHEDULED');

    // xoá ngày: null + NONE (cả khi có khoảng trắng)
    const cleared = setCardDate(plan, 'c2', 'dueDate', '');
    expect(find(cleared, 'c2')).toMatchObject({ dueDate: null, dueOrigin: 'NONE', startDate: '2026-09-14', startOrigin: 'SCHEDULED' });
    expect(find(setCardDate(plan, 'c1', 'dueDate', '   '), 'c1')).toMatchObject({ dueDate: null, dueOrigin: 'NONE' });
    // xoá ngày vốn đã trống: không đổi
    expect(setCardDate(plan, 'c4', 'dueDate', '')).toBe(plan);
    expect(setCardDate(plan, 'khong-co', 'dueDate', '2026-01-01')).toBe(plan);
  });

  it('tính chất: 500 thao tác ngẫu nhiên (hạt giống cố định) - đầu vào không bị sửa, ngày <-> nguồn luôn nhất quán, thẻ không đụng tới giữ nguyên tham chiếu', () => {
    let seed = 20260919;
    const rnd = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % n;
    };
    const refs = ['c1', 'c2', 'c3', 'c4', 'khong-co'];
    const dates = ['', '   ', '2026-10-20', '2026-09-14', '2027-01-01', '2026-09-16'];
    let plan = makePlan();
    const bad: string[] = [];
    for (let i = 0; i < 500; i += 1) {
      const ref = refs[rnd(refs.length)]!;
      const before = plan;
      const snapshot = JSON.stringify(before);
      const op = rnd(4);
      const next =
        op === 0
          ? setCardDate(before, ref, 'startDate', dates[rnd(dates.length)]!)
          : op === 1
            ? setCardDate(before, ref, 'dueDate', dates[rnd(dates.length)]!)
            : op === 2
              ? setCardSelected(before, ref, rnd(2) === 0)
              : setCardTitle(before, ref, `T${rnd(5)}`);
      if (JSON.stringify(before) !== snapshot) bad.push(`#${i}: đầu vào bị sửa`);
      for (const c of next.lists.flatMap((l) => l.cards)) {
        if ((c.startDate === null) !== (c.startOrigin === 'NONE')) bad.push(`#${i}: ${c.ref} start ${c.startDate}/${c.startOrigin}`);
        if ((c.dueDate === null) !== (c.dueOrigin === 'NONE')) bad.push(`#${i}: ${c.ref} due ${c.dueDate}/${c.dueOrigin}`);
        if (c.ref !== ref && c !== find(before, c.ref)) bad.push(`#${i}: thẻ ${c.ref} không liên quan bị thay tham chiếu`);
      }
      plan = next;
    }
    expect(bad).toEqual([]);
  });
});

describe('validatePlan: chặn trước những lỗi server chắc chắn từ chối', () => {
  it('kế hoạch hợp lệ -> không có lỗi; thẻ CHƯA TICK và danh sách không còn thẻ nào KHÔNG bị kiểm tra', () => {
    expect(validatePlan(makePlan())).toEqual([]);

    // thẻ bỏ tick có tiêu đề rỗng + ngày bậy: không được tạo nên không cản việc tạo bảng
    const plan = setCardTitle(setCardDate(setCardDate(makePlan(), 'c3', 'startDate', '2026-12-31'), 'c3', 'dueDate', '2026-01-01'), 'c3', '');
    expect(find(plan, 'c3').selected).toBe(false);
    expect(validatePlan(plan)).toEqual([]);

    // danh sách toàn thẻ bỏ tick: tên rỗng cũng không sao (danh sách đó bị bỏ)
    const emptyList = setListName(setCardSelected(setCardSelected(makePlan(), 'c3', false), 'c4', false), 1, '');
    expect(validatePlan(emptyList)).toEqual([]);
  });

  it('từng loại lỗi: tên bảng rỗng, không chọn thẻ nào, tên danh sách rỗng, tiêu đề rỗng, ngày sai (6 kiểu), bắt đầu sau hạn; ngày bằng nhau thì hợp lệ', () => {
    const only = (plan: BoardPlan) => validatePlan(plan).map((i) => `${i.scope}${i.listIndex ?? ''}${i.ref ? `@${i.ref}` : ''}: ${i.message}`);

    expect(only(setBoardName(makePlan(), '   '))).toEqual(['board: Tên bảng không được để trống.']);

    // bỏ tick hết: chỉ 1 lỗi cấp kế hoạch (không kèm lỗi tên danh sách)
    let none = makePlan();
    for (const r of ['c1', 'c2', 'c4']) none = setCardSelected(none, r, false);
    expect(only(none)).toEqual(['plan: Chưa chọn thẻ nào để tạo.']);

    expect(only(setListName(makePlan(), 0, ' '))).toEqual(['list0: Tên danh sách không được để trống.']);
    expect(only(setCardTitle(makePlan(), 'c2', ''))).toEqual(['card0@c2: Tiêu đề thẻ không được để trống.']);
    expect(only(setCardTitle(makePlan(), 'c4', '  '))).toEqual(['card1@c4: Tiêu đề thẻ không được để trống.']);

    const badDates = ['2026-02-30', '1969-12-31', '2101-01-01', 'abc', '2026-1-5', '0000-00-00'];
    const wrong: unknown[] = [];
    for (const d of badDates) {
      const got = only(setCardDate(makePlan(), 'c4', 'dueDate', d));
      if (JSON.stringify(got) !== JSON.stringify(['card1@c4: Ngày hạn chót không hợp lệ (năm 1970–2100).'])) wrong.push({ d, got });
    }
    expect(wrong).toEqual([]);
    expect(only(setCardDate(makePlan(), 'c4', 'startDate', '2026-02-30'))).toEqual(['card1@c4: Ngày bắt đầu không hợp lệ (năm 1970–2100).']);

    // bắt đầu sau hạn: 1 lỗi; bằng nhau: hợp lệ; một ngày sai + một ngày đúng: chỉ báo ngày sai (không thêm lỗi thứ tự)
    const reversed = setCardDate(setCardDate(makePlan(), 'c4', 'startDate', '2026-11-02'), 'c4', 'dueDate', '2026-11-01');
    expect(only(reversed)).toEqual(['card1@c4: Ngày bắt đầu phải trước hạn chót.']);
    const same = setCardDate(setCardDate(makePlan(), 'c4', 'startDate', '2026-11-01'), 'c4', 'dueDate', '2026-11-01');
    expect(only(same)).toEqual([]);
    const mixed = setCardDate(setCardDate(makePlan(), 'c4', 'startDate', '2026-13-01'), 'c4', 'dueDate', '2026-11-01');
    expect(only(mixed)).toEqual(['card1@c4: Ngày bắt đầu không hợp lệ (năm 1970–2100).']);

    // nhiều lỗi cùng lúc đều được báo, đúng thẻ
    const many = setCardTitle(setBoardName(setCardTitle(makePlan(), 'c1', ''), ''), 'c2', '');
    expect(only(many).sort()).toEqual([
      'board: Tên bảng không được để trống.',
      'card0@c1: Tiêu đề thẻ không được để trống.',
      'card0@c2: Tiêu đề thẻ không được để trống.',
    ]);
  });
});

describe('ngày, so sánh, cảnh báo', () => {
  it('isValidDay: ngày lịch THẬT trong 1970-2100 (năm nhuận, cận biên); formatViDate', () => {
    const rows: Array<[string, boolean]> = [
      ['2026-10-20', true],
      ['2028-02-29', true], // nhuận
      ['2026-02-29', false],
      ['2100-02-29', false], // 2100 không nhuận
      ['2100-12-31', true],
      ['2101-01-01', false],
      ['1970-01-01', true],
      ['1969-12-31', false],
      ['2026-00-10', false],
      ['2026-13-01', false],
      ['2026-04-31', false],
      ['2026-4-30', false],
      ['', false],
      ['2026-10-20T00:00', false],
    ];
    const wrong = rows.map(([v, want]) => ({ v, want, got: isValidDay(v) })).filter((r) => r.want !== r.got);
    expect(wrong).toEqual([]);

    expect(formatViDate('2026-10-05')).toBe('05/10/2026');
    expect(formatViDate('khong-phai-ngay')).toBe('khong-phai-ngay');
  });

  it('planEdited so sánh nội dung (không phải tham chiếu); warningsForCard chỉ lấy cảnh báo đúng thẻ', () => {
    const original = makePlan();
    expect(planEdited(original, JSON.parse(JSON.stringify(original)))).toBe(false); // bản sao y hệt
    expect(planEdited(original, setCardSelected(original, 'c1', false))).toBe(true);
    expect(planEdited(original, setBoardName(original, 'Bảng thử'))).toBe(false); // sửa rồi trả lại giá trị cũ

    expect(warningsForCard(original, 'c1').map((w) => w.code)).toEqual(['YEAR_INFERRED', 'FUZZY_DATE']);
    expect(warningsForCard(original, 'c4').map((w) => w.message)).toEqual(['Đã đoán năm.']);
    expect(warningsForCard(original, 'c2')).toEqual([]);
    expect(warningsForCard(original, 'khong-co')).toEqual([]);
  });
});
