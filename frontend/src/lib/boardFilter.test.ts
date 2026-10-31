import { describe, expect, it } from 'vitest';
import type { Card, CardStatus } from '../types/card';
import { EMPTY_FILTER, cardMatchesFilter, filterActiveCount, isFilterActive } from './boardFilter';

function card(status: CardStatus, over: Partial<Card> = {}): Card {
  return {
    id: `c-${status}`,
    listId: 'l1',
    title: 'Thẻ',
    description: null,
    status,
    isDone: status === 'DONE',
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('boardFilter - lọc theo trạng thái', () => {
  it('không chọn trạng thái nào -> mọi thẻ đều qua', () => {
    expect(cardMatchesFilter(card('BLOCKED'), EMPTY_FILTER)).toBe(true);
    expect(isFilterActive(EMPTY_FILTER)).toBe(false);
  });

  it('chọn nhiều trạng thái -> thẻ khớp 1 trong số đó là qua (OR trong nhóm)', () => {
    const f = { ...EMPTY_FILTER, statuses: ['IN_PROGRESS', 'BLOCKED'] as CardStatus[] };
    expect(cardMatchesFilter(card('IN_PROGRESS'), f)).toBe(true);
    expect(cardMatchesFilter(card('BLOCKED'), f)).toBe(true);
    expect(cardMatchesFilter(card('TODO'), f)).toBe(false);
    expect(cardMatchesFilter(card('DONE'), f)).toBe(false);
  });

  it('kết hợp với nhóm khác -> phải khớp cả hai (AND giữa các nhóm)', () => {
    const f = { ...EMPTY_FILTER, statuses: ['IN_PROGRESS'] as CardStatus[], keyword: 'báo cáo' };
    expect(cardMatchesFilter(card('IN_PROGRESS', { title: 'Viết báo cáo' }), f)).toBe(true);
    expect(cardMatchesFilter(card('IN_PROGRESS', { title: 'Họp nhóm' }), f)).toBe(false);
    expect(cardMatchesFilter(card('TODO', { title: 'Viết báo cáo' }), f)).toBe(false);
  });

  it('mỗi trạng thái được chọn tính 1 vào số bộ lọc đang bật', () => {
    const f = { ...EMPTY_FILTER, statuses: ['TODO', 'DONE'] as CardStatus[] };
    expect(filterActiveCount(f)).toBe(2);
    expect(isFilterActive(f)).toBe(true);
  });
});
