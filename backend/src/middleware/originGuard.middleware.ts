import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { AppError } from '../utils/AppError';

/** Doc du lieu, khong doi trang thai -> khong can chan (CORS da chan trang la DOC ket qua). */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Header Origin co duoc phep khong. Khong co Origin (curl, server goi server, test) -> cho qua: trinh duyet
 * LUON gui Origin voi request ghi cheo trang va voi ket noi WebSocket, nen trang la khong the giau no di.
 */
export function isAllowedOrigin(origin: string | undefined, allowedOrigins: readonly string[]): boolean {
  return origin === undefined || allowedOrigins.includes(origin);
}

/**
 * Chan request GHI (POST/PUT/PATCH/DELETE) gui tu trang web khong nam trong CORS_ORIGIN.
 *
 * CORS chi chan trang la DOC phan hoi, khong chan request duoc GUI di: form tu trang la (multipart, hoac POST
 * khong body) van toi server kem cookie neu cookie la SameSite=None (COOKIE_SAMESITE=none khi frontend va backend
 * o hai ten mien khac nhau). Middleware nay tra 403 truoc khi request cham toi route nao (ke ca multer ghi file).
 */
export function originGuard(allowedOrigins: readonly string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method) || isAllowedOrigin(req.get('origin'), allowedOrigins)) {
      return next();
    }
    next(new AppError('Yeu cau den tu nguon khong duoc phep', 403, { code: 'ORIGIN_NOT_ALLOWED' }));
  };
}
