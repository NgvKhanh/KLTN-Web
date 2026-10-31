// Dung cau tra loi danh muc theo MAU (CHATBOT_MODULE.md §18).
//
// HAM THUAN: nhan ket qua da tinh (chat.catalog) + thong tin pham vi, tra ve ChatAnswer. Moi con so trong cau dan lay
// tu so da dem - khong co so nao duoc "viet ra" o day (co test kiem). LLM KHONG tham gia buoc nay.

import { MAX_CLARIFY_OPTIONS, base, quote, scopeWhere, type ChatAnswer, type ChatFact, type ChatTable, type ScopeInfo } from './chat.answer';
import type {
  BoardRoleCode,
  BoardsResult,
  CatalogResult,
  CountsResult,
  MembersResult,
  WorkspaceRoleCode,
  WorkspacesResult,
} from './chat.catalog';
import type { CatalogIntent } from './chat.intent';

/**
 * Cau hoi goi y sau moi loai cau tra loi danh muc. Moi cau PHAI duoc bo luat hieu dung y dinh no hua (co test) va
 * KHONG chua ten bang / khong gian cu the (danh muc ten khac nhau moi nguoi).
 */
export const CATALOG_SUGGESTIONS: Readonly<Record<CatalogIntent, readonly string[]>> = {
  MY_BOARDS: ['Tôi thuộc những không gian nào?', 'Mỗi bảng có bao nhiêu thẻ?'],
  MY_WORKSPACES: ['Tôi đang ở bao nhiêu bảng?', 'Không gian này có bao nhiêu người?'],
  MEMBER_LIST: ['Bảng này có bao nhiêu thẻ?', 'Ai đang có nhiều việc?'],
  CARD_COUNTS: ['Tôi đang ở bao nhiêu bảng?', 'Bảng này có những ai?'],
};

const BOARD_ROLE: Record<BoardRoleCode, string> = {
  OWNER: 'Chủ bảng',
  ADMIN: 'Quản trị viên',
  MEMBER: 'Thành viên',
  VIEWER: 'Người xem',
};
const WORKSPACE_ROLE: Record<WorkspaceRoleCode, string> = {
  OWNER: 'Chủ sở hữu',
  ADMIN: 'Quản trị viên',
  MEMBER: 'Thành viên',
};
const VIA_WORKSPACE = 'Xem nhờ không gian';

const COUNT_NOTE = 'Đếm các thẻ còn hiệu lực (chưa xoá, chưa lưu trữ); "đã xong" là thẻ được đánh dấu hoàn thành.';

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function cutNote(shown: number, total: number, unit: string): string[] {
  return total > shown ? [`Chỉ hiện ${shown} ${unit} đầu tiên trong tổng ${total}.`] : [];
}

function table(columns: string[], rows: ChatTable['rows'], total: number): ChatTable {
  return { columns, rows, total };
}

// ===================== MY_BOARDS =====================

function boardsAnswer(r: BoardsResult, scope: ScopeInfo, now: Date): ChatAnswer {
  let text: string;
  if (scope.kind === 'BOARD') {
    const b = r.rows[0];
    text = b
      ? `Bạn đang xem bảng ${quote(b.name)} (không gian ${quote(b.workspaceName)}). ${b.myRole === null ? 'Bạn xem được bảng này nhờ không gian.' : `Vai trò của bạn: ${BOARD_ROLE[b.myRole].toLowerCase()}.`}`
      : 'Không tìm thấy bảng này.';
  } else if (r.total === 0) {
    const ws = r.workspaceName ?? scope.workspaceName;
    text = ws === null ? 'Bạn chưa xem được bảng nào.' : `Không có bảng nào trong không gian ${quote(ws)} mà bạn xem được.`;
  } else {
    const ws = r.workspaceName ?? (scope.kind === 'WORKSPACE' ? scope.workspaceName : null);
    const head = ws === null ? `Bạn xem được ${r.total} bảng` : `Không gian ${quote(ws)} có ${r.total} bảng bạn xem được`;
    text = `${head}, trong đó bạn tham gia trực tiếp ${r.direct} bảng.`;
  }
  const answer = base(scope, now, 'ANSWER', text);
  answer.facts = [
    { key: 'total', label: 'Bảng xem được', value: r.total },
    { key: 'direct', label: 'Tham gia trực tiếp', value: r.direct },
    { key: 'viaWorkspace', label: 'Chỉ xem nhờ không gian', value: r.total - r.direct },
  ];
  answer.table = table(
    ['Bảng', 'Không gian', 'Bạn là'],
    r.rows.map((b) => ({ cells: [b.name, b.workspaceName, b.myRole === null ? VIA_WORKSPACE : BOARD_ROLE[b.myRole]], boardId: b.id })),
    r.total
  );
  answer.notes = [
    ...cutNote(r.rows.length, r.total, 'bảng'),
    'Chỉ tính bảng bạn có quyền đọc (chủ bảng, thành viên, hoặc bảng hiển thị cho cả không gian); không tính bảng công khai bạn chưa tham gia.',
  ];
  return answer;
}

// ===================== MY_WORKSPACES =====================

function workspacesAnswer(r: WorkspacesResult, scope: ScopeInfo, now: Date): ChatAnswer {
  const n = r.rows.length;
  let text: string;
  if (n === 0) text = 'Bạn chưa thuộc không gian nào trong phạm vi này.';
  else if (scope.kind === 'MY') text = `Bạn thuộc ${n} không gian làm việc.`;
  else text = `Bạn thuộc không gian ${quote(r.rows[0].name)} với vai trò ${WORKSPACE_ROLE[r.rows[0].myRole].toLowerCase()}.`;
  const answer = base(scope, now, 'ANSWER', text);
  answer.facts = [{ key: 'workspaces', label: 'Không gian', value: n }];
  answer.table = table(
    ['Không gian', 'Vai trò của bạn', 'Bảng bạn xem được', 'Thành viên'],
    r.rows.map((w) => ({ cells: [w.isPersonal ? `${w.name} (cá nhân)` : w.name, WORKSPACE_ROLE[w.myRole], w.boards, w.members] })),
    n
  );
  answer.notes = ['"Bảng bạn xem được" chỉ tính bảng bạn có quyền đọc, không phải mọi bảng của không gian.'];
  return answer;
}

// ===================== MEMBER_LIST =====================

function membersAnswer(r: MembersResult, scope: ScopeInfo, now: Date): ChatAnswer {
  const subject = r.subject.type === 'BOARD' ? `Bảng ${quote(r.subject.name)}` : `Không gian ${quote(r.subject.name)}`;
  const answer = base(scope, now, 'ANSWER', r.total === 0 ? `${subject} chưa có thành viên nào.` : `${subject} có ${r.total} thành viên.`);
  answer.facts = [{ key: 'members', label: 'Thành viên', value: r.total }];
  const label = (role: MembersResult['rows'][number]['role']): string =>
    r.subject.type === 'BOARD' ? BOARD_ROLE[role as BoardRoleCode] : WORKSPACE_ROLE[role as WorkspaceRoleCode];
  answer.table = table(['Tên', 'Vai trò'], r.rows.map((p) => ({ cells: [p.name, label(p.role)] })), r.total);
  answer.notes = ['Chỉ hiện tên và vai trò.', ...cutNote(r.rows.length, r.total, 'người')];
  if (r.workspaceWide) {
    answer.notes.push(
      `Bảng hiển thị cho cả không gian ${quote(r.workspaceWide.workspaceName)} (${r.workspaceWide.people} người), nên mọi thành viên của không gian đều xem được.`
    );
  }
  return answer;
}

// ===================== CARD_COUNTS =====================

function countsAnswer(r: CountsResult, columnLabel: string | null, scope: ScopeInfo, now: Date): ChatAnswer {
  const total = r.open + r.done;
  const where = r.mode === 'BY_COLUMN' ? `bảng ${quote(r.subject ?? '')}` : r.subject !== null ? `không gian ${quote(r.subject)}` : scopeWhere(scope);
  const cols = r.columnFilter === null ? null : columnLabel !== null ? `cột ${quote(columnLabel)}` : `${r.columnFilter.matched} cột khớp`;
  const detail = `${total} thẻ: ${r.open} chưa xong, ${r.done} đã hoàn thành`;
  let text: string;
  if (r.mode === 'BY_COLUMN') {
    text = cols === null ? `${capitalize(where)} có ${detail}.` : `${capitalize(cols)} của ${where} có ${detail}.`;
  } else {
    const tail = cols === null ? '' : ` ở ${cols}`;
    text = total === 0 ? `Trong ${where} chưa có thẻ nào${tail}.` : `Trong ${where} có ${detail}${tail}, trên ${r.total} bảng.`;
  }
  const answer = base(scope, now, 'ANSWER', text);
  const facts: ChatFact[] = [
    { key: 'total', label: 'Tổng số thẻ', value: total },
    { key: 'open', label: 'Chưa xong', value: r.open },
    { key: 'done', label: 'Đã hoàn thành', value: r.done },
  ];
  answer.facts = facts;
  answer.table =
    r.mode === 'BY_COLUMN'
      ? table(['Cột', 'Chưa xong', 'Đã xong', 'Tổng'], r.rows.map((x) => ({ cells: [x.label, x.open, x.done, x.open + x.done] })), r.total)
      : table(
          ['Bảng', 'Không gian', 'Chưa xong', 'Đã xong', 'Tổng'],
          r.rows.map((x) => ({ cells: [x.label, x.workspaceName ?? '', x.open, x.done, x.open + x.done], boardId: x.boardId })),
          r.total
        );
  answer.notes = [COUNT_NOTE, ...cutNote(r.rows.length, r.total, r.mode === 'BY_COLUMN' ? 'cột' : 'bảng')];
  return answer;
}

// ===================== Diem vao =====================

/** Cau tra loi cho mot truy van danh muc da chay. `notes` = ghi chu tham so bi bo qua (chat.catalog.answerCatalog). */
export function renderCatalog(input: {
  intent: CatalogIntent;
  result: CatalogResult;
  scope: ScopeInfo;
  now: Date;
  /** CARD_COUNTS: ten cot da nhan dien (neu co loc cot). */
  columnLabel?: string | null;
  notes?: readonly string[];
}): ChatAnswer {
  const { result, scope, now } = input;
  let answer: ChatAnswer;
  switch (result.kind) {
    case 'BOARDS':
      answer = boardsAnswer(result, scope, now);
      break;
    case 'WORKSPACES':
      answer = workspacesAnswer(result, scope, now);
      break;
    case 'MEMBERS':
      answer = membersAnswer(result, scope, now);
      break;
    case 'COUNTS':
      answer = countsAnswer(result, input.columnLabel ?? null, scope, now);
      break;
  }
  answer.notes = [...(input.notes ?? []), ...answer.notes];
  answer.suggestions = [...CATALOG_SUGGESTIONS[input.intent]];
  return answer;
}

export interface TargetOption {
  id: string;
  label: string;
}

/** Nhieu bang / khong gian khop ten go -> nut chon (§18.4). */
export function renderClarifyTarget(typed: string, options: readonly TargetOption[], scope: ScopeInfo, now: Date): ChatAnswer {
  const shown = options.slice(0, MAX_CLARIFY_OPTIONS);
  const question = 'Ý bạn là cái nào?';
  const answer = base(scope, now, 'CLARIFY', `Có nhiều bảng hoặc không gian khớp với ${quote(typed)}. ${question}`);
  answer.clarify = { question, options: shown.map((o) => ({ id: o.id, label: o.label, kind: 'TARGET' as const })) };
  if (options.length > shown.length) answer.notes = ['Hãy gõ thêm tên để thu hẹp danh sách.'];
  return answer;
}

/** Khong tim thay ten trong pham vi - KHONG noi no co ton tai o noi khac hay khong (§18.3). */
export function renderTargetNotFound(typed: string, what: 'BOARD_OR_WORKSPACE' | 'WORKSPACE' | 'COLUMN', scope: ScopeInfo, now: Date): ChatAnswer {
  const noun = what === 'COLUMN' ? 'cột' : what === 'WORKSPACE' ? 'không gian' : 'bảng hoặc không gian';
  const answer = base(scope, now, 'ANSWER', `Không tìm thấy ${noun} ${quote(typed)} trong ${scopeWhere(scope)}.`);
  answer.suggestions = ['Tôi đang ở bao nhiêu bảng?', 'Tôi thuộc những không gian nào?'];
  return answer;
}
