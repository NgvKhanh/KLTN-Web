// Tach tu + so khop ten nguoi cua chatbot (CHATBOT_MODULE.md §8.2-8.3).
import { describe, expect, it } from 'vitest';
import {
  MAX_ROSTER,
  findNameSpans,
  isSelfReference,
  matchMember,
  sameWord,
  tokenize,
  type MemberMatch,
  type RosterMember,
} from '../src/modules/chat/chat.members';

const ROSTER: RosterMember[] = [
  { userId: 'lan1', name: 'Nguyễn Thị Lan' },
  { userId: 'lan2', name: 'Trần Lan' },
  { userId: 'lan3', name: 'Nguyễn Trần Lan' },
  { userId: 'tuan', name: 'Lê Văn Tuấn' },
  { userId: 'tanh', name: 'Tuấn Anh' },
  { userId: 'minh', name: 'Hoàng Minh' },
  { userId: 'plain', name: 'Pham Quoc Bao' },
];

/** Rut gon ket qua de so: ONE:id / MANY:id,id / NONE */
function short(m: MemberMatch): string {
  if (m.kind === 'ONE') return `ONE:${m.member.userId}`;
  if (m.kind === 'MANY') return `MANY:${m.members.map((x) => x.userId).join(',')}`;
  return 'NONE';
}

describe('tokenize / sameWord', () => {
  it('NFC + NFD cho cung ket qua; tach theo dau cau; giu ban co dau va ban khong dau', () => {
    const text = 'Việc của chị Lan, ĐỖ Nam (tuần sau)!';
    const nfc = tokenize(text);
    expect(tokenize(text.normalize('NFD'))).toEqual(nfc);
    expect(nfc.map((t) => t.orig)).toEqual(['việc', 'của', 'chị', 'lan', 'đỗ', 'nam', 'tuần', 'sau']);
    expect(nfc.map((t) => t.fold)).toEqual(['viec', 'cua', 'chi', 'lan', 'do', 'nam', 'tuan', 'sau']);
    expect(nfc.map((t) => t.plain)).toEqual([false, false, false, true, false, true, false, true]);
    expect(nfc[4].raw).toBe('ĐỖ');
    expect(tokenize('   ...  ')).toEqual([]);
    expect(tokenize('7 ngày').map((t) => t.fold)).toEqual(['7', 'ngay']);
  });

  it('hai tu cung co dau -> so co dau; mot ben khong dau -> so khong dau', () => {
    const w = (s: string) => tokenize(s)[0];
    const cases: [string, string, boolean][] = [
      ['tuần', 'Tuấn', false],
      ['tuan', 'Tuấn', true],
      ['Tuấn', 'tuan', true],
      ['TUẤN', 'tuấn', true],
      ['năm', 'Nam', true], // "Nam" khong dau -> so ban khong dau (bo luat loai cum "năm nay")
      ['năm', 'Nâm', false],
      ['đỗ', 'do', true],
      ['lan', 'Lân', true],
      ['lân', 'Lan', true],
      ['lân', 'lăn', false],
    ];
    for (const [a, b, eq] of cases) expect(sameWord(w(a), w(b)), `${a} ~ ${b}`).toBe(eq);
  });
});

describe('matchMember', () => {
  it('bang ket qua: duoi ten, xung ho, trung ten, ho ten day du', () => {
    const cases: [string, string][] = [
      ['Lan', 'MANY:lan1,lan3,lan2'], // sap theo ten (vi): Nguyễn Thị Lan < Nguyễn Trần Lan < Trần Lan
      ['chị Lan', 'MANY:lan1,lan3,lan2'],
      ['Thị Lan', 'ONE:lan1'],
      ['nguyen thi lan', 'ONE:lan1'],
      ['Trần Lan', 'ONE:lan2'], // khop duoi cua ca lan2 va lan3, nhung trung DUNG ca ten lan2
      ['Nguyễn Trần Lan', 'ONE:lan3'],
      ['Tuấn', 'ONE:tuan'], // "Tuấn Anh" khong ket thuc bang "Tuấn"
      ['tuan', 'ONE:tuan'],
      ['anh Tuấn', 'ONE:tuan'],
      ['Anh', 'ONE:tanh'], // mot tu thi khong bo xung ho
      ['Tuấn Anh', 'ONE:tanh'],
      ['Minh', 'ONE:minh'],
      ['bạn Minh', 'ONE:minh'],
      ['Bảo', 'ONE:plain'], // ten luu khong dau van tim duoc bang ten co dau
      ['Quoc Bao', 'ONE:plain'],
      ['tuần', 'NONE'],
      ['Hùng', 'NONE'],
      ['Nguyễn Lan', 'NONE'], // khong phai duoi ten
      ['', 'NONE'],
      ['   ', 'NONE'],
      ['@#!', 'NONE'],
    ];
    for (const [query, expected] of cases) expect(short(matchMember(query, ROSTER)), query).toBe(expected);

    // Ten MOT tu trung dung ca ten mot nguoi nhung cung la duoi ten nguoi khac -> van hoi lai
    const single = [
      { userId: 'lan', name: 'Lan' },
      { userId: 'lan1', name: 'Nguyễn Thị Lan' },
    ];
    expect(short(matchMember('Lan', single))).toBe('MANY:lan,lan1');
    expect(short(matchMember('Nguyễn Thị Lan', single))).toBe('ONE:lan1');
  });

  it('bo trung userId, bo nguoi ten rong, gioi han so nguoi va do dai ten', () => {
    const dup = [
      { userId: 'a', name: 'Lê Hoa' },
      { userId: 'a', name: 'Lê Hoa' },
      { userId: 'b', name: '   ' },
    ];
    expect(short(matchMember('Hoa', dup))).toBe('ONE:a');

    // nguoi ten rong KHONG chiem cho trong gioi han
    const blanks: RosterMember[] = Array.from({ length: MAX_ROSTER }, (_, i) => ({ userId: `blank${i}`, name: '' }));
    expect(short(matchMember('Hoa', [...blanks, { userId: 'hoa', name: 'Lê Hoa' }]))).toBe('ONE:hoa');

    const big: RosterMember[] = Array.from({ length: MAX_ROSTER + 5 }, (_, i) => ({ userId: `u${i}`, name: `Người ${i}` }));
    expect(short(matchMember(`Người ${MAX_ROSTER - 1}`, big))).toBe(`ONE:u${MAX_ROSTER - 1}`);
    expect(short(matchMember(`Người ${MAX_ROSTER + 1}`, big))).toBe('NONE'); // ngoai gioi han -> khong xet

    const longName = [{ userId: 'x', name: 'A B C D E F G H I K Lan' }];
    expect(short(matchMember('Lan', longName))).toBe('ONE:x');
    expect(short(matchMember('C D E F G H I K Lan', longName))).toBe('ONE:x'); // 9 tu -> chi xet 8 tu cuoi
  });

  it('khong sua mang dau vao', () => {
    const roster = Object.freeze(ROSTER.map((m) => Object.freeze({ ...m })));
    expect(() => matchMember('Lan', roster)).not.toThrow();
    expect(roster.map((m) => m.userId)).toEqual(ROSTER.map((m) => m.userId));
  });
});

describe('isSelfReference / findNameSpans', () => {
  it('chinh nguoi hoi', () => {
    const yes = ['tôi', 'Tôi', 'TÔI', 'toi', 'mình', 'tớ', 'em', 'bản thân', 'ban than', 'chính tôi', '  tôi  '];
    const no = ['minh', 'Minh', 'Lan', '', 'tôi và Lan', 'anh', 'bạn', 'tới', 'tối']; // "tới"/"tối" bo dau cung la "toi"
    for (const s of yes) expect(isSelfReference(s), s).toBe(true);
    for (const s of no) expect(isSelfReference(s), s).toBe(false);
  });

  it('moi doan trung duoi ten, dai truoc ngan', () => {
    const toks = tokenize('Nguyễn Thị Lan đang làm gì');
    const spans = findNameSpans(toks, ROSTER).map((s) => `${s.start}-${s.end}:${s.userIds.join(',')}`);
    expect(spans).toEqual(['0-3:lan1', '1-3:lan1', '2-3:lan1,lan2,lan3']);
    expect(findNameSpans(tokenize('không có ai'), ROSTER)).toEqual([]);
  });

  it('cau 500 ky tu x 300 nguoi van nhanh', () => {
    const roster: RosterMember[] = Array.from({ length: 300 }, (_, i) => ({ userId: `u${i}`, name: `Nguyễn Văn Tên${i}` }));
    const question = 'Nguyễn Văn Tên1 đang làm gì '.repeat(20).slice(0, 500);
    const t0 = performance.now();
    for (let k = 0; k < 5; k++) findNameSpans(tokenize(question), roster);
    expect((performance.now() - t0) / 5).toBeLessThan(250);
  });
});
