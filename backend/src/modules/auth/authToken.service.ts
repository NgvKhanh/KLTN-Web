import crypto from 'node:crypto';
import { prisma } from '../../config/prisma';
import { AppError } from '../../utils/AppError';
import type { Prisma } from '../../generated/prisma/client';
import type { AuthTokenType } from '../../generated/prisma/enums';

// Prisma Client thuong HOAC client trong 1 transaction ($transaction(async (tx) => ...))
type Db = typeof prisma | Prisma.TransactionClient;

/**
 * Token 1 lan dung cho xac minh email va dat lai mat khau.
 *
 * Nguyen tac: token tho (gui qua email) KHONG bao gio luu vao DB.
 * DB chi luu SHA-256 cua token -> lo DB cung khong the dung token de reset.
 */

const HASH_ALGO = 'sha256';

function hashToken(raw: string): string {
  return crypto.createHash(HASH_ALGO).update(raw).digest('hex');
}

/**
 * Tao token moi cho user. Tra ve chuoi token THO (chua hash) de nhet vao link email.
 * Cac token cu cung loai, chua dung cua user se bi don di.
 */
export async function createAuthToken(
  userId: string,
  type: AuthTokenType,
  ttlMs: number
): Promise<string> {
  const raw = crypto.randomBytes(32).toString('hex'); // 64 ky tu hex
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + ttlMs);

  await prisma.$transaction([
    prisma.authToken.deleteMany({ where: { userId, type, usedAt: null } }),
    prisma.authToken.create({ data: { userId, type, tokenHash, expiresAt } }),
  ]);

  return raw;
}

/**
 * Kiem tra + "tieu thu" token (danh dau da dung) MOT CACH NGUYEN TU. Tra ve userId.
 * Nem AppError neu token sai / het han / da dung.
 *
 * Truyen `db` la client trong transaction de viec tieu thu token va thay doi
 * du lieu di kem (doi mat khau, xac minh email) cung thanh/that bai voi nhau:
 * neu buoc sau loi, token khong bi mat hieu luc oan.
 *
 * Dung updateMany co dieu kien (usedAt: null, chua het han) -> hai request
 * dong thoi thi chi dung mot cai co count === 1, cai con lai bi tu choi.
 */
export async function consumeAuthToken(
  db: Db,
  raw: string,
  type: AuthTokenType
): Promise<string> {
  const tokenHash = hashToken(raw);

  const consumed = await db.authToken.updateMany({
    where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (consumed.count === 0) {
    throw new AppError('Lien ket khong hop le hoac da het han', 400);
  }

  const record = await db.authToken.findUnique({
    where: { tokenHash },
    select: { userId: true },
  });
  // count === 1 dam bao ban ghi ton tai
  return record!.userId;
}
