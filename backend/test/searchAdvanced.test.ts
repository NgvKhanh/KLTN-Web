import { describe, expect, it } from 'vitest';
import {
  addMember,
  agent,
  makeBoard,
  makeCard,
  makeList,
  makeUser,
} from './helpers';

describe('GET /api/search/cards - tim kiem nang cao xuyen board', () => {
  it('loc theo tu khoa + trang thai + phan trang', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);

    const match = await makeCard(owner, list.id, 'Bao cao thang 9');
    await makeCard(owner, list.id, 'Viec khac khong lien quan');
    const doneMatch = await makeCard(owner, list.id, 'Bao cao thang 8');
    await agent()
      .patch(`/api/cards/${doneMatch.id}`)
      .set('Cookie', owner.cookie)
      .send({ isDone: true });

    const res = await agent()
      .get('/api/search/cards?q=Bao cao&status=active')
      .set('Cookie', owner.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].id).toBe(match.id);
  });

  it('loc theo nguoi phu trach: "me" va "unassigned"', async () => {
    const owner = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);

    const mine = await makeCard(owner, list.id, 'The cua toi');
    await agent()
      .post(`/api/cards/${mine.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ userId: owner.id });
    await makeCard(owner, list.id, 'The chua giao');

    const meRes = await agent()
      .get('/api/search/cards?assignee=me')
      .set('Cookie', owner.cookie);
    expect(meRes.body.data.items).toHaveLength(1);
    expect(meRes.body.data.items[0].id).toBe(mine.id);

    const unassignedRes = await agent()
      .get('/api/search/cards?assignee=unassigned')
      .set('Cookie', owner.cookie);
    expect(unassignedRes.body.data.items).toHaveLength(1);
    expect(unassignedRes.body.data.items[0].id).not.toBe(mine.id);
  });

  it('loc qua han (overdue) va theo ten nhan, xuyen 2 bang khac nhau', async () => {
    const owner = await makeUser();
    const board1 = await makeBoard(owner, { name: 'Bang 1' });
    const board2 = await makeBoard(owner, { name: 'Bang 2' });
    const list1 = await makeList(owner, board1.id);
    const list2 = await makeList(owner, board2.id);

    const overdueCard = await makeCard(owner, list1.id, 'The qua han');
    await agent()
      .patch(`/api/cards/${overdueCard.id}`)
      .set('Cookie', owner.cookie)
      .send({ dueDate: '2020-01-01T00:00:00.000Z' });

    const labelRes = await agent()
      .post(`/api/boards/${board2.id}/labels`)
      .set('Cookie', owner.cookie)
      .send({ name: 'Gap', color: '#ff0000' });
    const labelId = labelRes.body.data.label.id as string;
    const labeledCard = await makeCard(owner, list2.id, 'The co nhan Gap');
    await agent()
      .put(`/api/cards/${labeledCard.id}/labels/${labelId}`)
      .set('Cookie', owner.cookie);

    const overdueRes = await agent()
      .get('/api/search/cards?overdue=true')
      .set('Cookie', owner.cookie);
    expect(overdueRes.body.data.items.map((c: { id: string }) => c.id)).toEqual([
      overdueCard.id,
    ]);

    const labelRes2 = await agent()
      .get('/api/search/cards?labelName=gap')
      .set('Cookie', owner.cookie);
    expect(labelRes2.body.data.items.map((c: { id: string }) => c.id)).toEqual([
      labeledCard.id,
    ]);
  });

  it('khong thay the tren bang minh khong co quyen', async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const board = await makeBoard(owner);
    const list = await makeList(owner, board.id);
    await makeCard(owner, list.id, 'The rieng tu cua owner');

    const res = await agent()
      .get('/api/search/cards?q=rieng tu')
      .set('Cookie', outsider.cookie);
    expect(res.body.data.total).toBe(0);
  });
});

describe('Bo loc ca nhan da luu (SavedFilter)', () => {
  it('luu, liet ke, xoa bo loc - rieng cho tung nguoi dung', async () => {
    const owner = await makeUser();
    const other = await makeUser();

    const create = await agent()
      .post('/api/search/filters')
      .set('Cookie', owner.cookie)
      .send({
        name: 'Viec cua toi qua han',
        params: { assignee: 'me', overdue: true },
      });
    expect(create.status).toBe(201);
    expect(create.body.data.filter.name).toBe('Viec cua toi qua han');

    const list = await agent()
      .get('/api/search/filters')
      .set('Cookie', owner.cookie);
    expect(list.body.data.filters).toHaveLength(1);

    const otherList = await agent()
      .get('/api/search/filters')
      .set('Cookie', other.cookie);
    expect(otherList.body.data.filters).toHaveLength(0);

    const filterId = create.body.data.filter.id as string;
    const del = await agent()
      .delete(`/api/search/filters/${filterId}`)
      .set('Cookie', owner.cookie);
    expect(del.status).toBe(200);

    const listAfter = await agent()
      .get('/api/search/filters')
      .set('Cookie', owner.cookie);
    expect(listAfter.body.data.filters).toHaveLength(0);
  });

  it('luu trung ten -> ghi de dieu kien cu thay vi loi', async () => {
    const owner = await makeUser();
    await agent()
      .post('/api/search/filters')
      .set('Cookie', owner.cookie)
      .send({ name: 'Trung ten', params: { status: 'active' } });

    const res = await agent()
      .post('/api/search/filters')
      .set('Cookie', owner.cookie)
      .send({ name: 'Trung ten', params: { status: 'done' } });
    expect(res.status).toBe(201);

    const list = await agent()
      .get('/api/search/filters')
      .set('Cookie', owner.cookie);
    expect(list.body.data.filters).toHaveLength(1);
    expect(list.body.data.filters[0].params.status).toBe('done');
  });

  it('khong xoa duoc bo loc cua nguoi khac -> 404', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const create = await agent()
      .post('/api/search/filters')
      .set('Cookie', owner.cookie)
      .send({ name: 'Cua owner', params: {} });
    const filterId = create.body.data.filter.id as string;

    const res = await agent()
      .delete(`/api/search/filters/${filterId}`)
      .set('Cookie', other.cookie);
    expect(res.status).toBe(404);
  });
});
