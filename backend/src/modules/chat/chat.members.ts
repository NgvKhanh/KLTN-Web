// Tach tu + so khop ten nguoi (CHATBOT_MODULE.md §8.2-8.3).
//
// HAM THUAN, khong DB. "Danh sach nguoi" (roster) do tang pham vi (chat.scope, buoc 2)
// doc tu CSDL roi truyen vao; danh sach nay KHONG BAO GIO duoc gui cho LLM.
//
// Quy tac so tu (§8.2): so NGUYEN TU. Hai tu deu co dau -> so ban co dau (de "tuần"
// khong khop "Tuấn", "năm" khong khop "Nâm"...); con lai -> so ban khong dau (de nguoi
// go khong dau van tim duoc "Tuấn" bang "tuan").

import { foldText, normalizeText } from '../ai/ai.rules';

export interface RosterMember {
  userId: string;
  name: string;
}

export interface Token {
  /** Nguyen van (giu hoa/thuong) - dung de doan ten rieng viet hoa. */
  raw: string;
  /** Chu thuong, giu dau (NFC). */
  orig: string;
  /** Chu thuong, bo dau (foldText). */
  fold: string;
  /** true neu tu khong co dau (orig === fold). */
  plain: boolean;
}

export type MemberMatch =
  | { kind: 'ONE'; member: RosterMember }
  | { kind: 'MANY'; members: RosterMember[] }
  | { kind: 'NONE' };

/** Ten dai hon so tu nay chi xet phan cuoi (chan dau vao bat thuong). */
export const MAX_NAME_TOKENS = 8;
/** So nguoi toi da duoc xet (workspace that nho hon rat nhieu). */
export const MAX_ROSTER = 2000;

const WORD_RE = /[\p{L}\p{N}]+/gu;

/** NFC (normalizeText) -> tach cac cum chu/so; moi tu co ban co dau + ban khong dau. */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  for (const m of normalizeText(text).matchAll(WORD_RE)) {
    const raw = m[0];
    const orig = raw.toLowerCase();
    const fold = foldText(orig);
    out.push({ raw, orig, fold, plain: orig === fold });
  }
  return out;
}

/** Hai tu bang nhau theo quy tac §8.2. */
export function sameWord(a: Token, b: Token): boolean {
  return !a.plain && !b.plain ? a.orig === b.orig : a.fold === b.fold;
}

/** Tu xung ho dung truoc ten ("chị Lan", "anh Minh") - so ban khong dau. */
const HONORIFICS = new Set(['anh', 'chi', 'em', 'ban', 'co', 'chu', 'thay', 'bac', 'be', 'ong']);

export function isHonorific(t: Token): boolean {
  return HONORIFICS.has(t.fold);
}

/** Bo tu xung ho o DAU chuoi, mien la con lai it nhat 1 tu. */
function stripHonorifics(tokens: Token[]): Token[] {
  let i = 0;
  while (i < tokens.length - 1 && isHonorific(tokens[i])) i++;
  return tokens.slice(i);
}

/**
 * Chuoi ten ma thuc ra la chinh nguoi hoi ("tôi", "mình", "tớ", "em", "bản thân").
 * "minh" KHONG DAU khong tinh: LLM tra "Minh" la ten nguoi.
 */
export function isSelfReference(text: string): boolean {
  const t = tokenize(text);
  if (t.length === 1) {
    const w = t[0];
    return (
      w.orig === 'tôi' ||
      w.orig === 'mình' ||
      w.orig === 'tớ' ||
      w.orig === 'em' ||
      (w.plain && w.fold === 'toi')
    );
  }
  if (t.length === 2) {
    const [a, b] = t;
    const pair = `${a.fold} ${b.fold}`;
    return pair === 'ban than' || (a.fold === 'chinh' && isSelfReference(b.raw));
  }
  return false;
}

/** Tu cua ten (toi da MAX_NAME_TOKENS tu CUOI - so khop theo duoi ten). */
export function nameTokens(name: string): Token[] {
  const t = tokenize(name);
  return t.length > MAX_NAME_TOKENS ? t.slice(t.length - MAX_NAME_TOKENS) : t;
}

/** `part` la duoi (cac tu cuoi lien tiep) cua `whole`, ke ca bang ca ten. */
export function isSuffixOf(part: Token[], whole: Token[]): boolean {
  if (part.length === 0 || part.length > whole.length) return false;
  const offset = whole.length - part.length;
  return part.every((t, i) => sameWord(t, whole[offset + i]));
}

/** Bo trung userId, gioi han kich thuoc, tach tu san cho moi nguoi. */
export function prepareRoster(roster: readonly RosterMember[]): { member: RosterMember; tokens: Token[] }[] {
  const seen = new Set<string>();
  const out: { member: RosterMember; tokens: Token[] }[] = [];
  for (const m of roster) {
    if (out.length >= MAX_ROSTER) break;
    if (seen.has(m.userId)) continue;
    seen.add(m.userId);
    const tokens = nameTokens(m.name);
    if (tokens.length > 0) out.push({ member: m, tokens });
  }
  return out;
}

function byName(a: RosterMember, b: RosterMember): number {
  return a.name.localeCompare(b.name, 'vi') || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0);
}

/**
 * Nhan dien mot chuoi ten (do nguoi dung go hoac LLM trich) trong danh sach nguoi.
 * - Khop khi chuoi (da bo xung ho) la DUOI cua ten: "Lan", "Thị Lan", "Nguyễn Thị Lan".
 * - Nhieu nguoi khop -> MANY (hoi lai), tru khi chuoi co >= 2 tu va khop DUNG ca ten
 *   cua dung 1 nguoi (go ho ten day du la co chu dich).
 */
export function matchMember(query: string, roster: readonly RosterMember[]): MemberMatch {
  const all = tokenize(query);
  const q = stripHonorifics(all.length > MAX_NAME_TOKENS ? all.slice(all.length - MAX_NAME_TOKENS) : all);
  if (q.length === 0) return { kind: 'NONE' };

  const hits = prepareRoster(roster).filter((r) => isSuffixOf(q, r.tokens));
  if (hits.length === 1) return { kind: 'ONE', member: hits[0].member };
  if (hits.length === 0) return { kind: 'NONE' };

  const exact = hits.filter((r) => r.tokens.length === q.length);
  if (q.length >= 2 && exact.length === 1) return { kind: 'ONE', member: exact[0].member };
  return { kind: 'MANY', members: hits.map((h) => h.member).sort(byName) };
}

/**
 * Nhan dien nguoi duoc hoi toi trong danh sach nguoi HIEN TAI cua pham vi:
 * - `memberUserId` (nguoi da chon o luot truoc / nut "Y ban la ai?") -> chi hop le neu
 *   van con trong danh sach (nguoi da roi, bi xoa, hoac pham vi doi -> NONE);
 * - nguoc lai so `memberText` theo matchMember.
 */
export function resolveMemberRef(
  ref: { memberText: string | null; memberUserId: string | null },
  roster: readonly RosterMember[]
): MemberMatch {
  if (ref.memberUserId !== null) {
    const found = roster.find((m) => m.userId === ref.memberUserId);
    return found ? { kind: 'ONE', member: found } : { kind: 'NONE' };
  }
  if (ref.memberText !== null) return matchMember(ref.memberText, roster);
  return { kind: 'NONE' };
}

/** Mot doan tu [start, end) trong cau hoi trung voi duoi ten cua it nhat 1 nguoi. */
export interface NameSpan {
  start: number;
  end: number;
  userIds: string[];
}

/**
 * Moi doan trong cau hoi trung voi duoi ten cua ai do (chua xet ngu canh - viec cua
 * bo luat). Sap theo vi tri bat dau, roi do dai GIAM dan.
 */
export function findNameSpans(tokens: Token[], roster: readonly RosterMember[]): NameSpan[] {
  const prepared = prepareRoster(roster);
  const spans: NameSpan[] = [];
  for (let start = 0; start < tokens.length; start++) {
    for (let len = Math.min(MAX_NAME_TOKENS, tokens.length - start); len >= 1; len--) {
      const part = tokens.slice(start, start + len);
      const userIds = prepared.filter((r) => isSuffixOf(part, r.tokens)).map((r) => r.member.userId);
      if (userIds.length > 0) spans.push({ start, end: start + len, userIds });
    }
  }
  return spans;
}
