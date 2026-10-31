// Nhan dien ten bang / khong gian / cot cua cau hoi danh muc (CHATBOT_MODULE.md §18.4) - ham thuan, khong DB.
import { describe, expect, it } from 'vitest';
import {
  resolveCatalogQuestion,
  scopeDefaultTarget,
  targetId,
  targetLabel,
  targetName,
  type CatalogResolution,
  type ResolveScope,
} from '../src/modules/chat/chat.catalog.resolve';
import type { EntityCatalog } from '../src/modules/chat/chat.entities';
import type { CatalogIntent, CatalogQuestion } from '../src/modules/chat/chat.intent';

const CAT: EntityCatalog = Object.freeze({
  workspaces: Object.freeze([
    { id: 'w1', name: 'Marketing' },
    { id: 'w2', name: 'Kỹ thuật' },
    { id: 'w3', name: 'Website Team' }, // khop PHAN DAU "Website" (bac 2) - khong duoc tranh voi hai bang ten "Website" (bac 1)
  ]),
  boards: Object.freeze([
    { id: 'b1', name: 'Website', workspaceId: 'w2', workspaceName: 'Kỹ thuật' },
    { id: 'b2', name: 'Website', workspaceId: 'w1', workspaceName: 'Marketing' },
    { id: 'b3', name: 'Sprint 12', workspaceId: 'w2', workspaceName: 'Kỹ thuật' },
    { id: 'b4', name: 'Sprint 13', workspaceId: 'w2', workspaceName: 'Kỹ thuật' },
    { id: 'b5', name: 'Marketing', workspaceId: 'w2', workspaceName: 'Kỹ thuật' },
    { id: 'b6', name: 'Kế hoạch quý 4', workspaceId: 'w1', workspaceName: 'Marketing' },
    { id: 'b7', name: 'Hạ tầng Kỹ thuật', workspaceId: 'w1', workspaceName: 'Marketing' }, // khop LIEN TIEP (bac 3) - khong duoc tranh voi khong gian "Kỹ thuật" (bac 1)
  ]),
  columns: Object.freeze([
    { id: 'c1', name: 'Đang làm', boardId: 'b1' },
    { id: 'c2', name: 'Đang làm', boardId: 'b3' },
    { id: 'c3', name: 'Xong', boardId: 'b3' },
    { id: 'c4', name: 'Xong', boardId: 'b6' },
    { id: 'c5', name: 'Kiểm thử', boardId: 'b1' },
    { id: 'c6', name: 'Đã duyệt', boardId: 'b6' },
  ]),
}) as EntityCatalog;

const MY: ResolveScope = { kind: 'MY', workspace: null, board: null };
const WS: ResolveScope = { kind: 'WORKSPACE', workspace: { id: 'w2', name: 'Kỹ thuật' }, board: null };
const BD: ResolveScope = { kind: 'BOARD', workspace: { id: 'w2', name: 'Kỹ thuật' }, board: { id: 'b3', name: 'Sprint 12' } };
const Q = (intent: CatalogIntent, target: string | null = null, column: string | null = null, tid: string | null = null): CatalogQuestion => ({
  intent,
  target,
  column,
  targetId: tid,
});

/** Rut gon ket qua thanh chuoi de so bang. */
function short(r: CatalogResolution): string {
  if (r.kind === 'NOT_FOUND') return `NOT_FOUND:${r.what}:${r.typed}:${r.targetName}`;
  if (r.kind === 'CLARIFY') return `CLARIFY:${r.refs.map(targetId).join(',')}`;
  return `RESOLVED:${r.target ? targetId(r.target) : '-'}:${r.columns ? r.columns.map((c) => c.id).join(',') : '-'}:${r.columnName ?? '-'}:${r.notes.length}`;
}

describe('resolveCatalogQuestion - ten bang / khong gian', () => {
  it('bang ket qua: mot / nhieu / khong co, theo tung y dinh va pham vi', () => {
    const rows: Array<[string, ResolveScope, CatalogQuestion, string]> = [
      ['bang trung ca ten', MY, Q('CARD_COUNTS', 'Sprint 12'), 'RESOLVED:b3:-:-:0'],
      ['phan dau chi 1 bang', MY, Q('CARD_COUNTS', 'Kế hoạch'), 'RESOLVED:b6:-:-:0'],
      ['khong gian', MY, Q('MEMBER_LIST', 'Kỹ thuật'), 'RESOLVED:w2:-:-:0'],
      ['2 bang cung ten', MY, Q('CARD_COUNTS', 'Website'), 'CLARIFY:b1,b2'],
      ['phan dau nhieu bang', MY, Q('MEMBER_LIST', 'Sprint'), 'CLARIFY:b3,b4'],
      ['bang + khong gian cung ten -> hoi lai ca hai', MY, Q('MEMBER_LIST', 'Marketing'), 'CLARIFY:b5,w1'],
      ['bang trung ca ten thang khong gian chi khop mot phan', MY, Q('CARD_COUNTS', 'Website'), 'CLARIFY:b1,b2'],
      ['khong tim thay', MY, Q('CARD_COUNTS', 'Khong co'), 'NOT_FOUND:BOARD_OR_WORKSPACE:Khong co:null'],
      ['MY_BOARDS chi loc khong gian: khong gian', MY, Q('MY_BOARDS', 'Marketing'), 'RESOLVED:w1:-:-:0'],
      ['MY_BOARDS: ten trung ten bang chi xet khong gian (phan dau cua "Website Team")', MY, Q('MY_BOARDS', 'Website'), 'RESOLVED:w3:-:-:0'],
      ['bac chac nhat thang: ten khong gian trung ca ten, bang chi khop lien tiep', MY, Q('CARD_COUNTS', 'Kỹ thuật'), 'RESOLVED:w2:-:-:0'],
      ['bac chac nhat thang: hai bang trung ca ten, khong gian chi khop phan dau', MY, Q('MEMBER_LIST', 'Website'), 'CLARIFY:b1,b2'],
      ['MY_BOARDS ten bang khong phai khong gian -> khong tim thay khong gian', MY, Q('MY_BOARDS', 'Sprint 12'), 'NOT_FOUND:WORKSPACE:Sprint 12:null'],
      ['tu khoa mo dau bi bo', MY, Q('CARD_COUNTS', 'bảng Sprint 13'), 'RESOLVED:b4:-:-:0'],
      ['khong dau', MY, Q('CARD_COUNTS', 'ke hoach quy 4'), 'RESOLVED:b6:-:-:0'],
    ];
    const wrong = rows.map(([name, scope, q, want]) => ({ name, got: short(resolveCatalogQuestion(scope, q, CAT)), want })).filter((r) => r.got !== r.want);
    expect(wrong).toEqual([]);
  });

  it('id da chon: phai co trong danh muc; bang HOAC khong gian; id la -> khong tim thay, khong lo gi', () => {
    expect(short(resolveCatalogQuestion(MY, Q('CARD_COUNTS', null, null, 'b3'), CAT))).toBe('RESOLVED:b3:-:-:0');
    expect(short(resolveCatalogQuestion(MY, Q('MEMBER_LIST', null, null, 'w1'), CAT))).toBe('RESOLVED:w1:-:-:0');
    expect(short(resolveCatalogQuestion(MY, Q('CARD_COUNTS', null, null, 'b999'), CAT))).toBe('NOT_FOUND:BOARD_OR_WORKSPACE:lựa chọn của bạn:null');
    // id uu tien hon chuoi go
    expect(short(resolveCatalogQuestion(MY, Q('CARD_COUNTS', 'Sprint 12', null, 'b4'), CAT))).toBe('RESOLVED:b4:-:-:0');
    // id ton tai o noi khac nhung KHONG nam trong danh muc cua pham vi -> khong tim thay
    const narrow: EntityCatalog = { workspaces: [{ id: 'w2', name: 'Kỹ thuật' }], boards: [CAT.boards[2]], columns: [] };
    expect(short(resolveCatalogQuestion(MY, Q('CARD_COUNTS', null, null, 'b6'), narrow))).toBe('NOT_FOUND:BOARD_OR_WORKSPACE:lựa chọn của bạn:null');
  });

  it('ten khong dung toi (y dinh khong dung ten / pham vi da hep) -> bo qua kem ghi chu, khong doi ket qua', () => {
    const cases: Array<[string, ResolveScope, CatalogQuestion]> = [
      ['MY_WORKSPACES', MY, Q('MY_WORKSPACES', 'Marketing')],
      ['MY_BOARDS o pham vi KHONG GIAN', WS, Q('MY_BOARDS', 'Marketing')],
      ['MY_BOARDS o pham vi BANG', BD, Q('MY_BOARDS', 'Marketing')],
    ];
    for (const [name, scope, q] of cases) {
      const r = resolveCatalogQuestion(scope, q, CAT);
      expect(r, name).toMatchObject({ kind: 'RESOLVED', target: null, columns: null });
      expect(r.kind === 'RESOLVED' ? r.notes : [], name).toHaveLength(1);
    }
    // pham vi hep: CARD_COUNTS / MEMBER_LIST van dung ten (ten phai nam trong danh muc cua pham vi)
    expect(short(resolveCatalogQuestion(WS, Q('CARD_COUNTS', 'Sprint 13'), CAT))).toBe('RESOLVED:b4:-:-:0');
  });

  it('MEMBER_LIST khong ten: mac dinh theo pham vi (bang / khong gian); pham vi ca nhan -> khong tim thay (dich vu hoi lai truoc)', () => {
    expect(short(resolveCatalogQuestion(BD, Q('MEMBER_LIST'), CAT))).toBe('RESOLVED:b3:-:-:0');
    expect(short(resolveCatalogQuestion(WS, Q('MEMBER_LIST'), CAT))).toBe('RESOLVED:w2:-:-:0');
    expect(short(resolveCatalogQuestion(MY, Q('MEMBER_LIST'), CAT))).toBe('NOT_FOUND:BOARD_OR_WORKSPACE:bảng hoặc không gian bạn hỏi:null');
    // CARD_COUNTS / MY_BOARDS khong ten: khong doat mac dinh (truy van tu dung pham vi)
    expect(short(resolveCatalogQuestion(BD, Q('CARD_COUNTS'), CAT))).toBe('RESOLVED:-:-:-:0');
    // pham vi BANG ma bang khong co trong danh muc (khong nen xay ra): van lay tu pham vi
    const target = scopeDefaultTarget(BD, { workspaces: [], boards: [], columns: [] });
    expect(target && targetId(target)).toBe('b3');
    expect(target && targetLabel(target)).toBe('Bảng Sprint 12 (Kỹ thuật)');
    expect(scopeDefaultTarget({ kind: 'BOARD', workspace: null, board: { id: 'x', name: 'X' } }, CAT)).toBeNull();
    expect(scopeDefaultTarget(MY, CAT)).toBeNull();
  });
});

describe('resolveCatalogQuestion - ten cot', () => {
  it('chi CARD_COUNTS loc cot; ten cot chi tim trong cac bang thuoc pham vi / bang da chon', () => {
    const rows: Array<[string, ResolveScope, CatalogQuestion, string]> = [
      ['cot o moi bang (2 cot cung ten)', MY, Q('CARD_COUNTS', null, 'Đang làm'), 'RESOLVED:-:c1,c2:Đang làm:0'],
      ['cot cua mot bang', MY, Q('CARD_COUNTS', 'Sprint 12', 'Xong'), 'RESOLVED:b3:c3:Xong:0'],
      ['cot cua bang khac khong lot vao', MY, Q('CARD_COUNTS', 'Sprint 12', 'Kiểm thử'), 'NOT_FOUND:COLUMN:Kiểm thử:Sprint 12'],
      ['cot theo khong gian', MY, Q('CARD_COUNTS', 'Marketing', 'Xong'), 'CLARIFY:b5,w1'], // "Marketing" van la ten lap
      ['cot o pham vi BANG mac dinh bang do', BD, Q('CARD_COUNTS', null, 'Đang làm'), 'RESOLVED:-:c2:Đang làm:0'],
      ['khong dau', MY, Q('CARD_COUNTS', null, 'dang lam'), 'RESOLVED:-:c1,c2:Đang làm:0'],
      ['phan dau ten cot', MY, Q('CARD_COUNTS', null, 'Kiểm'), 'RESOLVED:-:c5:Kiểm thử:0'],
      ['khong co cot', MY, Q('CARD_COUNTS', null, 'Không có'), 'NOT_FOUND:COLUMN:Không có:null'],
      ['chi mot chu cai khong phai la tu', MY, Q('CARD_COUNTS', null, 'Đ'), 'NOT_FOUND:COLUMN:Đ:null'],
    ];
    const wrong = rows.map(([name, scope, q, want]) => ({ name, got: short(resolveCatalogQuestion(scope, q, CAT)), want })).filter((r) => r.got !== r.want);
    expect(wrong).toEqual([]);
    // pham vi KHONG GIAN: danh muc do server nap DA thu hep theo pham vi (chat.catalog.loadCatalog) -> chi cot cua bang trong khong gian
    const boardsW2 = CAT.boards.filter((b) => b.workspaceId === 'w2');
    const narrow: EntityCatalog = {
      workspaces: [CAT.workspaces[1]],
      boards: boardsW2,
      columns: CAT.columns.filter((c) => boardsW2.some((b) => b.id === c.boardId)),
    };
    expect(short(resolveCatalogQuestion(WS, Q('CARD_COUNTS', null, 'Xong'), narrow))).toBe('RESOLVED:-:c3:Xong:0');
    // hai cot khac ten cung khop mot chuoi go: columnName = chuoi go
    const two = resolveCatalogQuestion(MY, Q('CARD_COUNTS', null, 'Đang'), { ...CAT, columns: [{ id: 'c7', name: 'Đang làm', boardId: 'b1' }, { id: 'c8', name: 'Đang sửa', boardId: 'b1' }] });
    expect(two).toMatchObject({ kind: 'RESOLVED', columnName: 'Đang' });
    expect(short(two)).toBe('RESOLVED:-:c7,c8:Đang:0');
  });

  it('cot cua khong gian: chi cot cua cac bang trong khong gian do; y dinh khac khong loc cot (ghi chu)', () => {
    const r = resolveCatalogQuestion(MY, Q('CARD_COUNTS', null, 'Xong', 'w1'), CAT);
    expect(short(r)).toBe('RESOLVED:w1:c4:Xong:0');
    const list = resolveCatalogQuestion(MY, Q('MEMBER_LIST', 'Sprint 12', 'Xong'), CAT);
    expect(list).toMatchObject({ kind: 'RESOLVED', columns: null, columnName: null });
    expect(list.kind === 'RESOLVED' ? list.notes : []).toEqual(['Trợ lý chưa lọc theo cột cho loại câu hỏi này.']);
  });
});

describe('ham tro giup + tinh thuan', () => {
  it('targetId / targetName / targetLabel', () => {
    const board = resolveCatalogQuestion(MY, Q('CARD_COUNTS', 'Sprint 12'), CAT);
    const space = resolveCatalogQuestion(MY, Q('MEMBER_LIST', 'Kỹ thuật'), CAT);
    if (board.kind !== 'RESOLVED' || space.kind !== 'RESOLVED' || !board.target || !space.target) throw new Error('phai khop');
    expect([targetId(board.target), targetName(board.target), targetLabel(board.target)]).toEqual(['b3', 'Sprint 12', 'Bảng Sprint 12 (Kỹ thuật)']);
    expect([targetId(space.target), targetName(space.target), targetLabel(space.target)]).toEqual(['w2', 'Kỹ thuật', 'Không gian Kỹ thuật']);
  });

  it('khong sua dau vao (danh muc dong bang), tat dinh', () => {
    const q = Object.freeze(Q('CARD_COUNTS', 'Website', 'Đang làm'));
    const a = resolveCatalogQuestion(MY, q, CAT);
    const b = resolveCatalogQuestion(MY, q, CAT);
    expect(b).toEqual(a);
    expect(a.kind).toBe('CLARIFY');
  });
});
