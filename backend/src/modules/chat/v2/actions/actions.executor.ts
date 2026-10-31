// THUC THI mot ke hoach (CHATBOT_V2_ACTIONS_PLAN.md §4.6, Phase 2).
//
// Thu tu, moi buoc deu CHI DOC cho toi khi vao transaction:
//   1. guardBoard : nguoi ra lenh con quyen SUA bang khong (mat quyen -> FAILED, khong bi che boi "du lieu da doi")
//   2. dung lai   : phan giai lai tu phan tuong trung da luu + id da ghim, so voi luc xem truoc -> khac thi STALE (bo qua khi vua moi lap)
//   3. guardPlan  : quyen + nghiep vu cua TAT CA thao tac (mot thao tac bi chan -> ca ke hoach that bai)
//   4. TRANSACTION (mot lan, tat ca hoac khong gi):
//        a. nhan cho PROPOSED -> EXECUTING   (nguyen tu; hai yeu cau dong thoi: yeu cau sau doi roi thua cuoc va nhan lai ket qua cu)
//        b. khoa dong theo thu tu id, kiem lai quyen + ton tai + gia tri cu  (sai -> PlanAbort -> rollback)
//        c. ghi tung thao tac theo thu tu topo (du lieu + Activity)
//        d. chot EXECUTED + ket qua   (cung transaction nen process chet giua chung thi ke hoach quay ve PROPOSED, KHONG ket o EXECUTING)
//   5. SAU COMMIT : phat thong bao / tu dong hoa / socket (actions.effects)
// That bai o buoc nao cung chot FAILED / STALE (conditional update) va tra cau tieng Viet "chua thay doi gi".

import { prisma } from '../../../../config/prisma';
import { Prisma } from '../../../../generated/prisma/client';
import { AppError } from '../../../../utils/AppError';
import { vnToday } from '../../chat.period';
import type { ChatScopeInput } from '../../chat.scope';
import type { EntityOption } from '../chat.v2.entities';
import { resolveExecutionContext, type ExecutionContext } from '../chat.v2.scope';
import { discardAdopted, dispatchEffects, newEffects, type DispatchReport, type Effects } from './actions.effects';
import { guardBoard, guardPlan, mapServiceError } from './actions.guard';
import { buildResultView, errorText, STALE_TAIL, summarizePatch, summarizePlan } from './actions.plan';
import { recordAssignOutcomes } from './actions.assign';
import { claimPlan, expireIfNeeded, findOwnedPlan, recoverIfStuck, settlePlan, type PlanRow } from './actions.plan.repo';
import { rebuildAndCompare } from './actions.preflight';
import type { ActionErrorCode, ResultStatus, ResultView, StoredPlan } from './actions.types';
import { resultFromRow } from './actions.view';
import { applyOp, laterAssignees, lockAndVerify, PlanAbort, type OpOutcome, type RunState } from './actions.write';

export interface ExecOutcome {
  status: ResultStatus;
  result: ResultView;
  /** true: ke hoach da duoc yeu cau khac chot truoc (khong chay lai). */
  replayed: boolean;
  /** Doi tuong de hieu "no / the vua roi" o cau sau (the va cot cuoi cung bi tac dong). */
  bind: EntityOption[];
  report?: DispatchReport;
}

export interface ExecInput {
  row: PlanRow;
  now: Date;
  autoExecuted: boolean;
  /** Pham vi GIAO DIEN luc ap dung (de dung lai ngu canh bang). */
  scope: ChatScopeInput;
  /** Ke hoach vua duoc lap trong cung luot (tu chay): khong can dung lai de so sanh. */
  skipRebuild?: boolean;
}

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** Lan nhan cho that bai: ke hoach khong con PROPOSED (da chay / da huy / het han) hoac vua bi yeu cau khac nhan truoc. */
class NotClaimed extends Error {}

const unique = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

function bindingsFrom(state: RunState, outcomes: readonly OpOutcome[], boardName: string): EntityOption[] {
  const out: EntityOption[] = [];
  const card = [...outcomes].reverse().find((o) => o.cardId !== undefined);
  const cardState = card?.cardId !== undefined ? state.cards.get(card.cardId) : undefined;
  if (card?.cardId !== undefined && cardState) out.push({ id: card.cardId, name: cardState.title, kind: 'CARD', parentName: boardName });
  const lastList = [...outcomes].reverse().find((o) => o.listId !== undefined);
  if (lastList?.listId !== undefined) {
    const created = [...state.created.values()].find((c) => c.kind === 'LIST' && c.id === lastList.listId);
    const name = created?.name ?? (lastList.cardId !== undefined ? state.cards.get(lastList.cardId)?.listName : undefined);
    if (name !== undefined) out.push({ id: lastList.listId, name, kind: 'COLUMN', parentName: boardName });
  }
  return out;
}

export async function executePlan(input: ExecInput): Promise<ExecOutcome> {
  const { row, now } = input;
  const stored = row.plan as unknown as StoredPlan;
  const userId = row.userId as string;
  const ops = stored.ops;
  const patchPlan = stored.kind === 'PATCH';
  const ctx = { userId, boardId: stored.boardId, ...(patchPlan ? { patch: true } : {}) };
  const warnings = stored.warnings ?? [];

  /** Chot THAT BAI (chua ghi gi). Neu ke hoach da bi yeu cau khac chot truoc thi tra ket qua cua yeu cau do. */
  const fail = async (status: 'FAILED' | 'STALE', code: ActionErrorCode, text: string, detail?: string): Promise<ExecOutcome> => {
    const result = buildResultView({
      planId: row.id,
      autoExecuted: input.autoExecuted,
      status,
      summary: text,
      boardId: stored.boardId,
      error: { code, text },
      warnings,
    });
    const won = await settlePlan(row.id, userId, 'PROPOSED', {
      status,
      result: json({ ...result, ...(detail !== undefined ? { detail: detail.slice(0, 300) } : {}) }),
      errorCode: code,
      executedOps: 0,
      executionMs: null,
      now,
    });
    if (won) return { status, result, replayed: false, bind: [] };
    return replay((await findOwnedPlan(userId, row.id)) ?? row);
  };

  const replay = async (current: PlanRow): Promise<ExecOutcome> => {
    const fresh = await recoverIfStuck(await expireIfNeeded(current, now), now);
    if (fresh.status === 'EXECUTING') throw new AppError('Kế hoạch đang được thực hiện. Hãy chờ một chút.', 409);
    const result = resultFromRow(fresh, true);
    return { status: result.status, result, replayed: true, bind: [] };
  };

  if (ops.length === 0) return fail('FAILED', 'INVALID', errorText('INVALID'));
  // Board Patch chi THEM cot / the: hang da luu co thao tac nao khac thi KHONG chay (kiem lai dung luc ap dung, khong tin du lieu da luu)
  if (patchPlan && ops.some((o) => o.type !== 'CREATE_LIST' && o.type !== 'CREATE_CARD')) return fail('FAILED', 'INVALID', errorText('INVALID'));

  const refuseGuard = (g: { code: ActionErrorCode; text: string }) => {
    const stale = g.code === 'NOT_FOUND';
    return fail(stale ? 'STALE' : 'FAILED', stale ? 'STALE' : g.code, stale ? errorText('STALE') : g.text);
  };

  // 1) quyen SUA bang cua nguoi ra lenh, kiem lai DUNG luc chay (quyen co the vua doi giua hai buoc). Kiem truoc buoc 2 de "mat quyen"
  //    luon duoc bao la mat quyen chu khong bi che boi "du lieu da doi".
  const board = await guardBoard(userId, stored.boardId);
  if (!board.ok) return refuseGuard(board);

  // 2) du lieu co doi ke tu luc xem truoc khong
  if (input.skipRebuild !== true) {
    let exec: ExecutionContext;
    try {
      exec = await resolveExecutionContext({ userId, now, scope: input.scope, conversationScope: { kind: 'BOARD', boardId: stored.boardId } });
    } catch (e) {
      if (e instanceof AppError && e.statusCode < 500) {
        return e.statusCode === 404 ? fail('STALE', 'STALE', errorText('STALE')) : fail('FAILED', 'FORBIDDEN', errorText('FORBIDDEN'));
      }
      throw e;
    }
    const same = await rebuildAndCompare({ userId, exec, stored, today: vnToday(row.createdAt), planNow: row.createdAt });
    if (same.kind === 'CHANGED') return fail('STALE', 'STALE', `${same.reason} ${STALE_TAIL}`);
    if (same.kind === 'UNRESOLVABLE') return fail('STALE', 'STALE', same.reason.includes('Chưa thay đổi gì') ? `${same.reason} Hãy gửi lại lệnh để tạo kế hoạch mới.` : `${same.reason} ${STALE_TAIL}`);
  }

  // 3) quyen + nghiep vu cua TAT CA thao tac (mot thao tac bi chan -> ca ke hoach that bai)
  const guard = await guardPlan({ userId, boardId: stored.boardId, ops });
  if (!guard.ok) return refuseGuard(guard);

  // 4) transaction: nhan cho + khoa + ghi + chot ket qua cung mot COMMIT
  const started = Date.now();
  // hieu ung cua lan chay gan nhat: neu transaction hoan tac thi cac tep da chep vao thu muc tep the phai bi go
  let liveEffects: Effects | null = null;
  const attempt = () =>
    prisma.$transaction(
      async (tx) => {
        if (!(await claimPlan(row.id, userId, now, tx))) throw new NotClaimed();
        const state = await lockAndVerify(tx, ctx, ops);
        const effects = newEffects();
        liveEffects = effects;
        const excl = laterAssignees(ops, state);
        const outcomes: OpOutcome[] = [];
        for (const [index, op] of ops.entries()) outcomes.push(await applyOp(tx, ctx, state, effects, op, index, excl(index)));

        const changed = outcomes.filter((o) => o.changed).length;
        const cardIds = unique(outcomes.flatMap((o) => (o.cardId !== undefined ? [o.cardId] : [])));
        const multi = ops.length > 1;
        const made = (type: string) => outcomes.filter((o, i) => o.changed && ops[i].type === type).length;
        const result = buildResultView({
          planId: row.id,
          status: 'EXECUTED',
          autoExecuted: input.autoExecuted,
          summary: patchPlan ? summarizePatch(stored.boardName, made('CREATE_LIST'), made('CREATE_CARD')) : summarizePlan(stored.boardName, outcomes.map((o) => ({ text: o.text, changed: o.changed }))),
          boardId: stored.boardId,
          ...(cardIds.length > 0 ? { cardId: cardIds[0] } : {}),
          warnings,
          ...(multi ? { opCount: ops.length, details: outcomes.map((o) => o.text), cardIds } : {}),
        });
        const settled = await settlePlan(row.id, userId, 'EXECUTING', { status: 'EXECUTED', result: json(result), errorCode: null, executedOps: changed, executionMs: Date.now() - started, now }, tx);
        if (!settled) throw new NotClaimed();
        return { state, effects, outcomes, result };
      },
      { timeout: 30_000, maxWait: 10_000 }
    );

  try {
    let done: Awaited<ReturnType<typeof attempt>>;
    try {
      done = await attempt();
    } catch (e) {
      // xung dot khoa / deadlock voi mot thao tac khac dang sua cung dong: thu lai MOT lan (transaction truoc da rollback han)
      if (liveEffects !== null) discardAdopted(liveEffects);
      liveEffects = null;
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2034') done = await attempt();
      else throw e;
    }
    const report = await dispatchEffects(done.effects);
    // Phase 6: ghi ket qua cho luot goi y phan cong - CHI sau khi nguoi dung da bam Ap dung (khong bao gio khi tu chay: ke hoach co nguoi do may chon luon xem truoc)
    if (!input.autoExecuted) await recordAssignOutcomes({ userId, ops, changed: done.outcomes.map((o) => o.changed), now });
    return { status: 'EXECUTED', result: done.result, replayed: false, bind: bindingsFrom(done.state, done.outcomes, stored.boardName), report };
  } catch (e) {
    if (liveEffects !== null) discardAdopted(liveEffects);
    if (e instanceof NotClaimed) return replay((await findOwnedPlan(userId, row.id)) ?? row);
    if (e instanceof PlanAbort) {
      const stale = e.code === 'STALE' || e.code === 'NOT_FOUND';
      return fail(stale ? 'STALE' : 'FAILED', stale ? 'STALE' : e.code, stale ? `${e.message} ${STALE_TAIL}` : `${e.message} ${errorText(e.code)}`, e.message);
    }
    // loi nghiep vu cua service/assert (AppError < 500) -> ma + cau tieng Viet; loi he thong -> chot FAILED, KHONG lo chi tiet cho nguoi dung
    let mapped: ReturnType<typeof mapServiceError> | null = null;
    try {
      mapped = mapServiceError(e);
    } catch {
      mapped = null;
    }
    if (mapped) return fail('FAILED', mapped.code, mapped.text, e instanceof Error ? e.message : undefined);
    return fail('FAILED', 'SERVICE_ERROR', errorText('SERVICE_ERROR'), e instanceof Error ? `${e.name}: ${e.message}` : 'unknown');
  }
}
