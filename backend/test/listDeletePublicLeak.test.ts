import { describe, expect, it } from 'vitest';
import { agent, makeBoard, makeCard, makeList, makeUser } from './helpers';

// #4 CODE_REVIEW.md: xoa/luu tru mot danh sach chi dat deletedAt/archivedAt cua CHINH
// no; cac the ben trong khong duoc kiem tra danh sach cha con "hoat dong" hay khong o
// 2 duong doc: doc CONG KHAI (publicBoard.service.ts) va doc chi tiet the cua thanh
// vien DA DANG NHAP (card.service.ts getCardDetail dung thang assertBoardView, bo qua
// trang thai danh sach cha).
describe('Xoa/luu tru danh sach phai thu hoi quyen doc the ben trong', () => {
  async function makePublicBoard(owner: Awaited<ReturnType<typeof makeUser>>) {
    const board = await makeBoard(owner);
    await agent()
      .patch(`/api/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .send({ visibility: 'PUBLIC' })
      .expect(200);
    return board;
  }

  it('xoa hoac luu tru danh sach -> the ben trong khong con doc CONG KHAI duoc nua', async () => {
    const owner = await makeUser();
    const board = await makePublicBoard(owner);

    const deletedList = await makeList(owner, board.id, 'Se bi xoa');
    const deletedCard = await makeCard(owner, deletedList.id, 'The trong danh sach bi xoa');
    const archivedList = await makeList(owner, board.id, 'Se bi luu tru');
    const archivedCard = await makeCard(owner, archivedList.id, 'The trong danh sach bi luu tru');

    // Con danh sach: doc cong khai OK
    await agent().get(`/api/public/cards/${deletedCard.id}`).expect(200);
    await agent().get(`/api/public/cards/${archivedCard.id}`).expect(200);

    await agent()
      .delete(`/api/lists/${deletedList.id}`)
      .set('Cookie', owner.cookie)
      .expect(200);
    await agent()
      .post(`/api/lists/${archivedList.id}/archive`)
      .set('Cookie', owner.cookie)
      .expect(200);

    const afterDelete = await agent().get(`/api/public/cards/${deletedCard.id}`);
    expect(afterDelete.status).toBe(404);
    const afterArchive = await agent().get(`/api/public/cards/${archivedCard.id}`);
    expect(afterArchive.status).toBe(404);
  });

  it('xoa danh sach -> thanh vien DA DANG NHAP cung khong con xem chi tiet the ben trong (truoc day lo qua duong doc thuong)', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner); // rieng tu, khong can PUBLIC de tai hien lo hong nay
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id, 'The rieng tu');

    await agent().get(`/api/cards/${card.id}`).set('Cookie', owner.cookie).expect(200);

    await agent()
      .delete(`/api/lists/${list.id}`)
      .set('Cookie', owner.cookie)
      .expect(200);

    const res = await agent().get(`/api/cards/${card.id}`).set('Cookie', owner.cookie);
    expect(res.status).toBe(404);
  });
});
