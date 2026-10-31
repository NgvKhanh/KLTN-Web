// Buoc 5 - API goi y phan cong (assign.routes / assign.service / assign.repo). Test tich hop qua HTTP tren DB THAT
// va TRA THANG vao cac bang AssignRun / WorkspaceAssignWeights / AssignWeightHistory (khong chi tin JSON tra ve).
//
// LUU Y HA TANG: test/setup.ts TRUNCATE ca DB truoc MOI `it`; registerLimiter chi cho 10 dang ky / gio moi file,
// nen user duoc tao THANG vao CSDL bang makeDirectUser (khong qua /api/auth/register). Test 429 dat CUOI file
// (limiter giu trang thai trong process).
import { describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma';
import { assertBoardView, isBoardParticipant } from '../src/modules/board/board.service';
import {
  decideAndLearn,
  findRun,
  readBoardRef,
  readCandidates,
  readViewableBoardIds,
} from '../src/modules/assign/assign.repo';
import {
  ALGORITHM_VERSION,
  getWorkspaceWeights,
  resetWorkspaceWeights,
  setWorkspaceWeights,
  suggestForCard,
} from '../src/modules/assign/assign.service';
import { agent, makeDirectUser, type TestUser } from './helpers';
import {
  SIMILAR,
  TITLE_TARGET,
  W,
  assign,
  candOf,
  daysAgo,
  daysAhead,
  delW,
  extraBoard,
  getW,
  giveHistory,
  idsOf,
  mkCard,
  newTarget,
  postOutcome,
  putW,
  sorted,
  suggest,
  withRun,
  world,
  wsWorld,
  type Cand,
  type CardSpec,
} from './assignFixtures';

// ===================== Quyen va tap ung vien =====================

describe('GET /api/cards/:cardId/assignment-suggestions - quyen', () => {
  it('401 khi chua dang nhap; 404 the khong ton tai / da xoa / bang da luu tru; 403 nguoi ngoai va VIEWER; 200 chu bang va thanh vien', async () => {
    const w = await world();
    const target = await newTarget(w.listId);

    expect((await suggest(null, target.id)).status).toBe(401);
    expect((await suggest(w.owner, 'khong-co-the-nay')).status).toBe(404);

    expect((await suggest(w.outsider, target.id)).status).toBe(403);
    expect((await suggest(w.viewer, target.id)).status).toBe(403);
    expect((await suggest(w.owner, target.id)).status).toBe(200);
    expect((await suggest(w.alice, target.id)).status).toBe(200);
    expect((await suggest(w.bob, target.id)).status).toBe(200);

    // Bi tu choi thi KHONG ghi nhat ky
    const runsBefore = await prisma.assignRun.count();
    await suggest(w.outsider, target.id);
    await suggest(w.viewer, target.id);
    expect(await prisma.assignRun.count()).toBe(runsBefore);

    // The da xoa mem -> 404 (du la chu bang)
    const gone = await newTarget(w.listId, { deletedAt: new Date() });
    expect((await suggest(w.owner, gone.id)).status).toBe(404);
    // Bang da luu tru -> 404
    await prisma.board.update({ where: { id: w.boardId }, data: { archivedAt: new Date() } });
    expect((await suggest(w.owner, target.id)).status).toBe(404);
  });

  it('nguoi bi go khoi bang mat quyen ngay (deletedAt); thanh vien khong gian KHONG tu co quyen tren bang PRIVATE', async () => {
    const w = await world('PRIVATE');
    const target = await newTarget(w.listId);
    const wsMember = await makeDirectUser('WsMember');
    await prisma.workspaceMember.create({ data: { workspaceId: w.wsId, userId: wsMember.id, role: 'MEMBER' } });
    expect((await suggest(wsMember, target.id)).status).toBe(403);

    expect((await suggest(w.bob, target.id)).status).toBe(200);
    await prisma.boardMember.updateMany({ where: { boardId: w.boardId, userId: w.bob.id }, data: { deletedAt: new Date() } });
    expect((await suggest(w.bob, target.id)).status).toBe(403);
  });
});

describe('GET assignment-suggestions - tap ung vien', () => {
  it('chu bang + thanh vien khong phai VIEWER; loai VIEWER, nguoi da bi go, tai khoan da xoa; co ten/avatar, KHONG co email', async () => {
    const w = await world();
    const gone = await makeDirectUser('Gone');
    const deleted = await makeDirectUser('Deleted');
    await prisma.boardMember.create({ data: { boardId: w.boardId, userId: gone.id, role: 'MEMBER', deletedAt: new Date() } });
    await prisma.boardMember.create({ data: { boardId: w.boardId, userId: deleted.id, role: 'MEMBER' } });
    await prisma.user.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    await prisma.user.update({ where: { id: w.alice.id }, data: { avatarUrl: '/uploads/avatars/a.png' } });
    const target = await newTarget(w.listId);

    const res = await suggest(w.owner, target.id);
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual(sorted([w.owner.id, w.alice.id, w.bob.id]));
    expect(res.body.data.candidateCount).toBe(3);
    expect(candOf(res.body, w.alice).user).toEqual({ id: w.alice.id, name: 'Alice', avatarUrl: '/uploads/avatars/a.png' });
    expect(candOf(res.body, w.bob).user.avatarUrl).toBeNull();

    // Khong lo email, mat khau, phien ban token o bat ky cho nao
    const text = JSON.stringify(res.body);
    for (const u of [w.owner, w.alice, w.bob, w.viewer, w.outsider]) expect(text).not.toContain(u.email);
    expect(text).not.toMatch(/email|passwordHash|tokenVersion/i);
  });

  it('bang WORKSPACE: them chu + thanh vien khong gian; bang PRIVATE: khong. Thanh vien khong gian chi goi duoc khi bang WORKSPACE', async () => {
    const w = await world('WORKSPACE');
    const wsMember = await makeDirectUser('WsMember');
    const wsRemoved = await makeDirectUser('WsRemoved');
    await prisma.workspaceMember.create({ data: { workspaceId: w.wsId, userId: wsMember.id, role: 'MEMBER' } });
    await prisma.workspaceMember.create({ data: { workspaceId: w.wsId, userId: wsRemoved.id, role: 'MEMBER', deletedAt: new Date() } });
    const target = await newTarget(w.listId);

    const open = await suggest(wsMember, target.id);
    expect(open.status).toBe(200);
    expect(idsOf(open.body)).toEqual(sorted([w.owner.id, w.alice.id, w.bob.id, wsMember.id]));

    await prisma.board.update({ where: { id: w.boardId }, data: { visibility: 'PRIVATE' } });
    expect((await suggest(wsMember, target.id)).status).toBe(403);
    const closed = await suggest(w.owner, target.id);
    expect(idsOf(closed.body)).toEqual(sorted([w.owner.id, w.alice.id, w.bob.id]));
  });

  it('KHOP isBoardParticipant: voi ma tran 10 nguoi x 2 muc hien thi, tap ung vien == tap nguoi gan duoc vao the (tru tai khoan da xoa)', async () => {
    const w = await world('PRIVATE');
    const admin = await makeDirectUser('BoardAdmin');
    const wsMember = await makeDirectUser('WsMember');
    const wsAdmin = await makeDirectUser('WsAdmin');
    const wsRemoved = await makeDirectUser('WsRemoved');
    const boardRemoved = await makeDirectUser('BoardRemoved');
    const deleted = await makeDirectUser('Deleted');
    // Chu khong gian KHONG co dong WorkspaceMember (isBoardParticipant van tinh la thanh vien qua ownerId)
    const wsOwnerNoRow = await makeDirectUser('WsOwnerNoRow');
    await prisma.workspace.update({ where: { id: w.wsId }, data: { ownerId: wsOwnerNoRow.id } });
    await prisma.boardMember.createMany({
      data: [
        { boardId: w.boardId, userId: admin.id, role: 'ADMIN' },
        { boardId: w.boardId, userId: boardRemoved.id, role: 'MEMBER', deletedAt: new Date() },
        { boardId: w.boardId, userId: deleted.id, role: 'MEMBER' },
      ],
    });
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId: w.wsId, userId: wsMember.id, role: 'MEMBER' },
        { workspaceId: w.wsId, userId: wsAdmin.id, role: 'ADMIN' },
        { workspaceId: w.wsId, userId: wsRemoved.id, role: 'MEMBER', deletedAt: new Date() },
      ],
    });
    await prisma.user.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    const everyone = [w.owner, w.alice, w.bob, w.viewer, w.outsider, admin, wsMember, wsAdmin, wsRemoved, boardRemoved, deleted, wsOwnerNoRow];

    for (const visibility of ['PRIVATE', 'WORKSPACE'] as const) {
      await prisma.board.update({ where: { id: w.boardId }, data: { visibility } });
      const ref = (await readBoardRef(w.boardId))!;
      const got = (await readCandidates(ref)).map((u) => u.id);
      const want: string[] = [];
      for (const u of everyone) {
        if (u.id === deleted.id) continue; // tai khoan da xoa khong bao gio la ung vien
        if (await isBoardParticipant(w.boardId, u.id)) want.push(u.id);
      }
      expect(sorted(got), visibility).toEqual(sorted(want));
      // Va de kiem tra khong rong / khong bao hoa: PRIVATE < WORKSPACE (them wsMember, wsAdmin, chu khong gian khong co dong thanh vien)
      expect(want.length).toBe(visibility === 'PRIVATE' ? 4 : 7);
    }
  });
});

// ===================== Cham diem qua API =====================

describe('GET assignment-suggestions - cham diem tren du lieu that', () => {
  it('nguoi co 3 the giong len dau kem bang chung dung the cua ho; nguoi chua co lich su gan NO_HISTORY; trong so mac dinh; muy', async () => {
    const w = await world();
    const target = await newTarget(w.listId);
    const aliceCards = await giveHistory(w.listId, w.alice.id);
    const bobCards = await giveHistory(w.listId, w.bob.id, ['Viet API thanh toan']);

    const res = await suggest(w.owner, target.id);
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.algorithmVersion).toBe(ALGORITHM_VERSION);
    expect(d.card).toEqual({ id: target.id, title: TITLE_TARGET, boardId: w.boardId, workspaceId: w.wsId });
    expect(d.weights).toEqual({ experience: 0.36, reliability: 0.24, availability: 0.2, declared: 0.2, custom: false });
    expect(d.groupOnTimeRate).toBe(1);
    expect(d.candidateCount).toBe(3);

    expect(d.candidates[0].user.id).toBe(w.alice.id);
    expect(d.candidates.map((c: Cand) => c.rank)).toEqual([1, 2, 3]);
    const alice = candOf(res.body, w.alice);
    expect(alice.evidence.length).toBeGreaterThan(0);
    for (const e of alice.evidence) {
      expect(aliceCards).toContain(e.cardId);
      expect(SIMILAR).toContain(e.title);
      expect(e.outcome).toBe('ON_TIME');
      expect(e.sim).toBeGreaterThan(0);
    }
    expect(candOf(res.body, w.owner).flags).toContain('NO_HISTORY');
    expect(candOf(res.body, w.owner).evidence).toEqual([]);
    expect(candOf(res.body, w.bob).flags).toContain('NO_SIMILAR');
    expect(candOf(res.body, w.bob).evidence).toEqual([]);
    expect(bobCards.length).toBe(1);
    // Ba thanh phan co du: gia tri tho + thang chuan hoa + ti trong
    expect(alice.components.experience.value).toBeGreaterThan(0);
    expect(alice.components.availability.value).toBe(1);
    expect(alice.score).not.toBeNull();
    expect(alice.rawScore).not.toBeNull();
    // Buoc 16: co thanh phan Ho so + bang chung ho so (chua ai khai -> null / rong); buoc 18: co NO_PROFILE ra API
    for (const c of res.body.data.candidates as (Cand & Record<string, unknown>)[]) {
      expect(Object.keys(c.components).sort()).toEqual(['availability', 'declared', 'experience', 'reliability']);
      expect((c.components as unknown as Record<string, { value: unknown }>).declared.value).toBeNull();
      expect(c.flags).toContain('NO_PROFILE');
      expect(c.declaredEvidence).toEqual([]);
    }
  });

  it('tai va suc chua: qua suc chua mac dinh 5 -> OVERLOADED; ho so suc chua 8 duoc doc; tam nghi -> PAUSED, kha dung 0', async () => {
    const w = await world();
    const target = await newTarget(w.listId, { startDate: daysAgo(1), dueDate: daysAhead(5) });
    // Alice va Bob moi nguoi 6 the dang mo chong lan; Owner khong the nao
    for (const u of [w.alice, w.bob]) {
      for (let i = 0; i < 6; i += 1) {
        await mkCard(w.listId, { title: `Viec dang lam ${u.name} ${i}`, startDate: daysAgo(2), dueDate: daysAhead(3), members: [u.id] });
      }
    }
    await prisma.memberWorkProfile.create({ data: { userId: w.bob.id, workspaceId: w.wsId, maxParallelCards: 8 } });
    await prisma.memberWorkProfile.create({ data: { userId: w.owner.id, workspaceId: w.wsId, pausedUntil: daysAhead(30) } });

    const res = await suggest(w.alice, target.id);
    expect(res.status).toBe(200);
    const alice = candOf(res.body, w.alice);
    expect([alice.load, alice.capacity]).toEqual([6, 5]);
    expect(alice.flags).toContain('OVERLOADED');
    expect(alice.components.availability.value).toBe(0);

    const bob = candOf(res.body, w.bob);
    expect([bob.load, bob.capacity]).toEqual([6, 8]);
    expect(bob.flags).not.toContain('OVERLOADED');
    expect(bob.components.availability.value).toBeCloseTo(0.25, 12);

    const owner = candOf(res.body, w.owner);
    expect(owner.flags).toContain('PAUSED');
    expect(owner.components.availability.value).toBe(0);
    expect(owner.load).toBe(0);
  });

  it('nguoi da o trong the van duoc cham va gan assigned=true; nguoi khac assigned=false; the dang cham khong chong len tai cua chinh minh', async () => {
    const w = await world();
    const target = await newTarget(w.listId, { members: [w.alice.id] });
    const res = await suggest(w.owner, target.id);
    expect(candOf(res.body, w.alice).assigned).toBe(true);
    expect(candOf(res.body, w.alice).load).toBe(0); // the dang cham khong tu tinh vao tai
    expect(candOf(res.body, w.bob).assigned).toBe(false);
    expect(candOf(res.body, w.owner).assigned).toBe(false);
    expect(res.body.data.candidateCount).toBe(3);
  });

  it('KHONG doc cheo khong gian: lich su va the dang mo o khong gian khac khong duoc dung', async () => {
    const w = await world();
    const ws2 = await prisma.workspace.create({
      data: { ownerId: w.owner.id, name: 'Nhom khac', members: { create: { userId: w.owner.id, role: 'OWNER' } } },
      select: { id: true },
    });
    const other = await extraBoard(w, { name: 'Bang khac', members: [w.alice.id], workspaceId: ws2.id });
    // Ho so lam viec cua khong gian khac (suc chua 9) cung khong duoc ap sang khong gian nay
    await prisma.memberWorkProfile.create({ data: { userId: w.alice.id, workspaceId: ws2.id, maxParallelCards: 9 } });
    await giveHistory(other.listId, w.alice.id);
    for (let i = 0; i < 6; i += 1) {
      await mkCard(other.listId, { title: `Viec khac ${i}`, startDate: daysAgo(2), dueDate: daysAhead(3), members: [w.alice.id] });
    }
    const target = await newTarget(w.listId);

    const res = await suggest(w.owner, target.id);
    const alice = candOf(res.body, w.alice);
    expect(alice.flags).toContain('NO_HISTORY');
    expect(alice.evidence).toEqual([]);
    expect(alice.load).toBe(0);
    expect(alice.capacity).toBe(5);
    expect(res.body.data.groupOnTimeRate).toBeNull(); // muy cung chi tinh trong khong gian nay
  });

  it('the / bang DA XOA bi loai; bang DA LUU TRU van la lich su (du an cu) nhung khong chiem tai', async () => {
    const w = await world();
    const target = await newTarget(w.listId);
    const okCards = await giveHistory(w.listId, w.alice.id, [SIMILAR[0]!]);
    const goneCard = await mkCard(w.listId, { title: SIMILAR[1]!, done: true, dueDate: daysAgo(20), completedAt: daysAgo(25), members: [w.alice.id], deletedAt: new Date() });
    const archivedBoard = await extraBoard(w, { name: 'Du an cu', members: [w.alice.id], archived: true });
    const oldCard = await mkCard(archivedBoard.listId, { title: SIMILAR[2]!, done: true, dueDate: daysAgo(40), completedAt: daysAgo(45), members: [w.alice.id] });
    const openInArchived = await mkCard(archivedBoard.listId, { title: 'Dang mo trong bang luu tru', startDate: daysAgo(2), dueDate: daysAhead(3), members: [w.alice.id] });
    const deletedBoard = await extraBoard(w, { name: 'Bang da xoa', members: [w.alice.id], deleted: true });
    const inDeleted = await mkCard(deletedBoard.listId, { title: SIMILAR[1]!, done: true, dueDate: daysAgo(30), completedAt: daysAgo(35), members: [w.alice.id] });
    const archivedCard = await mkCard(w.listId, { title: 'The luu tru dang mo', startDate: daysAgo(2), dueDate: daysAhead(3), members: [w.alice.id], archivedAt: new Date() });
    // Danh sach da xoa: the ben trong khong tinh. Danh sach da luu tru: the da xong van la lich su, the dang mo khong chiem tai
    const deletedList = await prisma.list.create({ data: { boardId: w.boardId, name: 'Da xoa', deletedAt: new Date() }, select: { id: true } });
    const inDeletedList = await mkCard(deletedList.id, { title: SIMILAR[1]!, done: true, dueDate: daysAgo(20), completedAt: daysAgo(22), members: [w.alice.id] });
    const archivedList = await prisma.list.create({ data: { boardId: w.boardId, name: 'Luu tru', archivedAt: new Date() }, select: { id: true } });
    const doneInArchivedList = await mkCard(archivedList.id, { title: 'Thiet ke giao dien tim kiem', done: true, dueDate: daysAgo(50), completedAt: daysAgo(52), members: [w.alice.id] });
    await mkCard(archivedList.id, { title: 'Dang mo trong danh sach luu tru', startDate: daysAgo(2), dueDate: daysAhead(3), members: [w.alice.id] });

    const res = await suggest(w.owner, target.id);
    const alice = candOf(res.body, w.alice);
    const evidenceIds = alice.evidence.map((e) => e.cardId);
    expect(evidenceIds).toContain(okCards[0]);
    expect(evidenceIds).toContain(oldCard.id); // bang luu tru van la lich su
    expect(evidenceIds).toContain(doneInArchivedList.id); // danh sach luu tru cung vay
    for (const bad of [goneCard.id, inDeleted.id, inDeletedList.id]) expect(evidenceIds).not.toContain(bad);
    // The dang mo trong bang luu tru / the da luu tru khong chiem tai (neu bi dem thi load = 2)
    expect([openInArchived.id, archivedCard.id]).toHaveLength(2);
    expect(alice.load).toBe(0);
    // Chu bang xem duoc ca hai bang -> tieu de the cu hien ra
    expect(alice.evidence.find((e) => e.cardId === oldCard.id)!.title).toBe(SIMILAR[2]);
  });

  it('the / danh sach / bang DA XOA la VO HINH: them chung khong doi bat ky con so nao (kho ngu lieu IDF, muy, lich su, tai)', async () => {
    const w = await world();
    const target = await newTarget(w.listId, { createdAt: daysAgo(80) });
    await giveHistory(w.listId, w.alice.id);
    await giveHistory(w.listId, w.bob.id, [SIMILAR[0]!]);
    const now = new Date();
    const before = await suggestForCard(w.owner.id, target.id, now);
    expect(before.groupOnTimeRate).toBe(1); // moi the that deu dung han

    // Ba the "Thiet ke giao dien" da xong TRE han, khong ai nhan, moi bo mot loai da xoa: neu bi dem se doi
    // IDF (docCount, df) va lam muy tut xuong duoi 1. Them mot the dang mo cua alice ben trong: khong duoc chiem tai.
    const noise = async (listId: string, extra: Partial<CardSpec> = {}) => {
      for (const i of [0, 1, 2]) {
        await mkCard(listId, { title: 'Thiet ke giao dien', done: true, completedAt: daysAgo(5), dueDate: daysAgo(20 + i), ...extra });
      }
      await mkCard(listId, { title: 'Dang mo trong cho da xoa', startDate: daysAgo(2), dueDate: daysAhead(3), members: [w.alice.id], ...extra, done: false });
    };
    await noise(w.listId, { deletedAt: new Date() }); // the da xoa
    const deletedList = await prisma.list.create({ data: { boardId: w.boardId, name: 'Da xoa', deletedAt: new Date() }, select: { id: true } });
    await noise(deletedList.id); // danh sach da xoa
    const deletedBoard = await extraBoard(w, { name: 'Bang da xoa', members: [w.alice.id], deleted: true });
    await noise(deletedBoard.listId); // bang da xoa

    const after = await suggestForCard(w.owner.id, target.id, now);
    expect(after.groupOnTimeRate).toBe(1);
    expect({ ...after, runId: null }).toEqual({ ...before, runId: null });
    // ... con neu chinh cac the do KHONG bi xoa thi ket qua phai khac (chung to phep so sanh khong rong)
    await prisma.card.updateMany({ where: { title: 'Thiet ke giao dien' }, data: { deletedAt: null } });
    await prisma.list.update({ where: { id: deletedList.id }, data: { deletedAt: null } });
    await prisma.board.update({ where: { id: deletedBoard.id }, data: { deletedAt: null } });
    const alive = await suggestForCard(w.owner.id, target.id, now);
    expect(alive.groupOnTimeRate).toBeLessThan(1);
  });

  it('chong ro ri tuong lai + tat dinh: chay tai mot thoi diem QUA KHU thi the xong SAU do bi bo; cung `now` cho ket qua giong het', async () => {
    const w = await world();
    const target = await newTarget(w.listId, { createdAt: daysAgo(80) });
    const before = await giveHistory(w.listId, w.alice.id, [SIMILAR[0]!]); // xong ~30 ngay truoc
    const later = await mkCard(w.listId, { title: SIMILAR[1]!, done: true, completedAt: daysAgo(5), dueDate: daysAgo(4), members: [w.alice.id], assignedAt: daysAgo(6) });
    const pastNow = daysAgo(20);

    const past = await suggestForCard(w.owner.id, target.id, pastNow);
    expect(past.generatedAt).toEqual(pastNow);
    const alice = past.candidates.find((c) => c.user.id === w.alice.id)!;
    // Luc do moi co the dau (xong 30 ngay truoc); the xong 5 ngay truoc chua ton tai
    expect(alice.evidence.map((e) => e.cardId)).toEqual([before[0]]);
    expect(alice.evidence.map((e) => e.cardId)).not.toContain(later.id);

    const now = await suggestForCard(w.owner.id, target.id, new Date());
    expect(now.candidates.find((c) => c.user.id === w.alice.id)!.evidence.map((e) => e.cardId).sort()).toEqual([before[0]!, later.id].sort());

    // Tat dinh: cung `now` -> cung ket qua (tru runId)
    const a = await suggestForCard(w.owner.id, target.id, pastNow);
    const b = await suggestForCard(w.owner.id, target.id, pastNow);
    expect({ ...a, runId: null }).toEqual({ ...b, runId: null });
    expect(a.runId).not.toBe(b.runId);
  });

  it('the moi khong co ung vien nao (tai khoan da xoa het) -> khong ghi nhat ky, runId = null', async () => {
    const w = await world();
    const target = await newTarget(w.listId);
    await prisma.user.updateMany({ data: { deletedAt: new Date() } });
    const r = await suggestForCard(w.owner.id, target.id);
    expect(r.runId).toBeNull();
    expect(r.candidates).toEqual([]);
    expect(r.candidateCount).toBe(0);
    expect(await prisma.assignRun.count()).toBe(0);
  });
});

// ===================== Rieng tu =====================

describe('GET assignment-suggestions - rieng tu', () => {
  it('che tieu de bang chung thuoc bang nguoi hoi khong xem duoc; DIEM van tinh ca; nguoi xem duoc thi thay du', async () => {
    const w = await world();
    const secret = await extraBoard(w, { name: 'Bang rieng tu', members: [w.alice.id] }); // bob khong thuoc bang nay
    const target = await newTarget(w.listId);
    const visibleCard = await mkCard(w.listId, { title: SIMILAR[0]!, done: true, completedAt: daysAgo(30), dueDate: daysAgo(25), members: [w.alice.id] });
    const secretCard = await mkCard(secret.listId, { title: 'Thiet ke giao dien bi mat', done: true, completedAt: daysAgo(31), dueDate: daysAgo(26), members: [w.alice.id] });
    const now = new Date();

    const asBob = await suggestForCard(w.bob.id, target.id, now);
    const asOwner = await suggestForCard(w.owner.id, target.id, now);

    const evOf = (r: typeof asBob) => r.candidates.find((c) => c.user.id === w.alice.id)!.evidence;
    const bobSees = evOf(asBob);
    expect(bobSees.map((e) => e.cardId).sort()).toEqual([secretCard.id, visibleCard.id].sort());
    expect(bobSees.find((e) => e.cardId === visibleCard.id)!.title).toBe(SIMILAR[0]);
    expect(bobSees.find((e) => e.cardId === secretCard.id)!.title).toBeNull();
    expect(JSON.stringify(asBob)).not.toContain('bi mat');

    const ownerSees = evOf(asOwner);
    expect(ownerSees.find((e) => e.cardId === secretCard.id)!.title).toBe('Thiet ke giao dien bi mat');

    // Che chi doi CHU: diem, hang, bang chung (tru tieu de) giong het giua hai nguoi hoi
    const strip = (r: typeof asBob) =>
      r.candidates.map((c) => ({ ...c, evidence: c.evidence.map((e) => ({ ...e, title: null })) }));
    expect(strip(asBob)).toEqual(strip(asOwner));
  });

  it('nhat ky AssignRun KHONG chep tieu de the (chi id): khong nhan ban noi dung bang rieng tu', async () => {
    const w = await world();
    const target = await newTarget(w.listId);
    await giveHistory(w.listId, w.alice.id);
    const res = await suggest(w.owner, target.id);
    const run = await prisma.assignRun.findUniqueOrThrow({ where: { id: res.body.data.runId } });
    const text = JSON.stringify(run);
    for (const t of [...SIMILAR, TITLE_TARGET]) expect(text).not.toContain(t);
    expect(text).not.toMatch(/title|email/i);
  });

  it('decideAndLearn ghi MOT lan o tang CSDL: lan thu hai tra null, KHONG de len va KHONG cong them luot phan hoi (bao ve dua chay, khong dua vao thoi diem cua HTTP)', async () => {
    const { w, runId } = await withRun();
    const run = (await findRun(runId))!;
    const learnable = { ...run, workspaceId: run.workspaceId! };
    const first = new Date('2026-09-20T05:00:00Z');
    const a = await decideAndLearn(learnable, w.alice.id, first);
    expect(a).not.toBeNull();
    expect(a!.feedbackCount).toBe(1);
    expect(await decideAndLearn(learnable, w.bob.id, new Date())).toBeNull();
    const after = await prisma.assignRun.findUniqueOrThrow({ where: { id: runId } });
    expect([after.chosenUserId, after.accepted, after.decidedAt]).toEqual([w.alice.id, true, first]);
    const row = await prisma.workspaceAssignWeights.findUniqueOrThrow({ where: { workspaceId: w.wsId } });
    expect(row.feedbackCount).toBe(1);
    // Luot khong ton tai: khong ghi gi, khong nem loi
    expect(await decideAndLearn({ ...learnable, id: 'khong-co' }, w.alice.id, first)).toBeNull();
    expect((await prisma.workspaceAssignWeights.findUniqueOrThrow({ where: { workspaceId: w.wsId } })).feedbackCount).toBe(1);
  });

  it('readViewableBoardIds KHOP assertBoardView voi ma tran (5 nguoi x 4 bang); bang luu tru: thanh vien van xem duoc, nguoi ngoai khong', async () => {
    const w = await world('PRIVATE'); // bang 1: PRIVATE, alice/bob/viewer la thanh vien
    const wsMember = await makeDirectUser('WsMember');
    const removed = await makeDirectUser('Removed');
    await prisma.workspaceMember.create({ data: { workspaceId: w.wsId, userId: wsMember.id, role: 'MEMBER' } });
    await prisma.boardMember.create({ data: { boardId: w.boardId, userId: removed.id, role: 'MEMBER', deletedAt: new Date() } });
    const wsBoard = await extraBoard(w, { name: 'Bang KG', visibility: 'WORKSPACE' });
    const pubBoard = await extraBoard(w, { name: 'Bang cong khai', visibility: 'PUBLIC' });
    const priv2 = await extraBoard(w, { name: 'Bang rieng 2', members: [w.bob.id] });
    const archived = await extraBoard(w, { name: 'Bang luu tru', members: [w.alice.id], archived: true });
    const deleted = await extraBoard(w, { name: 'Bang da xoa', members: [w.alice.id], deleted: true });
    // Chu bang KHONG co dong BoardMember: chi xem duoc nho ownerId (assertBoardView cung cho phep)
    const bare = await prisma.board.create({ data: { ownerId: w.owner.id, workspaceId: w.wsId, name: 'Bang khong thanh vien' }, select: { id: true } });
    const boards = [w.boardId, wsBoard.id, pubBoard.id, priv2.id, bare.id];
    const users = [w.owner, w.alice, w.bob, w.viewer, w.outsider, wsMember, removed];

    for (const u of users) {
      const got = await readViewableBoardIds(u.id, w.wsId);
      for (const b of boards) {
        const can = await assertBoardView(u.id, b).then(() => true, () => false);
        expect(got.has(b), `${u.name} / ${b}`).toBe(can);
      }
      expect(got.has(deleted.id), `${u.name} / xoa`).toBe(false);
    }
    // Bang luu tru: thanh vien (alice) va chu bang (owner) van xem duoc; bob/nguoi ngoai thi khong
    expect((await readViewableBoardIds(w.alice.id, w.wsId)).has(archived.id)).toBe(true);
    expect((await readViewableBoardIds(w.owner.id, w.wsId)).has(archived.id)).toBe(true);
    expect((await readViewableBoardIds(w.bob.id, w.wsId)).has(archived.id)).toBe(false);
    expect((await readViewableBoardIds(w.outsider.id, w.wsId)).has(archived.id)).toBe(false);
    // Bang o khong gian KHAC khong bao gio nam trong tap
    expect((await readViewableBoardIds(w.owner.id, 'khong-gian-khac')).size).toBe(0);
  });
});

// ===================== Nhat ky =====================

describe('GET assignment-suggestions - ghi AssignRun', () => {
  it('moi luot goi ghi DUNG mot dong: khong gian / bang / the / nguoi bam / phien ban / trong so / so ung vien / nguoi dung dau / do tre', async () => {
    const w = await world();
    const target = await newTarget(w.listId);
    await giveHistory(w.listId, w.alice.id);

    expect(await prisma.assignRun.count()).toBe(0);
    const res = await suggest(w.bob, target.id);
    expect(await prisma.assignRun.count()).toBe(1);
    const run = await prisma.assignRun.findUniqueOrThrow({ where: { id: res.body.data.runId } });
    expect(run).toMatchObject({
      workspaceId: w.wsId,
      boardId: w.boardId,
      cardId: target.id,
      actorKey: w.bob.id,
      algorithmVersion: ALGORITHM_VERSION,
      candidateCount: 3,
      topUserId: w.alice.id,
      chosenUserId: null,
      accepted: false,
      decidedAt: null,
      learned: false,
    });
    expect(run.weights).toEqual({ experience: 0.36, reliability: 0.24, availability: 0.2, declared: 0.2 });
    expect(run.latencyMs).not.toBeNull();
    expect(run.latencyMs!).toBeGreaterThanOrEqual(0);
    expect(run.latencyMs!).toBeLessThan(15_000);

    const logged = run.candidates as unknown as { userId: string; rank: number; components: Record<string, unknown>; evidence: { cardId: string }[]; flags: string[] }[];
    expect(logged.map((c) => c.userId)).toEqual(res.body.data.candidates.map((c: Cand) => c.user.id));
    expect(logged.map((c) => c.rank)).toEqual([1, 2, 3]);
    expect(Object.keys(logged[0]!.components).sort()).toEqual(['availability', 'declared', 'experience', 'reliability']);
    // Nhat ky ghi DU co (ke ca NO_PROFILE) va bang chung ho so (rong vi chua ai khai)
    expect(logged.every((c) => c.flags.includes('NO_PROFILE'))).toBe(true);
    expect(logged.every((c) => Array.isArray((c as unknown as { declaredEvidence: unknown }).declaredEvidence))).toBe(true);
    expect(logged[0]!.evidence.length).toBeGreaterThan(0);
    expect(Object.keys(logged[0]!.evidence[0]!).sort()).toEqual(['cardId', 'outcome', 'sim', 'weight']);

    // Goi lan nua -> mot dong nua, runId khac
    const again = await suggest(w.bob, target.id);
    expect(await prisma.assignRun.count()).toBe(2);
    expect(again.body.data.runId).not.toBe(res.body.data.runId);
  });

  it('GET khong tao dong trong so hay lich su trong so (chi ghi AssignRun)', async () => {
    const w = await world();
    const target = await newTarget(w.listId);
    await suggest(w.owner, target.id);
    expect(await prisma.workspaceAssignWeights.count()).toBe(0);
    expect(await prisma.assignWeightHistory.count()).toBe(0);
  });

  it('xoa the -> nhat ky con song (cardId = null), khong mat dong', async () => {
    const w = await world();
    const target = await newTarget(w.listId);
    const res = await suggest(w.owner, target.id);
    await prisma.card.delete({ where: { id: target.id } });
    const run = await prisma.assignRun.findUniqueOrThrow({ where: { id: res.body.data.runId } });
    expect(run.cardId).toBeNull();
    expect(run.workspaceId).toBe(w.wsId);
  });
});

// ===================== Trong so =====================

describe('GET/PUT/DELETE /api/workspaces/:id/assignment-weights', () => {
  it('GET: mac dinh 0,36/0,24/0,20/0,20 khi chua chinh (khong tao dong); moi thanh vien xem duoc; nguoi ngoai 403; khong ton tai 404; chua dang nhap 401', async () => {
    const w = await wsWorld();
    for (const u of [w.owner, w.admin, w.member]) {
      const res = await getW(u, w.wsId);
      expect(res.status, u.name).toBe(200);
      expect(res.body.data).toEqual({
        workspaceId: w.wsId,
        weights: { experience: 0.36, reliability: 0.24, availability: 0.2, declared: 0.2 },
        defaults: { experience: 0.36, reliability: 0.24, availability: 0.2, declared: 0.2 },
        custom: false,
        feedbackCount: 0,
        updatedAt: null,
        learning: { minFeedback: 10, eta: 0.05, active: false },
        feedback: { decided: 0, accepted: 0 },
        history: [],
      });
    }
    expect((await getW(w.outsider, w.wsId)).status).toBe(403);
    expect((await getW(w.owner, 'khong-co')).status).toBe(404);
    expect((await getW(null, w.wsId)).status).toBe(401);
    expect(await prisma.workspaceAssignWeights.count()).toBe(0);
  });

  it('PUT: OWNER va ADMIN duoc, MEMBER va nguoi ngoai 403; luu dung + ghi 1 dong lich su (runId null); GET thay gia tri moi', async () => {
    const w = await wsWorld();
    expect((await putW(w.member, w.wsId, W(0.4, 0.3, 0.2, 0.1))).status).toBe(403);
    expect((await putW(w.outsider, w.wsId, W(0.4, 0.3, 0.2, 0.1))).status).toBe(403);
    expect((await putW(null, w.wsId, W(0.4, 0.3, 0.2, 0.1))).status).toBe(401);
    expect(await prisma.workspaceAssignWeights.count()).toBe(0);

    const res = await putW(w.admin, w.wsId, W(0.4, 0.3, 0.2, 0.1));
    expect(res.status).toBe(200);
    expect(res.body.data.weights).toEqual({ experience: 0.4, reliability: 0.3, availability: 0.2, declared: 0.1 });
    expect(res.body.data.custom).toBe(true);
    expect(res.body.data.updatedAt).not.toBeNull();

    const row = await prisma.workspaceAssignWeights.findUniqueOrThrow({ where: { workspaceId: w.wsId } });
    expect([row.wExperience, row.wReliability, row.wAvailability, row.wDeclared, row.feedbackCount]).toEqual([0.4, 0.3, 0.2, 0.1, 0]);
    const hist = await prisma.assignWeightHistory.findMany({ where: { workspaceId: w.wsId } });
    expect(hist).toHaveLength(1);
    expect(hist[0]).toMatchObject({ wExperience: 0.4, wReliability: 0.3, wAvailability: 0.2, wDeclared: 0.1, feedbackCount: 0, runId: null });

    const seen = await getW(w.member, w.wsId);
    expect(seen.body.data.weights).toEqual({ experience: 0.4, reliability: 0.3, availability: 0.2, declared: 0.1 });
    expect(seen.body.data.custom).toBe(true);

    // OWNER cung duoc
    expect((await putW(w.owner, w.wsId, W(0.35, 0.35, 0.2, 0.1))).status).toBe(200);
    expect(await prisma.assignWeightHistory.count()).toBe(2);
  });

  it('PUT sai -> 400 kem loi tung truong, KHONG ghi gi (am / qua tran / qua san / tong khac 1 / thieu truong / chuoi / mang)', async () => {
    const w = await wsWorld();
    const bad: [string, unknown, string][] = [
      ['am', W(-0.1, 0.6, 0.4, 0.1), 'experience'],
      ['qua tran 0,71', W(0.71, 0.1, 0.09, 0.1), 'experience'],
      ['qua san 0,04', W(0.5, 0.36, 0.04, 0.1), 'availability'],
      ['Ho so qua san 0,04', W(0.4, 0.3, 0.26, 0.04), 'declared'],
      ['Ho so qua tran 0,71', W(0.1, 0.1, 0.09, 0.71), 'declared'],
      ['tong 0,9', W(0.3, 0.3, 0.2, 0.1), 'sum'],
      ['tong 1,2', W(0.4, 0.4, 0.3, 0.1), 'sum'],
      ['thieu truong', { experience: 0.5, reliability: 0.3, declared: 0.2 }, 'availability'],
      ['thieu Ho so (giao dien cu ba thanh truot)', { experience: 0.45, reliability: 0.3, availability: 0.25 }, 'declared'],
      ['chuoi', W('0.4', 0.3, 0.2, 0.1), 'experience'],
      ['null', W(null, 0.3, 0.2, 0.1), 'experience'],
    ];
    for (const [label, body, field] of bad) {
      const res = await putW(w.owner, w.wsId, body);
      expect(res.status, label).toBe(400);
      expect(res.body.errors.map((e: { field: string }) => e.field), label).toContain(field);
    }
    for (const body of [[], null]) {
      expect((await putW(w.owner, w.wsId, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(await prisma.workspaceAssignWeights.count()).toBe(0);
    expect(await prisma.assignWeightHistory.count()).toBe(0);
  });

  it('PUT giong het gia tri hien tai (ke ca mac dinh khi chua co dong) KHONG ghi lich su; doi that thi ghi them', async () => {
    const w = await wsWorld();
    expect((await putW(w.owner, w.wsId, W(0.36, 0.24, 0.2, 0.2))).status).toBe(200);
    expect(await prisma.workspaceAssignWeights.count()).toBe(0);
    expect(await prisma.assignWeightHistory.count()).toBe(0);

    await putW(w.owner, w.wsId, W(0.4, 0.3, 0.2, 0.1));
    await putW(w.owner, w.wsId, W(0.4, 0.3, 0.2, 0.1));
    expect(await prisma.assignWeightHistory.count()).toBe(1);
    await putW(w.owner, w.wsId, W(0.5, 0.2, 0.2, 0.1));
    expect(await prisma.assignWeightHistory.count()).toBe(2);
  });

  it('PUT giu nguyen feedbackCount; DELETE dat lai mac dinh + dua feedbackCount ve 0 + ghi 1 dong lich su; goi lai khong ghi them', async () => {
    const w = await wsWorld();
    await putW(w.owner, w.wsId, W(0.5, 0.2, 0.2, 0.1));
    await prisma.workspaceAssignWeights.update({ where: { workspaceId: w.wsId }, data: { feedbackCount: 7 } });
    const put = await putW(w.owner, w.wsId, W(0.4, 0.3, 0.2, 0.1));
    expect(put.body.data.feedbackCount).toBe(7);
    expect((await prisma.assignWeightHistory.findMany({ orderBy: { createdAt: 'asc' } })).map((h) => h.feedbackCount)).toEqual([0, 7]);

    expect((await delW(w.member, w.wsId)).status).toBe(403);
    expect((await delW(w.outsider, w.wsId)).status).toBe(403);
    const res = await delW(w.admin, w.wsId);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ weights: { experience: 0.36, reliability: 0.24, availability: 0.2, declared: 0.2 }, custom: false, feedbackCount: 0 });

    const row = await prisma.workspaceAssignWeights.findUniqueOrThrow({ where: { workspaceId: w.wsId } });
    expect([row.wExperience, row.wReliability, row.wAvailability, row.wDeclared, row.feedbackCount]).toEqual([0.36, 0.24, 0.2, 0.2, 0]);
    const hist = await prisma.assignWeightHistory.findMany({ orderBy: { createdAt: 'asc' } });
    expect(hist).toHaveLength(3);
    expect(hist[2]).toMatchObject({ wExperience: 0.36, wReliability: 0.24, wAvailability: 0.2, wDeclared: 0.2, feedbackCount: 0, runId: null });

    await delW(w.owner, w.wsId);
    expect(await prisma.assignWeightHistory.count()).toBe(3);

    // Trong so da la mac dinh nhung so luot phan hoi con > 0 (vd hoc xong roi quay ve mac dinh): dat lai van dua ve 0
    await prisma.workspaceAssignWeights.update({ where: { workspaceId: w.wsId }, data: { feedbackCount: 4 } });
    const again = await delW(w.owner, w.wsId);
    expect(again.body.data.feedbackCount).toBe(0);
    expect(await prisma.assignWeightHistory.count()).toBe(4);
  });

  it('service TU kiem tra lai (rao ve cuoi, khong chi dua vao zod): gia tri sai nem 400, khong ghi; nguoi khong du quyen nem 403', async () => {
    const w = await wsWorld();
    const bad = [
      { experience: 0.85, reliability: 0.05, availability: 0.05, declared: 0.05 },
      { experience: Number.NaN, reliability: 0.4, availability: 0.4, declared: 0.2 },
      { experience: 0.3, reliability: 0.3, availability: 0.3, declared: 0.3 },
      { experience: 0.45, reliability: 0.3, availability: 0.25 } as never,
    ];
    for (const b of bad) {
      await expect(setWorkspaceWeights(w.owner.id, w.wsId, b)).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(setWorkspaceWeights(w.member.id, w.wsId, { experience: 0.4, reliability: 0.3, availability: 0.2, declared: 0.1 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(resetWorkspaceWeights(w.member.id, w.wsId)).rejects.toMatchObject({ statusCode: 403 });
    await expect(getWorkspaceWeights(w.outsider.id, w.wsId)).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.workspaceAssignWeights.count()).toBe(0);
    // Gia tri hop le di qua, va ket qua tra ve chi gom bon khoa thiet ke (khong roi khoa la)
    const ok = await setWorkspaceWeights(w.owner.id, w.wsId, { experience: 0.4, reliability: 0.3, availability: 0.2, declared: 0.1, extra: 9 } as never);
    expect(ok.weights).toEqual({ experience: 0.4, reliability: 0.3, availability: 0.2, declared: 0.1 });
  });

  it('DELETE khi chua co dong: 200 mac dinh, khong tao dong nao', async () => {
    const w = await wsWorld();
    const res = await delW(w.owner, w.wsId);
    expect(res.status).toBe(200);
    expect(res.body.data.custom).toBe(false);
    expect(await prisma.workspaceAssignWeights.count()).toBe(0);
    expect(await prisma.assignWeightHistory.count()).toBe(0);
  });

  it('nhom chinh trong so thi goi y THAY DOI theo: kinh nghiem nang -> nguoi giau kinh nghiem nhung qua tai len dau; kha dung nang -> nguoi ranh len dau', async () => {
    // Bang chi co hai ung vien: alice (chu bang, 4 the giong, dang qua tai) va bob (1 the giong, ranh).
    // Chu khong gian (wsOwner) khong nam trong bang nhung chinh duoc trong so.
    const wsOwner = await makeDirectUser('WsOwner');
    const alice = await makeDirectUser('Alice');
    const bob = await makeDirectUser('Bob');
    const ws = await prisma.workspace.create({
      data: { ownerId: wsOwner.id, name: 'Nhom', members: { create: { userId: wsOwner.id, role: 'OWNER' } } },
      select: { id: true },
    });
    const board = await prisma.board.create({
      data: {
        ownerId: alice.id,
        workspaceId: ws.id,
        name: 'B',
        lists: { create: { name: 'To do' } },
        members: { create: [{ userId: alice.id, role: 'OWNER' }, { userId: bob.id, role: 'MEMBER' }] },
      },
      include: { lists: { select: { id: true } } },
    });
    const listId = board.lists[0]!.id;
    const target = await newTarget(listId, { startDate: daysAgo(1), dueDate: daysAhead(5) });
    await giveHistory(listId, alice.id, [...SIMILAR, 'Thiet ke giao dien tim kiem']);
    await giveHistory(listId, bob.id, [SIMILAR[0]!]);
    for (let i = 0; i < 6; i += 1) {
      await mkCard(listId, { title: `Viec ban ${i}`, startDate: daysAgo(2), dueDate: daysAhead(3), members: [alice.id] });
    }

    const top = async () => (await suggest(alice, target.id)).body.data as { candidates: Cand[]; weights: { experience: number; custom: boolean } };
    const base = await top();
    expect(base.candidates.map((c) => c.user.id).sort()).toEqual(sorted([alice.id, bob.id]));
    expect(base.weights.custom).toBe(false);
    expect(base.candidates[0]!.user.id).toBe(alice.id); // mac dinh: kinh nghiem 0,36 > kha dung 0,20
    expect(base.candidates[0]!.flags).toContain('OVERLOADED');

    expect((await putW(wsOwner, ws.id, W(0.05, 0.2, 0.7, 0.05))).status).toBe(200);
    const availHeavy = await top();
    expect(availHeavy.weights.custom).toBe(true);
    expect(availHeavy.weights.experience).toBe(0.05);
    expect(availHeavy.candidates[0]!.user.id).toBe(bob.id);

    expect((await putW(wsOwner, ws.id, W(0.7, 0.2, 0.05, 0.05))).status).toBe(200);
    expect((await top()).candidates[0]!.user.id).toBe(alice.id);

    // Nhat ky ghi dung bo trong so LUC DO
    const runs = await prisma.assignRun.findMany({ orderBy: { createdAt: 'asc' } });
    expect(runs.map((r) => (r.weights as { experience: number }).experience)).toEqual([0.36, 0.05, 0.7]);
  });

  it('trong so luu hong trong CSDL khong lam hong goi y: lui ve mac dinh (custom = false) va canh bao', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const w = await world();
      const target = await newTarget(w.listId);
      await prisma.workspaceAssignWeights.create({ data: { workspaceId: w.wsId, wExperience: -1, wReliability: 0, wAvailability: 0 } });
      const res = await suggest(w.owner, target.id);
      expect(res.status).toBe(200);
      expect(res.body.data.weights).toEqual({ experience: 0.36, reliability: 0.24, availability: 0.2, declared: 0.2, custom: false });
      expect(warn).toHaveBeenCalledTimes(1);
      const run = await prisma.assignRun.findUniqueOrThrow({ where: { id: res.body.data.runId } });
      expect(run.weights).toEqual({ experience: 0.36, reliability: 0.24, availability: 0.2, declared: 0.2 }); // nhat ky ghi cai DA DUNG
    } finally {
      warn.mockRestore();
    }
  });
});

// ===================== Ghi nguoi duoc chon =====================

describe('POST /api/assignment/runs/:runId/outcome', () => {
  it('giao dung nguoi xep dau: accepted = true, ghi dung vao AssignRun; cong 1 luot phan hoi nhung KHONG hoc (learned = false, trong so khong doi)', async () => {
    const { w, target, runId } = await withRun();
    expect((await assign(w.owner, target.id, w.alice.id)).status).toBeLessThan(300);

    const res = await postOutcome(w.owner, runId, { chosenUserId: w.alice.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      runId,
      chosenUserId: w.alice.id,
      topUserId: w.alice.id,
      accepted: true,
      learned: false,
      learning: { learned: false, reason: 'ACCEPTED' },
      feedbackCount: 1,
      weights: { experience: 0.36, reliability: 0.24, availability: 0.2, declared: 0.2 },
    });
    expect(new Date(res.body.data.decidedAt).getTime()).toBeGreaterThan(Date.now() - 10_000);

    const run = await prisma.assignRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({ chosenUserId: w.alice.id, accepted: true, learned: false });
    expect(run.decidedAt).not.toBeNull();
    // Luot dau tien tao dong trong so (mac dinh, nang cap khi doc va ghi du bon cot) voi feedbackCount = 1; khong co dong lich su nao
    const row = await prisma.workspaceAssignWeights.findUniqueOrThrow({ where: { workspaceId: w.wsId } });
    expect([row.wExperience, row.wReliability, row.wAvailability, row.wDeclared, row.feedbackCount]).toEqual([0.36, 0.24, 0.2, 0.2, 1]);
    expect(await prisma.assignWeightHistory.count()).toBe(0);
  });

  it('giao nguoi KHAC nguoi xep dau: accepted = false, topUserId van la nguoi xep dau', async () => {
    const { w, target, runId } = await withRun();
    await assign(w.owner, target.id, w.bob.id);
    const res = await postOutcome(w.owner, runId, { chosenUserId: w.bob.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ chosenUserId: w.bob.id, topUserId: w.alice.id, accepted: false });
    expect(await prisma.assignRun.count({ where: { accepted: true } })).toBe(0);
  });

  it('luot cua NGUOI KHAC va luot khong ton tai deu la 404; chua dang nhap 401; khong ghi gi', async () => {
    const { w, target, runId } = await withRun();
    await assign(w.owner, target.id, w.alice.id);
    expect((await postOutcome(w.bob, runId, { chosenUserId: w.alice.id })).status).toBe(404); // bob la thanh vien, nhung khong phai nguoi bam
    expect((await postOutcome(w.owner, 'khong-co', { chosenUserId: w.alice.id })).status).toBe(404);
    expect((await postOutcome(null, runId, { chosenUserId: w.alice.id })).status).toBe(401);
    expect((await prisma.assignRun.findUniqueOrThrow({ where: { id: runId } })).decidedAt).toBeNull();
  });

  it('nguoi duoc chon CHUA o trong the -> 400 va khong ghi (khong tin loi khai cua client)', async () => {
    const { w, runId } = await withRun();
    const res = await postOutcome(w.owner, runId, { chosenUserId: w.bob.id });
    expect(res.status).toBe(400);
    expect((await prisma.assignRun.findUniqueOrThrow({ where: { id: runId } })).chosenUserId).toBeNull();
    // Nguoi khong ton tai cung 400
    expect((await postOutcome(w.owner, runId, { chosenUserId: 'ai-do' })).status).toBe(400);
  });

  it('ghi MOT lan: gui lai dung nguoi cu la 200 (ket qua da luu), gui nguoi khac la 409 va du lieu khong doi', async () => {
    const { w, target, runId } = await withRun();
    await assign(w.owner, target.id, w.alice.id);
    await assign(w.owner, target.id, w.bob.id);
    const first = await postOutcome(w.owner, runId, { chosenUserId: w.alice.id });
    const same = await postOutcome(w.owner, runId, { chosenUserId: w.alice.id });
    expect(same.status).toBe(200);
    // Gui lai chi tra phan da luu (khong co learning / feedbackCount / weights) va KHONG cong them luot phan hoi
    const core = (d: Record<string, unknown>) => ({
      runId: d.runId,
      chosenUserId: d.chosenUserId,
      topUserId: d.topUserId,
      accepted: d.accepted,
      decidedAt: d.decidedAt,
      learned: d.learned,
    });
    expect(core(same.body.data)).toEqual(core(first.body.data));
    expect(first.body.data.learning).toBeDefined();
    expect(same.body.data.learning).toBeUndefined();
    expect((await prisma.workspaceAssignWeights.findUniqueOrThrow({ where: { workspaceId: w.wsId } })).feedbackCount).toBe(1);

    const other = await postOutcome(w.owner, runId, { chosenUserId: w.bob.id });
    expect(other.status).toBe(409);
    const run = await prisma.assignRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.chosenUserId).toBe(w.alice.id);
    expect(run.accepted).toBe(true);
    expect((await prisma.workspaceAssignWeights.findUniqueOrThrow({ where: { workspaceId: w.wsId } })).feedbackCount).toBe(1);
  });

  it('hai request CUNG LUC chon hai nguoi khac nhau: dung MOT request thang (200), request kia 409; CSDL khop nguoi thang', async () => {
    const { w, target, runId } = await withRun();
    await assign(w.owner, target.id, w.alice.id);
    await assign(w.owner, target.id, w.bob.id);
    const [a, b] = await Promise.all([
      postOutcome(w.owner, runId, { chosenUserId: w.alice.id }),
      postOutcome(w.owner, runId, { chosenUserId: w.bob.id }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const winner = a.status === 200 ? w.alice : w.bob;
    const run = await prisma.assignRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run.chosenUserId).toBe(winner.id);
    expect(run.accepted).toBe(winner.id === w.alice.id);
  });

  it('nguoi bam bi ha xuong VIEWER sau khi goi y -> 403 va khong ghi; the bi xoa han (cardId = null) -> 409', async () => {
    const a = await withRun();
    await assign(a.w.owner, a.target.id, a.w.alice.id);
    const bobRun = (await suggest(a.w.bob, a.target.id)).body.data.runId as string;
    await prisma.boardMember.updateMany({ where: { boardId: a.w.boardId, userId: a.w.bob.id }, data: { role: 'VIEWER' } });
    expect((await postOutcome(a.w.bob, bobRun, { chosenUserId: a.w.alice.id })).status).toBe(403);
    expect((await prisma.assignRun.findUniqueOrThrow({ where: { id: bobRun } })).decidedAt).toBeNull();

    const b = await withRun();
    await prisma.card.delete({ where: { id: b.target.id } });
    const res = await postOutcome(b.w.owner, b.runId, { chosenUserId: b.w.alice.id });
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('da bi xoa');
  });

  it('nguoi duoc chon nam NGOAI danh sach ung vien (vd VIEWER gan tay truoc do) van ghi duoc, accepted = false', async () => {
    const { w, target, runId } = await withRun();
    await prisma.cardMember.create({ data: { cardId: target.id, userId: w.viewer.id } });
    const res = await postOutcome(w.owner, runId, { chosenUserId: w.viewer.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ chosenUserId: w.viewer.id, accepted: false });
  });

  it('body sai -> 400 do zod (co loi theo truong), khong roi xuong service: thieu, rong, khong phai chuoi, qua dai', async () => {
    const { w, runId } = await withRun();
    const bad: unknown[] = [{}, { chosenUserId: '' }, { chosenUserId: '   ' }, { chosenUserId: 42 }, { chosenUserId: null }, { chosenUserId: 'x'.repeat(101) }];
    for (const body of bad) {
      const res = await postOutcome(w.owner, runId, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      // Do zod tu choi (co danh sach loi theo truong) - khong phai service tu choi vi "chua o trong the"
      expect(res.body.errors?.map((e: { field: string }) => e.field), JSON.stringify(body)).toContain('chosenUserId');
    }
    const arr = await postOutcome(w.owner, runId, []);
    expect(arr.status).toBe(400);
    expect(arr.body.errors).toBeDefined();
    // Do dai 100 la con hop le ve mat dinh dang (toi service, noi no bi tu choi vi khong co trong the)
    const edge = await postOutcome(w.owner, runId, { chosenUserId: 'x'.repeat(100) });
    expect(edge.status).toBe(400);
    expect(edge.body.errors).toBeUndefined();
    expect((await prisma.assignRun.findUniqueOrThrow({ where: { id: runId } })).decidedAt).toBeNull();
  });
});

// ===================== Gioi han toc do (dat CUOI: limiter giu trang thai trong process) =====================

describe('gioi han toc do', () => {
  it('60 luot / nguoi / 10 phut; luot thu 61 -> 429; nguoi khac khong bi anh huong', async () => {
    const w = await world();
    const target = await newTarget(w.listId);
    let last = 0;
    for (let i = 0; i < 60; i += 1) {
      last = (await suggest(w.owner, target.id)).status;
      if (last !== 200) break;
    }
    expect(last).toBe(200);
    expect((await suggest(w.owner, target.id)).status).toBe(429);
    expect((await suggest(w.alice, target.id)).status).toBe(200);
    expect(await prisma.assignRun.count({ where: { actorKey: w.owner.id } })).toBe(60);
  }, 60_000);
});
