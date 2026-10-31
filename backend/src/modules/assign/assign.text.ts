// Tach tu tieng Viet cho module goi y phan cong (ASSIGN_MODULE.md §5.1).
//
// HAM THUAN: khong Prisma, khong dong ho, khong mang. Dau vao la chu cua the (tieu de + mo ta),
// dau ra la cac "thuat ngu" (term) de dem TF-IDF o assign.tfidf.ts.
//
// THIET KE QUAN TRONG - vi sao hu tu duoc xet TRUOC khi bo dau:
//   Bo dau lam nhieu tu khac nhau thanh mot: "bang" (hu tu: bang Google) va "bang" (noi dung: bang
//   nguoi dung), "dang" (dang lam) va "dang" (dang nhap), "trong" (hu tu) va "trong" (trong so).
//   Neu xet hu tu tren dang DA bo dau thi se xoa mat "bang", "dang", "trong" - ba tu noi dung cua
//   chinh du an nay. Vi vay: hu tu duoc nhan dien tren dang CO DAU nguoi dung go; chi sau do moi
//   bo dau de ra thuat ngu (nhu vay "dang nhap" go khong dau van khop "đăng nhập").
//   Rieng chu go KHONG dau: bo them cac hu tu KHONG mo ho (STOP_PLAIN) va cac hu tu von khong dau.
//
// QUY UOC (giong ai.rules.ts, vi day cung la dau vao do nguoi dung nhap):
//  - Khong ghep chuoi vao regex; moi regex la hang literal; khong co phep lap khong gioi han long nhau.
//  - Bo tach quet MOT LAN theo tung ky tu, khong dung regex tren ca chuoi -> thoi gian tuyen tinh.

import { foldText, normalizeText } from '../ai/ai.rules';

/** Tieu de dem gap doi mo ta: tieu de mang nhieu thong tin hon, mo ta hay co cau dem. */
export const TITLE_WEIGHT = 2;
/** Chi doc toi da chung nay ky tu moi truong (mo ta the co the rat dai). */
export const MAX_TEXT_CHARS = 4000;
/** Token dai hon (theo ky tu) la rac (URL, ma bam, chuoi dinh) -> bo. */
export const MAX_TOKEN_CHARS = 30;
const MIN_TOKEN_CHARS = 2;

/**
 * Hu tu, viet THUONG, GIU DAU. Chi gom tu ma dang co dau cua no khong trung voi tu noi dung nao
 * trong linh vuc quan ly cong viec. Co chu y KHONG dua vao: "cơ" (co so du lieu), "nền" (mau nen),
 * "đề" (de tai), "vẽ", "vá", "trọng" (trong so), "đăng", "bảng", "tải" - deu la tu noi dung; va cac
 * tu HAI NGHIA ngay ca khi co dau: "chỉ" (chi muc), "từ" (tu khoa), "quá" (qua han). Duoc phat hien
 * khi tham do ("Tao chỉ mục" mat "chi"), khong phai luc thiet ke - xem test cum tu linh vuc.
 */
const STOP_ACCENTED: ReadonlySet<string> = new Set([
  'và', 'của', 'cho', 'các', 'những', 'một', 'được', 'khi', 'để', 'là', 'có', 'không', 'với',
  'trong', 'này', 'đó', 'kia', 'ấy', 'nào', 'như', 'thì', 'mà', 'cũng', 'đã', 'sẽ', 'đang', 'rồi',
  'còn', 'nữa', 'hay', 'hoặc', 'nhưng', 'nếu', 'vì', 'nên', 'do', 'bởi', 'tại', 'đến', 'tới',
  'ở', 'trên', 'dưới', 'ngoài', 'giữa', 'theo', 'về', 'cùng', 'cả', 'mỗi', 'mọi', 'bằng', 'sau',
  'trước', 'lúc', 'đây', 'đấy', 'rất', 'lại', 'vào', 'lên', 'xuống', 'bị', 'phải', 'cần',
  'vẫn', 'chưa', 'đều', 'nhé', 'ạ', 'thôi', 'luôn', 'vậy', 'thế', 'gì', 'mình', 'bạn',
  'tôi', 'chị',
]);

/**
 * Hu tu khi nguoi dung go KHONG DAU (chi xet khi token khong co dau nao de bo). Chi giu dang khong
 * mo ho: "cua" khong phai tu noi dung nao, con "co"(co/cơ), "nen"(nen/nền), "dang"(đang/đăng),
 * "bang"(bằng/bảng), "ve"(về/vẽ), "va"(và/vá), "moi"(mới/mỗi/mời) deu KHONG co mat o day.
 * LUU Y: cac hu tu von khong dau (cho, do, hay, khi, sau, theo, trong...) nam o STOP_ACCENTED va ap
 * dung cho ca chu go khong dau, vi hai cach viet trung nhau - he qua chap nhan: "trọng số" go KHONG
 * dau mat "trong" (con go co dau thi giu). Test doi chieu tu vung linh vuc de dam bao danh sach
 * nay khong nuot mat tu noi dung.
 */
export const STOP_PLAIN: ReadonlySet<string> = new Set([
  'cua', 'cac', 'mot', 'duoc', 'voi', 'tren', 'giua', 'truoc',
  // Tieng Anh: chi nhung tu KHONG trung tu Viet go khong dau. KHONG dua vao: "the" (= "thẻ", tu trung
  // tam cua ung dung nay!), "that" (= "thất bại"), "in" (= in an), "to" (= to lon).
  'and', 'for', 'with', 'of', 'this',
]);

// Ky tu lam DUT cau: bigram khong duoc bac qua. Dau gach noi/gach duoi/khoang trang chi tach token.
const SEGMENT_BREAK: ReadonlySet<string> = new Set([
  '.', ',', ';', ':', '!', '?', '(', ')', '[', ']', '{', '}', '"', '“', '”', '‘',
  '’', '/', '\\', '|', '…', '\n',
]);

// Ky tu thuoc mot tu: chu, dau ket hop (NFC con sot), so. Kiem tra tung ky tu, khong lap.
const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u;
// "Khong co ky tu nao KHONG phai so" = toan chu so.
const NON_DIGIT = /[^\p{N}]/u;

/** Mot token tho: dang co dau (thuong) va dang bo dau. */
interface RawToken {
  lower: string;
  folded: string;
}

function isStop(t: RawToken): boolean {
  if (STOP_ACCENTED.has(t.lower)) return true;
  // Go khong dau (khong co dau nao de bo) moi xet danh sach khong dau
  return t.lower === t.folded && STOP_PLAIN.has(t.folded);
}

function isKept(t: RawToken): boolean {
  const len = Array.from(t.folded).length;
  if (len < MIN_TOKEN_CHARS || len > MAX_TOKEN_CHARS) return false;
  if (!NON_DIGIT.test(t.folded)) return false; // toan chu so ("2026", "3")
  return !isStop(t);
}

/**
 * Cac doan (tach o dau cau); moi doan la day token, `null` danh dau token BI BO (hu tu, qua ngan,
 * toan so...) - van chiem cho de bigram khong bac qua no.
 */
function segments(text: string): (string | null)[][] {
  const clipped = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
  const src = normalizeText(clipped);

  const out: (string | null)[][] = [];
  let seg: (string | null)[] = [];
  let word = '';

  const flushWord = () => {
    if (word === '') return;
    const raw: RawToken = { lower: word.toLowerCase(), folded: foldText(word) };
    seg.push(isKept(raw) ? raw.folded : null);
    word = '';
  };
  const flushSegment = () => {
    flushWord();
    if (seg.length > 0) out.push(seg);
    seg = [];
  };

  for (const ch of src) {
    if (WORD_CHAR.test(ch)) {
      word += ch;
    } else if (SEGMENT_BREAK.has(ch)) {
      flushSegment();
    } else {
      flushWord(); // khoang trang, gach noi, ky hieu khac: chi tach token
    }
  }
  flushSegment();
  return out;
}

/**
 * Thuat ngu cua mot doan chu: TRUOC het cac uni-gram theo thu tu, ROI cac bi-gram (hai token GIU LAI
 * ke nhau trong cung mot doan, cach nhau mot dau cach). Bi-gram la cach re nhat de bat cum
 * "dang nhap", "kiem thu", "co so du lieu" ma khong can thu vien tach tu.
 */
export function tokenize(text: string): string[] {
  const unigrams: string[] = [];
  const bigrams: string[] = [];
  for (const seg of segments(text)) {
    for (let i = 0; i < seg.length; i += 1) {
      const a = seg[i];
      if (a === null || a === undefined) continue;
      unigrams.push(a);
      const b = seg[i + 1];
      if (b !== null && b !== undefined) bigrams.push(`${a} ${b}`);
    }
  }
  return [...unigrams, ...bigrams];
}

export interface CardText {
  title: string;
  description?: string | null;
}

/** So lan xuat hien (co trong so) cua tung thuat ngu trong mot the: tieu de nhan `titleWeight`, mo ta nhan 1. */
export function countTerms(card: CardText, titleWeight: number = TITLE_WEIGHT): Map<string, number> {
  if (!Number.isFinite(titleWeight) || titleWeight < 0) {
    throw new RangeError('titleWeight phai la so huu han >= 0');
  }
  const counts = new Map<string, number>();
  const add = (terms: string[], weight: number) => {
    if (weight === 0) return;
    for (const t of terms) counts.set(t, (counts.get(t) ?? 0) + weight);
  };
  add(tokenize(card.title ?? ''), titleWeight);
  add(tokenize(card.description ?? ''), 1);
  return counts;
}
