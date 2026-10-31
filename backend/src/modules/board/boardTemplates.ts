// Cac mau bang co san. Nguoi dung chon 1 mau -> tao ngay 1 bang day du list + the (+ nhan neu mau co).
// Moi cot ghi TUONG MINH trang thai cua no (null = cot tu do, vd "Y tuong",
// "Hom nay") thay vi doan theo ten - de doc/sua truc tiep o day.

import type { CardStatus } from '../../generated/prisma/enums';

export type TemplateCategory = 'work' | 'dev' | 'marketing' | 'study' | 'life';

/** Nhom mau, theo thu tu hien thi o trang Mau. */
export const TEMPLATE_CATEGORIES: { id: TemplateCategory; name: string }[] = [
  { id: 'work', name: 'Công việc' },
  { id: 'dev', name: 'Phần mềm' },
  { id: 'marketing', name: 'Marketing và bán hàng' },
  { id: 'study', name: 'Học tập' },
  { id: 'life', name: 'Cá nhân' },
];

export interface BoardTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  color: string;
  /** Nhan tao san cho bang. Bo trong = bang dung bo nhan mac dinh cua ung dung. */
  labels?: { name: string; color: string }[];
  lists: { name: string; status: CardStatus | null; cards: string[] }[];
}

// Bang mau cua nhan (khop LABEL_COLORS cua giao dien) va mau nen bang (boardColors.ts)
const RED = '#EB5A46';
const ORANGE = '#FF9F1A';
const YELLOW = '#F2D600';
const GREEN = '#61BD4F';
const PURPLE = '#C377E0';
const BLUE = '#0079BF';

export const BOARD_TEMPLATES: BoardTemplate[] = [
  // ---- Công việc ----
  {
    id: 'kanban',
    name: 'Kanban cơ bản',
    description: 'Ba cột đơn giản để theo dõi công việc hằng ngày.',
    category: 'work',
    color: '#0079BF',
    lists: [
      {
        name: 'Cần làm',
        status: 'TODO',
        cards: ['Ví dụ: Lên kế hoạch tuần', 'Ví dụ: Trả lời email'],
      },
      { name: 'Đang làm', status: 'IN_PROGRESS', cards: ['Ví dụ: Viết báo cáo'] },
      { name: 'Hoàn thành', status: 'DONE', cards: [] },
    ],
  },
  {
    id: 'project',
    name: 'Quản lý dự án',
    description: 'Quy trình đầy đủ từ ý tưởng đến bàn giao, kèm cột tạm hoãn.',
    category: 'work',
    color: '#519839',
    lists: [
      { name: 'Ý tưởng', status: null, cards: ['Thu thập yêu cầu', 'Nghiên cứu đối thủ'] },
      { name: 'Việc cần làm', status: 'TODO', cards: ['Thiết kế giao diện', 'Lập lịch dự án'] },
      { name: 'Đang thực hiện', status: 'IN_PROGRESS', cards: [] },
      { name: 'Đang review', status: 'IN_REVIEW', cards: [] },
      { name: 'Hoàn thành', status: 'DONE', cards: [] },
      { name: 'Tạm hoãn', status: 'BLOCKED', cards: [] },
    ],
  },
  {
    id: 'hiring',
    name: 'Tuyển dụng',
    description: 'Theo dõi ứng viên từ lúc nhận hồ sơ đến khi nhận việc.',
    category: 'work',
    color: '#4BBF6B',
    labels: [
      { name: 'Ưu tiên', color: RED },
      { name: 'Cần hỏi thêm', color: ORANGE },
      { name: 'Giới thiệu nội bộ', color: GREEN },
    ],
    lists: [
      {
        name: 'Hồ sơ mới',
        status: 'TODO',
        cards: ['Ứng viên A – Lập trình viên React', 'Ứng viên B – Thiết kế giao diện'],
      },
      { name: 'Đang sàng lọc', status: 'IN_PROGRESS', cards: [] },
      { name: 'Phỏng vấn', status: 'IN_PROGRESS', cards: [] },
      { name: 'Chờ quyết định', status: 'IN_REVIEW', cards: [] },
      { name: 'Đã nhận việc', status: 'DONE', cards: [] },
      { name: 'Không phù hợp', status: null, cards: [] },
    ],
  },
  {
    id: 'event',
    name: 'Tổ chức sự kiện',
    description: 'Chia việc theo mảng: nội dung, tài trợ, hậu cần và truyền thông.',
    category: 'work',
    color: '#CD5A91',
    labels: [
      { name: 'Cần gấp', color: RED },
      { name: 'Chờ phản hồi', color: ORANGE },
      { name: 'Đã chốt', color: GREEN },
    ],
    lists: [
      { name: 'Việc chung', status: 'TODO', cards: ['Chốt thời gian và địa điểm', 'Lập ngân sách dự kiến'] },
      { name: 'Nội dung và khách mời', status: null, cards: ['Mời diễn giả chính'] },
      { name: 'Tài trợ', status: null, cards: ['Lập danh sách doanh nghiệp liên hệ'] },
      { name: 'Hậu cần', status: null, cards: ['Thuê âm thanh, ánh sáng'] },
      { name: 'Truyền thông', status: null, cards: ['Thiết kế poster và ảnh bìa'] },
      { name: 'Chờ duyệt', status: 'IN_REVIEW', cards: [] },
      { name: 'Đã xong', status: 'DONE', cards: [] },
    ],
  },
  {
    id: 'retro',
    name: 'Họp nhóm và nhìn lại',
    description: 'Thu ý kiến sau một giai đoạn rồi biến thành việc cụ thể.',
    category: 'work',
    color: '#00AECC',
    lists: [
      { name: 'Làm tốt', status: null, cards: ['Giao tiếp trong nhóm rõ ràng'] },
      { name: 'Cần cải thiện', status: null, cards: ['Họp kéo dài hơn dự kiến'] },
      { name: 'Ý tưởng', status: null, cards: [] },
      { name: 'Việc cần làm', status: 'TODO', cards: [] },
      { name: 'Đã xong', status: 'DONE', cards: [] },
    ],
  },

  // ---- Phần mềm ----
  {
    id: 'sprint',
    name: 'Sprint / Agile',
    description: 'Bảng cho một sprint theo Scrum: backlog → đang làm → kiểm thử → xong.',
    category: 'dev',
    color: '#89609E',
    lists: [
      {
        name: 'Product Backlog',
        status: 'TODO',
        cards: ['Là người dùng, tôi muốn đăng nhập', 'Là người dùng, tôi muốn đổi mật khẩu'],
      },
      { name: 'Sprint Backlog', status: 'TODO', cards: ['Thiết lập CI/CD'] },
      { name: 'Đang làm', status: 'IN_PROGRESS', cards: [] },
      { name: 'Kiểm thử', status: 'IN_REVIEW', cards: [] },
      { name: 'Hoàn thành', status: 'DONE', cards: [] },
    ],
  },
  {
    id: 'bugs',
    name: 'Theo dõi lỗi',
    description: 'Ghi nhận, xác nhận và sửa lỗi; mỗi lỗi qua bước kiểm tra lại trước khi đóng.',
    category: 'dev',
    color: '#B04632',
    labels: [
      { name: 'Nghiêm trọng', color: RED },
      { name: 'Giao diện', color: PURPLE },
      { name: 'Hiệu năng', color: ORANGE },
      { name: 'Bảo mật', color: BLUE },
    ],
    lists: [
      {
        name: 'Mới báo',
        status: 'TODO',
        cards: ['Nút Đăng nhập không phản hồi trên Safari', 'Trang báo cáo tải chậm khi có trên 500 dòng'],
      },
      { name: 'Đã xác nhận', status: 'TODO', cards: [] },
      { name: 'Đang sửa', status: 'IN_PROGRESS', cards: ['Hạn thẻ hiển thị lệch một ngày'] },
      { name: 'Chờ kiểm tra lại', status: 'IN_REVIEW', cards: [] },
      { name: 'Đã sửa', status: 'DONE', cards: [] },
      { name: 'Chưa tái hiện được', status: null, cards: [] },
    ],
  },
  {
    id: 'roadmap',
    name: 'Lộ trình sản phẩm',
    description: 'Xếp tính năng theo quý, từ ý tưởng đến khi phát hành.',
    category: 'dev',
    color: '#00AECC',
    labels: [
      { name: 'Tính năng mới', color: GREEN },
      { name: 'Cải tiến', color: BLUE },
      { name: 'Nợ kỹ thuật', color: YELLOW },
    ],
    lists: [
      { name: 'Ý tưởng', status: null, cards: ['Đăng nhập bằng Google', 'Xuất báo cáo PDF'] },
      { name: 'Quý sau', status: null, cards: [] },
      { name: 'Quý này', status: 'TODO', cards: ['Thông báo đẩy trên di động'] },
      { name: 'Đang triển khai', status: 'IN_PROGRESS', cards: [] },
      { name: 'Đã phát hành', status: 'DONE', cards: [] },
    ],
  },

  // ---- Marketing và bán hàng ----
  {
    id: 'content',
    name: 'Lịch nội dung',
    description: 'Theo dõi bài viết / video từ lúc lên ý tưởng đến khi xuất bản.',
    category: 'marketing',
    color: '#B04632',
    lists: [
      { name: 'Ý tưởng', status: null, cards: ['Chủ đề: Mẹo năng suất', 'Chủ đề: Review công cụ'] },
      { name: 'Đang viết', status: 'IN_PROGRESS', cards: [] },
      { name: 'Chờ duyệt', status: 'IN_REVIEW', cards: [] },
      { name: 'Đã lên lịch', status: null, cards: [] },
      { name: 'Đã đăng', status: 'DONE', cards: [] },
    ],
  },
  {
    id: 'campaign',
    name: 'Chiến dịch marketing',
    description: 'Từ brief đến báo cáo kết quả; mỗi kênh hoặc mỗi sản phẩm một thẻ.',
    category: 'marketing',
    color: '#D29034',
    labels: [
      { name: 'Mạng xã hội', color: BLUE },
      { name: 'Email', color: YELLOW },
      { name: 'Quảng cáo trả phí', color: RED },
      { name: 'Báo chí', color: GREEN },
    ],
    lists: [
      {
        name: 'Brief và mục tiêu',
        status: 'TODO',
        cards: ['Xác định mục tiêu và ngân sách', 'Chọn kênh triển khai'],
      },
      { name: 'Sản xuất nội dung', status: 'IN_PROGRESS', cards: ['Thiết kế bộ ảnh quảng cáo'] },
      { name: 'Chờ duyệt', status: 'IN_REVIEW', cards: [] },
      { name: 'Đang chạy', status: 'IN_PROGRESS', cards: [] },
      { name: 'Đã có báo cáo', status: 'DONE', cards: [] },
    ],
  },
  {
    id: 'sales',
    name: 'Quy trình bán hàng',
    description: 'Đưa khách hàng tiềm năng qua từng bước cho tới khi chốt đơn.',
    category: 'marketing',
    color: '#519839',
    labels: [
      { name: 'Nóng', color: RED },
      { name: 'Ấm', color: ORANGE },
      { name: 'Lạnh', color: BLUE },
    ],
    lists: [
      {
        name: 'Khách tiềm năng',
        status: 'TODO',
        cards: ['Công ty ABC – cần báo giá phần mềm', 'Cửa hàng XYZ – hỏi gói dịch vụ'],
      },
      { name: 'Đã liên hệ', status: 'IN_PROGRESS', cards: [] },
      { name: 'Đã gửi báo giá', status: 'IN_REVIEW', cards: [] },
      { name: 'Đang đàm phán', status: 'IN_PROGRESS', cards: [] },
      { name: 'Chốt đơn', status: 'DONE', cards: [] },
      { name: 'Không thành công', status: null, cards: [] },
    ],
  },

  // ---- Học tập ----
  {
    id: 'exam',
    name: 'Ôn thi học kỳ',
    description: 'Chia môn học thành chủ đề nhỏ và theo dõi mức độ nắm vững.',
    category: 'study',
    color: '#4BBF6B',
    lists: [
      { name: 'Cần ôn', status: 'TODO', cards: ['Giải tích: chương 1–3', 'Tiếng Anh: từ vựng unit 1–5'] },
      { name: 'Đang ôn', status: 'IN_PROGRESS', cards: [] },
      { name: 'Cần hỏi lại', status: 'BLOCKED', cards: [] },
      { name: 'Đã nắm vững', status: 'DONE', cards: [] },
    ],
  },
  {
    id: 'group-project',
    name: 'Bài tập nhóm',
    description: 'Phân việc, theo dõi tiến độ và nộp bài đúng hạn cho dự án môn học.',
    category: 'study',
    color: '#89609E',
    lists: [
      { name: 'Cần phân công', status: 'TODO', cards: ['Chọn đề tài', 'Chia phần báo cáo'] },
      { name: 'Đang làm', status: 'IN_PROGRESS', cards: [] },
      { name: 'Chờ nhóm trưởng duyệt', status: 'IN_REVIEW', cards: [] },
      { name: 'Đã nộp', status: 'DONE', cards: [] },
    ],
  },
  {
    id: 'thesis',
    name: 'Khoá luận tốt nghiệp',
    description: 'Bám sát tiến độ làm khoá luận và trao đổi với giảng viên hướng dẫn.',
    category: 'study',
    color: '#D29034',
    lists: [
      {
        name: 'Tài liệu cần đọc',
        status: 'TODO',
        cards: ['Tìm 5 bài báo liên quan', 'Đọc chương cơ sở lý thuyết'],
      },
      { name: 'Đang nghiên cứu', status: 'IN_PROGRESS', cards: [] },
      { name: 'Đang viết', status: 'IN_PROGRESS', cards: ['Viết chương 1: Giới thiệu'] },
      { name: 'Chờ GVHD phản hồi', status: 'IN_REVIEW', cards: [] },
      { name: 'Đã chỉnh sửa xong', status: 'DONE', cards: [] },
    ],
  },

  // ---- Cá nhân ----
  {
    id: 'personal',
    name: 'Việc cá nhân',
    description: 'Sắp xếp việc riêng theo mức độ ưu tiên về thời gian.',
    category: 'life',
    color: '#00AECC',
    lists: [
      { name: 'Hôm nay', status: null, cards: ['Tập thể dục 30 phút'] },
      { name: 'Tuần này', status: null, cards: ['Đọc xong 1 cuốn sách'] },
      { name: 'Sau này', status: null, cards: [] },
      { name: 'Đang chờ', status: 'BLOCKED', cards: [] },
      { name: 'Xong', status: 'DONE', cards: [] },
    ],
  },
  {
    id: 'travel',
    name: 'Kế hoạch du lịch',
    description: 'Gom địa điểm, đặt chỗ và chuẩn bị đồ cho chuyến đi.',
    category: 'life',
    color: '#0079BF',
    lists: [
      { name: 'Địa điểm muốn đi', status: null, cards: ['Đà Lạt', 'Hội An'] },
      { name: 'Cần đặt trước', status: 'TODO', cards: ['Vé máy bay', 'Phòng khách sạn'] },
      { name: 'Đã đặt', status: 'DONE', cards: [] },
      { name: 'Chuẩn bị hành lý', status: 'TODO', cards: ['Giấy tờ tuỳ thân', 'Sạc dự phòng'] },
      { name: 'Lịch trình theo ngày', status: null, cards: [] },
    ],
  },
];

export function getTemplate(id: string): BoardTemplate | undefined {
  return BOARD_TEMPLATES.find((t) => t.id === id);
}
