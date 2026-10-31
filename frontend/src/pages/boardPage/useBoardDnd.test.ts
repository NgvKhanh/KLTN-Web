import { act, renderHook } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type {
  CollisionDetection,
  DragEndEvent,
  DragOverEvent,
  DragStartEvent,
} from '@dnd-kit/core';
import type { BoardList } from '../../types/list';
import type { Card } from '../../types/card';

const moveCardMock = vi.fn();
vi.mock('../../lib/api/card', () => ({
  moveCard: (...a: unknown[]) => (moveCardMock as (...a: unknown[]) => Promise<unknown>)(...a),
}));
vi.mock('../../lib/api/list', () => ({
  reorderList: vi.fn(),
}));

import { createCollisionDetection, useBoardDnd } from './useBoardDnd';

function card(id: string, listId: string): Card {
  return {
    id,
    listId,
    title: id,
    description: null,
    status: 'TODO',
    isDone: false,
    position: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function cardDrag(id: string): DragStartEvent {
  return { active: { id, data: { current: { type: 'card' } } } } as unknown as DragStartEvent;
}
function overOnList(activeId: string, listId: string): DragOverEvent {
  return {
    active: { id: activeId, data: { current: { type: 'card' } } },
    over: { id: `list-${listId}`, data: { current: { type: 'list' } } },
  } as unknown as DragOverEvent;
}
function endOnList(activeId: string, listId: string): DragEndEvent {
  return {
    active: { id: activeId, data: { current: { type: 'card' } } },
    over: { id: `list-${listId}`, data: { current: { type: 'list' } } },
  } as unknown as DragEndEvent;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function useHarness(initial: BoardList[]) {
  const [lists, setLists] = useState(initial);
  const [listsError, setListsError] = useState<string | null>(null);
  const draggingRef = useRef(false);
  const pendingReloadRef = useRef(false);
  const reloadLists = vi.fn();
  const dnd = useBoardDnd({
    lists,
    setLists,
    reloadLists,
    setListsError,
    draggingRef,
    pendingReloadRef,
  });
  return { lists, listsError, reloadLists, ...dnd };
}

// CODE_REVIEW.md #10: listsSnapshotRef la MOT ref dung chung cho moi luot keo the.
// Keo A sang L2 (request luu con dang cho) roi bat dau keo B sang L2; khi request A
// xong (thanh cong) va sau do B bi huy, snapshot cua B phai duoc khoi phuc dung -
// KHONG duoc de request A (da xong truoc) xoa mat snapshot cua B.
describe('useBoardDnd: snapshot keo-tha khong bi luot keo MOI hon lam mat (#10)', () => {
  it('keo A sang L2 (dang cho luu) -> bat dau keo B sang L2 -> A luu xong -> huy B: B tro ve L1, A giu nguyen o L2', async () => {
    moveCardMock.mockReset();
    const { promise: moveA, resolve: resolveMoveA } = deferred<Card>();
    moveCardMock.mockReturnValueOnce(moveA);

    const initial: BoardList[] = [
      { id: 'L1', boardId: 'b1', name: 'L1', position: 0, status: null, createdAt: '', updatedAt: '', cards: [card('A', 'L1'), card('B', 'L1')] },
      { id: 'L2', boardId: 'b1', name: 'L2', position: 1, status: null, createdAt: '', updatedAt: '', cards: [] },
    ];
    const { result } = renderHook(() => useHarness(initial));

    // Keo A sang L2 (lay snapshot ban dau, the he 1)
    act(() => result.current.handleDragStart(cardDrag('A')));
    act(() => result.current.handleDragOver(overOnList('A', 'L2')));
    expect(result.current.lists.find((l) => l.id === 'L1')!.cards.map((c) => c.id)).toEqual(['B']);
    expect(result.current.lists.find((l) => l.id === 'L2')!.cards.map((c) => c.id)).toEqual(['A']);

    let endPromise!: Promise<void>;
    act(() => {
      endPromise = result.current.handleDragEnd(endOnList('A', 'L2'));
    });

    // Trong luc request cua A CON DANG CHO: bat dau keo B sang L2 (the he 2,
    // ghi de listsSnapshotRef).
    act(() => result.current.handleDragStart(cardDrag('B')));
    act(() => result.current.handleDragOver(overOnList('B', 'L2')));
    expect(result.current.lists.find((l) => l.id === 'L1')!.cards).toHaveLength(0);
    expect(result.current.lists.find((l) => l.id === 'L2')!.cards.map((c) => c.id)).toEqual(['A', 'B']);

    // Request cua A xong (thanh cong)
    await act(async () => {
      resolveMoveA(card('A', 'L2'));
      await endPromise;
    });

    // Nguoi dung HUY luot keo B (vd tha ra ngoai / nhan Esc)
    act(() => result.current.handleDragCancel());

    const l1 = result.current.lists.find((l) => l.id === 'L1')!.cards.map((c) => c.id);
    const l2 = result.current.lists.find((l) => l.id === 'L2')!.cards.map((c) => c.id);
    // B phai tro ve L1 (luot keo cua no bi huy, chua bao gio luu); A phai o lai L2
    // (da luu thanh cong that su o server).
    expect(l1).toEqual(['B']);
    expect(l2).toEqual(['A']);
  });
});

// Trang thai theo cot: trong luc keo, the doi trang thai TAM theo cot dang di qua
// (giong ket qua backend se tra ve); ve lai cot cu / vao cot tu do thi giu trang thai ban dau.
describe('useBoardDnd: trang thai tam cua the khi keo qua cac cot', () => {
  it('keo qua cot DONE -> tam thanh DONE; di tiep sang cot tu do / ve cot cu -> lay lai trang thai ban dau', () => {
    const blocked: Card = { ...card('A', 'L1'), status: 'BLOCKED' };
    const initial: BoardList[] = [
      { id: 'L1', boardId: 'b1', name: 'L1', position: 0, status: 'IN_PROGRESS', createdAt: '', updatedAt: '', cards: [blocked] },
      { id: 'L2', boardId: 'b1', name: 'L2', position: 1, status: 'DONE', createdAt: '', updatedAt: '', cards: [] },
      { id: 'L3', boardId: 'b1', name: 'L3', position: 2, status: null, createdAt: '', updatedAt: '', cards: [] },
    ];
    const { result } = renderHook(() => useHarness(initial));
    const cardIn = (listId: string) => result.current.lists.find((l) => l.id === listId)!.cards[0]!;

    act(() => result.current.handleDragStart(cardDrag('A')));
    act(() => result.current.handleDragOver(overOnList('A', 'L2')));
    expect(cardIn('L2')).toMatchObject({ status: 'DONE', isDone: true });

    act(() => result.current.handleDragOver(overOnList('A', 'L3')));
    expect(cardIn('L3')).toMatchObject({ status: 'BLOCKED', isDone: false });

    act(() => result.current.handleDragOver(overOnList('A', 'L1')));
    // Ve lai cot cu: giu trang thai da doi tay (BLOCKED), KHONG lay IN_PROGRESS cua cot
    expect(cardIn('L1')).toMatchObject({ status: 'BLOCKED', isDone: false });
  });
});

// Keo the qua lai giua cac cot lam onDragOver doi state lien tuc -> "Maximum update depth exceeded".
describe('useBoardDnd: khong lap vo han khi keo the qua lai giua cac cot', () => {
  function twoLists(): BoardList[] {
    return [
      { id: 'L1', boardId: 'b1', name: 'L1', position: 0, status: null, createdAt: '', updatedAt: '', cards: [card('A', 'L1'), card('B', 'L1')] },
      { id: 'L2', boardId: 'b1', name: 'L2', position: 1, status: null, createdAt: '', updatedAt: '', cards: [card('C', 'L2')] },
    ];
  }
  const idsOf = (lists: BoardList[], listId: string) =>
    lists.find((l) => l.id === listId)!.cards.map((c) => c.id);

  it('vua chuyen A: L1 -> L2 ma "over" lap tuc dao lai ve L1 thi bo qua; qua nhip tay nguoi moi cho chuyen nguoc', () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    const { result } = renderHook(() => useHarness(twoLists()));

    act(() => result.current.handleDragStart(cardDrag('A')));
    act(() => result.current.handleDragOver(overOnList('A', 'L2')));
    expect(idsOf(result.current.lists, 'L2')).toEqual(['C', 'A']);

    // Cung mot nhip (10 ms sau): dich den dao lai ve cot cu -> KHONG chuyen nguoc
    now.mockReturnValue(1_010);
    act(() => result.current.handleDragOver(overOnList('A', 'L1')));
    expect(idsOf(result.current.lists, 'L1')).toEqual(['B']);
    expect(idsOf(result.current.lists, 'L2')).toEqual(['C', 'A']);

    // Nguoi dung that su keo nguoc lai (300 ms sau) -> duoc chuyen
    now.mockReturnValue(1_300);
    act(() => result.current.handleDragOver(overOnList('A', 'L1')));
    expect(idsOf(result.current.lists, 'L1')).toEqual(['B', 'A']);
    expect(idsOf(result.current.lists, 'L2')).toEqual(['C']);
    now.mockRestore();
  });
});

describe('createCollisionDetection: keo theo vi tri con tro', () => {
  type Args = Parameters<CollisionDetection>[0];
  const rect = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });
  const droppable = (id: string, r: ReturnType<typeof rect>) => ({
    id,
    key: id,
    data: { current: {} },
    disabled: false,
    node: { current: null },
    rect: { current: r },
  });
  function build(opts: {
    type: 'card' | 'list';
    activeId: string;
    pointer: { x: number; y: number } | null;
    dragged: ReturnType<typeof rect>;
    droppables: ReturnType<typeof droppable>[];
  }): Args {
    return {
      active: { id: opts.activeId, data: { current: { type: opts.type } } },
      collisionRect: opts.dragged,
      droppableRects: new Map(opts.droppables.map((d) => [d.id, d.rect.current])),
      droppableContainers: opts.droppables,
      pointerCoordinates: opts.pointer,
    } as unknown as Args;
  }

  const lists: BoardList[] = [
    { id: 'L1', boardId: 'b1', name: 'L1', position: 0, status: null, createdAt: '', updatedAt: '', cards: [card('A', 'L1')] },
    { id: 'L2', boardId: 'b1', name: 'L2', position: 1, status: null, createdAt: '', updatedAt: '', cards: [card('C', 'L2'), card('D', 'L2')] },
    { id: 'L3', boardId: 'b1', name: 'L3', position: 2, status: null, createdAt: '', updatedAt: '', cards: [] },
  ];
  // L1: x 0-100 | L2: x 110-210 | L3: x 220-320 ; moi cot cao 400
  const scene = () => [
    droppable('list-L1', rect(0, 0, 100, 400)),
    droppable('list-L2', rect(110, 0, 100, 400)),
    droppable('list-L3', rect(220, 0, 100, 400)),
    droppable('A', rect(5, 40, 90, 40)),
    droppable('C', rect(115, 40, 90, 40)),
    droppable('D', rect(115, 90, 90, 40)),
  ];
  const fresh = () => ({ lastOverId: null as string | null, recentlyMovedToNewList: false });

  it('con tro tren the nao thi "over" la the do, du hinh chu nhat cua the dang keo gan cot khac hon', () => {
    const detect = createCollisionDetection(() => lists, fresh());
    const hits = detect(
      build({
        type: 'card',
        activeId: 'A',
        // Con tro nam tren the D (cot L2) nhung hinh chu nhat cua the dang keo lech han sang cot L1
        pointer: { x: 160, y: 110 },
        dragged: rect(10, 90, 90, 40),
        droppables: scene(),
      })
    );
    expect(hits[0]?.id).toBe('D');
  });

  it('con tro tren khoang trong cua cot co the -> the gan tam nhat trong cot; cot rong -> chinh cot do', () => {
    const detect = createCollisionDetection(() => lists, fresh());
    const inColumn = detect(
      build({
        type: 'card',
        activeId: 'A',
        pointer: { x: 160, y: 300 }, // duoi cac the cua L2
        dragged: rect(115, 280, 90, 40),
        droppables: scene(),
      })
    );
    expect(inColumn[0]?.id).toBe('D');

    const emptyColumn = detect(
      build({
        type: 'card',
        activeId: 'A',
        pointer: { x: 270, y: 200 },
        dragged: rect(225, 180, 90, 40),
        droppables: scene(),
      })
    );
    expect(emptyColumn[0]?.id).toBe('list-L3');
  });

  it('con tro roi khoi moi cot: giu dich den gan nhat; vua doi cot thi dung chinh the dang keo', () => {
    const state = fresh();
    const detect = createCollisionDetection(() => lists, state);
    const droppables = scene();
    // Co "over" hop le truoc
    detect(build({ type: 'card', activeId: 'A', pointer: { x: 160, y: 110 }, dragged: rect(115, 90, 90, 40), droppables }));
    // Ra ngoai tat ca cac cot (khong cham gi) -> van tra ve dich den cu, khong nhay sang cot khac
    const outside = detect(build({ type: 'card', activeId: 'A', pointer: { x: 500, y: 700 }, dragged: rect(480, 680, 90, 40), droppables }));
    expect(outside[0]?.id).toBe('D');
    // Vua chuyen cot trong khung hinh nay -> coi chinh the dang keo la dich den (khong chuyen tiep)
    state.recentlyMovedToNewList = true;
    const justMoved = detect(build({ type: 'card', activeId: 'A', pointer: { x: 500, y: 700 }, dragged: rect(480, 680, 90, 40), droppables }));
    expect(justMoved[0]?.id).toBe('A');
  });

  it('keo COT: chi xet cac cot, bo qua the ben trong', () => {
    const detect = createCollisionDetection(() => lists, fresh());
    const hits = detect(
      build({
        type: 'list',
        activeId: 'list-L1',
        pointer: { x: 160, y: 110 },
        dragged: rect(115, 10, 100, 400),
        droppables: scene(),
      })
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => String(h.id).startsWith('list-'))).toBe(true);
    expect(hits[0]?.id).toBe('list-L2');
  });
});
