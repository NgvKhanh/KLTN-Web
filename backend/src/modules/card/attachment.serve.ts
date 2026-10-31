import fs from 'node:fs';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../../config/prisma';
import {
  cardAttachmentDiskPath,
  cardAttachmentPublicPath,
  isInlineSafeAttachment,
  trustedAttachmentContentType,
} from '../../config/upload';
import { AppError } from '../../utils/AppError';
import { assertBoardView } from '../board/board.service';

/**
 * Phuc vu tep dinh kem cua the ("/uploads/cards/<file>") CO kiem tra quyen.
 *
 * Khac voi express.static: chi tra file khi nguoi goi co quyen XEM bang chua the
 * (bang PUBLIC thi khach chua dang nhap cung xem duoc - xem assertBoardView).
 * Phai gan SAU optionalAuth (da thu gan req.user neu co) va TRUOC
 * express.static('/uploads'). Khi khong hop le -> tra loi truc tiep, khong
 * goi next() de tep khong bi lo qua middleware tinh dung sau.
 */
export async function serveCardAttachment(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = req.user?.id ?? null;

    // req.path o day la phan sau "/uploads/cards", vd "/abc-123.png". Ma hoa phan tram hong
    // (vd "%E0%A4%A") lam decodeURIComponent nem URIError: khong phai loi he thong -> 404.
    let filename: string;
    try {
      filename = path.basename(decodeURIComponent(req.path));
    } catch {
      res.status(404).json({ success: false, message: 'Khong tim thay tep' });
      return;
    }
    if (!filename || filename === '.' || filename === '/') {
      res.status(404).json({ success: false, message: 'Khong tim thay tep' });
      return;
    }

    // Chi phuc vu tep cua the / danh sach CON HOAT DONG. The hoac danh sach da xoa / luu tru khong con
    // hien o bat ky man hinh nao (endpoint public cua the cung da tra 404), nen ai con giu duong dan cu
    // - ke ca khach chua dang nhap cua bang PUBLIC - cung khong duoc tai tiep. Khoi phuc thi tep lai tai duoc.
    const att = await prisma.attachment.findFirst({
      where: {
        url: cardAttachmentPublicPath(filename),
        card: {
          deletedAt: null,
          archivedAt: null,
          list: { deletedAt: null, archivedAt: null },
        },
      },
      select: {
        name: true,
        card: { select: { list: { select: { boardId: true } } } },
      },
    });
    if (!att) {
      res.status(404).json({ success: false, message: 'Khong tim thay tep' });
      return;
    }

    // Nem AppError(403/404) neu khong co quyen xem bang
    await assertBoardView(userId, att.card.list.boardId);

    const diskPath = cardAttachmentDiskPath(filename);
    if (!fs.existsSync(diskPath)) {
      res.status(404).json({ success: false, message: 'Tep khong con ton tai' });
      return;
    }

    // Content-Type suy tu DUOI FILE (dang tin cay) - KHONG dung MIME nguoi
    // upload tu khai bao (co the bi gia mao, dan toi XSS luu tru neu mo inline).
    res.setHeader('Content-Type', trustedAttachmentContentType(filename));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    // Chi anh moi duoc mo truc tiep (inline); cac dinh dang khac LUON tai
    // xuong, bat ke query ?download, de trinh duyet khong the "dung" noi dung.
    const disposition =
      req.query.download || !isInlineSafeAttachment(filename)
        ? 'attachment'
        : 'inline';
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(att.name)}`
    );
    res.sendFile(diskPath);
  } catch (err) {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ success: false, message: err.message });
      return;
    }
    next(err);
  }
}
