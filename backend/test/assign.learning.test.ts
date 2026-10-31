// Buoc 6a - hoc trong so qua API (assign.repo.decideAndLearn / assign.service.recordOutcome), ho so lam viec ca nhan
// va cac truong moi cua GET trong so. Test tich hop tren DB THAT, tra thang vao WorkspaceAssignWeights /
// AssignWeightHistory / AssignRun.
//
// Cac luot goi y duoc DUNG SAN bang prisma (AssignRun voi dac trung da biet) de kiem soat chinh xac tung con so, khong
// phu thuoc bo cham; phan "hai dau ra khop nhau" da co o assign.equivalence.test.ts, con phan luong that (goi y -> giao ->
// ghi ket qua) co mot ca rieng o cuoi.
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { learnStep } from '../src/modules/assign/assign.learn';
import { saveWorkProfile } from '../src/modules/assign/assign.repo';
import { setMyWorkProfile } from '../src/modules/assign/assign.service';
import { agent, makeDirectUser, type TestUser } from './helpers';
import {
  SIMILAR,
  W,
  assign,
  daysAgo,
  daysAhead,
  delW,
  getW,
  giveHistory,
  mkCard,
  newTarget,
  postOutcome,
  putW,
  suggest,
  world,
  wsWorld,
  type World,
} from './assignFixtures';

type Feat = [number | null, number | null, number | null] | null;
interface CraftCand {
  userId: string;
  score: number | null;
  f: Feat;
  declared?: number | null;
}

/** Dung san mot AssignRun (dung dinh dang createRun ghi) voi ung vien + dac trung `scaled` da biet. */
async function craftRun(w: World, cardId: string, top: string | null, cands: CraftCand[], actor: TestUser = w.owner): Promise<string> {
  const comp = (v: number | null) => ({ value: v === null ? null : 0.5, scaled: v, share: 0.3 });
  const candidates = cands.map((c, i) => ({
    userId: c.userId,
    rank: i + 1,
    score: c.score,
    rawScore: c.score,
    confidence: 0.5,
    confidenceLevel: 'FAIR',
    load: 0,
    capacity: 5,
    flags: [] as string[],
    components: {
      experience: comp(c.f ? c.f[0] : null),
      reliability: comp(c.f ? c.f[1] : null),
      availability: comp(c.f ? c.f[2] : null),
      ...(c.declared !== undefined ? { declared: comp(c.declared) } : {}),
    },
    evidence: [],
  }));
  const run = await prisma.assignRun.create({
    data: {
      workspaceId: w.wsId,
      boardId: w.boardId,
      cardId,
      actorKey: actor.id,
      algorithmVersion: 'test',
      weights: { experience: 0.45, reliability: 0.3, availability: 0.25 },
      candidates,
      candidateCount: candidates.length,
      topUserId: top,
    },
    select: { id: true },
  });
  return run.id;
}

/** Alice (xep dau, hon o kinh nghiem) va Bob (hon o kha dung); reliability bang nhau. Hieu (bob - alice) = (-1, 0, +1). */
const aliceTop = (w: World): CraftCand[] => [
  { userId: w.alice.id, score: 60, f: [1, 0.5, 0] },
  { userId: w.bob.id, score: 40, f: [0, 0.5, 1] },
];

async function learnWorld() {
  const w = await world();
  const target = await newTarget(w.listId);
  await prisma.cardMember.createMany({
    data: [
      { cardId: target.id, userId: w.alice.id },
      { cardId: target.id, userId: w.bob.id },
    ],
  });
  return { w, target };
}

const rowOf = (wsId: string) => prisma.workspaceAssignWeights.findUniqueOrThrow({ where: { workspaceId: wsId } });
/** Bon trong so cua MOT DONG CSDL (WorkspaceAssignWeights / AssignWeightHistory) - buoc 16: them wDeclared. */
const wOf = (r: { wExperience: number; wReliability: number; wAvailability: number; wDeclared: number | null }) => [
  r.wExperience,
  r.wReliability,
  r.wAvailability,
  r.wDeclared,
];
/** Bon trong so o dang API ({ experience, reliability, availability, declared }). */
const wApi = (w: { experience: number; reliability: number; availability: number; declared: number }) => [w.experience, w.reliability, w.availability, w.declared];
const closeTo = (got: number[], want: number[], eps = 1e-12) => got.every((g, i) => Math.abs(g - want[i]!) <= eps);

// ===================== Hoc =====================

describe('POST outcome - hoc trong so (muc 2)', () => {
  it('9 luot dau chi GHI NHAN (TOO_EARLY, feedbackCount tang, trong so va lich su khong doi); luot thu 10 HOC; luot 11 hoc tiep', async () => {
    const { w, target } = await learnWorld();
    for (let i = 1; i <= 9; i += 1) {
      const runId = await craftRun(w, target.id, w.alice.id, aliceTop(w));
      const res = await postOutcome(w.owner, runId, { chosenUserId: w.bob.id });
      expect(res.status, `luot ${i}`).toBe(200);
      expect(res.body.data, `luot ${i}`).toMatchObject({
        accepted: false,
        learned: false,
        feedbackCount: i,
        learning: { learned: false, reason: 'TOO_EARLY' },
        weights: { experience: 0.36, reliability: 0.24, availability: 0.2, declared: 0.2 },
      });
    }
    // Dong tao lan dau mang mac dinh CU cua cot (wDeclared null) -> nang cap khi doc -> ghi lai du bon cot
    let row = await rowOf(w.wsId);
    expect([...wOf(row), row.feedbackCount]).toEqual([0.36, 0.24, 0.2, 0.2, 9]);
    expect(await prisma.assignWeightHistory.count()).toBe(0);
    expect(await prisma.assignRun.count({ where: { learned: true } })).toBe(0);

    // Luot thu 10: bat dau hoc tren S = ba thanh phan lich su (nhat ky 3 thanh phan), khoi 1 - 0,20: hieu (-1; 0; +1) * 0,05 -> (0,31; 0,24; 0,25; 0,20)
    const run10 = await craftRun(w, target.id, w.alice.id, aliceTop(w));
    const r10 = await postOutcome(w.owner, run10, { chosenUserId: w.bob.id });
    expect(r10.status).toBe(200);
    expect(r10.body.data).toMatchObject({ learned: true, feedbackCount: 10, learning: { learned: true, reason: 'LEARNED' } });
    expect(closeTo(wApi(r10.body.data.weights), [0.31, 0.24, 0.25, 0.2])).toBe(true);
    expect(Object.keys(r10.body.data.weights).sort()).toEqual(['availability', 'declared', 'experience', 'reliability']);
    row = await rowOf(w.wsId);
    expect(row.feedbackCount).toBe(10);
    expect(closeTo(wOf(row) as number[], [0.31, 0.24, 0.25, 0.2])).toBe(true);
    const h1 = await prisma.assignWeightHistory.findMany({ orderBy: { createdAt: 'asc' } });
    expect(h1).toHaveLength(1);
    expect(h1[0]).toMatchObject({ workspaceId: w.wsId, runId: run10, feedbackCount: 10 });
    expect(closeTo(wOf(h1[0]!) as number[], [0.31, 0.24, 0.25, 0.2])).toBe(true);
    expect((await prisma.assignRun.findUniqueOrThrow({ where: { id: run10 } })).learned).toBe(true);

    // Luot 11: cung dac trung -> buoc tiep (0,26; 0,24; 0,30; 0,20)
    const run11 = await craftRun(w, target.id, w.alice.id, aliceTop(w));
    const r11 = await postOutcome(w.owner, run11, { chosenUserId: w.bob.id });
    expect(r11.body.data).toMatchObject({ learned: true, feedbackCount: 11 });
    expect(closeTo(wApi(r11.body.data.weights), [0.26, 0.24, 0.3, 0.2])).toBe(true);
    expect(await prisma.assignWeightHistory.count()).toBe(2);
  });

  it('giao DUNG nguoi xep dau (ACCEPTED) sau khi da du 10 luot: van cong luot, KHONG doi trong so, KHONG ghi lich su', async () => {
    const { w, target } = await learnWorld();
    await prisma.workspaceAssignWeights.create({ data: { workspaceId: w.wsId, wExperience: 0.4, wReliability: 0.3, wAvailability: 0.2, wDeclared: 0.1, feedbackCount: 12 } });
    const runId = await craftRun(w, target.id, w.alice.id, aliceTop(w));
    const res = await postOutcome(w.owner, runId, { chosenUserId: w.alice.id });
    expect(res.body.data).toMatchObject({ accepted: true, learned: false, feedbackCount: 13, learning: { learned: false, reason: 'ACCEPTED' } });
    const row = await rowOf(w.wsId);
    expect([...wOf(row), row.feedbackCount]).toEqual([0.4, 0.3, 0.2, 0.1, 13]);
    expect(await prisma.assignWeightHistory.count()).toBe(0);
  });

  it('cac ly do khong hoc o CSDL that: NO_TOP, NOT_CANDIDATE, MISSING_COMPONENT, TIE, NO_CHANGE (moi luot van cong feedbackCount)', async () => {
    const { w, target } = await learnWorld();
    await prisma.cardMember.create({ data: { cardId: target.id, userId: w.viewer.id } }); // duoc gan tay, khong nam trong danh sach da cham
    await prisma.workspaceAssignWeights.create({ data: { workspaceId: w.wsId, wExperience: 0.7, wReliability: 0.2, wAvailability: 0.05, wDeclared: 0.05, feedbackCount: 20 } });

    const cases: [string, string, string | null, CraftCand[], string][] = [
      ['NO_TOP', 'NO_TOP', null, aliceTop(w), w.bob.id],
      ['NOT_CANDIDATE', 'NOT_CANDIDATE', w.alice.id, aliceTop(w), w.viewer.id],
      ['MISSING_COMPONENT', 'MISSING_COMPONENT', w.alice.id, [{ userId: w.alice.id, score: 60, f: [1, 0.5, 0] }, { userId: w.bob.id, score: 40, f: null }], w.bob.id],
      ['TIE', 'TIE', w.alice.id, [{ userId: w.alice.id, score: 50, f: [1, 0.5, 0] }, { userId: w.bob.id, score: 50, f: [0, 0.5, 1] }], w.bob.id],
      // w = (0,70; 0,20; 0,05; Ho so 0,05), hieu (+1; +1; -1) tren ba thanh phan lich su (khoi 0,95): tran/san chan het -> khong doi
      ['NO_CHANGE', 'NO_CHANGE', w.alice.id, [{ userId: w.alice.id, score: 60, f: [0, 0, 1] }, { userId: w.bob.id, score: 40, f: [1, 1, 0] }], w.bob.id],
    ];
    let expectedCount = 20;
    for (const [label, reason, top, cands, chosen] of cases) {
      const runId = await craftRun(w, target.id, top, cands);
      const res = await postOutcome(w.owner, runId, { chosenUserId: chosen });
      expectedCount += 1;
      expect(res.status, label).toBe(200);
      expect(res.body.data.learning, label).toEqual({ learned: false, reason });
      expect(res.body.data.feedbackCount, label).toBe(expectedCount);
      expect(closeTo(wApi(res.body.data.weights), [0.7, 0.2, 0.05, 0.05]), label).toBe(true);
    }
    const row = await rowOf(w.wsId);
    expect([...wOf(row), row.feedbackCount]).toEqual([0.7, 0.2, 0.05, 0.05, 25]);
    expect(await prisma.assignWeightHistory.count()).toBe(0);
    expect(await prisma.assignRun.count({ where: { learned: true } })).toBe(0);
    // accepted chi dung khi nguoi duoc chon == nguoi xep dau (kem NO_TOP: top null -> false)
    expect((await prisma.assignRun.findMany({ where: { decidedAt: { not: null } } })).every((r) => r.accepted === false)).toBe(true);
  });

  it('buoc 13 (§17.7) o CSDL that: nguoi duoc chon THIEU tin cay -> van hoc tren kinh nghiem + kha dung; tin cay giu nguyen', async () => {
    const { w, target } = await learnWorld();
    await prisma.workspaceAssignWeights.create({ data: { workspaceId: w.wsId, feedbackCount: 12 } }); // cot mac dinh cu -> nang cap: 0,36 / 0,24 / 0,20 / 0,20
    const runId = await craftRun(w, target.id, w.alice.id, [
      { userId: w.alice.id, score: 60, f: [1, 0.5, 0] },
      { userId: w.bob.id, score: 40, f: [0, null, 1] },
    ]);
    const res = await postOutcome(w.owner, runId, { chosenUserId: w.bob.id });
    expect(res.body.data.learning).toEqual({ learned: true, reason: 'LEARNED' });
    // D_top = 0,80, D_chosen = 0,56: delta = (-0,70; +1), chieu S -> (-0,0425; +0,0425).
    expect(closeTo(wApi(res.body.data.weights), [0.3175, 0.24, 0.2425, 0.2])).toBe(true);
    const row = await rowOf(w.wsId);
    expect([row.wReliability, row.wDeclared]).toEqual([0.24, 0.2]);
    expect(closeTo(wOf(row) as number[], [0.3175, 0.24, 0.2425, 0.2])).toBe(true);
  });

  it('nguoi duoc chon thieu lich su: API luu buoc hoc THU HEP khoang cach diem, va chi ghi mot lan', async () => {
    const { w, target } = await learnWorld();
    await prisma.workspaceAssignWeights.create({ data: { workspaceId: w.wsId, feedbackCount: 9 } });
    const runId = await craftRun(w, target.id, w.alice.id, [
      { userId: w.alice.id, score: 80, f: [1, 1, 0.8], declared: 0.2 },
      { userId: w.bob.id, score: 45, f: [null, null, 0.7], declared: 0.2 },
    ]);
    const res = await postOutcome(w.owner, runId, { chosenUserId: w.bob.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ feedbackCount: 10, learning: { learned: true, reason: 'LEARNED' } });
    expect(closeTo(wApi(res.body.data.weights), [0.36, 0.24, 0.2065, 0.1935])).toBe(true);
    const row = await rowOf(w.wsId);
    const topScore = 100 * (row.wExperience + row.wReliability + row.wAvailability * 0.8 + row.wDeclared! * 0.2);
    const chosenScore = 100 * (row.wAvailability * 0.7 + row.wDeclared! * 0.2) / (row.wAvailability + row.wDeclared!);
    expect(topScore - chosenScore).toBeCloseTo(34.5775, 10);
    expect(topScore - chosenScore).toBeLessThan(35);
    const history = await prisma.assignWeightHistory.findMany({ where: { runId } });
    expect(history).toHaveLength(1);
    expect(closeTo(wOf(history[0]!) as number[], wOf(row) as number[])).toBe(true);
    const replay = await postOutcome(w.owner, runId, { chosenUserId: w.bob.id });
    expect(replay.status).toBe(200);
    expect((await rowOf(w.wsId)).feedbackCount).toBe(10);
    expect(await prisma.assignWeightHistory.count({ where: { runId } })).toBe(1);
  });

  it('PHEP CHIEU o CSDL that: (0,70; 0,20; 0,05; Ho so 0,05) + 0,05 * (+1; 0; +1) tren khoi 0,95 -> (0,70; 0,175; 0,075; 0,05) (kep-roi-chuan-hoa se ra (0,665; 0,19; 0,095), khac)', async () => {
    const { w, target } = await learnWorld();
    await prisma.workspaceAssignWeights.create({ data: { workspaceId: w.wsId, wExperience: 0.7, wReliability: 0.2, wAvailability: 0.05, wDeclared: 0.05, feedbackCount: 30 } });
    const runId = await craftRun(w, target.id, w.alice.id, [
      { userId: w.alice.id, score: 60, f: [0, 0.5, 0] },
      { userId: w.bob.id, score: 40, f: [1, 0.5, 1] },
    ]);
    const res = await postOutcome(w.owner, runId, { chosenUserId: w.bob.id });
    expect(res.body.data.learning).toEqual({ learned: true, reason: 'LEARNED' });
    expect(closeTo(wApi(res.body.data.weights), [0.7, 0.175, 0.075, 0.05])).toBe(true);
    const row = await rowOf(w.wsId);
    expect(closeTo(wOf(row) as number[], [0.7, 0.175, 0.075, 0.05])).toBe(true);
    expect(row.wExperience + row.wReliability + row.wAvailability + row.wDeclared!).toBeCloseTo(1, 12);
  });

  it('HAI luot phan hoi CUNG LUC trong cung nhom NOI DUOI nhau (khoa dong): khong mat cap nhat nao; lich su la mot chuoi lien tiep', async () => {
    const { w, target } = await learnWorld();
    await prisma.workspaceAssignWeights.create({ data: { workspaceId: w.wsId, feedbackCount: 12 } }); // trong so mac dinh, da du 10 luot
    const f1 = { top: [1, 0.5, 0] as [number, number, number], chosen: [0, 0.5, 1] as [number, number, number] };
    const f2 = { top: [0, 1, 0.5] as [number, number, number], chosen: [1, 0, 0.5] as [number, number, number] };
    const mk = (f: { top: [number, number, number]; chosen: [number, number, number] }) =>
      craftRun(w, target.id, w.alice.id, [
        { userId: w.alice.id, score: 60, f: f.top },
        { userId: w.bob.id, score: 40, f: f.chosen },
      ]);
    const [run1, run2] = [await mk(f1), await mk(f2)];
    type Ws = { experience: number; reliability: number; availability: number; declared: number };
    const feat = (t: [number, number, number]) => ({ experience: t[0], reliability: t[1], availability: t[2] });
    const step = (from: Ws, f: typeof f1) => learnStep(from, feat(f.top), feat(f.chosen));
    const arr = (x: Ws) => [x.experience, x.reliability, x.availability, x.declared];
    // Dong cot mac dinh cu -> nang cap khi doc = mac dinh moi
    const DEFAULT = { experience: 0.36, reliability: 0.24, availability: 0.2, declared: 0.2 };
    // Hai buoc cong tinh, khong cham bien -> giao hoan: ket qua cuoi la (0,36; 0,19; 0,25; 0,20) du thu tu nao
    const both = step(step(DEFAULT, f1), f2);
    const only1 = step(DEFAULT, f1); // (0,31; 0,24; 0,25; 0,20)
    const only2 = step(DEFAULT, f2); // (0,41; 0,19; 0,20; 0,20)
    expect(closeTo(arr(both), [0.36, 0.19, 0.25, 0.2])).toBe(true);

    const [a, b] = await Promise.all([
      postOutcome(w.owner, run1, { chosenUserId: w.bob.id }),
      postOutcome(w.owner, run2, { chosenUserId: w.bob.id }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const row = await rowOf(w.wsId);
    // Khong khoa: ca hai giao dich cung doc dem = 12 va cung ghi 13 (mat mot luot) va trong so chi ap dung MOT buoc
    expect(row.feedbackCount).toBe(14);
    expect(closeTo(wOf(row) as number[], arr(both), 1e-9)).toBe(true);
    expect(closeTo(wOf(row) as number[], arr(only1), 1e-9)).toBe(false);
    expect(closeTo(wOf(row) as number[], arr(only2), 1e-9)).toBe(false);

    const hist = await prisma.assignWeightHistory.findMany({ orderBy: { createdAt: 'asc' } });
    expect(hist.map((h) => h.feedbackCount)).toEqual([13, 14]); // luot phan hoi thu 13 roi thu 14, khong trung so
    expect(new Set([hist[0]!.runId, hist[1]!.runId])).toEqual(new Set([run1, run2]));
    // Dong lich su thu hai bat dau tu CHINH dong thu nhat (mot chuoi lien tiep, khong phai hai nhanh tu mac dinh)
    const firstRun = hist[0]!.runId === run1 ? f1 : f2;
    const secondRun = hist[1]!.runId === run1 ? f1 : f2;
    const afterFirst = step(DEFAULT, firstRun);
    expect(closeTo(wOf(hist[0]!) as number[], arr(afterFirst), 1e-9)).toBe(true);
    expect(closeTo(wOf(hist[1]!) as number[], arr(step(afterFirst, secondRun)), 1e-9)).toBe(true);
  });

  it('KHOA dong trong so (FOR UPDATE): giao dich khac dang giu dong thi luot phan hoi CHO roi doc gia tri MOI - khong ghi de mat cap nhat (khong dua vao may rui thoi gian)', async () => {
    const { w, target } = await learnWorld();
    await prisma.workspaceAssignWeights.create({ data: { workspaceId: w.wsId, feedbackCount: 12 } }); // cot mac dinh cu -> nang cap = mac dinh moi
    const runId = await craftRun(w, target.id, w.alice.id, aliceTop(w)); // hieu (-1; 0; +1)

    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const lockedP = new Promise<void>((r) => (locked = r));
    // Mot giao dich khac giu khoa dong trong so, doi roi cap nhat (vd mot lan chinh tay) truoc khi commit
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "workspaceId" FROM "WorkspaceAssignWeights" WHERE "workspaceId" = ${w.wsId} FOR UPDATE`;
        locked();
        await released;
        await tx.workspaceAssignWeights.update({
          where: { workspaceId: w.wsId },
          data: { wExperience: 0.5, wReliability: 0.2, wAvailability: 0.1, wDeclared: 0.2, feedbackCount: 13 },
        });
      },
      { timeout: 20_000 }
    );
    await lockedP;

    const pending = postOutcome(w.owner, runId, { chosenUserId: w.bob.id }).then((r) => r);
    await new Promise((r) => setTimeout(r, 600)); // du de yeu cau toi CSDL: co khoa thi dung cho o day, khong khoa thi da doc gia tri CU
    release();
    const [res] = await Promise.all([pending, holder]);
    expect(res.status).toBe(200);

    // Doc SAU giao dich kia: dem 13 -> 14 va trong so bat dau tu (0,50; 0,20; 0,10; 0,20) -> (0,45; 0,20; 0,15; 0,20).
    // Neu khong khoa: doc gia tri cu (12; mac dinh 0,36 / 0,24 / 0,20 / 0,20) roi ghi de -> dem 13 va (0,31; 0,24; 0,25; 0,20).
    const row = await rowOf(w.wsId);
    expect(row.feedbackCount).toBe(14);
    expect(closeTo(wOf(row) as number[], [0.45, 0.2, 0.15, 0.2])).toBe(true);
    expect(res.body.data).toMatchObject({ feedbackCount: 14, learned: true });
    const hist = await prisma.assignWeightHistory.findMany();
    expect(hist).toHaveLength(1);
    expect([hist[0]!.feedbackCount, hist[0]!.runId]).toEqual([14, runId]);
  });

  it('luu ho so lan dau bi tranh TRUNG KHOA (mot giao dich khac vua tao dong): khong nem loi, cap nhat len dong do va van chi mot dong', async () => {
    const w = await wsWorld();
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));
    let inserted!: () => void;
    const insertedP = new Promise<void>((r) => (inserted = r));
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.memberWorkProfile.create({ data: { userId: w.member.id, workspaceId: w.wsId, maxParallelCards: 9 } });
        inserted();
        await released;
      },
      { timeout: 20_000 }
    );
    await insertedP;
    const saving = saveWorkProfile(w.member.id, w.wsId, { maxParallelCards: 4, pausedUntil: null });
    await new Promise((r) => setTimeout(r, 500)); // upsert cua ta khong thay dong chua commit -> cho o buoc ghi
    release();
    await holder;
    const saved = await saving;
    expect(saved.maxParallelCards).toBe(4);
    expect(await prisma.memberWorkProfile.count()).toBe(1);
    expect((await prisma.memberWorkProfile.findFirstOrThrow()).maxParallelCards).toBe(4);
  });

  it('DELETE dat lai dua ve 0 luot -> luot phan hoi ke tiep lai la TOO_EARLY; nhom khac khong bi anh huong', async () => {
    const a = await learnWorld();
    const b = await learnWorld();
    await prisma.workspaceAssignWeights.create({ data: { workspaceId: a.w.wsId, wExperience: 0.3, wReliability: 0.3, wAvailability: 0.4, feedbackCount: 15 } });
    await prisma.workspaceAssignWeights.create({ data: { workspaceId: b.w.wsId, feedbackCount: 5 } });

    // Chu khong gian A dat lai (owner cua world la chu KG)
    expect((await delW(a.w.owner, a.w.wsId)).status).toBe(200);
    const runA = await craftRun(a.w, a.target.id, a.w.alice.id, aliceTop(a.w));
    const res = await postOutcome(a.w.owner, runA, { chosenUserId: a.w.bob.id });
    expect(res.body.data).toMatchObject({ feedbackCount: 1, learning: { learned: false, reason: 'TOO_EARLY' } });

    // Nhom B khong bi dong toi
    expect((await rowOf(b.w.wsId)).feedbackCount).toBe(5);
    expect(await prisma.assignWeightHistory.count({ where: { workspaceId: b.w.wsId } })).toBe(0);
  });

  it('luong THAT: goi y -> giao -> ghi ket qua; GET trong so phan anh so luot, ti le giao dung nguoi xep dau va trang thai hoc', async () => {
    const w = await world();
    const target = await newTarget(w.listId);
    await giveHistory(w.listId, w.alice.id, SIMILAR); // alice se xep dau
    await prisma.cardMember.create({ data: { cardId: target.id, userId: w.bob.id } });
    await assign(w.owner, target.id, w.alice.id);

    const runOf = async () => (await suggest(w.owner, target.id)).body.data.runId as string;
    const first = await postOutcome(w.owner, await runOf(), { chosenUserId: w.alice.id }); // dung nguoi xep dau
    const second = await postOutcome(w.owner, await runOf(), { chosenUserId: w.alice.id });
    const third = await postOutcome(w.owner, await runOf(), { chosenUserId: w.bob.id }); // khac nguoi xep dau
    expect([first.body.data.accepted, second.body.data.accepted, third.body.data.accepted]).toEqual([true, true, false]);
    expect(third.body.data.learning.reason).toBe('TOO_EARLY');

    // Chu khong gian doc so lieu: workspace cua world la workspace cua owner
    const view = (await getW(w.owner, w.wsId)).body.data;
    expect(view.feedbackCount).toBe(3);
    expect(view.feedback).toEqual({ decided: 3, accepted: 2 });
    expect(view.learning).toEqual({ minFeedback: 10, eta: 0.05, active: false });
    expect(view.history).toEqual([]);

    await prisma.workspaceAssignWeights.update({ where: { workspaceId: w.wsId }, data: { feedbackCount: 10 } });
    expect((await getW(w.owner, w.wsId)).body.data.learning.active).toBe(true);
  });
});

// ===================== GET trong so: lich su + so lieu =====================

describe('GET trong so - lich su doi va cac truong moi', () => {
  it('lich su: toi da 20 dong, MOI NHAT TRUOC; nguon LEARNED (co runId) / MANUAL (khong); moi thanh vien xem duoc', async () => {
    const w = await wsWorld();
    await prisma.workspaceAssignWeights.create({ data: { workspaceId: w.wsId } });
    const base = Date.now() - 60 * 60_000;
    for (let i = 0; i < 25; i += 1) {
      await prisma.assignWeightHistory.create({
        data: {
          workspaceId: w.wsId,
          wExperience: 0.45,
          wReliability: 0.3,
          wAvailability: 0.25,
          feedbackCount: i,
          runId: i % 2 === 0 ? `run-${i}` : null,
          createdAt: new Date(base + i * 60_000),
        },
      });
    }
    for (const u of [w.owner, w.admin, w.member]) {
      const res = await getW(u, w.wsId);
      expect(res.status, u.name).toBe(200);
      const h = res.body.data.history as { feedbackCount: number; source: string; runId: string | null; at: string; weights: unknown }[];
      expect(h).toHaveLength(20);
      expect(h.map((x) => x.feedbackCount)).toEqual(Array.from({ length: 20 }, (_, k) => 24 - k)); // 24, 23, ..., 5
      expect(h[0]).toMatchObject({ feedbackCount: 24, source: 'LEARNED', runId: 'run-24' });
      expect(h[1]).toMatchObject({ feedbackCount: 23, source: 'MANUAL', runId: null });
      // Dong lich su truoc buoc 16: Ho so = null (khong nang cap - lich su giu dung nhu luc do)
      expect(h[0]!.weights).toEqual({ experience: 0.45, reliability: 0.3, availability: 0.25, declared: null });
      expect(new Date(h[0]!.at).getTime()).toBeGreaterThan(new Date(h[1]!.at).getTime());
    }
  });

  it('PUT / DELETE tra cung mot dang day du (lich su moi nhat la thay doi vua roi, nguon MANUAL)', async () => {
    const w = await wsWorld();
    const put = await putW(w.owner, w.wsId, W(0.4, 0.3, 0.2, 0.1));
    expect(put.body.data.history[0]).toMatchObject({ source: 'MANUAL', runId: null, weights: { experience: 0.4, reliability: 0.3, availability: 0.2, declared: 0.1 } });
    expect(put.body.data.learning).toEqual({ minFeedback: 10, eta: 0.05, active: false });
    expect(put.body.data.feedback).toEqual({ decided: 0, accepted: 0 });
    const del = await delW(w.owner, w.wsId);
    expect(del.body.data.history).toHaveLength(2);
    expect(del.body.data.history[0]).toMatchObject({ source: 'MANUAL', weights: { experience: 0.36, reliability: 0.24, availability: 0.2, declared: 0.2 } });
  });
});

// ===================== Ho so lam viec ca nhan =====================

const pUrl = (id: string) => `/api/workspaces/${id}/assignment-profile`;
const getP = (u: TestUser | null, id: string) => {
  const r = agent().get(pUrl(id));
  return u ? r.set('Cookie', u.cookie) : r;
};
const putP = (u: TestUser | null, id: string, body: unknown) => {
  const r = agent().put(pUrl(id));
  return (u ? r.set('Cookie', u.cookie) : r).send(body as object);
};

describe('GET/PUT /api/workspaces/:workspaceId/assignment-profile - ho so lam viec CUA CHINH MINH', () => {
  it('GET: mac dinh 5 the, khong tam nghi, khong tao dong; moi thanh vien xem duoc cua minh; nguoi ngoai 403; khong ton tai 404; chua dang nhap 401', async () => {
    const w = await wsWorld();
    for (const u of [w.owner, w.admin, w.member]) {
      const res = await getP(u, w.wsId);
      expect(res.status, u.name).toBe(200);
      expect(res.body.data).toEqual({
        workspaceId: w.wsId,
        maxParallelCards: 5,
        defaultMaxParallelCards: 5,
        pausedUntil: null,
        isDefault: true,
        updatedAt: null,
      });
    }
    expect((await getP(w.outsider, w.wsId)).status).toBe(403);
    expect((await getP(w.owner, 'khong-co')).status).toBe(404);
    expect((await getP(null, w.wsId)).status).toBe(401);
    expect(await prisma.memberWorkProfile.count()).toBe(0);
  });

  it('PUT luu dung + GET doc lai; moi nguoi mot ho so RIENG (khong ai sua ho so nguoi khac); thanh vien thuong cung tu sua duoc; xoa tam nghi bang null', async () => {
    const w = await wsWorld();
    const until = new Date('2026-10-05T16:59:59.999Z');
    const put = await putP(w.member, w.wsId, { maxParallelCards: 3, pausedUntil: until.toISOString() });
    expect(put.status).toBe(200);
    expect(put.body.data).toMatchObject({ maxParallelCards: 3, pausedUntil: until.toISOString(), isDefault: false, defaultMaxParallelCards: 5 });
    expect(put.body.data.updatedAt).not.toBeNull();

    const row = await prisma.memberWorkProfile.findUniqueOrThrow({ where: { userId_workspaceId: { userId: w.member.id, workspaceId: w.wsId } } });
    expect([row.maxParallelCards, row.pausedUntil]).toEqual([3, until]);
    expect(row.allowCrossWorkspace).toBe(false); // khong dong toi cong tac rieng tu

    expect((await getP(w.member, w.wsId)).body.data).toMatchObject({ maxParallelCards: 3, pausedUntil: until.toISOString() });
    // Nguoi khac van thay mac dinh cua HO
    expect((await getP(w.admin, w.wsId)).body.data).toMatchObject({ maxParallelCards: 5, pausedUntil: null, isDefault: true });
    expect(await prisma.memberWorkProfile.count()).toBe(1);

    // Xoa tam nghi, bien 1 va 30
    const cleared = await putP(w.member, w.wsId, { maxParallelCards: 30, pausedUntil: null });
    expect(cleared.body.data).toMatchObject({ maxParallelCards: 30, pausedUntil: null, isDefault: false });
    expect((await putP(w.member, w.wsId, { maxParallelCards: 1, pausedUntil: null })).status).toBe(200);
    // Ve dung mac dinh thi isDefault = true
    expect((await putP(w.member, w.wsId, { maxParallelCards: 5, pausedUntil: null })).body.data.isDefault).toBe(true);
    expect(await prisma.memberWorkProfile.count()).toBe(1);

    expect((await putP(w.outsider, w.wsId, { maxParallelCards: 3, pausedUntil: null })).status).toBe(403);
    expect((await putP(null, w.wsId, { maxParallelCards: 3, pausedUntil: null })).status).toBe(401);
    expect((await putP(w.owner, 'khong-co', { maxParallelCards: 3, pausedUntil: null })).status).toBe(404);
  });

  it('PUT sai -> 400 kem loi theo truong, KHONG ghi gi: so the 0 / 31 / le / chuoi / null / thieu; ngay khong phai ISO co Z / chi ngay / lech mui gio / so / thieu', async () => {
    const w = await wsWorld();
    const ok = { maxParallelCards: 5, pausedUntil: null };
    const bad: [string, unknown, string][] = [
      ['so the = 0', { ...ok, maxParallelCards: 0 }, 'maxParallelCards'],
      ['so the = 31', { ...ok, maxParallelCards: 31 }, 'maxParallelCards'],
      ['so the am', { ...ok, maxParallelCards: -2 }, 'maxParallelCards'],
      ['so the le', { ...ok, maxParallelCards: 2.5 }, 'maxParallelCards'],
      ['so the la chuoi', { ...ok, maxParallelCards: '5' }, 'maxParallelCards'],
      ['so the null', { ...ok, maxParallelCards: null }, 'maxParallelCards'],
      ['thieu so the', { pausedUntil: null }, 'maxParallelCards'],
      ['ngay la chu', { ...ok, pausedUntil: 'khong-phai-ngay' }, 'pausedUntil'],
      ['chi co ngay, khong gio', { ...ok, pausedUntil: '2026-10-01' }, 'pausedUntil'],
      ['co lech mui gio thay vi Z', { ...ok, pausedUntil: '2026-10-01T10:00:00+07:00' }, 'pausedUntil'],
      ['ngay la so', { ...ok, pausedUntil: 1_790_000_000_000 }, 'pausedUntil'],
      ['thieu pausedUntil', { maxParallelCards: 5 }, 'pausedUntil'],
    ];
    for (const [label, body, field] of bad) {
      const res = await putP(w.owner, w.wsId, body);
      expect(res.status, label).toBe(400);
      expect(res.body.errors.map((e: { field: string }) => e.field), label).toContain(field);
    }
    expect((await putP(w.owner, w.wsId, [])).status).toBe(400);
    expect(await prisma.memberWorkProfile.count()).toBe(0);
  });

  it('service TU kiem tra lai (rao ve cuoi, khong chi dua vao zod): gia tri sai nem 400, nguoi ngoai nem 403', async () => {
    const w = await wsWorld();
    for (const n of [0, 31, 2.5, Number.NaN, Infinity]) {
      await expect(setMyWorkProfile(w.owner.id, w.wsId, { maxParallelCards: n, pausedUntil: null }), String(n)).rejects.toMatchObject({ statusCode: 400 });
    }
    await expect(setMyWorkProfile(w.owner.id, w.wsId, { maxParallelCards: 5, pausedUntil: new Date('khong') })).rejects.toMatchObject({ statusCode: 400 });
    await expect(setMyWorkProfile(w.outsider.id, w.wsId, { maxParallelCards: 5, pausedUntil: null })).rejects.toMatchObject({ statusCode: 403 });
    expect(await prisma.memberWorkProfile.count()).toBe(0);
  });

  it('bam Luu hai lan CUNG LUC (trung khoa lan dau): ca hai deu 200, van chi mot dong', async () => {
    const w = await wsWorld();
    const [a, b] = await Promise.all([
      putP(w.member, w.wsId, { maxParallelCards: 4, pausedUntil: null }),
      putP(w.member, w.wsId, { maxParallelCards: 6, pausedUntil: null }),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(await prisma.memberWorkProfile.count()).toBe(1);
    expect([4, 6]).toContain((await getP(w.member, w.wsId)).body.data.maxParallelCards);
  });

  it('ho so ANH HUONG goi y: suc chua 1 + 1 the dang mo chong lan -> OVERLOADED, capacity 1; tam nghi -> PAUSED, kha dung 0; het tam nghi -> binh thuong', async () => {
    const w = await world();
    // alice, bob la thanh vien bang; de goi API ho so ho phai la thanh vien khong gian
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId: w.wsId, userId: w.alice.id, role: 'MEMBER' },
        { workspaceId: w.wsId, userId: w.bob.id, role: 'MEMBER' },
      ],
    });
    const target = await newTarget(w.listId, { startDate: daysAgo(1), dueDate: daysAhead(5) });
    await mkCard(w.listId, { title: 'Viec dang lam', startDate: daysAgo(2), dueDate: daysAhead(3), members: [w.alice.id] });

    const cand = async (u: TestUser) => {
      const res = await suggest(w.owner, target.id);
      return (res.body.data.candidates as { user: { id: string }; load: number; capacity: number; flags: string[]; components: { availability: { value: number } } }[]).find((c) => c.user.id === u.id)!;
    };
    const before = await cand(w.alice);
    expect([before.load, before.capacity]).toEqual([1, 5]);
    expect(before.flags).not.toContain('OVERLOADED');

    expect((await putP(w.alice, w.wsId, { maxParallelCards: 1, pausedUntil: null })).status).toBe(200);
    const over = await cand(w.alice);
    expect([over.load, over.capacity]).toEqual([1, 1]);
    expect(over.flags).toContain('OVERLOADED');
    expect(over.components.availability.value).toBe(0);

    expect((await putP(w.bob, w.wsId, { maxParallelCards: 5, pausedUntil: daysAhead(10).toISOString() })).status).toBe(200);
    const paused = await cand(w.bob);
    expect(paused.flags).toContain('PAUSED');
    expect(paused.components.availability.value).toBe(0);

    // Het tam nghi (ngay da qua, truoc luc bat dau cua so cua the moi la now - 1 ngay) -> khong con co PAUSED
    expect((await putP(w.bob, w.wsId, { maxParallelCards: 5, pausedUntil: daysAgo(3).toISOString() })).status).toBe(200);
    expect((await cand(w.bob)).flags).not.toContain('PAUSED');
  });
});
