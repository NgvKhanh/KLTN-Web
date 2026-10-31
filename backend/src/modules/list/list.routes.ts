import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  archiveListHandler,
  copyListHandler,
  createListHandler,
  deleteAllCardsHandler,
  deleteListHandler,
  listBoardListsHandler,
  moveAllCardsHandler,
  purgeListHandler,
  restoreListHandler,
  sortListHandler,
  updateListHandler,
} from './list.controller';
import {
  createListSchema,
  moveAllCardsSchema,
  sortListSchema,
  updateListSchema,
} from './list.schema';
import { getListWatchHandler, setListWatchHandler } from '../watch/watch.controller';

// Gan vao /api/boards/:boardId/lists
export const boardListRoutes = Router({ mergeParams: true });
boardListRoutes.use(requireAuth);
boardListRoutes.get('/', listBoardListsHandler);
boardListRoutes.post('/', validateBody(createListSchema), createListHandler);

// Gan vao /api/lists
export const listRoutes = Router();
listRoutes.use(requireAuth);
listRoutes.patch('/:listId', validateBody(updateListSchema), updateListHandler);
listRoutes.get('/:listId/watch', getListWatchHandler);
listRoutes.put('/:listId/watch', setListWatchHandler);
listRoutes.post('/:listId/archive', archiveListHandler);
listRoutes.post('/:listId/restore', restoreListHandler);
listRoutes.delete('/:listId/purge', purgeListHandler);
listRoutes.delete('/:listId', deleteListHandler);

// Thao tac nang cao voi 1 danh sach
listRoutes.post('/:listId/copy', copyListHandler);
listRoutes.post(
  '/:listId/move-all-cards',
  validateBody(moveAllCardsSchema),
  moveAllCardsHandler
);
listRoutes.patch('/:listId/sort', validateBody(sortListSchema), sortListHandler);
listRoutes.delete('/:listId/cards', deleteAllCardsHandler);
