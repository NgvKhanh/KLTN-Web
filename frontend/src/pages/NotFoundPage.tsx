import { Link, useLocation, useNavigate } from 'react-router-dom';
import Logo from '../components/Logo';
import { useAuth } from '../context/AuthContext';

interface Props {
  // Khach chua dang nhap: khong co Header / Sidebar nen trang tu dung khung rieng
  standalone?: boolean;
}

// Hinh minh hoa: mot bang 3 cot, cot giua thieu mot the (o net dut co dau "?") - dung ngon ngu cua san pham,
// chi dung mau thuong hieu va xam, khong trang tri them.
function MissingCardIllustration() {
  const card = 'fill-slate-100 dark:fill-slate-700';
  const header = 'fill-slate-300 dark:fill-slate-500';
  return (
    <svg
      viewBox="0 0 240 160"
      className="h-auto w-56 sm:w-64"
      fill="none"
      role="img"
      aria-label="Bảng có một thẻ bị thiếu"
    >
      <rect
        x="1"
        y="1"
        width="238"
        height="158"
        rx="14"
        className="fill-white stroke-slate-200 dark:fill-slate-800 dark:stroke-slate-700"
        strokeWidth="2"
      />
      {/* Cot 1 */}
      <rect x="18" y="20" width="62" height="8" rx="4" className={header} />
      <rect x="18" y="38" width="62" height="30" rx="7" className={card} />
      <rect x="18" y="76" width="62" height="40" rx="7" className={card} />
      {/* Cot 2: the bi thieu */}
      <rect x="89" y="20" width="62" height="8" rx="4" className={header} />
      <rect x="89" y="38" width="62" height="36" rx="7" className={card} />
      <rect
        x="89.75"
        y="82.75"
        width="60.5"
        height="40.5"
        rx="7"
        className="fill-primary/5 stroke-primary"
        strokeWidth="1.5"
        strokeDasharray="5 4"
      />
      <text
        x="120"
        y="110"
        textAnchor="middle"
        className="fill-primary-ink"
        style={{ font: '600 20px system-ui, sans-serif' }}
      >
        ?
      </text>
      {/* Cot 3 */}
      <rect x="160" y="20" width="62" height="8" rx="4" className={header} />
      <rect x="160" y="38" width="62" height="46" rx="7" className={card} />
      <rect x="160" y="92" width="62" height="26" rx="7" className={card} />
    </svg>
  );
}

const PRIMARY_BTN =
  'rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover';
const SECONDARY_BTN =
  'rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800';

/** Trang 404: dia chi khong khop trang nao cua ung dung. */
export default function NotFoundPage({ standalone = false }: Props) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  // BrowserRouter ghi `idx` vao history.state: > 0 nghia la con trang truoc do cua ung dung de quay lai
  // (mo thang vao dia chi sai thi khong co -> khong hien nut, tranh quay ra khoi trang web).
  const canGoBack = (window.history.state?.idx ?? 0) > 0;

  const body = (
    <section
      aria-labelledby="not-found-title"
      className="mx-auto flex max-w-lg flex-col items-center text-center"
    >
      <MissingCardIllustration />
      <p className="mt-8 rounded-full bg-primary-soft px-3 py-1 text-xs font-semibold text-primary-ink">
        Lỗi 404
      </p>
      <h1
        id="not-found-title"
        className="mt-4 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-slate-100"
      >
        Không tìm thấy trang
      </h1>
      <p className="mt-3 text-base text-slate-600 dark:text-slate-300">
        Địa chỉ bạn mở không tồn tại hoặc đã được chuyển đi.
      </p>
      <code className="mt-4 max-w-full break-all rounded-md bg-slate-100 px-2.5 py-1 text-[13px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
        {pathname}
      </code>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link to={user ? '/boards' : '/'} className={PRIMARY_BTN}>
          {user ? 'Về danh sách bảng' : 'Về trang chủ'}
        </Link>
        {user ? (
          canGoBack && (
            <button type="button" onClick={() => navigate(-1)} className={SECONDARY_BTN}>
              Quay lại
            </button>
          )
        ) : (
          <Link to="/login" className={SECONDARY_BTN}>
            Đăng nhập
          </Link>
        )}
      </div>
    </section>
  );

  if (!standalone) {
    return <div className="flex min-h-[70vh] items-center justify-center py-10">{body}</div>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <header className="px-4 py-4 sm:px-6">
        <Link to="/" aria-label="TaskFlow - trang chủ" className="inline-flex">
          <Logo />
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-24">{body}</main>
    </div>
  );
}
