// Thanh phan "Ho so" (ho so tu khai) - ASSIGN_MODULE.md §17.3-17.4. HAM THUAN: khong Prisma, khong dong ho, khong mang.
//
// Ho so tu khai (ky nang, cac cong viec da lam, chu trich tu CV) duoc CAT thanh cac "muc khai"; moi muc la mot tai lieu rieng
// de so voi the (mot van ban dai nhieu chu de se khop moi chu de chi ~1/sqrt(n) neu de nguyen). Gia tri Ho so cho cap (the,
// nguoi) = do giong LON NHAT giua the va mot muc (thap hon simMin -> 0): them muc khong bao gio lam diem giam, chep mot muc
// nhieu lan khong "bom" duoc diem, va moi diem co dung mot dong bang chung chinh.
//
// Vec-to cua muc dung vectorizeKnown (bo tu co df = 0 trong kho the): idfOf cho tu CHUA TUNG THAY idf LON NHAT, nen mot CV
// nhieu tu khong bao gio xuat hien trong the (dia chi, truong hoc...) se luon bi diem thap neu giu chung.
//
// RIENG TU: muc CV khong bao gio mang chu ra ngoai (title = null ngay tu day); chi co ma muc va do giong.

import { normalizeText, foldText } from '../ai/ai.rules';
import { countTerms } from './assign.text';
import { cosine, vectorizeKnown, type Idf, type SparseVector, type TermCounts } from './assign.tfidf';

/** Toi da so cum ky nang dua vao cham (sau khi bo trung). */
export const DECLARED_MAX_SKILL_ITEMS = 50;
/** Toi da so cong viec da lam (theo thu tu nguoi dung). */
export const DECLARED_MAX_WORK_ITEMS = 30;
/** Do dai toi da (ky tu) mot doan CV. */
export const DECLARED_CHUNK_CHARS = 400;
/** Chi lay chung nay doan CV dau tien. */
export const DECLARED_MAX_CV_CHUNKS = 50;
/** So dong bang chung Ho so toi da moi ung vien. */
export const DECLARED_EVIDENCE_LIMIT = 3;

export interface DeclaredWorkItem {
  title: string;
  description?: string | null;
}

/** Ho so tu khai cua MOT nguoi (dung o moi khong gian). Nguoi goi khong truyen ho so da tat "dung cho goi y". */
export interface DeclaredProfile {
  skillsText?: string | null;
  workItems?: readonly DeclaredWorkItem[] | null;
  /** Chu trich tu CV (nguoi dung da sua). */
  cvText?: string | null;
}

export type DeclaredKind = 'SKILL' | 'WORK' | 'CV';

export interface DeclaredItem {
  kind: DeclaredKind;
  /** Vi tri trong nhom cung loai (0, 1, ...) - tat dinh theo thu tu nguoi dung khai. */
  index: number;
  /** `skill:<i>` / `work:<i>` / `cv:<i>`. */
  itemId: string;
  /** Cum ky nang / tieu de cong viec; muc CV LUON null. */
  title: string | null;
  counts: TermCounts;
}

export interface DeclaredEvidence {
  kind: DeclaredKind;
  itemId: string;
  title: string | null;
  /** Do giong voi the, trong [simMin, 1]. */
  sim: number;
}

export interface DeclaredScore {
  /** null = khong co ho so dung duoc (khong co muc nao); 0 = co khai nhung khong muc nao du giong. */
  value: number | null;
  evidence: DeclaredEvidence[];
}

// ---------- Cat muc ----------

const SKILL_SEPARATORS: ReadonlySet<string> = new Set(['\n', ',', ';', '•', '|']);
const BULLETS: ReadonlySet<string> = new Set(['-', '*', '•', '+', '–', '—']);
const isSpace = (ch: string | undefined) => ch === ' ' || ch === '\n';

/** Khoa so trung cua cum ky nang (cum da gop khoang trang): thuong, bo dau. */
function skillKey(phrase: string): string {
  return foldText(phrase);
}

function skillItems(text: string): DeclaredItem[] {
  const out: DeclaredItem[] = [];
  const seen = new Set<string>();
  let cur = '';
  const flush = () => {
    const phrase = cur.split(' ').filter((w) => w !== '').join(' ');
    cur = '';
    // Cum rong khong co thuat ngu nao nen bi bo o duoi (counts.size === 0); gioi han 50 do vong lap ben duoi canh
    const key = skillKey(phrase);
    if (seen.has(key)) return;
    const counts = countTerms({ title: '', description: phrase });
    if (counts.size === 0) return;
    seen.add(key);
    out.push({ kind: 'SKILL', index: out.length, itemId: `skill:${out.length}`, title: phrase, counts });
  };
  for (const ch of normalizeText(text)) {
    if (out.length >= DECLARED_MAX_SKILL_ITEMS) break;
    if (SKILL_SEPARATORS.has(ch)) flush();
    else cur += ch;
  }
  flush();
  return out;
}

function workItems(items: readonly DeclaredWorkItem[]): DeclaredItem[] {
  const out: DeclaredItem[] = [];
  for (const w of items.slice(0, DECLARED_MAX_WORK_ITEMS)) {
    const counts = countTerms({ title: w.title ?? '', description: w.description ?? null });
    if (counts.size === 0) continue;
    const title = (w.title ?? '').trim();
    out.push({ kind: 'WORK', index: out.length, itemId: `work:${out.length}`, title: title === '' ? null : title, counts });
  }
  return out;
}

/** Cat mot manh dai thanh cac mau <= DECLARED_CHUNK_CHARS, uu tien cat o khoang trang (quet nguoc trong cua so, khong qua `start`). */
function* splitLong(s: string): Generator<string> {
  let start = 0;
  while (s.length - start > DECLARED_CHUNK_CHARS) {
    let cut = start + DECLARED_CHUNK_CHARS;
    while (cut > start && s[cut] !== ' ') cut -= 1;
    if (cut === start) cut = start + DECLARED_CHUNK_CHARS; // khong co khoang trang: cat cung
    const piece = s.slice(start, cut).trim();
    if (piece !== '') yield piece;
    start = cut;
    while (start < s.length && isSpace(s[start])) start += 1;
  }
  const rest = s.slice(start).trim();
  if (rest !== '') yield rest;
}

/**
 * Doan CV: tach theo dong trong va dong bat dau bang gach dau dong thanh cac MANH, cat manh qua dai, roi GOM cac manh lien nhau
 * thanh doan <= DECLARED_CHUNK_CHARS (noi bang xuong dong: bi-gram khong bac qua hai manh). Dung ngay khi du DECLARED_MAX_CV_CHUNKS.
 */
export function cvChunks(text: string): string[] {
  const chunks: string[] = [];
  let acc = '';
  const add = (piece: string): boolean => {
    if (acc === '') acc = piece;
    else if (acc.length + 1 + piece.length <= DECLARED_CHUNK_CHARS) acc += '\n' + piece;
    else {
      chunks.push(acc);
      acc = piece;
    }
    return chunks.length >= DECLARED_MAX_CV_CHUNKS;
  };
  let fragment: string[] = [];
  // true = da du so doan
  const flushFragment = (): boolean => {
    if (fragment.length === 0) return false;
    const joined = fragment.join(' ');
    fragment = [];
    for (const piece of splitLong(joined)) if (add(piece)) return true;
    return false;
  };
  for (const raw of normalizeText(text).split('\n')) {
    const line = raw.trim();
    if (line === '') {
      if (flushFragment()) return chunks;
      continue;
    }
    if (BULLETS.has(line[0]!) && (line.length === 1 || line[1] === ' ')) {
      if (flushFragment()) return chunks;
      const body = line.slice(1).trim();
      if (body !== '') fragment.push(body);
      continue;
    }
    fragment.push(line);
  }
  if (flushFragment()) return chunks;
  if (acc !== '') chunks.push(acc);
  return chunks;
}

function cvItems(text: string): DeclaredItem[] {
  const out: DeclaredItem[] = [];
  for (const chunk of cvChunks(text)) {
    const counts = countTerms({ title: '', description: chunk });
    if (counts.size === 0) continue;
    out.push({ kind: 'CV', index: out.length, itemId: `cv:${out.length}`, title: null, counts });
  }
  return out;
}

/** Moi muc khai cua mot ho so, theo thu tu SKILL -> WORK -> CV. Khong co ho so / khong con muc nao -> []. */
export function declaredItems(profile: DeclaredProfile | null | undefined): DeclaredItem[] {
  if (!profile) return [];
  return [
    ...skillItems(profile.skillsText ?? ''),
    ...workItems(profile.workItems ?? []),
    ...cvItems(profile.cvText ?? ''),
  ];
}

// ---------- Cham ----------

const KIND_ORDER: Record<DeclaredKind, number> = { WORK: 0, SKILL: 1, CV: 2 };

/**
 * §17.4: gia tri Ho so cua the `qvec` voi cac muc `items`. Chi muc co sim > 0 va sim >= simMin moi tinh (nhu kinh nghiem). Khong
 * co muc nao -> value null (NO_PROFILE); co muc nhung khong muc nao du giong -> 0. Bang chung: toi da 3 muc giong nhat, hoa thi
 * WORK -> SKILL -> CV, roi vi tri.
 */
export function scoreDeclared(qvec: SparseVector, items: readonly DeclaredItem[], idf: Idf, simMin: number): DeclaredScore {
  if (items.length === 0) return { value: null, evidence: [] };
  const hits: { item: DeclaredItem; sim: number }[] = [];
  for (const item of items) {
    const sim = cosine(qvec, vectorizeKnown(item.counts, idf));
    if (sim > 0 && sim >= simMin) hits.push({ item, sim });
  }
  hits.sort(
    (a, b) => b.sim - a.sim || KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] || a.item.index - b.item.index
  );
  return {
    value: hits.length > 0 ? hits[0]!.sim : 0,
    evidence: hits.slice(0, DECLARED_EVIDENCE_LIMIT).map(({ item, sim }) => ({
      kind: item.kind,
      itemId: item.itemId,
      title: item.kind === 'CV' ? null : item.title,
      sim,
    })),
  };
}
