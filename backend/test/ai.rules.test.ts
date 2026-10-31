import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  daysInMonth,
  diffDays,
  isValidYmd,
  isWeekend,
  isoWeekday,
  lastDayOfMonth,
  mondayOfWeek,
  parseIso,
} from '../src/modules/ai/ai.dates';
import {
  analyzeText,
  detectMode,
  extractDatesFromLine,
  foldText,
  splitLines,
  summarizeLineDates,
} from '../src/modules/ai/ai.rules';

// Buoc 2 (AI_MODULE.md §11): bo luat doc van ban tieng Viet - thuan ham, khong
// DB, khong mang. Moi gia tri mong doi duoc LAY tu lan chay that (script tham do)
// roi doi chieu bang mat truoc khi viet vao day, khong suy luan tay.
//
// Hom nay co dinh = 2026-09-14 (THU HAI) de ket qua tat dinh. Chay them nhieu mui
// gio de chung minh khong lech ngay (rui ro RR5):
//   TZ=UTC      npx vitest run test/ai.rules.test.ts   (UTC+0)
//   TZ=PST8PDT  npx vitest run test/ai.rules.test.ts   (UTC-7, sau UTC ve phia am)
//   (bo TZ)     npx vitest run test/ai.rules.test.ts   (mui gio he thong: VN = UTC+7)
// CHU Y tren Windows: Node BO QUA ten IANA ("Asia/Ho_Chi_Minh", "America/Los_Angeles")
// va am tham quay ve mui gio he thong -> phai dung "UTC" hoac dang POSIX nhu
// "PST8PDT". Kiem tra TZ co hieu luc that khong bang:
//   TZ=PST8PDT node -e "console.log(new Date(2026,8,14).getTimezoneOffset())"  -> 420
//
// Luu y: test/setup.ts TRUNCATE DB truoc MOI `it` (~0.4 giay) nen cac ca duoc
// gop thanh bang, moi bang la 1 `it`, va so ca duoc bao cao ngay trong ten.

const TODAY = '2026-09-14';

type Row = [input: string, expected: string[]];

/** "2026-10-20 DUE" cho moi ngay tim duoc trong dong. */
function brief(line: string, today = TODAY): string[] {
  return extractDatesFromLine(line, today).map((d) => `${d.date} ${d.role}`);
}

/** Doi chieu ca bang, in ra TAT CA dong sai cung luc thay vi dung o dong dau. */
function checkTable(rows: Row[], today = TODAY): void {
  const wrong = rows
    .map(([input, expected]) => ({ input, expected, actual: brief(input, today) }))
    .filter((r) => JSON.stringify(r.expected) !== JSON.stringify(r.actual));
  expect(wrong).toEqual([]);
}

// ===================== ai.dates.ts =====================

describe('ai.dates: tien ich lich UTC', () => {
  it('cong/tru ngay, qua thang, qua nam, nam nhuan', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30'); // khong bi gio mua he chen vao
    expect(addDays('2026-09-14', 0)).toBe('2026-09-14');
  });

  it('cong thang kep ve ngay cuoi thang khi ngay dich khong ton tai', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-01-15', -2)).toBe('2025-11-15');
  });

  it('thu ISO, dau tuan, cuoi tuan', () => {
    expect(isoWeekday('2026-09-14')).toBe(1); // Thu Hai
    expect(isoWeekday('2026-09-19')).toBe(6);
    expect(isoWeekday('2026-09-20')).toBe(7); // Chu nhat
    expect(mondayOfWeek('2026-09-20')).toBe('2026-09-14');
    expect(mondayOfWeek('2026-09-14')).toBe('2026-09-14');
    expect(isWeekend('2026-09-19')).toBe(true);
    expect(isWeekend('2026-09-18')).toBe(false);
  });

  it('kiem tra ngay that + phan tich chuoi ISO chat che', () => {
    expect(isValidYmd(2026, 2, 29)).toBe(false);
    expect(isValidYmd(2028, 2, 29)).toBe(true);
    expect(isValidYmd(2026, 13, 1)).toBe(false);
    expect(isValidYmd(1969, 1, 1)).toBe(false);
    expect(isValidYmd(2101, 1, 1)).toBe(false);
    expect(parseIso('2026-02-31')).toBeNull();
    expect(parseIso('2026-9-1')).toBeNull();
    expect(parseIso('2026-09-14')).toEqual({ year: 2026, month: 9, day: 14 });
    expect(() => addDays('khong-phai-ngay', 1)).toThrow(/YYYY-MM-DD/);
  });

  it('so ngay trong thang, ngay cuoi thang, khoang cach ngay', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2026, 12)).toBe(31);
    expect(lastDayOfMonth(2026, 11)).toBe('2026-11-30');
    expect(diffDays('2026-09-14', '2026-10-14')).toBe(30);
    expect(diffDays('2026-10-14', '2026-09-14')).toBe(-30);
  });
});

// ===================== ai.rules.ts: ngay thang =====================

describe('ai.rules: trich ngay thang tieng Viet', () => {
  it('ngay tuyet doi (10 ca)', () => {
    checkTable([
      ['Nộp báo cáo trước 20/10', ['2026-10-20 DUE']],
      ['Hội thảo ngày 15/11/2026', ['2026-11-15 DUE']],
      ['Hội thảo 15/11/26', ['2026-11-15 DUE']],
      ['Họp ngày 15 tháng 11', ['2026-11-15 DUE']],
      ['Họp ngày 15 tháng 11 năm 2027', ['2027-11-15 DUE']],
      ['Deadline 2026-12-05', ['2026-12-05 DUE']],
      ['Hạn 15-11-2026', ['2026-11-15 DUE']],
      ['Hạn 15.11.2026', ['2026-11-15 DUE']],
      ['Ngày 15/03 họp lại', ['2027-03-15 DUE']], // thieu nam, da qua -> nam sau
      ['Ngày 29/02 kiểm tra', ['2028-02-29 DUE']], // nam nhuan gan nhat
    ]);
  });

  it('khong phai ngay -> bo qua, khong bao gio ra ngay sai (11 ca)', () => {
    checkTable([
      ['Nộp ngày 31/02', []],
      ['Nộp ngày 15/13', []],
      ['Ngày 31 tháng 4 họp', []],
      ['Cần 5-7 người', []], // khoang so, khong phai 5 thang 7
      ['Trang 10-12', []],
      ['Làm việc 24/7', []], // thanh ngu
      ['Bản 2.5/5 điểm', []],
      ['Tháng 12/2026 ra mắt', []],
      ['Cần chốt trong tháng 11', []], // chi co thang, chua ho tro
      ['Kế hoạch Marketing Q4/2026', []],
      ['Không có ngày nào ở đây', []],
    ]);
  });

  it('URL va email chua dau / khong bi doc thanh ngay', () => {
    checkTable([['Xem https://example.com/12/11 và mail a.12/11@x.com', []]]);
    checkTable([['Xem www.abc.vn/5/6/2026 rồi họp 20/10', ['2026-10-20 DUE']]]);
  });

  it('ngay tuong doi so voi hom nay (7 ca)', () => {
    checkTable([
      ['Xong trong 2 tuần', ['2026-09-28 DUE']],
      ['Xong trong vòng 3 ngày', ['2026-09-17 DUE']],
      ['Xong sau 10 ngày', ['2026-09-24 DUE']],
      ['Xong trong hai tuần', ['2026-09-28 DUE']],
      ['Xong 2 tuần nữa', ['2026-09-28 DUE']],
      ['Xong trong 1 tháng', ['2026-10-14 DUE']],
      // "3 thang 2 lan" khong duoc doc thanh ngay 3 thang 2
      ['Hoàn thành trong 3 tháng 2 lần', ['2026-12-14 DUE']],
    ]);
  });

  it('thu trong tuan (9 ca) + hoi quy "thu 6 tuan sau" khong bi doc thanh "6 tuan sau"', () => {
    checkTable([
      ['Họp vào thứ 6 tuần này', ['2026-09-18 DUE']],
      ['Họp thứ 6 tuần sau', ['2026-09-25 DUE']],
      ['Họp thứ 6 tuần tới', ['2026-09-25 DUE']],
      ['Họp thứ 2', ['2026-09-14 DUE']], // hom nay la thu Hai -> tinh la hom nay
      ['Họp thứ 2 tuần trước', ['2026-09-07 DUE']],
      ['Nộp chủ nhật tuần sau', ['2026-09-27 DUE']],
      ['Nộp chủ nhật', ['2026-09-20 DUE']],
      ['Họp thứ tư tuần này', ['2026-09-16 DUE']],
      ['Đây là vấn đề thứ tư cần giải quyết', []], // "thu tu" la so thu tu
      // hoi quy: 2 mau khac nhau tren cung 1 dong
      ['Xong 6 tuần nữa', ['2026-10-26 DUE']],
      ['Họp thứ 6 tuần này, xong 6 tuần nữa', ['2026-09-18 DUE', '2026-10-26 DUE']],
    ]);
  });

  it('hom nay / mai / kia va KHONG doc "Mai" (ten nguoi) thanh ngay mai (10 ca)', () => {
    checkTable([
      ['Gửi bản thảo ngày mai', ['2026-09-15 DUE']],
      ['Gửi bản thảo chiều mai', ['2026-09-15 DUE']],
      ['Gửi bản thảo tối mai', ['2026-09-15 DUE']],
      ['Xong hôm nay', ['2026-09-14 DUE']],
      ['Xong ngày kia', ['2026-09-16 DUE']],
      ['Xong ngày mốt', ['2026-09-16 DUE']],
      ['Ngọc Mai gửi bản thảo', []], // ca hoi quy quan trong nhat cua v1
      ['Mai gửi bản thảo', []],
      ['Tôi mai đi họp', []], // "toi" (I), khong phai "toi" (evening)
      ['Xong ngày một', []], // "mot" khong dau -> khong doan
    ]);
  });

  it('moc mo (10 ca)', () => {
    checkTable([
      ['Xong cuối tháng sau', ['2026-10-31 DUE']],
      ['Xong đầu tuần sau', ['2026-09-21 DUE']],
      ['Xong cuối tuần này', ['2026-09-20 DUE']],
      ['Xong giữa tháng này', ['2026-09-15 DUE']],
      ['Xong cuối tháng 11', ['2026-11-30 DUE']],
      ['Xong đầu tháng 9', ['2027-09-01 DUE']], // thang 9 nam nay da qua 1 ngay -> nam sau
      ['Xong cuối năm', ['2026-12-31 DUE']],
      ['Xong cuối năm sau', ['2027-12-31 DUE']],
      ['Xong trong tuần này', ['2026-09-20 DUE']],
      ['Xong trong tháng sau', ['2026-10-31 DUE']],
    ]);
  });

  it('van ban viet khong dau / viet hoa van doc duoc', () => {
    checkTable([
      ['Xong ngay mai', ['2026-09-15 DUE']],
      ['Han thu 6 tuan nay', ['2026-09-18 DUE']],
      ['Han 20/10 (khong dau)', ['2026-10-20 DUE']],
      ['HẠN 20/10', ['2026-10-20 DUE']],
      ['Nộp TRƯỚC THỨ 6 TUẦN NÀY', ['2026-09-18 DUE']],
    ]);
  });

  it('phu thuoc dung vao "hom nay": thu Sau, Chu nhat, qua nam, cuoi thang', () => {
    // hom nay la thu Sau: "thu 6" = hom nay, "thu 2" = thu Hai tuan sau
    checkTable(
      [
        ['Họp thứ 6', ['2026-09-18 DUE']],
        ['Họp thứ 2', ['2026-09-21 DUE']],
        ['Họp thứ 2 tuần này', ['2026-09-14 DUE']], // co chu "tuan nay" -> tuan hien tai, du da qua
      ],
      '2026-09-18'
    );
    // hom nay la Chu nhat: van thuoc tuan Thu Hai -> Chu nhat
    checkTable(
      [
        ['Họp thứ 6 tuần này', ['2026-09-18 DUE']],
        ['Nộp chủ nhật', ['2026-09-20 DUE']],
        ['Nộp chủ nhật tuần sau', ['2026-09-27 DUE']],
      ],
      '2026-09-20'
    );
    // qua ranh gioi nam
    checkTable(
      [
        ['Xong 5/1', ['2027-01-05 DUE']],
        ['Xong trong 3 ngày', ['2027-01-02 DUE']],
        ['Xong cuối tháng sau', ['2027-01-31 DUE']],
        ['Họp thứ 6 tuần sau', ['2027-01-08 DUE']],
        ['Xong đầu năm sau', ['2027-01-01 DUE']],
      ],
      '2026-12-30'
    );
    // cong thang kep ngay cuoi thang, ke ca sang nam nhuan
    checkTable(
      [
        ['Xong sau 1 tháng', ['2027-02-28 DUE']],
        ['Xong sau 13 tháng', ['2028-02-29 DUE']],
      ],
      '2027-01-31'
    );
  });

  it('vai tro START / DUE tu tu khoa (7 ca)', () => {
    checkTable([
      ['Từ 1/11 đến 15/11', ['2026-11-01 START', '2026-11-15 DUE']],
      ['1/11 - 15/11', ['2026-11-01 START', '2026-11-15 DUE']], // chi cach nhau dau noi
      ['Bắt đầu 1/11, hạn 15/11', ['2026-11-01 START', '2026-11-15 DUE']],
      ['Kickoff 1/11', ['2026-11-01 START']],
      ['Từ 1/11', ['2026-11-01 START']],
      ['Hạn: 15/11', ['2026-11-15 DUE']],
      ['Họp 10/11, nộp 15/11', ['2026-11-10 DUE', '2026-11-15 DUE']],
    ]);
  });

  it('co ghi chu ro: roleExplicit / fuzzy / yearInferred / pattern / vi tri', () => {
    const one = (line: string) => extractDatesFromLine(line, TODAY)[0]!;

    expect(one('Hạn: 15/11').roleExplicit).toBe(true);
    expect(one('Họp ngày 15/11').roleExplicit).toBe(false); // chi la mac dinh DUE

    expect(one('Họp 15/11/2026').yearInferred).toBe(false);
    expect(one('Họp 15/11').yearInferred).toBe(true);

    expect(one('Xong cuối tháng sau')).toMatchObject({ fuzzy: true, pattern: 'FUZZY' });
    expect(one('Xong trong 2 tuần')).toMatchObject({ fuzzy: false, pattern: 'RELATIVE' });
    expect(one('Họp thứ 6 tuần này')).toMatchObject({ pattern: 'WEEKDAY' });
    expect(one('Gửi ngày mai')).toMatchObject({ pattern: 'DAYWORD' });
    expect(one('Deadline 2026-12-05')).toMatchObject({ pattern: 'ISO' });

    // start/end tro dung doan chu; raw la doan chu that
    const d = one('Nộp báo cáo trước 20/10');
    expect(d.raw).toBe('20/10');
    expect('Nộp báo cáo trước 20/10'.slice(d.start, d.end)).toBe('20/10');
  });

  it('summarizeLineDates: bat dau + han chot cua 1 the (6 ca)', () => {
    const sum = (line: string) => {
      const s = summarizeLineDates(extractDatesFromLine(line, TODAY));
      return [s.start?.date ?? null, s.due?.date ?? null];
    };
    expect(sum('Họp 10/11, nộp 15/11')).toEqual([null, '2026-11-15']); // lay han cuoi cung
    expect(sum('Xong cuối tháng 11, hạn 20/11')).toEqual([null, '2026-11-20']); // uu tien ngay chinh xac hon moc mo
    expect(sum('Từ 1/11 đến 15/11')).toEqual(['2026-11-01', '2026-11-15']);
    expect(sum('Chỉ có từ 1/11')).toEqual(['2026-11-01', null]);
    expect(sum('Xong cuối tháng 11')).toEqual([null, '2026-11-30']); // chi co moc mo -> van dung
    expect(sum('Không có ngày')).toEqual([null, null]);
  });

  it('"today" khong hop le -> nem loi ro rang thay vi doan', () => {
    for (const bad of ['2026-02-30', '14/09/2026', '']) {
      expect(() => extractDatesFromLine('x', bad)).toThrow(/YYYY-MM-DD/);
      expect(() => analyzeText('x', bad)).toThrow(/YYYY-MM-DD/);
    }
  });
});

// ===================== ai.rules.ts: tach dong / cau truc =====================

describe('ai.rules: chuan hoa va tach dong', () => {
  const view = (text: string) => splitLines(text).map((l) => `${l.kind}:${l.level}:${l.text}`);

  it('heading, bullet, danh so, checkbox, thut le, in dam (5 kieu)', () => {
    expect(view('# Kế hoạch\n## Việc\n- A\n* B\n• C\n1. D\n2) E')).toEqual([
      'HEADING:1:Kế hoạch',
      'HEADING:2:Việc',
      'BULLET:0:A',
      'BULLET:0:B',
      'BULLET:0:C',
      'BULLET:0:D',
      'BULLET:0:E',
    ]);
    expect(view('**Giai đoạn 1**\n- [ ] Làm slide\n- [x] Đặt phòng\n  - việc con\n    - sâu hơn')).toEqual([
      'HEADING:3:Giai đoạn 1',
      'BULLET:0:Làm slide', // bo o tick
      'BULLET:0:Đặt phòng',
      'BULLET:1:việc con',
      'BULLET:2:sâu hơn',
    ]);
  });

  // CODE_REVIEW.md #12: \d{1,2} truoc day lam muc "100." tro len bi coi la TEXT (STRUCTURED
  // bo qua dong TEXT khi dung ke hoach) - mat cong viec ma khong canh bao rieng nao.
  it('muc danh so 3 chu so (toi 100 tro len) van la BULLET, khong bi coi la TEXT', () => {
    expect(view('99. Việc chín mươi chín\n100. Việc một trăm\n999. Việc chín trăm chín mươi chín')).toEqual([
      'BULLET:0:Việc chín mươi chín',
      'BULLET:0:Việc một trăm',
      'BULLET:0:Việc chín trăm chín mươi chín',
    ]);
  });

  it('danh so bat dau tu 1, bo dong trong va dong chi toan ky hieu', () => {
    const lines = splitLines('Tiêu đề\n\n---\n***\n-\n...\n- Việc A\n\n#hashtag không phải heading\n==========\nKết');
    expect(lines.map((l) => [l.no, l.kind, l.text])).toEqual([
      [1, 'TEXT', 'Tiêu đề'],
      [2, 'BULLET', 'Việc A'],
      [3, 'TEXT', '#hashtag không phải heading'], // thieu khoang trang sau # -> khong phai heading
      [4, 'TEXT', 'Kết'],
    ]);
  });

  it('doan van xuoi tach theo cau; viet tat "TS." va so thap phan khong bi cat', () => {
    expect(view('Tổ chức hội thảo khoa học cấp khoa vào 15/11. Cần chuẩn bị nội dung báo cáo, mời 3 diễn giả. Nhóm có 4 người.')).toEqual([
      'TEXT:0:Tổ chức hội thảo khoa học cấp khoa vào 15/11.',
      'TEXT:0:Cần chuẩn bị nội dung báo cáo, mời 3 diễn giả.',
      'TEXT:0:Nhóm có 4 người.',
    ]);
    expect(view('Mời TS. Nguyễn Văn A phát biểu. Sau đó thảo luận nhóm. Kết thúc lúc 5.5 giờ.')).toEqual([
      'TEXT:0:Mời TS. Nguyễn Văn A phát biểu.',
      'TEXT:0:Sau đó thảo luận nhóm.',
      'TEXT:0:Kết thúc lúc 5.5 giờ.',
    ]);
  });

  it('CRLF, NBSP, ky tu vo hinh, NFD deu duoc chuan hoa (4 ca)', () => {
    expect(view('Dòng 1\r\n\r\n\r\nDòng 2 có\u00A0NBSP\r\nDòng 3').map((s) => s.split(':')[2])).toEqual([
      'Dòng 1',
      'Dòng 2 có NBSP',
      'Dòng 3',
    ]);
    expect(splitLines('Nộp\u200B trước 20/10')[0]!.text).toBe('Nộp trước 20/10');
    // NFD (dau roi) -> NFC: cung ket qua, khong lech vi tri
    const nfd = 'Nộp trước 20/10'.normalize('NFD');
    expect(nfd.length).toBeGreaterThan('Nộp trước 20/10'.length);
    expect(splitLines(nfd)[0]!.text).toBe('Nộp trước 20/10');
    expect(analyzeText(nfd, TODAY).dates.map((d) => d.date)).toEqual(['2026-10-20']);
    // gop nhieu khoang trang; tab -> thut le
    expect(splitLines('Việc   A    rất   dài')[0]!.text).toBe('Việc A rất dài');
    expect(splitLines('- A\n\t- B')[1]).toMatchObject({ kind: 'BULLET', level: 2 });
  });

  it('foldText bo dau nhung GIU NGUYEN DO DAI (de vi tri khop dung tren van ban goc)', () => {
    for (const s of ['Nguyễn Đức Ưu', 'Hạn: 15/11 😀 ok', 'Ǆ İstanbul', 'Thứ Sáu']) {
      expect(foldText(s).length).toBe(s.length);
    }
    expect(foldText('Nguyễn Đức Ưu')).toBe('nguyen duc uu');
    expect(foldText('Thứ Sáu')).toBe('thu sau');
  });
});

describe('ai.rules: che do STRUCTURED / FREEFORM', () => {
  const mode = (text: string) => {
    const d = detectMode(splitLines(text));
    return [d.mode, d.structuredLines, d.contentLines];
  };
  const mk = (kinds: string) =>
    kinds
      .split('')
      .map((k, i) => (k === 'B' ? `- Muc ${i}` : k === 'H' ? `# Tieu de ${i}` : `Van xuoi ${i}.`))
      .join('\n');

  it('ranh gioi: du 3 dong va ty le >= 0.4 (inclusive) moi la STRUCTURED (8 ca)', () => {
    expect(mode(mk('BBB'))).toEqual(['STRUCTURED', 3, 3]);
    expect(mode(mk('BB'))).toEqual(['FREEFORM', 2, 2]); // qua ngan
    expect(mode(mk('BBTTT'))).toEqual(['STRUCTURED', 2, 5]); // dung 0.4
    expect(mode(mk('BTTTT'))).toEqual(['FREEFORM', 1, 5]); // 0.2
    expect(mode(mk('HHB'))).toEqual(['STRUCTURED', 3, 3]);
    expect(mode(mk('TTT'))).toEqual(['FREEFORM', 0, 3]);
    expect(mode(mk('HTBTT'))).toEqual(['STRUCTURED', 2, 5]);
    expect(detectMode([])).toEqual({ mode: 'FREEFORM', structuredRatio: 0, structuredLines: 0, contentLines: 0 });
  });

  it('nguong la tham so: doi nguong -> doi ket qua (de buoc 10 quet 0.2 - 0.6)', () => {
    const lines = splitLines(mk('BTTTT')); // ty le 0.2
    expect(detectMode(lines).mode).toBe('FREEFORM');
    expect(detectMode(lines, { minContentLines: 3, structuredRatio: 0.2 }).mode).toBe('STRUCTURED');
    expect(detectMode(lines, { minContentLines: 6, structuredRatio: 0.2 }).mode).toBe('FREEFORM');
  });

  it('van ban mau: 1 doan van xuoi dai la FREEFORM du co nhieu cau, co tieu de/bullet la STRUCTURED (9 ca)', () => {
    const rows: Array<[string, string]> = [
      ['- A\n- B\n- C\n- D\n- E', 'STRUCTURED'],
      ['1. Viet de cuong\n2. Nop de cuong\n3. Lam slide\n4. Bao ve', 'STRUCTURED'],
      ['# Ke hoach\nMuc tieu la xong som.\n## Viec\n- A\n- B\nGhi chu them.\n- C\nHet.', 'STRUCTURED'], // 0.625
      ['Gioi thieu du an.\nMuc tieu ro rang.\n- A\n- B\nCan than.\nHoi y kien.', 'FREEFORM'], // 0.333
      [
        'Tổ chức hội thảo khoa học cấp khoa vào 15/11. Cần chuẩn bị nội dung báo cáo, mời 3 diễn giả, lo hậu cần phòng ốc và làm truyền thông trước 2 tuần. Nhóm có 4 người.',
        'FREEFORM',
      ],
      [
        'Anh Nam sẽ gửi báo cáo trước thứ 6. Chị Lan chưa có phản hồi về ngân sách. Cả nhóm thống nhất họp lại vào thứ 2 tuần sau.\nCần chốt nhà cung cấp.',
        'FREEFORM',
      ],
      ['Làm khóa luận.\nNộp vào tháng 12.', 'FREEFORM'],
      ['Việc A - làm trước thứ 6. Việc B - làm sau đó. Việc C - cuối tháng. Việc D - tuần sau.', 'FREEFORM'], // gach ngang giua cau khong phai bullet
      ['', 'FREEFORM'],
    ];
    const wrong = rows
      .map(([text, expected]) => ({ text, expected, actual: detectMode(splitLines(text)).mode }))
      .filter((r) => r.expected !== r.actual);
    expect(wrong).toEqual([]);
  });
});

// ===================== analyzeText: ket hop tren van ban that =====================

describe('analyzeText: ke hoach Marketing that', () => {
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

  it('11 dong: cau truc, che do va ngay theo tung dong khop voi doc tay', () => {
    const a = analyzeText(MARKETING, TODAY);

    expect(a.lines.map((l) => `${l.kind[0]}${l.level}`)).toEqual([
      'H1', 'H2', 'B0', 'B0', 'H2', 'B0', 'B0', 'B0', 'H2', 'B0', 'B0',
    ]);
    expect(a).toMatchObject({ mode: 'STRUCTURED', structuredLines: 11, contentLines: 11, structuredRatio: 1 });

    const byLine = new Map<number, string[]>();
    for (const d of a.dates) byLine.set(d.line, [...(byLine.get(d.line) ?? []), `${d.role}=${d.date}`]);
    expect([...byLine.entries()]).toEqual([
      [6, ['DUE=2026-10-20']],
      [7, ['DUE=2026-10-25']],
      [8, ['DUE=2026-09-18']],
      [10, ['START=2026-11-01', 'DUE=2026-11-15']],
      [11, ['DUE=2026-11-30']],
    ]);
    // Dong 1 co "Q4/2026" nhung KHONG duoc coi la ngay; dong 3-4 la ten nguoi
    expect(byLine.has(1)).toBe(false);
    expect(byLine.has(3)).toBe(false);
  });

  it('ket qua khong doi khi doi so dong trong / xuong dong kieu Windows', () => {
    const a = analyzeText(MARKETING, TODAY);
    const b = analyzeText(MARKETING.replace(/\n/g, '\r\n\r\n'), TODAY);
    expect(b.lines.map((l) => l.text)).toEqual(a.lines.map((l) => l.text));
    expect(b.dates.map((d) => [d.line, d.date, d.role])).toEqual(a.dates.map((d) => [d.line, d.date, d.role]));
  });
});

// ===================== Do ben + ky luat ma nguon =====================

describe('do ben va ky luat ma nguon', () => {
  it('dau vao xau dai 32.000 ky tu: xu ly nhanh (khong co regex tang theo binh phuong)', () => {
    // Truoc khi sua, 32.000 ky tu mat ~0.5 giay (email "[...]+@" khong gioi han va
    // /\s+$/). Nay ~10ms. Nguong 250ms de du du cho may cham nhung van bat duoc loi.
    const evil = [
      'a'.repeat(32000),
      '1'.repeat(32000),
      // khoang trang DUNG TRUOC 1 ky tu khac (moi vi tri deu quet den cuoi roi that bai)
      `${' '.repeat(32000)}x`,
      `${'\t'.repeat(8000)}x`,
      '1/'.repeat(16000),
      `http://${'a'.repeat(31000)}`,
      `${'a'.repeat(15000)}@${'b.'.repeat(7000)}`,
      'trong 1 '.repeat(4000),
    ];
    const slow = evil
      .map((text) => {
        const t0 = performance.now();
        analyzeText(text, TODAY);
        return { head: text.slice(0, 12), ms: performance.now() - t0 };
      })
      .filter((r) => r.ms > 250);
    expect(slow).toEqual([]);
  });

  // Doc chinh file nguon (bo comment) de ep tuan thu quy uoc - loi #1, #9, RR5.
  const ROOT = path.resolve(__dirname, '../src/modules/ai');
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  for (const file of ['ai.dates.ts', 'ai.rules.ts']) {
    it(`${file}: khong ghep chuoi vao regex, khong regex "khop moi ky tu", khong dung gio dia phuong`, () => {
      const src = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));

      // Loi #1: ten nguoi/noi dung nhap vao regex -> crash
      expect(src).not.toMatch(/new\s+RegExp\s*\(/);
      expect(src).not.toMatch(/\bRegExp\s*\(/);
      // Loi #9: khop moi ky tu khong gioi han
      expect(src).not.toContain('.*');
      expect(src).not.toContain('.+');
      // RR5: ham theo mui gio may chay lam lech ngay (VN = UTC+7)
      expect(src).not.toMatch(/\.(get|set)(Date|Day|Month|FullYear|Hours|Minutes|Seconds|Milliseconds|TimezoneOffset)\s*\(/);
      expect(src).not.toMatch(/toLocale\w*String/);
      // "hom nay" phai la tham so, khong doc dong ho
      expect(src).not.toMatch(/Date\.now\s*\(/);
      expect(src).not.toMatch(/new\s+Date\s*\(\s*\)/);
    });
  }
});
