import { describe, expect, it } from 'vitest';
import {
  nextOccurrenceAfter,
  nextOccurrenceOnOrAfter,
} from '../src/modules/card/recurringSchedule.dates';

describe('recurringSchedule.dates - DAILY', () => {
  it('gio hen chua toi trong ngay -> lay ngay hom nay', () => {
    const from = new Date('2026-03-10T08:00:00.000Z');
    const next = nextOccurrenceOnOrAfter(from, { frequency: 'DAILY', timeOfDay: '09:00' });
    expect(next.toISOString()).toBe('2026-03-10T09:00:00.000Z');
  });

  it('gio hen da qua trong ngay -> nhay sang ngay mai', () => {
    const from = new Date('2026-03-10T10:00:00.000Z');
    const next = nextOccurrenceOnOrAfter(from, { frequency: 'DAILY', timeOfDay: '09:00' });
    expect(next.toISOString()).toBe('2026-03-11T09:00:00.000Z');
  });

  it('dung gio hen (bang, khong lech) -> tinh la lan nay (onOrAfter bao gom)', () => {
    const from = new Date('2026-03-10T09:00:00.000Z');
    const next = nextOccurrenceOnOrAfter(from, { frequency: 'DAILY', timeOfDay: '09:00' });
    expect(next.toISOString()).toBe('2026-03-10T09:00:00.000Z');
  });

  it('nextOccurrenceAfter luon nhay qua lan hien tai, khong lap lai', () => {
    const current = new Date('2026-03-10T09:00:00.000Z');
    const next = nextOccurrenceAfter(current, { frequency: 'DAILY', timeOfDay: '09:00' });
    expect(next.toISOString()).toBe('2026-03-11T09:00:00.000Z');
  });
});

describe('recurringSchedule.dates - WEEKLY', () => {
  it('tim dung thu tiep theo (2026-03-10 la thu Ba, hen thu Hai)', () => {
    // 2026-03-10 UTC la thu Ba (getUTCDay=2); dayOfWeek=1 la thu Hai
    const from = new Date('2026-03-10T00:00:00.000Z');
    const next = nextOccurrenceOnOrAfter(from, {
      frequency: 'WEEKLY',
      dayOfWeek: 1,
      timeOfDay: '09:00',
    });
    expect(next.getUTCDay()).toBe(1);
    expect(next.toISOString()).toBe('2026-03-16T09:00:00.000Z');
  });

  it('dung ngay trong tuan nhung gio da qua -> nhay sang tuan sau', () => {
    // 2026-03-09 la thu Hai (dayOfWeek=1)
    const from = new Date('2026-03-09T10:00:00.000Z');
    const next = nextOccurrenceOnOrAfter(from, {
      frequency: 'WEEKLY',
      dayOfWeek: 1,
      timeOfDay: '09:00',
    });
    expect(next.toISOString()).toBe('2026-03-16T09:00:00.000Z');
  });

  it('dung ngay trong tuan va gio con toi -> lay chinh ngay do', () => {
    const from = new Date('2026-03-09T08:00:00.000Z');
    const next = nextOccurrenceOnOrAfter(from, {
      frequency: 'WEEKLY',
      dayOfWeek: 1,
      timeOfDay: '09:00',
    });
    expect(next.toISOString()).toBe('2026-03-09T09:00:00.000Z');
  });
});

describe('recurringSchedule.dates - MONTHLY', () => {
  it('ngay 31 nhung thang 2 chi co 28 ngay -> lay ngay cuoi thang (28)', () => {
    const from = new Date('2026-02-01T00:00:00.000Z');
    const next = nextOccurrenceOnOrAfter(from, {
      frequency: 'MONTHLY',
      dayOfMonth: 31,
      timeOfDay: '09:00',
    });
    expect(next.toISOString()).toBe('2026-02-28T09:00:00.000Z');
  });

  it('thang sau co du 31 ngay -> KHONG bi "dinh" mai vao ngay 28, tro lai dung 31', () => {
    // Tiep ngay sau lan chay thang 2 (28/2) -> lan ke tiep phai la 31/3, khong phai 28/3
    const afterFeb = new Date('2026-02-28T09:00:00.000Z');
    const next = nextOccurrenceAfter(afterFeb, {
      frequency: 'MONTHLY',
      dayOfMonth: 31,
      timeOfDay: '09:00',
    });
    expect(next.toISOString()).toBe('2026-03-31T09:00:00.000Z');
  });

  it('dung ngay trong thang nhung gio da qua -> nhay sang thang sau', () => {
    const from = new Date('2026-05-15T10:00:00.000Z');
    const next = nextOccurrenceOnOrAfter(from, {
      frequency: 'MONTHLY',
      dayOfMonth: 15,
      timeOfDay: '09:00',
    });
    expect(next.toISOString()).toBe('2026-06-15T09:00:00.000Z');
  });

  it('qua nam moi (thang 12 -> thang 1 nam sau)', () => {
    const from = new Date('2026-12-20T00:00:00.000Z');
    const next = nextOccurrenceOnOrAfter(from, {
      frequency: 'MONTHLY',
      dayOfMonth: 5,
      timeOfDay: '09:00',
    });
    expect(next.toISOString()).toBe('2027-01-05T09:00:00.000Z');
  });
});
