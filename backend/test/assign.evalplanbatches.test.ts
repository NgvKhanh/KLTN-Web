// Buoc 9a - lop 2: cat mot dot chia viec tu bo mo phong (evalPlanBatches.ts). HAM THUAN: khong cham CSDL.
import { describe, expect, it } from 'vitest';
import { LEGACY_WEIGHTS_V1 } from '../src/modules/assign/assign.score';
import { cutBatch, cutBatches, PLAN_BATCH_DAYS, PLAN_BATCH_K } from '../src/scripts/evalPlanBatches';
import { DEFAULT_SIM, generateSimulation, skillAt, type SimCard, type SimDataset } from '../src/scripts/simGenerator';

const SEED = 9401; // dev, ngoai 2001-2020 (lop 1) va 3001-3020 (lop 2)

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    Object.freeze(v);
    for (const x of Object.values(v as object)) deepFreeze(x);
  }
  return v;
}

/** Bo du lieu TU TAY dung (khong qua generateSimulation) de kiem soat tuyet doi assignedDay/dueDay - dung cho cac
 * bien va truong hop hoa ma du lieu ngau nhien khong the chac chan tao ra. */
function tinyCard(over: Partial<SimCard> & { key: string; assignedDay: number; dueDay: number }): SimCard {
  return {
    boardKey: 'b1',
    listIndex: 0,
    title: 't',
    description: '',
    topic: 0,
    secondTopic: null,
    ambiguous: false,
    createdDay: 0,
    assigneeKey: '',
    assignedByKey: '',
    done: false,
    completedDay: null,
    onTime: false,
    reopened: false,
    ...over,
  };
}

function tinyDataset(cards: SimCard[]): SimDataset {
  return {
    config: { ...DEFAULT_SIM, days: 200 },
    // Khoa CO Y de KHONG theo thu tu bang chu cai - kiem poolKeys phai tu sap xep, khong chi "giu nguyen thu tu nguon"
    people: ['p3', 'p1', 'p2'].map((key) => ({ key, name: key, email: `${key}@x.vn`, skills: [0.5], learning: [0], joinedDay: 0, leftDay: null, capacity: 5, horizonDays: 200 })),
    boards: [{ key: 'b1', name: 'B', themes: [0], startDay: 0, endDay: 200 }],
    cards,
  };
}

describe('cutBatch', () => {
  it('tra ve dung K the, ho boi >= 3 nguoi, khoa the la duy nhat', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: SEED });
    const batch = cutBatch(data, 90, 12)!;
    expect(batch).not.toBeNull();
    expect(batch.cards).toHaveLength(12);
    expect(new Set(batch.cards.map((c) => c.id)).size).toBe(12);
    expect(batch.poolKeys.length).toBeGreaterThanOrEqual(3);
    expect(new Set(batch.candidates.map((c) => c.userId))).toEqual(new Set(batch.poolKeys));
    expect(batch.poolKeys).toEqual([...batch.poolKeys].sort());
  });

  it('khong du K the (ngay qua xa lich su) -> null', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: SEED });
    expect(cutBatch(data, data.config.days + 1000, 12)).toBeNull();
  });

  it('ho boi DUNG 3 nguoi (bien) van hop le (< 3 moi bi loai, khong phai <= 3)', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: SEED, people: 3 });
    const day = 210; // du muon de ca 3 nguoi (ke ca nguoi vao sau) da tham gia, theo dung dinh nghia cua assignablePool
    expect(data.people.filter((p) => p.joinedDay <= day && (p.leftDay === null || p.leftDay > day))).toHaveLength(3);
    expect(cutBatch(data, day, 12)).not.toBeNull();
  });

  it('ho boi < 3 nguoi -> null (nhom qua nho)', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: SEED, people: 2 });
    expect(cutBatch(data, 90, 12)).toBeNull();
  });

  it('KHONG sua doi du lieu dau vao', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: SEED });
    const before = JSON.stringify(data);
    deepFreeze(data);
    expect(() => cutBatch(data, 90, 12)).not.toThrow();
    expect(JSON.stringify(data)).toBe(before);
  });

  it('tat dinh: cung (seed, day, k) cho ra dung cung mot ket qua', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: SEED });
    const a = cutBatch(data, 150, 12)!;
    const b = cutBatch(data, 150, 12)!;
    expect(JSON.stringify(a.cards)).toBe(JSON.stringify(b.cards));
    expect(JSON.stringify(a.candidates)).toBe(JSON.stringify(b.candidates));
    expect(a.ctx.now.getTime()).toBe(b.ctx.now.getTime());
    expect(a.ctx.groupOnTimeRate).toBe(b.ctx.groupOnTimeRate);
  });

  it('ghim bo trong so cua buoc 9 (LEGACY_WEIGHTS_V1, §17.6): so lieu da cong bo khong doi theo mac dinh moi cua san pham', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: SEED });
    expect(cutBatch(data, 90, 12)!.ctx.weights).toEqual(LEGACY_WEIGHTS_V1);
  });

  it('the gioi con lai (candidates) KHONG chua lich su/tai cua chinh cac the trong dot (khong ro ri)', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: SEED });
    const batch = cutBatch(data, 150, 12)!;
    const batchIds = new Set(batch.cards.map((c) => c.id));
    for (const c of batch.candidates) {
      for (const h of c.history) expect(batchIds.has(h.cardId)).toBe(false);
      for (const o of c.openCards) expect(batchIds.has(o.cardId)).toBe(false);
    }
  });

  it('the trong dot xep theo han gap truoc bang chinh do dai ke hoach goc (han - ngay giao goc), bat dau tu `day`', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: SEED });
    const day = 150;
    const batch = cutBatch(data, day, 12)!;
    const originals = new Map(data.cards.map((c) => [c.key, c]));
    for (const c of batch.cards) {
      const orig = originals.get(c.id)!;
      expect(orig.assignedDay).toBeGreaterThanOrEqual(day);
      const planned = Math.max(1, orig.dueDay - orig.assignedDay);
      // startDate la NUA DEM, dueDate la 23:59 cua ngay han -> hieu la `planned` ngay tron cong them ~23h59 (floor, khong round)
      const gotDays = Math.floor((c.dueDate!.getTime() - c.startDate!.getTime()) / 86_400_000);
      expect(gotDays).toBe(planned);
    }
  });

  it('lay K the SOM NHAT (assignedDay be nhat) trong so cac the con lai tu ngay `day`, khong phai K the cuoi cung', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: SEED });
    const day = 150;
    const batch = cutBatch(data, day, 12)!;
    const batchIds = new Set(batch.cards.map((c) => c.id));
    const eligible = data.cards.filter((c) => c.assignedDay >= day);
    const maxAssignedDayInBatch = Math.max(...eligible.filter((c) => batchIds.has(c.key)).map((c) => c.assignedDay));
    const minAssignedDayOutside = Math.min(
      ...eligible.filter((c) => !batchIds.has(c.key)).map((c) => c.assignedDay),
      Infinity
    );
    // Khong the nao NGOAI dot co assignedDay be hon the TRONG dot (dot la K the som nhat, khong phai K the cuoi)
    expect(minAssignedDayOutside).toBeGreaterThanOrEqual(maxAssignedDayInBatch);
  });

  it('skillOf khop voi skillAt cong khai; bestSkill la max tren ca ho boi', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: SEED });
    const batch = cutBatch(data, 150, 12)!;
    const peopleByKey = new Map(data.people.map((p) => [p.key, p]));
    const card = batch.cards[0]!;
    const origCard = data.cards.find((c) => c.key === card.id)!;
    for (const key of batch.poolKeys) {
      expect(batch.skillOf(key, card.id)).toBeCloseTo(skillAt(peopleByKey.get(key)!, origCard.topic, 150), 12);
    }
    const best = Math.max(...batch.poolKeys.map((k) => batch.skillOf(k, card.id)));
    expect(batch.bestSkill(card.id)).toBeCloseTo(best, 12);
  });

  it('skillOf nem loi voi nguoi hoac the ngoai dot', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: SEED });
    const batch = cutBatch(data, 150, 12)!;
    expect(() => batch.skillOf('khong-ton-tai', batch.cards[0]!.id)).toThrow();
    expect(() => batch.skillOf(batch.poolKeys[0]!, 'the-khong-ton-tai')).toThrow();
  });

  it('tu choi tham so sai: day am/khong nguyen, k < 1/khong nguyen', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: SEED });
    expect(() => cutBatch(data, -1, 12)).toThrow(RangeError);
    expect(() => cutBatch(data, 1.5, 12)).toThrow(RangeError);
    expect(() => cutBatch(data, 90, 0)).toThrow(RangeError);
    expect(() => cutBatch(data, 90, 1.5)).toThrow(RangeError);
  });
});

describe('cutBatch - du lieu tu tay (kiem soat tuyet doi assignedDay/dueDay, ho boi co chu dinh)', () => {
  // a,b CUNG ngay 100 (b hoa a qua khoa); c ngay 101 (sau). a co dueDay = assignedDay (khoang = 0, thu clamp toi thieu 1 ngay).
  const data = tinyDataset([
    tinyCard({ key: 'a', assignedDay: 100, dueDay: 100 }),
    tinyCard({ key: 'b', assignedDay: 100, dueDay: 105 }),
    tinyCard({ key: 'c', assignedDay: 101, dueDay: 110 }),
  ]);
  const batch = cutBatch(data, 100, 3)!;

  it('the DUNG BANG `day` (khong chi lon hon) van duoc tinh; hoa ngay thi theo khoa tang dan; roi theo ngay', () => {
    expect(batch).not.toBeNull();
    expect(batch.cards.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('do dai ke hoach toi thieu 1 ngay (khoang = 0 duoc KEP LEN 1, khong phai 0 hay 2)', () => {
    const a = batch.cards.find((c) => c.id === 'a')!;
    const spanDays = Math.floor((a.dueDate!.getTime() - a.startDate!.getTime()) / 86_400_000);
    expect(spanDays).toBe(1);
  });

  it('poolKeys LUON sap xep tang dan, du thu tu nguoi trong bo du lieu nguon la gi', () => {
    expect(batch.poolKeys).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('cutBatches', () => {
  it('bo qua ngay khong cat duoc, giu dung thu tu cac ngay con lai', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: SEED });
    const days = [90, data.config.days + 1000, 210];
    const batches = cutBatches(data, days, 12);
    expect(batches.map((b) => b.day)).toEqual([90, 210]);
  });

  it('tung dot khop voi goi cutBatch rieng le (cung du lieu)', () => {
    const data = generateSimulation({ ...DEFAULT_SIM, seed: SEED });
    const batches = cutBatches(data, PLAN_BATCH_DAYS, PLAN_BATCH_K);
    for (const b of batches) {
      const single = cutBatch(data, b.day, PLAN_BATCH_K)!;
      expect(JSON.stringify(b.cards)).toBe(JSON.stringify(single.cards));
    }
  });
});
