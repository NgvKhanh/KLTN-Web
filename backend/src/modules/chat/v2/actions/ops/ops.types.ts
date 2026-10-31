// HOP DONG CUA MOT "NHOM THAO TAC MO RONG" (buoc E-I): moi thao tac mo rong khai bao O MOT CHO moi hanh vi cua no (o tham chieu, giay phep dong tu,
// phan giai, quyen, kiem lai gia tri cu, ghi, hien thi, giai thich STALE, chinh sach xac nhan). Cac thao tac cu (18 thao tac cua phase 1-7 + buoc D)
// van nam trong cac `switch` cua tung tep; thao tac moi di qua registry nay (ops.registry) de moi nhom la mot tep doc lap, kiem thu duoc rieng.
//
// QUY UOC IMPORT (de khong tao vong): tep trong actions/ops CHI import cac tep la (actions.write.base, actions.guard.base, actions.text, actions.dates,
// actions.palette...) va `import type` tu cac tep loi (actions.resolve, actions.refs). Phan giai dung ham tro giup do actions.resolve TIEM vao qua `ResolveHelpers`.

import type { ExecutionContext } from '../../chat.v2.scope';
import type { DueGrounding } from '../actions.dates';
import type { StagedUploadRef } from '../../uploads/chat.uploads';
import type { EntityOption } from '../../chat.v2.entities';
import type { Effects } from '../actions.effects';
import type { Slot, SlotName } from '../actions.refs';
import type { ActionOp, ActionType, MemberRef, Ref } from '../actions.schema';
import type { ActionErrorCode, ConfirmReasonCode, GuardVerdict, PendingChoice, PlanItemView, StoredOp } from '../actions.types';
import type { OpOutcome, RunState, Tx, WriteContext } from '../actions.write.base';

/** Thao tac mot lan chay cho phep: AUTO = tu chay khi la thao tac DUY NHAT va lenh truc tiep; con lai luon xem truoc kem cac ly do `confirm`. */
export interface OpPolicy {
  autoRun: boolean;
  /** Ly do luon bat buoc xem truoc (hien o ban xem truoc). Rong + autoRun = co the tu chay. */
  confirm: readonly ConfirmReasonCode[];
  /** Thao tac quan tri bang (xoa bang, doi quyen...): khong tron voi thao tac the / cot trong cung mot ke hoach. */
  admin?: boolean;
  /** Ly do xem truoc phu thuoc CHI TIET thao tac da phan giai (vd chi truong van ban moi la noi dung). */
  confirmFor?: (op: StoredOp) => readonly ConfirmReasonCode[];
}

/** Mot "Hit": thuc the da tim thay (id that + ten hien thi). */
export interface OpHit {
  id: string;
  name: string;
  parentName?: string;
  local?: string;
}

export type OpOutcomeKind = { kind: 'ONE'; hit: OpHit } | { kind: 'MANY'; hits: OpHit[] } | { kind: 'NONE'; text: string };

/** Ket qua phan giai cua mot thao tac (cung hinh dang voi actions.resolve.ResolveResult). */
export type OpResolveResult =
  | { kind: 'OK'; op: StoredOp; more?: StoredOp[]; warnings: string[] }
  | { kind: 'CHOICE'; pending: PendingChoice }
  | { kind: 'FAIL'; code: ActionErrorCode; text: string };

export interface CardTargetLite {
  ids: { card?: string };
  local?: { card: string };
  title: string;
  /** Hang the that (null khi la the do chinh ke hoach tao). */
  row: {
    id: string;
    title: string;
    description: string | null;
    startDate: Date | null;
    dueDate: Date | null;
    status: string;
    listId: string;
    list: { id: string; name: string; boardId: string };
    members: { userId: string }[];
    labels: { labelId: string }[];
  } | null;
}
export interface ListTargetLite {
  ids: { list?: string };
  local?: { list: string };
  name: string;
}

/** Ham tro giup do actions.resolve cung cap cho cac nhom thao tac. */
export interface ResolveHelpers {
  cardTarget(ref: Ref): Promise<CardTargetLite | OpResolveResult>;
  listTarget(ref: Ref | undefined): Promise<ListTargetLite | OpResolveResult>;
  /** Mot tham chieu (the / cot / nguoi / nhan co san) -> Hit hoac ket qua dung som (nut chon / loi). */
  pick(kind: 'card' | 'list' | 'member' | 'label', ref: MemberRef | undefined): Promise<OpHit | OpResolveResult>;
  /** Nguoi dung da chot (nut chon) cho dau van tay `sig`: tra id hoac undefined. */
  preset(sig: string): string | undefined;
  /** Ten bang + bo tat ca thuc the cua bang (de nhom thao tac tu tim thuc the con cua the / bang). */
  boardId: string;
  userId: string;
  exec: ExecutionContext;
  bindings: readonly EntityOption[];
  now: Date;
  /** Ngay han / bat dau da hieu tu cau (chi thao tac co o ngay: do actions.provenance tinh). */
  due?: DueGrounding;
  /** Cac tep nguoi dung dinh kem vao CHINH tin nhan nay (kho tam). Rong khi khong dinh kem. */
  uploads: readonly StagedUploadRef[];
}

export const isOpResult = (x: unknown): x is OpResolveResult => typeof x === 'object' && x !== null && 'kind' in x && ['OK', 'CHOICE', 'FAIL'].includes((x as { kind: string }).kind);

export interface ResolveCtx {
  h: ResolveHelpers;
  ok(op: StoredOp, more?: StoredOp[]): OpResolveResult;
  warnings: string[];
}

export interface GuardCtx {
  userId: string;
  boardId: string;
  /** Cac the da kiem quyen trong cung ke hoach. */
  checked?: Set<string>;
  /** Kiem quyen truy cap the (assertCardAccess + thuoc dung bang), nho ket qua. */
  card(cardId: string): Promise<GuardVerdict>;
}

export interface ApplyCtx {
  tx: Tx;
  ctx: WriteContext;
  state: RunState;
  effects: Effects;
  index: number;
  /** Nhung nguoi se duoc giao the nay o thao tac SAU (de thong bao thao tac truoc khong gui cho ho). */
  excl: (cardId: string) => string[];
}

/** Doi tuong ma thao tac tac dong: dung de phat hien mau thuan trong mot ke hoach (xoa the roi lai sua chinh the do...). */
export interface OpTarget {
  key: string;
  /** REMOVE: xoa / luu tru / di chuyen di mat; MODIFY: sua noi dung / thuoc tinh; READ: chi doc (khong xung dot). */
  effect: 'MODIFY' | 'REMOVE';
}

export interface OpHandler<T extends ActionOp = ActionOp> {
  readonly type: T['type'];
  /** Ten ngan cua thao tac (dung khi noi ro thao tac nao khong duoc yeu cau). */
  readonly label: string;
  readonly policy: OpPolicy;
  slots(op: T): Slot[];
  withRef(op: T, name: SlotName, ref: Ref): ActionOp;
  /**
   * Vi tri cac dong tu "giay phep" cua thao tac nay trong cau (rong = khong duoc cau yeu cau). `op` de doi chieu danh tu / ten rieng cua chinh
   * thao tac (vd "xoa" phai di cung "the" hoac ten the, de "xoa nhan Gap khoi the" khong cap giay phep cho DELETE_CARD).
   */
  licence(words: readonly string[], op: T): number[];
  /** Noi dung van ban moi phai la chu CHINH nguoi dung go. Mac dinh: khong co noi dung moi. */
  grounded?(op: T, words: readonly string[]): boolean;
  resolve(rc: ResolveCtx, op: T): Promise<OpResolveResult>;
  guard(g: GuardCtx, op: StoredOp): Promise<GuardVerdict>;
  /** Kiem lai TRONG transaction (sau khi khoa cot / the): ton tai + gia tri cu. Sai -> nem PlanAbort('STALE'...). */
  verify?(tx: Tx, ctx: WriteContext, op: StoredOp): Promise<void>;
  apply(a: ApplyCtx, op: StoredOp): Promise<OpOutcome>;
  describe(op: StoredOp, index: number): PlanItemView;
  summary(op: StoredOp): string;
  /** Giai thich vi sao ke hoach cu (STALE) khi cung doi tuong ma gia tri khac. */
  stale?: string;
  targets?(op: StoredOp): OpTarget[];
}

export type AnyHandler = OpHandler<ActionOp>;

/** Ep kieu mot handler cua mot loai thao tac cu the thanh handler chung (an toan: registry tra dung handler theo `type`). */
export function defineOp<K extends ActionType>(handler: OpHandler<Extract<ActionOp, { type: K }>>): AnyHandler {
  return handler as unknown as AnyHandler;
}
