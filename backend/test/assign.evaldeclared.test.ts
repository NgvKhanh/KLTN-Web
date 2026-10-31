// Buoc 15 - danh gia thanh phan "Ho so" (evalDeclaredRun.ts / evalDeclaredReport.ts). THUAN: khong cham CSDL. Chi chay tren 2 hat
// giong thu (9901, 9902) - so lieu chinh thuc do CLI chay (dev 9801-9820, xac nhan 4001-4020).
import { describe, expect, it } from 'vitest';
import { DEFAULT_WEIGHTS, LEGACY_WEIGHTS_V1 } from '../src/modules/assign/assign.score';
import { scorerArm } from '../src/scripts/evalAssignArms';
import { runArm, type DecisionRecord, type RunResult } from '../src/scripts/evalAssignRun';
import { comparePaired } from '../src/scripts/evalAssignStats';
import {
  ARM_DECLARED_ONLY,
  ARM_FULL3,
  COLD_DONE_MAX,
  CURVES,
  DECLARED_DEV_SEEDS,
  DECLARED_EVAL_SEEDS,
  D_RULE_TOLERANCE,
  D_RULE_W1_MARGIN,
  D_SWEEP,
  MAIN_ARM_IDS,
  P1_MARGIN,
  armFull4,
  chooseD,
  coldCards,
  curve,
  familyWeights,
  liarExperiment,
  mainExperiment,
  meanOnCards,
  missingExperiment,
  prepare,
  primary,
  runOn,
  weakestPerson,
  withProfiles,
  type DSweepRow,
} from '../src/scripts/evalDeclaredRun';
import {
  breakEven,
  buildConfirmReport,
  buildDevReport,
  curveTable,
  dSweepTable,
  missingTable,
  primaryTable,
} from '../src/scripts/evalDeclaredReport';
import { skillAt } from '../src/scripts/simGenerator';

const near = (a: number, b: number) => Math.abs(a - b) < 1e-12;

describe('hang so dang ky truoc (§17.10)', () => {
  it('hat giong dev 9801-9820, xac nhan 4001-4020; quet d; W3 <= 2 the; luat chon d 0,002 / 0,005; P1 -0,005', () => {
    expect([DECLARED_DEV_SEEDS[0], DECLARED_DEV_SEEDS.at(-1), DECLARED_DEV_SEEDS.length]).toEqual([9801, 9820, 20]);
    expect([DECLARED_EVAL_SEEDS[0], DECLARED_EVAL_SEEDS.at(-1), DECLARED_EVAL_SEEDS.length]).toEqual([4001, 4020, 20]);
    expect(D_SWEEP).toEqual([0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4]);
    expect([COLD_DONE_MAX, D_RULE_TOLERANCE, D_RULE_W1_MARGIN, P1_MARGIN]).toEqual([2, 0.002, 0.005, -0.005]);
    expect(CURVES).toEqual({ pOver: [0, 0.15, 0.3, 0.5, 0.7], overlap: [0.1, 0.3, 0.5, 0.7, 0.9], pNone: [0, 0.3, 0.6, 0.9] });
  });

  it('familyWeights: d = 0 -> dung bo cu; d = 0,2 -> mac dinh san pham; d ngoai [0, 1) -> loi', () => {
    expect(familyWeights(0)).toEqual(LEGACY_WEIGHTS_V1);
    const w = familyWeights(0.2);
    for (const k of ['experience', 'reliability', 'availability', 'declared'] as const) expect(near(w[k], DEFAULT_WEIGHTS[k])).toBe(true);
    for (const bad of [-0.01, 1, Number.NaN]) expect(() => familyWeights(bad)).toThrow(RangeError);
  });
});

describe('chooseD - luat chon d (cach doc chot o buoc 15)', () => {
  const row = (d: number, w1: number, w2: number): DSweepRow => ({ d, w1: [w1, w1], w2: [w2, w2] });

  it('binh thuong: d NHO NHAT trong 0,002 cua W2 tot nhat', () => {
    const c = chooseD([row(0, 0.5, 0.4), row(0.1, 0.5, 0.45), row(0.2, 0.5, 0.451), row(0.3, 0.5, 0.44)]);
    expect(c).toMatchObject({ d: 0.1, bestW2D: 0.2, admissible: [0, 0.1, 0.2, 0.3], eligible: [0.1, 0.2], productD: 0.1 });
  });

  it('W2 tot nhat bi loai vi kem W1 -> tim trong tap con lai (hai dieu kien doc NOI TIEP, khong bao gio rong)', () => {
    const c = chooseD([row(0, 0.5, 0.4), row(0.1, 0.499, 0.43), row(0.3, 0.49, 0.5)]);
    expect(c).toMatchObject({ d: 0.1, bestW2D: 0.3, admissible: [0, 0.1], eligible: [0.1] });
    // Doc "giao" nhu chu nghia den se RONG o day: 0,3 la tot nhat W2 nhung kem W1; 0,1 khong trong 0,002 cua 0,5
  });

  it('chi d = 0 qua duoc -> d = 0, san pham de muc san 0,05 (ket luan "khong dang dua vao mac dinh")', () => {
    const c = chooseD([row(0, 0.5, 0.4), row(0.2, 0.49, 0.5)]);
    expect(c).toMatchObject({ d: 0, eligible: [0], productD: 0.05 });
    expect(chooseD([row(0, 0.5, 0.4), row(0.2, 0.49, 0.5)], 0.07).productD).toBe(0.07);
  });

  it('bien: dung trong nguong thi van tinh (>=), vuot 1e-9 thi khong', () => {
    const eps = 1e-9;
    expect(chooseD([row(0, 0.5, 0.4), row(0.1, 0.5 - D_RULE_W1_MARGIN + eps, 0.5)]).d).toBe(0.1);
    expect(chooseD([row(0, 0.5, 0.4), row(0.1, 0.5 - D_RULE_W1_MARGIN - eps, 0.5)]).d).toBe(0);
    expect(chooseD([row(0, 0.5, 0.4), row(0.1, 0.5, 0.45 - D_RULE_TOLERANCE + eps), row(0.2, 0.5, 0.45)]).d).toBe(0.1);
    expect(chooseD([row(0, 0.5, 0.4), row(0.1, 0.5, 0.45 - D_RULE_TOLERANCE - eps), row(0.2, 0.5, 0.45)]).d).toBe(0.2);
  });

  it('DUNG BANG nguong (tinh cung phep tinh) van tinh ca hai dieu kien - ">=" chu khong phai ">"', () => {
    const w1Edge = 0.5 - D_RULE_W1_MARGIN;
    expect(chooseD([row(0, 0.5, 0.4), row(0.1, w1Edge, 0.5)]).d).toBe(0.1);
    const w2Edge = 0.45 - D_RULE_TOLERANCE;
    expect(chooseD([row(0, 0.5, 0.4), row(0.1, 0.5, w2Edge), row(0.2, 0.5, 0.45)]).d).toBe(0.1);
  });

  it('dung TRUNG BINH theo hat giong; thu tu dong khong anh huong; thieu d = 0 / rong -> loi', () => {
    const rows: DSweepRow[] = [
      { d: 0.2, w1: [0.4, 0.6], w2: [0.5, 0.4] }, // tb W2 0,45
      { d: 0, w1: [0.5, 0.5], w2: [0.3, 0.3] },
      { d: 0.1, w1: [0.3, 0.7], w2: [0.44, 0.459] }, // tb W2 0,4495 -> trong 0,002
    ];
    expect(chooseD(rows).d).toBe(0.1);
    expect(chooseD([...rows].reverse()).d).toBe(0.1);
    expect(() => chooseD([])).toThrow(RangeError);
    expect(() => chooseD([row(0.1, 0.5, 0.5)])).toThrow(/d = 0/);
  });
});

describe('W3 va so sanh chinh', () => {
  const rec = (cardKey: string, bestDoneCount: number, p: number) => ({ cardKey, bestDoneCount, pOnTimeAssigned: p }) as DecisionRecord;
  const fake = (ds: DecisionRecord[]) => ({ decisions: ds }) as RunResult;

  it('coldCards: the co nguoi tot nhat <= 2 the da xong (bien 2 tinh, 3 khong); meanOnCards tren dung cac the do', () => {
    const base = fake([rec('a', 0, 0.2), rec('b', 2, 0.4), rec('c', 3, 0.9), rec('d', 7, 0.1)]);
    const keys = coldCards(base);
    expect([...keys]).toEqual(['a', 'b']);
    expect(meanOnCards(base, keys)).toBeCloseTo(0.3, 12);
    const other = fake([rec('a', 9, 0.6), rec('b', 9, 0.8), rec('c', 0, 0)]);
    expect(meanOnCards(other, keys)).toBeCloseTo(0.7, 12); // cung the, bat ke bestDoneCount cua nhanh kia
    expect(meanOnCards(other, new Set(['zz']))).toBeNull();
    expect([...coldCards(base, 0)]).toEqual(['a']);
  });

  it('primary: dat khi CAN DUOI > nguong (P1 dung nguong am, P2-P4 dung 0)', () => {
    const a = [0.5, 0.51, 0.52, 0.5, 0.49];
    const b = [0.5, 0.5, 0.5, 0.5, 0.5];
    const c = comparePaired(a, b);
    expect(primary('P1', 'x', 'W1', a, b, P1_MARGIN)).toMatchObject({ pass: c.lo > P1_MARGIN, threshold: -0.005 });
    expect(primary('P2', 'x', 'W2', a, b, 0).pass).toBe(c.lo > 0);
    expect(primary('P1', 'x', 'W1', b, a, P1_MARGIN).pass).toBe(comparePaired(b, a).lo > -0.005);
    // Can duoi DUNG BANG nguong -> KHONG dat (tieu chi la ">")
    const same = [0.5, 0.5, 0.5];
    expect(primary('P2', 'x', 'W2', same, same, 0)).toMatchObject({ pass: false, comparison: { lo: 0 } });
  });
});

describe('chay that tren 2 hat giong thu (9901, 9902)', () => {
  const datasets = [prepare(9901), prepare(9902)];

  it('trong so cua tung nhanh: day-du-3 = bo cu, day-du-4 = ho mac dinh, chi-Ho-so = (0; 0; 0; 1)', () => {
    expect(ARM_FULL3.make().weights!()).toEqual(LEGACY_WEIGHTS_V1);
    expect(armFull4(0.3).make().weights!()).toEqual(familyWeights(0.3));
    expect(ARM_DECLARED_ONLY.make().weights!()).toEqual({ experience: 0, reliability: 0, availability: 0, declared: 1 });
  });

  it('runOn: W1 / W2 khac nhau; day-du-3 KHONG phu thuoc ho so (trong so Ho so = 0)', () => {
    const ds = datasets[0]!;
    const plain = runArm(ds.data, () => scorerArm({ id: 'x', label: 'x', weights: LEGACY_WEIGHTS_V1 }), { mode: 'ARM' });
    expect(runOn(ds, ARM_FULL3, 'W1').summary).toEqual(plain.summary);
    expect(runOn(withProfiles(ds, { overlap: 1, pNone: 0 }), ARM_FULL3, 'W1').summary).toEqual(plain.summary);
    expect(runOn(ds, ARM_FULL3, 'W2').summary).not.toEqual(plain.summary);
    expect(runOn(ds, armFull4(0.2), 'W1').summary).not.toEqual(plain.summary);
  });

  it('mainExperiment: moi nhanh x the gioi co 2 hat giong; W3 do tren CUNG the; 4 so sanh chinh dung cap nhanh / the gioi', () => {
    const m = mainExperiment(datasets, 0.2);
    for (const w of ['W1', 'W2'] as const) for (const id of MAIN_ARM_IDS) expect(m.summaries[w][id]).toHaveLength(2);
    expect(m.w3.seedsWithCold).toBe(m.w3.full3.length);
    expect(m.w3.full4).toHaveLength(m.w3.full3.length);
    expect(m.primary.map((p) => p.id)).toEqual(m.w3.full3.length >= 2 ? ['P1', 'P2', 'P3', 'P4'] : ['P1', 'P2', 'P4']);
    const p = (w: 'W1' | 'W2', id: (typeof MAIN_ARM_IDS)[number]) => m.summaries[w][id].map((s) => s.pOnTimeAssigned);
    expect(m.primary[0]!.comparison.mean).toBeCloseTo(comparePaired(p('W1', 'full-4'), p('W1', 'full-3')).mean, 12);
    expect(m.primary[1]!.comparison.mean).toBeCloseTo(comparePaired(p('W2', 'full-4'), p('W2', 'full-3')).mean, 12);
    expect(m.primary.at(-1)!.comparison.mean).toBeCloseTo(comparePaired(p('W2', 'declared-only'), p('W2', 'random')).mean, 12);
    // Tham chieu toi uu khong thua nhanh nao
    for (const id of MAIN_ARM_IDS) for (const w of ['W1', 'W2'] as const) {
      expect(m.summaries[w].oracle.map((s) => s.pOnTimeAssigned).every((x, i) => x >= m.summaries[w][id][i]!.pOnTimeAssigned - 1e-12)).toBe(true);
    }
    // W3 = trung binh tren cac the lanh cua the gioi day-du-3
    const base = runOn(datasets[0]!, ARM_FULL3, 'W1');
    const keys = coldCards(base);
    expect(keys.size).toBeGreaterThan(0);
    expect(m.w3.full3[0]).toBeCloseTo(meanOnCards(base, keys)!, 12);
    // day-du-4 do tren CUNG cac the lanh cua day-du-3 (khong phai the lanh cua the gioi chinh no) - moi hat giong
    let distinguishing = 0;
    datasets.forEach((ds, i) => {
      const k3 = coldCards(runOn(ds, ARM_FULL3, 'W1'));
      const f4 = runOn(ds, armFull4(0.2), 'W1');
      expect(m.w3.full4[i]).toBeCloseTo(meanOnCards(f4, k3)!, 12);
      if (Math.abs(meanOnCards(f4, coldCards(f4))! - meanOnCards(f4, k3)!) > 1e-9) distinguishing += 1;
    });
    expect(distinguishing).toBeGreaterThan(0); // it nhat mot hat giong ma "the lanh cua chinh no" cho so khac
  });

  it('curve: mot diem cho moi muc; chenh lech = day-du-4 (ho so theo muc) - day-du-3', () => {
    const full3 = datasets.map((ds) => runOn(ds, ARM_FULL3, 'W2').summary.pOnTimeAssigned);
    const pts = curve(datasets, 0.2, 'pNone', 'W2', full3);
    expect(pts.map((p) => p.value)).toEqual(CURVES.pNone);
    const at = pts.find((p) => p.value === 0.9)!;
    const want = datasets.map((ds) => runOn(withProfiles(ds, { pNone: 0.9 }), armFull4(0.2), 'W2').summary.pOnTimeAssigned);
    expect(at.full4).toEqual(want);
    expect(at.diff.mean).toBeCloseTo(comparePaired(want, full3).mean, 12);
  });

  it('weakestPerson = ky nang an trung binh luc vao thap nhat; nguoi khai qua / DROP-NEUTRAL-ZERO dung cau truc', () => {
    const data = datasets[0]!.data;
    const w = weakestPerson(data);
    const avg = (key: string) => {
      const p = data.people.find((x) => x.key === key)!;
      return p.skills.reduce((s, _, t) => s + skillAt(p, t, p.joinedDay), 0) / p.skills.length;
    };
    expect(data.people.every((p) => avg(w) <= avg(p.key))).toBe(true);
    const liar = liarExperiment(datasets, 0.2, 'W1');
    for (const xs of [liar.shareHonest, liar.shareLiar, liar.shareFull3]) {
      expect(xs).toHaveLength(2);
      expect(xs.every((x) => x >= 0 && x <= 1)).toBe(true);
    }
    expect(liar.diff.mean).toBeCloseTo(comparePaired(liar.withLiar, liar.honest).mean, 12);
    const rows = missingExperiment(datasets, 0.2);
    expect(rows.map((r) => `${r.world}/${r.policy}`)).toEqual(['W1/DROP', 'W1/NEUTRAL', 'W1/ZERO', 'W2/DROP', 'W2/NEUTRAL', 'W2/ZERO']);
    // NEUTRAL = mac dinh cua bo cham -> trung day-du-4 khong truyen missing; DROP / ZERO dung chinh sach cua dong
    const run = (policy: 'DROP' | 'ZERO') => datasets.map((ds) => runOn(ds, armFull4(0.2, { declared: policy }), 'W1').summary.pOnTimeAssigned);
    expect(rows[1]!.pOnTime).toEqual(datasets.map((ds) => runOn(ds, armFull4(0.2), 'W1').summary.pOnTimeAssigned));
    expect(rows[0]!.pOnTime).toEqual(run('DROP'));
    expect(rows[2]!.pOnTime).toEqual(run('ZERO'));
    expect(rows[0]!.pOnTime).not.toEqual(rows[1]!.pOnTime); // phep so co y nghia: ba cach cho so khac nhau tren 2 hat giong nay
  });
});

describe('bao cao', () => {
  const rows: DSweepRow[] = [
    { d: 0, w1: [0.5, 0.52], w2: [0.4, 0.42] },
    { d: 0.1, w1: [0.51, 0.52], w2: [0.45, 0.46] },
    { d: 0.3, w1: [0.4, 0.41], w2: [0.5, 0.5] },
  ];
  const choice = chooseD(rows);

  it('dSweepTable / buildDevReport: danh dau dung dong (chon / qua W1 / kem W1), neo dung o', () => {
    const t = dSweepTable(rows, choice);
    expect(t).toContain('| 0,10 | 0,515');
    expect(t).toMatch(/\| 0,10 \|[^\n]*\| \*\*chọn\*\* \|/);
    expect(t).toMatch(/\| 0,00 \|[^\n]*\| – \| qua W1 \|/);
    expect(t).toMatch(/\| 0,30 \|[^\n]*\| kém W1 \|/);
    const r = buildDevReport({ date: '2026-09-28', seeds: [9801, 9802], datasetSha256: 'a'.repeat(64), profileSha256: 'b'.repeat(64) }, rows, choice);
    expect(r).toContain('**Chọn `d` = 0,10**');
    expect(r).toContain('(9801–9802)');
    expect(r).toContain('Cách đọc chốt trước khi chạy pha này');
  });

  it('primaryTable: ĐẠT / KHÔNG ĐẠT theo can duoi; breakEven = muc dau tien khong con hon', () => {
    const good = primary('P2', 'a − b', 'W2', [0.6, 0.61, 0.62], [0.5, 0.5, 0.5], 0);
    const bad = primary('P4', 'a − b', 'W2', [0.5, 0.49, 0.51], [0.5, 0.5, 0.5], 0);
    const t = primaryTable([good, bad]);
    expect(t).toMatch(/\| P2 \|[^\n]*\| \*\*ĐẠT\*\* \|/);
    expect(t).toMatch(/\| P4 \|[^\n]*\| KHÔNG ĐẠT \|/);
    const pt = (value: number, diffMean: number) => ({ value, full4: [0.5], diff: { mean: diffMean, lo: diffMean, hi: diffMean, n: 1, positive: 0, negative: 0, ties: 0 } });
    expect(breakEven([pt(0, 0.02), pt(0.3, 0.001), pt(0.5, 0), pt(0.7, -0.01)])).toBe(0.5);
    expect(breakEven([pt(0, 0.02), pt(0.3, 0.01)])).toBeNull();
    expect(curveTable('pOver', 'W2', [pt(0, 0.02), pt(0.5, -0.01)])).toContain('điểm hoà vốn (mức đầu tiên mà đầy đủ-4 không còn hơn trung bình) = 0,50');
  });

  it('missingTable: NEUTRAL la moc (–), hai cach con lai tru NEUTRAL; buildConfirmReport co du cac muc', () => {
    const rows2 = [
      { policy: 'DROP' as const, world: 'W1' as const, pOnTime: [0.5, 0.6], newcomerParity: [1, null] },
      { policy: 'NEUTRAL' as const, world: 'W1' as const, pOnTime: [0.4, 0.5], newcomerParity: [0.5, 0.7] },
    ];
    const t = missingTable(rows2);
    expect(t).toMatch(/\| NEUTRAL \(mặc định\) \|[^\n]*\| – \| 0,60 \|/);
    expect(t).toMatch(/\| DROP \|[^\n]*\| \+0,100 \[\+0,100; \+0,100\] \| 1,00 \|/);
    const datasets = [prepare(9901), prepare(9902)];
    const main = mainExperiment(datasets, 0.2);
    const report = buildConfirmReport({
      meta: { date: '2026-09-28', seeds: [4001, 4002], datasetSha256: 'a'.repeat(64), profileSha256: 'b'.repeat(64) },
      main,
      curves: [],
      liar: [],
      missing: rows2,
    });
    for (const h of ['## Bốn so sánh chính', '### W1 — mặc định', '### W2 — nhóm mới', '## Người không khai', '## Giới hạn']) expect(report).toContain(h);
    expect(report).toContain(`**${main.primary.filter((p) => p.pass).length}/${main.primary.length} so sánh đạt tiêu chí.**`);
    expect(report).toContain('`d` = 0,20');
  });
});
