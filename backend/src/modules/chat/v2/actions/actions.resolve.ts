// RESOLVER: tham chieu tuong trung (TEXT / CONTEXT / SELF / PLAN) -> id THAT trong bang cua ke hoach (CHATBOT_V2_ACTIONS_PLAN.md §6, §7).
//
// LLM khong bao gio thay ket qua nay va khong co o nao de dien id. Moi tham chieu CO SAN tim trong `exec` (da kep boi tran pham vi va
// chi gom DUNG bang cua ke hoach) nen "Login" o bang khac khong bao gio khop. Ket qua moi tham chieu: ONE / MANY (nhap nhang ->
// nut chon) / NONE (khong tim thay, khong goi y bang khac). Tham chieu PLAN (cot / the do chinh ke hoach tao) KHONG di qua CSDL:
// no tro toi mot thao tac tao, id chi co khi thao tac do chay trong transaction.
//
// Phase 2: mot ke hoach co nhieu thao tac nen (1) moi tham chieu CUNG DAU VAN TAY (actions.refs) chi tim mot lan - "Giao Login cho
// Nam va Register cho Nam" tim Nam mot lan - va mot lan nguoi dung bam chon ap dung cho moi cho nhac cung chu; (2) "no / the vua
// roi" duoc GHIM thanh id (`pins`) de ap dung sau van dung dung thuc the du phien hoi thoai da doi.

import { prisma } from '../../../../config/prisma';
import { guessListStatus } from '../../../card/cardStatus';
import { isSelfReference } from '../../chat.members';
import { liveCardWhere } from '../../chat.scope';
import { resolveEntities, type EntityOption } from '../chat.v2.entities';
import type { ExecutionContext } from '../chat.v2.scope';
import { dueIso, formatDueDate, startIso, vnDayOfIso, type DueGrounding } from './actions.dates';
import { bestAssignee, splitUnassigned } from './actions.assign';
import { refSignature, type SlotKind } from './actions.refs';
import { descriptionHash } from './actions.plan';
import { dedupeRuleActions, findSameRule, ruleNameOf, sameRuleText, thenText, whenText } from './actions.rule';
import { MAX_OPS_PER_PLAN, type ActionOp, type MemberRef, type Ref } from './actions.schema';
import { handlerOf } from './ops/ops.registry';
import type { ResolveCtx } from './ops/ops.types';
import { foldWords, stripLeadingGeneric } from './actions.text';
import type { ActionErrorCode, AssignChoice, PendingChoice, StoredOp, StoredRuleAction } from './actions.types';

/** Toi da bay nhieu nut chon; nhieu hon thi bao nguoi dung neu ro hon (khong cat danh sach am tham). */
export const MAX_CHOICES = 8;

/** dau van tay tham chieu -> id da chot (nut chon hoac "no" da hieu). */
export type Presets = Record<string, string>;

export interface LocalEntity {
  kind: 'LIST' | 'CARD';
  name: string;
}

interface Hit {
  id: string;
  name: string;
  parentName?: string;
  /** Co: thuc the do chinh ke hoach tao (id = key cua thao tac tao). */
  local?: string;
}
export type Outcome = { kind: 'ONE'; hit: Hit } | { kind: 'MANY'; hits: Hit[] } | { kind: 'NONE'; text: string };

export interface ResolveEnv {
  userId: string;
  exec: ExecutionContext;
  boardId: string;
  /** session.bindings (da kiem lai quyen o dau luot). */
  bindings: readonly EntityOption[];
  /** Chi SET_CARD_DUE: ngay da hieu tu cau cua nguoi dung. */
  due?: DueGrounding;
  /** Thuc the do chinh ke hoach tao: key -> ten (de hien thi + de biet tham chieu PLAN hop le). */
  local?: ReadonlyMap<string, LocalEntity>;
  /** Nho ket qua tim theo dau van tay trong MOT lan dung ke hoach. */
  cache?: Map<string, Outcome>;
  /** Cac "no / the vua roi" da hieu thanh id: ghi vao ke hoach de dung lai khong can phien. */
  pins?: Record<string, string>;
  /** Thoi diem LAP ke hoach (khi dung lai luc ap dung: createdAt) - de goi y / chia viec tai lap dung ket qua; mac dinh exec.now. */
  planNow?: Date;
  /** Phase 6: so thao tac toi da mot ASSIGN_UNASSIGNED duoc khai trien thanh (gioi han so thao tac cua ke hoach). */
  splitRoom?: number;
  /** Board Patch: cot MOI la cot tu do (khong doan trang thai theo ten, de the do AI tao khong bi gan trang thai bat ngo). */
  freeLists?: boolean;
  /** Buoc G: cac tep tam nguoi dung dinh kem vao tin nhan. */
  uploads?: readonly { id: string; name: string; size: number; ext: string }[];
}

export type ResolveResult =
  | { kind: 'OK'; op: StoredOp; /** thao tac khai trien them (ASSIGN_UNASSIGNED -> nhieu ASSIGN_MEMBER) */ more?: StoredOp[]; warnings: string[] }
  | { kind: 'CHOICE'; pending: PendingChoice }
  | { kind: 'FAIL'; code: ActionErrorCode; text: string };

const WHAT: Record<SlotKind, string> = { card: 'thẻ', list: 'cột', member: 'thành viên', label: 'nhãn' };

function fromOptions(options: readonly EntityOption[], text: string): Outcome {
  if (options.length === 0) return { kind: 'NONE', text };
  const hits = options.map((o) => ({ id: o.id, name: o.name, parentName: o.parentName }));
  return hits.length === 1 ? { kind: 'ONE', hit: hits[0] } : { kind: 'MANY', hits };
}

/** Tim theo ten; khong thay thi thu lai sau khi bo tu chung o dau ("task Login" -> "Login"). */
async function byName(exec: ExecutionContext, kind: EntityOption['kind'], text: string): Promise<Outcome> {
  const first = await resolveEntities(exec, kind, text);
  if (first.status !== 'NOT_FOUND') return fromOptions(first.options, text);
  const stripped = stripLeadingGeneric(text);
  if (stripped !== '' && stripped !== text) {
    const second = await resolveEntities(exec, kind, stripped);
    if (second.status !== 'NOT_FOUND') return fromOptions(second.options, text);
  }
  return { kind: 'NONE', text };
}

const CARD_SELECT = {
  id: true,
  title: true,
  description: true,
  startDate: true,
  dueDate: true,
  status: true,
  listId: true,
  list: { select: { id: true, name: true, boardId: true } },
  members: { select: { userId: true } },
  labels: { select: { labelId: true } },
} as const;

async function loadCard(env: ResolveEnv, id: string) {
  return prisma.card.findFirst({ where: { AND: [liveCardWhere(env.exec.scope.boardWhere), { id }] }, select: CARD_SELECT });
}

async function loadList(env: ResolveEnv, id: string): Promise<Hit | null> {
  const l = await prisma.list.findFirst({
    where: { id, boardId: env.boardId, deletedAt: null, archivedAt: null },
    select: { id: true, name: true },
  });
  return l ? { id: l.id, name: l.name } : null;
}

function binding(env: ResolveEnv, kind: EntityOption['kind']): EntityOption | undefined {
  return env.bindings.find((b) => b.kind === kind);
}

async function locateCard(env: ResolveEnv, ref: Ref, preset?: string): Promise<Outcome> {
  if (preset !== undefined) {
    const c = await loadCard(env, preset);
    return c ? { kind: 'ONE', hit: { id: c.id, name: c.title } } : { kind: 'NONE', text: 'thẻ đã chọn' };
  }
  if (ref.by === 'CONTEXT') {
    const b = binding(env, 'CARD');
    const c = b ? await loadCard(env, b.id) : null;
    return c ? { kind: 'ONE', hit: { id: c.id, name: c.title } } : { kind: 'NONE', text: 'thẻ vừa nhắc' };
  }
  if (ref.by !== 'TEXT') return { kind: 'NONE', text: 'thẻ' };
  const out = await byName(env.exec, 'CARD', ref.text);
  if (out.kind !== 'MANY') return out;
  // phan biet hai the cung ten bang TEN COT chua chung
  const rows = await prisma.card.findMany({ where: { id: { in: out.hits.map((h) => h.id) } }, select: { id: true, list: { select: { name: true } } } });
  const listOf = new Map(rows.map((r) => [r.id, r.list.name]));
  return { kind: 'MANY', hits: out.hits.map((h) => ({ id: h.id, name: h.name, parentName: listOf.get(h.id) })) };
}

async function locateList(env: ResolveEnv, ref: Ref | undefined, preset?: string): Promise<Outcome> {
  if (preset !== undefined) {
    const l = await loadList(env, preset);
    return l ? { kind: 'ONE', hit: l } : { kind: 'NONE', text: 'cột đã chọn' };
  }
  if (ref === undefined) {
    // khong noi cot: bang co dung 1 cot thi dung no, nhieu cot thi hoi
    const lists = await prisma.list.findMany({
      where: { boardId: env.boardId, deletedAt: null, archivedAt: null },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true },
      take: MAX_CHOICES + 1,
    });
    if (lists.length === 0) return { kind: 'NONE', text: 'cột nào' };
    return lists.length === 1 ? { kind: 'ONE', hit: lists[0] } : { kind: 'MANY', hits: lists };
  }
  if (ref.by === 'CONTEXT') {
    const b = binding(env, 'COLUMN');
    const l = b ? await loadList(env, b.id) : null;
    return l ? { kind: 'ONE', hit: l } : { kind: 'NONE', text: 'cột vừa nhắc' };
  }
  if (ref.by !== 'TEXT') return { kind: 'NONE', text: 'cột' };
  const named = await byName(env.exec, 'COLUMN', ref.text);
  if (named.kind !== 'NONE') return named;
  // "Dang lam" khi cot ten la "In Progress": khop theo TRANG THAI cua cot
  const status = guessListStatus(ref.text) ?? guessListStatus(stripLeadingGeneric(ref.text));
  if (status === null) return named;
  const lists = await prisma.list.findMany({
    where: { boardId: env.boardId, status, deletedAt: null, archivedAt: null },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true },
  });
  if (lists.length === 0) return named;
  return lists.length === 1 ? { kind: 'ONE', hit: lists[0] } : { kind: 'MANY', hits: lists };
}

async function locateMember(env: ResolveEnv, ref: Ref, preset?: string): Promise<Outcome> {
  const person = (id: string): Outcome => {
    const m = env.exec.roster.find((r) => r.userId === id);
    return m ? { kind: 'ONE', hit: { id: m.userId, name: m.name } } : { kind: 'NONE', text: 'thành viên' };
  };
  if (preset !== undefined) return person(preset);
  if (ref.by === 'SELF') return person(env.userId);
  if (ref.by === 'CONTEXT') {
    const b = binding(env, 'MEMBER');
    return b ? person(b.id) : { kind: 'NONE', text: 'người vừa nhắc' };
  }
  if (ref.by !== 'TEXT') return { kind: 'NONE', text: 'thành viên' };
  if (isSelfReference(ref.text)) return person(env.userId);
  return byName(env.exec, 'MEMBER', ref.text);
}

async function locateLabel(env: ResolveEnv, ref: Ref, preset?: string): Promise<Outcome> {
  if (preset !== undefined) {
    const l = await prisma.label.findFirst({ where: { id: preset, boardId: env.boardId }, select: { id: true, name: true } });
    return l ? { kind: 'ONE', hit: l } : { kind: 'NONE', text: 'nhãn đã chọn' };
  }
  if (ref.by !== 'TEXT') return { kind: 'NONE', text: 'nhãn' };
  return byName(env.exec, 'LABEL', ref.text);
}

/** Tim mot tham chieu CO SAN, co nho theo dau van tay. */
async function findExisting(env: ResolveEnv, kind: SlotKind, ref: Ref | undefined, presets: Presets): Promise<{ sig: string; out: Outcome }> {
  const sig = refSignature(kind, ref) as string;
  const seen = env.cache?.get(sig);
  if (seen) return { sig, out: seen };
  const preset = presets[sig];
  let out: Outcome;
  if (kind === 'card') out = await locateCard(env, ref as Ref, preset);
  else if (kind === 'list') out = await locateList(env, ref, preset);
  else if (kind === 'member') out = await locateMember(env, ref as Ref, preset);
  else out = await locateLabel(env, ref as Ref, preset);
  // "no / the vua roi" da hieu: ghim thanh id de lan dung lai ke hoach khong phu thuoc phien
  if (out.kind === 'ONE' && ref?.by === 'CONTEXT' && env.pins) env.pins[sig] = out.hit.id;
  env.cache?.set(sig, out);
  return { sig, out };
}

const isResult = (x: Hit | ResolveResult): x is ResolveResult => 'kind' in x;
const textOf = (ref: Ref | undefined): string => (ref !== undefined && ref.by === 'TEXT' ? ref.text : '');

/** Mot tham chieu -> mot Hit, hoac mot ket qua dung som (nut chon / loi). */
async function pick(env: ResolveEnv, kind: SlotKind, ref: MemberRef | undefined, presets: Presets): Promise<Hit | ResolveResult> {
  if (ref?.by === 'PLAN') {
    const made = env.local?.get(ref.key);
    if (!made || made.kind !== (kind === 'list' ? 'LIST' : 'CARD')) {
      return { kind: 'FAIL', code: 'INVALID_PLAN', text: `Tham chiếu “${ref.key}” không trỏ tới ${WHAT[kind]} nào được tạo trong kế hoạch. Chưa thay đổi gì.` };
    }
    return { id: ref.key, name: made.name, local: ref.key };
  }
  // {by:BEST} chi hop le o member cua ASSIGN_MEMBER va da duoc xu ly ngay trong resolveOp; o day la loi cau truc
  if (ref?.by === 'BEST') return { kind: 'FAIL', code: 'INVALID', text: 'Chỉ có thể nhờ chọn “người phù hợp nhất” khi giao người cho thẻ. Chưa thay đổi gì.' };
  const { sig, out } = await findExisting(env, kind, ref, presets);
  if (out.kind === 'ONE') return out.hit;
  const text = textOf(ref);
  if (out.kind === 'NONE') {
    return { kind: 'FAIL', code: 'NOT_FOUND', text: `Không tìm thấy ${WHAT[kind]} “${out.text === '' ? text : out.text}” trong bảng này. Chưa thay đổi gì.` };
  }
  if (out.hits.length > MAX_CHOICES) {
    const which = text === '' ? `Hãy nói rõ tên ${WHAT[kind]}` : `Có ${out.hits.length} ${WHAT[kind]} khớp “${text}”. Hãy nêu rõ hơn (thêm tên đầy đủ)`;
    return { kind: 'FAIL', code: 'AMBIGUOUS', text: `${which}. Chưa thay đổi gì.` };
  }
  return {
    kind: 'CHOICE',
    pending: { sig, kind, text, options: out.hits.map((h) => ({ id: h.id, label: h.parentName ? `${h.name} · ${h.parentName}` : h.name })) },
  };
}

type CardRow = NonNullable<Awaited<ReturnType<typeof loadCard>>>;
interface CardTarget {
  ids: { card?: string };
  local?: { card: string };
  title: string;
  row: CardRow | null;
}
type ListTarget = { ids: { list?: string }; local?: { list: string }; name: string };

async function cardTarget(env: ResolveEnv, ref: Ref, presets: Presets): Promise<CardTarget | ResolveResult> {
  const hit = await pick(env, 'card', ref, presets);
  if (isResult(hit)) return hit;
  if (hit.local !== undefined) return { ids: {}, local: { card: hit.local }, title: hit.name, row: null };
  const row = await loadCard(env, hit.id);
  if (!row) return { kind: 'FAIL', code: 'NOT_FOUND', text: 'Thẻ không còn tồn tại. Chưa thay đổi gì.' };
  return { ids: { card: row.id }, title: row.title, row };
}

async function listTarget(env: ResolveEnv, ref: Ref | undefined, presets: Presets): Promise<ListTarget | ResolveResult> {
  const hit = await pick(env, 'list', ref, presets);
  if (isResult(hit)) return hit;
  return hit.local !== undefined ? { ids: {}, local: { list: hit.local }, name: hit.name } : { ids: { list: hit.id }, name: hit.name };
}

const isFail = (x: object): x is ResolveResult => 'kind' in x;

/** Cac cot cua the / cot tao moi: chi them khoa khi co gia tri that (khong de `undefined` lot vao JSON luu). */
const localOf = (card?: { card: string }, list?: { list: string }): Pick<StoredOp, 'local'> =>
  card || list ? { local: { ...(card ?? {}), ...(list ?? {}) } } : {};

/**
 * Phan giai mot thao tac. `presets` = cac id da chot theo dau van tay (nut chon / "no" da ghim); chung van duoc kiem lai con ton tai
 * trong bang. Tra CHOICE khi con MOT tham chieu nhap nhang (hoi tung cai mot), FAIL khi khong tim thay / qua nhieu.
 */
export async function resolveOp(env: ResolveEnv, symbolic: ActionOp, presets: Presets = {}): Promise<ResolveResult> {
  const warnings: string[] = [];
  const ok = (op: StoredOp): ResolveResult => ({ kind: 'OK', warnings, op });
  const key = 'key' in symbolic && symbolic.key !== undefined ? { key: symbolic.key } : {};

  switch (symbolic.type) {
    case 'CREATE_LIST': {
      const name = symbolic.name.trim();
      const taken = await prisma.list.findMany({ where: { boardId: env.boardId, deletedAt: null, archivedAt: null }, select: { name: true } });
      const folded = foldWords(name).join(' ');
      if (taken.some((l) => foldWords(l.name).join(' ') === folded)) {
        return { kind: 'FAIL', code: 'CONFLICT', text: `Bảng đã có cột “${name}”. Hãy dùng tên khác, hoặc nhờ mình thêm thẻ vào cột đã có. Chưa thay đổi gì.` };
      }
      // doan trang thai theo ten, GIONG tao cot bang tay (createList): "Hoan thanh" -> DONE, "Kiem thu" -> Cho duyet...
      return ok({ type: 'CREATE_LIST', ...key, ids: {}, params: { name, listStatus: env.freeLists === true ? null : guessListStatus(name) }, before: null, display: { listName: name } });
    }
    case 'CREATE_CARD': {
      const list = await listTarget(env, symbolic.list, presets);
      if (isFail(list)) return list;
      const title = symbolic.title.trim();
      if (list.ids.list !== undefined) {
        const same = await prisma.card.count({ where: { listId: list.ids.list, title, deletedAt: null, archivedAt: null } });
        if (same > 0) warnings.push(`Cột “${list.name}” đã có thẻ “${title}”; mình vẫn tạo thẻ mới cùng tên.`);
      }
      return ok({ type: 'CREATE_CARD', ...key, ids: list.ids, ...localOf(undefined, list.local), params: { title }, before: null, display: { listName: list.name } });
    }
    case 'RENAME_CARD': {
      const card = await cardTarget(env, symbolic.card, presets);
      if (isFail(card)) return card;
      const title = symbolic.title.trim();
      return ok({
        type: 'RENAME_CARD',
        ids: card.ids,
        ...localOf(card.local),
        params: { title },
        before: { title: card.title },
        display: { cardTitle: card.title },
        ...(card.row !== null && title === card.row.title ? { noop: `Thẻ “${card.title}” đã có tên này rồi nên chưa cần đổi.` } : {}),
      });
    }
    case 'SET_CARD_DUE': {
      const card = await cardTarget(env, symbolic.card, presets);
      if (isFail(card)) return card;
      const resolution = env.due?.resolution;
      if (resolution === undefined || resolution.kind === 'INVALID') {
        return { kind: 'FAIL', code: 'INVALID', text: 'Ngày hạn không hợp lệ. Chưa thay đổi gì.' };
      }
      if (env.due?.llmDiffers) warnings.push('Ngày hạn được lấy theo đúng câu của bạn (khác với ngày AI đề xuất).');
      const before = card.row?.dueDate ? card.row.dueDate.toISOString() : null;
      const due = resolution.kind === 'CLEAR' ? null : dueIso(resolution.date);
      let noop: string | undefined;
      if (card.row !== null) {
        if (due === null && before === null) noop = `Thẻ “${card.title}” chưa có hạn nên không cần bỏ.`;
        else if (due !== null && before !== null && vnDayOfIso(before) === vnDayOfIso(due)) {
          noop = `Hạn của thẻ “${card.title}” đã là ${formatDueDate(vnDayOfIso(due))} rồi.`;
        }
      }
      return ok({ type: 'SET_CARD_DUE', ids: card.ids, ...localOf(card.local), params: { due }, before: { due: before }, display: { cardTitle: card.title }, ...(noop !== undefined ? { noop } : {}) });
    }
    case 'MOVE_CARD': {
      const card = await cardTarget(env, symbolic.card, presets);
      if (isFail(card)) return card;
      const list = await listTarget(env, symbolic.toList, presets);
      if (isFail(list)) return list;
      return ok({
        type: 'MOVE_CARD',
        ids: { ...card.ids, ...list.ids },
        ...localOf(card.local, list.local),
        params: {},
        before: card.row ? { listId: card.row.listId, listName: card.row.list.name } : null,
        display: { cardTitle: card.title, toListName: list.name },
        ...(card.row !== null && list.ids.list !== undefined && card.row.listId === list.ids.list ? { noop: `Thẻ “${card.title}” đã ở cột “${list.name}” rồi.` } : {}),
      });
    }
    case 'SET_CARD_STATUS': {
      const card = await cardTarget(env, symbolic.card, presets);
      if (isFail(card)) return card;
      return ok({
        type: 'SET_CARD_STATUS',
        ids: card.ids,
        ...localOf(card.local),
        params: { status: symbolic.status },
        before: card.row ? { status: card.row.status, listId: card.row.listId, listName: card.row.list.name } : null,
        display: { cardTitle: card.title },
        ...(card.row !== null && card.row.status === symbolic.status ? { noop: `Thẻ “${card.title}” đã ở trạng thái này rồi.` } : {}),
      });
    }
    case 'ASSIGN_MEMBER': {
      const card = await cardTarget(env, symbolic.card, presets);
      if (isFail(card)) return card;
      let member: Hit;
      let choice: AssignChoice | undefined;
      if (symbolic.member.by === 'BEST') {
        // Phase 6: "nguoi phu hop nhat" do MAY chon bang module goi y phan cong; chi lam mot lan (ghim id) roi dung lai khi ap dung
        if (card.row === null) return { kind: 'FAIL', code: 'INVALID', text: 'Thẻ vừa tạo trong cùng lệnh chưa có lịch sử nên mình chưa gợi ý người phù hợp được. Hãy nêu tên người. Chưa thay đổi gì.' };
        const pinKey = `member:best:${card.row.id}`;
        const pinned = presets[pinKey];
        if (pinned !== undefined) {
          const known = env.exec.roster.find((r) => r.userId === pinned);
          if (!known) return { kind: 'FAIL', code: 'NOT_FOUND', text: 'Người được gợi ý lúc xem trước không còn trong phạm vi bảng. Chưa thay đổi gì.' };
          member = { id: known.userId, name: known.name };
        } else {
          const best = await bestAssignee({ userId: env.userId, cardId: card.row.id, now: env.planNow ?? env.exec.now });
          if (!best.ok) return { kind: 'FAIL', code: best.code, text: best.text };
          member = { id: best.pick.userId, name: best.pick.name };
          choice = best.pick.choice;
          if (env.pins) env.pins[pinKey] = member.id;
        }
      } else {
        const picked = await pick(env, 'member', symbolic.member, presets);
        if (isResult(picked)) return picked;
        member = picked;
      }
      const already = card.row?.members.some((m) => m.userId === member.id) ?? false;
      return ok({
        type: 'ASSIGN_MEMBER',
        ids: { ...card.ids, member: member.id },
        ...localOf(card.local),
        params: {},
        before: { alreadyAssigned: already },
        display: { cardTitle: card.title, memberName: member.name },
        ...(choice !== undefined ? { choice } : {}),
        ...(already ? { noop: `${member.name} đã được giao thẻ “${card.title}” rồi.` } : {}),
      });
    }
    case 'ASSIGN_UNASSIGNED': {
      const list = await listTarget(env, symbolic.list, presets);
      if (isFail(list)) return list;
      if (list.ids.list === undefined) return { kind: 'FAIL', code: 'INVALID', text: 'Cột mới tạo trong cùng lệnh chưa có việc nào để chia. Chưa thay đổi gì.' };
      const split = await splitUnassigned({ userId: env.userId, listId: list.ids.list, now: env.planNow ?? env.exec.now, room: env.splitRoom ?? MAX_OPS_PER_PLAN });
      if (!split.ok) return { kind: 'FAIL', code: split.code, text: split.text };
      if (split.ops.length === 0) {
        return { kind: 'FAIL', code: 'NO_CHANGE', text: split.totalUnassigned === 0 ? `Cột “${list.name}” không có việc nào chưa có người nhận. Chưa thay đổi gì.` : 'Không ai đủ điều kiện nhận việc lúc này (mọi người đang tạm nghỉ). Chưa thay đổi gì.' };
      }
      if (split.cut > 0 || split.truncated) warnings.push(`Cột “${list.name}” có ${split.totalUnassigned} việc chưa có người nhận; mình chỉ chia ${split.ops.length} việc gấp nhất (tối đa ${env.splitRoom ?? MAX_OPS_PER_PLAN} mỗi lần). Gửi lại lệnh để chia phần còn lại.`);
      if (split.noOne > 0) warnings.push(`${split.noOne} việc chưa chia được vì không ai đủ điều kiện nhận (đang tạm nghỉ).`);
      const [first, ...rest] = split.ops;
      return { kind: 'OK', op: first, more: rest, warnings };
    }
    case 'CREATE_AUTOMATION_RULE': {
      // Phase 7: luat chi nham vao cot / nhan / nguoi CO SAN cua bang; ten luat do SERVER dung tu ten da phan giai (khong lay chu cua mo hinh)
      if (symbolic.trigger === 'CARD_MOVED_TO_LIST' && symbolic.list === undefined) {
        return { kind: 'FAIL', code: 'INVALID', text: 'Luật “khi thẻ được chuyển vào cột” cần nói rõ là cột nào. Chưa thay đổi gì.' };
      }
      let list: { id: string; name: string } | undefined;
      if (symbolic.list !== undefined) {
        const target = await listTarget(env, symbolic.list, presets);
        if (isFail(target)) return target;
        if (target.ids.list === undefined) return { kind: 'FAIL', code: 'INVALID', text: 'Luật chỉ nhắm vào cột đã có trong bảng. Chưa thay đổi gì.' };
        list = { id: target.ids.list, name: target.name };
      }
      const labelNames = new Map<string, string>();
      const memberNames = new Map<string, string>();
      const drafted: StoredRuleAction[] = [];
      for (const a of symbolic.actions) {
        if (a.type === 'SET_DONE') {
          drafted.push({ type: 'SET_DONE', done: a.done ?? true });
        } else if (a.type === 'ADD_LABEL') {
          const label = await pick(env, 'label', a.label, presets);
          if (isResult(label)) return label;
          labelNames.set(label.id, label.name);
          drafted.push({ type: 'ADD_LABEL', labelId: label.id });
        } else {
          const member = await pick(env, 'member', a.member, presets);
          if (isResult(member)) return member;
          memberNames.set(member.id, member.name);
          drafted.push({ type: 'ASSIGN_MEMBER', userId: member.id });
        }
      }
      if (drafted.some((a) => a.type === 'SET_DONE' && a.done === true) && drafted.some((a) => a.type === 'SET_DONE' && a.done === false)) {
        return { kind: 'FAIL', code: 'CONFLICT', text: 'Luật vừa đánh dấu hoàn thành vừa mở lại thẻ nên mâu thuẫn. Hãy chọn một. Chưa thay đổi gì.' };
      }
      const { actions, dropped } = dedupeRuleActions(drafted);
      if (dropped > 0) warnings.push(`Đã bỏ ${dropped} việc trùng lặp trong luật.`);
      const when = whenText(symbolic.trigger, list?.name);
      const then = actions.map((a) => thenText(a, { label: a.labelId !== undefined ? labelNames.get(a.labelId) : undefined, member: a.userId !== undefined ? memberNames.get(a.userId) : undefined }));
      const existing = await findSameRule(prisma, env.boardId, { trigger: symbolic.trigger, listId: list?.id ?? null, actions });
      return ok({
        type: 'CREATE_AUTOMATION_RULE',
        ids: list ? { list: list.id } : {},
        params: { rule: { trigger: symbolic.trigger, name: ruleNameOf(when, then), actions } },
        before: null,
        display: { ...(list ? { listName: list.name } : {}), ruleWhen: when, ruleThen: then },
        ...(existing !== null ? { noop: sameRuleText(existing) } : {}),
      });
    }
    case 'SET_CARD_DESCRIPTION': {
      const card = await cardTarget(env, symbolic.card, presets);
      if (isFail(card)) return card;
      const description = symbolic.description.trim();
      const current = card.row?.description ?? '';
      return ok({
        type: 'SET_CARD_DESCRIPTION',
        ids: card.ids,
        ...localOf(card.local),
        params: { description },
        before: card.row ? { descriptionHash: descriptionHash(current), descriptionLength: current.trim().length } : null,
        display: { cardTitle: card.title },
        ...(card.row !== null && current.trim() === description ? { noop: `Mô tả của thẻ “${card.title}” đã đúng nội dung này rồi.` } : {}),
      });
    }
    case 'SET_CARD_START': {
      const card = await cardTarget(env, symbolic.card, presets);
      if (isFail(card)) return card;
      const resolution = env.due?.resolution;
      if (resolution === undefined || resolution.kind === 'INVALID') return { kind: 'FAIL', code: 'INVALID', text: 'Ngày bắt đầu không hợp lệ. Chưa thay đổi gì.' };
      if (env.due?.llmDiffers) warnings.push('Ngày bắt đầu được lấy theo đúng câu của bạn (khác với ngày AI đề xuất).');
      const before = card.row?.startDate ? card.row.startDate.toISOString() : null;
      const start = resolution.kind === 'CLEAR' ? null : startIso(resolution.date);
      let noop: string | undefined;
      if (card.row !== null) {
        if (start === null && before === null) noop = `Thẻ “${card.title}” chưa có ngày bắt đầu nên không cần bỏ.`;
        else if (start !== null && before !== null && vnDayOfIso(before) === vnDayOfIso(start)) noop = `Ngày bắt đầu của thẻ “${card.title}” đã là ${formatDueDate(vnDayOfIso(start))} rồi.`;
        else if (start !== null && card.row.dueDate !== null && Date.parse(start) > card.row.dueDate.getTime()) warnings.push(`Ngày bắt đầu sau hạn hiện tại của thẻ “${card.title}” (${formatDueDate(vnDayOfIso(card.row.dueDate.toISOString()))}).`);
      }
      return ok({ type: 'SET_CARD_START', ids: card.ids, ...localOf(card.local), params: { start }, before: { start: before }, display: { cardTitle: card.title }, ...(noop !== undefined ? { noop } : {}) });
    }
    case 'ADD_COMMENT': {
      const card = await cardTarget(env, symbolic.card, presets);
      if (isFail(card)) return card;
      return ok({ type: 'ADD_COMMENT', ids: card.ids, ...localOf(card.local), params: { text: symbolic.text.trim() }, before: null, display: { cardTitle: card.title } });
    }
    case 'ADD_CHECKLIST': {
      const card = await cardTarget(env, symbolic.card, presets);
      if (isFail(card)) return card;
      const items = symbolic.items.map((i) => i.trim()).filter((i) => i !== '');
      if (items.length === 0) return { kind: 'FAIL', code: 'INVALID', text: 'Checklist cần ít nhất một mục. Chưa thay đổi gì.' };
      const title = symbolic.title?.trim();
      return ok({ type: 'ADD_CHECKLIST', ids: card.ids, ...localOf(card.local), params: { items, ...(title ? { title } : {}) }, before: null, display: { cardTitle: card.title } });
    }
    case 'REMOVE_MEMBER': {
      const card = await cardTarget(env, symbolic.card, presets);
      if (isFail(card)) return card;
      const member = await pick(env, 'member', symbolic.member, presets);
      if (isResult(member)) return member;
      const already = card.row?.members.some((m) => m.userId === member.id) ?? false;
      return ok({
        type: 'REMOVE_MEMBER',
        ids: { ...card.ids, member: member.id },
        ...localOf(card.local),
        params: {},
        before: { alreadyAssigned: already },
        display: { cardTitle: card.title, memberName: member.name },
        ...(!already ? { noop: `${member.name} chưa được giao thẻ “${card.title}” nên chưa cần bỏ.` } : {}),
      });
    }
    case 'REMOVE_LABEL': {
      const card = await cardTarget(env, symbolic.card, presets);
      if (isFail(card)) return card;
      const label = await pick(env, 'label', symbolic.label, presets);
      if (isResult(label)) return label;
      const already = card.row?.labels.some((l) => l.labelId === label.id) ?? false;
      return ok({
        type: 'REMOVE_LABEL',
        ids: { ...card.ids, label: label.id },
        ...localOf(card.local),
        params: {},
        before: { alreadyLabeled: already },
        display: { cardTitle: card.title, labelName: label.name },
        ...(!already ? { noop: `Thẻ “${card.title}” chưa có nhãn “${label.name}” nên chưa cần gỡ.` } : {}),
      });
    }
    case 'RENAME_LIST': {
      const list = await listTarget(env, symbolic.list, presets);
      if (isFail(list)) return list;
      if (list.ids.list === undefined) return { kind: 'FAIL', code: 'INVALID', text: 'Cột mới tạo trong cùng lệnh không cần đổi tên (hãy đặt đúng tên khi tạo). Chưa thay đổi gì.' };
      const name = symbolic.name.trim();
      const lists = await prisma.list.findMany({ where: { boardId: env.boardId, deletedAt: null, archivedAt: null }, select: { id: true, name: true } });
      const current = lists.find((l) => l.id === list.ids.list);
      if (!current) return { kind: 'FAIL', code: 'NOT_FOUND', text: 'Cột này không còn trong bảng. Chưa thay đổi gì.' };
      const folded = foldWords(name).join(' ');
      if (lists.some((l) => l.id !== current.id && foldWords(l.name).join(' ') === folded)) {
        return { kind: 'FAIL', code: 'CONFLICT', text: `Bảng đã có cột “${name}”. Hãy dùng tên khác. Chưa thay đổi gì.` };
      }
      return ok({
        type: 'RENAME_LIST',
        ids: { list: current.id },
        params: { name },
        before: { listName: current.name },
        display: { listName: current.name },
        ...(current.name === name ? { noop: `Cột “${name}” đã có tên này rồi nên chưa cần đổi.` } : {}),
      });
    }
    case 'ARCHIVE_CARD': {
      const card = await cardTarget(env, symbolic.card, presets);
      if (isFail(card)) return card;
      if (card.local !== undefined) return { kind: 'FAIL', code: 'INVALID', text: 'Thẻ mới tạo trong cùng lệnh không cần lưu trữ. Chưa thay đổi gì.' };
      return ok({ type: 'ARCHIVE_CARD', ids: card.ids, params: {}, before: card.row ? { listId: card.row.listId, listName: card.row.list.name } : null, display: { cardTitle: card.title } });
    }
    case 'ADD_LABEL': {
      const card = await cardTarget(env, symbolic.card, presets);
      if (isFail(card)) return card;
      const label = await pick(env, 'label', symbolic.label, presets);
      if (isResult(label)) return label;
      const already = card.row?.labels.some((l) => l.labelId === label.id) ?? false;
      return ok({
        type: 'ADD_LABEL',
        ids: { ...card.ids, label: label.id },
        ...localOf(card.local),
        params: {},
        before: { alreadyLabeled: already },
        display: { cardTitle: card.title, labelName: label.name },
        ...(already ? { noop: `Thẻ “${card.title}” đã có nhãn “${label.name}” rồi.` } : {}),
      });
    }
    default: {
      // thao tac mo rong (actions/ops): moi nhom tu phan giai, dung ham tro giup cua bo phan giai nay
      const handler = handlerOf(symbolic.type);
      if (!handler) return { kind: 'FAIL', code: 'INVALID', text: 'Thao tác này chưa được trợ lý hỗ trợ. Chưa thay đổi gì.' };
      const rc: ResolveCtx = {
        warnings,
        ok: (op, more) => ({ kind: 'OK', op, ...(more !== undefined ? { more } : {}), warnings }),
        h: {
          cardTarget: (ref) => cardTarget(env, ref, presets),
          listTarget: (ref) => listTarget(env, ref, presets),
          pick: (kind, ref) => pick(env, kind, ref, presets),
          preset: (sig) => presets[sig],
          boardId: env.boardId,
          userId: env.userId,
          exec: env.exec,
          bindings: env.bindings,
          now: env.planNow ?? env.exec.now,
          ...(env.due !== undefined ? { due: env.due } : {}),
          uploads: env.uploads ?? [],
        },
      };
      return handler.resolve(rc, symbolic);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Ca ke hoach
// ---------------------------------------------------------------------------------------------------------------------

export type ResolveOpsResult =
  | { kind: 'OK'; ops: StoredOp[]; warnings: string[]; pins: Record<string, string> }
  | { kind: 'CHOICE'; pending: PendingChoice; pins: Record<string, string> }
  | { kind: 'FAIL'; code: ActionErrorCode; text: string; ops: StoredOp[] };

/** Thao tac nao KHONG duoc xuat hien hai lan tren cung mot the (hai gia tri khac nhau se mau thuan). */
const EXCLUSIVE: Partial<Record<StoredOp['type'], string>> = {
  RENAME_CARD: 'đổi tên',
  SET_CARD_DUE: 'đổi hạn',
  MOVE_CARD: 'chuyển cột',
  SET_CARD_STATUS: 'đổi trạng thái',
  SET_CARD_DESCRIPTION: 'đổi mô tả',
  SET_CARD_START: 'đổi ngày bắt đầu',
};
/** Cap thao tac doi nghich nhau tren CUNG mot the + cung mot nguoi / nhan: khong the vua giao vua bo. */
const OPPOSITE: Partial<Record<StoredOp['type'], StoredOp['type']>> = { ASSIGN_MEMBER: 'REMOVE_MEMBER', REMOVE_MEMBER: 'ASSIGN_MEMBER', ADD_LABEL: 'REMOVE_LABEL', REMOVE_LABEL: 'ADD_LABEL' };

const cardKeyOf = (op: StoredOp): string | undefined => op.ids.card ?? (op.local?.card !== undefined ? `local:${op.local.card}` : undefined);

/** Doi tuong CO SAN ma mot thao tac tac dong (de tim mau thuan: xoa / luu tru roi lai sua). Thao tac mo rong tu khai bao; thao tac cu suy ra tu the cua no. */
function targetsOf(op: StoredOp): { key: string; effect: 'MODIFY' | 'REMOVE' }[] {
  const handler = handlerOf(op.type);
  if (handler?.targets !== undefined) return handler.targets(op);
  if (handler !== undefined) return [];
  return op.ids.card !== undefined ? [{ key: `card:${op.ids.card}`, effect: op.type === 'ARCHIVE_CARD' ? 'REMOVE' : 'MODIFY' }] : [];
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Hai thao tac mau thuan tren cung mot the -> loi; thao tac TRUNG HET (cung the, cung gia tri / nguoi / nhan) -> bo thao tac sau.
 * Ham thuan tren cac thao tac da phan giai (the do ke hoach tao duoc nhan dien bang key).
 */
export function dedupeOps(ops: readonly StoredOp[]): { ok: true; ops: StoredOp[]; dropped: number } | { ok: false; text: string } {
  const kept: StoredOp[] = [];
  let dropped = 0;
  for (const [i, op] of ops.entries()) {
    const card = cardKeyOf(op);
    let duplicate = false;
    if (op.type === 'RENAME_LIST') {
      const prior = kept.find((k) => k.type === 'RENAME_LIST' && k.ids.list === op.ids.list);
      if (prior !== undefined) {
        if (same(prior.params, op.params)) duplicate = true;
        else return { ok: false, text: `Có hai tên mới khác nhau cho cột “${op.display.listName ?? 'này'}” (thao tác ${kept.indexOf(prior) + 1} và ${i + 1}). Hãy nói rõ một tên. Chưa thay đổi gì.` };
      }
    }
    if (card !== undefined) {
      for (const [j, prior] of kept.entries()) {
        if (cardKeyOf(prior) !== card) continue;
        const title = op.display.cardTitle ?? 'này';
        if (EXCLUSIVE[op.type] !== undefined && prior.type === op.type) {
          if (same(prior.params, op.params) && same(prior.ids, op.ids)) duplicate = true;
          else return { ok: false, text: `Có hai thao tác ${EXCLUSIVE[op.type]} khác nhau cho thẻ “${title}” (thao tác ${j + 1} và ${i + 1}). Hãy nói rõ một giá trị. Chưa thay đổi gì.` };
        }
        if ((op.type === 'MOVE_CARD' && prior.type === 'SET_CARD_STATUS') || (op.type === 'SET_CARD_STATUS' && prior.type === 'MOVE_CARD')) {
          return { ok: false, text: `Thẻ “${title}” vừa được chuyển cột vừa được đổi trạng thái (thao tác ${j + 1} và ${i + 1}) và hai việc này ảnh hưởng lẫn nhau. Hãy chọn một. Chưa thay đổi gì.` };
        }
        if (op.type === 'ARCHIVE_CARD' || prior.type === 'ARCHIVE_CARD') {
          if (op.type === 'ARCHIVE_CARD' && prior.type === 'ARCHIVE_CARD') duplicate = true;
          else return { ok: false, text: `Thẻ “${title}” vừa được lưu trữ vừa bị sửa (thao tác ${j + 1} và ${i + 1}). Hãy tách thành hai lệnh. Chưa thay đổi gì.` };
        }
        const opposite = OPPOSITE[op.type];
        if (opposite !== undefined && prior.type === opposite && prior.ids.member === op.ids.member && prior.ids.label === op.ids.label) {
          return { ok: false, text: `Thao tác ${j + 1} và ${i + 1} làm ngược nhau trên thẻ “${title}”. Hãy nói rõ bạn muốn thêm hay bỏ. Chưa thay đổi gì.` };
        }
        if ((op.type === 'ADD_COMMENT' || op.type === 'ADD_CHECKLIST') && prior.type === op.type && same(prior.params, op.params)) duplicate = true;
        if ((op.type === 'REMOVE_MEMBER' && prior.type === 'REMOVE_MEMBER' && prior.ids.member === op.ids.member) || (op.type === 'REMOVE_LABEL' && prior.type === 'REMOVE_LABEL' && prior.ids.label === op.ids.label)) duplicate = true;
        if (op.type === 'ASSIGN_MEMBER' && prior.type === 'ASSIGN_MEMBER' && prior.ids.member === op.ids.member) duplicate = true;
        if (op.type === 'ADD_LABEL' && prior.type === 'ADD_LABEL' && prior.ids.label === op.ids.label) duplicate = true;
      }
    }
    // thao tac mo rong: xoa / luu tru mot doi tuong roi lai sua chinh no (hoac xoa hai lan) -> mau thuan hoac trung
    if (!duplicate) {
      const mine = targetsOf(op);
      for (const [j, prior] of kept.entries()) {
        const theirs = targetsOf(prior);
        const clash = mine.some((a) => theirs.some((b) => a.key === b.key && (a.effect === 'REMOVE' || b.effect === 'REMOVE')));
        if (!clash) continue;
        if (op.type === prior.type && same(op.ids, prior.ids) && same(op.params, prior.params)) duplicate = true;
        else return { ok: false, text: `Thao tác ${j + 1} và ${i + 1} cùng tác động tới một đối tượng nhưng một trong hai làm nó biến mất (xóa / lưu trữ). Hãy tách thành hai lệnh. Chưa thay đổi gì.` };
      }
    }
    if (duplicate) dropped += 1;
    else kept.push(op);
  }
  return { ok: true, ops: kept, dropped };
}

/**
 * Phan giai ca ke hoach theo THU TU CHAY (da sap topo). Dung o thao tac dau tien can nguoi dung chon / loi. `presets` da chot nen
 * cac lan goi sau (sau moi lan bam nut) di tiep den tham chieu nhap nhang ke tiep ma khong tim lai nhung cai da xong.
 */
export async function resolveOps(
  env: Omit<ResolveEnv, 'local' | 'cache' | 'pins' | 'due'>,
  ordered: readonly ActionOp[],
  presets: Presets,
  dues: readonly (DueGrounding | undefined)[]
): Promise<ResolveOpsResult> {
  const local = new Map<string, LocalEntity>();
  for (const op of ordered) {
    if (op.type === 'CREATE_LIST' && op.key !== undefined) local.set(op.key, { kind: 'LIST', name: op.name.trim() });
    if (op.type === 'CREATE_CARD' && op.key !== undefined) local.set(op.key, { kind: 'CARD', name: op.title.trim() });
  }
  const pins: Record<string, string> = {};
  const cache = new Map<string, Outcome>();
  const resolved: StoredOp[] = [];
  const warnings: string[] = [];
  for (const [i, symbolic] of ordered.entries()) {
    const res = await resolveOp({ ...env, local, cache, pins, due: dues[i], splitRoom: Math.max(1, MAX_OPS_PER_PLAN - (ordered.length - 1)) }, symbolic, presets);
    if (res.kind === 'CHOICE') return { kind: 'CHOICE', pending: res.pending, pins };
    if (res.kind === 'FAIL') return { kind: 'FAIL', code: res.code, text: res.text, ops: resolved };
    resolved.push(res.op, ...(res.more ?? []));
    for (const w of res.warnings) if (!warnings.includes(w)) warnings.push(w);
  }
  const deduped = dedupeOps(resolved);
  if (!deduped.ok) return { kind: 'FAIL', code: 'CONFLICT', text: deduped.text, ops: resolved };
  if (deduped.dropped > 0) warnings.push(`Đã bỏ ${deduped.dropped} thao tác trùng lặp.`);
  return { kind: 'OK', ops: deduped.ops, warnings, pins };
}
