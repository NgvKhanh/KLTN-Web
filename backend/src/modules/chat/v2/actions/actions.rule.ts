// LUAT TU DONG HOA bang ngon ngu tu nhien (Phase 7; CHATBOT_V2_ACTIONS_PLAN.md PL-D). Chatbot KHONG co engine rieng: no chi anh xa cau cua
// nguoi dung vao dung nhung gi `modules/automation` da co (2 dieu kien kich hoat, 3 hanh dong, toi da 5) roi tao luat bang chinh du lieu do.
//
// Khac mot thao tac mot-lan ("chuyen Login sang Done"), mot LUAT chay mai mai: moi lan co the moi / the duoc chuyen vao cot, engine tu lam cac
// viec nay bang quyen cua NGUOI TAO LUAT (nhat ky + thong bao ghi ten ho). Vi vay luat LUON xem truoc, rui ro CAO, khong bao gio tu chay.
//
// File nay gom: (1) cac HAM THUAN dung chu hien thi / ten luat / dau van tay de so trung; (2) tim luat da co trong CSDL (dung o buoc lap ke
// hoach VA ngay trong transaction ap dung) de khong tao hai luat giong het nhau.

import type { Prisma } from '../../../../generated/prisma/client';
import type { RuleTrigger } from './actions.schema';
import type { RuleView, StoredRuleAction } from './actions.types';

const q = (s: string): string => `“${s}”`;

export const RULE_NOTE =
  'Luật chạy bằng quyền của bạn: mỗi lần điều kiện xảy ra, hệ thống tự làm các việc trên với danh nghĩa bạn (nhật ký và thông báo ghi tên bạn), cho đến khi bạn tắt hoặc xóa luật ở mục Tự động hóa của bảng.';

export const UNSUPPORTED_RULE_TEXT =
  'Luật tự động hóa hiện chỉ hỗ trợ: điều kiện “khi thẻ MỚI được tạo” (ở một cột hoặc cả bảng) hoặc “khi thẻ được chuyển VÀO một cột”; việc luật làm: đánh dấu hoàn thành (hoặc mở lại), gắn nhãn, giao người (tối đa 5 việc). Chưa hỗ trợ nhắc hạn / hẹn giờ, gửi email hay thông báo, bình luận, đổi hạn, chuyển hoặc xóa thẻ. Chưa thay đổi gì.';

export const RULE_ONLY_TEXT = 'Luật tự động hóa phải được tạo riêng: mỗi lệnh một luật, không kèm thao tác khác. Hãy gửi từng việc một. Chưa thay đổi gì.';

/** Ten luat toi da (khop automation.schema: name <= 200). */
export const MAX_RULE_NAME = 200;

/** "khi thẻ được chuyển vào cột “Done”" / "khi có thẻ mới trong cột “Cần làm”" / "khi có thẻ mới trong bảng". */
export function whenText(trigger: RuleTrigger, listName: string | undefined): string {
  if (trigger === 'CARD_MOVED_TO_LIST') return `Khi thẻ được chuyển vào cột ${q(listName ?? '')}`;
  return listName === undefined ? 'Khi có thẻ mới được tạo (ở bất kỳ cột nào của bảng)' : `Khi có thẻ mới được tạo trong cột ${q(listName)}`;
}

/** Mot hanh dong -> cau ngan. */
export function thenText(action: StoredRuleAction, names: { label?: string; member?: string }): string {
  switch (action.type) {
    case 'SET_DONE':
      return action.done === false ? 'mở lại thẻ (bỏ đánh dấu hoàn thành)' : 'đánh dấu thẻ hoàn thành';
    case 'ADD_LABEL':
      return `gắn nhãn ${q(names.label ?? '')}`;
    case 'ASSIGN_MEMBER':
      return `giao thẻ cho ${names.member ?? ''}`;
  }
}

/** Ten luat DO SERVER dung (khong lay chu cua mo hinh): "Khi thẻ được chuyển vào cột “Done”: đánh dấu thẻ hoàn thành, gắn nhãn “Hoàn thành”". */
export function ruleNameOf(when: string, then: readonly string[]): string {
  const full = `${when}: ${then.join(', ')}`;
  return full.length <= MAX_RULE_NAME ? full : `${full.slice(0, MAX_RULE_NAME - 1)}…`;
}

export function ruleViewOf(when: string, then: readonly string[]): RuleView {
  return { when, then: [...then], note: RULE_NOTE };
}

// ---------------------------------------------------------------------------------------------------------------------
// So trung
// ---------------------------------------------------------------------------------------------------------------------

export interface RuleSpec {
  trigger: RuleTrigger;
  /** null = moi cot (chi hop le voi CARD_CREATED). */
  listId: string | null;
  actions: readonly StoredRuleAction[];
}

const actionKey = (a: { type: string; done?: boolean | null; labelId?: string | null; userId?: string | null }): string => {
  switch (a.type) {
    case 'SET_DONE':
      return `SET_DONE:${a.done === false ? 'open' : 'done'}`;
    case 'ADD_LABEL':
      return `ADD_LABEL:${a.labelId ?? ''}`;
    default:
      return `ASSIGN_MEMBER:${a.userId ?? ''}`;
  }
};

/**
 * Dau van tay cua mot luat: dieu kien + cot + TAP hanh dong (khong tinh thu tu / lap lai). Hai luat cung dau van tay lam dung cung mot viec nen
 * khong tao them (se chay hai lan, gui thong bao hai lan).
 */
export function ruleSignature(spec: RuleSpec): string {
  const acts = [...new Set(spec.actions.map(actionKey))].sort();
  return `${spec.trigger}|${spec.listId ?? '*'}|${acts.join(',')}`;
}

/** Bo hanh dong trung lap (cung loai + cung nhan / nguoi) - giu thu tu dau tien. Tra ve so hanh dong bi bo. */
export function dedupeRuleActions(actions: readonly StoredRuleAction[]): { actions: StoredRuleAction[]; dropped: number } {
  const seen = new Set<string>();
  const out: StoredRuleAction[] = [];
  for (const a of actions) {
    const key = actionKey(a);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return { actions: out, dropped: actions.length - out.length };
}

export interface ExistingRule {
  id: string;
  name: string;
  isEnabled: boolean;
}

export type RuleDb = Pick<Prisma.TransactionClient, 'automationRule'>;

/** Luat DA CO cua bang giong het `spec` (ke ca luat dang tat). Dung `db` la prisma (luc lap ke hoach) hoac tx (trong transaction ap dung). */
export async function findSameRule(db: RuleDb, boardId: string, spec: RuleSpec): Promise<ExistingRule | null> {
  const rules = await db.automationRule.findMany({
    where: { boardId, triggerType: spec.trigger },
    select: { id: true, name: true, isEnabled: true, triggerListId: true, actions: { select: { type: true, boolValue: true, labelId: true, userId: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const want = ruleSignature(spec);
  for (const r of rules) {
    const sig = ruleSignature({
      trigger: spec.trigger,
      listId: r.triggerListId,
      actions: r.actions.map((a) => ({ type: a.type, ...(a.type === 'SET_DONE' ? { done: a.boolValue ?? true } : {}), ...(a.labelId ? { labelId: a.labelId } : {}), ...(a.userId ? { userId: a.userId } : {}) })),
    });
    if (sig === want) return { id: r.id, name: r.name, isEnabled: r.isEnabled };
  }
  return null;
}

/** Cau khi luat giong het da co. */
export const sameRuleText = (existing: ExistingRule): string =>
  `Bảng đã có luật giống hệt: ${q(existing.name)}${existing.isEnabled ? '' : ' (đang tắt, bạn có thể bật lại ở mục Tự động hóa)'}. Mình không tạo thêm để tránh chạy hai lần.`;
