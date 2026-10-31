import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { fetchMyBoards, setBoardStar } from '../lib/api/board';
import { getErrorMessage } from '../lib/errorMessage';
import { logError } from '../lib/logError';
import { socket } from '../lib/socket';
import type { Board } from '../types/board';

interface BoardsContextValue {
  boards: Board[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  // Them moi hoac cap nhat 1 bang trong danh sach (dung sau khi tao/sua)
  upsertBoard: (board: Board) => void;
  removeBoard: (boardId: string) => void;
  // Danh dau / bo sao (cap nhat ngay, tu goi API)
  toggleStar: (boardId: string) => void;
}

const BoardsContext = createContext<BoardsContextValue | undefined>(undefined);

// Nguon du lieu bang dung chung: Header (tim kiem, tao moi), Sidebar, trang chu.
export function BoardsProvider({ children }: { children: ReactNode }) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Luon giu ban sao MOI NHAT cua "boards" de doc dong bo (khong phu thuoc
  // React chay updater cua setState() truoc hay sau dong code tiep theo -
  // dieu nay KHONG duoc dam bao, vd khi da co 1 cap nhat dang cho xu ly).
  // Cap nhat trong effect (cho moi nguon: reload/upsert/remove/realtime) VA
  // ngay tai cho trong toggleStar (cho double-click truoc khi kip render).
  const boardsRef = useRef<Board[]>(boards);
  useEffect(() => {
    boardsRef.current = boards;
  }, [boards]);

  // CODE_REVIEW.md #16: BoardsProvider unmount khi dang xuat (ProtectedRoute chi
  // render no luc da dang nhap), nhung mot request setBoardStar dang bay + hang
  // doi cua no (runStarRequest tu goi lai o .finally) van tiep tuc chay sau do -
  // trinh duyet van gan cookie phien HIEN TAI (co the la nguoi khac vua dang nhap
  // tren cung tab) vao request tiep theo. Co aliveRef nay de dung han hang doi
  // ngay khi provider khong con "song" nua, khong doi ket qua request dang bay.
  const aliveRef = useRef(true);
  useEffect(() => {
    // StrictMode chay lai setup sau cleanup; provider van dang duoc su dung.
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Hang doi + "khoa" GHI SAO theo TUNG BANG: dam bao chi co TOI DA 1 request
  // setBoardStar dang bay cho 1 bang tai 1 thoi diem. Neu ban truoc chi chan
  // rollback cua request cu (khong ngan 2 request cung bay), server van co
  // the nhan/xu ly chung KHONG theo thu tu gui di (vd request "tat" gui truoc
  // nhung server xu ly SAU request "bat" gui sau) -> DB ket thuc sai gia tri
  // du ca 2 request deu "thanh cong". Serialize o day tranh hoan toan tinh
  // huong do: starPendingRef giu "gia tri CUOI CUNG nguoi dung muon" (ghi de
  // moi lan bam), starInFlightRef danh dau bang nao dang co request bay. Khi
  // request hien tai xong, neu con gia tri cho thi gui tiep - luon hoi tu ve
  // dung 1 gia tri cuoi cung, khong bao gio co 2 request cung bang chay song song.
  const starPendingRef = useRef<Record<string, boolean>>({});
  const starInFlightRef = useRef<Record<string, boolean>>({});

  // So the (khong bao gio giam) cho biet "co bao nhieu lan bam sao" da xay ra
  // cho 1 bang, tang NGAY luc bam (toggleStar, xem duoi).
  const starGenerationRef = useRef<Record<string, number>>({});

  interface StarActivitySnapshot {
    gen: Record<string, number>;
    active: Record<string, boolean>;
  }

  // Chup "trang thai ghi sao" cua TAT CA bang dang duoc theo doi, ngay TRUOC
  // khi phat 1 request tai danh sach (fetchMyBoards). Dung lam moc de, khi
  // ket qua ve, biet duoc bang nao co the da bi ghi/dang ghi trong luc fetch
  // nay con dang bay - snapshot server co the khong phan anh dung thao tac
  // do (server sinh snapshot truoc/sau request ghi deu co the xay ra, client
  // khong biet chac). Can ca 2 phan:
  //  - active: co request dang bay/cho NGAY LUC CHUP (bat thao tac bat dau
  //    TRUOC fetch va co the VAN con dang cho khi fetch tra ve, hoac da xong
  //    nhung ket qua cua no chua chac duoc snapshot server phan anh dung).
  //  - gen: so de phat hien them thao tac MOI bat dau SAU luc chup (trong
  //    luc fetch dang bay), ke ca khi no da hoan tat xong truoc luc fetch tra
  //    ve (khong con "active" nua vao thoi diem ap dung ket qua).
  // Thieu 1 trong 2 phan deu de lot 1 kieu dua (da tu kiem chung bang test).
  function snapshotStarActivity(): StarActivitySnapshot {
    const ids = new Set<string>([
      ...Object.keys(starGenerationRef.current),
      ...Object.keys(starInFlightRef.current),
      ...Object.keys(starPendingRef.current),
    ]);
    const gen: Record<string, number> = {};
    const active: Record<string, boolean> = {};
    for (const id of ids) {
      gen[id] = starGenerationRef.current[id] ?? 0;
      active[id] =
        Boolean(starInFlightRef.current[id]) ||
        starPendingRef.current[id] !== undefined;
    }
    return { gen, active };
  }

  // excludeBoardId: bang dang duoc dong bo RIENG (vd sau khi chinh no vua
  // that bai) - van lay gia tri MOI nhat cho rieng bang do (da duoc bao dam
  // an toan boi khoa starInFlightRef cua chinh no suot qua trinh dong bo).
  const applyFreshBoardsPreservingConcurrentStars = (
    fresh: Board[],
    snapshotAtFetchStart: StarActivitySnapshot,
    excludeBoardId?: string
  ): Board[] =>
    fresh.map((b) => {
      if (b.id === excludeBoardId) return b;
      const wasActiveAtStart = snapshotAtFetchStart.active[b.id] ?? false;
      const genChangedSinceStart =
        (starGenerationRef.current[b.id] ?? 0) !==
        (snapshotAtFetchStart.gen[b.id] ?? 0);
      if (!wasActiveAtStart && !genChangedSinceStart) return b;
      const local = boardsRef.current.find((x) => x.id === b.id);
      return local ? { ...b, isStarred: local.isStarred } : b;
    });

  const reload = useCallback(async () => {
    setIsLoading(true);
    // Chup truoc khi goi API - moc de so sanh khi ket qua ve.
    const snapshotAtFetchStart = snapshotStarActivity();
    try {
      const fresh = await fetchMyBoards();
      const merged = applyFreshBoardsPreservingConcurrentStars(
        fresh,
        snapshotAtFetchStart
      );
      boardsRef.current = merged;
      setBoards(merged);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, 'Không tải được danh sách bảng.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Realtime: quyen truy cap bang thay doi (duoc them/xoa khoi bang hoac khong
  // gian, hoac 1 bang doi muc hien thi) -> tai lai danh sach bang
  useEffect(() => {
    const onAccessChanged = () => void reload();
    socket.on('board:access-changed', onAccessChanged);
    socket.on('workspace:changed', onAccessChanged);
    return () => {
      socket.off('board:access-changed', onAccessChanged);
      socket.off('workspace:changed', onAccessChanged);
    };
  }, [reload]);

  const upsertBoard = useCallback((board: Board) => {
    setBoards((cur) => {
      const idx = cur.findIndex((b) => b.id === board.id);
      if (idx === -1) return [board, ...cur];
      const next = [...cur];
      next[idx] = { ...next[idx], ...board };
      return next;
    });
  }, []);

  const removeBoard = useCallback((boardId: string) => {
    setBoards((cur) => cur.filter((b) => b.id !== boardId));
  }, []);

  // Gui request setBoardStar CHO 1 BANG neu chua co request nao dang bay cho
  // bang do. Khi xong, neu trong luc cho co gia tri moi hon duoc yeu cau
  // (starPendingRef) thi tu goi lai chinh no de gui tiep - vong lap tu ket
  // thuc khi khong con gia tri nao dang cho.
  const runStarRequest = useCallback((boardId: string) => {
    if (!aliveRef.current) return; // provider da unmount (vd dang xuat) - dung hang doi
    if (starInFlightRef.current[boardId]) return; // da co request dang bay
    const desired = starPendingRef.current[boardId];
    if (desired === undefined) return; // khong con gi de gui
    delete starPendingRef.current[boardId];
    starInFlightRef.current[boardId] = true;

    setBoardStar(boardId, desired)
      .catch(() => {
        if (!aliveRef.current) return;
        // Chi dong bo lai tu server neu KHONG con gia tri moi hon dang cho -
        // neu co, request tiep theo (o finally ben duoi) se tu thiet lap
        // dung trang thai, khong can dong bo them o day.
        if (starPendingRef.current[boardId] !== undefined) return;
        const snapshotAtFetchStart = snapshotStarActivity();
        return fetchMyBoards()
          .then((fresh) => {
            if (!aliveRef.current) return;
            if (starPendingRef.current[boardId] !== undefined) return;
            // excludeBoardId = boardId: lay gia tri MOI NHAT cho CHINH bang
            // nay (dang duoc dong bo - an toan vi khoa starInFlightRef cua no
            // van con giu suot qua trinh nay), nhung GIU NGUYEN moi bang KHAC
            // co lan bam sao xay ra trong luc fetch nay dang chay.
            const merged = applyFreshBoardsPreservingConcurrentStars(
              fresh,
              snapshotAtFetchStart,
              boardId
            );
            boardsRef.current = merged;
            setBoards(merged);
          })
          .catch(
            logError('BoardsContext: dong bo lai sau khi doi sao that bai')
          );
      })
      .finally(() => {
        starInFlightRef.current[boardId] = false;
        if (aliveRef.current && starPendingRef.current[boardId] !== undefined) {
          runStarRequest(boardId);
        }
      });
  }, []);

  const toggleStar = useCallback(
    (boardId: string) => {
      const current = boardsRef.current.find((b) => b.id === boardId);
      if (!current) return;
      const next = !current.isStarred;

      // Ghi nhan NGAY: co 1 lan bam sao cho bang nay. Bat ky lan tai danh
      // sach nao da BAT DAU truoc thoi diem nay (con dang cho ket qua) se
      // thay so nay khac voi luc no chup snapshot -> tu biet khong dung
      // isStarred trong ket qua do cho bang nay nua.
      starGenerationRef.current[boardId] =
        (starGenerationRef.current[boardId] ?? 0) + 1;

      const applied = boardsRef.current.map((b) =>
        b.id === boardId ? { ...b, isStarred: next } : b
      );
      boardsRef.current = applied; // cap nhat ref NGAY, khong cho den luc render
      setBoards(applied);

      // Ghi de "gia tri CUOI CUNG nguoi dung muon" cho bang nay. Neu dang co
      // request bay, no se tu gui gia tri nay ngay khi xong (khong gui them
      // 1 request song song) - dam bao server luon xu ly TUAN TU, khong bao
      // gio nhan 2 request cung bang cung luc va co the ghi sai thu tu.
      starPendingRef.current[boardId] = next;
      runStarRequest(boardId);
    },
    [runStarRequest]
  );

  return (
    <BoardsContext.Provider
      value={{
        boards,
        isLoading,
        error,
        reload,
        upsertBoard,
        removeBoard,
        toggleStar,
      }}
    >
      {children}
    </BoardsContext.Provider>
  );
}

export function useBoards(): BoardsContextValue {
  const ctx = useContext(BoardsContext);
  if (!ctx) {
    throw new Error('useBoards phải được dùng bên trong BoardsProvider');
  }
  return ctx;
}
