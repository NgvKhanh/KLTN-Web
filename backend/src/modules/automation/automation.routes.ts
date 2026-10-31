import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  createAutomationRuleHandler,
  deleteAutomationRuleHandler,
  listAutomationRulesHandler,
  updateAutomationRuleHandler,
} from './automation.controller';
import {
  createAutomationRuleSchema,
  updateAutomationRuleSchema,
} from './automation.schema';

// Gan vao /api/boards/:boardId/automation-rules
export const boardAutomationRoutes = Router({ mergeParams: true });
boardAutomationRoutes.use(requireAuth);
boardAutomationRoutes.get('/', listAutomationRulesHandler);
boardAutomationRoutes.post(
  '/',
  validateBody(createAutomationRuleSchema),
  createAutomationRuleHandler
);

// Gan vao /api/automation-rules
export const automationRoutes = Router();
automationRoutes.use(requireAuth);
automationRoutes.patch(
  '/:ruleId',
  validateBody(updateAutomationRuleSchema),
  updateAutomationRuleHandler
);
automationRoutes.delete('/:ruleId', deleteAutomationRuleHandler);
