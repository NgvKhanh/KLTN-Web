import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  addAttachment,
  addCardReminder,
  addChecklist,
  addChecklistItem,
  addComment,
  addCardMember,
  archiveCard,
  attachCardLabel,
  convertItemToCard,
  copyCard,
  deleteAttachment,
  deleteChecklist,
  deleteChecklistItem,
  deleteComment,
  detachCardLabel,
  fetchBoardLabels,
  fetchCardDetail,
  fetchCardReminders,
  getCardConflict,
  moveCard,
  removeCardMember,
  removeCardReminder,
  reorderChecklistItems,
  REMINDER_OFFSETS,
  setCardWatch,
  updateCard,
  updateChecklistItem,
  type CardGuardedFields,
  type CardReminder,
  type ReminderOffset,
} from '../../lib/api/card';
import { assetUrl } from '../../lib/assets';
import { toDatetimeLocalValue } from '../../lib/datetimeLocal';
import Avatar from '../Avatar';
import LabelPanel from './LabelPanel';
import { useBoards } from '../../context/BoardsContext';
import {
  fetchBoardCustomFields,
  setCardFieldValue,
} from '../../lib/api/customField';
import { saveCardAsTemplate } from '../../lib/api/cardTemplate';
import type { CustomField } from '../../types/customField';
import { Skeleton, SkeletonRegion } from '../Skeleton';
import { getErrorMessage } from '../../lib/errorMessage';
import { logError } from '../../lib/logError';
import { fetchBoardLists } from '../../lib/api/list';
import { MiniMarkdown } from '../../lib/miniMarkdown';
import type { BoardMember } from '../../types/board';
import type {
  CardActivity,
  CardComment,
  CardDetail,
  CardStatus,
  Label,
} from '../../types/card';
import { CARD_STATUS_ORDER, STATUS_META, targetListForStatus } from '../../lib/cardStatus';
import StatusBadge from './StatusBadge';
import type { BoardList } from '../../types/list';
import AssignSuggestPanel from './cardModal/AssignSuggestPanel';
import CardConflictDialog, { type ConflictRow } from './cardModal/CardConflictDialog';
import { AddItemInput } from './cardModal/AddItemInput';
import CommentComposer from './cardModal/CommentComposer';
import CommentThread from './cardModal/CommentThread';
import { SortableItem } from './cardModal/SortableItem';
import { groupCommentThreads, type CommentThreadGroup } from '../../lib/commentThreads';
import { useCardRealtime } from './cardModal/useCardRealtime';
import {
  COVER_COLORS,
  STORY_POINT_OPTIONS,
  activityText,
  fmt,
  formatBytes,
} from './cardModal/helpers';

interface Props {
  cardId: string;
  // Cac cot cua bang theo dung thu tu, kem trang thai (de biet the se nhay sang cot nao)
  lists: { id: string; name: string; status: CardStatus | null }[];
  boardMembers: BoardMember[];
  currentUserId?: string;
  readOnly?: boolean;
  onClose: () => void;
  onChanged: () => void;
}

// Nhac han la thiet lap CA NHAN (rieng cho tung nguoi), khong phai sua noi
// dung the - nen luon bat tuong tac duoc, ke ca voi VIEWER (readOnly=true).
// Tach rieng khoi panel "Ngay" (chi danh cho nguoi co quyen sua) de dung lai
// duoc o ca 2 noi: trong panel "Ngay" va o popover rieng canh huy hieu ngay.
// Nut "Thêm vào thẻ": chung kiểu dáng, mỗi nút có biểu tượng để quét mắt nhanh hơn
const ADD_TO_CARD_BTN =
  'inline-flex items-center gap-1.5 rounded bg-slate-200 dark:bg-slate-600 px-3 py-1.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-300 dark:hover:bg-slate-600';

const CONFLICT_LABELS: Record<keyof CardGuardedFields, string> = {
  title: 'Tiêu đề',
  description: 'Mô tả',
  startDate: 'Ngày bắt đầu',
  dueDate: 'Ngày hết hạn',
};

const ADD_ICON_PATHS = {
  labels: 'M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0L3 13V3h10l7.6 7.6a2 2 0 010 2.8zM7.5 7.5h.01',
  due: 'M5 4h14a2 2 0 012 2v13a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zM3 10h18M8 2v4M16 2v4',
  members: 'M12 4.5a3.5 3.5 0 110 7 3.5 3.5 0 010-7zM5 20a7 7 0 0114 0',
  checklist: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
  cover: 'M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2zM8.5 7a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM21 15l-5-5L5 21',
  attach: 'M21 12.5l-8.5 8.5a5 5 0 01-7-7l9-9a3.5 3.5 0 015 5l-9 9a2 2 0 01-3-3l8-8',
} as const;

function AddIcon({ name }: { name: keyof typeof ADD_ICON_PATHS }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={ADD_ICON_PATHS[name]} />
    </svg>
  );
}

function ReminderCheckboxes({
  cardId,
  reminders,
  onChanged,
  onError,
}: {
  cardId: string;
  reminders: CardReminder[];
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {REMINDER_OFFSETS.map((offset) => {
        const active = reminders.some((r) => r.offsetMinutes === offset);
        return (
          <label
            key={offset}
            className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"
          >
            <input
              type="checkbox"
              checked={active}
              onChange={() => {
                const toggle = (offsetMinutes: ReminderOffset) =>
                  active
                    ? removeCardReminder(cardId, offsetMinutes)
                    : addCardReminder(cardId, offsetMinutes);
                toggle(offset)
                  .then(onChanged)
                  .catch((err) =>
                    onError(getErrorMessage(err, 'Không đặt được nhắc hẹn.'))
                  );
              }}
            />
            {offset === 10
              ? '10 phút trước'
              : offset === 60
                ? '1 giờ trước'
                : '1 ngày trước'}
          </label>
        );
      })}
    </div>
  );
}

export default function CardModal({
  cardId,
  lists,
  boardMembers,
  currentUserId,
  readOnly = false,
  onClose,
  onChanged,
}: Props) {
  const [card, setCard] = useState<CardDetail | null>(null);
  const [labels, setLabels] = useState<Label[]>([]);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templateSaveState, setTemplateSaveState] = useState<'idle' | 'busy' | 'done'>(
    'idle'
  );

  const [titleDraft, setTitleDraft] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [editingDesc, setEditingDesc] = useState(false);
  // Khoa lac quan (nhieu nguoi sua cung 1 the): gia tri GOC cua truong luc BAT DAU
  // sua - gui kem khi luu de server phat hien nguoi khac da doi truong do.
  // Lay luc bat dau sua (khong lay luc bam Luu) vi `card` co the da duoc tai lai
  // o giua, luc do gia tri hien tai khong con la "cai minh da thay".
  const editBase = useRef<CardGuardedFields>({});
  // Esc o o tieu de = huy sua (khong luu). Danh dau de onBlur (neu con chay luc o go
  // bi go khoi DOM) khong luu nham. Reset moi lan mo o sua.
  const titleEscapeRef = useRef(false);
  // Nguoi khac da luu de len cho minh vua sua -> hop thoai chon giu ban nao
  const [conflict, setConflict] = useState<{
    patch: CardGuardedFields;
    base: CardGuardedFields;
    theirs: CardGuardedFields;
  } | null>(null);
  const conflictRef = useRef(false);
  useEffect(() => {
    conflictRef.current = conflict !== null;
  }, [conflict]);
  const [conflictBusy, setConflictBusy] = useState(false);
  // Co thay doi tren bang trong luc dang sua -> nhac nhe (khong chan)
  const [changedWhileEditing, setChangedWhileEditing] = useState(false);
  const [panel, setPanel] = useState<
    | 'labels'
    | 'due'
    | 'members'
    | 'list'
    | 'status'
    | 'move-board'
    | 'menu'
    | 'checklist'
    | 'cover'
    | 'copy'
    | 'reminders'
    | null
  >(null);
  const [clTitle, setClTitle] = useState('Việc cần làm');
  const [clCopyFrom, setClCopyFrom] = useState('');
  const [copyTitle, setCopyTitle] = useState('');
  const [copyListId, setCopyListId] = useState('');
  const { boards: myBoards } = useBoards();
  const [moveBoardId, setMoveBoardId] = useState('');
  const [moveTargetLists, setMoveTargetLists] = useState<BoardList[]>([]);
  const [moveListId, setMoveListId] = useState('');
  const [moveLoadingLists, setMoveLoadingLists] = useState(false);
  const [hideDone, setHideDone] = useState<Record<string, boolean>>({});
  const itemSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );
  const [showDetails, setShowDetails] = useState(false);
  const [itemPanel, setItemPanel] = useState<{
    id: string;
    kind: 'assign' | 'due';
  } | null>(null);
  const itemDueRef = useRef<HTMLInputElement>(null);
  const [reminders, setReminders] = useState<CardReminder[]>([]);
  const loadReminders = useCallback(() => {
    fetchCardReminders(cardId)
      .then(setReminders)
      .catch(logError('CardModal: tai nhac han'));
  }, [cardId]);
  useEffect(() => {
    if (panel === 'due' || panel === 'reminders') loadReminders();
  }, [panel, loadReminders]);

  // Chon bang dich (khac bang hien tai) o panel "move-board" -> tai danh
  // sach cua bang do de chon list dich
  useEffect(() => {
    if (!moveBoardId) {
      setMoveTargetLists([]);
      setMoveListId('');
      return;
    }
    let alive = true;
    setMoveLoadingLists(true);
    fetchBoardLists(moveBoardId)
      .then((ls) => {
        if (!alive) return;
        setMoveTargetLists(ls);
        setMoveListId(ls[0]?.id ?? '');
      })
      .catch(logError('CardModal: tai danh sach bang dich'))
      .finally(() => alive && setMoveLoadingLists(false));
    return () => {
      alive = false;
    };
  }, [moveBoardId]);

  // Dang go tieu de / mo ta -> tai lai the KHONG duoc ghi de ban nhap (truoc day
  // chi su kien realtime tranh duoc, con tu thao tac cua chinh minh thi mat ban nhap)
  const editingTitleRef = useRef(false);
  const editingDescRef = useRef(false);
  useEffect(() => {
    editingTitleRef.current = editingTitle;
    editingDescRef.current = editingDesc;
  }, [editingTitle, editingDesc]);
  // Nhieu lan tai lai chay chong nhau (realtime + sau khi luu): chi lan MOI NHAT
  // duoc ap dung, lan cu ve tre khong de len du lieu moi hon.
  const reloadSeq = useRef(0);

  const reload = useCallback(async () => {
    const seq = (reloadSeq.current += 1);
    const d = await fetchCardDetail(cardId);
    if (seq !== reloadSeq.current) return d;
    setCard(d);
    if (!editingTitleRef.current) setTitleDraft(d.title);
    if (!editingDescRef.current) setDescDraft(d.description ?? '');
    return d;
  }, [cardId]);

  const reloadLabels = useCallback(() => {
    if (!card) return;
    fetchBoardLabels(card.list.boardId)
      .then(setLabels)
      .catch(logError('CardModal: tai nhan'));
    void reload();
    onChanged();
  }, [card, reload, onChanged]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    reload()
      .then((d) => {
        if (!alive) return null;
        return Promise.all([
          fetchBoardLabels(d.list.boardId),
          fetchBoardCustomFields(d.list.boardId),
        ]);
      })
      .then((res) => {
        if (!alive || !res) return;
        const [ls, fs] = res;
        setLabels(ls);
        setCustomFields(fs);
      })
      .catch((err) => alive && setError(getErrorMessage(err, 'Không tải được thẻ.')))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [reload]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Dang hien hop thoai xung dot: Esc chi dong hop thoai do, khong dong the
      if (e.key === 'Escape' && !conflictRef.current) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  // Realtime: nguoi khac binh luan / sua the tren cung bang -> tai lai ngay
  const editingRef = useRef(false);
  editingRef.current = editingTitle || editingDesc;
  const boardIdRef = useRef<string | null>(null);
  boardIdRef.current = card?.list.boardId ?? null;
  const markChangedWhileEditing = useCallback(() => setChangedWhileEditing(true), []);
  useCardRealtime({
    reload,
    editingRef,
    editing: editingTitle || editingDesc,
    boardIdRef,
    onChangedWhileEditing: markChangedWhileEditing,
  });

  // Luu cac truong co khoa lac quan. `base` = gia tri GOC luc bat dau sua. Server
  // thay truong do da bi nguoi khac doi -> 409, ta mo hop thoai thay vi bao loi chung.
  // Tra ve true neu luu thanh cong.
  // `onFail`: loi KHONG phai xung dot (vd noi dung qua dai) -> goi de mo lai o soan thao
  // voi ban nhap con nguyen, thay vi dong lai roi mat chu da go.
  async function saveGuarded(
    patch: CardGuardedFields,
    base: CardGuardedFields,
    onFail?: () => void
  ): Promise<boolean> {
    if (readOnly || !card) return false;
    setError(null);
    try {
      await updateCard(card.id, { ...patch, expected: base });
    } catch (err) {
      const c = getCardConflict(err);
      if (c) {
        setConflict({ patch, base, theirs: c.current });
      } else {
        setError(getErrorMessage(err, 'Thao tác thất bại.'));
        onFail?.();
      }
      return false;
    }
    try {
      await reload();
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err, 'Thao tác thất bại.'));
    }
    return true;
  }

  // "Ghi de": van gui kem gia tri goc = ban moi nhat vua thay, de neu giua chung
  // lai co nguoi thu 3 luu thi van duoc bao thay vi am tham de len.
  async function overwriteConflict() {
    if (!conflict) return;
    setConflictBusy(true);
    try {
      const ok = await saveGuarded(conflict.patch, { ...conflict.base, ...conflict.theirs });
      if (ok) setConflict(null);
    } finally {
      setConflictBusy(false);
    }
  }

  async function acceptTheirsConflict() {
    setConflict(null);
    setError(null);
    try {
      await reload();
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err, 'Không tải được thẻ.'));
    }
  }

  // Quay lai o soan thao voi noi dung cua minh, lay ban moi nhat lam goc moi
  // (chi cho tieu de / mo ta; ngay thang thi dung ban moi roi chon lai)
  async function keepEditingConflict() {
    if (!conflict) return;
    const { patch } = conflict;
    setConflict(null);
    setError(null);
    try {
      const d = await reload();
      if (patch.title !== undefined) {
        editBase.current.title = d.title;
        titleEscapeRef.current = false;
        setTitleDraft(patch.title);
        setChangedWhileEditing(false);
        setEditingTitle(true);
      } else if (patch.description !== undefined) {
        editBase.current.description = d.description ?? null;
        setDescDraft(patch.description ?? '');
        setChangedWhileEditing(false);
        setEditingDesc(true);
      }
    } catch (err) {
      setError(getErrorMessage(err, 'Không tải được thẻ.'));
    }
  }

  function startEditDesc() {
    if (readOnly || !card) return;
    editBase.current.description = card.description ?? null;
    setChangedWhileEditing(false);
    setEditingDesc(true);
  }

  // Luu ngay bat dau / het han tu 2 o datetime-local ('' = bo ngay). Chi gui
  // truong THUC SU doi (so o datetime-local, do chinh xac phut) de sua 1 ngay
  // khong bi coi la xung dot voi viec nguoi khac vua doi ngay kia.
  function saveDates(startVal: string | undefined, dueVal: string | undefined) {
    if (!card) return;
    const baseStart =
      editBase.current.startDate !== undefined ? editBase.current.startDate : card.startDate;
    const baseDue =
      editBase.current.dueDate !== undefined ? editBase.current.dueDate : card.dueDate;
    const patch: CardGuardedFields = {};
    const base: CardGuardedFields = {};
    if ((startVal ?? '') !== toDatetimeLocalValue(baseStart)) {
      patch.startDate = startVal ? new Date(startVal).toISOString() : null;
      base.startDate = baseStart;
    }
    if ((dueVal ?? '') !== toDatetimeLocalValue(baseDue)) {
      patch.dueDate = dueVal ? new Date(dueVal).toISOString() : null;
      base.dueDate = baseDue;
    }
    if (Object.keys(patch).length === 0) return;
    void saveGuarded(patch, base);
  }

  // Tra ve true neu chinh thao tac `fn` thanh cong (ke ca khi tai lai the sau do loi) - noi goi dung de biet co nen lam buoc
  // tiep theo khong (vd ghi lai lua chon o o Thanh vien co goi y phan cong).
  async function run(fn: () => Promise<unknown>): Promise<boolean> {
    if (readOnly) return false;
    setError(null);
    let done = false;
    try {
      await fn();
      done = true;
      await reload();
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err, 'Thao tác thất bại.'));
    }
    return done;
  }

  // Keo sap xep lai cac muc trong 1 checklist
  async function reorderItems(checklistId: string, e: DragEndEvent) {
    if (readOnly || !card) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const cl = card.checklists.find((c) => c.id === checklistId);
    if (!cl) return;
    const oldIndex = cl.items.findIndex((i) => i.id === active.id);
    const newIndex = cl.items.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const nextItems = arrayMove(cl.items, oldIndex, newIndex);
    setCard({
      ...card,
      checklists: card.checklists.map((c) =>
        c.id === checklistId ? { ...c, items: nextItems } : c
      ),
    });
    try {
      await reorderChecklistItems(
        checklistId,
        nextItems.map((i) => i.id)
      );
      onChanged();
    } catch (err) {
      setError(getErrorMessage(err, 'Không sắp xếp được mục.'));
      await reload();
    }
  }

  // Binh luan gom thanh luong (goc + cac cau tra loi); moi luong xen voi nhat ky theo gio cua binh luan goc
  const feed = useMemo(() => {
    if (!card) return [] as (
      | { kind: 'thread'; at: string; t: CommentThreadGroup<CardComment> }
      | { kind: 'activity'; at: string; a: CardActivity }
    )[];
    const items: (
      | { kind: 'thread'; at: string; t: CommentThreadGroup<CardComment> }
      | { kind: 'activity'; at: string; a: CardActivity }
    )[] = [
      ...groupCommentThreads(card.comments).map((t) => ({
        kind: 'thread' as const,
        at: t.root.createdAt,
        t,
      })),
      // "Hien chi tiet" moi hien cac dong nhat ky hoat dong
      ...(showDetails
        ? card.activities
            .filter((a) => a.type !== 'comment.create')
            .map((a) => ({ kind: 'activity' as const, at: a.createdAt, a }))
        : []),
    ];
    return items.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
  }, [card, showDetails]);

  const cardLabelIds = new Set(card?.labels.map((l) => l.labelId));
  const cardMemberIds = new Set(card?.members.map((m) => m.userId));
  const startRef = useRef<HTMLInputElement>(null);
  const dueRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Hang cua hop thoai xung dot: ban cua minh canh ban moi nhat tren the
  const conflictRows: ConflictRow[] = conflict
    ? (Object.keys(conflict.theirs) as (keyof CardGuardedFields)[]).map((k) => {
        const show = (v: string | null | undefined) =>
          v === null || v === undefined ? '' : k === 'startDate' || k === 'dueDate' ? fmt(v) : v;
        return {
          key: k,
          label: CONFLICT_LABELS[k],
          mine: show(conflict.patch[k]),
          theirs: show(conflict.theirs[k]),
        };
      })
    : [];

  return createPortal(
    <div
      className="tf-overlay fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 py-10"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-[760px] max-w-full rounded-xl bg-[#f4f5f7] shadow-2xl dark:bg-slate-900">
        {error && (loading || !card) ? (
          <p className="p-10 text-center text-sm text-slate-600 dark:text-slate-400">{error}</p>
        ) : loading || !card ? (
          <SkeletonRegion label="Đang tải thẻ…" className="flex flex-col gap-4 p-6">
            <Skeleton className="h-6 w-3/5" />
            <Skeleton className="h-3 w-24" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-8 w-20" />
            </div>
            <Skeleton className="h-20 w-full" />
          </SkeletonRegion>
        ) : (
          <>
            {/* Anh bia */}
            {(card.coverImageUrl || card.coverColor) && (
              <div
                className="h-24 rounded-t-xl bg-cover bg-center"
                style={
                  card.coverImageUrl
                    ? { backgroundImage: `url(${assetUrl(card.coverImageUrl)})` }
                    : { backgroundColor: card.coverColor as string }
                }
              />
            )}

            {/* Header */}
            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-700 px-4 py-3">
              <div className="relative">
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => setPanel(panel === 'list' ? null : 'list')}
                  className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-2.5 py-1 text-sm text-slate-700 dark:text-slate-200 enabled:hover:bg-slate-50 dark:enabled:hover:bg-slate-700"
                >
                  {card.list.name}
                  {!readOnly && ' ▾'}
                </button>
                {panel === 'list' && !readOnly && (
                  <div className="tf-menu-in absolute left-0 top-9 z-10 w-48 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1 shadow-xl">
                    {lists.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => {
                          setPanel(null);
                          if (l.id !== card.listId)
                            void run(() => moveCard(card.id, { listId: l.id, position: 0 }));
                        }}
                        className={`block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 ${
                          l.id === card.listId ? 'font-semibold text-primary-ink' : 'text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        {l.name}
                      </button>
                    ))}
                    <div className="mt-1 border-t border-slate-200 pt-1 dark:border-slate-700">
                      <button
                        type="button"
                        onClick={() => {
                          setMoveBoardId('');
                          setPanel('move-board');
                        }}
                        className="block w-full truncate rounded px-2 py-1.5 text-left text-sm text-primary-ink hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        Chuyển sang bảng khác…
                      </button>
                    </div>
                  </div>
                )}
                {panel === 'move-board' && !readOnly && (
                  <div className="tf-menu-in absolute left-0 top-9 z-10 w-64 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-xl">
                    <p className="mb-2 text-sm font-semibold text-slate-700 dark:text-slate-100">
                      Chuyển thẻ sang bảng khác
                    </p>
                    <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">
                      Bảng đích
                    </label>
                    <select
                      autoFocus
                      value={moveBoardId}
                      onChange={(e) => setMoveBoardId(e.target.value)}
                      className="mb-3 w-full rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
                    >
                      <option value="">Chọn bảng…</option>
                      {myBoards
                        .filter((b) => b.id !== card.list.boardId)
                        .map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                            {b.workspaceName ? ` (${b.workspaceName})` : ''}
                          </option>
                        ))}
                    </select>

                    {moveBoardId && (
                      <>
                        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">
                          Danh sách đích
                        </label>
                        <select
                          value={moveListId}
                          onChange={(e) => setMoveListId(e.target.value)}
                          disabled={moveLoadingLists || moveTargetLists.length === 0}
                          className="mb-3 w-full rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm focus:border-primary focus:outline-none disabled:opacity-60"
                        >
                          {moveTargetLists.length === 0 ? (
                            <option value="">
                              {moveLoadingLists ? 'Đang tải…' : 'Bảng chưa có danh sách'}
                            </option>
                          ) : (
                            moveTargetLists.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))
                          )}
                        </select>
                      </>
                    )}

                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!moveListId}
                        onClick={() => {
                          const targetListId = moveListId;
                          setPanel(null);
                          void run(() =>
                            moveCard(card.id, { listId: targetListId, position: 0 })
                          );
                        }}
                        className="flex-1 rounded-lg bg-primary py-1.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
                      >
                        Chuyển
                      </button>
                      <button
                        type="button"
                        onClick={() => setPanel('list')}
                        className="rounded-lg px-2 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                      >
                        Quay lại
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Trang thai the. Doi trang thai khi the dang o cot CO trang thai -> the tu
                  chuyen sang cot dau tien mang trang thai moi (neu bang co), ghi chu ngay trong lua chon. */}
              <div className="relative">
                <button
                  type="button"
                  disabled={readOnly}
                  aria-label={`Trạng thái: ${STATUS_META[card.status].label}`}
                  onClick={() => setPanel(panel === 'status' ? null : 'status')}
                  className="flex items-center gap-1 rounded-lg px-1 py-1 enabled:hover:bg-slate-100 dark:enabled:hover:bg-slate-700"
                >
                  <StatusBadge status={card.status} className="text-xs" />
                  {!readOnly && <span className="text-xs text-slate-500">▾</span>}
                </button>
                {panel === 'status' && !readOnly && (
                  <div className="tf-menu-in absolute left-0 top-9 z-10 w-60 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1 shadow-xl">
                    {CARD_STATUS_ORDER.map((st) => {
                      const moveTo = targetListForStatus(lists, card.listId, st);
                      return (
                        <button
                          key={st}
                          type="button"
                          aria-pressed={st === card.status}
                          onClick={() => {
                            setPanel(null);
                            if (st !== card.status)
                              void run(() => updateCard(card.id, { status: st }));
                          }}
                          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 ${
                            st === card.status ? 'font-semibold text-primary-ink' : 'text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_META[st].dot}`} />
                          <span className="flex-1">{STATUS_META[st].label}</span>
                          {st !== card.status && moveTo && (
                            <span className="truncate text-[11px] font-normal text-slate-500 dark:text-slate-400">
                              → cột {moveTo.name}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="relative ml-auto">
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => setPanel(panel === 'menu' ? null : 'menu')}
                    aria-label="Hành động"
                    className="rounded p-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                  >
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                      <circle cx="5" cy="12" r="1.8" />
                      <circle cx="12" cy="12" r="1.8" />
                      <circle cx="19" cy="12" r="1.8" />
                    </svg>
                  </button>
                )}
                {panel === 'menu' && !readOnly && (
                  <div className="tf-menu-in absolute right-0 top-9 z-10 w-40 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1 shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setCopyTitle(`${card.title} (bản sao)`);
                        setCopyListId(card.listId);
                        setPanel('copy');
                      }}
                      className="block w-full rounded px-2 py-1.5 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      Sao chép thẻ
                    </button>
                    <button
                      type="button"
                      disabled={templateSaveState === 'busy'}
                      onClick={() => {
                        setTemplateSaveState('busy');
                        saveCardAsTemplate(card.id)
                          .then(() => {
                            setTemplateSaveState('done');
                            setTimeout(() => {
                              setTemplateSaveState('idle');
                              setPanel(null);
                            }, 1200);
                          })
                          .catch((err) => {
                            setTemplateSaveState('idle');
                            setError(getErrorMessage(err, 'Không lưu được mẫu.'));
                          });
                      }}
                      className="block w-full rounded px-2 py-1.5 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
                    >
                      {templateSaveState === 'busy'
                        ? 'Đang lưu...'
                        : templateSaveState === 'done'
                          ? 'Đã lưu thành mẫu ✓'
                          : 'Lưu thành mẫu thẻ'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPanel(null);
                        void run(async () => {
                          await archiveCard(card.id);
                          onClose();
                        });
                      }}
                      className="block w-full rounded px-2 py-1.5 text-left text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700"
                    >
                      Lưu trữ
                    </button>
                  </div>
                )}
                {panel === 'copy' && !readOnly && (
                  <div className="tf-menu-in absolute right-0 top-9 z-10 w-64 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-xl">
                    <p className="mb-2 text-sm font-semibold">Sao chép thẻ</p>
                    <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">
                      Tiêu đề
                    </label>
                    <textarea
                      autoFocus
                      rows={2}
                      value={copyTitle}
                      onChange={(e) => setCopyTitle(e.target.value)}
                      className="mb-2 w-full resize-none rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
                    />
                    <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">
                      Danh sách
                    </label>
                    <select
                      value={copyListId}
                      onChange={(e) => setCopyListId(e.target.value)}
                      className="mb-3 w-full rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
                    >
                      {lists.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        setPanel(null);
                        void run(() =>
                          copyCard(card.id, {
                            title: copyTitle.trim() || undefined,
                            listId: copyListId || undefined,
                          })
                        );
                      }}
                      className="w-full rounded-lg bg-primary py-1.5 text-sm font-semibold text-white hover:bg-primary-hover"
                    >
                      Tạo thẻ
                    </button>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Đóng"
                className="rounded p-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <div className="flex flex-col gap-4 p-4 md:flex-row">
              {/* ===== Cot trai ===== */}
              <div className="min-w-0 flex-1">
                {/* Tieu de + done */}
                <div className="mb-3 flex items-start gap-2">
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => void run(() => updateCard(card.id, { isDone: !card.isDone }))}
                    aria-label="Đánh dấu hoàn thành"
                    className="mt-1"
                  >
                    {card.isDone ? (
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-emerald-600 text-white">
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3">
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                    ) : (
                      <span className="block h-5 w-5 rounded-full border-2 border-slate-400" />
                    )}
                  </button>
                  {editingTitle && !readOnly ? (
                    <textarea
                      autoFocus
                      value={titleDraft}
                      maxLength={500}
                      onChange={(e) => setTitleDraft(e.target.value)}
                      onBlur={() => {
                        if (titleEscapeRef.current) {
                          titleEscapeRef.current = false;
                          return;
                        }
                        setEditingTitle(false);
                        const t = titleDraft.trim();
                        // So voi tieu de LUC BAT DAU sua, khong phai card.title hien tai
                        // (the co the vua duoc nguoi khac doi): neu minh khong doi gi thi
                        // khong luu, de ban moi cua ho khong bi ghi de bang ban cu.
                        const base = editBase.current.title ?? card.title;
                        if (t && t !== base) {
                          void saveGuarded({ title: t }, { title: base }, () => setEditingTitle(true));
                        }
                        else setTitleDraft(card.title);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          (e.target as HTMLTextAreaElement).blur();
                        } else if (e.key === 'Escape') {
                          // Huy sua tieu de, KHONG dong ca the (truoc day Esc dong the
                          // va mat ban nhap)
                          e.stopPropagation();
                          titleEscapeRef.current = true;
                          setEditingTitle(false);
                          setTitleDraft(card.title);
                        }
                      }}
                      rows={1}
                      className="w-full resize-none rounded border border-primary px-2 py-1 text-lg font-semibold text-slate-900 dark:text-slate-100 focus:outline-none"
                    />
                  ) : (
                    <h2
                      onClick={() => {
                        if (readOnly) return;
                        editBase.current.title = card.title;
                        titleEscapeRef.current = false;
                        setChangedWhileEditing(false);
                        setEditingTitle(true);
                      }}
                      className={`text-lg font-semibold ${
                        readOnly ? '' : 'cursor-pointer'
                      } ${
                        card.isDone ? 'text-slate-600 dark:text-slate-400 line-through' : 'text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {card.title}
                    </h2>
                  )}
                </div>

                {changedWhileEditing && (editingTitle || editingDesc) && (
                  <p
                    role="status"
                    className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
                  >
                    Thẻ này vừa có thay đổi trong lúc bạn đang sửa. Nếu trùng chỗ bạn sửa, bạn sẽ
                    được hỏi giữ bản nào khi lưu.
                  </p>
                )}

                {/* Theo doi the: nhan thong bao hoat dong du khong phai thanh vien duoc gan */}
                <div className="mb-4 pl-7">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setCardWatch(card.id, !card.isWatching)
                        .then(reload)
                        .then(onChanged)
                        .catch((err) =>
                          setError(
                            getErrorMessage(
                              err,
                              'Không đổi được trạng thái theo dõi.'
                            )
                          )
                        );
                    }}
                    className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium ${
                      card.isWatching
                        ? 'bg-primary/10 text-primary-ink'
                        : 'bg-slate-200 text-slate-700 hover:bg-slate-300 dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-slate-600'
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    {card.isWatching ? 'Đang theo dõi' : 'Theo dõi'}
                  </button>
                </div>

                {/* Huy hieu: nhan / ngay / do phuc tap / thanh vien */}
                {(card.labels.length > 0 ||
                  card.startDate ||
                  card.dueDate ||
                  !readOnly ||
                  card.storyPoints != null ||
                  card.members.length > 0) && (
                  <div className="mb-4 flex flex-wrap gap-4 pl-7">
                    {card.labels.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-400">Nhãn</p>
                        <div className="flex flex-wrap gap-1">
                          {card.labels.map((l) => (
                            <span
                              key={l.labelId}
                              className="rounded px-2 py-1 text-xs font-medium text-white"
                              style={{ backgroundColor: l.label.color }}
                            >
                              {l.label.name || '   '}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {(card.startDate || card.dueDate) && (
                      <div className="relative">
                        <p className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-400">
                          {card.startDate && card.dueDate
                            ? 'Ngày bắt đầu → hết hạn'
                            : card.startDate
                              ? 'Ngày bắt đầu'
                              : 'Ngày hết hạn'}
                        </p>
                        <span className="inline-flex items-center gap-1.5 rounded bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-700 dark:text-slate-200 ring-1 ring-slate-200">
                          {[card.startDate, card.dueDate]
                            .filter(Boolean)
                            .map((d) => fmt(d as string))
                            .join('  →  ')}
                        </span>
                        {card.dueDate && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setPanel(panel === 'reminders' ? null : 'reminders')
                              }
                              title="Nhắc tôi trước hạn"
                              aria-label="Nhắc tôi trước hạn"
                              className="ml-1 inline-grid h-6 w-6 place-items-center rounded-full text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-600"
                            >
                              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                                <path d="M13.73 21a2 2 0 01-3.46 0" />
                              </svg>
                            </button>
                            {panel === 'reminders' && (
                              <div className="tf-menu-in absolute left-0 top-full z-10 mt-1 w-56 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-xl">
                                <p className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
                                  Nhắc tôi trước hạn
                                </p>
                                <ReminderCheckboxes
                                  cardId={card.id}
                                  reminders={reminders}
                                  onChanged={loadReminders}
                                  onError={setError}
                                />
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    {/* Do phuc tap (story point) - mot trong cac yeu to cua canh bao tre han (RISK_MODULE.md §5) */}
                    {(!readOnly || card.storyPoints != null) && (
                      <div>
                        <label
                          htmlFor="card-story-points"
                          className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400"
                        >
                          Độ phức tạp
                        </label>
                        {readOnly ? (
                          <span className="inline-flex rounded bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-700 dark:text-slate-200 ring-1 ring-slate-200">
                            {card.storyPoints} điểm
                          </span>
                        ) : (
                          <select
                            id="card-story-points"
                            value={card.storyPoints ?? ''}
                            onChange={(e) => {
                              const v = e.target.value;
                              void run(() => updateCard(card.id, { storyPoints: v === '' ? null : Number(v) }));
                            }}
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                          >
                            <option value="">Chưa đặt</option>
                            {STORY_POINT_OPTIONS.map((p) => (
                              <option key={p} value={p}>
                                {p} điểm
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    )}
                    {card.members.length > 0 && (
                      <div>
                        <p className="mb-1 text-xs font-semibold text-slate-600 dark:text-slate-400">Thành viên</p>
                        <div className="flex -space-x-1">
                          {card.members.map((m) => (
                            <Avatar
                              key={m.userId}
                              id={m.userId}
                              name={m.user.name}
                              avatarUrl={m.user.avatarUrl}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Hang nut hanh dong */}
                {!readOnly && (
                  <p className="mb-1.5 pl-7 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Thêm vào thẻ
                  </p>
                )}
                <div
                  className={`relative mb-4 flex flex-wrap gap-2 pl-7 ${
                    readOnly ? 'hidden' : ''
                  }`}
                >
                  {(['labels', 'due', 'members'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => {
                        // Mo bang "Ngay": ghi lai gia tri goc de khoa lac quan khi luu
                        if (p === 'due' && panel !== 'due') {
                          editBase.current.startDate = card.startDate;
                          editBase.current.dueDate = card.dueDate;
                        }
                        setPanel(panel === p ? null : p);
                      }}
                      className={ADD_TO_CARD_BTN}
                    >
                      <AddIcon name={p} />
                      {p === 'labels' ? 'Nhãn' : p === 'due' ? 'Ngày' : 'Thành viên'}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      if (panel === 'checklist') {
                        setPanel(null);
                      } else {
                        setClTitle('Việc cần làm');
                        setClCopyFrom('');
                        setPanel('checklist');
                      }
                    }}
                    className={ADD_TO_CARD_BTN}
                  >
                    <AddIcon name="checklist" />
                    Việc cần làm
                  </button>
                  <button
                    type="button"
                    onClick={() => setPanel(panel === 'cover' ? null : 'cover')}
                    className={ADD_TO_CARD_BTN}
                  >
                    <AddIcon name="cover" />
                    Ảnh bìa
                  </button>
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                    className={`${ADD_TO_CARD_BTN} disabled:opacity-60`}
                  >
                    <AddIcon name="attach" />
                    {uploading ? 'Đang tải lên...' : 'Đính kèm'}
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    hidden
                    onChange={async (e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (!f) return;
                      setUploading(true);
                      try {
                        await addAttachment(card.id, f);
                        await reload();
                        onChanged();
                      } catch (err) {
                        setError(getErrorMessage(err, 'Tải tệp lên thất bại.'));
                      } finally {
                        setUploading(false);
                      }
                    }}
                  />

                  {panel === 'cover' && (
                    <div className="absolute left-7 top-10 z-10 w-64 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-xl">
                      <p className="mb-2 text-xs font-semibold text-slate-600 dark:text-slate-400">Ảnh bìa</p>
                      <div className="grid grid-cols-5 gap-2">
                        {COVER_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => {
                              setPanel(null);
                              void run(() =>
                                updateCard(card.id, {
                                  coverColor: c,
                                  coverImageUrl: null,
                                })
                              );
                            }}
                            aria-label={`Màu bìa ${c}`}
                            aria-pressed={card.coverColor === c && !card.coverImageUrl}
                            className="grid h-8 place-items-center rounded"
                            style={{ backgroundColor: c }}
                          >
                            {card.coverColor === c && !card.coverImageUrl && (
                              <svg viewBox="0 0 24 24" className="h-4 w-4 text-white" fill="none" stroke="currentColor" strokeWidth="3">
                                <path d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </button>
                        ))}
                      </div>
                      {(card.coverColor || card.coverImageUrl) && (
                        <button
                          type="button"
                          onClick={() => {
                            setPanel(null);
                            void run(() =>
                              updateCard(card.id, {
                                coverColor: null,
                                coverImageUrl: null,
                              })
                            );
                          }}
                          className="mt-3 w-full rounded bg-slate-100 dark:bg-slate-700 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-600"
                        >
                          Bỏ ảnh bìa
                        </button>
                      )}
                    </div>
                  )}

                  {panel === 'checklist' && (
                    <div className="absolute left-7 top-10 z-10 w-72 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-xl">
                      <p className="mb-2 text-center text-sm font-semibold">
                        Thêm danh sách công việc
                      </p>
                      <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">
                        Tiêu đề
                      </label>
                      <input
                        autoFocus
                        value={clTitle}
                        maxLength={200}
                        onChange={(e) => setClTitle(e.target.value)}
                        onFocus={(e) => e.target.select()}
                        className="mb-3 w-full rounded-lg border border-slate-300 dark:border-slate-600 px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none"
                      />
                      {card.checklists.length > 0 && (
                        <>
                          <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">
                            Sao chép mục từ …
                          </label>
                          <select
                            value={clCopyFrom}
                            onChange={(e) => setClCopyFrom(e.target.value)}
                            className="mb-3 w-full rounded-lg border border-slate-300 dark:border-slate-600 px-2 py-1.5 text-sm focus:border-primary focus:outline-none"
                          >
                            <option value="">(không có)</option>
                            {card.checklists.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.title}
                              </option>
                            ))}
                          </select>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setPanel(null);
                          void run(() =>
                            addChecklist(
                              card.id,
                              clTitle,
                              clCopyFrom || undefined
                            )
                          );
                        }}
                        className="w-full rounded-lg bg-primary py-1.5 text-sm font-semibold text-white hover:bg-primary-hover"
                      >
                        Thêm
                      </button>
                    </div>
                  )}

                  {panel === 'labels' && (
                    <LabelPanel
                      boardId={card.list.boardId}
                      labels={labels}
                      cardLabelIds={cardLabelIds}
                      onToggle={(labelId, attached) =>
                        void run(() =>
                          attached
                            ? detachCardLabel(card.id, labelId)
                            : attachCardLabel(card.id, labelId)
                        )
                      }
                      onLabelsChanged={reloadLabels}
                    />
                  )}

                  {panel === 'due' && (
                    <div className="absolute left-7 top-10 z-10 w-72 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shadow-xl">
                      <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">
                        Ngày bắt đầu
                      </label>
                      <input
                        ref={startRef}
                        type="datetime-local"
                        defaultValue={toDatetimeLocalValue(card.startDate)}
                        className="mb-3 w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm"
                      />
                      <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-400">
                        Ngày hết hạn
                      </label>
                      <input
                        ref={dueRef}
                        type="datetime-local"
                        defaultValue={toDatetimeLocalValue(card.dueDate)}
                        className="w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm"
                      />
                      <div className="mt-3 flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const s = startRef.current?.value;
                            const v = dueRef.current?.value;
                            setPanel(null);
                            saveDates(s, v);
                          }}
                          className="flex-1 rounded bg-primary py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
                        >
                          Lưu
                        </button>
                        {(card.startDate || card.dueDate) && (
                          <button
                            type="button"
                            onClick={() => {
                              setPanel(null);
                              saveDates('', '');
                            }}
                            className="rounded px-2 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                          >
                            Bỏ
                          </button>
                        )}
                      </div>

                      {card.dueDate && (
                        <div className="mt-3 border-t border-slate-200 dark:border-slate-700 pt-3">
                          <p className="mb-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400">
                            Nhắc tôi trước hạn
                          </p>
                          <ReminderCheckboxes
                            cardId={card.id}
                            reminders={reminders}
                            onChanged={loadReminders}
                            onError={setError}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {panel === 'members' && (
                    <div className="absolute left-7 top-10 z-10 max-h-[70vh] w-[22rem] max-w-[calc(100vw-3rem)] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 shadow-xl">
                      {/* Gợi ý phân công dựa trên lịch sử (ASSIGN_MODULE.md); giao tay vẫn dùng được khi gợi ý lỗi */}
                      <AssignSuggestPanel
                        key={card.id}
                        cardId={card.id}
                        boardMembers={boardMembers}
                        cardMemberIds={cardMemberIds}
                        onAdd={(userId) => run(() => addCardMember(card.id, userId))}
                        onRemove={(userId) => run(() => removeCardMember(card.id, userId))}
                      />
                    </div>
                  )}
                </div>

                {/* Truong tuy chinh */}
                {customFields.length > 0 && (
                  <div className="mb-5 pl-7">
                    <p className="mb-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
                      Trường tùy chỉnh
                    </p>
                    <div className="flex flex-col gap-2">
                      {customFields.map((f) => {
                        const fv = card.fieldValues.find((v) => v.fieldId === f.id);
                        const save = (value: string | number | boolean | null) => {
                          void run(() => setCardFieldValue(card.id, f.id, value));
                        };
                        return (
                          <div key={f.id} className="flex items-center gap-3">
                            <label className="w-32 shrink-0 truncate text-xs font-medium text-slate-600 dark:text-slate-400">
                              {f.name}
                            </label>
                            {readOnly ? (
                              <span className="text-sm text-slate-700 dark:text-slate-200">
                                {f.type === 'CHECKBOX'
                                  ? fv?.boolValue
                                    ? 'Có'
                                    : 'Không'
                                  : f.type === 'DROPDOWN'
                                    ? (f.options.find((o) => o.id === fv?.optionId)?.value ?? '—')
                                    : f.type === 'DATE'
                                      ? (fv?.dateValue ? fmt(fv.dateValue) : '—')
                                      : (fv?.textValue ?? fv?.numberValue ?? '—')}
                              </span>
                            ) : f.type === 'TEXT' ? (
                              <input
                                key={fv?.textValue ?? ''}
                                defaultValue={fv?.textValue ?? ''}
                                onBlur={(e) => {
                                  const v = e.target.value.trim();
                                  if (v !== (fv?.textValue ?? '')) save(v || null);
                                }}
                                className="min-w-0 flex-1 rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm focus:border-primary focus:outline-none"
                              />
                            ) : f.type === 'NUMBER' ? (
                              <input
                                type="number"
                                key={fv?.numberValue ?? ''}
                                defaultValue={fv?.numberValue ?? ''}
                                onBlur={(e) => {
                                  const raw = e.target.value.trim();
                                  save(raw === '' ? null : Number(raw));
                                }}
                                className="min-w-0 flex-1 rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm focus:border-primary focus:outline-none"
                              />
                            ) : f.type === 'DATE' ? (
                              <input
                                type="date"
                                defaultValue={fv?.dateValue ? fv.dateValue.slice(0, 10) : ''}
                                onChange={(e) =>
                                  save(e.target.value ? new Date(e.target.value).toISOString() : null)
                                }
                                className="min-w-0 flex-1 rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm focus:border-primary focus:outline-none"
                              />
                            ) : f.type === 'CHECKBOX' ? (
                              <input
                                type="checkbox"
                                checked={Boolean(fv?.boolValue)}
                                onChange={(e) => save(e.target.checked)}
                              />
                            ) : (
                              <select
                                value={fv?.optionId ?? ''}
                                onChange={(e) => save(e.target.value || null)}
                                className="min-w-0 flex-1 rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm focus:border-primary focus:outline-none"
                              >
                                <option value="">(chưa chọn)</option>
                                {f.options.map((o) => (
                                  <option key={o.id} value={o.id}>
                                    {o.value}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Mo ta */}
                <div className="mb-5 pl-7">
                  <p className="mb-1 text-sm font-semibold text-slate-700 dark:text-slate-200">
                    Mô tả{' '}
                    <span className="font-normal text-xs text-slate-600 dark:text-slate-400">
                      (hỗ trợ Markdown)
                    </span>
                  </p>
                  {readOnly ? (
                    <div className="rounded-lg bg-white dark:bg-slate-800 p-2 ring-1 ring-slate-200">
                      {card.description ? (
                        <MiniMarkdown text={card.description} />
                      ) : (
                        <p className="text-sm text-slate-600 dark:text-slate-400">Không có mô tả.</p>
                      )}
                    </div>
                  ) : editingDesc ? (
                    <div>
                      <textarea
                        autoFocus
                        rows={5}
                        value={descDraft}
                        maxLength={5000}
                        onChange={(e) => setDescDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            // Huy sua mo ta, KHONG dong ca the
                            e.stopPropagation();
                            setEditingDesc(false);
                            setDescDraft(card.description ?? '');
                          }
                        }}
                        placeholder="**đậm**, *nghiêng*, - danh sách, [chữ](liên kết)..."
                        className="w-full rounded-lg border border-slate-300 dark:border-slate-600 p-2 text-sm focus:border-primary focus:outline-none"
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingDesc(false);
                            const next = descDraft.trim() || null;
                            const base = editBase.current.description ?? null;
                            // Khong doi gi so voi luc bat dau sua -> khong luu (tranh
                            // ghi de ban moi cua nguoi khac bang chinh ban cu)
                            if (next === base) {
                              setDescDraft(card.description ?? '');
                              return;
                            }
                            void saveGuarded({ description: next }, { description: base }, () =>
                              setEditingDesc(true)
                            );
                          }}
                          className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover"
                        >
                          Lưu
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingDesc(false);
                            setDescDraft(card.description ?? '');
                          }}
                          className="rounded px-2 py-1.5 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          Huỷ
                        </button>
                      </div>
                    </div>
                  ) : card.description ? (
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={startEditDesc}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') startEditDesc();
                      }}
                      className="cursor-pointer rounded-lg bg-white dark:bg-slate-800 p-2 ring-1 ring-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      <MiniMarkdown text={card.description} />
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={startEditDesc}
                      className="block w-full rounded-lg bg-white dark:bg-slate-800 p-2 text-left text-sm text-slate-600 dark:text-slate-300 ring-1 ring-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                    >
                      Thêm mô tả chi tiết hơn...
                    </button>
                  )}
                </div>

                {/* Tep dinh kem */}
                {card.attachments.length > 0 && (
                  <div className="mb-5 pl-7">
                    <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 12.5l-8.5 8.5a5 5 0 01-7-7l9-9a3.5 3.5 0 015 5l-9 9a2 2 0 01-3-3l8-8" />
                      </svg>
                      Tệp đính kèm
                    </p>
                    <div className="flex flex-col gap-2">
                      {card.attachments.map((att) => {
                        const isImg = att.mime.startsWith('image/');
                        return (
                          <div
                            key={att.id}
                            className="flex items-center gap-3 rounded-lg bg-white dark:bg-slate-800 p-2 ring-1 ring-slate-200"
                          >
                            <a
                              href={assetUrl(att.url)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="grid h-12 w-16 shrink-0 place-items-center overflow-hidden rounded bg-slate-100 dark:bg-slate-700"
                            >
                              {isImg ? (
                                <img
                                  src={assetUrl(att.url)}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <span className="text-[10px] font-bold uppercase text-slate-600 dark:text-slate-400">
                                  {att.name.split('.').pop()?.slice(0, 4) || 'TỆP'}
                                </span>
                              )}
                            </a>
                            <div className="min-w-0 flex-1">
                              <a
                                href={assetUrl(att.url)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200 hover:underline"
                              >
                                {att.name}
                              </a>
                              <p className="text-xs text-slate-600 dark:text-slate-400">
                                {formatBytes(att.size)} · {fmt(att.createdAt)}
                              </p>
                              {!readOnly && (
                                <div className="mt-0.5 flex gap-3 text-xs">
                                  {isImg && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void run(() =>
                                          updateCard(card.id, {
                                            coverImageUrl: att.url,
                                            coverColor: null,
                                          })
                                        )
                                      }
                                      className="text-slate-600 dark:text-slate-400 hover:underline"
                                    >
                                      Làm ảnh bìa
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void run(() => deleteAttachment(att.id))
                                    }
                                    className="text-slate-600 dark:text-slate-400 hover:underline"
                                  >
                                    Xoá
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Checklist */}
                <div className="flex flex-col gap-4 pl-7">
                  {card.checklists.map((cl) => {
                    const done = cl.items.filter((i) => i.isDone).length;
                    const pct = cl.items.length ? Math.round((done / cl.items.length) * 100) : 0;
                    const hiding = Boolean(hideDone[cl.id]);
                    const shownItems = hiding
                      ? cl.items.filter((i) => !i.isDone)
                      : cl.items;
                    const dragDisabled = readOnly || hiding;
                    return (
                      <div key={cl.id}>
                        <div className="mb-1 flex items-center gap-2">
                          <p className="flex-1 text-sm font-semibold text-slate-700 dark:text-slate-200">{cl.title}</p>
                          {done > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setHideDone((h) => ({ ...h, [cl.id]: !h[cl.id] }))
                              }
                              className="rounded px-1.5 py-0.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                            >
                              {hiding
                                ? `Hiện mục đã đánh dấu (${done})`
                                : `Ẩn mục đã đánh dấu (${done})`}
                            </button>
                          )}
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={() => void run(() => deleteChecklist(cl.id))}
                              className="rounded px-1.5 py-0.5 text-xs text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                            >
                              Xoá
                            </button>
                          )}
                        </div>
                        <div className="mb-2 flex items-center gap-2">
                          <span className="text-xs text-slate-600 dark:text-slate-400">{pct}%</span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-600">
                            <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                        <DndContext
                          sensors={itemSensors}
                          collisionDetection={closestCenter}
                          onDragEnd={(e) => void reorderItems(cl.id, e)}
                        >
                          <SortableContext
                            items={shownItems.map((i) => i.id)}
                            strategy={verticalListSortingStrategy}
                          >
                        <div className="flex flex-col gap-1">
                          {shownItems.map((it) => (
                            <SortableItem key={it.id} id={it.id} disabled={dragDisabled}>
                              <input
                                type="checkbox"
                                checked={it.isDone}
                                disabled={readOnly}
                                onChange={() =>
                                  void run(() =>
                                    updateChecklistItem(it.id, { isDone: !it.isDone })
                                  )
                                }
                                className="h-4 w-4 shrink-0"
                              />
                              <span
                                className={`min-w-0 flex-1 text-sm ${
                                  it.isDone ? 'text-slate-600 dark:text-slate-400 line-through' : 'text-slate-700 dark:text-slate-200'
                                }`}
                              >
                                {it.content}
                              </span>

                              {it.assignee && (
                                <Avatar
                                  id={it.assignee.id}
                                  name={it.assignee.name}
                                  avatarUrl={it.assignee.avatarUrl}
                                  className="h-5 w-5 text-[9px]"
                                />
                              )}
                              {it.dueDate && (
                                <span className="inline-flex shrink-0 items-center gap-0.5 rounded bg-slate-100 dark:bg-slate-700 px-1 text-[11px] text-slate-600 dark:text-slate-300">
                                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="9" />
                                    <path d="M12 7v5l3 2" />
                                  </svg>
                                  {new Date(it.dueDate).toLocaleDateString('vi-VN', {
                                    day: '2-digit',
                                    month: '2-digit',
                                  })}
                                </span>
                              )}

                              {!readOnly && (
                                <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
                                  <button
                                    type="button"
                                    title="Chỉ định"
                                    onClick={() =>
                                      setItemPanel(
                                        itemPanel?.id === it.id &&
                                          itemPanel.kind === 'assign'
                                          ? null
                                          : { id: it.id, kind: 'assign' }
                                      )
                                    }
                                    className="rounded p-0.5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                                  >
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                                      <circle cx="9" cy="8" r="3.5" />
                                      <path d="M3.5 20a5.5 5.5 0 0111 0M17 8h5M19.5 5.5v5" />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    title="Ngày hết hạn"
                                    onClick={() =>
                                      setItemPanel(
                                        itemPanel?.id === it.id &&
                                          itemPanel.kind === 'due'
                                          ? null
                                          : { id: it.id, kind: 'due' }
                                      )
                                    }
                                    className="rounded p-0.5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                                  >
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                                      <circle cx="12" cy="12" r="9" />
                                      <path d="M12 7v5l3 2" />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    title="Chuyển thành thẻ"
                                    onClick={() =>
                                      void run(() => convertItemToCard(it.id))
                                    }
                                    className="rounded p-0.5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                                  >
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                                      <rect x="4" y="5" width="16" height="14" rx="2" />
                                      <path d="M9 12h6M12 9v6" />
                                    </svg>
                                  </button>
                                  <button
                                    type="button"
                                    title="Xoá"
                                    onClick={() => void run(() => deleteChecklistItem(it.id))}
                                    className="rounded p-0.5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                                  >
                                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                                      <path d="M6 6l12 12M18 6L6 18" />
                                    </svg>
                                  </button>
                                </div>
                              )}

                              {itemPanel?.id === it.id && itemPanel.kind === 'assign' && (
                                <div className="absolute right-0 top-6 z-20 w-48 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-1 shadow-xl">
                                  <p className="px-2 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                                    Chỉ định
                                  </p>
                                  {boardMembers.map((m) => (
                                    <button
                                      key={m.userId}
                                      type="button"
                                      onClick={() => {
                                        setItemPanel(null);
                                        void run(() =>
                                          updateChecklistItem(it.id, {
                                            assigneeId:
                                              it.assigneeId === m.userId
                                                ? null
                                                : m.userId,
                                          })
                                        );
                                      }}
                                      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700"
                                    >
                                      <Avatar
                                        id={m.userId}
                                        name={m.user.name}
                                        avatarUrl={m.user.avatarUrl}
                                        className="h-5 w-5 text-[9px]"
                                      />
                                      <span className="flex-1 truncate">{m.user.name}</span>
                                      {it.assigneeId === m.userId && (
                                        <svg viewBox="0 0 24 24" className="h-4 w-4 text-primary-ink" fill="none" stroke="currentColor" strokeWidth="2">
                                          <path d="M5 13l4 4L19 7" />
                                        </svg>
                                      )}
                                    </button>
                                  ))}
                                </div>
                              )}
                              {itemPanel?.id === it.id && itemPanel.kind === 'due' && (
                                <div className="absolute right-0 top-6 z-20 w-56 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2 shadow-xl">
                                  <p className="mb-1 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                                    Ngày hết hạn
                                  </p>
                                  <input
                                    ref={itemDueRef}
                                    type="datetime-local"
                                    defaultValue={toDatetimeLocalValue(it.dueDate)}
                                    className="w-full rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-sm"
                                  />
                                  <div className="mt-2 flex gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const v = itemDueRef.current?.value;
                                        setItemPanel(null);
                                        void run(() =>
                                          updateChecklistItem(it.id, {
                                            dueDate: v
                                              ? new Date(v).toISOString()
                                              : null,
                                          })
                                        );
                                      }}
                                      className="flex-1 rounded bg-primary py-1 text-sm font-medium text-white hover:bg-primary-hover"
                                    >
                                      Lưu
                                    </button>
                                    {it.dueDate && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setItemPanel(null);
                                          void run(() =>
                                            updateChecklistItem(it.id, { dueDate: null })
                                          );
                                        }}
                                        className="rounded px-2 py-1 text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                                      >
                                        Bỏ
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </SortableItem>
                          ))}
                        </div>
                          </SortableContext>
                        </DndContext>
                        {!readOnly && (
                          <AddItemInput onAdd={(c) => run(() => addChecklistItem(cl.id, c))} />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ===== Cot phai: nhan xet + hoat dong ===== */}
              <div className="w-full shrink-0 md:w-72">
                <div className="mb-2 flex items-center gap-2">
                  <p className="flex flex-1 items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
                    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
                    </svg>
                    Nhận xét và hoạt động
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowDetails((v) => !v)}
                    className="shrink-0 rounded border border-slate-300 dark:border-slate-600 px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                  >
                    {showDetails ? 'Ẩn chi tiết' : 'Hiện chi tiết'}
                  </button>
                </div>

                {!readOnly && (
                  <div className="mb-3">
                    <CommentComposer
                      boardMembers={boardMembers}
                      placeholder="Viết bình luận... (gõ @ để nhắc tên)"
                      onSubmit={(t) => run(() => addComment(card.id, t))}
                    />
                  </div>
                )}

                {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

                <ul className="flex flex-col gap-3">
                  {feed.map((it) =>
                    it.kind === 'thread' ? (
                      <CommentThread
                        key={`c-${it.t.root.id}`}
                        thread={it.t}
                        currentUserId={currentUserId}
                        readOnly={readOnly}
                        boardMembers={boardMembers}
                        onReply={(parentId, t) => run(() => addComment(card.id, t, parentId))}
                        onDelete={(id) => void run(() => deleteComment(id))}
                      />
                    ) : (
                      <li key={`a-${it.a.id}`} className="flex gap-2">
                        <Avatar
                          id={it.a.user.id}
                          name={it.a.user.name}
                          avatarUrl={it.a.user.avatarUrl}
                          className="h-6 w-6 text-[10px]"
                        />
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          <span className="font-semibold text-slate-700 dark:text-slate-200">{it.a.user.name}</span>{' '}
                          {activityText(it.a)}
                          <br />
                          <span className="text-slate-600 dark:text-slate-400">{fmt(it.a.createdAt)}</span>
                        </p>
                      </li>
                    )
                  )}
                </ul>
              </div>
            </div>
          </>
        )}
      </div>
      {conflict && (
        <CardConflictDialog
          rows={conflictRows}
          busy={conflictBusy}
          onOverwrite={() => void overwriteConflict()}
          onUseTheirs={() => void acceptTheirsConflict()}
          onKeepEditing={
            conflict.patch.title !== undefined || conflict.patch.description !== undefined
              ? () => void keepEditingConflict()
              : undefined
          }
        />
      )}
    </div>,
    document.body
  );
}
