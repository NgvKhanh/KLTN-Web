// Dung cau tra loi danh muc theo mau (CHATBOT_MODULE.md §18.3, §18.5) - ham thuan.
import { describe, expect, it } from 'vitest';
import { MAX_CLARIFY_OPTIONS, QUICK_QUESTIONS, type ChatAnswer, type ScopeInfo } from '../src/modules/chat/chat.answer';
import type { CatalogResult } from '../src/modules/chat/chat.catalog';
import { CATALOG_SUGGESTIONS, renderCatalog, renderClarifyTarget, renderTargetNotFound } from '../src/modules/chat/chat.catalog.answer';
import { applyFollowUp } from '../src/modules/chat/chat.followup';
import { CATALOG_INTENTS, type CatalogIntent } from '../src/modules/chat/chat.intent';
import { parseByRules } from '../src/modules/chat/chat.rules';

const NOW = new Date('2026-09-30T10:00:00Z');
const MY: ScopeInfo = { kind: 'MY', workspaceName: null, boardName: null, boardCount: 18, isLeader: false };
const WS: ScopeInfo = { kind: 'WORKSPACE', workspaceName: 'Nhóm A', boardName: null, boardCount: 3, isLeader: true };
const BD: ScopeInfo = { kind: 'BOARD', workspaceName: 'Nhóm A', boardName: 'Bảng X', boardCount: 1, isLeader: false };

const render = (intent: CatalogIntent, result: CatalogResult, scope: ScopeInfo, extra: { columnLabel?: string | null; notes?: string[] } = {}) =>
  renderCatalog({ intent, result, scope, now: NOW, ...extra });

describe('cau tra loi danh muc: cau dan + so lieu + bang, tung y dinh', () => {
  it('MY_BOARDS: tong / tham gia truc tiep / chi xem nho khong gian; loc khong gian; pham vi bang; khong co bang', () => {
    const rows = [
      { id: 'b1', name: '1234', workspaceName: 'Không gian của Khánh', myRole: 'OWNER' as const },
      { id: 'b2', name: 'abc', workspaceName: 'Nhóm A', myRole: null },
      { id: 'b3', name: 'xyz', workspaceName: 'Nhóm A', myRole: 'VIEWER' as const },
    ];
    const my = render('MY_BOARDS', { kind: 'BOARDS', total: 3, direct: 2, workspaceName: null, rows }, MY);
    expect(my.kind).toBe('ANSWER');
    expect(my.text).toBe('Bạn xem được 3 bảng, trong đó bạn tham gia trực tiếp 2 bảng.');
    expect(my.facts).toEqual([
      { key: 'total', label: 'Bảng xem được', value: 3 },
      { key: 'direct', label: 'Tham gia trực tiếp', value: 2 },
      { key: 'viaWorkspace', label: 'Chỉ xem nhờ không gian', value: 1 },
    ]);
    expect(my.table).toEqual({
      columns: ['Bảng', 'Không gian', 'Bạn là'],
      total: 3,
      rows: [
        { cells: ['1234', 'Không gian của Khánh', 'Chủ bảng'], boardId: 'b1' },
        { cells: ['abc', 'Nhóm A', 'Xem nhờ không gian'], boardId: 'b2' },
        { cells: ['xyz', 'Nhóm A', 'Người xem'], boardId: 'b3' },
      ],
    });
    expect(my.notes.join(' ')).toContain('không tính bảng công khai');
    expect(my.suggestions).toEqual(['Tôi thuộc những không gian nào?', 'Mỗi bảng có bao nhiêu thẻ?']);
    expect([my.cards, my.sections, my.total, my.page]).toEqual([[], [], 0, 1]); // khong co "Xem thêm"

    const ws = render('MY_BOARDS', { kind: 'BOARDS', total: 3, direct: 1, workspaceName: null, rows }, WS);
    expect(ws.text).toBe('Không gian “Nhóm A” có 3 bảng bạn xem được, trong đó bạn tham gia trực tiếp 1 bảng.');
    const filtered = render('MY_BOARDS', { kind: 'BOARDS', total: 0, direct: 0, workspaceName: 'Nhóm B', rows: [] }, MY);
    expect(filtered.text).toBe('Không có bảng nào trong không gian “Nhóm B” mà bạn xem được.');
    expect(filtered.table?.rows).toEqual([]);
    const none = render('MY_BOARDS', { kind: 'BOARDS', total: 0, direct: 0, workspaceName: null, rows: [] }, MY);
    expect(none.text).toBe('Bạn chưa xem được bảng nào.');
    const board = render('MY_BOARDS', { kind: 'BOARDS', total: 1, direct: 0, workspaceName: null, rows: [{ id: 'b1', name: 'Bảng X', workspaceName: 'Nhóm A', myRole: null }] }, BD);
    expect(board.text).toBe('Bạn đang xem bảng “Bảng X” (không gian “Nhóm A”). Bạn xem được bảng này nhờ không gian.');
    const ownBoard = render('MY_BOARDS', { kind: 'BOARDS', total: 1, direct: 1, workspaceName: null, rows: [{ id: 'b1', name: 'Bảng X', workspaceName: 'Nhóm A', myRole: 'ADMIN' }] }, BD);
    expect(ownBoard.text).toContain('Vai trò của bạn: quản trị viên.');
  });

  it('MY_WORKSPACES: vai tro, so bang xem duoc, so thanh vien; ghi chu "chi tinh bang co quyen doc"', () => {
    const r: CatalogResult = {
      kind: 'WORKSPACES',
      rows: [
        { id: 'w1', name: 'Nhóm A', isPersonal: false, myRole: 'ADMIN', boards: 5, members: 4 },
        { id: 'w2', name: 'Không gian của Khánh', isPersonal: true, myRole: 'OWNER', boards: 13, members: 1 },
      ],
    };
    const a = render('MY_WORKSPACES', r, MY);
    expect(a.text).toBe('Bạn thuộc 2 không gian làm việc.');
    expect(a.facts).toEqual([{ key: 'workspaces', label: 'Không gian', value: 2 }]);
    expect(a.table).toEqual({
      columns: ['Không gian', 'Vai trò của bạn', 'Bảng bạn xem được', 'Thành viên'],
      total: 2,
      rows: [{ cells: ['Nhóm A', 'Quản trị viên', 5, 4] }, { cells: ['Không gian của Khánh (cá nhân)', 'Chủ sở hữu', 13, 1] }],
    });
    expect(a.notes.join(' ')).toContain('không phải mọi bảng của không gian');
    expect(render('MY_WORKSPACES', { kind: 'WORKSPACES', rows: [r.rows[0]] }, WS).text).toBe('Bạn thuộc không gian “Nhóm A” với vai trò quản trị viên.');
    expect(render('MY_WORKSPACES', { kind: 'WORKSPACES', rows: [] }, BD).text).toBe('Bạn chưa thuộc không gian nào trong phạm vi này.');
  });

  it('MEMBER_LIST: chi ten + vai tro (khong email / id); ghi chu bang hien thi WORKSPACE; nhan vai tro theo loai', () => {
    const board = render(
      'MEMBER_LIST',
      {
        kind: 'MEMBERS',
        subject: { type: 'BOARD', name: 'Bảng X', workspaceName: 'Nhóm A' },
        total: 2,
        rows: [{ name: 'Lan', role: 'OWNER' }, { name: 'Minh', role: 'VIEWER' }],
        workspaceWide: { workspaceName: 'Nhóm A', people: 9 },
      },
      BD
    );
    expect(board.text).toBe('Bảng “Bảng X” có 2 thành viên.');
    expect(board.table).toEqual({ columns: ['Tên', 'Vai trò'], total: 2, rows: [{ cells: ['Lan', 'Chủ bảng'] }, { cells: ['Minh', 'Người xem'] }] });
    expect(board.notes).toEqual(['Chỉ hiện tên và vai trò.', 'Bảng hiển thị cho cả không gian “Nhóm A” (9 người), nên mọi thành viên của không gian đều xem được.']);
    expect(JSON.stringify(board)).not.toMatch(/email|userId|@/);

    const ws = render(
      'MEMBER_LIST',
      { kind: 'MEMBERS', subject: { type: 'WORKSPACE', name: 'Nhóm A', workspaceName: null }, total: 1, rows: [{ name: 'Lan', role: 'OWNER' }], workspaceWide: null },
      WS
    );
    expect(ws.text).toBe('Không gian “Nhóm A” có 1 thành viên.');
    expect(ws.table?.rows).toEqual([{ cells: ['Lan', 'Chủ sở hữu'] }]);
    expect(ws.notes).toEqual(['Chỉ hiện tên và vai trò.']);
    expect(render('MEMBER_LIST', { kind: 'MEMBERS', subject: { type: 'BOARD', name: 'B', workspaceName: null }, total: 0, rows: [], workspaceWide: null }, BD).text).toBe(
      'Bảng “B” chưa có thành viên nào.'
    );
  });

  it('CARD_COUNTS: theo cot (co / khong loc cot), theo bang (co / khong loc khong gian), khong co the', () => {
    const byColumn = render(
      'CARD_COUNTS',
      { kind: 'COUNTS', mode: 'BY_COLUMN', subject: 'Bảng X', columnFilter: null, rows: [{ label: 'Cần làm', open: 5, done: 0 }, { label: 'Xong', open: 0, done: 2 }], total: 2, open: 5, done: 2 },
      BD
    );
    expect(byColumn.text).toBe('Bảng “Bảng X” có 7 thẻ: 5 chưa xong, 2 đã hoàn thành.');
    expect(byColumn.facts.map((f) => [f.key, f.value])).toEqual([['total', 7], ['open', 5], ['done', 2]]);
    expect(byColumn.table).toEqual({ columns: ['Cột', 'Chưa xong', 'Đã xong', 'Tổng'], total: 2, rows: [{ cells: ['Cần làm', 5, 0, 5] }, { cells: ['Xong', 0, 2, 2] }] });

    const oneColumn = render(
      'CARD_COUNTS',
      { kind: 'COUNTS', mode: 'BY_COLUMN', subject: 'Bảng X', columnFilter: { matched: 1 }, rows: [{ label: 'Đang làm', open: 4, done: 0 }], total: 1, open: 4, done: 0 },
      BD,
      { columnLabel: 'Đang làm' }
    );
    expect(oneColumn.text).toBe('Cột “Đang làm” của bảng “Bảng X” có 4 thẻ: 4 chưa xong, 0 đã hoàn thành.');
    const manyColumns = render(
      'CARD_COUNTS',
      { kind: 'COUNTS', mode: 'BY_COLUMN', subject: 'Bảng X', columnFilter: { matched: 3 }, rows: [], total: 3, open: 1, done: 0 },
      BD,
      { columnLabel: null }
    );
    expect(manyColumns.text).toContain('3 cột khớp của bảng “Bảng X”');

    const byBoard = render(
      'CARD_COUNTS',
      { kind: 'COUNTS', mode: 'BY_BOARD', subject: null, columnFilter: null, rows: [{ label: '1234', boardId: 'b1', workspaceName: 'Nhóm A', open: 3, done: 1 }], total: 1, open: 3, done: 1 },
      MY
    );
    expect(byBoard.text).toBe('Trong các bảng bạn xem được có 4 thẻ: 3 chưa xong, 1 đã hoàn thành, trên 1 bảng.');
    expect(byBoard.table).toEqual({
      columns: ['Bảng', 'Không gian', 'Chưa xong', 'Đã xong', 'Tổng'],
      total: 1,
      rows: [{ cells: ['1234', 'Nhóm A', 3, 1, 4], boardId: 'b1' }],
    });
    const inWs = render('CARD_COUNTS', { kind: 'COUNTS', mode: 'BY_BOARD', subject: 'Nhóm A', columnFilter: null, rows: [], total: 0, open: 0, done: 0 }, MY);
    expect(inWs.text).toBe('Trong không gian “Nhóm A” chưa có thẻ nào.');
    expect(byColumn.notes[0]).toContain('còn hiệu lực');
  });

  it('bang toi da 100 dong: ghi chu "chi hien N ... trong tong M"; ghi chu tham so bi bo qua dung truoc', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: `b${i}`, name: `B${i}`, workspaceName: 'W', myRole: null }));
    const a = render('MY_BOARDS', { kind: 'BOARDS', total: 130, direct: 0, workspaceName: null, rows }, MY, { notes: ['Trợ lý bỏ qua tên.'] });
    expect(a.table?.rows).toHaveLength(100);
    expect(a.table?.total).toBe(130);
    expect(a.notes[0]).toBe('Trợ lý bỏ qua tên.');
    expect(a.notes).toContain('Chỉ hiện 100 bảng đầu tiên trong tổng 130.');
  });
});

describe('cau tra loi danh muc: hoi lai / khong tim thay', () => {
  it('nhieu bang / khong gian khop -> nut TARGET, toi da 8, ghi chu thu hep; khong tim thay khong noi ten co ton tai noi khac', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ id: `id${i}`, label: `Bảng abc ${i} (Nhóm A)` }));
    const c = renderClarifyTarget('abc', many, MY, NOW);
    expect(c.kind).toBe('CLARIFY');
    expect(c.text).toBe('Có nhiều bảng hoặc không gian khớp với “abc”. Ý bạn là cái nào?');
    expect(c.clarify?.options).toHaveLength(MAX_CLARIFY_OPTIONS);
    expect(c.clarify?.options[0]).toEqual({ id: 'id0', label: 'Bảng abc 0 (Nhóm A)', kind: 'TARGET' });
    expect(c.notes).toEqual(['Hãy gõ thêm tên để thu hẹp danh sách.']);
    expect(renderClarifyTarget('abc', many.slice(0, 2), MY, NOW).notes).toEqual([]);

    const nf = renderTargetNotFound('xyz', 'COLUMN', BD, NOW);
    expect([nf.kind, nf.text]).toEqual(['ANSWER', 'Không tìm thấy cột “xyz” trong bảng “Bảng X”.']);
    expect(renderTargetNotFound('xyz', 'BOARD_OR_WORKSPACE', WS, NOW).text).toBe('Không tìm thấy bảng hoặc không gian “xyz” trong không gian “Nhóm A”.');
    expect(renderTargetNotFound('xyz', 'WORKSPACE', MY, NOW).text).toBe('Không tìm thấy không gian “xyz” trong các bảng bạn xem được.');
    for (const a of [nf, c]) expect(a.text).not.toMatch(/tồn tại|nơi khác|không gian khác/);
    for (const a of [nf, c]) expect([a.facts, a.cards, a.sections, a.generatedAt]).toEqual([[], [], [], NOW.toISOString()]);
  });
});

describe('tinh chat: moi con so trong cau dan / ghi chu deu co trong so lieu da tinh', () => {
  it('400 bo ket qua ngau nhien (hat giong co dinh) cho ca 4 loai', () => {
    let seed = 20260930;
    const rand = (n: number) => {
      seed = (seed * 48271) % 2147483647;
      return seed % n;
    };
    const roles = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;
    const numbersIn = (s: string) => (s.match(/[0-9]+/g) ?? []).map(Number);
    const bad: unknown[] = [];
    for (let n = 0; n < 400; n++) {
      const kind = rand(4);
      let result: CatalogResult;
      let intent: CatalogIntent;
      const scope = [MY, WS, BD][rand(3)];
      const extra: number[] = [];
      if (kind === 0) {
        intent = 'MY_BOARDS';
        const total = rand(230);
        const direct = rand(total + 1);
        const shown = Math.min(total, 100);
        result = {
          kind: 'BOARDS',
          total,
          direct,
          workspaceName: rand(2) === 0 ? null : 'Nhóm Y',
          rows: Array.from({ length: shown }, (_, i) => ({ id: `b${i}`, name: `Bảng ${'ABCDEFGH'[i % 8]}`, workspaceName: 'Nhóm Y', myRole: rand(5) === 4 ? null : roles[rand(4)] })),
        };
      } else if (kind === 1) {
        intent = 'MY_WORKSPACES';
        const rows = Array.from({ length: rand(6) }, (_, i) => ({
          id: `w${i}`,
          name: `Nhóm ${'ABCDEFGH'[i]}`,
          isPersonal: i === 0,
          myRole: (['OWNER', 'ADMIN', 'MEMBER'] as const)[rand(3)],
          boards: rand(40),
          members: rand(30),
        }));
        result = { kind: 'WORKSPACES', rows };
        extra.push(...rows.flatMap((r) => [r.boards, r.members]));
      } else if (kind === 2) {
        intent = 'MEMBER_LIST';
        const total = rand(150);
        const people = rand(80);
        result = {
          kind: 'MEMBERS',
          subject: { type: rand(2) === 0 ? 'BOARD' : 'WORKSPACE', name: 'Đối tượng', workspaceName: null },
          total,
          rows: Array.from({ length: Math.min(total, 100) }, (_, i) => ({ name: `Người ${'ABCDEFGH'[i % 8]}`, role: roles[rand(4)] })),
          workspaceWide: rand(2) === 0 ? null : { workspaceName: 'Nhóm Y', people },
        };
      } else {
        intent = 'CARD_COUNTS';
        const rows = Array.from({ length: rand(12) }, (_, i) => ({ label: `Cột ${'ABCDEFGHIJKL'[i]}`, boardId: `b${i}`, workspaceName: 'Nhóm Y', open: rand(50), done: rand(50) }));
        result = {
          kind: 'COUNTS',
          mode: rand(2) === 0 ? 'BY_COLUMN' : 'BY_BOARD',
          subject: rand(2) === 0 ? null : 'Đối tượng',
          columnFilter: rand(2) === 0 ? null : { matched: rand(9) + 1 },
          rows,
          total: rows.length + rand(3) * 40,
          open: rows.reduce((a, r) => a + r.open, 0),
          done: rows.reduce((a, r) => a + r.done, 0),
        };
      }
      const a: ChatAnswer = render(intent, result, scope, { columnLabel: result.kind === 'COUNTS' && result.columnFilter && rand(2) === 0 ? 'Cột A' : null });
      const allowed = new Set<number>([...a.facts.map((f) => f.value), a.table?.total ?? -1, a.table?.rows.length ?? -1, ...extra]);
      if (result.kind === 'MEMBERS' && result.workspaceWide) allowed.add(result.workspaceWide.people);
      if (result.kind === 'COUNTS') {
        allowed.add(result.open + result.done);
        if (result.columnFilter) allowed.add(result.columnFilter.matched);
      }
      for (const num of [...numbersIn(a.text), ...a.notes.flatMap(numbersIn)]) {
        if (!allowed.has(num)) bad.push({ intent, num, text: a.text, notes: a.notes });
      }
      expect(a.kind).toBe('ANSWER');
      expect(a.text.length).toBeGreaterThan(0);
    }
    expect(bad).toEqual([]);
  });
});

describe('goi y va cau hoi nhanh cua danh muc di qua bo luat ra DUNG y dinh', () => {
  it('moi cau goi y danh muc + cau hoi nhanh thu nam (khong danh muc ten -> khong can ten)', () => {
    const roster = [{ userId: 'u1', name: 'Nguyễn Thị Lan' }];
    const want: Record<string, CatalogIntent> = {
      'Tôi thuộc những không gian nào?': 'MY_WORKSPACES',
      'Mỗi bảng có bao nhiêu thẻ?': 'CARD_COUNTS',
      'Tôi đang ở bao nhiêu bảng?': 'MY_BOARDS',
      'Không gian này có bao nhiêu người?': 'MEMBER_LIST',
      'Bảng này có bao nhiêu thẻ?': 'CARD_COUNTS',
      'Bảng này có những ai?': 'MEMBER_LIST',
    };
    const all = [...new Set(CATALOG_INTENTS.flatMap((i) => CATALOG_SUGGESTIONS[i]))];
    for (const text of all) {
      if (text === 'Ai đang có nhiều việc?') continue; // y dinh cu, da co test o chat.answer.test
      const fu = applyFollowUp(parseByRules(text, roster), null);
      expect(fu.kind, text).toBe('CATALOG');
      expect(fu.kind === 'CATALOG' && fu.question.intent, text).toBe(want[text]);
      expect(fu.kind === 'CATALOG' && [fu.question.target, fu.question.column], text).toEqual([null, null]);
    }
    // cau hoi nhanh thu nam
    expect(QUICK_QUESTIONS).toHaveLength(5);
    const quick = applyFollowUp(parseByRules(QUICK_QUESTIONS[4], roster), null);
    expect(quick.kind === 'CATALOG' && quick.question.intent).toBe('MY_BOARDS');
    // moi y dinh danh muc co goi y; khong goi y nao chua ten bang / khong gian cu the (khong biet ten cua ai)
    expect(Object.keys(CATALOG_SUGGESTIONS).sort()).toEqual([...CATALOG_INTENTS].sort());
    for (const text of all) expect(text).not.toMatch(/“|"/);
  });
});
