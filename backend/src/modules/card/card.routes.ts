import { Router } from 'express';
import { uploadCardAttachment } from '../../config/upload';
import { requireAuth } from '../../middleware/auth.middleware';
import {
  cleanupUploadOnError,
  requireCardAccess,
} from '../../middleware/uploadGuard.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { setCardWatchHandler } from '../watch/watch.controller';
import { setCardFieldValueHandler } from '../customField/customField.controller';
import { setCardFieldValueSchema } from '../customField/customField.schema';
import {
  applyCardTemplateHandler,
  saveCardAsTemplateHandler,
} from './cardTemplate.controller';
import {
  applyCardTemplateSchema,
  saveCardAsTemplateSchema,
} from './cardTemplate.schema';
import {
  archiveCardHandler,
  copyCardHandler,
  createCardHandler,
  deleteCardHandler,
  listCalendarHandler,
  listMyCardsHandler,
  moveCardHandler,
  purgeCardHandler,
  restoreCardHandler,
  searchCardsHandler,
  updateCardHandler,
} from './card.controller';
import {
  copyCardSchema,
  createCardSchema,
  createReminderSchema,
  moveCardSchema,
  updateCardSchema,
} from './card.schema';
import {
  addAttachmentHandler,
  addCardMemberHandler,
  addCardReminderHandler,
  addChecklistHandler,
  addChecklistItemHandler,
  addCommentHandler,
  attachLabelHandler,
  convertItemToCardHandler,
  deleteAttachmentHandler,
  deleteChecklistHandler,
  deleteChecklistItemHandler,
  deleteCommentHandler,
  detachLabelHandler,
  getCardDetailHandler,
  listCardRemindersHandler,
  removeCardMemberHandler,
  removeCardReminderHandler,
  reorderChecklistItemsHandler,
  updateChecklistHandler,
  updateChecklistItemHandler,
  updateCommentHandler,
} from './cardExtras.controller';
import {
  addCardMemberSchema,
  addChecklistItemSchema,
  addChecklistSchema,
  commentSchema,
  createCommentSchema,
  reorderChecklistItemsSchema,
  updateChecklistItemSchema,
  updateChecklistSchema,
} from './cardExtras.schema';

// Gan vao /api/lists/:listId/cards
export const listCardRoutes = Router({ mergeParams: true });
listCardRoutes.use(requireAuth);
listCardRoutes.post('/', validateBody(createCardSchema), createCardHandler);
listCardRoutes.post(
  '/from-template/:templateId',
  validateBody(applyCardTemplateSchema),
  applyCardTemplateHandler
);

// Gan vao /api/cards
export const cardRoutes = Router();
cardRoutes.use(requireAuth);

cardRoutes.get('/mine', listMyCardsHandler);
cardRoutes.get('/calendar', listCalendarHandler);
cardRoutes.get('/search', searchCardsHandler);
cardRoutes.get('/:cardId', getCardDetailHandler);
cardRoutes.put('/:cardId/watch', setCardWatchHandler);
cardRoutes.put(
  '/:cardId/custom-fields/:fieldId',
  validateBody(setCardFieldValueSchema),
  setCardFieldValueHandler
);
cardRoutes.post(
  '/:cardId/save-as-template',
  validateBody(saveCardAsTemplateSchema),
  saveCardAsTemplateHandler
);
cardRoutes.patch('/:cardId', validateBody(updateCardSchema), updateCardHandler);
cardRoutes.patch('/:cardId/move', validateBody(moveCardSchema), moveCardHandler);
cardRoutes.post('/:cardId/copy', validateBody(copyCardSchema), copyCardHandler);
cardRoutes.post('/:cardId/archive', archiveCardHandler);
cardRoutes.post('/:cardId/restore', restoreCardHandler);
cardRoutes.delete('/:cardId/purge', purgeCardHandler);
cardRoutes.delete('/:cardId', deleteCardHandler);

// Thanh vien the
cardRoutes.post(
  '/:cardId/members',
  validateBody(addCardMemberSchema),
  addCardMemberHandler
);
cardRoutes.delete('/:cardId/members/:userId', removeCardMemberHandler);

// Nhan tren the
cardRoutes.put('/:cardId/labels/:labelId', attachLabelHandler);
cardRoutes.delete('/:cardId/labels/:labelId', detachLabelHandler);

// Checklist
cardRoutes.post(
  '/:cardId/checklists',
  validateBody(addChecklistSchema),
  addChecklistHandler
);

// Nhac han (rieng cho nguoi dat, khong dung chung giua cac thanh vien the)
cardRoutes.get('/:cardId/reminders', listCardRemindersHandler);
cardRoutes.post(
  '/:cardId/reminders',
  validateBody(createReminderSchema),
  addCardReminderHandler
);
cardRoutes.delete(
  '/:cardId/reminders/:offsetMinutes',
  removeCardReminderHandler
);

// Binh luan
cardRoutes.post(
  '/:cardId/comments',
  validateBody(createCommentSchema),
  addCommentHandler
);

// Tep dinh kem (multipart, field "file")
// Kiem tra quyen the TRUOC khi ghi file; don file rac neu handler loi.
cardRoutes.post(
  '/:cardId/attachments',
  requireCardAccess,
  uploadCardAttachment,
  addAttachmentHandler,
  cleanupUploadOnError
);

// Gan vao /api/checklists
export const checklistRoutes = Router();
checklistRoutes.use(requireAuth);
checklistRoutes.patch(
  '/:checklistId',
  validateBody(updateChecklistSchema),
  updateChecklistHandler
);
checklistRoutes.delete('/:checklistId', deleteChecklistHandler);
checklistRoutes.post(
  '/:checklistId/items',
  validateBody(addChecklistItemSchema),
  addChecklistItemHandler
);
checklistRoutes.patch(
  '/:checklistId/reorder',
  validateBody(reorderChecklistItemsSchema),
  reorderChecklistItemsHandler
);

// Gan vao /api/checklist-items
export const checklistItemRoutes = Router();
checklistItemRoutes.use(requireAuth);
checklistItemRoutes.patch(
  '/:itemId',
  validateBody(updateChecklistItemSchema),
  updateChecklistItemHandler
);
checklistItemRoutes.post('/:itemId/convert-to-card', convertItemToCardHandler);
checklistItemRoutes.delete('/:itemId', deleteChecklistItemHandler);

// Gan vao /api/attachments
export const attachmentRoutes = Router();
attachmentRoutes.use(requireAuth);
attachmentRoutes.delete('/:attachmentId', deleteAttachmentHandler);

// Gan vao /api/comments
export const commentRoutes = Router();
commentRoutes.use(requireAuth);
commentRoutes.patch(
  '/:commentId',
  validateBody(commentSchema),
  updateCommentHandler
);
commentRoutes.delete('/:commentId', deleteCommentHandler);
