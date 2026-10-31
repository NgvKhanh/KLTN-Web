import { Suspense, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import BoardSidebar, { BoardMobileNav } from '../components/BoardSidebar';
import ErrorBoundary from '../components/ErrorBoundary';
import Header from '../components/Header';
import PageLoading from '../components/PageLoading';
import { useBoards } from '../context/BoardsContext';
import type { Board } from '../types/board';

export interface BoardOutletContext {
  boards: Board[];
  isLoading: boolean;
  error: string | null;
  patchBoard: (board: Board) => void;
}

// Layout khi dang xem 1 bang: Header + Sidebar giu nguyen, chi vung noi dung doi.
export default function BoardViewLayout() {
  const { boards, isLoading, error, upsertBoard } = useBoards();
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();

  const ctx: BoardOutletContext = {
    boards,
    isLoading,
    error,
    patchBoard: upsertBoard,
  };

  return (
    <div className="flex h-screen flex-col">
      <Header onOpenNav={() => setNavOpen(true)} />
      <BoardMobileNav open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex min-h-0 flex-1">
        <BoardSidebar />
        <main className="min-w-0 flex-1 overflow-hidden">
          <ErrorBoundary scope="board-page" resetKey={pathname}>
            <Suspense fallback={<PageLoading />}>
              <Outlet context={ctx} />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
