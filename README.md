# TaskFlow — Website quản lý công việc và dự án

TaskFlow là ứng dụng web quản lý công việc theo mô hình bảng Kanban, thực hiện trong khuôn khổ khoá luận tốt nghiệp. Dữ liệu được tổ chức theo bốn tầng: **không gian làm việc → bảng → danh sách (cột) → thẻ công việc**. Nhiều người cùng làm trên một bảng và thấy thay đổi của nhau ngay lập tức qua Socket.IO.

Ngoài phần quản lý công việc, dự án có ba module AI:

1. **Tạo bảng từ mô tả**: dán đoạn mô tả hoặc tải tệp `.docx`/`.pdf`, hệ thống dựng sẵn cột, thẻ, ngày, nhãn và checklist để người dùng xem trước rồi mới tạo.
2. **Gợi ý phân công**: xếp hạng thành viên phù hợp cho từng thẻ dựa trên lịch sử làm việc, độ tin cậy, mức bận và hồ sơ tự khai; có thể chia việc cho cả danh sách thẻ.
3. **Chatbot trợ lý**: hỏi đáp bằng tiếng Việt về công việc, ví dụ "tuần này tôi còn việc gì quá hạn", "ai đang giữ nhiều việc nhất". Số liệu do backend tính, LLM chỉ dùng để hiểu câu hỏi.

Cả ba module vẫn chạy khi chưa cấu hình khoá API. Khi đó hệ thống dùng bộ luật viết tay thay cho LLM.

---

## Mục lục

1. [Công nghệ sử dụng](#1-công-nghệ-sử-dụng)
2. [Cấu trúc thư mục](#2-cấu-trúc-thư-mục)
3. [Cài đặt và chạy](#3-cài-đặt-và-chạy)
4. [Biến môi trường](#4-biến-môi-trường)
5. [Chức năng quản lý công việc](#5-chức-năng-quản-lý-công-việc)
6. [Module AI 1 — Tạo bảng từ mô tả](#6-module-ai-1--tạo-bảng-từ-mô-tả)
7. [Module AI 2 — Gợi ý phân công](#7-module-ai-2--gợi-ý-phân-công)
8. [Module AI 3 — Chatbot trợ lý](#8-module-ai-3--chatbot-trợ-lý)
9. [Thời gian thực (Socket.IO)](#9-thời-gian-thực-socketio)
10. [Bảo mật và phân quyền](#10-bảo-mật-và-phân-quyền)
11. [Danh sách API](#11-danh-sách-api)
12. [Mô hình dữ liệu](#12-mô-hình-dữ-liệu)
13. [Kiểm thử và đánh giá](#13-kiểm-thử-và-đánh-giá)

---

## 1. Công nghệ sử dụng

| Lớp | Công nghệ |
|---|---|
| Frontend | React 19, Vite 8, TypeScript, Tailwind CSS 4, React Router 7, `@dnd-kit` (kéo thả), Axios, `socket.io-client` |
| Backend | Node.js 20, Express 4, TypeScript, Zod 4 (kiểm tra dữ liệu vào), Multer (tải tệp), Nodemailer, `express-rate-limit` |
| Cơ sở dữ liệu | PostgreSQL 16, Prisma ORM 7 (adapter `pg`) |
| Xác thực | JWT lưu trong cookie `httpOnly`, mật khẩu băm bằng bcrypt, đăng nhập Google (`@react-oauth/google` + `google-auth-library`) |
| Thời gian thực | Socket.IO 4, dùng chung cổng HTTP với API |
| AI | Bất kỳ nhà cung cấp nào có API tương thích OpenAI (`/chat/completions`). Mặc định dùng Google Gemini. Đọc tệp bằng `mammoth` (.docx) và `pdf-parse` (.pdf) |
| Dịch vụ ngoài | Unsplash API (ảnh nền bảng), SMTP hoặc Ethereal (gửi mail) |
| Kiểm thử | Vitest + Supertest (backend, chạy trên PostgreSQL thật), Vitest + Testing Library + jsdom (frontend) |
| Hạ tầng | Docker Compose chạy PostgreSQL và backend; frontend chạy trực tiếp trên máy |

---

## 2. Cấu trúc thư mục

```
KLTN-Web/
├── backend/                     API Express + Prisma
│   ├── prisma/
│   │   ├── schema.prisma        Toàn bộ mô hình dữ liệu
│   │   └── migrations/          Lịch sử migration
│   ├── src/
│   │   ├── app.ts               Khai báo middleware và gắn route
│   │   ├── server.ts            Khởi động HTTP + Socket.IO + các bộ hẹn giờ
│   │   ├── config/              env, prisma, mailer, cấu hình tải tệp
│   │   ├── middleware/          auth, rate limit, validate, chặn tải tệp
│   │   ├── realtime/socket.ts   Phòng socket, phát sự kiện, kiểm quyền vào phòng
│   │   ├── modules/
│   │   │   ├── auth/            Đăng ký, đăng nhập, Google, quên mật khẩu, xác minh email
│   │   │   ├── workspace/       Không gian làm việc, thành viên, trang tổng quan
│   │   │   ├── board/           Bảng, thành viên, chia sẻ, mẫu bảng, xem công khai
│   │   │   ├── list/            Danh sách (cột)
│   │   │   ├── card/            Thẻ, checklist, bình luận, đính kèm, nhắc hạn, thẻ định kỳ, mẫu thẻ, trạng thái
│   │   │   ├── label/           Nhãn
│   │   │   ├── customField/     Trường tuỳ chỉnh
│   │   │   ├── automation/      Luật tự động
│   │   │   ├── activity/        Nhật ký hoạt động
│   │   │   ├── notification/    Thông báo, tuỳ chọn nhận, email tổng hợp hằng ngày
│   │   │   ├── search/          Tìm kiếm nâng cao, bộ lọc đã lưu
│   │   │   ├── watch/           Theo dõi bảng / danh sách / thẻ
│   │   │   ├── unsplash/        Proxy Unsplash có bộ nhớ đệm
│   │   │   ├── ai/              Module AI 1 — tạo bảng từ mô tả
│   │   │   ├── assign/          Module AI 2 — gợi ý phân công
│   │   │   ├── declaredProfile/ Hồ sơ tự khai (kỹ năng, công việc đã làm, CV)
│   │   │   └── chat/            Module AI 3 — chatbot (v1 và thư mục v2/)
│   │   ├── scripts/             Script đánh giá, sinh dữ liệu mô phỏng, dữ liệu demo
│   │   └── utils/               AppError, JWT, băm mật khẩu, asyncHandler
│   ├── test/                    Test backend (Vitest + Supertest)
│   └── Dockerfile
├── frontend/                    SPA React
│   └── src/
│       ├── App.tsx              Khai báo route
│       ├── layouts/             MainLayout, BoardViewLayout
│       ├── pages/               Các trang (Board, Calendar, Search, Workspace, ...)
│       ├── components/          board/, assistant/, auth/, workspace/, nav/, landing/, ...
│       ├── context/             Auth, Boards, Workspaces, Theme, Assistant
│       ├── lib/                 Gọi API, socket, logic thuần (lọc, trạng thái, kế hoạch AI, ...)
│       ├── styles/              Màu thương hiệu, chuyển động
│       └── types/               Kiểu dữ liệu dùng chung
└── docker-compose.yml           PostgreSQL + backend
```

---

## 3. Cài đặt và chạy

### Yêu cầu

- Docker Desktop (chạy PostgreSQL và backend)
- Node.js 20 trở lên và npm (chạy frontend, chạy test)

### Chạy lần đầu

```bash
# 1. Tạo file cấu hình
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Mở `backend/.env` và đặt `JWT_SECRET` thành một chuỗi ngẫu nhiên. Có thể tạo bằng lệnh:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

```bash
# 2. Dựng PostgreSQL (cổng 5432) và backend (cổng 4000)
docker compose up -d
```

Mỗi lần khởi động, container backend tự chạy `prisma generate` và `prisma migrate deploy` rồi mới bật server ở chế độ theo dõi thay đổi (`tsx watch`).

```bash
# 3. Chạy frontend (cổng 5173)
cd frontend
npm ci
npm run dev
```

Mở `http://localhost:5173`. Kiểm tra backend còn sống ở `http://localhost:4000/api/health`.

### Chạy backend trực tiếp trên máy (không dùng container backend)

```bash
docker compose up -d postgres
cd backend
npm ci
npx prisma generate
npx prisma migrate deploy
npm run dev
```

### Lưu ý khi phát triển trên Windows

- Container backend gắn mã nguồn qua bind mount. Trên Windows, `tsx watch` trong container thường không nhận thay đổi tệp, nên sau khi sửa mã backend cần chạy `docker compose restart backend`.
- `node_modules` của container nằm trong volume riêng (bản Linux). Khi thêm thư viện backend, cài trong container: `docker compose exec -T backend npm i <tên-gói>` rồi khởi động lại container.
- Khi đổi `schema.prisma`, tạo migration mới rồi chạy `docker compose exec backend npx prisma migrate deploy` (hoặc khởi động lại container).
- Thư mục `backend/uploads/` chứa tệp thật của người dùng (ảnh đại diện, ảnh nền, tệp đính kèm, CV). Không xoá tệp trong thư mục này bằng ký tự đại diện.

### Dữ liệu mẫu (tuỳ chọn)

Chạy trong `backend/`. Cả hai script từ chối chạy khi `NODE_ENV=production` và chỉ đụng tới tài khoản thuộc tên miền riêng của chúng.

| Lệnh | Tác dụng |
|---|---|
| `npm run seed:team` | Tạo nhóm demo 5 người (`@team.local`) cùng các bảng mẫu để thử gợi ý phân công. Thêm `-- --remove` để xoá |
| `npm run seed:sim` | Tạo dữ liệu mô phỏng (`@sim.local`) có lịch sử hoàn thành việc, dùng cho bộ đánh giá phân công. Thêm `-- --seed=<số>` để đổi bộ dữ liệu, `-- --remove` để xoá |

---

## 4. Biến môi trường

### Backend (`backend/.env`)

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `PORT` | | Cổng API, mặc định `4000` |
| `NODE_ENV` | | `development`, `production` hoặc `test` |
| `CORS_ORIGIN` | | Địa chỉ frontend được gọi API, nhiều địa chỉ cách nhau bằng dấu phẩy |
| `DATABASE_URL` | Có | Chuỗi kết nối PostgreSQL. Khi chạy bằng Docker Compose, giá trị này được ghi đè thành host `postgres` |
| `JWT_SECRET` | Có | Khoá ký JWT |
| `JWT_EXPIRES_IN` | | Thời hạn phiên đăng nhập, mặc định `7d` |
| `FRONTEND_URL` | | Dùng để dựng liên kết trong email |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` | | Máy chủ gửi mail. Để trống thì dùng Ethereal: mail không tới hộp thư thật, liên kết xem trước được in ra log |
| `GOOGLE_CLIENT_ID` | | OAuth Client ID cho đăng nhập Google. Để trống thì `/api/auth/google` trả 503 và nút Google bị ẩn |
| `UNSPLASH_ACCESS_KEY` | | Khoá Unsplash. Để trống thì chỉ chọn được nền màu |
| `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY` | | Nhà cung cấp LLM. Chỉ gọi LLM khi đủ cả ba biến; thiếu biến nào thì cả ba module AI dùng bộ luật |
| `AI_PROVIDER_LABEL` | | Tên nhà cung cấp ghi vào nhật ký đo đạc |
| `AI_TIMEOUT_MS` | | Thời gian chờ tối đa một lượt gọi LLM, mặc định `30000` |
| `AI_MAX_INPUT_CHARS` | | Số ký tự tối đa module tạo bảng phân tích, mặc định `20000` |
| `CHAT_ENGINE` | | `v2` hoặc `legacy`: chọn phiên bản chatbot giao diện dùng |
| `CHAT_ACTIONS` | | Cho chatbot v2 **thực hiện** thao tác (tạo thẻ, đổi cột, xoá...). Mặc định bật ở development / test, **tắt ở production** |
| `CHAT_AUTO_EXECUTE` | | Cho thao tác đơn giản, rõ ràng tự chạy không cần bấm "Áp dụng". Mặc định như `CHAT_ACTIONS` |
| `TRUST_PROXY` | | Số cấp reverse proxy tin cậy (thường `1`) khi chạy sau nginx / Cloudflare... Để trống = không tin proxy nào. Quên đặt khi có proxy thì mọi giới hạn theo IP (đăng nhập, đăng ký) gộp chung cả người dùng |
| `COOKIE_SAMESITE` | | `lax` (mặc định), `strict` hoặc `none`. Đặt `none` khi frontend và backend ở hai tên miền khác nhau (vd Vercel + Render); cookie khi đó luôn kèm Secure, request ghi và kết nối socket từ nguồn ngoài `CORS_ORIGIN` bị chặn. Safari không đăng nhập được ở chế độ này |

Đổi nhà cung cấp LLM chỉ cần đổi ba biến `AI_*`. Trong `.env.example` có sẵn cấu hình mẫu cho Gemini, Groq, OpenRouter, Mistral và GitHub Models.

### Frontend (`frontend/.env`)

| Biến | Ý nghĩa |
|---|---|
| `VITE_API_URL` | Địa chỉ API, mặc định `http://localhost:4000/api` |
| `VITE_GOOGLE_CLIENT_ID` | Cùng giá trị với `GOOGLE_CLIENT_ID` của backend. Để trống thì không hiện nút đăng nhập Google |

---

## 5. Chức năng quản lý công việc

### 5.1. Tài khoản và xác thực

- **Đăng ký / đăng nhập** bằng email và mật khẩu. JWT được lưu trong cookie `httpOnly`, frontend không đọc được token.
- **Đăng nhập Google.** Lần đầu đăng nhập tạo tài khoản mới; nếu email đã có tài khoản thì liên kết vào tài khoản đó. Email Google được coi là đã xác minh.
- **Xác minh email.** Sau khi đăng ký, hệ thống gửi mail chứa liên kết có hạn 24 giờ. Tài khoản chưa xác minh vẫn dùng được bình thường, chỉ hiện banner nhắc kèm nút gửi lại.
- **Quên mật khẩu.** Nhập email để nhận liên kết đặt lại. Thông báo trả về luôn giống nhau, không tiết lộ email có tồn tại hay không. Token trong mail chỉ dùng được một lần và chỉ lưu dạng băm SHA-256.
- **Đổi mật khẩu.** Đổi hoặc đặt lại mật khẩu sẽ vô hiệu mọi phiên cũ (qua `tokenVersion`) và ngắt các kết nối socket đang mở của tài khoản.
- **Hồ sơ cá nhân** (`/settings/profile`): đổi tên hiển thị, tải lên hoặc xoá ảnh đại diện, chọn giao diện Sáng / Tối / Theo hệ thống, khai hồ sơ kỹ năng cho module gợi ý phân công (mục 7).
- **Quay lại đúng trang sau khi đăng nhập.** Người chưa đăng nhập mở một liên kết bảo vệ sẽ được đưa về đúng liên kết đó sau khi đăng nhập.

### 5.2. Không gian làm việc (Workspace)

- Mỗi người dùng có sẵn một **không gian cá nhân**, tạo lúc đăng ký. Không gian này không xoá và không rời được.
- Tạo thêm **không gian nhóm**, mời thành viên qua email. Vai trò: `OWNER` (chủ), `ADMIN` (quản trị), `MEMBER` (thành viên).
- Chủ không gian đổi được vai trò, xoá thành viên và **chuyển quyền sở hữu**. Thành viên không phải chủ có thể rời không gian. Chủ xoá được không gian nhóm.
- Mỗi bảng thuộc đúng một không gian. Chủ và quản trị không gian quản lý được các bảng trong đó.
- **Trang quản lý không gian** (`/workspaces/:id`) gồm:
  - Tổng quan: số thẻ (tổng, quá hạn, chưa giao, đã hoàn thành), lọc theo người phụ trách và trạng thái, danh sách thẻ khớp lọc.
  - Thành viên: mời, đổi vai trò, xoá, xem CV (nếu có quyền).
  - Các bảng trong không gian.
  - Cài đặt gợi ý phân công (trọng số của nhóm, hồ sơ làm việc của mình).
  - Vùng nguy hiểm: rời hoặc xoá không gian.
- Bộ chuyển không gian nằm trên thanh điều hướng; không gian đang chọn được nhớ lại giữa các lần mở trang.

### 5.3. Bảng (Board)

- **Tạo bảng**: đặt tên, chọn không gian, chọn nền (màu hoặc ảnh Unsplash) và xem trước thu nhỏ ngay trong hộp thoại. Có thêm hai cách tạo khác:
  - **Từ mẫu**: 6 mẫu dựng sẵn (Kanban cơ bản, Quản lý dự án, Sprint / Agile, Lịch nội dung, Việc cá nhân, Khoá luận tốt nghiệp), hoặc mẫu tự lưu từ một bảng có sẵn ("Lưu thành mẫu").
  - **Bằng AI**: xem mục 6.
- **Mức hiển thị**: `PRIVATE` (chỉ thành viên bảng), `WORKSPACE` (mọi thành viên không gian được xem và sửa), `PUBLIC` (ai có liên kết cũng xem được, chỉ đọc).
- **Ảnh nền**: chọn màu, tìm ảnh trên Unsplash (có ghi công tác giả theo yêu cầu của Unsplash), tải ảnh từ máy, hoặc bỏ nền.
- **Đánh dấu sao** để đưa bảng lên mục Yêu thích; **theo dõi bảng** để nhận thông báo về mọi thay đổi.
- **Lưu trữ / khôi phục / xoá vĩnh viễn** bảng. Bảng đã lưu trữ được liệt kê riêng ở trang danh sách bảng.
- **Xuất bảng ra tệp JSON.**
- **Thống kê bảng**: tổng thẻ, số đã hoàn thành, số quá hạn, tiến độ từng danh sách, phân bố theo trạng thái, những thành viên giữ nhiều thẻ nhất.
- **Nhật ký hoạt động** của toàn bảng; **kho lưu trữ** liệt kê thẻ và danh sách đã lưu trữ để khôi phục hoặc xoá hẳn.

### 5.4. Chia sẻ và phân quyền bảng

- Vai trò trong bảng: `OWNER`, `ADMIN`, `MEMBER`, `VIEWER` (chỉ xem, không sửa và không được giao việc).
- **Mời qua email.** Nếu email chưa có tài khoản, hệ thống gửi mail kèm liên kết mời.
- **Liên kết mời**: tạo, sao chép, thu hồi. Người mở liên kết (`/join/:token`) thấy bản xem trước của bảng và gửi **yêu cầu tham gia**.
- **Duyệt hoặc từ chối yêu cầu tham gia** trong tab riêng của bảng chia sẻ. Danh sách yêu cầu tự cập nhật theo thời gian thực, và thông báo "có người muốn tham gia" mở thẳng tab này.
- **Chuyển quyền sở hữu bảng.** Chủ cũ trở thành quản trị và sau đó có thể rời bảng.
- Với bảng mức `WORKSPACE`, thành viên không gian cũng hiện trong danh sách thành viên bảng (đánh dấu "qua không gian"), được giao việc nhưng không đổi vai trò được tại bảng.
- **Xem công khai** (`/public/boards/:id`): bảng `PUBLIC` mở được khi chưa đăng nhập, chỉ đọc hoàn toàn: không kéo thả, không bình luận, checklist bị khoá.
- **Chỉ báo đang trực tuyến**: hiện avatar những người đang mở cùng bảng.

### 5.5. Danh sách (cột) và trạng thái theo cột

- Tạo, đổi tên, kéo thả đổi thứ tự cột.
- Menu cột: thêm thẻ, thêm thẻ từ mẫu, tạo **thẻ định kỳ**, theo dõi danh sách, sao chép danh sách, di chuyển danh sách, chuyển toàn bộ thẻ sang danh sách khác, sắp xếp thẻ (ngày tạo, tên, đã xong), xoá mọi thẻ, lưu trữ danh sách, **chia việc gợi ý** cho cả danh sách (mục 7).
- **Trạng thái theo cột.** Thẻ có 5 trạng thái cố định: Cần làm (`TODO`), Đang làm (`IN_PROGRESS`), Chờ duyệt (`IN_REVIEW`), Hoàn thành (`DONE`), Bị chặn (`BLOCKED`). Mỗi cột có thể gắn một trạng thái hoặc để tự do. Cột và thẻ liên kết hai chiều:
  - Kéo thẻ vào cột có trạng thái thì thẻ đổi sang trạng thái đó.
  - Đổi tay trạng thái thẻ thì thẻ tự chuyển sang cột mang trạng thái mới (nếu bảng có cột như vậy).
  - Cột mới (tạo tay, từ mẫu, hoặc từ AI) được đoán trạng thái theo tên, ví dụ cột "Đang làm" nhận `IN_PROGRESS`.
  - Trạng thái `DONE` luôn đồng bộ với dấu hoàn thành và thời điểm hoàn thành của thẻ.

### 5.6. Thẻ công việc (Card)

Thẻ trên bảng hiện ảnh bìa, nhãn màu, tiêu đề, trạng thái và các huy hiệu: có mô tả, hạn, tiến độ checklist, số bình luận, số đính kèm, avatar người phụ trách. Bấm vào thẻ mở **hộp thoại chi tiết thẻ**. Địa chỉ trang được gắn `?card=<id>` nên có thể gửi liên kết thẳng tới một thẻ.

Các thao tác trong chi tiết thẻ:

- **Tiêu đề và mô tả**: sửa trực tiếp; mô tả viết bằng Markdown đơn giản.
- **Hoàn thành / trạng thái**: đánh dấu xong hoặc chọn một trong 5 trạng thái.
- **Thành viên**: gán nhiều người. Ô chọn thành viên có kèm gợi ý phân công.
- **Nhãn**: gắn, tạo, sửa nhãn màu (bảng 10 màu dùng chung).
- **Ngày**: ngày bắt đầu và hạn chót, kèm **nhắc hạn** trước 10 phút, 1 giờ hoặc 1 ngày.
- **Checklist**: nhiều checklist trong một thẻ, thanh phần trăm tiến độ, ẩn mục đã xong, kéo thả sắp xếp mục, mỗi mục có người phụ trách và hạn riêng, có thể **chuyển một mục thành thẻ mới**.
- **Tệp đính kèm**: tải lên tối đa 10MB mỗi tệp; ảnh có xem trước và đặt được làm ảnh bìa.
- **Ảnh bìa**: chọn màu hoặc ảnh đính kèm.
- **Trường tùy chỉnh**: nhập giá trị cho các trường bảng đã định nghĩa (văn bản, số, ngày, hộp chọn, danh sách thả xuống).
- **Bình luận** (mục 5.7) và **dòng hoạt động** của thẻ, sắp theo thời gian.
- **Di chuyển** sang danh sách khác, kể cả sang bảng khác.
- **Sao chép thẻ**, **lưu thành mẫu thẻ**, **theo dõi thẻ**, **lưu trữ / khôi phục / xoá vĩnh viễn**.

Khi người khác sửa thẻ đang mở, hộp thoại tự tải lại nội dung nhưng không ghi đè lên phần tiêu đề hoặc mô tả người dùng đang gõ dở.

### 5.7. Bình luận, nhắc tên và trả lời

- Viết bình luận, gõ `@` để **nhắc tên** thành viên; người được nhắc nhận thông báo.
- **Trả lời bình luận** theo luồng một cấp: trả lời một câu trả lời vẫn được xếp dưới bình luận gốc.
- Xoá bình luận gốc thì các câu trả lời vẫn giữ nguyên, bình luận gốc hiện "Bình luận đã bị xoá".
- Mỗi người chỉ nhận một thông báo cho một bình luận, theo thứ tự ưu tiên: được nhắc tên, rồi được trả lời, rồi bình luận thường trên thẻ đang theo dõi. Người không còn quyền xem thẻ thì không nhận thông báo.

### 5.8. Tự động hoá, thẻ định kỳ và mẫu thẻ

- **Luật tự động** ở phạm vi một bảng, dạng "khi X thì Y":
  - Điều kiện: thẻ được tạo (trong một danh sách hoặc mọi danh sách), hoặc thẻ được chuyển vào một danh sách cụ thể.
  - Hành động (tối đa 5 mỗi luật): đánh dấu hoàn thành hoặc bỏ hoàn thành, gắn nhãn, gán thành viên.
  - Bật, tắt hoặc xoá từng luật. Không có hành động nào di chuyển hay tạo thẻ, để tránh các luật kích hoạt nhau vô hạn.
- **Thẻ định kỳ**: lịch tự tạo thẻ mới trong một danh sách theo ngày, tuần hoặc tháng, có giờ chạy, ngày kết thúc và mẫu thẻ tuỳ chọn. Tạm dừng, chạy tiếp hoặc xoá được.
- **Mẫu thẻ**: lưu một thẻ (kèm checklist) thành mẫu để tạo nhanh thẻ tương tự.

Các tác vụ nền chạy trong tiến trình backend: quét nhắc hạn mỗi phút, tạo thẻ định kỳ mỗi 5 phút, gửi email tổng hợp mỗi 15 phút cho những người tới giờ nhận.

### 5.9. Các chế độ xem

| Trang | Đường dẫn | Nội dung |
|---|---|---|
| Trang giới thiệu | `/` | Giới thiệu sản phẩm cho khách chưa đăng nhập |
| Tổng quan | `/home` | Lời chào, số liệu nhanh (bảng, thẻ được giao, quá hạn, đến hạn trong tuần), việc cần chú ý, bảng truy cập gần đây, hoạt động gần đây |
| Tất cả bảng | `/boards` | Bảng chia theo nhóm Yêu thích và từng không gian, mỗi bảng có thanh tiến độ; mục bảng đã lưu trữ |
| Bảng Kanban | `/boards/:id` | Các cột cuộn ngang, kéo thả thẻ và cột |
| Bảng biểu | trong trang bảng | Xem thẻ dạng bảng tính (trạng thái, tên, danh sách, nhãn, thành viên, hạn), bấm tiêu đề cột để sắp xếp |
| Công việc của tôi | `/my-cards` | Thẻ được giao cho mình, nhóm theo Quá hạn / Hôm nay / Trong tuần / Sau này / Không có hạn |
| Lịch | `/calendar` | Xem theo tháng hoặc tuần, kéo thẻ sang ngày khác để đổi hạn; hiện cả mục checklist có hạn riêng |
| Tìm kiếm nâng cao | `/search` | Mục 5.10 |
| Mẫu | `/templates` | Chọn mẫu bảng có sẵn hoặc mẫu của mình |
| Hoạt động của tôi | `/activity` | Nhật ký thao tác cá nhân |

Trong trang bảng còn có **phím tắt**: `?` mở bảng trợ giúp, `n` thêm thẻ, `f` mở bộ lọc, `b` đổi nền, `x` xoá bộ lọc, `q` lọc nhanh việc giao cho tôi.

### 5.10. Tìm kiếm và lọc

- **Ô tìm kiếm trên thanh điều hướng** (phím tắt `/`): tìm thẻ trên mọi bảng đọc được và lọc tên bảng ngay khi gõ.
- **Tìm kiếm nâng cao**: từ khoá, người phụ trách (mọi người / của tôi / chưa giao), trạng thái, nhãn, quá hạn, khoảng ngày hết hạn. Kết quả phân trang, danh sách kết quả cuộn riêng trong khi bộ lọc đứng yên.
- **Bộ lọc đã lưu**: lưu tổ hợp lọc hiện tại để dùng lại bằng một lần bấm.
- **Lọc trong một bảng**: theo từ khoá, thành viên (kể cả "chưa có thành viên" và "giao cho tôi"), trạng thái, hạn (không có / quá hạn / ngày mai / trong tuần), nhãn.

### 5.11. Thông báo

- **Chuông thông báo** có số chưa đọc, lọc "chỉ chưa đọc", đánh dấu tất cả đã đọc. Bấm một thông báo sẽ mở đúng nơi liên quan (thẻ, tab yêu cầu tham gia, trang không gian).
- Các loại sự kiện được thông báo: được thêm vào bảng hoặc không gian, đổi vai trò, chuyển quyền sở hữu, yêu cầu tham gia và kết quả duyệt, được giao thẻ, được nhắc tên, có trả lời, có bình luận, có tệp đính kèm, thẻ bị di chuyển, đổi tên, hoàn thành, đặt hạn, nhắc hạn.
- Thông báo mới đến ngay qua socket; ngoài ra chuông vẫn hỏi lại máy chủ mỗi 45 giây phòng khi mất kết nối.
- **Cài đặt thông báo** (`/settings/notifications`): bật hoặc tắt theo nhóm (hoạt động thẻ, bảng và không gian, nhắc hạn), email nhắc hạn, email tổng hợp hằng ngày.

### 5.12. Giao diện

- Giao diện tiếng Việt, có **chế độ tối**, dùng được trên điện thoại (thanh điều hướng thu vào ngăn kéo, lịch tự co lại).
- Thanh bên gồm Tổng quan, Công việc của tôi, Lịch, Tất cả bảng, Mẫu, Tìm kiếm nâng cao, cùng cây không gian và các bảng bên trong.
- Hiệu ứng xuất hiện nhẹ, khung chờ khi tải dữ liệu, màn hình trống có hướng dẫn. Thẻ vừa được người khác tạo hoặc sửa được làm nổi bật trong chốc lát. Mọi hiệu ứng tự tắt khi hệ điều hành bật chế độ giảm chuyển động.
- Trang đăng nhập và đăng ký chia hai cột: một bên là biểu mẫu, một bên giới thiệu sản phẩm.
- Logo TaskFlow là mũi tên gấp giấy, dải màu xanh ngọc sang chàm.

---

## 6. Module AI 1 — Tạo bảng từ mô tả

**Đầu vào**: đoạn mô tả công việc tiếng Việt gõ tay, hoặc tệp `.docx` / `.pdf` (tối đa 5MB, PDF tối đa 50 trang).
**Đầu ra**: một bảng gồm các cột, thẻ, nhãn, checklist và ngày bắt đầu / hạn chót cho từng thẻ.
**Ngoài phạm vi**: module không gán người cho thẻ. Việc đó thuộc module gợi ý phân công.

### Luồng sử dụng

1. Trong hộp thoại "Tạo bảng", chọn **Tạo bằng AI**.
2. Gõ mô tả hoặc tải tệp lên. Nội dung tệp được dùng trực tiếp, không đổ ra ô chữ để sửa.
3. Hệ thống sinh **kế hoạch** và bắt buộc hiển thị màn xem trước. Người dùng sửa tên cột, tên thẻ, ngày, nhãn, checklist, hoặc bỏ chọn thẻ không muốn tạo.
4. Bấm tạo: toàn bộ bảng được ghi trong một giao dịch, và mỗi kế hoạch chỉ áp dụng được một lần.

### Cách hoạt động

- **Bộ luật** đọc cấu trúc văn bản (tiêu đề, gạch đầu dòng, đánh số) và trích ngày tiếng Việt ("thứ 6 tuần sau", "20/10", "trong 3 ngày", ...). Bộ luật luôn chạy được, kể cả khi không có khoá API.
- **LLM** (nếu đã cấu hình) đọc văn bản và trả một bản nháp theo lược đồ JSON cố định. Lược đồ này không có chỗ cho ngày tuyệt đối, ID hay mã màu, chỉ có tên, số dòng nguồn (`sourceLine`), độ lệch ngày và mã màu từ 0 đến 9. Vì vậy dù văn bản đầu vào chứa câu lệnh chèn vào, mô hình cũng không có chỗ để gây hại.
- **Gộp hai nguồn**: ngày do bộ luật tìm được luôn được ưu tiên hơn ngày LLM đưa ra. Thẻ không truy được về một dòng có thật trong văn bản thì bị loại và được đếm vào `droppedCards`.
- Văn bản được phân loại **có cấu trúc** hoặc **văn xuôi**. Văn bản có cấu trúc do bộ luật dẫn dắt, văn xuôi do LLM dẫn dắt.
- Mỗi lượt sinh ghi một dòng `AiRun` (chế độ, nhà cung cấp, token, độ trễ, số lần người dùng sửa, ...) làm dữ liệu cho chương đánh giá.
- Đọc tệp an toàn: đuôi tệp phải khớp với chữ ký nhị phân, mục lục tệp zip được kiểm tra để chặn zip bomb, bộ đọc chạy trong tiến trình con có giới hạn bộ nhớ và thời gian.

### Kết quả đánh giá

25 mẫu tự soạn, mỗi nhánh chạy 3 lần với Gemini:

| Nhánh | F1 nhận dòng thành thẻ | Ghi chú |
|---|---|---|
| B0 — chỉ bộ luật | 0,95 | Nhận đủ dòng nhưng giữ cả tiêu đề, câu dẫn, dòng chèn lệnh |
| B1 — chỉ LLM | 0,966 | 6,7% lượt trả JSON hỏng khi không ép lược đồ |
| B2 — lai | 0,994 | 0 lượt lỗi định dạng khi dùng `json_schema`, ngày đúng 100% |

Lệnh chạy lại: `npm run eval:ai`.

---

## 7. Module AI 2 — Gợi ý phân công

Module trả lời câu hỏi "thẻ này nên giao cho ai", có cá nhân hoá theo lịch sử của từng nhóm. Toàn bộ viết bằng TypeScript, không dùng thư viện học máy bên ngoài.

### Kiến trúc hai lớp

**Lớp 1 — chấm điểm từng cặp (thẻ, người).** Điểm gồm bốn thành phần:

| Thành phần | Cách tính |
|---|---|
| Kinh nghiệm | Độ giống giữa thẻ đang xét và các thẻ người đó từng hoàn thành: tách từ tiếng Việt, TF-IDF, k láng giềng gần nhất, giảm dần theo thời gian |
| Tin cậy | Tỉ lệ hoàn thành đúng hạn ở các việc tương tự |
| Khả dụng | Số thẻ đang mở chồng lấn khoảng thời gian của thẻ mới, so với sức chứa người đó tự khai (mặc định 5 thẻ cùng lúc) |
| Hồ sơ | Độ khớp với kỹ năng, công việc đã làm và nội dung CV người đó tự khai |

Các thành phần được chuẩn hoá min-max trong nhóm ứng viên của thẻ rồi cộng theo trọng số. Mặc định: kinh nghiệm 0,36, tin cậy 0,24, khả dụng 0,20, hồ sơ 0,20. Thành phần nào thiếu dữ liệu thì không được tính. Mỗi gợi ý kèm **bằng chứng** (các thẻ tương tự đã làm), **độ tin cậy của điểm** (dữ liệu mỏng / vừa đủ / đủ) và các cờ cảnh báo như quá tải, tạm nghỉ, chưa có lịch sử.

**Lớp 2 — chia việc cho cả danh sách.** Các thẻ chưa có người nhận được xếp theo hạn gấp trước. Với mỗi thẻ, hệ thống gọi lớp 1, chọn người đứng đầu (bỏ qua người đang tạm nghỉ), rồi cộng thẻ vừa giao vào tải của người đó trước khi xét thẻ tiếp theo. Cách này tránh dồn mọi việc cho người giỏi nhất. Kết quả chỉ là bản xem trước (tối đa 30 thẻ); người dùng sửa từng dòng rồi mới áp dụng.

### Học từ phản hồi

Khi trưởng nhóm giao thẻ cho một người khác với người đứng đầu danh sách gợi ý, hệ thống điều chỉnh trọng số của nhóm theo kiểu perceptron xếp hạng cặp, bước học 0,05, bắt đầu từ lượt phản hồi thứ 10. Trọng số luôn được chiếu về vùng hợp lệ. Quản trị không gian xem được trọng số hiện tại và lịch sử thay đổi, chỉnh tay hoặc đặt lại mặc định.

### Hồ sơ tự khai và CV

- Mỗi người khai **kỹ năng**, **công việc đã làm** (tối đa 30 mục) và có thể **tải CV** (`.docx` / `.pdf`) ở trang Hồ sơ. Hồ sơ gắn với người dùng và dùng chung cho mọi không gian.
- Nội dung CV được trích chữ (không dùng LLM) và cắt thành các đoạn để so khớp.
- **Quyền xem CV**: mặc định **chỉ chủ CV** tải được tệp. Chủ CV phải chủ động **bật công tắc "Cho phép quản trị bảng / không gian chung tải tệp CV của tôi"** (trang Hồ sơ, mặc định TẮT) thì chủ hoặc quản trị viên của một bảng (hoặc không gian chứa bảng) mà cả hai cùng tham gia mới tải được. Người khác chỉ thấy các cụm kỹ năng đã khớp, không tải được tệp. Tắt "Dùng hồ sơ này cho gợi ý" thì rút CV khỏi mọi người. Chữ trích từ CV vẫn dùng để tính điểm gợi ý dù công tắc chia sẻ tắt. (Trước 14/10, bất kỳ ai thêm người đó vào bảng của mình đều tải được CV mà không cần họ đồng ý.)
- **Hồ sơ làm việc theo không gian**: sức chứa (số thẻ chồng lấn tối đa, từ 1 đến 30) và ngày tạm nghỉ.

### Giao diện

- Ô **Thành viên** trong chi tiết thẻ hiện danh sách gợi ý kèm điểm, bằng chứng và cờ. Hệ thống hỏi lại khi giao cho người đang quá tải hoặc tạm nghỉ.
- Mục **"Chia việc gợi ý…"** trong menu danh sách mở màn xem trước của lớp 2.
- Mục **Gợi ý phân công** ở trang quản lý không gian: thanh trượt trọng số, trạng thái tự học, cấu hình làm việc của mình.
- Nút **Xem CV** ở danh sách thành viên bảng và không gian.

### Đánh giá

Dữ liệu lịch sử được **sinh mô phỏng** có kiểm soát (bộ sinh cố ý lệch khỏi giả định của bộ chấm để tránh đánh giá vòng tròn), đóng băng bằng mã băm, chạy trên 20 hạt giống, có khoảng tin cậy bootstrap 95%.

- Lớp 1, vòng kín: tỉ lệ đúng hạn 0,441 so với 0,389 khi giao ngẫu nhiên (+0,052, khoảng tin cậy [+0,039; +0,065]). Tỉ lệ này cao hơn các cách giao chỉ dựa vào một tiêu chí như người rảnh nhất hay người nhiều kinh nghiệm nhất.
- Lớp 2: thêm trần số thẻ mỗi người hoặc phạt điểm theo số thẻ đã nhận giúp giảm tỉ lệ việc dồn cho một người từ 35,3% xuống 22,2% hoặc 28,9%, trong khi tỉ lệ đúng hạn gần như không đổi.
- Thành phần Hồ sơ: chỉ 1/4 so sánh đăng ký trước đạt. Hiện chưa đủ bằng chứng để kết luận hồ sơ tự khai cải thiện phân công.

---

## 8. Module AI 3 — Chatbot trợ lý

Nút **Trợ lý** trên thanh điều hướng mở khung chat bên phải màn hình. Người dùng hỏi bằng tiếng Việt, có dấu hay không dấu đều được. Bản v1 **chỉ đọc dữ liệu**. Bản v2 còn **thực hiện lệnh** (tạo thẻ, chuyển cột, giao việc, tạo luật tự động hóa...) nhưng luôn trong một bảng, kiểm quyền lại, và cho xem trước rồi bấm **Áp dụng** trừ các lệnh đơn rất rõ ràng (xem [Hành động của bản v2](#hành-động-của-bản-v2)).

### Nguyên tắc chung

- **LLM chỉ hiểu câu hỏi, không tự tính số.** Mọi con số và danh sách đều do backend truy vấn cơ sở dữ liệu rồi dựng câu trả lời.
- **Tối thiểu hoá dữ liệu gửi đi**: LLM không nhận tên bảng, tên không gian hay nội dung thẻ khi không cần thiết, và không bao giờ viết SQL.
- **Quyền được kiểm tra lại ở mỗi lượt hỏi**: chatbot chỉ thấy những bảng người hỏi được phép xem. Quản trị không gian không vì thế mà đọc được bảng riêng tư của người khác.
- **Không có khoá API vẫn chạy**, khi đó dùng bộ luật để hiểu câu hỏi.

### Bản v1 (`/api/chat`)

- Hiểu câu hỏi bằng bộ luật kết hợp LLM, ra một trong các ý định: việc của tôi, việc tôi nên ưu tiên làm trước, việc của một thành viên, khối lượng việc của nhóm, tổng kết nhóm (kèm một đoạn nhận xét ngắn do AI viết từ số đếm), bảng của tôi, không gian của tôi, danh sách thành viên, đếm thẻ theo cột.
- Hiểu khoảng thời gian (hôm nay, tuần này, tháng này, quá hạn, ...), câu hỏi nối tiếp ("còn quá hạn thì sao?"), hỏi lại khi trùng tên ("Ý bạn là ai?"), nút "Xem thêm" để phân trang.
- Đánh giá trên tập kiểm tra 105 câu × 3 lần với Gemini, tỉ lệ khớp hoàn toàn: **B0 bộ luật 82,9%**, **B1 chỉ LLM 95,9%**, **B2 lai 94,9%**.

### Bản v2 (`/api/chat/v2`, đang hoàn thiện)

- LLM đóng vai **bộ điều phối**: tự chọn và gọi nhiều công cụ đọc dữ liệu trong một câu hỏi. Các công cụ gồm nhận diện đối tượng, tra danh mục (bảng, không gian, thành viên), lọc thẻ, thống kê thẻ theo người / bảng / cột / trạng thái / ngày, và tra nhật ký thay đổi.
- Trả lời được câu hỏi nhiều phần, ví dụ "việc nào đã giao, việc nào chưa giao", và câu hỏi về lịch sử như "tuần này những thẻ nào đã thay đổi".
- Mọi ID do LLM đề xuất đều phải đến từ dữ liệu backend đã xác minh. Đầu vào của từng công cụ được kiểm tra bằng Zod.
- **Lịch sử hội thoại được lưu theo tài khoản** (bảng `ChatConversation` / `ChatTurn`). Khi mở lại trợ lý, hội thoại gần nhất được khôi phục. Có danh sách hội thoại cũ và nút tạo hội thoại mới. Kết quả cũ được kiểm quyền lại khi mở.
- Biến `CHAT_ENGINE` chọn bản giao diện dùng. Môi trường phát triển mặc định dùng v2; API v1 vẫn được giữ để tương thích.
- Chưa làm: kho hướng dẫn sử dụng (RAG).

### Hành động của bản v2

Chỉ bật khi `CHAT_ACTIONS=true` (mặc định bật ở môi trường phát triển, **tắt ở production**) và có cấu hình AI. Không có AI thì lệnh ghi được báo "cần bật AI", không đoán bằng bộ luật.

| Nhóm lệnh | Ví dụ | Cách xử lý |
|---|---|---|
| Một thao tác rõ ràng | "Chuyển Login UI sang Đang làm", "Giao Login API cho tôi" | Tự chạy (nếu `CHAT_AUTO_EXECUTE=true`), báo kết quả |
| Nhiều thao tác, đổi cấu trúc, ngày mơ hồ | "Tạo cột Kiểm thử và thêm 3 task…" | Xem trước, bấm **Áp dụng**: làm tất cả hoặc không làm gì |
| Giao việc do hệ thống chọn | "Giao cho người phù hợp nhất", "Chia các việc chưa có người trong cột X" | Xem trước kèm hạng, điểm, mức tin cậy, cảnh báo |
| Mở rộng bảng bằng nội dung AI nghĩ ra | "Bổ sung các việc còn thiếu cho giai đoạn kiểm thử" | Xem trước, chỉ **thêm** cột / thẻ mới, lọc trùng |
| Luật tự động hóa | "Khi thẻ vào cột Hoàn thành thì gắn nhãn Gấp" | Xem trước, rủi ro cao, nói rõ luật chạy bằng quyền của người tạo |

- **LLM không bao giờ chạm id hay quyền**: nó chỉ đưa ra kế hoạch bằng chữ người dùng gõ; backend tự tìm đối tượng trong đúng bảng, kiểm quyền bằng chính hàm của giao diện, rồi mới ghi, trong **một transaction**.
- **Dữ liệu không phải chỉ dẫn**: chữ nằm trong tiêu đề, mô tả hay bình luận của thẻ không bao giờ cho phép một hành động; chỉ câu của người dùng mới có tác dụng.
- **Phạm vi thao tác**: 69 loại thao tác trên đúng một bảng mỗi lần (thẻ, cột, bình luận, checklist, tệp, nhãn, trường tuỳ chỉnh, luật tự động hóa, thành viên, hiển thị, lưu trữ / xoá). Chỉ **22 loại thao tác đơn giản, chính xác** (tạo thẻ, đổi tên, đặt hạn, chuyển cột, đổi trạng thái, giao / bỏ người, gắn / gỡ nhãn, khôi phục thẻ, tick checklist, nhắc hạn, theo dõi, gắn sao bảng...) được tự chạy, và chỉ khi lệnh là MỘT thao tác rõ ràng. Mọi thao tác **xoá, hàng loạt hoặc quản trị bảng** (đổi hiển thị, thành viên, vai trò, link mời, lưu trữ / xoá bảng) **luôn phải xem trước và bấm Áp dụng**, được đánh giá rủi ro CAO và không bao giờ tự chạy; xoá bảng còn phải gõ lại đúng tên bảng.
- **Cố ý không làm**: chuyển quyền chủ bảng, thao tác trên nhiều bảng trong một lần, chuyển thẻ sang bảng khác, hoàn tác (chưa có lệnh hoặc nút hoàn tác). Yêu cầu đó được trả lời "chưa hỗ trợ".
- Đánh giá với Gemini thật và kho câu an toàn đối kháng: **kết quả đầy đủ trên tập test chưa có** (hết hạn mức ngày giữa chừng), xem mục "Mức độ bằng chứng" ở §13.

---

## 9. Thời gian thực (Socket.IO)

Socket.IO chạy chung cổng 4000 với API và xác thực bằng cùng cookie đăng nhập. Phía frontend chỉ có một kết nối dùng chung, tự nối khi đăng nhập và ngắt khi đăng xuất. Máy chủ gửi sự kiện vào **phòng của bảng** hoặc **phòng của người dùng**:

| Sự kiện | Phòng | Ý nghĩa |
|---|---|---|
| `board:lists-changed` | bảng | Nội dung bảng thay đổi (thẻ, cột, checklist, bình luận, ...). Trang bảng và chi tiết thẻ tự tải lại sau 400ms |
| `board:members-changed` | bảng | Thành viên bảng thay đổi |
| `board:meta-changed` | bảng | Tên, nền hoặc mức hiển thị của bảng thay đổi |
| `board:join-requests-changed` | bảng | Có yêu cầu tham gia mới hoặc yêu cầu đã được xử lý |
| `board:presence` | bảng | Danh sách người đang mở bảng |
| `board:removed` | bảng | Bảng bị xoá, người đang xem được đưa về trang danh sách bảng |
| `board:access-changed` | người dùng | Danh sách bảng người dùng được xem thay đổi |
| `workspace:changed` | người dùng | Thông tin hoặc thành viên không gian thay đổi |
| `notification:new` | người dùng | Có thông báo mới |

Khi người dùng mất quyền (bị xoá khỏi bảng hoặc không gian, bảng đổi mức hiển thị), máy chủ chủ động đẩy socket của họ ra khỏi phòng bảng, không trông vào việc phía client tự rời. Sau khi mất kết nối và nối lại, trang bảng tự vào lại phòng và tải bù dữ liệu.

---

## 10. Bảo mật và phân quyền

- **Phiên đăng nhập**: JWT trong cookie `httpOnly`; đổi hoặc đặt lại mật khẩu sẽ thu hồi mọi phiên và socket cũ.
- **Kiểm tra quyền ở backend** cho mọi thao tác, theo ba mức: xem, sửa, quản lý. Quyền được tính từ vai trò trong bảng, vai trò trong không gian và mức hiển thị của bảng.
- **Kiểm tra dữ liệu vào** bằng Zod ở mọi route; JSON body giới hạn 1MB. Chỉ nhận JSON và multipart (không nhận `application/x-www-form-urlencoded`, để không có đường CSRF bằng form-post chéo trang). Dữ liệu client gửi sai (JSON hỏng, body quá lớn) trả 400 / 413, không phải 500.
- **Header an toàn**: `helmet` (`X-Content-Type-Options`, chống nhúng khung, `Referrer-Policy`, HSTS ở production), không lộ `X-Powered-By`. Phía sau reverse proxy phải đặt `TRUST_PROXY` để giới hạn tần suất theo IP đúng.
- **Riêng tư khi xem bảng công khai**: người chỉ xem được bảng vì bảng ở mức PUBLIC không thấy email thành viên ở bất kỳ đường đọc nào (danh sách và thẻ, chi tiết thẻ, xuất bảng, danh sách thành viên). Mã link mời chỉ trả ở `/invite-link` cho người quản lý, không nằm trong danh sách bảng, phản hồi sửa bảng hay bản xuất.
- **Giới hạn tần suất gọi** cho đăng nhập, đăng ký, đăng nhập Google, quên và đặt lại mật khẩu, gửi lại email xác minh, xem bảng công khai, các API AI (đọc tệp, tạo kế hoạch, áp dụng kế hoạch), gợi ý phân công, chia việc, tải CV và chatbot.
- **Tệp đính kèm**: tệp của thẻ được phục vụ qua route có kiểm quyền (bảng công khai thì khách xem được). Chỉ thư mục ảnh đại diện và ảnh nền được phục vụ tĩnh; thư mục gốc chứa tệp tải lên không được mở công khai, nên đường dẫn mã hoá kiểu `/uploads/%63ards/...` không lách qua được. Kiểu nội dung được suy ra từ đuôi tệp trong danh sách cho phép, không tin giá trị client gửi lên. Tệp của thẻ hoặc danh sách đã xoá / lưu trữ không còn được phục vụ (khôi phục thì tải lại được).
- **Token email** (xác minh, đặt lại mật khẩu) dùng một lần, có hạn, chỉ lưu bản băm.
- **Module AI**: lược đồ đầu ra cố định để chặn prompt injection; tệp tải lên được kiểm chữ ký và đọc trong tiến trình con; dữ liệu đo đạc không lưu khoá API.
- **Cơ sở dữ liệu test tách biệt**: bộ test từ chối chạy nếu `DATABASE_URL` không trỏ rõ ràng tới một CSDL test cục bộ, và ghi tệp tải lên vào thư mục tạm chứ không vào `backend/uploads`.

---

## 11. Danh sách API

Mọi API có tiền tố `/api`, trả JSON dạng `{ success, ... }`. Khi lỗi, API trả `{ success: false, message }`.

| Nhóm | Tiền tố | Chức năng chính |
|---|---|---|
| Sức khoẻ | `GET /api/health` | Kiểm tra server |
| Xác thực | `/api/auth` | `register`, `login`, `logout`, `google`, `me` (xem, sửa), `me/avatar`, `password`, `forgot-password`, `reset-password`, `verify-email`, `resend-verification` |
| Không gian | `/api/workspaces` | CRUD không gian, `overview`, `members` (mời, đổi vai trò, xoá, `transfer-ownership`), `board-templates` |
| Bảng | `/api/boards` | CRUD bảng, `from-template`, `from-saved-template`, `save-as-template`, `templates`, `star`, `watch`, `background`, `archive-board` / `restore` / `purge`, `archive`, `export`, `invite-link`, `join/:token`, `join-requests` (duyệt, từ chối) |
| Thành viên bảng | `/api/boards/:boardId/members` | Liệt kê, thêm hoặc mời, đổi vai trò, xoá, chuyển quyền sở hữu |
| Danh sách | `/api/boards/:boardId/lists`, `/api/lists` | Tạo, sửa, `copy`, `sort`, `move-all-cards`, `watch`, lưu trữ, khôi phục, xoá, xoá mọi thẻ |
| Thẻ | `/api/lists/:listId/cards`, `/api/cards` | Tạo (kể cả `from-template`), xem, sửa, `move`, `copy`, `watch`, lưu trữ, khôi phục, xoá; `members`, `labels`, `custom-fields`, `checklists`, `comments`, `attachments`, `reminders`, `save-as-template`; `mine`, `calendar`, `search` |
| Thành phần của thẻ | `/api/checklists`, `/api/checklist-items`, `/api/comments`, `/api/attachments` | Sửa, xoá, sắp xếp, `convert-to-card` |
| Nhãn | `/api/boards/:boardId/labels`, `/api/labels` | CRUD nhãn |
| Trường tùy chỉnh | `/api/boards/:boardId/custom-fields`, `/api/custom-fields`, `/api/custom-field-options` | CRUD trường và lựa chọn |
| Mẫu thẻ | `/api/boards/:boardId/card-templates`, `/api/card-templates` | Liệt kê, xoá |
| Tự động hoá | `/api/boards/:boardId/automation-rules`, `/api/automation-rules` | CRUD luật |
| Thẻ định kỳ | `/api/lists/:listId/recurring-schedules`, `/api/recurring-schedules` | CRUD lịch, tạm dừng |
| Hoạt động | `/api/activities` | `me`, `home`, `board/:boardId` |
| Thông báo | `/api/notifications` | Danh sách, `unread-count`, `read-all`, `:id/read`, `preferences` |
| Tìm kiếm | `/api/search` | `cards`, `filters` (bộ lọc đã lưu) |
| Unsplash | `/api/unsplash` | Tìm ảnh, `track-download` |
| Xem công khai | `/api/public` | `boards/:id`, `boards/:id/lists`, `cards/:id` (không cần đăng nhập) |
| AI tạo bảng | `/api/ai` | `status`, `documents/extract`, `board-plans`, `board-plans/:runId/apply` |
| Gợi ý phân công | `/api/cards/:cardId/assignment-suggestions`, `/api/lists/:listId/assignment-plan`, `/api/assignment/runs/:runId/outcome`, `/api/workspaces/:id/assignment-weights`, `/api/workspaces/:id/assignment-profile` | Gợi ý theo thẻ, chia việc theo danh sách, ghi phản hồi, trọng số nhóm, hồ sơ làm việc |
| Hồ sơ tự khai | `/api/me/assign-profile`, `/api/users/:userId/assign-profile/cv` | Xem / sửa hồ sơ, tải lên / xoá / tải về CV, kiểm quyền xem CV |
| Chatbot | `/api/chat`, `/api/chat/v2` | `status`, gửi câu hỏi, chọn đáp án hỏi lại, xem thêm; v2 có thêm `conversations` |

Tệp tĩnh: `/uploads/avatars`, `/uploads/boards` (công khai), `/uploads/cards` (có kiểm quyền).

---

## 12. Mô hình dữ liệu

Định nghĩa đầy đủ ở [backend/prisma/schema.prisma](backend/prisma/schema.prisma). Các nhóm bảng chính:

| Nhóm | Bảng |
|---|---|
| Người dùng và xác thực | `User`, `AuthToken`, `NotificationPreference` |
| Không gian | `Workspace`, `WorkspaceMember` |
| Bảng | `Board`, `BoardMember`, `BoardStar`, `BoardJoinRequest`, `Watch` |
| Danh sách và thẻ | `List`, `Card`, `CardMember`, `CardReminder`, `Attachment`, `Comment` |
| Nhãn, trường tùy chỉnh, checklist | `Label`, `CardLabel`, `CustomField`, `CustomFieldOption`, `CardFieldValue`, `Checklist`, `ChecklistItem` |
| Mẫu và tự động hoá | `BoardTemplate`, `BoardTemplateList`, `BoardTemplateCard`, `CardTemplate`, `CardTemplateChecklist`, `CardTemplateItem`, `AutomationRule`, `AutomationAction`, `RecurringCardSchedule` |
| Nhật ký, thông báo, tìm kiếm | `Activity`, `Notification`, `SavedFilter` |
| Module AI tạo bảng | `AiRun` |
| Module gợi ý phân công | `UserAssignProfile`, `MemberWorkProfile`, `WorkspaceAssignWeights`, `AssignWeightHistory`, `AssignRun` |
| Chatbot v2 | `ChatConversation`, `ChatTurn` |

Một vài điểm thiết kế:

- `Activity` lưu chi tiết từng thao tác kèm thời điểm. Bảng này là nguồn dữ liệu cho dòng hoạt động, thống kê, module gợi ý phân công và câu hỏi lịch sử của chatbot.
- `Card.status` luôn có giá trị; `List.status` có thể rỗng (cột tự do). Quy tắc đồng bộ nằm ở [backend/src/modules/card/cardStatus.ts](backend/src/modules/card/cardStatus.ts).
- Khoá ngoại của `AiRun` và `AssignRun` dùng `SetNull` thay vì `Cascade`, để xoá người dùng hay bảng không làm mất số liệu thực nghiệm.

---

## 13. Kiểm thử và đánh giá

### Chạy test

```bash
# Backend: cần PostgreSQL đang chạy ở localhost:5432.
# CSDL "taskflow_test" được tạo và migrate tự động.
cd backend
npm test                  # cả hai nhóm (xem dưới)
npm run test:unit         # chỉ nhóm test thuần, không chạm CSDL (~1,5 phút)
npm run test:integration  # chỉ nhóm tích hợp (HTTP thật + PostgreSQL thật)
npm run test:coverage     # chạy tất cả kèm đo độ phủ mã (báo cáo ở backend/coverage)
npm run typecheck
npm run lint

# Frontend
cd frontend
npm test
npm run test:coverage     # báo cáo ở frontend/coverage
npm run lint
npm run build
```

Backend chia hai nhóm (cấu hình ở `backend/vitest.config.ts`):

- **unit**: 61 tệp, 1.222 test hàm thuần, không chạm CSDL. Không `TRUNCATE` trước mỗi test, và Prisma bị thay bằng bản "câm" nên test lỡ chạm CSDL sẽ thất bại ngay với thông báo rõ. Test mới viết thuần thì đặt tên `*.unit.test.ts`.
- **integration**: phần còn lại, chạy tuần tự qua HTTP thật trên PostgreSQL thật, `TRUNCATE` mọi bảng trước mỗi test. Vì dùng chung một CSDL test nên **không chạy hai lượt test backend cùng lúc**.

Số liệu lượt chạy cuối (15/10/2026): backend 164 tệp / 2.440 test đều qua trong 20,6 phút (kèm đo độ phủ), độ phủ dòng 93,4% (không tính script đánh giá / seed và mã Prisma sinh ra); frontend 73 tệp / 620 test đều qua, độ phủ dòng 57,7%.

### Script đánh giá các module AI

Chạy trong `backend/`. Các script dùng bộ nhớ đệm phản hồi LLM nên chạy lại không tốn thêm lượt gọi; chúng không ghi vào CSDL ứng dụng.

| Lệnh | Mục đích |
|---|---|
| `npm run eval:ai -- --arm=rule,llm-only,hybrid --runs=3 --delay=6000` | Đánh giá module tạo bảng (25 mẫu) |
| `npm run eval:assign -- --exp=all` | Đánh giá lớp 1 phân công (8 nhánh × 20 hạt giống, quét tham số, học trọng số, độ bền) |
| `npm run eval:plan` | Đánh giá lớp 2 phân công (7 cách chia × 20 hạt giống) |
| `npx tsx src/scripts/evalDeclared.ts --phase=dev\|confirm` | Đánh giá thành phần Hồ sơ tự khai |
| `npx tsx src/scripts/evaluateChat.ts --arm=all --split=test --runs=3 --delay=4000` | Đánh giá chatbot v1 (B0 / B1 / B2) |
| `npx tsx src/scripts/evaluateChatActions.ts --split=test --runs=3 --delay=4000 --out=eval-chat-actions-result.md` | Đánh giá phần hành động của chatbot v2 (chọn công cụ, kế hoạch, an toàn đối kháng, mở rộng bảng) |
| `npm run assign:keywords`, `npm run assign:suggest` | Xem từ khoá TF-IDF và gợi ý trên dữ liệu mô phỏng |

Gói Gemini miễn phí có hạn mức theo phút và theo ngày. Khi gặp lỗi 429, chờ rồi chạy lại đúng lệnh cũ; các lượt đã có trong bộ nhớ đệm sẽ không bị gọi lại.

### Mức độ bằng chứng của từng kết quả

Không phải con số nào ở trên cũng có sức nặng như nhau. Bảng dưới ghi rõ dữ liệu, quy mô và giới hạn để dùng đúng khi trích dẫn trong báo cáo:

| Kết quả | Dữ liệu | Quy mô | Mức bằng chứng |
|---|---|---|---|
| Tạo bảng: F1 nhận dòng thành thẻ (B0 0,95 / B1 0,966 / B2 0,994) | 25 mẫu do tác giả tự soạn | 3 lần × 3 nhánh, Gemini thật | **Thật nhưng tập nhỏ, tự soạn**: khoảng tin cậy rộng, chưa phải mẫu từ người dùng khác |
| Phân công lớp 1 (đúng hạn 0,441 so với 0,389 giao ngẫu nhiên) và lớp 2 (dồn việc 35,3% giảm còn 22,2% / 28,9%) | Dữ liệu **mô phỏng** có kiểm soát (bộ sinh cố ý lệch khỏi giả định của bộ chấm), đóng băng bằng mã băm | 20 hạt giống, bootstrap 95% | **Mô phỏng**: cho thấy thuật toán đúng như thiết kế trên dữ liệu tổng hợp; **chưa phải** dữ liệu làm việc thật của một nhóm |
| Phân công: thành phần Hồ sơ tự khai | Mô phỏng | 1/4 so sánh đăng ký trước đạt | **Chưa đủ bằng chứng** để kết luận hồ sơ cải thiện phân công |
| Chatbot v1: khớp hoàn toàn (B0 82,9% / B1 95,9% / B2 94,9%) | 105 câu tập test tự soạn | 3 lần, Gemini thật | **Thật nhưng tập nhỏ, tự soạn** |
| Chatbot v2, phần đọc | Dữ liệu giả của bài kiểm tra | Vài câu đối chiếu (smoke) | **Smoke**, không phải tỷ lệ chính xác |
| Chatbot v2, hành động: chọn tuyến 96,8%, khớp kế hoạch 81,3%, tự chạy nhầm 0/28 | 45 câu (13 dev / 32 test) tự soạn, đóng băng sha256 | Tập dev: 1 lần, đủ. Tập test: **một phần**, 62/156 lượt có phản hồi (hết hạn mức ngày) | **Một phần**: phần an toàn đối kháng và mở rộng bảng của tập test **chưa chạy**; ở tập dev chỉ có 5 câu đối kháng (0/5 tự chạy). `eval-chat-actions-result.md` chưa có |
| Chatbot v2: 51 thao tác mới (bước E–I) | Thăm dò Gemini thật, không CSDL | **n = 1** (56 câu dương, 7 câu âm, 63 lượt gọi): 55/56 đúng loại ở lượt đầu | **Thăm dò**, chưa có khoảng tin cậy |
| An toàn của chatbot hành động (không tự chạy việc phá huỷ, không lộ dữ liệu) | Kho 32 câu đối kháng **xác định** (mô hình giả luôn làm theo chỉ dẫn xấu) cùng test từng giai đoạn | Chạy trong `npm test` | **Mạnh nhất**: bảo đảm bằng mã và test, không phụ thuộc LLM thật. 30/32 từ chối hoàn toàn, 2/32 chỉ tới xem trước, 0 tự chạy, 0 thay đổi dữ liệu |

Hệ quả khi viết chương đánh giá: các kết luận về **độ chính xác** của AI nên ghi là "trên tập tự soạn / dữ liệu mô phỏng"; các kết luận về **an toàn** nên dựa vào kho đối kháng xác định và test, không dựa vào lượt chạy LLM thật.
