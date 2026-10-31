import type { ChatV2Block } from '../types/chat';

function mergeRows<T extends { id: string }>(prev: T[], next: T[]): T[] {
  const rows = new Map(prev.map((r) => [r.id, r]));
  for (const r of next) rows.set(r.id, r);
  return [...rows.values()];
}
export function mergeV2Block(prev: ChatV2Block, next: ChatV2Block): ChatV2Block {
  if (prev.status !== 'OK' || next.status !== 'OK' || prev.tool !== next.tool) return next;
  if (prev.tool === 'query_tasks' && next.tool === 'query_tasks') return { ...next, data: { ...next.data, cards: mergeRows(prev.data.cards, next.data.cards) } };
  if (prev.tool === 'aggregate_tasks' && next.tool === 'aggregate_tasks') return { ...next, data: { ...next.data, rows: mergeRows(prev.data.rows, next.data.rows) } };
  if (prev.tool === 'query_data' && next.tool === 'query_data') return { ...next, data: { ...next.data, rows: mergeRows(prev.data.rows, next.data.rows), groups: [...new Map([...prev.data.groups, ...next.data.groups].map((g) => [g.id ?? g.label, g])).values()] } };
  if (prev.tool === 'query_activities' && next.tool === 'query_activities') return { ...next, data: { ...next.data, cards: mergeRows(prev.data.cards, next.data.cards), events: mergeRows(prev.data.events, next.data.events) } };
  if (prev.tool === 'query_catalog' && next.tool === 'query_catalog') {
    if (prev.data.kind === 'BOARDS' && next.data.kind === 'BOARDS') return { ...next, data: { ...next.data, rows: mergeRows(prev.data.rows, next.data.rows) } };
    if (prev.data.kind === 'WORKSPACES' && next.data.kind === 'WORKSPACES') return { ...next, data: { ...next.data, rows: mergeRows(prev.data.rows, next.data.rows) } };
    if (prev.data.kind === 'MEMBERS' && next.data.kind === 'MEMBERS') return { ...next, data: { ...next.data, rows: mergeRows(prev.data.rows, next.data.rows) } };
  }
  return next;
}
