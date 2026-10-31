// Ngay han cua thao tac: LLM chi KHAI (DateSpec), SERVER doi ra ngay that. Luat thang LLM ve ngay thang (AI_MODULE.md §3.4): neu
// cau cua nguoi dung co ngay ma bo luat tieng Viet cua module AI (extractDatesFromLine) tim duoc thi dung NGAY DO, khong tin
// ngay LLM tu tinh. HAM THUAN: "hom nay" luon la tham so (todayInVietnam do noi goi tinh), khong doc dong ho o day.
//
// Quy uoc han cua du an (ai.apply.ts dueInstant): 23:59 gio Viet Nam (+07:00) cua ngay do.

import { addDays, isValidIso, isoWeekday, mondayOfWeek, type IsoDate } from '../../../ai/ai.dates';
import { dueInstant, startInstant } from '../../../ai/ai.apply';
import { extractDatesFromLine } from '../../../ai/ai.rules';
import type { DateSpec } from './actions.schema';
import { foldWords, hasAny, type Phrase } from './actions.text';

export type DueResolution = { kind: 'DATE'; date: IsoDate } | { kind: 'CLEAR' } | { kind: 'INVALID' };

/** DateSpec -> ngay lich (theo hom nay o Viet Nam). Tuan tinh Thu Hai -> Chu nhat, "cuoi tuan" = Chu nhat. */
export function resolveDateSpec(spec: DateSpec, today: IsoDate): DueResolution {
  switch (spec.type) {
    case 'NONE':
      return { kind: 'CLEAR' };
    case 'ABSOLUTE':
      return isValidIso(spec.date) ? { kind: 'DATE', date: spec.date } : { kind: 'INVALID' };
    case 'RELATIVE_DAYS':
      return { kind: 'DATE', date: addDays(today, spec.days) };
    case 'END_OF_WEEK':
      return { kind: 'DATE', date: addDays(mondayOfWeek(today), 6) };
    case 'WEEKDAY':
      return { kind: 'DATE', date: addDays(mondayOfWeek(today), spec.weekday - 1 + (spec.week === 'NEXT' ? 7 : 0)) };
  }
}

const CLEAR_DUE_PHRASES: readonly Phrase[] = [
  ['bo', 'han'],
  ['xoa', 'han'],
  ['huy', 'han'],
  ['go', 'han'],
  ['khong', 'han'],
  ['khong', 'co', 'han'],
  ['bo', 'deadline'],
  ['xoa', 'deadline'],
  ['huy', 'deadline'],
  ['go', 'deadline'],
];

interface FoundDate {
  date: IsoDate;
  fuzzy: boolean;
}

const WEEKDAY_WORD_ISO: Readonly<Record<string, number>> = { hai: 1, ba: 2, tu: 3, nam: 4, sau: 5, bay: 6 };
// Tu chi HAN dung ngay truoc ("han ... la thu sau", "doi han sang thu sau", "truoc thu sau", "den thu sau").
const DUE_CUES: ReadonlySet<string> = new Set(['han', 'deadline', 'due', 'den', 'truoc', 'sang', 'toi', 'la', 'vao', 'dat', 'luc']);
const WEEK_QUALIFIERS: ReadonlySet<string> = new Set(['nay', 'sau', 'toi', 'truoc']);

/**
 * "thu sau" va "cuoi tuan" GOI TRON (khong kem "tuan nay / tuan sau"): bo luat cua module AI chu y khong nhan vi trong van ban dai
 * chung de nham voi so thu tu ("buoc thu tu", "lan thu nam"). Trong MOT CAU LENH ngan, day lai la cach noi thong thuong nhat cua
 * han, nen nhan o day - nhung CHI khi co tu chi han dung ngay truoc (toi da 3 tu), de khong nhan nham "thu" trong ten the.
 * "thu <X>" tro = lan xuat hien KE TIEP cua thu do, tinh ca hom nay (cung quy uoc voi bo luat module AI); "cuoi tuan" = Chu nhat
 * tuan nay va luon la moc MO.
 */
function bareDueDates(message: string, today: IsoDate): FoundDate[] {
  const words = foldWords(message);
  const cued = (i: number) => words.slice(Math.max(0, i - 3), i).some((w) => DUE_CUES.has(w));
  const found: FoundDate[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const next = words[i + 1];
    if (words[i] === 'thu' && next !== undefined && Object.hasOwn(WEEKDAY_WORD_ISO, next)) {
      const qualified = words[i + 2] === 'tuan' && WEEK_QUALIFIERS.has(words[i + 3] ?? '');
      if (qualified || !cued(i)) continue; // "thu sau tuan nay" da do bo luat module AI xu ly
      const ahead = (WEEKDAY_WORD_ISO[next] - isoWeekday(today) + 7) % 7;
      found.push({ date: addDays(today, ahead), fuzzy: false });
    } else if (words[i] === 'cuoi' && next === 'tuan') {
      if (WEEK_QUALIFIERS.has(words[i + 2] ?? '') || !cued(i)) continue;
      found.push({ date: addDays(mondayOfWeek(today), 6), fuzzy: true });
    }
  }
  return found;
}

/** Cac ngay BAT DAU (role START do bo luat module AI nhan qua tu khoa "bat dau tu / ngay bat dau / start") tim thay trong cau. */
export function startDatesInMessage(message: string, today: IsoDate): FoundDate[] {
  const byDate = new Map<IsoDate, FoundDate>();
  for (const d of extractDatesFromLine(message, today)) {
    if (d.role !== 'START') continue;
    const prev = byDate.get(d.date);
    if (prev === undefined || (prev.fuzzy && !d.fuzzy)) byDate.set(d.date, { date: d.date, fuzzy: d.fuzzy });
  }
  return [...byDate.values()];
}

/** Cac ngay HAN (khong phai ngay bat dau) tim thay trong cau: bo luat module AI + cach noi goi tron cua cau lenh; da bo trung. */
export function dueDatesInMessage(message: string, today: IsoDate): FoundDate[] {
  const byDate = new Map<IsoDate, FoundDate>();
  const add = (d: FoundDate) => {
    const prev = byDate.get(d.date);
    // cung mot ngay duoc nhac hai lan: giu cach noi CHINH XAC (khong mo) neu co
    if (prev === undefined || (prev.fuzzy && !d.fuzzy)) byDate.set(d.date, d);
  };
  for (const d of extractDatesFromLine(message, today)) {
    if (d.role === 'DUE') add({ date: d.date, fuzzy: d.fuzzy });
  }
  for (const d of bareDueDates(message, today)) add(d);
  return [...byDate.values()];
}

export interface DueGrounding {
  resolution: DueResolution;
  /** Ngay (hoac y bo han) co MAT trong chinh cau cua nguoi dung. */
  grounded: boolean;
  /** Moc mo ("cuoi tuan", "cuoi thang"): nen cho nguoi dung xem lai ngay da hieu. */
  fuzzy: boolean;
  /** LLM khai mot ngay khac voi ngay trong cau -> da dung ngay trong cau. */
  llmDiffers: boolean;
}

const CLEAR_START_PHRASES: readonly Phrase[] = [['bo', 'ngay', 'bat', 'dau'], ['xoa', 'ngay', 'bat', 'dau'], ['huy', 'ngay', 'bat', 'dau'], ['go', 'ngay', 'bat', 'dau'], ['khong', 'co', 'ngay', 'bat', 'dau']];

/** Giong groundDue nhung cho NGAY BAT DAU: ngay phai co mat trong cau voi vai tro START (khong nhan nham ngay han). */
export function groundStart(spec: DateSpec, message: string, today: IsoDate): DueGrounding {
  const llm = resolveDateSpec(spec, today);
  if (llm.kind === 'INVALID') return { resolution: llm, grounded: false, fuzzy: false, llmDiffers: false };
  if (llm.kind === 'CLEAR') return { resolution: llm, grounded: hasAny(foldWords(message), CLEAR_START_PHRASES), fuzzy: false, llmDiffers: false };
  const found = startDatesInMessage(message, today);
  if (found.length === 0) return { resolution: llm, grounded: false, fuzzy: false, llmDiffers: false };
  const same = found.find((f) => f.date === llm.date);
  if (found.length === 1) return { resolution: { kind: 'DATE', date: found[0].date }, grounded: true, fuzzy: found[0].fuzzy, llmDiffers: same === undefined };
  return same !== undefined ? { resolution: llm, grounded: true, fuzzy: same.fuzzy, llmDiffers: false } : { resolution: llm, grounded: false, fuzzy: false, llmDiffers: false };
}

export function groundDue(spec: DateSpec, message: string, today: IsoDate): DueGrounding {
  const llm = resolveDateSpec(spec, today);
  if (llm.kind === 'INVALID') return { resolution: llm, grounded: false, fuzzy: false, llmDiffers: false };
  if (llm.kind === 'CLEAR') {
    return { resolution: llm, grounded: hasAny(foldWords(message), CLEAR_DUE_PHRASES), fuzzy: false, llmDiffers: false };
  }
  const found = dueDatesInMessage(message, today);
  if (found.length === 0) return { resolution: llm, grounded: false, fuzzy: false, llmDiffers: false };
  const same = found.find((f) => f.date === llm.date);
  if (found.length === 1) {
    const only = found[0];
    return { resolution: { kind: 'DATE', date: only.date }, grounded: true, fuzzy: only.fuzzy, llmDiffers: same === undefined };
  }
  // nhieu ngay trong cau: chi chap nhan khi ngay LLM khai trung mot trong cac ngay do
  return same !== undefined
    ? { resolution: llm, grounded: true, fuzzy: same.fuzzy, llmDiffers: false }
    : { resolution: llm, grounded: false, fuzzy: false, llmDiffers: false };
}

/** Ngay bat dau luu vao CSDL (ISO UTC): 00:00 gio Viet Nam cua ngay do (cung quy uoc voi ai.apply). */
export function startIso(date: IsoDate): string {
  return startInstant(date).toISOString();
}

/** Han luu vao CSDL (ISO UTC) cua mot ngay lich. */
export function dueIso(date: IsoDate): string {
  return dueInstant(date).toISOString();
}

const VN_OFFSET_MS = 7 * 3_600_000;

/** Ngay lich Viet Nam cua mot thoi diem ISO (chi dung UTC, khong phu thuoc TZ may chu). */
export function vnDayOfIso(iso: string): IsoDate {
  return new Date(Date.parse(iso) + VN_OFFSET_MS).toISOString().slice(0, 10);
}

const WEEKDAY_NAMES = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];

/** "Thứ Sáu, 09/10/2026". */
export function formatDueDate(date: IsoDate): string {
  const [year, month, day] = date.split('-');
  return `${WEEKDAY_NAMES[isoWeekday(date) - 1]}, ${day}/${month}/${year}`;
}
