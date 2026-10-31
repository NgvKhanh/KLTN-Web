import type { CardStatus } from './card';

// Hop dong API /api/chat (CHATBOT_MODULE.md §12). Doc la chinh; "hanh dong" (Phase 1) chi la 7 thao tac an toan tren MOT bang,
// qua xem truoc + nut Ap dung hoac tu chay khi cau lenh ro rang (CHATBOT_V2_ACTIONS_PLAN.md).

export type ChatScope =
  | { kind: 'MY' }
  | { kind: 'WORKSPACE'; workspaceId: string }
  | { kind: 'BOARD'; boardId: string };

export type ChatIntent =
  | 'MY_TASKS'
  | 'MY_PRIORITIES'
  | 'MEMBER_TASKS'
  | 'TEAM_SUMMARY'
  | 'TEAM_WORKLOAD'
  // Danh muc truy van (§18): bang, khong gian, thanh vien, dem the
  | 'MY_BOARDS'
  | 'MY_WORKSPACES'
  | 'MEMBER_LIST'
  | 'CARD_COUNTS'
  | 'UNSUPPORTED'
  | 'NONE';
export type ChatPeriod = 'TODAY' | 'TOMORROW' | 'THIS_WEEK' | 'NEXT_WEEK' | 'LAST_WEEK' | 'NEXT_7_DAYS';
export type ChatFocus = 'OPEN' | 'OVERDUE' | 'DONE' | 'BLOCKED';
export type ChatParser = 'RULE' | 'LLM' | 'HYBRID';
export type ChatSlot = 'period' | 'focus' | 'member';
export type PriorityReason = 'OVERDUE' | 'DUE_TODAY' | 'DUE_SOON' | 'LATER';

export interface ChatStatus {
  llmAvailable: boolean;
  engine?: 'legacy' | 'v2';
  /** Lenh GHI chay duoc: server bat CHAT_ACTIONS va co AI. Khong co truong = may chu cu, coi nhu chi doc. */
  actions?: boolean;
}

// ===================== Hanh dong (Phase 1: mot thao tac, Phase 2: nhieu thao tac trong mot bang) =====================
// Khoi xem truoc / ket qua do SERVER dung tu ke hoach da phan giai (ten lay tu CSDL), khong phai chu AI viet.

export type ChatPlanStatus = 'NEEDS_CHOICE' | 'PROPOSED' | 'EXECUTING' | 'EXECUTED' | 'FAILED' | 'STALE' | 'CANCELLED' | 'EXPIRED';
export type ChatPlanRisk = 'LOW' | 'MEDIUM' | 'HIGH';
export interface ChatPlanReason {
  code: 'AUTO_DISABLED' | 'DELEGATED_TO_DATA' | 'NOT_GROUNDED' | 'FUZZY_DATE' | 'QUESTION_FORM' | 'MULTI_OP' | 'NEW_STRUCTURE' | 'BOARD_PATCH' | 'AI_CHOSEN_TARGET' | 'STANDING_RULE' | 'TEXT_CONTENT' | 'ARCHIVE' | 'DELETE' | 'BULK' | 'ADMIN' | 'FILE';
  /** Cau giai thich vi sao lenh nay chua tu chay (hien nguyen van cho nguoi dung). */
  text: string;
}
/** Phase 6: nguoi nhan do HE THONG goi y phan cong chon (khong phai ten nguoi dung nêu). Khong co bang chung / ho so / CV. */
export interface ChatAssignChoice {
  source: 'BEST' | 'PLAN';
  rank: number;
  /** Diem tuong doi trong nhom ung vien cua the nay (0-100); null = khong co du lieu. */
  score: number | null;
  confidenceLevel: 'THIN' | 'FAIR' | 'GOOD';
  flags: string[];
  alternatives: { name: string; rank: number; score: number | null }[];
}
/** Phase 7: luat tu dong hoa - dieu kien, cac viec se lam va ghi chu "chay bang quyen cua ban" (server dung san). */
export interface ChatRuleView {
  when: string;
  then: string[];
  note: string;
}
export interface ChatPlanItem {
  index: number;
  choice?: ChatAssignChoice;
  rule?: ChatRuleView;
  verb: string;
  text: string;
  detail?: string;
  cardId?: string;
  /** Thao tac xoa / khong khoi phuc duoc: to mau canh bao. */
  danger?: boolean;
}
/** Phase 3 (Board Patch): mot muc AI de xuat nhung KHONG dua vao ke hoach (da co / trung / khong hop le). */
export interface ChatPatchSkipped {
  kind: 'LIST' | 'CARD';
  title: string;
  reason: 'EXISTS' | 'SIMILAR' | 'DUPLICATE_IN_PATCH' | 'UNKNOWN_LIST';
  /** Ten muc co san ma muc nay trung, va ten cot chua no. */
  existing?: string;
  where?: string;
}
export interface ChatPatchView {
  newLists: number;
  newCards: number;
  skipped: ChatPatchSkipped[];
  /** So cot / the CO SAN cua bang - khong bi dung toi. */
  untouched: { lists: number; cards: number };
  context: { cardsShown: number; cardsTotal: number; truncated: boolean };
}
/** Tep da tai len kho tam cua tro ly, cho gan vao the (nut kep giay o khung chat). */
export interface ChatStagedFile {
  id: string;
  name: string;
  size: number;
}
export interface ChatActionPlan {
  planId: string;
  /** Dau van tay cua ban xem truoc: gui lai khi bam Ap dung. */
  checksum: string;
  status: ChatPlanStatus;
  risk: ChatPlanRisk;
  requiresConfirmation: boolean;
  /** Nut "Ap dung" con dung duoc (cho xac nhan va chua het han). */
  canConfirm: boolean;
  reasons: ChatPlanReason[];
  expiresAt: string;
  boardId: string;
  boardName: string;
  items: ChatPlanItem[];
  /** So thao tac cua ke hoach (may chu cu khong gui: coi nhu bang so dong). */
  opCount?: number;
  warnings: string[];
  /** Co khi la ke hoach mo rong bang do AI de xuat (Board Patch). */
  patch?: ChatPatchView;
}
export type ChatResultStatus = 'EXECUTED' | 'FAILED' | 'STALE' | 'CANCELLED' | 'EXPIRED';
export interface ChatActionResult {
  planId: string;
  status: ChatResultStatus;
  /** Da tu chay vi lenh ro rang va du an toan (khong qua nut Ap dung). */
  autoExecuted: boolean;
  /** Ap dung lan hai tro di: ket qua luu tu lan dau. */
  alreadyApplied?: boolean;
  summary: string;
  boardId: string;
  cardId?: string;
  error?: { code: string; text: string };
  warnings: string[];
  /** Ke hoach nhieu thao tac: so thao tac va mot cau cho moi thao tac (da lam / da co san). */
  opCount?: number;
  details?: string[];
  cardIds?: string[];
}
export type ChatActionView = { kind: 'PLAN'; plan: ChatActionPlan } | { kind: 'RESULT'; result: ChatActionResult };

export interface ChatConversationSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  /** Trang ma cau hoi cuoi cung duoc gui tu. May chu cu khong tra thi khong co. */
  scope?: ChatScope;
}
export interface ChatConversationList {
  conversations: ChatConversationSummary[];
  page: number;
  hasMore: boolean;
}
export interface ChatConversationHistory {
  conversation: { id: string; title: string; updatedAt: string };
  turns: { id: number; question: string; reply: ChatReply | null; error: string | null; createdAt: string }[];
  hasMore: boolean;
  before: number | null;
}

export interface ChatCard {
  id: string;
  title: string;
  boardId: string;
  boardName: string;
  listName: string;
  status: CardStatus;
  dueDate: string | null;
  completedAt: string | null;
  overdue: boolean;
  checklistDone: number;
  checklistTotal: number;
  assignees: string[];
  /** Chi co o cau hoi "nen lam gi truoc". */
  reason?: PriorityReason;
}

export interface ChatFact {
  key: string;
  label: string;
  value: number;
}

export interface ChatSection {
  key: 'BLOCKED' | 'DONE' | 'OVERDUE';
  label: string;
  total: number;
  cards: ChatCard[];
}

export interface ChatWorkloadRow {
  userId: string;
  name: string;
  open: number;
  overdue: number;
  /** Chi truong nhom thay; null = chua khai (mac dinh). */
  capacity?: number | null;
  pausedUntil?: string | null;
}

export interface ChatClarifyOption {
  id: string;
  label: string;
  /** USER: chon nguoi; WORKSPACE: chon khong gian; TARGET: chon bang / khong gian khi trung ten (§18). */
  kind: 'USER' | 'WORKSPACE' | 'TARGET';
}

/** Bang ket qua chung cua cau tra loi danh muc (§18.5). Dong co `boardId` la lien ket mo bang. */
export interface ChatTableRow {
  cells: (string | number)[];
  boardId?: string;
}
export interface ChatTable {
  columns: string[];
  rows: ChatTableRow[];
  /** Tong so dong that (co the lon hon so dong hien khi bi cat). */
  total: number;
}

export interface ChatAnswer {
  blocks?: ChatV2Block[];
  /** Ban xem truoc hoac ket qua cua MOT thao tac (khong nam trong blocks). */
  action?: ChatActionView;
  kind: 'ANSWER' | 'CLARIFY' | 'UNSUPPORTED';
  text: string;
  scopeLabel: string;
  generatedAt: string;
  facts: ChatFact[];
  cards: ChatCard[];
  total: number;
  page: number;
  pageSize: number;
  sections: ChatSection[];
  rows?: ChatWorkloadRow[];
  /** Chi cau tra loi danh muc (§18). */
  table?: ChatTable;
  ignoredSlots: ChatSlot[];
  notes: string[];
  clarify?: { question: string; options: ChatClarifyOption[] };
  suggestions: string[];
  comment?: { text: string; source: 'AI' };
  /** Buoc C: doan tra loi tu do cua AI, DA qua bo kiem so / ten voi du lieu tra cuu; luon di kem cac khoi du lieu do server dung. */
  aiAnswer?: { text: string; source: 'AI' };
}

export interface ChatUnderstood {
  summary?: string;
  intent: ChatIntent;
  period: ChatPeriod | null;
  focus: ChatFocus | null;
  memberName: string | null;
  /** Cau danh muc: ten bang / khong gian DA nhan dien (khong phai chuoi go). */
  targetName?: string | null;
  columnName?: string | null;
  parser: ChatParser;
}

export interface ChatReply {
  version?: 'v2';
  mode?: 'AI' | 'BASIC';
  conversationId: string;
  conversationReset?: true;
  understood: ChatUnderstood;
  answer: ChatAnswer;
}

export interface ChatV2Task {
  id: string; title: string; status: CardStatus; isDone: boolean;
  boardId: string; boardName: string; columnId: string; columnName: string;
  dueDate: string | null; completedAt: string | null; createdAt: string; overdue: boolean;
  assignees: { id: string; name: string }[];
}
export interface ChatV2Event {
  id: string; boardId: string; cardId: string | null; cardTitle: string | null; redacted: boolean;
  type: string; createdAt: string; actor: { id: string; name: string } | null;
  data: Record<string, string | null>;
}
export interface ChatV2Source {
  id: string; generatedAt: string; scope: ChatScope; scopeLabel: string;
  appliedInput: Record<string, unknown>; ranges: { from: string; to: string }[];
}
/** Phase 4: thong ke mot cot (tong quan bang va danh muc cot). */
export interface ChatV2ListStat { id: string; name: string; status: CardStatus | null; totalCards: number; openCards: number; doneCards: number }
export interface ChatV2BoardOverview {
  board: { id: string; name: string };
  totalCards: number; openCards: number; doneCards: number;
  /** Phan tram nguyen; null khi bang chua co the nao. */
  donePercent: number | null;
  overdueCards: number; blockedCards: number; unassignedOpenCards: number;
  listCount: number; labelCount: number; memberCount: number; customFieldCount: number;
  lists: ChatV2ListStat[];
}
export interface ChatV2AssigneeSuggestion {
  card: { id: string; title: string; boardId: string; boardName: string; columnName: string };
  candidateCount: number;
  candidates: { rank: number; user: { id: string; name: string }; score: number | null; confidenceLevel: 'THIN' | 'FAIR' | 'GOOD'; flags: string[]; assigned: boolean; load: number; capacity: number }[];
}
export interface ChatV2CardDetails {
  id: string; title: string; status: CardStatus; isDone: boolean;
  boardId: string; boardName: string; columnId: string; columnName: string;
  startDate: string | null; dueDate: string | null; completedAt: string | null; createdAt: string; overdue: boolean;
  assignees: { id: string; name: string }[];
  labels: { id: string; name: string; color: string }[];
  checklist: { lists: number; done: number; total: number };
  fields: { id: string; name: string; type: string; value: string }[];
  commentCount: number; attachmentCount: number;
  hasDescription: boolean; descriptionLength: number;
  /** Trich ngan cua mo ta de HIEN cho nguoi dung; noi dung do nguoi khac viet nen luon danh dau chua dang tin. */
  descriptionExcerpt: string | null;
}
/** Bước B: truy vấn tổng quát (công việc / bình luận / mục checklist / tệp). Ô văn bản là nội dung do NGƯỜI KHÁC viết: luôn hiện như chữ thuần. */
export type ChatV2DataEntity = 'CARD' | 'COMMENT' | 'CHECKLIST_ITEM' | 'ATTACHMENT';
export interface ChatV2DataColumn { key: string; label: string; type: 'text' | 'number' | 'date' | 'bool' | 'status' }
export interface ChatV2DataRow { id: string; cardId: string | null; boardId: string | null; cells: Record<string, string | number | boolean | null> }
export interface ChatV2DataGroup { id: string | null; label: string; count: number }
export interface ChatV2QueryData {
  entity: ChatV2DataEntity; mode: 'ROWS' | 'GROUPS';
  total: number; page: number; pageSize: number; hasMore: boolean;
  /** Số bản ghi khớp điều kiện (mode GROUPS: `total` là số nhóm). */
  matched: number;
  columns: ChatV2DataColumn[]; rows: ChatV2DataRow[]; groups: ChatV2DataGroup[];
  groupBy: string | null; groupLabel: string | null; bucket: 'DAY' | 'WEEK' | 'MONTH' | null;
  highestCount: number; topGroups: number;
}
interface V2Page { total: number; page: number; pageSize: number; hasMore: boolean }
interface BlockBase { id: string; title: string; status: 'OK'; source: ChatV2Source; pagination: { page: number; hasMore: boolean } }
export type ChatV2Block = (BlockBase & (
  | { tool: 'query_tasks'; data: V2Page & { cards: ChatV2Task[] } }
  | { tool: 'aggregate_tasks'; data: V2Page & { /** Phase 4: chi co khi bo loc tinh ca viec da xong; may chu cu khong gui. */ doneCards?: number | null; donePercent?: number | null; totalCards: number; groupBy: 'ASSIGNEE' | 'BOARD' | 'COLUMN' | 'STATUS' | 'DATE'; highestCount: number; leaderIds: string[]; rows: { id: string; label: string; count: number }[]; outsideAssignments: number; deletedAccountAssignments: number; unassignedCards: number; assignmentCounting: string } }
  | { tool: 'query_activities'; data: V2Page & { mode: 'EVENTS' | 'CHANGED_CARDS'; eventCount: number; changedCardCount: number; events: ChatV2Event[]; cards: { id: string; title: string | null; eventCount: number; lastChangedAt: string; events: ChatV2Event[]; eventsTruncated: boolean }[]; coverage: string } }
  | { tool: 'query_catalog'; data: V2Page & (
    | { kind: 'BOARDS'; rows: { id: string; name: string; workspaceId: string; workspaceName: string; myRole: string | null }[] }
    | { kind: 'WORKSPACES'; rows: { id: string; name: string; myRole: string | null; boards: number; members: number }[] }
    | { kind: 'MEMBERS'; rows: { id: string; name: string; role: string | null }[] }
    | { kind: 'LISTS'; rows: ChatV2ListStat[] }
    | { kind: 'LABELS'; rows: { id: string; name: string; color: string; cards: number }[] }
    | { kind: 'CUSTOM_FIELDS'; rows: { id: string; name: string; type: 'TEXT' | 'NUMBER' | 'DATE' | 'CHECKBOX' | 'DROPDOWN'; options: { id: string; value: string }[] }[] }
  ) }
  | { tool: 'get_board_overview'; data: ChatV2BoardOverview }
  | { tool: 'suggest_assignee'; data: ChatV2AssigneeSuggestion }
  | { tool: 'get_card_details'; data: ChatV2CardDetails }
  | { tool: 'query_data'; data: ChatV2QueryData }
)) | { id: string; title: string; status: 'ERROR'; error: string };
