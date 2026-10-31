import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { agent, makeBoard, makeUser, makeWorkspace } from './helpers';

// CODE_REVIEW.md #2: mot ke tan cong dang ky truoc bang email cua nguoi khac (dang ky
// KHONG doi hoi xac minh email) roi "chiem cho" tai khoan do. Truoc day, quan tri vien
// moi thanh vien bang/khong gian bang dung email do se cap quyen NGAY cho tai khoan bi
// chiem cho, du chua ai chung minh so huu email that. Xem them googleAccountLink.test.ts
// cho #1 (lien ket dang nhap Google vao tai khoan chua xac minh).
describe('#2 moi thanh vien bang email khong duoc cap quyen ngay cho tai khoan CHUA xac minh', () => {
  it('POST /api/boards/:id/members: email thuoc tai khoan chua xac minh -> gui email moi, KHONG tao membership', async () => {
    const owner = await makeUser();
    const squatter = await makeUser({ verified: false });
    const board = await makeBoard(owner);

    const res = await agent()
      .post(`/api/boards/${board.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ email: squatter.email, role: 'MEMBER' });

    expect(res.status).toBe(200);
    expect(res.body.data.invitedEmail).toBe(squatter.email);

    const membership = await prisma.boardMember.findFirst({
      where: { boardId: board.id, userId: squatter.id },
    });
    expect(membership).toBeNull();
  });

  it('POST /api/boards/:id/members: email thuoc tai khoan DA xac minh -> van vao thang nhu cu', async () => {
    const owner = await makeUser();
    const teammate = await makeUser();
    const board = await makeBoard(owner);

    const res = await agent()
      .post(`/api/boards/${board.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ email: teammate.email, role: 'MEMBER' });

    expect(res.status).toBe(201);
    expect(res.body.data.member.userId).toBe(teammate.id);
  });

  it('POST /api/workspaces/:id/members: email thuoc tai khoan chua xac minh -> gui email moi, KHONG tao membership', async () => {
    const owner = await makeUser();
    const squatter = await makeUser({ verified: false });
    const ws = await makeWorkspace(owner);

    const res = await agent()
      .post(`/api/workspaces/${ws.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ email: squatter.email, role: 'MEMBER' });

    expect(res.status).toBe(200);
    expect(res.body.data.invitedEmail).toBe(squatter.email);

    const membership = await prisma.workspaceMember.findFirst({
      where: { workspaceId: ws.id, userId: squatter.id },
    });
    expect(membership).toBeNull();
  });

  it('POST /api/workspaces/:id/members: email thuoc tai khoan DA xac minh -> van vao thang nhu cu', async () => {
    const owner = await makeUser();
    const teammate = await makeUser();
    const ws = await makeWorkspace(owner);

    const res = await agent()
      .post(`/api/workspaces/${ws.id}/members`)
      .set('Cookie', owner.cookie)
      .send({ email: teammate.email, role: 'MEMBER' });

    expect(res.status).toBe(201);
    expect(res.body.data.member.userId).toBe(teammate.id);
  });
});
