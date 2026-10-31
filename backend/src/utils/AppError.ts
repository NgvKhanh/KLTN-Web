/**
 * Loi nghiep vu co ma trang thai HTTP cu the (vi du 400, 401, 404).
 * Dung de phan biet voi loi he thong khong luong truoc duoc (mac dinh tra 500).
 *
 * `code` / `data` (tuy chon): ma loi may doc duoc + du lieu di kem de client xu ly
 * tiep (vd 409 CARD_CONFLICT kem gia tri hien tai cua truong bi sua cung luc).
 */
export class AppError extends Error {
  statusCode: number;
  code?: string;
  data?: Record<string, unknown>;

  constructor(
    message: string,
    statusCode: number,
    extra?: { code?: string; data?: Record<string, unknown> }
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = extra?.code;
    this.data = extra?.data;
    this.name = 'AppError';
  }
}
