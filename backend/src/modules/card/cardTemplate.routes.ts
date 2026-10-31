import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  createCardTemplateHandler,
  deleteCardTemplateHandler,
  listCardTemplatesHandler,
} from './cardTemplate.controller';
import { createCardTemplateSchema } from './cardTemplate.schema';

// Gan vao /api/boards/:boardId/card-templates
export const boardCardTemplateRoutes = Router({ mergeParams: true });
boardCardTemplateRoutes.use(requireAuth);
boardCardTemplateRoutes.get('/', listCardTemplatesHandler);
boardCardTemplateRoutes.post(
  '/',
  validateBody(createCardTemplateSchema),
  createCardTemplateHandler
);

// Gan vao /api/card-templates
export const cardTemplateRoutes = Router();
cardTemplateRoutes.use(requireAuth);
cardTemplateRoutes.delete('/:templateId', deleteCardTemplateHandler);
