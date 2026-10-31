// Buoc 3 - bo tach tu (assign.text.ts). HAM THUAN: khong cham CSDL.
// (setup.ts van TRUNCATE truoc moi `it`, nen cac ca duoc gop thanh bang cho nhanh.)
//
// Luu y: KHONG go dau thoat backslash-u trong noi dung (cong cu doi thanh ky tu that) -> dung
// String.fromCharCode cho ky tu dac biet.
import { describe, expect, it } from 'vitest';
import { foldText } from '../src/modules/ai/ai.rules';
import {
  MAX_TEXT_CHARS,
  MAX_TOKEN_CHARS,
  STOP_PLAIN,
  TITLE_WEIGHT,
  countTerms,
  tokenize,
} from '../src/modules/assign/assign.text';
import { SYNONYMS, TOPICS } from '../src/scripts/simVocab';

const NBSP = String.fromCharCode(0xa0);
const LEFT_QUOTE = String.fromCharCode(0x201c);
const RIGHT_QUOTE = String.fromCharCode(0x201d);

describe('Buoc 3 - tach tu: cac cau mau (ket qua doc tu tham do, khong doan)', () => {
  it('uni-gram truoc, bi-gram sau; bi-gram khong bac qua hu tu, dau cau, so', () => {
    const cases: [string, string[]][] = [
      [
        'Viết API đăng nhập bằng Google',
        ['viet', 'api', 'dang', 'nhap', 'google', 'viet api', 'api dang', 'dang nhap'],
      ],
      [
        'Thiết kế bảng người dùng cho dữ liệu cũ',
        [
          'thiet', 'ke', 'bang', 'nguoi', 'dung', 'du', 'lieu', 'cu',
          'thiet ke', 'ke bang', 'bang nguoi', 'nguoi dung', 'du lieu', 'lieu cu',
        ],
      ],
      ['Học trọng số của mô hình', ['hoc', 'trong', 'so', 'mo', 'hinh', 'hoc trong', 'trong so', 'mo hinh']],
      ['Việc làm trong nhóm', ['viec', 'lam', 'nhom', 'viec lam']],
      [
        'Sửa lỗi. Đăng nhập trên điện thoại',
        ['sua', 'loi', 'dang', 'nhap', 'dien', 'thoai', 'sua loi', 'dang nhap', 'dien thoai'],
      ],
      [
        'Dựng front-end/back-end cho login (deploy)',
        ['dung', 'front', 'end', 'back', 'end', 'login', 'deploy', 'dung front', 'front end', 'back end'],
      ],
      ['Hoàn thiện mục 3 năm 2026 b2 v1.2', ['hoan', 'thien', 'muc', 'nam', 'b2', 'v1', 'hoan thien', 'thien muc', 'b2 v1']],
      ['snake_case_name', ['snake', 'case', 'name', 'snake case', 'case name']],
      ['Tạo chỉ mục cho cơ sở dữ liệu', ['tao', 'chi', 'muc', 'co', 'so', 'du', 'lieu', 'tao chi', 'chi muc', 'co so', 'so du', 'du lieu']],
    ];
    for (const [input, expected] of cases) expect(tokenize(input), input).toEqual(expected);

    // Khong co bi-gram nao bac qua: hu tu ("cho"), dau cham, dau gach cheo, so
    const all = cases.flatMap(([, e]) => e);
    for (const bad of ['dung du', 'loi dang', 'end back', 'muc nam', 'nam b2', 'lieu cho']) {
      expect(all, bad).not.toContain(bad);
    }
    // Dau ngoac kep cong cung lam dut cau
    expect(tokenize(`Sửa ${LEFT_QUOTE}lỗi${RIGHT_QUOTE} đăng nhập`)).not.toContain('loi dang');
  });

  it('go co dau, khong dau, HOA, NFD, khoang trang la -> CUNG ket qua', () => {
    const want = ['dang', 'nhap', 'dang nhap'];
    for (const v of [
      'Đăng nhập',
      'dang nhap',
      'ĐĂNG NHẬP',
      'Đăng nhập'.normalize('NFD'),
      `Đăng${NBSP}nhập`,
      '  đăng \t nhập \n ',
    ]) {
      expect(tokenize(v), JSON.stringify(v)).toEqual(want);
    }
    // Ca cau "chi muc" co dau va khong dau ra CUNG tap thuat ngu (loi 'chỉ' bi coi la hu tu tung lam khac di)
    expect(tokenize('Tạo chỉ mục cho cơ sở dữ liệu')).toEqual(tokenize('tao chi muc cho co so du lieu'));
    // Deterministic
    expect(tokenize('Viết API đăng nhập bằng Google')).toEqual(tokenize('Viết API đăng nhập bằng Google'));
  });
});

describe('Buoc 3 - hu tu xet tren dang CO DAU (chong nuot mat tu noi dung)', () => {
  it('cap tu dong am khac nghia: hu tu bi bo, tu noi dung duoc giu', () => {
    // [hu tu (bi bo), tu noi dung co CUNG dang bo dau (duoc giu)]
    const pairs: [string, string, string][] = [
      ['bằng', 'bảng', 'bang'],
      ['đang', 'đăng', 'dang'],
      ['nên', 'nền', 'nen'],
      ['có', 'cơ', 'co'],
      ['về', 'vẽ', 've'],
      ['và', 'vá', 'va'],
      ['trong', 'trọng', 'trong'],
      ['để', 'đề', 'de'],
      ['tại', 'tải', 'tai'],
    ];
    for (const [stop, content, folded] of pairs) {
      expect(tokenize(stop), `${stop} phai bi bo`).toEqual([]);
      expect(tokenize(content), `${content} phai duoc giu`).toEqual([folded]);
    }
    // Ba tu hai nghia ngay ca khi co dau: phai GIU (cum tu linh vuc)
    for (const [w, folded] of [['chỉ', 'chi'], ['từ', 'tu'], ['quá', 'qua'], ['mới', 'moi']] as const) {
      expect(tokenize(w), w).toEqual([folded]);
    }
    // Chu HOA cung nhu vay
    expect(tokenize('VÀ CỦA CHO')).toEqual([]);
    expect(tokenize('BẢNG')).toEqual(['bang']);
  });

  it('go KHONG dau: chi bo hu tu khong mo ho; tu mo ho van duoc giu', () => {
    for (const w of [...STOP_PLAIN, 'cho', 'khi', 'theo', 'sau', 'do', 'hay']) {
      expect(tokenize(w), `${w} khong dau phai bi bo`).toEqual([]);
    }
    // Go khong dau cua tu noi dung: van giu (day la ly do chung khong nam trong STOP_PLAIN)
    for (const w of ['bang', 'dang', 'nen', 'co', 've', 'va', 'moi', 'de', 'tai', 'chi', 'the', 'that']) {
      expect(STOP_PLAIN.has(w), `${w} khong duoc nam trong STOP_PLAIN`).toBe(false);
      expect(tokenize(w), `${w} khong dau phai duoc giu`).toEqual([w]);
    }
  });

  it('STOP_PLAIN chi ap dung khi chu KHONG co dau: tu co dau roi vao dang bo dau cua no van duoc giu', () => {
    // dược (pharma) / mốt (trend) / vòi (faucet) / trược: co dau, KHONG phai hu tu, du dang bo dau trung STOP_PLAIN
    for (const [w, folded] of [['dược', 'duoc'], ['mốt', 'mot'], ['vòi', 'voi'], ['trược', 'truoc'], ['cạc', 'cac']] as const) {
      expect(STOP_PLAIN.has(folded), folded).toBe(true); // dieu kien cua phep thu
      expect(tokenize(w), w).toEqual([folded]);
      expect(tokenize(folded), `${folded} (khong dau) la hu tu`).toEqual([]);
    }
  });

  it('cum tu linh vuc giu DU am tiet (du lieu tu vung mo phong + cac cum bo sung)', () => {
    // Chinh phep kiem nay se bat lai loi "chi" (chi muc) / "tu" (tu khoa) / "qua" (qua han) bi coi la hu tu
    const extras = [
      'chỉ mục', 'trọng số', 'từ khoá', 'quá hạn', 'đăng nhập', 'bảng màu', 'nền tối',
      'cơ sở dữ liệu', 'đề tài', 'cấu hình', 'tải tệp', 'phản hồi',
    ];
    const phrases = [...new Set([...Object.keys(SYNONYMS), ...extras])];
    expect(phrases.length).toBeGreaterThanOrEqual(25);
    for (const phrase of phrases) {
      const syllables = foldText(phrase).split(' ');
      const tokens = tokenize(phrase);
      for (const s of syllables) expect(tokens, `${phrase}: thieu am tiet "${s}"`).toContain(s);
      for (let i = 0; i + 1 < syllables.length; i += 1) {
        expect(tokens, `${phrase}: thieu bi-gram`).toContain(`${syllables[i]} ${syllables[i + 1]}`);
      }
    }

    // STOP_PLAIN khong duoc nuot tu noi dung: tu nao trong tu vung ma dang bo dau nam trong STOP_PLAIN
    // thi chinh no (go co dau) cung phai la hu tu that (bi bo)
    const vocab = new Set<string>();
    const add = (text: string) => {
      for (const w of text.toLowerCase().split(/[^\p{L}\p{N}]/u)) if (w !== '') vocab.add(w);
    };
    for (const t of TOPICS) for (const list of [t.verbs, t.objects, t.details, t.descWords]) list.forEach(add);
    for (const k of Object.keys(SYNONYMS)) add(k);
    expect(vocab.size).toBeGreaterThanOrEqual(250); // do duoc 279 luc viet
    for (const w of vocab) {
      if (STOP_PLAIN.has(foldText(w))) expect(tokenize(w), `"${w}" bi STOP_PLAIN nuot`).toEqual([]);
    }
  });
});

describe('Buoc 3 - dau ngat cau: tung ky tu mot (chong bi-gram bac qua)', () => {
  it('moi dau ngat cau lam dut bi-gram; dau cach, gach noi, gach duoi, ky hieu khac chi tach token', () => {
    const cc = String.fromCharCode;
    const breakers = [
      '.', ',', ';', ':', '!', '?', '(', ')', '[', ']', '{', '}', '"', '/', cc(92), '|', cc(10),
      cc(0x201c), cc(0x201d), cc(0x2018), cc(0x2019), cc(0x2026),
    ];
    for (const c of breakers) {
      expect(tokenize(`alpha${c}beta`), JSON.stringify(c)).toEqual(['alpha', 'beta']);
      expect(tokenize(`alpha ${c} beta`), JSON.stringify(c)).toEqual(['alpha', 'beta']);
    }
    // Ky tu KHONG ngat cau: van ra bi-gram
    for (const c of [' ', '-', '_', '+', '@', '#', '&', '*', '=', '%', '$', '~', '<', '>', cc(9)]) {
      expect(tokenize(`alpha${c}beta`), JSON.stringify(c)).toEqual(['alpha', 'beta', 'alpha beta']);
    }
  });

  it('hang so theo GIA TRI (khong tu khop voi chinh minh)', () => {
    expect(MAX_TEXT_CHARS).toBe(4000);
    expect(MAX_TOKEN_CHARS).toBe(30);
    expect(TITLE_WEIGHT).toBe(2);
  });
});

describe('Buoc 3 - bien va do ben cua bo tach tu', () => {
  it('do dai token, so, rong, ky tu la', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   \n\t  ')).toEqual([]);
    expect(tokenize('a b c 12 34')).toEqual([]);
    expect(tokenize('2026')).toEqual([]);
    expect(tokenize('b2')).toEqual(['b2']);
    expect(tokenize('ab')).toEqual(['ab']);
    expect(tokenize('a')).toEqual([]);
    // Bien do dai token: MAX_TOKEN_CHARS con giu, +1 thi bo
    expect(tokenize('x'.repeat(MAX_TOKEN_CHARS))).toEqual(['x'.repeat(MAX_TOKEN_CHARS)]);
    expect(tokenize('x'.repeat(MAX_TOKEN_CHARS + 1))).toEqual([]);
    // Token qua dai (URL dinh, ma bam) bi bo, cac phan con lai giu
    expect(tokenize(`https://example.com/${'a'.repeat(43)}`)).toEqual(['https', 'example', 'com']);
    // Ky tu ngoai chu Latin va bieu tuong: khong nem loi
    expect(() => tokenize('日本語 テスト 🎉 👩‍💻')).not.toThrow();
    expect(tokenize('日本語')).toEqual(['日本語']);
    expect(tokenize('🎉🎉')).toEqual([]);
    // Ky tu suy bien (nua cap thay the o cuoi): khong nem loi
    expect(() => tokenize(`abc${String.fromCharCode(0xd800)}`)).not.toThrow();
    // Thanh phan null / undefined khong lam sap countTerms
    expect(countTerms({ title: 'a', description: null }).size).toBe(0);
  });

  it('chi doc MAX_TEXT_CHARS ky tu dau; dau vao khong lo van chay nhanh (tuyen tinh)', () => {
    const cut = tokenize(`early ${' '.repeat(MAX_TEXT_CHARS)}late`);
    expect(cut).toContain('early');
    expect(cut).not.toContain('late');
    // Truoc diem cat thi doc duoc
    expect(tokenize(`${' '.repeat(MAX_TEXT_CHARS - 10)}late`)).toContain('late');

    const huge = 'ab '.repeat(2_000_000); // 6 trieu ky tu
    const t0 = Date.now();
    const out = tokenize(huge);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(out.length).toBeLessThanOrEqual(MAX_TEXT_CHARS); // bi cat -> so thuat ngu bi chan tren

    // Cac dang dau vao "xau" kinh dien cho regex: khong gay treo
    const t1 = Date.now();
    for (const bad of ['-'.repeat(50_000), '.'.repeat(50_000), 'a-'.repeat(25_000), ' '.repeat(50_000), String.fromCharCode(0x301).repeat(50_000)]) {
      tokenize(bad);
    }
    expect(Date.now() - t1).toBeLessThan(1000);
  });

  it('tinh chat cau truc tren 400 chuoi ngau nhien (hat giong co dinh)', () => {
    const alphabet = 'aeiouyăâêôơư đ bcdglmnrstvx ắầẩẫậ ẻẽẹ ỉĩị ỏõọ ủũụ ỳỷỹỵ 0123456789 AEIOUĐ .,;:!?()[]/-_"\'\n\t' + NBSP;
    let s = 20260920;
    const next = () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const isUnigram = (t: string) => {
      const len = Array.from(t).length;
      return len >= 2 && len <= MAX_TOKEN_CHARS && !t.includes(' ') && /[^\p{N}]/u.test(t);
    };
    let nonEmpty = 0;
    for (let n = 0; n < 400; n += 1) {
      const len = Math.floor(next() * 120);
      let text = '';
      for (let i = 0; i < len; i += 1) text += alphabet[Math.floor(next() * alphabet.length)];
      const out = tokenize(text);
      expect(tokenize(text)).toEqual(out); // tat dinh
      const uni = out.filter((t) => !t.includes(' '));
      const bi = out.filter((t) => t.includes(' '));
      // Uni-gram truoc, bi-gram sau
      expect(out).toEqual([...uni, ...bi]);
      expect(uni.every(isUnigram), text).toBe(true);
      for (const b of bi) {
        const parts = b.split(' ');
        expect(parts.length, b).toBe(2);
        // Hai nua deu la uni-gram hop le va CUNG xuat hien trong danh sach uni-gram
        for (const p of parts) {
          expect(isUnigram(p), b).toBe(true);
          expect(uni, b).toContain(p);
        }
      }
      // Moi bi-gram gom hai uni-gram ke nhau => khong the nhieu hon uni-gram
      expect(bi.length).toBeLessThanOrEqual(uni.length);
      if (out.length > 0) nonEmpty += 1;
    }
    expect(nonEmpty).toBeGreaterThan(200); // bo sinh khong sinh toan chuoi rong
  });
});

describe('Buoc 3 - countTerms', () => {
  it('tieu de nhan TITLE_WEIGHT, mo ta nhan 1, cong don; tham so sai bi tu choi', () => {
    expect(TITLE_WEIGHT).toBe(2);
    const c = countTerms({ title: 'Kiểm thử đăng nhập', description: 'kiểm thử luồng đăng nhập' });
    expect(c.get('kiem')).toBe(3); // 2 (tieu de) + 1 (mo ta)
    expect(c.get('dang nhap')).toBe(3);
    expect(c.get('thu dang')).toBe(2); // chi o tieu de
    expect(c.get('luong')).toBe(1); // chi o mo ta
    expect(c.get('thu luong')).toBe(1);

    // Tham so titleWeight: 0 bo tieu de, 1 ngang mo ta, so am / NaN / vo han bi tu choi
    expect(countTerms({ title: 'Kiểm thử', description: 'luồng' }, 0).has('kiem')).toBe(false);
    expect(countTerms({ title: 'Kiểm thử', description: 'luồng' }, 0).get('luong')).toBe(1);
    expect(countTerms({ title: 'Kiểm thử' }, 1).get('kiem')).toBe(1);
    expect(countTerms({ title: 'Kiểm thử' }, 5).get('kiem')).toBe(5);
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => countTerms({ title: 'x' }, bad), String(bad)).toThrow(RangeError);
    }
    // Thieu mo ta / mo ta null / mo ta undefined deu duoc
    expect(countTerms({ title: 'Kiểm thử' }).get('kiem')).toBe(2);
    expect(countTerms({ title: 'Kiểm thử', description: null }).get('kiem')).toBe(2);
    expect(countTerms({ title: '', description: 'kiểm thử' }).get('kiem')).toBe(1);
    // Thu tu chen tat dinh
    expect([...countTerms({ title: 'Kiểm thử đăng nhập' }).keys()]).toEqual(['kiem', 'thu', 'dang', 'nhap', 'kiem thu', 'thu dang', 'dang nhap']);
  });
});
