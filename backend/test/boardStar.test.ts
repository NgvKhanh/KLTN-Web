import { describe, expect, it } from 'vitest';
import {
  addWorkspaceMember,
  agent,
  makeBoard,
  makeUser,
  makeWorkspace,
} from './helpers';

async function listBoards(user: { cookie: string }) {
  const res = await agent().get('/api/boards').set('Cookie', user.cookie);
  return res.body.data.boards as { id: string; isStarred: boolean }[];
}

// Van de #11: danh dau sao phai luu duoc cho nguoi truy cap qua khong gian
describe('#11 danh dau sao bang qua khong gian lam viec', () => {
  it('thanh vien khong gian (chua la thanh vien bang) star -> luu duoc', async () => {
    const owner = await makeUser();
    const viewer = await makeUser();
    const ws = await makeWorkspace(owner);
    await addWorkspaceMember(owner, ws.id, viewer.email, 'MEMBER');

    const board = await makeBoard(owner, { workspaceId: ws.id });
    await agent()
      .patch(`/api/boards/${board.id}`)
      .set('Cookie', owner.cookie)
      .send({ visibility: 'WORKSPACE' })
      .expect(200);

    // viewer chua la thanh vien truc tiep cua bang -> star
    await agent()
      .put(`/api/boards/${board.id}/star`)
      .set('Cookie', viewer.cookie)
      .send({ starred: true })
      .expect(200);

    // Tai lai danh sach bang cua viewer: dau sao con do
    const boards = await listBoards(viewer);
    expect(boards.find((b) => b.id === board.id)?.isStarred).toBe(true);

    // Bo sao
    await agent()
      .put(`/api/boards/${board.id}/star`)
      .set('Cookie', viewer.cookie)
      .send({ starred: false })
      .expect(200);
    const after = await listBoards(viewer);
    expect(after.find((b) => b.id === board.id)?.isStarred).toBe(false);
  });
});
