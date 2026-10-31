import { describe, expect, it } from 'vitest';
import {
  addMember,
  agent,
  makeBoard,
  makeCard,
  makeList,
  makeUser,
} from './helpers';

describe('Chuyen the sang bang khac', () => {
  it('chuyen the sang list o bang khac minh co quyen -> thanh cong', async () => {
    const user = await makeUser();
    const boardA = await makeBoard(user, { name: 'Bang A' });
    const listA = await makeList(user, boardA.id);
    const card = await makeCard(user, listA.id, 'The can chuyen');

    const boardB = await makeBoard(user, { name: 'Bang B' });
    const listB = await makeList(user, boardB.id, 'Danh sach B');

    const res = await agent()
      .patch(`/api/cards/${card.id}/move`)
      .set('Cookie', user.cookie)
      .send({ listId: listB.id, position: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data.card.listId).toBe(listB.id);

    const listRes = await agent()
      .get(`/api/boards/${boardB.id}/lists`)
      .set('Cookie', user.cookie);
    const movedList = listRes.body.data.lists.find(
      (l: { id: string }) => l.id === listB.id
    );
    expect(movedList.cards.map((c: { id: string }) => c.id)).toContain(
      card.id
    );
  });

  it('khong co quyen sua bang dich -> 403, the khong bi chuyen', async () => {
    const owner = await makeUser();
    const boardA = await makeBoard(owner, { name: 'Bang A' });
    const listA = await makeList(owner, boardA.id);
    const card = await makeCard(owner, listA.id);

    const stranger = await makeUser();
    const boardB = await makeBoard(stranger, { name: 'Bang cua nguoi la' });
    const listB = await makeList(stranger, boardB.id);

    const res = await agent()
      .patch(`/api/cards/${card.id}/move`)
      .set('Cookie', owner.cookie)
      .send({ listId: listB.id, position: 0 });
    expect(res.status).toBe(403);
  });

  it('thanh vien the khong con la thanh vien bang dich -> bi go khoi the sau khi chuyen', async () => {
    const owner = await makeUser();
    const boardA = await makeBoard(owner, { name: 'Bang A' });
    const listA = await makeList(owner, boardA.id);
    const card = await makeCard(owner, listA.id);

    const memberOnlyA = await makeUser();
    await addMember(owner, boardA.id, memberOnlyA.email);
    await agent()
      .post(`/api/cards/${card.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: memberOnlyA.id })
      .expect(201);

    const boardB = await makeBoard(owner, { name: 'Bang B' });
    const listB = await makeList(owner, boardB.id);
    // memberOnlyA KHONG duoc them vao boardB

    await agent()
      .patch(`/api/cards/${card.id}/move`)
      .set('Cookie', owner.cookie)
      .send({ listId: listB.id, position: 0 })
      .expect(200);

    const detail = await agent()
      .get(`/api/cards/${card.id}`)
      .set('Cookie', owner.cookie);
    const memberIds = detail.body.data.card.members.map(
      (m: { userId: string }) => m.userId
    );
    expect(memberIds).not.toContain(memberOnlyA.id);
  });

  it('nhan thuoc bang nguon bi go khoi the sau khi chuyen sang bang khac', async () => {
    const owner = await makeUser();
    const boardA = await makeBoard(owner, { name: 'Bang A' });
    const listA = await makeList(owner, boardA.id);
    const card = await makeCard(owner, listA.id);

    const labelRes = await agent()
      .post(`/api/boards/${boardA.id}/labels`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Uu tien cao', color: '#ff0000' });
    expect(labelRes.status).toBe(201);
    const labelId = labelRes.body.data.label.id as string;
    await agent()
      .put(`/api/cards/${card.id}/labels/${labelId}`)
      .set('Cookie', owner.cookie)
      .expect(200);

    const boardB = await makeBoard(owner, { name: 'Bang B' });
    const listB = await makeList(owner, boardB.id);

    await agent()
      .patch(`/api/cards/${card.id}/move`)
      .set('Cookie', owner.cookie)
      .send({ listId: listB.id, position: 0 })
      .expect(200);

    const detail = await agent()
      .get(`/api/cards/${card.id}`)
      .set('Cookie', owner.cookie);
    expect(detail.body.data.card.labels).toEqual([]);
  });

  it('gia tri truong tuy chinh cua bang nguon bi go sau khi chuyen sang bang khac', async () => {
    const owner = await makeUser();
    const boardA = await makeBoard(owner, { name: 'Bang A' });
    const listA = await makeList(owner, boardA.id);
    const card = await makeCard(owner, listA.id);

    const fieldRes = await agent()
      .post(`/api/boards/${boardA.id}/custom-fields`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Uu tien', type: 'TEXT' });
    const fieldId = fieldRes.body.data.field.id as string;
    await agent()
      .put(`/api/cards/${card.id}/custom-fields/${fieldId}`)
      .set('Cookie', owner.cookie)
      .send({ value: 'Cao' })
      .expect(200);

    const boardB = await makeBoard(owner, { name: 'Bang B' });
    const listB = await makeList(owner, boardB.id);

    await agent()
      .patch(`/api/cards/${card.id}/move`)
      .set('Cookie', owner.cookie)
      .send({ listId: listB.id, position: 0 })
      .expect(200);

    const detail = await agent()
      .get(`/api/cards/${card.id}`)
      .set('Cookie', owner.cookie);
    expect(detail.body.data.card.fieldValues).toEqual([]);
  });

  it('van chuyen duoc trong CUNG 1 bang (khong hoi quy)', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const listA = await makeList(owner, board.id, 'A');
    const listB = await makeList(owner, board.id, 'B');
    const card = await makeCard(owner, listA.id);

    const res = await agent()
      .patch(`/api/cards/${card.id}/move`)
      .set('Cookie', owner.cookie)
      .send({ listId: listB.id, position: 0 });
    expect(res.status).toBe(200);
    expect(res.body.data.card.listId).toBe(listB.id);
  });
});
