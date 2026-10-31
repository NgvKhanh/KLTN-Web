// Khop ten bang / khong gian / cot (CHATBOT_MODULE.md §18.4) - ham thuan.
import { describe, expect, it } from 'vitest';
import {
  MAX_ENTITY_TOKENS,
  entityTokens,
  longestPrefixAt,
  matchEntity,
  prepareEntities,
  type NamedEntity,
} from '../src/modules/chat/chat.entities';
import { tokenize } from '../src/modules/chat/chat.members';

const E = (id: string, name: string): NamedEntity => ({ id, name });

const BOARDS = [
  E('b1', '1234'),
  E('b2', 'khanh'),
  E('b3', 'Kế hoạch Marketing ra mắt sản phẩm'),
  E('b4', 'Kế hoạch Marketing quý 4'),
  E('b5', 'Dự án Demo'),
  E('b6', 'Demo'),
  E('b7', 'Bảng công việc'),
];

const idsOf = (m: ReturnType<typeof matchEntity<NamedEntity>>): string[] =>
  m.kind === 'ONE' ? [m.item.id] : m.kind === 'MANY' ? m.items.map((x) => x.id) : [];

describe('matchEntity - ba bac khop: trung ca ten > phan dau > lien tiep', () => {
  it('bang ket qua: mot / nhieu / khong co; bac cao thang bac thap', () => {
    const rows: Array<[string, string, string[], number | null]> = [
      // typed, ten, ids, bac
      ['1234', 'trung ca ten', ['b1'], 1],
      ['Khanh', 'khong phan biet hoa thuong', ['b2'], 1],
      ['Kế hoạch Marketing ra mắt sản phẩm', 'ca ten dai', ['b3'], 1],
      ['Kế hoạch Marketing ra mắt', 'phan dau, chi 1 bang', ['b3'], 2],
      ['Kế hoạch Marketing', 'phan dau, 2 bang -> MANY sap theo ten', ['b4', 'b3'], 2],
      ['Kế hoạch', 'phan dau, 2 bang', ['b4', 'b3'], 2],
      ['Demo', 'trung ca ten cua "Demo" thang phan dau cua "Dự án Demo"', ['b6'], 1],
      ['Marketing quý', 'lien tiep giua ten', ['b4'], 3],
      ['sản phẩm', 'lien tiep cuoi ten', ['b3'], 3],
      ['Không có bảng nào', 'khong khop', [], null],
      ['', 'rong', [], null],
      ['   ', 'toan khoang trang', [], null],
    ];
    for (const [typed, why, ids, tier] of rows) {
      const m = matchEntity(typed, BOARDS);
      expect(idsOf(m), `${typed}: ${why}`).toEqual(ids);
      expect(m.kind === 'NONE' ? null : m.tier, `${typed}: bac`).toBe(tier);
    }
  });

  it('bo tu khoa mo dau (bang / cot / khong gian / danh sach / workspace), mien la con lai it nhat mot tu', () => {
    expect(idsOf(matchEntity('bảng 1234', BOARDS))).toEqual(['b1']);
    expect(idsOf(matchEntity('Bảng khanh', BOARDS))).toEqual(['b2']);
    expect(idsOf(matchEntity('cột Đang làm', [E('c1', 'Đang làm')]))).toEqual(['c1']);
    expect(idsOf(matchEntity('không gian Nhóm A', [E('w1', 'Nhóm A')]))).toEqual(['w1']);
    expect(idsOf(matchEntity('danh sách Cần làm', [E('c1', 'Cần làm')]))).toEqual(['c1']);
    expect(idsOf(matchEntity('bảng bảng 1234', BOARDS))).toEqual(['b1']); // nhieu tu khoa lien tiep
    // chi toan tu khoa: giu nguyen de con khop duoc ten "Bảng công việc"
    expect(idsOf(matchEntity('bảng', BOARDS)).sort()).toEqual(['b7']);
    expect(idsOf(matchEntity('Bảng công việc', BOARDS))).toEqual(['b7']);
  });

  it('ten CHINH NO bat dau bang tu khoa: trung ca ten (ban goc) thang khong gian chi khop ban da bo tu khoa', () => {
    const boards = [{ id: 'b', name: 'Bảng công việc' }];
    const spaces = [{ id: 'w', name: 'công việc' }];
    const board = matchEntity('Bảng công việc', boards);
    expect([board.kind, board.kind === 'ONE' ? board.tier : null]).toEqual(['ONE', 1]);
    const space = matchEntity('Bảng công việc', spaces); // ban bo tu khoa "công việc" trung ca ten khong gian: van khop
    expect([space.kind, space.kind === 'ONE' ? space.tier : null]).toEqual(['ONE', 1]);
    // go khong co tu khoa: chi khop phan lien tiep cua ten bang (bac 3), nen ten day du van ro rang hon
    const loose = matchEntity('công việc', boards);
    expect([loose.kind, loose.kind === 'ONE' ? loose.tier : null]).toEqual(['ONE', 3]);
    expect(idsOf(matchEntity('BANG BI MAT', [E('b1', 'BANG-BI-MAT'), E('b2', 'Chuyện bí mật')]))).toEqual(['b1']);
  });

  it('go khong dau khop ten co dau; hai ben deu co dau thi so co dau (khong nham); NFD', () => {
    expect(idsOf(matchEntity('ke hoach marketing ra mat', BOARDS))).toEqual(['b3']);
    expect(idsOf(matchEntity('du an demo', BOARDS))).toEqual(['b5']);
    // "mắt" != "mắc": hai ben co dau khac nhau thi khong khop
    expect(idsOf(matchEntity('Kế hoạch Marketing ra mắc', BOARDS))).toEqual([]);
    expect(idsOf(matchEntity('Kế hoạch Marketing ra mắt'.normalize('NFD'), BOARDS))).toEqual(['b3']);
  });

  it('bo trung id, bo ten rong, khong sua mang dau vao, chi xet MAX_ENTITY_TOKENS tu dau', () => {
    const frozen = Object.freeze([E('x', 'Lan'), E('x', 'Lan khac'), E('y', ''), E('z', '   ')]) as readonly NamedEntity[];
    expect(idsOf(matchEntity('Lan', frozen))).toEqual(['x']);
    expect(prepareEntities(frozen).map((p) => p.item.id)).toEqual(['x']);

    const longName = Array.from({ length: MAX_ENTITY_TOKENS + 5 }, (_, i) => `tu${i}`).join(' ');
    expect(entityTokens(longName)).toHaveLength(MAX_ENTITY_TOKENS);
    expect(idsOf(matchEntity(longName, [E('long', longName)]))).toEqual(['long']);
  });

  it('nhanh voi 500 bang x cau dai; tat dinh', () => {
    const many = Array.from({ length: 500 }, (_, i) => E(`id${i}`, `Bang so ${i} cua nhom ${i % 7}`));
    const t0 = performance.now();
    for (let n = 0; n < 200; n++) matchEntity(`bang so ${n % 500} cua nhom`, many);
    expect((performance.now() - t0) / 200).toBeLessThan(15);
    expect(idsOf(matchEntity('Bang so 7 cua nhom 0', many))).toEqual(['id7']);
    expect(matchEntity('bang so 7', many)).toEqual(matchEntity('bang so 7', many));
  });
});

describe('longestPrefixAt - doan dai nhat la phan dau cua ten (dung cho bo luat)', () => {
  const toks = tokenize('bảng Kế hoạch Marketing ra mắt có bao nhiêu thẻ');
  it('lay doan dai nhat khop phan dau; khong khop thi null; khong vuot cuoi cau', () => {
    expect(longestPrefixAt(toks, 1, BOARDS)).toEqual({ end: 6 }); // "Kế hoạch Marketing ra mắt" (5 tu), roi "có" khong khop tiep
    expect(longestPrefixAt(toks, 6, BOARDS)).toBeNull(); // "có bao nhiêu thẻ": khong ten nao bat dau bang "có"
    expect(longestPrefixAt(tokenize('khanh'), 0, BOARDS)).toEqual({ end: 1 });
    expect(longestPrefixAt(toks, toks.length, BOARDS)).toBeNull();
    expect(longestPrefixAt(toks, 1, [])).toBeNull();
    // chi phan DAU: "Marketing" o giua ten khong tinh
    expect(longestPrefixAt(tokenize('Marketing'), 0, BOARDS)).toBeNull();
  });
});
