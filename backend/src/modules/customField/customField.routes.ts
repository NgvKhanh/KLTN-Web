import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  addFieldOptionHandler,
  createCustomFieldHandler,
  deleteCustomFieldHandler,
  deleteFieldOptionHandler,
  listCustomFieldsHandler,
  updateCustomFieldHandler,
  updateFieldOptionHandler,
} from './customField.controller';
import {
  addFieldOptionSchema,
  createCustomFieldSchema,
  updateCustomFieldSchema,
  updateFieldOptionSchema,
} from './customField.schema';

// Gan vao /api/boards/:boardId/custom-fields
export const boardCustomFieldRoutes = Router({ mergeParams: true });
boardCustomFieldRoutes.use(requireAuth);
boardCustomFieldRoutes.get('/', listCustomFieldsHandler);
boardCustomFieldRoutes.post(
  '/',
  validateBody(createCustomFieldSchema),
  createCustomFieldHandler
);

// Gan vao /api/custom-fields
export const customFieldRoutes = Router();
customFieldRoutes.use(requireAuth);
customFieldRoutes.patch(
  '/:fieldId',
  validateBody(updateCustomFieldSchema),
  updateCustomFieldHandler
);
customFieldRoutes.delete('/:fieldId', deleteCustomFieldHandler);
customFieldRoutes.post(
  '/:fieldId/options',
  validateBody(addFieldOptionSchema),
  addFieldOptionHandler
);

// Gan vao /api/custom-field-options
export const customFieldOptionRoutes = Router();
customFieldOptionRoutes.use(requireAuth);
customFieldOptionRoutes.patch(
  '/:optionId',
  validateBody(updateFieldOptionSchema),
  updateFieldOptionHandler
);
customFieldOptionRoutes.delete('/:optionId', deleteFieldOptionHandler);
