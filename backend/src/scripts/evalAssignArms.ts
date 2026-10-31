// Cac NHANH (chinh sach chon nguoi) cua bo danh gia goi y phan cong (buoc 7, ASSIGN_MODULE.md §11).
//
// TEP NAY KHONG DUOC import simGenerator / simVocab: mot nhanh chi duoc thay cai bo cham thay - chu trong the va KET QUA
// hoan thanh - khong bao gio thay ky nang an cua nguoi mo phong. Cac nhanh THAM CHIEU (nguoi gioi nhat, toi uu) can ky
// nang an nen nam o evalAssignRun.ts. Co test canh giu (doc ma nguon). Rng tu bo sinh chi di vao qua giao dien
// `RandomSource` ben duoi.
//
// Moi nhanh la mot doi tuong CO TRANG THAI RIENG (con tro chia vong tron, trong so dang hoc...): dung ArmSpec.make() de
// lay mot ban moi cho moi (hat giong, lan chay) - khong dung chung giua hai lan chay.

import {
  LEGACY_WEIGHTS_V1,
  rankCandidates,
  type CandidateInput,
  type ComponentKey,
  type MissingPolicy,
  type Normalization,
  type RankedCandidate,
  type ScoreCard,
  type ScoreParams,
  type Weights,
} from '../modules/assign/assign.score';
import type { Idf } from '../modules/assign/assign.tfidf';

/** Nguon so ngau nhien toi thieu ma nhanh can (Rng cua bo sinh thoa man). */
export interface RandomSource {
  next(): number;
  int(n: number): number;
}

/** Cung hinh dang voi Snapshot cua simReplay (khong import de tep nay khong keo theo bo sinh). */
export interface ArmSnapshot {
  now: Date;
  idf: Idf;
  mu: number | null;
  candidates: readonly CandidateInput[];
}

/** Doi tuong "tra loi" ma CHI nhanh tham chieu duoc dung (evalAssignRun.ts). Nhanh thuong khong duoc cham vao. */
export interface Oracle {
  skillOf(key: string): number;
  pOnTimeOf(key: string): number;
}

export interface ArmInput {
  card: ScoreCard;
  /** Ho boi = cac ung vien trong snapshot. */
  snapshot: ArmSnapshot;
  /** So the DANG MO chong lan cua tung nguoi trong ho boi (dinh nghia cua bo cham; runner tinh mot lan moi quyet dinh). */
  load: ReadonlyMap<string, number>;
  /** Luong ngau nhien RIENG cua the nay (chi nhanh ngau nhien dung). */
  rng: RandomSource;
  oracle?: Oracle;
}

export interface ArmOutput {
  /** Khoa nguoi, tot nhat truoc. Bat buoc la HOAN VI cua ho boi. */
  order: string[];
  /** Co khi nhanh dung bo cham (de hoc va de xem tung thanh phan); null voi nhanh khong dung bo cham. */
  ranked: RankedCandidate[] | null;
}

export interface ArmFeedback {
  /** Ket qua xep hang ma nhanh vua tra ve cho dung quyet dinh nay. */
  output: ArmOutput;
  /** Nguoi ma truong nhom (gia) se chon / da chon. */
  chosenKey: string;
}

export interface Arm {
  readonly id: string;
  readonly label: string;
  rank(input: ArmInput): ArmOutput;
  /** Phan hoi cua truong nhom sau moi quyet dinh (chi nhanh co hoc dung). */
  observe?(feedback: ArmFeedback): void;
  /** Trong so dang dung (nhanh dung bo cham) - de ve duong hoi tu. */
  weights?(): Weights;
}

export interface ArmSpec {
  id: string;
  label: string;
  /** Tao mot ban MOI (co trang thai rieng). */
  make: () => Arm;
}

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const poolKeys = (s: ArmSnapshot): string[] => s.candidates.map((c) => c.userId).sort(byKey);

/** Nhanh 1: rut ngau nhien trong ho boi (Fisher-Yates tren danh sach da sap theo khoa -> tat dinh khi biet luong `rng`). */
export function randomArm(): Arm {
  return {
    id: 'random',
    label: 'Ngẫu nhiên',
    rank({ snapshot, rng }) {
      const keys = poolKeys(snapshot);
      for (let i = keys.length - 1; i > 0; i -= 1) {
        const j = rng.int(i + 1);
        [keys[i], keys[j]] = [keys[j]!, keys[i]!];
      }
      return { order: keys, ranked: null };
    },
  };
}

/**
 * Nhanh 2: chia vong tron theo thu tu khoa. Con tro tien theo GOI Y cua chinh nhanh (moi lan rank tien mot buoc); nguoi
 * khong con trong ho boi bi bo qua, nguoi cuoi vong quay ve dau.
 */
export function roundRobinArm(): Arm {
  let last: string | null = null;
  return {
    id: 'round-robin',
    label: 'Chia vòng tròn',
    rank({ snapshot }) {
      const keys = poolKeys(snapshot);
      let start = 0;
      if (last !== null) {
        const after = last;
        const idx = keys.findIndex((k) => k > after);
        start = idx === -1 ? 0 : idx;
      }
      const order = [...keys.slice(start), ...keys.slice(0, start)];
      last = order[0]!;
      return { order, ranked: null };
    },
  };
}

/** Nhanh 3: nguoi it the dang mo chong lan nhat (dem tho, khong chia cho suc chua); hoa -> khoa nho hon. */
export function mostFreeArm(): Arm {
  return {
    id: 'most-free',
    label: 'Người rảnh nhất',
    rank({ snapshot, load }) {
      const order = poolKeys(snapshot).sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || byKey(a, b));
      return { order, ranked: null };
    },
  };
}

/** Nhanh 4: nguoi da xong NHIEU the nhat tinh den luc giao (the xong sau do khong tinh); hoa -> khoa nho hon. */
export function mostFrequentArm(): Arm {
  return {
    id: 'most-frequent',
    label: 'Người hay làm nhất',
    rank({ snapshot }) {
      const nowMs = snapshot.now.getTime();
      const done = new Map(
        snapshot.candidates.map((c) => [c.userId, c.history.filter((h) => h.completedAt.getTime() <= nowMs).length])
      );
      const order = poolKeys(snapshot).sort((a, b) => done.get(b)! - done.get(a)! || byKey(a, b));
      return { order, ranked: null };
    },
  };
}

export interface ScorerArmOptions {
  id: string;
  label: string;
  /** Mac dinh LEGACY_WEIGHTS_V1 (ghim so lieu buoc 7, §17.6) - khong phai DEFAULT_WEIGHTS moi cua san pham. */
  weights?: Weights;
  params?: Partial<ScoreParams>;
  /** Mac dinh 'MINMAX' va 'DROP' - dung cau hinh SAN PHAM (assign.service.ts). */
  normalize?: Normalization;
  /** Mot gia tri (ca bon thanh phan) hoac ban ghi theo thanh phan (buoc 12); khong truyen = DEFAULT_MISSING cua bo cham. */
  missing?: MissingPolicy | Partial<Record<ComponentKey, MissingPolicy>>;
}

/** Cac nhanh dung bo cham: chi khac nhau o trong so / tham so. */
export function scorerArm(o: ScorerArmOptions): Arm {
  const weights: Weights = { ...(o.weights ?? LEGACY_WEIGHTS_V1) };
  return {
    id: o.id,
    label: o.label,
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
    weights: () => ({ ...weights }),
  };
}

/** Ba thanh phan tu lich su - cac nhanh cua buoc 7 chi nhin ba thanh phan nay (Ho so = 0). */
export type WeightKey = Exclude<keyof Weights, 'declared'>;

const W_KEYS: readonly WeightKey[] = ['experience', 'reliability', 'availability'];

/**
 * Bo mot thanh phan (trong so 0) va chia lai hai trong so con lai cho tong = 1 - dung cho nhanh "cat bo". Chi cho bo ba trong so kieu
 * cu (Ho so = 0): Ho so khac 0 se bi bo mat im lang nen nem loi.
 */
export function withoutComponent(w: Weights, drop: WeightKey): Weights {
  if (w.declared !== 0) throw new RangeError('withoutComponent chi dung cho bo trong so khong co Ho so (declared = 0)');
  const rest = W_KEYS.filter((k) => k !== drop);
  const total = rest.reduce((s, k) => s + w[k], 0);
  if (!(total > 0)) throw new RangeError('hai trong so con lai phai co tong > 0');
  const out: Weights = { experience: 0, reliability: 0, availability: 0, declared: 0 };
  for (const k of rest) out[k] = w[k] / total;
  return out;
}

const only = (k: WeightKey): Weights => ({
  experience: k === 'experience' ? 1 : 0,
  reliability: k === 'reliability' ? 1 : 0,
  availability: k === 'availability' ? 1 : 0,
  declared: 0,
});

/** Bay nhanh dau cua bang so sanh chinh (nhanh 8 - "co hoc" - nam o evalAssignLeader.ts vi can truong nhom gia). */
export const MAIN_ARMS: readonly ArmSpec[] = [
  { id: 'random', label: 'Ngẫu nhiên', make: randomArm },
  { id: 'round-robin', label: 'Chia vòng tròn', make: roundRobinArm },
  { id: 'most-free', label: 'Người rảnh nhất', make: mostFreeArm },
  { id: 'most-frequent', label: 'Người hay làm nhất', make: mostFrequentArm },
  {
    id: 'exp-only',
    label: 'Chỉ kinh nghiệm',
    make: () => scorerArm({ id: 'exp-only', label: 'Chỉ kinh nghiệm', weights: only('experience') }),
  },
  {
    id: 'load-only',
    label: 'Chỉ tải (khả dụng)',
    make: () => scorerArm({ id: 'load-only', label: 'Chỉ tải (khả dụng)', weights: only('availability') }),
  },
  {
    id: 'full',
    label: 'Đầy đủ, trọng số cố định',
    make: () => scorerArm({ id: 'full', label: 'Đầy đủ, trọng số cố định' }),
  },
];

/** Nghien cuu cat bo: tung thanh phan dung mot minh, va bo tung thanh phan khoi cau hinh mac dinh. */
export const ABLATION_ARMS: readonly ArmSpec[] = [
  {
    id: 'rel-only',
    label: 'Chỉ tin cậy',
    make: () => scorerArm({ id: 'rel-only', label: 'Chỉ tin cậy', weights: only('reliability') }),
  },
  {
    id: 'no-avail',
    label: 'Bỏ khả dụng',
    make: () => scorerArm({ id: 'no-avail', label: 'Bỏ khả dụng', weights: withoutComponent(LEGACY_WEIGHTS_V1, 'availability') }),
  },
  {
    id: 'no-rel',
    label: 'Bỏ tin cậy',
    make: () => scorerArm({ id: 'no-rel', label: 'Bỏ tin cậy', weights: withoutComponent(LEGACY_WEIGHTS_V1, 'reliability') }),
  },
  {
    id: 'no-exp',
    label: 'Bỏ kinh nghiệm',
    make: () => scorerArm({ id: 'no-exp', label: 'Bỏ kinh nghiệm', weights: withoutComponent(LEGACY_WEIGHTS_V1, 'experience') }),
  },
];
