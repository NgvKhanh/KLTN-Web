// Chu tieng Viet cho lop HANH DONG: tach tu khong dau, bang dong tu "giay phep", tu khoa trang thai, cum "giao cho du lieu",
// phu dinh, dau hieu cau hoi. HAM THUAN: khong DB, khong dong ho, khong mang. Quy uoc nhu ai.rules.ts: moi regex la hang
// literal, khong ghep chuoi vao regex; bo tach quet MOT LAN theo tung ky tu.
//
// Muc dich chung (CHATBOT_V2_ACTIONS_PLAN.md §5): phan biet DU LIEU (ten the, ten cot... chi dung de TIM doi tuong) voi CHI DAN
// (nguon cua hanh dong). Mot thao tac chi duoc xem la "lenh truc tiep cua nguoi dung" khi chinh cau cua ho co dong tu tuong ung
// va chua cac chu ma thao tac dung.

import type { CardStatus } from '../../../../generated/prisma/enums';
import { foldText, normalizeText } from '../../../ai/ai.rules';
import { tokenize } from '../../chat.members';

export type Phrase = readonly string[];

/** Tach cau thanh cac tu: chu thuong, bo dau tieng Viet, chi giu a-z0-9. */
export function foldWords(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of foldText(normalizeText(input))) {
    const c = ch.charCodeAt(0);
    if ((c >= 97 && c <= 122) || (c >= 48 && c <= 57)) {
      cur += ch;
    } else if (cur !== '') {
      out.push(cur);
      cur = '';
    }
  }
  if (cur !== '') out.push(cur);
  return out;
}

/** Vi tri bat dau cua MOI lan `phrase` xuat hien LIEN TIEP trong `words`. */
export function phraseIndexes(words: readonly string[], phrase: Phrase): number[] {
  const out: number[] = [];
  if (phrase.length === 0) return out;
  for (let i = 0; i + phrase.length <= words.length; i += 1) {
    let ok = true;
    for (let k = 0; k < phrase.length; k += 1) {
      if (words[i + k] !== phrase[k]) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(i);
  }
  return out;
}

export function hasPhrase(words: readonly string[], phrase: Phrase): boolean {
  return phraseIndexes(words, phrase).length > 0;
}

export function hasAny(words: readonly string[], phrases: readonly Phrase[]): boolean {
  return phrases.some((p) => hasPhrase(words, p));
}

export function indexesOfAny(words: readonly string[], phrases: readonly Phrase[]): number[] {
  return phrases.flatMap((p) => phraseIndexes(words, p)).sort((a, b) => a - b);
}

// ===================== Dong tu "giay phep" theo loai thao tac =====================
// Chi la dong tu chi VIEC LAM (khong phai ten rieng): "chuyen", "giao", "doi han"... Chu da bo dau, thuong.

export const CREATE_VERBS: readonly Phrase[] = [['tao'], ['them'], ['add'], ['create'], ['new'], ['bo', 'sung'], ['lap']];
export const LIST_NOUNS: readonly Phrase[] = [['cot'], ['list'], ['danh', 'sach'], ['column']];
/** Dong tu tao phai dung SAT danh tu "cot" (toi da 3 tu: "tao cot", "them mot cot moi"): "them 3 task vao cot X" khong phai lenh tao cot. */
const CREATE_LIST_SPAN = 3;
export const RENAME_VERBS: readonly Phrase[] = [
  ['doi', 'ten'],
  ['sua', 'ten'],
  ['rename'],
  ['doi', 'tieu', 'de'],
  ['sua', 'tieu', 'de'],
  ['dat', 'ten'],
  ['goi', 'la'],
  ['doi', 'thanh'],
  ['sua', 'thanh'],
];
const DUE_VERBS: readonly Phrase[] = [
  ['deadline'],
  ['han'],
  ['due'],
  ['gia', 'han'],
  ['dat', 'han'],
  ['doi', 'han'],
  ['bo', 'han'],
  ['xoa', 'han'],
  ['huy', 'han'],
  ['go', 'han'],
];
export const MOVE_VERBS: readonly Phrase[] = [['chuyen'], ['di', 'chuyen'], ['dua'], ['keo'], ['move'], ['dat', 'vao'], ['dat', 'sang']];
const ASSIGN_VERBS: readonly Phrase[] = [['giao'], ['gan'], ['assign'], ['phan', 'cong'], ['chi', 'dinh']];
// Phase 6: chia viec cho CA COT. Phai co dong tu chia / giao / phan cong VA dau hieu "chua co nguoi" (neu khong thi "giao Login cho Lan" khong the bi doi thanh chia ca cot).
const SPLIT_VERBS: readonly Phrase[] = [['chia'], ['giao'], ['phan', 'cong'], ['phan', 'bo'], ['assign']];
const UNASSIGNED_CUES: readonly Phrase[] = [
  ['chua', 'co', 'nguoi'],
  ['chua', 'giao'],
  ['chua', 'duoc', 'giao'],
  ['chua', 'phan', 'cong'],
  ['chua', 'duoc', 'phan', 'cong'],
  ['khong', 'co', 'nguoi'],
  ['chua', 'co', 'ai'],
  ['chua', 'ai'],
  ['con', 'trong'],
];
/** Cau nho chon "nguoi phu hop nhat" (khong goi ten): chi khi co cum nay thi {by:BEST} moi duoc chap nhan. */
const BEST_CUES: readonly Phrase[] = [['phu', 'hop'], ['thich', 'hop'], ['tot', 'nhat'], ['hop', 'nhat'], ['xung', 'dang'], ['ai', 'lam', 'duoc'], ['dung', 'nguoi'], ['goi', 'y']];
export const hasBestCue = (words: readonly string[]): boolean => hasAny(words, BEST_CUES);
// Phase 7: LUAT TU DONG HOA. Hai cach cau nguoi dung ra lenh tao luat: (A) danh tu "luat / quy tac / rule" + dong tu tao / dat / cai dat dung sat truoc nos,
// (B) cau dieu kien "khi ... thi ..." co dau hieu kich hoat (the moi duoc tao / the duoc chuyen vao cot). Khong co ca hai -> khong phai lenh tao luat.
const RULE_NOUNS: readonly Phrase[] = [['luat'], ['quy', 'tac'], ['rule'], ['automation'], ['tu', 'dong', 'hoa'], ['kich', 'ban']];
const RULE_VERBS: readonly Phrase[] = [...CREATE_VERBS, ['dat'], ['cai', 'dat'], ['thiet', 'lap'], ['cau', 'hinh'], ['bat'], ['kich', 'hoat'], ['xay', 'dung']];
const RULE_SPAN = 4;
const WHEN_WORDS: readonly Phrase[] = [['khi'], ['moi', 'khi'], ['he'], ['moi', 'lan'], ['bat', 'cu', 'khi'], ['cu', 'moi'], ['neu']];
const THEN_WORDS: readonly Phrase[] = [['thi'], ['se'], ['tu', 'dong']];
const MOVED_CUES: readonly Phrase[] = [['the', 'vao'], ['chuyen', 'vao'], ['keo', 'vao'], ['di', 'chuyen', 'vao'], ['duoc', 'chuyen'], ['duoc', 'keo'], ['chuyen', 'sang'], ['vao', 'cot'], ['roi', 'vao'], ['den', 'cot'], ['sang', 'cot']];
const CREATED_CUES: readonly Phrase[] = [['the', 'moi'], ['tao', 'the'], ['duoc', 'tao'], ['them', 'the'], ['task', 'moi'], ['viec', 'moi'], ['card', 'moi'], ['tao', 'moi'], ['moi', 'tao'], ['xuat', 'hien']];
/** Dieu kien kich hoat / hanh dong ma engine tu dong hoa KHONG co -> khong tao luat (xem actions.rule.UNSUPPORTED_RULE_TEXT). */
const UNSUPPORTED_RULE_CUES: readonly Phrase[] = [
  ['nhac'],
  ['gui', 'email'],
  ['gui', 'mail'],
  ['gui', 'tin'],
  ['gui', 'thong', 'bao'],
  ['hang', 'ngay'],
  ['moi', 'ngay'],
  ['hang', 'tuan'],
  ['moi', 'tuan'],
  ['hang', 'thang'],
  ['moi', 'thang'],
  ['den', 'han'],
  ['sap', 'het', 'han'],
  ['het', 'han'],
  ['qua', 'han'],
  ['truoc', 'han'],
  ['binh', 'luan'],
  ['comment'],
  ['dinh', 'kem'],
  ['luu', 'tru'],
  ['xoa', 'the'],
  ['bi', 'xoa'],
  ['thi', 'chuyen'],
  ['thi', 'di', 'chuyen'],
  ['thi', 'dua'],
  ['dat', 'han'],
  ['doi', 'han'],
  ['doi', 'ten'],
  ['thay', 'doi'],
  ['duoc', 'giao'],
  ['duoc', 'gan', 'nhan'],
  ['duoc', 'sua'],
  ['duoc', 'cap', 'nhat'],
];
const DONE_CUES: readonly Phrase[] = [['hoan', 'thanh'], ['hoan', 'tat'], ['xong'], ['done'], ['completed'], ['danh', 'dau']];
const REOPEN_CUES: readonly Phrase[] = [['mo', 'lai'], ['reopen'], ['chua', 'xong'], ['chua', 'hoan', 'thanh'], ['bo', 'danh', 'dau'], ['bo', 'hoan', 'thanh']];

const RULE_ASSIGN_VERBS: readonly Phrase[] = [['giao'], ['assign'], ['phan', 'cong'], ['chi', 'dinh'], ['gan', 'cho']];

/** Bo MOT lan xuat hien dau tien cua moi chu trong `ownTexts` (ten cot / nhan / nguoi da duoc tham chieu) khoi cau, de ten do khong bi quet nhu mot cum chi viec / dieu kien. */
export function withoutOwnTexts(words: readonly string[], ownTexts: readonly string[]): string[] {
  let out = [...words];
  for (const own of ownTexts) {
    const phrase = foldWords(own);
    const [at] = phraseIndexes(out, phrase);
    if (phrase.length === 0 || at === undefined) continue;
    out = [...out.slice(0, at), ...out.slice(at + phrase.length)];
  }
  return out;
}

export type RuleActionKind = 'SET_DONE' | 'SET_OPEN' | 'ADD_LABEL' | 'ASSIGN_MEMBER';

/** Cau cua nguoi dung co noi toi hanh dong nay cua luat khong (cung kieu "giay phep" nhu thao tac mot-lan). */
export function ruleActionMentioned(kind: RuleActionKind, words: readonly string[]): boolean {
  switch (kind) {
    case 'SET_DONE':
      return hasAny(words, DONE_CUES);
    case 'SET_OPEN':
      return hasAny(words, REOPEN_CUES);
    case 'ADD_LABEL':
      return hasAny(words, LABEL_WORDS) && hasAny(words, LABEL_VERBS);
    case 'ASSIGN_MEMBER':
      // "gan" (gắn / gán) chỉ tính khi đi với "cho": "gắn nhãn Gấp" không phải việc giao người
      return hasAny(words, RULE_ASSIGN_VERBS) || (hasPhrase(words, ['them']) && hasPhrase(words, ['vao']));
  }
}

/** Cau co noi toi dieu kien kich hoat nay khong ("khi the moi duoc tao" / "khi the duoc chuyen vao cot X"). */
export function ruleTriggerMentioned(trigger: 'CARD_CREATED' | 'CARD_MOVED_TO_LIST', words: readonly string[]): boolean {
  return hasAny(words, trigger === 'CARD_CREATED' ? CREATED_CUES : MOVED_CUES);
}

/**
 * Cau co yeu cau mot dieu kien / hanh dong ma engine tu dong hoa KHONG co khong. `ownTexts` = chu cua cac tham chieu (ten cot / nhan / nguoi):
 * duoc bo ra truoc khi quet de mot nhan ten "Qua han" khong bi coi la dieu kien "qua han". Tra ve cum dau tien tim thay (de bao loi).
 */
export function unsupportedRuleCue(message: string, ownTexts: readonly string[] = []): string | null {
  const words = withoutOwnTexts(foldWords(message), ownTexts);
  for (const cue of UNSUPPORTED_RULE_CUES) if (hasPhrase(words, cue)) return cue.join(' ');
  return null;
}

// ===================== Buoc D: sua noi dung va don dep the =====================
// Cung nguyen tac "giay phep": thao tac chi duoc chay khi CHINH CAU nguoi dung co dong tu / cum tu tuong ung. Danh tu (mo ta, binh luan, checklist...) phai
// di cung dong tu (hoac dung dau cau nhu mot menh lenh: "Binh luan vao the X: ..."), de cau hoi "mo ta the nay la gi?" khong bao gio sinh ra thao tac.
export const WRITE_VERBS: readonly Phrase[] = [...CREATE_VERBS, ['viet'], ['sua'], ['doi'], ['cap', 'nhat'], ['dat'], ['ghi'], ['dien'], ['thay'], ['update'], ['set'], ['de', 'lai'], ['gui'], ['post'], ['comment'], ['soan']];
export const DESCRIPTION_NOUNS: readonly Phrase[] = [['mo', 'ta'], ['description'], ['noi', 'dung', 'the']];
export const COMMENT_NOUNS: readonly Phrase[] = [['binh', 'luan'], ['comment'], ['nhan', 'xet'], ['ghi', 'chu']];
export const CHECKLIST_NOUNS: readonly Phrase[] = [['checklist'], ['check', 'list'], ['viec', 'con'], ['cong', 'viec', 'con'], ['subtask'], ['sub', 'task'], ['muc', 'con']];
/** Cum chi NGAY BAT DAU (rieng): "bat dau" tran khong du vi "chua bat dau" la trang thai Can lam. */
const START_PHRASES: readonly Phrase[] = [['ngay', 'bat', 'dau'], ['bat', 'dau', 'tu'], ['bat', 'dau', 'vao'], ['bat', 'dau', 'ngay'], ['start', 'date'], ['start'], ['khoi', 'cong']];
export const REMOVE_VERBS: readonly Phrase[] = [['bo'], ['go'], ['xoa'], ['loai'], ['rut'], ['remove'], ['unassign'], ['huy'], ['thu', 'hoi']];
/** Cum tu chi "bo nguoi ra khoi the" ma khong can chu "khoi". */
const UNASSIGN_PHRASES: readonly Phrase[] = [['huy', 'giao'], ['bo', 'giao'], ['thu', 'hoi'], ['unassign'], ['go', 'giao']];
export const ARCHIVE_PHRASES: readonly Phrase[] = [['luu', 'tru'], ['archive'], ['cat', 'vao', 'kho'], ['dua', 'vao', 'kho', 'luu', 'tru']];
/** Danh tu dung SAT SAU dong tu (toi da 4 tu) hoac dung dau cau (mot menh lenh: "Mo ta the Login: ..."). */
export const NOUN_SPAN = 4;
export function nounWithVerb(words: readonly string[], nouns: readonly Phrase[], verbs: readonly Phrase[]): number[] {
  const nounAt = indexesOfAny(words, nouns);
  if (nounAt.length === 0) return [];
  const verbAt = indexesOfAny(words, verbs).filter((v) => nounAt.some((n) => n >= v && n - v <= NOUN_SPAN));
  // mot menh lenh khong dong tu: danh tu nam trong 2 tu dau cau ("Binh luan vao the X: ...", "Mo ta the Login la ...")
  return verbAt.length > 0 ? verbAt : nounAt.filter((n) => n <= 1);
}
/** Dong tu BO / GO / XOA... dung truoc danh tu `nouns` (toi da NOUN_SPAN tu): "bo nhan Gap", "go Lan khoi the". */
export function removeBefore(words: readonly string[], nouns: readonly Phrase[]): number[] {
  const nounAt = indexesOfAny(words, nouns);
  return indexesOfAny(words, REMOVE_VERBS).filter((v) => nounAt.some((n) => n > v && n - v <= NOUN_SPAN));
}

export const LABEL_WORDS: readonly Phrase[] = [['nhan'], ['label'], ['tag']];
export const LABEL_VERBS: readonly Phrase[] = [['them'], ['gan'], ['dan'], ['add'], ['dat'], ['cho'], ['gui']];
const STATUS_VERBS: readonly Phrase[] = [
  ['chuyen'],
  ['doi'],
  ['dat'],
  ['danh', 'dau'],
  ['mark'],
  ['set'],
  ['cap', 'nhat'],
  ['trang', 'thai'],
  ['sang'],
  ['thanh'],
  ['la'],
];

// ===================== Trang thai =====================
// SAO Y GUESS_RULES o card/cardStatus.ts (khong export) - test chat.actions.pure canh de hai ban khong lech.

export const STATUS_ORDER: readonly CardStatus[] = ['IN_REVIEW', 'BLOCKED', 'TODO', 'IN_PROGRESS', 'DONE'];
export const STATUS_PHRASES: Record<CardStatus, readonly Phrase[]> = {
  IN_REVIEW: [['cho', 'duyet'], ['review'], ['kiem', 'thu'], ['kiem', 'tra'], ['testing'], ['qa'], ['phan', 'hoi']],
  BLOCKED: [['bi', 'chan'], ['tam', 'hoan'], ['tam', 'dung'], ['dang', 'cho'], ['blocked'], ['on', 'hold']],
  TODO: [['chua', 'lam'], ['chua', 'xong'], ['chua', 'hoan', 'thanh'], ['chua', 'bat', 'dau'], ['can', 'lam'], ['to', 'do'], ['todo'], ['backlog']],
  IN_PROGRESS: [
    ['dang', 'lam'],
    ['dang', 'thuc', 'hien'],
    ['dang', 'xu', 'ly'],
    ['dang', 'viet'],
    ['dang', 'nghien', 'cuu'],
    ['dang', 'phat', 'trien'],
    ['in', 'progress'],
    ['doing'],
  ],
  DONE: [['hoan', 'thanh'], ['hoan', 'tat'], ['xong'], ['done'], ['da', 'dang'], ['completed'], ['finished']],
};

export interface StatusMention {
  status: CardStatus;
  start: number;
  end: number;
}

/**
 * Moi lan nguoi dung nhac toi mot trang thai. Hai cum chong lan ("chua hoan thanh" chua "hoan thanh") -> giu cum DAI hon;
 * bang nhau -> cum dung truoc theo STATUS_ORDER (nhu GUESS_RULES). Ket qua sap theo vi tri.
 */
export function statusMentions(words: readonly string[]): StatusMention[] {
  const all: Array<StatusMention & { rank: number }> = [];
  for (const [rank, status] of STATUS_ORDER.entries()) {
    for (const phrase of STATUS_PHRASES[status]) {
      for (const start of phraseIndexes(words, phrase)) all.push({ status, start, end: start + phrase.length, rank });
    }
  }
  all.sort((a, b) => b.end - b.start - (a.end - a.start) || a.rank - b.rank || a.start - b.start);
  const kept: StatusMention[] = [];
  for (const m of all) {
    if (!kept.some((k) => m.start < k.end && k.start < m.end)) kept.push({ status: m.status, start: m.start, end: m.end });
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** Trang thai duoc nhac CUOI CUNG trong cau ("tu Dang lam sang Xong" -> DONE), null neu khong nhac. */
export function lastStatusMention(words: readonly string[]): CardStatus | null {
  const all = statusMentions(words);
  return all.length === 0 ? null : all[all.length - 1].status;
}

// ===================== Phu dinh + giay phep =====================

const NEGATORS: readonly Phrase[] = [['dung'], ['khoi'], ['khong'], ['chua', 'can'], ['khong', 'can'], ['khong', 'duoc'], ['khong', 'nen'], ['cam']];

/** Mot phu dinh nam NGAY TRUOC vi tri `at` (cach toi da 1 tu: "dung chuyen", "khong can phai chuyen"). */
export function negatedAt(words: readonly string[], at: number): boolean {
  for (const neg of NEGATORS) {
    for (const start of phraseIndexes(words, neg)) {
      const end = start + neg.length;
      if (end <= at && at - end <= 1) return true;
    }
  }
  return false;
}

export interface Licence {
  /** Co it nhat mot dong tu cho phep thao tac nay trong cau (chua xet phu dinh). */
  licensed: boolean;
  /** Moi lan xuat hien dong tu deu bi phu dinh ("dung chuyen ..."). */
  negated: boolean;
}

/**
 * "Giay phep dong tu": cau cua NGUOI DUNG co dong tu cho loai thao tac nay khong? Thao tac khong co dong tu trong cau
 * (vd mo ta the bao "giao het cho X" + cau hoi binh thuong) khong bao gio duoc tu chay.
 */
/** Licence tu cac vi tri dong tu (cac nhom thao tac mo rong): rong = chua duoc cau yeu cau; moi vi tri deu bi phu dinh = negated. */
export function licenceFromPositions(at: readonly number[], words: readonly string[]): Licence {
  if (at.length === 0) return { licensed: false, negated: false };
  return { licensed: true, negated: at.every((i) => negatedAt(words, i)) };
}

export function licenceFor(type: string, words: readonly string[], status?: CardStatus, strictLast = true): Licence {
  let at: number[] = [];
  switch (type) {
    case 'CREATE_LIST': {
      const nouns = indexesOfAny(words, LIST_NOUNS);
      at = indexesOfAny(words, CREATE_VERBS).filter((v) => nouns.some((n) => n > v && n - v <= CREATE_LIST_SPAN));
      break;
    }
    case 'CREATE_CARD':
      at = indexesOfAny(words, CREATE_VERBS);
      break;
    case 'RENAME_CARD':
      at = indexesOfAny(words, RENAME_VERBS);
      break;
    case 'SET_CARD_DUE':
      at = indexesOfAny(words, DUE_VERBS);
      break;
    case 'MOVE_CARD':
      at = indexesOfAny(words, MOVE_VERBS);
      break;
    case 'ASSIGN_MEMBER': {
      at = indexesOfAny(words, ASSIGN_VERBS);
      // "them Minh vao task Frontend": dong tu "them" + "vao"
      if (hasPhrase(words, ['vao'])) at = [...at, ...phraseIndexes(words, ['them'])].sort((a, b) => a - b);
      break;
    }
    case 'ASSIGN_UNASSIGNED':
      at = hasAny(words, UNASSIGNED_CUES) ? indexesOfAny(words, SPLIT_VERBS) : [];
      break;
    case 'CREATE_AUTOMATION_RULE': {
      const nouns = indexesOfAny(words, RULE_NOUNS);
      at = indexesOfAny(words, RULE_VERBS).filter((v) => nouns.some((n) => n > v && n - v <= RULE_SPAN));
      if (at.length === 0 && hasAny(words, [...MOVED_CUES, ...CREATED_CUES])) {
        const whens = indexesOfAny(words, WHEN_WORDS);
        const thens = indexesOfAny(words, THEN_WORDS);
        if (whens.some((w) => thens.some((t) => t > w))) at = whens;
      }
      break;
    }
    case 'ADD_LABEL':
      // phai nhac toi nhan (nhan/label/tag) VA co dong tu gan / them / dan...
      at = hasAny(words, LABEL_WORDS) ? indexesOfAny(words, LABEL_VERBS) : [];
      break;
    case 'SET_CARD_STATUS': {
      // trang thai muc tieu phai la trang thai DUOC NHAC CUOI ("tu Dang lam sang Xong" -> Xong); can dong tu (tru DONE: "xong" tu no
      // da la lenh). Ke hoach co NHIEU thao tac doi trang thai ("Login la dang lam, Register la xong") thi chi can duoc nhac den (strictLast = false).
      if (status === undefined) return { licensed: false, negated: false };
      const mentioned = strictLast ? lastStatusMention(words) === status : statusMentions(words).some((m) => m.status === status);
      if (!mentioned) return { licensed: false, negated: false };
      at = indexesOfAny(words, STATUS_VERBS);
      if (at.length === 0 && status === 'DONE') at = statusMentions(words).filter((m) => m.status === 'DONE').map((m) => m.start);
      break;
    }
    case 'SET_CARD_DESCRIPTION':
      at = nounWithVerb(words, DESCRIPTION_NOUNS, WRITE_VERBS);
      break;
    case 'ADD_COMMENT':
      at = nounWithVerb(words, COMMENT_NOUNS, WRITE_VERBS);
      break;
    case 'ADD_CHECKLIST':
      at = nounWithVerb(words, CHECKLIST_NOUNS, WRITE_VERBS);
      break;
    case 'SET_CARD_START':
      at = indexesOfAny(words, START_PHRASES);
      break;
    case 'REMOVE_MEMBER': {
      // "go Lan khoi the X", "bo Lan khoi task Y" (can chu "khoi") hoac cum rieng "huy giao", "thu hoi", "unassign"
      const away = indexesOfAny(words, REMOVE_VERBS).filter(() => hasPhrase(words, ['khoi']));
      at = [...away, ...indexesOfAny(words, UNASSIGN_PHRASES)].sort((a, b) => a - b);
      break;
    }
    case 'REMOVE_LABEL':
      at = removeBefore(words, LABEL_WORDS);
      break;
    case 'RENAME_LIST': {
      // dong tu doi ten dung truoc danh tu "cot / list / danh sach": "doi ten cot A thanh B", "doi ten cho toi cot A thanh B" ("doi ten" da chiem 2 tu)
      const nouns = indexesOfAny(words, LIST_NOUNS);
      at = indexesOfAny(words, RENAME_VERBS).filter((v) => nouns.some((n) => n >= v && n - v <= NOUN_SPAN));
      break;
    }
    case 'ARCHIVE_CARD':
      at = indexesOfAny(words, ARCHIVE_PHRASES);
      break;
    default:
      return { licensed: false, negated: false };
  }
  if (at.length === 0) return { licensed: false, negated: false };
  return { licensed: true, negated: at.every((i) => negatedAt(words, i)) };
}

// ===================== "Lam theo noi dung trong du lieu" =====================

const DELEGATION_STRONG: readonly Phrase[] = [
  ['lam', 'theo'],
  ['thuc', 'hien', 'theo'],
  ['ap', 'dung', 'theo'],
  ['tuan', 'theo'],
  ['lam', 'dung', 'theo'],
  ['lam', 'nhu'],
  ['lam', 'dung', 'nhu'],
];
const DELEGATION_WEAK: readonly Phrase[] = [['lam'], ['thuc', 'hien'], ['ap', 'dung'], ['theo'], ['nhu'], ['xu', 'ly']];
const DATA_NOUNS: readonly Phrase[] = [
  ['noi', 'dung'],
  ['mo', 'ta'],
  ['chi', 'dan'],
  ['huong', 'dan'],
  ['binh', 'luan'],
  ['ghi', 'chu'],
  ['comment'],
  ['description'],
  ['instruction'],
  ['yeu', 'cau', 'trong'],
];
const DATA_OBJECTS: readonly Phrase[] = [['the'], ['card'], ['task'], ['viec'], ['tep'], ['file'], ['tai', 'lieu']];

/**
 * Nguoi dung giao quyen cho DU LIEU: "lam theo noi dung card nay", "thuc hien nhu mo ta", "xu ly theo binh luan"... Chi dan khi do
 * khong phai cua nguoi dung ma nam trong the / tep / binh luan -> khong bao gio tu chay, luon cho xem truoc.
 */
export function delegatesToData(words: readonly string[]): boolean {
  const near = (verbAt: number, nouns: readonly Phrase[], span: number) =>
    indexesOfAny(words, nouns).some((j) => j > verbAt && j - verbAt <= span);
  for (const verb of DELEGATION_STRONG) {
    for (const i of phraseIndexes(words, verb)) {
      if (near(i + verb.length - 1, [...DATA_NOUNS, ...DATA_OBJECTS], 4)) return true;
    }
  }
  for (const verb of DELEGATION_WEAK) {
    for (const i of phraseIndexes(words, verb)) {
      if (near(i + verb.length - 1, DATA_NOUNS, 5)) return true;
    }
  }
  return false;
}

// ===================== Dau hieu cau hoi / cau nho =====================

const REQUEST_MARKERS: readonly Phrase[] = [
  ['giup'],
  ['ho'],
  ['nhe'],
  ['nha'],
  ['di'],
  ['lam', 'on'],
  ['vui', 'long'],
  ['co', 'the'],
  ['duoc', 'khong'],
  ['hay'],
  ['xin'],
];

/** Cau co dang cau hoi ("Co nen chuyen ... khong?") ma khong co dau hieu nho ("giup", "nhe", "di"...). */
export function isQuestionForm(raw: string, words: readonly string[]): boolean {
  const asked =
    raw.includes('?') || words[words.length - 1] === 'khong' || hasPhrase(words.slice(0, 2), ['co', 'nen']) || words[0] === 'lieu';
  return asked && !hasAny(words, REQUEST_MARKERS);
}

// ===================== Tham chieu: tu chung, "no", "toi" =====================

/** Danh tu chung dung truoc ten ("task Login", "cot Dang lam", "nhan Backend"): bo khi so khop. */
export const GENERIC_WORDS: ReadonlySet<string> = new Set([
  'task',
  'tasks',
  'card',
  'cards',
  'the',
  'viec',
  'cong',
  'cot',
  'danh',
  'sach',
  'list',
  'nhan',
  'label',
  'thanh',
  'vien',
  'anh',
  'chi',
  'ban',
  'nhiem',
  'vu',
  'ticket',
  'bang',
  'board',
]);

/** Bo cac tu chung o DAU chuoi (giu lai it nhat 1 tu); giu nguyen chu va dau cua phan con lai. */
export function stripLeadingGeneric(text: string): string {
  const tokens = tokenize(text);
  let i = 0;
  while (i < tokens.length - 1 && GENERIC_WORDS.has(tokens[i].fold)) i += 1;
  return tokens
    .slice(i)
    .map((t) => t.raw)
    .join(' ');
}

const CONTEXT_CUES: Record<'LAST_CARD' | 'LAST_LIST' | 'LAST_MEMBER', readonly Phrase[]> = {
  LAST_CARD: [['no'], ['nay'], ['do'], ['kia'], ['vua', 'roi'], ['cai', 'do'], ['cai', 'nay']],
  LAST_LIST: [['no'], ['do'], ['nay'], ['vua', 'roi'], ['cai', 'do']],
  LAST_MEMBER: [['no'], ['ho'], ['nguoi', 'do'], ['nguoi', 'nay'], ['anh', 'ay'], ['chi', 'ay'], ['ban', 'ay'], ['vua', 'roi']],
};

/** Cau co chu chi "no / the do / cai nay / vua roi" cho loai tham chieu ngu canh nay khong? */
export function hasContextCue(slot: 'LAST_CARD' | 'LAST_LIST' | 'LAST_MEMBER', words: readonly string[]): boolean {
  return hasAny(words, CONTEXT_CUES[slot]);
}

/**
 * Cau co goi chinh nguoi hoi ("toi", "minh" CO DAU, "to", "tui") khong? "minh" KHONG DAU khong tinh: no trung ten rieng
 * "Minh" (LLM tra {by:SELF} cho "giao cho Minh" se gan nham nguoi dung).
 */
export function hasSelfCue(raw: string): boolean {
  for (const t of tokenize(raw)) {
    if (t.orig === 'tôi' || t.orig === 'toi' || t.orig === 'tui' || t.orig === 'tớ' || t.orig === 'mình') return true;
  }
  return hasPhrase(foldWords(raw), ['ban', 'than']);
}

/** Cac tu cua `text` (khong dau, bo tu chung) co nam trong `words` khong? `ratio` = ty le token toi thieu phai co mat. */
export function groundedIn(text: string, words: readonly string[], ratio = 0.8, skipGeneric = true): boolean {
  let tokens = foldWords(text);
  if (skipGeneric) {
    const meaningful = tokens.filter((t) => !GENERIC_WORDS.has(t));
    if (meaningful.length > 0) tokens = meaningful;
  }
  if (tokens.length === 0) return false;
  const have = new Set(words);
  const hit = tokens.filter((t) => have.has(t)).length;
  return hit / tokens.length >= ratio;
}

// ===================== Board Patch (Phase 3): cau YEU CAU mo rong bang =====================
// Board Patch khong co "ten the / ten cot" do nguoi dung go (noi dung do AI de xuat), nen nguon cua hanh dong chi con la CAU: co dong tu
// "them / bo sung / mo rong / len ke hoach..." khong bi phu dinh, khong phai cau hoi, khong bao xoa / thay the du lieu cu.

const PATCH_VERBS: readonly Phrase[] = [
  ...CREATE_VERBS,
  ['len', 'ke', 'hoach'],
  ['len', 'danh', 'sach'],
  ['mo', 'rong'],
  ['viet', 'them'],
  ['goi', 'y'],
  ['de', 'xuat'],
  ['soan'],
  ['generate'],
  ['expand'],
  ['extend'],
];

/** Dong tu muon XOA / THAY THE / LUU TRU du lieu co san. Chi tinh khi theo sau (toi da 3 tu) la mot danh tu cua bang. */
const DESTRUCTIVE_VERBS: readonly Phrase[] = [
  ['xoa'],
  ['loai', 'bo'],
  ['go', 'bo'],
  ['don', 'sach'],
  ['don', 'dep'],
  ['bo', 'het'],
  ['delete'],
  ['remove'],
  ['clear'],
  ['wipe'],
  ['reset'],
  ['ghi', 'de'],
  ['thay', 'the'],
  ['luu', 'tru'],
  ['archive'],
  ['lam', 'lai', 'tu', 'dau'],
  ['tao', 'lai'],
  ['viet', 'lai'],
  ['sinh', 'lai'],
];
const BOARD_ENTITY_WORDS: ReadonlySet<string> = new Set(['the', 'card', 'cards', 'task', 'tasks', 'cot', 'list', 'lists', 'column', 'columns', 'bang', 'board', 'boards', 'viec', 'cu', 'het', 'tat', 'all', 'everything', 'toan', 'moi', 'cac', 'nhung']);
const DESTRUCTIVE_SPAN = 3;
const NEW_BOARD_SPAN = 2;
const BOARD_PARTS: readonly Phrase[] = [['cot'], ['the'], ['task'], ['viec'], ['list'], ['card'], ['danh', 'sach'], ['column']];

/** Cau co dong tu "them / bo sung / mo rong..." cho viec mo rong bang khong (chua xet phu dinh o ngoai, xem `negated`). */
export function licenceForPatch(words: readonly string[]): Licence {
  const at = indexesOfAny(words, PATCH_VERBS);
  if (at.length === 0) return { licensed: false, negated: false };
  return { licensed: true, negated: at.every((i) => negatedAt(words, i)) };
}

/** Cau yeu cau XOA / thay the du lieu cu cua bang ("xoa het the cu roi tao lai"). "Dung xoa gi ca" (bi phu dinh) khong tinh. */
export function asksDestructive(words: readonly string[]): boolean {
  for (const verb of DESTRUCTIVE_VERBS) {
    for (const start of phraseIndexes(words, verb)) {
      if (negatedAt(words, start)) continue;
      const end = start + verb.length;
      if (words.slice(end, end + DESTRUCTIVE_SPAN).some((w) => BOARD_ENTITY_WORDS.has(w))) return true;
    }
  }
  return false;
}

/** "Tao bang moi cho du an X": tao CA BANG (viec cua module AI sinh bang), khong phai mo rong bang dang mo. */
export function asksNewBoard(words: readonly string[]): boolean {
  if (hasAny(words, BOARD_PARTS)) return false;
  const boards = indexesOfAny(words, [['bang'], ['board']]);
  return indexesOfAny(words, CREATE_VERBS).some((v) => boards.some((b) => b > v && b - v <= NEW_BOARD_SPAN));
}
