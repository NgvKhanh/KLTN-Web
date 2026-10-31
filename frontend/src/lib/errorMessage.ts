import axios from 'axios';

// Thong diep mac dinh (tieng Anh) cua zod khi schema khong dat thong diep rieng:
// khong co ich cho nguoi dung, nen bo qua va dung thong diep chung cua server.
const ZOD_DEFAULT = /^(too (big|small)|invalid|required|expected|string must|number must|array must)/i;

/**
 * Lay thong diep loi de doc tu axios error, co gia tri du phong khi khong doan duoc.
 *
 * Server validate tra 400 kem `errors: [{ field, message }]` (vd "Mo ta qua dai");
 * `message` chi la cau chung "Du lieu gui len khong hop le". Co ly do cu the thi uu
 * tien no de nguoi dung biet sua gi.
 */
export function getErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { message?: unknown; errors?: unknown }
      | undefined;
    if (Array.isArray(data?.errors)) {
      for (const e of data.errors as { message?: unknown }[]) {
        const m = e?.message;
        if (typeof m === 'string' && m.trim() && !ZOD_DEFAULT.test(m.trim())) {
          return m.trim();
        }
      }
    }
    if (typeof data?.message === 'string' && data.message) {
      return data.message;
    }
  }
  return fallback;
}
