import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type { CardHighlight } from '../../components/board/CardHighlightContext';
import { diffCards } from '../../lib/cardDiff';
import type { BoardList } from '../../types/list';

// Thay đổi xuất hiện trong khoảng này sau thao tác của CHÍNH mình thì coi là do mình gây ra.
// (Realtime chỉ mang boardId nên không biết ai đổi; sự kiện của mình cũng quay về qua socket.)
const LOCAL_WINDOW_MS = 1500;
const CLEAR_AFTER_MS = 1600;
// Một lần tải mà quá nhiều thẻ đổi (áp dụng kế hoạch AI, đổi trạng thái cột...) thì không nháy cả bảng.
const MAX_CHANGES = 12;

interface Options {
  lists: BoardList[];
  listsLoading: boolean;
  draggingRef: MutableRefObject<boolean>;
}

/**
 * Cho biết thẻ nào vừa thay đổi để hiện hiệu ứng tạm thời:
 *  - enter: thẻ vừa xuất hiện (thẻ mới hoặc vừa chuyển sang cột này) -> mờ dần vào
 *  - flash: viền nổi bật, CHỈ khi thay đổi đến từ người khác
 * So sánh danh sách cũ và mới ở phía trình duyệt, không cần thêm dữ liệu từ server.
 * Lần tải đầu của mỗi bảng chỉ dùng làm mốc, không hiệu ứng.
 */
export function useCardHighlights({
  lists,
  listsLoading,
  draggingRef,
}: Options): ReadonlyMap<string, CardHighlight> {
  const [highlights, setHighlights] = useState<ReadonlyMap<string, CardHighlight>>(new Map());
  const baselineRef = useRef<BoardList[] | null>(null);
  const lastLocalAtRef = useRef(0);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Ghi nhận mọi thao tác của chính mình (chuột, bàn phím)
  useEffect(() => {
    const mark = () => {
      lastLocalAtRef.current = Date.now();
    };
    const events = ['pointerdown', 'pointerup', 'keydown'] as const;
    for (const e of events) window.addEventListener(e, mark, true);
    return () => {
      for (const e of events) window.removeEventListener(e, mark, true);
    };
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // useLayoutEffect: thẻ vừa gắn vào trang đã có lớp hiệu ứng trước khi trình duyệt vẽ -> không nhấp nháy
  useLayoutEffect(() => {
    if (listsLoading) {
      baselineRef.current = null; // đổi bảng / tải lại từ đầu -> lần tải sau chỉ là mốc mới
      return;
    }
    const baseline = baselineRef.current;
    baselineRef.current = lists;
    if (!baseline) return;
    // Đang kéo: thẻ đổi cột liên tục theo tay mình, không phải thay đổi để báo
    if (draggingRef.current) return;

    const changes = diffCards(baseline, lists);
    if (changes.size === 0 || changes.size > MAX_CHANGES) return;

    const local = Date.now() - lastLocalAtRef.current < LOCAL_WINDOW_MS;
    const next = new Map<string, CardHighlight>();
    for (const [id, kind] of changes) {
      const h: CardHighlight = { enter: kind !== 'changed', flash: !local };
      if (h.enter || h.flash) next.set(id, h);
    }
    if (next.size === 0) return;

    setHighlights((prev) => new Map([...prev, ...next]));
    for (const id of next.keys()) {
      clearTimeout(timersRef.current.get(id));
      timersRef.current.set(
        id,
        setTimeout(() => {
          timersRef.current.delete(id);
          setHighlights((prev) => {
            const copy = new Map(prev);
            copy.delete(id);
            return copy;
          });
        }, CLEAR_AFTER_MS)
      );
    }
  }, [lists, listsLoading, draggingRef]);

  return highlights;
}
