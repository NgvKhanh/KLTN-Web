import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchBoard, fetchBoardMembers } from '../../lib/api/board';
import { fetchBoardLists } from '../../lib/api/list';
import { logError } from '../../lib/logError';
import { socket } from '../../lib/socket';
import type { Board, BoardMember } from '../../types/board';
import type { BoardList } from '../../types/list';

interface Options {
  boardId: string | undefined;
  patchBoard: (board: Board) => void;
  setLists: Dispatch<SetStateAction<BoardList[]>>;
  setMembers: Dispatch<SetStateAction<BoardMember[]>>;
  setFetchedBoard: Dispatch<SetStateAction<Board | null>>;
  setOnlineIds: Dispatch<SetStateAction<string[]>>;
  draggingRef: MutableRefObject<boolean>;
  pendingReloadRef: MutableRefObject<boolean>;
}

/**
 * Dong bo trang bang theo thoi gian thuc qua socket:
 *  - board:lists-changed  -> tai lai danh sach (gop 400ms; hoan neu dang keo-tha)
 *  - board:members-changed-> tai lai thanh vien + chi tiet bang (canManage)
 *  - board:meta-changed   -> tai lai chi tiet bang
 *  - workspace:changed    -> vai tro cua minh trong khong gian co the vua doi,
 *    anh huong canManage cua bang muc WORKSPACE -> tai lai chi tiet bang
 *  - board:removed        -> bi go khoi bang -> ve trang chu
 *  - board:presence       -> cap nhat danh sach nguoi dang xem
 *  - connect (noi lai)    -> vao phong lai + tai bu
 */
export function useBoardRealtime({
  boardId,
  patchBoard,
  setLists,
  setMembers,
  setFetchedBoard,
  setOnlineIds,
  draggingRef,
  pendingReloadRef,
}: Options) {
  const navigate = useNavigate();

  useEffect(() => {
    if (!boardId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Effect nay thuoc ve MOT bang. Khi doi bang / roi trang, cleanup go listener + huy timer nhung cac
    // request da bay van se tra ve va goi setLists / setMembers / setFetchedBoard cua bang MOI -> danh sach
    // cua bang cu de len bang dang mo. Co "stale" bat o cleanup, moi phan hoi den muon deu bi bo qua.
    let stale = false;
    const ifCurrent =
      <T>(apply: (value: T) => void) =>
      (value: T) => {
        if (!stale) apply(value);
      };
    setOnlineIds([]);

    const doReloadLists = () => {
      // Dang keo-tha -> hoan lai, chay sau khi tha tay
      if (draggingRef.current) {
        pendingReloadRef.current = true;
        return;
      }
      fetchBoardLists(boardId)
        .then(ifCurrent(setLists))
        .catch(logError('BoardPage realtime: tai danh sach'));
    };

    const onListsChanged = () => {
      clearTimeout(timer);
      timer = setTimeout(doReloadLists, 400); // gop nhieu su kien lien tiep
    };
    const onMetaChanged = () => {
      fetchBoard(boardId)
        .then(
          ifCurrent((b: Board) => {
            patchBoard(b);
            setFetchedBoard((prev) => (prev ? b : prev));
          })
        )
        .catch(logError('BoardPage realtime: tai chi tiet bang'));
    };
    const onMembersChanged = () => {
      fetchBoardMembers(boardId)
        .then(ifCurrent(setMembers))
        .catch(logError('BoardPage realtime: tai thanh vien'));
      // Vai tro cua CHINH minh co the vua doi (thang/ha cap, chuyen chu bang)
      // -> canManage/canEdit cua bang cung phai tai lai theo, khong chi doi
      // danh sach thanh vien. Neu khong, nut quan ly se "treo" sai quyen cho
      // toi khi nguoi dung tu tai lai trang.
      onMetaChanged();
    };
    const onRemoved = (payload: { boardId?: string }) => {
      if (payload?.boardId === boardId) navigate('/boards', { replace: true });
    };
    const onPresence = (payload: { boardId?: string; userIds?: string[] }) => {
      if (payload?.boardId === boardId) setOnlineIds(payload.userIds ?? []);
    };
    // Mat ket noi roi noi lai: vao phong lai + tai bu du lieu
    const onConnect = () => {
      socket.emit('join-board', boardId);
      onMembersChanged();
      onListsChanged();
    };

    socket.emit('join-board', boardId);
    socket.on('board:lists-changed', onListsChanged);
    socket.on('board:members-changed', onMembersChanged);
    socket.on('board:meta-changed', onMetaChanged);
    socket.on('workspace:changed', onMetaChanged);
    socket.on('board:removed', onRemoved);
    socket.on('board:presence', onPresence);
    socket.on('connect', onConnect);

    return () => {
      stale = true;
      clearTimeout(timer);
      socket.emit('leave-board', boardId);
      socket.off('board:lists-changed', onListsChanged);
      socket.off('board:members-changed', onMembersChanged);
      socket.off('board:meta-changed', onMetaChanged);
      socket.off('workspace:changed', onMetaChanged);
      socket.off('board:removed', onRemoved);
      socket.off('board:presence', onPresence);
      socket.off('connect', onConnect);
    };
  }, [
    boardId,
    navigate,
    patchBoard,
    setLists,
    setMembers,
    setFetchedBoard,
    setOnlineIds,
    draggingRef,
    pendingReloadRef,
  ]);
}
