// Truong nhom GIA + nhanh CO HOC trong so (buoc 7b, ASSIGN_MODULE.md §8 "Cach do muc 2" va §11).
//
// Truong nhom gia co mot THIEN LECH co dinh `bias` (ba trong so) va chon nguoi co "tien ich" lon nhat:
//     tien_ich(u) = tong_k bias_k * dac_trung_k(u)  +  nhieu * N(0,1)
// Thien lech nay la TUY Y va khong biet ky nang an: no chung minh trong so hoc DUOC BAM THEO gu cua nhom, KHONG chung minh viec
// hoc lam ket qua khach quan tot hon (neu gu cua truong nhom la xau thi hoc theo gu do cung xau). Bao cao phai noi ro dieu nay.
//
// Nhanh co hoc dung DUNG cac ham cua san pham (assign.learn.ts: learningDecision / parseRunCandidates / learnStep) - khong viet
// lai luat hoc - va lam dung nhung gi assign.repo.ts › decideAndLearn lam: moi luot phan hoi tang feedbackCount TRUOC khi quyet
// dinh, nguoi xep dau la nguoi CO diem, du lieu hoc doc lai tu dang JSON ma AssignRun luu.
//
// KHONG import simGenerator (chi type Rng qua Leader): truong nhom chi thay nhung gi giao dien hien ra (gia tri tho / da chuan hoa).

import { LEGACY_WEIGHTS_V1, rankCandidates, type RankedCandidate, type Weights } from '../modules/assign/assign.score';
import { LEARN_ETA, LEARN_MIN_FEEDBACK, learningDecision, parseRunCandidates } from '../modules/assign/assign.learn';
import { LEGACY_DEFAULT_WEIGHTS, type LegacyWeights } from '../modules/assign/assign.weights';
import type { Arm, ArmFeedback, ArmInput, ScorerArmOptions } from './evalAssignArms';
import type { Leader } from './evalAssignRun';

export type FeatureSpace = 'SCALED' | 'RAW';

export interface LeaderConfig {
  /**
   * Thien lech that: ba trong so khong am, tong 1 (khong bat buoc nam trong [0,05; 0,70] nhu trong so cua nhom). Chi ba thanh phan tu
   * lich su: truong nhom gia cua buoc 7 khong nhin thanh phan Ho so.
   */
  bias: LegacyWeights;
  /** Do lech chuan cua nhieu Gauss cong vao tien ich (0 = nhat quan tuyet doi). Dac trung nam trong [0,1], bias tong 1 -> tien ich trong [0,1]. */
  noise: number;
  /**
   * Truong nhom "nhin" gia tri nao:
   *  - 'SCALED' (mac dinh): gia tri da chuan hoa trong nhom - chinh la dac trung ma bo hoc dung (gu BIEU DIEN DUOC).
   *  - 'RAW': gia tri tho hien tren giao dien (kinh nghiem %, tin cay %, kha dung %) - bo hoc KHONG bieu dien chinh xac duoc
   *    (kiem tra do ben khi gu nam ngoai khong gian dac trung cua bo hoc).
   */
  space?: FeatureSpace;
}

const KEYS = ['experience', 'reliability', 'availability'] as const;

/** Nhieu chuan N(0,1) bang Box-Muller (dung `1 - u` de khong bao gio log(0)). */
function gaussian(rng: { next(): number }): number {
  return Math.sqrt(-2 * Math.log(1 - rng.next())) * Math.cos(2 * Math.PI * rng.next());
}

function validateLeader(cfg: LeaderConfig): void {
  let sum = 0;
  for (const k of KEYS) {
    const v = cfg.bias[k];
    if (!Number.isFinite(v) || v < 0) throw new RangeError(`bias.${k} phai la so huu han >= 0`);
    sum += v;
  }
  if (Math.abs(sum - 1) > 1e-9) throw new RangeError('bias phai co tong bang 1');
  if (!Number.isFinite(cfg.noise) || cfg.noise < 0) throw new RangeError('noise phai la so huu han >= 0');
  if (cfg.space !== undefined && cfg.space !== 'SCALED' && cfg.space !== 'RAW') throw new RangeError('space phai la SCALED | RAW');
}

/**
 * Truong nhom co thien lech. Thanh phan THIEU du lieu (null) duoc coi la 0,5 ("khong biet = trung binh") - ca hai khong gian dac
 * trung. Hoa tien ich -> nguoi dung truoc trong danh sach xep hang (nguoi diem cao hon). Chi rut so ngau nhien khi noise > 0.
 */
export function biasedLeader(cfg: LeaderConfig): Leader {
  validateLeader(cfg);
  const space = cfg.space ?? 'SCALED';
  return {
    pick({ ranked, rng }) {
      if (ranked.length === 0) throw new RangeError('danh sach xep hang rong');
      let bestKey = ranked[0]!.userId;
      let bestUtility = -Infinity;
      for (const r of ranked) {
        let u = 0;
        for (const k of KEYS) {
          const c = r.components[k];
          const x = space === 'SCALED' ? c.scaled : c.value;
          u += cfg.bias[k] * (x ?? 0.5);
        }
        if (cfg.noise > 0) u += cfg.noise * gaussian(rng);
        if (u > bestUtility) {
          bestUtility = u;
          bestKey = r.userId;
        }
      }
      return bestKey;
    },
  };
}

/** Ba kieu thien lech + mot doi chung trung mac dinh (khong co "loi" de hoc: trong so hoc duoc phai dung yen). */
export const PERSONAS = {
  expert: { label: 'Ưu tiên kinh nghiệm', bias: { experience: 0.7, reliability: 0.15, availability: 0.15 } },
  reliable: { label: 'Ưu tiên đúng hạn', bias: { experience: 0.15, reliability: 0.7, availability: 0.15 } },
  free: { label: 'Ưu tiên người rảnh', bias: { experience: 0.15, reliability: 0.15, availability: 0.7 } },
  control: { label: 'Trùng mặc định (đối chứng)', bias: { ...LEGACY_DEFAULT_WEIGHTS } },
} as const satisfies Record<string, { label: string; bias: LegacyWeights }>;

export type PersonaId = keyof typeof PERSONAS;

/** Khoang cach L1 giua hai bo trong so (0 = trung nhau; toi da 2). */
export function l1Distance(a: Weights, b: Weights): number {
  let s = 0;
  for (const k of KEYS) s += Math.abs(a[k] - b[k]);
  return s;
}

/** Dang JSON toi thieu ma AssignRun.candidates luu (assign.service.ts) va parseRunCandidates doc lai. */
function runJson(r: RankedCandidate) {
  const c = (k: (typeof KEYS)[number]) => ({ value: r.components[k].value, scaled: r.components[k].scaled, share: r.components[k].share });
  return {
    userId: r.userId,
    score: r.score,
    components: { experience: c('experience'), reliability: c('reliability'), availability: c('availability') },
  };
}

export interface LearningArmOptions extends Omit<ScorerArmOptions, 'weights' | 'id' | 'label'> {
  id?: string;
  label?: string;
  /** Toc do hoc (mac dinh LEARN_ETA cua san pham). */
  eta?: number;
  /** So luot phan hoi toi thieu truoc khi hoc (mac dinh LEARN_MIN_FEEDBACK cua san pham). */
  minFeedback?: number;
  /** Trong so ban dau (mac dinh LEGACY_WEIGHTS_V1 - nhu nhom moi tao o buoc 7; ghim so lieu cu, §17.6). */
  initial?: Weights;
}

export interface LearningStats {
  /** So luot phan hoi da nhan. */
  feedback: number;
  /** So luot thuc su lam doi trong so. */
  learned: number;
}

export interface LearningArm extends Arm {
  stats(): LearningStats;
}

/**
 * Nhanh "day du, co hoc trong so" (nhanh 8): xep hang bang bo cham voi trong so HIEN TAI cua nhom (cau hinh san pham: MINMAX /
 * DROP), va sau moi quyet dinh nhan phan hoi cua truong nhom qua learningDecision cua san pham.
 */
export function learningArm(o: LearningArmOptions = {}): LearningArm {
  const eta = o.eta ?? LEARN_ETA;
  const minFeedback = o.minFeedback ?? LEARN_MIN_FEEDBACK;
  let weights: Weights = { ...(o.initial ?? LEGACY_WEIGHTS_V1) };
  let feedback = 0;
  let learned = 0;
  return {
    id: o.id ?? 'learned',
    label: o.label ?? 'Đầy đủ, có học trọng số',
    rank({ card, snapshot }) {
      const ranked = rankCandidates(card, snapshot.candidates, {
        idf: snapshot.idf,
        now: snapshot.now,
        groupOnTimeRate: snapshot.mu,
        weights,
        params: o.params,
        normalize: o.normalize,
        missing: o.missing,
      });
      return { order: ranked.map((r) => r.userId), ranked };
    },
    observe({ output, chosenKey }: ArmFeedback) {
      const ranked = output.ranked;
      if (!ranked || ranked.length === 0) throw new Error('nhanh co hoc can ket qua xep hang cua bo cham');
      feedback += 1; // moi luot ghi duoc deu tinh, TRUOC khi quyet dinh (giong decideAndLearn)
      const top = ranked[0]!;
      const decision = learningDecision({
        weights,
        feedbackCount: feedback,
        topUserId: top.score !== null ? top.userId : null,
        chosenUserId: chosenKey,
        candidates: parseRunCandidates(ranked.map(runJson)),
        eta,
        minFeedback,
      });
      if (decision.learn) {
        weights = decision.next;
        learned += 1;
      }
    },
    weights: () => ({ ...weights }),
    stats: () => ({ feedback, learned }),
  };
}

/**
 * Boc mot nhanh dung bo cham de ghi lai, o tung quyet dinh, "moi ung vien deu du ba thanh phan" (khong ai thieu du lieu). Day la dac
 * tinh cua THE GIOI (gia tri chuan hoa `scaled` khong phu thuoc trong so cua nhanh) nen giong nhau o moi nhanh - dung lam mau so chung
 * khi so sanh ti le chap nhan giua hai nhanh. Vi sao can: voi `DROP`, nguoi chua co lich su chi con thanh phan kha dung, nen diem cua ho
 * duoc chia lai thanh CHINH gia tri do (score 100 neu ranh hoan toan) va thuong dung dau; truong nhom khong chon ho nen ho khong bao gio co
 * lich su, kha dung mai bang 1, va bi goi y mai - bo hoc cung khong sua duoc (chot chan "thieu thanh phan thi khong hoc", §8).
 */
export type FlaggedArm<T extends Arm> = T & { completeFlags(): boolean[] };

export function withCompleteFlags<T extends Arm>(inner: T): FlaggedArm<T> {
  const flags: boolean[] = [];
  return {
    ...inner,
    rank(input: ArmInput) {
      const out = inner.rank(input);
      if (!out.ranked) throw new Error('withCompleteFlags can nhanh dung bo cham');
      flags.push(out.ranked.every((r) => KEYS.every((k) => r.components[k].scaled !== null)));
      return out;
    },
    completeFlags: () => [...flags],
  };
}

/** Ket qua lien quan den hoc cua mot lan chay (dung cho duong hoi tu va ti le chap nhan). */
export interface LearningTrace {
  /** Khoang cach L1 tu trong so cua nhanh den `target` SAU moi quyet dinh; phan tu 0 la LUC BAN DAU (chua co quyet dinh). */
  distance: number[];
  /** Ti le nguoi xep dau trung nguoi truong nhom chon, theo cua so: ba phan dau / ba phan cuoi cua cac quyet dinh. */
  acceptFirstThird: number;
  acceptLastThird: number;
  acceptAll: number;
  /**
   * Nhu tren nhung CHI tinh cac quyet dinh ma moi ung vien deu du ba thanh phan (mau so chung cua hai nhanh); null neu phan do khong
   * co quyet dinh nao nhu vay. Tach rieng vi ti le chap nhan chung bi hien tuong "nguoi moi bi goi y mai" (xem withCompleteFlags) chi phoi.
   */
  acceptFirstThirdComplete: number | null;
  acceptLastThirdComplete: number | null;
  /** Ti le quyet dinh ma nguoi xep dau CHUA co the nao da xong (nguoi moi), ba dau / ba cuoi. */
  newcomerTopFirstThird: number;
  newcomerTopLastThird: number;
}

export interface TraceDecision {
  weights: Weights | null;
  topKey: string;
  leaderKey: string | null;
  topHasNoHistory: boolean;
}

/**
 * Tu chuoi quyet dinh (co trong so cua nhanh va nguoi truong nhom chon) dung duong hoi tu + ti le chap nhan. `complete[i]` = quyet dinh i
 * co moi ung vien deu du ba thanh phan (xem withCompleteFlags). `initial` la trong so luc ban dau (de co diem t = 0).
 */
export function learningTrace(
  decisions: readonly TraceDecision[],
  target: Weights,
  complete: readonly boolean[],
  initial: Weights = LEGACY_WEIGHTS_V1
): LearningTrace {
  const n = decisions.length;
  if (n < 3) throw new RangeError('can it nhat 3 quyet dinh de chia ba');
  if (complete.length !== n) throw new RangeError('so co "du du lieu" phai bang so quyet dinh');
  for (const d of decisions) {
    if (d.weights === null) throw new RangeError('nhanh khong co trong so (khong phai nhanh dung bo cham)');
    if (d.leaderKey === null) throw new RangeError('quyet dinh khong co truong nhom');
  }
  const third = Math.floor(n / 3);
  const accepted = (i: number) => decisions[i]!.topKey === decisions[i]!.leaderKey;
  const rate = (from: number, to: number) => {
    let hit = 0;
    for (let i = from; i < to; i += 1) if (accepted(i)) hit += 1;
    return hit / (to - from);
  };
  const rateComplete = (from: number, to: number): number | null => {
    let hit = 0;
    let total = 0;
    for (let i = from; i < to; i += 1) {
      if (!complete[i]) continue;
      total += 1;
      if (accepted(i)) hit += 1;
    }
    return total === 0 ? null : hit / total;
  };
  const newcomerTop = (from: number, to: number) => {
    let c = 0;
    for (let i = from; i < to; i += 1) if (decisions[i]!.topHasNoHistory) c += 1;
    return c / (to - from);
  };
  return {
    distance: [l1Distance(initial, target), ...decisions.map((d) => l1Distance(d.weights!, target))],
    acceptFirstThird: rate(0, third),
    acceptLastThird: rate(n - third, n),
    acceptAll: rate(0, n),
    acceptFirstThirdComplete: rateComplete(0, third),
    acceptLastThirdComplete: rateComplete(n - third, n),
    newcomerTopFirstThird: newcomerTop(0, third),
    newcomerTopLastThird: newcomerTop(n - third, n),
  };
}
