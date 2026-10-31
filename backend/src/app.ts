import cookieParser from 'cookie-parser';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { env } from './config/env';
import { AVATAR_DIR, BOARD_BG_DIR } from './config/upload';
import { optionalAuth } from './middleware/auth.middleware';
import activityRoutes from './modules/activity/activity.routes';
import authRoutes from './modules/auth/auth.routes';
import boardRoutes from './modules/board/board.routes';
import { boardMemberRoutes } from './modules/board/boardMember.routes';
import publicBoardRoutes from './modules/board/publicBoard.routes';
import {
  attachmentRoutes,
  cardRoutes,
  checklistItemRoutes,
  checklistRoutes,
  commentRoutes,
  listCardRoutes,
} from './modules/card/card.routes';
import { serveCardAttachment } from './modules/card/attachment.serve';
import { boardListRoutes, listRoutes } from './modules/list/list.routes';
import { boardLabelRoutes, labelRoutes } from './modules/label/label.routes';
import {
  boardCustomFieldRoutes,
  customFieldOptionRoutes,
  customFieldRoutes,
} from './modules/customField/customField.routes';
import {
  boardCardTemplateRoutes,
  cardTemplateRoutes,
} from './modules/card/cardTemplate.routes';
import {
  automationRoutes,
  boardAutomationRoutes,
} from './modules/automation/automation.routes';
import {
  listRecurringScheduleRoutes,
  recurringScheduleRoutes,
} from './modules/card/recurringSchedule.routes';
import { aiRoutes } from './modules/ai/ai.routes';
import { chatRoutes } from './modules/chat/chat.routes';
import {
  assignRunRoutes,
  cardAssignRoutes,
  listAssignRoutes,
  workspaceAssignRoutes,
  workspaceProfileRoutes,
} from './modules/assign/assign.routes';
import { meAssignProfileRoutes, userCvRoutes } from './modules/declaredProfile/declaredProfile.routes';
import notificationRoutes from './modules/notification/notification.routes';
import { cardRiskRoutes } from './modules/risk/risk.routes';
import searchRoutes from './modules/search/search.routes';
import unsplashRoutes from './modules/unsplash/unsplash.routes';
import workspaceRoutes from './modules/workspace/workspace.routes';
import { AppError } from './utils/AppError';
import { clientErrorOf } from './utils/clientError';

/**
 * Tao va cau hinh Express app.
 * Tach rieng khoi server.ts de sau nay co the dung lai cho viec test.
 */
export function createApp() {
  const app = express();

  // Khong lo "X-Powered-By: Express" (helmet cung bo header nay; dat ro de khong phu thuoc phien ban)
  app.disable('x-powered-by');
  // Sau reverse proxy phai khai bao TRUST_PROXY, neu khong moi gioi han theo IP gop chung ca nguoi dung
  if (env.trustProxy !== null) app.set('trust proxy', env.trustProxy);

  // Bo header an toan (X-Content-Type-Options, X-Frame-Options, Referrer-Policy...).
  app.use(
    helmet({
      // Anh dai dien / anh nen / tep the duoc nhung tu frontend o NGUON KHAC (localhost:5173 -> :4000).
      // Mac dinh "same-origin" cua helmet se chan <img src=".../uploads/...">.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // API tra JSON va tep tinh, khong phuc vu trang HTML: CSP chat chi co loi (chan neu mot phan hoi
      // bi trinh duyet hieu nham la HTML), khong anh huong anh / tep.
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      // HSTS chi co y nghia qua HTTPS: bat o production, tat o dev (http://localhost).
      strictTransportSecurity: env.isProduction ? { maxAge: 15_552_000 } : false,
    })
  );

  // Chi cho phep frontend trong danh sach CORS_ORIGIN goi API
  app.use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    })
  );

  // Doc du lieu JSON gui len (gioi han 1mb de tranh request qua lon)
  // Chi nhan JSON (va multipart o cac route upload, do multer xu ly rieng). KHONG bat urlencoded: khong
  // endpoint nao dung, va nhan form-post cheo trang se la cua ngo CSRF cho moi route co cookie.
  app.use(express.json({ limit: '1mb' }));
  // Doc cookie (dung de lay JWT luu trong cookie httpOnly)
  app.use(cookieParser());

  // Route kiem tra server con song hay khong
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      success: true,
      message: 'Server dang chay',
      environment: env.nodeEnv,
      timestamp: new Date().toISOString(),
    });
  });

  // Tep dinh kem cua the: co the thuoc bang RIENG TU -> phai kiem tra quyen.
  // Dung optionalAuth (khong ep dang nhap) vi bang PUBLIC thi khach cung xem
  // duoc tep - serveCardAttachment tu quyet dinh qua assertBoardView.
  app.use('/uploads/cards', optionalAuth, serveCardAttachment);

  // Phuc vu file tinh CONG KHAI da tai len: chi tung thu muc duoc phep, KHONG
  // BAO GIO mount static tren toan bo UPLOAD_ROOT (thu muc cha con chua
  // "cards" la du lieu rieng tu). Neu mount ca UPLOAD_ROOT, mot request voi
  // doan duong dan ma hoa (vd "/uploads/%63ards/<file>") se khong khop tien
  // to "/uploads/cards" o tren nhung van duoc express.static giai ma va phuc
  // vu thang tu dia, bo qua hoan toan kiem tra quyen phia tren.
  app.use('/uploads/avatars', express.static(AVATAR_DIR));
  app.use('/uploads/boards', express.static(BOARD_BG_DIR));

  app.use('/api/auth', authRoutes);
  app.use('/api/workspaces/:workspaceId/assignment-weights', workspaceAssignRoutes);
  app.use('/api/workspaces/:workspaceId/assignment-profile', workspaceProfileRoutes);
  app.use('/api/me/assign-profile', meAssignProfileRoutes);
  app.use('/api/users/:userId/assign-profile/cv', userCvRoutes);
  app.use('/api/workspaces', workspaceRoutes);
  app.use('/api/activities', activityRoutes);
  app.use('/api/boards/:boardId/lists', boardListRoutes);
  app.use('/api/boards/:boardId/members', boardMemberRoutes);
  app.use('/api/boards/:boardId/labels', boardLabelRoutes);
  app.use('/api/boards/:boardId/custom-fields', boardCustomFieldRoutes);
  app.use('/api/boards/:boardId/card-templates', boardCardTemplateRoutes);
  app.use('/api/boards/:boardId/automation-rules', boardAutomationRoutes);
  app.use('/api/boards', boardRoutes);
  app.use('/api/automation-rules', automationRoutes);
  app.use('/api/lists/:listId/cards', listCardRoutes);
  app.use('/api/lists/:listId/recurring-schedules', listRecurringScheduleRoutes);
  app.use('/api/lists/:listId/assignment-plan', listAssignRoutes);
  app.use('/api/lists', listRoutes);
  app.use('/api/recurring-schedules', recurringScheduleRoutes);
  app.use('/api/cards/:cardId/assignment-suggestions', cardAssignRoutes);
  app.use('/api/cards/:cardId/risk', cardRiskRoutes);
  app.use('/api/assignment/runs', assignRunRoutes);
  app.use('/api/cards', cardRoutes);
  app.use('/api/search', searchRoutes);
  app.use('/api/checklists', checklistRoutes);
  app.use('/api/checklist-items', checklistItemRoutes);
  app.use('/api/attachments', attachmentRoutes);
  app.use('/api/comments', commentRoutes);
  app.use('/api/labels', labelRoutes);
  app.use('/api/custom-fields', customFieldRoutes);
  app.use('/api/custom-field-options', customFieldOptionRoutes);
  app.use('/api/card-templates', cardTemplateRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/unsplash', unsplashRoutes);
  app.use('/api/ai', aiRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/public', publicBoardRoutes);

  // Khong khop route nao -> tra ve 404 dang JSON
  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      message: `Khong tim thay duong dan: ${req.method} ${req.originalUrl}`,
    });
  });

  // Bat moi loi phat sinh trong app va tra ve dang JSON thong nhat
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        success: false,
        message: err.message,
        ...(err.code ? { code: err.code } : {}),
        ...(err.data ? { data: err.data } : {}),
      });
      return;
    }

    // Loi do client gui (JSON sai cu phap, body qua lon...): 4xx, khong phai loi he thong
    const clientError = clientErrorOf(err);
    if (clientError) {
      res.status(clientError.status).json({ success: false, message: clientError.message });
      return;
    }

    const message =
      err instanceof Error ? err.message : 'Loi khong xac dinh tu server';

    console.error('[LOI SERVER]', err);

    res.status(500).json({
      success: false,
      message: env.isProduction ? 'Loi he thong, vui long thu lai sau' : message,
    });
  });

  return app;
}
