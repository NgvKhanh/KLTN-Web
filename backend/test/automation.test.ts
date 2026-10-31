import { describe, expect, it } from 'vitest';
import { agent, makeBoard, makeList, makeUser } from './helpers';

describe('POST /api/boards/:boardId/automation-rules', () => {
  it('tao luat CARD_CREATED voi hanh dong SET_DONE -> 201', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);

    const res = await agent()
      .post(`/api/boards/${board.id}/automation-rules`)
      .set('Cookie', owner.cookie)
      .send({
        name: 'Tu dong hoan thanh',
        triggerType: 'CARD_CREATED',
        triggerListId: list.id,
        actions: [{ type: 'SET_DONE', boolValue: true }],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.rule.actions).toHaveLength(1);
    expect(res.body.data.rule.actions[0].type).toBe('SET_DONE');

    // CARD_MOVED_TO_LIST thieu triggerListId -> 400 (cung 1 board, khong can user moi)
    const bad = await agent()
      .post(`/api/boards/${board.id}/automation-rules`)
      .set('Cookie', owner.cookie)
      .send({
        name: 'Thieu list',
        triggerType: 'CARD_MOVED_TO_LIST',
        actions: [{ type: 'SET_DONE' }],
      });
    expect(bad.status).toBe(400);
  });

  it('ADD_LABEL voi nhan tu bang khac -> 400', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner, { name: 'Bang A' });
    const otherBoard = await makeBoard(owner, { name: 'Bang B' });

    const labelRes = await agent()
      .post(`/api/boards/${otherBoard.id}/labels`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Gap', color: '#ff0000' });
    const foreignLabelId = labelRes.body.data.label.id as string;

    const res = await agent()
      .post(`/api/boards/${board.id}/automation-rules`)
      .set('Cookie', owner.cookie)
      .send({
        name: 'Gan nhan sai bang',
        triggerType: 'CARD_CREATED',
        actions: [{ type: 'ADD_LABEL', labelId: foreignLabelId }],
      });
    expect(res.status).toBe(400);
  });

  it('ASSIGN_MEMBER voi nguoi khong phai thanh vien bang -> 400', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const board = await makeBoard(owner);

    const res = await agent()
      .post(`/api/boards/${board.id}/automation-rules`)
      .set('Cookie', owner.cookie)
      .send({
        name: 'Gan nguoi ngoai bang',
        triggerType: 'CARD_CREATED',
        actions: [{ type: 'ASSIGN_MEMBER', userId: outsider.id }],
      });
    expect(res.status).toBe(400);
  });

  it('nguoi ngoai bang khong tao duoc luat -> 403', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const board = await makeBoard(owner);

    const res = await agent()
      .post(`/api/boards/${board.id}/automation-rules`)
      .set('Cookie', outsider.cookie)
      .send({
        name: 'X',
        triggerType: 'CARD_CREATED',
        actions: [{ type: 'SET_DONE' }],
      });
    expect(res.status).toBe(403);
  });
});

describe('PATCH/DELETE /api/automation-rules/:id', () => {
  it('cap nhat (doi ten, tat, thay hanh dong) roi xoa - nguoi ngoai bang bi 403', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const board = await makeBoard(owner);

    const create = await agent()
      .post(`/api/boards/${board.id}/automation-rules`)
      .set('Cookie', owner.cookie)
      .send({
        name: 'Luat goc',
        triggerType: 'CARD_CREATED',
        actions: [{ type: 'SET_DONE' }],
      });
    const ruleId = create.body.data.rule.id as string;

    const patchByOutsider = await agent()
      .patch(`/api/automation-rules/${ruleId}`)
      .set('Cookie', outsider.cookie)
      .send({ isEnabled: false });
    expect(patchByOutsider.status).toBe(403);

    const patch = await agent()
      .patch(`/api/automation-rules/${ruleId}`)
      .set('Cookie', owner.cookie)
      .send({
        name: 'Luat da doi ten',
        isEnabled: false,
        actions: [{ type: 'SET_DONE', boolValue: false }],
      });
    expect(patch.status).toBe(200);
    expect(patch.body.data.rule.name).toBe('Luat da doi ten');
    expect(patch.body.data.rule.isEnabled).toBe(false);
    expect(patch.body.data.rule.actions).toHaveLength(1);
    expect(patch.body.data.rule.actions[0].boolValue).toBe(false);

    const delByOutsider = await agent()
      .delete(`/api/automation-rules/${ruleId}`)
      .set('Cookie', outsider.cookie);
    expect(delByOutsider.status).toBe(403);

    const del = await agent()
      .delete(`/api/automation-rules/${ruleId}`)
      .set('Cookie', owner.cookie);
    expect(del.status).toBe(200);
  });
});
