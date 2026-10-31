import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.middleware';
import {
  validateBody,
  validateQuery,
} from '../../middleware/validate.middleware';
import {
  createSavedFilterHandler,
  deleteSavedFilterHandler,
  listSavedFiltersHandler,
  searchCardsAdvancedHandler,
} from './search.controller';
import { createSavedFilterSchema, searchCardsQuerySchema } from './search.schema';

const router = Router();

router.use(requireAuth);

// Tim the nang cao, xuyen moi bang, co phan trang
router.get('/cards', validateQuery(searchCardsQuerySchema), searchCardsAdvancedHandler);

// Bo loc ca nhan da luu
router.get('/filters', listSavedFiltersHandler);
router.post('/filters', validateBody(createSavedFilterSchema), createSavedFilterHandler);
router.delete('/filters/:filterId', deleteSavedFilterHandler);

export default router;
