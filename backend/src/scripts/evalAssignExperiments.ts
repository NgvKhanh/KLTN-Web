// Cac THI NGHIEM cua buoc 7b (ASSIGN_MODULE.md §11): quet tham so, luoi trong so, chuan hoa x thieu du lieu, the gioi (phat tai,
// mat do viec), do ben truoc cac nguon lech, hoc trong so. Tep nay chi KHAI BAO cac diem do va chay chung mot vong lap; viec
// dinh dang bang nam o evalAssignReportSweeps.ts. KHONG Prisma, KHONG dong ho, KHONG mang - tat dinh.
//
// So sanh CAP chi hop le giua cac diem CUNG the gioi (cung bo du lieu, cung hat giong): trong bao cao, chenh lech cap chi duoc
// tinh trong mot nhom co cung `world`. Doi cau hinh bo sinh (mat do, nguon lech) tao ra bo du lieu KHAC nen chi so sanh cac nhanh
// TRONG tung the gioi, khong so sanh xuyen the gioi.

import {
  DEFAULT_PARAMS,
  LEGACY_WEIGHTS_V1,
  type MissingPolicy,
  type Normalization,
  type ScoreParams,
  type Weights,
} from '../modules/assign/assign.score';
import { LEGACY_KEYS, pinLegacy, projectWithin } from '../modules/assign/assign.weights';
import { countTerms, type CardText } from '../modules/assign/assign.text';
import type { TermCounts } from '../modules/assign/assign.tfidf';
import { MAIN_ARMS, scorerArm, withoutComponent, type Arm, type ArmSpec } from './evalAssignArms';
import {
  PERSONAS,
  biasedLeader,
  learningArm,
  learningTrace,
  withCompleteFlags,
  type FeatureSpace,
  type FlaggedArm,
  type LearningArm,
  type LearningStats,
  type LearningTrace,
  type PersonaId,
} from './evalAssignLeader';
import { runArm, type RunOptions, type RunSummary } from './evalAssignRun';
import { DEFAULT_SIM, generateSimulation, type SimCard, type SimConfig, type SimDataset } from './simGenerator';
import { neighbourAccuracy, type NeighbourAccuracy } from './simTextEval';

// ---------- Bo du lieu (co nho dem) ----------

export type World = Partial<SimConfig> | undefined;
export type DatasetProvider = (seed: number, world: World) => SimDataset;

/** Khoa on dinh cua mot cau hinh the gioi (thu tu khoa khong anh huong). */
export function worldKey(world: World): string {
  if (!world) return 'mac dinh';
  const keys = Object.keys(world).sort() as (keyof SimConfig)[];
  return keys.length === 0 ? 'mac dinh' : keys.map((k) => `${k}=${world[k]}`).join(', ');
}

/** Sinh bo du lieu theo (hat giong, the gioi) va nho lai: nhieu diem do dung chung mot bo. */
export function makeDatasetProvider(): DatasetProvider {
  const cache = new Map<string, SimDataset>();
  return (seed, world) => {
    const key = `${seed}|${worldKey(world)}`;
    let d = cache.get(key);
    if (!d) {
      d = generateSimulation({ ...DEFAULT_SIM, ...(world ?? {}), seed });
      cache.set(key, d);
    }
    return d;
  };
}

// ---------- Diem do chung ----------

export interface SweepPoint {
  /** Nhom = mot bang trong bao cao. */
  group: string;
  label: string;
  /** Diem "mac dinh" cua nhom (de tinh chenh lech cap). */
  isDefault?: boolean;
  /** Tao ban MOI cua nhanh cho tung hat giong. */
  make: () => Arm;
  opts: RunOptions;
  /** Cau hinh bo sinh khac mac dinh (doi the gioi). */
  world?: Partial<SimConfig>;
}

export interface SweepResult {
  group: string;
  label: string;
  isDefault: boolean;
  /** worldKey cua cau hinh bo sinh - cac ket qua cung `world` moi so sanh cap duoc voi nhau. */
  world: string;
  perSeed: RunSummary[];
}

export function runSweep(
  seeds: readonly number[],
  points: readonly SweepPoint[],
  provider: DatasetProvider,
  onProgress?: (line: string) => void
): SweepResult[] {
  return points.map((p) => {
    const t0 = Date.now();
    const perSeed = seeds.map((seed) => runArm(provider(seed, p.world), p.make, p.opts).summary);
    onProgress?.(`[${p.group}] ${p.label}: ${seeds.length} hat giong, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    return { group: p.group, label: p.label, isDefault: p.isDefault === true, world: worldKey(p.world), perSeed };
  });
}

const ARM_OF = (id: string): ArmSpec => {
  const spec = MAIN_ARMS.find((a) => a.id === id);
  if (!spec) throw new Error(`khong co nhanh chinh "${id}"`);
  return spec;
};

const pt = (group: string, label: string, make: () => Arm, opts: RunOptions, extra: Partial<SweepPoint> = {}): SweepPoint => ({
  group,
  label,
  make,
  opts,
  ...extra,
});

const ARM_MODE: RunOptions = { mode: 'ARM' };

// ---------- 1. Tham so cua bo cham (moi lan doi MOT tham so) ----------

interface ParamSpec {
  group: string;
  key: keyof ScoreParams;
  values: readonly number[];
}

/** Cac tham so §5.8 duoc quet; gia tri mac dinh lay tu DEFAULT_PARAMS (khong chep tay). */
export const PARAM_SPECS: readonly ParamSpec[] = [
  { group: 'H – nửa đời suy giảm (ngày)', key: 'halfLifeDays', values: [30, 60, 90, 180, 365] },
  { group: 'K – số thẻ giống nhất đem xét', key: 'k', values: [1, 3, 5, 8, 12] },
  { group: 'm – hệ số co về trung bình nhóm', key: 'shrinkage', values: [0.5, 1, 3, 6, 12] },
  { group: 'm_e – hệ số bão hoà lượng bằng chứng', key: 'evidenceSaturation', values: [0.5, 1, 2, 4, 8] },
  { group: 'simMin – ngưỡng bỏ thẻ quá khác', key: 'simMin', values: [0, 0.05, 0.1, 0.2] },
];

export function paramSweepPoints(): SweepPoint[] {
  const out: SweepPoint[] = [];
  for (const spec of PARAM_SPECS) {
    const def = DEFAULT_PARAMS[spec.key];
    if (!spec.values.includes(def)) throw new Error(`gia tri mac dinh ${def} cua ${spec.key} khong nam trong luoi quet`);
    for (const v of spec.values) {
      const params: Partial<ScoreParams> = { [spec.key]: v };
      out.push(
        pt(spec.group, String(v).replace('.', ','), () => scorerArm({ id: 'full', label: 'full', params }), ARM_MODE, {
          isDefault: v === def,
        })
      );
    }
  }
  // Suc chua ma bo cham TIN (the gioi van dung suc chua that): nguoi dung chua khai ho so thi mac dinh 5 cho tat ca
  const capGroup = 'Sức chứa bộ chấm tin (thẻ song song)';
  out.push(pt(capGroup, 'sức chứa thật', () => scorerArm({ id: 'full', label: 'full' }), ARM_MODE, { isDefault: true }));
  for (const c of [2, 3, 5, 8]) {
    out.push(pt(capGroup, String(c), () => scorerArm({ id: 'full', label: 'full' }), { mode: 'ARM', assumedCapacity: c }));
  }
  return out;
}

// ---------- 2. Chuan hoa x thieu du lieu ----------

export function normalizationPoints(): SweepPoint[] {
  const group = 'Chuẩn hoá x xử lý thành phần thiếu';
  const combos: { normalize: Normalization; missing: MissingPolicy; label: string; isDefault?: boolean }[] = [
    { normalize: 'NONE', missing: 'DROP', label: 'Cộng thô (NONE / DROP)' },
    { normalize: 'MINMAX', missing: 'DROP', label: 'Min-max / bỏ thành phần thiếu (MẶC ĐỊNH)', isDefault: true },
    { normalize: 'MINMAX', missing: 'NEUTRAL', label: 'Min-max / thay bằng trung bình nhóm (NEUTRAL)' },
    { normalize: 'NONE', missing: 'NEUTRAL', label: 'Cộng thô / NEUTRAL' },
  ];
  return combos.map((c) =>
    pt(group, c.label, () => scorerArm({ id: 'full', label: 'full', normalize: c.normalize, missing: c.missing }), ARM_MODE, {
      isDefault: c.isDefault,
    })
  );
}

// ---------- 3. Luoi trong so ----------

/** Moi bo (a, b, c) la boi cua 0,1 trong [0,1; 0,7], tong 1: 33 diem (Ho so = 0 - luoi cua buoc 7). */
export function weightGrid(): Weights[] {
  const out: Weights[] = [];
  for (let a = 1; a <= 7; a += 1) {
    for (let b = 1; b <= 7; b += 1) {
      const c = 10 - a - b;
      if (c >= 1 && c <= 7) out.push({ experience: a / 10, reliability: b / 10, availability: c / 10, declared: 0 });
    }
  }
  return out;
}

const fmtW = (w: Weights) => [w.experience, w.reliability, w.availability].map((x) => x.toFixed(2).replace('.', ',')).join(' / ');

export function weightsGridPoints(): SweepPoint[] {
  const group = 'Lưới trọng số (kinh nghiệm / tin cậy / khả dụng)';
  const points = [
    pt(group, `${fmtW(LEGACY_WEIGHTS_V1)} (MẶC ĐỊNH)`, () => scorerArm({ id: 'full', label: 'full' }), ARM_MODE, { isDefault: true }),
  ];
  for (const w of weightGrid()) {
    points.push(pt(group, fmtW(w), () => scorerArm({ id: 'w', label: 'w', weights: w }), ARM_MODE));
  }
  return points;
}

// ---------- 4. The gioi: phat tai va mat do viec ----------

export const LOAD_PENALTIES: readonly number[] = [0, 0.06, 0.12, 0.2, 0.3];
const WORLD_ARM_IDS = ['random', 'most-free', 'exp-only', 'full'] as const;

function noAvailabilityArm(): Arm {
  return scorerArm({ id: 'no-avail', label: 'Bỏ khả dụng', weights: withoutComponent(LEGACY_WEIGHTS_V1, 'availability') });
}

/** Voi moi muc phat tai cua the gioi: cac nhanh chinh + nhanh bo kha dung. Nhom = muc phat tai, dong = nhanh. */
export function loadPenaltyPoints(): SweepPoint[] {
  const out: SweepPoint[] = [];
  for (const p of LOAD_PENALTIES) {
    const group = `Phạt tải của thế giới = ${String(p).replace('.', ',')}`;
    for (const id of WORLD_ARM_IDS) {
      const spec = ARM_OF(id);
      out.push(pt(group, spec.label, spec.make, { mode: 'ARM', loadPenalty: p }, { isDefault: id === 'full' }));
    }
    out.push(pt(group, 'Bỏ khả dụng', noAvailabilityArm, { mode: 'ARM', loadPenalty: p }));
  }
  return out;
}

export const DENSITIES: readonly number[] = [24, 48, 72];

/** Mat do viec: so the moi bang (24 = mac dinh). Doi bo sinh -> bo du lieu khac (chi so sanh cac nhanh TRONG tung the gioi). */
export function densityPoints(): SweepPoint[] {
  const out: SweepPoint[] = [];
  for (const n of DENSITIES) {
    const group = `Mật độ việc: ${n} thẻ mỗi bảng`;
    for (const id of WORLD_ARM_IDS) {
      const spec = ARM_OF(id);
      out.push(pt(group, spec.label, spec.make, ARM_MODE, { isDefault: id === 'full', world: { cardsPerBoard: n } }));
    }
    out.push(pt(group, 'Bỏ khả dụng', noAvailabilityArm, ARM_MODE, { world: { cardsPerBoard: n } }));
  }
  return out;
}

// ---------- 5. Do ben truoc cac nguon lech cua bo sinh ----------

export interface Perturbation {
  /** Nguon lech / tham so cua bo sinh. */
  name: string;
  key: keyof SimConfig;
  low: number;
  high: number;
}

/** Nguon lech §7 (moi nguon ha thap / nang len so voi mac dinh) + quy mo nhom. Gia tri mac dinh o DEFAULT_SIM. */
export const PERTURBATIONS: readonly Perturbation[] = [
  { name: 'Phân công lịch sử sai', key: 'wrongAssignRate', low: 0.05, high: 0.5 },
  { name: 'Thẻ mơ hồ', key: 'ambiguousRate', low: 0, high: 0.4 },
  { name: 'Từ đồng nghĩa / viết tắt', key: 'synonymRate', low: 0, high: 0.7 },
  { name: 'Lỗi chính tả', key: 'typoRate', low: 0, high: 0.3 },
  { name: 'Người học nghề', key: 'learnerRate', low: 0, high: 0.7 },
  { name: 'Quy mô nhóm (số người)', key: 'people', low: 4, high: 10 },
];

const ROBUST_ARM_IDS = ['random', 'most-free', 'exp-only', 'full'] as const;

/** Mac dinh + tung nguon lech o hai muc: 13 the gioi x 4 nhanh. Nhom = the gioi, dong = nhanh. */
export function robustnessPoints(): SweepPoint[] {
  const out: SweepPoint[] = [];
  const worlds: { group: string; world: Partial<SimConfig> | undefined }[] = [{ group: 'Mặc định (đối chứng)', world: undefined }];
  const comma = (x: number) => String(x).replace('.', ',');
  for (const p of PERTURBATIONS) {
    worlds.push({ group: `${p.name}: thấp (${comma(p.low)})`, world: { [p.key]: p.low } as Partial<SimConfig> });
    worlds.push({ group: `${p.name}: cao (${comma(p.high)})`, world: { [p.key]: p.high } as Partial<SimConfig> });
  }
  for (const w of worlds) {
    for (const id of ROBUST_ARM_IDS) {
      const spec = ARM_OF(id);
      out.push(pt(w.group, spec.label, spec.make, ARM_MODE, { isDefault: id === 'full', world: w.world }));
    }
  }
  return out;
}

// ---------- 6. Hoc trong so (muc 2) ----------

export interface LearningPoint {
  persona: PersonaId;
  /** Do lech chuan nhieu cua truong nhom. */
  noise: number;
  /** Toc do hoc cua nhanh. */
  eta: number;
  space: FeatureSpace;
}

export interface LearningRun {
  trace: LearningTrace;
  stats: LearningStats;
  final: Weights;
}

export interface LearningResult {
  point: LearningPoint;
  /** Theo hat giong (cung thu tu `seeds`). */
  learned: LearningRun[];
  /** Nhanh CO DINH trong so (mac dinh san pham) nhin CUNG the gioi (chi truong nhom giao viec). */
  fixed: LearningTrace[];
}

/**
 * Trong so muc tieu cua duong hoi tu: diem hop le gan nhat voi thien lech that (bo hoc chi co the toi day). Bo hoc chi chinh ba thanh
 * phan tu lich su va Ho so = 0 o nhanh buoc 7 -> chieu rieng ba thanh phan do, tong 1.
 */
export function learningTarget(persona: PersonaId): Weights {
  return projectWithin(pinLegacy(PERSONAS[persona].bias), LEGACY_KEYS);
}

/**
 * Che do LEADER: truong nhom gia giao viec (the gioi CHI phu thuoc truong nhom, khong phu thuoc nhanh) nen nhanh co dinh va nhanh
 * co hoc thay cung mot the gioi, cung nguoi duoc giao, cung ket qua - khac nhau duy nhat o GOI Y va chuyen dong cua trong so.
 */
export function runLearning(
  seeds: readonly number[],
  points: readonly LearningPoint[],
  provider: DatasetProvider,
  onProgress?: (line: string) => void
): LearningResult[] {
  const fixedCache = new Map<string, LearningTrace[]>();
  return points.map((p) => {
    const t0 = Date.now();
    const target = learningTarget(p.persona);
    const leader = biasedLeader({ bias: PERSONAS[p.persona].bias, noise: p.noise, space: p.space });
    const learned: LearningRun[] = [];
    const fixedKey = `${p.persona}|${p.noise}|${p.space}`;
    const needFixed = !fixedCache.has(fixedKey);
    const fixed: LearningTrace[] = needFixed ? [] : fixedCache.get(fixedKey)!;
    for (const seed of seeds) {
      const data = provider(seed, undefined);
      const holder: { arm: FlaggedArm<LearningArm> | null } = { arm: null };
      const r = runArm(
        data,
        () => {
          holder.arm = withCompleteFlags(learningArm({ eta: p.eta }));
          return holder.arm;
        },
        { mode: 'LEADER', leader }
      );
      learned.push({
        trace: learningTrace(r.decisions, target, holder.arm!.completeFlags()),
        stats: holder.arm!.stats(),
        final: r.finalWeights!,
      });
      if (needFixed) {
        const fixedHolder: { arm: FlaggedArm<Arm> | null } = { arm: null };
        const f = runArm(
          data,
          () => {
            fixedHolder.arm = withCompleteFlags(ARM_OF('full').make());
            return fixedHolder.arm;
          },
          { mode: 'LEADER', leader }
        );
        fixed.push(learningTrace(f.decisions, target, fixedHolder.arm!.completeFlags()));
      }
    }
    if (needFixed) fixedCache.set(fixedKey, fixed);
    onProgress?.(
      `[hoc] ${p.persona} nhieu ${p.noise} eta ${p.eta} ${p.space}: ${seeds.length} hat giong, ${((Date.now() - t0) / 1000).toFixed(1)} s`
    );
    return { point: p, learned, fixed };
  });
}

export interface ObjectiveResult {
  persona: PersonaId;
  noise: number;
  /** Nhanh co hoc TU GIAO (che do ARM), truong nhom chi cho phan hoi. */
  learned: RunSummary[];
  /** Nhanh co dinh trong so, cung the gioi (cung bo du lieu, khong co truong nhom). */
  fixed: RunSummary[];
  /** Trong so cuoi cung cua nhanh co hoc, theo hat giong. */
  finals: Weights[];
}

/**
 * Anh huong KHACH QUAN cua viec hoc: nhanh co hoc TU GIAO nguoi xep dau theo trong so da hoc tu truong nhom (che do ARM, truong
 * nhom chi cho phan hoi). So voi nhanh co dinh cung the gioi de biet theo gu cua nhom co lam ket qua tot / xau di.
 */
export function runLearnedObjective(
  seeds: readonly number[],
  persona: PersonaId,
  noise: number,
  provider: DatasetProvider
): ObjectiveResult {
  const leader = biasedLeader({ bias: PERSONAS[persona].bias, noise });
  const learned: RunSummary[] = [];
  const fixed: RunSummary[] = [];
  const finals: Weights[] = [];
  for (const seed of seeds) {
    const data = provider(seed, undefined);
    const l = runArm(data, () => learningArm(), { mode: 'ARM', leader });
    learned.push(l.summary);
    finals.push(l.finalWeights!);
    fixed.push(runArm(data, ARM_OF('full').make, { mode: 'ARM' }).summary);
  }
  return { persona, noise, learned, fixed, finals };
}

// ---------- 7. Chuoi xu ly van ban: bi-gram va trong so tieu de ----------

const stripBigrams = (m: TermCounts): TermCounts => new Map([...m].filter(([term]) => !term.includes(' ')));

export interface TextVariant {
  id: string;
  label: string;
  isDefault?: boolean;
  counts: (c: SimCard) => TermCounts;
}

const asText = (c: SimCard): CardText => ({ title: c.title, description: c.description });

/** Cac bien the cua chuoi xu ly: countTerms chinh la ham cua san pham (mac dinh: uni + bi-gram, tieu de x2). */
export const TEXT_VARIANTS: readonly TextVariant[] = [
  { id: 'default', label: 'uni + bi-gram, tiêu đề ×2 (MẶC ĐỊNH)', isDefault: true, counts: (c) => countTerms(asText(c)) },
  { id: 'uni', label: 'chỉ uni-gram, tiêu đề ×2', counts: (c) => stripBigrams(countTerms(asText(c))) },
  { id: 't1', label: 'uni + bi, tiêu đề ×1', counts: (c) => countTerms(asText(c), 1) },
  { id: 't3', label: 'uni + bi, tiêu đề ×3', counts: (c) => countTerms(asText(c), 3) },
  { id: 't5', label: 'uni + bi, tiêu đề ×5', counts: (c) => countTerms(asText(c), 5) },
  { id: 'title', label: 'uni + bi, chỉ tiêu đề', counts: (c) => countTerms({ title: c.title }) },
  { id: 'desc', label: 'uni + bi, chỉ mô tả', counts: (c) => countTerms({ title: '', description: c.description }, 0) },
];

export interface TextResult {
  id: string;
  label: string;
  isDefault: boolean;
  perSeed: NeighbourAccuracy[];
}

export function runTextVariants(seeds: readonly number[], provider: DatasetProvider): TextResult[] {
  return TEXT_VARIANTS.map((v) => ({
    id: v.id,
    label: v.label,
    isDefault: v.isDefault === true,
    perSeed: seeds.map((seed) => neighbourAccuracy(provider(seed, undefined), v.counts)),
  }));
}

/** Cac diem hoc cua bang chinh: ba gu + doi chung, ba muc nhieu, toc do hoc cua san pham. */
export function mainLearningPoints(eta: number): LearningPoint[] {
  const personas: PersonaId[] = ['expert', 'reliable', 'free', 'control'];
  const out: LearningPoint[] = [];
  for (const persona of personas) for (const noise of [0, 0.1, 0.25]) out.push({ persona, noise, eta, space: 'SCALED' });
  return out;
}

/** Quet toc do hoc: nhieu truong nhom (co "loi" that de hoc) va doi chung (khong co loi de hoc, chi do troi do nhieu). */
export function etaSweepPoints(): LearningPoint[] {
  const out: LearningPoint[] = [];
  for (const persona of ['expert', 'control'] as PersonaId[]) {
    for (const noise of [0, 0.25]) for (const eta of [0.01, 0.02, 0.05, 0.1, 0.2]) out.push({ persona, noise, eta, space: 'SCALED' });
  }
  return out;
}

/** Truong nhom nhin gia tri THO (gu nam ngoai khong gian dac trung cua bo hoc). */
export function rawSpacePoints(eta: number): LearningPoint[] {
  return (['expert', 'reliable', 'free'] as PersonaId[]).map((persona) => ({ persona, noise: 0.1, eta, space: 'RAW' as const }));
}
