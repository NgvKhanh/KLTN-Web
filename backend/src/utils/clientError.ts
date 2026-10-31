/**
 * Nhan dien LOI DO CLIENT GUI (khong phai loi he thong) do cac middleware cua Express / body-parser nem ra
 * (thu vien http-errors gan san `status` 4xx va `type`): JSON sai cu phap, body vuot gioi han, ma hoa / charset
 * khong ho tro, ket noi bi huy giua chung...
 *
 * Truoc day bo xu ly loi chung chi biet AppError nen cac loi nay roi xuong nhanh 500 ("Loi he thong") va in
 * "[LOI SERVER]" vao log; client gui du lieu sai khong phai la loi server. Ham nay tra ve ma trang thai dung
 * kem thong diep co dinh (KHONG chuyen tiep thong diep tieng Anh cua thu vien ra ngoai).
 * Tra ve null neu khong phai loi cua client.
 */
export function clientErrorOf(err: unknown): { status: number; message: string } | null {
  if (typeof err !== 'object' || err === null) return null;
  const e = err as { status?: unknown; statusCode?: unknown; type?: unknown };
  const status =
    typeof e.status === 'number' ? e.status : typeof e.statusCode === 'number' ? e.statusCode : null;
  if (status === null || status < 400 || status >= 500) return null;

  switch (e.type) {
    case 'entity.parse.failed':
      return { status: 400, message: 'Du lieu JSON gui len khong hop le' };
    case 'entity.too.large':
      return { status: 413, message: 'Du lieu gui len qua lon' };
    case 'encoding.unsupported':
    case 'charset.unsupported':
      return { status: 415, message: 'Dinh dang du lieu khong duoc ho tro' };
    default:
      break;
  }
  if (status === 413) return { status, message: 'Du lieu gui len qua lon' };
  if (status === 415) return { status, message: 'Dinh dang du lieu khong duoc ho tro' };
  // Con lai (vd "Failed to decode param", "request aborted", "request size did not match content length")
  return { status: 400, message: 'Yeu cau khong hop le' };
}

/** Loi vi pham rang buoc duy nhat cua Prisma (P2002), nhan dien bang `code` de khong phu thuoc lop loi cu the. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}
