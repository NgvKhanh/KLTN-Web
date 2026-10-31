import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import {
  cardAttachmentDiskPath,
  cardAttachmentPublicPath,
} from '../src/config/upload';
import { prisma } from '../src/config/prisma';
import { addMember, agent, makeBoard, makeCard, makeList, makeUser } from './helpers';

async function makePublicBoard(owner: Awaited<ReturnType<typeof makeUser>>) {
  const board = await makeBoard(owner, { name: 'Bang cong khai' });
  const res = await agent()
    .patch(`/api/boards/${board.id}`)
    .set('Cookie', owner.cookie)
    .send({ visibility: 'PUBLIC' });
  expect(res.status).toBe(200);
  return board;
}

const createdFiles: string[] = [];
afterAll(() => {
  for (const f of createdFiles) fs.promises.unlink(f).catch(() => {});
});

async function seedAttachment(cardId: string, uploaderId: string) {
  const filename = `${randomUUID()}.txt`;
  const disk = cardAttachmentDiskPath(filename);
  fs.writeFileSync(disk, 'noi dung tep');
  createdFiles.push(disk);
  await prisma.attachment.create({
    data: {
      cardId,
      uploaderId,
      name: 'file.txt',
      url: cardAttachmentPublicPath(filename),
      mime: 'text/plain',
      size: 12,
    },
  });
  return filename;
}

describe('Xem bang PUBLIC khong can dang nhap', () => {
  it('GET /api/public/boards/:id -> 200, khong can cookie', async () => {
    const owner = await makeUser();
    const board = await makePublicBoard(owner);

    const res = await agent().get(`/api/public/boards/${board.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.board.name).toBe('Bang cong khai');
  });

  it('bang RIENG TU (mac dinh) -> 404 cho khach khong dang nhap', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);

    const res = await agent().get(`/api/public/boards/${board.id}`);
    expect(res.status).toBe(404);
  });

  it('bang WORKSPACE (khong phai PUBLIC) -> 404 cho khach', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    await agent()
      .patch(`/api/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .send({ visibility: 'WORKSPACE' })
      .expect(200);

    const res = await agent().get(`/api/public/boards/${board.id}`);
    expect(res.status).toBe(404);
  });

  it('GET .../lists tra ve danh sach + the, KHONG lo email thanh vien', async () => {
    const owner = await makeUser();
    const board = await makePublicBoard(owner);
    const list = await makeList(owner, board.id, 'Danh sach');
    const card = await makeCard(owner, list.id, 'The cong khai');
    await agent()
      .post(`/api/cards/${card.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: owner.id })
      .expect(201);

    const res = await agent().get(`/api/public/boards/${board.id}/lists`);
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).toContain('The cong khai');
    expect(raw).not.toContain(owner.email);
    expect(raw).not.toContain('@');
  });

  it('GET /api/public/cards/:id -> chi tiet the cong khai, khong lo email', async () => {
    const owner = await makeUser();
    const board = await makePublicBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id, 'The chi tiet');
    await agent()
      .post(`/api/cards/${card.id}/comments`)
      .set('Cookie', owner.cookie)
      .send({ text: 'binh luan cong khai' })
      .expect(201);

    const res = await agent().get(`/api/public/cards/${card.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.card.title).toBe('The chi tiet');
    expect(res.body.data.card.comments[0].text).toBe('binh luan cong khai');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(owner.email);
    expect(raw).not.toContain('@');
  });

  it('the thuoc bang RIENG TU -> 404 cho khach (khong do doan duoc ID)', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);

    const res = await agent().get(`/api/public/cards/${card.id}`);
    expect(res.status).toBe(404);
  });

  it('khach xem duoc tep dinh kem cua the trong bang PUBLIC', async () => {
    const owner = await makeUser();
    const board = await makePublicBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    const file = await seedAttachment(card.id, owner.id);

    const res = await agent().get(`/uploads/cards/${file}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('noi dung tep');
  });

  it('mot thanh vien VIEWER van xem duoc qua duong dan thuong (khong can API public)', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const viewer = await makeUser();
    await addMember(owner, board.id, viewer.email, 'VIEWER');

    const res = await agent()
      .get(`/api/boards/${board.id}`)
      .set('Cookie', viewer.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.board.canEdit).toBe(false);
  });
});
