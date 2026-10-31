// Buoc 7a - dung bao cao (evalAssignReport.ts). THUAN: khong cham CSDL. Kiem SO TINH TAY tren du lieu dung san, khong doc lai
// ket qua thuc: bang so lieu la thu duoc dua vao luan van nen dinh dang / dau / ket luan phai dung.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PRIMARY_COMPARISONS,
  buildArmsReport,
  closedLoopTable,
  comparisonTable,
  datasetFingerprint,
  fmtDiff,
  fmtMeanCI,
  fmtSigned,
  historyTable,
  meanOver,
  seriesOf,
  verdict,
  type ArmResult,
  type ReportMeta,
} from '../src/scripts/evalAssignReport';
import { comparePaired } from '../src/scripts/evalAssignStats';
import { EVAL_SEEDS, type RunSummary } from '../src/scripts/evalAssignRun';
import { DEFAULT_SIM, generateSimulation } from '../src/scripts/simGenerator';

// Ma bam DONG BANG cua 20 bo du lieu danh gia. Doi ma nay = bo sinh (hoac danh sach hat giong) da doi -> MOI SO LIEU cua buoc 7 phai
// chay lai; khong sua cho xanh.
const FROZEN_EVAL_SHA256 = 'ff6c7cc6ef628c2f7dda9bde8578edcdcd9ec809d761776be033847feff02bbc';

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

const arm = (id: string, label: string, perSeed: RunSummary[]): ArmResult => ({ id, label, perSeed });

const ALL_IDS = [
  'random', 'round-robin', 'most-free', 'most-frequent', 'exp-only', 'load-only', 'full',
  'no-avail', 'no-rel', 'no-exp', 'rel-only', 'best-skill', 'oracle',
];
const allArms = (n: number): ArmResult[] =>
  ALL_IDS.map((id, k) => arm(id, `Nhanh ${id}`, Array.from({ length: n }, (_, i) => summary({ pOnTime: 0.3 + 0.02 * k + 0.001 * i, regret: 0.4 - 0.01 * k }))));

const meta = (n: number): ReportMeta => ({
  date: '2026-09-21',
  seeds: Array.from({ length: n }, (_, i) => 2001 + i),
  datasetSha256: 'abcdef0123456789'.repeat(4),
  minDay: 60,
  loadPenalty: 0.06,
});

describe('dinh dang so (kieu Viet, dau ro rang)', () => {
  it('fmtMeanCI: co khoang khi >= 2 hat giong; 1 gia tri thi khong co khoang; rong thi gach ngang', () => {
    expect(fmtMeanCI([0.5, 0.5, 0.5])).toBe('0,500 [0,500; 0,500]');
    expect(fmtMeanCI([0.25])).toBe('0,250');
    expect(fmtMeanCI([])).toBe('–');
    const s = fmtMeanCI([0.2, 0.4, 0.6, 0.8]);
    expect(s).toMatch(/^0,500 \[0,\d{3}; 0,\d{3}\]$/);
    expect(fmtMeanCI([0.12345, 0.12345], 2)).toBe('0,12 [0,12; 0,12]');
  });

  it('fmtSigned / fmtDiff: dau + hoac -, khong dau cho 0', () => {
    expect(fmtSigned(0.0124)).toBe('+0,012');
    expect(fmtSigned(-0.0044)).toBe('-0,004');
    expect(fmtSigned(0)).toBe('0,000');
    expect(fmtSigned(-0)).toBe('0,000');
    expect(fmtSigned(1.5, 1)).toBe('+1,5');
    expect(fmtDiff(comparePaired([3, 3, 3, 3], [1, 1, 1, 1]))).toBe('+2,000 [+2,000; +2,000]');
    expect(fmtDiff(comparePaired([1, 1, 1], [3, 3, 3]))).toBe('-2,000 [-2,000; -2,000]');
    expect(fmtDiff(comparePaired([1, 1], [1, 1]))).toBe('0,000 [0,000; 0,000]');
  });
});

describe('verdict - ket luan chi dua vao khoang tin cay', () => {
  const ci = (lo: number, hi: number) => ({ mean: (lo + hi) / 2, lo, hi, n: 20, positive: 0, negative: 0, ties: 0 });

  it('khoang > 0: nhanh 1 tot hon khi chi so cang cao cang tot, kem hon khi cang thap cang tot', () => {
    expect(verdict(ci(0.01, 0.05), true)).toBe('nhánh 1 tốt hơn');
    expect(verdict(ci(0.01, 0.05), false)).toBe('nhánh 1 kém hơn');
  });

  it('khoang < 0: dao nguoc', () => {
    expect(verdict(ci(-0.05, -0.01), true)).toBe('nhánh 1 kém hơn');
    expect(verdict(ci(-0.05, -0.01), false)).toBe('nhánh 1 tốt hơn');
  });

  it('khoang chua 0 (ke ca cham 0 o mot dau) -> chua phan biet duoc', () => {
    expect(verdict(ci(-0.01, 0.05), true)).toBe('chưa phân biệt được');
    expect(verdict(ci(0, 0.05), true)).toBe('chưa phân biệt được');
    expect(verdict(ci(-0.05, 0), false)).toBe('chưa phân biệt được');
    expect(verdict(ci(0, 0), true)).toBe('chưa phân biệt được');
  });
});

describe('seriesOf / meanOver', () => {
  it('bo hat giong khong co gia tri (null); trung binh cac hat giong con lai; khong co gi -> null', () => {
    const r = arm('a', 'A', [summary({ newcomerParity: 1 }), summary({ newcomerParity: null }), summary({ newcomerParity: 0.5 })]);
    expect(seriesOf(r, (s) => s.newcomerParity)).toEqual([1, 0.5]);
    expect(meanOver(r, (s) => s.newcomerParity)).toBeCloseTo(0.75, 12);
    const none = arm('b', 'B', [summary({ newcomerParity: null }), summary({ newcomerParity: null })]);
    expect(meanOver(none, (s) => s.newcomerParity)).toBeNull();
    expect(seriesOf(r, (s) => s.pOnTime)).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('comparisonTable', () => {
  const seeds = 4;
  const full = arm('full', 'Day du', [0.5, 0.6, 0.55, 0.65].map((p) => summary({ pOnTime: p, regret: 0.2 })));
  const rnd = arm('random', 'Ngau nhien', [0.4, 0.5, 0.45, 0.55].map((p) => summary({ pOnTime: p, regret: 0.3 })));

  it('chenh lech hang so -> khoang co do rong 0; dem hat giong; ket luan theo chieu cua tung chi so', () => {
    const table = comparisonTable([full, rnd], [['full', 'random']]);
    const row = table.split('\n')[2]!;
    expect(row).toContain('Day du − Ngau nhien');
    expect(row).toContain('+0,100 [+0,100; +0,100]'); // 0,5 - 0,4 = ... = 0,1 o ca 4 hat giong
    expect(row).toContain(`${seeds} / 0 / 0`);
    expect(row).toContain('-0,100 [-0,100; -0,100]'); // hoi tiec 0,2 - 0,3
    // Ca hai chi so deu "nhanh 1 tot hon" (P cao hon, hoi tiec thap hon)
    expect(row.match(/nhánh 1 tốt hơn/g)).toHaveLength(2);
  });

  it('dao chieu: doi cho hai nhanh thi doi dau va ket luan', () => {
    const row = comparisonTable([full, rnd], [['random', 'full']]).split('\n')[2]!;
    expect(row).toContain('-0,100 [-0,100; -0,100]');
    expect(row).toContain(`0 / ${seeds} / 0`);
    expect(row.match(/nhánh 1 kém hơn/g)).toHaveLength(2);
  });

  it('cung ket qua -> chua phan biet duoc; thieu nhanh -> bao loi ro rang', () => {
    const twin = arm('twin', 'Song sinh', full.perSeed.map((s) => ({ ...s })));
    const row = comparisonTable([full, twin], [['full', 'twin']]).split('\n')[2]!;
    expect(row).toContain(`0 / 0 / ${seeds}`);
    expect(row.match(/chưa phân biệt được/g)).toHaveLength(2);
    expect(() => comparisonTable([full], [['full', 'khong-co']])).toThrow(/khong-co/);
  });

  it('nam phep so sanh chinh da dang ky deu la (full, nhanh khac) - khong ai them bot am tham', () => {
    expect(PRIMARY_COMPARISONS).toEqual([
      ['full', 'random'],
      ['full', 'most-free'],
      ['full', 'most-frequent'],
      ['full', 'exp-only'],
      ['full', 'load-only'],
    ]);
  });
});

describe('closedLoopTable / historyTable', () => {
  const rows = [
    arm('a', 'A', [summary({ top1: 0.4, top3: 0.7, mrr: 0.6, regret: 0.25, giniAssigned: 0.3, maxShareAssigned: 0.35, maxShareTop: 0.45, newcomerParity: 0.5, onTimeRealised: 0.42 }),
      summary({ top1: 0.6, top3: 0.9, mrr: 0.8, regret: 0.15, giniAssigned: 0.1, maxShareAssigned: 0.25, maxShareTop: 0.45, newcomerParity: 1.5, onTimeRealised: 0.48 })]),
  ];

  it('moi nhanh mot dong, dung dinh dang o tung cot', () => {
    const lines = closedLoopTable(rows).split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('P(đúng hạn) [95% CI]');
    const cells = lines[2]!.split(' | ').map((c) => c.replace(/^\| /, '').replace(/ \|$/, ''));
    expect(cells[0]).toBe('A');
    expect(cells[1]).toMatch(/^0,500 \[/);
    expect(cells[2]).toBe('0,200'); // hoi tiec trung binh
    expect(cells[3]).toBe('50,0%'); // top-1
    expect(cells[4]).toBe('80,0%'); // top-3
    expect(cells[5]).toBe('0,700'); // MRR
    expect(cells[6]).toBe('0,200'); // Gini
    expect(cells[7]).toBe('30,0%'); // nguoi nhieu nhat
    expect(cells[8]).toBe('1,00'); // nguoi moi
    expect(cells[9]).toBe('45,0%'); // dung han thuc
  });

  it('khong co nguoi moi o hat giong nao -> gach ngang, khong phai "NaN"', () => {
    const line = closedLoopTable([arm('a', 'A', [summary({ newcomerParity: null }), summary({ newcomerParity: null })])]).split('\n')[2]!;
    expect(line).toContain('| – |');
    expect(line).not.toMatch(/NaN|undefined|null/);
  });

  it('historyTable: them hai dong tham chieu lay tu nhanh dau tien (phan cong that, ngau nhien ky vong)', () => {
    const base = arm('full', 'Day du', [
      summary({ giniTop: 0.31, maxShareTop: 0.33, pOnTimeAssigned: 0.52, regretAssigned: 0.13, top1Assigned: 0.55, giniAssigned: 0.24, maxShareAssigned: 0.27, chancePOnTime: 0.38, chanceRegret: 0.32, chanceTop1: 0.19 }),
      summary({ giniTop: 0.31, maxShareTop: 0.33, pOnTimeAssigned: 0.52, regretAssigned: 0.13, top1Assigned: 0.55, giniAssigned: 0.24, maxShareAssigned: 0.27, chancePOnTime: 0.38, chanceRegret: 0.32, chanceTop1: 0.19 }),
    ]);
    const lines = historyTable([base], ['full']).split('\n');
    expect(lines).toHaveLength(5); // tieu de + dong ke + 1 nhanh + 2 tham chieu
    // Dong cua chinh nhanh: chat luong GOI Y va do tap trung cua goi y (giniTop 0,31 / maxShareTop 0,33 trong `summary`)
    const armCells = lines[2]!.split(' | ').map((c) => c.replace(/^\| /, '').replace(/ \|$/, ''));
    expect(armCells[0]).toBe('Day du');
    expect(armCells[2]).toBe('0,200'); // hoi tiec cua goi y
    expect(armCells[3]).toBe('50,0%'); // top-1
    expect(armCells[4]).toBe('80,0%'); // top-3
    expect(armCells[5]).toBe('0,650'); // MRR
    expect(armCells[6]).toBe('0,310'); // Gini cua goi y
    expect(armCells[7]).toBe('33,0%'); // nguoi nhieu nhat cua goi y
    const actual = lines[3]!;
    expect(actual).toContain('phân công thật');
    expect(actual).toContain('0,520');
    expect(actual).toContain('0,130');
    expect(actual).toContain('55,0%');
    expect(actual).toContain('0,240');
    expect(actual).toContain('27,0%');
    const chance = lines[4]!;
    expect(chance).toContain('ngẫu nhiên (kỳ vọng)');
    expect(chance).toContain('0,380');
    expect(chance).toContain('0,320');
    expect(chance).toContain('19,0%');
  });
});

describe('datasetFingerprint', () => {
  it('bang sha256 cua JSON bo du lieu; doi mot the thi ma bam doi; ma bam tong phu thuoc thu tu', () => {
    const a = generateSimulation({ ...DEFAULT_SIM, seed: 9301 });
    const b = generateSimulation({ ...DEFAULT_SIM, seed: 9302 });
    const f = datasetFingerprint([a, b]);
    expect(f.perSeed[0]).toBe(createHash('sha256').update(JSON.stringify(a)).digest('hex'));
    expect(f.perSeed[1]).not.toBe(f.perSeed[0]);
    expect(f.combined).toBe(createHash('sha256').update(f.perSeed.join('\n')).digest('hex'));
    expect(datasetFingerprint([b, a]).combined).not.toBe(f.combined);
    const tweaked = { ...a, cards: a.cards.map((c, i) => (i === 0 ? { ...c, title: c.title + '!' } : c)) };
    expect(datasetFingerprint([tweaked, b]).perSeed[0]).not.toBe(f.perSeed[0]);
    expect(datasetFingerprint([a, b])).toEqual(f);
  });

  it('DONG BANG: 20 bo du lieu danh gia 2001-2020 khong duoc doi', () => {
    const ds = EVAL_SEEDS.map((seed) => generateSimulation({ ...DEFAULT_SIM, seed }));
    expect(datasetFingerprint(ds).combined).toBe(FROZEN_EVAL_SHA256);
  });
});

describe('buildArmsReport', () => {
  it('phan biet ngay lap bao cao voi thoi diem chay that duoc luu trong cache', () => {
    const m: ReportMeta = {
      ...meta(20), date: '2026-10-06', sourceSha256: 'source-v1', nodeVersion: 'v22.0.0',
      experimentRuns: { arms: '2026-09-21T12:00:00.000Z' },
    };
    const text = buildArmsReport({ meta: m, closed: allArms(20), history: allArms(20) });
    expect(text).toContain('Ngày lập báo cáo 2026-10-06');
    expect(text).toContain('`arms`: 2026-09-21T12:00:00.000Z');
    expect(text).toContain('sha256 mã nguồn `source-v1`');
    expect(text).not.toContain('Ngày chạy 2026-10-06');
  });

  it('du cac muc, dong dau ghi ngay / so hat giong / ma bam; 20 hat giong thi khong co canh bao', () => {
    const text = buildArmsReport({ meta: meta(20), closed: allArms(20), history: allArms(20) });
    for (const h of ['## 1. ', '## 2. ', '## 3. ', '## 4. ', '## Giới hạn']) expect(text).toContain(h);
    expect(text).toContain('Ngày chạy 2026-09-21');
    expect(text).toContain('20 hạt giống (2001–2020)');
    expect(text).toContain('từ ngày 60');
    expect(text).toContain('0,06');
    expect(text).toContain('`abcdef0123456789…`');
    expect(text).not.toContain('Cảnh báo');
    expect(text).not.toMatch(/NaN|undefined|null/);
  });

  it('it hon 20 hat giong -> co canh bao; so hat giong trong tieu de va phan gioi han dung', () => {
    const text = buildArmsReport({ meta: meta(5), closed: allArms(5), history: allArms(5) });
    expect(text).toContain('Cảnh báo');
    expect(text).toContain('chỉ 5 hạt giống');
    expect(text).toContain('Khoảng tin cậy tính trên 5 hạt giống');
  });

  /** So dong du lieu cua BANG DAU TIEN trong mot muc (bo dong tieu de va dong ke). */
  const firstTableRows = (text: string, start: string, end: string): string[] => {
    const lines = text.slice(text.indexOf(start), text.indexOf(end)).split('\n');
    const from = lines.findIndex((l) => l.startsWith('| Nhánh'));
    const table: string[] = [];
    for (let i = from; i < lines.length && lines[i]!.startsWith('|'); i += 1) table.push(lines[i]!);
    return table.slice(2);
  };

  it('ranh gioi canh bao: 19 hat giong van bi canh bao, 20 thi khong', () => {
    expect(buildArmsReport({ meta: meta(19), closed: allArms(19), history: allArms(19) })).toContain('Cảnh báo');
    expect(buildArmsReport({ meta: meta(20), closed: allArms(20), history: allArms(20) })).not.toContain('Cảnh báo');
  });

  it('thu tu cac nhanh trong bang 1 va bang cat bo dung nhu da dang ky', () => {
    const text = buildArmsReport({ meta: meta(6), closed: allArms(6), history: allArms(6) });
    const labels = (start: string, end: string) => {
      const lines = text.slice(text.indexOf(start), text.indexOf(end)).split('\n');
      const from = lines.findIndex((l) => l.startsWith('| Nhánh'));
      const rows: string[] = [];
      for (let i = from + 2; i < lines.length && lines[i]!.startsWith('|'); i += 1) rows.push(lines[i]!.split(' | ')[0]!.replace(/^\| /, ''));
      return rows;
    };
    expect(labels('## 1. ', '## 2. ')).toEqual([
      'random', 'round-robin', 'most-free', 'most-frequent', 'exp-only', 'load-only', 'full', 'best-skill', 'oracle',
    ].map((id) => `Nhanh ${id}`));
    expect(labels('## 3. ', '## 4. ')).toEqual([
      'full', 'no-avail', 'no-rel', 'no-exp', 'exp-only', 'rel-only', 'load-only',
    ].map((id) => `Nhanh ${id}`));
  });

  it('bang 1 co du 7 nhanh chinh + 2 tham chieu; bang 3 (cat bo) co du 7 dong; thieu nhanh thi bao loi', () => {
    const text = buildArmsReport({ meta: meta(6), closed: allArms(6), history: allArms(6) });
    expect(firstTableRows(text, '## 1. ', '## 2. ')).toHaveLength(9);
    expect(firstTableRows(text, '## 3. ', '## 4. ')).toHaveLength(7);
    // Bang doi chieu HISTORY: 9 nhanh + 2 dong tham chieu
    expect(firstTableRows(text, '## 4. ', '## Giới hạn')).toHaveLength(11);
    expect(() => buildArmsReport({ meta: meta(6), closed: allArms(6).filter((r) => r.id !== 'oracle' && r.id !== 'full'), history: allArms(6) })).toThrow(/full/);
  });

  it('muc cat bo co ba phep so sanh cap voi nhanh day du, dung thu tu', () => {
    const text = buildArmsReport({ meta: meta(6), closed: allArms(6), history: allArms(6) });
    const s3 = text.slice(text.indexOf('## 3. '), text.indexOf('## 4. '));
    const rows = s3.split('\n').filter((l) => l.startsWith('| Nhanh ') && l.includes(' − '));
    expect(rows.map((r) => r.split(' | ')[0]!.replace(/^\| /, ''))).toEqual([
      'Nhanh no-avail − Nhanh full',
      'Nhanh no-rel − Nhanh full',
      'Nhanh no-exp − Nhanh full',
    ]);
  });

  it('khong co nhanh tham chieu thi bo dong tham chieu (khong bat buoc)', () => {
    const noRefs = allArms(6).filter((r) => r.id !== 'best-skill' && r.id !== 'oracle');
    const text = buildArmsReport({ meta: meta(6), closed: noRefs, history: noRefs });
    expect(firstTableRows(text, '## 1. ', '## 2. ')).toHaveLength(7);
    expect(firstTableRows(text, '## 4. ', '## Giới hạn')).toHaveLength(9); // 7 nhanh + 2 dong tham chieu cua phat lai
  });
});
