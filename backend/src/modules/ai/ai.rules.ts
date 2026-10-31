// Bo luat doc van ban tieng Viet cua module AI (AI_MODULE.md §5).
//
// TAT DINH, KHONG GOI AI, KHONG DUNG DB/MANG. Lam 3 viec:
//   1. Chuan hoa + tach van ban thanh cac DONG DANH SO 1..N (sourceLine).
//   2. Trich ngay thang tieng Viet tren tung dong ("RULE thang LLM" ve ngay).
//   3. Quyet dinh che do STRUCTURED hay FREEFORM.
//
// QUY UOC BAT BUOC (co test doc chinh file nguon nay de ep tuan thu):
// - Moi regex la HANG LITERAL khai o dau file. Khong ghep chuoi vao regex: ten
//   nguoi/noi dung do nguoi dung nhap co the chua ky tu dac biet lam sap ca tinh
//   nang (loi #1 cua ban v1).
// - Khong dung regex "khop moi ky tu vo han" (dau cham + sao / dau cong): dung
//   lop ky tu cu the hoac gioi han so lan lap (loi #9 cua ban v1).
// - Ngay la chuoi "YYYY-MM-DD", tinh bang ai.dates.ts (UTC). "Hom nay" luon la
//   tham so - khong doc dong ho o day.

import {
  addDays,
  addMonths,
  isValidIso,
  isValidYmd,
  lastDayOfMonth,
  mondayOfWeek,
  toIso,
  type IsoDate,
} from './ai.dates';

export type PlanMode = 'STRUCTURED' | 'FREEFORM';
export type LineKind = 'HEADING' | 'BULLET' | 'TEXT';
export type DateRole = 'START' | 'DUE';
export type DatePattern =
  | 'ISO'
  | 'ABSOLUTE'
  | 'RELATIVE'
  | 'WEEKDAY'
  | 'DAYWORD'
  | 'FUZZY';

export interface RuleLine {
  /** So dong, tinh tu 1, chi dem dong co noi dung (bo dong trong). */
  no: number;
  /** Dong goc da cat khoang trang 2 dau (con nguyen ky hieu #, -, 1.). */
  raw: string;
  /** Noi dung sau khi bo ky hieu heading/bullet va gop khoang trang. */
  text: string;
  kind: LineKind;
  /** HEADING: cap 1-6. BULLET: do thut le 0-5. TEXT: 0. */
  level: number;
}

export interface RuleDate {
  /** RuleLine.no chua ngay nay (0 neu goi extractDatesFromLine truc tiep). */
  line: number;
  /** Doan chu goc khop duoc. */
  raw: string;
  /** Vi tri [start, end) trong RuleLine.text (da chuan hoa NFC). */
  start: number;
  end: number;
  date: IsoDate;
  role: DateRole;
  /** true neu vai tro suy ra tu tu khoa ("han", "bat dau"...), false neu chi la mac dinh. */
  roleExplicit: boolean;
  pattern: DatePattern;
  /** Moc mo ("cuoi thang sau", "trong tuan nay") - can ghi vao canh bao. */
  fuzzy: boolean;
  /** Ngay/thang thieu nam, da suy ra nam gan nhat KHONG o qua khu. */
  yearInferred: boolean;
}

export interface ModeDetection {
  mode: PlanMode;
  structuredRatio: number;
  structuredLines: number;
  contentLines: number;
}

export interface RuleFindings extends ModeDetection {
  today: IsoDate;
  lines: RuleLine[];
  dates: RuleDate[];
}

// ===================== 1. Chuan hoa + tach dong =====================

/** NFC, LF, bo ky tu vo hinh, NBSP -> cach, tab -> 4 cach. */
export function normalizeText(input: string): string {
  return input
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\t/g, '    ');
}

function sameLengthLower(cp: string): string {
  const lower = cp.toLowerCase();
  return lower.length === cp.length ? lower : cp;
}

/** Ha chu thuong, GIU dau. Dai bang chuoi goc de vi tri khop nhau. */
function lowerText(s: string): string {
  let out = '';
  for (const cp of s) out += sameLengthLower(cp);
  return out;
}

/**
 * Ha chu thuong + BO DAU tieng Viet, tung ky tu mot nen chuoi ket qua DAI BANG
 * chuoi vao (vi tri khop tren ban bo dau dung nguyen cho ban goc).
 */
export function foldText(s: string): string {
  let out = '';
  for (const cp of s) {
    if (cp === 'đ' || cp === 'Đ') {
      out += 'd';
      continue;
    }
    const base = Array.from(cp.normalize('NFD'))[0] ?? cp;
    const lower = base.toLowerCase();
    out += lower.length === cp.length ? lower : cp;
  }
  return out;
}

const HEADING_RE = /^(#{1,6})\s+(\S[^\n]*)$/;
const BOLD_HEADING_RE = /^\*\*([^*\n]{1,80})\*\*:?$/;
// CODE_REVIEW.md #12: \d{1,2} lam muc so 100 tro len bi coi la TEXT (bo qua o
// STRUCTURED) ma khong canh bao rieng nao - noi rong len 3 chu so (toi da 999,
// du cho moi tai lieu that) van giu duoc gioi han tren de tranh vet lam.
const BULLET_RE = /^( *)(?:[-*•+–—]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?(\S[^\n]*)$/;

// Dong chi toan ky hieu ("---", "***", "-", "...") khong mang noi dung -> bo.
const HAS_LETTER_OR_DIGIT_RE = /[\p{L}\p{N}]/u;

// Cau ket thuc bang . ! ? roi cach + chu HOA/so. Lookbehind giu dau cau o cau truoc.
const SENTENCE_BREAK_RE = /(?<=[.!?…])\s+(?=[\p{Lu}\p{N}])/u;
// Viet tat/chu cai dau ten ("TS.", "Nguyen V. A") khong phai het cau.
const ABBREVIATION_END_RE = /(?:^|\s)(?:TS|ThS|PGS|GS|BS|KS|Mr|Mrs|Ms|Dr|TP|Tp|TT|Q|P)\.$/;
const INITIAL_END_RE = /(?:^|\s)\p{Lu}\.$/u;

function splitSentences(s: string): string[] {
  const out: string[] = [];
  for (const part of s.split(SENTENCE_BREAK_RE)) {
    const prev = out[out.length - 1];
    if (prev !== undefined && (ABBREVIATION_END_RE.test(prev) || INITIAL_END_RE.test(prev))) {
      out[out.length - 1] = `${prev} ${part}`;
    } else {
      out.push(part);
    }
  }
  return out;
}

function squeeze(s: string): string {
  return s.replace(/ {2,}/g, ' ').trim();
}

/**
 * Tach van ban thanh cac dong co noi dung, danh so 1..N.
 * - Dong trong bi bo (khong danh so).
 * - Dong heading/bullet giu nguyen 1 dong.
 * - Doan van xuoi (TEXT) tach them theo CAU, de moi cau co so dong rieng.
 */
export function splitLines(input: string): RuleLine[] {
  const rows: Omit<RuleLine, 'no'>[] = [];

  for (const rawLine of normalizeText(input).split('\n')) {
    const withIndent = rawLine.trimEnd();
    const raw = withIndent.trim();
    if (!HAS_LETTER_OR_DIGIT_RE.test(raw)) continue;

    const heading = HEADING_RE.exec(raw);
    if (heading) {
      rows.push({ raw, text: squeeze(heading[2]!), kind: 'HEADING', level: heading[1]!.length });
      continue;
    }
    const bullet = BULLET_RE.exec(withIndent);
    if (bullet) {
      rows.push({
        raw,
        text: squeeze(bullet[2]!),
        kind: 'BULLET',
        level: Math.min(5, Math.floor(bullet[1]!.length / 2)),
      });
      continue;
    }
    const bold = BOLD_HEADING_RE.exec(raw);
    if (bold) {
      rows.push({ raw, text: squeeze(bold[1]!), kind: 'HEADING', level: 3 });
      continue;
    }
    for (const sentence of splitSentences(raw)) {
      const text = squeeze(sentence);
      if (text !== '') rows.push({ raw: sentence.trim(), text, kind: 'TEXT', level: 0 });
    }
  }

  return rows.map((row, i) => ({ no: i + 1, ...row }));
}

// ===================== 2. Trich ngay thang tieng Viet =====================
// Moi bo nhan dien chay tren ban BO DAU + chu thuong ("fold"), vi tri khop van
// dung tren van ban goc. Chay theo thu tu UU TIEN; doan chu da bi 1 mau chiem thi
// cac mau sau khong duoc chiem lai.

interface Candidate {
  start: number;
  end: number;
  date: IsoDate;
  pattern: DatePattern;
  fuzzy: boolean;
  yearInferred: boolean;
}

interface Ctx {
  /** Ban bo dau + chu thuong (dai bang van ban goc). */
  f: string;
  /** Ban chu thuong con dau - de phan biet "toi" (toi/toi) khi can. */
  low: string;
  today: IsoDate;
}

// MOI phep lap deu co CAN TREN. Neu bo can (vd phan truoc @ cua email), moi vi tri
// trong 1 day chu dai deu quet ca day de tim "@" -> thoi gian tang theo BINH PHUONG
// do dai dong (da do: 32000 ky tu = 0.5 giay). Co test do toc do de giu dieu nay.
const NOISE_RE =
  /https?:\/\/\S{1,2000}|www\.\S{1,2000}|[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63}){1,8}/g;

const ISO_DATE_RE = /(?<![\d/.-])(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
// "15 thang 11", "ngay 15 thang 11 nam 2026"
const ABS_WORDS_RE =
  /(?<![\d/])(?:ngay {1,3})?(\d{1,2}) {1,3}thang {1,3}(\d{1,2})(?: {1,3}nam {1,3}(\d{4}|\d{2}))?(?!\d)/g;
// "15/11", "15/11/2026", "15/11/26": chi dung dau / (dau - va . de nham voi khoang so, vd "5-7 nguoi")
const SLASH_DATE_RE = /(?<![\d/.-])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/g;
// "15-11-2026", "15.11.2026": bat buoc du 4 chu so nam
const DASH_DOT_DATE_RE = /(?<![\d/.-])(\d{1,2})[-.](\d{1,2})[-.](\d{4})(?![\d/])/g;

// "trong 2 tuan", "trong vong 3 ngay", "sau 10 ngay" (khong co "sau" = 6 vi trung tu "sau")
const REL_PREFIX_RE =
  /(?<![a-z0-9])(?:trong(?: {1,3}vong)?|sau) {1,3}(\d{1,3}|mot|hai|ba|bon|nam|bay|tam|chin|muoi) {1,3}(ngay|tuan|thang)(?![a-z0-9])/g;
// "2 tuan nua", "3 thang toi", "10 ngay sau"
const REL_SUFFIX_RE =
  /(?<![a-z0-9])(\d{1,3}|mot|hai|ba|bon|nam|bay|tam|chin|muoi) {1,3}(ngay|tuan|thang) {1,3}(?:nua|toi|sau)(?![a-z0-9])/g;

const FUZZY_PERIOD_RE =
  /(?<![a-z0-9])(dau|giua|cuoi) {1,3}(tuan|thang) {1,3}(nay|sau|toi|truoc)(?![a-z0-9])/g;
const FUZZY_MONTH_NUM_RE = /(?<![a-z0-9])(dau|giua|cuoi) {1,3}thang {1,3}(\d{1,2})(?!\d)/g;
const FUZZY_YEAR_RE =
  /(?<![a-z0-9])(dau|giua|cuoi) {1,3}nam(?: {1,3}(nay|sau|toi|truoc|\d{4}))?(?![a-z0-9])/g;
const FUZZY_IN_PERIOD_RE = /(?<![a-z0-9])trong {1,3}(tuan|thang) {1,3}(nay|sau|toi)(?![a-z0-9])/g;

const WEEKDAY_DIGIT_RE =
  /(?<![a-z0-9])thu {0,1}([2-7])(?![a-z0-9])(?: {1,3}tuan {1,3}(nay|sau|toi|truoc))?/g;
// "thu tu"/"thu nam" chi nhan khi co "tuan nay/sau..." di kem (neu khong la so thu tu)
const WEEKDAY_WORD_RE =
  /(?<![a-z0-9])thu {1,3}(hai|ba|tu|nam|sau|bay) {1,3}tuan {1,3}(nay|sau|toi|truoc)(?![a-z0-9])/g;
const SUNDAY_RE =
  /(?<![a-z0-9])chu {1,3}nhat(?: {1,3}tuan {1,3}(nay|sau|toi|truoc))?(?![a-z0-9])/g;

// Khong bat "mai" dung mot minh (la ten nguoi: "Ngoc Mai").
const DAYWORD_RE =
  /(?<![a-z0-9])(?:hom {1,3}nay|ngay {1,3}(?:mai|mot|kia)|(?:sang|chieu|toi|trua|dem) {1,3}(?:mai|nay))(?![a-z0-9])/g;

const START_KEYWORD_RE =
  /(?<![a-z0-9])(?:bat {1,3}dau|khoi {1,3}dong|khoi {1,3}cong|kick {0,1}off|tu)(?![a-z0-9])/g;
const DUE_KEYWORD_RE =
  /(?<![a-z0-9])(?:han {1,3}chot|han|deadline|truoc|den|hoan {1,3}thanh|hoan {1,3}tat|xong|nop|ket {1,3}thuc|ban {1,3}giao|cham {1,3}nhat)(?![a-z0-9])/g;
// Khoang giua 2 ngay chi la dau noi ("1/11 - 15/11", "1/11 den 15/11")
const PURE_SEPARATOR_RE = /^[\s\-–—→~]*(?:den|toi)?[\s\-–—→~]*$/;

const NUMBER_WORDS: Record<string, number> = {
  mot: 1,
  hai: 2,
  ba: 3,
  bon: 4,
  nam: 5,
  bay: 7,
  tam: 8,
  chin: 9,
  muoi: 10,
};

function parseCount(s: string): number {
  return /^\d+$/.test(s) ? Number(s) : (NUMBER_WORDS[s] ?? 0);
}

function todayYear(today: IsoDate): number {
  return Number(today.slice(0, 4));
}

/** Nam gan nhat (tu nam hien tai tro di) de ngay d/m KHONG roi vao qua khu. */
function inferYearForward(month: number, day: number, today: IsoDate): number | null {
  const startYear = todayYear(today);
  for (let y = startYear; y <= startYear + 8; y += 1) {
    if (isValidYmd(y, month, day) && toIso(y, month, day) >= today) return y;
  }
  return null;
}

function resolveYmd(
  dayStr: string,
  monthStr: string,
  yearStr: string | undefined,
  today: IsoDate
): { date: IsoDate; yearInferred: boolean } | null {
  const day = Number(dayStr);
  const month = Number(monthStr);
  if (yearStr !== undefined) {
    const year = yearStr.length === 2 ? 2000 + Number(yearStr) : Number(yearStr);
    return isValidYmd(year, month, day) ? { date: toIso(year, month, day), yearInferred: false } : null;
  }
  const year = inferYearForward(month, day, today);
  return year === null ? null : { date: toIso(year, month, day), yearInferred: true };
}

function pos(m: RegExpMatchArray): { start: number; end: number } {
  const start = m.index ?? 0;
  return { start, end: start + m[0].length };
}

function matchIso({ f, today }: Ctx): Candidate[] {
  const out: Candidate[] = [];
  for (const m of f.matchAll(ISO_DATE_RE)) {
    const r = resolveYmd(m[3]!, m[2]!, m[1], today);
    if (r) out.push({ ...pos(m), ...r, pattern: 'ISO', fuzzy: false });
  }
  return out;
}

function matchRelative({ f, today }: Ctx): Candidate[] {
  const out: Candidate[] = [];
  for (const re of [REL_PREFIX_RE, REL_SUFFIX_RE]) {
    for (const m of f.matchAll(re)) {
      const count = parseCount(m[1]!);
      if (count < 1) continue;
      const unit = m[2]!;
      const date =
        unit === 'ngay'
          ? addDays(today, count)
          : unit === 'tuan'
            ? addDays(today, 7 * count)
            : addMonths(today, count);
      out.push({ ...pos(m), date, pattern: 'RELATIVE', fuzzy: false, yearInferred: false });
    }
  }
  return out;
}

function matchAbsoluteWords({ f, today }: Ctx): Candidate[] {
  const out: Candidate[] = [];
  for (const m of f.matchAll(ABS_WORDS_RE)) {
    const r = resolveYmd(m[1]!, m[2]!, m[3], today);
    if (r) out.push({ ...pos(m), ...r, pattern: 'ABSOLUTE', fuzzy: false });
  }
  return out;
}

function matchSlash({ f, today }: Ctx): Candidate[] {
  const out: Candidate[] = [];
  for (const m of f.matchAll(SLASH_DATE_RE)) {
    // "24/7" la thanh ngu (luc nao cung), khong phai 24 thang 7.
    if (m[1] === '24' && m[2] === '7' && m[3] === undefined) continue;
    const r = resolveYmd(m[1]!, m[2]!, m[3], today);
    if (r) out.push({ ...pos(m), ...r, pattern: 'ABSOLUTE', fuzzy: false });
  }
  for (const m of f.matchAll(DASH_DOT_DATE_RE)) {
    const r = resolveYmd(m[1]!, m[2]!, m[3], today);
    if (r) out.push({ ...pos(m), ...r, pattern: 'ABSOLUTE', fuzzy: false });
  }
  return out;
}

type Part = 'dau' | 'giua' | 'cuoi';

function dayInMonth(part: Part, year: number, month: number): IsoDate {
  if (part === 'dau') return toIso(year, month, 1);
  if (part === 'giua') return toIso(year, month, 15);
  return lastDayOfMonth(year, month);
}

function matchFuzzy({ f, today }: Ctx): Candidate[] {
  const out: Candidate[] = [];
  const push = (m: RegExpMatchArray, date: IsoDate, yearInferred = false) =>
    out.push({ ...pos(m), date, pattern: 'FUZZY', fuzzy: true, yearInferred });

  for (const m of f.matchAll(FUZZY_PERIOD_RE)) {
    const part = m[1] as Part;
    const q = m[3]!;
    const shift = q === 'sau' || q === 'toi' ? 1 : q === 'truoc' ? -1 : 0;
    if (m[2] === 'tuan') {
      const monday = addDays(mondayOfWeek(today), 7 * shift);
      push(m, addDays(monday, part === 'dau' ? 0 : part === 'giua' ? 2 : 6));
    } else {
      const first = addMonths(`${today.slice(0, 7)}-01`, shift);
      push(m, dayInMonth(part, Number(first.slice(0, 4)), Number(first.slice(5, 7))));
    }
  }

  for (const m of f.matchAll(FUZZY_MONTH_NUM_RE)) {
    const month = Number(m[2]);
    if (month < 1 || month > 12) continue;
    let year = todayYear(today);
    let date = dayInMonth(m[1] as Part, year, month);
    if (date < today) {
      year += 1;
      date = dayInMonth(m[1] as Part, year, month);
    }
    if (isValidYmd(year, month, 1)) push(m, date, true);
  }

  for (const m of f.matchAll(FUZZY_YEAR_RE)) {
    const q = m[2];
    let year = todayYear(today);
    if (q === 'sau' || q === 'toi') year += 1;
    else if (q === 'truoc') year -= 1;
    else if (q !== undefined && q !== 'nay') year = Number(q);
    if (!isValidYmd(year, 1, 1)) continue;
    push(m, m[1] === 'dau' ? toIso(year, 1, 1) : m[1] === 'giua' ? toIso(year, 6, 30) : toIso(year, 12, 31));
  }

  for (const m of f.matchAll(FUZZY_IN_PERIOD_RE)) {
    const shift = m[2] === 'nay' ? 0 : 1;
    if (m[1] === 'tuan') {
      push(m, addDays(addDays(mondayOfWeek(today), 7 * shift), 6));
    } else {
      const first = addMonths(`${today.slice(0, 7)}-01`, shift);
      push(m, lastDayOfMonth(Number(first.slice(0, 4)), Number(first.slice(5, 7))));
    }
  }
  return out;
}

const WEEKDAY_WORD_TO_ISO: Record<string, number> = { hai: 1, ba: 2, tu: 3, nam: 4, sau: 5, bay: 6 };

/** k: thu ISO 1 (T2) .. 7 (CN). Khong co "tuan ...": lan xuat hien ke tiep, TINH CA hom nay. */
function weekdayDate(k: number, qualifier: string | undefined, today: IsoDate): IsoDate {
  const monday = mondayOfWeek(today);
  if (qualifier === 'nay') return addDays(monday, k - 1);
  if (qualifier === 'sau' || qualifier === 'toi') return addDays(monday, 7 + k - 1);
  if (qualifier === 'truoc') return addDays(monday, -7 + k - 1);
  const candidate = addDays(monday, k - 1);
  return candidate >= today ? candidate : addDays(candidate, 7);
}

function matchWeekday({ f, today }: Ctx): Candidate[] {
  const out: Candidate[] = [];
  const push = (m: RegExpMatchArray, k: number, qualifier: string | undefined) =>
    out.push({
      ...pos(m),
      date: weekdayDate(k, qualifier, today),
      pattern: 'WEEKDAY',
      fuzzy: false,
      yearInferred: false,
    });

  for (const m of f.matchAll(WEEKDAY_DIGIT_RE)) push(m, Number(m[1]) - 1, m[2]);
  for (const m of f.matchAll(WEEKDAY_WORD_RE)) push(m, WEEKDAY_WORD_TO_ISO[m[1]!]!, m[2]);
  for (const m of f.matchAll(SUNDAY_RE)) push(m, 7, m[1]);
  return out;
}

function matchDayword({ f, low, today }: Ctx): Candidate[] {
  const out: Candidate[] = [];
  for (const m of f.matchAll(DAYWORD_RE)) {
    const { start, end } = pos(m);
    const text = m[0];
    // "toi" trung "toi" (I): chi nhan khi van ban ghi ro dau "toi mai/toi nay"
    if (text.startsWith('toi') && low.slice(start, start + 3) !== 'tối') continue;
    // "ngay mot" trung "ngay mot" (day one): chi nhan khi ghi ro "ngay mot" co dau
    if (text.endsWith('mot') && !low.slice(start, end).endsWith('mốt')) continue;
    const offset = text.endsWith('mai') ? 1 : text.endsWith('kia') || text.endsWith('mot') ? 2 : 0;
    out.push({
      start,
      end,
      date: addDays(today, offset),
      pattern: 'DAYWORD',
      fuzzy: false,
      yearInferred: false,
    });
  }
  return out;
}

// Thu tu = do UU TIEN khi 2 mau cung khop 1 doan chu: cang CU THE cang dung truoc.
// Vi du "thu 6 tuan sau": neu matchRelative chay truoc se cuop chu so 6 va doc
// thanh "6 tuan sau" (26/10) thay vi thu Sau cua tuan sau (25/09).
const MATCHERS: Array<(ctx: Ctx) => Candidate[]> = [
  matchIso,
  matchWeekday,
  matchRelative,
  matchAbsoluteWords,
  matchSlash,
  matchFuzzy,
  matchDayword,
];

function maskNoise(s: string): string {
  return s.replace(NOISE_RE, (m) => ' '.repeat(m.length));
}

function lastBoundaryBefore(f: string, from: number, to: number): number {
  for (let i = to - 1; i >= from; i -= 1) {
    if (',.;!?'.includes(f.charAt(i))) return i;
  }
  return -1;
}

/** Tu khoa gan nhat (ben phai nhat) trong doan ngu canh quyet dinh vai tro. */
function keywordRole(context: string): DateRole | null {
  let bestPos = -1;
  let role: DateRole | null = null;
  for (const m of context.matchAll(START_KEYWORD_RE)) {
    if ((m.index ?? 0) > bestPos) {
      bestPos = m.index ?? 0;
      role = 'START';
    }
  }
  for (const m of context.matchAll(DUE_KEYWORD_RE)) {
    if ((m.index ?? 0) > bestPos) {
      bestPos = m.index ?? 0;
      role = 'DUE';
    }
  }
  return role;
}

/**
 * Trich moi ngay thang tieng Viet trong 1 dong. Ket qua sap theo vi tri.
 * `today` = ngay lich hien tai (YYYY-MM-DD) - dung de giai "thu 6 tuan nay",
 * "trong 2 tuan", thieu nam...
 * `start`/`end` tinh tren van ban da chuan hoa NFC; `raw` moi la doan chu dung.
 */
export function extractDatesFromLine(input: string, today: IsoDate, lineNo = 0): RuleDate[] {
  if (!isValidIso(today)) throw new Error(`"today" phai la YYYY-MM-DD hop le, nhan duoc "${today}"`);

  const text = maskNoise(input.normalize('NFC'));
  const ctx: Ctx = { f: foldText(text), low: lowerText(text), today };

  const accepted: Candidate[] = [];
  const overlaps = (c: Candidate) => accepted.some((a) => c.start < a.end && a.start < c.end);
  for (const matcher of MATCHERS) {
    for (const c of matcher(ctx).sort((a, b) => a.start - b.start)) {
      if (!overlaps(c)) accepted.push(c);
    }
  }
  accepted.sort((a, b) => a.start - b.start);

  // --- Vai tro START/DUE tu tu khoa dung truoc moi ngay ---
  const roles = accepted.map((c, i) => {
    const prevEnd = i === 0 ? 0 : accepted[i - 1]!.end;
    // Ngu canh toi da 40 ky tu truoc ngay, cat tai dau cau/phay gan nhat.
    const windowStart = Math.max(prevEnd, c.start - 40);
    const from = Math.max(windowStart, lastBoundaryBefore(ctx.f, windowStart, c.start) + 1);
    return keywordRole(ctx.f.slice(from, c.start));
  });

  // Hai ngay, chua co tu khoa, tang dan, chi cach nhau bang dau noi -> START, DUE.
  if (
    accepted.length === 2 &&
    roles[0] === null &&
    roles[1] === null &&
    accepted[0]!.date < accepted[1]!.date &&
    PURE_SEPARATOR_RE.test(ctx.f.slice(accepted[0]!.end, accepted[1]!.start))
  ) {
    roles[0] = 'START';
    roles[1] = 'DUE';
  }

  return accepted.map((c, i) => ({
    line: lineNo,
    raw: text.slice(c.start, c.end),
    start: c.start,
    end: c.end,
    date: c.date,
    role: roles[i] ?? 'DUE',
    roleExplicit: roles[i] !== null,
    pattern: c.pattern,
    fuzzy: c.fuzzy,
    yearInferred: c.yearInferred,
  }));
}

/**
 * Gop cac ngay cua 1 dong thanh (bat dau, han chot) cho 1 the:
 * - start = ngay START dau tien.
 * - due   = ngay DUE cuoi cung; neu co ngay chinh xac thi uu tien no hon moc mo.
 */
export function summarizeLineDates(dates: RuleDate[]): { start: RuleDate | null; due: RuleDate | null } {
  const start = dates.find((d) => d.role === 'START') ?? null;
  const dues = dates.filter((d) => d.role === 'DUE');
  const exact = dues.filter((d) => !d.fuzzy);
  const pool = exact.length > 0 ? exact : dues;
  return { start, due: pool.length > 0 ? pool[pool.length - 1]! : null };
}

// ===================== 3. Che do STRUCTURED / FREEFORM =====================

/**
 * Hai hang so DUY NHAT cua bo phan loai (thay cong thuc 5 he so cua ban v1).
 * Chua hieu chinh: buoc 10 (chuong danh gia) quet nguong 0.2 -> 0.6 tren bo du lieu.
 */
export const MODE_THRESHOLDS = { minContentLines: 3, structuredRatio: 0.4 } as const;

/**
 * structuredRatio = (dong heading + bullet) / (dong co noi dung).
 * STRUCTURED khi du dong VA ty le >= nguong. Chuan hoa theo do dai nen van ban
 * dai khong tu dong thanh STRUCTURED.
 */
export function detectMode(
  lines: RuleLine[],
  thresholds: { minContentLines: number; structuredRatio: number } = MODE_THRESHOLDS
): ModeDetection {
  const contentLines = lines.length;
  const structuredLines = lines.filter((l) => l.kind !== 'TEXT').length;
  const structuredRatio = contentLines === 0 ? 0 : structuredLines / contentLines;
  const mode: PlanMode =
    contentLines >= thresholds.minContentLines && structuredRatio >= thresholds.structuredRatio
      ? 'STRUCTURED'
      : 'FREEFORM';
  return { mode, structuredRatio, structuredLines, contentLines };
}

// ===================== 4. Diem vao duy nhat =====================

/** Chay het bo luat tren 1 van ban -> RuleFindings (tang 1, khong Zod: do code minh sinh ra). */
export function analyzeText(input: string, today: IsoDate): RuleFindings {
  if (!isValidIso(today)) throw new Error(`"today" phai la YYYY-MM-DD hop le, nhan duoc "${today}"`);
  const lines = splitLines(input);
  const dates = lines.flatMap((l) => extractDatesFromLine(l.text, today, l.no));
  return { today, lines, dates, ...detectMode(lines) };
}
