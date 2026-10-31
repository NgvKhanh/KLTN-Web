import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { AppError } from '../utils/AppError';

// Thu muc luu file tai len (nam ngoai src, khong commit len git). Bien moi truong UPLOAD_ROOT CHI de test tro sang thu muc tam
// (test/uploadsIsolation.ts): thu muc that duoc bind-mount chung voi backend trong Docker, test ghi / xoa vao do la mat tep that
// cua nguoi dung (04/10 da mat mot CV vi vay). Ung dung va Docker khong dat bien nay.
export const UPLOAD_ROOT = process.env.UPLOAD_ROOT ? path.resolve(process.env.UPLOAD_ROOT) : path.join(process.cwd(), 'uploads');
// CHI xuat cac thu muc CONG KHAI (avatars, boards) de app.ts mount static
// dung tung thu muc do. KHONG bao gio mount static tren UPLOAD_ROOT: no chua
// ca CARD_ATTACH_DIR (rieng tu) va lam vo hieu lop kiem tra quyen o
// attachment.serve.ts (vi du request toi /uploads/%63ards/<file> khong khop
// prefix "/uploads/cards" nhung van duoc express.static giai ma va phuc vu).
export const BOARD_BG_DIR = path.join(UPLOAD_ROOT, 'boards');
export const AVATAR_DIR = path.join(UPLOAD_ROOT, 'avatars');
const CARD_ATTACH_DIR = path.join(UPLOAD_ROOT, 'cards');

fs.mkdirSync(BOARD_BG_DIR, { recursive: true });
fs.mkdirSync(CARD_ATTACH_DIR, { recursive: true });
fs.mkdirSync(AVATAR_DIR, { recursive: true });

// Chi cho phep vai dinh dang anh; suy ra duoi file tu mime de khong tin ten goc
const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, BOARD_BG_DIR),
  filename: (_req, file, cb) => {
    const ext = MIME_TO_EXT[file.mimetype] ?? '';
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const boardBackgroundUpload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (MIME_TO_EXT[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new AppError('Chi chap nhan anh JPG, PNG, WEBP hoac GIF', 400));
    }
  },
});

/**
 * Middleware nhan 1 file o field "image", da chuyen loi cua Multer
 * thanh AppError de tra ve JSON thong nhat (400) thay vi 500 kho hieu.
 */
export function uploadBoardBackground(
  req: Request,
  res: Response,
  next: NextFunction
) {
  boardBackgroundUpload.single('image')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      next(new AppError('Anh qua lon (toi da 5MB)', 400));
      return;
    }
    next(err instanceof AppError ? err : new AppError('Tai anh len that bai', 400));
  });
}

// Duong dan cong khai (luu vao DB) tu ten file
export function boardBackgroundPublicPath(filename: string): string {
  return `/uploads/boards/${filename}`;
}

// ===================== ANH DAI DIEN =====================

const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2MB

const avatarUploadMw = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
    filename: (_req, file, cb) => {
      const ext = MIME_TO_EXT[file.mimetype] ?? '';
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: AVATAR_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (MIME_TO_EXT[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new AppError('Chỉ chấp nhận ảnh JPG, PNG, WEBP hoặc GIF', 400));
    }
  },
});

export function uploadAvatar(req: Request, res: Response, next: NextFunction) {
  avatarUploadMw.single('image')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      next(new AppError('Ảnh quá lớn (tối đa 2MB)', 400));
      return;
    }
    next(err instanceof AppError ? err : new AppError('Tải ảnh lên thất bại', 400));
  });
}

export function avatarPublicPath(filename: string): string {
  return `/uploads/avatars/${filename}`;
}

export function removeAvatarFile(publicPath: string | null): void {
  if (!publicPath || !publicPath.startsWith('/uploads/avatars/')) return;
  fs.promises
    .unlink(path.join(AVATAR_DIR, path.basename(publicPath)))
    .catch(() => {});
}

// ===================== TEP DINH KEM CUA THE =====================

export const ATTACH_MAX_BYTES = 10 * 1024 * 1024; // 10MB
export const ATTACH_ALLOWED_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
  '.pdf',
  '.txt',
  '.csv',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.zip',
]);

// Content-Type SUY TU DUOI FILE (dang tin cay) khi phuc vu tep - KHONG BAO GIO
// dung file.mimetype nguoi upload tu khai bao. Nguoi upload co the dat ten
// "bao-cao.txt" nhung khai Content-Type "text/html" trong multipart; neu server
// phuc vu lai dung gia tri do va cho mo "inline", trinh duyet se dung noi dung
// nhu HTML -> XSS luu tru tren origin cua backend.
const ATTACH_EXT_TO_TRUSTED_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.csv': 'text/plain', // khong dung text/csv: mot so trinh duyet tu mo bang, van an toan hon la de lo Content-Type nguoi dung tu khai
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
};

// Chi anh moi duoc mo TRUC TIEP (Content-Disposition: inline) tren trinh duyet;
// cac dinh dang con lai LUON ep tai xuong, du client co truyen ?download hay
// khong, de trinh duyet khong bao gio "dung" duoc noi dung tren origin backend.
const ATTACH_INLINE_SAFE_EXT = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.gif',
]);

/** Content-Type an toan de phuc vu 1 tep dinh kem, suy tu ten file (duoi). */
export function trustedAttachmentContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return ATTACH_EXT_TO_TRUSTED_MIME[ext] ?? 'application/octet-stream';
}

/** True neu dinh dang nay duoc phep mo inline (chi anh); con lai phai tai xuong. */
export function isInlineSafeAttachment(filename: string): boolean {
  return ATTACH_INLINE_SAFE_EXT.has(path.extname(filename).toLowerCase());
}

const cardAttachmentUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, CARD_ATTACH_DIR),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(
        null,
        `${crypto.randomUUID()}${ATTACH_ALLOWED_EXT.has(ext) ? ext : ''}`
      );
    },
  }),
  limits: { fileSize: ATTACH_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ATTACH_ALLOWED_EXT.has(ext)) {
      cb(null, true);
    } else {
      cb(new AppError('Định dạng tệp không được hỗ trợ', 400));
    }
  },
});

export function uploadCardAttachment(
  req: Request,
  res: Response,
  next: NextFunction
) {
  cardAttachmentUpload.single('file')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      next(new AppError('Tệp quá lớn (tối đa 10MB)', 400));
      return;
    }
    next(err instanceof AppError ? err : new AppError('Tải tệp lên thất bại', 400));
  });
}

/**
 * Dua mot tep DA CO tren dia (kho tam cua chatbot) vao thu muc tep dinh kem cua the voi ten UUID moi (giu duoi da kiem). Tra ve ten tep + duong dan cong khai.
 * Dung copy roi de nguoi goi xoa tep nguon sau khi ghi CSDL thanh cong (neu giao dich hong thi tep nguon con de thu lai).
 */
export function adoptCardAttachmentFile(sourcePath: string, ext: string): { filename: string; publicPath: string } {
  const safeExt = ATTACH_ALLOWED_EXT.has(ext.toLowerCase()) ? ext.toLowerCase() : '';
  const filename = `${crypto.randomUUID()}${safeExt}`;
  fs.copyFileSync(sourcePath, path.join(CARD_ATTACH_DIR, filename));
  return { filename, publicPath: cardAttachmentPublicPath(filename) };
}

export function cardAttachmentPublicPath(filename: string): string {
  return `/uploads/cards/${filename}`;
}

// Duong dan tuyet doi tren o dia cua 1 tep dinh kem (tu ten file hoac public path).
// Dung path.basename de chan path traversal (../).
export function cardAttachmentDiskPath(filenameOrPath: string): string {
  return path.join(CARD_ATTACH_DIR, path.basename(filenameOrPath));
}

export function removeCardAttachmentFile(publicPath: string | null): void {
  if (!publicPath || !publicPath.startsWith('/uploads/cards/')) return;
  const fullPath = path.join(CARD_ATTACH_DIR, path.basename(publicPath));
  fs.promises.unlink(fullPath).catch(() => {
    // File co the da bi xoa -> bo qua
  });
}

// ===================== TEP VAN BAN CHO MODULE AI =====================

// Tep chi de TRICH CHU roi bo: memoryStorage (khong ghi xuong dia -> khong co file rac can don).
// Noi dung that (magic bytes, zip bomb...) duoc kiem o modules/ai/ai.document.ts.
export const AI_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const AI_DOCUMENT_EXT = new Set(['.pdf', '.docx']);

const aiDocumentUploadMw = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AI_DOCUMENT_MAX_BYTES, files: 1, fields: 5, parts: 8 },
  fileFilter: (_req, file, cb) => {
    // Loc som theo duoi de khong phai nhan 5MB cua tep chac chan bi tu choi
    if (AI_DOCUMENT_EXT.has(path.extname(file.originalname).toLowerCase())) {
      cb(null, true);
    } else {
      cb(new AppError('Chỉ hỗ trợ tệp .docx hoặc .pdf', 400));
    }
  },
});

/** Nhan 1 tep o field "file" vao req.file.buffer; loi cua Multer doi thanh AppError 400. */
export function uploadAiDocument(req: Request, res: Response, next: NextFunction) {
  aiDocumentUploadMw.single('file')(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        next(new AppError('Tệp quá lớn (tối đa 5MB)', 400));
        return;
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        next(new AppError('Sai tên trường tệp (cần "file")', 400));
        return;
      }
    }
    next(err instanceof AppError ? err : new AppError('Tải tệp lên thất bại', 400));
  });
}

// Xoa file anh nen cu tren dia (bo qua neu khong con)
export function removeBoardBackgroundFile(publicPath: string | null): void {
  if (!publicPath) return;
  // Chi xoa file do minh luu (duong dan /uploads/boards/...). Anh ngoai
  // (vd link Unsplash) khong co file tren dia nen bo qua.
  if (!publicPath.startsWith('/uploads/boards/')) return;
  const filename = path.basename(publicPath);
  const fullPath = path.join(BOARD_BG_DIR, filename);
  fs.promises.unlink(fullPath).catch(() => {
    // File co the da bi xoa truoc do -> bo qua
  });
}

// ===================== CV CUA HO SO TU KHAI (goi y phan cong, buoc 17) =====================

// Du lieu ca nhan NHAY CAM: thu muc RIENG, KHONG BAO GIO mount static (xem ghi chu UPLOAD_ROOT o tren). Tep chi di qua
// declaredProfile.controller.ts (kiem quyen, luon tai xuong). Nhan tep bang uploadAiDocument (bo nho) - chi ghi xuong day SAU khi
// trich chu thanh cong; ten tren dia = UUID + duoi theo LOAI DA KIEM (khong lay tu ten nguoi dung).
export const CV_DIR = path.join(UPLOAD_ROOT, 'cv');
fs.mkdirSync(CV_DIR, { recursive: true });

const CV_EXT_TO_TRUSTED_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Duong dan tuyet doi cua 1 tep CV tu ten luu (path.basename chan ../). */
export function cvDiskPath(storedName: string): string {
  return path.join(CV_DIR, path.basename(storedName));
}

/** Content-Type tin cay suy tu duoi cua ten LUU (may chu dat); duoi la -> octet-stream. */
export function trustedCvContentType(storedName: string): string {
  return CV_EXT_TO_TRUSTED_MIME[path.extname(storedName).toLowerCase()] ?? 'application/octet-stream';
}

/** Xoa 1 tep CV (bo qua neu khong con). Cho xong moi tra ve - de "xoa CV" xoa that truoc khi bao thanh cong. */
export async function removeCvFile(storedName: string | null): Promise<void> {
  if (!storedName) return;
  await fs.promises.unlink(cvDiskPath(storedName)).catch(() => {});
}
