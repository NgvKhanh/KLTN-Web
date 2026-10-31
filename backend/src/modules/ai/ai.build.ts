// Chuyen ket qua bo luat (RuleFindings) thanh BoardPlan - duong RULE-ONLY (buoc 4),
// va (buoc 6) hop nhat them ban nhap cua LLM neu co.
//
// HAM THUAN: khong DB, khong mang, khong doc dong ho ("hom nay" la tham so).
//
// HOP NHAT VOI LLM (AI_MODULE.md §5):
//   - CAU TRUC (danh sach/the/mo ta/nhan/checklist/goi y thoi luong) lay tu ban nhap;
//   - NGAY lay tu BO LUAT theo dong nguon cua the: ngay EXPLICIT luon thang, LLM chi
//     co the goi y "offset" (bo rai lich doi thanh ngay);
//   - STRUCTURED: the khong truy vet duoc ve 1 dong CO THAT bi loai va dem vao
//     droppedCards (bien "ao giac" thanh con so do duoc); FREEFORM cho phep the tu them;
//   - ban nhap khong con the nao dung duoc -> quay ve duong rule-only (draftUsed=false).
//
// QUY TAC CHUYEN DOI (khong AI):
//   Tieu de cap 1 duy nhat va dung dau          -> ten bang
//   Tieu de khac                                -> 1 DANH SACH (chi khi co the di kem)
//   Gach dau dong cap 0                         -> 1 THE, giu nguyen van ban lam tieu de
//   Gach dau dong thut vao duoi 1 the           -> 1 muc CHECKLIST cua the do
//   Van xuoi: STRUCTURED bo qua; FREEFORM moi cau 1 the
// Khong anh xa ten nguoi: ten nam nguyen trong tieu de the (AI_MODULE.md §2).
//
// KY LUAT: giong ai.rules.ts - moi regex la hang literal, khong ghep chuoi vao
// regex, khong dung ham gio dia phuong.

import type { IsoDate } from './ai.dates';
import { foldText, summarizeLineDates, type PlanMode, type RuleDate, type RuleFindings, type RuleLine } from './ai.rules';
import { scheduleCards, type ScheduleInput } from './ai.schedule';
import {
  BOARD_COLORS,
  LIMITS,
  boardColorFromKey,
  labelColorFromKey,
  limitsForMode,
  type BoardPlan,
  type LlmDraft,
  type PlanCard,
  type PlanWarning,
  type WarningCode,
} from './boardPlan.schema';

export interface BuildOptions {
  mode: PlanMode;
  /** Ngay lich hien tai (YYYY-MM-DD). */
  today: IsoDate;
  /** Cua so du an do nguoi dung dat (tuy chon). */
  projectStart?: IsoDate | null;
  projectEnd?: IsoDate | null;
  skipWeekend: boolean;
}

export interface PlanStats {
  /** Tong so the trong ke hoach (ke ca the bo tick san). */
  totalCards: number;
  selectedCards: number;
  /** The bi cat vi vuot gioi han so luong cua che do. */
  truncatedCards: number;
  /** The co it nhat 1 ngay EXPLICIT / it nhat 1 ngay SCHEDULED / khong co ngay nao. */
  explicitCards: number;
  scheduledCards: number;
  undatedCards: number;
}

export interface BuildResult {
  plan: BoardPlan;
  stats: PlanStats;
  /** true = ke hoach dung cau truc tu ban nhap LLM; false = duong rule-only. */
  draftUsed: boolean;
  /** So the LLM de xuat nhung bi loai vi khong truy vet duoc (chi che do STRUCTURED). */
  droppedCards: number;
}

export const DEFAULT_BOARD_NAME = 'Kế hoạch từ AI';
export const DEFAULT_LIST_NAME = 'Việc cần làm';

// Muc "Thanh vien / Nhan su / Tham du" la danh sach ten nguoi, khong phai viec can
// lam -> cac the trong do duoc BO TICK SAN (khong xoa: nguoi dung tick lai duoc).
const MEMBER_HEADING_RE =
  /(?<![a-z0-9])(?:thanh vien|nhan su|tham du|nguoi tham gia|doi ngu|participants?|attendees?|members?)(?![a-z0-9])/;
const TRAILING_DOTS_RE = /[.…]+$/;

/** So cach thu gon cua 1 gioi han: gom canh bao cung ma neu co qua nhieu the. */
const MAX_WARNINGS_PER_CODE = 10;

// ===================== 1. Duyet dong -> danh sach + the tho =====================

interface RawCard {
  /** Dong nguon; null = the do LLM tu them (chi FREEFORM). */
  line: RuleLine | null;
  title: string;
  description: string;
  checklist: string[];
  labelKeys: string[];
  /** Goi y thoi luong cua LLM (null = khong co / duong rule-only). */
  startOffsetDays: number | null;
  durationDays: number | null;
}
interface RawList {
  name: string;
  memberList: boolean;
  cards: RawCard[];
}

// CODE_REVIEW.md #11: khong duoc cat doi 1 cap ky tu thay the (emoji) - chuoi con lai
// se chua nua surrogate le, Zod van nhan nhung Postgres tu choi luu JSONB -> 500.
function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  let cutAt = max;
  const last = s.charCodeAt(cutAt - 1);
  if (last >= 0xd800 && last <= 0xdbff) cutAt -= 1; // nua dau cua cap thay the
  return s.slice(0, cutAt).trimEnd();
}

/**
 * Tieu de tai lieu = tieu de cap 1 DUY NHAT va la tieu de DAU TIEN. Neu co nhieu
 * tieu de cap 1 ("# Giai doan 1", "# Giai doan 2") thi khong dong nao la tieu de
 * tai lieu, tat ca la danh sach.
 */
function findTitleLine(lines: RuleLine[]): RuleLine | null {
  const headings = lines.filter((l) => l.kind === 'HEADING');
  const first = headings[0];
  if (!first || first.level !== 1) return null;
  return headings.filter((l) => l.level === 1).length === 1 ? first : null;
}

interface WalkOptions {
  titleLine: RuleLine | null;
  /** Van xuoi cung thanh the (FREEFORM, hoac phuong an du phong). */
  textAsCards: boolean;
  /** Tieu de cung thanh the va KHONG tao danh sach (phuong an du phong). */
  headingsAsCards: boolean;
}

function walk(lines: RuleLine[], opts: WalkOptions): RawList[] {
  const lists: RawList[] = [];
  // Doi tuong trang thai (khong dung `let`): TS khong theo doi duoc bien bi gan trong ham con.
  const state: { current: RawList | null; pending: { name: string; memberList: boolean } | null } = {
    current: null,
    pending: null,
  };

  // Danh sach chi duoc tao KHI co the dau tien: tieu de khong co the di kem bi bo.
  const ensureList = (): RawList => {
    if (state.pending) {
      state.current = { name: cut(state.pending.name, LIMITS.db.listName), memberList: state.pending.memberList, cards: [] };
      lists.push(state.current);
      state.pending = null;
    } else if (!state.current) {
      state.current = { name: DEFAULT_LIST_NAME, memberList: false, cards: [] };
      lists.push(state.current);
    }
    return state.current;
  };
  const addCard = (line: RuleLine) => {
    const list = ensureList();
    const raw = line.kind === 'TEXT' ? line.text.replace(TRAILING_DOTS_RE, '') : line.text;
    list.cards.push({
      line,
      title: cut(raw === '' ? line.text : raw, LIMITS.db.cardTitle),
      description: '',
      checklist: [],
      labelKeys: [],
      startOffsetDays: null,
      durationDays: null,
    });
  };

  for (const line of lines) {
    if (opts.titleLine !== null && line.no === opts.titleLine.no) continue;

    if (line.kind === 'HEADING') {
      if (opts.headingsAsCards) {
        addCard(line);
      } else {
        state.pending = { name: line.text, memberList: MEMBER_HEADING_RE.test(foldText(line.text)) };
        state.current = null;
      }
    } else if (line.kind === 'BULLET') {
      const cur = state.current;
      const parent = cur !== null && line.level > 0 ? cur.cards[cur.cards.length - 1] : undefined;
      if (parent) {
        if (parent.checklist.length < LIMITS.maxChecklistItems) parent.checklist.push(cut(line.text, LIMITS.db.checklistItem));
      } else {
        addCard(line);
      }
    } else if (opts.textAsCards) {
      addCard(line);
    }
  }
  return lists;
}

/**
 * So dong cua cac dong nam DUOI mot tieu de "Thanh vien / Nhan su / Tham du..." TRONG VAN BAN GOC
 * (den tieu de ke tiep). Day la cach duong bo luat nhan ra danh sach ten nguoi.
 */
function memberSectionLines(lines: RuleLine[]): Set<number> {
  const out = new Set<number>();
  let inMember = false;
  for (const line of lines) {
    if (line.kind === 'HEADING') {
      inMember = MEMBER_HEADING_RE.test(foldText(line.text));
      continue;
    }
    if (inMember) out.add(line.no);
  }
  return out;
}

/**
 * Danh sach/the tu ban nhap LLM. Ban nhap da qua Zod (parseLlmDraft) nen o day chi ap
 * CHINH SACH: che do STRUCTURED loai the khong truy vet duoc ve dong that.
 *
 * Danh sach cua AI la "danh sach ten nguoi" (bo tick san) CHI KHI moi the truy vet duoc cua no xuat
 * phat tu dong nam duoi mot tieu de Thanh vien/Nhan su trong van ban goc. KHONG dua vao TEN danh
 * sach do AI dat: "Nhan su" (nhom viec tuyen nguoi) la ten hop le cho danh sach viec that
 * (buoc 10 do duoc: AI dat ten do cho the "Tuyen pha che..." lam ca danh sach bi bo tick).
 */
function walkDraft(
  draft: LlmDraft,
  lines: RuleLine[],
  mode: PlanMode
): { lists: RawList[]; dropped: number } {
  const byNo = new Map<number, RuleLine>(lines.map((l) => [l.no, l]));
  const declared = new Set(draft.labels.map((l) => l.key));
  const memberLines = memberSectionLines(lines);
  let dropped = 0;
  const lists: RawList[] = [];
  for (const dl of draft.lists) {
    const cards: RawCard[] = [];
    for (const c of dl.cards) {
      const line = c.sourceLine === null ? null : (byNo.get(c.sourceLine) ?? null);
      if (mode === 'STRUCTURED' && line === null) {
        dropped += 1;
        continue;
      }
      cards.push({
        line,
        title: cut(c.title, LIMITS.db.cardTitle),
        description: cut(c.description, LIMITS.db.cardDescription),
        checklist: c.checklist.slice(0, LIMITS.maxChecklistItems).map((x) => cut(x, LIMITS.db.checklistItem)),
        labelKeys: [...new Set(c.labelKeys)].filter((k) => declared.has(k)),
        startOffsetDays: c.startOffsetDays,
        durationDays: c.durationDays,
      });
    }
    if (cards.length > 0) {
      const traced = cards.flatMap((c) => (c.line === null ? [] : [c.line.no]));
      const memberList = traced.length > 0 && traced.every((no) => memberLines.has(no));
      lists.push({ name: cut(dl.name, LIMITS.db.listName), memberList, cards });
    }
  }
  return { lists, dropped };
}

// ===================== 2. Canh bao =====================

const WARNING_TEXT: Record<Extract<WarningCode, 'YEAR_INFERRED' | 'FUZZY_DATE' | 'RELATIVE_FROM_TODAY' | 'DATE_ORDER_FIXED'>, string> = {
  YEAR_INFERRED: 'Ngày chưa ghi năm, hệ thống đã chọn năm gần nhất chưa qua.',
  FUZZY_DATE: 'Mốc thời gian chưa chính xác (vd "cuối tháng sau"), đã quy về một ngày cụ thể.',
  RELATIVE_FROM_TODAY: 'Thời gian tương đối (vd "trong 2 tuần") được tính từ ngày hôm nay, không phải từ ngày trong văn bản.',
  DATE_ORDER_FIXED: 'Ngày bắt đầu sau hạn chót nên hai ngày đã được đổi chỗ.',
};

/** Neu cung 1 ma xuat hien tren qua nhieu the thi gop thanh 1 canh bao co so luong. */
function collapseWarnings(all: PlanWarning[]): PlanWarning[] {
  const byCode = new Map<WarningCode, PlanWarning[]>();
  for (const w of all) byCode.set(w.code, [...(byCode.get(w.code) ?? []), w]);
  const out: PlanWarning[] = [];
  for (const group of byCode.values()) {
    const first = group[0]!;
    if (group.length <= MAX_WARNINGS_PER_CODE) out.push(...group);
    else out.push({ code: first.code, message: `${group.length} thẻ: ${first.message}`, ...(first.ref ? { ref: first.ref } : {}) });
  }
  return out.slice(0, LIMITS.maxWarnings);
}

function formatViDate(iso: IsoDate): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Ma mau bang theo ten (xac dinh, khong ngau nhien): cung ten luon cung mau. */
function boardColorFor(name: string): (typeof BOARD_COLORS)[number] {
  let sum = 0;
  for (const ch of name) sum += ch.codePointAt(0) ?? 0;
  return boardColorFromKey(sum % BOARD_COLORS.length);
}

function boardNameFor(mode: PlanMode, titleLine: RuleLine | null, lines: RuleLine[]): string {
  if (titleLine) return cut(titleLine.text, LIMITS.db.boardName);
  if (mode === 'FREEFORM') {
    const first = lines.find((l) => l.kind === 'TEXT') ?? lines[0];
    if (first) {
      const name = cut(first.text.replace(TRAILING_DOTS_RE, ''), 60);
      if (name !== '') return name;
    }
  }
  return DEFAULT_BOARD_NAME;
}

// ===================== 3. Ham chinh =====================

export function buildPlan(findings: RuleFindings, opts: BuildOptions, draft: LlmDraft | null = null): BuildResult {
  const { lines } = findings;
  const limits = limitsForMode(opts.mode);
  const titleLine = findTitleLine(lines);

  // Lan 1 theo quy tac cua che do; neu khong ra the nao (vd chi co tieu de) thi
  // lan 2: moi dong (tru tieu de tai lieu) la 1 the trong 1 danh sach.
  const textAsCards = opts.mode === 'FREEFORM';
  let rawLists: RawList[] = [];
  let draftUsed = false;
  let droppedCards = 0;
  if (draft !== null) {
    const fromDraft = walkDraft(draft, lines, opts.mode);
    droppedCards = fromDraft.dropped;
    if (fromDraft.lists.length > 0) {
      rawLists = fromDraft.lists;
      draftUsed = true;
    }
  }
  if (!draftUsed) rawLists = walk(lines, { titleLine, textAsCards, headingsAsCards: false });
  let fallbackUsed = false;
  if (!draftUsed && rawLists.length === 0) {
    rawLists = walk(lines, { titleLine, textAsCards: true, headingsAsCards: true });
    fallbackUsed = true;
  }

  // Cat theo gioi han cua che do (danh sach truoc, roi tong so the), dem so the bi cat.
  const totalBefore = rawLists.reduce((n, l) => n + l.cards.length, 0);
  let budget = limits.maxTotalCards;
  const lists = rawLists.slice(0, limits.maxLists).map((l) => {
    const cards = l.cards.slice(0, Math.max(0, budget));
    budget -= cards.length;
    return { ...l, cards };
  }).filter((l) => l.cards.length > 0);
  const totalKept = lists.reduce((n, l) => n + l.cards.length, 0);
  const truncatedCards = totalBefore - totalKept;

  // ---- Ngay cua tung the ----
  const datesByLine = new Map<number, RuleDate[]>();
  for (const d of findings.dates) datesByLine.set(d.line, [...(datesByLine.get(d.line) ?? []), d]);

  interface Flat {
    list: RawList;
    card: RawCard;
    ref: string;
    selected: boolean;
    startDate: IsoDate | null;
    dueDate: IsoDate | null;
  }
  const flat: Flat[] = [];
  const refOf = new Map<RawCard, string>();
  const warnings: PlanWarning[] = [];
  for (const list of lists) {
    for (const card of list.cards) {
      const ref = `c${flat.length + 1}`;
      const lineNo = card.line?.no ?? null;
      const { start, due } = summarizeLineDates(lineNo === null ? [] : (datesByLine.get(lineNo) ?? []));
      let startDate = start?.date ?? null;
      let dueDate = due?.date ?? null;
      if (startDate !== null && dueDate !== null && startDate > dueDate) {
        [startDate, dueDate] = [dueDate, startDate];
        warnings.push({ code: 'DATE_ORDER_FIXED', message: WARNING_TEXT.DATE_ORDER_FIXED, ref, ...(lineNo === null ? {} : { line: lineNo }) });
      }
      // Moi ma canh bao toi da 1 lan tren 1 the, du ca ngay bat dau va han deu dinh
      const used = [start, due].filter((d): d is RuleDate => d !== null);
      const flags: Array<[WarningCode & keyof typeof WARNING_TEXT, boolean]> = [
        ['YEAR_INFERRED', used.some((d) => d.yearInferred)],
        ['FUZZY_DATE', used.some((d) => d.fuzzy)],
        ['RELATIVE_FROM_TODAY', used.some((d) => d.pattern === 'RELATIVE')],
      ];
      for (const [code, on] of flags) {
        if (on) warnings.push({ code, message: WARNING_TEXT[code], ref, ...(lineNo === null ? {} : { line: lineNo }) });
      }
      flat.push({ list, card, ref, selected: !list.memberList, startDate, dueDate });
      refOf.set(card, ref);
    }
  }

  // ---- Rai lich: chi cho the DUOC TICK (the bo tick khong phai viec de xep lich) ----
  // STRUCTURED: van ban la nguon su that -> khong bia ngay tru khi nguoi dung dat
  // ngay ket thuc. FREEFORM: ngay la thu ta phai sinh ra -> luon rai.
  const spreadUndated = opts.mode === 'FREEFORM' || (opts.projectEnd ?? null) !== null;
  const scheduledIdx = flat.map((f, i) => (f.selected ? i : -1)).filter((i) => i >= 0);
  const inputs: ScheduleInput[] = scheduledIdx.map((i) => ({
    startDate: flat[i]!.startDate,
    dueDate: flat[i]!.dueDate,
    startOffsetDays: flat[i]!.card.startOffsetDays,
    durationDays: flat[i]!.card.durationDays,
  }));
  const schedule = scheduleCards(inputs, {
    today: opts.today,
    start: opts.projectStart ?? null,
    end: opts.projectEnd ?? null,
    skipWeekend: opts.skipWeekend,
    spreadUndated,
  });
  for (const w of schedule.warnings) warnings.push({ code: w.code, message: w.message });

  const resultFor = new Map<number, (typeof schedule.cards)[number]>();
  scheduledIdx.forEach((flatIndex, k) => resultFor.set(flatIndex, schedule.cards[k]!));

  const planCards = new Map<string, PlanCard>();
  flat.forEach((f, i) => {
    const s = resultFor.get(i);
    planCards.set(f.ref, {
      ref: f.ref,
      title: f.card.title,
      description: f.card.description,
      sourceLine: f.card.line?.no ?? null,
      selected: f.selected,
      // The bo tick khong qua bo rai lich: chi giu ngay EXPLICIT neu co
      startDate: s ? s.startDate : f.startDate,
      startOrigin: s ? s.startOrigin : f.startDate !== null ? 'EXPLICIT' : 'NONE',
      dueDate: s ? s.dueDate : f.dueDate,
      dueOrigin: s ? s.dueOrigin : f.dueDate !== null ? 'EXPLICIT' : 'NONE',
      labelKeys: f.card.labelKeys,
      checklist: f.card.checklist,
    });
  });

  // ---- Canh bao + gia dinh + thong ke ----
  if (truncatedCards > 0) {
    warnings.unshift({
      code: 'INPUT_TRUNCATED',
      message: `Chỉ lấy ${totalKept} thẻ đầu tiên vì vượt giới hạn ${limits.maxTotalCards} thẻ của chế độ ${opts.mode} (bỏ ${truncatedCards} thẻ).`,
    });
  }
  // Gia dinh phai phan anh DUNG nhung gi da xay ra, khong phai nhung gi che do noi chung lam.
  const kept = lists.flatMap((l) => l.cards);
  const assumptions: string[] = [];
  if (droppedCards > 0) {
    warnings.unshift({
      code: 'CARD_DROPPED',
      message: `${droppedCards} thẻ do AI thêm vào không truy vết được về dòng nào trong văn bản nên đã bị loại.`,
    });
  }
  if (draftUsed) {
    for (const a of draft!.assumptions) assumptions.push(cut(a, 300));
  } else if (fallbackUsed) {
    assumptions.push('Văn bản không có gạch đầu dòng nên mỗi dòng được coi là một thẻ.');
  } else {
    if (kept.some((c) => c.line?.kind === 'BULLET')) assumptions.push('Mỗi gạch đầu dòng được coi là một thẻ.');
    if (kept.some((c) => c.line?.kind === 'TEXT')) {
      assumptions.push('Mỗi câu văn xuôi được coi là một thẻ vì chưa có AI để chọn câu nào là việc cần làm.');
    } else if (lines.some((l) => l.kind === 'TEXT')) {
      assumptions.push('Đoạn văn xuôi không được chuyển thành thẻ.');
    }
  }
  if (warnings.some((w) => w.code === 'RELATIVE_FROM_TODAY')) {
    assumptions.push(`Ngày hôm nay được tính là ${formatViDate(opts.today)}.`);
  }

  // Tieu de tai lieu (neu co) thang ten do LLM dat: do la van ban that cua nguoi dung.
  const draftName = draftUsed ? draft!.board.name.trim() : '';
  const boardName = titleLine || draftName === '' ? boardNameFor(opts.mode, titleLine, lines) : cut(draftName, LIMITS.db.boardName);
  const plan: BoardPlan = {
    mode: opts.mode,
    board: { name: boardName, color: draftUsed ? boardColorFromKey(draft!.board.colorKey) : boardColorFor(boardName) },
    labels: draftUsed
      ? draft!.labels.map((l) => ({ key: l.key, name: l.name, color: labelColorFromKey(l.colorKey) }))
      : [],
    lists: lists.map((l) => ({
      name: l.name,
      cards: l.cards.map((c) => planCards.get(refOf.get(c)!)!),
    })),
    warnings: collapseWarnings(warnings),
    assumptions: assumptions.slice(0, LIMITS.maxPlanAssumptions),
  };
  // Van ban co the chi gom tieu de/ky hieu: van tra 1 danh sach rong de giu hop dong (>= 1 danh sach)
  if (plan.lists.length === 0) plan.lists.push({ name: DEFAULT_LIST_NAME, cards: [] });

  const all = [...planCards.values()];
  const has = (c: PlanCard, o: 'EXPLICIT' | 'SCHEDULED') => c.startOrigin === o || c.dueOrigin === o;
  return {
    plan,
    draftUsed,
    droppedCards,
    stats: {
      totalCards: all.length,
      selectedCards: all.filter((c) => c.selected).length,
      truncatedCards,
      explicitCards: all.filter((c) => has(c, 'EXPLICIT')).length,
      scheduledCards: all.filter((c) => has(c, 'SCHEDULED')).length,
      undatedCards: all.filter((c) => c.startOrigin === 'NONE' && c.dueOrigin === 'NONE').length,
    },
  };
}
