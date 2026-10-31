import { describe, expect, it } from 'vitest';
import type { DeclaredProfile } from '../types/assign';
import {
  CV_TEXT_MAX,
  SKILLS_MAX_CHARS,
  WORK_DESC_MAX,
  WORK_ITEMS_MAX,
  WORK_TITLE_MAX,
  draftIssues,
  draftOf,
  formatSize,
  inputOf,
  sameDraft,
  type ProfileDraft,
} from './declaredProfile';

const PROFILE: DeclaredProfile = {
  useForAssign: true,
  cvShared: false,
  skillsText: 'React, SQL',
  workItems: [
    { id: 'a1', title: 'Trang quản trị', description: 'Dashboard' },
    { id: 'a2', title: 'API đăng nhập', description: null },
  ],
  cv: null,
  cvText: null,
};

const draft = (over: Partial<ProfileDraft> = {}): ProfileDraft => ({ ...draftOf(PROFILE), ...over });

describe('hang so: khop gioi han cua may chu (declaredProfile.schema.ts)', () => {
  it('2000 / 30 / 200 / 1000 / 20000', () => {
    expect([SKILLS_MAX_CHARS, WORK_ITEMS_MAX, WORK_TITLE_MAX, WORK_DESC_MAX, CV_TEXT_MAX]).toEqual([2000, 30, 200, 1000, 20000]);
  });
});

describe('draftOf / inputOf', () => {
  it('draftOf: ma cua may chu lam khoa; mo ta / chu CV null -> chuoi rong', () => {
    expect(draftOf(PROFILE)).toEqual({
      useForAssign: true,
      cvShared: false,
      skillsText: 'React, SQL',
      workItems: [
        { key: 'a1', id: 'a1', title: 'Trang quản trị', description: 'Dashboard' },
        { key: 'a2', id: 'a2', title: 'API đăng nhập', description: '' },
      ],
      cvText: '',
    });
    expect(draftOf({ ...PROFILE, cvText: 'chu CV' }).cvText).toBe('chu CV');
  });

  it('inputOf: muc moi KHONG gui id; ten cat khoang trang; mo ta rong -> null; chu CV rong / chi khoang trang -> null', () => {
    const d = draft({
      workItems: [
        { key: 'a1', id: 'a1', title: '  Trang quản trị  ', description: 'Dashboard' },
        { key: 'moi-1', title: 'Việc mới', description: '   ' },
      ],
      cvText: '  \n ',
    });
    expect(inputOf(d)).toEqual({
      useForAssign: true,
      cvShared: false,
      skillsText: 'React, SQL',
      workItems: [
        { id: 'a1', title: 'Trang quản trị', description: 'Dashboard' },
        { title: 'Việc mới', description: null },
      ],
      cvText: null,
    });
    expect('id' in inputOf(d).workItems[1]!).toBe(false);
    expect(inputOf(draft({ cvText: 'Kinh nghiệm React' })).cvText).toBe('Kinh nghiệm React');
    expect(inputOf(draft({ useForAssign: false })).useForAssign).toBe(false);
    expect(inputOf(draft({ cvShared: true })).cvShared).toBe(true);
    // may chu cu chua co truong nay -> coi nhu chua chia se
    expect(draftOf({ ...PROFILE, cvShared: undefined as unknown as boolean }).cvShared).toBe(false);
  });

  it('VONG TRON: inputOf(draftOf(p)) giu nguyen noi dung ho so', () => {
    expect(inputOf(draftOf(PROFILE))).toEqual({
      useForAssign: true,
      cvShared: false,
      skillsText: 'React, SQL',
      workItems: [
        { id: 'a1', title: 'Trang quản trị', description: 'Dashboard' },
        { id: 'a2', title: 'API đăng nhập', description: null },
      ],
      cvText: null,
    });
  });
});

describe('sameDraft', () => {
  it('so theo NOI DUNG gui di (khoang trang thua o ten / mo ta rong khong tinh la doi); moi truong doi deu la khac', () => {
    const base = draft();
    expect(sameDraft(base, draft())).toBe(true);
    expect(sameDraft(base, draft({ workItems: base.workItems.map((w) => ({ ...w, title: ` ${w.title} ` })) }))).toBe(true);
    expect(sameDraft(base, draft({ useForAssign: false }))).toBe(false);
    expect(sameDraft(base, draft({ skillsText: 'React' }))).toBe(false);
    expect(sameDraft(base, draft({ cvText: 'x' }))).toBe(false);
    expect(sameDraft(base, draft({ workItems: base.workItems.slice(0, 1) }))).toBe(false);
    expect(sameDraft(base, draft({ workItems: [...base.workItems].reverse() }))).toBe(false);
    expect(sameDraft(base, draft({ workItems: base.workItems.map((w, i) => (i === 0 ? { ...w, description: 'khác' } : w)) }))).toBe(false);
  });
});

describe('draftIssues - cung gioi han voi may chu, bien dung bang van hop le', () => {
  it('ho so hop le -> khong loi; bien (2000 / 30 viec / ten 200 / mo ta 1000 / CV 20000) van hop le', () => {
    expect(draftIssues(draft())).toEqual([]);
    const edge = draft({
      skillsText: 'x'.repeat(2000),
      workItems: Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, title: 't'.repeat(200), description: 'd'.repeat(1000) })),
      cvText: 'c'.repeat(20000),
    });
    expect(draftIssues(edge)).toEqual([]);
  });

  it('vuot tung gioi han -> dung mot thong diep, danh so cong viec tu 1', () => {
    expect(draftIssues(draft({ skillsText: 'x'.repeat(2001) }))).toEqual(['Kỹ năng tối đa 2000 ký tự.']);
    expect(draftIssues(draft({ cvText: 'c'.repeat(20001) }))).toEqual(['Nội dung CV tối đa 20000 ký tự.']);
    const many = Array.from({ length: 31 }, (_, i) => ({ key: `k${i}`, title: 'Việc', description: '' }));
    expect(draftIssues(draft({ workItems: many }))).toEqual(['Tối đa 30 công việc.']);
    const w = (title: string, description = '') => ({ key: 'k', title, description });
    expect(draftIssues(draft({ workItems: [w('ok'), w('   ')] }))).toEqual(['Công việc 2 chưa có tên.']);
    expect(draftIssues(draft({ workItems: [w('t'.repeat(201))] }))).toEqual(['Tên công việc 1 tối đa 200 ký tự.']);
    // Ten dai do khoang trang thua o hai dau van hop le (may chu cat truoc khi kiem)
    expect(draftIssues(draft({ workItems: [w(` ${'t'.repeat(200)} `)] }))).toEqual([]);
    expect(draftIssues(draft({ workItems: [w('ok', 'd'.repeat(1001))] }))).toEqual(['Mô tả công việc 1 tối đa 1000 ký tự.']);
  });
});

describe('formatSize', () => {
  it('B / KB / MB, dau phay thap phan', () => {
    expect(formatSize(900)).toBe('900 B');
    expect(formatSize(1023)).toBe('1023 B');
    expect(formatSize(1024)).toBe('1,0 KB');
    expect(formatSize(1536)).toBe('1,5 KB');
    expect(formatSize(1024 * 1024 - 1)).toBe('1024,0 KB');
    expect(formatSize(1024 * 1024)).toBe('1,0 MB');
    expect(formatSize(2_500_000)).toBe('2,4 MB');
  });
});
