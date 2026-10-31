// Buoc 7b - cac thi nghiem (evalAssignExperiments.ts). THUAN: khong cham CSDL. Kiem CAC KHAI BAO diem do (tham so, nhom, mac dinh,
// the gioi) va vong lap chung tren vai bo nho - khong chay ca 20 hat giong (viec do la cua CLI).
import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, LEGACY_WEIGHTS_V1 } from '../src/modules/assign/assign.score';
import { countTerms } from '../src/modules/assign/assign.text';
import {
  DENSITIES,
  LOAD_PENALTIES,
  PARAM_SPECS,
  PERTURBATIONS,
  TEXT_VARIANTS,
  densityPoints,
  etaSweepPoints,
  learningTarget,
  loadPenaltyPoints,
  mainLearningPoints,
  makeDatasetProvider,
  normalizationPoints,
  paramSweepPoints,
  rawSpacePoints,
  robustnessPoints,
  runLearnedObjective,
  runLearning,
  runSweep,
  runTextVariants,
  weightGrid,
  weightsGridPoints,
  worldKey,
  type SweepPoint,
} from '../src/scripts/evalAssignExperiments';
import { PERSONAS, biasedLeader, l1Distance, learningArm } from '../src/scripts/evalAssignLeader';
import { runArm } from '../src/scripts/evalAssignRun';
import { WEIGHT_MAX, WEIGHT_MIN } from '../src/modules/assign/assign.weights';
import { DEFAULT_SIM } from '../src/scripts/simGenerator';
import { neighbourAccuracy } from '../src/scripts/simTextEval';
import { scorerArm } from '../src/scripts/evalAssignArms';

const SMALL = { boards: 3, cardsPerBoard: 14, days: 200 } as const;

/** Moi nhom co DUNG MOT diem mac dinh (de tinh chenh lech cap). */
function oneDefaultPerGroup(points: readonly SweepPoint[]) {
  const groups = new Map<string, SweepPoint[]>();
  for (const p of points) groups.set(p.group, [...(groups.get(p.group) ?? []), p]);
  for (const [group, list] of groups) {
    expect(list.filter((p) => p.isDefault).length, `nhom "${group}"`).toBe(1);
    expect(new Set(list.map((p) => p.label)).size, `nhan trung trong "${group}"`).toBe(list.length);
  }
  return groups;
}

describe('the gioi va bo du lieu', () => {
  it('worldKey: on dinh, khong phu thuoc thu tu khoa, "mac dinh" cho cau hinh rong', () => {
    expect(worldKey(undefined)).toBe('mac dinh');
    expect(worldKey({})).toBe('mac dinh');
    expect(worldKey({ people: 4, boards: 2 })).toBe(worldKey({ boards: 2, people: 4 }));
    expect(worldKey({ people: 4 })).not.toBe(worldKey({ people: 5 }));
    expect(worldKey({ people: 4 })).not.toBe(worldKey({ boards: 4 }));
  });

  it('provider: nho lai (cung doi tuong), phan biet hat giong va the gioi, ap dung cau hinh', () => {
    const get = makeDatasetProvider();
    const a = get(9001, undefined);
    expect(get(9001, undefined)).toBe(a);
    expect(get(9001, {})).toBe(a); // {} va undefined la cung the gioi
    expect(get(9002, undefined)).not.toBe(a);
    const four = get(9001, { people: 4 });
    expect(four).not.toBe(a);
    expect(four.people).toHaveLength(4);
    expect(a.people).toHaveLength(DEFAULT_SIM.people);
    expect(a.config.seed).toBe(9001);
    // Khac cau hinh chi o `world`: van dung hat giong
    expect(four.config.seed).toBe(9001);
  });
});

describe('cac diem quet tham so', () => {
  const points = paramSweepPoints();

  it('moi nhom co dung mot diem mac dinh; gia tri mac dinh la gia tri cua DEFAULT_PARAMS (khong chep tay)', () => {
    const groups = oneDefaultPerGroup(points);
    expect(groups.size).toBe(PARAM_SPECS.length + 1); // + nhom suc chua
    for (const spec of PARAM_SPECS) {
      expect(spec.values).toContain(DEFAULT_PARAMS[spec.key]);
      const g = groups.get(spec.group)!;
      const def = g.find((p) => p.isDefault)!;
      expect(def.label).toBe(String(DEFAULT_PARAMS[spec.key]).replace('.', ','));
      expect(g).toHaveLength(spec.values.length);
    }
  });

  it('cac nhom dung: H, K, m, m_e, simMin; suc chua gia dinh 2/3/5/8 + suc chua that', () => {
    expect(PARAM_SPECS.map((s) => s.key)).toEqual(['halfLifeDays', 'k', 'shrinkage', 'evidenceSaturation', 'simMin']);
    const cap = points.filter((p) => p.group.startsWith('Sức chứa'));
    expect(cap.map((p) => p.label)).toEqual(['sức chứa thật', '2', '3', '5', '8']);
    expect(cap.map((p) => p.opts.assumedCapacity)).toEqual([undefined, 2, 3, 5, 8]);
    expect(points).toHaveLength(5 + 5 + 5 + 5 + 4 + 5);
    for (const p of points) expect(p.opts.mode).toBe('ARM');
  });

  it('luoi quet la DUNG cac gia tri da cong bo (moi diem la mot the nghiem - doi luoi phai la mot quyet dinh co y thuc)', () => {
    expect(PARAM_SPECS.map((s) => [s.key, [...s.values]])).toEqual([
      ['halfLifeDays', [30, 60, 90, 180, 365]],
      ['k', [1, 3, 5, 8, 12]],
      ['shrinkage', [0.5, 1, 3, 6, 12]],
      ['evidenceSaturation', [0.5, 1, 2, 4, 8]],
      ['simMin', [0, 0.05, 0.1, 0.2]],
    ]);
  });

  it('moi diem dat DUNG mot tham so va giu nguyen cac tham so con lai (khong doi hai thu mot luc)', () => {
    // Nhanh duoc tao ra dung bo cham: kiem qua hanh vi, khong doc noi bo - doi H thi thu tu co the doi, nhung khong duoc nem loi
    for (const p of points.slice(0, 6)) {
      const arm = p.make();
      expect(arm.weights!()).toEqual(LEGACY_WEIGHTS_V1);
    }
  });
});

describe('chuan hoa x thieu du lieu', () => {
  it('bon to hop, dung mot mac dinh (min-max / bo thanh phan thieu)', () => {
    const pts = normalizationPoints();
    expect(pts).toHaveLength(4);
    oneDefaultPerGroup(pts);
    expect(pts.find((p) => p.isDefault)!.label).toContain('MẶC ĐỊNH');
    expect(pts.map((p) => p.label).join(' ')).toContain('NEUTRAL');
    expect(pts.map((p) => p.label).join(' ')).toContain('NONE');
  });
});

describe('luoi trong so', () => {
  it('33 bo (a, b, c) la boi cua 0,1 trong [0,1; 0,7], tong 1, khong trung; tat ca hop le voi luat cua san pham', () => {
    const grid = weightGrid();
    expect(grid).toHaveLength(33);
    const keys = new Set<string>();
    for (const w of grid) {
      expect(w.experience + w.reliability + w.availability).toBeCloseTo(1, 12);
      for (const v of [w.experience, w.reliability, w.availability]) {
        expect(v).toBeGreaterThanOrEqual(0.1 - 1e-12);
        expect(v).toBeLessThanOrEqual(0.7 + 1e-12);
        expect(v).toBeGreaterThanOrEqual(WEIGHT_MIN);
        expect(v).toBeLessThanOrEqual(WEIGHT_MAX + 1e-12);
        expect(Math.abs(v * 10 - Math.round(v * 10))).toBeLessThan(1e-9);
      }
      keys.add(`${w.experience}|${w.reliability}|${w.availability}`);
    }
    expect(keys.size).toBe(33);
    // Goc: (0,7; 0,2; 0,1) va (0,4; 0,3; 0,3) co mat, (0,8; 0,1; 0,1) khong
    expect(keys.has('0.7|0.2|0.1')).toBe(true);
    expect(keys.has('0.4|0.3|0.3')).toBe(true);
    expect(keys.has('0.8|0.1|0.1')).toBe(false);
  });

  it('34 diem = 33 luoi + cau hinh mac dinh (0,45 / 0,30 / 0,25), dung mot diem mac dinh', () => {
    const pts = weightsGridPoints();
    expect(pts).toHaveLength(34);
    oneDefaultPerGroup(pts);
    expect(pts[0]!.isDefault).toBe(true);
    expect(pts[0]!.make().weights!()).toEqual(LEGACY_WEIGHTS_V1);
    // Luoi cua buoc 7: moi diem Ho so = 0
    expect(pts.every((p) => p.make().weights!().declared === 0)).toBe(true);
    expect(pts[0]!.label).toContain('0,45 / 0,30 / 0,25');
  });
});

describe('the gioi: phat tai va mat do', () => {
  it('phat tai: 5 muc x 5 nhanh (4 nhanh chinh + bo kha dung), muc dinh 0,06 nam trong luoi; mac dinh cua nhom la nhanh day du', () => {
    expect(LOAD_PENALTIES).toEqual([0, 0.06, 0.12, 0.2, 0.3]);
    const pts = loadPenaltyPoints();
    expect(pts).toHaveLength(LOAD_PENALTIES.length * 5);
    const groups = oneDefaultPerGroup(pts);
    expect(groups.size).toBe(LOAD_PENALTIES.length);
    for (const [, list] of groups) {
      expect(list.map((p) => p.label)).toEqual(['Ngẫu nhiên', 'Người rảnh nhất', 'Chỉ kinh nghiệm', 'Đầy đủ, trọng số cố định', 'Bỏ khả dụng']);
      expect(list.find((p) => p.isDefault)!.label).toBe('Đầy đủ, trọng số cố định');
      expect(new Set(list.map((p) => p.opts.loadPenalty)).size).toBe(1);
    }
    expect(pts.map((p) => p.opts.loadPenalty)).toContain(0.06);
    for (const p of pts) expect(p.opts.mode).toBe('ARM');
  });

  it('mat do: 3 muc (24 = mac dinh, 48, 72), moi muc doi `cardsPerBoard`, 5 nhanh', () => {
    expect(DENSITIES).toEqual([24, 48, 72]);
    expect(DENSITIES).toContain(DEFAULT_SIM.cardsPerBoard);
    const pts = densityPoints();
    expect(pts).toHaveLength(15);
    const groups = oneDefaultPerGroup(pts);
    expect(groups.size).toBe(3);
    expect([...new Set(pts.map((p) => p.world!.cardsPerBoard))]).toEqual([24, 48, 72]);
    for (const p of pts) expect(Object.keys(p.world!)).toEqual(['cardsPerBoard']);
  });
});

describe('do ben truoc nguon lech', () => {
  it('moi nguon lech co muc thap < mac dinh < muc cao (dat hai phia cua gia tri mac dinh cua bo sinh)', () => {
    expect(PERTURBATIONS.map((p) => p.key)).toEqual(['wrongAssignRate', 'ambiguousRate', 'synonymRate', 'typoRate', 'learnerRate', 'people']);
    for (const p of PERTURBATIONS) {
      const def = DEFAULT_SIM[p.key] as number;
      expect(p.low, p.name).toBeLessThan(def);
      expect(p.high, p.name).toBeGreaterThan(def);
    }
  });

  it('cac muc thap / cao la DUNG cac gia tri da cong bo', () => {
    expect(PERTURBATIONS.map((p) => [p.key, p.low, p.high])).toEqual([
      ['wrongAssignRate', 0.05, 0.5],
      ['ambiguousRate', 0, 0.4],
      ['synonymRate', 0, 0.7],
      ['typoRate', 0, 0.3],
      ['learnerRate', 0, 0.7],
      ['people', 4, 10],
    ]);
  });

  it('13 the gioi (mac dinh + 6 nguon x 2 muc) x 4 nhanh = 52 diem; moi the gioi mot nhom co dung mot mac dinh', () => {
    const pts = robustnessPoints();
    expect(pts).toHaveLength(52);
    const groups = oneDefaultPerGroup(pts);
    expect(groups.size).toBe(13);
    expect(pts.slice(0, 4).every((p) => p.world === undefined)).toBe(true); // nhom dau la doi chung mac dinh
    for (const p of pts.slice(4)) expect(Object.keys(p.world!)).toHaveLength(1);
    // Moi the gioi chi doi DUNG mot tham so
    const worlds = new Set(pts.map((p) => worldKey(p.world)));
    expect(worlds.size).toBe(13);
    // Nhan the gioi dung dau phay thap phan kieu Viet, khong co dau cham
    for (const g of groups.keys()) expect(g).not.toMatch(/\d\.\d/);
    expect([...groups.keys()]).toContain('Phân công lịch sử sai: thấp (0,05)');
  });
});

describe('runSweep', () => {
  it('chay tung diem tren tung hat giong, ghi nhom / nhan / mac dinh / the gioi, tat dinh, bao tien do', () => {
    const provider = makeDatasetProvider();
    const pts: SweepPoint[] = [
      { group: 'g', label: 'a', isDefault: true, make: () => scorerArm({ id: 'x', label: 'x' }), opts: { mode: 'ARM', minDay: 30 }, world: SMALL },
      { group: 'g', label: 'b', make: () => scorerArm({ id: 'y', label: 'y', weights: { experience: 1, reliability: 0, availability: 0, declared: 0 } }), opts: { mode: 'ARM', minDay: 30 }, world: SMALL },
    ];
    const lines: string[] = [];
    const r = runSweep([9401, 9402], pts, provider, (l) => lines.push(l));
    expect(r).toHaveLength(2);
    expect(r.map((x) => [x.group, x.label, x.isDefault])).toEqual([['g', 'a', true], ['g', 'b', false]]);
    expect(r[0]!.world).toBe(worldKey(SMALL));
    expect(r[0]!.perSeed).toHaveLength(2);
    expect(r[0]!.perSeed[0]!.decisions).toBeGreaterThan(0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('[g] a');
    expect(runSweep([9401, 9402], pts, makeDatasetProvider())).toEqual(r);
    // Hai diem khac trong so cho ket qua khac
    expect(r[0]!.perSeed).not.toEqual(r[1]!.perSeed);
  });
});

describe('chuoi xu ly van ban', () => {
  it('bay bien the, dung mot mac dinh; mac dinh chinh la countTerms cua san pham (uni + bi-gram, tieu de x2)', () => {
    expect(TEXT_VARIANTS.map((v) => v.id)).toEqual(['default', 'uni', 't1', 't3', 't5', 'title', 'desc']);
    expect(TEXT_VARIANTS.filter((v) => v.isDefault)).toHaveLength(1);
    expect(TEXT_VARIANTS[0]!.isDefault).toBe(true);
  });

  it('ket qua tren 2 bo du lieu: moi bien the mot dong, moi hat giong mot ket qua; mac dinh khop neighbourAccuracy truc tiep', () => {
    const provider = makeDatasetProvider();
    const res = runTextVariants([9501, 9502], provider);
    expect(res).toHaveLength(7);
    for (const r of res) {
      expect(r.perSeed).toHaveLength(2);
      for (const a of r.perSeed) {
        expect(a.top1).toBeGreaterThanOrEqual(0);
        expect(a.top1).toBeLessThanOrEqual(1);
      }
    }
    const direct = neighbourAccuracy(provider(9501, undefined), (c) => countTerms({ title: c.title, description: c.description }));
    expect(res[0]!.perSeed[0]).toEqual(direct);
    // "chi mo ta" kem han "mac dinh" (so lieu buoc 3: 75% so voi 97%) - kiem phep do khong bi lat nguoc
    const by = (id: string) => res.find((r) => r.id === id)!;
    const mean = (r: { perSeed: { top1: number }[] }) => r.perSeed.reduce((s, x) => s + x.top1, 0) / r.perSeed.length;
    expect(mean(by('desc'))).toBeLessThan(mean(by('default')));
  });

  it('ngu nghia tung bien the: trong so tieu de x1 / x2 / x3 / x5, chi tieu de, chi mo ta', () => {
    // Tieu de co mot tu rieng ("bang"), mo ta co mot tu rieng ("bao cao"): so lan dem cua tu = trong so cua truong chua no
    const card = { title: 'bảng', description: 'báo cáo' } as never;
    const variant = (id: string) => TEXT_VARIANTS.find((v) => v.id === id)!.counts(card);
    const titleTerm = [...variant('default').keys()].find((t) => t.includes('bang'))!;
    const descTerm = [...variant('default').keys()].find((t) => t.includes('bao cao') || t.includes('bao'))!;
    expect(titleTerm).toBeDefined();
    expect(descTerm).toBeDefined();
    expect(variant('t1').get(titleTerm)).toBe(1);
    expect(variant('default').get(titleTerm)).toBe(2);
    expect(variant('t3').get(titleTerm)).toBe(3);
    expect(variant('t5').get(titleTerm)).toBe(5);
    for (const id of ['default', 't1', 't3', 't5', 'uni']) expect(variant(id).get(descTerm)).toBe(1); // mo ta luon x1
    // Chi tieu de: khong con thuat ngu cua mo ta; chi mo ta: khong con thuat ngu cua tieu de
    expect(variant('title').has(descTerm)).toBe(false);
    expect(variant('title').get(titleTerm)).toBe(2);
    expect(variant('desc').has(titleTerm)).toBe(false);
    expect(variant('desc').get(descTerm)).toBe(1);
  });

  it('bien the "chi uni-gram" khong con thuat ngu nao co dau cach; cac bien the con lai giu bi-gram', () => {
    const uni = TEXT_VARIANTS.find((v) => v.id === 'uni')!;
    const def = TEXT_VARIANTS[0]!;
    const card = { title: 'Thiết kế cơ sở dữ liệu', description: 'Cần chú ý bảng và chỉ mục.' } as never;
    const u = uni.counts(card);
    expect([...u.keys()].some((t) => t.includes(' '))).toBe(false);
    expect([...def.counts(card).keys()].some((t) => t.includes(' '))).toBe(true);
    expect(u.size).toBeLessThan(def.counts(card).size);
  });
});

describe('thi nghiem hoc', () => {
  const provider = makeDatasetProvider();

  it('cac tap diem hoc: bang chinh 4 gu x 3 muc nhieu = 12; quet eta 2 gu x 2 nhieu x 5 eta = 20; khong gian tho 3', () => {
    const main = mainLearningPoints(0.05);
    expect(main).toHaveLength(12);
    expect(new Set(main.map((p) => `${p.persona}|${p.noise}`)).size).toBe(12);
    expect(main.every((p) => p.eta === 0.05 && p.space === 'SCALED')).toBe(true);
    const eta = etaSweepPoints();
    expect(eta).toHaveLength(20);
    expect([...new Set(eta.map((p) => p.eta))]).toEqual([0.01, 0.02, 0.05, 0.1, 0.2]);
    expect([...new Set(eta.map((p) => p.persona))]).toEqual(['expert', 'control']);
    const raw = rawSpacePoints(0.05);
    expect(raw).toHaveLength(3);
    expect(raw.every((p) => p.space === 'RAW' && p.noise === 0.1)).toBe(true);
  });

  it('muc tieu hoi tu = thien lech cua gu (da hop le nen phep chieu khong doi); doi chung = mac dinh', () => {
    for (const persona of ['expert', 'reliable', 'free', 'control'] as const) {
      expect(l1Distance(learningTarget(persona), { ...PERSONAS[persona].bias, declared: 0 })).toBeCloseTo(0, 9);
      // Bo hoc cua buoc 7 khong cham Ho so (= 0) -> muc tieu cung khong
      expect(learningTarget(persona).declared).toBe(0);
    }
    expect(l1Distance(learningTarget('control'), LEGACY_WEIGHTS_V1)).toBeCloseTo(0, 9);
  });

  it('muc tieu hoi tu: gu nam NGOAI tap trong so hop le -> diem hop le GAN NHAT (bo hoc khong bao gio toi duoc gu tho)', () => {
    // (0,9; 0,05; 0,05) co tong 1 nhung 0,9 vuot tran 0,7: diem hop le gan nhat la (0,7; 0,15; 0,15). PERSONAS chi la `as const` cua
    // KIEU (o thoi gian chay la doi tuong thuong) nen doi tam roi khoi phuc trong finally.
    const bias = PERSONAS.expert.bias as { experience: number; reliability: number; availability: number };
    const saved = { ...bias };
    try {
      Object.assign(bias, { experience: 0.9, reliability: 0.05, availability: 0.05 });
      const t = learningTarget('expert');
      expect(t.experience).toBeCloseTo(0.7, 9);
      expect(t.reliability).toBeCloseTo(0.15, 9);
      expect(t.availability).toBeCloseTo(0.15, 9);
    } finally {
      Object.assign(bias, saved);
    }
    expect({ ...PERSONAS.expert.bias }).toEqual(saved);
  });

  it('runLearning tren 2 bo nho: hinh dang ket qua, nhanh co dinh giu trong so, nhanh co hoc giu bat bien, tat dinh', () => {
    const points = [{ persona: 'free' as const, noise: 0, eta: 0.05, space: 'SCALED' as const }];
    const lines: string[] = [];
    const [res] = runLearning([9601, 9602], points, provider, (l) => lines.push(l));
    expect(lines).toHaveLength(1);
    expect(res!.learned).toHaveLength(2);
    expect(res!.fixed).toHaveLength(2);
    res!.learned.forEach((r, i) => {
      const n = r.trace.distance.length - 1;
      expect(n).toBeGreaterThan(50);
      expect(r.stats.feedback).toBe(n); // moi quyet dinh mot luot phan hoi
      expect(r.stats.learned).toBeLessThanOrEqual(n);
      expect(r.final.experience + r.final.reliability + r.final.availability).toBeCloseTo(1, 9);
      // Nhanh co dinh: trong so khong bao gio doi -> khoang cach khong doi va bang khoang cach ban dau cua nhanh co hoc
      const f = res!.fixed[i]!;
      expect(f.distance).toHaveLength(r.trace.distance.length);
      expect(new Set(f.distance).size).toBe(1);
      expect(f.distance[0]).toBeCloseTo(r.trace.distance[0]!, 12);
      // Mau so "du du lieu" la dac tinh cua THE GIOI nen hai nhanh cung co hoac cung khong co quyet dinh du du lieu o moi phan
      expect(f.acceptFirstThirdComplete === null).toBe(r.trace.acceptFirstThirdComplete === null);
      expect(f.acceptLastThirdComplete === null).toBe(r.trace.acceptLastThirdComplete === null);
      for (const v of [r.trace.acceptFirstThirdComplete, r.trace.acceptLastThirdComplete, f.acceptFirstThirdComplete, f.acceptLastThirdComplete]) {
        if (v !== null) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
      // Nguoi xep dau la nguoi moi: ti le hop le
      for (const v of [r.trace.newcomerTopFirstThird, r.trace.newcomerTopLastThird, f.newcomerTopFirstThird, f.newcomerTopLastThird]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });
    // Cung the gioi: cung nguoi truong nhom chon -> nhanh co dinh va nhanh co hoc thay cung cac quyet dinh
    expect(res!.fixed[0]!.distance.length).toBe(res!.learned[0]!.trace.distance.length);
    const again = runLearning([9601, 9602], points, makeDatasetProvider());
    expect(again[0]).toEqual(res);
  });

  it('cung (gu, nhieu, khong gian) khac eta: nhanh co dinh dung chung (cung ket qua)', () => {
    const points = [
      { persona: 'expert' as const, noise: 0.1, eta: 0.02, space: 'SCALED' as const },
      { persona: 'expert' as const, noise: 0.1, eta: 0.2, space: 'SCALED' as const },
    ];
    const [a, b] = runLearning([9603], points, provider);
    expect(b!.fixed).toBe(a!.fixed); // cung doi tuong (bo nho dem)
    expect(a!.learned[0]!.final).not.toEqual(b!.learned[0]!.final); // nhung eta khac nhau cho trong so khac nhau
  });

  it('nhanh co dinh KHONG dung chung giua hai khong gian dac trung (SCALED / RAW): truong nhom nhin gia tri khac nen chon khac', () => {
    const scaled = { persona: 'expert' as const, noise: 0.1, eta: 0.05, space: 'SCALED' as const };
    const raw = { ...scaled, space: 'RAW' as const };
    const [a, b] = runLearning([9603], [scaled, raw], provider);
    expect(b!.fixed).not.toBe(a!.fixed);
    expect(b!.fixed).not.toEqual(a!.fixed); // truong nhom chon khac -> ti le chap nhan khac
    // Ket qua cua diem RAW khong phu thuoc vao viec diem SCALED da chay truoc hay chua
    const [alone] = runLearning([9603], [raw], makeDatasetProvider());
    expect(b!.fixed).toEqual(alone!.fixed);
  });

  it('runLearning = dung lai bang tay bang cac ham cua module: truong nhom co nhieu CUA DIEM, nhanh co hoc dung eta cua diem', () => {
    const point = { persona: 'expert' as const, noise: 0.25, eta: 0.1, space: 'SCALED' as const };
    const [res] = runLearning([9603], [point], provider);
    const data = provider(9603, undefined);
    const noisy = runArm(data, () => learningArm({ eta: 0.1 }), {
      mode: 'LEADER',
      leader: biasedLeader({ bias: PERSONAS.expert.bias, noise: 0.25, space: 'SCALED' }),
    });
    expect(res!.learned[0]!.final).toEqual(noisy.finalWeights);
    // Nhieu co tac dung that: cung diem, truong nhom khong nhieu cho trong so cuoi khac
    const quiet = runArm(data, () => learningArm({ eta: 0.1 }), {
      mode: 'LEADER',
      leader: biasedLeader({ bias: PERSONAS.expert.bias, noise: 0, space: 'SCALED' }),
    });
    expect(res!.learned[0]!.final).not.toEqual(quiet.finalWeights);
  });

  it('runLearnedObjective: hinh dang ket qua, trong so cuoi hop le, hai nhanh cung so hat giong', () => {
    const r = runLearnedObjective([9701, 9702], 'reliable', 0.1, provider);
    expect(r.persona).toBe('reliable');
    expect(r.noise).toBe(0.1);
    expect(r.learned).toHaveLength(2);
    expect(r.fixed).toHaveLength(2);
    expect(r.finals).toHaveLength(2);
    for (const w of r.finals) {
      expect(w.experience + w.reliability + w.availability).toBeCloseTo(1, 9);
      expect(w.experience).toBeGreaterThanOrEqual(WEIGHT_MIN - 1e-12);
    }
    for (const s of [...r.learned, ...r.fixed]) expect(s.acceptance).toBe(1); // ARM: nhanh tu giao nguoi xep dau
  });

  it('runLearnedObjective: nhanh co hoc THAT SU hoc tu truong nhom (trong so cuoi tien sat gu) du tu giao nguoi xep dau', () => {
    const target = learningTarget('free');
    const start = l1Distance(LEGACY_WEIGHTS_V1, target); // 0,9: mac dinh nghieng ve kinh nghiem, gu nghieng ve kha dung
    const r = runLearnedObjective([9701, 9702], 'free', 0, provider);
    for (const w of r.finals) expect(l1Distance(w, target)).toBeLessThan(0.25 * start);
    // Trong so doi thi goi y doi thi ket qua doi: hai nhanh khong the trung het tung hat giong
    expect(r.learned.some((s, i) => s.pOnTime !== r.fixed[i]!.pOnTime)).toBe(true);
  });
});
