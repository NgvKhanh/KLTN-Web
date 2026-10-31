import { describe, expect, it } from 'vitest';
import {
  addMember,
  agent,
  makeBoard,
  makeCard,
  makeList,
  makeUser,
} from './helpers';

// [P1] Nhat ky bang cu khong duoc lo ten MOI cua the da chuyen sang bang khac
// (nhat la bang rieng tu ma nguoi xem nhat ky khong co quyen).
describe('Nhat ky bang: khong lo ten the sau khi the chuyen sang bang khac', () => {
  it('the tao o bang A, chuyen sang bang B (rieng tu) roi doi ten -> nhat ky cua bang A khong duoc lo ten moi', async () => {
    const owner = await makeUser();
    const boardA = await makeBoard(owner, { name: 'Bang A' });
    const listA = await makeList(owner, boardA.id);
    const card = await makeCard(owner, listA.id, 'Ten ban dau');

    const memberA = await makeUser();
    await addMember(owner, boardA.id, memberA.email);

    // Bang B mac dinh la PRIVATE, memberA KHONG duoc them vao
    const boardB = await makeBoard(owner, { name: 'Bang B rieng tu' });
    const listB = await makeList(owner, boardB.id);

    await agent()
      .patch(`/api/cards/${card.id}/move`)
      .set('Cookie', owner.cookie)
      .send({ listId: listB.id, position: 0 })
      .expect(200);

    const secretTitle = 'Thong tin nhay cam chi danh cho bang B';
    await agent()
      .patch(`/api/cards/${card.id}`)
      .set('Cookie', owner.cookie)
      .send({ title: secretTitle })
      .expect(200);

    // memberA chi co quyen o bang A, doc nhat ky bang A (nhat ky 'card.create'
    // cua the nay van con o do vi ghi tai thoi diem the con thuoc bang A)
    const res = await agent()
      .get(`/api/activities/board/${boardA.id}`)
      .set('Cookie', memberA.cookie)
      .expect(200);

    const activities = res.body.data.activities as Array<{
      type: string;
      cardId: string | null;
      card: { id: string; title: string | null } | null;
    }>;
    const createLog = activities.find(
      (a) => a.type === 'card.create' && a.cardId === card.id
    );
    expect(createLog).toBeTruthy();
    expect(createLog?.card?.title).not.toBe(secretTitle);
    expect(createLog?.card?.title).toBeNull();
  });

  it('the van con o dung bang da ghi nhat ky -> ten hien thi binh thuong (khong bi che)', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id, 'Ten ban dau');

    await agent()
      .patch(`/api/cards/${card.id}`)
      .set('Cookie', owner.cookie)
      .send({ title: 'Ten sau khi doi' })
      .expect(200);

    const res = await agent()
      .get(`/api/activities/board/${board.id}`)
      .set('Cookie', owner.cookie)
      .expect(200);

    const activities = res.body.data.activities as Array<{
      type: string;
      cardId: string | null;
      card: { id: string; title: string | null } | null;
    }>;
    const createLog = activities.find(
      (a) => a.type === 'card.create' && a.cardId === card.id
    );
    expect(createLog?.card?.title).toBe('Ten sau khi doi');
  });

  it('nhat ky trang chu (home) cung khong lo ten the da chuyen sang bang rieng tu khac', async () => {
    const owner = await makeUser();
    const boardA = await makeBoard(owner, { name: 'Bang A' });
    const listA = await makeList(owner, boardA.id);
    const card = await makeCard(owner, listA.id, 'Ten ban dau');

    const memberA = await makeUser();
    await addMember(owner, boardA.id, memberA.email);

    const boardB = await makeBoard(owner, { name: 'Bang B rieng tu' });
    const listB = await makeList(owner, boardB.id);
    await agent()
      .patch(`/api/cards/${card.id}/move`)
      .set('Cookie', owner.cookie)
      .send({ listId: listB.id, position: 0 })
      .expect(200);

    const secretTitle = 'Bi mat cua bang B';
    await agent()
      .patch(`/api/cards/${card.id}`)
      .set('Cookie', owner.cookie)
      .send({ title: secretTitle })
      .expect(200);

    const res = await agent()
      .get('/api/activities/home')
      .set('Cookie', memberA.cookie)
      .expect(200);

    const activities = res.body.data.activities as Array<{
      type: string;
      cardId: string | null;
      card: { id: string; title: string | null } | null;
    }>;
    const createLog = activities.find(
      (a) => a.type === 'card.create' && a.cardId === card.id
    );
    expect(createLog).toBeTruthy();
    expect(createLog?.card?.title).not.toBe(secretTitle);
    expect(createLog?.card?.title).toBeNull();
  });
});
