// CHU TIENG VIET cho cac nhom thao tac mo rong: dong tu / danh tu "giay phep" va cac ham doi chieu. HAM THUAN (khong CSDL, khong dong ho).
// Nguyen tac nhu actions.text: mot thao tac chi duoc chay khi CHINH CAU nguoi dung co dong tu cho dung loai viec VA dong tu do di cung danh tu / ten
// cua DOI TUONG cua thao tac (de "xoa nhan Gap khoi the Login" khong the cap giay phep cho DELETE_CARD, du mo hinh co de xuat nham).

import { foldWords, indexesOfAny, phraseIndexes, type Phrase } from '../actions.text';

export const CARD_NOUNS: readonly Phrase[] = [['the'], ['card'], ['task'], ['viec'], ['cong', 'viec'], ['ticket'], ['the', 'viec']];
export const LIST_NOUNS_VI: readonly Phrase[] = [['cot'], ['list'], ['danh', 'sach'], ['column'], ['cot', 'viec']];
export const COMMENT_NOUNS_VI: readonly Phrase[] = [['binh', 'luan'], ['comment'], ['nhan', 'xet'], ['ghi', 'chu'], ['loi', 'nhan']];
export const CHECKLIST_NOUNS_VI: readonly Phrase[] = [['checklist'], ['check', 'list'], ['danh', 'sach', 'viec'], ['viec', 'con'], ['cong', 'viec', 'con']];
export const ITEM_NOUNS: readonly Phrase[] = [['muc'], ['viec', 'con'], ['cong', 'viec', 'con'], ['item'], ['dong'], ['checklist'], ['subtask']];
export const FILE_NOUNS: readonly Phrase[] = [['tep'], ['file'], ['tai', 'lieu'], ['dinh', 'kem'], ['attachment'], ['anh'], ['hinh']];

export const DELETE_VERBS: readonly Phrase[] = [['xoa'], ['delete'], ['remove'], ['loai', 'bo'], ['go', 'bo'], ['xoa', 'bo'], ['tieu', 'huy']];
/** Xóa NHƯNG cũng là "gỡ / bỏ" - cách nói thường ngày với bình luận, mục checklist, tệp ("gỡ tệp thiết kế.pdf", "bỏ mục build"). Không dùng cho bảng / cột / thẻ (ở đó chỉ "xóa" mới là xóa). */
export const REMOVE_OR_DELETE_VERBS: readonly Phrase[] = [...DELETE_VERBS, ['go'], ['bo'], ['rut']];
export const RESTORE_VERBS: readonly Phrase[] = [['khoi', 'phuc'], ['phuc', 'hoi'], ['restore'], ['lay', 'lai'], ['bo', 'luu', 'tru'], ['huy', 'luu', 'tru']];
export const COPY_VERBS: readonly Phrase[] = [['sao', 'chep'], ['copy'], ['nhan', 'ban'], ['nhan', 'doi'], ['duplicate'], ['clone'], ['tao', 'ban', 'sao']];
export const ALL_CUES: readonly Phrase[] = [['tat', 'ca'], ['het'], ['toan', 'bo'], ['moi'], ['all'], ['cac']];
export const EDIT_VERBS: readonly Phrase[] = [['sua'], ['doi'], ['cap', 'nhat'], ['chinh', 'sua'], ['edit'], ['update'], ['thay'], ['thay', 'doi'], ['viet', 'lai']];

/** Tu dem (khong chi doi tuong) co the nam giua dong tu va danh tu ma khong doi nghia: "xoa GIUP TOI CAI the", "xoa TAT CA CAC the", "xoa CHO TOI cot 5" (12/10: cau that cua nguoi dung bi tu choi vi thieu "cho"). */
const FILLERS: ReadonlySet<string> = new Set(['cai', 'mot', 'cac', 'nhung', 'nay', 'do', 'tat', 'ca', 'het', 'toan', 'bo', 'giup', 'toi', 'minh', 'di', 'nhe', 'dum', 'ho', 'vui', 'long', 'hay', 'xin', 'lam', 'on', 'vai', 'moi', 'dang', 'dung', 'luon', 'ngay', 'bay', 'gio', 'cu', 'het', 'cho', 'gium', 'gium', 'em', 'anh', 'chi', 'ban']);

/**
 * Vi tri bat dau cua cac dong tu `verbs` ma NGAY SAU no (chi cach bang cac tu dem) la mot danh tu trong `nouns` HOAC mot cum `own` (ten rieng cua doi
 * tuong: ten the, ten cot). `maxGap`: so tu dem toi da giua dong tu va danh tu.
 */
export function verbThen(words: readonly string[], verbs: readonly Phrase[], nouns: readonly Phrase[], own: readonly string[] = [], maxGap = 4, extraFillers: readonly string[] = []): number[] {
  const targets: number[] = [...indexesOfAny(words, nouns)];
  for (const text of own) {
    const phrase = foldWords(text);
    if (phrase.length > 0) targets.push(...phraseIndexes(words, phrase));
  }
  const out: number[] = [];
  for (const verb of verbs) {
    for (const start of phraseIndexes(words, verb)) {
      const after = start + verb.length;
      const ok = targets.some((t) => {
        if (t < after || t - after > maxGap) return false;
        for (let i = after; i < t; i += 1) if (!FILLERS.has(words[i]) && !extraFillers.includes(words[i])) return false;
        return true;
      });
      if (ok) out.push(start);
    }
  }
  return out.sort((a, b) => a - b);
}

/** Cau co CHUA MOT TRONG cac cum (o bat ky dau). */
export function mentions(words: readonly string[], phrases: readonly Phrase[]): boolean {
  return indexesOfAny(words, phrases).length > 0;
}

/** Chu cua cac tham chieu TEXT cua mot thao tac (de so voi cau). */
export function ownTexts(...refs: Array<{ by: string; text?: string } | undefined>): string[] {
  return refs.flatMap((r) => (r !== undefined && r.by === 'TEXT' && typeof r.text === 'string' ? [r.text] : []));
}
