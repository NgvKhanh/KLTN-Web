import { NextFunction, Request, Response } from 'express';

type AsyncRouteHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

/**
 * Boc 1 route handler bat dong bo: neu Promise bi reject (co loi),
 * tu dong chuyen loi do cho next() de middleware xu ly loi tap trung bat duoc,
 * thay vi phai viet try/catch lap lai o moi controller.
 */
export function asyncHandler(handler: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}
