import { describe, expect, it } from 'vitest';
import { agent, makeBoard, makeCard, makeList, makeUser } from './helpers';

interface BoardRow {
  id: string;
  cardCount: number;
  doneCount: number;
}

async function listBoards(user: { cookie: string }) {
  const res = await agent().get('/api/boards').set('Cookie', user.cookie).expect(200);
  return res.body.data.boards as BoardRow[];
}

// Thanh tien do o danh sach bang: dem GIONG man hinh bang (bo the/danh sach da luu tru)
describe('danh sach bang tra ve cardCount va doneCount', () => {
  it('bang trong: 0 / 0', async () => {
    const user = await makeUser();
    const board = await makeBoard(user);
    const row = (await listBoards(user)).find((b) => b.id === board.id)!;
    expect(row.cardCount).toBe(0);
    expect(row.doneCount).toBe(0);
  });

  it('dem the tren nhieu danh sach va the da hoan thanh', async () => {
    const user = await makeUser();
    const board = await makeBoard(user);
    const l1 = await makeList(user, board.id, 'A');
    const l2 = await makeList(user, board.id, 'B');
    const c1 = await makeCard(user, l1.id, 'c1');
    await makeCard(user, l1.id, 'c2');
    const c3 = await makeCard(user, l2.id, 'c3');

    await agent().patch(`/api/cards/${c1.id}`).set('Cookie', user.cookie).send({ isDone: true }).expect(200);
    await agent().patch(`/api/cards/${c3.id}`).set('Cookie', user.cookie).send({ isDone: true }).expect(200);

    const row = (await listBoards(user)).find((b) => b.id === board.id)!;
    expect(row.cardCount).toBe(3);
    expect(row.doneCount).toBe(2);
  });

  it('the da luu tru khong duoc dem (khop voi man hinh bang)', async () => {
    const user = await makeUser();
    const board = await makeBoard(user);
    const l1 = await makeList(user, board.id);
    const keep = await makeCard(user, l1.id, 'giu');
    const gone = await makeCard(user, l1.id, 'luu tru');
    await agent().patch(`/api/cards/${keep.id}`).set('Cookie', user.cookie).send({ isDone: true }).expect(200);
    await agent().patch(`/api/cards/${gone.id}`).set('Cookie', user.cookie).send({ isDone: true }).expect(200);
    await agent().post(`/api/cards/${gone.id}/archive`).set('Cookie', user.cookie).expect(200);

    const row = (await listBoards(user)).find((b) => b.id === board.id)!;
    expect(row.cardCount).toBe(1);
    expect(row.doneCount).toBe(1);
  });

  it('danh sach da luu tru: cac the ben trong khong duoc dem', async () => {
    const user = await makeUser();
    const board = await makeBoard(user);
    const l1 = await makeList(user, board.id, 'con');
    const l2 = await makeList(user, board.id, 'se luu tru');
    await makeCard(user, l1.id);
    await makeCard(user, l2.id);
    await makeCard(user, l2.id);
    await agent().post(`/api/lists/${l2.id}/archive`).set('Cookie', user.cookie).expect(200);

    const row = (await listBoards(user)).find((b) => b.id === board.id)!;
    expect(row.cardCount).toBe(1);
  });

  it('moi bang chi dem the cua chinh no', async () => {
    const user = await makeUser();
    const b1 = await makeBoard(user, { name: 'Mot' });
    const b2 = await makeBoard(user, { name: 'Hai' });
    const l1 = await makeList(user, b1.id);
    const l2 = await makeList(user, b2.id);
    await makeCard(user, l1.id);
    await makeCard(user, l2.id);
    await makeCard(user, l2.id);
    const rows = await listBoards(user);
    expect(rows.find((b) => b.id === b1.id)?.cardCount).toBe(1);
    expect(rows.find((b) => b.id === b2.id)?.cardCount).toBe(2);
  });

  it('khong lo bang cua nguoi khac: chi tra ve bang minh xem duoc', async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const board = await makeBoard(owner);
    const l = await makeList(owner, board.id);
    await makeCard(owner, l.id);
    const rows = await listBoards(stranger);
    expect(rows.find((b) => b.id === board.id)).toBeUndefined();
  });
});
