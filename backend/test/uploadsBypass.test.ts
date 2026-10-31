import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AVATAR_DIR,
  cardAttachmentDiskPath,
  cardAttachmentPublicPath,
} from '../src/config/upload';
import { prisma } from '../src/config/prisma';
import { agent, makeBoard, makeCard, makeList, makeUser } from './helpers';

// Van de moi #1: request voi doan duong dan ma hoa phai KHONG con bypass
// duoc lop kiem tra quyen cua /uploads/cards (truoc day roi vao
// express.static(UPLOAD_ROOT) va bi giai ma nguoc lai).
//
// LUU Y: ban truoc cua test nay chi thu 1 file KHONG TON TAI, nen cung tra
// ve 404 voi CA code cu bi loi lan code da vá - khong chung minh duoc gi.
// Ban nay dung 1 tep dinh kem THAT (co noi dung bi mat that su) de phan biet
// ro: duong dan chuan phuc vu duoc (200 + dung noi dung), duong dan ma hoa
// thi khong bao gio lay duoc noi dung do - ke ca voi cookie cua chinh CHU
// bang (nguoi le ra co quyen doc file qua duong dan chuan).
describe('Khong con duong vong qua /uploads/cards bang path encoding', () => {
  it('duong dan chuan phuc vu duoc file that; duong dan ma hoa thi khong, ke ca voi cookie hop le', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);

    const filename = `${randomUUID()}.txt`;
    const secret = 'NOI DUNG BI MAT - CHI CHU BANG DUOC DOC';
    fs.writeFileSync(cardAttachmentDiskPath(filename), secret);
    await prisma.attachment.create({
      data: {
        cardId: card.id,
        uploaderId: owner.id,
        name: 'bimat.txt',
        url: cardAttachmentPublicPath(filename),
        mime: 'text/plain',
        size: secret.length,
      },
    });

    try {
      // 1) Duong dan CHUAN, co dang nhap -> phuc vu dung, chung minh file that su ton tai va doc duoc
      const canonical = await agent()
        .get(`/uploads/cards/${filename}`)
        .set('Cookie', owner.cookie);
      expect(canonical.status).toBe(200);
      expect(canonical.text).toContain(secret);

      // 2) Duong dan MA HOA, KHONG dang nhap -> khong duoc lo noi dung
      const encodedNoAuth = await agent().get(
        `/uploads/%63ards/${filename}`
      );
      expect(encodedNoAuth.status).not.toBe(200);
      expect(encodedNoAuth.text).not.toContain(secret);

      // 3) Duong dan MA HOA, CO cookie hop le cua chinh chu bang -> VAN khong
      //    duoc lo noi dung. Neu con lo o day nghia la /uploads/%63ards van
      //    khop mot static handler nao do va bo qua han lop kiem tra quyen
      //    (khac voi truong hop 401 don thuan vi thieu dang nhap).
      const encodedWithAuth = await agent()
        .get(`/uploads/%63ards/${filename}`)
        .set('Cookie', owner.cookie);
      expect(encodedWithAuth.status).not.toBe(200);
      expect(encodedWithAuth.text).not.toContain(secret);
    } finally {
      fs.promises.unlink(cardAttachmentDiskPath(filename)).catch(() => {});
    }
  });

  it('thu muc cong khai (avatars) van duoc phuc vu binh thuong', async () => {
    const filename = 'smoke-avatar-test.txt';
    const diskPath = `${AVATAR_DIR}/${filename}`;
    fs.writeFileSync(diskPath, 'anh dai dien cong khai');
    try {
      const res = await agent().get(`/uploads/avatars/${filename}`);
      expect(res.status).toBe(200);
      expect(res.text).toContain('anh dai dien cong khai');
    } finally {
      fs.unlinkSync(diskPath);
    }
  });
});
