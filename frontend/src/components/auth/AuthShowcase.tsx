// Cột giới thiệu bên phải trang đăng nhập/đăng ký (từ 1024px): một câu mô tả sản phẩm + bảng Kanban minh hoạ với
// DỮ LIỆU DEMO, không chứa thông tin người dùng thật. Chỉ để giới thiệu nên ẩn với trình đọc màn hình.
const COLUMNS = [
  {
    title: 'Cần làm',
    cards: [
      { text: 'Viết nội dung trang giới thiệu', tag: 'Nội dung', tagClass: 'bg-orange-100 text-orange-700', who: 'LA' },
      { text: 'Chuẩn bị bộ hình sản phẩm', tag: 'Thiết kế', tagClass: 'bg-violet-100 text-violet-700', who: 'MN' },
    ],
  },
  {
    title: 'Đang làm',
    cards: [
      { text: 'Thiết kế giao diện website', tag: 'Thiết kế', tagClass: 'bg-violet-100 text-violet-700', who: 'HA' },
      { text: 'Xây dựng trang đăng ký', tag: 'Phát triển', tagClass: 'bg-sky-100 text-sky-700', who: 'TU' },
    ],
  },
  {
    title: 'Hoàn thành',
    cards: [
      { text: 'Thống nhất ý tưởng dự án', tag: 'Kế hoạch', tagClass: 'bg-emerald-100 text-emerald-700', who: 'LA' },
      { text: 'Phác thảo luồng người dùng', tag: 'Kế hoạch', tagClass: 'bg-emerald-100 text-emerald-700', who: 'MN' },
    ],
  },
];

export default function AuthShowcase() {
  return (
    <aside
      aria-hidden="true"
      className="hidden flex-col justify-center gap-8 border-l border-slate-200 bg-white px-10 py-12 lg:flex xl:px-16"
    >
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 xl:text-3xl">
          Quản lý công việc nhóm trên bảng Kanban
        </h2>
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-slate-600">
          Chia dự án thành thẻ việc, giao người phụ trách, đặt hạn và theo dõi tiến độ cùng cả nhóm.
        </p>
      </div>

      <div className="max-w-xl rounded-xl border border-slate-200 bg-slate-50 p-3">
        <p className="mb-2 px-1 text-xs font-medium text-slate-500">Ra mắt website mới (dữ liệu minh hoạ)</p>
        <div className="grid grid-cols-3 gap-2">
          {COLUMNS.map((col) => (
            <div key={col.title} className="rounded-lg bg-slate-100 p-2">
              <p className="mb-1.5 px-1 text-[11px] font-semibold text-slate-600">{col.title}</p>
              <div className="flex flex-col gap-1.5">
                {col.cards.map((c) => (
                  <div key={c.text} className="rounded-md border border-slate-200 bg-white p-2">
                    <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold ${c.tagClass}`}>{c.tag}</span>
                    <p className="mt-1 text-[11px] font-medium leading-snug text-slate-800">{c.text}</p>
                    <span className="mt-1.5 grid h-4 w-4 place-items-center rounded-full bg-slate-200 text-[8px] font-bold text-slate-700">
                      {c.who}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
