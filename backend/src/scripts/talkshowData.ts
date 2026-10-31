// Du lieu SOAN TAY cho bo demo "Ban to chuc Talk show": 10 nguoi (truong nhom + 9 thanh vien), ho so chuyen mon cua tung
// nguoi (ky nang, cong viec da lam, CV), mot bang lon da chia san viec va mot bang talk show CU da xong (de moi nguoi co lich
// su lam viec dung chuyen mon - module goi y phan cong doc lich su nay). File nay CHI CO DU LIEU, khong dung CSDL; phan ghi
// nam o seedTalkshow.ts.
//
// Moi moc thoi gian la ngay/gio THEO GIO VIET NAM, dang 'YYYY-MM-DD' hoac 'YYYY-MM-DD HH:mm'. Talk show dien ra thu Bay
// 14/11/2026; bang duoc soan theo moc "hom nay" la 06/10/2026 (viec truoc moc nay da xong / dang lam, sau moc nay chua lam).

export type PersonKey =
  | 'lead'
  | 'kythuat'
  | 'thietke'
  | 'noidung'
  | 'khachmoi'
  | 'truyenthong'
  | 'taitro'
  | 'haucan'
  | 'sankhau'
  | 'media';

export const LABELS = {
  'Điều phối': '#8590a2',
  'Nội dung': '#579dff',
  'Khách mời': '#9f8fef',
  'Truyền thông': '#e774bb',
  'Thiết kế': '#fea362',
  'Tài trợ': '#4bce97',
  'Hậu cần': '#f5cd47',
  'Kỹ thuật': '#6cc3e0',
  'Sân khấu': '#94c748',
  'Quay dựng': '#f87168',
} as const;
export type LabelName = keyof typeof LABELS;

export const PHASES = {
  'Khởi động': '#579dff',
  'Chuẩn bị': '#4bce97',
  'Nước rút': '#fea362',
  'Ngày diễn ra': '#f87168',
  'Sau sự kiện': '#9f8fef',
} as const;
export type PhaseName = keyof typeof PHASES;

export const PRIORITIES = { Cao: '#f87168', 'Trung bình': '#f5cd47', Thấp: '#4bce97' } as const;
export type PriorityName = keyof typeof PRIORITIES;

export type ListKey = 'TODO' | 'IN_PROGRESS' | 'IN_REVIEW' | 'BLOCKED' | 'DONE';

export const EMAIL_DOMAIN = 'talkshow.test';
export const WORKSPACE_NAME = 'Ban tổ chức Talk show';
/** Moc "hom nay" khi soan du lieu - script tu choi ghi neu co the DA XONG sau moc nay. */
export const AUTHORED_TODAY = '2026-10-06';

// ===================== Nguoi =====================

export interface CvExperience {
  time: string;
  title: string;
  bullets: string[];
}

export interface CvContent {
  headline: string;
  objective: string;
  education: string;
  experiences: CvExperience[];
  tools: string[];
  achievements: string[];
}

export interface TalkshowPerson {
  key: PersonKey;
  /** true = tai khoan CO SAN cua nhom: script chi tim theo email, KHONG doi ten / mat khau / CV. */
  existing: boolean;
  email: string;
  /** Ten hien thi khi TAO tai khoan moi (tai khoan co san giu ten cua ho). */
  name: string;
  department: string;
  /** Nhan chinh cua mang nguoi nay phu trach. */
  label: LabelName;
  /** So the song song toi da (MemberWorkProfile.maxParallelCards). */
  capacity: number;
  workspaceRole: 'OWNER' | 'ADMIN' | 'MEMBER';
  skills: string[];
  workItems: { title: string; description: string }[];
  /** CV sinh thanh tep .docx; null = khong tao CV (tai khoan co san giu CV cua ho). */
  cv: CvContent | null;
}

/** Nguoi dau tien la truong nhom (chu khong gian, chu bang, nguoi giao viec). */
export const PEOPLE: readonly TalkshowPerson[] = [
  {
    key: 'lead',
    existing: true,
    email: 'quockhanh9876543@gmail.com',
    name: 'Khanh Quoc',
    department: 'Trưởng ban tổ chức (điều phối chung, ngân sách)',
    label: 'Điều phối',
    capacity: 6,
    workspaceRole: 'OWNER',
    skills: [
      'Quản lý dự án sự kiện',
      'Lập kế hoạch tổng thể và timeline',
      'Lập dự toán và theo dõi ngân sách',
      'Điều phối nhân sự ban tổ chức',
      'Làm việc với nhà trường và đối tác',
      'Điều phối tổng duyệt và ngày diễn ra',
      'Báo cáo tổng kết và quyết toán sự kiện',
    ],
    workItems: [
      {
        title: 'Trưởng ban tổ chức talk show “Khởi nghiệp từ giảng đường” (06/2026)',
        description:
          'Điều phối 10 thành viên, lập kế hoạch và timeline 7 tuần, quản lý ngân sách 62 triệu đồng, chương trình đạt 280 khán giả trực tiếp.',
      },
      {
        title: 'Phó ban sự kiện Ngày hội việc làm sinh viên 2025',
        description: 'Lập kế hoạch tổng, làm việc với nhà trường xin địa điểm, điều phối tổng duyệt và ngày diễn ra.',
      },
      {
        title: 'Phụ trách ngân sách chương trình Chào tân sinh viên 2025',
        description: 'Lập dự toán, theo dõi thu chi, quyết toán và báo cáo tài chính sau chương trình.',
      },
    ],
    cv: null,
  },
  {
    key: 'kythuat',
    existing: true,
    email: 'nguyenkhanh30032005@gmail.com',
    name: 'khanh nguyen',
    department: 'Kỹ thuật số (trang đăng ký, check-in QR, livestream)',
    label: 'Kỹ thuật',
    capacity: 5,
    workspaceRole: 'MEMBER',
    skills: [
      'ReactJS',
      'Node.js',
      'Làm landing page và form đăng ký',
      'Gửi email xác nhận tự động',
      'Check-in bằng mã QR',
      'Livestream bằng OBS',
      'Thống kê số liệu bằng Google Sheets',
    ],
    workItems: [
      {
        title: 'Làm trang đăng ký cho talk show “Khởi nghiệp từ giảng đường” (06/2026)',
        description: 'Landing page và form đăng ký, gửi email xác nhận kèm mã QR, check-in 280 khán giả bằng mã QR tại cửa.',
      },
      {
        title: 'Phụ trách livestream Ngày hội câu lạc bộ 2025',
        description: 'Thiết lập OBS với 2 máy quay, phát trực tiếp lên fanpage, theo dõi đường truyền suốt chương trình.',
      },
      {
        title: 'Đồ án website quản lý công việc nhóm',
        description: 'Xây dựng ứng dụng web bằng ReactJS và Node.js, có đăng nhập, bảng công việc và thông báo thời gian thực.',
      },
    ],
    cv: null,
  },
  {
    key: 'thietke',
    existing: true,
    email: 'nguyenhuyqp2025@gmail.com',
    name: 'Mr Zai đẹp',
    department: 'Thiết kế đồ hoạ và nhận diện sự kiện',
    label: 'Thiết kế',
    capacity: 5,
    workspaceRole: 'MEMBER',
    skills: [
      'Thiết kế đồ hoạ',
      'Bộ nhận diện sự kiện',
      'Poster và ấn phẩm mạng xã hội',
      'Backdrop và standee',
      'Slide trình chiếu',
      'Adobe Photoshop',
      'Adobe Illustrator',
      'Figma',
      'Canva',
    ],
    workItems: [
      {
        title: 'Thiết kế bộ nhận diện talk show “Khởi nghiệp từ giảng đường” (06/2026)',
        description: 'Logo, bảng màu, poster công bố, ảnh giới thiệu diễn giả, backdrop sân khấu 6m × 3m và slide trình chiếu.',
      },
      {
        title: 'Thiết kế ấn phẩm Ngày hội việc làm sinh viên 2025',
        description: 'Poster, banner, standee và bộ ảnh đếm ngược đăng fanpage.',
      },
      {
        title: 'Thiết kế backdrop đêm văn nghệ khoa',
        description: 'Backdrop sân khấu, vé mời và thẻ ban tổ chức; làm việc với xưởng in để chỉnh file in.',
      },
    ],
    cv: null,
  },
  {
    key: 'noidung',
    existing: false,
    email: `ha.tran@${EMAIL_DOMAIN}`,
    name: 'Trần Thu Hà',
    department: 'Phó ban – nội dung và kịch bản',
    label: 'Nội dung',
    capacity: 5,
    workspaceRole: 'ADMIN',
    skills: [
      'Biên tập nội dung',
      'Viết kịch bản chương trình',
      'Soạn câu hỏi phỏng vấn diễn giả',
      'Kịch bản và lời dẫn MC',
      'Khảo sát khán giả',
      'Điều phối phần hỏi đáp',
      'Viết bài tổng kết',
    ],
    workItems: [
      {
        title: 'Trưởng nhóm nội dung talk show “Khởi nghiệp từ giảng đường” (06/2026)',
        description: 'Xây dựng nội dung 2 phiên thảo luận, soạn câu hỏi cho diễn giả, viết kịch bản và lời dẫn MC.',
      },
      {
        title: 'Biên tập viên bản tin sinh viên của khoa',
        description: 'Viết và biên tập bài phỏng vấn cựu sinh viên, bài tổng kết sự kiện hằng tháng.',
      },
      {
        title: 'Thiết kế khảo sát nhu cầu sinh viên về hướng nghiệp',
        description: 'Soạn phiếu khảo sát 15 câu, thu 250 phản hồi và tổng hợp thành báo cáo chủ đề quan tâm.',
      },
    ],
    cv: {
      headline: 'Biên tập nội dung – Viết kịch bản sự kiện',
      objective:
        'Sinh viên năm 3 ngành Báo chí, mong muốn phát triển ở vị trí biên tập nội dung và sản xuất chương trình. Mạnh về xây dựng mạch nội dung, đặt câu hỏi phỏng vấn và viết kịch bản dẫn chương trình.',
      education: 'Cử nhân Báo chí (năm 3), điểm trung bình 3,4/4',
      experiences: [
        {
          time: '05/2026 – 07/2026',
          title: 'Trưởng nhóm nội dung – Talk show “Khởi nghiệp từ giảng đường”',
          bullets: [
            'Xây dựng nội dung 2 phiên thảo luận về khởi nghiệp sinh viên.',
            'Soạn bộ 14 câu hỏi cho diễn giả, viết kịch bản chương trình và lời dẫn MC.',
            'Tổng hợp câu hỏi của khán giả để chọn câu cho phần hỏi đáp.',
          ],
        },
        {
          time: '09/2025 – nay',
          title: 'Biên tập viên – Bản tin sinh viên của khoa',
          bullets: ['Viết bài phỏng vấn cựu sinh viên.', 'Biên tập bài tổng kết sự kiện hằng tháng.'],
        },
      ],
      tools: ['Google Docs', 'Google Forms', 'Notion', 'Slido'],
      achievements: ['Giải Nhì cuộc thi viết “Sinh viên và nghề báo” cấp trường 2025'],
    },
  },
  {
    key: 'khachmoi',
    existing: false,
    email: `minh.le@${EMAIL_DOMAIN}`,
    name: 'Lê Hoàng Minh',
    department: 'Khách mời và diễn giả',
    label: 'Khách mời',
    capacity: 4,
    workspaceRole: 'MEMBER',
    skills: [
      'Mời và chăm sóc diễn giả',
      'Soạn thư mời trang trọng',
      'Đàm phán lịch trình khách mời',
      'Lễ tân và đón tiếp',
      'Giao tiếp tiếng Anh',
      'Chuẩn bị quà tặng khách mời',
    ],
    workItems: [
      {
        title: 'Phụ trách diễn giả talk show “Khởi nghiệp từ giảng đường” (06/2026)',
        description: 'Lên danh sách, mời và xác nhận lịch 2 diễn giả và MC; thu tiểu sử, ảnh chân dung; đón tiếp ngày diễn ra.',
      },
      {
        title: 'Lễ tân Hội thảo khoa học sinh viên 2025',
        description: 'Đón tiếp khách mời, hướng dẫn chỗ ngồi, chuẩn bị phòng chờ và quà tặng.',
      },
      {
        title: 'Thành viên ban đối ngoại câu lạc bộ tiếng Anh',
        description: 'Liên hệ khách mời nước ngoài, soạn thư mời song ngữ, sắp xếp lịch trình.',
      },
    ],
    cv: {
      headline: 'Quan hệ khách mời – Đối ngoại sự kiện',
      objective:
        'Sinh viên năm 3 ngành Quan hệ công chúng, mong muốn làm công việc đối ngoại và chăm sóc khách mời cho các sự kiện, hội thảo chuyên nghiệp.',
      education: 'Cử nhân Quan hệ công chúng (năm 3), IELTS 7.0',
      experiences: [
        {
          time: '05/2026 – 06/2026',
          title: 'Phụ trách diễn giả – Talk show “Khởi nghiệp từ giảng đường”',
          bullets: [
            'Lên danh sách diễn giả là nhà sáng lập startup, gửi thư mời và xác nhận lịch.',
            'Mời MC, gửi kịch bản và lịch trình trước chương trình.',
            'Đón tiếp, chuẩn bị phòng chờ và quà tặng cho diễn giả.',
          ],
        },
        {
          time: '03/2025 – 12/2025',
          title: 'Ban đối ngoại – Câu lạc bộ tiếng Anh',
          bullets: ['Liên hệ khách mời nước ngoài, soạn thư mời song ngữ.', 'Lễ tân Hội thảo khoa học sinh viên 2025.'],
        },
      ],
      tools: ['Gmail', 'Google Calendar', 'Zoom', 'Google Sheets'],
      achievements: ['Thành viên xuất sắc ban đối ngoại câu lạc bộ tiếng Anh năm 2025'],
    },
  },
  {
    key: 'truyenthong',
    existing: false,
    email: `anh.pham@${EMAIL_DOMAIN}`,
    name: 'Phạm Ngọc Anh',
    department: 'Truyền thông và mạng xã hội',
    label: 'Truyền thông',
    capacity: 5,
    workspaceRole: 'MEMBER',
    skills: [
      'Lập kế hoạch truyền thông',
      'Quản trị fanpage',
      'Viết bài mạng xã hội',
      'Chạy quảng cáo Facebook',
      'Đo lường tiếp cận và tương tác',
      'Kết nối câu lạc bộ và cộng đồng sinh viên',
      'Đưa tin trực tiếp sự kiện',
    ],
    workItems: [
      {
        title: 'Trưởng nhóm truyền thông talk show “Khởi nghiệp từ giảng đường” (06/2026)',
        description: 'Lập kế hoạch truyền thông 5 tuần, viết bài giới thiệu diễn giả, chạy quảng cáo, đạt 410 lượt đăng ký.',
      },
      {
        title: 'Quản trị fanpage câu lạc bộ kỹ năng (8.000 người theo dõi)',
        description: 'Lên lịch đăng bài hằng tuần, viết nội dung, theo dõi số liệu tiếp cận và tương tác.',
      },
      {
        title: 'Chạy quảng cáo tuyển thành viên câu lạc bộ 2025',
        description: 'Ngân sách 3 triệu đồng, nhắm sinh viên năm nhất, chi phí 4.500 đồng mỗi lượt đăng ký.',
      },
    ],
    cv: {
      headline: 'Truyền thông mạng xã hội – Content Marketing',
      objective:
        'Sinh viên năm 3 ngành Marketing, định hướng truyền thông số. Có kinh nghiệm lập kế hoạch truyền thông, viết nội dung và chạy quảng cáo cho các sự kiện sinh viên.',
      education: 'Cử nhân Marketing (năm 3), chứng chỉ Meta Digital Marketing Associate',
      experiences: [
        {
          time: '05/2026 – 07/2026',
          title: 'Trưởng nhóm truyền thông – Talk show “Khởi nghiệp từ giảng đường”',
          bullets: [
            'Lập kế hoạch truyền thông 5 tuần với KPI tiếp cận và đăng ký.',
            'Viết chuỗi bài giới thiệu diễn giả, chạy quảng cáo kêu gọi đăng ký.',
            'Đưa tin trực tiếp và đăng bài tổng kết sau chương trình.',
          ],
        },
        {
          time: '01/2025 – nay',
          title: 'Quản trị fanpage – Câu lạc bộ kỹ năng',
          bullets: ['Lên lịch và viết bài hằng tuần cho fanpage 8.000 người theo dõi.', 'Báo cáo số liệu tiếp cận, tương tác hằng tháng.'],
        },
      ],
      tools: ['Meta Business Suite', 'Canva', 'CapCut', 'Google Analytics'],
      achievements: ['Top 10 cuộc thi “Chiến dịch truyền thông sinh viên” 2025'],
    },
  },
  {
    key: 'taitro',
    existing: false,
    email: `vinh.do@${EMAIL_DOMAIN}`,
    name: 'Đỗ Quang Vinh',
    department: 'Tài trợ và đối ngoại doanh nghiệp',
    label: 'Tài trợ',
    capacity: 4,
    workspaceRole: 'MEMBER',
    skills: [
      'Tìm kiếm nhà tài trợ',
      'Soạn hồ sơ tài trợ',
      'Đàm phán và ký hợp đồng tài trợ',
      'Chăm sóc đối tác doanh nghiệp',
      'Quản lý quyền lợi nhà tài trợ',
      'Báo cáo hiệu quả tài trợ',
    ],
    workItems: [
      {
        title: 'Trưởng nhóm tài trợ talk show “Khởi nghiệp từ giảng đường” (06/2026)',
        description: 'Soạn hồ sơ tài trợ, gửi thư mời 25 doanh nghiệp, ký 3 hợp đồng với tổng giá trị 45 triệu đồng.',
      },
      {
        title: 'Ban đối ngoại Ngày hội việc làm sinh viên 2025',
        description: 'Mời 12 doanh nghiệp tham gia gian hàng tuyển dụng, theo dõi quyền lợi và gửi thư cảm ơn.',
      },
      {
        title: 'Thực tập sinh kinh doanh tại một công ty truyền thông',
        description: 'Tìm kiếm khách hàng, chuẩn bị báo giá và theo dõi hợp đồng.',
      },
    ],
    cv: {
      headline: 'Tài trợ – Đối ngoại doanh nghiệp',
      objective:
        'Sinh viên năm 4 ngành Quản trị kinh doanh, mạnh về tìm kiếm và đàm phán với doanh nghiệp, mong muốn làm ở vị trí phát triển đối tác.',
      education: 'Cử nhân Quản trị kinh doanh (năm 4)',
      experiences: [
        {
          time: '05/2026 – 07/2026',
          title: 'Trưởng nhóm tài trợ – Talk show “Khởi nghiệp từ giảng đường”',
          bullets: [
            'Soạn hồ sơ tài trợ với 3 gói quyền lợi.',
            'Gửi thư mời 25 doanh nghiệp, đàm phán và ký 3 hợp đồng (45 triệu đồng).',
            'Theo dõi thực hiện quyền lợi tại sự kiện, gửi báo cáo và thư cảm ơn.',
          ],
        },
        {
          time: '06/2025 – 09/2025',
          title: 'Thực tập sinh kinh doanh – Công ty truyền thông',
          bullets: ['Tìm kiếm khách hàng, chuẩn bị báo giá.', 'Theo dõi tiến độ hợp đồng và chăm sóc khách hàng.'],
        },
      ],
      tools: ['Google Slides', 'Google Sheets', 'Canva', 'HubSpot CRM'],
      achievements: ['Kêu gọi tài trợ vượt 120% mục tiêu cho Ngày hội việc làm 2025'],
    },
  },
  {
    key: 'haucan',
    existing: false,
    email: `lan.vu@${EMAIL_DOMAIN}`,
    name: 'Vũ Thị Lan',
    department: 'Hậu cần và địa điểm',
    label: 'Hậu cần',
    capacity: 5,
    workspaceRole: 'MEMBER',
    skills: [
      'Hậu cần sự kiện',
      'Đặt địa điểm và hội trường',
      'Làm việc với nhà cung cấp in ấn',
      'Tea-break và suất ăn',
      'Sơ đồ chỗ ngồi và khu check-in',
      'Quản lý tình nguyện viên',
      'Kiểm kê thiết bị và vật tư',
    ],
    workItems: [
      {
        title: 'Trưởng ban hậu cần talk show “Khởi nghiệp từ giảng đường” (06/2026)',
        description: 'Đặt hội trường, in ấn backdrop và standee, tea-break 300 khách, bố trí chỗ ngồi, quản lý 18 tình nguyện viên.',
      },
      {
        title: 'Hậu cần Chào tân sinh viên 2025',
        description: 'Lên danh sách vật tư, làm việc với nhà cung cấp, kiểm kê và trả đồ sau chương trình.',
      },
      {
        title: 'Điều phối tình nguyện viên Giải chạy vì cộng đồng',
        description: 'Tuyển, tập huấn và phân ca cho 40 tình nguyện viên.',
      },
    ],
    cv: {
      headline: 'Hậu cần sự kiện – Điều phối vận hành',
      objective:
        'Sinh viên năm 3 ngành Quản trị sự kiện, cẩn thận và chi tiết, mong muốn phát triển ở vị trí điều phối vận hành sự kiện.',
      education: 'Cử nhân Quản trị dịch vụ du lịch và lữ hành – chuyên ngành sự kiện (năm 3)',
      experiences: [
        {
          time: '05/2026 – 06/2026',
          title: 'Trưởng ban hậu cần – Talk show “Khởi nghiệp từ giảng đường”',
          bullets: [
            'Khảo sát và đặt hội trường 300 chỗ.',
            'Đặt in ấn backdrop, standee, vé mời; đặt tea-break và nước uống.',
            'Bố trí chỗ ngồi, bàn check-in; tuyển và phân công 18 tình nguyện viên.',
          ],
        },
        {
          time: '08/2025 – 10/2025',
          title: 'Hậu cần – Chào tân sinh viên 2025',
          bullets: ['Làm việc với nhà cung cấp vật tư.', 'Kiểm kê và trả thiết bị sau chương trình.'],
        },
      ],
      tools: ['Google Sheets', 'Google Forms', 'Zalo nhóm', 'Draw.io (sơ đồ mặt bằng)'],
      achievements: ['Tình nguyện viên tiêu biểu Giải chạy vì cộng đồng 2025'],
    },
  },
  {
    key: 'sankhau',
    existing: false,
    email: `thang.bui@${EMAIL_DOMAIN}`,
    name: 'Bùi Đức Thắng',
    department: 'Sân khấu, âm thanh và ánh sáng',
    label: 'Sân khấu',
    capacity: 4,
    workspaceRole: 'MEMBER',
    skills: [
      'Âm thanh sân khấu',
      'Ánh sáng sân khấu',
      'Vận hành bàn mixer',
      'Màn hình LED và máy chiếu',
      'Bố trí sân khấu',
      'Nhạc nền và hiệu ứng chuyển cảnh',
      'Kiểm tra thiết bị trước chương trình',
    ],
    workItems: [
      {
        title: 'Phụ trách sân khấu talk show “Khởi nghiệp từ giảng đường” (06/2026)',
        description: 'Lấy báo giá và thuê âm thanh ánh sáng, bố trí sân khấu, chuẩn bị nhạc nền, vận hành ngày diễn ra.',
      },
      {
        title: 'Kỹ thuật âm thanh câu lạc bộ âm nhạc',
        description: 'Vận hành bàn mixer 16 kênh cho các đêm nhạc acoustic, cân chỉnh micro và loa monitor.',
      },
      {
        title: 'Kỹ thuật viên đêm văn nghệ khoa',
        description: 'Lên cue ánh sáng theo kịch bản, điều khiển màn LED và máy chiếu.',
      },
    ],
    cv: {
      headline: 'Kỹ thuật sân khấu – Âm thanh và ánh sáng',
      objective:
        'Sinh viên năm 3 ngành Kỹ thuật điện tử, đam mê kỹ thuật sân khấu, mong muốn làm kỹ thuật viên âm thanh ánh sáng cho sự kiện.',
      education: 'Kỹ sư Kỹ thuật điện tử – viễn thông (năm 3)',
      experiences: [
        {
          time: '05/2026 – 06/2026',
          title: 'Phụ trách sân khấu – Talk show “Khởi nghiệp từ giảng đường”',
          bullets: [
            'Lấy báo giá 3 đơn vị, thuê âm thanh ánh sáng trong ngân sách.',
            'Bố trí sân khấu, vị trí ghế diễn giả và máy quay.',
            'Chuẩn bị nhạc nền, vận hành âm thanh ánh sáng ngày diễn ra.',
          ],
        },
        {
          time: '2024 – nay',
          title: 'Kỹ thuật âm thanh – Câu lạc bộ âm nhạc',
          bullets: ['Vận hành bàn mixer 16 kênh.', 'Cân chỉnh micro không dây và loa monitor.'],
        },
      ],
      tools: ['Bàn mixer Yamaha MG16', 'QLC+ (điều khiển ánh sáng)', 'Ableton Live', 'Resolume'],
      achievements: ['Vận hành kỹ thuật cho 12 đêm nhạc acoustic không sự cố'],
    },
  },
  {
    key: 'media',
    existing: false,
    email: `linh.ngo@${EMAIL_DOMAIN}`,
    name: 'Ngô Phương Linh',
    department: 'Quay chụp và dựng video',
    label: 'Quay dựng',
    capacity: 4,
    workspaceRole: 'MEMBER',
    skills: [
      'Quay phim sự kiện',
      'Chụp ảnh sự kiện',
      'Dựng video bằng Premiere Pro',
      'CapCut',
      'Video ngắn Reels và TikTok',
      'Kịch bản quay và danh sách cảnh',
      'Phỏng vấn trước máy quay',
    ],
    workItems: [
      {
        title: 'Phụ trách quay dựng talk show “Khởi nghiệp từ giảng đường” (06/2026)',
        description: 'Quay dựng video teaser, phỏng vấn diễn giả, chụp ảnh ngày diễn ra, dựng video highlight và 5 video ngắn.',
      },
      {
        title: 'Quay phim câu lạc bộ truyền hình sinh viên',
        description: 'Quay và dựng phóng sự ngắn 3–5 phút về hoạt động sinh viên.',
      },
      {
        title: 'Chụp ảnh kỷ yếu và sự kiện khoa',
        description: 'Chụp ảnh sự kiện, chỉnh màu bằng Lightroom và bàn giao trong 48 giờ.',
      },
    ],
    cv: {
      headline: 'Quay phim – Dựng video sự kiện',
      objective:
        'Sinh viên năm 2 ngành Truyền thông đa phương tiện, yêu thích kể chuyện bằng hình ảnh, mong muốn làm quay dựng cho sự kiện và mạng xã hội.',
      education: 'Cử nhân Truyền thông đa phương tiện (năm 2)',
      experiences: [
        {
          time: '05/2026 – 07/2026',
          title: 'Phụ trách quay dựng – Talk show “Khởi nghiệp từ giảng đường”',
          bullets: [
            'Quay và dựng video teaser, phỏng vấn ngắn diễn giả.',
            'Chụp ảnh và quay phim ngày diễn ra với 2 máy quay.',
            'Dựng video highlight 3 phút và cắt video ngắn đăng Reels, TikTok.',
          ],
        },
        {
          time: '2025 – nay',
          title: 'Quay phim – Câu lạc bộ truyền hình sinh viên',
          bullets: ['Quay và dựng phóng sự ngắn về hoạt động sinh viên.', 'Chụp ảnh sự kiện khoa, chỉnh màu bằng Lightroom.'],
        },
      ],
      tools: ['Adobe Premiere Pro', 'CapCut', 'Lightroom', 'Máy ảnh Sony A7 III', 'Gimbal DJI RS 3'],
      achievements: ['Giải Ba cuộc thi phim ngắn sinh viên 2025'],
    },
  },
];

// ===================== The =====================

/** [noi dung, da xong?, nguoi phu trach muc, han cua muc] */
export type ChecklistItemDef = readonly [content: string, done: boolean, assignee?: PersonKey | null, due?: string | null];

export interface ChecklistDef {
  title: string;
  items: readonly ChecklistItemDef[];
}

/** [nguoi viet, luc, noi dung] */
export type CommentDef = readonly [author: PersonKey, at: string, text: string];

export interface CardDef {
  title: string;
  description: string;
  list: ListKey;
  /** Nguoi nhan viec; nguoi dau tien la nguoi chiu trach nhiem chinh. */
  members: readonly PersonKey[];
  labels: readonly LabelName[];
  start: string;
  due: string;
  /** Bat buoc voi the DONE, cam voi the khac. */
  done?: string;
  /** Luc keo sang cot hien tai (IN_REVIEW / BLOCKED). Mac dinh: ngay bat dau. */
  movedAt?: string;
  phase: PhaseName;
  priority: PriorityName;
  budget?: number;
  contact?: string;
  cover?: string;
  checklists?: readonly ChecklistDef[];
  comments?: readonly CommentDef[];
}

export const MAIN_BOARD = {
  name: 'Talk show “Gen Z & nghề nghiệp thời AI” – 14/11/2026',
  color: '#89609E',
  lists: [
    { key: 'TODO', name: 'Việc cần làm' },
    { key: 'IN_PROGRESS', name: 'Đang thực hiện' },
    { key: 'IN_REVIEW', name: 'Chờ duyệt' },
    { key: 'BLOCKED', name: 'Đang vướng' },
    { key: 'DONE', name: 'Hoàn thành' },
  ] as const satisfies readonly { key: ListKey; name: string }[],
  /** Truong nhom tao bang toi hom truoc buoi hop khoi dong. */
  createdAt: '2026-09-13 21:00',
  /** Luc chot ke hoach tong (the "Lap ke hoach tong the" xong): the cua cac giai doan sau duoc tao tu luc nay. */
  plannedAt: '2026-09-18 22:00',
};

export const MAIN_CARDS: readonly CardDef[] = [
  // ---------- Truong ban to chuc ----------
  {
    title: 'Chốt mục tiêu, chủ đề và hình thức talk show',
    description:
      '**Chủ đề:** “Gen Z & nghề nghiệp thời AI” – AI đang thay đổi tuyển dụng và công việc của người trẻ như thế nào, sinh viên cần chuẩn bị gì.\n\n' +
      '**Thông tin chốt trong buổi họp khởi động:**\n' +
      '- Thời gian: 14:00–17:00 thứ Bảy 14/11/2026\n' +
      '- Địa điểm: Hội trường lớn, tầng 3 nhà A2\n' +
      '- Quy mô: 300 khán giả trực tiếp + livestream trên Fanpage và YouTube\n' +
      '- 3 diễn giả + 1 MC, 3 phiên: chia sẻ – thảo luận – hỏi đáp\n\n' +
      '**Mục tiêu đo được:** 300 lượt đăng ký, 250 người check-in, 1.000 lượt xem livestream, điểm hài lòng ≥ 4/5.',
    list: 'DONE',
    members: ['lead'],
    labels: ['Điều phối'],
    start: '2026-09-14',
    due: '2026-09-16',
    done: '2026-09-16 21:00',
    phase: 'Khởi động',
    priority: 'Cao',
    cover: '#579dff',
    checklists: [
      {
        title: 'Đầu ra buổi họp khởi động',
        items: [
          ['Thống nhất chủ đề và thông điệp chính', true],
          ['Chốt ngày giờ 14/11, 14:00–17:00', true],
          ['Chốt quy mô 300 chỗ + livestream', true],
          ['Chia 9 mảng phụ trách cho thành viên', true],
        ],
      },
    ],
    comments: [
      ['lead', '2026-09-16 21:05', 'Đã chốt xong, biên bản họp ghi ở mô tả. Mọi người xem thẻ của mảng mình và báo lại nếu thấy hạn chưa hợp lý nhé.'],
      ['noidung', '2026-09-16 21:20', 'Nhóm nội dung ok. Mình sẽ làm khảo sát khán giả trong tuần này để chốt câu hỏi.'],
    ],
  },
  {
    title: 'Lập kế hoạch tổng thể và timeline 9 tuần',
    description:
      'Kế hoạch tổng chia 5 giai đoạn: **Khởi động** (14/09–27/09), **Chuẩn bị** (28/09–31/10), **Nước rút** (01/11–13/11), **Ngày diễn ra** (14/11), **Sau sự kiện** (15/11–25/11).\n\n' +
      'Mỗi mảng có mốc bàn giao rõ ràng; các việc phụ thuộc nhau ghi chú ngay trong thẻ (ví dụ: ảnh diễn giả → bài giới thiệu diễn giả).',
    list: 'DONE',
    members: ['lead'],
    labels: ['Điều phối'],
    start: '2026-09-15',
    due: '2026-09-19',
    done: '2026-09-18 22:00',
    phase: 'Khởi động',
    priority: 'Cao',
    checklists: [
      {
        title: 'Các phần của kế hoạch',
        items: [
          ['Timeline theo tuần cho 9 mảng', true],
          ['Danh sách mốc quan trọng (milestone)', true],
          ['Rủi ro chính và phương án dự phòng', true],
          ['Gửi kế hoạch cho cả nhóm góp ý', true],
        ],
      },
    ],
  },
  {
    title: 'Lập dự toán ngân sách chương trình',
    description:
      'Tổng dự toán **85.000.000 đ**, nguồn: tài trợ (mục tiêu 60 triệu) + kinh phí Đoàn trường (25 triệu).\n\n' +
      '**Các khoản chính:**\n' +
      '- Âm thanh, ánh sáng, màn LED: 18 triệu\n' +
      '- Thù lao + quà tặng diễn giả, MC: 21 triệu\n' +
      '- In ấn backdrop, standee, vé mời: 8 triệu\n' +
      '- Tea-break 300 khách: 6 triệu\n' +
      '- Quảng cáo Facebook: 5 triệu\n' +
      '- Áo đồng phục ban tổ chức: 3,5 triệu\n' +
      '- Thuê thiết bị livestream: 4 triệu\n' +
      '- Dự phòng: 5 triệu',
    list: 'DONE',
    members: ['lead'],
    labels: ['Điều phối', 'Tài trợ'],
    start: '2026-09-16',
    due: '2026-09-22',
    done: '2026-09-22 16:30',
    phase: 'Khởi động',
    priority: 'Cao',
    budget: 85_000_000,
    comments: [
      ['taitro', '2026-09-22 17:10', 'Với mục tiêu 60 triệu tài trợ thì mình cần chốt ít nhất 1 gói Vàng + 2 gói Bạc + nhà tài trợ hiện vật. Mình nhận nhé.'],
    ],
  },
  {
    title: 'Xin phê duyệt kế hoạch và mượn hội trường với Đoàn trường',
    description:
      'Nộp tờ trình kế hoạch + dự toán cho Văn phòng Đoàn trường, đăng ký mượn Hội trường lớn nhà A2 ngày 13/11 (tổng duyệt) và 14/11 (chính thức).\n\n' +
      'Kèm theo: danh sách ban tổ chức, cam kết an toàn và vệ sinh hội trường.',
    list: 'DONE',
    members: ['lead', 'haucan'],
    labels: ['Điều phối', 'Hậu cần'],
    start: '2026-09-18',
    due: '2026-09-25',
    done: '2026-09-24 10:00',
    phase: 'Khởi động',
    priority: 'Cao',
    contact: 'Văn phòng Đoàn trường – phòng 105 nhà A1',
    checklists: [
      {
        title: 'Hồ sơ nộp',
        items: [
          ['Tờ trình kế hoạch tổ chức', true, 'lead'],
          ['Dự toán kinh phí', true, 'lead'],
          ['Phiếu đăng ký mượn hội trường 13/11 và 14/11', true, 'haucan'],
          ['Danh sách ban tổ chức kèm số điện thoại', true, 'haucan'],
        ],
      },
    ],
    comments: [['haucan', '2026-09-24 10:15', 'Đã có giấy xác nhận mượn hội trường cả hai ngày, mình chụp gửi vào nhóm rồi.']],
  },
  {
    title: 'Họp giao ban hằng tuần (tối thứ Hai, 20:00)',
    description:
      'Họp online 30 phút mỗi tối thứ Hai: mỗi mảng báo cáo việc đã xong, việc tuần tới và điểm đang vướng. Biên bản ghi vào bình luận của thẻ này.',
    list: 'IN_PROGRESS',
    members: ['lead'],
    labels: ['Điều phối'],
    start: '2026-09-21',
    due: '2026-11-09 21:00',
    phase: 'Chuẩn bị',
    priority: 'Trung bình',
    checklists: [
      {
        title: 'Lịch giao ban',
        items: [
          ['Tuần 1 – 21/09', true],
          ['Tuần 2 – 28/09', true],
          ['Tuần 3 – 05/10', true],
          ['Tuần 4 – 12/10', false, null, '2026-10-12 20:00'],
          ['Tuần 5 – 19/10', false, null, '2026-10-19 20:00'],
          ['Tuần 6 – 26/10', false, null, '2026-10-26 20:00'],
          ['Tuần 7 – 02/11', false, null, '2026-11-02 20:00'],
          ['Tuần 8 – 09/11 (chốt trước tổng duyệt)', false, null, '2026-11-09 20:00'],
        ],
      },
    ],
    comments: [
      ['lead', '2026-09-28 21:00', 'Giao ban tuần 2: khảo sát khán giả xong (212 phản hồi), bộ nhận diện đã duyệt. Vướng: chưa có diễn giả thứ ba.'],
      ['lead', '2026-10-05 21:00', 'Giao ban tuần 3: đã mở form đăng ký, teaser đạt 4,2 nghìn tiếp cận. Vướng: chờ anh Minh Khoa xác nhận lịch, chờ đường mạng có dây để chạy thử livestream.'],
    ],
  },
  {
    title: 'Theo dõi thu – chi và cập nhật bảng ngân sách',
    description:
      'Cập nhật bảng ngân sách mỗi khi có khoản chi hoặc tiền tài trợ về. Mọi khoản chi trên 1 triệu phải có báo giá và được trưởng ban duyệt trước.\n\n' +
      'Cuối mỗi tuần đối chiếu lại với dự toán, báo cáo chênh lệch trong buổi giao ban.',
    list: 'IN_PROGRESS',
    members: ['lead'],
    labels: ['Điều phối'],
    start: '2026-09-22',
    due: '2026-11-20',
    phase: 'Chuẩn bị',
    priority: 'Trung bình',
  },
  {
    title: 'Duyệt kịch bản chương trình bản cuối',
    description:
      'Đọc và góp ý kịch bản chi tiết do nhóm nội dung soạn, thống nhất thời lượng từng phần và các điểm chuyển cảnh với sân khấu, quay dựng.\n\n' +
      '**Phụ thuộc:** thẻ “Viết kịch bản chi tiết chương trình (run-down theo phút)”.',
    list: 'TODO',
    members: ['lead', 'noidung'],
    labels: ['Điều phối', 'Nội dung'],
    start: '2026-10-26',
    due: '2026-10-30',
    phase: 'Chuẩn bị',
    priority: 'Cao',
  },
  {
    title: 'Tổ chức tổng duyệt toàn bộ chương trình (13/11)',
    description:
      'Tổng duyệt 14:00–18:00 ngày 13/11 tại hội trường A2, chạy đúng kịch bản như ngày chính thức (MC, nhạc, ánh sáng, slide, livestream thử).\n\n' +
      'Thành phần: toàn bộ ban tổ chức, MC, tình nguyện viên trưởng nhóm.',
    list: 'TODO',
    members: ['lead', 'noidung', 'sankhau', 'kythuat', 'haucan'],
    labels: ['Điều phối', 'Sân khấu'],
    start: '2026-11-13 14:00',
    due: '2026-11-13 18:00',
    phase: 'Nước rút',
    priority: 'Cao',
    cover: '#fea362',
    checklists: [
      {
        title: 'Nội dung tổng duyệt',
        items: [
          ['Chạy kịch bản MC từ đầu đến cuối', false, 'noidung'],
          ['Kiểm tra nhạc, ánh sáng theo từng phần', false, 'sankhau'],
          ['Chạy thử livestream 15 phút', false, 'kythuat'],
          ['Thử luồng check-in và chỗ ngồi', false, 'haucan'],
          ['Chốt danh sách việc còn thiếu', false, 'lead'],
        ],
      },
    ],
  },
  {
    title: 'Điều phối chung ngày diễn ra talk show (14/11)',
    description:
      'Trưởng ban giữ bộ đàm kênh 1, theo dõi tiến độ theo kịch bản, xử lý phát sinh và giữ liên lạc với các trưởng mảng.\n\n' +
      '**Mốc thời gian:**\n' +
      '- 10:30 ban tổ chức có mặt, họp nhanh\n' +
      '- 12:30 mở bàn check-in\n' +
      '- 13:30 đón diễn giả vào phòng chờ\n' +
      '- 14:00 bắt đầu chương trình\n' +
      '- 17:00 kết thúc, chụp ảnh lưu niệm, thu dọn',
    list: 'TODO',
    members: ['lead'],
    labels: ['Điều phối'],
    start: '2026-11-14 10:30',
    due: '2026-11-14 18:00',
    phase: 'Ngày diễn ra',
    priority: 'Cao',
    cover: '#f87168',
  },
  {
    title: 'Tổng kết, báo cáo và quyết toán sau sự kiện',
    description:
      'Họp rút kinh nghiệm toàn ban, viết báo cáo tổng kết gửi Đoàn trường (số liệu đăng ký, check-in, livestream, khảo sát hài lòng) và quyết toán kinh phí.',
    list: 'TODO',
    members: ['lead', 'taitro'],
    labels: ['Điều phối'],
    start: '2026-11-15',
    due: '2026-11-25',
    phase: 'Sau sự kiện',
    priority: 'Trung bình',
  },

  // ---------- Noi dung ----------
  {
    title: 'Khảo sát khán giả: sinh viên muốn nghe gì về nghề nghiệp thời AI',
    description:
      'Phiếu khảo sát 15 câu trên Google Forms, gửi qua fanpage và nhóm lớp. Mục tiêu 200 phản hồi.\n\n' +
      '**Kết quả:** 212 phản hồi. Ba chủ đề được quan tâm nhất: viết CV và phỏng vấn khi nhà tuyển dụng dùng AI (68%), kỹ năng nào khó bị thay thế (61%), dùng AI để học và làm đồ án thế nào cho đúng (54%).',
    list: 'DONE',
    members: ['noidung'],
    labels: ['Nội dung'],
    start: '2026-09-16',
    due: '2026-09-23',
    done: '2026-09-22 20:00',
    phase: 'Khởi động',
    priority: 'Cao',
    checklists: [
      {
        title: 'Các bước khảo sát',
        items: [
          ['Soạn 15 câu hỏi', true],
          ['Gửi fanpage và 20 nhóm lớp', true, 'truyenthong'],
          ['Tổng hợp kết quả thành 1 trang', true],
        ],
      },
    ],
  },
  {
    title: 'Xây dựng khung nội dung 3 phiên của chương trình',
    description:
      '- **Phiên 1 (40 phút):** AI đang thay đổi tuyển dụng như thế nào – góc nhìn nhà tuyển dụng\n' +
      '- **Phiên 2 (50 phút):** Kỹ năng Gen Z cần có để không bị thay thế – thảo luận 3 diễn giả\n' +
      '- **Phiên 3 (45 phút):** Hỏi đáp trực tiếp và mentoring nhanh\n\n' +
      'Xen giữa: 2 tiết mục mini game có quà của nhà tài trợ.',
    list: 'DONE',
    members: ['noidung'],
    labels: ['Nội dung'],
    start: '2026-09-21',
    due: '2026-09-28',
    done: '2026-09-29 22:30',
    phase: 'Khởi động',
    priority: 'Cao',
    comments: [
      ['noidung', '2026-09-29 22:35', 'Trễ 1 ngày vì chờ kết quả khảo sát cuối, đã chốt khung 3 phiên. Anh Khanh xem giúp nhé.'],
      ['lead', '2026-09-30 08:10', 'Khung ổn. Phiên 2 nên chừa 5 phút để MC tóm tắt trước khi sang hỏi đáp.'],
    ],
  },
  {
    title: 'Soạn bộ câu hỏi cho diễn giả (mỗi phiên 6–8 câu)',
    description:
      'Câu hỏi bám theo kết quả khảo sát khán giả. Mỗi diễn giả có 2 câu “riêng” theo chuyên môn và các câu chung để thảo luận.\n\n' +
      'Đã gửi trưởng ban duyệt, sau đó nhóm khách mời gửi trước cho diễn giả.',
    list: 'IN_REVIEW',
    members: ['noidung'],
    labels: ['Nội dung', 'Khách mời'],
    start: '2026-09-29',
    due: '2026-10-08',
    movedAt: '2026-10-05 22:00',
    phase: 'Chuẩn bị',
    priority: 'Cao',
    checklists: [
      {
        title: 'Câu hỏi theo phiên',
        items: [
          ['Phiên 1 – 7 câu', true],
          ['Phiên 2 – 8 câu', true],
          ['Câu hỏi dự phòng cho phần hỏi đáp – 5 câu', true],
          ['Trưởng ban duyệt', false, 'lead', '2026-10-08'],
        ],
      },
    ],
  },
  {
    title: 'Viết kịch bản chi tiết chương trình (run-down theo phút)',
    description:
      'Kịch bản theo từng phút: lời dẫn MC, nhạc, ánh sáng, slide, góc máy và người phụ trách mỗi phần. Bản này dùng chung cho sân khấu, quay dựng và kỹ thuật.',
    list: 'IN_PROGRESS',
    members: ['noidung'],
    labels: ['Nội dung'],
    start: '2026-10-05',
    due: '2026-10-25',
    phase: 'Chuẩn bị',
    priority: 'Cao',
    checklists: [
      {
        title: 'Các phần kịch bản',
        items: [
          ['Mở màn và giới thiệu diễn giả', true],
          ['Phiên 1', false],
          ['Phiên 2', false],
          ['Mini game và tài trợ', false, 'taitro'],
          ['Phiên 3 – hỏi đáp', false],
          ['Bế mạc và chụp ảnh', false],
        ],
      },
    ],
  },
  {
    title: 'Chuẩn bị kịch bản và lời dẫn cho MC',
    description:
      'Từ kịch bản chi tiết, viết lời dẫn hoàn chỉnh cho MC Hoàng Yến, gửi trước 10 ngày và hẹn một buổi đọc thử online.',
    list: 'TODO',
    members: ['noidung', 'khachmoi'],
    labels: ['Nội dung', 'Khách mời'],
    start: '2026-10-20',
    due: '2026-10-31',
    phase: 'Chuẩn bị',
    priority: 'Trung bình',
  },
  {
    title: 'Chuẩn bị phần hỏi đáp: thu câu hỏi qua Slido và lọc câu hay',
    description:
      'Tạo phòng Slido, gắn mã QR lên màn hình chờ. Hai bạn trực Slido lọc câu trùng, chọn câu hay để MC đọc; câu hỏi từ livestream cũng đưa vào đây.',
    list: 'TODO',
    members: ['noidung', 'kythuat'],
    labels: ['Nội dung', 'Kỹ thuật'],
    start: '2026-10-26',
    due: '2026-11-07',
    phase: 'Nước rút',
    priority: 'Trung bình',
  },
  {
    title: 'Viết bài tổng kết và tổng hợp trích dẫn hay sau chương trình',
    description: 'Bài tổng kết 800–1.000 chữ kèm 5 trích dẫn hay nhất của diễn giả, phối hợp truyền thông đăng fanpage trong 3 ngày sau chương trình.',
    list: 'TODO',
    members: ['noidung', 'truyenthong'],
    labels: ['Nội dung', 'Truyền thông'],
    start: '2026-11-15',
    due: '2026-11-18',
    phase: 'Sau sự kiện',
    priority: 'Thấp',
  },

  // ---------- Khach moi ----------
  {
    title: 'Lập danh sách 8 diễn giả tiềm năng và tiêu chí chọn',
    description:
      'Tiêu chí: có kinh nghiệm thực tế về tuyển dụng hoặc ứng dụng AI, nói chuyện gần gũi với sinh viên, sắp xếp được lịch chiều 14/11.\n\n' +
      'Danh sách xếp theo thứ tự ưu tiên, mỗi người có phương án dự phòng cùng chuyên môn.',
    list: 'DONE',
    members: ['khachmoi'],
    labels: ['Khách mời'],
    start: '2026-09-16',
    due: '2026-09-21',
    done: '2026-09-20 18:00',
    phase: 'Khởi động',
    priority: 'Cao',
  },
  {
    title: 'Mời và chốt 3 diễn giả chính',
    description:
      'Gửi thư mời chính thức (kèm giới thiệu chương trình và quyền lợi), gọi điện xác nhận, chốt lịch và hình thức thù lao.\n\n' +
      '**Diễn giả:**\n' +
      '- Chị Nguyễn Thảo Vy – Trưởng phòng Tuyển dụng một công ty công nghệ\n' +
      '- Anh Trần Đức Bảo – Kỹ sư AI\n' +
      '- Anh Lê Minh Khoa – Nhà sáng lập một startup giáo dục',
    list: 'IN_PROGRESS',
    members: ['khachmoi', 'lead'],
    labels: ['Khách mời'],
    start: '2026-09-22',
    due: '2026-10-05',
    phase: 'Chuẩn bị',
    priority: 'Cao',
    budget: 15_000_000,
    checklists: [
      {
        title: 'Xác nhận diễn giả',
        items: [
          ['Chị Thảo Vy đồng ý tham gia', true, 'khachmoi', '2026-09-30'],
          ['Anh Đức Bảo đồng ý tham gia', true, 'khachmoi', '2026-10-02'],
          ['Anh Minh Khoa xác nhận lịch', false, 'khachmoi', '2026-10-08'],
          ['Gửi thư xác nhận chính thức cho cả 3 người', false, 'khachmoi'],
        ],
      },
    ],
    comments: [
      ['khachmoi', '2026-10-05 19:30', 'Anh Minh Khoa đang đi công tác, hẹn trả lời trước 08/10. Nếu không được, mình mời phương án dự phòng là chị Phạm Hải Yến (cùng mảng giáo dục).'],
      ['lead', '2026-10-05 20:10', 'Ok em, quá 08/10 thì chuyển luôn sang phương án dự phòng để kịp làm ảnh giới thiệu.'],
    ],
  },
  {
    title: 'Mời và ký thoả thuận với MC chương trình',
    description: 'MC Hoàng Yến, đã dẫn nhiều talk show sinh viên. Thoả thuận gồm thù lao, lịch đọc thử kịch bản và lịch tổng duyệt 13/11.',
    list: 'DONE',
    members: ['khachmoi'],
    labels: ['Khách mời'],
    start: '2026-09-25',
    due: '2026-10-02',
    done: '2026-10-01 15:00',
    phase: 'Chuẩn bị',
    priority: 'Trung bình',
    budget: 3_000_000,
    contact: 'MC Hoàng Yến',
  },
  {
    title: 'Thu thập tiểu sử, ảnh chân dung và đề tài chia sẻ của diễn giả',
    description:
      'Mỗi diễn giả gửi: tiểu sử 80–100 chữ, ảnh chân dung chất lượng cao (nền đơn giản), tên đề tài và 3 ý chính muốn chia sẻ.\n\n' +
      'Thiết kế và truyền thông đang chờ phần này để làm ảnh và bài giới thiệu.',
    list: 'IN_PROGRESS',
    members: ['khachmoi'],
    labels: ['Khách mời'],
    start: '2026-10-01',
    due: '2026-10-10',
    phase: 'Chuẩn bị',
    priority: 'Cao',
    checklists: [
      {
        title: 'Hồ sơ diễn giả',
        items: [
          ['Chị Thảo Vy – tiểu sử + ảnh', true],
          ['Anh Đức Bảo – tiểu sử', true],
          ['Anh Đức Bảo – ảnh chân dung', false],
          ['Diễn giả thứ ba – tiểu sử + ảnh', false],
        ],
      },
    ],
  },
  {
    title: 'Gửi câu hỏi, lịch trình và họp online với diễn giả trước chương trình',
    description:
      'Gửi bộ câu hỏi đã duyệt và lịch trình ngày 14/11 cho từng diễn giả; hẹn họp online 30 phút để thống nhất ý chính và tránh trùng nội dung giữa các diễn giả.',
    list: 'TODO',
    members: ['khachmoi', 'noidung'],
    labels: ['Khách mời', 'Nội dung'],
    start: '2026-10-20',
    due: '2026-11-07',
    phase: 'Nước rút',
    priority: 'Cao',
  },
  {
    title: 'Chuẩn bị quà tặng và thư cảm ơn diễn giả, MC',
    description: 'Quà tặng gồm hoa, kỷ niệm chương khắc tên và thư cảm ơn viết tay có chữ ký của ban tổ chức.',
    list: 'TODO',
    members: ['khachmoi', 'haucan'],
    labels: ['Khách mời', 'Hậu cần'],
    start: '2026-10-26',
    due: '2026-11-10',
    phase: 'Nước rút',
    priority: 'Trung bình',
    budget: 3_000_000,
  },
  {
    title: 'Đón tiếp diễn giả ngày diễn ra (phòng chờ, nước, lịch trình)',
    description: 'Đón diễn giả tại cổng, dẫn lên phòng chờ tầng 3, chuẩn bị nước, khăn giấy và lịch trình in sẵn; mỗi diễn giả có một tình nguyện viên hỗ trợ riêng.',
    list: 'TODO',
    members: ['khachmoi'],
    labels: ['Khách mời'],
    start: '2026-11-14 12:30',
    due: '2026-11-14 17:30',
    phase: 'Ngày diễn ra',
    priority: 'Cao',
  },

  // ---------- Truyen thong ----------
  {
    title: 'Lập kế hoạch truyền thông 6 tuần (kênh, lịch đăng, KPI)',
    description:
      '**Kênh:** Fanpage chương trình, fanpage Đoàn trường, nhóm lớp, TikTok, email sinh viên.\n\n' +
      '**KPI:** 300 lượt đăng ký, tiếp cận 20.000, 1.000 lượt xem livestream.\n\n' +
      '**Lịch:** teaser → công bố → giới thiệu diễn giả → kêu gọi đăng ký → đếm ngược → đưa tin trực tiếp → tổng kết.',
    list: 'DONE',
    members: ['truyenthong'],
    labels: ['Truyền thông'],
    start: '2026-09-21',
    due: '2026-09-30',
    done: '2026-09-30 21:00',
    phase: 'Khởi động',
    priority: 'Cao',
  },
  {
    title: 'Đăng bài teaser công bố chương trình',
    description: 'Bài teaser kèm video 30 giây và poster công bố, ghim đầu fanpage.',
    list: 'DONE',
    members: ['truyenthong'],
    labels: ['Truyền thông'],
    start: '2026-10-01',
    due: '2026-10-03',
    done: '2026-10-03 19:00',
    phase: 'Chuẩn bị',
    priority: 'Trung bình',
    comments: [['truyenthong', '2026-10-05 09:00', 'Sau 2 ngày teaser đạt 4,2 nghìn tiếp cận, 310 lượt tương tác, 46 lượt chia sẻ.']],
  },
  {
    title: 'Chuỗi bài giới thiệu 3 diễn giả',
    description:
      'Mỗi diễn giả một bài (ảnh + tiểu sử + đề tài chia sẻ), đăng cách nhau 2 ngày.\n\n' +
      '**Đang vướng:** chưa đủ ảnh chân dung và tiểu sử (thẻ “Thu thập tiểu sử, ảnh chân dung…”), diễn giả thứ ba chưa chốt.',
    list: 'BLOCKED',
    members: ['truyenthong'],
    labels: ['Truyền thông', 'Khách mời'],
    start: '2026-10-06',
    due: '2026-10-16',
    movedAt: '2026-10-06 09:00',
    phase: 'Chuẩn bị',
    priority: 'Cao',
    comments: [['truyenthong', '2026-10-06 09:05', 'Chuyển sang “Đang vướng” vì chờ ảnh diễn giả. Bài của chị Thảo Vy mình đã viết xong nháp.']],
  },
  {
    title: 'Mở đăng ký tham dự và đẩy bài kêu gọi đăng ký',
    description:
      'Bài mở đăng ký dẫn tới trang đăng ký của chương trình; nhắc lại ở các mốc 100, 200 và 300 lượt đăng ký. Theo dõi số đăng ký mỗi ngày cùng nhóm kỹ thuật.',
    list: 'IN_PROGRESS',
    members: ['truyenthong', 'kythuat'],
    labels: ['Truyền thông', 'Kỹ thuật'],
    start: '2026-10-05',
    due: '2026-11-10',
    phase: 'Chuẩn bị',
    priority: 'Cao',
    checklists: [
      {
        title: 'Mốc đăng ký',
        items: [
          ['Bài mở đăng ký (05/10)', true],
          ['Mốc 100 lượt', false, null, '2026-10-15'],
          ['Mốc 200 lượt', false, null, '2026-10-28'],
          ['Mốc 300 lượt – đóng form', false, null, '2026-11-10'],
        ],
      },
    ],
  },
  {
    title: 'Liên hệ câu lạc bộ, Đoàn – Hội các khoa để chia sẻ chương trình',
    description: 'Gửi bài và poster cho 15 câu lạc bộ và Liên chi đoàn các khoa, nhờ chia sẻ vào nhóm sinh viên.',
    list: 'IN_PROGRESS',
    members: ['truyenthong'],
    labels: ['Truyền thông'],
    start: '2026-10-05',
    due: '2026-10-20',
    phase: 'Chuẩn bị',
    priority: 'Trung bình',
    checklists: [
      {
        title: 'Đầu mối đã liên hệ',
        items: [
          ['Liên chi đoàn khoa Công nghệ thông tin', true],
          ['Liên chi đoàn khoa Kinh tế', true],
          ['Câu lạc bộ Kỹ năng', false],
          ['Câu lạc bộ Tiếng Anh', false],
          ['Hội sinh viên trường', false],
        ],
      },
    ],
  },
  {
    title: 'Chạy quảng cáo Facebook nhắm sinh viên (ngân sách 5 triệu)',
    description: 'Hai nhóm quảng cáo: kêu gọi đăng ký (3 triệu) và nhắc xem livestream (2 triệu). Nhắm sinh viên 18–24 tuổi trong bán kính 10 km quanh trường.',
    list: 'TODO',
    members: ['truyenthong'],
    labels: ['Truyền thông'],
    start: '2026-10-20',
    due: '2026-11-12',
    phase: 'Nước rút',
    priority: 'Trung bình',
    budget: 5_000_000,
  },
  {
    title: 'Đưa tin trực tiếp trong chương trình và đăng bài tổng kết',
    description: 'Đăng story và bài cập nhật theo từng phiên, trả lời bình luận trên livestream; bài tổng kết kèm album ảnh trong 48 giờ.',
    list: 'TODO',
    members: ['truyenthong', 'media'],
    labels: ['Truyền thông', 'Quay dựng'],
    start: '2026-11-14 13:00',
    due: '2026-11-16',
    phase: 'Ngày diễn ra',
    priority: 'Trung bình',
  },

  // ---------- Thiet ke ----------
  {
    title: 'Thiết kế bộ nhận diện chương trình (logo, màu, phông chữ)',
    description: 'Logo chương trình, bảng 3 màu chủ đạo, 2 phông chữ và bộ khung ảnh dùng chung cho mọi ấn phẩm.',
    list: 'DONE',
    members: ['thietke'],
    labels: ['Thiết kế'],
    start: '2026-09-18',
    due: '2026-09-26',
    done: '2026-09-25 23:00',
    phase: 'Khởi động',
    priority: 'Cao',
  },
  {
    title: 'Thiết kế ảnh bìa fanpage và poster công bố',
    description: 'Ảnh bìa fanpage 1640 × 624 và poster công bố khổ dọc 4:5, có thông tin thời gian, địa điểm, mã QR đăng ký.',
    list: 'DONE',
    members: ['thietke'],
    labels: ['Thiết kế', 'Truyền thông'],
    start: '2026-09-27',
    due: '2026-10-02',
    done: '2026-10-03 10:00',
    phase: 'Chuẩn bị',
    priority: 'Cao',
  },
  {
    title: 'Thiết kế bộ ảnh giới thiệu 3 diễn giả',
    description: 'Ba ảnh cùng bố cục (ảnh chân dung, tên, chức danh, đề tài) để đăng chuỗi bài giới thiệu diễn giả.',
    list: 'TODO',
    members: ['thietke'],
    labels: ['Thiết kế', 'Khách mời'],
    start: '2026-10-08',
    due: '2026-10-14',
    phase: 'Chuẩn bị',
    priority: 'Cao',
  },
  {
    title: 'Thiết kế backdrop sân khấu 6m × 3m và standee',
    description:
      'Backdrop theo kích thước sân khấu đã đo, chừa vùng logo nhà tài trợ phía dưới. Hai standee đặt ở sảnh và cửa hội trường.\n\n' +
      'File in xuất PDF CMYK, gửi hậu cần đặt in.',
    list: 'IN_PROGRESS',
    members: ['thietke', 'sankhau'],
    labels: ['Thiết kế', 'Sân khấu'],
    start: '2026-10-05',
    due: '2026-10-20',
    phase: 'Chuẩn bị',
    priority: 'Cao',
    checklists: [
      {
        title: 'Các bản cần ra',
        items: [
          ['Phác thảo bố cục backdrop', true],
          ['Bản màu backdrop', false, 'thietke', '2026-10-12'],
          ['Standee sảnh', false, 'thietke', '2026-10-16'],
          ['Xuất file in CMYK', false, 'thietke', '2026-10-20'],
        ],
      },
    ],
  },
  {
    title: 'Thiết kế vé mời, thẻ ban tổ chức và thẻ diễn giả',
    description: 'Vé mời khách mời đặc biệt (50 vé), thẻ đeo cho 30 thành viên ban tổ chức và 4 thẻ diễn giả/MC.',
    list: 'TODO',
    members: ['thietke'],
    labels: ['Thiết kế', 'Hậu cần'],
    start: '2026-10-19',
    due: '2026-10-30',
    phase: 'Chuẩn bị',
    priority: 'Trung bình',
  },
  {
    title: 'Thiết kế slide trình chiếu và màn hình chờ',
    description: 'Slide mở màn, slide giới thiệu từng diễn giả, slide mini game và màn hình chờ có mã QR Slido.',
    list: 'TODO',
    members: ['thietke', 'noidung'],
    labels: ['Thiết kế', 'Nội dung'],
    start: '2026-10-26',
    due: '2026-11-08',
    phase: 'Nước rút',
    priority: 'Trung bình',
  },
  {
    title: 'Thiết kế bộ ảnh đếm ngược 7 ngày',
    description: 'Bảy ảnh đếm ngược, mỗi ảnh một trích dẫn ngắn của diễn giả hoặc một con số từ khảo sát khán giả.',
    list: 'TODO',
    members: ['thietke', 'truyenthong'],
    labels: ['Thiết kế', 'Truyền thông'],
    start: '2026-11-01',
    due: '2026-11-06',
    phase: 'Nước rút',
    priority: 'Thấp',
  },

  // ---------- Tai tro ----------
  {
    title: 'Soạn hồ sơ tài trợ và các gói quyền lợi',
    description:
      '**Gói quyền lợi:**\n' +
      '- Kim cương 20 triệu: logo lớn nhất trên backdrop, 5 phút phát biểu, gian hàng\n' +
      '- Vàng 10 triệu: logo trên backdrop, gian hàng, nhắc tên trong livestream\n' +
      '- Bạc 5 triệu: logo trên poster và slide\n' +
      '- Đồng hành: tài trợ hiện vật (nước uống, quà tặng)',
    list: 'DONE',
    members: ['taitro'],
    labels: ['Tài trợ'],
    start: '2026-09-17',
    due: '2026-09-26',
    done: '2026-09-26 17:00',
    phase: 'Khởi động',
    priority: 'Cao',
  },
  {
    title: 'Lập danh sách 20 doanh nghiệp và gửi thư mời tài trợ',
    description: 'Ưu tiên doanh nghiệp công nghệ, trung tâm đào tạo và doanh nghiệp đã từng tài trợ sự kiện sinh viên. Theo dõi phản hồi trong bảng tính chung.',
    list: 'DONE',
    members: ['taitro'],
    labels: ['Tài trợ'],
    start: '2026-09-27',
    due: '2026-10-04',
    done: '2026-10-04 22:00',
    phase: 'Chuẩn bị',
    priority: 'Cao',
    comments: [['taitro', '2026-10-04 22:05', 'Đã gửi 20/20 thư. Có 4 bên phản hồi quan tâm, 1 bên hẹn gặp tuần này (Nam Phong).']],
  },
  {
    title: 'Gặp và đàm phán với nhà tài trợ Vàng – Công ty CP Giải pháp số Nam Phong',
    description: 'Họp trực tiếp tại văn phòng công ty, trình bày hồ sơ và đề xuất gói Vàng 10 triệu kèm gian hàng tuyển thực tập sinh.',
    list: 'IN_PROGRESS',
    members: ['taitro', 'lead'],
    labels: ['Tài trợ'],
    start: '2026-10-05',
    due: '2026-10-15',
    phase: 'Chuẩn bị',
    priority: 'Cao',
    budget: 10_000_000,
    contact: 'Chị Mai Anh – phòng Marketing, Công ty CP Giải pháp số Nam Phong',
  },
  {
    title: 'Ký hợp đồng tài trợ và theo dõi tiền về tài khoản',
    description:
      'Hợp đồng theo mẫu của Đoàn trường, tiền tài trợ chuyển vào tài khoản của Đoàn trường.\n\n' +
      '**Đang vướng:** Văn phòng Đoàn trường đang sửa mẫu hợp đồng mới, dự kiến có lại sau 12/10.',
    list: 'BLOCKED',
    members: ['taitro', 'lead'],
    labels: ['Tài trợ', 'Điều phối'],
    start: '2026-10-05',
    due: '2026-10-25',
    movedAt: '2026-10-05 16:00',
    phase: 'Chuẩn bị',
    priority: 'Cao',
    contact: 'Văn phòng Đoàn trường – phòng 105 nhà A1',
  },
  {
    title: 'Chốt nhà tài trợ hiện vật: nước uống và tea-break',
    description: 'Đề xuất gói Đồng hành cho quán cà phê Mộc Trà (tài trợ 300 phần bánh) và một nhãn nước suối (20 thùng nước).',
    list: 'IN_PROGRESS',
    members: ['taitro', 'haucan'],
    labels: ['Tài trợ', 'Hậu cần'],
    start: '2026-10-03',
    due: '2026-10-18',
    phase: 'Chuẩn bị',
    priority: 'Trung bình',
  },
  {
    title: 'Tổng hợp quyền lợi nhà tài trợ và kiểm tra thực hiện',
    description: 'Bảng kiểm từng quyền lợi đã cam kết (logo, gian hàng, phát biểu, nhắc tên) và người chịu trách nhiệm thực hiện, rà lại trước tổng duyệt.',
    list: 'TODO',
    members: ['taitro', 'thietke', 'truyenthong'],
    labels: ['Tài trợ'],
    start: '2026-10-26',
    due: '2026-11-12',
    phase: 'Nước rút',
    priority: 'Trung bình',
  },
  {
    title: 'Gửi báo cáo hiệu quả và thư cảm ơn nhà tài trợ',
    description: 'Báo cáo gồm số liệu khán giả, lượt xem, hình ảnh logo tại sự kiện và các bài đăng có nhắc tên nhà tài trợ.',
    list: 'TODO',
    members: ['taitro'],
    labels: ['Tài trợ'],
    start: '2026-11-16',
    due: '2026-11-25',
    phase: 'Sau sự kiện',
    priority: 'Thấp',
  },

  // ---------- Hau can ----------
  {
    title: 'Khảo sát hội trường A2 và đo đạc sân khấu',
    description: 'Đo sân khấu (8m × 4m), kiểm tra ổ điện, vị trí cửa thoát hiểm, phòng chờ diễn giả và khu vực đặt bàn check-in.',
    list: 'DONE',
    members: ['haucan', 'sankhau'],
    labels: ['Hậu cần', 'Sân khấu'],
    start: '2026-09-22',
    due: '2026-09-26',
    done: '2026-09-26 11:00',
    phase: 'Khởi động',
    priority: 'Cao',
  },
  {
    title: 'Đặt may áo đồng phục ban tổ chức (30 áo)',
    description: 'Áo thun màu chủ đạo của chương trình, in logo trước ngực và chữ “Ban tổ chức” sau lưng.',
    list: 'IN_PROGRESS',
    members: ['haucan'],
    labels: ['Hậu cần'],
    start: '2026-10-01',
    due: '2026-10-20',
    phase: 'Chuẩn bị',
    priority: 'Thấp',
    budget: 3_500_000,
    checklists: [
      {
        title: 'Tiến độ áo',
        items: [
          ['Chốt mẫu áo với thiết kế', true, 'thietke'],
          ['Thu size của 30 người', true],
          ['Đặt xưởng may', false, null, '2026-10-09'],
          ['Nhận áo và phát cho mọi người', false, null, '2026-10-20'],
        ],
      },
    ],
  },
  {
    title: 'Lên sơ đồ chỗ ngồi, khu check-in và luồng di chuyển',
    description: 'Sơ đồ 300 ghế chia khu (khách mời, nhà tài trợ, sinh viên), hai bàn check-in ở sảnh, luồng vào ra không chồng nhau.',
    list: 'IN_PROGRESS',
    members: ['haucan', 'kythuat'],
    labels: ['Hậu cần', 'Kỹ thuật'],
    start: '2026-10-05',
    due: '2026-10-23',
    phase: 'Chuẩn bị',
    priority: 'Trung bình',
  },
  {
    title: 'Tuyển và phân công 20 tình nguyện viên',
    description: 'Đăng tuyển trong câu lạc bộ, phỏng vấn ngắn, chia nhóm: check-in, dẫn chỗ, hỗ trợ diễn giả, hậu trường. Tập huấn ngày 11/11.',
    list: 'TODO',
    members: ['haucan'],
    labels: ['Hậu cần'],
    start: '2026-10-12',
    due: '2026-11-11',
    phase: 'Chuẩn bị',
    priority: 'Trung bình',
  },
  {
    title: 'Đặt in ấn: backdrop, standee, banner, vé mời',
    description: 'Lấy báo giá 2 xưởng in, gửi file in đã duyệt, hẹn nhận hàng trước ngày 10/11 để kịp dựng.',
    list: 'TODO',
    members: ['haucan', 'thietke'],
    labels: ['Hậu cần', 'Thiết kế'],
    start: '2026-10-21',
    due: '2026-11-05',
    phase: 'Nước rút',
    priority: 'Cao',
    budget: 8_000_000,
  },
  {
    title: 'Đặt tea-break cho 300 khách và nước cho diễn giả',
    description: 'Phối hợp nhà tài trợ hiện vật; phần còn thiếu đặt ngoài. Bày ở sảnh lúc 15:30 (giải lao giữa phiên 2 và phiên 3).',
    list: 'TODO',
    members: ['haucan'],
    labels: ['Hậu cần'],
    start: '2026-10-26',
    due: '2026-11-10',
    phase: 'Nước rút',
    priority: 'Trung bình',
    budget: 6_000_000,
  },
  {
    title: 'Dọn dẹp, trả hội trường và kiểm kê đồ đạc sau sự kiện',
    description: 'Tháo backdrop, thu dọn rác, trả ghế về vị trí cũ, kiểm kê thiết bị mượn và ký biên bản trả hội trường.',
    list: 'TODO',
    members: ['haucan'],
    labels: ['Hậu cần'],
    start: '2026-11-14 17:00',
    due: '2026-11-15 12:00',
    phase: 'Sau sự kiện',
    priority: 'Trung bình',
  },

  // ---------- San khau ----------
  {
    title: 'Lên danh sách thiết bị âm thanh, ánh sáng, màn LED',
    description: '4 micro không dây, 2 loa monitor, bàn mixer 16 kênh, 12 đèn par LED, 2 đèn follow, màn LED 5m × 2,5m và máy chiếu dự phòng.',
    list: 'DONE',
    members: ['sankhau'],
    labels: ['Sân khấu'],
    start: '2026-09-28',
    due: '2026-10-03',
    done: '2026-10-02 21:00',
    phase: 'Chuẩn bị',
    priority: 'Cao',
  },
  {
    title: 'Lấy báo giá 3 đơn vị âm thanh – ánh sáng và chốt nhà cung cấp',
    description: 'So sánh báo giá theo cùng danh sách thiết bị, ưu tiên đơn vị có kỹ thuật viên trực suốt chương trình. Đề xuất chọn đơn vị giá 17,5 triệu.',
    list: 'IN_REVIEW',
    members: ['sankhau', 'lead'],
    labels: ['Sân khấu', 'Điều phối'],
    start: '2026-10-03',
    due: '2026-10-09',
    movedAt: '2026-10-06 08:30',
    phase: 'Chuẩn bị',
    priority: 'Cao',
    budget: 18_000_000,
    comments: [['sankhau', '2026-10-06 08:35', 'Em gửi bảng so sánh 3 báo giá ở mô tả. Anh duyệt giúp để em đặt cọc trước 09/10 nhé.']],
  },
  {
    title: 'Thiết kế bố trí sân khấu: ghế diễn giả, bục MC, vị trí máy quay',
    description: 'Sân khấu 3 ghế diễn giả + 1 bục MC, màn LED phía sau; hai vị trí máy quay (chính diện và góc 45°) không che tầm nhìn khán giả.',
    list: 'IN_PROGRESS',
    members: ['sankhau', 'media', 'thietke'],
    labels: ['Sân khấu', 'Quay dựng'],
    start: '2026-10-05',
    due: '2026-10-18',
    phase: 'Chuẩn bị',
    priority: 'Trung bình',
  },
  {
    title: 'Chuẩn bị nhạc nền, nhạc chuyển cảnh và hiệu ứng ánh sáng theo kịch bản',
    description: 'Danh sách nhạc (không vi phạm bản quyền), cue ánh sáng cho mở màn, giới thiệu diễn giả, mini game và bế mạc.',
    list: 'TODO',
    members: ['sankhau', 'noidung'],
    labels: ['Sân khấu', 'Nội dung'],
    start: '2026-10-26',
    due: '2026-11-10',
    phase: 'Nước rút',
    priority: 'Trung bình',
  },
  {
    title: 'Kiểm tra micro không dây, màn LED và thiết bị dự phòng',
    description: 'Thử từng micro (pin mới + pin dự phòng), màn LED, máy chiếu dự phòng, dây HDMI và bộ chia; ghi biên bản nhận thiết bị.',
    list: 'TODO',
    members: ['sankhau'],
    labels: ['Sân khấu'],
    start: '2026-11-12',
    due: '2026-11-13 12:00',
    phase: 'Nước rút',
    priority: 'Cao',
  },
  {
    title: 'Vận hành âm thanh – ánh sáng ngày diễn ra',
    description: 'Trực bàn mixer và bàn đèn từ 12:30 đến hết chương trình, giữ liên lạc với trưởng ban qua bộ đàm kênh 2.',
    list: 'TODO',
    members: ['sankhau'],
    labels: ['Sân khấu'],
    start: '2026-11-14 12:30',
    due: '2026-11-14 17:30',
    phase: 'Ngày diễn ra',
    priority: 'Cao',
  },

  // ---------- Ky thuat ----------
  {
    title: 'Làm trang đăng ký tham dự (landing page + form)',
    description:
      'Landing page giới thiệu chương trình, diễn giả, lịch trình và form đăng ký (họ tên, email, khoa, năm học, câu hỏi muốn gửi diễn giả). Dữ liệu đổ về bảng tính chung.',
    list: 'DONE',
    members: ['kythuat'],
    labels: ['Kỹ thuật'],
    start: '2026-09-24',
    due: '2026-10-04',
    done: '2026-10-04 20:00',
    phase: 'Chuẩn bị',
    priority: 'Cao',
    comments: [['kythuat', '2026-10-04 20:10', 'Trang đăng ký đã chạy, đã thử trên điện thoại và máy tính. Sáng 05/10 truyền thông đăng bài mở đăng ký.']],
  },
  {
    title: 'Gửi email xác nhận kèm mã QR cho người đăng ký',
    description: 'Mỗi người đăng ký nhận email xác nhận có mã QR riêng; gửi lại email nhắc lịch trước chương trình 3 ngày và 1 ngày.',
    list: 'IN_PROGRESS',
    members: ['kythuat'],
    labels: ['Kỹ thuật'],
    start: '2026-10-05',
    due: '2026-10-15',
    phase: 'Chuẩn bị',
    priority: 'Cao',
    checklists: [
      {
        title: 'Email tự động',
        items: [
          ['Mẫu email xác nhận', true],
          ['Sinh mã QR riêng cho từng người', false],
          ['Email nhắc lịch trước 3 ngày', false],
          ['Email nhắc lịch trước 1 ngày', false],
        ],
      },
    ],
  },
  {
    title: 'Xây dựng công cụ check-in bằng mã QR tại cửa',
    description: 'Trang check-in quét mã QR bằng điện thoại, báo trùng mã, đếm số người đã vào theo thời gian thực; có phương án dự phòng tra theo email.',
    list: 'TODO',
    members: ['kythuat'],
    labels: ['Kỹ thuật', 'Hậu cần'],
    start: '2026-10-15',
    due: '2026-11-05',
    phase: 'Chuẩn bị',
    priority: 'Cao',
  },
  {
    title: 'Chạy thử livestream và đường truyền mạng tại hội trường',
    description:
      'Chạy thử 30 phút với OBS và 2 máy quay, đo tốc độ tải lên.\n\n' +
      '**Đang vướng:** chờ phòng Quản trị cấp một đường mạng có dây riêng cho máy livestream (Wi-Fi hội trường không ổn định).',
    list: 'BLOCKED',
    members: ['kythuat', 'media'],
    labels: ['Kỹ thuật', 'Quay dựng'],
    start: '2026-10-05',
    due: '2026-10-17',
    movedAt: '2026-10-05 15:00',
    phase: 'Chuẩn bị',
    priority: 'Cao',
    contact: 'Phòng Quản trị – thiết bị',
    comments: [
      ['kythuat', '2026-10-05 15:05', 'Đo Wi-Fi hội trường chỉ được 4 Mbps tải lên, không đủ cho 1080p. Đã gửi đề nghị cấp mạng có dây.'],
      ['lead', '2026-10-05 21:10', 'Anh sẽ gọi trực tiếp cho phòng Quản trị sáng mai. Nếu không kịp thì thuê bộ phát 4G/5G dự phòng.'],
    ],
  },
  {
    title: 'Thiết lập livestream lên Fanpage và YouTube',
    description: 'Cấu hình OBS phát đồng thời 2 kênh, cảnh mở màn, khung tên diễn giả, cảnh giải lao; phân công người trả lời bình luận.',
    list: 'TODO',
    members: ['kythuat', 'media'],
    labels: ['Kỹ thuật', 'Quay dựng'],
    start: '2026-10-20',
    due: '2026-11-10',
    phase: 'Nước rút',
    priority: 'Cao',
    budget: 4_000_000,
  },
  {
    title: 'Thống kê số liệu đăng ký, check-in và lượt xem để báo cáo',
    description: 'Tổng hợp số đăng ký, số check-in theo khoa, số lượt xem và thời gian xem trung bình của livestream, kết quả khảo sát hài lòng.',
    list: 'TODO',
    members: ['kythuat', 'lead'],
    labels: ['Kỹ thuật', 'Điều phối'],
    start: '2026-11-15',
    due: '2026-11-18',
    phase: 'Sau sự kiện',
    priority: 'Trung bình',
  },

  // ---------- Quay dung ----------
  {
    title: 'Quay và dựng video teaser 30 giây',
    description: 'Teaser dọc 9:16 và ngang 16:9, dùng câu hỏi “AI có lấy mất việc của bạn?” làm mở đầu.',
    list: 'DONE',
    members: ['media'],
    labels: ['Quay dựng', 'Truyền thông'],
    start: '2026-09-25',
    due: '2026-10-02',
    done: '2026-10-01 23:30',
    phase: 'Chuẩn bị',
    priority: 'Cao',
  },
  {
    title: 'Lên kịch bản quay: góc máy và danh sách cảnh cần có',
    description: 'Danh sách cảnh cho từng phần của chương trình: toàn cảnh, cận diễn giả, phản ứng khán giả, hậu trường; phân công 2 máy quay và 2 máy ảnh.',
    list: 'IN_PROGRESS',
    members: ['media', 'sankhau'],
    labels: ['Quay dựng'],
    start: '2026-10-05',
    due: '2026-10-25',
    phase: 'Chuẩn bị',
    priority: 'Trung bình',
  },
  {
    title: 'Quay phỏng vấn ngắn diễn giả làm video giới thiệu',
    description: 'Mỗi diễn giả trả lời 2 câu hỏi ngắn (quay tại nơi làm việc hoặc online), dựng thành 3 video 45 giây đăng trước chương trình.',
    list: 'TODO',
    members: ['media', 'khachmoi'],
    labels: ['Quay dựng', 'Khách mời'],
    start: '2026-10-12',
    due: '2026-10-24',
    phase: 'Chuẩn bị',
    priority: 'Trung bình',
  },
  {
    title: 'Chụp ảnh và quay phim ngày diễn ra (2 máy quay, 2 máy ảnh)',
    description: 'Một máy quay chính diện cho livestream, một máy quay di động; hai máy ảnh chia khu sân khấu và khán giả. Gửi ảnh chọn lọc cho truyền thông ngay trong buổi.',
    list: 'TODO',
    members: ['media'],
    labels: ['Quay dựng'],
    start: '2026-11-14 12:30',
    due: '2026-11-14 18:00',
    phase: 'Ngày diễn ra',
    priority: 'Cao',
  },
  {
    title: 'Dựng video highlight 3 phút sau chương trình',
    description: 'Video highlight có phụ đề, nhạc nền và logo nhà tài trợ ở cuối video.',
    list: 'TODO',
    members: ['media', 'truyenthong'],
    labels: ['Quay dựng', 'Truyền thông'],
    start: '2026-11-15',
    due: '2026-11-21',
    phase: 'Sau sự kiện',
    priority: 'Trung bình',
  },
  {
    title: 'Cắt 5 video ngắn Reels/TikTok từ phần chia sẻ hay nhất',
    description: 'Mỗi video 30–60 giây, có phụ đề lớn, đăng cách ngày trong hai tuần sau chương trình.',
    list: 'TODO',
    members: ['media'],
    labels: ['Quay dựng'],
    start: '2026-11-16',
    due: '2026-11-25',
    phase: 'Sau sự kiện',
    priority: 'Thấp',
  },
];

// ===================== Bang talk show CU (lich su) =====================

export const PAST_BOARD = {
  name: 'Talk show “Khởi nghiệp từ giảng đường” – 27/06/2026 (đã kết thúc)',
  color: '#519839',
  lists: [
    { key: 'TODO', name: 'Việc cần làm' },
    { key: 'IN_PROGRESS', name: 'Đang thực hiện' },
    { key: 'DONE', name: 'Hoàn thành' },
  ] as const satisfies readonly { key: ListKey; name: string }[],
  createdAt: '2026-05-10 21:00',
  plannedAt: '2026-05-15 21:30',
};

/** Viec da xong cua talk show cu: [nguoi, tieu de, mo ta, bat dau, han, xong luc]. Xong sau han = tre han. */
export type PastCardDef = readonly [person: PersonKey, title: string, description: string, start: string, due: string, done: string];

export const PAST_CARDS: readonly PastCardDef[] = [
  ['lead', 'Lập kế hoạch tổng thể talk show Khởi nghiệp', 'Chia giai đoạn, timeline 7 tuần và mốc bàn giao cho từng mảng.', '2026-05-11', '2026-05-16', '2026-05-15 21:00'],
  ['lead', 'Lập dự toán và theo dõi ngân sách chương trình', 'Dự toán 62 triệu đồng, cập nhật thu chi hằng tuần.', '2026-05-13', '2026-05-20', '2026-05-20 17:00'],
  ['lead', 'Xin phê duyệt kế hoạch và mượn hội trường với Đoàn trường', 'Nộp tờ trình, dự toán và phiếu mượn hội trường.', '2026-05-18', '2026-05-25', '2026-05-27 10:00'],
  ['lead', 'Điều phối tổng duyệt chương trình', 'Tổng duyệt toàn bộ kịch bản với MC, sân khấu và kỹ thuật.', '2026-06-26 14:00', '2026-06-26 18:00', '2026-06-26 18:00'],
  ['lead', 'Tổng kết, báo cáo và quyết toán chương trình', 'Họp rút kinh nghiệm, báo cáo Đoàn trường và quyết toán kinh phí.', '2026-06-29', '2026-07-06', '2026-07-04 16:00'],

  ['noidung', 'Xây dựng nội dung 2 phiên thảo luận về khởi nghiệp', 'Khung nội dung phiên chia sẻ và phiên thảo luận.', '2026-05-14', '2026-05-24', '2026-05-23 21:00'],
  ['noidung', 'Soạn bộ câu hỏi phỏng vấn diễn giả', 'Bộ 14 câu hỏi theo kinh nghiệm của từng diễn giả.', '2026-05-25', '2026-06-03', '2026-06-03 20:00'],
  ['noidung', 'Viết kịch bản chương trình và lời dẫn MC', 'Kịch bản theo phút và lời dẫn hoàn chỉnh cho MC.', '2026-06-01', '2026-06-15', '2026-06-14 22:00'],
  ['noidung', 'Tổng hợp câu hỏi khán giả cho phần hỏi đáp', 'Lọc câu hỏi trùng, chọn câu hay để MC đọc.', '2026-06-20', '2026-06-27', '2026-06-27 15:00'],
  ['noidung', 'Viết bài tổng kết chương trình', 'Bài tổng kết kèm trích dẫn hay của diễn giả.', '2026-06-28', '2026-07-02', '2026-07-03 21:00'],

  ['khachmoi', 'Lên danh sách diễn giả là nhà sáng lập startup', 'Danh sách 6 người kèm phương án dự phòng.', '2026-05-12', '2026-05-17', '2026-05-16 18:00'],
  ['khachmoi', 'Mời và xác nhận lịch 2 diễn giả', 'Gửi thư mời, gọi điện xác nhận lịch và thù lao.', '2026-05-18', '2026-05-31', '2026-06-02 11:00'],
  ['khachmoi', 'Mời MC và gửi kịch bản trước chương trình', 'Chốt MC, gửi kịch bản và hẹn đọc thử.', '2026-05-25', '2026-06-10', '2026-06-09 19:00'],
  ['khachmoi', 'Thu thập tiểu sử và ảnh chân dung diễn giả', 'Tiểu sử 100 chữ và ảnh chân dung cho thiết kế.', '2026-06-01', '2026-06-07', '2026-06-06 20:00'],
  ['khachmoi', 'Chuẩn bị quà tặng và đón tiếp diễn giả', 'Quà tặng, phòng chờ và người hỗ trợ cho từng diễn giả.', '2026-06-15', '2026-06-27', '2026-06-27 13:00'],

  ['truyenthong', 'Lập kế hoạch truyền thông và lịch đăng bài', 'Kế hoạch 5 tuần, KPI tiếp cận và đăng ký.', '2026-05-15', '2026-05-22', '2026-05-21 21:00'],
  ['truyenthong', 'Liên hệ câu lạc bộ chia sẻ chương trình', 'Gửi bài và poster cho các câu lạc bộ, Liên chi đoàn.', '2026-06-01', '2026-06-12', '2026-06-11 18:00'],
  ['truyenthong', 'Viết bài giới thiệu diễn giả trên fanpage', 'Hai bài giới thiệu diễn giả đăng cách nhau 2 ngày.', '2026-06-05', '2026-06-14', '2026-06-13 20:00'],
  ['truyenthong', 'Chạy quảng cáo kêu gọi đăng ký tham dự', 'Ngân sách 3 triệu, đạt 410 lượt đăng ký.', '2026-06-08', '2026-06-25', '2026-06-25 22:00'],
  ['truyenthong', 'Đưa tin trực tiếp và đăng bài tổng kết', 'Story theo từng phiên và bài tổng kết kèm album ảnh.', '2026-06-27', '2026-06-30', '2026-06-30 21:00'],

  ['thietke', 'Thiết kế logo và bộ nhận diện chương trình', 'Logo, bảng màu, phông chữ và khung ảnh dùng chung.', '2026-05-15', '2026-05-24', '2026-05-26 23:00'],
  ['thietke', 'Thiết kế poster công bố và ảnh bìa fanpage', 'Poster 4:5 và ảnh bìa fanpage có mã QR đăng ký.', '2026-05-25', '2026-06-01', '2026-05-31 22:00'],
  ['thietke', 'Thiết kế ảnh giới thiệu diễn giả', 'Hai ảnh giới thiệu diễn giả cùng bố cục.', '2026-06-06', '2026-06-12', '2026-06-13 10:00'],
  ['thietke', 'Thiết kế backdrop sân khấu và standee', 'Backdrop 6m × 3m có vùng logo nhà tài trợ, hai standee.', '2026-06-08', '2026-06-18', '2026-06-18 20:00'],
  ['thietke', 'Thiết kế slide trình chiếu chương trình', 'Slide mở màn, giới thiệu diễn giả và màn hình chờ.', '2026-06-15', '2026-06-24', '2026-06-25 09:00'],

  ['taitro', 'Soạn hồ sơ tài trợ và gói quyền lợi', 'Hồ sơ tài trợ với 3 gói quyền lợi.', '2026-05-15', '2026-05-24', '2026-05-23 17:00'],
  ['taitro', 'Gửi thư mời tài trợ tới doanh nghiệp', 'Gửi thư mời 25 doanh nghiệp, theo dõi phản hồi.', '2026-05-25', '2026-06-05', '2026-06-05 21:00'],
  ['taitro', 'Đàm phán và ký hợp đồng với nhà tài trợ chính', 'Ký 3 hợp đồng, tổng giá trị 45 triệu đồng.', '2026-06-01', '2026-06-15', '2026-06-16 15:00'],
  ['taitro', 'Theo dõi thực hiện quyền lợi nhà tài trợ tại sự kiện', 'Bảng kiểm logo, gian hàng, phát biểu.', '2026-06-20', '2026-06-27', '2026-06-27 17:00'],
  ['taitro', 'Gửi báo cáo và thư cảm ơn nhà tài trợ', 'Báo cáo số liệu và hình ảnh quyền lợi đã thực hiện.', '2026-06-28', '2026-07-05', '2026-07-03 16:00'],

  ['haucan', 'Khảo sát và đặt hội trường', 'Khảo sát hội trường 300 chỗ, đặt lịch tổng duyệt và chính thức.', '2026-05-18', '2026-05-25', '2026-05-22 11:00'],
  ['haucan', 'Tuyển và phân công tình nguyện viên', 'Tuyển 18 tình nguyện viên, chia nhóm và tập huấn.', '2026-06-01', '2026-06-15', '2026-06-14 20:00'],
  ['haucan', 'Đặt in ấn backdrop, standee, vé mời', 'Lấy báo giá 2 xưởng in, nhận hàng đúng hẹn.', '2026-06-10', '2026-06-20', '2026-06-19 16:00'],
  ['haucan', 'Đặt tea-break và nước uống cho khách', 'Tea-break 300 phần và nước cho diễn giả.', '2026-06-15', '2026-06-25', '2026-06-24 15:00'],
  ['haucan', 'Bố trí chỗ ngồi và bàn check-in', 'Sơ đồ chỗ ngồi và hai bàn check-in ở sảnh.', '2026-06-20', '2026-06-26', '2026-06-26 17:00'],

  ['sankhau', 'Lấy báo giá và thuê âm thanh ánh sáng', 'So sánh 3 báo giá, chốt đơn vị có kỹ thuật viên trực.', '2026-05-25', '2026-06-08', '2026-06-07 18:00'],
  ['sankhau', 'Bố trí sân khấu và vị trí ghế diễn giả', 'Bố trí ghế diễn giả, bục MC và vị trí máy quay.', '2026-06-10', '2026-06-20', '2026-06-22 10:00'],
  ['sankhau', 'Chuẩn bị nhạc nền và hiệu ứng ánh sáng', 'Danh sách nhạc và cue ánh sáng theo kịch bản.', '2026-06-15', '2026-06-25', '2026-06-25 21:00'],
  ['sankhau', 'Vận hành âm thanh ánh sáng ngày diễn ra', 'Trực bàn mixer và bàn đèn suốt chương trình.', '2026-06-27 12:30', '2026-06-27 17:30', '2026-06-27 17:30'],

  ['kythuat', 'Làm trang đăng ký tham dự và form đăng ký', 'Landing page và form đăng ký đổ dữ liệu về bảng tính.', '2026-05-20', '2026-06-01', '2026-05-31 22:00'],
  ['kythuat', 'Gửi email xác nhận đăng ký cho khán giả', 'Email xác nhận kèm mã QR và email nhắc lịch.', '2026-06-02', '2026-06-10', '2026-06-09 21:00'],
  ['kythuat', 'Thiết lập livestream lên fanpage', 'OBS với 2 máy quay, khung tên diễn giả.', '2026-06-15', '2026-06-26', '2026-06-26 17:00'],
  ['kythuat', 'Check-in khán giả bằng mã QR', 'Quét mã QR tại cửa, đếm số người vào theo thời gian thực.', '2026-06-20', '2026-06-27', '2026-06-27 14:30'],
  ['kythuat', 'Thống kê số người đăng ký, tham dự và lượt xem livestream', 'Số liệu cho báo cáo tổng kết.', '2026-06-28', '2026-07-02', '2026-07-01 20:00'],

  ['media', 'Quay và dựng video teaser chương trình', 'Teaser 30 giây dọc và ngang.', '2026-05-28', '2026-06-06', '2026-06-05 23:00'],
  ['media', 'Quay phỏng vấn ngắn diễn giả', 'Hai video phỏng vấn ngắn 45 giây.', '2026-06-08', '2026-06-16', '2026-06-17 21:00'],
  ['media', 'Chụp ảnh và quay phim ngày diễn ra', 'Hai máy quay và hai máy ảnh.', '2026-06-27 12:30', '2026-06-27 18:00', '2026-06-27 18:00'],
  ['media', 'Dựng video highlight sau chương trình', 'Video highlight 3 phút có phụ đề.', '2026-06-28', '2026-07-05', '2026-07-04 22:00'],
  ['media', 'Cắt video ngắn đăng Reels và TikTok', 'Năm video 30–60 giây từ phần chia sẻ hay nhất.', '2026-06-30', '2026-07-08', '2026-07-08 21:00'],
];
