// Buoc 5 - DOI CHIEU duong CSDL voi duong bo nho. Nap bo mo phong vao Postgres bang seedSimulation, cham qua
// suggestForCard (doc CSDL that: assign.repo -> assign.snapshot -> assign.score), roi so TUNG CON SO voi duong bo nho da
// duoc kiem o buoc 4b (snapshotAsOf + rankCandidates). Hai duong di qua CUNG bo cham, chi khac o cho lay du lieu:
// neu tang doc CSDL lam meo bat ky thu gi (bo sot bang da luu tru, dem nham the, lech mo lai...) thi test nay vo.
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { DEFAULT_WEIGHTS, rankCandidates } from '../src/modules/assign/assign.score';
import { suggestForCard, type SuggestionResult } from '../src/modules/assign/assign.service';
import { DEFAULT_SIM, generateSimulation, type SimCard } from '../src/scripts/simGenerator';
import { snapshotAsOf } from '../src/scripts/simReplay';
import { seedSimulation, simDayToDate, vnToday, type SeedResult } from '../src/scripts/simSeed';

// simReplay chup "hom nay" MOT LAN luc nap module: dung cung moc de hai duong quy doi ngay giong nhau
const TODAY = vnToday();
const data = generateSimulation(DEFAULT_SIM);
const at = (d: number, h = 0, m = 0) => simDayToDate(TODAY, data.config.days, d, h, m);
const capacityOf = new Map(data.people.map((p) => [p.key, p.capacity]));

function invert(record: Record<string, string>): Map<string, string> {
  return new Map(Object.entries(record).map(([key, id]) => [id, key]));
}

/** So sanh mot ket qua CSDL voi duong bo nho tai cung `now` va cung ho boi. */
async function compareOne(seed: SeedResult, ownerId: string, c: SimCard, now: Date, day: number, hour: number) {
  const userKey = invert(seed.userIds);
  const cardKey = invert(seed.cardIds);

  const db: SuggestionResult = await suggestForCard(ownerId, seed.cardIds[c.key]!, now);
  const pool = db.candidates.map((x) => ({ key: userKey.get(x.user.id)!, capacity: capacityOf.get(userKey.get(x.user.id)!)! }));
  const ref = snapshotAsOf(data, day, hour, pool, c.key);
  const ranked = rankCandidates(
    { id: c.key, title: c.title, description: c.description, startDate: at(c.assignedDay), dueDate: at(c.dueDay, 23, 59) },
    ref.candidates,
    // Cau hinh san pham tu buoc 16: mac dinh moi (co Ho so) + thieu du lieu theo thanh phan (mac dinh cua bo cham = cua dich vu)
    { idf: ref.idf, now: ref.now, groupOnTimeRate: ref.mu, weights: DEFAULT_WEIGHTS }
  );

  expect(db.groupOnTimeRate).toBe(ref.mu);
  expect(db.candidates.length).toBe(ranked.length);
  const refByKey = new Map(ranked.map((r) => [r.userId, r]));
  for (const got of db.candidates) {
    const key = userKey.get(got.user.id)!;
    const want = refByKey.get(key)!;
    const label = `${c.key} / ${key}`;
    expect(got.score, label).toBe(want.score);
    expect(got.rawScore, label).toBe(want.rawScore);
    expect(got.confidence, label).toBe(want.confidence);
    expect(got.confidenceLevel, label).toBe(want.confidenceLevel);
    expect(got.components, label).toEqual(want.components);
    expect(want.components.declared.value, label).toBeNull(); // bo mo phong khong ai khai ho so
    expect([got.load, got.capacity, got.fit, got.evidenceMass], label).toEqual([want.load, want.capacity, want.fit, want.evidenceMass]);
    expect(want.flags, label).toContain('NO_PROFILE');
    expect(got.flags, label).toEqual(want.flags);
    // Bang chung: cung the (doi id CSDL -> khoa bo sinh), cung do giong / trong so / ket qua, tieu de hien du (chu bang xem het)
    expect(
      got.evidence.map((e) => ({ card: cardKey.get(e.cardId), title: e.title, sim: e.sim, weight: e.weight, outcome: e.outcome, completedAt: e.completedAt, dueDate: e.dueDate })),
      label
    ).toEqual(
      want.evidence.map((e) => ({ card: e.cardId, title: e.title, sim: e.sim, weight: e.weight, outcome: e.outcome, completedAt: e.completedAt, dueDate: e.dueDate }))
    );
  }
  // Thu tu xep hang theo diem giong nhau (hoa diem co the doi cho vi khoa bo sinh va id CSDL sap xep khac nhau)
  expect(db.candidates.map((x) => x.score)).toEqual(ranked.map((r) => r.score));
  return { db, ranked };
}

describe('Buoc 5 - duong CSDL == duong bo nho tren bo mo phong', () => {
  it('the DANG MO hom nay (12:00): tung diem, tung thanh phan, tung bang chung khop het; co the that su chiem tai', async () => {
    const seed = await seedSimulation(prisma, data, { today: TODAY });
    const ownerId = seed.userIds[data.people[0]!.key]!;
    const today = data.config.days;

    let checked = 0;
    let withLoad = 0;
    let withEvidence = 0;
    for (const c of data.cards) {
      if (c.done) continue;
      const { db } = await compareOne(seed, ownerId, c, at(today, 12), today, 12);
      checked += 1;
      if (db.candidates.some((x) => x.load > 0)) withLoad += 1;
      if (db.candidates.some((x) => x.evidence.length > 0)) withEvidence += 1;
      expect(db.candidates.length).toBeGreaterThanOrEqual(2);
    }
    expect(checked).toBeGreaterThan(5);
    expect(withLoad).toBeGreaterThan(0); // khong phai so sanh hai ket qua "khong ai ban"
    expect(withEvidence).toBe(checked);
  }, 120_000);

  it('PHAT LAI qua khu (10:00 luc giao viec, ~15 the): DB o hien tai nhung `now` lui ve qua khu van cho cung ket qua', async () => {
    const seed = await seedSimulation(prisma, data, { today: TODAY });
    const ownerId = seed.userIds[data.people[0]!.key]!;

    let checked = 0;
    let anyHistory = 0;
    for (const [i, c] of data.cards.entries()) {
      if (i % 7 !== 0 || c.assignedDay < 60) continue;
      const { db } = await compareOne(seed, ownerId, c, at(c.assignedDay, 10), c.assignedDay, 10);
      checked += 1;
      if (db.candidates.some((x) => x.evidence.length > 0)) anyHistory += 1;
    }
    expect(checked).toBeGreaterThan(10);
    expect(anyHistory).toBeGreaterThan(8);
  }, 120_000);
});
