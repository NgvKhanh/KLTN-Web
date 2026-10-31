// Buoc 7b - dung bao cao cua cac thi nghiem (evalAssignReportSweeps.ts). THUAN: khong cham CSDL. Kiem SO TINH TAY tren du lieu
// dung san: cac bang nay di vao luan van nen dau, dinh dang va ket luan phai dung.
import { describe, expect, it } from 'vitest';
import type { LearningResult, LearningRun, ObjectiveResult, SweepResult, TextResult } from '../src/scripts/evalAssignExperiments';
import type { ReportMeta } from '../src/scripts/evalAssignReport';
import {
  acceptanceTable,
  buildSweepReport,
  convergenceCsv,
  convergenceSeries,
  convergenceSvg,
  distanceAt,
  etaTable,
  groupResults,
  learningTable,
  newcomerDeltaLines,
  objectiveTable,
  pairedDiff,
  robustnessTable,
  sweepGroupTable,
  sweepSections,
  textTable,
  weightsGridTable,
} from '../src/scripts/evalAssignReportSweeps';
import type { LearningTrace } from '../src/scripts/evalAssignLeader';
import type { RunSummary } from '../src/scripts/evalAssignRun';

const summary = (over: Partial<RunSummary> = {}): RunSummary => ({
  decisions: 100,
  top1: 0.5,
  top3: 0.8,
  mrr: 0.65,
  regret: 0.2,
  pOnTime: 0.5,
  topNoHistory: 0.05,
  giniTop: 0.3,
  maxShareTop: 0.3,
  giniAssigned: 0.25,
  maxShareAssigned: 0.28,
  top1Assigned: 0.5,
  regretAssigned: 0.2,
  pOnTimeAssigned: 0.5,
  onTimeRealised: 0.45,
  newcomerParity: 1,
  acceptance: 1,
  chanceTop1: 0.2,
  chanceRegret: 0.3,
  chancePOnTime: 0.4,
  ...over,
});

const sw = (group: string, label: string, isDefault: boolean, ps: number[], over: Partial<RunSummary> = {}, world = 'mac dinh'): SweepResult => ({
  group,
  label,
  isDefault,
  world,
  perSeed: ps.map((p) => summary({ pOnTime: p, ...over })),
});

const cells = (line: string) => line.split(' | ').map((c) => c.replace(/^\| /, '').replace(/ \|$/, ''));
const rowsOf = (table: string) => table.split('\n').slice(2).map(cells);

describe('groupResults / pairedDiff', () => {
  it('gom theo nhom, giu thu tu xuat hien dau tien', () => {
    const rs = [sw('B', 'x', true, [0.5, 0.5]), sw('A', 'y', true, [0.5, 0.5]), sw('B', 'z', false, [0.5, 0.5])];
    const g = groupResults(rs);
    expect(g.map(([k]) => k)).toEqual(['B', 'A']);
    expect(g[0]![1].map((r) => r.label)).toEqual(['x', 'z']);
    expect(groupResults([])).toEqual([]);
  });

  it('chenh lech cap a - b theo hat giong; null khi khac the gioi, it hon 2 hat giong, hoac thieu gia tri', () => {
    const a = sw('g', 'a', false, [0.6, 0.7, 0.8]);
    const b = sw('g', 'b', true, [0.5, 0.5, 0.5]);
    const d = pairedDiff(a, b, (s) => s.pOnTime)!;
    expect(d.mean).toBeCloseTo(0.2, 12); // (0,1 + 0,2 + 0,3) / 3
    expect(d.positive).toBe(3);
    expect(pairedDiff(b, a, (s) => s.pOnTime)!.mean).toBeCloseTo(-0.2, 12);
    expect(pairedDiff({ ...a, world: 'people=4' }, b, (s) => s.pOnTime)).toBeNull(); // khac the gioi: khong so sanh xuyen the gioi
    expect(pairedDiff(sw('g', 'a', false, [0.6]), sw('g', 'b', true, [0.5]), (s) => s.pOnTime)).toBeNull();
    expect(pairedDiff(a, sw('g', 'b', true, [0.5, 0.5]), (s) => s.pOnTime)).toBeNull(); // khac so hat giong
    const nul = { ...a, perSeed: a.perSeed.map((s, i) => (i === 1 ? { ...s, newcomerParity: null } : s)) };
    expect(pairedDiff(nul, b, (s) => s.newcomerParity)).toBeNull();
    expect(pairedDiff(b, nul, (s) => s.newcomerParity)).toBeNull(); // thieu gia tri o PHIA b cung phai duoc phat hien
  });
});

describe('sweepGroupTable', () => {
  const rows = [
    sw('g', '30', false, [0.4, 0.5, 0.45, 0.55], { regret: 0.3, top1: 0.4, giniAssigned: 0.4, newcomerParity: 0.5, topNoHistory: 0.1 }),
    sw('g', '90', true, [0.5, 0.6, 0.55, 0.65], { regret: 0.2, top1: 0.5, giniAssigned: 0.3, newcomerParity: 1, topNoHistory: 0.05 }),
  ];

  it('dong mac dinh khong co chenh lech; dong khac co chenh lech cap so voi dong mac dinh, kem ket luan', () => {
    const table = sweepGroupTable(rows);
    const header = table.split('\n')[0]!;
    expect(header).toContain('Δ so với mặc định (90)');
    const [r30, r90] = rowsOf(table);
    expect(r30![0]).toBe('30');
    expect(r30![2]).toBe('-0,100 [-0,100; -0,100] — nhánh 1 kém hơn'); // 0,4 - 0,5 = ... = -0,1 o ca 4 hat giong
    expect(r90![0]).toBe('90');
    expect(r90![2]).toBe('–');
  });

  it('cac cot so lieu: hoi tiec, top-1, Gini, nguoi moi, nguoi moi dan dau', () => {
    const [r30, r90] = rowsOf(sweepGroupTable(rows));
    expect(r30!.slice(3)).toEqual(['0,300', '40,0%', '0,400', '0,50', '10,0%']);
    expect(r90!.slice(3)).toEqual(['0,200', '50,0%', '0,300', '1,00', '5,0%']);
    expect(r90![1]).toMatch(/^0,575 \[/); // trung binh 0,5 0,6 0,55 0,65
  });

  it('cot doi chieu them (against): chenh lech cap so voi dong co nhan do; dong chinh no -> gach ngang; khong co dong do -> gach ngang', () => {
    const rs = [
      sw('w', 'Ngẫu nhiên', false, [0.4, 0.4, 0.4]),
      sw('w', 'Đầy đủ', true, [0.5, 0.5, 0.5]),
      sw('w', 'Bỏ khả dụng', false, [0.45, 0.45, 0.45]),
    ];
    const table = sweepGroupTable(rs, { against: [{ header: 'Δ so với Ngẫu nhiên', label: 'Ngẫu nhiên' }, { header: 'Δ không có', label: 'khong-co' }] });
    const head = table.split('\n')[0]!;
    expect(head).toContain('Δ so với Ngẫu nhiên');
    expect(head).toContain('Δ không có');
    const [rnd, full, noav] = rowsOf(table);
    expect(rnd![3]).toBe('–'); // chinh no
    expect(full![3]).toBe('+0,100 [+0,100; +0,100] — nhánh 1 tốt hơn');
    expect(noav![3]).toBe('+0,050 [+0,050; +0,050] — nhánh 1 tốt hơn');
    expect(full![4]).toBe('–'); // khong co dong "khong-co"
  });

  it('khong co dong mac dinh -> cot chenh lech gach ngang; nguoi moi null -> gach ngang, khong "NaN"', () => {
    const rs = [sw('g', 'a', false, [0.4, 0.5], { newcomerParity: null }), sw('g', 'b', false, [0.5, 0.6], { newcomerParity: null })];
    const table = sweepGroupTable(rs);
    expect(table.split('\n')[0]).toContain('Δ so với mặc định |');
    for (const r of rowsOf(table)) {
      expect(r[2]).toBe('–');
      expect(r[6]).toBe('–');
    }
    expect(table).not.toMatch(/NaN|undefined|null/);
  });

  it('khac the gioi giua dong va dong mac dinh -> khong so sanh cap (gach ngang)', () => {
    const rs = [sw('g', 'a', false, [0.4, 0.5], {}, 'people=4'), sw('g', 'b', true, [0.5, 0.6], {}, 'mac dinh')];
    expect(rowsOf(sweepGroupTable(rs))[0]![2]).toBe('–');
  });

  it('sweepSections: moi nhom mot tieu de + mot bang, cap tieu de theo tham so', () => {
    const rs = [sw('Nhóm A', 'a', true, [0.5, 0.5]), sw('Nhóm B', 'b', true, [0.5, 0.5])];
    const text = sweepSections(rs);
    expect(text).toContain('### Nhóm A');
    expect(text).toContain('### Nhóm B');
    expect(text.indexOf('### Nhóm A')).toBeLessThan(text.indexOf('### Nhóm B'));
    expect(sweepSections(rs, {}, 4)).toContain('#### Nhóm A');
  });
});

describe('newcomerDeltaLines', () => {
  /** Mot dong voi "Nguoi moi" va Gini tung hat giong (khong dung `sw`: hai chi so nay phai khac nhau theo hat giong). */
  const row = (label: string, isDefault: boolean, parity: (number | null)[], gini: number[], world = 'mac dinh'): SweepResult => ({
    group: 'g',
    label,
    isDefault,
    world,
    perSeed: parity.map((p, i) => summary({ newcomerParity: p, giniAssigned: gini[i]! })),
  });
  const base = row('mac dinh', true, [0.5, 0.6, 0.7], [0.3, 0.3, 0.3]);
  const dash = (text: string) => text.split('\n').filter((l) => l.startsWith('- '));

  it('chenh lech cap cua Nguoi moi va Gini so voi dong mac dinh (khong tu so sanh voi chinh no), kem nhan TRUNG TINH', () => {
    const up = row('A cao', false, [0.6, 0.7, 0.8], [0.32, 0.32, 0.32]); // +0,1 va +0,02 o moi hat giong
    const down = row('B thap', false, [0.4, 0.5, 0.6], [0.28, 0.28, 0.28]); // -0,1 va -0,02
    const same = row('C ngang', false, [0.4, 0.7, 1.0], [0.3, 0.3, 0.3]); // -0,1 / +0,1 / +0,3 (khoang chua 0) va 0
    const text = newcomerDeltaLines([base, up, down, same]);
    expect(text.split('\n')[0]).toContain('so với mặc định (mac dinh)');
    const [a, b, c] = dash(text);
    expect(dash(text)).toHaveLength(3); // dong mac dinh khong co dong rieng
    expect(a).toBe('- A cao: Δ Người mới +0,100 [+0,100; +0,100] — cao hơn mặc định · Δ Gini +0,020 [+0,020; +0,020] — cao hơn mặc định');
    expect(b).toBe('- B thap: Δ Người mới -0,100 [-0,100; -0,100] — thấp hơn mặc định · Δ Gini -0,020 [-0,020; -0,020] — thấp hơn mặc định');
    expect(c).toContain('Δ Người mới +0,100 [');
    expect(c).toContain('] — chưa phân biệt được · Δ Gini 0,000 [0,000; 0,000] — chưa phân biệt được');
  });

  it('thieu gia tri (Nguoi moi null o mot hat giong, o mot trong hai dong) hoac khac the gioi -> gach ngang, khong "NaN"', () => {
    const nul = row('D thieu', false, [0.6, null, 0.8], [0.32, 0.32, 0.32]);
    const [d] = dash(newcomerDeltaLines([base, nul]));
    expect(d).toBe('- D thieu: Δ Người mới – · Δ Gini +0,020 [+0,020; +0,020] — cao hơn mặc định');
    const baseNull = row('mac dinh', true, [0.5, null, 0.7], [0.3, 0.3, 0.3]);
    expect(dash(newcomerDeltaLines([baseNull, row('E', false, [0.6, 0.7, 0.8], [0.3, 0.3, 0.3])]))[0]).toContain('Δ Người mới – ·'); // thieu o dong mac dinh cung phai duoc phat hien
    const other = row('F the gioi khac', false, [0.6, 0.7, 0.8], [0.32, 0.32, 0.32], 'people=4');
    expect(dash(newcomerDeltaLines([base, other]))[0]).toBe('- F the gioi khac: Δ Người mới – · Δ Gini –');
    expect(newcomerDeltaLines([base, nul, other])).not.toMatch(/NaN|undefined|null/);
  });

  it('khong co dong mac dinh -> chuoi rong (khong bang gi de so sanh)', () => {
    expect(newcomerDeltaLines([row('x', false, [0.5, 0.5], [0.3, 0.3]), row('y', false, [0.6, 0.6], [0.3, 0.3])])).toBe('');
    expect(newcomerDeltaLines([])).toBe('');
  });
});

describe('weightsGridTable', () => {
  const mk = () => [
    sw('g', '0,10 / 0,10 / 0,80', false, [0.30, 0.30, 0.30]),
    sw('g', '0,45 / 0,30 / 0,25 (MẶC ĐỊNH)', true, [0.50, 0.50, 0.50]),
    sw('g', '0,70 / 0,20 / 0,10', false, [0.60, 0.60, 0.60]),
    sw('g', '0,40 / 0,30 / 0,30', false, [0.55, 0.55, 0.55]),
    sw('g', '0,20 / 0,20 / 0,60', false, [0.40, 0.40, 0.40]),
  ];

  it('xep theo P(dung han) giam dan, ghi hang cua cau hinh mac dinh', () => {
    const text = weightsGridTable(mk());
    expect(text.split('\n')[0]).toBe('Xếp theo P(đúng hạn) giảm dần; cấu hình mặc định đứng hạng 3/5.');
    const rows = text.split('\n').slice(4).map(cells);
    expect(rows.map((r) => r[0])).toEqual(['1', '2', '3', '4', '5']);
    expect(rows.map((r) => r[1])).toEqual([
      '0,70 / 0,20 / 0,10',
      '0,40 / 0,30 / 0,30',
      '0,45 / 0,30 / 0,25 (MẶC ĐỊNH)',
      '0,20 / 0,20 / 0,60',
      '0,10 / 0,10 / 0,80',
    ]);
  });

  it('dong mac dinh khong co chenh lech; dong khac co chenh lech cap so voi mac dinh', () => {
    const text = weightsGridTable(mk());
    const body = text.split('\n').slice(4).map(cells);
    const def = body.find((r) => r[1]!.includes('MẶC ĐỊNH'))!;
    expect(def[3]).toBe('–');
    const best = body.find((r) => r[1] === '0,70 / 0,20 / 0,10')!;
    expect(best[3]).toBe('+0,100 [+0,100; +0,100] — nhánh 1 tốt hơn');
  });

  it('chi hien top N va luon them dong mac dinh neu no nam ngoai top', () => {
    const rows = [
      ...Array.from({ length: 6 }, (_, i) => sw('g', `cau hinh ${i}`, false, [0.9 - i * 0.05, 0.9 - i * 0.05])),
      sw('g', 'MAC DINH', true, [0.2, 0.2]),
    ];
    const text = weightsGridTable(rows, 3);
    const data = text.split('\n').slice(4);
    expect(data).toHaveLength(4); // top 3 + mac dinh
    expect(data[3]).toContain('MAC DINH');
    expect(data[3]!.split(' | ')[0]).toBe('| 7');
    expect(text).toContain('đứng hạng 7/7');
  });
});

describe('robustnessTable', () => {
  const world = (name: string, p: [number, number, number, number]) => [
    sw(name, 'Ngẫu nhiên', false, [p[0], p[0], p[0]]),
    sw(name, 'Người rảnh nhất', false, [p[1], p[1], p[1]]),
    sw(name, 'Chỉ kinh nghiệm', false, [p[2], p[2], p[2]]),
    sw(name, 'Đầy đủ, trọng số cố định', true, [p[3], p[3], p[3]]),
  ];

  it('moi the gioi mot dong: P(dung han) tung nhanh, chenh lech cap cua nhanh day du, thu hang', () => {
    const rs = [...world('Mặc định', [0.40, 0.38, 0.47, 0.45]), ...world('Phân công sai: cao', [0.41, 0.39, 0.44, 0.46])];
    const [a, b] = rowsOf(robustnessTable(rs));
    expect(a![0]).toBe('Mặc định');
    expect(a!.slice(1, 5)).toEqual(['0,400', '0,380', '0,470', '0,450']);
    expect(a![5]).toBe('+0,050 [+0,050; +0,050] — nhánh 1 tốt hơn'); // day du - ngau nhien
    expect(a![6]).toBe('-0,020 [-0,020; -0,020] — nhánh 1 kém hơn'); // day du - chi kinh nghiem
    expect(a![7]).toBe('Kinh nghiệm > Đầy đủ > Ngẫu nhiên > Rảnh nhất');
    expect(b![7]).toBe('Đầy đủ > Kinh nghiệm > Ngẫu nhiên > Rảnh nhất');
  });

  it('thieu mot nhanh -> gach ngang o cot do va bo khoi thu hang', () => {
    const partial = world('W', [0.4, 0.38, 0.47, 0.45]).filter((r) => r.label !== 'Chỉ kinh nghiệm');
    const [row] = rowsOf(robustnessTable(partial));
    expect(row![3]).toBe('–');
    expect(row![6]).toBe('–');
    expect(row![7]).toBe('Đầy đủ > Ngẫu nhiên > Rảnh nhất');
  });
});

// ---------- Hoc ----------

const dist = (n: number) => Array.from({ length: n + 1 }, (_, i) => 1 - i / n); // 1 -> 0 tuyen tinh, n quyet dinh
/** `firstC` / `lastC`: ti le chap nhan CHI tren quyet dinh du du lieu (mac dinh = ti le chung); `nTop*`: ti le nguoi xep dau la nguoi moi. */
const trace = (
  distance: number[],
  first: number,
  last: number,
  firstC: number | null = first,
  lastC: number | null = last,
  nTopFirst = 0,
  nTopLast = 0
): LearningTrace => ({
  distance,
  acceptFirstThird: first,
  acceptLastThird: last,
  acceptAll: (first + last) / 2,
  acceptFirstThirdComplete: firstC,
  acceptLastThirdComplete: lastC,
  newcomerTopFirstThird: nTopFirst,
  newcomerTopLastThird: nTopLast,
});
const lrun = (distance: number[], first: number, last: number, learned = 7, firstC: number | null = first, lastC: number | null = last, nTopLast = 0): LearningRun => ({
  trace: trace(distance, first, last, firstC, lastC, 0, nTopLast),
  stats: { feedback: distance.length - 1, learned },
  final: { experience: 0.15, reliability: 0.15, availability: 0.7 },
});
const learnResult = (persona: 'expert' | 'free' | 'control', noise: number, eta: number, learned: LearningRun[], fixed: LearningTrace[]): LearningResult => ({
  point: { persona, noise, eta, space: 'SCALED' },
  learned,
  fixed,
});

describe('distanceAt / learningTable / etaTable', () => {
  const seeds3 = [lrun(dist(100), 0.4, 0.8), lrun(dist(100), 0.4, 0.8), lrun(dist(100), 0.4, 0.8)];
  const fixed3 = [trace(dist(100).map(() => 1), 0.5, 0.5), trace(dist(100).map(() => 1), 0.5, 0.5), trace(dist(100).map(() => 1), 0.5, 0.5)];

  it('distanceAt: chi lay hat giong con du quyet dinh (t < do dai)', () => {
    const runs = [lrun(dist(100), 0, 0), lrun(dist(50), 0, 0), lrun(dist(30), 0, 0)];
    expect(distanceAt(runs, 0)).toHaveLength(3);
    expect(distanceAt(runs, 30)).toHaveLength(3); // dist(30) co 31 phan tu (chi so 0..30): 30 < 31 nen van con
    expect(distanceAt(runs, 31)).toHaveLength(2);
    expect(distanceAt(runs, 50)).toHaveLength(2);
    expect(distanceAt(runs, 51)).toHaveLength(1);
    expect(distanceAt(runs, 101)).toHaveLength(0);
    // Gia tri tai t = 50: dist(100)[50] = 0,5 va dist(50)[50] = 0 (phan tu cuoi)
    expect(distanceAt(runs, 50)).toEqual([0.5, 0]);
  });

  it('bang duong hoi tu: khoang cach tai cac moc, khoang cach cuoi, so luot hoc', () => {
    const table = learningTable([learnResult('free', 0, 0.05, seeds3, fixed3)]);
    const head = table.split('\n')[0]!;
    expect(head).toContain('0 / 10 / 20 / 40 / 80 / 100 quyết định');
    expect(cells(head)).toHaveLength(5);
    const [row] = rowsOf(table);
    expect(row).toHaveLength(5);
    expect(row![0]).toBe('Ưu tiên người rảnh');
    expect(row![1]).toBe('0');
    expect(row![2]).toBe('1,00 → 0,90 → 0,80 → 0,60 → 0,20 → 0,00');
    expect(row![3]).toMatch(/^0,00 \[0,00; 0,00\]$/); // khoang cach cuoi = 0 o ca 3 hat giong
    expect(row![4]).toBe('7,0');
  });

  it('nhieu la dau phay; gu doi chung; moc t vuot do dai thi gach ngang', () => {
    const shortRuns = [lrun(dist(30), 0.4, 0.4), lrun(dist(30), 0.4, 0.4)];
    const fx = [trace(dist(30).map(() => 1), 0.4, 0.4), trace(dist(30).map(() => 1), 0.4, 0.4)];
    const [row] = rowsOf(learningTable([learnResult('control', 0.25, 0.05, shortRuns, fx)]));
    expect(row![0]).toBe('Trùng mặc định (đối chứng)');
    expect(row![1]).toBe('0,25');
    expect(row![2]).toBe('1,00 → 0,67 → 0,33 → – → – → –'); // t = 40, 80, 100 khong con hat giong nao
  });

  it('bang chap nhan: moi quyet dinh va chi quyet dinh du du lieu, chenh lech cap tren mau so chung, nguoi moi dung dau', () => {
    // Nhanh co dinh: chung 50% -> 50%, du du lieu 60% -> 60%, nguoi moi dung dau 30%. Nhanh co hoc: chung 40% -> 80%, du du lieu 50% -> 90%, nguoi moi 20%
    const learned = [0, 1, 2].map(() => lrun(dist(100), 0.4, 0.8, 7, 0.5, 0.9, 0.2));
    const fixed = [0, 1, 2].map(() => trace(dist(100).map(() => 1), 0.5, 0.5, 0.6, 0.6, 0, 0.3));
    const table = acceptanceTable([learnResult('free', 0.1, 0.05, learned, fixed)]);
    expect(cells(table.split('\n')[0]!)).toHaveLength(8);
    const [row] = rowsOf(table);
    expect(row![0]).toBe('Ưu tiên người rảnh');
    expect(row![1]).toBe('0,1');
    expect(row![2]).toBe('50,0% → 50,0%'); // co dinh, moi quyet dinh
    expect(row![3]).toBe('40,0% → 80,0%'); // co hoc, moi quyet dinh
    expect(row![4]).toBe('60,0% → 60,0%'); // co dinh, du du lieu
    expect(row![5]).toBe('50,0% → 90,0%'); // co hoc, du du lieu
    expect(row![6]).toBe('+0,300 [+0,300; +0,300] — nhánh 1 tốt hơn'); // 0,9 - 0,6 tren mau so chung
    expect(row![7]).toBe('30,0% / 20,0%');
  });

  it('bang chap nhan: mui ten di tu ba DAU sang ba CUOI, o ca nhanh co dinh lan nhanh co hoc (moi cot mot cap so khac nhau)', () => {
    const learned = [0, 1].map(() => lrun(dist(100), 0.3, 0.7, 7, 0.35, 0.75));
    const fixed = [0, 1].map(() => trace(dist(100).map(() => 1), 0.2, 0.6, 0.25, 0.65));
    const [row] = rowsOf(acceptanceTable([learnResult('expert', 0, 0.05, learned, fixed)]));
    expect(row![2]).toBe('20,0% → 60,0%'); // co dinh, moi quyet dinh
    expect(row![3]).toBe('30,0% → 70,0%'); // co hoc, moi quyet dinh
    expect(row![4]).toBe('25,0% → 65,0%'); // co dinh, du du lieu
    expect(row![5]).toBe('35,0% → 75,0%'); // co hoc, du du lieu
  });

  it('bang chap nhan: hat giong khong co quyet dinh du du lieu bi bo khoi phep so sanh cap; duoi 2 hat giong thi gach ngang', () => {
    const learned = [lrun(dist(100), 0.4, 0.8, 7, 0.5, 0.9), lrun(dist(100), 0.4, 0.8, 7, null, null), lrun(dist(100), 0.4, 0.8, 7, 0.5, 0.7)];
    const fixed = [
      trace(dist(100).map(() => 1), 0.5, 0.5, 0.6, 0.6),
      trace(dist(100).map(() => 1), 0.5, 0.5, null, null),
      trace(dist(100).map(() => 1), 0.5, 0.5, 0.6, 0.5),
    ];
    const [row] = rowsOf(acceptanceTable([learnResult('expert', 0, 0.05, learned, fixed)]));
    // Chi 2 hat giong co mau so chung o ca hai nhanh: (0,9 - 0,6) va (0,7 - 0,5) -> trung binh 0,25
    expect(row![6]).toContain('+0,250');
    expect(row![4]).toBe('60,0% → 55,0%'); // trung binh cac hat giong CON gia tri: (0,6 + 0,6) / 2 va (0,6 + 0,5) / 2
    expect(row![5]).toBe('50,0% → 80,0%');
    const one = rowsOf(acceptanceTable([learnResult('expert', 0, 0.05, [learned[0]!], [fixed[0]!])]))[0]!;
    expect(one[6]).toBe('–');
    const nones = rowsOf(acceptanceTable([learnResult('expert', 0, 0.05, [lrun(dist(100), 0.4, 0.8, 7, null, null), lrun(dist(100), 0.4, 0.8, 7, null, null)], [trace(dist(100).map(() => 1), 0.5, 0.5, null, null), trace(dist(100).map(() => 1), 0.5, 0.5, null, null)])]))[0]!;
    expect(nones[4]).toBe('– → –');
    expect(nones[6]).toBe('–');
  });

  it('bang toc do hoc: moi eta mot dong, khoang cach cuoi, so lan hoc, chap nhan ba cuoi (du du lieu) cua nhanh co hoc va nhanh co dinh', () => {
    const a = learnResult('expert', 0.25, 0.01, [lrun(dist(100), 0.5, 0.6, 3, 0.55, 0.65), lrun(dist(100), 0.5, 0.6, 3, 0.55, 0.65)], [trace(dist(100).map(() => 1), 0.5, 0.5, 0.52, 0.52), trace(dist(100).map(() => 1), 0.5, 0.5, 0.52, 0.52)]);
    const b = learnResult('expert', 0.25, 0.2, [lrun(dist(100), 0.5, 0.9, 40, 0.55, 0.95), lrun(dist(100), 0.5, 0.9, 40, 0.55, 0.95)], a.fixed as LearningTrace[]);
    const [ra, rb] = rowsOf(etaTable([a, b]));
    expect(ra!.slice(0, 3)).toEqual(['Ưu tiên kinh nghiệm', '0,25', '0,01']);
    expect(rb!.slice(0, 3)).toEqual(['Ưu tiên kinh nghiệm', '0,25', '0,2']);
    expect(ra![4]).toBe('3,0');
    expect(rb![4]).toBe('40,0');
    expect(ra![5]).toBe('65,0%');
    expect(rb![5]).toBe('95,0%');
    expect(ra![6]).toBe('52,0%');
  });

  it('khoang cach cuoi (bang duong hoi tu va bang toc do hoc) la phan tu CUOI cua duong, khong phai diem ban dau', () => {
    const r = learnResult(
      'expert',
      0,
      0.05,
      [lrun([1, 0.6, 0.3], 0.5, 0.5), lrun([1, 0.8, 0.5], 0.5, 0.5)],
      [trace([1, 1, 1], 0.5, 0.5), trace([1, 1, 1], 0.5, 0.5)]
    );
    expect(rowsOf(learningTable([r]))[0]![3]).toMatch(/^0,40 \[/); // (0,3 + 0,5) / 2
    expect(rowsOf(etaTable([r]))[0]![3]).toMatch(/^0,40 \[/);
  });
});

describe('duong hoi tu (bang, CSV, SVG)', () => {
  const res = learnResult(
    'expert',
    0,
    0.05,
    [lrun(dist(100), 0, 0), lrun(dist(50), 0, 0), lrun(dist(30), 0, 0)],
    [trace(dist(100), 0, 0), trace(dist(50), 0, 0), trace(dist(30), 0, 0)]
  );

  it('convergenceSeries: moc t theo buoc, bo moc co < 2 hat giong, trung binh nam trong khoang', () => {
    const s = convergenceSeries(res, 'Nhóm', 10, 200);
    expect(s.label).toBe('Nhóm');
    // do dai 101 / 51 / 31: t = 0..30 co 3 hat giong; t = 40, 50 co 2; t >= 60 chi con 1 -> bo
    expect(s.points.map((p) => p.t)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(s.points.map((p) => p.n)).toEqual([3, 3, 3, 3, 2, 2]);
    for (const p of s.points) {
      expect(p.lo).toBeLessThanOrEqual(p.mean + 1e-12);
      expect(p.hi).toBeGreaterThanOrEqual(p.mean - 1e-12);
    }
    expect(s.points[0]!.mean).toBeCloseTo(1, 12);
    // t = 10: (0,9 + 0,8 + 0,6667) / 3
    expect(s.points[1]!.mean).toBeCloseTo((0.9 + 0.8 + (1 - 10 / 30)) / 3, 12);
  });

  it('convergenceSeries: moc cuoi (t = so quyet dinh toi da) duoc giu khi con du hat giong, ke ca khi la boi so cua buoc', () => {
    const two = learnResult('expert', 0, 0.05, [lrun(dist(20), 0, 0), lrun(dist(20), 0, 0)], [trace(dist(20), 0, 0), trace(dist(20), 0, 0)]);
    expect(convergenceSeries(two, 'x', 10, 100).points.map((p) => p.t)).toEqual([0, 10, 20]);
    expect(convergenceSeries(two, 'x', 2, 100).points.map((p) => p.t)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
    expect(convergenceSeries(two, 'x', 8, 100).points.map((p) => p.t)).toEqual([0, 8, 16]); // khong la boi so: dung o boi so lon nhat <= 20
    expect(convergenceSeries(two, 'x', 10, 100).points[2]!.n).toBe(2);
  });

  it('convergenceCsv: tieu de + mot dong moi diem, nhan duoc rao dau nhay kep', () => {
    const csv = convergenceCsv([{ label: 'A "x", y', points: [{ t: 0, mean: 1, lo: 0.9, hi: 1.1, n: 20 }] }, { label: 'B', points: [] }]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('nhom,t,trung_binh,can_duoi,can_tren,so_hat_giong');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe('"A ""x"", y",0,1.000000,0.900000,1.100000,20');
    expect(csv.endsWith('\n')).toBe(true);
  });

  it('convergenceSvg: SVG hop le, moi duong mot polyline + mot dai, nhan duoc thoat ky tu dac biet, khong NaN', () => {
    const s1 = convergenceSeries(res, 'A & B <x>', 10, 100);
    const s2 = convergenceSeries(res, 'Nhóm hai', 10, 100);
    const svg = convergenceSvg([s1, s2], 'Tiêu đề "thử"');
    expect(svg.startsWith('<svg ')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg.match(/<polyline /g)).toHaveLength(2);
    expect(svg.match(/<polygon /g)).toHaveLength(2);
    expect(svg).toContain('A &amp; B &lt;x&gt;');
    expect(svg).toContain('Tiêu đề &quot;thử&quot;');
    expect(svg).not.toMatch(/NaN|undefined|Infinity/);
    expect(svg.match(/<svg /g)).toHaveLength(1);
    // Truc y bat dau tu 0 va co gia tri toi thieu 0,2
    expect(svg).toContain('>0,00<');
  });

  it('convergenceSvg: hinh hoc dung - diem (t = 0, 1) o goc tren-trai cua vung ve, diem (t = toi da, 0) o day-phai', () => {
    // Khung 760 x 440, le trai 64, le phai 24, le tren 56, le duoi 64 -> vung ve rong 672 x cao 320; truc y 0..1 vi gia tri lon nhat 1
    const svg = convergenceSvg([
      {
        label: 'hình học',
        points: [
          { t: 0, mean: 1, lo: 1, hi: 1, n: 5 },
          { t: 10, mean: 0, lo: 0, hi: 0, n: 5 },
        ],
      },
    ]);
    expect(svg).toContain('<polyline points="64.0,56.0 736.0,376.0"');
    expect(svg).toContain('viewBox="0 0 760 440"');
    // Truc y: nhan 0,00 o day (y = 376) va 1,00 o dinh (y = 56)
    expect(svg).toContain('y="380.0" text-anchor="end"'); // 376 + 4
    expect(svg).toContain('>1,00<');
    // Truc y tu dong nang len khi gia tri > 1: gia tri lon nhat 1,5 -> tran ceil(1,5 * 5) / 5 = 1,6
    const tall = convergenceSvg([{ label: 'x', points: [{ t: 0, mean: 1.5, lo: 1.4, hi: 1.5, n: 5 }, { t: 5, mean: 0.1, lo: 0.1, hi: 0.1, n: 5 }] }]);
    expect(tall).toContain('>1,60<');
    // Gia tri nho: tran toi thieu 0,2
    const small = convergenceSvg([{ label: 'x', points: [{ t: 0, mean: 0.05, lo: 0.05, hi: 0.05, n: 5 }, { t: 5, mean: 0.01, lo: 0.01, hi: 0.01, n: 5 }] }]);
    expect(small).toContain('>0,20<');
  });

  it('convergenceSvg: duong toan 0 (hoi tu tuyet doi, vd. doi chung) van co truc y 0..0,2 - san 0,2 chi co tac dung khi moi gia tri bang 0', () => {
    // Moi gia tri > 0 da lam tran >= 0,2 nho phep lam tron len (ceil(x * 5) / 5 >= 0,2); chi khi hi = 0 moi can `max(0,2; ...)`
    const zero = convergenceSvg([{ label: 'x', points: [{ t: 0, mean: 0, lo: 0, hi: 0, n: 5 }, { t: 5, mean: 0, lo: 0, hi: 0, n: 5 }] }]);
    for (const label of ['>0,00<', '>0,04<', '>0,08<', '>0,12<', '>0,16<', '>0,20<']) expect(zero).toContain(label);
    expect(zero).not.toContain('>0,10<');
    expect(zero).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('khong co diem nao de ve -> tu choi', () => {
    expect(() => convergenceSvg([])).toThrow(RangeError);
    expect(() => convergenceSvg([{ label: 'x', points: [] }])).toThrow(RangeError);
  });
});

describe('textTable / objectiveTable', () => {
  const tr = (id: string, label: string, isDefault: boolean, top1: number[], p5: number[]): TextResult => ({
    id,
    label,
    isDefault,
    perSeed: top1.map((t, i) => ({ queries: 100, top1: t, p5: p5[i]!, chance: 0.13 })),
  });

  it('bang van ban: top-1 / P@5 trung binh va chenh lech cap so voi mac dinh', () => {
    const rows = rowsOf(
      textTable([
        tr('default', 'mac dinh', true, [0.97, 0.96, 0.98], [0.85, 0.84, 0.86]),
        tr('uni', 'uni-gram', false, [0.95, 0.94, 0.96], [0.85, 0.84, 0.86]),
      ])
    );
    expect(rows[0]![1]).toBe('97,0%');
    expect(rows[0]![2]).toBe('–');
    expect(rows[1]![1]).toBe('95,0%');
    expect(rows[1]![2]).toBe('-0,0200 [-0,0200; -0,0200] — nhánh 1 kém hơn');
    expect(rows[1]![4]).toContain('chưa phân biệt được'); // P@5 bang nhau
  });

  it('bang anh huong khach quan: trong so hoc duoc TB, P(dung han) hai nhanh, chenh lech cap', () => {
    const r: ObjectiveResult = {
      persona: 'free',
      noise: 0.1,
      learned: [0.45, 0.46, 0.44].map((p) => summary({ pOnTime: p, regret: 0.3 })),
      fixed: [0.47, 0.47, 0.47].map((p) => summary({ pOnTime: p, regret: 0.25 })),
      finals: [{ experience: 0.2, reliability: 0.2, availability: 0.6 }, { experience: 0.1, reliability: 0.2, availability: 0.7 }, { experience: 0.15, reliability: 0.2, availability: 0.65 }],
    };
    const [row] = rowsOf(objectiveTable([r]));
    expect(row![0]).toBe('Ưu tiên người rảnh');
    expect(row![1]).toBe('0,1');
    expect(row![2]).toBe('0,15 / 0,20 / 0,65');
    expect(row![3]).toMatch(/^0,450 \[/);
    expect(row![4]).toBe('0,470 [0,470; 0,470]');
    expect(row![5]).toContain('-0,020'); // (0,45 - 0,47 + 0,46 - 0,47 + 0,44 - 0,47) / 3
    expect(row![5]).toContain('nhánh 1 kém hơn');
    expect(row![6]).toBe('+0,050 [+0,050; +0,050] — nhánh 1 kém hơn'); // hoi tiec cao hon = kem hon
  });
});

describe('buildSweepReport', () => {
  it('bao cao gop giu thoi diem chay rieng cua tung thi nghiem', () => {
    const text = buildSweepReport({ meta: {
      date: '2026-10-06', seeds: [2001, 2002], datasetSha256: 'dataset-v1', minDay: 60, loadPenalty: 0.06,
      sourceSha256: 'source-v1', experimentRuns: {
        params: '2026-10-01T01:00:00.000Z', learn: '2026-10-02T02:00:00.000Z',
      },
    } });
    expect(text).toContain('Ngày lập báo cáo 2026-10-06');
    expect(text).toContain('`params`: 2026-10-01T01:00:00.000Z');
    expect(text).toContain('`learn`: 2026-10-02T02:00:00.000Z');
    expect(text).toContain('sha256 mã nguồn `source-v1`');
    expect(text).not.toContain('Ngày chạy 2026-10-06');
  });

  const meta = (n: number): ReportMeta => ({
    date: '2026-09-21',
    seeds: Array.from({ length: n }, (_, i) => 2001 + i),
    datasetSha256: 'abcdef0123456789'.repeat(4),
    minDay: 60,
    loadPenalty: 0.06,
  });
  const sweep = (group: string) => [sw(group, 'a', true, [0.5, 0.5, 0.5]), sw(group, 'b', false, [0.55, 0.55, 0.55])];
  const learnAll = {
    main: [learnResult('free', 0, 0.05, [lrun(dist(100), 0.4, 0.8), lrun(dist(100), 0.4, 0.8)], [trace(dist(100).map(() => 1), 0.5, 0.5), trace(dist(100).map(() => 1), 0.5, 0.5)])],
    eta: [learnResult('free', 0, 0.05, [lrun(dist(100), 0.4, 0.8), lrun(dist(100), 0.4, 0.8)], [trace(dist(100).map(() => 1), 0.5, 0.5), trace(dist(100).map(() => 1), 0.5, 0.5)])],
    raw: [learnResult('free', 0.1, 0.05, [lrun(dist(100), 0.4, 0.8), lrun(dist(100), 0.4, 0.8)], [trace(dist(100).map(() => 1), 0.5, 0.5), trace(dist(100).map(() => 1), 0.5, 0.5)])],
    objective: [
      { persona: 'free' as const, noise: 0.1, learned: [summary(), summary()], fixed: [summary(), summary()], finals: [{ experience: 0.2, reliability: 0.2, availability: 0.6 }, { experience: 0.2, reliability: 0.2, availability: 0.6 }] },
    ],
  };

  it('chi co muc nao co ket qua; khong co gi thi chi co dau bao cao va gioi han', () => {
    const empty = buildSweepReport({ meta: meta(20) });
    expect(empty).toContain('# Đánh giá module gợi ý phân công — quét tham số');
    expect(empty).toContain('Ngày chạy 2026-09-21');
    expect(empty).toContain('20 hạt giống (2001–2020)');
    expect(empty).toContain('`abcdef0123456789…`');
    expect(empty).toContain('## Giới hạn');
    for (const h of ['## 1. ', '## 2. ', '## 3. ', '## 4. ', '## 5. ', '## 6. ', '## 7. ']) expect(empty).not.toContain(h);
    expect(empty).not.toContain('Cảnh báo');
  });

  it('day du cac muc theo thu tu, moi muc dung ket qua cua no', () => {
    const text = buildSweepReport({
      meta: meta(20),
      params: sweep('Nhóm tham số'),
      norm: sweep('Chuẩn hoá'),
      weights: sweep('Lưới'),
      penalty: sweep('Phạt tải'),
      density: sweep('Mật độ'),
      robust: [
        sw('Mặc định', 'Ngẫu nhiên', false, [0.4, 0.4]),
        sw('Mặc định', 'Đầy đủ, trọng số cố định', true, [0.5, 0.5]),
      ],
      learn: learnAll,
      text: [{ id: 'default', label: 'mặc định', isDefault: true, perSeed: [{ queries: 10, top1: 0.9, p5: 0.8, chance: 0.1 }, { queries: 10, top1: 0.9, p5: 0.8, chance: 0.1 }] }],
    });
    const idx = ['## 1. ', '## 2. ', '## 3. ', '## 4. ', '## 5. ', '## 6. ', '## 7. ', '## Giới hạn'].map((h) => text.indexOf(h));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx); // dung thu tu
    for (const h of ['### Nhóm tham số', '### Phạt tải', '### Mật độ', '### 6.1 ', '### 6.2 ', '### 6.3 ', '### 6.4 ', '### 6.5 ']) expect(text).toContain(h);
    expect(text).toContain('đứng hạng 2/2'); // luoi: mac dinh (0,5) thua cau hinh b (0,55)
    expect(text).toContain('Chênh lệch cặp so với mặc định (a)'); // muc 2: chenh lech cap cua Nguoi moi / Gini
    expect(text).toContain('- b: Δ Người mới ');
    expect(text).not.toMatch(/NaN|undefined|null/);
  });

  it('phan gioi han va so hat giong; it hon 20 hat giong thi canh bao', () => {
    const text = buildSweepReport({ meta: meta(5), params: sweep('g') });
    expect(text).toContain('Cảnh báo');
    expect(text).toContain('chỉ 5 hạt giống');
    expect(text).toContain('Khoảng tin cậy tính trên 5 hạt giống');
    expect(buildSweepReport({ meta: meta(19) })).toContain('Cảnh báo');
    expect(buildSweepReport({ meta: meta(20) })).not.toContain('Cảnh báo');
  });

  it('chi co the gioi (phat tai hoac mat do) van co muc 4 va chi in phan co ket qua', () => {
    const onlyPenalty = buildSweepReport({ meta: meta(20), penalty: sweep('Phạt tải 0,06') });
    expect(onlyPenalty).toContain('## 4. ');
    expect(onlyPenalty).toContain('### Phạt tải 0,06');
    expect(onlyPenalty).not.toContain('### Mật độ');
    const onlyDensity = buildSweepReport({ meta: meta(20), density: sweep('Mật độ 24') });
    expect(onlyDensity).toContain('## 4. ');
    expect(onlyDensity).toContain('### Mật độ 24');
    expect(onlyDensity).not.toContain('### Phạt tải');
  });
});
