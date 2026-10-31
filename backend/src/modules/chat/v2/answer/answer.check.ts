// BỘ KIỂM CÂU TRẢ LỜI TỰ DO của chatbot v2 (bước C). HÀM THUẦN, không CSDL.
//
// Mô hình được viết một đoạn trả lời ngắn (`finish.answer`) dựa trên kết quả công cụ. Backend KHÔNG tin đoạn đó: nó chỉ được hiện khi qua các
// phép kiểm dưới đây, và luôn đứng cạnh các khối dữ liệu do server dựng (người dùng đối chiếu được). Sai thì bỏ (cho mô hình viết lại một lần).
//
// Nguyên tắc: mô hình chỉ được nhắc đến những gì CÓ trong kết quả đã tra cứu hoặc trong chính câu hỏi.
//   - Số: mọi dãy chữ số phải xuất hiện trong dữ liệu (số đếm, chữ số trong tiêu đề / tên, ngày giờ đã đổi sang giờ Việt Nam) hoặc trong câu hỏi.
//         Số thập phân, số La Mã, số viết bằng chữ ("bảy", "một") bị loại vì không đối chiếu được.
//   - Tên riêng: từ viết hoa GIỮA câu phải có trong dữ liệu / câu hỏi; từ viết hoa ĐẦU câu phải có trong dữ liệu hoặc là từ mở đầu câu thông dụng
//         (nên một cái tên bịa ở đầu câu cũng lộ ra). Đoạn trong dấu ngoặc kép phải khớp nguyên văn một chuỗi trong dữ liệu.
//   - Hình thức: không liên kết, không ký hiệu định dạng (markdown / HTML), độ dài có trần.
// Giới hạn đã biết: kiểm này KHÔNG chứng minh một nhận định ("việc này chậm") là đúng; nó chặn bịa SỐ và bịa TÊN. Nhận định vẫn phải đọc cùng khối dữ liệu.
import { foldText } from '../../../ai/ai.rules';
import { tokenize, type Token } from '../../chat.members';
import { vietnamDay } from '../chat.v2.dates';

export const MAX_ANSWER_CHARS = 1200;
export type AnswerRejectReason = 'EMPTY' | 'TOO_LONG' | 'MARKUP' | 'TIMESTAMP' | 'NUMBER' | 'DECIMAL' | 'NUMBER_WORD' | 'PROPER_NOUN' | 'QUOTE';
export type AnswerCheck = { ok: true; text: string } | { ok: false; reason: AnswerRejectReason; detail: string };

/** Những gì mô hình được phép nhắc tới. */
export interface AnswerFacts {
  /** Dãy chữ số hợp lệ. */
  numbers: Set<string>;
  /** Từ (bỏ dấu, chữ thường) xuất hiện trong dữ liệu / câu hỏi. */
  words: Set<string>;
  /** Cùng các từ đó nhưng GIỮ DẤU (chữ thường): từ có dấu chỉ khớp bản có dấu ("Đăng" không khớp "Đang"), giống quy tắc so tên của module chatbot. */
  exact: Set<string>;
  /** Chuỗi nguyên văn (bỏ dấu, chữ thường, gộp khoảng trắng) để đối chiếu đoạn trong ngoặc kép. */
  phrases: string[];
}

const ID_KEY = /(^id$|Id$|^ids$|Ids$)/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const MARKUP = new Set(['*', '#', '`', '[', ']', '<', '>', '|', '_', '~', '@', '\t', '\r', '{', '}', '\\']);
const LINK = ['http:', 'https:', 'www.'];
const SENTENCE_END = new Set(['.', '!', '?', ':', '…', ';']);
const pad2 = (n: number) => String(n).padStart(2, '0');

const fold = (s: string) => foldText(s.normalize('NFC').toLowerCase()).replace(/\s+/g, ' ').trim();
function addNumber(out: Set<string>, n: number | string): void { out.add(String(Number(n))); out.add(String(n)); }
/** Các thành phần ngày giờ THEO GIỜ VIỆT NAM của một mốc thời gian (người dùng thấy ngày giờ này, không phải giờ UTC trong dữ liệu). */
function addVietnamParts(out: Set<string>, d: Date): void {
  const day = vietnamDay(d);
  const [y, m, dd] = day.split('-');
  const vn = new Date(d.getTime() + 7 * 3_600_000);
  for (const p of [y, m, dd, String(vn.getUTCHours()), String(vn.getUTCMinutes())]) addNumber(out, p);
  out.add(pad2(vn.getUTCHours())); out.add(pad2(vn.getUTCMinutes()));
}
function digitRuns(text: string): string[] { return text.match(/\d+/g) ?? []; }

/** Gom sự thật từ các giá trị JSON (kết quả công cụ, câu hỏi...). Chuỗi dưới khoá id / *Id bị bỏ qua (id nội bộ chứa chữ số ngẫu nhiên). */
export function collectFacts(values: readonly unknown[], extraText: readonly string[] = []): AnswerFacts {
  const facts: AnswerFacts = { numbers: new Set(), words: new Set(ALWAYS_WORDS), exact: new Set(ALWAYS_EXACT), phrases: [] };
  const addText = (s: string) => {
    for (const t of tokenize(s)) { facts.words.add(t.fold); facts.exact.add(t.orig); }
    for (const r of digitRuns(s)) addNumber(facts.numbers, r);
    const f = fold(s);
    if (f) facts.phrases.push(f);
  };
  const walk = (v: unknown, key = ''): void => {
    if (typeof v === 'number') { if (Number.isFinite(v) && v >= 0 && Number.isInteger(v)) addNumber(facts.numbers, v); return; }
    if (typeof v === 'string') {
      if (ID_KEY.test(key)) return;
      if (ISO.test(v) && Number.isFinite(Date.parse(v))) { addVietnamParts(facts.numbers, new Date(v)); return; }
      addText(v);
      return;
    }
    if (Array.isArray(v)) { for (const x of v) walk(x, key); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(x, k);
  };
  for (const v of values) walk(v);
  for (const t of extraText) addText(t);
  return facts;
}

/** Từ viết hoa luôn được nhắc tới: tên sản phẩm, "Việt Nam" (giờ Việt Nam) và tên thứ trong tuần / Chủ Nhật. */
const ALWAYS_WORDS = ['taskflow', 'viet', 'nam', 'hai', 'ba', 'tu', 'sau', 'bay', 'chu', 'nhat'];
const ALWAYS_EXACT = [...ALWAYS_WORDS, 'việt', 'tư', 'sáu', 'bảy', 'chủ', 'nhật'];

/** Từ mở đầu câu thông dụng (đã bỏ dấu, chữ thường). Một từ lạ ở đầu câu phải có trong dữ liệu, nếu không có thể là tên bịa. */
const COMMON_STARTERS = new Set(`
a ai anh ban bao bang bo bi boi cac cach can cap cau cho chua chung co con cong cot cung da dang day de den do doi dua duoc dung gan hai han hay hien hom khi khong kha khac ket
la lam lan lay luc may minh moi mot muc nay neu nen nguoi nhan nhung nhieu nhom nhu noi o phan qua quan sau so sap tat the theo thi thanh thay thieu tinh tong trang trong tron
tren tuan tu tuy ty toi tin ve vi viec vua va voi vay xem xin yeu y
chao thu binh luan tep dinh hoan checklist muc tien lich su thay gio ngay thang khoang duoi ngoai nhat it ca cung chi moi nao ngay gom phu trach giao nhan tai len viet sua tao xoa kem hop he thong du lieu truy van tra cuu thong ke thieu tre
`.split(/\s+/).filter(Boolean));
const NUMBER_WORDS = tokenize('một hai ba bốn tư năm lăm sáu bảy bẩy tám chín mười mươi chục trăm nghìn ngàn triệu tỷ tỉ nửa');
// So khớp CÓ DẤU: câu trả lời của mô hình luôn có dấu, còn bỏ dấu sẽ nhầm "sau" (after) với "sáu", "nam" với "năm", "lam" với "lăm"...
const isNumberWord = (t: Token) => NUMBER_WORDS.some((w) => t.orig === w.orig);

interface Word { token: Token; capitalized: boolean; sentenceStart: boolean }
function wordsOf(text: string): Word[] {
  const out: Word[] = [];
  let prevEnd = 0;
  for (const m of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const raw = m[0];
    const start = m.index ?? 0;
    const between = text.slice(prevEnd, start);
    const trimmed = between.trim();
    // đầu văn bản, sau dấu kết câu, sau xuống dòng, hoặc sau gạch đầu dòng / số thứ tự
    const sentenceStart = out.length === 0 || between.includes('\n') || (trimmed !== '' && (SENTENCE_END.has(trimmed.charAt(trimmed.length - 1)) || /^[-–•]$/.test(trimmed)));
    const first = raw.charAt(0);
    out.push({ token: tokenize(raw)[0], capitalized: first !== first.toLowerCase() && !/\p{N}/u.test(first), sentenceStart });
    prevEnd = start + raw.length;
  }
  return out;
}

export function validateAnswer(raw: string, facts: AnswerFacts): AnswerCheck {
  const text = raw.normalize('NFC').trim();
  if (text === '') return { ok: false, reason: 'EMPTY', detail: 'Câu trả lời trống.' };
  if (Array.from(text).length > MAX_ANSWER_CHARS) return { ok: false, reason: 'TOO_LONG', detail: `Tối đa ${MAX_ANSWER_CHARS} ký tự.` };
  const lower = text.toLowerCase();
  const badChar = Array.from(text).find((ch) => MARKUP.has(ch));
  if (badChar !== undefined || LINK.some((l) => lower.includes(l))) return { ok: false, reason: 'MARKUP', detail: `Không dùng ký hiệu định dạng, liên kết hay địa chỉ thư${badChar ? ` (đang có “${badChar}”)` : ''}; chỉ chữ thường, xuống dòng và gạch đầu dòng “- ”.` };

  // Gemini hay chép nguyên mốc ISO của dữ liệu (UTC): không phải giờ người dùng thấy và dễ đọc nhầm; bắt riêng để mô hình biết sửa đúng chỗ.
  const iso = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}\S*/);
  if (iso) return { ok: false, reason: 'TIMESTAMP', detail: `Không chép nguyên mốc thời gian dạng ISO / UTC (“${iso[0].slice(0, 30)}”). Hãy nói ngày dạng dd/mm (ví dụ 07/10) và giờ theo GIỜ VIỆT NAM, hoặc bỏ mốc thời gian.` };

  // --- số ---
  for (const line of text.split('\n')) {
    const body = line.replace(/^\s*\d{1,2}[.)]\s+/, ' '); // số thứ tự đầu dòng ("1. ...") là đánh số, không phải số liệu
    if (/\d[.,]\d/.test(body)) return { ok: false, reason: 'DECIMAL', detail: 'Không dùng số thập phân hay dấu phân cách hàng nghìn; chỉ số nguyên có trong kết quả.' };
    for (const run of digitRuns(body)) {
      if (!facts.numbers.has(run) && !facts.numbers.has(String(Number(run)))) return { ok: false, reason: 'NUMBER', detail: `Số “${run}” không có trong kết quả tra cứu hay câu hỏi (không tự đếm các dòng, không cộng / trừ / làm tròn). Muốn số theo người / thẻ / ngày: gọi query_data với groupBy rồi dùng số của nhóm; còn không thì bỏ con số này.` };
    }
  }
  if (/\p{N}/u.test(text.replace(/[0-9]/g, ''))) return { ok: false, reason: 'NUMBER', detail: 'Chỉ dùng chữ số 0-9.' };

  const words = wordsOf(text);
  // Ngoại lệ: thứ Hai..thứ Bảy (tên thứ trùng số đếm) và tên người viết hoa có trong dữ liệu ("Nam" trùng "năm" khi bỏ dấu).
  const numberWord = words.find((w, i) => isNumberWord(w.token) && words[i - 1]?.token.fold !== 'thu' && !(w.capitalized && w.token.plain && facts.words.has(w.token.fold)));
  if (numberWord) return { ok: false, reason: 'NUMBER_WORD', detail: `Không viết số bằng chữ (“${numberWord.token.raw}”); dùng chữ số, hoặc diễn đạt không nêu số (“các”, “nhiều”, “vài”).` };

  // --- đoạn trong ngoặc kép phải khớp nguyên văn dữ liệu ---
  for (const m of text.matchAll(/[“"]([^”"]{1,200})[”"]/gu)) {
    const inner = fold(m[1]);
    if (inner && !facts.phrases.some((p) => p.includes(inner))) return { ok: false, reason: 'QUOTE', detail: `Đoạn “${m[1]}” không có nguyên văn trong kết quả tra cứu.` };
  }

  // --- tên riêng ---
  for (const w of words) {
    if (!w.capitalized) continue;
    const f = w.token.fold;
    if (w.token.plain ? facts.words.has(f) : facts.exact.has(w.token.orig)) continue;
    if (w.sentenceStart && COMMON_STARTERS.has(f)) continue;
    return { ok: false, reason: 'PROPER_NOUN', detail: `“${w.token.raw}” ${w.sentenceStart ? 'ở đầu câu' : 'viết hoa giữa câu'} nhưng không có trong kết quả tra cứu hay câu hỏi. Không nêu tên người, thẻ, bảng, nhãn không có trong kết quả.` };
  }
  return { ok: true, text };
}
