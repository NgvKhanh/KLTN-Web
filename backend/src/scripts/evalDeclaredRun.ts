// Danh gia thanh phan "Ho so" (buoc 15, ASSIGN_MODULE.md §17.10 - DANG KY TRUOC). HAM THUAN: khong Prisma, khong dong ho, khong mang.
//
// Vong kin (che do ARM cua buoc 7): nhanh tu giao nguoi xep dau, ket qua rut tu mo hinh cua bo sinh; chi so chinh = xac suat dung han
// KY VONG cua nguoi duoc giao (pOnTimeAssigned), moi hat giong la mot don vi, so sanh CAP bang bootstrap.
//  W1 mac dinh (giu lich su truoc ngay 60) · W2 nhom moi (coldStart) · W3 quyet dinh LANH = cac the trong W1 ma nguoi tot nhat co
//  <= 2 the da xong luc quyet dinh. Vong kin lam the gioi moi nhanh khac nhau nen "the lanh" duoc xac dinh TREN THE GIOI CUA NHANH
//  DAY-DU-3 (moc chung) roi do moi nhanh tren CUNG cac the do (so sanh cap).
//
// DOC ky nang an (qua bo chay / oracle / chon nguoi khai qua) - chi nam trong scripts/.

import { LEGACY_WEIGHTS_V1, type ComponentKey, type MissingPolicy, type Weights } from '../modules/assign/assign.score';
import type { DeclaredItem } from '../modules/assign/assign.declared';
import { MAIN_ARMS, scorerArm, type Arm } from './evalAssignArms';
import { oracleArm, runArm, type RunResult, type RunSummary } from './evalAssignRun';
import { comparePaired, mean, type PairedComparison } from './evalAssignStats';
import { declaredItemsByPerson, generateDeclaredProfiles, type DeclaredSimConfig } from './simDeclared';
import { DEFAULT_SIM, generateSimulation, skillAt, type SimDataset } from './simGenerator';

/** Hat giong DEV de chon d (§17.10: 93xx-97xx da dung lam du lieu thu). */
export const DECLARED_DEV_SEEDS: readonly number[] = Array.from({ length: 20 }, (_, i) => 9801 + i);
/** Hat giong XAC NHAN - chay MOT lan voi cau hinh da chot. */
export const DECLARED_EVAL_SEEDS: readonly number[] = Array.from({ length: 20 }, (_, i) => 4001 + i);
/** Cac muc d quet (dang ky truoc). */
export const D_SWEEP: readonly number[] = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4];
/** Quyet dinh "lanh" (W3): nguoi tot nhat co toi da chung nay the da xong. */
export const COLD_DONE_MAX = 2;
/** Luat chon d: trong pham vi nay cua gia tri W2 tot nhat... */
export const D_RULE_TOLERANCE = 0.002;
/** ...va khong kem d = 0 qua muc nay o W1. */
export const D_RULE_W1_MARGIN = 0.005;
/** Tieu chi dang ky truoc: P1 "khong kem hon" = can duoi khoang tin cay > nguong nay; P2-P4 "tot hon" = can duoi > 0. */
export const P1_MARGIN = -0.005;

/** Cac muc quet cua duong cong (dang ky truoc, §17.10). */
export const CURVES: Readonly<Record<'pOver' | 'overlap' | 'pNone', readonly number[]>> = {
  pOver: [0, 0.15, 0.3, 0.5, 0.7],
  overlap: [0.1, 0.3, 0.5, 0.7, 0.9],
  pNone: [0, 0.3, 0.6, 0.9],
};

/** Ho trong so mac dinh (§17.6): (1 - d) x (0,45; 0,30; 0,25) + d. d = 0 la dung bo cu (LEGACY_WEIGHTS_V1). */
export function familyWeights(d: number): Weights {
  if (!Number.isFinite(d) || d < 0 || d >= 1) throw new RangeError('d phai trong [0, 1)');
  return {
    experience: (1 - d) * LEGACY_WEIGHTS_V1.experience,
    reliability: (1 - d) * LEGACY_WEIGHTS_V1.reliability,
    availability: (1 - d) * LEGACY_WEIGHTS_V1.availability,
    declared: d,
  };
}

export const DECLARED_ONLY: Readonly<Weights> = { experience: 0, reliability: 0, availability: 0, declared: 1 };

export type World = 'W1' | 'W2';
export const WORLDS: readonly World[] = ['W1', 'W2'];

/** Mot bo du lieu + ho so da cat san (tinh MOT lan cho moi (hat giong, cau hinh ho so)). */
export interface DeclaredDataset {
  seed: number;
  data: SimDataset;
  items: Map<string, DeclaredItem[]>;
}

export function prepare(seed: number, profileCfg: Partial<DeclaredSimConfig> = {}): DeclaredDataset {
  const data = generateSimulation({ ...DEFAULT_SIM, seed });
  return { seed, data, items: declaredItemsByPerson(generateDeclaredProfiles(data, profileCfg)) };
}

/** Cung bo du lieu, ho so khac (duong cong / nguoi khai qua): khong sinh lai bo du lieu. */
export function withProfiles(ds: DeclaredDataset, profileCfg: Partial<DeclaredSimConfig>): DeclaredDataset {
  return { ...ds, items: declaredItemsByPerson(generateDeclaredProfiles(ds.data, profileCfg)) };
}

export interface ArmSpec {
  id: string;
  make: () => Arm;
}

type Missing = MissingPolicy | Partial<Record<ComponentKey, MissingPolicy>>;

export const scorer = (id: string, weights: Weights, missing?: Missing): ArmSpec => ({
  id,
  make: () => scorerArm({ id, label: id, weights, missing }),
});
const mainArm = (id: string): ArmSpec => {
  const spec = MAIN_ARMS.find((a) => a.id === id);
  if (!spec) throw new Error(`khong co nhanh ${id}`);
  return { id, make: spec.make };
};
export const ARM_FULL3 = scorer('full-3', LEGACY_WEIGHTS_V1);
export const armFull4 = (d: number, missing?: Missing): ArmSpec => scorer('full-4', familyWeights(d), missing);
export const ARM_DECLARED_ONLY = scorer('declared-only', DECLARED_ONLY);
export const ARM_RANDOM = mainArm('random');
export const ARM_EXP_ONLY = mainArm('exp-only');
export const ARM_ORACLE: ArmSpec = { id: 'oracle', make: oracleArm };

export function runOn(ds: DeclaredDataset, arm: ArmSpec, world: World): RunResult {
  return runArm(ds.data, arm.make, { mode: 'ARM', coldStart: world === 'W2', declared: ds.items });
}

/** Cac the "lanh" (W3) tren the gioi cua mot lan chay moc. */
export function coldCards(baseline: RunResult, doneMax: number = COLD_DONE_MAX): Set<string> {
  return new Set(baseline.decisions.filter((d) => d.bestDoneCount <= doneMax).map((d) => d.cardKey));
}

/** Trung binh pOnTimeAssigned tren cac the `keys` (null neu khong the nao). */
export function meanOnCards(r: RunResult, keys: ReadonlySet<string>): number | null {
  const xs = r.decisions.filter((d) => keys.has(d.cardKey)).map((d) => d.pOnTimeAssigned);
  return xs.length === 0 ? null : mean(xs);
}

// ---------- Chon d (luat dang ky truoc) ----------

export interface DSweepRow {
  d: number;
  /** P(dung han) theo hat giong dev (cung thu tu). */
  w1: number[];
  w2: number[];
}

export interface DChoice {
  d: number;
  /** d cho trung binh W2 cao nhat tren MOI d (chi de doi chieu, truoc khi ap rang buoc W1). */
  bestW2D: number;
  /** Cac d khong kem d = 0 qua 0,005 o W1, tang dan (buoc 1 cua luat). */
  admissible: number[];
  /** Trong tap tren, cac d co W2 trong 0,002 cua gia tri tot nhat, tang dan (buoc 2-3). */
  eligible: number[];
  /** d chon = 0 -> ket luan "Ho so khong dang dua vao mac dinh"; san pham van de muc san (0,05) de nhom tu hoc. */
  productD: number;
}

/**
 * §17.10 - CACH DOC CHOT O BUOC 15 (truoc khi chay dev 20 hat giong): luat ghi "d nho nhat co W2 trong 0,002 cua gia tri tot nhat VA
 * W1 khong kem d = 0 qua 0,005" - neu lay "tot nhat" tren MOI d thi hai dieu kien co the KHONG CO GIAO (lo ra khi chay thu 2 hat giong).
 * Doc theo thu tu: (1) chi giu cac d khong kem d = 0 qua 0,005 o W1 (luon co d = 0); (2) trong tap do lay W2 tot nhat; (3) chon d
 * NHO NHAT co W2 trong 0,002 cua gia tri do. Can dong d = 0 (moc W1).
 */
export function chooseD(rows: readonly DSweepRow[], weightMin = 0.05): DChoice {
  if (rows.length === 0) throw new RangeError('chooseD: khong co dong nao');
  const base = rows.find((r) => r.d === 0);
  if (!base) throw new RangeError('chooseD: can dong d = 0 (moc so sanh W1)');
  const m = rows.map((r) => ({ d: r.d, w1: mean(r.w1), w2: mean(r.w2) }));
  const bestW2D = [...m].sort((a, b) => b.w2 - a.w2 || a.d - b.d)[0]!.d;
  const baseW1 = mean(base.w1);
  const admissible = m.filter((r) => r.w1 >= baseW1 - D_RULE_W1_MARGIN);
  const bestW2 = Math.max(...admissible.map((r) => r.w2));
  const eligible = admissible
    .filter((r) => r.w2 >= bestW2 - D_RULE_TOLERANCE)
    .map((r) => r.d)
    .sort((a, b) => a - b);
  const d = eligible[0]!;
  return { d, bestW2D, admissible: admissible.map((r) => r.d).sort((a, b) => a - b), eligible, productD: d === 0 ? weightMin : d };
}

/** Quet d tren cac bo du lieu dev: W1 va W2 cua nhanh day-du voi tung d (d = 0 = day-du-3). */
export function dSweep(datasets: readonly DeclaredDataset[], ds: readonly number[] = D_SWEEP): DSweepRow[] {
  return ds.map((d) => {
    const arm = d === 0 ? ARM_FULL3 : armFull4(d);
    return {
      d,
      w1: datasets.map((x) => runOn(x, arm, 'W1').summary.pOnTimeAssigned),
      w2: datasets.map((x) => runOn(x, arm, 'W2').summary.pOnTimeAssigned),
    };
  });
}

// ---------- Xac nhan: so sanh chinh + mo ta ----------

export interface PrimaryResult {
  id: 'P1' | 'P2' | 'P3' | 'P4';
  label: string;
  world: string;
  comparison: PairedComparison;
  /** Tieu chi dang ky truoc: can duoi > nguong. */
  threshold: number;
  pass: boolean;
}

export function primary(id: PrimaryResult['id'], label: string, world: string, a: readonly number[], b: readonly number[], threshold: number): PrimaryResult {
  const comparison = comparePaired(a, b);
  return { id, label, world, comparison, threshold, pass: comparison.lo > threshold };
}

export const MAIN_ARM_IDS = ['full-3', 'full-4', 'declared-only', 'random', 'exp-only', 'oracle'] as const;
export type MainArmId = (typeof MAIN_ARM_IDS)[number];

export interface MainResult {
  d: number;
  /** Tom tat theo hat giong: world -> nhanh -> RunSummary[]. */
  summaries: Record<World, Record<MainArmId, RunSummary[]>>;
  w3: { full3: number[]; full4: number[]; cards: number[]; seedsWithCold: number };
  primary: PrimaryResult[];
}

export function mainExperiment(datasets: readonly DeclaredDataset[], d: number): MainResult {
  const specs: Record<MainArmId, ArmSpec> = {
    'full-3': ARM_FULL3,
    'full-4': armFull4(d),
    'declared-only': ARM_DECLARED_ONLY,
    random: ARM_RANDOM,
    'exp-only': ARM_EXP_ONLY,
    oracle: ARM_ORACLE,
  };
  const summaries = {} as MainResult['summaries'];
  const w3 = { full3: [] as number[], full4: [] as number[], cards: [] as number[], seedsWithCold: 0 };
  for (const world of WORLDS) {
    summaries[world] = {} as Record<MainArmId, RunSummary[]>;
    for (const id of MAIN_ARM_IDS) summaries[world][id] = [];
  }
  for (const ds of datasets) {
    for (const world of WORLDS) {
      const runs = {} as Record<MainArmId, RunResult>;
      for (const id of MAIN_ARM_IDS) {
        runs[id] = runOn(ds, specs[id], world);
        summaries[world][id].push(runs[id].summary);
      }
      if (world !== 'W1') continue;
      // W3: the lanh xac dinh tren the gioi cua day-du-3, do ca hai nhanh tren CUNG cac the
      const keys = coldCards(runs['full-3']);
      if (keys.size === 0) continue;
      w3.full3.push(meanOnCards(runs['full-3'], keys)!);
      w3.full4.push(meanOnCards(runs['full-4'], keys)!);
      w3.cards.push(keys.size);
      w3.seedsWithCold += 1;
    }
  }
  const p = (world: World, id: MainArmId) => summaries[world][id].map((s) => s.pOnTimeAssigned);
  const prim: PrimaryResult[] = [
    primary('P1', 'đầy đủ-4 − đầy đủ-3', 'W1 mặc định', p('W1', 'full-4'), p('W1', 'full-3'), P1_MARGIN),
    primary('P2', 'đầy đủ-4 − đầy đủ-3', 'W2 nhóm mới', p('W2', 'full-4'), p('W2', 'full-3'), 0),
  ];
  if (w3.full3.length >= 2) prim.push(primary('P3', 'đầy đủ-4 − đầy đủ-3', 'W3 quyết định lạnh', w3.full4, w3.full3, 0));
  prim.push(primary('P4', 'chỉ-Hồ-sơ − ngẫu nhiên', 'W2 nhóm mới', p('W2', 'declared-only'), p('W2', 'random'), 0));
  return { d, summaries, w3, primary: prim };
}

// ---------- Phu: duong cong, nguoi khai qua, cach xu ly thieu Ho so ----------

export interface CurvePoint {
  value: number;
  /** P(dung han) cua day-du-4 theo hat giong. */
  full4: number[];
  /** Chenh lech cap voi day-du-3 (khong phu thuoc ho so: trong so Ho so = 0). */
  diff: PairedComparison;
}

export function curve(
  datasets: readonly DeclaredDataset[],
  d: number,
  knob: keyof typeof CURVES,
  world: World,
  full3: readonly number[]
): CurvePoint[] {
  return CURVES[knob].map((value) => {
    const full4 = datasets.map((ds) => runOn(withProfiles(ds, { [knob]: value }), armFull4(d), world).summary.pOnTimeAssigned);
    return { value, full4, diff: comparePaired(full4, full3) };
  });
}

/** Nguoi co ky nang an TRUNG BINH (luc vao nhom) thap nhat - "nguoi khai qua" xau nhat co the. Hoa -> khoa nho. */
export function weakestPerson(data: SimDataset): string {
  const score = (key: string) => {
    const p = data.people.find((x) => x.key === key)!;
    return mean(p.skills.map((_, t) => skillAt(p, t, p.joinedDay)));
  };
  return [...data.people].map((p) => p.key).sort((a, b) => score(a) - score(b) || (a < b ? -1 : 1))[0]!;
}

export interface LiarResult {
  world: World;
  /** P(dung han) nhom: ho so trung thuc vs co nguoi khai qua (cung hat giong). */
  honest: number[];
  withLiar: number[];
  diff: PairedComparison;
  /** Phan viec nguoi khai qua nhan (so the / so the ho co mat trong ho boi): trung thuc / co khai qua / day-du-3. */
  shareHonest: number[];
  shareLiar: number[];
  shareFull3: number[];
}

function shareOf(r: RunResult, key: string): number {
  const inPool = r.decisions.filter((x) => x.poolKeys.includes(key));
  return inPool.length === 0 ? 0 : inPool.filter((x) => x.assignedKey === key).length / inPool.length;
}

export function liarExperiment(datasets: readonly DeclaredDataset[], d: number, world: World): LiarResult {
  const out: LiarResult = { world, honest: [], withLiar: [], diff: null as unknown as PairedComparison, shareHonest: [], shareLiar: [], shareFull3: [] };
  for (const ds of datasets) {
    const liar = weakestPerson(ds.data);
    const honest = runOn(ds, armFull4(d), world);
    const lying = runOn(withProfiles(ds, { liarKey: liar }), armFull4(d), world);
    const full3 = runOn(ds, ARM_FULL3, world);
    out.honest.push(honest.summary.pOnTimeAssigned);
    out.withLiar.push(lying.summary.pOnTimeAssigned);
    out.shareHonest.push(shareOf(honest, liar));
    out.shareLiar.push(shareOf(lying, liar));
    out.shareFull3.push(shareOf(full3, liar));
  }
  out.diff = comparePaired(out.withLiar, out.honest);
  return out;
}

export interface MissingRow {
  policy: MissingPolicy;
  world: World;
  pOnTime: number[];
  /** Phan chia deu cho nguoi vao muon (1 = cong bang). */
  newcomerParity: (number | null)[];
}

/** Cach xu ly nguoi KHONG khai o thanh phan Ho so (DROP / NEUTRAL - mac dinh / ZERO - chi de do). */
export function missingExperiment(datasets: readonly DeclaredDataset[], d: number): MissingRow[] {
  const out: MissingRow[] = [];
  for (const world of WORLDS) {
    for (const policy of ['DROP', 'NEUTRAL', 'ZERO'] as const) {
      const runs = datasets.map((ds) => runOn(ds, armFull4(d, { declared: policy }), world).summary);
      out.push({ policy, world, pOnTime: runs.map((s) => s.pOnTimeAssigned), newcomerParity: runs.map((s) => s.newcomerParity) });
    }
  }
  return out;
}
