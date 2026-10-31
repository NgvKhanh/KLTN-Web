import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { assignPlanLimiter, assignSuggestLimiter } from '../../middleware/rateLimit.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  getProfileHandler,
  getWeightsHandler,
  outcomeHandler,
  planHandler,
  putProfileHandler,
  putWeightsHandler,
  resetWeightsHandler,
  suggestHandler,
} from './assign.controller';
import { outcomeSchema, weightsSchema, workProfileSchema } from './assign.schema';

// Gan vao /api/cards/:cardId/assignment-suggestions
export const cardAssignRoutes = Router({ mergeParams: true });
cardAssignRoutes.use(requireAuth);
// Limiter dat SAU requireAuth (tinh theo nguoi dung) va TRUOC xu ly (yeu cau bi chan khong ton doc CSDL)
cardAssignRoutes.get('/', assignSuggestLimiter, suggestHandler);

// Gan vao /api/lists/:listId/assignment-plan (lop 2: chia viec cho ca danh sach, chi xem truoc)
export const listAssignRoutes = Router({ mergeParams: true });
listAssignRoutes.use(requireAuth);
listAssignRoutes.post('/', assignPlanLimiter, planHandler);

// Gan vao /api/assignment/runs
export const assignRunRoutes = Router();
assignRunRoutes.use(requireAuth);
assignRunRoutes.post('/:runId/outcome', validateBody(outcomeSchema), outcomeHandler);

// Gan vao /api/workspaces/:workspaceId/assignment-weights
export const workspaceAssignRoutes = Router({ mergeParams: true });
workspaceAssignRoutes.use(requireAuth);
workspaceAssignRoutes.get('/', getWeightsHandler);
workspaceAssignRoutes.put('/', validateBody(weightsSchema), putWeightsHandler);
workspaceAssignRoutes.delete('/', resetWeightsHandler);

// Gan vao /api/workspaces/:workspaceId/assignment-profile (ho so lam viec cua CHINH nguoi goi)
export const workspaceProfileRoutes = Router({ mergeParams: true });
workspaceProfileRoutes.use(requireAuth);
workspaceProfileRoutes.get('/', getProfileHandler);
workspaceProfileRoutes.put('/', validateBody(workProfileSchema), putProfileHandler);
