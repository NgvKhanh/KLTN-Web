import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  Link,
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  defaultDropAnimationSideEffects,
  type DropAnimation,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import AddListForm from '../components/board/AddListForm';
import AutomationPanel from '../components/board/AutomationPanel';
import BoardActionsMenu from '../components/board/BoardActionsMenu';
import BoardActivityMenu from '../components/board/BoardActivityMenu';
import BoardArchiveMenu from '../components/board/BoardArchiveMenu';
import BoardBackgroundMenu from '../components/board/BoardBackgroundMenu';
import BoardStatsPanel from '../components/board/BoardStatsPanel';
import BoardTableView from '../components/board/BoardTableView';
import CustomFieldsPanel from '../components/board/CustomFieldsPanel';
import BoardFilterPanel from '../components/board/BoardFilterPanel';
import BoardMembers from '../components/board/BoardMembers';
import { CardModal } from '../components/board/lazy';
import { ModalLoading } from '../components/PageLoading';
import CardModalCrash from '../components/board/CardModalCrash';
import ErrorBoundary from '../components/ErrorBoundary';
import CardItem from '../components/board/CardItem';
import { CardHighlightContext } from '../components/board/CardHighlightContext';
import ListColumn from '../components/board/ListColumn';
import ListColumnOverlay from '../components/board/ListColumnOverlay';
import ShortcutsHelp from '../components/board/ShortcutsHelp';
import ConfirmDialog from '../components/ConfirmDialog';
import { LogoMark } from '../components/Logo';
import { useAuth } from '../context/AuthContext';
import { useBoards } from '../context/BoardsContext';
import { SkeletonColumns, SkeletonRegion } from '../components/Skeleton';
import StarButton from '../components/StarButton';
import type { BoardOutletContext } from '../layouts/BoardViewLayout';
import {
  addBoardMember,
  changeMemberRole,
  fetchBoard,
  fetchBoardMembers,
  removeBoardMember,
  setBoardWatch,
  transferOwnership,
  updateBoard,
} from '../lib/api/board';
import { archiveCard, createCard, updateCard } from '../lib/api/card';
import { applyCardTemplate } from '../lib/api/cardTemplate';
import {
  archiveList,
  copyList,
  createList,
  deleteAllCards,
  fetchBoardLists,
  moveAllCards,
  reorderList,
  sortListCards,
  updateList,
  type SortListBy,
} from '../lib/api/list';
import { assetUrl } from '../lib/assets';
import {
  STATUS_META,
  reopenStatus,
  targetListForStatus,
} from '../lib/cardStatus';
import { pushRecentBoard } from '../lib/recentBoards';
import { getErrorMessage } from '../lib/errorMessage';
import { logError } from '../lib/logError';
import {
  EMPTY_FILTER,
  cardMatchesFilter,
  filterActiveCount,
  isFilterActive,
  type BoardFilter,
} from '../lib/boardFilter';
import type { Board, BoardMember, BoardVisibility } from '../types/board';
import BoardVisibilityMenu from '../components/board/BoardVisibilityMenu';
import type { Card, CardStatus } from '../types/card';
import type { BoardList } from '../types/list';
import { useBoardRealtime } from './boardPage/useBoardRealtime';
import { useCardHighlights } from './boardPage/useCardHighlights';
import { useBoardShortcuts } from './boardPage/useBoardShortcuts';
import { useStableCallback } from '../lib/useStableCallback';
import { useBoardDnd } from './boardPage/useBoardDnd';

// Nut tren thanh cong cu cua bang: chi hien icon cho do chiem cho, chu nam o
// title/aria-label. Tach rieng phan hinh dang va phan mau nen - de chung mot
// chuoi thi bg-white cua trang thai "dang bat" se dung do voi bg-white/25.
const TOOLBAR_BTN_BASE =
  'grid h-8 w-8 shrink-0 place-items-center rounded transition-colors';
const TOOLBAR_BTN = `${TOOLBAR_BTN_BASE} bg-white/25 text-white hover:bg-white/40`;
const TOOLBAR_BTN_ON = `${TOOLBAR_BTN_BASE} bg-white text-primary-ink`;
// Nút nằm trong nhóm công cụ (nền chung của nhóm), không có nền riêng
const TOOLBAR_BTN_FLAT = `${TOOLBAR_BTN_BASE} text-white hover:bg-white/30`;

// Hieu ung khi tha: ban goc mo dan trong luc "ban noi" bay ve cho -> muot hon
const dropAnimation: DropAnimation = {
  duration: 200,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: '0.35' } },
  }),
};

type DeleteTarget =
  | { kind: 'list'; list: BoardList }
  | { kind: 'cards-in-list'; list: BoardList }
  | null;

export default function BoardPage() {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Mo thang panel "Chia se" tu link thong bao: /boards/:id?share=requests
  const shareParam = searchParams.get('share');
  const consumeShareParam = useCallback(() => {
    setSearchParams(
      (prev) => {
        prev.delete('share');
        return prev;
      },
      { replace: true }
    );
  }, [setSearchParams]);
  const { user } = useAuth();
  const { boards, isLoading, error, patchBoard } =
    useOutletContext<BoardOutletContext>();
  const { toggleStar, removeBoard } = useBoards();
  const memberBoard = boards.find((b) => b.id === boardId);

  // Bang cong khai ma minh chua phai thanh vien -> tai truc tiep theo id
  const [fetchedBoard, setFetchedBoard] = useState<Board | null>(null);
  const [fetchBoardError, setFetchBoardError] = useState<string | null>(null);
  // Bang DANG MO ngay luc nay. Cac thao tac bat dong bo khong nam trong effect (tai lai danh sach sau khi keo
  // tha, theo doi bang, chuyen chu bang) doi phan hoi xong moi ghi state: neu nguoi dung da sang bang khac
  // thi phan hoi cua bang cu khong duoc de len bang moi.
  const currentBoardIdRef = useRef(boardId);
  useEffect(() => {
    currentBoardIdRef.current = boardId;
  }, [boardId]);
  const hasMemberBoard = memberBoard !== undefined;
  // Luon tai chi tiet bang tu backend (ke ca khi minh la thanh vien) de lay
  // canEdit / canManage do backend tinh - frontend khong tu suy doan quyen nua.
  useEffect(() => {
    if (!boardId) return;
    let alive = true;
    setFetchedBoard(null);
    setFetchBoardError(null);
    fetchBoard(boardId)
      .then((b) => alive && setFetchedBoard(b))
      .catch((err) => {
        // Bang minh la thanh vien van hien duoc tu du lieu danh sach -> khong chan
        if (alive && !hasMemberBoard) {
          setFetchBoardError(
            getErrorMessage(err, 'Bạn không có quyền xem bảng này.')
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [boardId, hasMemberBoard]);

  const board = memberBoard ?? fetchedBoard ?? undefined;
  // Uu tien canEdit do BACKEND tinh (memberBoard tu danh sach bang KHONG co
  // vai tro, chi bao "co la thanh vien" - the VIEWER cung la thanh vien nhung
  // khong duoc sua). Trong luc fetchedBoard chua tai xong, chi tam coi la
  // sua duoc neu chac chan la chu bang (memberBoard.isOwner) - cac vai tro
  // khac phai doi ket qua tu backend, tranh loe UI sua roi lai an di.
  const canEdit =
    fetchedBoard?.canEdit ?? Boolean(memberBoard?.isOwner);

  // Ghi nho bang vua mo cho muc "Truy cap nhanh" o Trang chu
  useEffect(() => {
    if (board?.id) pushRecentBoard(board.id);
  }, [board?.id]);
  const readOnly = board != null && !canEdit;
  const isOwner = Boolean(board && user && board.ownerId === user.id);
  // Theo doi bang: chi co tu GET chi tiet bang (fetchedBoard), khong co trong
  // danh sach bang cache (memberBoard) -> luon doc tu fetchedBoard.
  const isWatchingBoard = Boolean(fetchedBoard?.isWatching);
  const [watchBusy, setWatchBusy] = useState(false);
  async function toggleBoardWatch() {
    if (!board || watchBusy) return;
    setWatchBusy(true);
    try {
      await setBoardWatch(board.id, !isWatchingBoard);
      const fresh = await fetchBoard(board.id);
      if (currentBoardIdRef.current === board.id) setFetchedBoard(fresh);
    } catch (err) {
      logError('BoardPage: theo doi bang')(err);
    } finally {
      setWatchBusy(false);
    }
  }

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  const [members, setMembers] = useState<BoardMember[]>([]);
  // userId cua nhung nguoi DANG mo bang nay (realtime presence)
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  // Uu tien quyen do backend tra ve (tinh ca OWNER/ADMIN cua khong gian).
  // Khi chua tai xong chi tiet bang thi tam suy doan tu vai tro thanh vien.
  const canManageBoard =
    fetchedBoard?.canManage ??
    (isOwner ||
      members.find((m) => m.userId === user?.id)?.role === 'ADMIN');

  const [lists, setLists] = useState<BoardList[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [listsError, setListsError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [deleting, setDeleting] = useState(false);
  // Doi trang thai cot dang cho xac nhan (vi se doi trang thai cac the ben trong)
  const [statusTarget, setStatusTarget] = useState<{
    list: BoardList;
    status: CardStatus;
    changing: number; // so the se doi trang thai
    reopening: number; // trong do: so the dang hoan thanh se bi mo lai
  } | null>(null);
  const [bgMenuOpen, setBgMenuOpen] = useState(false);
  const [visMenuOpen, setVisMenuOpen] = useState(false);
  const [publicLinkCopied, setPublicLinkCopied] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [fieldsMenuOpen, setFieldsMenuOpen] = useState(false);
  const [automationOpen, setAutomationOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [boardView, setBoardView] = useState<'board' | 'table'>('board');
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  // Mo the truc tiep tu link tim kiem: /boards/:id?card=<cardId>
  const cardParam = searchParams.get('card');
  useEffect(() => {
    if (!cardParam) return;
    setOpenCardId(cardParam);
    setSearchParams(
      (prev) => {
        prev.delete('card');
        return prev;
      },
      { replace: true }
    );
  }, [cardParam, setSearchParams]);
  const [filter, setFilter] = useState<BoardFilter>(EMPTY_FILTER);
  const [filterOpen, setFilterOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);

  // Cho realtime: dang keo-tha thi hoan refetch de khoi giat
  const draggingRef = useRef(false);
  const pendingReloadRef = useRef(false);

  function reloadLists() {
    if (!boardId) return;
    const requested = boardId;
    fetchBoardLists(requested)
      .then((data) => {
        if (currentBoardIdRef.current === requested) setLists(data);
      })
      .catch(logError('BoardPage: tai lai danh sach'));
  }

  const {
    sensors,
    collisionDetection,
    activeCard,
    activeList,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useBoardDnd({
    lists,
    setLists,
    reloadLists,
    setListsError,
    draggingRef,
    pendingReloadRef,
  });

  // Cung mot loi voi effect danh sach o duoi (CODE_REVIEW.md #6): tranh phan hoi
  // thanh vien CU cua bang truoc ghi de thanh vien bang dang xem.
  useEffect(() => {
    if (!boardId) return;
    let alive = true;
    setMembers([]);
    fetchBoardMembers(boardId)
      .then((data) => {
        if (alive) setMembers(data);
      })
      .catch(logError('BoardPage: tai thanh vien'));
    return () => {
      alive = false;
    };
  }, [boardId]);

  async function handleAddMember(
    email: string,
    role: 'ADMIN' | 'MEMBER' | 'VIEWER'
  ) {
    if (!boardId) throw new Error('Thiếu mã bảng');
    const result = await addBoardMember(boardId, email, role);
    if (result.kind === 'member') {
      const created = result.member;
      setMembers((cur) =>
        cur.some((m) => m.userId === created.userId)
          ? cur.map((m) => (m.userId === created.userId ? created : m))
          : [...cur, created]
      );
    }
    return result;
  }

  async function handleTransferOwnership(userId: string) {
    if (!boardId) return;
    await transferOwnership(boardId, userId);
    // Cap nhat ngay tai cho; realtime cung se lam moi cho nguoi khac
    const [nextMembers, nextBoard] = await Promise.all([
      fetchBoardMembers(boardId).catch(() => members),
      fetchBoard(boardId).catch(() => null),
    ]);
    if (currentBoardIdRef.current !== boardId) return; // da sang bang khac trong luc cho
    setMembers(nextMembers);
    if (nextBoard) {
      patchBoard(nextBoard);
      setFetchedBoard((prev) => (prev ? nextBoard : prev));
    }
  }

  async function handleChangeMemberRole(
    userId: string,
    role: 'ADMIN' | 'MEMBER' | 'VIEWER'
  ) {
    if (!boardId) return;
    const prev = members;
    setMembers((cur) =>
      cur.map((m) => (m.userId === userId ? { ...m, role } : m))
    );
    try {
      const updated = await changeMemberRole(boardId, userId, role);
      setMembers((cur) =>
        cur.map((m) => (m.userId === userId ? updated : m))
      );
    } catch (err) {
      setMembers(prev);
      setListsError(getErrorMessage(err, 'Không đổi được vai trò.'));
    }
  }

  async function handleSetVisibility(v: BoardVisibility) {
    if (!board) return;
    try {
      const updated = await updateBoard(board.id, { visibility: v });
      patchBoard(updated);
      if (fetchedBoard) setFetchedBoard({ ...fetchedBoard, visibility: v });
    } catch (err) {
      setListsError(getErrorMessage(err, 'Không đổi được khả năng hiển thị.'));
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!boardId) return;
    const prev = members;
    setMembers((cur) => cur.filter((m) => m.userId !== userId));
    try {
      await removeBoardMember(boardId, userId);
    } catch (err) {
      setMembers(prev);
      setListsError(getErrorMessage(err, 'Không xoá được thành viên.'));
    }
  }

  // CODE_REVIEW.md #6: cho "alive" nhu effect fetchBoard o tren - tranh phan hoi CU
  // (bang A, request con cho) ghi de len danh sach cua bang MOI (B) khi chuyen bang
  // nhanh va A tra ve SAU B.
  useEffect(() => {
    if (!boardId) return;
    let alive = true;
    setLists([]);
    setListsLoading(true);
    setListsError(null);
    fetchBoardLists(boardId)
      .then((data) => {
        if (alive) setLists(data);
      })
      .catch((err) => {
        if (alive) setListsError(getErrorMessage(err, 'Không tải được danh sách.'));
      })
      .finally(() => {
        if (alive) setListsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [boardId]);

  // ---------- Realtime: đồng bộ khi người khác thay đổi bảng ----------
  useBoardRealtime({
    boardId,
    patchBoard,
    setLists,
    setMembers,
    setFetchedBoard,
    setOnlineIds,
    draggingRef,
    pendingReloadRef,
  });

  // Thẻ vừa xuất hiện / vừa đổi bởi người khác -> hiệu ứng tạm thời trên thẻ
  const cardHighlights = useCardHighlights({ lists, listsLoading, draggingRef });

  // ---------- Phím tắt ----------
  useBoardShortcuts({
    cardOpen: openCardId !== null,
    shortcutsOpen,
    readOnly,
    setShortcutsOpen,
    setFilterOpen,
    setBgMenuOpen,
    setFilter,
  });

  const listDndIds = useMemo(() => lists.map((l) => `list-${l.id}`), [lists]);

  // Ap dung bo loc -> danh sach the hien thi (khong dong toi state that)
  const filterOn = isFilterActive(filter);
  const displayLists = useMemo(
    () =>
      filterOn
        ? lists.map((l) => ({
            ...l,
            cards: l.cards.filter((c) =>
              cardMatchesFilter(c, filter, user?.id)
            ),
          }))
        : lists,
    [filterOn, lists, filter, user?.id]
  );

  // ---------- Ten bang ----------
  async function saveName() {
    if (!board) return;
    const name = draft.trim();
    setEditing(false);
    if (!name || name === board.name) return;
    try {
      patchBoard(await updateBoard(board.id, { name }));
    } catch (err) {
      setSaveError(getErrorMessage(err, 'Không đổi được tên bảng.'));
    }
  }
  function onNameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') saveName();
    if (e.key === 'Escape') setEditing(false);
  }
  function onNameSubmit(e: FormEvent) {
    e.preventDefault();
    saveName();
  }

  // ---------- Them / doi ten danh sach & the ----------
  async function handleAddList(name: string) {
    if (!boardId) return;
    const created = await createList(boardId, name);
    setLists((cur) => [...cur, { ...created, cards: [] }]);
  }

  async function handleRenameList(listId: string, name: string) {
    setLists((cur) => cur.map((l) => (l.id === listId ? { ...l, name } : l)));
    try {
      await updateList(listId, { name });
    } catch (err) {
      setListsError(getErrorMessage(err, 'Không đổi được tên danh sách.'));
      reloadLists();
    }
  }

  async function handleAddCard(listId: string, title: string) {
    const created = await createCard(listId, title);
    setLists((cur) =>
      cur.map((l) =>
        l.id === listId ? { ...l, cards: [...l.cards, created] } : l
      )
    );
  }

  async function handleApplyCardTemplate(listId: string, templateId: string) {
    const created = await applyCardTemplate(listId, templateId);
    setLists((cur) =>
      cur.map((l) =>
        l.id === listId ? { ...l, cards: [...l.cards, created] } : l
      )
    );
  }

  // ---------- Menu "..." cua danh sach ----------
  async function handleCopyList(list: BoardList) {
    try {
      const created = await copyList(list.id);
      setLists((cur) => {
        const at = cur.findIndex((l) => l.id === list.id);
        const next = [...cur];
        next.splice(at + 1, 0, created);
        return next;
      });
    } catch (err) {
      setListsError(getErrorMessage(err, 'Không sao chép được danh sách.'));
    }
  }

  async function handleMoveList(list: BoardList, to: 'start' | 'end') {
    const position = to === 'start' ? 0 : lists.length - 1;
    const oldIndex = lists.findIndex((l) => l.id === list.id);
    if (oldIndex === -1 || oldIndex === position) return;
    setLists((cur) => arrayMove(cur, oldIndex, position));
    try {
      await reorderList(list.id, position);
    } catch (err) {
      setListsError(getErrorMessage(err, 'Không di chuyển được danh sách.'));
      reloadLists();
    }
  }

  async function handleMoveAllCards(list: BoardList, targetListId: string) {
    try {
      await moveAllCards(list.id, targetListId);
      reloadLists();
    } catch (err) {
      setListsError(getErrorMessage(err, 'Không di chuyển được thẻ.'));
    }
  }

  // ---------- Trang thai cot ----------
  // Gan trang thai khac null -> moi the trong cot doi theo (backend lam), nen hoi
  // xac nhan truoc neu co the se bi doi; bo trang thai (null) thi the giu nguyen.
  function handleSetListStatus(list: BoardList, status: CardStatus | null) {
    if (status === null) {
      if (list.status !== null) void applyListStatus(list.id, null);
      return;
    }
    const changingCards = list.cards.filter((c) => c.status !== status);
    if (changingCards.length > 0) {
      setStatusTarget({
        list,
        status,
        changing: changingCards.length,
        reopening: changingCards.filter((c) => c.status === 'DONE').length,
      });
      return;
    }
    if (list.status !== status) void applyListStatus(list.id, status);
  }

  async function applyListStatus(listId: string, status: CardStatus | null) {
    setLists((cur) =>
      cur.map((l) =>
        l.id !== listId
          ? l
          : {
              ...l,
              status,
              cards:
                status === null
                  ? l.cards
                  : l.cards.map((c) => ({ ...c, status, isDone: status === 'DONE' })),
            }
      )
    );
    try {
      await updateList(listId, { status });
    } catch (err) {
      setListsError(getErrorMessage(err, 'Không đổi được trạng thái cột.'));
      reloadLists();
    }
  }

  async function handleSortList(list: BoardList, by: SortListBy) {
    try {
      await sortListCards(list.id, by);
      reloadLists();
    } catch (err) {
      setListsError(getErrorMessage(err, 'Không sắp xếp được danh sách.'));
    }
  }

  function patchCard(updated: Card) {
    setLists((cur) =>
      cur.map((l) => ({
        ...l,
        cards: l.cards.map((c) => (c.id === updated.id ? updated : c)),
      }))
    );
  }

  // Tick / bo tick hoan thanh. Neu the dang o cot co trang thai va bang co cot
  // mang trang thai moi (vd cot "Hoan thanh") thi backend chuyen the sang do ->
  // o day chuyen truoc (lac quan) cho muot, roi tai lai theo ket qua that.
  async function handleToggleCardDone(card: Card) {
    const listStatus = lists.find((l) => l.id === card.listId)?.status ?? null;
    const nextStatus: CardStatus = card.isDone ? reopenStatus(listStatus) : 'DONE';
    const optimistic = { ...card, status: nextStatus, isDone: !card.isDone };
    const target = targetListForStatus(lists, card.listId, nextStatus);
    if (target) {
      setLists((cur) =>
        cur.map((l) =>
          l.id === card.listId
            ? { ...l, cards: l.cards.filter((c) => c.id !== card.id) }
            : l.id === target.id
              ? { ...l, cards: [{ ...optimistic, listId: target.id }, ...l.cards] }
              : l
        )
      );
    } else {
      patchCard(optimistic);
    }
    try {
      const updated = await updateCard(card.id, { isDone: !card.isDone });
      if (target || updated.listId !== card.listId) reloadLists();
      else patchCard({ ...card, ...updated });
    } catch (err) {
      if (target) reloadLists();
      else patchCard(card); // hoan tac
      setListsError(getErrorMessage(err, 'Không cập nhật được thẻ.'));
    }
  }

  // Luu tru the (co the khoi phuc trong "Mục đã lưu trữ")
  async function handleArchiveCard(card: Card) {
    setLists((cur) =>
      cur.map((l) => ({
        ...l,
        cards: l.cards.filter((c) => c.id !== card.id),
      }))
    );
    try {
      await archiveCard(card.id);
    } catch (err) {
      setListsError(getErrorMessage(err, 'Không lưu trữ được thẻ.'));
      reloadLists();
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.kind === 'list') {
        await archiveList(deleteTarget.list.id);
        setLists((cur) => cur.filter((l) => l.id !== deleteTarget.list.id));
      } else {
        await deleteAllCards(deleteTarget.list.id);
        setLists((cur) =>
          cur.map((l) =>
            l.id === deleteTarget.list.id ? { ...l, cards: [] } : l
          )
        );
      }
      setDeleteTarget(null);
    } catch (err) {
      setListsError(getErrorMessage(err, 'Thao tác không thành công.'));
    } finally {
      setDeleting(false);
    }
  }

  // Cac ham truyen xuong ListColumn (da memo): neu tao lai moi lan BoardPage ve thi memo vo tac dung, ma BoardPage ve
  // lai moi khi the doi cot trong luc keo. Ham co dinh luon goi ban moi nhat cua no.
  const stableListHandlers = {
    onApplyCardTemplate: useStableCallback(handleApplyCardTemplate),
    onRename: useStableCallback(handleRenameList),
    onRequestDeleteList: useStableCallback((l: BoardList) => setDeleteTarget({ kind: 'list', list: l })),
    onAddCard: useStableCallback(handleAddCard),
    onToggleCardDone: useStableCallback(handleToggleCardDone),
    onRequestDeleteCard: useStableCallback(handleArchiveCard),
    onCopyList: useStableCallback(handleCopyList),
    onMoveList: useStableCallback(handleMoveList),
    onMoveAllCards: useStableCallback(handleMoveAllCards),
    onSortList: useStableCallback(handleSortList),
    onSetListStatus: useStableCallback(handleSetListStatus),
    onRequestDeleteAllCards: useStableCallback((l: BoardList) => setDeleteTarget({ kind: 'cards-in-list', list: l })),
    onAssignApplied: useStableCallback(reloadLists),
  };
  // Chi id + ten cot cho menu "Di chuyen tat ca the": mang nay chi doi khi them / xoa / doi ten cot, khong doi khi the doi cot
  const listOptionsKey = lists.map((l) => `${l.id}\u0000${l.name}`).join('\u0001');
  const listOptions = useMemo(() => lists.map((l) => ({ id: l.id, name: l.name })), [listOptionsKey]);

  if (isLoading) {
    return (
      <SkeletonRegion label="Đang tải bảng…" className="overflow-hidden p-4">
        <SkeletonColumns />
      </SkeletonRegion>
    );
  }
  if (error) {
    return <div className="p-6 text-sm text-red-600">{error}</div>;
  }
  if (!board) {
    return (
      <div className="p-6">
        <p className="text-sm text-slate-600">
          {fetchBoardError ??
            (memberBoard === undefined && !fetchedBoard
              ? 'Đang mở bảng...'
              : 'Không tìm thấy bảng này.')}
        </p>
        <Link
          to="/boards"
          className="mt-2 inline-block text-sm font-medium text-primary-ink hover:underline"
        >
          ← Về danh sách bảng
        </Link>
      </div>
    );
  }

  const canvasStyle = board.backgroundImage
    ? {
        backgroundImage: `url(${assetUrl(board.backgroundImage)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : { backgroundColor: board.color };

  return (
    <div className="board-canvas @container flex h-full min-w-0 flex-col" style={canvasStyle}>
      {/* Thanh ten bang */}
      <div className="flex shrink-0 flex-col gap-2 bg-gradient-to-b from-black/35 to-black/5 px-4 py-2 backdrop-blur-sm @min-[72rem]:flex-row @min-[72rem]:items-center">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 @min-[72rem]:flex-nowrap">
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-white/20 text-white">
            <LogoMark variant="white" className="h-5 w-5" />
          </span>
          {editing && !readOnly ? (
            <form onSubmit={onNameSubmit} className="min-w-0 flex-1">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={saveName}
                onKeyDown={onNameKeyDown}
                className="w-full min-w-0 rounded bg-white px-2 py-1 text-lg font-bold text-slate-900 focus:outline-none"
              />
            </form>
          ) : (
            <button
              type="button"
              disabled={readOnly}
              onClick={() => {
                setDraft(board.name);
                setEditing(true);
              }}
              title={board.name}
              className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-lg font-bold text-white drop-shadow-sm enabled:hover:bg-white/20"
            >
              {board.name}
            </button>
          )}

          {board.workspaceName && (
            <button
              type="button"
              onClick={() => navigate(`/workspaces/${board.workspaceId}`)}
              title="Mở không gian làm việc"
              className="hidden max-w-[10rem] shrink-0 items-center gap-1 truncate rounded bg-white/20 px-2 py-1 text-xs font-medium text-white hover:bg-white/30 sm:flex"
            >
              <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 8a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 8a3 3 0 100-6M15 20a6 6 0 019-5" />
              </svg>
              <span className="truncate">{board.workspaceName}</span>
            </button>
          )}

          {!readOnly && (
            <StarButton
              starred={Boolean(board.isStarred)}
              onToggle={() => toggleStar(board.id)}
              className={`shrink-0 rounded p-1 ${
                board.isStarred ? '' : 'text-white hover:bg-white/20'
              }`}
            />
          )}

          <button
            type="button"
            disabled={watchBusy}
            onClick={toggleBoardWatch}
            title={isWatchingBoard ? 'Đang theo dõi bảng' : 'Theo dõi bảng'}
            className={`flex shrink-0 items-center gap-1 rounded px-2 py-1 text-xs font-medium disabled:opacity-60 ${
              isWatchingBoard
                ? 'bg-white/30 text-white'
                : 'text-white hover:bg-white/20'
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span className="hidden sm:inline">
              {isWatchingBoard ? 'Đang theo dõi' : 'Theo dõi'}
            </span>
          </button>

          {canManageBoard && (
            <div className="relative">
              <button
                type="button"
                data-visibility-trigger
                onClick={() => setVisMenuOpen((v) => !v)}
                title="Khả năng hiển thị"
                className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded bg-white/25 px-2 py-1 text-xs font-medium text-white hover:bg-white/40"
              >
                {board.visibility === 'PUBLIC' ? (
                  <>
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="9" />
                      <path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" />
                    </svg>
                    Công khai
                  </>
                ) : board.visibility === 'WORKSPACE' ? (
                  <>
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 8a3 3 0 100-6 3 3 0 000 6zM3 20a6 6 0 0112 0M17 8a3 3 0 100-6M15 20a6 6 0 019-5" />
                    </svg>
                    Không gian làm việc
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="4" y="11" width="16" height="10" rx="2" />
                      <path d="M8 11V7a4 4 0 018 0v4" />
                    </svg>
                    Riêng tư
                  </>
                )}
              </button>
              {visMenuOpen && (
                <BoardVisibilityMenu
                  value={board.visibility}
                  onChange={handleSetVisibility}
                  onClose={() => setVisMenuOpen(false)}
                />
              )}
            </div>
          )}

          {board.visibility === 'PUBLIC' && (
            <button
              type="button"
              onClick={async () => {
                const url = `${window.location.origin}/public/boards/${board.id}`;
                try {
                  await navigator.clipboard.writeText(url);
                  setPublicLinkCopied(true);
                  setTimeout(() => setPublicLinkCopied(false), 2000);
                } catch {
                  /* trinh duyet chan clipboard */
                }
              }}
              title="Bất kỳ ai có liên kết này đều xem được, không cần đăng nhập"
              className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded bg-white/25 px-2 py-1 text-xs font-medium text-white hover:bg-white/40"
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1" />
              </svg>
              {publicLinkCopied ? 'Đã sao chép!' : 'Sao chép liên kết công khai'}
            </button>
          )}

        </div>

        <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2 @min-[72rem]:shrink-0 @min-[72rem]:flex-nowrap">
          <div className="flex items-center gap-0.5 rounded bg-white/20 p-0.5">
            <button
              type="button"
              onClick={() => setBoardView('board')}
              title="Xem dạng bảng"
              className={`rounded px-2 py-1 text-xs font-medium ${
                boardView === 'board' ? 'bg-white/40 text-white' : 'text-white/80 hover:bg-white/25'
              }`}
            >
              Bảng
            </button>
            <button
              type="button"
              onClick={() => setBoardView('table')}
              title="Xem dạng bảng biểu"
              className={`rounded px-2 py-1 text-xs font-medium ${
                boardView === 'table' ? 'bg-white/40 text-white' : 'text-white/80 hover:bg-white/25'
              }`}
            >
              Bảng biểu
            </button>
          </div>

          {/* Nhóm công cụ của bảng: thống kê, lọc, hoạt động, trường, tự động hoá, lưu trữ, ảnh nền */}
          <div role="toolbar" aria-label="Công cụ của bảng" className="flex shrink-0 items-center gap-0.5 rounded-lg bg-white/15 p-0.5">
            <div className="relative">
              <button
                type="button"
                data-stats-trigger
                onClick={() => setStatsOpen((v) => !v)}
                title="Thống kê tiến độ"
                aria-label="Thống kê tiến độ"
                className={TOOLBAR_BTN_FLAT}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 20V10M12 20V4M20 20v-7" />
                </svg>
              </button>
              {statsOpen && (
                <BoardStatsPanel lists={lists} onClose={() => setStatsOpen(false)} />
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                data-filter-trigger
                onClick={() => setFilterOpen((v) => !v)}
                title="Lọc thẻ"
                aria-label="Lọc thẻ"
                className={`relative ${filterOn ? TOOLBAR_BTN_ON : TOOLBAR_BTN_FLAT}`}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 5h18M6 12h12M10 19h4" />
                </svg>
                {filterOn && (
                  <span className="absolute -right-1 -top-1 grid h-4 min-w-[16px] place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-white ring-2 ring-white">
                    {filterActiveCount(filter)}
                  </span>
                )}
              </button>
              {filterOpen && (
                <BoardFilterPanel
                  boardId={board.id}
                  filter={filter}
                  onChange={setFilter}
                  boardMembers={members}
                  onClose={() => setFilterOpen(false)}
                />
              )}
            </div>

            <div className="relative">
              <button
                type="button"
                data-activity-trigger
                onClick={() => setActivityOpen((v) => !v)}
                title="Hoạt động"
                aria-label="Hoạt động"
                className={TOOLBAR_BTN_FLAT}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 8v4l3 2" />
                  <circle cx="12" cy="12" r="9" />
                </svg>
              </button>
              {activityOpen && (
                <BoardActivityMenu
                  boardId={board.id}
                  onClose={() => setActivityOpen(false)}
                />
              )}
            </div>

            {!readOnly && (
              <div className="relative">
                <button
                  type="button"
                  data-fields-trigger
                  onClick={() => setFieldsMenuOpen((v) => !v)}
                  title="Trường tùy chỉnh"
                  aria-label="Trường tùy chỉnh"
                  className={TOOLBAR_BTN_FLAT}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="4" rx="1" />
                    <rect x="3" y="10" width="18" height="4" rx="1" />
                    <rect x="3" y="16" width="10" height="4" rx="1" />
                  </svg>
                </button>
                {fieldsMenuOpen && (
                  <CustomFieldsPanel
                    boardId={board.id}
                    onClose={() => setFieldsMenuOpen(false)}
                    onChanged={reloadLists}
                  />
                )}
              </div>
            )}

            {!readOnly && (
              <div className="relative">
                <button
                  type="button"
                  data-automation-trigger
                  onClick={() => setAutomationOpen((v) => !v)}
                  title="Tự động hoá"
                  aria-label="Tự động hoá"
                  className={TOOLBAR_BTN_FLAT}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M13 3L4 14h7l-1 7 9-11h-7l1-7z" />
                  </svg>
                </button>
                {automationOpen && (
                  <AutomationPanel
                    boardId={board.id}
                    onClose={() => setAutomationOpen(false)}
                  />
                )}
              </div>
            )}

            {!readOnly && (
              <div className="relative">
                <button
                  type="button"
                  data-archive-trigger
                  onClick={() => setArchiveOpen((v) => !v)}
                  title="Mục đã lưu trữ"
                  aria-label="Mục đã lưu trữ"
                  className={TOOLBAR_BTN_FLAT}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="4" rx="1" />
                    <path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8M10 12h4" />
                  </svg>
                </button>
                {archiveOpen && (
                  <BoardArchiveMenu
                    boardId={board.id}
                    onClose={() => setArchiveOpen(false)}
                    onChanged={reloadLists}
                  />
                )}
              </div>
            )}

            {!readOnly && (
              <div className="relative">
                <button
                  type="button"
                  data-bg-trigger
                  onClick={() => setBgMenuOpen((v) => !v)}
                  title="Hình nền"
                  aria-label="Hình nền"
                  className={TOOLBAR_BTN_FLAT}
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="16" rx="2" />
                    <circle cx="9" cy="10" r="2" />
                    <path d="M21 16l-5-5-4 4-2-2-4 4" />
                  </svg>
                </button>
                {bgMenuOpen && (
                  <BoardBackgroundMenu
                    board={board}
                    onChanged={patchBoard}
                    onClose={() => setBgMenuOpen(false)}
                  />
                )}
              </div>
            )}
          </div>

          {/* canManageBoard co the true du readOnly=true (vd ADMIN khong gian
              xem 1 bang PUBLIC ma chua la thanh vien truc tiep -> khong sua
              duoc noi dung the nhung van quan ly duoc thanh vien/hien thi) */}
          {(!readOnly || canManageBoard) && (
            <BoardMembers
              boardId={board.id}
              members={members}
              currentUserId={user?.id}
              onlineUserIds={onlineIds}
              isOwner={isOwner}
              canManage={canManageBoard}
              openTo={shareParam === 'requests' ? 'requests' : null}
              onOpened={consumeShareParam}
              onAdd={handleAddMember}
              onChangeRole={handleChangeMemberRole}
              onRemove={handleRemoveMember}
              onTransferOwnership={handleTransferOwnership}
              onApproved={(member) =>
                setMembers((cur) =>
                  cur.some((m) => m.userId === member.userId)
                    ? cur.map((m) => (m.userId === member.userId ? member : m))
                    : [...cur, member]
                )
              }
            />
          )}

          {!readOnly && (
            <div className="relative">
              <button
                type="button"
                data-board-menu-trigger
                onClick={() => setBoardMenuOpen((v) => !v)}
                title="Thao tác với bảng"
                aria-label="Thao tác với bảng"
                className={TOOLBAR_BTN}
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                  <circle cx="5" cy="12" r="1.8" />
                  <circle cx="12" cy="12" r="1.8" />
                  <circle cx="19" cy="12" r="1.8" />
                </svg>
              </button>
              {boardMenuOpen && (
                <BoardActionsMenu
                  boardId={board.id}
                  boardName={board.name}
                  isOwner={isOwner}
                  onClose={() => setBoardMenuOpen(false)}
                  onArchived={() => {
                    setBoardMenuOpen(false);
                    removeBoard(board.id);
                    navigate('/boards', { replace: true });
                  }}
                  onDeleted={() => {
                    setBoardMenuOpen(false);
                    removeBoard(board.id);
                    navigate('/boards', { replace: true });
                  }}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {readOnly && (
        <div className="mx-3 mt-2 flex w-fit items-center gap-2 rounded bg-white/90 px-3 py-1 text-sm text-slate-700 shadow-sm">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 018 0v4" />
          </svg>
          Bảng công khai — bạn đang xem ở chế độ chỉ đọc
        </div>
      )}

      {(saveError || listsError) && (
        <p className="mx-4 mt-2 w-fit rounded bg-red-600/90 px-3 py-1 text-sm text-white">
          {saveError ?? listsError}
        </p>
      )}

      {filterOn && (
        <div className="mx-3 mt-2 flex w-fit items-center gap-2 rounded bg-white/90 px-3 py-1 text-sm text-slate-700 shadow-sm">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 5h18M6 12h12M10 19h4" />
          </svg>
          Đang lọc thẻ
          <button
            type="button"
            onClick={() => setFilter(EMPTY_FILTER)}
            className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium hover:bg-slate-300"
          >
            Xoá bộ lọc
          </button>
        </div>
      )}

      {/* Hang cac danh sach */}
      {listsLoading ? (
        <SkeletonRegion label="Đang tải danh sách…" className="p-4">
          <SkeletonColumns onColor />
        </SkeletonRegion>
      ) : boardView === 'table' ? (
        <BoardTableView lists={displayLists} onOpenCard={setOpenCardId} />
      ) : (
        <CardHighlightContext.Provider value={cardHighlights}>
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <div
              className={`board-scroll flex min-h-0 flex-1 items-start gap-3 overflow-x-auto p-3 ${
                activeCard || activeList ? 'tf-dragging select-none' : ''
              }`}
            >
              <SortableContext
                items={listDndIds}
                strategy={horizontalListSortingStrategy}
              >
                {displayLists.map((list) => (
                  <ListColumn
                    key={list.id}
                    list={list}
                    allLists={listOptions}
                    readOnly={readOnly}
                    onOpenCard={setOpenCardId}
                    {...stableListHandlers}
                  />
                ))}
              </SortableContext>

              {!readOnly && <AddListForm onAdd={handleAddList} />}
            </div>

            <DragOverlay dropAnimation={dropAnimation}>
              {activeCard ? (
                <div className="w-64">
                  <CardItem
                    card={activeCard}
                    listStatus={lists.find((l) => l.id === activeCard.listId)?.status ?? null}
                    overlay
                  />
                </div>
              ) : activeList ? (
                <ListColumnOverlay list={activeList} />
              ) : null}
            </DragOverlay>
          </DndContext>
        </CardHighlightContext.Provider>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={
          deleteTarget?.kind === 'cards-in-list'
            ? 'Xoá tất cả thẻ?'
            : 'Lưu trữ danh sách?'
        }
        message={
          deleteTarget?.kind === 'cards-in-list'
            ? `Toàn bộ ${deleteTarget.list.cards.length} thẻ trong danh sách "${deleteTarget.list.name}" sẽ bị xoá.`
            : deleteTarget?.kind === 'list'
              ? `Danh sách "${deleteTarget.list.name}" (và các thẻ bên trong) sẽ được chuyển vào mục Đã lưu trữ. Bạn có thể khôi phục lại sau.`
              : undefined
        }
        confirmLabel={
          deleteTarget?.kind === 'cards-in-list'
            ? 'Xoá tất cả thẻ'
            : 'Lưu trữ'
        }
        danger={deleteTarget?.kind === 'cards-in-list'}
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={statusTarget !== null}
        title="Đổi trạng thái cột?"
        message={
          statusTarget
            ? `${statusTarget.changing} thẻ trong cột "${statusTarget.list.name}" sẽ chuyển sang "${STATUS_META[statusTarget.status].label}"` +
              (statusTarget.status === 'DONE'
                ? ' và được đánh dấu hoàn thành.'
                : statusTarget.reopening > 0
                  ? ` (${statusTarget.reopening} thẻ đang hoàn thành sẽ bị mở lại).`
                  : '.')
            : undefined
        }
        confirmLabel="Đổi trạng thái"
        onConfirm={() => {
          if (!statusTarget) return;
          const { list, status } = statusTarget;
          setStatusTarget(null);
          void applyListStatus(list.id, status);
        }}
        onCancel={() => setStatusTarget(null)}
      />

      {openCardId && (
        // key theo the: mo the khac thi boundary la moi, khong dinh trang thai loi cua the truoc
        <ErrorBoundary
          key={openCardId}
          scope="card-modal"
          fallback={({ reset }) => (
            <CardModalCrash onClose={() => setOpenCardId(null)} onRetry={reset} />
          )}
        >
          <Suspense fallback={<ModalLoading />}>
            <CardModal
              cardId={openCardId}
              lists={lists.map((l) => ({ id: l.id, name: l.name, status: l.status }))}
              boardMembers={members}
              currentUserId={user?.id}
              readOnly={readOnly}
              onClose={() => setOpenCardId(null)}
              onChanged={reloadLists}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {shortcutsOpen && (
        <ShortcutsHelp onClose={() => setShortcutsOpen(false)} />
      )}
    </div>
  );
}
