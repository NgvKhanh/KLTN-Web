import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logError } from '../lib/logError';

interface Props {
  children: ReactNode;
  /** Tên vùng được bảo vệ - chỉ để ghi log ("app", "page", "card-modal"...). */
  scope: string;
  /** Khi giá trị này đổi (vd đường dẫn) thì vùng tự thoát khỏi trạng thái lỗi và dựng lại nội dung. */
  resetKey?: unknown;
  /**
   * Giao diện khi có lỗi. Mặc định: khung thông báo + "Thử lại" / "Tải lại trang" / "Về trang chủ".
   * Trả về null để không hiện gì (vd vùng phụ như khung trợ lý: hỏng thì biến mất, trang vẫn dùng được).
   */
  fallback?: (args: { error: Error; reset: () => void }) => ReactNode;
}

interface State {
  error: Error | null;
  /** resetKey cua lan render truoc, de so voi lan nay (getDerivedStateFromProps). */
  seenResetKey: unknown;
}

/**
 * Chặn lỗi xảy ra LÚC DỰNG GIAO DIỆN. Không có lớp này, một component ném lỗi (dữ liệu bất ngờ, null...) làm
 * React gỡ cả cây và người dùng chỉ thấy trang trắng. Chỉ lỗi khi render / vòng đời bị bắt; lỗi trong
 * trình xử lý sự kiện hay promise vẫn do chỗ gọi tự xử lý (đã có `logError` / thông báo lỗi riêng).
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, seenResetKey: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  // resetKey doi (vd sang trang khac) thi bo trang thai loi va dung lai noi dung - khong can setState o componentDidUpdate
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (Object.is(props.resetKey, state.seenResetKey)) return null;
    return { error: null, seenResetKey: props.resetKey };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    logError(`ErrorBoundary: ${this.props.scope}`)(error);
    if (info.componentStack) console.error(info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (this.props.fallback) return this.props.fallback({ error, reset: this.reset });
    return <DefaultFallback error={error} reset={this.reset} />;
  }
}

function DefaultFallback({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div
      role="alert"
      className="mx-auto my-10 max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm dark:border-slate-700 dark:bg-slate-800"
    >
      <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100">
        Phần này gặp lỗi khi hiển thị
      </h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
        Dữ liệu đã lưu không bị ảnh hưởng. Hãy thử lại; nếu vẫn lỗi, tải lại trang hoặc quay về trang chủ.
      </p>
      {import.meta.env.DEV && (
        <pre className="mt-3 max-h-32 overflow-auto rounded bg-slate-100 p-2 text-left text-xs text-slate-700 dark:bg-slate-900 dark:text-slate-300">
          {error.message}
        </pre>
      )}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Thử lại
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          Tải lại trang
        </button>
        {/* Thẻ a thường (không dùng router): lớp ngoài cùng có thể được dùng khi router chưa dựng được */}
        <a
          href="/"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          Về trang chủ
        </a>
      </div>
    </div>
  );
}
