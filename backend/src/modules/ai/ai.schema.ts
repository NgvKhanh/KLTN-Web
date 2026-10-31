import { z } from 'zod';
import { isValidIso } from './ai.dates';
import { boardPlanSchema } from './boardPlan.schema';

// Zod cho REQUEST BODY cua module AI. (Hop dong du lieu LlmDraft/BoardPlan nam o
// boardPlan.schema.ts.)

/**
 * Do dai toi da cua van ban dau vao. Dung chung voi ai.document.ts: chu trich tu tep duoc cat
 * dung bang muc nay de nguoi dung luon gui lai duoc ma khong bi 400 vi qua dai.
 */
export const MAX_INPUT_TEXT_CHARS = 20000;

/** Ngay lich THAT dang YYYY-MM-DD ("2026-02-30" bi tu choi). */
const isoDate = z.string().trim().refine(isValidIso, 'Ngay khong hop le (can dang YYYY-MM-DD)');

export const generatePlanSchema = z
  .object({
    workspaceId: z.string().trim().min(1, 'Thieu khong gian lam viec'),
    text: z
      .string()
      .trim()
      .min(20, 'Mo ta qua ngan (can it nhat 20 ky tu)')
      .max(MAX_INPUT_TEXT_CHARS, `Mo ta qua dai (toi da ${MAX_INPUT_TEXT_CHARS} ky tu)`)
      // NUL qua duoc JSON nhung Postgres tu choi luu (AiRun.inputText) -> 500. Chan o day (400).
      .refine((s) => !s.includes('\u0000'), 'Van ban chua ky tu khong hop le'),
    /**
     * Nguon van ban: gõ tay hay trich tu tep. Do CLIENT khai, chi de thong ke (bao nhieu luot chay
     * den tu tep) - khong anh huong cach xu ly va server khong kiem duoc.
     */
    inputKind: z.enum(['TEXT', 'DOCX', 'PDF']).default('TEXT'),
    /** Nguoi dung ghi de che do do may chon (modeAuto). */
    mode: z.enum(['STRUCTURED', 'FREEFORM']).optional(),
    projectStart: isoDate.optional(),
    projectEnd: isoDate.optional(),
    skipWeekend: z.boolean().default(true),
    /**
     * Ngay "hom nay" cua nguoi dung (de giai "thu 6 tuan nay", "trong 2 tuan"...).
     * Bo trong -> server lay theo gio Viet Nam. Chi anh huong ke hoach cua CHINH ho.
     */
    today: isoDate.optional(),
  })
  .refine((v) => !v.projectStart || !v.projectEnd || v.projectStart <= v.projectEnd, {
    message: 'Ngay bat dau phai truoc han chot',
    path: ['projectEnd'],
  });
export type GeneratePlanInput = z.infer<typeof generatePlanSchema>;

/**
 * Ke hoach nguoi dung da xem/sua. Kiem lai TOAN BO bang boardPlanSchema (khong tin
 * client): ngay that, nguon ngay khop, mau trong bang, khoa la bi tu choi...
 */
export const applyPlanSchema = z.object({ plan: boardPlanSchema });
export type ApplyPlanInput = z.infer<typeof applyPlanSchema>;
