// Buoc 4 module canh bao tre han (RISK_MODULE.md §7): bo mo phong vong doi the + anh chup qua khu. Test THUAN.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DAY_MS, type RiskCardHistory, type RiskStatus } from '../src/modules/risk/risk.history';
import { buildRiskContext, extractFeatures } from '../src/modules/risk/risk.features';
import {
  CONFIRM_SEEDS,
  DEV_SEEDS,
  RISK_SIM_START,
  TRAIN_SEEDS,
  generateRiskWorld,
  summarizeWorld,
} from '../src/scripts/riskSim';
import { completionAfter, computePriors, hashRows, labelAt, snapshotTimes, snapshotsOfWorld } from '../src/scripts/riskSnapshots';

describe('bộ mô phỏng vòng đời thẻ', () => {
  it('tất định: cùng hạt giống → cùng thế giới; khác hạt giống → khác', () => {
    expect(generateRiskWorld(6001)).toEqual(generateRiskWorld(6001));
    expect(JSON.stringify(generateRiskWorld(6001))).not.toBe(JSON.stringify(generateRiskWorld(6002)));
  });

  it('ĐÓNG BĂNG: mã băm 3 thế giới đầu không đổi (đổi bộ mô phỏng = phải học + đánh giá lại)', () => {
    const h = createHash('sha256');
    for (const s of [6001, 6002, 6003]) h.update(JSON.stringify(generateRiskWorld(s)));
    expect(h.digest('hex')).toBe('25cb2078072ef28982204992ceafe3a4a77137bed06b26740177758e952319bd');
  });

  it('ba dải hạt giống không giao nhau, mỗi dải đúng số lượng', () => {
    expect(TRAIN_SEEDS).toHaveLength(40);
    expect(DEV_SEEDS).toHaveLength(20);
    expect(CONFIRM_SEEDS).toHaveLength(20);
    const all = new Set([...TRAIN_SEEDS, ...DEV_SEEDS, ...CONFIRM_SEEDS]);
    expect(all.size).toBe(80);
  });

  it('hạt giống không hợp lệ → RangeError', () => {
    expect(() => generateRiskWorld(-1)).toThrow(RangeError);
    expect(() => generateRiskWorld(1.5)).toThrow(RangeError);
  });

  describe.each([6001, 6017, 6105, 6219])('bất biến dữ liệu quan sát được (hạt giống %i)', (seed) => {
    const w = generateRiskWorld(seed);
    const now = w.now.getTime();
    const sorted = (xs: readonly Date[]) => xs.every((x, i) => i === 0 || xs[i - 1]!.getTime() <= x.getTime());

    it('chuỗi trạng thái liền mạch, khớp trạng thái cuối và completedAt', () => {
      for (const c of w.cards) {
        expect(sorted(c.statusEvents.map((e) => e.at)), c.id).toBe(true);
        let cur: RiskStatus = 'TODO';
        for (const e of c.statusEvents) {
          expect(e.from, c.id).toBe(cur);
          expect(e.to).not.toBe(e.from);
          cur = e.to;
        }
        expect(c.status, c.id).toBe(cur);
        const lastDone = c.statusEvents.filter((e) => e.to === 'DONE').at(-1)?.at ?? null;
        expect(c.completedAt, c.id).toEqual(c.status === 'DONE' ? lastDone : null);
      }
    });

    it('chuỗi hạn liền mạch, hạn hiện tại = lần đổi cuối', () => {
      for (const c of w.cards) {
        expect(c.dueDate).not.toBeNull();
        for (let i = 1; i < c.dueEvents.length; i += 1) expect(c.dueEvents[i]!.from).toEqual(c.dueEvents[i - 1]!.to);
        if (c.dueEvents.length > 0) expect(c.dueDate).toEqual(c.dueEvents.at(-1)!.to);
        expect(c.dueEvents.length).toBeLessThanOrEqual(2);
        for (const e of c.dueEvents) expect(e.to!.getTime()).toBeGreaterThan(e.from!.getTime());
      }
    });

    it('checklist: isDone ↔ có mốc tick, mốc trong [tạo, bây giờ]; thẻ xong thì tick hết', () => {
      for (const c of w.cards) {
        for (const it of c.checklist) {
          expect(it.isDone).toBe(it.completedAt !== null);
          if (it.completedAt) {
            expect(it.completedAt.getTime()).toBeGreaterThanOrEqual(c.createdAt.getTime());
            expect(it.completedAt.getTime()).toBeLessThanOrEqual(now);
          }
        }
        if (c.status === 'DONE') expect(c.checklist.every((i) => i.isDone), c.id).toBe(true);
      }
    });

    it('mọi mốc nằm trong [bắt đầu thế giới, bây giờ], không trước lúc tạo thẻ; nhật ký sắp tăng', () => {
      for (const c of w.cards) {
        expect(c.createdAt.getTime()).toBeGreaterThanOrEqual(RISK_SIM_START);
        expect(sorted(c.activityAt)).toBe(true);
        for (const t of [...c.activityAt, ...c.statusEvents.map((e) => e.at), ...c.dueEvents.map((e) => e.at), ...c.members.map((m) => m.createdAt)]) {
          expect(t.getTime(), c.id).toBeGreaterThanOrEqual(c.createdAt.getTime());
          expect(t.getTime(), c.id).toBeLessThanOrEqual(now);
        }
        expect(new Set(c.members.map((m) => m.userId)).size).toBe(c.members.length);
      }
    });

    it('story point thuộc thang 1/2/3/5/8 hoặc null; phần ẩn không lọt vào thẻ', () => {
      for (const c of w.cards) {
        expect([null, 1, 2, 3, 5, 8]).toContain(c.storyPoints);
        expect(Object.keys(c).sort()).toEqual(
          ['activityAt', 'checklist', 'completedAt', 'createdAt', 'description', 'dueDate', 'dueEvents', 'id', 'members', 'startDate', 'status', 'statusEvents', 'storyPoints', 'title'].sort()
        );
      }
    });
  });

  it('người "dồn tick cuối" không tick mục nào trước lúc làm xong', () => {
    let checked = 0;
    for (const seed of TRAIN_SEEDS.slice(0, 8)) {
      const w = generateRiskWorld(seed);
      const batch = new Set(w.people.filter((p) => p.batchTicker).map((p) => p.id));
      for (const c of w.cards) {
        if (c.status !== 'DONE' || c.checklist.length === 0 || c.members.length !== 1 || !batch.has(c.members[0]!.userId)) continue;
        const firstWorkEnd = c.statusEvents.find((e) => e.to === 'IN_REVIEW' || e.to === 'DONE')!.at.getTime();
        for (const it of c.checklist) expect(it.completedAt!.getTime()).toBeGreaterThanOrEqual(firstWorkEnd - 60 * 60_000);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('tỉ lệ trên 40 thế giới học: ~40% không có điểm, ~30% không có checklist, trễ trung bình 25–40%, có bị chặn và lùi hạn', () => {
    const s = TRAIN_SEEDS.map((x) => summarizeWorld(generateRiskWorld(x)));
    const total = (k: keyof (typeof s)[0]) => s.reduce((a, r) => a + (r[k] as number), 0);
    expect(1 - total('withPoints') / total('cards')).toBeGreaterThan(0.35);
    expect(1 - total('withPoints') / total('cards')).toBeLessThan(0.45);
    expect(1 - total('withChecklist') / total('cards')).toBeGreaterThan(0.25);
    expect(1 - total('withChecklist') / total('cards')).toBeLessThan(0.35);
    const late = total('lateRate') / s.length;
    expect(late).toBeGreaterThan(0.25);
    expect(late).toBeLessThan(0.4);
    expect(total('blocked')).toBeGreaterThan(100);
    expect(total('postponed')).toBeGreaterThan(100);
  });
});

// ---------- Anh chup qua khu ----------
const T0 = Date.parse('2026-03-01T00:00:00.000Z');
const day = (d: number) => new Date(T0 + d * DAY_MS);
function card(over: Partial<RiskCardHistory> & { id: string }): RiskCardHistory {
  return {
    title: over.id, description: null, createdAt: day(0), startDate: null, dueDate: null, status: 'TODO', completedAt: null,
    storyPoints: null, members: [], statusEvents: [], dueEvents: [], checklist: [], activityAt: [], ...over,
  };
}

describe('nhãn và mốc ảnh chụp', () => {
  const done = (d: number) => [{ at: day(1), from: 'TODO' as const, to: 'IN_PROGRESS' as const }, { at: day(d), from: 'IN_PROGRESS' as const, to: 'DONE' as const }];

  it('nhãn: xong trước / đúng / sau hạn lúc t', () => {
    expect(labelAt(card({ id: 'a', dueDate: day(10), status: 'DONE', completedAt: day(9), statusEvents: done(9) }), day(5), day(30))).toBe(0);
    expect(labelAt(card({ id: 'b', dueDate: day(10), status: 'DONE', completedAt: day(10), statusEvents: done(10) }), day(5), day(30))).toBe(0);
    expect(labelAt(card({ id: 'c', dueDate: day(10), status: 'DONE', completedAt: day(11), statusEvents: done(11) }), day(5), day(30))).toBe(1);
  });

  it('nhãn theo hạn LÚC t: lùi hạn sau t rồi xong trước hạn mới vẫn là trễ', () => {
    const c = card({ id: 'p', dueDate: day(15), status: 'DONE', completedAt: day(12), statusEvents: done(12), dueEvents: [{ at: day(9), from: day(10), to: day(15) }] });
    expect(labelAt(c, day(7), day(30))).toBe(1);
    expect(labelAt(c, day(9.5), day(30))).toBe(0);
  });

  it('chưa xong tới cuối dữ liệu: hạn đã qua → trễ; hạn còn ở sau → chưa biết', () => {
    expect(labelAt(card({ id: 'o', dueDate: day(10) }), day(5), day(30))).toBe(1);
    expect(labelAt(card({ id: 'o2', dueDate: day(40) }), day(35), day(30))).toBeNull();
    expect(labelAt(card({ id: 'x', dueDate: day(10), status: 'DONE', completedAt: day(31), statusEvents: done(31) }), day(5), day(30))).toBe(1);
    // xong sau cuoi du lieu, han cung o sau cuoi du lieu -> luc "bay gio" chua biet ket qua
    expect(labelAt(card({ id: 'x2', dueDate: day(35), status: 'DONE', completedAt: day(33), statusEvents: done(33) }), day(29), day(30))).toBeNull();
    expect(labelAt(card({ id: 'n' }), day(5), day(30))).toBeNull();
  });

  it('completionAfter: lần xong đầu tiên sau t (kể cả khi sau đó mở lại); không nhật ký → completedAt', () => {
    const reopened = card({ id: 'r', status: 'DONE', completedAt: day(9), statusEvents: [{ at: day(4), from: 'TODO', to: 'DONE' }, { at: day(5), from: 'DONE', to: 'IN_PROGRESS' }, { at: day(9), from: 'IN_PROGRESS', to: 'DONE' }] });
    expect(completionAfter(reopened, day(3))).toEqual(day(4));
    expect(completionAfter(reopened, day(4))).toEqual(day(9)); // xong DUNG luc t khong phai "sau t"
    expect(completionAfter(reopened, day(4.5))).toEqual(day(9));
    expect(completionAfter(card({ id: 'b', status: 'DONE', completedAt: day(6) }), day(3))).toEqual(day(6));
    expect(completionAfter(card({ id: 'b2', status: 'DONE', completedAt: day(2) }), day(3))).toBeNull();
  });

  it('mốc ảnh chụp: đúng h ngày trước hạn có hiệu lực, trên từng khoảng của mỗi giá trị hạn', () => {
    const c = card({ id: 'm', createdAt: day(0), dueDate: day(15), dueEvents: [{ at: day(9), from: day(10), to: day(15) }] });
    // han 10 hieu luc [0, 9): moc 7 -> ngay 3, moc 3 -> ngay 7, moc 1 -> ngay 9 (KHONG: luc do han da la 15)
    // han 15 hieu luc [9, ...): moc 7 -> 8 (truoc khoang), moc 3 -> 12, moc 1 -> 14
    expect(snapshotTimes(c, 7, day(30))).toEqual([day(3)]);
    expect(snapshotTimes(c, 3, day(30))).toEqual([day(7), day(12)]);
    expect(snapshotTimes(c, 1, day(30))).toEqual([day(14)]);
  });

  it('mốc ảnh chụp: bỏ mốc trước lúc tạo, sau cuối dữ liệu, hoặc khi thẻ đã xong', () => {
    expect(snapshotTimes(card({ id: 'y', createdAt: day(5), dueDate: day(8) }), 7, day(30))).toEqual([]);
    expect(snapshotTimes(card({ id: 'z', dueDate: day(40) }), 3, day(30))).toEqual([]);
    expect(snapshotTimes(card({ id: 'd', dueDate: day(10), status: 'DONE', completedAt: day(6), statusEvents: done(6) }), 3, day(30))).toEqual([]);
  });

  it('đặc trưng của ảnh chụp đi qua ĐÚNG extractFeatures (replay) của module', () => {
    const w = generateRiskWorld(6005);
    const priors = { lateRate: 0.3, daysPerPoint: 2 };
    const rows = snapshotsOfWorld(w.seed, w.cards, w.now, priors);
    expect(rows.length).toBeGreaterThan(100);
    for (const r of rows.slice(0, 40)) {
      const c = w.cards.find((x) => x.id === r.cardId)!;
      expect(r.features).toEqual(extractFeatures(c, buildRiskContext(w.cards, r.t, priors, 'replay')));
      expect(Date.parse(r.features.detail.dueAt) - r.t.getTime()).toBe(r.horizon * DAY_MS);
      expect(r.y).toBe(labelAt(c, r.t, w.now));
    }
  });

  it('priors gộp trên thẻ đã xong có hạn; tập rỗng → lỗi', () => {
    const a = card({ id: 'a', dueDate: day(5), status: 'DONE', completedAt: day(6), storyPoints: 2 }); // tre, 6 ngay / 2 diem = 3
    const b = card({ id: 'b', dueDate: day(5), status: 'DONE', completedAt: day(1), storyPoints: 1 }); // dung han, 1 ngay / 1 diem
    expect(computePriors([{ cards: [a, b, card({ id: 'open', dueDate: day(3) })] }])).toEqual({ lateRate: 0.5, daysPerPoint: 2 });
    // xong DUNG han = dung han; khong nhap diem -> uoc luong tu checklist (8 muc -> 5 diem): 10 ngay / 5 = 2
    const onDue = card({ id: 'c', dueDate: day(10), status: 'DONE', completedAt: day(10),
      checklist: Array.from({ length: 8 }, () => ({ createdAt: day(0), isDone: true, completedAt: day(5) })) });
    expect(computePriors([{ cards: [onDue] }])).toEqual({ lateRate: 0, daysPerPoint: 2 });
    expect(() => computePriors([{ cards: [card({ id: 'x' })] }])).toThrow(RangeError);
  });

  it('mã băm tập ảnh chụp: tất định, đổi một nhãn là đổi mã', () => {
    const w = generateRiskWorld(6003);
    const priors = { lateRate: 0.3, daysPerPoint: 2 };
    const rows = snapshotsOfWorld(w.seed, w.cards, w.now, priors);
    expect(hashRows(rows)).toBe(hashRows(snapshotsOfWorld(w.seed, w.cards, w.now, priors)));
    const flipped = rows.map((r, i) => (i === 0 ? { ...r, y: (1 - r.y) as 0 | 1 } : r));
    expect(hashRows(flipped)).not.toBe(hashRows(rows));
  });
});
