import { lazy, Suspense } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import ErrorBoundary from '../components/ErrorBoundary';
import { AssistantProvider } from '../context/AssistantContext';
import { useAuth } from '../context/AuthContext';
import { BoardsProvider } from '../context/BoardsContext';
import { WorkspacesProvider } from '../context/WorkspacesContext';

// Khung trợ lý (nhiều khối trả lời, hành động...) là chunk riêng: tải ngay sau khi đăng nhập nhưng không chặn lần hiện trang.
const AssistantPanel = lazy(() => import('../components/assistant/AssistantPanel'));

/** Chi cho vao ben trong neu da dang nhap, con khong thi dua ve trang dang nhap. */
export default function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-500">
        Dang tai...
      </div>
    );
  }

  if (!user) {
    // Link toi 1 bang cu the -> thu dua sang ban xem CONG KHAI (khong ep dang
    // nhap). Neu bang do khong phai PUBLIC, trang do se tu hien loi + nut
    // dang nhap. Cac duong dan khac van ve /login nhu cu.
    const publicBoardMatch = /^\/boards\/([^/]+)\/?$/.exec(location.pathname);
    if (publicBoardMatch) {
      return <Navigate to={`/public/boards/${publicBoardMatch[1]}`} replace />;
    }
    // Nho lai trang dang muon vao -> dang nhap xong quay lai dung cho
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  // Tro ly o TREN cac layout: hoi thoai con nguyen khi doi tu MainLayout sang BoardViewLayout
  // (bam lien ket the trong cau tra loi). Dang xuat -> ProtectedRoute unmount -> hoi thoai mat theo.
  return (
    <WorkspacesProvider>
      <BoardsProvider>
        <AssistantProvider>
          <Outlet />
          {/* Khung tro ly la phan phu: hong thi tu an di, khong keo theo trang dang mo */}
          <ErrorBoundary scope="assistant" fallback={() => null}>
            <Suspense fallback={null}>
              <AssistantPanel />
            </Suspense>
          </ErrorBoundary>
        </AssistantProvider>
      </BoardsProvider>
    </WorkspacesProvider>
  );
}
