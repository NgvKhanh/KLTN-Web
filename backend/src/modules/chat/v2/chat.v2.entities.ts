import { prisma } from '../../../config/prisma';
import { listChoosableWorkspaces } from '../chat.scope';
import { sameWord, tokenize } from '../chat.members';
import { liveCardWhere } from '../chat.scope';
import type { ExecutionContext } from './chat.v2.scope';
import type { ENTITY_KINDS } from './chat.v2.schema';

export interface EntityOption { id: string; name: string; kind: typeof ENTITY_KINDS[number]; parentName?: string }
export type EntityResolution = {
  status: 'RESOLVED' | 'CLARIFY' | 'NOT_FOUND'; total: number; options: EntityOption[]; truncated: boolean;
};
/** Full names are compared without truncating long titles into false exact matches. */
export function selectMatches<T extends { id: string; name: string }>(text: string, pool: T[]): T[] {
  const original = tokenize(text);
  const cues = [['khong', 'gian'], ['bang'], ['board'], ['workspace'], ['cot'], ['the'], ['cong', 'viec'], ['anh'], ['chi'], ['ban'], ['nhan'], ['label']];
  const cue = cues.find((c) => original.length > c.length && c.every((s, i) => original[i].fold === s));
  const variants = cue ? [original, original.slice(cue.length)] : [original];
  const matches = pool.map((item) => ({ item, words: tokenize(item.name) }));
  const same = (a: ReturnType<typeof tokenize>, b: ReturnType<typeof tokenize>) => a.length === b.length && a.every((t, i) => sameWord(t, b[i]));
  const exact = matches.filter((m) => variants.some((v) => same(v, m.words))).map((m) => m.item);
  if (exact.length) return exact;
  const byId = pool.filter((p) => p.id === text);
  if (byId.length) return byId;
  for (const tier of ['PREFIX', 'CONTAINS'] as const) {
    const found = matches.filter((m) => variants.some((v) => {
      if (!v.length) return false;
      const starts = tier === 'PREFIX' ? [0] : m.words.map((_, i) => i);
      return starts.some((s) => s + v.length <= m.words.length && v.every((t, i) => sameWord(t, m.words[s + i])));
    })).map((m) => m.item);
    if (found.length) return found;
  }
  return [];
}
export async function resolveEntities(ctx: ExecutionContext, kind: typeof ENTITY_KINDS[number], text: string): Promise<EntityResolution> {
  let pool: EntityOption[];
  switch (kind) {
    case 'BOARD':
      pool = (await prisma.board.findMany({ where: ctx.scope.boardWhere, select: { id: true, name: true, workspace: { select: { name: true } } } }))
        .map((b) => ({ id: b.id, name: b.name, kind, parentName: b.workspace.name }));
      break;
    case 'WORKSPACE':
      pool = (await listChoosableWorkspaces(ctx.scope.userId))
        .filter((w) => ctx.scope.kind === 'MY' || w.id === ctx.scope.workspace?.id)
        .map((w) => ({ id: w.id, name: w.name, kind }));
      break;
    case 'COLUMN':
      pool = (await prisma.list.findMany({ where: { deletedAt: null, archivedAt: null, board: ctx.scope.boardWhere }, select: { id: true, name: true, board: { select: { name: true } } } }))
        .map((l) => ({ id: l.id, name: l.name, kind, parentName: l.board.name }));
      break;
    case 'CARD':
      // parentName = ten COT chua the (o trang bang) hoac "cot · bang" (o pham vi rong) de phan biet hai the cung ten
      pool = (await prisma.card.findMany({ where: liveCardWhere(ctx.scope.boardWhere), select: { id: true, title: true, list: { select: { name: true, board: { select: { name: true } } } } } }))
        .map((c) => ({ id: c.id, name: c.title, kind, parentName: ctx.scope.kind === 'BOARD' ? c.list.name : `${c.list.name} · ${c.list.board.name}` }));
      break;
    case 'MEMBER': pool = ctx.roster.map((m) => ({ id: m.userId, name: m.name, kind })); break;
    case 'CUSTOM_FIELD':
      pool = (await prisma.customField.findMany({ where: { board: ctx.scope.boardWhere }, select: { id: true, name: true, board: { select: { name: true } } } }))
        .map((f) => ({ id: f.id, name: f.name, kind, parentName: f.board.name }));
      break;
    case 'FIELD_OPTION':
      // gia tri cua truong dang lua chon (vd "Cao" cua truong "Uu tien"): parentName = ten truong de phan biet cung gia tri o nhieu truong
      pool = (await prisma.customFieldOption.findMany({ where: { field: { board: ctx.scope.boardWhere } }, select: { id: true, value: true, field: { select: { name: true } } } }))
        .map((o) => ({ id: o.id, name: o.value, kind, parentName: o.field.name }));
      break;
    case 'LABEL':
      // chỉ nhãn CÓ TÊN (nhãn mặc định chỉ có màu thì không gọi được bằng lời)
      pool = (await prisma.label.findMany({ where: { name: { not: '' }, board: ctx.scope.boardWhere }, select: { id: true, name: true, board: { select: { name: true } } } }))
        .map((l) => ({ id: l.id, name: l.name, kind, parentName: l.board.name }));
      break;
  }
  const found = selectMatches(text, pool).sort((a, b) => a.name.localeCompare(b.name, 'vi') || a.id.localeCompare(b.id));
  return { status: found.length === 0 ? 'NOT_FOUND' : found.length === 1 ? 'RESOLVED' : 'CLARIFY', total: found.length, options: found.slice(0, 100), truncated: found.length > 100 };
}
