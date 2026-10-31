import request from 'supertest';
import { createApp } from '../src/app';
import { prisma } from '../src/config/prisma';
import { signToken } from '../src/utils/jwt';

// 1 app dung chung cho moi test (khoi tao Express, khong lang nghe cong)
export const app = createApp();
export const agent = () => request(app);

let seq = 0;

export interface TestUser {
  id: string;
  email: string;
  password: string;
  name: string;
  cookie: string; // "token=..."
  personalWorkspaceId: string;
}

/**
 * Dang ky 1 user moi qua API that, tra ve kem cookie dang nhap.
 * Mac dinh danh dau email DA XAC MINH ngay sau khi dang ky (hau het test dung ham
 * nay de dai dien mot "dong nghiep that" da co san tai khoan, khong phai kich ban
 * kiem tra rieng cho luong xac minh email) - truyen { verified: false } de giu
 * trang thai chua xac minh that su cua /api/auth/register.
 */
export async function makeUser(
  over: Partial<Pick<TestUser, 'email' | 'password' | 'name'>> & {
    verified?: boolean;
  } = {}
): Promise<TestUser> {
  seq += 1;
  const email = over.email ?? `u${seq}_${Date.now()}@test.local`;
  const password = over.password ?? 'Password123';
  const name = over.name ?? `User ${seq}`;

  const res = await agent()
    .post('/api/auth/register')
    .send({ email, password, name });
  if (res.status !== 201) {
    throw new Error(
      `Dang ky that bai: ${res.status} ${JSON.stringify(res.body)}`
    );
  }

  const ws = await prisma.workspace.findFirstOrThrow({
    where: { ownerId: res.body.data.user.id, isPersonal: true },
    select: { id: true },
  });

  if (over.verified !== false) {
    await prisma.user.update({
      where: { id: res.body.data.user.id },
      data: { emailVerifiedAt: new Date() },
    });
  }

  return {
    id: res.body.data.user.id,
    email,
    password,
    name,
    cookie: cookieOf(res),
    personalWorkspaceId: ws.id,
  };
}

/**
 * Tao user THANG vao CSDL (kem khong gian ca nhan nhu luc dang ky that) va ky JWT, KHONG qua
 * /api/auth/register. Dung khi mot file test can nhieu hon ~10 tai khoan: registerLimiter chi cho
 * 10 lan dang ky / gio TINH THEO TUNG FILE. Cookie dung duoc voi moi route co requireAuth.
 */
export async function makeDirectUser(
  name = 'User',
  over: Partial<Pick<TestUser, 'email'>> = {}
): Promise<TestUser> {
  seq += 1;
  const email = over.email ?? `d${seq}_${Date.now()}@test.local`;
  const user = await prisma.user.create({
    data: { email, name, emailVerifiedAt: new Date() },
    select: { id: true, tokenVersion: true },
  });
  const ws = await prisma.workspace.create({
    data: {
      ownerId: user.id,
      name: `Khong gian cua ${name}`,
      isPersonal: true,
      members: { create: { userId: user.id, role: 'OWNER' } },
    },
    select: { id: true },
  });
  return {
    id: user.id,
    email,
    password: '',
    name,
    cookie: `token=${signToken({ userId: user.id, tokenVersion: user.tokenVersion })}`,
    personalWorkspaceId: ws.id,
  };
}

/** Lay cookie "token=..." tu response co Set-Cookie. */
export function cookieOf(res: request.Response): string {
  const raw = res.headers['set-cookie'];
  const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const tok = arr.find((c) => c.startsWith('token='));
  if (!tok) throw new Error('Response khong co cookie token');
  return tok.split(';')[0]!;
}

/** Tao 1 bang cho user, tra ve board (mac dinh o workspace ca nhan). */
export async function makeBoard(
  user: TestUser,
  over: Partial<{ name: string; workspaceId: string }> = {}
) {
  const res = await agent()
    .post('/api/boards')
    .set('Cookie', user.cookie)
    .send({
      name: over.name ?? 'Bang test',
      workspaceId: over.workspaceId ?? user.personalWorkspaceId,
    });
  if (res.status !== 201) {
    throw new Error(`Tao bang that bai: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.board as { id: string; ownerId: string };
}

/** Them 1 thanh vien vao bang bang email (chu bang / admin goi). */
export async function addMember(
  actor: TestUser,
  boardId: string,
  email: string,
  role: 'ADMIN' | 'MEMBER' | 'VIEWER' = 'MEMBER'
) {
  const res = await agent()
    .post(`/api/boards/${boardId}/members`)
    .set('Cookie', actor.cookie)
    .send({ email, role });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(
      `Them thanh vien that bai: ${res.status} ${JSON.stringify(res.body)}`
    );
  }
  return res.body;
}

/** Tao 1 danh sach trong bang, tra ve { id }. */
export async function makeList(user: TestUser, boardId: string, name = 'To do') {
  const res = await agent()
    .post(`/api/boards/${boardId}/lists`)
    .set('Cookie', user.cookie)
    .send({ name });
  if (res.status !== 201) {
    throw new Error(`Tao list that bai: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.list as { id: string };
}

/** Tao 1 the trong danh sach, tra ve { id }. */
export async function makeCard(user: TestUser, listId: string, title = 'The test') {
  const res = await agent()
    .post(`/api/lists/${listId}/cards`)
    .set('Cookie', user.cookie)
    .send({ title });
  if (res.status !== 201) {
    throw new Error(`Tao card that bai: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.card as { id: string };
}

/** Tao 1 khong gian lam viec (khong phai ca nhan), tra ve { id }. */
export async function makeWorkspace(owner: TestUser, name = 'KG test') {
  const res = await agent()
    .post('/api/workspaces')
    .set('Cookie', owner.cookie)
    .send({ name });
  if (res.status !== 201) {
    throw new Error(`Tao workspace that bai: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.workspace as { id: string };
}

/** Them thanh vien vao khong gian lam viec bang email. */
export async function addWorkspaceMember(
  actor: TestUser,
  workspaceId: string,
  email: string,
  role: 'ADMIN' | 'MEMBER' = 'MEMBER'
) {
  const res = await agent()
    .post(`/api/workspaces/${workspaceId}/members`)
    .set('Cookie', actor.cookie)
    .send({ email, role });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(
      `Them thanh vien KG that bai: ${res.status} ${JSON.stringify(res.body)}`
    );
  }
  return res.body;
}
