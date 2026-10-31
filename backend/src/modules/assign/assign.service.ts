// Goi y phan cong: noi cac tang (doc CSDL -> anh chup -> bo cham -> che rieng tu -> nhat ky) va quyen truy cap.
// Lich su thiet ke: ASSIGN_MODULE.md §4 (kien truc), §9-10 (bang, API). Bo cham nam o assign.score.ts (ham thuan);
// file nay khong tinh diem, chi lap dau vao va dong goi dau ra.

import { AppError } from '../../utils/AppError';
import { assertCardAccess } from '../card/card.service';
import { assertListAccess } from '../list/list.service';
import { cvDownloadableOf } from '../declaredProfile/declaredProfile.service';
import { assertWorkspaceAccess, assertWorkspaceManage } from '../workspace/workspace.service';
import {
  createRun,
  decideAndLearn,
  findRun,
  isOnCard,
  readBoardRef,
  readCandidates,
  readFeedbackStats,
  readMemberships,
  readPlanCards,
  readDeclaredProfiles,
  readProfiles,
  readReopenedCardIds,
  readViewableBoardIds,
  readWeightHistory,
  readWeights,
  readWorkProfile,
  readWorkspaceCards,
  saveWeights,
  saveWorkProfile,
  type HistoryWeights,
  type RunRow,
  type StoredProfile,
  type StoredWeights,
} from './assign.repo';
import { declaredItems, type DeclaredEvidence, type DeclaredItem } from './assign.declared';
import { LEARN_ETA, LEARN_MIN_FEEDBACK, type LearnReason } from './assign.learn';
import { PLAN_MAX_CARDS, PLAN_VERSION, planAssignments, urgencyOrder } from './assign.plan';
import { MAX_PARALLEL_LIMIT } from './assign.schema';
import {
  DEFAULT_MAX_PARALLEL,
  DEFAULT_WEIGHTS,
  rankCandidates,
  type CandidateScore,
  type ConfidenceLevel,
  type Flag,
  type MissingPolicy,
  type ComponentKey,
  type OutcomeKind,
  type Weights,
} from './assign.score';
import { buildSnapshot } from './assign.snapshot';
import { isDefaultWeights, sameWeights, weightIssues } from './assign.weights';

// Hai lua chon cua bo cham duoc ghi RO o day (khong dua vao mac dinh cua assign.score.ts) de mot lan ai do doi
// mac dinh thi nhat ky khong noi doi: phien ban thuat toan luon mo ta dung thu da chay.
const NORMALIZE = 'MINMAX' as const;
// Buoc 16 (§17.5): thieu du lieu THEO THANH PHAN - bo thanh phan lich su thieu (DROP), nguoi khong khai ho so nhan trung binh (NEUTRAL)
const MISSING: Readonly<Record<ComponentKey, MissingPolicy>> = {
  experience: 'DROP',
  reliability: 'DROP',
  availability: 'DROP',
  declared: 'NEUTRAL',
};
export const ALGORITHM_VERSION = `knn-tfidf-v2/${NORMALIZE.toLowerCase()}/${MISSING.experience.toLowerCase()}+decl-${MISSING.declared.toLowerCase()}`;


/**
 * Moi thu bo cham can doc cua mot khong gian (dung chung cho goi y mot the va chia ca danh sach): the, lien ket the-nguoi,
 * the tung mo lai, ho so, va bo trong so DANG DUNG. Trong so luu hong (sua tay trong CSDL) khong duoc lam mat goi y cua ca
 * nhom: lui ve mac dinh.
 */
async function readScoringInputs(workspaceId: string, candidateIds: readonly string[]) {
  const [cards, memberships, reopened, profiles, stored, declaredProfiles] = await Promise.all([
    readWorkspaceCards(workspaceId),
    readMemberships(workspaceId, candidateIds),
    readReopenedCardIds(workspaceId),
    readProfiles(workspaceId, candidateIds),
    readWeights(workspaceId),
    readDeclaredProfiles(candidateIds),
  ]);
  let weights: Weights = { ...DEFAULT_WEIGHTS };
  if (stored) {
    if (weightIssues(stored.weights).length === 0) weights = stored.weights;
    else console.warn(`[assign] trong so cua khong gian ${workspaceId} khong hop le, dung mac dinh`);
  }
  // Cat muc ho so MOT lan cho moi nguoi (tach tu la phan dat nhat - lop 2 cham lai ca nhom cho moi the)
  const declared = new Map<string, DeclaredItem[]>([...declaredProfiles].map(([id, p]) => [id, declaredItems(p)]));
  return { cards, memberships, reopened, profiles, weights, declared };
}

// ===================== Goi y cho mot the =====================

export interface SuggestionEvidence {
  cardId: string;
  /** null = the nay thuoc bang ma nguoi hoi KHONG xem duoc (rieng tu): che tieu de, diem van tinh ca no. */
  title: string | null;
  sim: number;
  weight: number;
  outcome: OutcomeKind;
  completedAt: Date;
  dueDate: Date | null;
}

export interface Suggestion {
  rank: number;
  /** Co y khong co email: ket qua nay hien cho moi nguoi sua duoc the. */
  user: { id: string; name: string; avatarUrl: string | null };
  /** Diem TUONG DOI trong nhom ung vien cua the nay (0-100), null neu khong co du lieu. Khong so sanh duoc giua hai the. */
  score: number | null;
  /** Diem tho theo §5.7 nguyen van. */
  rawScore: number | null;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  components: CandidateScore['components'];
  /** Toi da 3 muc ho so tu khai khop nhat (§17.4): cum ky nang / tieu de cong viec; muc CV luon title = null. */
  declaredEvidence: DeclaredEvidence[];
  /** Nguoi HOI tai duoc tep CV cua ung vien nay (co tep + co quyen - declaredProfile.service > cvDownloadableOf). */
  cvAvailable: boolean;
  fit: number;
  evidenceMass: number;
  load: number;
  capacity: number;
  flags: Flag[];
  /** Da o trong the nay roi. */
  assigned: boolean;
  evidence: SuggestionEvidence[];
}

export interface SuggestionResult {
  /** null khi khong co ung vien nao (khong ghi nhat ky). */
  runId: string | null;
  card: { id: string; title: string; boardId: string; workspaceId: string };
  algorithmVersion: string;
  generatedAt: Date;
  weights: Weights & { custom: boolean };
  /** `muy` cua nhom, null neu chua the nao co han. */
  groupOnTimeRate: number | null;
  candidateCount: number;
  candidates: Suggestion[];
}

/**
 * Xep hang nhung nguoi co the nhan the `cardId`, dua tren lich su cua khong gian chua the.
 * `now` mac dinh la bay gio; test truyen vao de chay lai "tai mot thoi diem" (khong doc dong ho ben trong).
 * Co ghi 1 dong AssignRun (nhat ky + nguon do ti le chap nhan) - vi vay route co gioi han toc do.
 */
export async function suggestForCard(userId: string, cardId: string, now: Date = new Date()): Promise<SuggestionResult> {
  const startedAt = Date.now();
  // Quyen: dung dung ham cua thao tac sua the -> VIEWER bi chan, nguoi ngoai bang bi chan
  const card = await assertCardAccess(userId, cardId);
  const board = await readBoardRef(card.list.boardId);
  if (!board) throw new AppError('Khong tim thay bang', 404);

  const candidateUsers = await readCandidates(board);
  const candidateIds = candidateUsers.map((u) => u.id);

  const [{ cards, memberships, reopened, profiles, weights, declared }, viewable, cvOk] = await Promise.all([
    readScoringInputs(board.workspaceId, candidateIds),
    readViewableBoardIds(userId, board.workspaceId),
    cvDownloadableOf(userId, candidateIds),
  ]);

  const snapshot = buildSnapshot({
    cards,
    memberships,
    reopened,
    profiles,
    candidateIds,
    targetCardId: card.id,
    now,
    declared,
  });
  const ranked = rankCandidates(
    { id: card.id, title: card.title, description: card.description, startDate: card.startDate, dueDate: card.dueDate },
    snapshot.candidates,
    { idf: snapshot.idf, now, groupOnTimeRate: snapshot.mu, weights, normalize: NORMALIZE, missing: MISSING }
  );

  const userById = new Map(candidateUsers.map((u) => [u.id, u]));
  const boardOfCard = new Map(cards.map((c) => [c.id, c.boardId]));
  const assignedIds = new Set(memberships.filter((m) => m.cardId === card.id).map((m) => m.userId));
  // Che that bai theo huong AN: khong biet the thuoc bang nao -> coi nhu khong xem duoc
  const canSee = (evidenceCardId: string) => {
    const b = boardOfCard.get(evidenceCardId);
    return b !== undefined && viewable.has(b);
  };

  const candidates: Suggestion[] = ranked.map((r) => {
    const u = userById.get(r.userId)!;
    return {
      rank: r.rank,
      user: { id: u.id, name: u.name, avatarUrl: u.avatarUrl },
      score: r.score,
      rawScore: r.rawScore,
      confidence: r.confidence,
      confidenceLevel: r.confidenceLevel,
      components: r.components,
      declaredEvidence: r.declaredEvidence,
      cvAvailable: cvOk.has(r.userId),
      fit: r.fit,
      evidenceMass: r.evidenceMass,
      load: r.load,
      capacity: r.capacity,
      flags: r.flags,
      assigned: assignedIds.has(r.userId),
      evidence: r.evidence.map((e) => ({
        cardId: e.cardId,
        title: canSee(e.cardId) ? e.title : null,
        sim: e.sim,
        weight: e.weight,
        outcome: e.outcome,
        completedAt: e.completedAt,
        dueDate: e.dueDate,
      })),
    };
  });

  let runId: string | null = null;
  if (ranked.length > 0) {
    const top = ranked[0]!;
    runId = await createRun({
      workspaceId: board.workspaceId,
      boardId: board.id,
      cardId: card.id,
      actorKey: userId,
      algorithmVersion: ALGORITHM_VERSION,
      weights: { ...weights },
      // Nhat ky KHONG chep tieu de the (chi id) - de khong nhan ban noi dung co the la cua bang rieng tu
      candidates: ranked.map((r) => ({
        userId: r.userId,
        rank: r.rank,
        score: r.score,
        rawScore: r.rawScore,
        confidence: r.confidence,
        confidenceLevel: r.confidenceLevel,
        load: r.load,
        capacity: r.capacity,
        flags: r.flags,
        components: {
          experience: { value: r.components.experience.value, scaled: r.components.experience.scaled, share: r.components.experience.share },
          reliability: { value: r.components.reliability.value, scaled: r.components.reliability.scaled, share: r.components.reliability.share },
          availability: { value: r.components.availability.value, scaled: r.components.availability.scaled, share: r.components.availability.share },
          declared: { value: r.components.declared.value, scaled: r.components.declared.scaled, share: r.components.declared.share },
        },
        evidence: r.evidence.map((e) => ({ cardId: e.cardId, sim: e.sim, weight: e.weight, outcome: e.outcome })),
        // Nhu bang chung the: KHONG chep chu (cum ky nang / tieu de cong viec la du lieu rieng cua nguoi do), chi ma muc + do giong
        declaredEvidence: r.declaredEvidence.map((e) => ({ kind: e.kind, itemId: e.itemId, sim: e.sim })),
      })),
      candidateCount: ranked.length,
      topUserId: top.score !== null ? top.userId : null,
      latencyMs: Date.now() - startedAt,
    });
  }

  return {
    runId,
    card: { id: card.id, title: card.title, boardId: board.id, workspaceId: board.workspaceId },
    algorithmVersion: ALGORITHM_VERSION,
    generatedAt: now,
    weights: { ...weights, custom: !isDefaultWeights(weights) },
    groupOnTimeRate: snapshot.mu,
    candidateCount: ranked.length,
    candidates,
  };
}

// ===================== Chia viec cho ca danh sach (lop 2) =====================

export interface PlanPick {
  user: { id: string; name: string; avatarUrl: string | null };
  /** Diem TUONG DOI trong nhom ung vien cua the nay TAI BUOC nay (da tinh cac the chia truoc). */
  score: number | null;
  rawScore: number | null;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  components: CandidateScore['components'];
  load: number;
  capacity: number;
  flags: Flag[];
}

export interface PlanRowView {
  /** 1 = xu ly truoc (han gap nhat). */
  order: number;
  card: { id: string; title: string; startDate: Date | null; dueDate: Date | null };
  /** null = khong ai du dieu kien (moi nguoi dang tam nghi): de trong, khong bia. */
  assignee: PlanPick | null;
  /** Xep hang cua MOI ung vien cho the nay tai buoc nay - de doi nguoi nhan trong ban xem truoc. Khong co bang chung (§10.10). */
  ranking: { userId: string; rank: number; score: number | null; load: number; capacity: number; flags: Flag[] }[];
}

export interface PlanPerson {
  user: { id: string; name: string; avatarUrl: string | null };
  capacity: number;
  /** So the dang mo cua nguoi nay TRUOC khi chia. */
  openCards: number;
  paused: boolean;
}

export interface PlanResult {
  list: { id: string; name: string; boardId: string; workspaceId: string };
  algorithmVersion: string;
  planVersion: string;
  generatedAt: Date;
  weights: Weights & { custom: boolean };
  groupOnTimeRate: number | null;
  people: PlanPerson[];
  /** Tong so the chua co nguoi nhan trong danh sach (co the nhieu hon so dong: xem `truncated`). */
  totalUnassigned: number;
  /** Chi chia PLAN_MAX_CARDS the dau (han gap nhat); phan con lai de lan sau. */
  truncated: boolean;
  rows: PlanRowView[];
}

/**
 * Chia cac the CHUA CO NGUOI NHAN cua danh sach `listId` cho nhung nguoi co the nhan (assign.plan.ts). CHI DE XEM TRUOC:
 * khong ghi gi vao CSDL (khong AssignRun, khong CardMember) - nguoi dung ap dung bang API giao the co san. Khong tra bang
 * chung (tieu de the cu) nen khong co gi de che theo quyen xem bang (§10.4). `now` mac dinh la bay gio; test truyen vao.
 */
export async function planForList(userId: string, listId: string, now: Date = new Date()): Promise<PlanResult> {
  // Quyen: nhu goi y cho mot the - phai SUA duoc bang (VIEWER va nguoi ngoai bi chan)
  const list = await assertListAccess(userId, listId);
  const board = await readBoardRef(list.boardId);
  if (!board) throw new AppError('Khong tim thay bang', 404);

  const candidateUsers = await readCandidates(board);
  const candidateIds = candidateUsers.map((u) => u.id);
  const [planCards, { cards, memberships, reopened, profiles, weights, declared }] = await Promise.all([
    readPlanCards(list.id),
    readScoringInputs(board.workspaceId, candidateIds),
  ]);

  const snapshot = buildSnapshot({ cards, memberships, reopened, profiles, candidateIds, targetCardId: null, now, declared });
  const plan = planAssignments({
    cards: urgencyOrder(planCards).slice(0, PLAN_MAX_CARDS),
    candidates: snapshot.candidates,
    ctx: { idf: snapshot.idf, now, groupOnTimeRate: snapshot.mu, weights, normalize: NORMALIZE, missing: MISSING },
  });

  const userById = new Map(candidateUsers.map((u) => [u.id, u]));
  // Co y khong co email: ket qua nay hien cho moi nguoi sua duoc bang
  const publicUser = (id: string) => {
    const u = userById.get(id)!;
    return { id: u.id, name: u.name, avatarUrl: u.avatarUrl };
  };

  const rows: PlanRowView[] = plan.map((row, i) => {
    const pick = row.ranked.find((r) => r.userId === row.assigneeId);
    return {
      order: i + 1,
      card: { id: row.card.id, title: row.card.title, startDate: row.card.startDate, dueDate: row.card.dueDate },
      assignee: pick
        ? {
            user: publicUser(pick.userId),
            score: pick.score,
            rawScore: pick.rawScore,
            confidence: pick.confidence,
            confidenceLevel: pick.confidenceLevel,
            components: pick.components,
            load: pick.load,
            capacity: pick.capacity,
            flags: pick.flags,
          }
        : null,
      ranking: row.ranked.map((r) => ({
        userId: r.userId,
        rank: r.rank,
        score: r.score,
        load: r.load,
        capacity: r.capacity,
        flags: r.flags,
      })),
    };
  });

  const people: PlanPerson[] = snapshot.candidates.map((c) => ({
    user: publicUser(c.userId),
    capacity: c.maxParallelCards ?? DEFAULT_MAX_PARALLEL,
    openCards: c.openCards.length,
    paused: c.pausedUntil instanceof Date && c.pausedUntil.getTime() >= now.getTime(),
  }));

  return {
    list: { id: list.id, name: list.name, boardId: board.id, workspaceId: board.workspaceId },
    algorithmVersion: ALGORITHM_VERSION,
    planVersion: PLAN_VERSION,
    generatedAt: now,
    weights: { ...weights, custom: !isDefaultWeights(weights) },
    groupOnTimeRate: snapshot.mu,
    people,
    totalUnassigned: planCards.length,
    truncated: planCards.length > PLAN_MAX_CARDS,
    rows,
  };
}

// ===================== Ghi nguoi duoc chon =====================

export interface OutcomeResult {
  runId: string;
  chosenUserId: string;
  topUserId: string | null;
  /** Nguoi duoc chon chinh la nguoi xep dau. */
  accepted: boolean;
  decidedAt: Date;
  /** Luot nay da lam doi trong so cua nhom (muc 2). */
  learned: boolean;
  /**
   * Ba truong duoi CHI co o lan ghi DAU TIEN. Gui lai (da quyet roi) chi tra phan tren: ly do khong duoc luu
   * (khong co cot de luu), va so luot / trong so luc do co the da doi vi luot phan hoi khac.
   */
  learning?: { learned: boolean; reason: LearnReason };
  /** So luot phan hoi cua nhom sau luot nay. */
  feedbackCount?: number;
  /** Trong so cua nhom sau luot nay. */
  weights?: Weights;
}

/**
 * Ghi nguoi thuc su duoc giao sau mot luot goi y. Chi nguoi da bam goi y duoc ghi; nguoi do phai con quyen sua the,
 * va nguoi duoc chon PHAI dang o trong the (khong tin loi khai cua client - nhat ky nay nuoi viec hoc trong so).
 * Chi ghi MOT lan: gui lai dung nguoi cu la khong lam gi (200), gui nguoi khac la 409.
 * Moi luot ghi duoc deu tinh vao `feedbackCount` cua nhom; tu luot thu 10, luot giao KHAC nguoi xep dau con lam trong
 * so cua nhom dich chuyen (assign.learn.ts) - tat ca trong mot giao dich (decideAndLearn).
 */
export async function recordOutcome(
  userId: string,
  runId: string,
  chosenUserId: string,
  now: Date = new Date()
): Promise<OutcomeResult> {
  const run = await findRun(runId);
  // Luot cua nguoi khac cung tra 404: khong lo ra la no ton tai
  if (!run || run.actorKey !== userId) throw new AppError('Khong tim thay luot goi y', 404);
  if (!run.cardId || !run.workspaceId) throw new AppError('The cua luot goi y nay da bi xoa', 409);
  await assertCardAccess(userId, run.cardId);

  if (run.decidedAt) return replayOutcome(run, chosenUserId);

  if (!(await isOnCard(run.cardId, chosenUserId))) throw new AppError('Nguoi nay chua duoc gan vao the', 400);

  const accepted = run.topUserId !== null && run.topUserId === chosenUserId;
  const outcome = await decideAndLearn({ ...run, workspaceId: run.workspaceId }, chosenUserId, now);
  if (outcome) {
    return {
      runId: run.id,
      chosenUserId,
      topUserId: run.topUserId,
      accepted,
      decidedAt: now,
      learned: outcome.learning.learned,
      learning: outcome.learning,
      feedbackCount: outcome.feedbackCount,
      weights: outcome.weights,
    };
  }

  // Thua cuoc dua: mot request khac vua ghi truoc. Doc lai ket qua that.
  const latest = await findRun(run.id);
  if (!latest?.decidedAt) throw new AppError('Khong ghi duoc ket qua, vui long thu lai', 409);
  return replayOutcome(latest, chosenUserId);
}

/** Luot da duoc quyet: cung nguoi -> tra lai ket qua da luu; nguoi khac -> 409. */
function replayOutcome(run: RunRow, chosenUserId: string): OutcomeResult {
  if (run.chosenUserId !== chosenUserId || !run.decidedAt) {
    throw new AppError('Luot goi y nay da duoc ghi nguoi khac', 409);
  }
  return {
    runId: run.id,
    chosenUserId,
    topUserId: run.topUserId,
    accepted: run.accepted,
    decidedAt: run.decidedAt,
    learned: run.learned,
  };
}

// ===================== Trong so cua khong gian =====================

/** So dong lich su tra ve trong GET trong so (moi nhat truoc). */
export const WEIGHT_HISTORY_LIMIT = 20;

export interface WeightHistoryEntry {
  id: string;
  at: Date;
  /** Dong truoc buoc 16: `declared` = null. */
  weights: HistoryWeights;
  /** So luot phan hoi cua nhom LUC DO. */
  feedbackCount: number;
  /** LEARNED = do hoc tu mot luot phan hoi (co runId); MANUAL = chinh tay hoac dat lai. */
  source: 'LEARNED' | 'MANUAL';
  runId: string | null;
}

export interface WorkspaceWeightsView {
  workspaceId: string;
  weights: Weights;
  defaults: Weights;
  /** Khac mac dinh. */
  custom: boolean;
  feedbackCount: number;
  /** null = chua tung chinh (dang dung mac dinh). */
  updatedAt: Date | null;
  /** Hang so cua bo hoc, de giao dien khong phai chep lai (luon dung voi may chu). */
  learning: { minFeedback: number; eta: number; active: boolean };
  /** Chi so danh gia truc tuyen (muc 1): luot da co ket qua / trong do giao dung nguoi xep dau. */
  feedback: { decided: number; accepted: number };
  history: WeightHistoryEntry[];
}

async function viewOf(workspaceId: string, stored: StoredWeights | null): Promise<WorkspaceWeightsView> {
  const [history, feedback] = await Promise.all([
    readWeightHistory(workspaceId, WEIGHT_HISTORY_LIMIT),
    readFeedbackStats(workspaceId),
  ]);
  const weights: Weights = stored && weightIssues(stored.weights).length === 0 ? { ...stored.weights } : { ...DEFAULT_WEIGHTS };
  const feedbackCount = stored?.feedbackCount ?? 0;
  return {
    workspaceId,
    weights,
    defaults: { ...DEFAULT_WEIGHTS },
    custom: !isDefaultWeights(weights),
    feedbackCount,
    updatedAt: stored?.updatedAt ?? null,
    learning: { minFeedback: LEARN_MIN_FEEDBACK, eta: LEARN_ETA, active: feedbackCount >= LEARN_MIN_FEEDBACK },
    feedback,
    history: history.map((h) => ({
      id: h.id,
      at: h.createdAt,
      weights: h.weights,
      feedbackCount: h.feedbackCount,
      source: h.runId ? 'LEARNED' : 'MANUAL',
      runId: h.runId,
    })),
  };
}

/** Moi thanh vien cua khong gian xem duoc trong so dang dung (khong giau), kem lich su doi va so lieu phan hoi. */
export async function getWorkspaceWeights(userId: string, workspaceId: string): Promise<WorkspaceWeightsView> {
  await assertWorkspaceAccess(userId, workspaceId);
  return viewOf(workspaceId, await readWeights(workspaceId));
}

/** Chi OWNER/ADMIN cua khong gian. Kiem tra CHAT (khong tu sua ngam); dat giong het gia tri hien tai thi khong ghi gi. */
export async function setWorkspaceWeights(userId: string, workspaceId: string, input: Weights): Promise<WorkspaceWeightsView> {
  await assertWorkspaceManage(userId, workspaceId);
  const issues = weightIssues(input);
  if (issues.length > 0) {
    throw new AppError(`Trong so khong hop le: ${issues.map((i) => i.message).join('; ')}`, 400);
  }
  const next: Weights = { experience: input.experience, reliability: input.reliability, availability: input.availability, declared: input.declared };
  const current = await readWeights(workspaceId);
  if (sameWeights(current?.weights ?? DEFAULT_WEIGHTS, next)) return viewOf(workspaceId, current);
  return viewOf(workspaceId, await saveWeights(workspaceId, next));
}

/** Dat lai mac dinh (0,36 / 0,24 / 0,20 / Ho so 0,20) va dua so luot phan hoi ve 0 (quy tac "du 10 luot moi hoc" ap dung lai). */
export async function resetWorkspaceWeights(userId: string, workspaceId: string): Promise<WorkspaceWeightsView> {
  await assertWorkspaceManage(userId, workspaceId);
  const current = await readWeights(workspaceId);
  if (!current || (isDefaultWeights(current.weights) && current.feedbackCount === 0)) {
    return viewOf(workspaceId, current);
  }
  return viewOf(workspaceId, await saveWeights(workspaceId, DEFAULT_WEIGHTS, { resetCount: true }));
}

// ===================== Ho so lam viec ca nhan =====================

export interface WorkProfileView {
  workspaceId: string;
  /** So the chong lan toi da truoc khi bi coi la qua tai (§5.6). */
  maxParallelCards: number;
  defaultMaxParallelCards: number;
  /** Tam nghi den het thoi diem nay (null = dang lam binh thuong). Thoi diem da qua = khong con tam nghi. */
  pausedUntil: Date | null;
  /** Chua chinh gi (khong co dong, hoac giong mac dinh va khong tam nghi). */
  isDefault: boolean;
  /** null = chua tung luu. */
  updatedAt: Date | null;
}

function profileView(workspaceId: string, stored: StoredProfile | null): WorkProfileView {
  const maxParallelCards = stored?.maxParallelCards ?? DEFAULT_MAX_PARALLEL;
  const pausedUntil = stored?.pausedUntil ?? null;
  return {
    workspaceId,
    maxParallelCards,
    defaultMaxParallelCards: DEFAULT_MAX_PARALLEL,
    pausedUntil,
    isDefault: maxParallelCards === DEFAULT_MAX_PARALLEL && pausedUntil === null,
    updatedAt: stored?.updatedAt ?? null,
  };
}

/** Ho so cua CHINH nguoi goi trong khong gian nay (moi thanh vien khong gian). */
export async function getMyWorkProfile(userId: string, workspaceId: string): Promise<WorkProfileView> {
  await assertWorkspaceAccess(userId, workspaceId);
  return profileView(workspaceId, await readWorkProfile(userId, workspaceId));
}

/**
 * Nguoi dung tu dat so the song song toi da (1-30) va "tam nghi den" cua CHINH minh. Hai gia tri nay lam thay doi
 * thanh phan kha dung va co OVERLOADED / PAUSED trong goi y (§5.6). Khong ai sua ho so cua nguoi khac.
 */
export async function setMyWorkProfile(
  userId: string,
  workspaceId: string,
  input: { maxParallelCards: number; pausedUntil: Date | null }
): Promise<WorkProfileView> {
  await assertWorkspaceAccess(userId, workspaceId);
  const { maxParallelCards, pausedUntil } = input;
  if (!Number.isInteger(maxParallelCards) || maxParallelCards < 1 || maxParallelCards > MAX_PARALLEL_LIMIT) {
    throw new AppError(`So the song song toi da phai la so nguyen tu 1 den ${MAX_PARALLEL_LIMIT}`, 400);
  }
  if (pausedUntil !== null && !(pausedUntil instanceof Date && Number.isFinite(pausedUntil.getTime()))) {
    throw new AppError('Ngay tam nghi khong hop le', 400);
  }
  return profileView(workspaceId, await saveWorkProfile(userId, workspaceId, { maxParallelCards, pausedUntil }));
}
