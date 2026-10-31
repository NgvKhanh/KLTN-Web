import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import {
  cardAttachmentDiskPath,
  cardAttachmentPublicPath,
} from '../src/config/upload';
import {
  addMember,
  agent,
  makeBoard,
  makeCard,
  makeList,
  makeUser,
} from './helpers';

const createdFiles: string[] = [];
afterAll(() => {
  for (const f of createdFiles) fs.promises.unlink(f).catch(() => {});
});

/** Tao truc tiep 1 tep dinh kem (ghi file + ban ghi DB) cho 1 the. */
async function seedAttachment(cardId: string, uploaderId: string) {
  const filename = `${randomUUID()}.txt`;
  const disk = cardAttachmentDiskPath(filename);
  fs.writeFileSync(disk, 'NOI DUNG BI MAT');
  createdFiles.push(disk);
  await prisma.attachment.create({
    data: {
      cardId,
      uploaderId,
      name: 'bimat.txt',
      url: cardAttachmentPublicPath(filename),
      mime: 'text/plain',
      size: 15,
    },
  });
  return filename;
}

// Van de #2: tep dinh kem bang rieng tu khong duoc phuc vu cong khai
describe('#2 GET /uploads/cards/:file - kiem tra quyen', () => {
  it('khong dang nhap, bang RIENG TU -> 403 (khong duoc phuc vu tep)', async () => {
    // Sau khi ho tro bang PUBLIC cho khach xem khong dang nhap, route nay
    // dung optionalAuth thay vi requireAuth: khach van bi tu choi cho bang
    // rieng tu, nhung ma trang thai gio la 403 (dung quyen han) thay vi 401
    // (thieu dang nhap) - xem assertBoardView(userId=null, ...).
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    const file = await seedAttachment(card.id, owner.id);

    await agent().get(`/uploads/cards/${file}`).expect(403);
  });

  it('thanh vien bang -> 200 va tai duoc noi dung', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    const file = await seedAttachment(card.id, owner.id);

    const res = await agent()
      .get(`/uploads/cards/${file}`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.text).toContain('NOI DUNG BI MAT');
  });

  it('nguoi ngoai bang -> 403', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    const file = await seedAttachment(card.id, owner.id);

    await agent()
      .get(`/uploads/cards/${file}`)
      .set('Cookie', outsider.cookie)
      .expect(403);
  });

  it('thanh vien bi xoa khoi bang -> mat quyen tai tep', async () => {
    const owner = await makeUser();
    const member = await makeUser();
    const board = await makeBoard(owner);
    await addMember(owner, board.id, member.email, 'MEMBER');
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    const file = await seedAttachment(card.id, owner.id);

    await agent()
      .get(`/uploads/cards/${file}`)
      .set('Cookie', member.cookie)
      .expect(200);

    await agent()
      .delete(`/api/boards/${board.id}/members/${member.id}`)
      .set('Cookie', owner.cookie)
      .expect(200);

    await agent()
      .get(`/uploads/cards/${file}`)
      .set('Cookie', member.cookie)
      .expect(403);
  });
});

// Van de #8: khong ghi file khi chua co quyen tai nguyen
describe('#8 upload kiem tra quyen truoc khi ghi file', () => {
  it('nguoi ngoai bang upload tep vao the -> 403 va khong tao ban ghi', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);

    const res = await agent()
      .post(`/api/cards/${card.id}/attachments`)
      .set('Cookie', outsider.cookie)
      .attach('file', Buffer.from('xin chao'), 'test.txt');

    expect(res.status).toBe(403);
    expect(await prisma.attachment.count({ where: { cardId: card.id } })).toBe(0);
  });

  it('nguoi ngoai bang upload anh nen -> 403', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const board = await makeBoard(owner);

    const res = await agent()
      .post(`/api/boards/${board.id}/background`)
      .set('Cookie', outsider.cookie)
      .attach('image', Buffer.from('fake'), 'bg.png');

    expect(res.status).toBe(403);
  });
});
