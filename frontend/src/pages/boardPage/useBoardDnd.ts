import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import {
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  closestCorners,
  getFirstCollision,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { moveCard } from '../../lib/api/card';
import { reorderList } from '../../lib/api/list';
import { getErrorMessage } from '../../lib/errorMessage';
import type { Card } from '../../types/card';
import type { BoardList } from '../../types/list';

export function listIdFromDnd(id: string): string | null {
  return id.startsWith('list-') ? id.slice('list-'.length) : null;
}

interface CollisionState {
  // Dich den cuoi cung da tim thay (dung khi con tro tam thoi khong nam tren gi ca)
  lastOverId: UniqueIdentifier | null;
  // Vua doi cot trong khung hinh nay: bo cuc con lech 1 nhip, giu dich den cu thay vi nhay lung tung
  recentlyMovedToNewList: boolean;
}

/**
 * Phat hien va cham khi keo (cong thuc "nhieu container" cua dnd-kit):
 *  - keo 1 COT: chi xet cac cot khac (bo qua the ben trong) -> "over" luon la 1 cot;
 *  - keo THE: xet theo VI TRI CON TRO truoc, khong theo cac goc cua the dang keo. Truoc day dung
 *    closestCorners cho moi thu: ngay sau khi the doi cot, hinh chu nhat cua the lai gan cot cu hon ->
 *    "over" dao lai -> handleDragOver chuyen nguoc -> lap vo han ("Maximum update depth exceeded").
 */
export function createCollisionDetection(
  getLists: () => BoardList[],
  state: CollisionState
): CollisionDetection {
  return (args) => {
    if (args.active.data.current?.type === 'list') {
      return closestCorners({
        ...args,
        droppableContainers: args.droppableContainers.filter((c) =>
          String(c.id).startsWith('list-')
        ),
      });
    }

    const pointerHits = pointerWithin(args);
    const hits = pointerHits.length > 0 ? pointerHits : rectIntersection(args);
    let overId = getFirstCollision(hits, 'id');

    if (overId != null) {
      // Trung 1 cot dang co the: chon the gan tam nhat trong cot do (cot rong thi giu nguyen cot)
      const listId = listIdFromDnd(String(overId));
      if (listId) {
        const cardIds = new Set(
          getLists()
            .find((l) => l.id === listId)
            ?.cards.map((c) => c.id)
        );
        if (cardIds.size > 0) {
          const nearest = closestCenter({
            ...args,
            droppableContainers: args.droppableContainers.filter(
              (c) => c.id !== overId && cardIds.has(String(c.id))
            ),
          });
          overId = getFirstCollision(nearest, 'id') ?? overId;
        }
      }
      state.lastOverId = overId;
      return [{ id: overId }];
    }

    // Con tro dang o khe giua cac cot, hoac the vua doi cot lam bo cuc lech: giu dich den gan nhat
    if (state.recentlyMovedToNewList) state.lastOverId = args.active.id;
    return state.lastOverId != null ? [{ id: state.lastOverId }] : [];
  };
}

interface Options {
  lists: BoardList[];
  setLists: Dispatch<SetStateAction<BoardList[]>>;
  reloadLists: () => void;
  setListsError: Dispatch<SetStateAction<string | null>>;
  draggingRef: MutableRefObject<boolean>;
  pendingReloadRef: MutableRefObject<boolean>;
}

/**
 * Toan bo logic keo-tha cua trang bang (cot + the), tach khoi BoardPage.
 * Giu nguyen hanh vi: cap nhat lac quan trong luc keo, chup anh de khoi phuc
 * khi huy / tha hut, luu that bai thi tra ve trang thai truoc do roi dong bo lai.
 */
export function useBoardDnd({
  lists,
  setLists,
  reloadLists,
  setListsError,
  draggingRef,
  pendingReloadRef,
}: Options) {
  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const [activeList, setActiveList] = useState<BoardList | null>(null);
  // Anh chup danh sach truoc khi keo the: handleDragOver da doi state giua cac
  // danh sach; neu huy keo / tha ra ngoai thi khoi phuc lai anh chup nay.
  const listsSnapshotRef = useRef<BoardList[] | null>(null);
  // CODE_REVIEW.md #10: danh so THE HE cua lan keo the GAN NHAT. listsSnapshotRef
  // la MOT ref dung chung nen luot keo A dang cho luu (await moveCard) co the bi
  // luot keo B (bat dau trong luc do) ghi de mat snapshot; khi A xong lai xoa/khoi
  // phuc nham snapshot cua B. Chi thao tac len listsSnapshotRef sau await neu
  // dragGenerationRef van con dung THE HE da ghi nhan luc bat dau luot keo do.
  const dragGenerationRef = useRef(0);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Phat hien va cham: doc danh sach MOI NHAT qua ref nen ham nay giu nguyen giua cac lan render
  const listsRef = useRef(lists);
  listsRef.current = lists;
  const collisionStateRef = useRef<CollisionState>({
    lastOverId: null,
    recentlyMovedToNewList: false,
  });
  const collisionDetection = useMemo(
    () => createCollisionDetection(() => listsRef.current, collisionStateRef.current),
    []
  );
  // Sau khi the doi cot, den khung hinh ke tiep bo cuc da on dinh -> thoi giu dich den cu
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      collisionStateRef.current.recentlyMovedToNewList = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [lists]);
  // Lan chuyen cot gan nhat: chan viec chuyen NGUOC ngay lap tuc (xem handleDragOver)
  const lastMoveRef = useRef<{
    cardId: string;
    from: string;
    to: string;
    at: number;
  } | null>(null);
  const resetCollisionState = () => {
    collisionStateRef.current.lastOverId = null;
    collisionStateRef.current.recentlyMovedToNewList = false;
    lastMoveRef.current = null;
  };

  const findListIdByCard = (cardId: string): string | undefined =>
    lists.find((l) => l.cards.some((c) => c.id === cardId))?.id;

  // Trang thai hien tam cua the dang keo khi no dang nam o cot `toList` - khop
  // quy tac o backend (moveCard): sang cot KHAC co trang thai -> doi theo cot;
  // ve lai cot ban dau hoac vao cot tu do -> giu trang thai ban dau (lay tu anh
  // chup truoc khi keo, vi the co the vua di ngang qua cot khac).
  const statusWhileOver = (card: Card, toList: BoardList) => {
    const original =
      listsSnapshotRef.current
        ?.flatMap((l) => l.cards)
        .find((c) => c.id === card.id) ?? card;
    if (toList.id === original.listId || !toList.status) {
      return { status: original.status, isDone: original.isDone };
    }
    return { status: toList.status, isDone: toList.status === 'DONE' };
  };

  const endDragCursor = () => {
    document.body.style.cursor = '';
  };

  const restoreDragSnapshot = () => {
    if (listsSnapshotRef.current) {
      setLists(listsSnapshotRef.current);
    }
    listsSnapshotRef.current = null;
  };

  const afterDragSettled = () => {
    draggingRef.current = false;
    if (pendingReloadRef.current) {
      pendingReloadRef.current = false;
      reloadLists();
    }
  };

  function handleDragStart(event: DragStartEvent) {
    const { active } = event;
    const type = active.data.current?.type;
    draggingRef.current = true;
    resetCollisionState();
    document.body.style.cursor = 'grabbing';
    if (type === 'list') {
      const id = listIdFromDnd(active.id as string);
      setActiveList(lists.find((l) => l.id === id) ?? null);
    } else if (type === 'card') {
      const listId = findListIdByCard(active.id as string);
      const card = lists
        .find((l) => l.id === listId)
        ?.cards.find((c) => c.id === active.id);
      setActiveCard(card ?? null);
      // Giu nguyen trang thai truoc khi keo de con khoi phuc neu huy / tha hut
      dragGenerationRef.current += 1;
      listsSnapshotRef.current = lists;
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || active.data.current?.type !== 'card') return;

    const activeId = active.id as string;
    const overId = over.id as string;
    const fromListId = findListIdByCard(activeId);
    const toListId =
      over.data.current?.type === 'card'
        ? findListIdByCard(overId)
        : (listIdFromDnd(overId) ?? undefined);

    if (!fromListId || !toListId || fromListId === toListId) return;

    // Chong "bong ban": vua chuyen A -> B ma ngay lap tuc lai doi B -> A (nhanh hon tay nguoi nhieu) la do
    // dich den dao qua dao lai sau moi lan ve lai, khong phai nguoi dung. Bo qua de vong lap tu tat.
    const now = Date.now();
    const last = lastMoveRef.current;
    if (
      last &&
      last.cardId === activeId &&
      last.from === toListId &&
      last.to === fromListId &&
      now - last.at < 80
    ) {
      return;
    }
    lastMoveRef.current = { cardId: activeId, from: fromListId, to: toListId, at: now };
    collisionStateRef.current.recentlyMovedToNewList = true;

    setLists((prev) => {
      const fromList = prev.find((l) => l.id === fromListId);
      const toList = prev.find((l) => l.id === toListId);
      if (!fromList || !toList) return prev;
      const moving = fromList.cards.find((c) => c.id === activeId);
      if (!moving) return prev;

      const overIndex =
        over.data.current?.type === 'card'
          ? toList.cards.findIndex((c) => c.id === overId)
          : toList.cards.length;
      const insertAt = overIndex >= 0 ? overIndex : toList.cards.length;

      return prev.map((l) => {
        if (l.id === fromListId) {
          return { ...l, cards: l.cards.filter((c) => c.id !== activeId) };
        }
        if (l.id === toListId) {
          const next = [...l.cards];
          next.splice(insertAt, 0, {
            ...moving,
            listId: toListId,
            ...statusWhileOver(moving, toList),
          });
          return { ...l, cards: next };
        }
        return l;
      });
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const type = active.data.current?.type;
    setActiveCard(null);
    setActiveList(null);
    resetCollisionState();
    endDragCursor();
    afterDragSettled();
    // Tha ra ngoai (khong co diem tha) -> tra state ve nhu truoc khi keo
    if (!over) {
      restoreDragSnapshot();
      return;
    }

    // ---- Sap xep lai cot ----
    if (type === 'list') {
      const overListId =
        listIdFromDnd(over.id as string) ??
        (over.data.current?.type === 'card'
          ? (over.data.current.listId as string)
          : null);
      const oldIndex = lists.findIndex((l) => `list-${l.id}` === active.id);
      const newIndex = lists.findIndex((l) => l.id === overListId);
      if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;
      const reordered = arrayMove(lists, oldIndex, newIndex);
      setLists(reordered);
      try {
        await reorderList(reordered[newIndex]!.id, newIndex);
      } catch (err) {
        setListsError(getErrorMessage(err, 'Không lưu được thứ tự danh sách.'));
        reloadLists();
      }
      return;
    }

    // ---- Keo tha the ----
    if (type === 'card') {
      const myDragGeneration = dragGenerationRef.current;
      const activeId = active.id as string;
      const overId = over.id as string;
      const toListId =
        over.data.current?.type === 'card'
          ? findListIdByCard(overId)
          : (listIdFromDnd(overId) ?? undefined);
      if (!toListId) {
        restoreDragSnapshot();
        return;
      }

      const toList = lists.find((l) => l.id === toListId);
      if (!toList) {
        restoreDragSnapshot();
        return;
      }

      const oldIndex = toList.cards.findIndex((c) => c.id === activeId);
      const overIndex =
        over.data.current?.type === 'card'
          ? toList.cards.findIndex((c) => c.id === overId)
          : toList.cards.length - 1;
      const newIndex = overIndex >= 0 ? overIndex : toList.cards.length - 1;

      let finalIndex = oldIndex;
      if (oldIndex !== -1 && oldIndex !== newIndex) {
        const reorderedCards = arrayMove(toList.cards, oldIndex, newIndex);
        finalIndex = reorderedCards.findIndex((c) => c.id === activeId);
        setLists((prev) =>
          prev.map((l) =>
            l.id === toListId ? { ...l, cards: reorderedCards } : l
          )
        );
      } else if (oldIndex === -1) {
        finalIndex = toList.cards.length;
      }

      try {
        await moveCard(activeId, { listId: toListId, position: finalIndex });
        // Chi xoa snapshot neu CHUA co luot keo nao khac bat dau trong luc cho -
        // neu co, listsSnapshotRef gio la cua luot keo MOI HON, khong duoc dung vao.
        if (dragGenerationRef.current === myDragGeneration) {
          listsSnapshotRef.current = null; // da luu thanh cong
        }
      } catch (err) {
        setListsError(getErrorMessage(err, 'Không di chuyển được thẻ.'));
        if (dragGenerationRef.current === myDragGeneration) {
          // Tra ngay ve trang thai truoc khi keo, sau do dong bo lai voi server
          restoreDragSnapshot();
        }
        // Luon dong bo lai server du co con la the he nay hay khong.
        reloadLists();
      }
    }
  }

  function handleDragCancel() {
    setActiveCard(null);
    setActiveList(null);
    resetCollisionState();
    endDragCursor();
    afterDragSettled();
    restoreDragSnapshot();
  }

  return {
    sensors,
    collisionDetection,
    activeCard,
    activeList,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
