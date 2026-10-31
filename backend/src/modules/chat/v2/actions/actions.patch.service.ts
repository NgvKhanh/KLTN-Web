// DICH VU BOARD PATCH (Phase 3): "AI mo rong bang" - nguoi dung neu muc tieu, AI de xuat cot / the MOI, server loc trung, hien xem truoc,
// nguoi dung bam "Ap dung" thi ghi. Tai su dung TOAN BO ha tang Phase 2: ChatActionPlan, preflight, guard, executor (mot transaction),
// kiem tra ke hoach cu (STALE), idempotent.
//
// Khac propose_actions o BON diem (con lai y het):
//  1. Noi dung (ten cot, tieu de the) do AI nghi ra, khong phai chu nguoi dung go -> nguon cua hanh dong chi con la CAU (assessPatchRequest).
//  2. CHI hai thao tac CREATE_LIST + CREATE_CARD; khong co o nao de xoa / sua / chuyen du lieu cu.
//  3. LUON xem truoc -> Ap dung, ke ca khi CHAT_AUTO_EXECUTE bat va chi co mot the (decidePatch).
//  4. Kiem tra trung voi TOAN BO bang truoc khi xem truoc, kiem lai luc ap dung (preflight) va lai lan nua TRONG transaction (lockAndVerify).
//
// Du lieu cua bang (ten bang / cot / the) chi la DU LIEU cho bo lap ke hoach (khung BOARD_DATA, khong co cong cu, khong co quyen ghi); moi thu
// no tra ve deu qua schema dong, sang loc noi dung (looksUnsafe) va preflight nhu mot de xuat bat ky.

import { vnToday } from '../../chat.period';
import { decidePatch } from './actions.autorun';
import { guardBoard, guardPlan } from './actions.guard';
import { buildPatch } from './actions.patch.build';
import { buildPlannerContext, buildPlannerMessages, loadBoardContext, type PatchPlanner } from './actions.patch.context';
import { assessPatchRequest, PATCH_LIMITS, UNSAFE_CONTENT_TEXT } from './actions.patch.schema';
import { cancelOpenPlans } from './actions.plan.repo';
import { prepare, resolvePrepared } from './actions.preflight';
import { boardInCeiling, persist, refuse, storedPlan, targetBoard, type ActionOutcome, type ActionSession, type Base, type PlanMeta } from './actions.service';
import type { PatchInfo, StoredOp, StoredPlan } from './actions.types';
import { planViewOf } from './actions.view';

export interface PatchInput {
  session: ActionSession;
  now: Date;
  /** Cau CUA NGUOI DUNG (da gop phan bo sung): chi cau nay moi la lenh. */
  message: string;
  /** Muc tieu mo hinh khai khi chon cong cu (chi de do dac). */
  goal: string;
  meta: PlanMeta;
  planner: PatchPlanner;
}

const AI_DOWN_TEXT = 'AI hiện chưa sẵn sàng nên mình chưa lập được kế hoạch mở rộng bảng. Chưa thay đổi gì. Hãy thử lại sau.';
const AI_BAD_TEXT = 'AI chưa đề xuất được kế hoạch hợp lệ cho yêu cầu này. Chưa thay đổi gì. Hãy nêu rõ hơn (ví dụ giai đoạn hoặc tính năng cần thêm việc) rồi thử lại.';

export const previewPatchText = (info: Pick<PatchInfo, 'newLists' | 'newCards'>, boardName: string): string => {
  const parts = [info.newLists > 0 ? `${info.newLists} cột` : '', info.newCards > 0 ? `${info.newCards} thẻ` : ''].filter((p) => p !== '');
  return `AI đề xuất thêm ${parts.join(' và ')} vào bảng “${boardName}”, dữ liệu hiện có được giữ nguyên. Bấm “Áp dụng” để thêm hoặc “Hủy” để bỏ qua.`;
};

const skippedText = (info: PatchInfo): string => {
  const names = info.skipped.slice(0, 3).map((s) => `“${s.title}”`).join(', ');
  return `Mình không thấy mục nào mới để thêm: ${info.skipped.length} mục AI định thêm đã có sẵn hoặc trùng nhau (ví dụ ${names}). Chưa thay đổi gì.`;
};

export async function proposeBoardPatch(input: PatchInput): Promise<ActionOutcome> {
  const { session, now, message } = input;
  const userId = session.userId;
  const baseOf = (symbolic: StoredPlan['symbolic'], meta: PlanMeta): Base => ({ session, now, message, symbolic, meta, autoExecute: false });
  const kind = { kind: 'PATCH' as const };
  let base = baseOf([], input.meta);

  // 1) cau co that su yeu cau mo rong bang khong (khong xoa / thay the, khong tao ca bang moi, khong lam theo chi dan trong du lieu)
  const request = assessPatchRequest(message);
  if (!request.ok) return refuse(base, null, request.code, request.text, { provenance: 'NOT_REQUESTED', stored: kind, parse: false });

  // 2) bang dich + quyen sua: kiem TRUOC khi ton mot luot goi AI
  const found = await targetBoard(session, now);
  if (!found.ok) {
    return refuse(base, null, found.code, found.text, {
      provenance: 'USER_DIRECT',
      stored: kind,
      ...(found.code === 'NO_BOARD' ? { pending: { kind: 'QUESTION', original: message, question: found.text, options: [] } as const } : {}),
    });
  }
  const { target } = found;
  const board = await guardBoard(userId, target.boardId);
  if (!board.ok) return refuse(base, target, board.code, board.text, { provenance: 'USER_DIRECT', stored: kind });
  const inCeiling = await boardInCeiling(session.uiScope, target.boardId);
  if (!inCeiling) return refuse(base, target, 'OUT_OF_SCOPE', 'Thao tác nằm ngoài phạm vi bảng hiện tại. Chưa thay đổi gì.', { provenance: 'USER_DIRECT', stored: kind });

  // 3) doc bang + nho bo lap ke hoach (MOT luot goi, khong cong cu)
  const loaded = await loadBoardContext(target.boardId);
  const view = buildPlannerContext(target.boardName, loaded.context);
  const planned = await input.planner(buildPlannerMessages(message, view));
  const plannerMs = planned.latencyMs;
  const meta: PlanMeta = {
    ...input.meta,
    promptTokens: planned.ok ? (input.meta.promptTokens ?? 0) + (planned.promptTokens ?? 0) : input.meta.promptTokens,
    completionTokens: planned.ok ? (input.meta.completionTokens ?? 0) + (planned.completionTokens ?? 0) : input.meta.completionTokens,
    latencyMs: (input.meta.latencyMs ?? 0) + plannerMs,
  };
  base = baseOf([], meta);
  if (!planned.ok) {
    return refuse(base, target, planned.reason === 'UNAVAILABLE' ? 'AI_UNAVAILABLE' : 'INVALID', planned.reason === 'UNAVAILABLE' ? AI_DOWN_TEXT : AI_BAD_TEXT, {
      provenance: 'USER_DIRECT',
      stored: kind,
      parse: planned.reason !== 'INVALID',
    });
  }

  // 4) de xuat -> thao tac tuong trung (loc trung tren TOAN BO bang, sang loc noi dung)
  const built = buildPatch(planned.draft, loaded.context);
  if (!built.ok) {
    return refuse(base, target, built.code, built.code === 'UNSAFE_CONTENT' ? UNSAFE_CONTENT_TEXT : AI_BAD_TEXT, { provenance: 'USER_DIRECT', stored: kind, parse: false });
  }
  const { build } = built;
  const info: PatchInfo = {
    goal: input.goal.slice(0, 300),
    newLists: build.newLists,
    newCards: build.newCards,
    draftLists: build.draftLists,
    draftCards: build.draftCards,
    skipped: build.skipped,
    untouched: { lists: loaded.context.lists.length, cards: loaded.cardsTotal },
    context: { cardsShown: view.cardsShown, cardsTotal: view.cardsTotal, truncated: view.truncated },
    plannerMs,
  };
  base = baseOf(build.ops, meta);
  const patchExtra = { kind: 'PATCH' as const, patch: info };
  if (build.ops.length === 0) {
    return refuse(base, target, 'NO_CHANGE', build.skipped.length > 0 ? skippedText(info) : 'AI chưa đề xuất thêm được gì mới cho yêu cầu này. Chưa thay đổi gì. Hãy nêu rõ hơn rồi thử lại.', {
      provenance: 'USER_DIRECT',
      stored: patchExtra,
    });
  }

  // 5) preflight chung: gioi han -> do thi -> nguon goc -> phan giai -> quyen (mot buoc loi thi khong ghi gi)
  const prep = prepare(build.ops, message, vnToday(now), 'PATCH');
  if (!prep.ok) return refuse(base, target, prep.code, prep.text, { provenance: 'USER_DIRECT', stored: patchExtra, parse: false });
  const { prepared } = prep;
  const resolved = await resolvePrepared({ userId, exec: target.exec, boardId: target.boardId, bindings: [], prepared, presets: build.presets, mode: 'PATCH' });
  if (resolved.kind === 'CHOICE') {
    return refuse(base, target, 'AMBIGUOUS', 'Bảng có nhiều cột trùng tên nên mình chưa chắc nên thêm vào cột nào. Hãy đổi tên một cột hoặc chỉ định rõ hơn. Chưa thay đổi gì.', {
      provenance: prepared.prov.verdict,
      presets: build.presets,
      stored: patchExtra,
      resolve: false,
    });
  }
  if (resolved.kind === 'FAIL') {
    return refuse(base, target, resolved.code, resolved.text, { ops: resolved.ops, provenance: prepared.prov.verdict, presets: build.presets, stored: patchExtra, resolve: false });
  }

  const ops: StoredOp[] = resolved.ops;
  const guard = await guardPlan({ userId, boardId: target.boardId, ops });
  const decision = decidePatch({ opTypes: ops.map((o) => o.type), provenance: prepared.prov, boardIds: [target.boardId], inCeiling, guard, maxOps: PATCH_LIMITS.maxOps });
  if (decision.mode !== 'CONFIRM') {
    const reason = decision.mode === 'REFUSE' ? decision : { code: 'INVALID' as const, text: 'Không lập được kế hoạch. Chưa thay đổi gì.' };
    return refuse(base, target, reason.code, reason.text, { ops, provenance: prepared.prov.verdict, presets: build.presets, stored: patchExtra, resolve: true });
  }

  // 6) luu (PROPOSED, luon can bam "Ap dung") va hien xem truoc
  const warnings = [...resolved.warnings];
  if (view.truncated) warnings.push(`AI chỉ xem ${view.cardsShown}/${view.cardsTotal} thẻ của bảng; mình vẫn kiểm tra trùng trên toàn bộ thẻ.`);
  if (loaded.dedupeTruncated) warnings.push('Bảng rất lớn nên mình chỉ kiểm tra trùng trên một phần thẻ.');
  const stored = storedPlan(base, target, ops, { ...patchExtra, presets: { ...build.presets, ...resolved.pins }, warnings });
  const row = await persist(
    base,
    target,
    { plan: stored, risk: decision.risk, requiresConfirmation: true, reasons: decision.reasons, provenance: prepared.prov.verdict, status: 'PROPOSED', autoExecuted: false, resolve: true },
    null
  );
  await cancelOpenPlans(userId, session.id, 'SUPERSEDED', now, { except: row.id });
  return { text: previewPatchText(info, target.boardName), action: { kind: 'PLAN', plan: planViewOf(row, stored, 'PROPOSED', now) }, bind: [] };
}
