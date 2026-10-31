// DO THI PHU THUOC giua cac thao tac cua mot ke hoach (CHATBOT_V2_ACTIONS_PLAN.md, Phase 2). HAM THUAN: khong CSDL, khong dong ho.
//
// Mot thao tac co the tro toi cot / the do CHINH ke hoach tao ra bang {by:'PLAN', key}. Thu tu chay KHONG dua vao thu tu trong mang
// mot cach mo ho: ta dung canh phu thuoc (thao tac nao dung ket qua cua thao tac nao) roi sap xep topo; chi khi hai thao tac khong
// phu thuoc nhau moi giu thu tu nguoi dung/ LLM viet (on dinh).
//
// Kiem tra theo THU TU nay (loi dau tien thang): trung key -> tham chieu thieu -> VONG (ke ca tu tro chinh minh) -> sai loai
// (khoa the dua vao o cot...) -> vuot gioi han. Tach `analyzeGraph` ra khoi loai thao tac de kiem thu duoc bang du lieu tong hop.

import { BOARD_ADMIN_TYPES, BOARD_REMOVING_TYPES, DEFAULT_LIMITS, type ActionOp, type PlanLimits, type Ref } from './actions.schema';
import { foldedName, referencedSignatures, slotsOf, withRef, type Slot } from './actions.refs';
import { RULE_ONLY_TEXT } from './actions.rule';

export type GraphErrorCode = 'DUPLICATE_KEY' | 'MISSING_REF' | 'CYCLE' | 'WRONG_KIND' | 'DUPLICATE_NAME' | 'RULE_NOT_ALONE' | 'ADMIN_NOT_ALONE';
export type LimitErrorCode = 'TOO_MANY_OPS' | 'TOO_MANY_CARDS' | 'TOO_MANY_LISTS' | 'TOO_MANY_REFS';

export type NodeKind = 'LIST' | 'CARD';
export interface GraphRef {
  key: string;
  /** Loai thuc the ma o nhan tham chieu can (cot / the / nguoi / nhan). Chi LIST / CARD co the do ke hoach tao. */
  expects: 'LIST' | 'CARD' | 'MEMBER' | 'LABEL';
}
export interface GraphNode {
  /** Co key = thao tac nay TAO ra mot thuc the va co the duoc tro toi. */
  key?: string;
  creates?: NodeKind;
  refs: GraphRef[];
}

export type GraphResult =
  | { ok: true; /** chi so thao tac theo thu tu chay. */ order: number[]; /** deps[i] = cac chi so ma i phu thuoc. */ deps: number[][] }
  | { ok: false; code: GraphErrorCode; text: string; at?: number };

const NO_CHANGE = 'Chưa thay đổi gì.';
const ADMIN_ONLY_TEXT = `Thao tác quản trị bảng (thành viên, quyền, hiển thị, link mời, lưu trữ hay xóa bảng) cần được làm riêng: xóa / lưu trữ bảng một mình, các thao tác quản trị khác không kèm việc ở thẻ hay cột. Hãy tách thành từng lệnh. ${NO_CHANGE}`;
const label = (i: number) => `thao tác ${i + 1}`;

export function analyzeGraph(nodes: readonly GraphNode[]): GraphResult {
  const byKey = new Map<string, number>();
  for (const [i, node] of nodes.entries()) {
    if (node.key === undefined) continue;
    const prior = byKey.get(node.key);
    if (prior !== undefined) {
      return { ok: false, code: 'DUPLICATE_KEY', at: i, text: `Hai thao tác (${label(prior)} và ${label(i)}) dùng chung khoá “${node.key}”. ${NO_CHANGE}` };
    }
    byKey.set(node.key, i);
  }

  const deps: number[][] = nodes.map(() => []);
  for (const [i, node] of nodes.entries()) {
    for (const ref of node.refs) {
      const target = byKey.get(ref.key);
      if (target === undefined) {
        return { ok: false, code: 'MISSING_REF', at: i, text: `${label(i)} nhắc tới “${ref.key}” nhưng kế hoạch không có thao tác nào tạo ra nó. ${NO_CHANGE}` };
      }
      if (!deps[i].includes(target)) deps[i].push(target);
    }
  }

  // vong (ke ca thao tac tro chinh minh): Kahn - neu con nut chua xep duoc thi co vong
  const indegree = deps.map((d) => d.length);
  const users: number[][] = nodes.map(() => []);
  deps.forEach((d, i) => d.forEach((t) => users[t].push(i)));
  const order: number[] = [];
  const ready = new Set<number>(indegree.flatMap((n, i) => (n === 0 ? [i] : [])));
  while (ready.size > 0) {
    const next = Math.min(...ready); // on dinh: thao tac viet truoc chay truoc khi khong phu thuoc nhau
    ready.delete(next);
    order.push(next);
    for (const u of users[next]) {
      indegree[u] -= 1;
      if (indegree[u] === 0) ready.add(u);
    }
  }
  if (order.length !== nodes.length) {
    const stuck = nodes.map((_, i) => i).filter((i) => !order.includes(i));
    return { ok: false, code: 'CYCLE', at: stuck[0], text: `Các thao tác (${stuck.map((i) => label(i)).join(', ')}) phụ thuộc vòng vào nhau nên không xác định được thứ tự. ${NO_CHANGE}` };
  }

  for (const [i, node] of nodes.entries()) {
    for (const ref of node.refs) {
      const target = nodes[byKey.get(ref.key) as number];
      if (target.creates !== ref.expects) {
        const what = { LIST: 'cột', CARD: 'thẻ', MEMBER: 'người', LABEL: 'nhãn' }[ref.expects];
        return { ok: false, code: 'WRONG_KIND', at: i, text: `${label(i)} cần ${what} nhưng “${ref.key}” không phải ${what} mới được tạo trong kế hoạch. ${NO_CHANGE}` };
      }
    }
  }
  return { ok: true, order, deps };
}

/** Do thi cua mot danh sach thao tac (sau khi da tu noi tham chieu: xem `linkLocalRefs`). */
export function graphNodesOf(ops: readonly ActionOp[]): GraphNode[] {
  return ops.map((op) => {
    const refs: GraphRef[] = [];
    for (const slot of slotsOf(op)) {
      if (slot.ref?.by === 'PLAN') refs.push({ key: slot.ref.key, expects: slot.kind.toUpperCase() as GraphRef['expects'] });
    }
    if (op.type === 'CREATE_LIST') return { ...(op.key !== undefined ? { key: op.key } : {}), creates: 'LIST' as const, refs };
    if (op.type === 'CREATE_CARD') return { ...(op.key !== undefined ? { key: op.key } : {}), creates: 'CARD' as const, refs };
    return { refs };
  });
}

export type LimitResult = { ok: true } | { ok: false; code: LimitErrorCode; text: string };

/** Gioi han cua mot ke hoach. Nam o backend: LLM co "lam ngo" de xuat bao nhieu thao tac thi cung khong qua duoc day. */
export function checkLimits(ops: readonly ActionOp[], limits: PlanLimits = DEFAULT_LIMITS, split = 'Hãy chia nhỏ lệnh và gửi từng phần. Chưa thay đổi gì.'): LimitResult {
  if (ops.length > limits.maxOps) {
    return { ok: false, code: 'TOO_MANY_OPS', text: `Lệnh này có ${ops.length} thao tác, nhiều hơn mức tối đa ${limits.maxOps} thao tác mỗi lần. ${split}` };
  }
  const cards = ops.filter((o) => o.type === 'CREATE_CARD').length;
  if (cards > limits.maxCards) {
    return { ok: false, code: 'TOO_MANY_CARDS', text: `Lệnh này tạo ${cards} thẻ, nhiều hơn mức tối đa ${limits.maxCards} thẻ mỗi lần. ${split}` };
  }
  const lists = ops.filter((o) => o.type === 'CREATE_LIST').length;
  if (lists > limits.maxLists) {
    return { ok: false, code: 'TOO_MANY_LISTS', text: `Lệnh này tạo ${lists} cột, nhiều hơn mức tối đa ${limits.maxLists} cột mỗi lần. ${split}` };
  }
  const refs = referencedSignatures(ops).size;
  if (refs > limits.maxRefs) {
    return { ok: false, code: 'TOO_MANY_REFS', text: `Lệnh này nhắc tới ${refs} thẻ / cột / người / nhãn có sẵn, nhiều hơn mức tối đa ${limits.maxRefs}. ${split}` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------------------------------
// Tu noi chu thanh tham chieu noi bo
// ---------------------------------------------------------------------------------------------------------------------

export type LinkResult = { ok: true; ops: ActionOp[]; linked: number; /** Cau giai thich cho nguoi dung khi "no" duoc hieu la the / cot moi. */ notes: string[] } | { ok: false; code: GraphErrorCode; text: string };

const AUTO_KEY = (i: number) => `_${i}`; // PLAN_KEY_RE bat dau bang chu cai nen khong bao gio trung key cua nguoi dung / LLM

/**
 * Gemini hay viet "giao Unit Test cho Nam" (chu) thay vi dung key. Neu mot tham chieu CHU o o cot / the khop DUNG ten cot / the ma
 * chinh ke hoach tao ra thi do la the do (neu khong, luc tao cot "Kiem thu" no se khong tim thay chinh cot do). Moi thao tac tao
 * duoc gan key tu dong khi LLM khong dat. Hai thao tac tao cung ten trong mot ke hoach -> loi (khong the biet tro cai nao).
 *
 * "Tao task X roi gan nhan Backend cho NO": trong cung mot cau, "no" la thuc the vua duoc nhac gan nhat. Tham chieu CONTEXT (LAST_CARD /
 * LAST_LIST) o mot thao tac dung SAU thao tac tao the / cot thi tro toi thao tac tao do chu khong phai the cu cua cuoc tro chuyen (neu khong,
 * nhan se gan nham the cu). Truoc thao tac tao nao thi giu nguyen CONTEXT. Luon kem ghi chu de nguoi dung kiem tra o ban xem truoc.
 */
export function linkLocalRefs(ops: readonly ActionOp[]): LinkResult {
  const lists = new Map<string, number>();
  const cards = new Map<string, number>();
  for (const [i, op] of ops.entries()) {
    if (op.type !== 'CREATE_LIST' && op.type !== 'CREATE_CARD') continue;
    const book = op.type === 'CREATE_LIST' ? lists : cards;
    const name = foldedName(op.type === 'CREATE_LIST' ? op.name : op.title);
    if (name !== '' && book.has(name)) {
      const what = op.type === 'CREATE_LIST' ? 'cột' : 'thẻ';
      return { ok: false, code: 'DUPLICATE_NAME', text: `Kế hoạch tạo hai ${what} cùng tên “${op.type === 'CREATE_LIST' ? op.name : op.title}” (${label(book.get(name) as number)} và ${label(i)}). Hãy dùng tên khác nhau. Chưa thay đổi gì.` };
    }
    if (name !== '') book.set(name, i);
  }

  let linked = 0;
  const notes: string[] = [];
  const out = ops.map((original, i) => {
    let op: ActionOp = original;
    if ((op.type === 'CREATE_LIST' || op.type === 'CREATE_CARD') && op.key === undefined) op = { ...op, key: AUTO_KEY(i) };
    for (const slot of slotsOf(op)) {
      const hit = localTarget(slot, lists, cards) ?? nearestCreated(ops, i, slot);
      if (hit === undefined) continue;
      const target = ops[hit];
      if (target.type !== 'CREATE_LIST' && target.type !== 'CREATE_CARD') continue;
      const ref: Ref = { by: 'PLAN', key: target.key ?? AUTO_KEY(hit) };
      if (slot.ref?.by === 'CONTEXT') {
        const note = target.type === 'CREATE_LIST' ? `“nó” được hiểu là cột MỚI “${target.name}” (vừa tạo trong kế hoạch này).` : `“nó” được hiểu là thẻ MỚI “${target.title}” (vừa tạo trong kế hoạch này).`;
        if (!notes.includes(note)) notes.push(note);
      }
      op = withRef(op, slot.name, ref);
      linked += 1;
    }
    return op;
  });
  return { ok: true, ops: out, linked, notes };
}

/** Thao tac tao cot / the gan nhat DUNG TRUOC thao tac thu `at` (theo thu tu de xuat), cho tham chieu CONTEXT "no". */
function nearestCreated(ops: readonly ActionOp[], at: number, slot: Slot): number | undefined {
  if (slot.ref?.by !== 'CONTEXT') return undefined;
  const want = slot.kind === 'card' && slot.ref.slot === 'LAST_CARD' ? 'CREATE_CARD' : slot.kind === 'list' && slot.ref.slot === 'LAST_LIST' ? 'CREATE_LIST' : null;
  if (want === null) return undefined;
  for (let j = at - 1; j >= 0; j -= 1) if (ops[j].type === want) return j;
  return undefined;
}

function localTarget(slot: Slot, lists: ReadonlyMap<string, number>, cards: ReadonlyMap<string, number>): number | undefined {
  if (slot.ref?.by !== 'TEXT') return undefined;
  const name = foldedName(slot.ref.text);
  if (slot.kind === 'list') return lists.get(name);
  if (slot.kind === 'card') return cards.get(name);
  return undefined;
}

export type PlanShape = { ok: true; ops: ActionOp[]; /** thu tu chay: chi so vao `ops` */ order: number[]; linked: number; notes: string[] } | { ok: false; code: GraphErrorCode | LimitErrorCode; text: string };

/** Hinh dang cua de xuat: gioi han -> tu noi -> do thi. Chua cham CSDL. `ops` tra ve da duoc gan key + noi tham chieu. */
export function shapePlan(proposed: readonly ActionOp[], limits: PlanLimits = DEFAULT_LIMITS, split?: string): PlanShape {
  // Phase 7: luat tu dong hoa chay mai mai nen duoc tao RIENG (mot lenh = mot luat, khong kem thao tac nao khac / khong tro toi cot do ke hoach tao)
  if (proposed.some((o) => o.type === 'CREATE_AUTOMATION_RULE') && proposed.length > 1) return { ok: false, code: 'RULE_NOT_ALONE', text: RULE_ONLY_TEXT };
  // Buoc I: xoa / luu tru ca bang dung mot minh; thao tac quan tri khac chi tron voi thao tac quan tri (khong lan voi viec o the / cot)
  const admin = proposed.filter((o) => (BOARD_ADMIN_TYPES as readonly string[]).includes(o.type));
  if (admin.length > 0 && (proposed.some((o) => (BOARD_REMOVING_TYPES as readonly string[]).includes(o.type)) ? proposed.length > 1 : admin.length !== proposed.length)) {
    return { ok: false, code: 'ADMIN_NOT_ALONE', text: ADMIN_ONLY_TEXT };
  }
  const within = checkLimits(proposed, limits, split);
  if (!within.ok) return within;
  const linked = linkLocalRefs(proposed);
  if (!linked.ok) return linked;
  const graph = analyzeGraph(graphNodesOf(linked.ops));
  if (!graph.ok) return { ok: false, code: graph.code, text: graph.text };
  return { ok: true, ops: linked.ops, order: graph.order, linked: linked.linked, notes: linked.notes };
}
