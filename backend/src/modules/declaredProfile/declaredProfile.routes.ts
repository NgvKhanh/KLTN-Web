import { Router } from 'express';
import { uploadAiDocument } from '../../config/upload';
import { requireAuth } from '../../middleware/auth.middleware';
import { cvUploadLimiter } from '../../middleware/rateLimit.middleware';
import { validateBody, validateQuery } from '../../middleware/validate.middleware';
import {
  cvAccessHandler,
  deleteCvHandler,
  downloadMyCvHandler,
  downloadUserCvHandler,
  getMyProfileHandler,
  putMyProfileHandler,
  uploadCvHandler,
} from './declaredProfile.controller';
import { cvAccessQuerySchema, declaredProfileSchema } from './declaredProfile.schema';

// Gan vao /api/me/assign-profile - ho so tu khai cua CHINH nguoi goi (ASSIGN_MODULE.md §17.9)
export const meAssignProfileRoutes = Router();
meAssignProfileRoutes.use(requireAuth);
meAssignProfileRoutes.get('/', getMyProfileHandler);
meAssignProfileRoutes.put('/', validateBody(declaredProfileSchema), putMyProfileHandler);
// Thu tu: dang nhap -> gioi han toc do -> multer (nhan tep vao BO NHO, chua ghi dia) -> trich chu roi moi luu tep
meAssignProfileRoutes.post('/cv', cvUploadLimiter, uploadAiDocument, uploadCvHandler);
meAssignProfileRoutes.delete('/cv', deleteCvHandler);
meAssignProfileRoutes.get('/cv', downloadMyCvHandler);
// Ai trong danh sach minh tai duoc CV (nut "Xem CV" o danh sach thanh vien bang / khong gian)
meAssignProfileRoutes.get('/cv-access', validateQuery(cvAccessQuerySchema), cvAccessHandler);

// Gan vao /api/users/:userId/assign-profile/cv - chu / quan tri bang chung (hoac khong gian chua bang) tai CV cua thanh vien; con lai 404
export const userCvRoutes = Router({ mergeParams: true });
userCvRoutes.use(requireAuth);
userCvRoutes.get('/', downloadUserCvHandler);
