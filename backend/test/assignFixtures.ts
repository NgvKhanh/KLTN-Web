// Cac ham dung "the gioi" (nguoi dung, khong gian, bang, the, luot goi y) dung chung cho cac tep test assign.
// Tach ra tu assign.api.test.ts o buoc 6a de assign.learning.test.ts khong phai chep lai.
// LUU Y: user duoc tao THANG vao CSDL bang makeDirectUser (registerLimiter chi cho 10 dang ky / gio moi tep).
import { expect } from 'vitest';
import { prisma } from '../src/config/prisma';
import { agent, makeDirectUser, type TestUser } from './helpers';

export const DAY = 86_400_000;
export const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
export const daysAhead = (n: number) => new Date(Date.now() + n * DAY);

// ---------- Dung the gioi ----------

export interface World {
  owner: TestUser;
  alice: TestUser;
  bob: TestUser;
  viewer: TestUser;
  outsider: TestUser;
  wsId: string;
  boardId: string;
  listId: string;
}

/** Khong gian + 1 bang: owner (chu bang), alice/bob (MEMBER), viewer (VIEWER); outsider khong lien quan. */
export async function world(visibility: 'PRIVATE' | 'WORKSPACE' = 'PRIVATE'): Promise<World> {
  const owner = await makeDirectUser('Owner');
  const alice = await makeDirectUser('Alice');
  const bob = await makeDirectUser('Bob');
  const viewer = await makeDirectUser('Viewer');
  const outsider = await makeDirectUser('Outsider');
  const ws = await prisma.workspace.create({
    data: { ownerId: owner.id, name: 'Nhom', members: { create: { userId: owner.id, role: 'OWNER' } } },
    select: { id: true },
  });
  const board = await prisma.board.create({
    data: {
      ownerId: owner.id,
      workspaceId: ws.id,
      name: 'Bang 1',
      visibility,
      lists: { create: { name: 'To do' } },
      members: {
        create: [
          { userId: owner.id, role: 'OWNER' },
          { userId: alice.id, role: 'MEMBER' },
          { userId: bob.id, role: 'MEMBER' },
          { userId: viewer.id, role: 'VIEWER' },
        ],
      },
    },
    include: { lists: { select: { id: true } } },
  });
  return { owner, alice, bob, viewer, outsider, wsId: ws.id, boardId: board.id, listId: board.lists[0]!.id };
}

/** Them mot bang nua vao khong gian (chi owner + cac thanh vien chi dinh la thanh vien bang). */
export async function extraBoard(
  w: World,
  o: { name: string; visibility?: 'PRIVATE' | 'WORKSPACE' | 'PUBLIC'; members?: string[]; archived?: boolean; deleted?: boolean; workspaceId?: string }
) {
  const board = await prisma.board.create({
    data: {
      ownerId: w.owner.id,
      workspaceId: o.workspaceId ?? w.wsId,
      name: o.name,
      visibility: o.visibility ?? 'PRIVATE',
      archivedAt: o.archived ? new Date() : null,
      deletedAt: o.deleted ? new Date() : null,
      lists: { create: { name: 'To do' } },
      members: { create: [w.owner.id, ...(o.members ?? [])].map((userId, i) => ({ userId, role: i === 0 ? ('OWNER' as const) : ('MEMBER' as const) })) },
    },
    include: { lists: { select: { id: true } } },
  });
  return { id: board.id, listId: board.lists[0]!.id };
}

export interface CardSpec {
  title: string;
  description?: string | null;
  done?: boolean;
  completedAt?: Date;
  dueDate?: Date | null;
  startDate?: Date | null;
  members?: string[];
  assignedAt?: Date;
  archivedAt?: Date | null;
  deletedAt?: Date | null;
  createdAt?: Date;
}

export async function mkCard(listId: string, o: CardSpec): Promise<{ id: string }> {
  const done = o.done ?? false;
  return prisma.card.create({
    data: {
      listId,
      title: o.title,
      description: o.description ?? null,
      isDone: done,
      completedAt: done ? (o.completedAt ?? daysAgo(10)) : null,
      dueDate: o.dueDate ?? null,
      startDate: o.startDate ?? null,
      archivedAt: o.archivedAt ?? null,
      deletedAt: o.deletedAt ?? null,
      createdAt: o.createdAt ?? daysAgo(60),
      members: { create: (o.members ?? []).map((userId) => ({ userId, createdAt: o.assignedAt ?? daysAgo(40) })) },
    },
    select: { id: true },
  });
}

export const TITLE_TARGET = 'Thiet ke giao dien quen mat khau';
export const SIMILAR = ['Thiet ke giao dien dang nhap', 'Thiet ke giao dien dang ky', 'Thiet ke giao dien trang chu'];

/** Cho `userId` lam xong cac the giong the moi, dung han. */
export async function giveHistory(listId: string, userId: string, titles: string[] = SIMILAR) {
  const made: string[] = [];
  for (const [i, title] of titles.entries()) {
    const c = await mkCard(listId, { title, done: true, completedAt: daysAgo(30 + i), dueDate: daysAgo(25 + i), members: [userId] });
    made.push(c.id);
  }
  return made;
}

export const newTarget = (listId: string, over: Partial<CardSpec> = {}) =>
  mkCard(listId, { title: TITLE_TARGET, dueDate: daysAhead(5), startDate: daysAgo(1), ...over });

// ---------- Goi API ----------

export interface Cand {
  rank: number;
  user: { id: string; name: string; avatarUrl: string | null };
  score: number | null;
  rawScore: number | null;
  confidence: number;
  confidenceLevel: string;
  components: Record<'experience' | 'reliability' | 'availability' | 'declared', { value: number | null; weight: number; scaled: number | null; share: number }>;
  /** Buoc 16: muc ho so tu khai khop nhat (muc CV luon title = null). */
  declaredEvidence: { kind: 'SKILL' | 'WORK' | 'CV'; itemId: string; title: string | null; sim: number }[];
  load: number;
  capacity: number;
  flags: string[];
  assigned: boolean;
  evidence: { cardId: string; title: string | null; sim: number; weight: number; outcome: string; completedAt: string; dueDate: string | null }[];
}

export const suggest = (u: TestUser | null, cardId: string) => {
  const r = agent().get(`/api/cards/${cardId}/assignment-suggestions`);
  return u ? r.set('Cookie', u.cookie) : r;
};
export const candOf = (body: { data: { candidates: Cand[] } }, u: TestUser): Cand => {
  const c = body.data.candidates.find((x) => x.user.id === u.id);
  if (!c) throw new Error(`Khong co ung vien ${u.name}`);
  return c;
};
export const idsOf = (body: { data: { candidates: Cand[] } }) => body.data.candidates.map((c) => c.user.id).sort();
export const sorted = (xs: string[]) => [...xs].sort();

// ---------- Trong so (cua khong gian) ----------

export interface WsWorld {
  owner: TestUser;
  admin: TestUser;
  member: TestUser;
  outsider: TestUser;
  wsId: string;
}
export async function wsWorld(): Promise<WsWorld> {
  const owner = await makeDirectUser('Owner');
  const admin = await makeDirectUser('Admin');
  const member = await makeDirectUser('Member');
  const outsider = await makeDirectUser('Outsider');
  const ws = await prisma.workspace.create({
    data: {
      ownerId: owner.id,
      name: 'Nhom trong so',
      members: {
        create: [
          { userId: owner.id, role: 'OWNER' },
          { userId: admin.id, role: 'ADMIN' },
          { userId: member.id, role: 'MEMBER' },
        ],
      },
    },
    select: { id: true },
  });
  return { owner, admin, member, outsider, wsId: ws.id };
}
export const wUrl = (id: string) => `/api/workspaces/${id}/assignment-weights`;
export const getW = (u: TestUser | null, id: string) => {
  const r = agent().get(wUrl(id));
  return u ? r.set('Cookie', u.cookie) : r;
};
export const putW = (u: TestUser | null, id: string, body: unknown) => {
  const r = agent().put(wUrl(id));
  return (u ? r.set('Cookie', u.cookie) : r).send(body as object);
};
export const delW = (u: TestUser | null, id: string) => {
  const r = agent().delete(wUrl(id));
  return u ? r.set('Cookie', u.cookie) : r;
};
/** Bon trong so (buoc 16: API nhan du bon khoa). */
export const W = (experience: unknown, reliability: unknown, availability: unknown, declared: unknown) => ({ experience, reliability, availability, declared });

// ---------- Ghi nguoi duoc chon ----------

export const postOutcome = (u: TestUser | null, runId: string, body: unknown) => {
  const r = agent().post(`/api/assignment/runs/${runId}/outcome`);
  return (u ? r.set('Cookie', u.cookie) : r).send(body as object);
};
export const assign = (u: TestUser, cardId: string, userId: string) =>
  agent().post(`/api/cards/${cardId}/members`).set('Cookie', u.cookie).send({ userId });

export async function withRun() {
  const w = await world();
  const target = await newTarget(w.listId);
  await giveHistory(w.listId, w.alice.id); // alice se la nguoi xep dau
  const res = await suggest(w.owner, target.id);
  expect(res.status).toBe(200);
  expect(res.body.data.candidates[0].user.id).toBe(w.alice.id);
  return { w, target, runId: res.body.data.runId as string };
}
