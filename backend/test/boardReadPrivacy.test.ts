// Chinh sach DOC thong nhat cho bang PUBLIC (REVIEW 26/09 #2, 30/09 #3, 14/10): nguoi dang nhap nhung KHONG thuoc
// bang (chi xem duoc vi bang la PUBLIC) khong duoc thay EMAIL that cua nguoi khac, va KHONG ai ngoai endpoint
// /invite-link duoc nhan inviteToken. boardPublicLeak.test.ts giu 2 duong dau (members, chi tiet bang); file nay
// phu cac duong con lai: danh sach + the, chi tiet the, xuat bang, danh sach bang cua toi, va cac phan hoi ghi.
// Dung makeDirectUser: file nay can nhieu hon 10 tai khoan (registerLimiter chi cho 10 lan dang ky / gio / file).
import { describe, expect, it } from 'vitest';
import {
  addMember,
  addWorkspaceMember,
  agent,
  makeBoard,
  makeCard,
  makeDirectUser,
  makeList,
  makeWorkspace,
  type TestUser,
} from './helpers';

function ok(res: { status: number; body: unknown }, what: string) {
  if (res.status >= 300) throw new Error(`${what} that bai: ${res.status} ${JSON.stringify(res.body)}`);
}

/** Bang PUBLIC co link moi dang bat, 1 danh sach, 1 the co chu bang lam thanh vien the + 1 binh luan. */
async function publicBoardWithContent(owner: TestUser) {
  const board = await makeBoard(owner);
  const vis = await agent().patch(`/api/boards/${board.id}`).set('Cookie', owner.cookie).send({ visibility: 'PUBLIC' });
  ok(vis, 'doi hien thi');
  const enable = await agent().post(`/api/boards/${board.id}/invite-link`).set('Cookie', owner.cookie);
  ok(enable, 'bat link moi');
  const link = await agent().get(`/api/boards/${board.id}/invite-link`).set('Cookie', owner.cookie);
  ok(link, 'doc link moi');
  const token = link.body.data.token as string;
  expect(token.length).toBeGreaterThan(8);
  const list = await makeList(owner, board.id);
  const card = await makeCard(owner, list.id, 'The cong khai');
  ok(await agent().post(`/api/cards/${card.id}/members`).set('Cookie', owner.cookie).send({ userId: owner.id }), 'gan thanh vien the');
  ok(await agent().post(`/api/cards/${card.id}/comments`).set('Cookie', owner.cookie).send({ text: 'binh luan thu' }), 'binh luan');
  return { board, list, card, token };
}

const text = (body: unknown) => JSON.stringify(body);

describe('bang PUBLIC: email thanh vien khong lo qua cac duong doc long nhau', () => {
  it('GET /boards/:id/lists - nguoi ngoai khong thay email; chu bang van thay', async () => {
    const owner = await makeDirectUser('Chu');
    const outsider = await makeDirectUser('Nguoi la');
    const { board } = await publicBoardWithContent(owner);

    const asOutsider = await agent().get(`/api/boards/${board.id}/lists`).set('Cookie', outsider.cookie);
    expect(asOutsider.status).toBe(200);
    // van thay noi dung (ten the, ten thanh vien) - chi email bi che
    expect(text(asOutsider.body)).toContain('The cong khai');
    expect(text(asOutsider.body)).toContain('Chu');
    expect(text(asOutsider.body)).not.toContain(owner.email);

    const asOwner = await agent().get(`/api/boards/${board.id}/lists`).set('Cookie', owner.cookie);
    expect(asOwner.status).toBe(200);
    expect(text(asOwner.body)).toContain(owner.email);
  });

  it('GET /cards/:id - nguoi ngoai khong thay email thanh vien the / nguoi binh luan; chu bang van thay', async () => {
    const owner = await makeDirectUser('Chu');
    const outsider = await makeDirectUser('Nguoi la');
    const { card } = await publicBoardWithContent(owner);

    const asOutsider = await agent().get(`/api/cards/${card.id}`).set('Cookie', outsider.cookie);
    expect(asOutsider.status).toBe(200);
    expect(text(asOutsider.body)).toContain('binh luan thu');
    expect(text(asOutsider.body)).not.toContain(owner.email);

    const asOwner = await agent().get(`/api/cards/${card.id}`).set('Cookie', owner.cookie);
    expect(asOwner.status).toBe(200);
    expect(text(asOwner.body)).toContain(owner.email);
  });

  it('GET /boards/:id/export - nguoi ngoai khong thay email; KHONG AI nhan inviteToken', async () => {
    const owner = await makeDirectUser('Chu');
    const outsider = await makeDirectUser('Nguoi la');
    const { board, token } = await publicBoardWithContent(owner);

    const asOutsider = await agent().get(`/api/boards/${board.id}/export`).set('Cookie', outsider.cookie);
    expect(asOutsider.status).toBe(200);
    expect(text(asOutsider.body)).toContain('The cong khai');
    expect(text(asOutsider.body)).not.toContain(owner.email);
    expect(text(asOutsider.body)).not.toContain(token);

    const asOwner = await agent().get(`/api/boards/${board.id}/export`).set('Cookie', owner.cookie);
    expect(asOwner.status).toBe(200);
    expect(text(asOwner.body)).toContain(owner.email); // noi dung cua chinh ho
    expect(text(asOwner.body)).not.toContain(token); // ma truy cap khong nam trong ban xuat
    expect(asOwner.body.data.board.inviteToken).toBeUndefined();
  });

  it('thanh vien bang muc WORKSPACE (chi qua khong gian) van thay email nhu cu - khong bi che nham', async () => {
    const owner = await makeDirectUser('Chu');
    const colleague = await makeDirectUser('Dong nghiep');
    const ws = await makeWorkspace(owner, 'Nhom');
    await addWorkspaceMember(owner, ws.id, colleague.email, 'MEMBER');
    const board = await makeBoard(owner, { workspaceId: ws.id });
    ok(
      await agent().patch(`/api/boards/${board.id}`).set('Cookie', owner.cookie).send({ visibility: 'WORKSPACE' }),
      'doi hien thi WORKSPACE'
    );
    const list = await makeList(owner, board.id);
    const card = await makeCard(owner, list.id, 'The noi bo');
    ok(await agent().post(`/api/cards/${card.id}/members`).set('Cookie', owner.cookie).send({ userId: owner.id }), 'gan thanh vien the');

    const lists = await agent().get(`/api/boards/${board.id}/lists`).set('Cookie', colleague.cookie);
    expect(lists.status).toBe(200);
    expect(text(lists.body)).toContain(owner.email);
    const detail = await agent().get(`/api/cards/${card.id}`).set('Cookie', colleague.cookie);
    expect(detail.status).toBe(200);
    expect(text(detail.body)).toContain(owner.email);
  });
});

describe('inviteToken chi di qua /invite-link', () => {
  it('GET /boards: VIEWER (va thanh vien) khong nhan duoc inviteToken, chu bang cung khong', async () => {
    const owner = await makeDirectUser('Chu');
    const viewer = await makeDirectUser('Chi xem');
    const member = await makeDirectUser('Thanh vien');
    const { board, token } = await publicBoardWithContent(owner);
    await addMember(owner, board.id, viewer.email, 'VIEWER');
    await addMember(owner, board.id, member.email, 'MEMBER');

    for (const [who, user] of [['VIEWER', viewer], ['MEMBER', member], ['chu bang', owner]] as const) {
      const res = await agent().get('/api/boards').set('Cookie', user.cookie);
      expect(res.status, who).toBe(200);
      const rows = (res.body.data.boards ?? res.body.data) as Array<{ id: string; inviteToken?: unknown }>;
      const row = rows.find((b) => b.id === board.id);
      expect(row, who).toBeDefined();
      expect(row!.inviteToken, who).toBeUndefined();
      expect(text(res.body), who).not.toContain(token);
    }

    // /invite-link van chi danh cho nguoi quan ly (chuc nang khong bi anh huong)
    const direct = await agent().get(`/api/boards/${board.id}/invite-link`).set('Cookie', viewer.cookie);
    expect(direct.status).toBe(403);
  });

  it('phan hoi cua thao tac ghi (doi ten bang) khong chua inviteToken - ke ca khi nguoi sua chi la MEMBER', async () => {
    const owner = await makeDirectUser('Chu');
    const member = await makeDirectUser('Thanh vien');
    const { board, token } = await publicBoardWithContent(owner);
    await addMember(owner, board.id, member.email, 'MEMBER');

    const res = await agent().patch(`/api/boards/${board.id}`).set('Cookie', member.cookie).send({ name: 'Ten moi' });
    expect(res.status).toBe(200);
    expect(res.body.data.board.name).toBe('Ten moi');
    expect(res.body.data.board.inviteToken).toBeUndefined();
    expect(text(res.body)).not.toContain(token);
  });
});
