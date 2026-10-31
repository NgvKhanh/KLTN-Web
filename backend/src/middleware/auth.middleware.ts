import { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { verifyToken } from '../utils/jwt';

const TOKEN_COOKIE_NAME = 'token';

/**
 * Lay JWT tu cookie httpOnly (uu tien) hoac tu header Authorization: Bearer <token>
 * (de tien test bang Postman ma khong can gui cookie).
 */
function extractToken(req: Request): string | undefined {
  const cookieToken = req.cookies?.[TOKEN_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }

  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }

  return undefined;
}

/**
 * Middleware bat buoc dang nhap: kiem tra JWT hop le va nguoi dung con ton tai
 * (chua bi xoa mem), sau do gan thong tin ngan gon vao req.user.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const token = extractToken(req);

    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Ban chua dang nhap. Vui long dang nhap de tiep tuc.',
      });
      return;
    }

    const payload = verifyToken(token);

    const user = await prisma.user.findFirst({
      where: { id: payload.userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        tokenVersion: true,
      },
    });

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Tai khoan khong ton tai hoac da bi vo hieu hoa.',
      });
      return;
    }

    // Token khong con khop tokenVersion hien tai (da doi/dat lai mat khau
    // sau khi token nay duoc cap) -> het hieu luc ngay lap tuc.
    if ((payload.tokenVersion ?? -1) !== user.tokenVersion) {
      res.status(401).json({
        success: false,
        message: 'Mat khau da thay doi. Vui long dang nhap lai.',
      });
      return;
    }

    const { tokenVersion: _tv, ...safeUser } = user;
    req.user = safeUser;
    next();
  } catch {
    res.status(401).json({
      success: false,
      message: 'Phien dang nhap khong hop le hoac da het han.',
    });
  }
}

/**
 * Middleware KHONG bat buoc dang nhap: neu co JWT hop le thi gan req.user
 * (giong requireAuth), nguoc lai (khong co token / token khong hop le) van
 * cho request di tiep nhu khach chua dang nhap - khong tra loi 401.
 * Dung cho cac endpoint doc du lieu ma khach cung xem duoc (vd bang PUBLIC).
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  try {
    const token = extractToken(req);
    if (!token) return next();

    const payload = verifyToken(token);
    const user = await prisma.user.findFirst({
      where: { id: payload.userId, deletedAt: null },
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        tokenVersion: true,
      },
    });

    if (user && (payload.tokenVersion ?? -1) === user.tokenVersion) {
      const { tokenVersion: _tv, ...safeUser } = user;
      req.user = safeUser;
    }
  } catch {
    // Token khong hop le -> coi nhu khach chua dang nhap, khong chan request
  }
  next();
}

export { TOKEN_COOKIE_NAME };
