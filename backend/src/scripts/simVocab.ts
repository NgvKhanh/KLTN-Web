// Tu vung cho bo sinh du lieu mo phong (ASSIGN_MODULE.md §7).
//
// QUAN TRONG VE PHUONG PHAP: ten chu de o day CHI de doc va go loi. Bo cham
// diem KHONG BAO GIO duoc nhin thay `topic` - no chi thay chu trong tieu de va
// mo ta. Neu de lo chu de sang bo cham thi ca phep danh gia thanh vo nghia.
//
// Tu vung duoc soan de moi chu de co tu rieng, NHUNG co ba nguon lam nhoe cu y
// (§7): tu dong nghia / viet tat (SYNONYMS), loi chinh ta (xem simGenerator),
// va tu chung khong lo chu de (GENERIC_*). Nho vay do giong theo tu khoa khong
// bao gio trung khop hoan hao voi ky nang an - dung nhu ngoai doi.

export interface Topic {
  /** Chi de nguoi doc hieu. Khong dua vao bo cham diem. */
  name: string;
  verbs: string[];
  objects: string[];
  details: string[];
  /** Tu hay gap trong mo ta cua chu de nay. */
  descWords: string[];
}

export const TOPICS: Topic[] = [
  {
    name: 'Giao dien',
    verbs: ['Dựng', 'Hoàn thiện', 'Sửa', 'Ghép', 'Tối ưu'],
    objects: [
      'màn hình đăng nhập',
      'trang chủ',
      'thanh điều hướng',
      'biểu mẫu đăng ký',
      'danh sách thẻ',
      'hộp thoại xác nhận',
      'giao diện bảng',
    ],
    details: [
      'trên điện thoại',
      'cho chế độ tối',
      'theo bản thiết kế',
      'cho màn hình nhỏ',
      '',
    ],
    descWords: [
      'bố cục',
      'nút bấm',
      'khoảng cách',
      'phông chữ',
      'hiển thị',
      'thành phần',
      'trạng thái rỗng',
    ],
  },
  {
    name: 'May chu va API',
    verbs: ['Viết', 'Bổ sung', 'Sửa', 'Tách', 'Chuẩn hoá'],
    objects: [
      'API đăng nhập',
      'API danh sách thẻ',
      'endpoint tải tệp',
      'xử lý lỗi tập trung',
      'phân trang cho danh sách',
      'lớp xác thực',
      'API thống kê',
    ],
    details: ['bằng Google', 'cho thiết bị di động', 'theo chuẩn REST', 'có giới hạn tần suất', ''],
    descWords: [
      'yêu cầu',
      'phản hồi',
      'mã lỗi',
      'tham số',
      'xác thực',
      'phiên',
      'định tuyến',
    ],
  },
  {
    name: 'Co so du lieu',
    verbs: ['Thiết kế', 'Thêm', 'Tối ưu', 'Sửa', 'Dọn'],
    objects: [
      'bảng người dùng',
      'quan hệ giữa bảng và thẻ',
      'chỉ mục cho truy vấn chậm',
      'migration thêm cột',
      'ràng buộc khoá ngoại',
      'truy vấn thống kê',
      'sao lưu định kỳ',
    ],
    details: ['cho dữ liệu cũ', 'tránh mất dữ liệu', 'theo sơ đồ mới', ''],
    descWords: [
      'lược đồ',
      'bản ghi',
      'truy vấn',
      'khoá chính',
      'kiểu dữ liệu',
      'chuyển đổi',
      'ràng buộc',
    ],
  },
  {
    name: 'Kiem thu',
    verbs: ['Viết', 'Bổ sung', 'Sửa', 'Mở rộng', 'Rà'],
    objects: [
      'test cho luồng đăng nhập',
      'ca kiểm thử biên',
      'kiểm thử tích hợp',
      'test hồi quy',
      'bộ test đang hỏng',
      'kịch bản kiểm thử thủ công',
      'độ phủ cho module thẻ',
    ],
    details: ['sau khi đổi API', 'cho trường hợp lỗi', 'chạy được trong CI', ''],
    descWords: [
      'ca kiểm thử',
      'kỳ vọng',
      'dữ liệu mẫu',
      'độ phủ',
      'khẳng định',
      'tình huống',
      'lỗi',
    ],
  },
  {
    name: 'Tai lieu va bao cao',
    verbs: ['Viết', 'Cập nhật', 'Soạn', 'Biên tập', 'Dịch'],
    objects: [
      'tài liệu hướng dẫn sử dụng',
      'chương mở đầu của báo cáo',
      'biên bản họp nhóm',
      'mô tả kiến trúc hệ thống',
      'tài liệu bàn giao',
      'slide báo cáo tiến độ',
      'phụ lục số liệu',
    ],
    details: ['cho buổi bảo vệ', 'theo mẫu của khoa', 'kèm hình minh hoạ', ''],
    descWords: [
      'mục lục',
      'đoạn văn',
      'trích dẫn',
      'hình vẽ',
      'nội dung',
      'trình bày',
      'bản nháp',
    ],
  },
  {
    name: 'Thiet ke UI/UX',
    verbs: ['Vẽ', 'Chỉnh', 'Thống nhất', 'Dựng', 'Hoàn thiện'],
    objects: [
      'wireframe cho luồng tạo bảng',
      'bảng màu và phông chữ',
      'bộ biểu tượng',
      'nguyên mẫu tương tác',
      'khung giao diện trang cá nhân',
      'luồng người dùng mới',
      'bản thiết kế màn hình thống kê',
    ],
    details: ['trên Figma', 'cho cả nền sáng và tối', 'theo phản hồi người dùng', ''],
    descWords: [
      'màu sắc',
      'bố cục',
      'trải nghiệm',
      'thói quen',
      'thị giác',
      'nhất quán',
      'khoảng trắng',
    ],
  },
  {
    name: 'Trien khai va ha tang',
    verbs: ['Dựng', 'Cấu hình', 'Sửa', 'Hoàn thiện', 'Kiểm tra'],
    objects: [
      'Docker cho môi trường phát triển',
      'quy trình CI',
      'biến môi trường cho máy chủ',
      'tên miền và chứng chỉ',
      'kịch bản triển khai',
      'nhật ký hệ thống',
      'sao lưu tự động',
    ],
    details: ['trên máy chủ thật', 'cho nhánh chính', 'tránh lộ khoá bí mật', ''],
    descWords: [
      'container',
      'cổng',
      'cấu hình',
      'khởi động',
      'phiên bản',
      'môi trường',
      'nhật ký',
    ],
  },
  {
    name: 'Phan tich yeu cau',
    verbs: ['Khảo sát', 'Đặc tả', 'Phỏng vấn', 'Tổng hợp', 'Rà soát'],
    objects: [
      'yêu cầu chức năng quản lý thẻ',
      'use case cho người quản trị',
      'sơ đồ luồng nghiệp vụ',
      'danh sách yêu cầu phi chức năng',
      'người dùng mục tiêu',
      'quy trình làm việc của nhóm',
      'tiêu chí nghiệm thu',
    ],
    details: ['với ba nhóm sinh viên', 'cho giai đoạn hai', 'trước khi chốt thiết kế', ''],
    descWords: [
      'yêu cầu',
      'tác nhân',
      'quy trình',
      'phạm vi',
      'nghiệp vụ',
      'kịch bản',
      'tiêu chí',
    ],
  },
];

/**
 * Nguon lech 1: tu dong nghia / viet tat / tu tieng Anh. Bo sinh thay the ngau
 * nhien -> hai the CUNG chu de van co the khong dung chung mot tu nao.
 */
export const SYNONYMS: Record<string, string[]> = {
  'giao diện': ['UI', 'front-end'],
  'màn hình': ['screen', 'trang'],
  'biểu mẫu': ['form'],
  'đăng nhập': ['login'],
  'người dùng': ['user'],
  'cơ sở dữ liệu': ['CSDL', 'database', 'DB'],
  'chỉ mục': ['index'],
  'kiểm thử': ['test', 'testing'],
  'tài liệu': ['docs'],
  'máy chủ': ['server', 'back-end'],
  'triển khai': ['deploy'],
  'nguyên mẫu': ['prototype'],
  'yêu cầu': ['requirement'],
  'sao lưu': ['backup'],
  'nhật ký': ['log'],
  'thống kê': ['báo cáo số liệu'],
};

/**
 * Nguon lech 2: the "mo ho" - tieu de khong lo chu de. Ngoai doi rat nhieu the
 * kieu nay, va bo cham diem PHAI xu ly duoc thay vi doan bua.
 */
export const GENERIC_TITLES: string[] = [
  'Xử lý nốt phần còn lại',
  'Hoàn thiện mục 3',
  'Rà soát lại theo góp ý của thầy',
  'Chỉnh sửa theo phản hồi buổi họp',
  'Việc còn tồn từ tuần trước',
  'Cập nhật theo yêu cầu mới',
  'Kiểm tra lại một lượt trước khi nộp',
  'Sửa những chỗ đã ghi chú',
];

/** Tu chung, khong thuoc chu de nao - don vao mo ta cho giong van viet that. */
export const GENERIC_DESC: string[] = [
  'Cần xong trước buổi họp nhóm',
  'Ưu tiên làm sớm',
  'Đã trao đổi trong nhóm chat',
  'Nếu vướng thì báo lại cả nhóm',
  'Làm xong nhớ báo để rà lại',
  'Phần này liên quan tới việc của bạn khác',
];
