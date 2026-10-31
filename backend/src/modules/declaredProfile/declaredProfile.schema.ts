import { z } from 'zod';
import { MAX_INPUT_TEXT_CHARS } from '../ai/ai.schema';

// Zod cho ho so TU KHAI (ASSIGN_MODULE.md §17.2). Gioi han o day la gioi han cua API; bo cham tu cat them (50 cum ky nang, 30 cong
// viec, 50 doan CV) nen ho so dai hon cung khong lam cham goi y.

export const SKILLS_MAX_CHARS = 2000;
export const WORK_ITEMS_MAX = 30;
export const WORK_TITLE_MAX = 200;
export const WORK_DESC_MAX = 1000;
/** Bang gioi han chu cua bo trich tep (chu trich ra luon luu lai duoc). */
export const CV_TEXT_MAX = MAX_INPUT_TEXT_CHARS;

export const workItemSchema = z.object({
  id: z.string().trim().min(1).max(64, 'Mã công việc quá dài').optional(),
  title: z.string().trim().min(1, 'Thiếu tên công việc').max(WORK_TITLE_MAX, `Tên công việc tối đa ${WORK_TITLE_MAX} ký tự`),
  description: z.string().max(WORK_DESC_MAX, `Mô tả công việc tối đa ${WORK_DESC_MAX} ký tự`).nullable().optional(),
});

export const declaredProfileSchema = z.object({
  useForAssign: z.boolean(),
  // Chia se TEP CV voi nguoi quan ly bang / khong gian chung. Tuy chon: khong gui = giu nguyen (mac dinh tat).
  cvShared: z.boolean().optional(),
  skillsText: z.string().max(SKILLS_MAX_CHARS, `Kỹ năng tối đa ${SKILLS_MAX_CHARS} ký tự`),
  workItems: z.array(workItemSchema).max(WORK_ITEMS_MAX, `Tối đa ${WORK_ITEMS_MAX} công việc`),
  cvText: z.string().max(CV_TEXT_MAX, `Nội dung CV tối đa ${CV_TEXT_MAX} ký tự`).nullable(),
});
export type DeclaredProfileInput = z.infer<typeof declaredProfileSchema>;

/** Toi da so nguoi hoi trong MOT lan (danh sach thanh vien bang / khong gian). */
export const CV_ACCESS_MAX_IDS = 200;

/** `?userIds=a,b,c` - bo khoang trang, bo trung, bo phan tu rong. */
export const cvAccessQuerySchema = z.object({
  userIds: z
    .string()
    .transform((s) => [...new Set(s.split(',').map((x) => x.trim()).filter((x) => x !== ''))])
    .pipe(
      z
        .array(z.string().max(64, 'Mã người dùng quá dài'))
        .min(1, 'Thiếu danh sách người dùng')
        .max(CV_ACCESS_MAX_IDS, `Tối đa ${CV_ACCESS_MAX_IDS} người mỗi lần`)
    ),
});
export type CvAccessQuery = z.infer<typeof cvAccessQuerySchema>;
