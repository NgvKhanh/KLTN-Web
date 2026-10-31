// DE XUAT CUA AI -> THAO TAC TUONG TRUNG (Board Patch, Phase 3). HAM THUAN: nhan ban chup DAY DU cua bang (khong chi phan gui cho AI) nen
// viec loc trung luon chay tren TOAN BO cot / the, ke ca khi bang lon va AI chi xem mot phan.
//
// Dau ra chi gom CREATE_LIST va CREATE_CARD (ActionOp thuong, di qua dung preflight / guard / executor cua Phase 2):
//  - cot AI de xuat da co (trung ten, khong dau) -> khong tao cot moi, the cua no chuyen vao cot co san;
//  - the trung / gan giong the da co (o BAT KY cot nao) hoac trung chinh de xuat -> bo qua, liet ke o "Da co - bo qua";
//  - the tro vao cot khong ton tai -> bo qua (khong doan cot khac);
//  - cot co san duoc tham chieu bang TEXT + "pin" id (presets) nen hai cot trung ten khong bao gio bi nham.

import { foldedName, refSignature } from './actions.refs';
import type { ActionOp, Ref } from './actions.schema';
import { cleanText, looksUnsafe, type PatchDraft } from './actions.patch.schema';
import { foldWords } from './actions.text';
import type { PatchSkipped } from './actions.types';

export interface CtxList {
  id: string;
  name: string;
}
export interface CtxCard {
  listId: string;
  title: string;
}
/** Ban chup DAY DU cac cot va the con song cua bang (the cua cot da luu tru / xoa khong co mat). */
export interface BoardContext {
  lists: CtxList[];
  cards: CtxCard[];
}

/** Khoa tam cua cot co san gui cho AI: L1, L2... theo thu tu cot. */
export const listKeyOf = (index: number): string => `L${index + 1}`;

// ---------------------------------------------------------------------------------------------------------------------
// So khop tieu de
// ---------------------------------------------------------------------------------------------------------------------

/** Tu "dem" khong mang nghia cong viec: bo khi so sanh tieu de. */
const FILLER: ReadonlySet<string> = new Set(['va', 'cho', 'cua', 'de', 'cac', 'nhung', 'mot', 'la', 'o', 'trong', 'voi', 'cung', 'theo', 'tu', 'den', 'nay', 'do', 'the', 'task', 'viec', 'cong', 'card', 'can', 'se', 'duoc', 'vao', 'ra', 'hay', 'nhu', 'khi', 'neu']);
/** Hai tieu de duoc coi la GAN GIONG khi ti le trung (Jaccard) cua tap tu cua chung dat muc nay. */
export const SIMILAR_THRESHOLD = 0.8;

export const titleKey = (title: string): string => foldWords(title).join(' ');

export function titleTokens(title: string): Set<string> {
  const words = foldWords(title);
  const meaningful = words.filter((w) => !FILLER.has(w));
  return new Set(meaningful.length > 0 ? meaningful : words);
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let both = 0;
  for (const t of a) if (b.has(t)) both += 1;
  return both / (a.size + b.size - both);
}

export interface TitleEntry {
  title: string;
  key: string;
  tokens: Set<string>;
  where?: string;
}
export const indexTitles = (items: readonly { title: string; where?: string }[]): TitleEntry[] =>
  items.map((it) => ({ title: it.title, key: titleKey(it.title), tokens: titleTokens(it.title), ...(it.where !== undefined ? { where: it.where } : {}) }));

export interface TitleMatch {
  reason: 'EXISTS' | 'SIMILAR';
  entry: TitleEntry;
}

/** Tieu de `title` co trung (EXISTS: cung chu sau khi bo dau / hoa-thuong) hoac gan giong (SIMILAR: cung tap tu chinh) muc nao trong `pool` khong. */
export function matchTitle(title: string, pool: readonly TitleEntry[]): TitleMatch | null {
  const key = titleKey(title);
  const tokens = titleTokens(title);
  let similar: TitleEntry | null = null;
  for (const entry of pool) {
    if (entry.key === key) return { reason: 'EXISTS', entry };
    if (similar === null && jaccard(tokens, entry.tokens) >= SIMILAR_THRESHOLD) similar = entry;
  }
  return similar === null ? null : { reason: 'SIMILAR', entry: similar };
}

// ---------------------------------------------------------------------------------------------------------------------
// Dung thao tac
// ---------------------------------------------------------------------------------------------------------------------

export interface PatchBuild {
  ops: ActionOp[];
  /** dau van tay tham chieu cot co san -> id (de bo phan giai khong phai doan, ke ca khi hai cot trung ten). */
  presets: Record<string, string>;
  skipped: PatchSkipped[];
  newLists: number;
  newCards: number;
  draftLists: number;
  draftCards: number;
}

export type BuildResult = { ok: true; build: PatchBuild } | { ok: false; code: 'INVALID' | 'UNSAFE_CONTENT'; reason: 'UNSAFE' | 'KEY_CLASH' };

const LIST_NAME_MAX = 100;
const CARD_TITLE_MAX = 500;

type Target = { kind: 'EXISTING'; list: CtxList } | { kind: 'NEW'; key: string; name: string };

export function buildPatch(draft: PatchDraft, ctx: BoardContext): BuildResult {
  const lists = draft.lists.map((l) => ({ key: l.key, name: cleanText(l.name, LIST_NAME_MAX) })).filter((l) => l.name !== '');
  const cards = draft.cards.map((c) => ({ list: cleanText(c.list, 120), title: cleanText(c.title, CARD_TITLE_MAX) })).filter((c) => c.title !== '' && c.list !== '');
  if (lists.some((l) => looksUnsafe(l.name)) || cards.some((c) => looksUnsafe(c.title))) return { ok: false, code: 'UNSAFE_CONTENT', reason: 'UNSAFE' };

  const existingKeys = new Map(ctx.lists.map((l, i) => [listKeyOf(i), l] as const));
  const draftKeys = new Set<string>();
  for (const l of lists) {
    if (existingKeys.has(l.key) || draftKeys.has(l.key)) return { ok: false, code: 'INVALID', reason: 'KEY_CLASH' };
    draftKeys.add(l.key);
  }

  const skipped: PatchSkipped[] = [];
  const ops: ActionOp[] = [];
  const presets: Record<string, string> = {};
  const targets = new Map<string, Target>(); // khoa AI dung -> noi the se vao
  const listTitles = (listId: string) => ctx.lists.find((l) => l.id === listId)?.name;

  // 1) cot: da co (trung ten, ke ca khi bo tu chung dau chuoi) -> dung cot co san; trung chinh de xuat -> gop
  const newNames = new Map<string, string>(); // titleKey / foldedName -> khoa cot moi da lap
  let newCount = 0;
  for (const l of lists) {
    const names = [titleKey(l.name), foldedName(l.name)];
    const same = ctx.lists.find((e) => names.includes(titleKey(e.name)) || names.includes(foldedName(e.name)));
    if (same) {
      targets.set(l.key, { kind: 'EXISTING', list: same });
      skipped.push({ kind: 'LIST', title: l.name, reason: 'EXISTS', existing: same.name });
      continue;
    }
    const earlier = names.map((n) => newNames.get(n)).find((k) => k !== undefined);
    if (earlier !== undefined) {
      targets.set(l.key, targets.get(earlier) as Target);
      skipped.push({ kind: 'LIST', title: l.name, reason: 'DUPLICATE_IN_PATCH', existing: (targets.get(earlier) as Extract<Target, { kind: 'NEW' }>).name });
      continue;
    }
    newCount += 1;
    const planKey = `n${newCount}`;
    for (const n of names) newNames.set(n, l.key);
    targets.set(l.key, { kind: 'NEW', key: planKey, name: l.name });
    ops.push({ type: 'CREATE_LIST', key: planKey, name: l.name });
  }

  // 2) the: tim cot dich, loc trung (voi TOAN BO the co san va voi cac the da nhan trong de xuat)
  const existingPool = indexTitles(ctx.cards.map((c) => ({ title: c.title, where: listTitles(c.listId) })));
  const acceptedPool: TitleEntry[] = [];
  const acceptedStripped = new Set<string>();
  const targetOf = (name: string): Target | undefined => {
    const byKey = targets.get(name) ?? (existingKeys.has(name) ? ({ kind: 'EXISTING', list: existingKeys.get(name) as CtxList } as const) : undefined);
    if (byKey) return byKey;
    // AI ghi TEN cot thay vi khoa: chap nhan neu khop DUNG ten mot cot (co san hoac moi) - khong doan gan dung
    const fold = titleKey(name);
    const live = ctx.lists.find((e) => titleKey(e.name) === fold);
    if (live) return { kind: 'EXISTING', list: live };
    return [...targets.values()].find((t) => t.kind === 'NEW' && titleKey(t.name) === fold);
  };

  let newCards = 0;
  for (const c of cards) {
    const target = targetOf(c.list);
    if (!target) {
      skipped.push({ kind: 'CARD', title: c.title, reason: 'UNKNOWN_LIST' });
      continue;
    }
    const hit = matchTitle(c.title, existingPool);
    if (hit) {
      skipped.push({ kind: 'CARD', title: c.title, reason: hit.reason, existing: hit.entry.title, ...(hit.entry.where !== undefined ? { where: hit.entry.where } : {}) });
      continue;
    }
    const inPatch = matchTitle(c.title, acceptedPool);
    const stripped = foldedName(c.title);
    if (inPatch || acceptedStripped.has(stripped)) {
      skipped.push({ kind: 'CARD', title: c.title, reason: 'DUPLICATE_IN_PATCH', existing: inPatch?.entry.title ?? c.title });
      continue;
    }
    let list: Ref;
    if (target.kind === 'NEW') {
      list = { by: 'PLAN', key: target.key };
    } else {
      list = { by: 'TEXT', text: target.list.name };
      const sig = refSignature('list', list) as string;
      if (presets[sig] !== undefined && presets[sig] !== target.list.id) {
        // hai cot co san trung ten (cung dau van tay): khong the phan biet bang ten -> khong doan
        skipped.push({ kind: 'CARD', title: c.title, reason: 'UNKNOWN_LIST', where: target.list.name });
        continue;
      }
      presets[sig] = target.list.id;
    }
    acceptedPool.push(...indexTitles([{ title: c.title }]));
    acceptedStripped.add(stripped);
    newCards += 1;
    ops.push({ type: 'CREATE_CARD', title: c.title, list });
  }

  return { ok: true, build: { ops, presets, skipped, newLists: newCount, newCards, draftLists: draft.lists.length, draftCards: draft.cards.length } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Kiem tra lai luc ap dung
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Cot / the cua ke hoach da xuat hien trong bang SAU luc xem truoc (nguoi khac vua them)? Tra cau mo ta dau tien, null = khong trung.
 * Dung o hai cho: buoc dung lai ke hoach (truoc transaction) va ngay trong transaction sau khi khoa dong (de dong thoi cung khong tao trung).
 */
export function findPatchCollision(ops: readonly { type: string; params: { name?: string; title?: string } }[], ctx: BoardContext): string | null {
  const pool = indexTitles(ctx.cards);
  for (const op of ops) {
    if (op.type === 'CREATE_LIST' && op.params.name !== undefined) {
      const names = [titleKey(op.params.name), foldedName(op.params.name)];
      const same = ctx.lists.find((l) => names.includes(titleKey(l.name)) || names.includes(foldedName(l.name)));
      if (same) return `Cột “${op.params.name}” đã có trong bảng${same.name === op.params.name ? '' : ` (“${same.name}”)`} kể từ lúc xem trước.`;
    }
    if (op.type === 'CREATE_CARD' && op.params.title !== undefined) {
      const hit = matchTitle(op.params.title, pool);
      if (hit) return `Thẻ “${op.params.title}” đã có trong bảng${hit.entry.title === op.params.title ? '' : ` (“${hit.entry.title}”)`} kể từ lúc xem trước.`;
    }
  }
  return null;
}
