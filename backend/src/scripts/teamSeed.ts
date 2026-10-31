// Bo du lieu DEMO cho phan goi y phan cong: mot nhom 5 nguoi cung lam MOT loai viec (lap trinh
// giao dien website ban hang), moi nguoi co mot "so truong" rieng, ti le dung han khac nhau va tai
// hien tai khac nhau - de nhin duoc ket qua xep hang "ai nen nhan the nay" cho tung the.
//
// KHAC seedSimulation (simSeed.ts): du lieu o day do TAY soan, KHONG ngau nhien; moi moc thoi gian
// ghi theo "cach day N ngay" so voi hom nay nen luc nao chay cung co lich su MOI (ham suy giam theo
// thoi gian co nua doi 90 ngay - xem ASSIGN_MODULE.md §5.3, du lieu cu qua thi khong con y nghia).
//
// AN TOAN: moi thu tao ra deu gan voi tai khoan @team.local; phan don dep chi xoa dung nhung tai
// khoan do va thu ho so huu - khong cham vao du lieu that, khong cham vao du lieu @sim.local.
// Chay lai nhieu lan la an toan: luon don sach ban cu roi tao ban moi trong MOT transaction.

import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { hashPassword } from '../utils/password';
import { SIM_DEFAULT_PASSWORD, simDayToDate, vnToday } from './simSeed';

export const TEAM_EMAIL_DOMAIN = 'team.local';
export const TEAM_WORKSPACE_NAME = 'Nhóm Website bán hàng (demo)';
export const TEAM_PASSWORD = SIM_DEFAULT_PASSWORD;

type Db = PrismaClient | Prisma.TransactionClient;

// ===================== Du lieu soan tay =====================

export interface TeamPerson {
  key: string;
  name: string;
  email: string;
  /** So the song song toi da (MemberWorkProfile.maxParallelCards). */
  capacity: number;
  /** Vao nhom cach day bao nhieu ngay. */
  joinedAgo: number;
  /** Ghi chu cho nguoi doc/nguoi demo - khong dua vao bo cham diem. */
  role: string;
}

/** key dau tien la truong nhom (chu khong gian, giao viec cho nguoi khac). */
export const TEAM_PEOPLE: readonly TeamPerson[] = [
  { key: 'long', name: 'Nguyễn Minh Long', email: `long@${TEAM_EMAIL_DOMAIN}`, capacity: 5, joinedAgo: 135, role: 'Trưởng nhóm - mạnh về trang sản phẩm, làm đúng hạn' },
  { key: 'mai', name: 'Trần Thị Mai', email: `mai@${TEAM_EMAIL_DOMAIN}`, capacity: 4, joinedAgo: 130, role: 'Mạnh về giỏ hàng và thanh toán, đang nhiều việc' },
  { key: 'nam', name: 'Lê Văn Nam', email: `nam@${TEAM_EMAIL_DOMAIN}`, capacity: 5, joinedAgo: 130, role: 'Mạnh về tài khoản/đăng nhập, hay trễ hạn' },
  { key: 'oanh', name: 'Phạm Thu Oanh', email: `oanh@${TEAM_EMAIL_DOMAIN}`, capacity: 5, joinedAgo: 120, role: 'Mạnh về giao diện điện thoại/hiệu ứng, luôn đúng hạn' },
  { key: 'phuc', name: 'Võ Đức Phúc', email: `phuc@${TEAM_EMAIL_DOMAIN}`, capacity: 3, joinedAgo: 21, role: 'Thành viên mới, ít lịch sử' },
];

/** Bang (sprint) theo thu tu thoi gian. startAgo = ngay bat dau (cach day bao nhieu ngay); endAgo am = ke ca tuong lai. */
export const TEAM_BOARDS: readonly { name: string; startAgo: number; endAgo: number }[] = [
  { name: 'Sprint 1: Khung giao diện và trang sản phẩm', startAgo: 130, endAgo: 96 },
  { name: 'Sprint 2: Giỏ hàng, thanh toán và tài khoản', startAgo: 95, endAgo: 61 },
  { name: 'Sprint 3: Hoàn thiện và tối ưu giao diện', startAgo: 60, endAgo: 26 },
  { name: 'Sprint 4: Đang chạy', startAgo: 25, endAgo: -15 },
];

// Viec DA XONG: [tieu de, mo ta, xong cach day N ngay, tre N ngay so voi han (am = xong som), bi mo lai?].
// Han = xong - tre; bat dau = han - 5 ngay. tre <= 0 la DUNG HAN (xem assign.score.ts §5.5).
type DoneRow = readonly [title: string, description: string, doneAgo: number, late: number, reopened?: boolean];
// Viec DANG MO da giao: [tieu de, mo ta, giao cach day N ngay, con N ngay nua toi han].
type OpenRow = readonly [title: string, description: string, assignedAgo: number, dueIn: number];
// Viec CHUA GIAO (de demo goi y): [tieu de, mo ta, con N ngay nua toi han | null = khong dat han].
type TodoRow = readonly [title: string, description: string, dueIn: number | null];

const DONE: Record<string, readonly DoneRow[]> = {
  // Truong nhom: trang san pham / danh muc. 12 viec dung han / 14.
  long: [
    ['Làm giao diện trang danh sách sản phẩm', 'Dựng lưới 4 cột hiển thị ảnh, tên, giá và nút thêm vào giỏ; co lại còn 2 cột trên màn hình nhỏ.', 3, -1],
    ['Thêm bộ lọc theo giá và thương hiệu cho trang danh sách sản phẩm', 'Bộ lọc dạng thanh trượt giá và ô chọn thương hiệu, cập nhật danh sách không tải lại trang.', 6, 0],
    ['Làm giao diện trang chi tiết sản phẩm', 'Hiển thị ảnh lớn, mô tả, đánh giá và các lựa chọn kích cỡ, màu sắc.', 9, -1],
    ['Thêm phân trang cho trang danh sách sản phẩm', 'Phân trang có nút trước, sau và số trang; giữ nguyên bộ lọc khi chuyển trang.', 12, 0],
    ['Hiển thị thư viện ảnh sản phẩm dạng carousel', 'Ảnh nhỏ bên dưới, bấm vào để phóng to; vuốt được trên điện thoại.', 15, 1],
    ['Làm thẻ sản phẩm có nhãn giảm giá', 'Hiển thị phần trăm giảm ở góc thẻ và giá gốc gạch ngang.', 19, -1],
    ['Làm trang danh mục sản phẩm theo từng nhóm hàng', 'Danh mục dạng cây ở bên trái, chọn nhóm hàng thì lọc danh sách bên phải.', 24, 0],
    ['Sửa lỗi hiển thị giá sản phẩm bị xuống dòng', 'Giá dài bị tràn khỏi thẻ khi số tiền lớn; cho co chữ và giữ trên một dòng.', 33, 0],
    ['Viết kiểm thử giao diện cho trang danh sách sản phẩm', 'Kiểm thử hiển thị đủ sản phẩm, lọc theo giá và chuyển trang.', 41, -1],
    ['Thêm tìm kiếm gợi ý ở thanh tìm kiếm sản phẩm', 'Gõ ba ký tự thì hiện tối đa sáu gợi ý, chọn bằng phím mũi tên.', 52, 2],
    ['Làm giao diện trang chủ với khu vực sản phẩm nổi bật', 'Banner đầu trang, hàng sản phẩm bán chạy và sản phẩm mới về.', 70, 0],
    ['Dựng khung giao diện chung cho website', 'Đầu trang, chân trang và bố cục lưới dùng chung cho mọi trang.', 95, -1],
    ['Làm thanh điều hướng chính của website', 'Menu ngang có danh mục con xổ xuống khi rê chuột.', 105, 0],
    ['Cài đặt bộ biến màu và kiểu chữ dùng chung', 'Khai báo biến màu, khoảng cách và kiểu chữ để cả nhóm dùng thống nhất.', 118, 0],
  ],
  // Gio hang + thanh toan. 10 viec dung han / 12.
  mai: [
    ['Làm giao diện trang giỏ hàng', 'Danh sách sản phẩm đã chọn, ô đổi số lượng, nút xoá và tổng tiền tạm tính.', 2, 0],
    ['Làm form nhập địa chỉ giao hàng', 'Gồm họ tên, số điện thoại, tỉnh thành, quận huyện và ghi chú; kiểm tra bắt buộc từng ô.', 5, -1],
    ['Làm giao diện bước chọn phương thức thanh toán', 'Chọn thanh toán khi nhận hàng, thẻ ngân hàng hoặc ví điện tử; hiển thị hướng dẫn tương ứng.', 8, 0],
    ['Hiển thị tóm tắt đơn hàng ở trang thanh toán', 'Cột bên phải liệt kê sản phẩm, phí vận chuyển, mã giảm giá và tổng thanh toán.', 11, 2],
    ['Áp dụng mã giảm giá ở trang giỏ hàng', 'Ô nhập mã, thông báo mã hợp lệ hoặc hết hạn và cập nhật lại tổng tiền.', 14, -1, true],
    ['Làm trang xác nhận đặt hàng thành công', 'Hiển thị mã đơn, thời gian giao dự kiến và nút xem chi tiết đơn hàng.', 18, 0],
    ['Kiểm tra dữ liệu form thanh toán trước khi gửi', 'Báo lỗi ngay dưới từng ô, không cho gửi khi thiếu thông tin bắt buộc.', 23, 0],
    ['Sửa lỗi hiển thị tổng tiền khi đổi số lượng trong giỏ hàng', 'Tổng tiền không cập nhật ngay sau khi bấm tăng giảm; đồng bộ lại theo số lượng mới.', 34, 3],
    ['Viết kiểm thử giao diện cho luồng thanh toán', 'Kiểm thử từ giỏ hàng đến xác nhận đơn hàng với dữ liệu mẫu.', 44, -1],
    ['Làm biểu tượng giỏ hàng có số lượng trên thanh điều hướng', 'Chấm đỏ hiển thị số sản phẩm và cập nhật ngay khi thêm vào giỏ.', 58, 0],
    ['Làm giao diện danh sách sản phẩm yêu thích', 'Trái tim ở góc thẻ sản phẩm, trang riêng liệt kê các sản phẩm đã lưu.', 75, 0],
    ['Dựng các thành phần nút bấm và ô nhập dùng chung', 'Chuẩn hoá nút chính, nút phụ và ô nhập với đủ trạng thái lỗi, vô hiệu.', 100, 0],
  ],
  // Tai khoan / dang nhap. 7 viec dung han / 11 (hay tre).
  nam: [
    ['Làm giao diện trang đăng nhập', 'Form email và mật khẩu, nút hiện mật khẩu, thông báo lỗi khi sai thông tin.', 4, 1],
    ['Làm form đăng ký tài khoản', 'Nhập họ tên, email, mật khẩu và nhập lại mật khẩu, kiểm tra độ mạnh mật khẩu.', 7, 0, true],
    ['Kiểm tra dữ liệu form đăng ký', 'Kiểm tra định dạng email, độ dài mật khẩu và hai mật khẩu phải trùng nhau.', 10, 3],
    ['Làm chức năng quên mật khẩu', 'Nhập email để nhận liên kết, trang đặt lại mật khẩu mới và thông báo thành công.', 14, 0],
    ['Làm trang hồ sơ cá nhân', 'Xem và sửa họ tên, số điện thoại, ảnh đại diện và địa chỉ giao hàng mặc định.', 18, 2],
    ['Làm trang lịch sử đơn hàng của tôi', 'Bảng các đơn đã đặt kèm trạng thái, ngày đặt, tổng tiền và nút xem chi tiết.', 22, -1],
    ['Ghép API đăng nhập vào form đăng nhập', 'Gọi API, lưu phiên đăng nhập và chuyển về trang đang xem trước đó.', 27, 0],
    ['Sửa lỗi hiển thị thông báo lỗi ở form đăng nhập', 'Thông báo bị che bởi bàn phím trên điện thoại; cuộn tới ô đầu tiên bị lỗi.', 38, 4],
    ['Viết kiểm thử giao diện cho form đăng nhập', 'Kiểm thử đăng nhập đúng, sai mật khẩu và bỏ trống ô.', 49, 0],
    ['Làm giao diện trang đổi mật khẩu', 'Nhập mật khẩu cũ, mật khẩu mới và xác nhận; báo thành công.', 66, -1],
    ['Làm giao diện trang giới thiệu và liên hệ', 'Thông tin cửa hàng, bản đồ và form gửi liên hệ.', 92, 0],
  ],
  // Giao dien dien thoai / hieu ung / toi uu. 9 viec, deu dung han.
  oanh: [
    ['Làm menu điều hướng dạng hamburger cho màn hình nhỏ', 'Nút ba gạch mở ngăn kéo bên trái, đóng khi bấm ra ngoài hoặc chọn mục.', 4, -1],
    ['Làm giao diện trang chủ hiển thị tốt trên điện thoại', 'Điều chỉnh bố cục một cột, cỡ chữ và khoảng cách cho màn hình dưới 480px.', 7, 0],
    ['Thêm chế độ tối cho toàn bộ giao diện', 'Nút chuyển sáng tối, lưu lựa chọn và dùng biến màu cho mọi thành phần.', 11, 0],
    ['Tối ưu tốc độ tải ảnh trên trang chủ', 'Tải ảnh khi cuộn tới, dùng định dạng nhẹ và kích thước phù hợp từng màn hình.', 14, -1],
    ['Thêm hiệu ứng chuyển trang mượt hơn', 'Hiệu ứng mờ dần khi chuyển trang và khung xương khi đang tải dữ liệu.', 17, 0],
    ['Sửa lỗi vỡ bố cục trên trình duyệt Safari', 'Khoảng cách và lưới bị lệch trên Safari cũ; bổ sung tiền tố và giải pháp thay thế.', 25, 0],
    ['Chuẩn hoá màu sắc và phông chữ theo bản thiết kế', 'Đối chiếu từng thành phần với bản thiết kế và sửa các chỗ lệch màu, cỡ chữ.', 40, -1],
    ['Viết kiểm thử giao diện cho menu điều hướng', 'Kiểm thử menu trên nhiều kích thước màn hình.', 55, 0],
    ['Làm giao diện thanh tìm kiếm co giãn theo màn hình', 'Ô tìm kiếm thu gọn thành biểu tượng trên màn hình nhỏ.', 80, 0],
  ],
  // Thanh vien moi (vao 21 ngay truoc): chi co 2 viec nho.
  phuc: [
    ['Sửa lỗi chính tả và nội dung ở chân trang', 'Cập nhật thông tin liên hệ, giờ làm việc và liên kết mạng xã hội trong chân trang.', 8, 0],
    ['Thêm biểu tượng mạng xã hội vào chân trang', 'Biểu tượng Facebook, Zalo và YouTube, mở liên kết trong tab mới.', 4, -1],
  ],
};

const OPEN: Record<string, readonly OpenRow[]> = {
  // Mai co 4 viec dang mo = dung suc chua (4) -> co OVERLOADED khi the moi chong lan.
  mai: [
    ['Làm giao diện trang theo dõi đơn hàng', 'Dòng thời gian trạng thái đơn hàng: đã đặt, đang giao, đã nhận.', 6, 4],
    ['Thêm hiệu ứng cho nút thêm vào giỏ hàng', 'Nút rung nhẹ và bay vào biểu tượng giỏ hàng khi bấm.', 3, 6],
    ['Làm giao diện trang lịch sử thanh toán', 'Bảng các lần thanh toán kèm trạng thái và nút tải hoá đơn.', 2, 8],
    ['Sửa lỗi hiển thị mã giảm giá trên màn hình nhỏ', 'Ô nhập mã bị che nút áp dụng khi màn hình dưới 360px.', 1, 3],
  ],
  long: [
    ['Làm giao diện trang khuyến mãi theo mùa', 'Banner lớn, đếm ngược thời gian và lưới sản phẩm giảm giá.', 4, 7],
    ['Thêm nhãn hàng mới về vào thẻ sản phẩm', 'Nhãn màu xanh cho sản phẩm mới trong 14 ngày.', 2, 5],
  ],
  nam: [
    ['Làm giao diện xác thực hai bước bằng mã OTP', 'Ô nhập sáu số, đếm ngược gửi lại mã và báo lỗi khi sai mã.', 5, 7],
    ['Làm trang quản lý địa chỉ giao hàng', 'Thêm, sửa, xoá địa chỉ và chọn địa chỉ mặc định.', 2, 9],
  ],
  oanh: [['Thêm hiệu ứng khung xương khi tải danh sách sản phẩm', 'Các khối xám nhấp nháy thay cho ảnh và chữ trong lúc chờ dữ liệu.', 3, 5]],
};

// Viec CHUA GIAO trong sprint dang chay (cot "Can lam"): moi the "hop" voi so truong cua mot nguoi.
const TODO: readonly TodoRow[] = [
  ['Làm giao diện trang so sánh sản phẩm', 'Bảng so sánh thông số của tối đa bốn sản phẩm, làm nổi bật điểm khác biệt.', 9],
  ['Làm form chọn thời gian giao hàng và ghi chú cho đơn', 'Chọn khung giờ giao, ghi chú cho người giao hàng và hiển thị phí vận chuyển tương ứng.', 6],
  ['Làm giao diện đăng nhập bằng Google và Facebook', 'Hai nút đăng nhập nhanh dưới form, xử lý trường hợp tài khoản đã tồn tại.', 8],
  ['Làm giao diện dạng ngăn kéo cho màn hình điện thoại', 'Các bảng chức năng mở dạng ngăn kéo từ dưới lên trên màn hình nhỏ, vuốt xuống để đóng.', null],
  ['Sửa lỗi hiển thị bảng giá trên trình duyệt cũ', 'Bảng giá bị tràn ngang; cho cuộn ngang và cố định cột đầu.', null],
  ['Viết kiểm thử giao diện cho trang giỏ hàng', 'Kiểm thử thêm, xoá, đổi số lượng và áp dụng mã giảm giá.', 12],
  ['Cập nhật thông tin liên hệ và giờ làm việc ở chân trang', 'Đổi số điện thoại, địa chỉ cửa hàng và khung giờ làm việc mới trong chân trang của website.', null],
];

const SPAN_DAYS = 5; // bat dau = han - 5 ngay

// ===================== Khai trien thanh tung the =====================

export interface TeamCard {
  key: string;
  title: string;
  description: string;
  /** null = chua giao. */
  assigneeKey: string | null;
  boardIndex: number;
  /** 0 = Can lam, 1 = Dang lam, 2 = Hoan thanh. */
  listIndex: 0 | 1 | 2;
  /** Cac moc "cach day N ngay" (am = tuong lai). */
  createdAgo: number;
  assignedAgo: number | null;
  dueAgo: number | null;
  completedAgo: number | null;
  reopened: boolean;
}

function boardIndexFor(ago: number): number {
  const fits = TEAM_BOARDS.map((b, i) => ({ i, start: b.startAgo })).filter((b) => b.start >= ago);
  if (fits.length === 0) return 0; // cu hon moi bang -> bang dau
  return fits.reduce((a, b) => (b.start < a.start ? b : a)).i;
}

/** Ham thuan: khai trien du lieu soan tay thanh danh sach the day du moc thoi gian. */
export function expandTeamCards(): TeamCard[] {
  const out: TeamCard[] = [];
  for (const person of TEAM_PEOPLE) {
    (DONE[person.key] ?? []).forEach(([title, description, doneAgo, late, reopened], i) => {
      const dueAgo = doneAgo + late;
      const assignedAgo = dueAgo + SPAN_DAYS;
      out.push({
        key: `${person.key}-done-${i + 1}`,
        title,
        description,
        assigneeKey: person.key,
        boardIndex: boardIndexFor(assignedAgo),
        listIndex: 2,
        createdAgo: assignedAgo + 1,
        assignedAgo,
        dueAgo,
        completedAgo: doneAgo,
        reopened: reopened === true,
      });
    });
    (OPEN[person.key] ?? []).forEach(([title, description, assignedAgo, dueIn], i) => {
      out.push({
        key: `${person.key}-open-${i + 1}`,
        title,
        description,
        assigneeKey: person.key,
        boardIndex: TEAM_BOARDS.length - 1,
        listIndex: 1,
        createdAgo: assignedAgo + 1,
        assignedAgo,
        dueAgo: -dueIn,
        completedAgo: null,
        reopened: false,
      });
    });
  }
  TODO.forEach(([title, description, dueIn], i) => {
    out.push({
      key: `todo-${i + 1}`,
      title,
      description,
      assigneeKey: null,
      boardIndex: TEAM_BOARDS.length - 1,
      listIndex: 0,
      createdAgo: 2,
      assignedAgo: null,
      dueAgo: dueIn === null ? null : -dueIn,
      completedAgo: null,
      reopened: false,
    });
  });
  return out;
}

// ===================== Ghi vao CSDL =====================

export interface RemoveTeamResult {
  users: number;
  workspaces: number;
}

/** Xoa toan bo du lieu nhom demo cu. Chi dung toi tai khoan @team.local va thu ho so huu. */
export async function removeTeam(db: Db): Promise<RemoveTeamResult> {
  const users = await db.user.findMany({
    where: { email: { endsWith: `@${TEAM_EMAIL_DOMAIN}` } },
    select: { id: true },
  });
  if (users.length === 0) return { users: 0, workspaces: 0 };

  const userIds = users.map((u) => u.id);
  const workspaces = await db.workspace.findMany({
    where: { ownerId: { in: userIds } },
    select: { id: true },
  });
  const workspaceIds = workspaces.map((w) => w.id);

  // AssignRun dung SetNull (nhat ky phai song sot qua viec xoa) - o day ta MUON xoa vi chung la
  // nhat ky cua du lieu gia; neu de lai chi la rac mo coi.
  await db.assignRun.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
  // Xoa user keo theo (Cascade): khong gian, bang, danh sach, the, thanh vien, nhat ky hoat dong, ho so.
  await db.user.deleteMany({ where: { id: { in: userIds } } });

  return { users: userIds.length, workspaces: workspaceIds.length };
}

export interface SeedTeamOptions {
  /** Ngay "hom nay" theo gio VN, YYYY-MM-DD. Mac dinh: hom nay that. */
  today?: string;
  password?: string;
}

export interface SeedTeamResult {
  workspaceId: string;
  userIds: Record<string, string>;
  boardIds: string[];
  /** Id cac the CHUA GIAO (theo thu tu trong TODO) - de mo len xem goi y. */
  todoCardIds: string[];
  /** Cot "Can lam" cua sprint dang chay - de thu "Chia viec goi y". */
  todoListId: string;
  removed: RemoveTeamResult;
  counts: { users: number; boards: number; cards: number; done: number; open: number; unassigned: number };
}

const BOARD_COLORS = ['#0079BF', '#519839', '#B04632', '#89609E'];
const LIST_NAMES = ['Cần làm', 'Đang làm', 'Hoàn thành'] as const;

export async function seedTeam(prisma: PrismaClient, opts: SeedTeamOptions = {}): Promise<SeedTeamResult> {
  const today = opts.today ?? vnToday();
  // simDayToDate(today, 0, -N) = 00:00 gio VN cua ngay cach day N ngay (am = tuong lai)
  const at = (ago: number, hour = 0, minute = 0) => simDayToDate(today, 0, -ago, hour, minute);
  const passwordHash = await hashPassword(opts.password ?? TEAM_PASSWORD);
  const cards = expandTeamCards();
  const leader = TEAM_PEOPLE[0]!;

  return prisma.$transaction(
    async (tx) => {
      const removed = await removeTeam(tx);

      // ---------- Tai khoan + khong gian ca nhan (giong luc dang ky that) ----------
      const userIds: Record<string, string> = {};
      for (const p of TEAM_PEOPLE) {
        const user = await tx.user.create({
          data: {
            email: p.email,
            name: p.name,
            passwordHash,
            emailVerifiedAt: at(p.joinedAgo, 8),
            createdAt: at(p.joinedAgo, 8),
          },
          select: { id: true },
        });
        userIds[p.key] = user.id;
        await tx.workspace.create({
          data: {
            ownerId: user.id,
            name: `Không gian của ${p.name}`,
            isPersonal: true,
            members: { create: { userId: user.id, role: 'OWNER' } },
          },
        });
      }

      // ---------- Khong gian nhom + ho so lam viec ----------
      const workspace = await tx.workspace.create({
        data: { ownerId: userIds[leader.key]!, name: TEAM_WORKSPACE_NAME, createdAt: at(leader.joinedAgo, 9) },
        select: { id: true },
      });
      for (const p of TEAM_PEOPLE) {
        await tx.workspaceMember.create({
          data: {
            workspaceId: workspace.id,
            userId: userIds[p.key]!,
            role: p.key === leader.key ? 'OWNER' : 'MEMBER',
            createdAt: at(p.joinedAgo, 9),
          },
        });
        await tx.memberWorkProfile.create({
          data: { userId: userIds[p.key]!, workspaceId: workspace.id, maxParallelCards: p.capacity },
        });
      }

      // ---------- Bang + danh sach + thanh vien bang ----------
      const boardIds: string[] = [];
      const listIds: string[][] = [];
      for (const [bi, b] of TEAM_BOARDS.entries()) {
        const board = await tx.board.create({
          data: {
            ownerId: userIds[leader.key]!,
            workspaceId: workspace.id,
            name: b.name,
            color: BOARD_COLORS[bi % BOARD_COLORS.length]!,
            createdAt: at(b.startAgo, 9),
          },
          select: { id: true },
        });
        boardIds.push(board.id);

        const lists: string[] = [];
        for (const [li, name] of LIST_NAMES.entries()) {
          const list = await tx.list.create({
            data: { boardId: board.id, name, position: li, createdAt: at(b.startAgo, 9) },
            select: { id: true },
          });
          lists.push(list.id);
        }
        listIds.push(lists);

        for (const p of TEAM_PEOPLE) {
          // Chi nguoi da vao nhom truoc khi bang ket thuc moi la thanh vien bang
          if (p.joinedAgo < b.endAgo) continue;
          const joinedAgo = Math.min(p.joinedAgo, b.startAgo);
          await tx.boardMember.create({
            data: {
              boardId: board.id,
              userId: userIds[p.key]!,
              role: p.key === leader.key ? 'OWNER' : 'MEMBER',
              joinedAt: at(joinedAgo, 9),
              createdAt: at(joinedAgo, 9),
            },
          });
        }
      }

      // ---------- The + nguoi duoc gan + nhat ky ----------
      const nameOf = new Map(TEAM_PEOPLE.map((p) => [p.key, p.name]));
      const positions = new Map<string, number>();
      const activities: Prisma.ActivityCreateManyInput[] = [];
      const cardIdByKey = new Map<string, string>();

      for (const c of cards) {
        const boardId = boardIds[c.boardIndex]!;
        const listId = listIds[c.boardIndex]![c.listIndex]!;
        const posKey = `${c.boardIndex}/${c.listIndex}`;
        const position = positions.get(posKey) ?? 0;
        positions.set(posKey, position + 1);

        const createdAt = at(c.createdAgo, 9);
        const assignedAt = c.assignedAgo === null ? null : at(c.assignedAgo, 10);
        const completedAt = c.completedAgo === null ? null : at(c.completedAgo, 17);
        // Truong nhom giao; nguoi giao = chinh nguoi nhan thi la tu nhan (assignedById phai la null)
        const assignerKey = c.assigneeKey === null || c.assigneeKey === leader.key ? null : leader.key;

        const card = await tx.card.create({
          data: {
            listId,
            title: c.title,
            description: c.description,
            status: c.completedAgo !== null ? 'DONE' : 'TODO',
            isDone: c.completedAgo !== null,
            completedAt,
            startDate: c.assignedAgo === null ? null : at(c.assignedAgo, 0),
            dueDate: c.dueAgo === null ? null : at(c.dueAgo, 23, 59),
            position,
            createdAt,
            updatedAt: completedAt ?? assignedAt ?? createdAt,
            ...(c.assigneeKey === null
              ? {}
              : {
                  members: {
                    create: {
                      userId: userIds[c.assigneeKey]!,
                      createdAt: assignedAt!,
                      assignedById: assignerKey === null ? null : userIds[assignerKey]!,
                    },
                  },
                }),
          },
          select: { id: true },
        });
        cardIdByKey.set(c.key, card.id);

        activities.push({
          boardId,
          cardId: card.id,
          userId: userIds[leader.key]!,
          type: 'card.create',
          data: { listName: LIST_NAMES[0] },
          createdAt,
        });
        if (c.assigneeKey !== null) {
          const assigneeId = userIds[c.assigneeKey]!;
          activities.push({
            boardId,
            cardId: card.id,
            userId: assignerKey === null ? assigneeId : userIds[assignerKey]!,
            type: 'member.add',
            data: { memberId: assigneeId, memberName: nameOf.get(c.assigneeKey)! },
            createdAt: assignedAt!,
          });
          if (c.completedAgo !== null) {
            if (c.reopened) {
              // Xong -> mo lai -> xong trong cung ngay (completedAt chi giu lan cuoi, con lich su mo
              // lai nam o day - bo cham doc `card.undone` de biet the tung bi mo lai).
              activities.push(
                { boardId, cardId: card.id, userId: assigneeId, type: 'card.done', data: {}, createdAt: at(c.completedAgo, 9) },
                { boardId, cardId: card.id, userId: assigneeId, type: 'card.undone', data: {}, createdAt: at(c.completedAgo, 11) }
              );
            }
            activities.push({ boardId, cardId: card.id, userId: assigneeId, type: 'card.done', data: {}, createdAt: completedAt! });
          }
        }
      }
      await tx.activity.createMany({ data: activities });

      const todoCardIds = cards.filter((c) => c.key.startsWith('todo-')).map((c) => cardIdByKey.get(c.key)!);
      const lastBoard = TEAM_BOARDS.length - 1;
      return {
        workspaceId: workspace.id,
        userIds,
        boardIds,
        todoCardIds,
        todoListId: listIds[lastBoard]![0]!,
        removed,
        counts: {
          users: TEAM_PEOPLE.length,
          boards: TEAM_BOARDS.length,
          cards: cards.length,
          done: cards.filter((c) => c.completedAgo !== null).length,
          open: cards.filter((c) => c.assigneeKey !== null && c.completedAgo === null).length,
          unassigned: cards.filter((c) => c.assigneeKey === null).length,
        },
      };
    },
    { timeout: 120_000, maxWait: 10_000 }
  );
}
