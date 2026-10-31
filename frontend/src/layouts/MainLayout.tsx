import { Suspense, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import EmailVerifyBanner from '../components/EmailVerifyBanner';
import ErrorBoundary from '../components/ErrorBoundary';
import Header from '../components/Header';
import PageLoading from '../components/PageLoading';
import Sidebar, { MainMobileNav } from '../components/Sidebar';

export default function MainLayout() {
  const { pathname } = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  // Tổng quan và danh sách bảng cần rộng hơn (cột phụ, lưới 4 cột); các trang còn lại giữ bề rộng đọc gọn
  const wide = pathname === '/home' || pathname === '/boards';
  // Tìm kiếm nâng cao lấp đúng chiều cao vùng nội dung (từ md): bộ lọc đứng yên, chỉ danh sách kết quả cuộn
  const fill = pathname === '/search';
  return (
    <div className="flex h-screen flex-col bg-white dark:bg-slate-900">
      <Header onOpenNav={() => setNavOpen(true)} />
      <MainMobileNav open={navOpen} onClose={() => setNavOpen(false)} />
      <EmailVerifyBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        {/* relative: phan tu position:absolute ben trong (vd chu sr-only cho trinh doc man hinh) tinh vi tri theo
            vung cuon nay; thieu no chung tinh theo ca trang, keo dai tai lieu -> ca khung cuon lo nen trong ben duoi */}
        <main className="relative min-w-0 flex-1 overflow-y-auto bg-[var(--app-bg)]">
          {/* key theo duong dan: doi trang thi noi dung mo dan vao (chi doi do mo) */}
          <div
            key={pathname}
            className={`tf-page-in mx-auto w-full p-4 sm:p-6 ${wide ? 'max-w-6xl' : 'max-w-5xl'} ${fill ? 'md:h-full' : ''}`}
          >
            {/* Trang loi chi mat phan noi dung; Header + Sidebar con nguyen de nguoi dung di sang trang khac */}
            <ErrorBoundary scope="page" resetKey={pathname}>
              <Suspense fallback={<PageLoading />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
