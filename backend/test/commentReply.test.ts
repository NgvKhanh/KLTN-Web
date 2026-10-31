import { describe, expect, it } from 'vitest';
import {
  addMember,
  agent,
  makeBoard,
  makeCard,
  makeDirectUser,
  makeList,
  type TestUser,
} from './helpers';

// Tra loi binh luan: luong 1 cap (parentId luon tro ve binh luan GOC), thong bao
// "card.comment.reply" cho nguoi duoc tra loi, xoa goc con tra loi thi hien "da xoa".
// User tao THANG vao CSDL (makeDirectUser): registerLimiter chi cho 10 dang ky / gio moi file.

interface ApiComment {
  id: string;
  parentId: string | null;
  text: string;
  deleted: boolean;
  user: { id: string; name: string };
}

async function setup() {
  const owner = await makeDirectUser('Chu Bang');
  const member = await makeDirectUser('Thanh Vien');
  const board = await makeBoard(owner);
  await addMember(owner, board.id, member.email);
  const list = await makeList(owner, board.id);
  const card = await makeCard(owner, list.id);
  return { owner, member, board, card };
}

function comment(user: TestUser, cardId: string, text: string, parentId?: string) {
  return agent()
    .post(`/api/cards/${cardId}/comments`)
    .set('Cookie', user.cookie)
    .send(parentId ? { text, parentId } : { text });
}

async function cardComments(user: TestUser, cardId: string): Promise<ApiComment[]> {
  const res = await agent().get(`/api/cards/${cardId}`).set('Cookie', user.cookie).expect(200);
  return res.body.data.card.comments as ApiComment[];
}

async function notificationsOf(user: TestUser, cardId: string) {
  const res = await agent().get('/api/notifications').set('Cookie', user.cookie).expect(200);
  return (res.body.data.notifications as { type: string; cardId: string }[]).filter(
    (n) => n.cardId === cardId
  );
}

describe('Tra loi binh luan', () => {
  it('tra loi binh luan goc -> parentId = goc; tra loi mot cau tra loi -> van gan vao goc (1 cap)', async () => {
    const { owner, member, card } = await setup();
    const root = (await comment(owner, card.id, 'Binh luan goc').expect(201)).body.data.comment;
    expect(root.parentId).toBeNull();

    const r1 = (await comment(member, card.id, 'Tra loi 1', root.id).expect(201)).body.data.comment;
    expect(r1.parentId).toBe(root.id);

    const r2 = (await comment(owner, card.id, 'Tra loi cua tra loi', r1.id).expect(201)).body.data.comment;
    expect(r2.parentId).toBe(root.id);

    const list = await cardComments(owner, card.id);
    expect(list.map((c) => [c.text, c.parentId])).toEqual(
      expect.arrayContaining([
        ['Binh luan goc', null],
        ['Tra loi 1', root.id],
        ['Tra loi cua tra loi', root.id],
      ])
    );
    expect(list.every((c) => c.deleted === false)).toBe(true);
  });

  it('khong tra loi duoc binh luan cua the khac, binh luan da xoa, hay id khong ton tai -> 404', async () => {
    const { owner, board, card } = await setup();
    const list2 = await makeList(owner, board.id, 'Khac');
    const other = await makeCard(owner, list2.id, 'The khac');
    const foreign = (await comment(owner, other.id, 'O the khac').expect(201)).body.data.comment;
    await comment(owner, card.id, 'Tra loi lac the', foreign.id).expect(404);

    const gone = (await comment(owner, card.id, 'Se bi xoa').expect(201)).body.data.comment;
    await agent().delete(`/api/comments/${gone.id}`).set('Cookie', owner.cookie).expect(200);
    await comment(owner, card.id, 'Tra loi binh luan da xoa', gone.id).expect(404);

    await comment(owner, card.id, 'Tra loi ma', 'khong-ton-tai').expect(404);
    // Khong co cau tra loi lac nao bi tao ra
    expect((await cardComments(owner, card.id)).map((c) => c.text)).toEqual([]);
  });

  it('nguoi bi tra loi nhan dung 1 thong bao "card.comment.reply"; tu tra loi minh thi khong', async () => {
    const { owner, member, card } = await setup();
    const root = (await comment(member, card.id, 'Cau hoi cua thanh vien').expect(201)).body.data.comment;

    await comment(owner, card.id, 'Chu bang tra loi', root.id).expect(201);
    const got = await notificationsOf(member, card.id);
    expect(got.map((n) => n.type)).toEqual(['card.comment.reply']);

    await comment(owner, card.id, 'Chu bang tu tra loi chinh minh', root.id).expect(201);
    const ownerGot = await notificationsOf(owner, card.id);
    expect(ownerGot.some((n) => n.type === 'card.comment.reply')).toBe(false);
  });

  it('vua duoc tra loi vua duoc nhac ten -> chi nhan "card.mentioned" (khong trung)', async () => {
    const { owner, member, card } = await setup();
    const root = (await comment(member, card.id, 'Hoi').expect(201)).body.data.comment;
    await comment(owner, card.id, '@Thanh Vien day nhe', root.id).expect(201);
    const got = await notificationsOf(member, card.id);
    expect(got.map((n) => n.type)).toEqual(['card.mentioned']);
  });

  it('nguoi bi tra loi da bi moi ra khoi bang -> khong nhan thong bao tra loi', async () => {
    const { owner, member, board, card } = await setup();
    const root = (await comment(member, card.id, 'Truoc khi roi bang').expect(201)).body.data.comment;
    await agent()
      .delete(`/api/boards/${board.id}/members/${member.id}`)
      .set('Cookie', owner.cookie)
      .expect((r) => expect([200, 204]).toContain(r.status));

    await comment(owner, card.id, 'Tra loi sau khi da roi', root.id).expect(201);
    const got = await notificationsOf(member, card.id);
    expect(got.some((n) => n.type === 'card.comment.reply')).toBe(false);
  });

  it('xoa goc dang co tra loi -> goc hien "da xoa" (khong lo noi dung), tra loi van con; xoa het tra loi -> goc bien mat', async () => {
    const { owner, member, card } = await setup();
    const root = (await comment(owner, card.id, 'Noi dung bi mat').expect(201)).body.data.comment;
    const reply = (await comment(member, card.id, 'Cau tra loi', root.id).expect(201)).body.data.comment;

    await agent().delete(`/api/comments/${root.id}`).set('Cookie', owner.cookie).expect(200);
    let list = await cardComments(member, card.id);
    const shownRoot = list.find((c) => c.id === root.id);
    expect(shownRoot).toMatchObject({ deleted: true, text: '' });
    expect(JSON.stringify(list)).not.toContain('Noi dung bi mat');
    expect(list.find((c) => c.id === reply.id)).toMatchObject({ deleted: false, text: 'Cau tra loi' });

    // Van tra loi duoc trong luong qua cau tra loi con lai
    const r2 = (await comment(owner, card.id, 'Tiep tuc luong', reply.id).expect(201)).body.data.comment;
    expect(r2.parentId).toBe(root.id);

    await agent().delete(`/api/comments/${reply.id}`).set('Cookie', member.cookie).expect(200);
    await agent().delete(`/api/comments/${r2.id}`).set('Cookie', owner.cookie).expect(200);
    list = await cardComments(owner, card.id);
    expect(list).toEqual([]);
  });

  it('bang cong khai: khach xem the cung thay luong + goc da xoa duoc che noi dung', async () => {
    const { owner, member, board, card } = await setup();
    await agent()
      .patch(`/api/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .send({ visibility: 'PUBLIC' })
      .expect(200);
    const root = (await comment(owner, card.id, 'Goc cong khai bi xoa').expect(201)).body.data.comment;
    await comment(member, card.id, 'Tra loi cong khai', root.id).expect(201);
    await agent().delete(`/api/comments/${root.id}`).set('Cookie', owner.cookie).expect(200);

    const res = await agent().get(`/api/public/cards/${card.id}`).expect(200);
    const list = res.body.data.card.comments as ApiComment[];
    expect(list.find((c) => c.id === root.id)).toMatchObject({ deleted: true, text: '' });
    expect(list.find((c) => c.text === 'Tra loi cong khai')?.parentId).toBe(root.id);
    expect(JSON.stringify(list)).not.toContain('Goc cong khai bi xoa');
    expect(JSON.stringify(list)).not.toContain('deletedAt');
  });
});
