// Nhan ly do uu tien cho "Hom nay toi nen lam gi truoc?" (CHATBOT_MODULE.md §6.6).
//
// HAM THUAN. The KHONG co truong "do uu tien" nen chi dua vao han chot; thu tu danh sach
// da la dueDate tang dan (SQL) nen nhan chi GAN NHAN tung dong, khong sap lai. Cac moc
// ngay (00:00 gio VN) do nguoi goi tinh san bang chat.period roi truyen vao.

export const PRIORITY_REASONS = ['OVERDUE', 'DUE_TODAY', 'DUE_SOON', 'LATER'] as const;
export type PriorityReason = (typeof PRIORITY_REASONS)[number];

export interface PriorityBounds {
  now: Date;
  /** 00:00 gio VN ngay mai. */
  tomorrow: Date;
  /** 00:00 gio VN (hom nay + 4) - het "3 ngay toi". */
  day4: Date;
}

export function priorityReason(dueDate: Date | null, b: PriorityBounds): PriorityReason {
  if (dueDate === null) return 'LATER';
  const t = dueDate.getTime();
  if (t < b.now.getTime()) return 'OVERDUE';
  if (t < b.tomorrow.getTime()) return 'DUE_TODAY';
  if (t < b.day4.getTime()) return 'DUE_SOON';
  return 'LATER';
}
