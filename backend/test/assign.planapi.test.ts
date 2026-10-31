// Buoc 8a - API chia viec cho ca danh sach (POST /api/lists/:listId/assignment-plan). Test tich hop qua HTTP tren DB THAT.
// Diem mau chot: ban xem truoc PHAI trung voi viec lan luot bam goi y so 1 cua LOP 1 cho tung the roi giao that (doi chieu
// tung nguoi, tung diem, tung xep hang) - va KHONG ghi bat cu thu gi.
//
// LUU Y HA TANG: test/setup.ts TRUNCATE ca DB truoc MOI `it`; user duoc tao THANG vao CSDL (makeDirectUser) vi registerLimiter
// chi cho 10 dang ky / gio moi file. Test 429 dat CUOI file (limiter giu trang thai trong process). Lien ket the-nguoi trong
// test doi chieu duoc ghi THANG bang Prisma voi createdAt lui 1 phut: dong ho CSDL co the lech may chu vai giay, ma anh chup
// chi tinh lien ket da co luc `now`.
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { PLAN_MAX_CARDS, PLAN_VERSION } from '../src/modules/assign/assign.plan';
import { ALGORITHM_VERSION, planForList } from '../src/modules/assign/assign.service';
import { agent, makeDirectUser, type TestUser } from './helpers';
import {
  W,
  daysAgo,
  daysAhead,
  giveHistory,
  idsOf,
  mkCard,
  newTarget,
  putW,
  sorted,
  suggest,
  world,
  type Cand,
  type World,
} from './assignFixtures';

interface PlanRow {
  order: number;
  card: { id: string; title: string; startDate: string | null; dueDate: string | null };
  assignee: null | {
    user: { id: string; name: string };
    score: number | null;
    rawScore: number | null;
    confidence: number;
    confidenceLevel: string;
    components: Record<'experience' | 'reliability' | 'availability', { value: number | null; weight: number; scaled: number | null; share: number }>;
    load: number;
    capacity: number;
    flags: string[];
  };
  ranking: { userId: string; rank: number; score: number | null; load: number; capacity: number; flags: string[] }[];
}
interface PlanBody {
  data: {
    list: { id: string; name: string; boardId: string; workspaceId: string };
    algorithmVersion: string;
    planVersion: string;
    generatedAt: string;
    weights: { experience: number; reliability: number; availability: number; declared: number; custom: boolean };
    groupOnTimeRate: number | null;
    people: { user: { id: string; name: string; avatarUrl: string | null }; capacity: number; openCards: number; paused: boolean }[];
    totalUnassigned: number;
    truncated: boolean;
    rows: PlanRow[];
  };
}

const plan = (u: TestUser | null, listId: string) => {
  const r = agent().post(`/api/lists/${listId}/assignment-plan`);
  return u ? r.set('Cookie', u.cookie) : r;
};
const body = (res: { body: unknown }) => res.body as PlanBody;

/** Moi thu ban xem truoc KHONG duoc ghi. */
const writes = async () => ({
  runs: await prisma.assignRun.count(),
  members: await prisma.cardMember.count(),
  activities: await prisma.activity.count(),
  weights: await prisma.workspaceAssignWeights.count(),
  weightHistory: await prisma.assignWeightHistory.count(),
  cards: await prisma.card.count(),
});

const REPORTS = ['Viet bao cao tuan mot', 'Viet bao cao tuan hai', 'Viet bao cao tuan ba'];
const TARGETS = [
  'Thiet ke giao dien quen mat khau',
  'Thiet ke giao dien ho so',
  'Viet bao cao tuan bon',
  'Thiet ke giao dien cai dat',
  'Viet bao cao tuan nam',
  'Thiet ke giao dien thong bao',
  'Viet bao cao tuan sau',
];
/** Tieu de vo can, CHI phan mo ta moi nhac toi giao dien: neu ban xem truoc quen doc mo ta thi se xep hang khac lop 1. */
const DESCRIBED = { title: 'Cong viec moi', description: 'Thiet ke giao dien dang nhap' };

// ===================== Quyen =====================

describe('POST /api/lists/:listId/assignment-plan - quyen', () => {
  it('401 chua dang nhap; 404 danh sach khong ton tai / da xoa / da luu tru / bang da luu tru; 403 nguoi ngoai va VIEWER; 200 chu bang va thanh vien', async () => {
    const w = await world();
    await newTarget(w.listId);
    expect((await plan(null, w.listId)).status).toBe(401);
    expect((await plan(w.owner, 'khong-co-danh-sach')).status).toBe(404);
    expect((await plan(w.outsider, w.listId)).status).toBe(403);
    expect((await plan(w.viewer, w.listId)).status).toBe(403);
    for (const u of [w.owner, w.alice, w.bob]) expect((await plan(u, w.listId)).status).toBe(200);

    const gone = await prisma.list.create({ data: { boardId: w.boardId, name: 'Da xoa', deletedAt: new Date() } });
    const archived = await prisma.list.create({ data: { boardId: w.boardId, name: 'Luu tru', archivedAt: new Date() } });
    expect((await plan(w.owner, gone.id)).status).toBe(404);
    expect((await plan(w.owner, archived.id)).status).toBe(404);
    await prisma.board.update({ where: { id: w.boardId }, data: { archivedAt: new Date() } });
    expect((await plan(w.owner, w.listId)).status).toBe(404);
  });

  it('thanh vien khong gian cua bang o muc WORKSPACE (khong la thanh vien bang) cung goi duoc, giong lop 1', async () => {
    const w = await world('WORKSPACE');
    const wsMember = await makeDirectUser('WsMember');
    await prisma.workspaceMember.create({ data: { workspaceId: w.wsId, userId: wsMember.id, role: 'MEMBER' } });
    const target = await newTarget(w.listId);
    expect((await suggest(wsMember, target.id)).status).toBe(200);
    expect((await plan(wsMember, w.listId)).status).toBe(200);
    expect((await plan(w.outsider, w.listId)).status).toBe(403);
  });
});

// ===================== The nao duoc chia =====================

describe('POST .../assignment-plan - chon the va thu tu', () => {
  it('chi chia the CHUA CO NGUOI NHAN, chua xong, chua luu tru / xoa, dung danh sach; han gap truoc, khong han o cuoi', async () => {
    const w = await world();
    const other = await prisma.list.create({ data: { boardId: w.boardId, name: 'Khac' } });
    const startsAt = daysAgo(3);
    const late = await mkCard(w.listId, { title: 'Ban sau', dueDate: daysAhead(9), startDate: startsAt });
    const none = await mkCard(w.listId, { title: 'Khong han' });
    const soon = await mkCard(w.listId, { title: 'Gap', dueDate: daysAhead(2) });
    await mkCard(w.listId, { title: 'Da giao', dueDate: daysAhead(1), members: [w.alice.id] });
    await mkCard(w.listId, { title: 'Da xong', done: true, dueDate: daysAhead(1) });
    await mkCard(w.listId, { title: 'Luu tru', dueDate: daysAhead(1), archivedAt: new Date() });
    await mkCard(w.listId, { title: 'Da xoa', dueDate: daysAhead(1), deletedAt: new Date() });
    await mkCard(other.id, { title: 'Danh sach khac', dueDate: daysAhead(1) });

    const res = await plan(w.owner, w.listId);
    expect(res.status).toBe(200);
    const d = body(res).data;
    expect(d.rows.map((r) => r.card.id)).toEqual([soon.id, late.id, none.id]);
    expect(d.rows.map((r) => r.order)).toEqual([1, 2, 3]);
    expect(d.rows.map((r) => r.card.title)).toEqual(['Gap', 'Ban sau', 'Khong han']);
    expect(d.totalUnassigned).toBe(3);
    expect(d.truncated).toBe(false);
    expect(d.list).toEqual({ id: w.listId, name: 'To do', boardId: w.boardId, workspaceId: w.wsId });
    expect(d.rows[2]!.card.dueDate).toBeNull();
    expect(d.rows[2]!.card.startDate).toBeNull();
    expect(d.rows[1]!.card.startDate).toBe(startsAt.toISOString());
    expect(d.rows[1]!.card.dueDate).not.toBeNull();
  });

  it('toi da 30 the moi luot: lay 30 the GAP NHAT; totalUnassigned cho biet tong, truncated = true; dung 30 the thi khong bao cat', async () => {
    const w = await world();
    // Han 1..32 ngay, tao theo thu tu xao tron (11 nguyen to cung nhau voi 32 -> hoan vi cua 1..32)
    const made = new Map<number, string>();
    for (let i = 0; i < 32; i += 1) {
      const day = ((i * 11) % 32) + 1;
      made.set(day, (await mkCard(w.listId, { title: `The han ${day}`, dueDate: daysAhead(day) })).id);
    }
    const res = await plan(w.owner, w.listId);
    expect(res.status).toBe(200);
    const d = body(res).data;
    expect(PLAN_MAX_CARDS).toBe(30);
    expect(d.rows).toHaveLength(30);
    expect(d.rows.map((r) => r.card.id)).toEqual(Array.from({ length: 30 }, (_, i) => made.get(i + 1)!));
    expect(d.totalUnassigned).toBe(32);
    expect(d.truncated).toBe(true);
    // Xoa hai the muon nhat -> dung 30 the: khong bi cat
    await prisma.card.deleteMany({ where: { id: { in: [made.get(31)!, made.get(32)!] } } });
    const exact = body(await plan(w.owner, w.listId)).data;
    expect(exact.rows).toHaveLength(30);
    expect(exact.totalUnassigned).toBe(30);
    expect(exact.truncated).toBe(false);
  });

  it('danh sach khong co the nao chua giao -> 200, khong dong nao', async () => {
    const w = await world();
    await mkCard(w.listId, { title: 'Da giao', members: [w.alice.id] });
    const res = await plan(w.owner, w.listId);
    expect(res.status).toBe(200);
    expect(body(res).data.rows).toEqual([]);
    expect(body(res).data.totalUnassigned).toBe(0);
    expect(body(res).data.truncated).toBe(false);
    expect(body(res).data.people.length).toBe(3); // van cho biet nhung nguoi co the nhan
  });
});

// ===================== Dang tra ve va rieng tu =====================

describe('POST .../assignment-plan - dang tra ve va rieng tu', () => {
  it('nguoi co the nhan = chu bang + thanh vien khong phai VIEWER (giong lop 1); moi dong co nguoi duoc chon va xep hang gon; khong email, khong bang chung', async () => {
    const w = await world();
    await giveHistory(w.listId, w.alice.id, ['Bi mat XYZ123 thiet ke giao dien', 'Bi mat XYZ123 thiet ke trang']);
    const target = await newTarget(w.listId);
    const layer1 = await suggest(w.owner, target.id);

    const res = await plan(w.owner, w.listId);
    expect(res.status).toBe(200);
    const d = body(res).data;
    expect(sorted(d.people.map((p) => p.user.id))).toEqual(idsOf(layer1.body)); // cung tap ung vien voi lop 1
    expect(d.people.map((p) => p.user.id)).not.toContain(w.viewer.id);
    expect(d.people.map((p) => p.user.id)).not.toContain(w.outsider.id);
    for (const p of d.people) {
      expect(Object.keys(p.user).sort()).toEqual(['avatarUrl', 'id', 'name']);
      expect(p.capacity).toBe(5);
      expect(p.paused).toBe(false);
    }
    expect(d.algorithmVersion).toBe(ALGORITHM_VERSION);
    expect(d.planVersion).toBe(PLAN_VERSION);
    expect(d.weights).toEqual({ experience: 0.36, reliability: 0.24, availability: 0.2, declared: 0.2, custom: false });
    expect(Number.isNaN(Date.parse(d.generatedAt))).toBe(false);

    const row = d.rows[0]!;
    expect(row.card.id).toBe(target.id);
    expect(row.assignee).not.toBeNull();
    expect(row.assignee!.user.id).toBe(w.alice.id); // co lich su giong the nay
    expect(Object.keys(row.assignee!.components).sort()).toEqual(['availability', 'declared', 'experience', 'reliability']);
    // Buoc 18: co NO_PROFILE ra API (chua ai khai ho so)
    expect(row.assignee!.flags).toContain('NO_PROFILE');
    expect(row.ranking.every((r) => r.flags.includes('NO_PROFILE'))).toBe(true);
    expect(row.ranking.map((r) => r.userId)).toEqual(layer1.body.data.candidates.map((c: Cand) => c.user.id));
    expect(row.ranking.map((r) => r.rank)).toEqual([1, 2, 3]);

    // Khong co bang chung -> khong lo tieu de the cu (ke ca o bang ma nguoi hoi khong xem duoc); khong email
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('XYZ123');
    expect(json).not.toContain('evidence');
    expect(json).not.toContain('@test.local');
    expect(json.toLowerCase()).not.toContain('email');
  });

  it('CHI XEM TRUOC: khong ghi AssignRun, lien ket the-nguoi, nhat ky, the, trong so hay lich su trong so', async () => {
    const w = await world();
    await giveHistory(w.listId, w.alice.id);
    for (const [i, title] of TARGETS.slice(0, 4).entries()) await mkCard(w.listId, { title, dueDate: daysAhead(2 + i), startDate: daysAgo(1) });
    const before = await writes();
    for (const u of [w.owner, w.alice]) expect((await plan(u, w.listId)).status).toBe(200);
    expect((await plan(w.viewer, w.listId)).status).toBe(403);
    expect(await writes()).toEqual(before);
    expect(before.runs).toBe(0);
  });

  it('trong so cua nhom LUU HONG trong CSDL khong lam hong ke hoach: lui ve mac dinh (nhu lop 1); trong so hop le duoc dung', async () => {
    const w = await world();
    await newTarget(w.listId);
    await prisma.workspaceAssignWeights.create({ data: { workspaceId: w.wsId, wExperience: 0.9, wReliability: 0.9, wAvailability: 0.9, wDeclared: 0.2 } });
    const bad = await plan(w.owner, w.listId);
    expect(bad.status).toBe(200);
    expect(body(bad).data.weights).toEqual({ experience: 0.36, reliability: 0.24, availability: 0.2, declared: 0.2, custom: false });
    await prisma.workspaceAssignWeights.update({ where: { workspaceId: w.wsId }, data: { wExperience: 0.2, wReliability: 0.2, wAvailability: 0.5, wDeclared: 0.1 } });
    const good = await plan(w.owner, w.listId);
    expect(body(good).data.weights).toEqual({ experience: 0.2, reliability: 0.2, availability: 0.5, declared: 0.1, custom: true });
  });

  it('tat dinh: hai lan goi lien tiep cho cung nguoi chon, cung xep hang, diem gan bang nhau (chi generatedAt doi)', async () => {
    const w = await world();
    await giveHistory(w.listId, w.alice.id);
    await giveHistory(w.listId, w.bob.id, REPORTS);
    for (const [i, title] of TARGETS.entries()) await mkCard(w.listId, { title, dueDate: daysAhead(2 + i), startDate: daysAgo(1) });
    const a = body(await plan(w.owner, w.listId)).data;
    const b = body(await plan(w.owner, w.listId)).data;
    expect(b.rows.map((r) => r.card.id)).toEqual(a.rows.map((r) => r.card.id));
    expect(b.rows.map((r) => r.assignee?.user.id)).toEqual(a.rows.map((r) => r.assignee?.user.id));
    a.rows.forEach((r, i) => {
      expect(b.rows[i]!.ranking.map((x) => x.userId)).toEqual(r.ranking.map((x) => x.userId));
      r.ranking.forEach((x, j) => {
        if (x.score !== null) expect(b.rows[i]!.ranking[j]!.score).toBeCloseTo(x.score, 3);
        expect(b.rows[i]!.ranking[j]!.load).toBe(x.load);
      });
    });
  });

  it('planForList voi `now` truyen vao: ket qua khong doc dong ho ben trong (hai `now` khac nhau -> hai generatedAt)', async () => {
    const w = await world();
    await newTarget(w.listId);
    const t1 = new Date('2026-09-20T03:00:00.000Z');
    const t2 = new Date('2026-09-21T03:00:00.000Z');
    expect((await planForList(w.owner.id, w.listId, t1)).generatedAt).toEqual(t1);
    expect((await planForList(w.owner.id, w.listId, t2)).generatedAt).toEqual(t2);
  });
});

// ===================== Tam nghi =====================

describe('POST .../assignment-plan - nguoi tam nghi', () => {
  it('nguoi dang tam nghi KHONG bao gio duoc chon, nhung van co trong danh sach nguoi (paused) va trong xep hang (co PAUSED); moi nguoi tam nghi -> de trong', async () => {
    const w = await world();
    await giveHistory(w.listId, w.alice.id); // alice se la nguoi xep dau
    const ids: string[] = [];
    for (const [i, title] of TARGETS.slice(0, 3).entries()) ids.push((await mkCard(w.listId, { title, dueDate: daysAhead(3 + i), startDate: daysAgo(1) })).id);

    const before = body(await plan(w.owner, w.listId)).data;
    expect(before.rows.some((r) => r.assignee?.user.id === w.alice.id)).toBe(true);

    await prisma.memberWorkProfile.create({ data: { userId: w.alice.id, workspaceId: w.wsId, pausedUntil: daysAhead(30) } });
    const paused = body(await plan(w.owner, w.listId)).data;
    expect(paused.people.find((p) => p.user.id === w.alice.id)!.paused).toBe(true);
    expect(paused.people.filter((p) => p.paused)).toHaveLength(1);
    for (const r of paused.rows) {
      expect(r.assignee).not.toBeNull();
      expect(r.assignee!.user.id).not.toBe(w.alice.id);
      expect(r.ranking.find((x) => x.userId === w.alice.id)!.flags).toContain('PAUSED');
    }

    // Ca nhom deu tam nghi -> khong ai duoc chon, van co du dong va xep hang
    for (const u of [w.owner, w.bob]) await prisma.memberWorkProfile.create({ data: { userId: u.id, workspaceId: w.wsId, pausedUntil: daysAhead(30) } });
    const all = body(await plan(w.owner, w.listId)).data;
    expect(all.rows.map((r) => r.card.id)).toEqual(ids);
    expect(all.rows.every((r) => r.assignee === null)).toBe(true);
    expect(all.rows.every((r) => r.ranking.length === 3)).toBe(true);
    expect(all.people.every((p) => p.paused)).toBe(true);
  });

  it('tam nghi den DUNG luc `now` van tinh la dang tam nghi (>=); qua mot mili giay thi khong', async () => {
    const w = await world();
    await newTarget(w.listId);
    const now = new Date('2026-09-20T03:00:00.000Z');
    await prisma.memberWorkProfile.create({ data: { userId: w.alice.id, workspaceId: w.wsId, pausedUntil: now } });
    await prisma.memberWorkProfile.create({ data: { userId: w.bob.id, workspaceId: w.wsId, pausedUntil: new Date(now.getTime() - 1) } });
    const d = await planForList(w.owner.id, w.listId, now);
    expect(d.people.find((p) => p.user.id === w.alice.id)!.paused).toBe(true);
    expect(d.people.find((p) => p.user.id === w.bob.id)!.paused).toBe(false);
    expect(d.people.find((p) => p.user.id === w.owner.id)!.paused).toBe(false); // chua co ho so -> khong tam nghi
  });

  it('suc chua va so the dang mo cua tung nguoi duoc bao (de ban xem truoc tinh "sau khi chia")', async () => {
    const w = await world();
    await prisma.memberWorkProfile.create({ data: { userId: w.bob.id, workspaceId: w.wsId, maxParallelCards: 2 } });
    await mkCard(w.listId, { title: 'Dang lam 1', members: [w.bob.id], dueDate: daysAhead(4) });
    await mkCard(w.listId, { title: 'Dang lam 2', members: [w.bob.id], dueDate: daysAhead(5) });
    await mkCard(w.listId, { title: 'Da xong roi', done: true, members: [w.bob.id], dueDate: daysAgo(3) }); // khong tinh
    await mkCard(w.listId, { title: 'Luu tru', members: [w.bob.id], archivedAt: new Date(), dueDate: daysAhead(5) }); // khong tinh
    await newTarget(w.listId);
    const d = body(await plan(w.owner, w.listId)).data;
    const bob = d.people.find((p) => p.user.id === w.bob.id)!;
    expect(bob.capacity).toBe(2);
    expect(bob.openCards).toBe(2);
    const alice = d.people.find((p) => p.user.id === w.alice.id)!;
    expect(alice.capacity).toBe(5);
    expect(alice.openCards).toBe(0);
  });
});

// ===================== Doi chieu voi lop 1 =====================

describe('POST .../assignment-plan - doi chieu voi lop 1 (lan luot bam goi y so 1 roi giao that)', () => {
  /** Nhom co chuyen mon khac nhau: alice manh "giao dien", bob manh "bao cao", chu bang chua co lich su. */
  async function team(): Promise<World> {
    const w = await world();
    // Suc chua khac nhau (mac dinh 5): alice 3, bob 4 - de "suc chua" trong ket qua khong the la hang so mac dinh
    await prisma.memberWorkProfile.create({ data: { userId: w.alice.id, workspaceId: w.wsId, maxParallelCards: 3 } });
    await prisma.memberWorkProfile.create({ data: { userId: w.bob.id, workspaceId: w.wsId, maxParallelCards: 4 } });
    await giveHistory(w.listId, w.alice.id);
    await giveHistory(w.listId, w.bob.id, REPORTS);
    for (const [i, title] of TARGETS.entries()) await mkCard(w.listId, { title, dueDate: daysAhead(2 + i), startDate: daysAgo(1) });
    await mkCard(w.listId, { ...DESCRIBED, dueDate: daysAhead(2 + TARGETS.length), startDate: daysAgo(1) });
    return w;
  }

  async function checkAgainstLayer1(w: World) {
    const res = await plan(w.owner, w.listId);
    expect(res.status).toBe(200);
    const rows = body(res).data.rows;
    expect(rows).toHaveLength(TARGETS.length + 1);
    expect(body(res).data.groupOnTimeRate).toBeCloseTo(
      (await suggest(w.owner, rows[0]!.card.id)).body.data.groupOnTimeRate,
      6
    );
    const seq: string[] = [];
    for (const row of rows) {
      const s = await suggest(w.owner, row.card.id);
      expect(s.status).toBe(200);
      const cands = s.body.data.candidates as Cand[];
      const top = cands.find((c) => c.score !== null && !c.flags.includes('PAUSED'))!;
      // Tinh huong khong phai hoa tuyet doi (neu khong thoi gian gia lap co the lat thu tu)
      const second = cands.filter((c) => c.user.id !== top.user.id && c.score !== null)[0];
      if (second) expect(top.score! - second.score!, `hoa o the ${row.card.title}`).toBeGreaterThan(1e-3);

      const a = row.assignee!;
      expect(a.user.id).toBe(top.user.id);
      expect(a.score).toBeCloseTo(top.score!, 3);
      expect(a.rawScore).toBeCloseTo(top.rawScore!, 3);
      expect(a.confidence).toBeCloseTo(top.confidence, 6);
      expect(a.confidenceLevel).toBe(top.confidenceLevel);
      expect(a.load).toBe(top.load);
      expect(a.capacity).toBe(top.capacity);
      expect(a.flags).toEqual(top.flags);
      for (const k of ['experience', 'reliability', 'availability'] as const) {
        const [x, y] = [a.components[k], top.components[k]];
        expect(x.weight).toBe(y.weight);
        for (const f of ['value', 'scaled', 'share'] as const) {
          if (y[f] === null) expect(x[f]).toBeNull();
          else expect(x[f]).toBeCloseTo(y[f]!, 6);
        }
      }
      expect(row.ranking.map((r) => r.userId)).toEqual(cands.map((c) => c.user.id));
      row.ranking.forEach((r, i) => {
        expect(r.rank).toBe(cands[i]!.rank);
        if (cands[i]!.score === null) expect(r.score).toBeNull();
        else expect(r.score).toBeCloseTo(cands[i]!.score!, 3);
        expect(r.load).toBe(cands[i]!.load);
        expect(r.capacity).toBe(cands[i]!.capacity);
        expect(r.flags).toEqual(cands[i]!.flags);
      });
      // Giao that (lien ket cu 1 phut de anh chup cua lan goi sau thay duoc)
      await prisma.cardMember.create({ data: { cardId: row.card.id, userId: top.user.id, createdAt: new Date(Date.now() - 60_000) } });
      seq.push(top.user.id);
    }
    return seq;
  }

  it('trong so mac dinh: moi the, nguoi duoc chon / diem / tai / co / xep hang DEU trung voi lan luot bam goi y so 1 roi giao that; co nhieu nguoi nhan viec', async () => {
    const w = await team();
    const seq = await checkAgainstLayer1(w);
    expect(new Set(seq).size).toBeGreaterThanOrEqual(2);
  });

  it('trong so cua nhom (thien ve kha dung 0,05 / 0,20 / 0,70 / Ho so 0,05): van trung lop 1, va viec duoc chia ra ba nguoi', async () => {
    const w = await team();
    expect((await putW(w.owner, w.wsId, W(0.05, 0.2, 0.7, 0.05))).status).toBe(200);
    const preview = body(await plan(w.owner, w.listId)).data;
    expect(preview.weights).toEqual({ experience: 0.05, reliability: 0.2, availability: 0.7, declared: 0.05, custom: true });
    const seq = await checkAgainstLayer1(w);
    expect(new Set(seq).size).toBe(3);
  });
});

// ===================== Gioi han toc do (dat CUOI) =====================

describe('gioi han toc do', () => {
  it('10 luot / nguoi / 10 phut; luot thu 11 -> 429; nguoi khac khong bi anh huong; khong ghi CSDL', async () => {
    const w = await world();
    await newTarget(w.listId);
    let last = 0;
    for (let i = 0; i < 10; i += 1) {
      last = (await plan(w.owner, w.listId)).status;
      if (last !== 200) break;
    }
    expect(last).toBe(200);
    expect((await plan(w.owner, w.listId)).status).toBe(429);
    expect((await plan(w.alice, w.listId)).status).toBe(200);
    expect(await prisma.assignRun.count()).toBe(0);
  }, 60_000);
});
