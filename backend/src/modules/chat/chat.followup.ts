// Cau noi tiep + cau tu nhac minh (CHATBOT_MODULE.md §9.2, §8.2 buoc 3).
//
// HAM THUAN. Dau vao: ket qua hieu cau hoi (bo luat, LLM hoac ban gop) + ngu canh
// luot truoc (lay tu phien). Dau ra: cau hoi cuoi voi y dinh la 1 trong 5 y dinh tra
// loi duoc, hoac UNSUPPORTED. Ca ba nhanh danh gia di qua DUNG ham nay.

import type { AnswerIntent, CatalogQuestion, ChatFocus, ChatPeriod, FinalQuestion, ParsedQuestion } from './chat.intent';
import { isAnswerIntent, isCatalogIntent } from './chat.intent';
import { isSelfReference } from './chat.members';

/** Ngu canh luot truoc luu trong phien: KHONG luu ten go, chi luu nguoi da nhan dien. */
export interface FollowUpContext {
  intent: AnswerIntent;
  period: ChatPeriod | null;
  focus: ChatFocus | null;
  memberUserId: string | null;
}

export type FollowUpResult =
  | { kind: 'QUESTION'; question: FinalQuestion; inherited: boolean }
  /** Cau hoi danh muc (§18): luon la cau MOI, khong ke thua ngu canh, khong noi tiep duoc. */
  | { kind: 'CATALOG'; question: CatalogQuestion }
  | { kind: 'UNSUPPORTED' };

const MY_INTENTS: readonly AnswerIntent[] = ['MY_TASKS', 'MY_PRIORITIES'];

/**
 * Nguoi hoi tu nhac minh ("tôi", "mình"...) duoi dang ten: hoi ve ban than -> y dinh
 * ca nhan tuong ung, bo ten.
 */
function selfIntent(intent: AnswerIntent): AnswerIntent {
  return MY_INTENTS.includes(intent) ? intent : 'MY_TASKS';
}

export function applyFollowUp(parsed: ParsedQuestion, prev: FollowUpContext | null): FollowUpResult {
  const self = parsed.member !== null && isSelfReference(parsed.member);
  const memberText = self ? null : parsed.member;

  if (isCatalogIntent(parsed.intent)) {
    return {
      kind: 'CATALOG',
      question: { intent: parsed.intent, target: parsed.target ?? null, column: parsed.column ?? null, targetId: null },
    };
  }
  if (isAnswerIntent(parsed.intent)) {
    // Cau hoi moi hoan toan: khong ke thua gi
    const intent = self ? selfIntent(parsed.intent) : parsed.intent;
    return {
      kind: 'QUESTION',
      inherited: false,
      question: { intent, period: parsed.period, focus: parsed.focus, memberText, memberUserId: null },
    };
  }
  if (parsed.intent === 'UNSUPPORTED') return { kind: 'UNSUPPORTED' };

  // NONE: chi bo sung tham so -> can ngu canh truoc + it nhat mot tham so moi
  const hasSlot = parsed.period !== null || parsed.focus !== null || parsed.member !== null;
  if (prev === null || !hasSlot) return { kind: 'UNSUPPORTED' };

  const period = parsed.period ?? prev.period;
  const focus = parsed.focus ?? prev.focus;
  if (self) {
    return {
      kind: 'QUESTION',
      inherited: true,
      question: { intent: selfIntent(prev.intent), period, focus, memberText: null, memberUserId: null },
    };
  }
  if (memberText !== null) {
    // "còn Minh?" -> hoi ve nguoi moi, giu ky + tinh trang cua cau truoc
    return {
      kind: 'QUESTION',
      inherited: true,
      question: { intent: 'MEMBER_TASKS', period, focus, memberText, memberUserId: null },
    };
  }
  return {
    kind: 'QUESTION',
    inherited: true,
    question: { intent: prev.intent, period, focus, memberText: null, memberUserId: prev.memberUserId },
  };
}
