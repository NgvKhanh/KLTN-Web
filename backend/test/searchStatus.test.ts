import { describe, expect, it } from 'vitest';
import { agent, makeBoard, makeCard, makeDirectUser, type TestUser } from './helpers';

// Tim kiem nang cao: loc theo trang thai cong viec (tham so "statuses", chon nhieu).

type Status = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'DONE' | 'BLOCKED';

async function setStatus(user: TestUser, cardId: string, status: Status) {
  await agent().patch(`/api/cards/${cardId}`).set('Cookie', user.cookie).send({ status }).expect(200);
}

async function search(user: TestUser, qs: string) {
  return agent().get(`/api/search/cards?${qs}`).set('Cookie', user.cookie);
}

const ids = (res: { body: { data: { items: { id: string }[] } } }) =>
  res.body.data.items.map((c) => c.id).sort();

async function setup() {
  const owner = await makeDirectUser();
  const board = await makeBoard(owner);
  // Cot tu do: doi trang thai the chi doi nhan, the o yen -> de dung du lieu
  const listRes = await agent()
    .post(`/api/boards/${board.id}/lists`)
    .set('Cookie', owner.cookie)
    .send({ name: 'Cot tu do', status: null });
  const listId = listRes.body.data.list.id as string;

  const todo = await makeCard(owner, listId, 'Viec A');
  const doing = await makeCard(owner, listId, 'Viec B');
  const blocked = await makeCard(owner, listId, 'Viec C');
  const done = await makeCard(owner, listId, 'Viec D');
  await setStatus(owner, doing.id, 'IN_PROGRESS');
  await setStatus(owner, blocked.id, 'BLOCKED');
  await setStatus(owner, done.id, 'DONE');
  return { owner, todo, doing, blocked, done };
}

describe('GET /api/search/cards - loc theo trang thai', () => {
  it('1 trang thai -> chi the o trang thai do; ket qua tra ve kem status', async () => {
    const { owner, blocked } = await setup();
    const res = await search(owner, 'statuses=BLOCKED');
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual([blocked.id]);
    expect(res.body.data.items[0].status).toBe('BLOCKED');
  });

  it('nhieu trang thai -> khop 1 trong so do', async () => {
    const { owner, doing, blocked } = await setup();
    const res = await search(owner, 'statuses=IN_PROGRESS,BLOCKED');
    expect(ids(res)).toEqual([doing.id, blocked.id].sort());
  });

  it('ket hop voi dieu kien khac (AND): tu khoa + trang thai', async () => {
    const { owner, doing } = await setup();
    const hit = await search(owner, 'q=Viec B&statuses=IN_PROGRESS');
    expect(ids(hit)).toEqual([doing.id]);
    const miss = await search(owner, 'q=Viec A&statuses=IN_PROGRESS');
    expect(miss.body.data.total).toBe(0);
  });

  it('bo trong / khong gui -> khong loc theo trang thai', async () => {
    const { owner } = await setup();
    expect((await search(owner, '')).body.data.total).toBe(4);
    expect((await search(owner, 'statuses=')).body.data.total).toBe(4);
  });

  it('trang thai sai -> 400', async () => {
    const owner = await makeDirectUser();
    expect((await search(owner, 'statuses=IN_PROGRESS,LAM_XONG')).status).toBe(400);
  });
});

describe('Bo loc da luu - giu duoc danh sach trang thai', () => {
  it('luu statuses roi doc lai dung; trang thai sai -> 400', async () => {
    const owner = await makeDirectUser();
    const ok = await agent()
      .post('/api/search/filters')
      .set('Cookie', owner.cookie)
      .send({ name: 'Dang ket', params: { statuses: ['IN_PROGRESS', 'BLOCKED'] } });
    expect(ok.status).toBe(201);

    const list = await agent().get('/api/search/filters').set('Cookie', owner.cookie);
    expect(list.body.data.filters[0].params.statuses).toEqual(['IN_PROGRESS', 'BLOCKED']);

    const bad = await agent()
      .post('/api/search/filters')
      .set('Cookie', owner.cookie)
      .send({ name: 'Sai', params: { statuses: ['XONG'] } });
    expect(bad.status).toBe(400);
  });
});
