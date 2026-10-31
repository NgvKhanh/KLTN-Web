import { describe, expect, it } from 'vitest';
import { addDays, isValidIso, isWeekend } from '../src/modules/ai/ai.dates';
import {
  countDays,
  nthDay,
  scheduleCards,
  type ScheduleInput,
  type ScheduleOptions,
  type ScheduleResult,
} from '../src/modules/ai/ai.schedule';

// Buoc 3 (AI_MODULE.md §5.2): bo rai lich tat dinh. Moi gia tri mong doi duoc LAY tu
// lan chay that (script tham do) roi doi chieu bang mat truoc khi viet vao day.
//
// Hom nay co dinh = 2026-09-14 (THU HAI). Chay them nhieu mui gio (xem dau file
// ai.rules.test.ts - luu y Windows bo qua ten IANA):
//   TZ=UTC npx vitest run test/ai.schedule.test.ts
//   TZ=PST8PDT npx vitest run test/ai.schedule.test.ts
//
// test/setup.ts TRUNCATE DB truoc MOI `it` (~0.4 giay) nen cac ca duoc gop thanh bang.

const TODAY = '2026-09-14';

const blank = (): ScheduleInput => ({ startDate: null, dueDate: null, startOffsetDays: null, durationDays: null });
const hint = (startOffsetDays: number | null, durationDays: number | null): ScheduleInput => ({
  ...blank(),
  startOffsetDays,
  durationDays,
});

/** "2026-09-14..2026-09-17 SS": bat dau..han + nguon (S=SCHEDULED, E=EXPLICIT, N=NONE). */
function fmt(r: ScheduleResult): string[] {
  return r.cards.map((c) => `${c.startDate ?? '-'}..${c.dueDate ?? '-'} ${c.startOrigin[0]}${c.dueOrigin[0]}`);
}
const warns = (r: ScheduleResult) => r.warnings.map((w) => (w.index === undefined ? w.code : `${w.code}#${w.index}`));
const run = (cards: ScheduleInput[], opts: Partial<ScheduleOptions> = {}) =>
  scheduleCards(cards, { today: TODAY, ...opts });

type Row = { name: string; cards: ScheduleInput[]; opts?: Partial<ScheduleOptions>; dates: string[]; warnings: string[] };

/** Doi chieu ca bang, in ra TAT CA dong sai cung luc. */
function checkRows(rows: Row[]): void {
  const wrong = rows
    .map((row) => {
      const r = run(row.cards, row.opts);
      return { name: row.name, dates: fmt(r), warnings: warns(r), want: { dates: row.dates, warnings: row.warnings } };
    })
    .filter((x) => JSON.stringify([x.dates, x.warnings]) !== JSON.stringify([x.want.dates, x.want.warnings]));
  expect(wrong).toEqual([]);
}

describe('ai.schedule: rai deu the chua co ngay', () => {
  it('5 the, khong dat ngay ket thuc: cua so mac dinh 28 ngay + canh bao (bo T7/CN va tinh ca T7/CN)', () => {
    const five = [blank(), blank(), blank(), blank(), blank()];
    checkRows([
      {
        name: 'bo T7/CN: 20 ngay lam viec, moi the 4 ngay, lien tiep, the cuoi ket thuc dung ngay lam viec cuoi',
        cards: five,
        dates: [
          '2026-09-14..2026-09-17 SS',
          '2026-09-18..2026-09-23 SS',
          '2026-09-24..2026-09-29 SS',
          '2026-09-30..2026-10-05 SS',
          '2026-10-06..2026-10-09 SS',
        ],
        warnings: ['DEFAULT_WINDOW'],
      },
      {
        name: 'tinh ca T7/CN: 28 ngay lich',
        cards: five,
        opts: { skipWeekend: false },
        dates: [
          '2026-09-14..2026-09-19 SS',
          '2026-09-20..2026-09-25 SS',
          '2026-09-26..2026-09-30 SS',
          '2026-10-01..2026-10-06 SS',
          '2026-10-07..2026-10-11 SS',
        ],
        warnings: ['DEFAULT_WINDOW'],
      },
    ]);

    const r = run(five);
    expect(r.window).toEqual({
      start: '2026-09-14',
      end: '2026-10-11',
      dayCount: 20,
      skipWeekend: true,
      defaultEnd: true,
    });
  });

  it('co ngay ket thuc do nguoi dung dat -> KHONG co canh bao cua so mac dinh', () => {
    checkRows([
      {
        name: '4 the trong 10 ngay lam viec',
        cards: [blank(), blank(), blank(), blank()],
        opts: { end: '2026-09-25' },
        dates: ['2026-09-14..2026-09-16 SS', '2026-09-17..2026-09-18 SS', '2026-09-21..2026-09-23 SS', '2026-09-24..2026-09-25 SS'],
        warnings: [],
      },
      {
        name: '1 the duy nhat phu het cua so',
        cards: [blank()],
        opts: { end: '2026-09-30' },
        dates: ['2026-09-14..2026-09-30 SS'],
        warnings: [],
      },
      {
        name: 'nhieu the hon so ngay (5 the / 3 ngay): the cung ngay, khong bao gio ngay bat dau sau han',
        cards: [blank(), blank(), blank(), blank(), blank()],
        opts: { start: '2026-09-14', end: '2026-09-16' },
        dates: [
          '2026-09-14..2026-09-14 SS',
          '2026-09-15..2026-09-15 SS',
          '2026-09-15..2026-09-15 SS',
          '2026-09-16..2026-09-16 SS',
          '2026-09-16..2026-09-16 SS',
        ],
        warnings: [],
      },
      {
        name: 'mang rong: khong co gi de canh bao',
        cards: [],
        dates: [],
        warnings: [],
      },
    ]);
  });

  it('spreadUndated = false: the khong co ngay va khong co goi y giu nguyen NONE, khong canh bao cua so', () => {
    checkRows([
      {
        name: 'tat rai',
        cards: [blank(), { ...blank(), dueDate: '2026-10-01' }, hint(0, 1)],
        opts: { spreadUndated: false },
        dates: ['-..- NN', '-..2026-10-01 NE', '2026-09-14..2026-09-14 SS'],
        warnings: [],
      },
    ]);
  });
});

describe('ai.schedule: ngay EXPLICIT duoc giu nguyen tuyet doi', () => {
  it('han roi vao T7, chi co ngay bat dau, ca hai ngay - va khong bia not ngay con lai', () => {
    checkRows([
      {
        name: 'EXPLICIT + the chua co ngay',
        cards: [
          { ...blank(), dueDate: '2026-09-19' }, // Thu Bay
          { ...blank(), startDate: '2026-11-01' }, // Chu nhat, chi co bat dau
          { ...blank(), startDate: '2026-11-01', dueDate: '2026-11-15' },
          blank(),
        ],
        dates: ['-..2026-09-19 NE', '2026-11-01..- EN', '2026-11-01..2026-11-15 EE', '2026-09-14..2026-10-09 SS'],
        warnings: ['DEFAULT_WINDOW'],
      },
      {
        name: 'EXPLICIT thang goi y cua LLM tren cung 1 the',
        cards: [{ startDate: null, dueDate: '2026-10-20', startOffsetDays: 0, durationDays: 2 }],
        dates: ['-..2026-10-20 NE'],
        warnings: [],
      },
      {
        name: 'EXPLICIT nam ngoai cua so van giu nguyen, khong bi ke',
        cards: [{ ...blank(), dueDate: '2027-03-01' }],
        opts: { end: '2026-09-25' },
        dates: ['-..2027-03-01 NE'],
        warnings: [],
      },
    ]);
  });
});

describe('ai.schedule: goi y cua LLM (offset / do dai) doi thanh ngay that', () => {
  it('dem NGAY LAM VIEC khi skipWeekend, ngay lich khi tat (6 ca)', () => {
    checkRows([
      {
        name: 'skip: offset 0 dai 3; offset 5 dai 2 (= thu Hai tuan sau); chi co do dai; chi co offset',
        cards: [hint(0, 3), hint(5, 2), hint(null, 4), hint(3, null)],
        dates: [
          '2026-09-14..2026-09-16 SS',
          '2026-09-21..2026-09-22 SS',
          '2026-09-14..2026-09-17 SS',
          '2026-09-17..2026-09-17 SS',
        ],
        warnings: [], // khong the nao can rai -> khong canh bao cua so mac dinh
      },
      {
        name: 'tat skipWeekend: dem ngay lich, offset 5 = Thu Bay',
        cards: [hint(0, 3), hint(5, 2)],
        opts: { skipWeekend: false },
        dates: ['2026-09-14..2026-09-16 SS', '2026-09-19..2026-09-20 SS'],
        warnings: [],
      },
    ]);
  });

  it('vuot ngay ket thuc do NGUOI DUNG dat -> ke lai + canh bao co chi so the; khong co end thi KHONG ke', () => {
    checkRows([
      {
        name: 'end 2026-09-25 (10 ngay lam viec)',
        cards: [hint(8, 5), hint(20, 2), hint(1, 2)],
        opts: { end: '2026-09-25' },
        dates: ['2026-09-24..2026-09-25 SS', '2026-09-25..2026-09-25 SS', '2026-09-15..2026-09-16 SS'],
        warnings: ['OFFSET_CLAMPED#0', 'OFFSET_CLAMPED#1'],
      },
      {
        name: 'khong co end: cua so 28 ngay do ta tu chon khong duoc cat ngan ke hoach dai cua LLM',
        cards: [hint(60, 10)],
        dates: ['2026-12-07..2026-12-18 SS'],
        warnings: [],
      },
    ]);
  });
});

describe('ai.schedule: cua so bat thuong', () => {
  it('cua so chi co T7/CN, start roi T7, ngay ket thuc o qua khu / truoc ngay bat dau, hom nay la T7 (5 ca)', () => {
    checkRows([
      {
        name: 'cua so chi T7-CN: lui ve dem ngay lich + canh bao',
        cards: [blank(), blank(), blank()],
        opts: { start: '2026-09-19', end: '2026-09-20' },
        dates: ['2026-09-19..2026-09-19 SS', '2026-09-20..2026-09-20 SS', '2026-09-20..2026-09-20 SS'],
        warnings: ['WINDOW_TOO_SHORT'],
      },
      {
        name: 'start la T7 -> doi sang thu Hai',
        cards: [blank(), blank()],
        opts: { start: '2026-09-19', end: '2026-10-02' },
        dates: ['2026-09-21..2026-09-25 SS', '2026-09-28..2026-10-02 SS'],
        warnings: [],
      },
      {
        name: 'ngay ket thuc o qua khu (2026-09-10): van xep, dua vao ngay bat dau, khong tu sua y nguoi dung',
        cards: [blank(), blank()],
        opts: { end: '2026-09-10' },
        dates: ['2026-09-14..2026-09-14 SS', '2026-09-14..2026-09-14 SS'],
        warnings: ['DEADLINE_IN_PAST'],
      },
      {
        name: 'ngay ket thuc chua qua nhung som hon ngay bat dau',
        cards: [blank()],
        opts: { start: '2026-10-01', end: '2026-09-20' },
        dates: ['2026-10-01..2026-10-01 SS'],
        warnings: ['WINDOW_TOO_SHORT'],
      },
      {
        name: 'hom nay la T7, khong dat start: bat dau tu thu Hai tuan sau',
        cards: [blank(), blank()],
        opts: { today: '2026-09-19' },
        dates: ['2026-09-21..2026-10-02 SS', '2026-10-05..2026-10-16 SS'],
        warnings: ['DEFAULT_WINDOW'],
      },
    ]);
  });

  it('dau vao khong hop le -> nem loi ro rang thay vi doan', () => {
    for (const opts of [{ today: '2026-02-30' }, { today: '14/09/2026' }, { start: 'abc' }, { end: '2026-13-01' }]) {
      expect(() => scheduleCards([blank()], { today: TODAY, ...opts })).toThrow(/YYYY-MM-DD/);
    }
  });
});

describe('ai.schedule: dem ngay dung tuyet doi', () => {
  it('countDays va nthDay khop voi cach dem "ngu" bang vong lap tren moi thu bat dau, do dai 0..45, n 0..60', () => {
    const wrong: string[] = [];
    for (const from of ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20']) {
      for (let len = 0; len <= 45; len += 1) {
        const to = addDays(from, len);
        for (const skip of [true, false]) {
          let ref = 0;
          for (let k = 0; k <= len; k += 1) if (!skip || !isWeekend(addDays(from, k))) ref += 1;
          if (countDays(from, to, skip) !== ref) wrong.push(`countDays ${from}..${to} skip=${skip}`);
        }
      }
      if (isWeekend(from)) continue; // nthDay doi hoi ngay bat dau la ngay lam viec
      for (let n = 0; n <= 60; n += 1) {
        let d = from;
        for (let left = n; left > 0; ) {
          d = addDays(d, 1);
          if (!isWeekend(d)) left -= 1;
        }
        if (nthDay(from, n, true) !== d) wrong.push(`nthDay ${from} n=${n}`);
        if (nthDay(from, n, false) !== addDays(from, n)) wrong.push(`nthDay(calendar) ${from} n=${n}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(countDays('2026-09-20', '2026-09-14', true)).toBe(0); // dao nguoc
  });
});

// ===================== Tinh chat (property) tren 300 dau vao sinh co dinh =====================

function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('ai.schedule: cac tinh chat luon dung tren 300 dau vao sinh ngau nhien (hat giong co dinh)', () => {
  it('dai, hop le, giu EXPLICIT, T7/CN, thu tu, nam trong cua so, tat dinh, khong sua dau vao, canh bao dung dieu kien', () => {
    const rnd = makeRng(20260914);
    const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
    const pick = <T,>(xs: readonly T[]) => xs[int(0, xs.length - 1)]!;
    const violations: string[] = [];

    for (let iter = 0; iter < 300; iter += 1) {
      const today = pick(['2026-09-14', '2026-09-18', '2026-09-19', '2026-09-20', '2026-12-29', '2028-02-25']);
      const start = rnd() < 0.4 ? addDays(today, int(-3, 10)) : null;
      const end = rnd() < 0.5 ? addDays(start ?? today, int(-5, 60)) : null;
      const opts: ScheduleOptions = { today, start, end, skipWeekend: rnd() < 0.7, spreadUndated: rnd() < 0.8 };

      const cards: ScheduleInput[] = Array.from({ length: int(0, 12) }, () => {
        const t = rnd();
        if (t < 0.35) return blank();
        if (t < 0.5) return { ...blank(), dueDate: addDays(today, int(-30, 90)) };
        if (t < 0.6) return { ...blank(), startDate: addDays(today, int(-30, 90)) };
        if (t < 0.7) {
          const a = addDays(today, int(-30, 60));
          return { ...blank(), startDate: a, dueDate: addDays(a, int(0, 30)) };
        }
        return hint(rnd() < 0.8 ? int(0, 40) : null, rnd() < 0.8 ? int(1, 15) : null);
      });
      const frozen = Object.freeze(cards.map((c) => Object.freeze({ ...c })));
      const tag = `#${iter} today=${today} start=${start} end=${end} skip=${opts.skipWeekend} spread=${opts.spreadUndated}`;
      const bad = (msg: string) => violations.push(`${tag}: ${msg}`);

      let r: ScheduleResult;
      try {
        r = scheduleCards(frozen, opts); // dau vao dong bang: ma sua dau vao se nem loi
      } catch (e) {
        bad(`nem loi: ${(e as Error).message}`);
        continue;
      }
      if (JSON.stringify(r) !== JSON.stringify(scheduleCards(frozen, opts))) bad('khong tat dinh');
      if (r.cards.length !== cards.length) bad('sai so luong');

      let lastSpreadDue = '';
      r.cards.forEach((out, i) => {
        const inp = cards[i]!;
        const explicit = inp.startDate !== null || inp.dueDate !== null;
        const hasHint = inp.startOffsetDays !== null || inp.durationDays !== null;
        const spread = !explicit && !hasHint && opts.spreadUndated;

        for (const [d, o, label] of [
          [out.startDate, out.startOrigin, 'start'],
          [out.dueDate, out.dueOrigin, 'due'],
        ] as const) {
          if ((d === null) !== (o === 'NONE')) bad(`card ${i} ${label}: ngay/nguon lech nhau`);
          if (d !== null && !isValidIso(d)) bad(`card ${i} ${label}: ngay khong hop le ${d}`);
          if (o === 'SCHEDULED' && d !== null && r.window.skipWeekend && isWeekend(d)) bad(`card ${i} ${label}: ${d} la T7/CN`);
        }
        if (out.startDate && out.dueDate && out.startOrigin === 'SCHEDULED' && out.startDate > out.dueDate) {
          bad(`card ${i}: bat dau ${out.startDate} sau han ${out.dueDate}`);
        }
        if (explicit) {
          if (out.startDate !== inp.startDate || out.dueDate !== inp.dueDate) bad(`card ${i}: EXPLICIT bi doi`);
          if (out.startOrigin !== (inp.startDate ? 'EXPLICIT' : 'NONE') || out.dueOrigin !== (inp.dueDate ? 'EXPLICIT' : 'NONE')) {
            bad(`card ${i}: nguon EXPLICIT sai`);
          }
        } else if (!hasHint && !spread && (out.startOrigin !== 'NONE' || out.dueOrigin !== 'NONE')) {
          bad(`card ${i}: bia ngay khi spreadUndated=false`);
        }
        if (spread) {
          if (out.startOrigin !== 'SCHEDULED' || out.dueOrigin !== 'SCHEDULED') bad(`card ${i}: the rai khong co ngay`);
          if (out.startDate! < r.window.start || out.dueDate! > r.window.end) bad(`card ${i}: ngoai cua so`);
          if (out.dueDate! < lastSpreadDue) bad(`card ${i}: han lui so voi the rai truoc`);
          lastSpreadDue = out.dueDate!;
        }
      });

      const sp = cards.filter((c) => c.startDate === null && c.dueDate === null && c.startOffsetDays === null && c.durationDays === null);
      const wantDefault = opts.end == null && opts.spreadUndated === true && sp.length > 0;
      if (warns(r).includes('DEFAULT_WINDOW') !== wantDefault) bad('DEFAULT_WINDOW sai dieu kien');
      if (r.warnings.some((w) => w.code === 'OFFSET_CLAMPED') && opts.end == null) bad('OFFSET_CLAMPED khi khong co end');
      if (r.warnings.some((w) => w.code === 'DEADLINE_IN_PAST') && !(opts.end != null && opts.end < today)) bad('DEADLINE_IN_PAST sai dieu kien');
    }
    expect(violations).toEqual([]);
  });
});
