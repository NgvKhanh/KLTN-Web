// Buoc 2 - do du lieu mo phong vao CSDL (simSeed.ts). Chay tren DB TEST.
//
// Ba loai bao dam:
//  (1) du lieu ghi xuong DUNG (tung the doi chieu voi bo sinh) va tuan thu cac bat bien cua buoc 1;
//  (2) AN TOAN khi chay tren DB dev: chay lai khong nhan doi, khong dung toi du lieu that,
//      hong giua chung thi ban cu con nguyen;
//  (3) du lieu di qua DUONG DI THAT cua san pham (dang nhap, phan quyen), khong chi nam trong bang.
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { DEFAULT_SIM, generateSimulation, type SimCard } from '../src/scripts/simGenerator';
import {
  SIM_DEFAULT_PASSWORD,
  SIM_WORKSPACE_NAME,
  removeSimulation,
  seedSimulation,
  simDayToDate,
  vnToday,
} from '../src/scripts/simSeed';
import { agent, makeBoard, makeCard, makeList, makeUser } from './helpers';

const TODAY = '2026-09-20';
const data = generateSimulation(DEFAULT_SIM);
const at = (day: number, hour = 0, minute = 0) =>
  simDayToDate(TODAY, data.config.days, day, hour, minute);
const simUsers = () => prisma.user.count({ where: { email: { endsWith: '@sim.local' } } });

describe('Buoc 2 - quy doi ngay so -> thoi diem that (gio Viet Nam)', () => {
  it('00:00 gio VN = 17:00Z hom truoc; 23:59 gio VN = 16:59Z; moi ngay cach nhau 24h; tham so sai bi tu choi', () => {
    expect(simDayToDate('2026-09-20', 300, 300).toISOString()).toBe('2026-09-19T17:00:00.000Z');
    expect(simDayToDate('2026-09-20', 300, 300, 23, 59).toISOString()).toBe('2026-09-20T16:59:00.000Z');
    expect(simDayToDate('2026-09-20', 300, 299).toISOString()).toBe('2026-09-18T17:00:00.000Z');
    expect(simDayToDate('2026-09-20', 300, 0).getTime()).toBe(
      simDayToDate('2026-09-20', 300, 300).getTime() - 300 * 86_400_000
    );
    // Qua ranh gioi thang/nam van dung (Date.UTC lo phan lich)
    // 28/02 00:00 gio VN = 27/02 17:00Z (2026 khong nhuan)
    expect(simDayToDate('2026-03-01', 60, 59).toISOString()).toBe('2026-02-27T17:00:00.000Z');
    expect(simDayToDate('2026-01-01', 1, 0).toISOString()).toBe('2025-12-30T17:00:00.000Z');
    for (const bad of ['2026-9-20', '20-09-2026', '', 'hom nay']) {
      expect(() => simDayToDate(bad, 300, 0), bad).toThrow();
    }
    // "Hom nay" theo gio VN: 23:30Z da la ngay hom sau o Viet Nam, 16:30Z thi chua
    expect(vnToday(new Date('2026-09-19T17:30:00Z'))).toBe('2026-09-20');
    expect(vnToday(new Date('2026-09-19T16:30:00Z'))).toBe('2026-09-19');
  });
});

describe('Buoc 2 - ghi vao CSDL dung va nhat quan', () => {
  it('moi the khop bo sinh; ngay dung han suy tu moc thoi gian DB trung voi bo sinh; nhat ky co memberId', async () => {
    const r = await seedSimulation(prisma, data, { today: TODAY });
    expect(r.removed).toEqual({ users: 0, workspaces: 0 });
    expect(r.counts).toMatchObject({ users: 6, boards: 5, cards: 120 });

    expect(await simUsers()).toBe(6);
    expect(await prisma.workspace.count({ where: { isPersonal: true, owner: { email: { endsWith: '@sim.local' } } } })).toBe(6);
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: r.workspaceId } });
    expect(ws.name).toBe(SIM_WORKSPACE_NAME);
    expect(await prisma.board.count({ where: { workspaceId: r.workspaceId } })).toBe(5);
    expect(await prisma.list.count({ where: { board: { workspaceId: r.workspaceId } } })).toBe(15);
    expect(await prisma.card.count()).toBe(120);
    expect(await prisma.cardMember.count()).toBe(120);
    expect(await prisma.memberWorkProfile.count({ where: { workspaceId: r.workspaceId } })).toBe(6);

    const rows = await prisma.card.findMany({
      include: { members: true },
    });
    const byId = new Map(rows.map((c) => [c.id, c]));
    let checkedOnTime = 0;
    for (const c of data.cards) {
      const row = byId.get(r.cardIds[c.key]!)!;
      expect(row.title).toBe(c.title);
      expect(row.description).toBe(c.description);
      expect(row.isDone).toBe(c.done);
      // Bat bien cua buoc 1: isDone <-> completedAt != null
      expect(row.completedAt !== null).toBe(c.done);
      expect(row.startDate).toEqual(at(c.assignedDay, 0));
      expect(row.dueDate).toEqual(at(c.dueDay, 23, 59));
      expect(row.createdAt).toEqual(at(c.createdDay, 9));
      if (c.done) {
        expect(row.completedAt).toEqual(at(c.completedDay!, 17));
        // DINH NGHIA cua module cham diem: dung han <=> completedAt <= dueDate. Doi chieu voi
        // co onTime cua bo sinh -> chung minh phep quy doi gio VN khong lam lech ngay nao.
        expect(row.completedAt!.getTime() <= row.dueDate!.getTime()).toBe(c.onTime);
        checkedOnTime += 1;
      }

      expect(row.members).toHaveLength(1);
      const m = row.members[0]!;
      expect(m.userId).toBe(r.userIds[c.assigneeKey]);
      expect(m.createdAt).toEqual(at(c.assignedDay, 10));
      expect(m.createdAt.getTime()).toBeGreaterThanOrEqual(row.createdAt.getTime());
      // Tu nhan (chu nhom nhan viec) -> null, con lai -> nguoi giao
      const self = (x: SimCard) => x.assignedByKey === x.assigneeKey;
      expect(m.assignedById).toBe(self(c) ? null : r.userIds[c.assignedByKey]);
    }
    expect(checkedOnTime).toBe(data.cards.filter((c) => c.done).length);
    expect(await prisma.card.count({ where: { isDone: true, completedAt: null } })).toBe(0);
    expect(await prisma.card.count({ where: { isDone: false, completedAt: { not: null } } })).toBe(0);

    // Nhat ky: co memberId (ban cu chi co ten -> khong dung duoc), dung so luong, dung thu tu
    const adds = await prisma.activity.findMany({ where: { type: 'member.add' } });
    expect(adds).toHaveLength(120);
    const idOf = new Map(data.cards.map((c) => [r.cardIds[c.key]!, r.userIds[c.assigneeKey]!]));
    for (const a of adds) {
      const d = a.data as { memberId?: string; memberName?: string };
      expect(d.memberId).toBe(idOf.get(a.cardId!));
      expect(typeof d.memberName).toBe('string');
    }
    const done = data.cards.filter((c) => c.done);
    const reopened = done.filter((c) => c.reopened);
    expect(await prisma.activity.count({ where: { type: 'card.create' } })).toBe(120);
    expect(await prisma.activity.count({ where: { type: 'card.undone' } })).toBe(reopened.length);
    expect(await prisma.activity.count({ where: { type: 'card.done' } })).toBe(done.length + reopened.length);
    for (const c of reopened.slice(0, 5)) {
      const log = await prisma.activity.findMany({
        where: { cardId: r.cardIds[c.key]!, type: { in: ['card.done', 'card.undone'] } },
        orderBy: { createdAt: 'asc' },
      });
      expect(log.map((l) => l.type)).toEqual(['card.done', 'card.undone', 'card.done']);
      // Lan xong CUOI CUNG trung dung completedAt (cot chi giu lan cuoi)
      expect(log[2]!.createdAt).toEqual(at(c.completedDay!, 17));
    }

    // Thanh vien khong gian: nguoi nghi bi go (xoa mem) dung ngay; nguoi vao muon vao dung ngay
    const leaver = data.people.find((p) => p.leftDay !== null)!;
    const late = data.people.find((p) => p.joinedDay > 0)!;
    const wm = await prisma.workspaceMember.findMany({ where: { workspaceId: r.workspaceId } });
    expect(wm).toHaveLength(6);
    expect(wm.find((m) => m.userId === r.userIds[leaver.key])!.deletedAt).toEqual(at(leaver.leftDay!, 9));
    expect(wm.filter((m) => m.deletedAt !== null)).toHaveLength(1);
    expect(wm.find((m) => m.userId === r.userIds[late.key])!.createdAt).toEqual(at(late.joinedDay, 9));
    const prof = await prisma.memberWorkProfile.findMany({ where: { workspaceId: r.workspaceId } });
    for (const p of data.people) {
      expect(prof.find((x) => x.userId === r.userIds[p.key])!.maxParallelCards).toBe(p.capacity);
    }
  });
});

describe('Buoc 2 - an toan khi chay tren DB dev', () => {
  it('chay lai khong nhan doi; khong cham du lieu that; don AssignRun mo coi; --remove chi xoa phan mo phong', async () => {
    // Du lieu THAT cua "nguoi dung": nguoi, bang, the, va mot AssignRun cua khong gian ca nhan
    const real = await makeUser();
    const realBoard = await makeBoard(real);
    const realList = await makeList(real, realBoard.id);
    const realCard = await makeCard(real, realList.id, 'The that cua toi');
    const realRun = await prisma.assignRun.create({
      data: { workspaceId: real.personalWorkspaceId, weights: {}, candidates: [] },
    });

    const first = await seedSimulation(prisma, data, { today: TODAY });
    const simRun = await prisma.assignRun.create({
      data: { workspaceId: first.workspaceId, weights: {}, candidates: [] },
    });
    expect(await simUsers()).toBe(6);

    // Chay lai voi hat giong khac: don ban cu roi tao ban moi
    const data2 = generateSimulation({ ...DEFAULT_SIM, seed: 7 });
    const second = await seedSimulation(prisma, data2, { today: TODAY });
    expect(second.removed).toEqual({ users: 6, workspaces: 7 }); // 6 ca nhan + 1 nhom
    expect(await simUsers()).toBe(6);
    expect(await prisma.workspace.count({ where: { name: SIM_WORKSPACE_NAME } })).toBe(1);
    expect(await prisma.card.count({ where: { list: { board: { workspaceId: second.workspaceId } } } })).toBe(data2.cards.length);
    // Ban cu bien mat han, khong nhan doi
    expect(await prisma.card.count({ where: { id: { in: Object.values(first.cardIds) } } })).toBe(0);
    expect(await prisma.workspace.count({ where: { id: first.workspaceId } })).toBe(0);
    // AssignRun cua du lieu gia bi don; cua du lieu THAT con nguyen
    expect(await prisma.assignRun.findUnique({ where: { id: simRun.id } })).toBeNull();
    expect(await prisma.assignRun.findUnique({ where: { id: realRun.id } })).not.toBeNull();

    // Du lieu that khong bi cham vao
    expect(await prisma.user.findUnique({ where: { id: real.id } })).not.toBeNull();
    expect(await prisma.board.findUnique({ where: { id: realBoard.id } })).not.toBeNull();
    expect(await prisma.card.findUnique({ where: { id: realCard.id } })).not.toBeNull();

    // Chi xoa
    expect(await removeSimulation(prisma)).toEqual({ users: 6, workspaces: 7 });
    expect(await simUsers()).toBe(0);
    expect(await prisma.card.count({ where: { id: realCard.id } })).toBe(1);
    expect(await prisma.card.count()).toBe(1);
    expect(await prisma.assignRun.findUnique({ where: { id: realRun.id } })).not.toBeNull();
    // Xoa lan hai: khong co gi de xoa, khong loi
    expect(await removeSimulation(prisma)).toEqual({ users: 0, workspaces: 0 });
  });

  it('hong giua chung thi ban cu con nguyen (mot transaction)', async () => {
    const first = await seedSimulation(prisma, data, { today: TODAY });
    const before = {
      users: await simUsers(),
      cards: await prisma.card.count(),
      members: await prisma.cardMember.count(),
      activities: await prisma.activity.count(),
    };
    expect(before.cards).toBe(120);

    // The thu 6 tro toi nguoi khong ton tai: seed chay duoc 5 the roi moi vap loi
    const broken = {
      ...data,
      cards: data.cards.map((c, i) => (i === 5 ? { ...c, assigneeKey: 'khong-ton-tai' } : c)),
    };
    await expect(seedSimulation(prisma, broken, { today: TODAY })).rejects.toThrow();

    // Ban cu (da bi xoa TRONG transaction hong) phai con nguyen ven, dung id cu
    expect({
      users: await simUsers(),
      cards: await prisma.card.count(),
      members: await prisma.cardMember.count(),
      activities: await prisma.activity.count(),
    }).toEqual(before);
    expect(await prisma.card.count({ where: { id: { in: Object.values(first.cardIds) } } })).toBe(120);
    expect(await prisma.workspace.count({ where: { id: first.workspaceId } })).toBe(1);

    // Va van chay lai duoc binh thuong sau loi
    const again = await seedSimulation(prisma, data, { today: TODAY });
    expect(again.removed.users).toBe(6);
    expect(await prisma.card.count()).toBe(120);

    // Bo du lieu rong nguoi: bao loi ro rang thay vi chay nua chung
    await expect(seedSimulation(prisma, { ...data, people: [] }, { today: TODAY })).rejects.toThrow();
  });
});

describe('Buoc 2 - du lieu di qua duong di THAT cua san pham', () => {
  it('chu nhom dang nhap thay du 5 bang + 120 the; nguoi nghi bi chan; nguoi vao muon vao duoc du an dang chay', async () => {
    const r = await seedSimulation(prisma, data, { today: TODAY });
    const owner = data.people[0]!;
    const leaver = data.people.find((p) => p.leftDay !== null)!;
    const late = data.people.find((p) => p.joinedDay > 0)!;
    const current = data.boards[data.boards.length - 1]!;

    const login = async (email: string) => {
      const res = await agent().post('/api/auth/login').send({ email, password: SIM_DEFAULT_PASSWORD });
      expect(res.status, email).toBe(200);
      const raw = res.headers['set-cookie'];
      const arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
      return arr.find((c) => c.startsWith('token='))!.split(';')[0]!;
    };

    // Chu nhom: thay 5 bang cua khong gian nhom (+ bang khac neu co - o day khong co)
    const ownerCookie = await login(owner.email);
    const boards = await agent().get('/api/boards').set('Cookie', ownerCookie);
    expect(boards.status).toBe(200);
    const mine = (boards.body.data.boards as { id: string; workspaceId: string }[]).filter(
      (b) => b.workspaceId === r.workspaceId
    );
    expect(mine.map((b) => b.id).sort()).toEqual(Object.values(r.boardIds).sort());

    // Doc danh sach + the cua tung bang bang API that: tong dung 120 the, dung 3 cot moi bang
    let total = 0;
    for (const b of data.boards) {
      const res = await agent().get(`/api/boards/${r.boardIds[b.key]}/lists`).set('Cookie', ownerCookie);
      expect(res.status).toBe(200);
      const lists = res.body.data.lists as { name: string; cards: { members: { userId: string }[] }[] }[];
      expect(lists.map((l) => l.name)).toEqual(['Cần làm', 'Đang làm', 'Hoàn thành']);
      const want = data.cards.filter((c) => c.boardKey === b.key);
      expect(lists.flatMap((l) => l.cards)).toHaveLength(want.length);
      // Moi the co dung 1 nguoi phu trach - dung nguoi ma bo sinh da giao
      for (const [li, list] of lists.entries()) {
        const inList = want.filter((c) => c.listIndex === li);
        expect(list.cards).toHaveLength(inList.length);
      }
      total += want.length;
    }
    expect(total).toBe(120);

    // Nguoi da nghi: khong con vao duoc bang cu lan bang dang chay
    const leaverCookie = await login(leaver.email);
    for (const b of data.boards) {
      const res = await agent().get(`/api/boards/${r.boardIds[b.key]}`).set('Cookie', leaverCookie);
      expect([403, 404], `${leaver.key} vao ${b.key}`).toContain(res.status);
    }

    // Nguoi vao muon: vao duoc du an dang chay, khong vao duoc du an da xong truoc khi ho tham gia
    const lateCookie = await login(late.email);
    const now = await agent().get(`/api/boards/${r.boardIds[current.key]}`).set('Cookie', lateCookie);
    expect(now.status).toBe(200);
    const first = data.boards[0]!;
    expect(late.joinedDay).toBeGreaterThan(first.endDay + 3);
    const old = await agent().get(`/api/boards/${r.boardIds[first.key]}`).set('Cookie', lateCookie);
    expect([403, 404]).toContain(old.status);
  });
});
