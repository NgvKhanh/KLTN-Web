import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  createLabelHandler,
  deleteLabelHandler,
  listBoardLabelsHandler,
  updateLabelHandler,
} from './label.controller';
import { createLabelSchema, updateLabelSchema } from '../card/cardExtras.schema';

// Gan vao /api/boards/:boardId/labels
export const boardLabelRoutes = Router({ mergeParams: true });
boardLabelRoutes.use(requireAuth);
boardLabelRoutes.get('/', listBoardLabelsHandler);
boardLabelRoutes.post('/', validateBody(createLabelSchema), createLabelHandler);

// Gan vao /api/labels
export const labelRoutes = Router();
labelRoutes.use(requireAuth);
labelRoutes.patch(
  '/:labelId',
  validateBody(updateLabelSchema),
  updateLabelHandler
);
labelRoutes.delete('/:labelId', deleteLabelHandler);
