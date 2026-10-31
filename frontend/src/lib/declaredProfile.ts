import type { DeclaredProfile, DeclaredProfileInput } from '../types/assign';

// Ban nhap cua "Ho so ky nang" o trang Ho so ca nhan (ASSIGN_MODULE.md §17.2): chuyen doi giua du lieu may chu va o nhap,
// kiem loi TRUOC khi gui (cung gioi han voi zod o may chu), so sanh de biet co thay doi chua.

export const SKILLS_MAX_CHARS = 2000;
export const WORK_ITEMS_MAX = 30;
export const WORK_TITLE_MAX = 200;
export const WORK_DESC_MAX = 1000;
export const CV_TEXT_MAX = 20000;

export interface WorkItemDraft {
  /** Khoa on dinh cho React: ma cua may chu, hoac `moi-N` cho muc chua luu. */
  key: string;
  /** Ma cua may chu; muc moi chua co. */
  id?: string;
  title: string;
  description: string;
}

export interface ProfileDraft {
  useForAssign: boolean;
  /** Cho phep nguoi quan ly chung tai tep CV (mac dinh tat). */
  cvShared: boolean;
  skillsText: string;
  workItems: WorkItemDraft[];
  /** Chu CV dang sua; '' = khong co. */
  cvText: string;
}

export function draftOf(p: DeclaredProfile): ProfileDraft {
  return {
    useForAssign: p.useForAssign,
    cvShared: p.cvShared === true,
    skillsText: p.skillsText,
    workItems: p.workItems.map((w) => ({ key: w.id, id: w.id, title: w.title, description: w.description ?? '' })),
    cvText: p.cvText ?? '',
  };
}

/** Than PUT: mo ta rong -> null, chu CV rong (chi khoang trang) -> null; muc moi khong gui `id`. */
export function inputOf(d: ProfileDraft): DeclaredProfileInput {
  return {
    useForAssign: d.useForAssign,
    cvShared: d.cvShared,
    skillsText: d.skillsText,
    workItems: d.workItems.map((w) => ({
      ...(w.id ? { id: w.id } : {}),
      title: w.title.trim(),
      description: w.description.trim() === '' ? null : w.description,
    })),
    cvText: d.cvText.trim() === '' ? null : d.cvText,
  };
}

export const sameDraft = (a: ProfileDraft, b: ProfileDraft) => JSON.stringify(inputOf(a)) === JSON.stringify(inputOf(b));

/** Cac loi chan viec luu (rong = hop le). Cung gioi han voi may chu de nguoi dung biet truoc khi bam Luu. */
export function draftIssues(d: ProfileDraft): string[] {
  const out: string[] = [];
  if (d.skillsText.length > SKILLS_MAX_CHARS) out.push(`Kỹ năng tối đa ${SKILLS_MAX_CHARS} ký tự.`);
  if (d.workItems.length > WORK_ITEMS_MAX) out.push(`Tối đa ${WORK_ITEMS_MAX} công việc.`);
  d.workItems.forEach((w, i) => {
    if (w.title.trim() === '') out.push(`Công việc ${i + 1} chưa có tên.`);
    else if (w.title.trim().length > WORK_TITLE_MAX) out.push(`Tên công việc ${i + 1} tối đa ${WORK_TITLE_MAX} ký tự.`);
    if (w.description.length > WORK_DESC_MAX) out.push(`Mô tả công việc ${i + 1} tối đa ${WORK_DESC_MAX} ký tự.`);
  });
  if (d.cvText.length > CV_TEXT_MAX) out.push(`Nội dung CV tối đa ${CV_TEXT_MAX} ký tự.`);
  return out;
}

/** 1536 -> "1,5 KB"; 2 500 000 -> "2,4 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1).replace('.', ',')} KB`;
  return `${(kb / 1024).toFixed(1).replace('.', ',')} MB`;
}
