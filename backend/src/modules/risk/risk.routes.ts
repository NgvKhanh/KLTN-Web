import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import { getCardRiskHandler } from './risk.controller';

// Gan vao /api/cards/:cardId/risk
export const cardRiskRoutes = Router({ mergeParams: true });
cardRiskRoutes.use(requireAuth);
cardRiskRoutes.get('/', getCardRiskHandler);
