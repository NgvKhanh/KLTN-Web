import { describe, expect, it } from 'vitest';
import { agent, makeBoard, makeCard, makeList, makeUser } from './helpers';

// Van de moi #2: khong duoc tin MIME nguoi upload tu khai bao khi phuc vu tep.
describe('Content-Type khi phuc vu tep dinh kem phai suy tu duoi file, khong tu MIME nguoi upload khai', () => {
  it('tai file .txt nhung khai Content-Type text/html -> phuc vu van la text/plain + luon tai xuong', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);

    const upload = await agent()
      .post(`/api/cards/${card.id}/attachments`)
      .set('Cookie', owner.cookie)
      .attach('file', Buffer.from('<script>alert(1)</script>'), {
        filename: 'bao-cao.txt',
        contentType: 'text/html', // MIME gia mao
      });
    expect(upload.status).toBe(201);
    const url = upload.body.data.attachment.url as string;

    const res = await agent().get(url).set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    // Khong phai anh -> luon ep tai xuong, khong mo inline du khong truyen ?download
    expect(res.headers['content-disposition']).toMatch(/^attachment/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    // Khong duoc phan anh nhu HTML
    expect(res.headers['content-type']).not.toMatch(/html/);
  });

  it('anh that (.png) van mo duoc inline', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);

    const upload = await agent()
      .post(`/api/cards/${card.id}/attachments`)
      .set('Cookie', owner.cookie)
      .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47]), {
        filename: 'anh.png',
        contentType: 'image/png',
      });
    expect(upload.status).toBe(201);
    const url = upload.body.data.attachment.url as string;

    const res = await agent().get(url).set('Cookie', owner.cookie);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['content-disposition']).toMatch(/^inline/);
  });
});
