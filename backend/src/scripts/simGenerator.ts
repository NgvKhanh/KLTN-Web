// Bo sinh du lieu mo phong cho module goi y phan cong (ASSIGN_MODULE.md §7).
//
// HAM THUAN, TAT DINH: cung mot `seed` luon cho ra cung mot bo du lieu, khong
// doc dong ho he thong, khong doc CSDL. Moi moc thoi gian la SO NGAY nguyen
// tinh tu dau lich su (ngay 0) den "hom nay" (ngay cfg.days); noi ghi vao CSDL
// moi quy doi sang ngay that (xem seedSimulation.ts).
//
// Y TUONG TRUNG TAM: moi nguoi co mot vec-to KY NANG AN theo chu de. Bo cham
// diem khong bao gio duoc thay vec-to nay - no chi thay CHU trong the va KET
// QUA hoan thanh. Nho vay phep danh gia o buoc 7 co "dap an tot nhat" de so,
// thu ma du lieu that khong co.
//
// SAU NGUON LECH CO Y (de bo sinh khong trung gia dinh voi bo cham - neu trung
// thi thang la duong nhien va ca chuong danh gia thanh vo nghia):
//   1. Tu dong nghia / viet tat        -> SYNONYMS trong simVocab
//   2. Loi chinh ta                    -> typo()
//   3. The mo ho khong lo chu de       -> GENERIC_TITLES
//   4. Phan cong lich su SAI mot phan  -> cfg.wrongAssignRate
//   5. Ky nang THAY DOI theo thoi gian -> person.learning (nguoi hoc nghe)
//   6. Ket qua dung han theo XAC SUAT  -> khong phai "hop thi luon dung han"

import {
  GENERIC_DESC,
  GENERIC_TITLES,
  SYNONYMS,
  TOPICS,
} from './simVocab';

export interface SimConfig {
  seed: number;
  /** So thanh vien trong nhom. */
  people: number;
  /** So "du an cu" (bang). */
  boards: number;
  cardsPerBoard: number;
  /** Do dai lich su tinh bang ngay; ngay cfg.days = "hom nay". */
  days: number;
  /** Ti le the duoc giao cho nguoi KHONG hop (nhieu cua doi that). */
  wrongAssignRate: number;
  /** Ti le the co tieu de khong lo chu de. */
  ambiguousRate: number;
  /** Xac suat thay mot cum tu bang tu dong nghia / viet tat. */
  synonymRate: number;
  /** Xac suat go sai chinh ta mot tu trong tieu de. */
  typoRate: number;
  /** Ti le thanh vien la "nguoi hoc nghe" (ky nang tang dan). */
  learnerRate: number;
  /** The tao trong ngan nay ngay cuoi co the con dang mo (tao ra TAI hien tai). */
  openRecentDays: number;
}

export const DEFAULT_SIM: SimConfig = {
  seed: 20260920,
  people: 6,
  boards: 5,
  cardsPerBoard: 24,
  days: 300,
  wrongAssignRate: 0.25,
  ambiguousRate: 0.12,
  synonymRate: 0.3,
  typoRate: 0.08,
  learnerRate: 0.34,
  openRecentDays: 30,
};

export interface SimPerson {
  key: string;
  name: string;
  email: string;
  /** KY NANG AN theo chu de, [0,1]. Bo cham diem khong duoc doc. */
  skills: number[];
  /** Muc tang ky nang tu luc tham gia den het lich su (0 = khong hoc nghe). */
  learning: number[];
  joinedDay: number;
  /** Ngay roi nhom; null = van dang lam. */
  leftDay: number | null;
  /** So the song song toi da - do vao MemberWorkProfile.maxParallelCards. */
  capacity: number;
  /** Do dai lich su, de skillAt() du thong tin ma khong can truyen config. */
  horizonDays: number;
}

export interface SimBoard {
  key: string;
  name: string;
  /** Chu de chinh cua du an (an). */
  themes: number[];
  startDay: number;
  endDay: number;
}

export interface SimCard {
  key: string;
  boardKey: string;
  /** 0 = Can lam, 1 = Dang lam, 2 = Hoan thanh. */
  listIndex: number;
  title: string;
  description: string;
  /** Chu de AN. Chi dung de cham diem o buoc 7, khong dua vao san pham. */
  topic: number;
  secondTopic: number | null;
  ambiguous: boolean;
  createdDay: number;
  assignedDay: number;
  dueDay: number;
  assigneeKey: string;
  assignedByKey: string;
  done: boolean;
  completedDay: number | null;
  onTime: boolean;
  /** Tung bi bo danh dau xong roi danh dau lai (dau hieu lam chua dat). */
  reopened: boolean;
}

export interface SimDataset {
  config: SimConfig;
  people: SimPerson[];
  boards: SimBoard[];
  cards: SimCard[];
}

// ---------- Bo sinh so ngau nhien tat dinh (LCG, cung hang so voi cac test khac) ----------

export class Rng {
  private s: number;

  constructor(seed: number) {
    // Hat giong 0 lam LCG ket cung o 0 sau vai buoc -> ep ve gia tri khac 0.
    this.s = (seed >>> 0) || 1;
  }

  next(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s / 4294967296;
  }

  /** So nguyen trong [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n) % Math.max(1, n);
  }

  /** So thuc trong [a, b). */
  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('pick() tren mang rong');
    return arr[this.int(arr.length)]!;
  }

  /** Chon theo trong so (trong so am hoac tong 0 -> chon deu). */
  weighted<T>(arr: readonly T[], weights: readonly number[]): T {
    if (arr.length === 0) throw new Error('weighted() tren mang rong');
    const safe = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
    const total = safe.reduce((a, b) => a + b, 0);
    if (total <= 0) return this.pick(arr);
    let r = this.next() * total;
    for (let i = 0; i < arr.length; i += 1) {
      r -= safe[i]!;
      if (r <= 0) return arr[i]!;
    }
    return arr[arr.length - 1]!;
  }
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** He so phat tai cua mo hinh ket qua: moi the vuot NUA suc chua tru chung nay khoi xac suat dung han. */
export const DEFAULT_LOAD_PENALTY = 0.06;

/**
 * Xac suat dung han cua mot viec (nguon lech 6): tang theo ky nang, giam khi tai vuot nua suc chua, luon
 * trong [0,05, 0,95]. Xuat ra de phep phat lai (simReplay) danh gia bang CUNG mo hinh ket qua - khong bao gio
 * duoc dua vao bo cham (bo cham khong duoc thay ky nang an). `loadPenalty` mac dinh la gia tri cua bo sinh; buoc 7
 * quet no de xem khi tai that su quan trong thi thanh phan kha dung co ich khong (KHONG nam trong SimConfig: cau hinh
 * la mot phan cua ma bam dong bang).
 */
export function onTimeProbability(
  skill: number,
  load: number,
  capacity: number,
  loadPenalty: number = DEFAULT_LOAD_PENALTY
): number {
  return clamp(0.15 + 0.7 * skill - loadPenalty * Math.max(0, load - capacity / 2), 0.05, 0.95);
}

export interface OutcomeInput {
  skill: number;
  /** So the chong lan luc giao (tai). */
  load: number;
  capacity: number;
  assignedDay: number;
  dueDay: number;
  /** Do dai lich su (ngay); hoan thanh SAU ngay nay = the van con mo. */
  days: number;
  /** The tao gan day: co the con dang mo bat ke ky nang. */
  recent: boolean;
  loadPenalty?: number;
}

export interface Outcome {
  stillOpen: boolean;
  completedDay: number | null;
  onTime: boolean;
  reopened: boolean;
}

/**
 * KET QUA cua mot viec da giao (nguon lech 6). Dung chung cho bo sinh (sinh lich su) va cho phep danh gia vong kin
 * o buoc 7 (nhanh tu giao viec -> ket qua rut tu CUNG mo hinh), de hai ben khong the lech nhau. THU TU GOI `rng`
 * la mot phan cua hop dong: no quyet dinh ma bam dong bang cua bo sinh (test canh).
 *
 * Luu y cho phep so sanh cap (buoc 7): `rng.chance(pOnTime)` dung CUNG mot so ngau nhien cho moi nguoi duoc chon, nen
 * voi cung mot luong, nguoi co xac suat cao hon LUON dung han neu nguoi thap hon dung han (ghep don dieu).
 */
export function sampleOutcome(rng: Rng, o: OutcomeInput): Outcome {
  // The tao gan day co the con dang mo -> tao ra "tai hien tai" de cham diem kha dung co y nghia.
  let stillOpen = o.recent && rng.chance(0.55);

  // Nguon lech 6: dung han la XAC SUAT, phu thuoc ky nang va tai, co nhieu.
  const pOnTime = onTimeProbability(o.skill, o.load, o.capacity, o.loadPenalty);

  let onTime = false;
  let completedDay: number | null = null;
  if (!stillOpen) {
    const planned = Math.max(1, o.dueDay - o.assignedDay);
    const finish = rng.chance(pOnTime)
      ? o.assignedDay + Math.max(1, Math.ceil(planned * (1 - 0.5 * o.skill) * rng.range(0.5, 1)))
      : o.dueDay + 1 + rng.int(1 + Math.round(8 * (1 - o.skill)));
    if (finish > o.days) {
      // Ngay hoan thanh du kien nam SAU hom nay -> the van con mo (co the
      // da qua han). Khong duoc kep ve hom nay: kep se bien mot the tre
      // han thanh dung han va lam du lieu tu mau thuan.
      stillOpen = true;
    } else {
      completedDay = finish;
      // DINH NGHIA duy nhat cua "dung han", trung voi cach module cham
      // diem se do: ngay hoan thanh <= ngay het han.
      onTime = finish <= o.dueDay;
    }
  }

  const reopened = !stillOpen && rng.chance(0.02 + 0.18 * (1 - o.skill));
  return { stillOpen, completedDay, onTime, reopened };
}

// ---------- Ky nang an theo thoi gian ----------

/**
 * Ky nang an cua `person` o `topic` tai `day`. Nguoi hoc nghe tang tuyen tinh
 * tu luc tham gia den het lich su. Chua tham gia -> 0 (khong phai ung vien).
 */
export function skillAt(person: SimPerson, topic: number, day: number): number {
  if (day < person.joinedDay) return 0;
  const span = Math.max(1, person.horizonDays - person.joinedDay);
  const progress = clamp((day - person.joinedDay) / span, 0, 1);
  return clamp((person.skills[topic] ?? 0) + (person.learning[topic] ?? 0) * progress, 0, 1);
}

/** Nguoi con lam viec tai `day` (da tham gia va chua roi nhom). */
export function availableAt(people: readonly SimPerson[], day: number): SimPerson[] {
  return people.filter(
    (p) => day >= p.joinedDay && (p.leftDay === null || day < p.leftDay)
  );
}

/** Tre toi da (ngay) sau han: dueDay + 1 + int(1 + round(8)) -> toi da dueDay + 9. */
export const MAX_LATE_DAYS = 9;

/**
 * Ho boi ung vien cho MOT viec: con lam viec luc giao VA khong roi nhom truoc
 * khi viec co the xong. Khong loc vay thi nguoi sap nghi van duoc giao viec
 * hoan thanh SAU ngay ho da roi nhom - du lieu tu mau thuan.
 */
export function assignablePool(
  people: readonly SimPerson[],
  assignedDay: number,
  dueDay: number
): SimPerson[] {
  return availableAt(people, assignedDay).filter(
    (p) => p.leftDay === null || p.leftDay > dueDay + MAX_LATE_DAYS
  );
}

/**
 * DAP AN TOT NHAT cho mot the: nguoi co ky nang an cao nhat o chu de cua the,
 * trong so nhung nguoi con lam viec luc do. Day la thu chi mo phong moi cho
 * biet - buoc 7 dung no lam moc so sanh (Top-1, do hoi tiec).
 */
export function bestCandidate(
  people: readonly SimPerson[],
  card: SimCard
): { key: string; skill: number } {
  const pool = assignablePool(people, card.assignedDay, card.dueDay);
  let best = { key: '', skill: -1 };
  for (const p of pool) {
    const s = skillAt(p, card.topic, card.assignedDay);
    // So sanh theo key khi bang diem -> ket qua tat dinh, khong phu thuoc thu tu
    if (s > best.skill || (s === best.skill && p.key < best.key)) {
      best = { key: p.key, skill: s };
    }
  }
  return best;
}

// ---------- Sinh chu ----------

const COMBINING = new RegExp(
  `[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`,
  'g'
);

/** Bo dau tieng Viet cua mot tu (dung cho phep "go sai chinh ta"). */
function deaccent(word: string): string {
  return word
    .normalize('NFD')
    .replace(COMBINING, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/** Nguon lech 2: go sai mot tu - bo dau, hoac gap doi mot chu cai. */
function typo(text: string, rng: Rng): string {
  const words = text.split(' ');
  const idx = words
    .map((w, i) => (w.length >= 4 ? i : -1))
    .filter((i) => i >= 0);
  if (idx.length === 0) return text;
  const at = rng.pick(idx);
  const word = words[at]!;
  if (rng.chance(0.5)) {
    words[at] = deaccent(word);
  } else {
    const cut = 1 + rng.int(word.length - 1);
    words[at] = word.slice(0, cut) + word[cut - 1] + word.slice(cut);
  }
  return words.join(' ');
}

/** Nguon lech 1: thay cum tu bang tu dong nghia / viet tat. */
function applySynonyms(text: string, rng: Rng, rate: number): string {
  let out = text;
  for (const [phrase, alts] of Object.entries(SYNONYMS)) {
    if (!out.includes(phrase)) continue;
    if (!rng.chance(rate)) continue;
    // Moi lan rut xac suat ap dung cho MOI lan xuat hien cua cum (khong chi lan dau),
    // de synonymRate co nghia ro rang: 1 = thay het, 0 = giu nguyen.
    out = out.split(phrase).join(rng.pick(alts));
  }
  return out;
}

function makeTitle(topic: number, rng: Rng, cfg: SimConfig): string {
  const t = TOPICS[topic]!;
  const detail = rng.pick(t.details);
  const raw = `${rng.pick(t.verbs)} ${rng.pick(t.objects)}${detail ? ` ${detail}` : ''}`;
  let title = applySynonyms(raw, rng, cfg.synonymRate);
  if (rng.chance(cfg.typoRate)) title = typo(title, rng);
  return title;
}

function makeDescription(
  topic: number,
  second: number | null,
  rng: Rng,
  cfg: SimConfig
): string {
  const t = TOPICS[topic]!;
  const parts = [`Cần chú ý ${rng.pick(t.descWords)} và ${rng.pick(t.descWords)}.`];
  if (second !== null) {
    parts.push(`Có liên quan tới ${rng.pick(TOPICS[second]!.descWords)}.`);
  }
  if (rng.chance(0.5)) parts.push(`${rng.pick(GENERIC_DESC)}.`);
  return applySynonyms(parts.join(' '), rng, cfg.synonymRate);
}

// ---------- Sinh nguoi ----------

const FIRST_NAMES = ['An', 'Bình', 'Chi', 'Dũng', 'Giang', 'Hà', 'Khánh', 'Linh', 'Minh', 'Nam'];
const LAST_NAMES = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Ngô'];

function makePeople(cfg: SimConfig, rng: Rng): SimPerson[] {
  const topicCount = TOPICS.length;
  const people: SimPerson[] = [];

  for (let i = 0; i < cfg.people; i += 1) {
    // Nen thap cho moi chu de, roi cho 2 chu de MANH va 1 chu de trung binh ->
    // moi nguoi co chuyen mon rieng thay vi gioi deu (giong nhom sinh vien that).
    const skills = Array.from({ length: topicCount }, () => rng.range(0.05, 0.3));
    const order = Array.from({ length: topicCount }, (_, t) => t);
    for (let k = order.length - 1; k > 0; k -= 1) {
      const j = rng.int(k + 1);
      [order[k], order[j]] = [order[j]!, order[k]!];
    }
    skills[order[0]!] = rng.range(0.65, 0.95);
    skills[order[1]!] = rng.range(0.55, 0.85);
    skills[order[2]!] = rng.range(0.35, 0.6);

    // Nguon lech 5: nguoi hoc nghe - mot chu de yeu tang dan theo thoi gian.
    const learning = Array.from({ length: topicCount }, () => 0);
    if (rng.chance(cfg.learnerRate)) {
      learning[order[topicCount - 1]!] = rng.range(0.3, 0.6);
    }

    // Nguoi cuoi cung tham gia muon (khong co lich su luc dau);
    // nguoi ap chot roi nhom truoc khi het lich su.
    const isLate = i === cfg.people - 1;
    const isLeaver = cfg.people >= 3 && i === cfg.people - 2;
    const joinedDay = isLate ? Math.floor(cfg.days * rng.range(0.5, 0.7)) : 0;
    const leftDay = isLeaver ? Math.floor(cfg.days * rng.range(0.8, 0.92)) : null;

    people.push({
      key: `p${i + 1}`,
      name: `${LAST_NAMES[i % LAST_NAMES.length]} ${FIRST_NAMES[i % FIRST_NAMES.length]}`,
      email: `sim${i + 1}@sim.local`,
      skills,
      learning,
      joinedDay,
      leftDay,
      capacity: 3 + rng.int(4),
      horizonDays: cfg.days,
    });
  }
  return people;
}

// ---------- Sinh bang ----------

function makeBoards(cfg: SimConfig, rng: Rng): SimBoard[] {
  const boards: SimBoard[] = [];
  // Bang CUOI CUNG la "du an dang chay": cua so ngan, ep sat hom nay, nen phan
  // lon the cua no con dang mo. Khong lam vay thi gan nhu khong the nao con mo
  // (do da 3/120) va diem kha dung khong co du lieu de tinh - do la loi that
  // phat hien duoc khi doc ket qua tham do, khong phai suy doan.
  const past = Math.max(1, cfg.boards - 1);
  const span = Math.max(30, Math.floor(cfg.days / 2));
  const lastSpan = Math.max(20, cfg.openRecentDays);

  // Chia chu de cho cac bang bang cach CHIA BAI tu mot co da xao, thay vi boc
  // ngau nhien tung bang. Boc ngau nhien tung lam mot bo du lieu thieu han vai
  // chu de (do duoc: chu de 1 chi co 1/120 the) -> nguoi manh chu de do khong
  // bao gio la dap an dung, va chi so danh gia mat y nghia.
  const deck: number[] = [];
  const refill = () => {
    const pool = Array.from({ length: TOPICS.length }, (_, t) => t);
    for (let k = pool.length - 1; k > 0; k -= 1) {
      const j = rng.int(k + 1);
      [pool[k], pool[j]] = [pool[j]!, pool[k]!];
    }
    deck.push(...pool);
  };

  for (let b = 0; b < cfg.boards; b += 1) {
    const themes: number[] = [];
    while (themes.length < 3) {
      if (deck.length === 0) refill();
      const t = deck.shift()!;
      if (!themes.includes(t)) themes.push(t);
    }
    const current = b === cfg.boards - 1;
    const startDay = current
      ? Math.max(0, cfg.days - lastSpan)
      : Math.floor((b * Math.max(0, cfg.days - lastSpan - span)) / past);
    boards.push({
      key: `b${b + 1}`,
      name: current
        ? `Dự án đang chạy: ${TOPICS[themes[0]!]!.name}`
        : `Dự án ${b + 1}: ${TOPICS[themes[0]!]!.name}`,
      themes,
      startDay,
      endDay: Math.min(cfg.days, startDay + (current ? lastSpan : span)),
    });
  }
  return boards;
}

// ---------- Sinh the + phan cong + ket qua ----------

interface Booking {
  from: number;
  to: number;
}

function overlapCount(bookings: Booking[], from: number, to: number): number {
  return bookings.filter((b) => b.from <= to && b.to >= from).length;
}

function makeCards(
  cfg: SimConfig,
  rng: Rng,
  people: SimPerson[],
  boards: SimBoard[]
): SimCard[] {
  const cards: SimCard[] = [];
  const bookings = new Map<string, Booking[]>(people.map((p) => [p.key, []]));
  let n = 0;

  for (const board of boards) {
    for (let i = 0; i < cfg.cardsPerBoard; i += 1) {
      n += 1;

      // Du an co chu de chinh, nhung van co viec "lac" - giong thuc te.
      const topic = rng.chance(0.15)
        ? rng.int(TOPICS.length)
        : rng.weighted(board.themes, [3, 2, 1]);
      const secondPick = rng.chance(0.3) ? rng.weighted(board.themes, [1, 1, 1]) : null;
      const second = secondPick === topic ? null : secondPick;
      const ambiguous = rng.chance(cfg.ambiguousRate);

      const window = Math.max(1, board.endDay - board.startDay - 4);
      const createdDay = board.startDay + rng.int(window);
      const assignedDay = Math.min(cfg.days, createdDay + rng.int(3));
      const dueDay = Math.min(cfg.days + 21, assignedDay + 3 + rng.int(12));

      const pool = assignablePool(people, assignedDay, dueDay);
      if (pool.length === 0) continue;

      // Nguon lech 4: mot phan phan cong lich su la SAI (chon bua). Phan con
      // lai chon theo ky nang nhung KHONG phai luon lay nguoi gioi nhat (mu 3
      // lam nhon xac suat ma van de lot nguoi hang hai) - neu luon lay nguoi
      // gioi nhat thi lich su chinh la dap an, bai toan thanh tam thuong.
      const assignee = rng.chance(cfg.wrongAssignRate)
        ? rng.pick(pool)
        : rng.weighted(
            pool,
            pool.map((p) => Math.pow(skillAt(p, topic, assignedDay), 3))
          );

      // Nguoi giao viec la chu nhom (p1). Chinh chu nhom nhan viec = TU NHAN
      // (assignedByKey trung assigneeKey; luc ghi CSDL se thanh assignedById null).
      const manager = people[0]!;
      const skill = skillAt(assignee, topic, assignedDay);
      const mine = bookings.get(assignee.key)!;
      const load = overlapCount(mine, assignedDay, dueDay);
      mine.push({ from: assignedDay, to: dueDay });

      // Nguon lech 6 + the tao gan day co the con dang mo (xem sampleOutcome)
      const recent = createdDay > cfg.days - cfg.openRecentDays;
      const { stillOpen, completedDay, onTime, reopened } = sampleOutcome(rng, {
        skill,
        load,
        capacity: assignee.capacity,
        assignedDay,
        dueDay,
        days: cfg.days,
        recent,
      });

      cards.push({
        key: `c${n}`,
        boardKey: board.key,
        listIndex: stillOpen ? (rng.chance(0.5) ? 0 : 1) : 2,
        title: ambiguous ? rng.pick(GENERIC_TITLES) : makeTitle(topic, rng, cfg),
        description: ambiguous
          ? `${rng.pick(GENERIC_DESC)}.`
          : makeDescription(topic, second, rng, cfg),
        topic,
        secondTopic: second,
        ambiguous,
        createdDay,
        assignedDay,
        dueDay,
        assigneeKey: assignee.key,
        assignedByKey: manager.key,
        done: !stillOpen,
        completedDay,
        onTime,
        reopened,
      });
    }
  }
  return cards;
}

/** Sinh toan bo bo du lieu. Tat dinh theo cfg.seed. */
export function generateSimulation(cfg: SimConfig = DEFAULT_SIM): SimDataset {
  if (cfg.people < 2) throw new Error('Can it nhat 2 thanh vien');
  if (cfg.boards < 1) throw new Error('Can it nhat 1 bang');
  if (cfg.cardsPerBoard < 1) throw new Error('Can it nhat 1 the moi bang');
  if (cfg.days < 30) throw new Error('Lich su phai dai it nhat 30 ngay');

  const rng = new Rng(cfg.seed);
  const people = makePeople(cfg, rng);
  const boards = makeBoards(cfg, rng);
  const cards = makeCards(cfg, rng, people, boards);
  return { config: cfg, people, boards, cards };
}

/** Vai con so de in ra khi chay CLI va de test doi chieu. */
export function summarize(data: SimDataset) {
  const done = data.cards.filter((c) => c.done);
  const optimal = data.cards.filter(
    (c) => bestCandidate(data.people, c).key === c.assigneeKey
  );
  return {
    people: data.people.length,
    boards: data.boards.length,
    cards: data.cards.length,
    open: data.cards.length - done.length,
    onTimeRate: done.length ? done.filter((c) => c.onTime).length / done.length : 0,
    reopenedRate: done.length ? done.filter((c) => c.reopened).length / done.length : 0,
    ambiguousRate: data.cards.length
      ? data.cards.filter((c) => c.ambiguous).length / data.cards.length
      : 0,
    /** Ti le phan cong lich su TRUNG voi nguoi gioi nhat - KHONG duoc gan 1. */
    optimalAssignRate: data.cards.length ? optimal.length / data.cards.length : 0,
  };
}
