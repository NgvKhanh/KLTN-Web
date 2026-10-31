/** Coverage inventory for the data tools delivered in steps 1–3. Help retrieval follows in step 7. */
export const CHAT_V2_CAPABILITIES = [
  { module: 'board', data: 'SUPPORTED', help: 'PLANNED', detail: 'Nhận diện, danh sách, vai trò của người hỏi và thống kê thẻ theo bảng.' },
  { module: 'workspace', data: 'SUPPORTED', help: 'PLANNED', detail: 'Nhận diện, danh sách, vai trò của người hỏi, số bảng đọc được và số thành viên.' },
  { module: 'card', data: 'SUPPORTED', help: 'PLANNED', detail: 'Lọc, phân trang, số đếm, hạn, trạng thái, người phụ trách; chưa trả nội dung mô tả.' },
  { module: 'list', data: 'SUPPORTED', help: 'PLANNED', detail: 'Nhận diện cột, lọc theo cột và nhóm số thẻ theo cột.' },
  { module: 'label', data: 'PARTIAL', help: 'PLANNED', detail: 'Lọc bằng ID nhãn đã kiểm quyền; chưa có công cụ danh mục nhãn theo tên.' },
  { module: 'checklist', data: 'NOT_SUPPORTED', help: 'PLANNED', detail: 'Người nhận item không được tính như người nhận thẻ.' },
  { module: 'activity', data: 'PARTIAL', help: 'PLANNED', detail: 'Các loại sự kiện trong schema; chỉ theo nhật ký đã ghi nhận, không phục dựng giá trị cũ bị thiếu.' },
  { module: 'notification', data: 'NOT_SUPPORTED', help: 'PLANNED', detail: 'Chưa truy vấn thông báo của người hỏi.' },
  { module: 'automation', data: 'NOT_SUPPORTED', help: 'PLANNED', detail: 'Chưa truy vấn cấu hình tự động hóa.' },
  { module: 'customField', data: 'NOT_SUPPORTED', help: 'PLANNED', detail: 'Chưa lọc hoặc tổng hợp giá trị trường tùy chỉnh.' },
  { module: 'ai', data: 'NOT_SUPPORTED', help: 'PLANNED', detail: 'Chưa truy vấn kết quả/lịch sử sinh bảng AI.' },
  { module: 'assign', data: 'NOT_SUPPORTED', help: 'PLANNED', detail: 'Chưa truy vấn lịch sử gợi ý phân công hoặc hồ sơ/CV.' },
] as const;
