/** Hiện trong lúc tải mã của một trang (React.lazy). Header / Sidebar vẫn nằm yên, chỉ vùng nội dung hiện dòng này. */
export default function PageLoading() {
  return (
    <div
      role="status"
      className="grid min-h-[40vh] place-items-center text-sm text-slate-500 dark:text-slate-400"
    >
      Đang tải…
    </div>
  );
}

/** Hiện trong lúc tải mã của một hộp thoại: lớp mờ nhẹ để người dùng thấy thao tác đã được nhận. */
export function ModalLoading() {
  return (
    <div
      role="status"
      className="fixed inset-0 z-50 grid place-items-center bg-black/20 text-sm font-medium text-white"
    >
      Đang mở…
    </div>
  );
}
