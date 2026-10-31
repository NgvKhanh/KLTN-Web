// TEP TAI LEN TRONG KHUNG CHAT (buoc G): nguoi dung chon tep o khung chat, tep nam o KHO TAM (khong cong khai) cho toi khi mot ke hoach ADD_ATTACHMENT duoc
// ap dung. Khong co bang CSDL: moi tep co mot tep metadata `<id>.json` canh no (chu so huu, ten goc, kich thuoc, duoi, gio tai len), tu het han sau 60 phut.
//
// AN TOAN: kho tam nam duoi UPLOAD_ROOT nhung KHONG duoc mount static (app.ts chi mount avatars / boards va tep the qua serveCardAttachment co kiem quyen);
// cung danh sach duoi tep + gioi han 10 MB nhu tep dinh kem cua the; ten tep tren dia la UUID (khong dung ten goc); moi thao tac kiem chu so huu.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { AppError } from '../../../../utils/AppError';
import { ATTACH_ALLOWED_EXT, ATTACH_MAX_BYTES, UPLOAD_ROOT } from '../../../../config/upload';

export const CHAT_STAGING_DIR = path.join(UPLOAD_ROOT, 'chat-staging');
export const STAGED_TTL_MS = 60 * 60_000;
export const MAX_STAGED_PER_MESSAGE = 5;
/** Moi nguoi dung chi giu toi da bay nhieu tep o kho tam cung luc (chong day o dia). */
export const MAX_STAGED_PER_USER = 10;

fs.mkdirSync(CHAT_STAGING_DIR, { recursive: true });

export interface StagedUpload {
  id: string;
  userId: string;
  /** Ten goc (da cat 200 ky tu, giai ma UTF-8). */
  name: string;
  size: number;
  /** Duoi tep (da kiem danh sach cho phep), vd ".pdf". */
  ext: string;
  createdAt: string;
}

/** Phan cua mot tep tam ma ke hoach luu lai (khong co userId / duong dan). */
export interface StagedUploadRef {
  id: string;
  name: string;
  size: number;
  ext: string;
}
export const refOf = (u: StagedUpload): StagedUploadRef => ({ id: u.id, name: u.name, size: u.size, ext: u.ext });

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const filePath = (id: string): string => path.join(CHAT_STAGING_DIR, id);
const metaPath = (id: string): string => path.join(CHAT_STAGING_DIR, `${id}.json`);

const staging = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, CHAT_STAGING_DIR),
    filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: ATTACH_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(Buffer.from(file.originalname, 'latin1').toString('utf8')).toLowerCase();
    if (ATTACH_ALLOWED_EXT.has(ext)) cb(null, true);
    else cb(new AppError('Định dạng tệp không được hỗ trợ', 400));
  },
});

/** Middleware multipart (truong "file"): ghi vao kho tam; loi quy ve AppError tieng Viet. */
export function stageUploadMiddleware(req: Request, res: Response, next: NextFunction): void {
  staging.single('file')(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return next(new AppError('Tệp quá lớn (tối đa 10MB)', 400));
    return next(err instanceof AppError ? err : new AppError('Tải tệp lên thất bại', 400));
  });
}

async function unlinkQuiet(p: string): Promise<void> {
  await fs.promises.unlink(p).catch(() => undefined);
}

async function readMeta(id: string): Promise<StagedUpload | null> {
  if (!ID_RE.test(id)) return null;
  try {
    const raw = JSON.parse(await fs.promises.readFile(metaPath(id), 'utf8')) as StagedUpload;
    return raw.id === id ? raw : null;
  } catch {
    return null;
  }
}

/** Don cac tep tam da het han (cung tep mo coi khong co metadata). */
export async function sweepStaging(now: Date): Promise<number> {
  let removed = 0;
  const names = await fs.promises.readdir(CHAT_STAGING_DIR).catch(() => [] as string[]);
  for (const name of names) {
    const id = name.replace(/\.json$/, '');
    if (!ID_RE.test(id)) continue;
    const meta = await readMeta(id);
    const stat = await fs.promises.stat(path.join(CHAT_STAGING_DIR, name)).catch(() => null);
    const born = meta ? Date.parse(meta.createdAt) : (stat?.mtimeMs ?? 0);
    if (now.getTime() - born > STAGED_TTL_MS && (name === id || meta !== null || stat !== null)) {
      await unlinkQuiet(filePath(id));
      await unlinkQuiet(metaPath(id));
      removed += 1;
    }
  }
  return removed;
}

/** Ghi metadata cho tep vua nhan (multer da luu noi dung). Qua han muc moi nguoi dung -> xoa tep va bao loi. */
export async function registerStaged(userId: string, file: Express.Multer.File, now: Date): Promise<StagedUpload> {
  const id = path.basename(file.filename);
  if (!ID_RE.test(id)) {
    await unlinkQuiet(file.path);
    throw new AppError('Tải tệp lên thất bại', 400);
  }
  await sweepStaging(now);
  const mine = await listStagedFor(userId, now);
  if (mine.length >= MAX_STAGED_PER_USER) {
    await unlinkQuiet(filePath(id));
    throw new AppError(`Bạn đang giữ ${mine.length} tệp chưa dùng. Hãy gắn hoặc bỏ bớt trước khi tải thêm.`, 400);
  }
  const name = Buffer.from(file.originalname, 'latin1').toString('utf8').slice(0, 200);
  const meta: StagedUpload = { id, userId, name, size: file.size, ext: path.extname(name).toLowerCase(), createdAt: now.toISOString() };
  await fs.promises.writeFile(metaPath(id), JSON.stringify(meta), 'utf8');
  return meta;
}

/** Cac tep tam con han cua mot nguoi dung. */
export async function listStagedFor(userId: string, now: Date): Promise<StagedUpload[]> {
  const names = await fs.promises.readdir(CHAT_STAGING_DIR).catch(() => [] as string[]);
  const out: StagedUpload[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const meta = await readMeta(name.slice(0, -5));
    if (meta && meta.userId === userId && now.getTime() - Date.parse(meta.createdAt) <= STAGED_TTL_MS) out.push(meta);
  }
  return out;
}

/**
 * Cac tep ma nguoi dung dinh kem vao MOT tin nhan: phai la tep cua chinh ho, con han. Id la / cua nguoi khac / het han -> loi nguoi dung doc duoc
 * (khong nuot am tham: nguoi dung se tuong tep da duoc gan). `now = null`: bo qua han (luc ap dung chi can tep con ton tai va dung chu so huu).
 */
export async function resolveStaged(userId: string, ids: readonly string[], now: Date | null): Promise<StagedUpload[]> {
  const unique = [...new Set(ids)];
  if (unique.length > MAX_STAGED_PER_MESSAGE) throw new AppError(`Mỗi lần gắn tối đa ${MAX_STAGED_PER_MESSAGE} tệp.`, 400);
  const out: StagedUpload[] = [];
  for (const id of unique) {
    const meta = await readMeta(id);
    const alive = meta !== null && meta.userId === userId && (now === null || now.getTime() - Date.parse(meta.createdAt) <= STAGED_TTL_MS) && fs.existsSync(filePath(id));
    if (!alive) throw new AppError('Tệp đính kèm không còn (đã hết hạn hoặc không phải của bạn). Hãy chọn lại tệp.', 404);
    out.push(meta);
  }
  return out;
}

/** Bo mot tep tam (nut x o khung chat). Khong phai cua nguoi dung -> coi nhu khong co. */
export async function discardStaged(userId: string, id: string): Promise<boolean> {
  const meta = await readMeta(id);
  if (!meta || meta.userId !== userId) return false;
  await unlinkQuiet(filePath(id));
  await unlinkQuiet(metaPath(id));
  return true;
}

/** Duong dan tep tam (chi cho lop ghi; luon qua `resolveStaged` truoc de kiem chu so huu). */
export function stagedPath(id: string): string {
  if (!ID_RE.test(id)) throw new AppError('Tệp đính kèm không hợp lệ.', 400);
  return filePath(id);
}

/** Don tep tam SAU khi da gan (hoac bo): xoa tep va metadata. */
export async function releaseStaged(id: string): Promise<void> {
  if (!ID_RE.test(id)) return;
  await unlinkQuiet(filePath(id));
  await unlinkQuiet(metaPath(id));
}
