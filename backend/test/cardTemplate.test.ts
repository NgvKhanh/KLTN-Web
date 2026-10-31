import { describe, expect, it } from 'vitest';
import { agent, makeBoard, makeCard, makeList, makeUser } from './helpers';

describe('Mau the do nguoi dung tu luu', () => {
  it('tao mau the thu cong kem checklist', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);

    const res = await agent()
      .post(`/api/boards/${board.id}/card-templates`)
      .set('Cookie', owner.cookie)
      .send({
        name: 'Mau xu ly loi',
        description: 'Cac buoc xu ly loi san xuat',
        checklists: [{ title: 'Cac buoc', items: ['Xac nhan loi', 'Fix', 'Deploy'] }],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.template.checklists[0].items).toHaveLength(3);

    const listRes = await agent()
      .get(`/api/boards/${board.id}/card-templates`)
      .set('Cookie', owner.cookie);
    expect(listRes.body.data.templates).toHaveLength(1);
  });

  it('luu 1 the dang co thanh mau -> chup dung mo ta + checklist', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id, 'The goc');
    await agent()
      .patch(`/api/cards/${card.id}`)
      .set('Cookie', owner.cookie)
      .send({ description: 'Mo ta cua the goc' })
      .expect(200);
    const clRes = await agent()
      .post(`/api/cards/${card.id}/checklists`)
      .set('Cookie', owner.cookie)
      .send({ title: 'Buoc' });
    const checklistId = clRes.body.data.checklist.id as string;
    await agent()
      .post(`/api/checklists/${checklistId}/items`)
      .set('Cookie', owner.cookie)
      .send({ content: 'Muc 1' })
      .expect(201);

    const res = await agent()
      .post(`/api/cards/${card.id}/save-as-template`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Mau tu the goc' });
    expect(res.status).toBe(201);
    expect(res.body.data.template.description).toBe('Mo ta cua the goc');
    expect(res.body.data.template.checklists[0].items[0].content).toBe('Muc 1');
  });

  it('ap dung mau vao 1 danh sach -> tao the moi kem checklist', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const tplRes = await agent()
      .post(`/api/boards/${board.id}/card-templates`)
      .set('Cookie', owner.cookie)
      .send({
        name: 'Mau onboard',
        checklists: [{ title: 'Checklist', items: ['Buoc 1', 'Buoc 2'] }],
      });
    const templateId = tplRes.body.data.template.id as string;
    const list = await makeList(owner, board.id, 'Danh sach ap dung');

    const applyRes = await agent()
      .post(`/api/lists/${list.id}/cards/from-template/${templateId}`)
      .set('Cookie', owner.cookie)
      .send({});
    expect(applyRes.status).toBe(201);
    expect(applyRes.body.data.card.title).toBe('Mau onboard');

    const detail = await agent()
      .get(`/api/cards/${applyRes.body.data.card.id}`)
      .set('Cookie', owner.cookie);
    expect(detail.body.data.card.checklists[0].items).toHaveLength(2);
  });

  it('mau tu bang khac khong ap dung duoc cho danh sach nay -> 400', async () => {
    const owner = await makeUser();
    const boardA = await makeBoard(owner, { name: 'A' });
    const boardB = await makeBoard(owner, { name: 'B' });
    const tplRes = await agent()
      .post(`/api/boards/${boardA.id}/card-templates`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Mau A' });
    const templateId = tplRes.body.data.template.id as string;
    const listB = await makeList(owner, boardB.id);

    const res = await agent()
      .post(`/api/lists/${listB.id}/cards/from-template/${templateId}`)
      .set('Cookie', owner.cookie)
      .send({});
    expect(res.status).toBe(400);
  });

  it('[P4] the tao tu mau cung duoc chay tu dong hoa "khi tao the" (nhat quan voi tao thu cong)', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id, 'Danh sach co luat');

    const ruleRes = await agent()
      .post(`/api/boards/${board.id}/automation-rules`)
      .set('Cookie', owner.cookie)
      .send({
        name: 'The moi trong list nay -> danh dau xong',
        triggerType: 'CARD_CREATED',
        triggerListId: list.id,
        actions: [{ type: 'SET_DONE', boolValue: true }],
      });
    expect(ruleRes.status).toBe(201);

    const tplRes = await agent()
      .post(`/api/boards/${board.id}/card-templates`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Mau bat ky' });
    const templateId = tplRes.body.data.template.id as string;

    const applyRes = await agent()
      .post(`/api/lists/${list.id}/cards/from-template/${templateId}`)
      .set('Cookie', owner.cookie)
      .send({});
    expect(applyRes.status).toBe(201);
    expect(applyRes.body.data.card.isDone).toBe(true);
  });

  it('nguoi ngoai bang khong tao duoc mau -> 403', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const outsider = await makeUser();

    const res = await agent()
      .post(`/api/boards/${board.id}/card-templates`)
      .set('Cookie', outsider.cookie)
      .send({ name: 'X' });
    expect(res.status).toBe(403);
  });
});
