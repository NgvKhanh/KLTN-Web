// Kieu du lieu cua module goi y phan cong (khop dung phan hoi cua backend, xem ASSIGN_MODULE.md §10).
// Thoi diem di qua JSON nen la chuoi ISO.

export type AssignFlag = 'NO_HISTORY' | 'NO_SIMILAR' | 'NO_PROFILE' | 'OVERLOADED' | 'PAUSED' | 'NO_DATA';
export type AssignConfidenceLevel = 'THIN' | 'FAIR' | 'GOOD';
export type AssignEvidenceOutcome = 'ON_TIME' | 'ON_TIME_REOPENED' | 'LATE' | 'NO_DUE';

/** Bon thanh phan cua diem: kinh nghiem, do tin cay, kha dung (tu lich su) va Ho so tu khai (§17). */
export interface AssignWeights {
  experience: number;
  reliability: number;
  availability: number;
  declared: number;
}

export type AssignWeightKey = keyof AssignWeights;
export type LegacyWeightKey = Exclude<AssignWeightKey, 'declared'>;

/** Moc lich su trong so: moc TRUOC buoc 16 khong co Ho so (`declared` = null). */
export type AssignHistoryWeights = Omit<AssignWeights, 'declared'> & { declared: number | null };

export interface AssignComponent {
  /** Gia tri THO trong [0,1]; null = chua co du lieu. */
  value: number | null;
  weight: number;
  /** Gia tri da chuan hoa trong nhom ung vien (dung de cong vao diem). */
  scaled: number | null;
  share: number;
}

export interface AssignEvidence {
  cardId: string;
  /** null = the thuoc bang RIENG TU ma nguoi hoi khong xem duoc. */
  title: string | null;
  sim: number;
  weight: number;
  outcome: AssignEvidenceOutcome;
  completedAt: string;
  dueDate: string | null;
}

/** Muc ho so tu khai khop voi the (§17.4). Muc CV luon `title` = null: chu CV khong bao gio ra ngoai chu CV. */
export interface AssignDeclaredEvidence {
  kind: 'SKILL' | 'WORK' | 'CV';
  itemId: string;
  title: string | null;
  sim: number;
}

export interface AssignSuggestion {
  rank: number;
  user: { id: string; name: string; avatarUrl: string | null };
  /** Diem TUONG DOI trong nhom ung vien cua the nay (0-100); null = khong du du lieu. */
  score: number | null;
  rawScore: number | null;
  confidence: number;
  confidenceLevel: AssignConfidenceLevel;
  components: Record<AssignWeightKey, AssignComponent>;
  fit: number;
  evidenceMass: number;
  load: number;
  capacity: number;
  flags: AssignFlag[];
  assigned: boolean;
  evidence: AssignEvidence[];
  /** Toi da 3 muc ho so tu khai khop nhat; rong = khong khai / khong muc nao du giong. */
  declaredEvidence: AssignDeclaredEvidence[];
  /** Nguoi HOI tai duoc tep CV cua ung vien nay (co tep + co quyen: chinh minh hoac OWNER/ADMIN khong gian chung). */
  cvAvailable: boolean;
}

export interface AssignSuggestionResult {
  /** null = khong co ung vien nao (khong ghi nhat ky). */
  runId: string | null;
  card: { id: string; title: string; boardId: string; workspaceId: string };
  algorithmVersion: string;
  generatedAt: string;
  weights: AssignWeights & { custom: boolean };
  groupOnTimeRate: number | null;
  candidateCount: number;
  candidates: AssignSuggestion[];
}

export type AssignLearnReason =
  | 'LEARNED'
  | 'NO_TOP'
  | 'ACCEPTED'
  | 'TOO_EARLY'
  | 'NOT_CANDIDATE'
  | 'MISSING_COMPONENT'
  | 'TIE'
  | 'NO_CHANGE';

export interface AssignOutcomeResult {
  runId: string;
  chosenUserId: string;
  topUserId: string | null;
  accepted: boolean;
  decidedAt: string;
  learned: boolean;
  /** Chi co o lan ghi dau tien. */
  learning?: { learned: boolean; reason: AssignLearnReason };
  feedbackCount?: number;
  weights?: AssignWeights;
}

export interface AssignWeightHistoryEntry {
  id: string;
  at: string;
  weights: AssignHistoryWeights;
  feedbackCount: number;
  /** LEARNED = do he thong tu hoc tu mot luot phan hoi; MANUAL = chinh tay hoac dat lai. */
  source: 'LEARNED' | 'MANUAL';
  runId: string | null;
}

export interface AssignWeightsView {
  workspaceId: string;
  weights: AssignWeights;
  defaults: AssignWeights;
  custom: boolean;
  feedbackCount: number;
  updatedAt: string | null;
  learning: { minFeedback: number; eta: number; active: boolean };
  /** Luot da co ket qua / trong do giao dung nguoi xep dau. */
  feedback: { decided: number; accepted: number };
  history: AssignWeightHistoryEntry[];
}

export interface AssignProfile {
  workspaceId: string;
  maxParallelCards: number;
  defaultMaxParallelCards: number;
  pausedUntil: string | null;
  isDefault: boolean;
  updatedAt: string | null;
}

export interface AssignProfileInput {
  maxParallelCards: number;
  /** ISO co Z, hoac null de bo tam nghi. */
  pausedUntil: string | null;
}

// ---------- Lop 2: chia viec cho ca danh sach (ASSIGN_MODULE.md §10.10) ----------

/** Nguoi co the nhan viec trong mot lan chia. */
export interface AssignPlanPerson {
  user: { id: string; name: string; avatarUrl: string | null };
  /** So the song song toi da (§5.6). */
  capacity: number;
  /** So the DANG MO cua nguoi nay truoc khi chia. */
  openCards: number;
  paused: boolean;
}

/** Nguoi duoc chon cho mot the: co ca ba gia tri tho, khong co bang chung (ban xem truoc khong lo tieu de the cu). */
export interface AssignPlanPick {
  user: { id: string; name: string; avatarUrl: string | null };
  score: number | null;
  rawScore: number | null;
  confidence: number;
  confidenceLevel: AssignConfidenceLevel;
  components: Record<AssignWeightKey, AssignComponent>;
  load: number;
  capacity: number;
  flags: AssignFlag[];
}

/** Xep hang gon cua MOI ung vien cho mot the, TAI BUOC do (da tinh cac the chia truoc). */
export interface AssignPlanRanking {
  userId: string;
  rank: number;
  score: number | null;
  load: number;
  capacity: number;
  flags: AssignFlag[];
}

export interface AssignPlanRow {
  /** 1 = xu ly truoc (han gap nhat). */
  order: number;
  card: { id: string; title: string; startDate: string | null; dueDate: string | null };
  /** null = khong ai du dieu kien (moi nguoi dang tam nghi). */
  assignee: AssignPlanPick | null;
  ranking: AssignPlanRanking[];
}

export interface AssignPlanResult {
  list: { id: string; name: string; boardId: string; workspaceId: string };
  algorithmVersion: string;
  planVersion: string;
  generatedAt: string;
  weights: AssignWeights & { custom: boolean };
  groupOnTimeRate: number | null;
  people: AssignPlanPerson[];
  /** Tong so the chua co nguoi nhan trong danh sach (co the nhieu hon so dong: xem `truncated`). */
  totalUnassigned: number;
  /** Chi chia mot so the gap nhat moi lan; phan con lai de lan sau. */
  truncated: boolean;
  rows: AssignPlanRow[];
}

// ---------- Ho so tu khai cua CHINH nguoi dung (ASSIGN_MODULE.md §17.2, §17.9) ----------

export interface DeclaredWorkItem {
  id: string;
  title: string;
  description: string | null;
}

export interface DeclaredCvInfo {
  fileName: string;
  size: number;
  uploadedAt: string;
}

export interface DeclaredProfile {
  /** Tat = bo cham coi nhu nguoi nay khong khai. */
  useForAssign: boolean;
  /** Cho phep chu / quan tri bang (khong gian) chung TAI TEP CV. Mac dinh TAT - nguoi khac khong tai duoc neu chua bat. */
  cvShared: boolean;
  skillsText: string;
  workItems: DeclaredWorkItem[];
  cv: DeclaredCvInfo | null;
  /** Chu trich tu CV (nguoi dung da sua) - chi chinh chu CV nhan duoc. */
  cvText: string | null;
}

export interface DeclaredProfileInput {
  useForAssign: boolean;
  /** Bo qua = giu gia tri hien tai tren may chu. */
  cvShared?: boolean;
  skillsText: string;
  /** Muc moi khong co `id` (may chu cap). */
  workItems: { id?: string; title: string; description?: string | null }[];
  cvText: string | null;
}

export interface DeclaredCvUploadResult {
  cv: DeclaredCvInfo;
  /** Chu trich duoc - hien cho nguoi dung SUA roi luu lai. */
  text: string;
  truncated: boolean;
  profile: DeclaredProfile;
}
