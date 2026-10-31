// REVIEW 26/09 #3: tep dinh kem van tai duoc sau khi the / danh sach bi xoa hoac luu tru (khach chua dang nhap
// cua bang PUBLIC con giu duong dan cu van tai duoc, du endpoint public cua the da tra 404). Gio route
// /uploads/cards chi phuc vu tep cua the + danh sach con hoat dong; khoi phuc thi tai lai duoc.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { cardAttachmentDiskPath, cardAttachmentPublicPath } from '../src/config/upload';
import { agent, makeBoard, makeCard, makeDirectUser, makeList, type TestUser } from './helpers';

const createdFiles: string[] = [];
afterAll(() => {
  for (const f of createdFiles) fs.rmSync(f, { force: true });
});

async function setup() {
  const owner = await makeDirectUser('Chu');
  const board = await makeBoard(owner);
  const patch = await agent().patch(`/api/boards/${board.id}`).set('Cookie', owner.cookie).send({ visibility: 'PUBLIC' });
  expect(patch.status).toBe(200);
  const list = await makeList(owner, board.id);
  const card = await makeCard(owner, list.id);
  const filename = `${randomUUID()}.txt`;
  const disk = cardAttachmentDiskPath(filename);
  fs.writeFileSync(disk, 'NOI DUNG TEP');
  createdFiles.push(disk);
  await prisma.attachment.create({
    data: { cardId: card.id, uploaderId: owner.id, name: 'tep.txt', url: cardAttachmentPublicPath(filename), mime: 'text/plain', size: 12 },
  });
  return { owner, list, card, url: `/uploads/cards/${filename}` };
}

const as = (user: TestUser | null, url: string) => {
  const r = agent().get(url);
  return user ? r.set('Cookie', user.cookie) : r;
};
const act = (user: TestUser, method: 'post' | 'delete', url: string) => agent()[method](url).set('Cookie', user.cookie);

async function expectServed(owner: TestUser, url: string, status: number) {
  expect((await as(null, url)).status, 'khach chua dang nhap').toBe(status);
  expect((await as(owner, url)).status, 'chu bang').toBe(status);
}

describe('GET /uploads/cards/:file theo vong doi cua the / danh sach', () => {
  it('dang hoat dong: khach (bang PUBLIC) va chu bang tai duoc', async () => {
    const { owner, url } = await setup();
    await expectServed(owner, url, 200);
  });

  it('the bi luu tru -> 404 cho moi nguoi; khoi phuc -> tai lai duoc', async () => {
    const { owner, card, url } = await setup();
    expect((await act(owner, 'post', `/api/cards/${card.id}/archive`)).status).toBe(200);
    await expectServed(owner, url, 404);
    expect((await act(owner, 'post', `/api/cards/${card.id}/restore`)).status).toBe(200);
    await expectServed(owner, url, 200);
  });

  it('the bi xoa -> 404 cho moi nguoi (endpoint public cua the cung 404)', async () => {
    const { owner, card, url } = await setup();
    expect((await act(owner, 'delete', `/api/cards/${card.id}`)).status).toBe(200);
    expect((await as(null, `/api/public/cards/${card.id}`)).status).toBe(404);
    await expectServed(owner, url, 404);
  });

  it('danh sach chua the bi luu tru -> 404; khoi phuc -> tai lai duoc', async () => {
    const { owner, list, url } = await setup();
    expect((await act(owner, 'post', `/api/lists/${list.id}/archive`)).status).toBe(200);
    await expectServed(owner, url, 404);
    expect((await act(owner, 'post', `/api/lists/${list.id}/restore`)).status).toBe(200);
    await expectServed(owner, url, 200);
  });

  it('danh sach chua the bi xoa -> 404 cho moi nguoi', async () => {
    const { owner, list, url } = await setup();
    expect((await act(owner, 'delete', `/api/lists/${list.id}`)).status).toBe(200);
    await expectServed(owner, url, 404);
  });

  it('duong dan ma hoa phan tram hong -> 404 (khong phai 500)', async () => {
    const res = await as(null, '/uploads/cards/%E0%A4%A');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});
