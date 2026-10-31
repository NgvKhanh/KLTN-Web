import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import type { CreateSavedFilterInput, SearchCardsQuery } from './search.schema';
import {
  createSavedFilter,
  deleteSavedFilter,
  listSavedFilters,
  searchCardsAdvanced,
} from './search.service';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError('Ban chua dang nhap', 401);
  }
  return req.user.id;
}

export const searchCardsAdvancedHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const query = res.locals.query as SearchCardsQuery;
    const result = await searchCardsAdvanced(requireUserId(req), query);
    res.json({ success: true, data: result });
  }
);

export const listSavedFiltersHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const filters = await listSavedFilters(requireUserId(req));
    res.json({ success: true, data: { filters } });
  }
);

export const createSavedFilterHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const filter = await createSavedFilter(
      requireUserId(req),
      req.body as CreateSavedFilterInput
    );
    res
      .status(201)
      .json({ success: true, message: 'Da luu bo loc', data: { filter } });
  }
);

export const deleteSavedFilterHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteSavedFilter(requireUserId(req), req.params.filterId as string);
    res.json({ success: true, message: 'Da xoa bo loc' });
  }
);
