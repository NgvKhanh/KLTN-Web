import { useEffect, useRef, type MutableRefObject } from 'react';
import { logError } from '../../../lib/logError';
import { socket } from '../../../lib/socket';

interface Options {
  /** Tai lai chi tiet the (da bao boc bang useCallback o CardModal). */
  reload: () => Promise<unknown>;
  /** true khi dang go tieu de / mo ta -> khong ghi de ban nhap. */
  editingRef: MutableRefObject<boolean>;
  /** Cung gia tri voi editingRef nhung la state: de biet LUC NAO het sua ma tai lai. */
  editing: boolean;
  /** boardId cua the dang mo -> loc su kien cua bang khac. */
  boardIdRef: MutableRefObject<string | null>;
  /** Goi khi co thay doi tren bang NGAY LUC dang sua (de nhac nguoi dung). */
  onChangedWhileEditing?: () => void;
}

/**
 * Nghe socket `board:lists-changed`: khi nguoi khac binh luan / sua the tren
 * CUNG bang thi tai lai the (gop 400ms). Tach khoi CardModal cho gon.
 *
 * Dang go tieu de / mo ta thi KHONG tai lai (se ghi de ban nhap) nhung cung KHONG
 * quen: danh dau "con no" va tai lai ngay khi het sua (luu / huy), de khong con
 * hien ban cu cho toi lan thao tac ke tiep.
 */
export function useCardRealtime({
  reload,
  editingRef,
  editing,
  boardIdRef,
  onChangedWhileEditing,
}: Options) {
  const pendingRef = useRef(false);
  const notifyRef = useRef(onChangedWhileEditing);
  useEffect(() => {
    notifyRef.current = onChangedWhileEditing;
  }, [onChangedWhileEditing]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onBoardChanged = (payload?: { boardId?: string }) => {
      if (
        boardIdRef.current &&
        payload?.boardId &&
        payload.boardId !== boardIdRef.current
      ) {
        return;
      }
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (editingRef.current) {
          // dang go -> khong ghi de ban nhap; tai lai sau khi het sua
          pendingRef.current = true;
          notifyRef.current?.();
          return;
        }
        void reload().catch(logError('CardModal realtime: tai lai the'));
      }, 400);
    };
    socket.on('board:lists-changed', onBoardChanged);
    return () => {
      clearTimeout(timer);
      socket.off('board:lists-changed', onBoardChanged);
    };
  }, [reload, editingRef, boardIdRef]);

  // Het sua (luu / huy) -> tai lai phan da bi hoan
  useEffect(() => {
    if (editing || !pendingRef.current) return;
    pendingRef.current = false;
    void reload().catch(logError('CardModal realtime: tai lai the sau khi sua'));
  }, [editing, reload]);
}
