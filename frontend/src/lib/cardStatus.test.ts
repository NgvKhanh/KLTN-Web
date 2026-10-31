import { describe, expect, it } from 'vitest';
import type { CardStatus } from '../types/card';
import { countByStatus, reopenStatus, shouldShowCardStatus, targetListForStatus } from './cardStatus';

describe('shouldShowCardStatus', () => {
  it('the khop trang thai cot -> an (header cot da noi)', () => {
    expect(shouldShowCardStatus('IN_PROGRESS', 'IN_PROGRESS')).toBe(false);
  });

  it('the lech cot -> hien', () => {
    expect(shouldShowCardStatus('BLOCKED', 'IN_PROGRESS')).toBe(true);
    expect(shouldShowCardStatus('TODO', 'IN_REVIEW')).toBe(true);
  });

  it('cot tu do: TODO an (bang cu khong roi mat), trang thai khac hien', () => {
    expect(shouldShowCardStatus('TODO', null)).toBe(false);
    expect(shouldShowCardStatus('IN_REVIEW', null)).toBe(true);
  });

  it('the DONE khong bao gio hien (da co dau tich xanh)', () => {
    expect(shouldShowCardStatus('DONE', 'IN_PROGRESS')).toBe(false);
    expect(shouldShowCardStatus('DONE', null)).toBe(false);
  });
});

describe('reopenStatus', () => {
  it('theo cot neu cot khac DONE, khong thi TODO', () => {
    expect(reopenStatus('IN_REVIEW')).toBe('IN_REVIEW');
    expect(reopenStatus('DONE')).toBe('TODO');
    expect(reopenStatus(null)).toBe('TODO');
  });
});

describe('targetListForStatus', () => {
  const lists: { id: string; status: CardStatus | null }[] = [
    { id: 'free', status: null },
    { id: 'todo', status: 'TODO' },
    { id: 'done1', status: 'DONE' },
    { id: 'done2', status: 'DONE' },
  ];

  it('cot dau tien (tu trai sang) mang trang thai dich', () => {
    expect(targetListForStatus(lists, 'todo', 'DONE')?.id).toBe('done1');
  });

  it('the o cot tu do -> khong chuyen', () => {
    expect(targetListForStatus(lists, 'free', 'DONE')).toBeNull();
  });

  it('cot hien tai da mang dung trang thai -> khong chuyen', () => {
    expect(targetListForStatus(lists, 'done2', 'DONE')).toBeNull();
  });

  it('bang khong co cot mang trang thai dich -> khong chuyen', () => {
    expect(targetListForStatus(lists, 'todo', 'BLOCKED')).toBeNull();
  });
});

describe('countByStatus', () => {
  it('du 5 trang thai, trang thai khong co the = 0', () => {
    expect(countByStatus([{ status: 'DONE' }, { status: 'DONE' }, { status: 'BLOCKED' }])).toEqual({
      TODO: 0,
      IN_PROGRESS: 0,
      IN_REVIEW: 0,
      DONE: 2,
      BLOCKED: 1,
    });
  });
});
