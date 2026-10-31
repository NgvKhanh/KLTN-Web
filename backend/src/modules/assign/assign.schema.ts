import { z } from 'zod';
import { weightIssues } from './assign.weights';

// Zod cho REQUEST BODY cua module goi y phan cong. Quy tac khoang gia tri / tong = 1 nam o assign.weights.ts
// (mot noi duy nhat, dung chung voi service va bo hoc trong so).

export const outcomeSchema = z.object({
  /** Nguoi thuc su duoc giao. Server kiem tra nguoi nay dang o trong the (khong tin client). */
  chosenUserId: z.string().trim().min(1, 'Thieu nguoi duoc chon').max(100, 'Ma nguoi dung qua dai'),
});
export type OutcomeInput = z.infer<typeof outcomeSchema>;

// Tu buoc 16 (§17.6): bon trong so, du khoa (them Ho so)
export const weightsSchema = z
  .object({
    experience: z.number(),
    reliability: z.number(),
    availability: z.number(),
    declared: z.number(),
  })
  .superRefine((w, ctx) => {
    for (const issue of weightIssues(w)) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: [issue.path] });
    }
  });
export type WeightsInput = z.infer<typeof weightsSchema>;

/** So the song song toi da nguoi dung duoc tu dat (§5.6: mac dinh 5). */
export const MAX_PARALLEL_LIMIT = 30;

export const workProfileSchema = z.object({
  maxParallelCards: z
    .number()
    .int('So the song song phai la so nguyen')
    .min(1, 'So the song song toi thieu la 1')
    .max(MAX_PARALLEL_LIMIT, `So the song song toi da la ${MAX_PARALLEL_LIMIT}`),
  /** Tam nghi den het thoi diem nay (ISO, co Z); null = dang lam binh thuong. */
  pausedUntil: z.union([z.string().datetime('Ngay tam nghi khong hop le (can dang ISO, vd 2026-10-01T16:59:59.999Z)'), z.null()]),
});
export type WorkProfileInput = z.infer<typeof workProfileSchema>;
