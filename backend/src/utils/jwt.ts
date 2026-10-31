import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export interface JwtPayload {
  userId: string;
  // So phien tai thoi diem ky. Phai khop User.tokenVersion moi con hieu luc
  // (doi/dat lai mat khau se tang User.tokenVersion -> thu hoi ngay lap tuc,
  // khong phu thuoc thoi gian nen khong bi sai so giay nhu cach dung iat cu).
  tokenVersion: number;
  // Do jsonwebtoken tu them khi ky (giay).
  iat?: number;
  exp?: number;
}

/** Ky 1 JWT chua userId + tokenVersion, dung khi dang nhap/dang ky thanh cong. */
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn,
  } as SignOptions);
}

/**
 * Xac minh JWT. Nem loi neu token khong hop le hoac het han,
 * noi goi phai tu bat loi nay (asyncHandler se chuyen ve middleware loi).
 */
export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}
