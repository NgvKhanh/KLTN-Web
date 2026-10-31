import { describe, expect, it } from 'vitest';
import { agent, makeBoard, makeCard, makeList, makeUser } from './helpers';

describe('Truong tuy chinh (custom fields)', () => {
  it('tao truong TEXT tren bang -> xuat hien trong danh sach', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);

    const res = await agent()
      .post(`/api/boards/${board.id}/custom-fields`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Khach hang', type: 'TEXT' });
    expect(res.status).toBe(201);
    expect(res.body.data.field.name).toBe('Khach hang');

    const listRes = await agent()
      .get(`/api/boards/${board.id}/custom-fields`)
      .set('Cookie', owner.cookie);
    expect(listRes.body.data.fields).toHaveLength(1);
  });

  it('nguoi ngoai bang khong tao duoc truong -> 403', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const outsider = await makeUser();

    const res = await agent()
      .post(`/api/boards/${board.id}/custom-fields`)
      .set('Cookie', outsider.cookie)
      .send({ name: 'X', type: 'TEXT' });
    expect(res.status).toBe(403);
  });

  it('tao truong DROPDOWN kem lua chon -> luu dung', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);

    const res = await agent()
      .post(`/api/boards/${board.id}/custom-fields`)
      .set('Cookie', owner.cookie)
      .send({
        name: 'Uu tien',
        type: 'DROPDOWN',
        options: [{ value: 'Cao', color: '#ff0000' }, { value: 'Thap' }],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.field.options).toHaveLength(2);
    expect(res.body.data.field.options[0].value).toBe('Cao');
  });

  it('dat gia tri TEXT tren the -> luu va tra ve trong chi tiet the', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    const field = (
      await agent()
        .post(`/api/boards/${board.id}/custom-fields`)
        .set('Cookie', owner.cookie)
        .send({ name: 'Ghi chu', type: 'TEXT' })
    ).body.data.field;

    const setRes = await agent()
      .put(`/api/cards/${card.id}/custom-fields/${field.id}`)
      .set('Cookie', owner.cookie)
      .send({ value: 'gia tri text' });
    expect(setRes.status).toBe(200);
    expect(setRes.body.data.value.textValue).toBe('gia tri text');

    const detail = await agent()
      .get(`/api/cards/${card.id}`)
      .set('Cookie', owner.cookie);
    const fv = detail.body.data.card.fieldValues.find(
      (v: { fieldId: string }) => v.fieldId === field.id
    );
    expect(fv.textValue).toBe('gia tri text');
  });

  it('dat gia tri NUMBER bang chuoi -> 400', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    const field = (
      await agent()
        .post(`/api/boards/${board.id}/custom-fields`)
        .set('Cookie', owner.cookie)
        .send({ name: 'Chi phi', type: 'NUMBER' })
    ).body.data.field;

    const res = await agent()
      .put(`/api/cards/${card.id}/custom-fields/${field.id}`)
      .set('Cookie', owner.cookie)
      .send({ value: 'khong phai so' });
    expect(res.status).toBe(400);
  });

  it('dat gia tri DROPDOWN voi optionId khong hop le -> 400; hop le -> luu dung', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    const field = (
      await agent()
        .post(`/api/boards/${board.id}/custom-fields`)
        .set('Cookie', owner.cookie)
        .send({ name: 'Trang thai', type: 'DROPDOWN', options: [{ value: 'Xong' }] })
    ).body.data.field;
    const optionId = field.options[0].id as string;

    const badRes = await agent()
      .put(`/api/cards/${card.id}/custom-fields/${field.id}`)
      .set('Cookie', owner.cookie)
      .send({ value: 'khong-ton-tai' });
    expect(badRes.status).toBe(400);

    const okRes = await agent()
      .put(`/api/cards/${card.id}/custom-fields/${field.id}`)
      .set('Cookie', owner.cookie)
      .send({ value: optionId });
    expect(okRes.status).toBe(200);
    expect(okRes.body.data.value.optionId).toBe(optionId);
  });

  it('gui value=null -> xoa gia tri da dat', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    const field = (
      await agent()
        .post(`/api/boards/${board.id}/custom-fields`)
        .set('Cookie', owner.cookie)
        .send({ name: 'Ghi chu', type: 'TEXT' })
    ).body.data.field;

    await agent()
      .put(`/api/cards/${card.id}/custom-fields/${field.id}`)
      .set('Cookie', owner.cookie)
      .send({ value: 'co gia tri' })
      .expect(200);
    await agent()
      .put(`/api/cards/${card.id}/custom-fields/${field.id}`)
      .set('Cookie', owner.cookie)
      .send({ value: null })
      .expect(200);

    const detail = await agent()
      .get(`/api/cards/${card.id}`)
      .set('Cookie', owner.cookie);
    expect(detail.body.data.card.fieldValues).toHaveLength(0);
  });

  it('truong tu bang khac khong dat duoc gia tri cho the nay -> 400', async () => {
    const owner = await makeUser();
    const boardA = await makeBoard(owner, { name: 'A' });
    const boardB = await makeBoard(owner, { name: 'B' });
    const list = await makeList(owner, boardA.id);
    const card = await makeCard(owner, list.id);
    const fieldB = (
      await agent()
        .post(`/api/boards/${boardB.id}/custom-fields`)
        .set('Cookie', owner.cookie)
        .send({ name: 'X', type: 'TEXT' })
    ).body.data.field;

    const res = await agent()
      .put(`/api/cards/${card.id}/custom-fields/${fieldB.id}`)
      .set('Cookie', owner.cookie)
      .send({ value: 'x' });
    expect(res.status).toBe(400);
  });

  it('xoa truong -> gia tri lien quan bien mat khoi the', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id);
    const field = (
      await agent()
        .post(`/api/boards/${board.id}/custom-fields`)
        .set('Cookie', owner.cookie)
        .send({ name: 'Tam', type: 'TEXT' })
    ).body.data.field;
    await agent()
      .put(`/api/cards/${card.id}/custom-fields/${field.id}`)
      .set('Cookie', owner.cookie)
      .send({ value: 'gia tri' })
      .expect(200);

    await agent()
      .delete(`/api/custom-fields/${field.id}`)
      .set('Cookie', owner.cookie)
      .expect(200);

    const detail = await agent()
      .get(`/api/cards/${card.id}`)
      .set('Cookie', owner.cookie);
    expect(detail.body.data.card.fieldValues).toHaveLength(0);
  });
});
