// CHINH SACH TU CHAY AN TOAN (CHATBOT_V2_ACTIONS_PLAN.md §5). Ham thuan: nhan cac su that da biet, tra ve AUTO / CONFIRM / REFUSE.
//
// Tam dieu kien (theo yeu cau 07/10) de mot thao tac duoc TU CHAY, khong can bam "Ap dung":
//   1. nguon cua hanh dong la lenh truc tiep cua nguoi dung        -> provenance = USER_DIRECT
//   2. thao tac thuoc whitelist an toan                            -> AUTO_RUN_TYPES (22 loai: 7 cua Phase 1 +
//      SET_CARD_START / REMOVE_MEMBER / REMOVE_LABEL (buoc D) + cac viec chinh xac / ca nhan o buoc E-I)
//   3. moi tham chieu resolve DUNG MOT doi tuong                   -> refsUnique
//   4. chi tac dong MOT bang, nam trong tran pham vi               -> boardIds / inCeiling
//   5. khong hang loat, khong huy hoai                             -> DUNG MOT thao tac, khong co bo chon / xoa
//   6. khong phai thao tac quan tri bang                           -> (doi quyen / vai tro / hien thi / thanh vien /
//      luu tru / xoa bang, tu buoc I) policy.confirm co ADMIN: LUON xem truoc, rui ro CAO, khong bao gio tu chay;
//      chuyen quyen CHU bang khong dien dat duoc trong schema
//   7. khong thuc thi chi dan lay tu du lieu                       -> provenance khong phai DELEGATED_TO_DATA / UNGROUNDED
//   8. backend kiem quyen + nghiep vu truoc khi chay               -> guard
// Khong dat -> CONFIRM (xem truoc + bam Ap dung, kem ly do) hoac REFUSE (khong ghi gi). Ten the xuat hien trong ngu canh hoi
// thoai KHONG con lam mat tu cach tu chay: chi NGUON CUA LENH moi duoc xet.
//
// Phase 2 - NHIEU THAO TAC: tu hai thao tac tro len la HANG LOAT (dieu kien 5) nen KHONG BAO GIO tu chay, ke ca khi moi thao tac deu
// nhe (vd chi toan "tao the"): mot lenh tao nham 10 the + 3 cot khong co nut hoan tac, phai doi nguoi dung tu don. Muon cho phep
// mot lop da thao tac cuc an toan tu chay thi phai dua bang chung truoc (xem CHATBOT_V2_MODULE.md §9, muc "Tu chay nhieu thao tac").
// Tao cot (CREATE_LIST) cung luon xem truoc: no doi cau truc bang va ten cot co the keo theo trang thai (vd "Hoan thanh" -> DONE).

import { ACTION_TYPES, AUTO_RUN_TYPES, CONTENT_TYPES, MAX_OPS_PER_PLAN, STRUCTURE_TYPES } from './actions.schema';
import type { ProvenanceReport } from './actions.provenance';
import { handlerOf } from './ops/ops.registry';
import type { ActionErrorCode, ConfirmReason, GuardVerdict, PlanRisk } from './actions.types';

/** Cac thao tac duoc phep TU CHAY khi la thao tac duy nhat. */
export const SAFE_ACTION_TYPES: readonly string[] = AUTO_RUN_TYPES;

/** Tu muc nay tro len ke hoach duoc coi la co rui ro CAO (nhieu thay doi cung luc). */
export const HIGH_RISK_OPS = 8;
/** Phase 6: tu so thao tac nay tro len, ke hoach co nguoi nhan do may chon la rui ro CAO. */
export const ASSIGN_HIGH_OPS = 4;

export interface DecisionInput {
  /** Loai tung thao tac theo thu tu chay. */
  opTypes: readonly string[];
  provenance: ProvenanceReport;
  /** Ngay han la moc mo ("cuoi tuan") -> nen cho nguoi dung xem lai. */
  dueFuzzy: boolean;
  /** Moi tham chieu da resolve ra dung mot doi tuong (lua chon bang nut cua nguoi dung cung tinh la duy nhat). */
  refsUnique: boolean;
  /** Cac bang (khong trung) cua moi id duoc nhac. */
  boardIds: readonly string[];
  /** Bang cua ke hoach nam trong tran pham vi hien tai. */
  inCeiling: boolean;
  guard: GuardVerdict;
  /** Co CHAT_AUTO_EXECUTE. */
  autoExecute: boolean;
  /** Phase 6: co thao tac nao co nguoi nhan do MAY chon (module goi y phan cong) khong. */
  aiChosen?: boolean;
  /** Ly do xem truoc do chinh thao tac DA PHAN GIAI bao (OpPolicy.confirmFor). */
  extraReasons?: readonly ConfirmReason['code'][];
}

export type Decision =
  | { mode: 'AUTO'; risk: 'LOW'; reasons: ConfirmReason[] }
  | { mode: 'CONFIRM'; risk: PlanRisk; reasons: ConfirmReason[] }
  | { mode: 'REFUSE'; code: ActionErrorCode; text: string };

export const CONFIRM_REASON_TEXT: Record<ConfirmReason['code'], string> = {
  AUTO_DISABLED: 'Chế độ tự chạy đang tắt nên mọi thao tác cần bạn xác nhận.',
  DELEGATED_TO_DATA:
    'Bạn nhờ làm theo nội dung nằm trong dữ liệu (thẻ, mô tả, bình luận…). Chỉ dẫn này đến từ dữ liệu chứ không phải từ chính câu lệnh của bạn nên thao tác không tự chạy.',
  NOT_GROUNDED: 'Mình đã diễn giải lại câu của bạn (tên hoặc nội dung chưa khớp hẳn với chữ bạn gõ) nên cần bạn xác nhận.',
  FUZZY_DATE: 'Ngày hạn bạn nói còn mơ hồ (ví dụ “cuối tuần”). Hãy kiểm tra ngày mình đã hiểu.',
  QUESTION_FORM: 'Câu của bạn có dạng câu hỏi nên mình chỉ làm khi bạn xác nhận.',
  MULTI_OP: 'Lệnh gồm nhiều thay đổi cùng lúc nên mình luôn cho bạn xem lại trước khi áp dụng (áp dụng là làm tất cả hoặc không làm gì).',
  NEW_STRUCTURE: 'Tạo hoặc đổi tên cột làm thay đổi cấu trúc của bảng nên cần bạn xác nhận.',
  TEXT_CONTENT: 'Mô tả, bình luận và checklist là nội dung văn bản mà người khác trong bảng sẽ đọc (bình luận còn gửi thông báo) nên mình luôn cho bạn xem lại trước khi áp dụng.',
  ARCHIVE: 'Lưu trữ sẽ ẩn thẻ khỏi bảng (khôi phục lại được trong mục Lưu trữ) nên mình luôn cho bạn xem lại trước khi áp dụng.',
  AI_CHOSEN_TARGET: 'Người nhận do hệ thống gợi ý phân công chọn (không phải tên bạn nêu) nên mình luôn cho bạn xem điểm, độ tin cậy, cờ cảnh báo và ứng viên khác trước khi áp dụng.',
  STANDING_RULE: 'Luật tự động hóa chạy LÂU DÀI mỗi khi điều kiện xảy ra, bằng quyền của bạn (người tạo luật) và có thể thay đổi nhiều thẻ về sau, nên mình luôn cho bạn xem lại trước khi áp dụng và không bao giờ tự chạy.',
  BOARD_PATCH: 'Nội dung cột và thẻ này do AI đề xuất (không phải chữ bạn gõ) nên mình luôn cho bạn xem trước và chỉ thêm mới, không đụng tới dữ liệu cũ.',
  DELETE: 'Xóa là thẻ, cột, bình luận hoặc tệp biến mất khỏi bảng và không khôi phục lại được ở giao diện nên mình luôn cho bạn xem lại trước khi áp dụng và không bao giờ tự chạy. Muốn giữ lại thì hãy dùng lưu trữ.',
  BULK: 'Thao tác này tác động lên cả một cột (nhiều thẻ cùng lúc) nên mình luôn cho bạn xem lại số lượng trước khi áp dụng.',
  ADMIN: 'Đây là thao tác quản trị bảng (thành viên, quyền, hiển thị, lưu trữ hay xóa bảng) ảnh hưởng tới nhiều người nên mình luôn cho bạn xem lại trước khi áp dụng và không bao giờ tự chạy.',
  FILE: 'Tệp đính kèm sẽ hiện cho mọi người trong bảng nên mình luôn cho bạn xem lại tên và loại tệp trước khi áp dụng.',
};

const refuse = (code: ActionErrorCode, text: string): Decision => ({ mode: 'REFUSE', code, text });

/**
 * Cau khong yeu cau thao tac nay (khong co dong tu / bi phu dinh) -> tu choi NGAY, truoc ca khi tim doi tuong: khong hien nut
 * chon cho mot lenh ma nguoi dung khong he ra. Dung chung voi decideExecution de van ban chi nam o mot cho.
 * `opLabel`: ten thao tac khong duoc yeu cau (chi dung khi ke hoach co nhieu thao tac de noi ro la thao tac nao).
 */
export function refusalBeforeResolve(provenance: ProvenanceReport, opLabel?: string): Extract<Decision, { mode: 'REFUSE' }> | null {
  if (provenance.verdict !== 'NOT_REQUESTED') return null;
  return {
    mode: 'REFUSE',
    code: 'NOT_REQUESTED',
    text:
      opLabel === undefined
        ? 'Mình chưa thấy câu của bạn yêu cầu thao tác này nên chưa thay đổi gì. Hãy nói rõ lệnh, ví dụ: “Chuyển Login sang Done”.'
        : `Mình chưa thấy câu của bạn yêu cầu “${opLabel}” nên không thực hiện kế hoạch này (áp dụng là làm tất cả hoặc không làm gì). Chưa thay đổi gì. Hãy nói rõ từng việc bạn muốn.`,
  };
}

/** Rui ro hien cho nguoi dung (khong dieu khien chinh sach): 1 thao tac ro rang LOW; nhieu thao tac / can xem lai MEDIUM; hang loat lon HIGH. */
export function riskOf(opCount: number, reasons: readonly ConfirmReason[]): PlanRisk {
  if (opCount >= HIGH_RISK_OPS) return 'HIGH';
  // Phase 7: luat tu dong hoa chay mai mai bang quyen nguoi tao -> luon CAO
  if (reasons.some((r) => r.code === 'STANDING_RULE' || r.code === 'DELETE' || r.code === 'ADMIN')) return 'HIGH';
  // chia viec hang loat do may chon (>= 4 the) cao hon: nhieu nguoi bi giao cung luc
  if (opCount >= ASSIGN_HIGH_OPS && reasons.some((r) => r.code === 'AI_CHOSEN_TARGET')) return 'HIGH';
  if (opCount >= 2 || reasons.some((r) => r.code !== 'AUTO_DISABLED')) return 'MEDIUM';
  return 'LOW';
}

export interface PatchDecisionInput {
  opTypes: readonly string[];
  provenance: ProvenanceReport;
  boardIds: readonly string[];
  inCeiling: boolean;
  guard: GuardVerdict;
  /** Han muc so thao tac cua Board Patch (PATCH_LIMITS.maxOps). */
  maxOps: number;
}

/**
 * Quyet dinh cho BOARD PATCH (Phase 3): KHONG BAO GIO tu chay, ke ca khi CHAT_AUTO_EXECUTE bat va ke hoach chi co MOT the - noi dung do AI nghi ra
 * nen nguoi dung phai thay truoc. Chi con hai ket qua: CONFIRM (xem truoc + Ap dung) hoac REFUSE. Chi cho phep CREATE_LIST / CREATE_CARD.
 */
export function decidePatch(input: PatchDecisionInput): Decision {
  const count = input.opTypes.length;
  if (!input.guard.ok) return refuse(input.guard.code, input.guard.text);
  if (count < 1 || count > input.maxOps) return refuse('TOO_MANY_OPS', `Một lần chỉ thêm tối đa ${input.maxOps} thao tác. Hãy nêu phạm vi hẹp hơn. Chưa thay đổi gì.`);
  if (input.opTypes.some((t) => t !== 'CREATE_LIST' && t !== 'CREATE_CARD')) return refuse('INVALID', 'Mở rộng bảng chỉ được thêm cột và thẻ mới. Chưa thay đổi gì.');
  if (input.boardIds.length !== 1 || !input.inCeiling) return refuse('OUT_OF_SCOPE', 'Thao tác nằm ngoài phạm vi bảng hiện tại. Chưa thay đổi gì.');
  const notRequested = refusalBeforeResolve(input.provenance);
  if (notRequested) return notRequested;
  const reasons: ConfirmReason[] = [{ code: 'BOARD_PATCH', text: CONFIRM_REASON_TEXT.BOARD_PATCH }];
  return { mode: 'CONFIRM', risk: riskOf(Math.max(count, 2), reasons), reasons };
}

export function decideExecution(input: DecisionInput): Decision {
  const count = input.opTypes.length;
  // A8: quyen + nghiep vu truoc het - khong co quyen thi khong co gi de ban
  if (!input.guard.ok) return refuse(input.guard.code, input.guard.text);
  // A5: gioi han so thao tac (gioi han that nam o actions.graph.checkLimits; day la lop thu hai)
  if (count < 1 || count > MAX_OPS_PER_PLAN) {
    return refuse('TOO_MANY_OPS', `Một kế hoạch chỉ có từ 1 đến ${MAX_OPS_PER_PLAN} thao tác. Hãy chia nhỏ lệnh. Chưa thay đổi gì.`);
  }
  // A2 + A6: whitelist (schema da dong; kiem lai de ham nay tu bao ve)
  if (input.opTypes.some((t) => !(ACTION_TYPES as readonly string[]).includes(t))) {
    return refuse('INVALID', 'Thao tác này chưa được trợ lý hỗ trợ. Chưa thay đổi gì.');
  }
  // A4: mot bang, trong tran
  if (input.boardIds.length !== 1 || !input.inCeiling) {
    return refuse('OUT_OF_SCOPE', 'Thao tác nằm ngoài phạm vi bảng hiện tại. Chưa thay đổi gì.');
  }
  // A3
  if (!input.refsUnique) return refuse('AMBIGUOUS', 'Còn đối tượng chưa xác định được duy nhất. Chưa thay đổi gì.');
  // A1: cau khong yeu cau thao tac nay
  const notRequested = refusalBeforeResolve(input.provenance);
  if (notRequested) return notRequested;

  const reasons: ConfirmReason[] = [];
  const push = (code: ConfirmReason['code']) => reasons.push({ code, text: CONFIRM_REASON_TEXT[code] });
  if (input.provenance.verdict === 'DELEGATED_TO_DATA') push('DELEGATED_TO_DATA');
  if (input.provenance.verdict === 'UNGROUNDED') {
    if (input.provenance.failures.some((f) => f.code === 'QUESTION_FORM')) push('QUESTION_FORM');
    if (input.provenance.failures.some((f) => f.code !== 'QUESTION_FORM')) push('NOT_GROUNDED');
  }
  if (input.dueFuzzy) push('FUZZY_DATE');
  if (input.aiChosen === true) push('AI_CHOSEN_TARGET');
  if (count >= 2) push('MULTI_OP');
  if (input.opTypes.includes('CREATE_AUTOMATION_RULE')) push('STANDING_RULE');
  if (input.opTypes.some((t) => STRUCTURE_TYPES.includes(t as (typeof STRUCTURE_TYPES)[number]))) push('NEW_STRUCTURE');
  if (input.opTypes.some((t) => CONTENT_TYPES.includes(t as (typeof CONTENT_TYPES)[number]))) push('TEXT_CONTENT');
  if (input.opTypes.includes('ARCHIVE_CARD')) push('ARCHIVE');
  // thao tac mo rong: ly do xac nhan do chinh handler khai bao (xoa, ca cot, quan tri, tep...)
  for (const t of new Set(input.opTypes)) {
    for (const code of handlerOf(t)?.policy.confirm ?? []) if (!reasons.some((r) => r.code === code)) push(code);
  }
  for (const code of input.extraReasons ?? []) if (!reasons.some((r) => r.code === code)) push(code);
  if (!input.autoExecute) push('AUTO_DISABLED');

  if (reasons.length === 0) return { mode: 'AUTO', risk: 'LOW', reasons };
  // chi vi tat tu chay thi van la lenh ro rang cua nguoi dung -> LOW; con lai la lenh can xem lai -> MEDIUM / HIGH
  return { mode: 'CONFIRM', risk: riskOf(count, reasons), reasons };
}
