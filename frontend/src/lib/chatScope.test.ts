import { describe, expect, it } from 'vitest';
import { assistantScopeFor, guardScope, planOutOfScope, scopeChipText, scopeChipTitle } from './chatScope';

// Pham vi cua tro ly THEO TRANG: trang bang khoa cung trong bang do, moi trang con lai la "moi bang cua toi".

describe('assistantScopeFor', () => {
  it('trang bang /boards/:boardId -> BOARD', () => {
    expect(assistantScopeFor('/boards/b1')).toEqual({ kind: 'BOARD', boardId: 'b1' });
    expect(assistantScopeFor('/boards/abc-123')).toEqual({ kind: 'BOARD', boardId: 'abc-123' });
    expect(assistantScopeFor('/boards/b1/')).toEqual({ kind: 'BOARD', boardId: 'b1' });
  });

  it('moi trang khac -> MY (trang chu, danh sach bang, khong gian, tim kiem, lich, cai dat...)', () => {
    for (const path of ['/', '/home', '/boards', '/workspaces/ws1', '/my-cards', '/search', '/calendar', '/settings/profile', '/templates', '/activity', '/join/tok']) {
      expect(assistantScopeFor(path), path).toEqual({ kind: 'MY' });
    }
  });

  it('khong nham duong dan dai hon hoac bang cong khai thanh trang bang cua nguoi dung', () => {
    expect(assistantScopeFor('/boards/b1/extra')).toEqual({ kind: 'MY' });
    expect(assistantScopeFor('/public/boards/b1')).toEqual({ kind: 'MY' });
  });
});

describe('nhan va tran pham vi', () => {
  it('nhan ngan + chu giai noi ro dang lam viec trong dau', () => {
    expect(scopeChipText({ kind: 'BOARD', boardId: 'b1' })).toBe('Trong bảng đang mở');
    expect(scopeChipText({ kind: 'MY' })).toBe('Mọi bảng của bạn');
    expect(scopeChipTitle({ kind: 'BOARD', boardId: 'b1' })).toContain('chỉ đọc và thay đổi trong bảng này');
    expect(scopeChipTitle({ kind: 'MY' })).toContain('mọi bảng bạn tham gia');
  });

  it('ke hoach cua bang khac voi trang bang dang mo thi bi khoa; o trang chu thi khong han che them', () => {
    expect(planOutOfScope({ kind: 'BOARD', boardId: 'b1' }, 'b1')).toBe(false);
    expect(planOutOfScope({ kind: 'BOARD', boardId: 'b1' }, 'b2')).toBe(true);
    expect(planOutOfScope({ kind: 'MY' }, 'b2')).toBe(false);
    expect(planOutOfScope({ kind: 'WORKSPACE', workspaceId: 'w' }, 'b2')).toBe(false);
  });

  it('chi gui pham vi kem nut chon / xem them khi dang o trang bang', () => {
    expect(guardScope({ kind: 'BOARD', boardId: 'b1' })).toEqual({ kind: 'BOARD', boardId: 'b1' });
    expect(guardScope({ kind: 'MY' })).toBeUndefined();
  });
});
