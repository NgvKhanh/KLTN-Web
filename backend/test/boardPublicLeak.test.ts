import { describe, expect, it } from 'vitest';
import { agent, makeBoard, makeUser } from './helpers';

// #3 CODE_REVIEW.md: nguoi KHONG phai thanh vien (chi xem duoc vi bang la PUBLIC)
// khong duoc thay email that cua thanh vien khac, cung khong duoc lo inviteToken
// qua duong doc chi tiet bang (chi endpoint /invite-link, yeu cau quyen quan ly,
// moi duoc tra ma moi thuc su).
describe('Bang PUBLIC khong lo email thanh vien / ma moi cho nguoi ngoai', () => {
  async function makePublicBoard(owner: Awaited<ReturnType<typeof makeUser>>) {
    const board = await makeBoard(owner);
    await agent()
      .patch(`/api/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .send({ visibility: 'PUBLIC' })
      .expect(200);
    await agent()
      .post(`/api/boards/${board.id}/invite-link`)
      .set('Cookie', owner.cookie)
      .expect(200);
    return board;
  }

  it('GET .../members: nguoi ngoai xem duoc TEN nhung KHONG thay EMAIL; thanh vien that su van thay', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const board = await makePublicBoard(owner);

    const asOutsider = await agent()
      .get(`/api/boards/${board.id}/members`)
      .set('Cookie', outsider.cookie);
    expect(asOutsider.status).toBe(200);
    const rows = asOutsider.body.data.members as Array<{ user: { name: string; email: string } }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.user.name).toBeTruthy();
      expect(row.user.email).toBe('');
    }
    expect(JSON.stringify(asOutsider.body)).not.toContain(owner.email);

    const asOwner = await agent()
      .get(`/api/boards/${board.id}/members`)
      .set('Cookie', owner.cookie);
    expect(asOwner.status).toBe(200);
    expect(asOwner.body.data.members[0].user.email).toBe(owner.email);
  });

  it('GET /api/boards/:id: nguoi ngoai KHONG nhan duoc inviteToken trong chi tiet bang', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const board = await makePublicBoard(owner);

    const res = await agent()
      .get(`/api/boards/${board.id}`)
      .set('Cookie', outsider.cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.board.canEdit).toBe(false);
    expect(res.body.data.board.inviteToken).toBeUndefined();

    // Chu bang goi dung endpoint /invite-link van lay duoc ma moi that (chuc nang
    // khong bi anh huong - chi duong doc lo thua bi chan).
    const link = await agent()
      .get(`/api/boards/${board.id}/invite-link`)
      .set('Cookie', owner.cookie);
    expect(link.status).toBe(200);
    expect(typeof link.body.data.token).toBe('string');
    expect(link.body.data.token.length).toBeGreaterThan(0);
  });
});
