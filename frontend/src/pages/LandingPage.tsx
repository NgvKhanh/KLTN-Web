import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import BoardPreview from '../components/landing/BoardPreview';
import LandingIcon from '../components/landing/LandingIcon';
import { useAuth } from '../context/AuthContext';
import './LandingPage.css';

const navigation = [
  { label: 'Tính năng', href: '#tinh-nang' },
  { label: 'Câu hỏi thường gặp', href: '#cau-hoi' },
];

// Mo ta dung chuc nang dang chay (doi chuc nang thi sua o day)
const features = [
  {
    icon: 'board' as const,
    title: 'Bảng Kanban',
    body: 'Mỗi dự án là một bảng gồm các cột và thẻ. Cột gắn với trạng thái công việc, kéo thẻ sang cột khác thì trạng thái đổi theo. Thẻ có hạn, nhãn, checklist, tệp đính kèm và bình luận.',
  },
  {
    icon: 'calendar' as const,
    title: 'Lịch và dạng bảng',
    body: 'Ngoài Kanban, có thể xem thẻ theo lịch hoặc dạng bảng biểu, lọc theo từ khoá, thành viên, trạng thái, nhãn và hạn.',
  },
  {
    icon: 'team' as const,
    title: 'Làm việc nhóm',
    body: 'Mời thành viên qua email hoặc liên kết, phân quyền theo vai trò. Thay đổi trên bảng hiện ngay cho mọi người đang mở, có thông báo khi được giao việc hoặc được nhắc tên.',
  },
  {
    icon: 'layers' as const,
    title: 'Tạo bảng từ mô tả',
    body: 'Dán mô tả dự án hoặc tải tài liệu lên, AI đề xuất các cột và công việc. Bạn xem lại, sửa hoặc bỏ bớt rồi mới tạo bảng.',
  },
  {
    icon: 'chart' as const,
    title: 'Gợi ý người phụ trách',
    body: 'Với mỗi việc, thành viên được xếp hạng theo kỹ năng, việc tương tự đã làm và số việc đang mở, kèm lý do. Người quyết định vẫn là bạn.',
  },
  {
    icon: 'message' as const,
    title: 'Trợ lý hỏi đáp',
    body: 'Hỏi bằng tiếng Việt về việc của bạn hay tiến độ nhóm, hoặc nhờ tạo thẻ, đổi hạn, giao việc. Thao tác nhiều bước hoặc xoá dữ liệu luôn hiện bản xem trước để bạn xác nhận.',
  },
];

const questions = [
  {
    question: 'TaskFlow dùng cho ai?',
    answer:
      'Cho cá nhân hoặc nhóm nhỏ cần theo dõi công việc theo dự án, ví dụ đồ án môn học, ban tổ chức sự kiện hay nhóm phát triển phần mềm. Mỗi dự án là một bảng riêng trong không gian làm việc của nhóm.',
  },
  {
    question: 'Bắt đầu như thế nào?',
    answer:
      'Tạo tài khoản, tạo một bảng (bảng trống, từ mẫu có sẵn hoặc từ mô tả), rồi mời thành viên vào bảng và thêm công việc.',
  },
  {
    question: 'Không dùng AI có được không?',
    answer:
      'Được. Các chức năng AI đều là tùy chọn, bạn có thể tự tạo và sắp xếp bảng như bình thường.',
  },
  {
    question: 'Gợi ý người phụ trách dựa vào đâu?',
    answer:
      'Dựa vào kỹ năng thành viên khai trong hồ sơ, những việc tương tự họ đã làm và số việc họ đang có. Mỗi gợi ý ghi rõ lý do, bạn có thể chọn người khác.',
  },
  {
    question: 'Trợ lý được phép làm gì?',
    answer:
      'Trợ lý chỉ thấy dữ liệu trong phạm vi bạn được xem. Nó có thể tạo thẻ, chuyển cột, đặt hạn hay giao việc theo yêu cầu của bạn; thao tác nhiều bước, xoá dữ liệu hoặc đổi quyền chỉ chạy sau khi bạn bấm Áp dụng trên bản xem trước.',
  },
  {
    question: 'Có chia sẻ bảng cho người ngoài nhóm được không?',
    answer:
      'Có. Người quản lý bảng có thể bật chế độ công khai và gửi liên kết; người nhận xem được mà không cần đăng nhập nhưng không sửa được.',
  },
];

export default function LandingPage() {
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  const menuPanelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuPanelRef.current?.contains(target)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        menuRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div className="landing-page" id="dau-trang">
      <a className="tf-skip-link" href="#noi-dung">
        Đến nội dung chính
      </a>
      <header className="tf-header">
        <div className="tf-wrap tf-header-inner">
          <Link
            to="/"
            aria-label="TaskFlow — Trang chủ"
            className="tf-brand"
            onClick={() => {
              setMenuOpen(false);
              window.scrollTo({ top: 0 });
            }}
          >
            <Logo markClassName="h-8 w-8" textClassName="text-xl font-bold tracking-tight" />
          </Link>
          <nav className="tf-desktop-nav" aria-label="Điều hướng giới thiệu">
            {navigation.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
          </nav>
          <div className="tf-header-actions">
            {!user && (
              <Link className="tf-login-link" to="/login">
                Đăng nhập
              </Link>
            )}
            <Link to={user ? '/boards' : '/register'} className="tf-button tf-button-primary tf-header-cta">
              {user ? 'Mở TaskFlow' : 'Bắt đầu ngay'}
            </Link>
            <button
              ref={menuRef}
              type="button"
              className="tf-menu-button"
              aria-label={menuOpen ? 'Đóng menu' : 'Mở menu'}
              aria-expanded={menuOpen}
              aria-controls="landing-mobile-menu"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <LandingIcon name={menuOpen ? 'close' : 'menu'} />
            </button>
          </div>
          {menuOpen && (
            <nav
              ref={menuPanelRef}
              id="landing-mobile-menu"
              className="tf-mobile-nav"
              aria-label="Điều hướng trên điện thoại"
            >
              {navigation.map((item) => (
                <a key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>
                  {item.label}
                </a>
              ))}
              {!user && (
                <Link to="/login" onClick={() => setMenuOpen(false)}>
                  Đăng nhập
                </Link>
              )}
            </nav>
          )}
        </div>
      </header>

      <main id="noi-dung" tabIndex={-1}>
        <section className="tf-hero" aria-labelledby="hero-title">
          <div className="tf-wrap tf-hero-grid">
            <div className="tf-hero-copy">
              <h1 id="hero-title">Quản lý công việc nhóm trên bảng Kanban</h1>
              <p className="tf-hero-description">
                TaskFlow giúp chia dự án thành từng thẻ việc, giao người phụ trách, đặt hạn và theo
                dõi tiến độ cùng cả nhóm. Kèm theo là vài công cụ AI: tạo bảng từ mô tả, gợi ý người
                phù hợp cho từng việc và trợ lý hỏi đáp bằng tiếng Việt.
              </p>
              <div className="tf-hero-actions">
                {user ? (
                  <Link to="/boards" className="tf-button tf-button-primary">
                    Vào không gian làm việc
                  </Link>
                ) : (
                  <>
                    <Link to="/register" className="tf-button tf-button-primary">
                      Tạo tài khoản
                    </Link>
                    <Link to="/login" className="tf-button tf-button-secondary">
                      Đăng nhập
                    </Link>
                  </>
                )}
              </div>
            </div>
            <div className="tf-hero-visual">
              <BoardPreview />
            </div>
          </div>
        </section>

        <section id="tinh-nang" className="tf-section tf-wrap" aria-labelledby="features-title">
          <h2 id="features-title">Tính năng chính</h2>
          <div className="tf-feature-grid">
            {features.map((f) => (
              <article key={f.title} className="tf-feature">
                <h3>
                  <LandingIcon name={f.icon} />
                  {f.title}
                </h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="cau-hoi" className="tf-section tf-wrap tf-faq-section" aria-labelledby="faq-title">
          <h2 id="faq-title">Câu hỏi thường gặp</h2>
          <div className="tf-faq-list">
            {questions.map((item) => (
              <details key={item.question}>
                <summary>
                  {item.question}
                  <LandingIcon name="plus" />
                </summary>
                <p>{item.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="tf-footer">
        <div className="tf-wrap tf-footer-inner">
          <div className="tf-footer-brand">
            <Link
              to="/"
              className="tf-brand"
              aria-label="TaskFlow — Về đầu trang"
              onClick={() => window.scrollTo({ top: 0 })}
            >
              <Logo markClassName="h-7 w-7" textClassName="text-lg font-bold tracking-tight" />
            </Link>
            <span>© {new Date().getFullYear()} TaskFlow · Đồ án tốt nghiệp</span>
          </div>
          <nav aria-label="Liên kết cuối trang">
            {navigation.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
            <Link to={user ? '/boards' : '/login'}>{user ? 'Mở TaskFlow' : 'Đăng nhập'}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
