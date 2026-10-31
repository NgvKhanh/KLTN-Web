// Buoc 16 - CSDL + dich vu cua thanh phan "Ho so" (ASSIGN_MODULE.md §17.8): nang cap trong so cu KHI DOC, ho so tu khai that vao
// bo cham (goi y + chia viec), nhat ky khong chep chu, hoc trong so Ho so tu dau den cuoi, xoa tai khoan xoa ho so. Can DB test.
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { parseWorkItems, weightsOfRow } from '../src/modules/assign/assign.repo';
import { weightsSchema } from '../src/modules/assign/assign.schema';
import { DEFAULT_WEIGHTS } from '../src/modules/assign/assign.score';
import { ALGORITHM_VERSION } from '../src/modules/assign/assign.service';
import { isDefaultWeights, upgradeLegacyWeights, weightIssues } from '../src/modules/assign/assign.weights';
import { makeDirectUser } from './helpers';
import {
  TITLE_TARGET,
  assign,
  candOf,
  getW,
  giveHistory,
  newTarget,
  postOutcome,
  putW,
  suggest,
  W,
  world,
  wsWorld,
} from './assignFixtures';

const close = (a: number, b: number) => Math.abs(a - b) < 1e-12;

describe('weightsOfRow / parseWorkItems (ham thuan cua tang du lieu)', () => {
  it('co wDeclared -> giu nguyen; null + bo ba hop le -> NANG CAP; null + bo ba hong -> Ho so NaN (dich vu lui ve mac dinh)', () => {
    expect(weightsOfRow({ wExperience: 0.4, wReliability: 0.3, wAvailability: 0.2, wDeclared: 0.1 })).toEqual({ experience: 0.4, reliability: 0.3, availability: 0.2, declared: 0.1 });
    expect(weightsOfRow({ wExperience: 0.45, wReliability: 0.3, wAvailability: 0.25, wDeclared: null })).toEqual(DEFAULT_WEIGHTS);
    const up = weightsOfRow({ wExperience: 0.5, wReliability: 0.3, wAvailability: 0.2, wDeclared: null });
    expect(up).toEqual(upgradeLegacyWeights({ experience: 0.5, reliability: 0.3, availability: 0.2 }));
    const bad = weightsOfRow({ wExperience: 0.9, wReliability: 0.9, wAvailability: 0.9, wDeclared: null });
    expect(Number.isNaN(bad.declared)).toBe(true);
    expect(weightIssues(bad).length).toBeGreaterThan(0);
  });

  it('parseWorkItems: lay muc co tieu de chuoi; mo ta khong phai chuoi -> null; phan tu hong / khong phai mang -> bo', () => {
    expect(parseWorkItems([{ title: 'A', description: 'x' }, { title: 'B', description: 5 }, { title: 3 }, null, 'y', { description: 'z' }])).toEqual([
      { title: 'A', description: 'x' },
      { title: 'B', description: null },
    ]);
    for (const bad of [null, {}, 'x', 7]) expect(parseWorkItems(bad)).toEqual([]);
  });
});

describe('trong so 4 khoa qua API', () => {
  it('ALGORITHM_VERSION ghi ro cach xu ly thieu du lieu theo thanh phan', () => {
    expect(ALGORITHM_VERSION).toBe('knn-tfidf-v2/minmax/drop+decl-neutral');
  });

  it('PUT kieu CU (ba khoa, giao dien truoc buoc 18) -> 400; zod bao THIEU KHOA declared (loi kieu), khong phai loi tong', async () => {
    const parsed = weightsSchema.safeParse({ experience: 0.45, reliability: 0.3, availability: 0.25 });
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues.map((i) => [i.code, i.path.join('.')])).toEqual([['invalid_type', 'declared']]);
    const w = await wsWorld();
    const res = await putW(w.owner, w.wsId, { experience: 0.45, reliability: 0.3, availability: 0.25 } as unknown as typeof DEFAULT_WEIGHTS);
    expect(res.status).toBe(400);
    expect(await prisma.workspaceAssignWeights.count()).toBe(0);
  });

  it('dong CU (wDeclared null) duoc NANG CAP khi doc - khong sua CSDL cho toi lan ghi ke tiep; dong mac dinh cu = dung mac dinh moi', async () => {
    const w = await wsWorld();
    await prisma.workspaceAssignWeights.create({ data: { workspaceId: w.wsId, wExperience: 0.5, wReliability: 0.3, wAvailability: 0.2 } });
    const res = await getW(w.member, w.wsId);
    const got = res.body.data.weights as typeof DEFAULT_WEIGHTS;
    const want = upgradeLegacyWeights({ experience: 0.5, reliability: 0.3, availability: 0.2 });
    for (const k of ['experience', 'reliability', 'availability', 'declared'] as const) expect(close(got[k], want[k]), k).toBe(true);
    expect(res.body.data.custom).toBe(true);
    expect((await prisma.workspaceAssignWeights.findUniqueOrThrow({ where: { workspaceId: w.wsId } })).wDeclared).toBeNull();
    // Mot lan ghi -> du bon cot
    expect((await putW(w.owner, w.wsId, W(0.4, 0.3, 0.2, 0.1))).status).toBe(200);
    expect((await prisma.workspaceAssignWeights.findUniqueOrThrow({ where: { workspaceId: w.wsId } })).wDeclared).toBe(0.1);

    const w2 = await wsWorld();
    await prisma.workspaceAssignWeights.create({ data: { workspaceId: w2.wsId } }); // cot mac dinh cu 0,45 / 0,30 / 0,25
    const d = await getW(w2.owner, w2.wsId);
    expect(d.body.data.weights).toEqual(DEFAULT_WEIGHTS);
    expect(d.body.data.custom).toBe(false);

    // Dong cu HONG (sua tay): GET tra mac dinh (khong NaN / null)
    const w3 = await wsWorld();
    await prisma.workspaceAssignWeights.create({ data: { workspaceId: w3.wsId, wExperience: 0.9, wReliability: 0.9, wAvailability: 0.9 } });
    const g = await getW(w3.owner, w3.wsId);
    expect(g.body.data.weights).toEqual(DEFAULT_WEIGHTS);
    expect(g.body.data.custom).toBe(false);
  });

  it('dong trong so HONG khong lam hong viec hoc: hoc tu mac dinh, ket qua hop le, ghi du bon cot', async () => {
    const w = await world();
    const target = await newTarget(w.listId);
    await giveHistory(w.listId, w.alice.id);
    await giveHistory(w.listId, w.bob.id, ['Thiet ke giao dien dang nhap']);
    await prisma.workspaceAssignWeights.create({ data: { workspaceId: w.wsId, wExperience: 0.9, wReliability: 0.9, wAvailability: 0.9, feedbackCount: 12 } });
    const res = await suggest(w.owner, target.id);
    const top = res.body.data.candidates[0].user.id as string;
    const other = top === w.alice.id ? w.bob : w.alice;
    await assign(w.owner, target.id, other.id);
    const out = await postOutcome(w.owner, res.body.data.runId, { chosenUserId: other.id });
    expect(out.status).toBe(200);
    expect(weightIssues(out.body.data.weights)).toEqual([]);
    const row = await prisma.workspaceAssignWeights.findUniqueOrThrow({ where: { workspaceId: w.wsId } });
    expect(row.wDeclared).not.toBeNull();
    expect(weightIssues(weightsOfRow(row))).toEqual([]);
  });
});

describe('ho so tu khai THAT vao bo cham', () => {
  async function setup() {
    const w = await world();
    const target = await newTarget(w.listId); // TITLE_TARGET = 'Thiet ke giao dien quen mat khau'
    await giveHistory(w.listId, w.alice.id); // alice xep dau nho lich su
    await prisma.userAssignProfile.create({
      data: {
        userId: w.bob.id,
        skillsText: 'giao dien quen mat khau, docker',
        workItems: [{ id: 'x', title: 'Thiet ke man hinh dang nhap', description: 'giao dien' }],
        cvText: 'Kinh nghiem: thiet ke giao dien quen mat khau cho ung dung ngan hang',
      },
    });
    await prisma.userAssignProfile.create({ data: { userId: w.alice.id, skillsText: 'kiem thu tu dong, bao cao' } });
    return { w, target };
  }

  it('goi y: nguoi khai khop co gia tri Ho so + bang chung (cum ky nang / tieu de cong viec; muc CV KHONG lo chu); khong khai -> null', async () => {
    const { w, target } = await setup();
    const res = await suggest(w.owner, target.id);
    expect(res.status).toBe(200);
    const bob = candOf(res.body, w.bob);
    const alice = candOf(res.body, w.alice);
    const owner = candOf(res.body, w.owner);
    expect(bob.components.declared.value).toBeGreaterThan(0.5);
    expect(bob.declaredEvidence).toContainEqual(expect.objectContaining({ kind: 'SKILL', itemId: 'skill:0', title: 'giao dien quen mat khau' }));
    const sims = bob.declaredEvidence.map((e) => e.sim);
    expect(sims).toEqual([...sims].sort((a, b) => b - a));
    expect(bob.components.declared.value).toBe(sims[0]); // gia tri = muc giong nhat
    expect(bob.declaredEvidence.map((e) => e.kind)).toContain('CV');
    expect(bob.declaredEvidence.filter((e) => e.kind === 'CV').every((e) => e.title === null)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('ngan hang'); // chu trong CV khong bao gio ra phan hoi
    expect(alice.components.declared.value).toBe(0); // co khai nhung khong khop
    expect(owner.components.declared.value).toBeNull(); // khong khai
    // NEUTRAL: nguoi khong khai nhan trung binh (khong phai 0) o thanh phan Ho so
    expect(owner.components.declared.scaled).toBeCloseTo(((bob.components.declared.scaled ?? 0) + (alice.components.declared.scaled ?? 0)) / 2, 12);
    expect(owner.flags).toContain('NO_PROFILE'); // buoc 18: co ra API
    expect(bob.flags).not.toContain('NO_PROFILE');
    expect(alice.flags).not.toContain('NO_PROFILE'); // co khai (du khong khop) -> khong phai NO_PROFILE
    expect(res.body.data.weights).toEqual({ ...DEFAULT_WEIGHTS, custom: false });
  });

  it('tat "dung cho goi y" -> coi nhu khong khai; nhat ky AssignRun ghi thanh phan Ho so + bang chung KHONG kem chu', async () => {
    const { w, target } = await setup();
    const on = await suggest(w.owner, target.id);
    const run = await prisma.assignRun.findUniqueOrThrow({ where: { id: on.body.data.runId } });
    expect(run.algorithmVersion).toBe(ALGORITHM_VERSION);
    const logged = run.candidates as { userId: string; components: Record<string, { value: number | null }>; declaredEvidence: Record<string, unknown>[]; flags: string[] }[];
    const lb = logged.find((c) => c.userId === w.bob.id)!;
    expect(lb.components.declared!.value).toBeGreaterThan(0.5);
    expect(lb.declaredEvidence.length).toBeGreaterThan(0);
    for (const e of lb.declaredEvidence) expect(Object.keys(e).sort()).toEqual(['itemId', 'kind', 'sim']);
    expect(JSON.stringify(run.candidates)).not.toContain('giao dien quen mat khau');
    expect(logged.find((c) => c.userId === w.owner.id)!.flags).toContain('NO_PROFILE');

    await prisma.userAssignProfile.update({ where: { userId: w.bob.id }, data: { useForAssign: false } });
    const off = await suggest(w.owner, target.id);
    expect(candOf(off.body, w.bob).components.declared.value).toBeNull();
    expect(candOf(off.body, w.bob).declaredEvidence).toEqual([]);
  });

  it('HOC tu dau den cuoi: Ho so dua nguoi khai khop (chua co lich su) len dau; giao cho nguoi co lich su -> trong so Ho so GIAM, thanh phan lich su (ngoai S) giu nguyen', async () => {
    const { w, target } = await setup();
    await prisma.workspaceAssignWeights.create({ data: { workspaceId: w.wsId, feedbackCount: 12 } });
    const res = await suggest(w.owner, target.id);
    // Voi mac dinh moi, ho so khop du keo bob (chua co lich su) len tren alice (co lich su)
    expect(res.body.data.candidates[0].user.id).toBe(w.bob.id);
    await assign(w.owner, target.id, w.alice.id);
    const out = await postOutcome(w.owner, res.body.data.runId, { chosenUserId: w.alice.id });
    expect(out.body.data.learning).toEqual({ learned: true, reason: 'LEARNED' });
    const next = out.body.data.weights as typeof DEFAULT_WEIGHTS;
    expect(next.declared).toBeLessThan(DEFAULT_WEIGHTS.declared);
    // S = {kha dung, Ho so} (bob khong co kinh nghiem / tin cay): hai thanh phan lich su khong bi dong toi
    expect([next.experience, next.reliability]).toEqual([DEFAULT_WEIGHTS.experience, DEFAULT_WEIGHTS.reliability]);
    expect(weightIssues(next)).toEqual([]);
    expect(isDefaultWeights(next)).toBe(false);
    const row = await prisma.workspaceAssignWeights.findUniqueOrThrow({ where: { workspaceId: w.wsId } });
    expect(row.wDeclared).toBe(next.declared);
    const hist = await prisma.assignWeightHistory.findMany();
    expect(hist).toHaveLength(1);
    expect(hist[0]!.wDeclared).toBe(next.declared);
  });

  it('xoa tai khoan -> ho so tu khai bi xoa theo (Cascade)', async () => {
    const u = await makeDirectUser('Xoa');
    await prisma.userAssignProfile.create({ data: { userId: u.id, skillsText: 'x' } });
    expect(await prisma.userAssignProfile.count({ where: { userId: u.id } })).toBe(1);
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.userAssignProfile.count({ where: { userId: u.id } })).toBe(0);
  });

  it('chia viec (lop 2) cung nap ho so: nguoi duoc chon mang thanh phan Ho so', async () => {
    const { w } = await setup();
    const res = await (await import('./helpers')).agent().post(`/api/lists/${w.listId}/assignment-plan`).set('Cookie', w.owner.cookie).send({});
    expect(res.status).toBe(200);
    const row = res.body.data.rows.find((r: { card: { title: string } }) => r.card.title === TITLE_TARGET);
    // Nhu goi y mot the: ho so khop keo bob len dau - lop 2 phai nap cung ho so
    expect(row.assignee.user.id).toBe(w.bob.id);
    expect(row.assignee.components.declared.value).toBeGreaterThan(0.5);
    expect(row.ranking[0].userId).toBe(w.bob.id);
  });
});
