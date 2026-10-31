import { act, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { Board } from '../types/board';

// ----- Mock API bang -----
const setBoardStarMock = vi.fn().mockResolvedValue(undefined);
let seedBoards: Board[] = [];
const fetchMyBoardsMock = vi.fn(() => Promise.resolve(seedBoards));
vi.mock('../lib/api/board', () => ({
  fetchMyBoards: (...a: unknown[]) =>
    (fetchMyBoardsMock as (...a: unknown[]) => Promise<Board[]>)(...a),
  setBoardStar: (...a: unknown[]) =>
    (setBoardStarMock as (...a: unknown[]) => Promise<void>)(...a),
}));

/** Promise dieu khien duoc tu ben ngoai - de gia lap thu tu resolve/reject tuy y. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

vi.mock('../lib/socket', () => ({
  socket: { on: () => {}, off: () => {} },
}));

import { BoardsProvider, useBoards } from './BoardsContext';

function makeBoard(id: string, isStarred: boolean): Board {
  return {
    id,
    ownerId: 'u1',
    workspaceId: 'w1',
    name: `Bang ${id}`,
    color: '#000',
    backgroundImage: null,
    visibility: 'PRIVATE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isStarred,
  };
}

function Probe() {
  const { boards, toggleStar, reload } = useBoards();
  return (
    <div>
      {boards.map((b) => (
        <button
          key={b.id}
          data-testid={`star-${b.id}`}
          onClick={() => toggleStar(b.id)}
        >
          {b.id}:{b.isStarred ? 'starred' : 'unstarred'}
        </button>
      ))}
      <button data-testid="reload" onClick={() => void reload()}>
        reload
      </button>
    </div>
  );
}

describe('dau sao duoc luu va khoi phuc sau khi tai lai trang trong StrictMode', () => {
  it('gui yeu cau luu sao va giu dung trang thai qua cac lan mount lai', async () => {
    seedBoards = [makeBoard('A', false)];
    setBoardStarMock.mockClear();
    setBoardStarMock.mockImplementationOnce(async (id: string, starred: boolean) => {
      seedBoards = [makeBoard(id, starred)];
    });

    const page = () => (
      <StrictMode>
        <BoardsProvider>
          <Probe />
        </BoardsProvider>
      </StrictMode>
    );
    const first = render(page());
    await screen.findByTestId('star-A');
    await act(async () => screen.getByTestId('star-A').click());
    expect(setBoardStarMock).toHaveBeenCalledWith('A', true);

    first.unmount();
    const second = render(page());
    await screen.findByText('A:starred');

    setBoardStarMock.mockImplementationOnce(async (id: string, starred: boolean) => {
      seedBoards = [makeBoard(id, starred)];
    });
    await act(async () => screen.getByTestId('star-A').click());
    expect(setBoardStarMock).toHaveBeenLastCalledWith('A', false);

    second.unmount();
    render(page());
    await screen.findByText('A:unstarred');
  });
});

// Van de moi #5: toggleStar() doc bien closure "next" NGAY SAU khi goi
// setState(updater) - thu tu nay khong duoc React dam bao, nen khi co 2 luot
// bam sao lien tiep (truoc khi kip render lai), gia tri gui len API co the sai.
describe('#5 toggleStar khong bi sai gia tri khi bam lien tiep', () => {
  it('bam sao 2 bang khac nhau LIEN TIEP (chua kip render) van gui dung gia tri cho tung bang', async () => {
    seedBoards = [makeBoard('A', false), makeBoard('B', true)];
    setBoardStarMock.mockClear();

    render(
      <BoardsProvider>
        <Probe />
      </BoardsProvider>
    );

    await screen.findByTestId('star-A');

    // Bam ca 2 nut trong CUNG 1 act() - khong cho render xen giua - de dam
    // bao lan goi thu 2 roi vao dung tinh huong "da co 1 cap nhat dang cho".
    await act(async () => {
      screen.getByTestId('star-A').click();
      screen.getByTestId('star-B').click();
    });

    expect(setBoardStarMock).toHaveBeenCalledWith('A', true); // false -> true
    expect(setBoardStarMock).toHaveBeenCalledWith('B', false); // true -> false
  });
});

// Van de moi (vong 4): 2 request setBoardStar CHO CUNG 1 BANG khong duoc phep
// bay DONG THOI, vi server ghi truc tiep tung request theo thu tu no NHAN
// duoc (khong theo thu tu client GUI) - neu ca 2 "thanh cong" nhung server xu
// ly nguoc thu tu gui, DB con lai gia tri SAI du UI dang hien dung. Ban vá
// vong 3 (starSeqRef) chi chan rollback cua request LOI, khong ngan viec 2
// request cung bay -> chua vao dung goc van de o nhanh THANH CONG.
// Sua: hang doi + khoa theo tung bang (xem BoardsContext.tsx/runStarRequest)
// dam bao TOI DA 1 request/bang bay tai 1 thoi diem.
describe('#3 (vong 4) khong bao gio co 2 request setBoardStar cung bang bay dong thoi', () => {
  it('bam 2 lan lien tiep cung bang: request thu 2 CHUA duoc gui khi request 1 con dang bay; hoi tu dung gia tri cuoi', async () => {
    seedBoards = [makeBoard('A', false)];
    setBoardStarMock.mockClear();

    const call1 = deferred<void>();
    const call2 = deferred<void>();
    setBoardStarMock.mockImplementationOnce(() => call1.promise);
    setBoardStarMock.mockImplementationOnce(() => call2.promise);

    render(
      <BoardsProvider>
        <Probe />
      </BoardsProvider>
    );
    await screen.findByTestId('star-A');

    // Click 1: bat sao (false -> true) -> gui request ngay
    await act(async () => {
      screen.getByTestId('star-A').click();
    });
    expect(setBoardStarMock).toHaveBeenCalledTimes(1);
    expect(setBoardStarMock).toHaveBeenNthCalledWith(1, 'A', true);

    // Click 2 NGAY (request 1 CHUA xong): bo sao lai (true -> false)
    await act(async () => {
      screen.getByTestId('star-A').click();
    });
    expect(screen.getByTestId('star-A').textContent).toBe('A:unstarred'); // UI lac quan cap nhat ngay
    // QUAN TRONG: van chi co DUNG 1 request dang bay - chua gui request thu 2
    expect(setBoardStarMock).toHaveBeenCalledTimes(1);

    // Request 1 hoan tat -> LUC NAY request 2 (gia tri MOI NHAT: false) moi duoc gui
    await act(async () => {
      call1.resolve();
      await call1.promise;
    });
    expect(setBoardStarMock).toHaveBeenCalledTimes(2);
    expect(setBoardStarMock).toHaveBeenNthCalledWith(2, 'A', false);

    await act(async () => {
      call2.resolve();
      await call2.promise;
    });
    expect(screen.getByTestId('star-A').textContent).toBe('A:unstarred');
  });

  it('request dau THAT BAI nhung da co gia tri MOI hon dang cho -> gui ngay gia tri do, KHONG dong bo lai tu server', async () => {
    seedBoards = [makeBoard('A', false)];
    setBoardStarMock.mockClear();
    fetchMyBoardsMock.mockClear();

    const call1 = deferred<void>();
    const call2 = deferred<void>();
    setBoardStarMock.mockImplementationOnce(() => call1.promise);
    setBoardStarMock.mockImplementationOnce(() => call2.promise);

    render(
      <BoardsProvider>
        <Probe />
      </BoardsProvider>
    );
    await screen.findByTestId('star-A');
    fetchMyBoardsMock.mockClear(); // bo qua lan goi luc mount

    await act(async () => {
      screen.getByTestId('star-A').click(); // true - gui ngay
    });
    await act(async () => {
      screen.getByTestId('star-A').click(); // false - xep hang cho
    });
    expect(setBoardStarMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      call1.reject(new Error('loi mang'));
      await call1.promise.catch(() => {});
    });

    // Da co gia tri moi hon (false) dang cho -> gui NGAY, khong dong bo server
    expect(setBoardStarMock).toHaveBeenCalledTimes(2);
    expect(setBoardStarMock).toHaveBeenNthCalledWith(2, 'A', false);
    expect(fetchMyBoardsMock).not.toHaveBeenCalled();

    await act(async () => {
      call2.resolve();
      await call2.promise;
    });
    expect(screen.getByTestId('star-A').textContent).toBe('A:unstarred');
  });

  it('bam 1 lan roi request that bai, KHONG co gia tri moi nao khac dang cho -> dong bo lai tu server', async () => {
    seedBoards = [makeBoard('A', false)];
    setBoardStarMock.mockClear();
    fetchMyBoardsMock.mockClear();

    const call1 = deferred<void>();
    setBoardStarMock.mockImplementationOnce(() => call1.promise);

    render(
      <BoardsProvider>
        <Probe />
      </BoardsProvider>
    );
    await screen.findByTestId('star-A');
    fetchMyBoardsMock.mockClear();
    // Server thuc te khong doi gi (request duy nhat that bai) -> van "false"
    fetchMyBoardsMock.mockResolvedValueOnce([makeBoard('A', false)]);

    await act(async () => {
      screen.getByTestId('star-A').click(); // toi UI: true
    });

    await act(async () => {
      call1.reject(new Error('loi mang'));
      await call1.promise.catch(() => {});
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchMyBoardsMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('star-A').textContent).toBe('A:unstarred'); // dung voi server
  });
});

// Van de moi (vong 5): dong bo lai sau khi 1 bang LOI (hoac reload() tu nguon
// khac) khong duoc phep ghi de isStarred cua BANG KHAC dang co request ghi
// sao rieng con bay - snapshot vua tai co the cu hon thao tac cua bang do.
describe('#3 (vong 5) dong bo lai KHONG duoc de len bang khac dang co request rieng', () => {
  it('bang A that bai -> dong bo lai KHONG duoc xoa sao cua bang B dang co request rieng con bay', async () => {
    seedBoards = [makeBoard('A', false), makeBoard('B', false)];
    setBoardStarMock.mockClear();
    fetchMyBoardsMock.mockClear();

    const callB = deferred<void>();
    const callA = deferred<void>();
    // Bam B truoc roi A -> request cua B duoc gui truoc (call thu 1), A la call thu 2
    setBoardStarMock.mockImplementationOnce(() => callB.promise);
    setBoardStarMock.mockImplementationOnce(() => callA.promise);

    render(
      <BoardsProvider>
        <Probe />
      </BoardsProvider>
    );
    await screen.findByTestId('star-A');
    fetchMyBoardsMock.mockClear();

    await act(async () => {
      screen.getByTestId('star-B').click(); // B: false -> true, dang bay
    });
    await act(async () => {
      screen.getByTestId('star-A').click(); // A: false -> true, dang bay (khac bang -> gui ngay duoc)
    });
    expect(screen.getByTestId('star-B').textContent).toBe('B:starred');
    expect(screen.getByTestId('star-A').textContent).toBe('A:starred');

    // Snapshot server tai thoi diem A that bai: server CHUA kip xu ly xong
    // request cua B (van "false") - day la nguon goc van de neu ghi de thang.
    fetchMyBoardsMock.mockResolvedValueOnce([
      makeBoard('A', true), // gia tri MOI cho chinh A (bang dang duoc dong bo)
      makeBoard('B', false), // CU hon thao tac cua B dang bay
    ]);

    await act(async () => {
      callA.reject(new Error('A that bai'));
      await callA.promise.catch(() => {});
      await Promise.resolve();
      await Promise.resolve();
    });

    // A lay gia tri moi tu server (true) - dung
    expect(screen.getByTestId('star-A').textContent).toBe('A:starred');
    // B PHAI GIU NGUYEN "starred" (dang cho request rieng cua no), KHONG bi
    // dong bo cua A de xuong "unstarred"
    expect(screen.getByTestId('star-B').textContent).toBe('B:starred');

    // Request cua B roi cung thanh cong -> van dung, khong co gi bi "treo sai"
    await act(async () => {
      callB.resolve();
      await callB.promise;
    });
    expect(screen.getByTestId('star-B').textContent).toBe('B:starred');
  });

  it('reload() tu nguon khac (vd workspace:changed) khong duoc xoa sao dang cho ghi', async () => {
    seedBoards = [makeBoard('A', false)];
    setBoardStarMock.mockClear();
    fetchMyBoardsMock.mockClear();

    const callA = deferred<void>();
    setBoardStarMock.mockImplementationOnce(() => callA.promise);

    render(
      <BoardsProvider>
        <Probe />
      </BoardsProvider>
    );
    await screen.findByTestId('star-A');
    fetchMyBoardsMock.mockClear();

    await act(async () => {
      screen.getByTestId('star-A').click(); // A: false -> true, request dang bay
    });
    expect(screen.getByTestId('star-A').textContent).toBe('A:starred');

    // reload() tu 1 nguon khac (vd realtime) tra ve snapshot CU (server chua
    // kip xu ly xong request cua A luc fetch)
    fetchMyBoardsMock.mockResolvedValueOnce([makeBoard('A', false)]);
    await act(async () => {
      screen.getByTestId('reload').click();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Van phai la "starred" - khong bi reload() de xuong trong luc request
    // cua chinh bang nay con dang bay
    expect(screen.getByTestId('star-A').textContent).toBe('A:starred');

    await act(async () => {
      callA.resolve();
      await callA.promise;
    });
    expect(screen.getByTestId('star-A').textContent).toBe('A:starred');
  });
});

// Van de moi (vong 6): ket qua tai danh sach CU (dang cho tu truoc) van co
// the toi SAU khi 1 thao tac sao da bam-va-luu THANH CONG TRON VEN (khong
// con "dang bay/cho" nua vao thoi diem ket qua cu toi) -> chi kiem tra
// "dang bay/cho NGAY LUC NAY" (vong 5) bo sot dung truong hop nay.
describe('#3 (vong 6) ket qua tai danh sach cu khong duoc de len thao tac da luu xong trong luc cho', () => {
  it('reload() dang cho ket qua (cham); B bam sao VA luu THANH CONG tron ven TRUOC khi ket qua cu toi -> khong bi de xuong', async () => {
    seedBoards = [makeBoard('B', false)];
    setBoardStarMock.mockClear();
    fetchMyBoardsMock.mockClear();

    render(
      <BoardsProvider>
        <Probe />
      </BoardsProvider>
    );
    await screen.findByTestId('star-B');
    fetchMyBoardsMock.mockClear();

    const callB = deferred<void>();
    setBoardStarMock.mockImplementationOnce(() => callB.promise);
    // 2. reload() bat dau ngay sau day, response CHAM (deferred, tu dieu khien)
    const reloadFetch = deferred<Board[]>();
    fetchMyBoardsMock.mockImplementationOnce(() => reloadFetch.promise);

    // 1. Bam bat sao B
    await act(async () => {
      screen.getByTestId('star-B').click();
    });
    expect(screen.getByTestId('star-B').textContent).toBe('B:starred');

    act(() => {
      screen.getByTestId('reload').click(); // bat dau fetch, chua resolve
    });

    // 3. Request bat sao B HOAN TAT THANH CONG TRON VEN (khong con dang bay
    // nua) - TRUOC khi response cua reload() (buoc 2) quay ve.
    await act(async () => {
      callB.resolve();
      await callB.promise;
    });
    expect(screen.getByTestId('star-B').textContent).toBe('B:starred');

    // 4. Response CU cua reload() (chup luc B CHUA co sao) gio moi toi
    await act(async () => {
      reloadFetch.resolve([makeBoard('B', false)]);
      await reloadFetch.promise;
    });

    // Van phai la "starred" - database that su da luu sao, khong duoc de UI
    // ve "chua co sao" chi vi ket qua tai danh sach cu toi tre.
    expect(screen.getByTestId('star-B').textContent).toBe('B:starred');
  });

  it('dong bo sau loi cua A dang cho (cham); B bam sao VA luu THANH CONG tron ven trong luc do -> khong bi de xuong', async () => {
    seedBoards = [makeBoard('A', false), makeBoard('B', false)];
    setBoardStarMock.mockClear();
    fetchMyBoardsMock.mockClear();

    render(
      <BoardsProvider>
        <Probe />
      </BoardsProvider>
    );
    await screen.findByTestId('star-A');
    fetchMyBoardsMock.mockClear();

    const callA = deferred<void>();
    setBoardStarMock.mockImplementationOnce(() => callA.promise);
    await act(async () => {
      screen.getByTestId('star-A').click(); // A: false -> true, dang bay
    });

    // A that bai -> bat dau dong bo lai; response CHAM (deferred)
    const resyncFetch = deferred<Board[]>();
    fetchMyBoardsMock.mockImplementationOnce(() => resyncFetch.promise);
    await act(async () => {
      callA.reject(new Error('A that bai'));
      await callA.promise.catch(() => {});
    });

    // Trong luc dong bo cua A dang cho, B bam sao VA luu THANH CONG tron ven
    const callB = deferred<void>();
    setBoardStarMock.mockImplementationOnce(() => callB.promise);
    await act(async () => {
      screen.getByTestId('star-B').click(); // B: false -> true
    });
    await act(async () => {
      callB.resolve();
      await callB.promise;
    });
    expect(screen.getByTestId('star-B').textContent).toBe('B:starred');

    // Response CU cua dong bo A (chup luc B CHUA co sao) gio moi toi
    await act(async () => {
      resyncFetch.resolve([makeBoard('A', true), makeBoard('B', false)]);
      await resyncFetch.promise;
    });

    expect(screen.getByTestId('star-A').textContent).toBe('A:starred'); // dung, lay tu ket qua dong bo
    expect(screen.getByTestId('star-B').textContent).toBe('B:starred'); // KHONG bi de xuong
  });
});

// CODE_REVIEW.md #16: BoardsProvider unmount khi dang xuat (xem ProtectedRoute).
// Truoc day, hang doi cua runStarRequest (tu goi lai o .finally khi con gia tri
// cho) khong biet provider da "chet" - request tiep theo van duoc gui, mang theo
// cookie phien HIEN TAI cua trinh duyet (co the la nguoi khac vua dang nhap tren
// cung tab), lam sai sao ca nhan cua ho cho 1 bang ho khong he thao tac.
describe('#16 hang doi ghi sao dung lai ngay khi BoardsProvider unmount (dang xuat)', () => {
  it('bam sao 2 lan lien tiep (co gia tri dang cho) roi unmount TRUOC khi request dau xong -> KHONG gui tiep request thu hai', async () => {
    seedBoards = [makeBoard('A', false)];
    setBoardStarMock.mockClear();

    const { unmount } = render(
      <BoardsProvider>
        <Probe />
      </BoardsProvider>
    );
    await screen.findByTestId('star-A');

    const call1 = deferred<void>();
    setBoardStarMock.mockImplementationOnce(() => call1.promise);
    await act(async () => {
      screen.getByTestId('star-A').click(); // false -> true: goi setBoardStar lan 1 (dang bay)
    });
    // Bam them lan nua trong luc request 1 con bay -> ghi vao starPendingRef,
    // se duoc runStarRequest tu goi lai gui tiep khi request 1 xong (neu con "song").
    await act(async () => {
      screen.getByTestId('star-A').click(); // true -> false: xep hang cho
    });
    expect(setBoardStarMock).toHaveBeenCalledTimes(1);

    // Nguoi dung dang xuat NGAY LUC NAY (BoardsProvider unmount) - truoc khi
    // request dau tra loi.
    unmount();

    // Request dau gio moi tra loi xong.
    await act(async () => {
      call1.resolve();
      await call1.promise;
    });

    // KHONG duoc gui tiep request thu hai sau khi da unmount, du van con gia
    // tri dang cho trong hang doi.
    expect(setBoardStarMock).toHaveBeenCalledTimes(1);
  });
});
