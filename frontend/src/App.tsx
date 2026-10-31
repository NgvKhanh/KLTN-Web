import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import PageLoading from './components/PageLoading';
import BoardViewLayout from './layouts/BoardViewLayout';
import MainLayout from './layouts/MainLayout';
import ProtectedRoute from './routes/ProtectedRoute';
import { useAuth } from './context/AuthContext';

// Mỗi trang là một chunk riêng, chỉ tải khi người dùng vào trang đó (trước đây cả ứng dụng nằm trong MỘT gói
// JS ~975 kB). Layout (Header / Sidebar) vẫn nạp sẵn vì gần như trang nào cũng dùng.
const BoardPage = lazy(() => import('./pages/BoardPage'));
const CalendarPage = lazy(() => import('./pages/CalendarPage'));
const ChangePasswordPage = lazy(() => import('./pages/ChangePasswordPage'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage'));
const HomeDashboard = lazy(() => import('./pages/HomeDashboard'));
const HomePage = lazy(() => import('./pages/HomePage'));
const JoinBoardPage = lazy(() => import('./pages/JoinBoardPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const LandingPage = lazy(() => import('./pages/LandingPage'));
const PublicBoardPage = lazy(() => import('./pages/PublicBoardPage'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage'));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage'));
const MyActivityPage = lazy(() => import('./pages/MyActivityPage'));
const MyCardsPage = lazy(() => import('./pages/MyCardsPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));
const NotificationSettingsPage = lazy(() => import('./pages/NotificationSettingsPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const TemplatesPage = lazy(() => import('./pages/TemplatesPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const WorkspaceSettingsPage = lazy(() => import('./pages/WorkspaceSettingsPage'));

// Dia chi khong khop trang nao -> trang 404 (giu nguyen dia chi tren thanh dia chi, khong tu chuyen huong).
function UnknownRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div
        role="status"
        className="grid min-h-screen place-items-center text-slate-600 dark:text-slate-300"
      >
        Đang kiểm tra đăng nhập…
      </div>
    );
  }
  // Khach: trang 404 doc lap (khong co Header / Sidebar de dung)
  if (!user) return <NotFoundPage standalone />;
  // Da dang nhap: 404 nam trong khung ung dung (Header + Sidebar) de nguoi dung di tiep duoc ngay
  return (
    <Routes>
      <Route element={<ProtectedRoute />}>
        <Route element={<MainLayout />}>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

function App() {
  return (
    // Suspense ngoài cùng cho các trang không nằm trong layout (landing, đăng nhập...); mỗi layout có Suspense riêng
    // quanh vùng nội dung để Header / Sidebar không biến mất lúc tải trang.
    <Suspense fallback={<PageLoading />}>
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/verify-email" element={<VerifyEmailPage />} />
      <Route path="/public/boards/:boardId" element={<PublicBoardPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<MainLayout />}>
          <Route path="/boards" element={<HomePage />} />
          <Route path="/home" element={<HomeDashboard />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/workspaces/:workspaceId" element={<WorkspaceSettingsPage />} />
          <Route path="/my-cards" element={<MyCardsPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/settings/profile" element={<ProfilePage />} />
          <Route path="/settings/password" element={<ChangePasswordPage />} />
          <Route path="/settings/notifications" element={<NotificationSettingsPage />} />
          <Route path="/activity" element={<MyActivityPage />} />
        </Route>

        <Route path="/join/:token" element={<JoinBoardPage />} />

        <Route element={<BoardViewLayout />}>
          <Route path="/boards/:boardId" element={<BoardPage />} />
        </Route>
      </Route>

      <Route path="*" element={<UnknownRoute />} />
    </Routes>
    </Suspense>
  );
}

export default App;
