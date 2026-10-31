import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { cancelChatAction, confirmChatAction, fetchChatStatus, fetchChatConversations, fetchChatConversation, fetchMoreAnswer, sendChatChoice, sendChatMessage } from '../lib/api/chat';
import { appendCards, chatErrorText, SUPERSEDED_TEXT } from '../lib/chatText';
import { assistantScopeFor, guardScope } from '../lib/chatScope';
import type { ChatActionView, ChatCard, ChatClarifyOption, ChatConversationHistory, ChatConversationSummary, ChatReply, ChatScope, ChatStagedFile, ChatStatus } from '../types/chat';
import { mergeV2Block } from '../lib/chatV2';

// Hoi thoai cua tro ly (CHATBOT_MODULE.md §13). Provider dat o ProtectedRoute (TREN cac layout) de
// hoi thoai KHONG mat khi bam lien ket the chuyen tu trang chu (MainLayout) sang trang bang
// (BoardViewLayout) - Header bi dung lai khi doi layout nen state khong the nam trong Header.
// Chua mo panel lan nao thi khong goi API nao.

export interface AssistantTurn {
  id: number;
  /** Cau nguoi dung go, hoac "Chọn: …" khi tra loi cau hoi lai. */
  question: string;
  /** Ten cac tep dinh kem vao cau nay (chi de hien; server luu theo id). */
  files?: string[];
  status: 'loading' | 'done' | 'error';
  reply: ChatReply | null;
  /** Danh sach chinh da tai (gop qua cac lan "Xem thêm"). */
  cards: ChatCard[];
  page: number;
  error: string | null;
  loadingMore: boolean;
  moreError: string | null;
  loadingBlockId?: string;
  /** Dang gui Ap dung / Huy cua khoi xem truoc trong luot nay. */
  actionBusy: boolean;
  actionError: string | null;
}

interface AssistantValue {
  open: boolean;
  turns: AssistantTurn[];
  busy: boolean;
  /** Pham vi theo trang dang mo: trang bang -> BOARD (khoa cung trong bang), con lai -> MY. */
  scope: ChatScope;
  /** null = chua biet (chua tai hoac tai loi). */
  status: ChatStatus | null;
  notice: string | null;
  conversations: ChatConversationSummary[];
  activeConversationId: string | null;
  historyLoading: boolean;
  historyError: string | null;
  historyHasMore: boolean;
  olderHasMore: boolean;
  refreshHistory: (more?: boolean) => Promise<void>;
  selectConversation: (id: string) => Promise<boolean>;
  loadOlder: () => Promise<void>;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  ask: (text: string, files?: ChatStagedFile[]) => Promise<void>;
  choose: (option: ChatClarifyOption) => Promise<void>;
  loadMore: (turn: AssistantTurn, blockId?: string) => Promise<void>;
  /** Nut "Ap dung" / "Huy" cua khoi xem truoc (khong goi AI). */
  confirmAction: (turn: AssistantTurn) => Promise<void>;
  cancelAction: (turn: AssistantTurn) => Promise<void>;
  newConversation: () => void;
}

const AssistantContext = createContext<AssistantValue | undefined>(undefined);
// Pham vi theo TRANG (assistantScopeFor): trang bang -> BOARD (doc va ghi chi trong bang do); trang khac -> MY (moi bang duoc
// phep; ten bang nhac trong cau do backend phan giai). Backend kiem lai moi lan, day chi la tran giao dien dang o.

function newTurn(id: number, question: string, files?: string[]): AssistantTurn {
  return { id, question, ...(files !== undefined && files.length > 0 ? { files } : {}), status: 'loading', reply: null, cards: [], page: 1, error: null, loadingMore: false, moreError: null, actionBusy: false, actionError: null };
}
const planIdOf = (a: ChatActionView): string => (a.kind === 'PLAN' ? a.plan.planId : a.result.planId);
/** Lenh moi (hoac go "huy") lam cac ban xem truoc cu het tac dung: cap nhat the cu cho khop voi server. */
function settleOlderPlans(turns: AssistantTurn[], currentId: number, action: ChatActionView): AssistantTurn[] {
  return turns.map((t) => {
    const old = t.reply?.answer.action;
    if (t.id === currentId || !t.reply || old?.kind !== 'PLAN' || old.plan.status !== 'PROPOSED') return t;
    const next: ChatActionView = planIdOf(action) === old.plan.planId
      ? action
      : { kind: 'RESULT', result: { planId: old.plan.planId, status: 'CANCELLED', autoExecuted: false, summary: SUPERSEDED_TEXT, boardId: old.plan.boardId, error: { code: 'SUPERSEDED', text: SUPERSEDED_TEXT }, warnings: [] } };
    return { ...t, reply: { ...t.reply, answer: { ...t.reply.answer, action: next } } };
  });
}
/**
 * Hoi thoai da luu co thuoc trang dang mo khong: trang bang -> dung bang do; trang khac (trang chu, khong gian...) -> hoi thoai
 * bat dau ngoai bang. May chu cu khong tra `scope` thi coi nhu khop (hanh vi cu).
 */
export function savedConversationFits(saved: ChatScope | undefined, here: ChatScope): boolean {
  if (!saved) return true;
  if (here.kind === 'BOARD') return saved.kind === 'BOARD' && saved.boardId === here.boardId;
  return saved.kind !== 'BOARD';
}
const sameScopeNow = (a: ChatScope, b: ChatScope): boolean => JSON.stringify(a) === JSON.stringify(b);
function restoredTurns(history: ChatConversationHistory): AssistantTurn[] {
  return history.turns.map((t) => ({ ...newTurn(t.id, t.question), status: t.error ? 'error' : 'done',
    reply: t.reply, cards: t.reply?.answer.cards ?? [], page: t.reply?.answer.page ?? 1, error: t.error,
  }));
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const scope = useMemo(() => assistantScopeFor(pathname), [pathname]);
  const scopeRef = useRef<ChatScope>(scope);
  useEffect(() => { scopeRef.current = scope; }, [scope]);
  const lastScope = useRef<ChatScope>(scope);
  // Moi lan bo hoi thoai (hoi thoai moi / roi bang) tang len 1: ket qua cua yeu cau gui TRUOC do khong duoc nhap vao hoi thoai moi.
  const epoch = useRef(0);
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ChatConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [olderHasMore, setOlderHasMore] = useState(false);
  const historyPage = useRef(1);
  const historyRequested = useRef(false);
  const olderBefore = useRef<number | null>(null);
  const conversationId = useRef<string | null>(null);
  const nextId = useRef(1);
  const statusRequested = useRef(false);
  const statusPromise = useRef<Promise<ChatStatus> | null>(null);
  const engine = useRef<'legacy' | 'v2'>('v2');

  const busy = historyLoading || turns.some((t) => t.status === 'loading' || t.loadingMore || t.actionBusy);

  const applyHistory = useCallback((history: ChatConversationHistory) => {
    conversationId.current = history.conversation.id;
    setActiveConversationId(history.conversation.id);
    setTurns(restoredTurns(history));
    nextId.current = Math.max(1, ...history.turns.map((t) => t.id + 1));
    olderBefore.current = history.before;
    setOlderHasMore(history.hasMore);
    setNotice('Đã mở hội thoại đã lưu. Các câu trả lời bên dưới phản ánh dữ liệu tại thời điểm hỏi.');
  }, []);

  const refreshList = useCallback(async (more = false) => {
    const result = await fetchChatConversations(more ? historyPage.current + 1 : 1);
    historyPage.current = result.page;
    setConversations((prev) => more ? [...prev.filter((p) => !result.conversations.some((n) => n.id === p.id)), ...result.conversations] : result.conversations);
    setHistoryHasMore(result.hasMore);
    return result;
  }, []);
  const refreshHistory = useCallback(async (more = false) => {
    setHistoryLoading(true); setHistoryError(null);
    try { await refreshList(more); }
    catch { setHistoryError('Không thể tải lịch sử trò chuyện. Hãy thử lại.'); }
    finally { setHistoryLoading(false); }
  }, [refreshList]);
  const selectConversation = useCallback(async (id: string) => {
    if (busy) return false;
    const startEpoch = epoch.current;
    setHistoryLoading(true); setHistoryError(null);
    try {
      const history = await fetchChatConversation(id);
      if (epoch.current !== startEpoch) return false; // vua roi bang trong luc tai
      applyHistory(history);
      return true;
    }
    catch { setHistoryError('Không thể mở hội thoại này. Hãy thử lại.'); return false; }
    finally { setHistoryLoading(false); }
  }, [busy, applyHistory]);
  const loadOlder = useCallback(async () => {
    const cid = conversationId.current;
    if (busy || !cid || !olderHasMore || !olderBefore.current) return;
    const startEpoch = epoch.current;
    setHistoryLoading(true); setHistoryError(null);
    try {
      const history = await fetchChatConversation(cid, olderBefore.current);
      if (epoch.current !== startEpoch) return;
      setTurns((prev) => [...restoredTurns(history), ...prev]);
      olderBefore.current = history.before; setOlderHasMore(history.hasMore);
    } catch { setHistoryError('Không thể tải tin nhắn trước. Hãy thử lại.'); }
    finally { setHistoryLoading(false); }
  }, [busy, olderHasMore]);

  const patch = useCallback((id: number, change: (t: AssistantTurn) => Partial<AssistantTurn>) => {
    setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, ...change(t) } : t)));
  }, []);

  const finish = useCallback(
    (id: number, reply: ChatReply) => {
      conversationId.current = reply.conversationId;
      setActiveConversationId(reply.conversationId);
      patch(id, () => ({ status: 'done', reply, cards: reply.answer.cards, page: reply.answer.page }));
      const action = reply.answer.action;
      if (action) setTurns((ts) => settleOlderPlans(ts, id, action));
      if (engine.current === 'v2') void refreshList().catch(() => setHistoryError('Không thể cập nhật danh sách lịch sử. Hãy thử lại.'));
    },
    [patch, refreshList]
  );

  const openPanel = useCallback(() => {
    setOpen(true);
    if (!statusRequested.current) {
      statusRequested.current = true;
      statusPromise.current = fetchChatStatus();
      statusPromise.current
        .then((next) => { engine.current = next.engine ?? 'v2'; setStatus(next); })
        .catch(() => {
          statusRequested.current = false; // lan mo sau thu lai
        });
    }
    if (!historyRequested.current) {
      historyRequested.current = true;
      const startEpoch = epoch.current;
      setHistoryLoading(true); setHistoryError(null);
      void (async () => {
        try {
          try { const next = await statusPromise.current; engine.current = next?.engine ?? 'v2'; } catch { /* Try v2 history directly. */ }
          if (engine.current === 'legacy') return;
          const result = await refreshList();
          // Chi khoi phuc hoi thoai gan nhat CUA CHINH trang dang mo (vao bang B khong duoc hien hoi thoai cua bang A);
          // khong co thi de trong, lich su van o danh sach "Lich su tro chuyen".
          const here = scopeRef.current;
          const match = result.conversations.find((c) => savedConversationFits(c.scope, here));
          if (match) {
            const history = await fetchChatConversation(match.id);
            if (epoch.current === startEpoch && sameScopeNow(scopeRef.current, here)) applyHistory(history); // roi bang giua chung thi khong dung lai hoi thoai cu
          }
        } catch { setHistoryError('Không thể tải lịch sử trò chuyện. Hãy thử lại.'); historyRequested.current = false; }
        finally { setHistoryLoading(false); }
      })();
    }
  }, [applyHistory, refreshList]);

  const closePanel = useCallback(() => setOpen(false), []);
  const togglePanel = useCallback(() => (open ? closePanel() : openPanel()), [open, closePanel, openPanel]);

  const ask = useCallback(
    async (text: string, files: ChatStagedFile[] = []) => {
      const message = text.trim();
      if (message === '' || busy) return;
      setNotice(null);
      const id = nextId.current++;
      const startEpoch = epoch.current;
      setTurns((ts) => [...ts, newTurn(id, message, files.map((f) => f.name))]);
      try {
        if (statusPromise.current) {
          try { const next = await statusPromise.current; engine.current = next.engine ?? 'v2'; }
          catch { /* Keep the selected engine; a failed discovery must not silently downgrade. */ }
        }
        // Roi bang truoc khi gui: cau nay thuoc bang cu, khong duoc gui sang pham vi cua trang moi.
        if (epoch.current !== startEpoch) return;
        const body = { message, scope: scopeRef.current, conversationId: conversationId.current ?? undefined, ...(files.length > 0 ? { uploadIds: files.map((f) => f.id) } : {}) };
        const reply = engine.current === 'v2' ? await sendChatMessage(body, 'v2') : await sendChatMessage(body);
        if (epoch.current !== startEpoch) return; // da roi bang: tra loi nam trong lich su, khong nhap vao hoi thoai moi
        if (reply.conversationReset) {
          setNotice('Hội thoại trước đã hết hạn nên trợ lý bắt đầu hội thoại mới: câu này không nối tiếp câu trước.');
        }
        finish(id, reply);
      } catch (err) {
        if (epoch.current !== startEpoch) return;
        patch(id, () => ({ status: 'error', error: chatErrorText(err, 'MESSAGE').text }));
        if (engine.current === 'v2') void refreshList().catch(() => setHistoryError('Không thể cập nhật danh sách lịch sử. Hãy thử lại.'));
      }
    },
    [busy, finish, patch, refreshList]
  );

  const choose = useCallback(
    async (option: ChatClarifyOption) => {
      const cid = conversationId.current;
      if (!cid || busy) return;
      const id = nextId.current++;
      const startEpoch = epoch.current;
      setTurns((ts) => [...ts, newTurn(id, `Chọn: ${option.label}`)]);
      try {
        const guard = guardScope(scopeRef.current);
        const reply = engine.current === 'v2' ? await (guard ? sendChatChoice(cid, option, 'v2', guard) : sendChatChoice(cid, option, 'v2')) : await sendChatChoice(cid, option);
        if (epoch.current !== startEpoch) return;
        finish(id, reply);
      } catch (err) {
        if (epoch.current !== startEpoch) return;
        const e = chatErrorText(err, 'CHOICE');
        if (e.conversationGone) conversationId.current = null;
        patch(id, () => ({ status: 'error', error: e.text }));
      }
    },
    [busy, finish, patch]
  );

  const loadMore = useCallback(
    async (turn: AssistantTurn, blockId?: string) => {
      const cid = conversationId.current;
      if (!cid || busy || !turn.reply) return;
      const block = turn.reply.answer.blocks?.find((b) => b.id === blockId);
      if (blockId && (!block || block.status !== 'OK' || !block.pagination.hasMore)) return;
      const startEpoch = epoch.current;
      patch(turn.id, () => ({ loadingMore: true, loadingBlockId: blockId, moreError: null }));
      try {
        const page = block?.status === 'OK' ? block.pagination.page + 1 : turn.page + 1;
        const guard = guardScope(scopeRef.current);
        const next = engine.current === 'v2' ? await (guard ? fetchMoreAnswer(cid, page, blockId, 'v2', guard) : fetchMoreAnswer(cid, page, blockId, 'v2')) : await fetchMoreAnswer(cid, page);
        if (epoch.current !== startEpoch) return;
        if (blockId && next.answer.blocks) {
          const incoming = next.answer.blocks.find((b) => b.id === blockId);
          if (!incoming) throw new Error('Missing answer block');
          patch(turn.id, (t) => ({ loadingMore: false, loadingBlockId: undefined,
            reply: { ...t.reply!, answer: { ...t.reply!.answer, blocks: t.reply!.answer.blocks?.map((b) => b.id === blockId ? mergeV2Block(b, incoming) : b) } },
          }));
          return;
        }
        patch(turn.id, (t) => {
          const prev = t.reply!;
          const answer = { ...prev.answer, total: next.answer.total, generatedAt: next.answer.generatedAt };
          return {
            loadingMore: false,
            page: next.answer.page,
            cards: appendCards(t.cards, next.answer.cards),
            reply: { ...prev, answer },
            // Du lieu doi giua hai trang (nguoi da roi nhom, the bi xoa...) -> noi ro ly do server dua ra
            moreError: next.answer.total === 0 ? next.answer.text : null,
          };
        });
      } catch (err) {
        if (epoch.current !== startEpoch) return;
        const e = chatErrorText(err, 'MORE');
        if (e.conversationGone) conversationId.current = null;
        patch(turn.id, () => ({ loadingMore: false, loadingBlockId: undefined, moreError: e.text }));
      }
    },
    [busy, patch]
  );

  // "Ap dung" / "Huy" cua ban xem truoc: thay chinh the xem truoc bang ket qua server tra ve (khong them luot moi).
  const settleAction = useCallback((turnId: number, next: ChatActionView | undefined) => {
    patch(turnId, (t) => ({ actionBusy: false, actionError: null, ...(next && t.reply ? { reply: { ...t.reply, answer: { ...t.reply.answer, action: next } } } : {}) }));
  }, [patch]);
  const confirmAction = useCallback(
    async (turn: AssistantTurn) => {
      const cid = conversationId.current;
      const action = turn.reply?.answer.action;
      if (!cid || busy || action?.kind !== 'PLAN') return;
      patch(turn.id, () => ({ actionBusy: true, actionError: null }));
      try {
        const reply = await confirmChatAction({ planId: action.plan.planId, checksum: action.plan.checksum }, cid, scopeRef.current);
        settleAction(turn.id, reply.answer.action);
        if (engine.current === 'v2') void refreshList().catch(() => setHistoryError('Không thể cập nhật danh sách lịch sử. Hãy thử lại.'));
      } catch (err) {
        patch(turn.id, () => ({ actionBusy: false, actionError: chatErrorText(err, 'ACTION').text }));
      }
    },
    [busy, patch, refreshList, settleAction]
  );
  const cancelAction = useCallback(
    async (turn: AssistantTurn) => {
      const cid = conversationId.current;
      const action = turn.reply?.answer.action;
      if (!cid || busy || action?.kind !== 'PLAN') return;
      patch(turn.id, () => ({ actionBusy: true, actionError: null }));
      try {
        settleAction(turn.id, (await cancelChatAction(action.plan.planId, cid)).answer.action);
      } catch (err) {
        patch(turn.id, () => ({ actionBusy: false, actionError: chatErrorText(err, 'ACTION').text }));
      }
    },
    [busy, patch, settleAction]
  );

  const newConversation = useCallback(() => {
    epoch.current += 1;
    conversationId.current = null;
    setActiveConversationId(null);
    setTurns([]);
    setNotice(null);
    olderBefore.current = null; setOlderHasMore(false);
  }, []);

  // Hoi thoai lam trong MOT bang thi gan voi bang do: roi bang (sang bang khac, hoac ra trang khac) -> lan mo tro ly sau la
  // hoi thoai trang. Lich su van con trong danh sach "Lich su tro chuyen". Di tu trang chu SANG bang (bam lien ket the trong
  // cau tra loi) thi KHONG lam moi: hoi thoai do bat dau ngoai bang. Doi tham so (?card=) trong cung bang khong doi pathname.
  useEffect(() => {
    const prev = lastScope.current;
    lastScope.current = scope;
    if (prev.kind !== 'BOARD') return;
    if (scope.kind === 'BOARD' && scope.boardId === prev.boardId) return;
    newConversation();
  }, [scope, newConversation]);

  const value = useMemo<AssistantValue>(
    () => ({ open, turns, busy, scope, status, notice, conversations, activeConversationId, historyLoading, historyError, historyHasMore, olderHasMore,
      refreshHistory, selectConversation, loadOlder, openPanel, closePanel, togglePanel, ask, choose, loadMore, confirmAction, cancelAction, newConversation }),
    [open, turns, busy, scope, status, notice, conversations, activeConversationId, historyLoading, historyError, historyHasMore, olderHasMore,
      refreshHistory, selectConversation, loadOlder, openPanel, closePanel, togglePanel, ask, choose, loadMore, confirmAction, cancelAction, newConversation]
  );

  return <AssistantContext.Provider value={value}>{children}</AssistantContext.Provider>;
}

export function useAssistant(): AssistantValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) throw new Error('useAssistant phai nam trong <AssistantProvider>');
  return ctx;
}
