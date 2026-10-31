// Kieu du lieu cua module AI (khop voi backend/src/modules/ai/boardPlan.schema.ts va ai.document.ts).
// Backend la noi KIEM TRA THAT (Zod); giao dien chi phan anh hinh dang de sua ke hoach truoc khi tao bang.

export type PlanMode = 'STRUCTURED' | 'FREEFORM';

/** Nguon cua 1 ngay: EXPLICIT = ghi ro (trong van ban hoac nguoi dung dat), SCHEDULED = tu xep, NONE = khong co. */
export type DateOrigin = 'EXPLICIT' | 'SCHEDULED' | 'NONE';

export type AiInputKind = 'TEXT' | 'DOCX' | 'PDF';

export interface PlanCard {
  ref: string;
  title: string;
  description: string;
  /** Dong van ban sinh ra the nay; null = AI tu them (chi che do FREEFORM). */
  sourceLine: number | null;
  /** Chi the duoc tick moi duoc tao thanh the that. */
  selected: boolean;
  /** Ngay dang YYYY-MM-DD (khong gio) - dung thang gia tri cua <input type="date">. */
  startDate: string | null;
  startOrigin: DateOrigin;
  dueDate: string | null;
  dueOrigin: DateOrigin;
  labelKeys: string[];
  checklist: string[];
}

export interface PlanList {
  name: string;
  cards: PlanCard[];
}

export interface PlanLabel {
  key: string;
  name: string;
  color: string;
}

export interface PlanWarning {
  code: string;
  message: string;
  /** Ma the (ref) lien quan neu co. */
  ref?: string;
  line?: number;
}

export interface BoardPlan {
  mode: PlanMode;
  board: { name: string; color: string };
  labels: PlanLabel[];
  lists: PlanList[];
  warnings: PlanWarning[];
  assumptions: string[];
}

export interface PlanStats {
  totalCards: number;
  selectedCards: number;
  truncatedCards: number;
  explicitCards: number;
  scheduledCards: number;
  undatedCards: number;
}

export interface GeneratePlanInput {
  workspaceId: string;
  text: string;
  inputKind?: AiInputKind;
  /** Bo trong = de may tu chon (modeAuto). */
  mode?: PlanMode;
  projectStart?: string;
  projectEnd?: string;
  skipWeekend: boolean;
}

export interface GeneratePlanResult {
  runId: string;
  /** true = ke hoach dung ket qua cua LLM; false = chi dung bo luat. */
  llmUsed: boolean;
  /** Che do do MAY chon; plan.mode la che do thuc su dung. */
  modeAuto: PlanMode;
  plan: BoardPlan;
  stats: PlanStats;
}

export interface AiStatus {
  llmAvailable: boolean;
  provider: string;
  model: string;
}

export interface ExtractedDocument {
  inputKind: 'DOCX' | 'PDF';
  text: string;
  chars: number;
  /** true neu bi cat vi BAT KY ly do nao (so ky tu, so trang, tep qua dai). */
  truncated: boolean;
  /** Tong so trang cua PDF; null voi DOCX. */
  pages: number | null;
}
