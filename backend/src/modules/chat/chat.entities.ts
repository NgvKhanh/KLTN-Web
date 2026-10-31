// Danh muc ten bang / khong gian / cot va so khop ten (CHATBOT_MODULE.md §18.4).
//
// HAM THUAN, khong DB. "Danh muc" (EntityCatalog) do server doc tu CSDL theo pham vi roi truyen vao
// (chat.catalog); danh muc nay KHONG BAO GIO duoc gui cho LLM - chi bo luat va buoc nhan dien o server thay ten.
//
// Quy tac so tu giong ten nguoi (§8.2): so NGUYEN TU, hai tu deu co dau -> so ban co dau, con lai -> so ban
// khong dau. Khac ten nguoi: khop theo BAC - trung ca ten > la PHAN DAU cua ten > nam lien tiep trong ten -
// vi ten bang thuong duoc go thieu duoi ("Kế hoạch Marketing" cho "Kế hoạch Marketing ra mắt...").

import { sameWord, tokenize, type Token } from './chat.members';

export interface NamedEntity {
  id: string;
  name: string;
}
export interface BoardEntity extends NamedEntity {
  workspaceId: string;
  workspaceName: string;
}
export interface ColumnEntity extends NamedEntity {
  boardId: string;
}

export interface EntityCatalog {
  boards: BoardEntity[];
  workspaces: NamedEntity[];
  columns: ColumnEntity[];
}

export const EMPTY_CATALOG: EntityCatalog = { boards: [], workspaces: [], columns: [] };

/** So thuc the toi da moi loai (khong gian that nho hon nhieu). */
export const MAX_BOARDS = 500;
export const MAX_WORKSPACES = 100;
export const MAX_COLUMNS = 3000;
/** Ten dai hon so tu nay chi xet phan dau (chan dau vao bat thuong). */
export const MAX_ENTITY_TOKENS = 12;

/** `tier`: 1 = trung ca ten, 2 = phan dau cua ten, 3 = nam lien tiep trong ten (bac cang thap cang chac). */
export type EntityMatch<T> = { kind: 'ONE'; item: T; tier: 1 | 2 | 3 } | { kind: 'MANY'; items: T[]; tier: 1 | 2 | 3 } | { kind: 'NONE' };

// Tu khoa mo dau nguoi dung hay go kem ("bảng abc", "cột Đang làm", "không gian Nhóm A") - bo khi so khop.
const CUE_SEQUENCES: readonly (readonly string[])[] = [['bang'], ['cot'], ['khong', 'gian'], ['danh', 'sach'], ['workspace'], ['board'], ['list']];

function cueLengthAt(tokens: readonly Token[], i: number): number {
  for (const cue of CUE_SEQUENCES) {
    if (i + cue.length <= tokens.length && cue.every((w, k) => tokens[i + k].fold === w)) return cue.length;
  }
  return 0;
}

/** Bo cac tu khoa mo dau, mien la con lai it nhat 1 tu. */
function stripCues(tokens: Token[]): Token[] {
  let i = 0;
  for (;;) {
    const n = cueLengthAt(tokens, i);
    if (n === 0 || i + n >= tokens.length) break;
    i += n;
  }
  return tokens.slice(i);
}

/** Tach tu ten thuc the (toi da MAX_ENTITY_TOKENS tu dau). */
export function entityTokens(name: string): Token[] {
  const t = tokenize(name);
  return t.length > MAX_ENTITY_TOKENS ? t.slice(0, MAX_ENTITY_TOKENS) : t;
}

interface Prepared<T> {
  item: T;
  tokens: Token[];
}

/** Bo trung id, bo ten rong, tach tu san. */
export function prepareEntities<T extends NamedEntity>(items: readonly T[]): Prepared<T>[] {
  const seen = new Set<string>();
  const out: Prepared<T>[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const tokens = entityTokens(item.name);
    if (tokens.length > 0) out.push({ item, tokens });
  }
  return out;
}

const sameSeq = (a: readonly Token[], b: readonly Token[]) => a.length === b.length && a.every((t, i) => sameWord(t, b[i]));
const isPrefix = (part: readonly Token[], whole: readonly Token[]) =>
  part.length > 0 && part.length <= whole.length && part.every((t, i) => sameWord(t, whole[i]));
function isContiguous(part: readonly Token[], whole: readonly Token[]): boolean {
  for (let s = 0; s + part.length <= whole.length; s++) {
    if (part.every((t, i) => sameWord(t, whole[s + i]))) return true;
  }
  return false;
}

function byName<T extends NamedEntity>(a: T, b: T): number {
  return a.name.localeCompare(b.name, 'vi') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Nhan dien mot chuoi ten (do nguoi dung go hoac LLM trich) trong danh sach thuc the: lay bac cao nhat co ket
 * qua (trung ca ten > phan dau > lien tiep); mot -> ONE, nhieu -> MANY (sap theo ten), khong -> NONE.
 */
export function matchEntity<T extends NamedEntity>(typed: string, items: readonly T[]): EntityMatch<T> {
  const all = tokenize(typed).slice(0, MAX_ENTITY_TOKENS);
  const q = stripCues(all);
  if (q.length === 0) return { kind: 'NONE' };
  // Ten co the chinh no bat dau bang tu khoa ("Bảng công việc"): thu ca ban goc lan ban da bo tu khoa
  const variants = q.length === all.length ? [q] : [all, q];
  const prepared = prepareEntities(items);
  const tiers = [
    prepared.filter((p) => variants.some((v) => sameSeq(v, p.tokens))),
    prepared.filter((p) => variants.some((v) => isPrefix(v, p.tokens))),
    prepared.filter((p) => variants.some((v) => isContiguous(v, p.tokens))),
  ];
  const at = tiers.findIndex((t) => t.length > 0);
  if (at < 0) return { kind: 'NONE' };
  const tier = (at + 1) as 1 | 2 | 3;
  const hits = tiers[at];
  if (hits.length === 1) return { kind: 'ONE', item: hits[0].item, tier };
  return { kind: 'MANY', items: hits.map((h) => h.item).sort(byName), tier };
}

/**
 * Doan dai nhat bat dau tai `start` trong cau hoi la PHAN DAU (hoac ca) cua ten it nhat 1 thuc the - dung cho bo luat
 * sau tu khoa ("bảng" + tên). null neu khong doan nao khop. `end` la chi so ket thuc (khong tinh).
 */
export function longestPrefixAt(tokens: readonly Token[], start: number, items: readonly NamedEntity[]): { end: number } | null {
  const prepared = prepareEntities(items);
  for (let len = Math.min(MAX_ENTITY_TOKENS, tokens.length - start); len >= 1; len--) {
    const part = tokens.slice(start, start + len);
    if (prepared.some((p) => isPrefix(part, p.tokens))) return { end: start + len };
  }
  return null;
}
