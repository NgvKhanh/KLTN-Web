import type { Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * Gioi han so lan goi cac endpoint "nhay cam" theo dia chi IP.
 * Dung cho: quen mat khau, gui lai mail xac minh... de tranh bi lam dung
 * gui mail hang loat.
 */
const TOO_MANY = {
  success: false,
  message: 'Ban thao tac qua nhieu lan. Vui long thu lai sau it phut.',
};

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phut
  limit: 10, // toi da 10 lan / IP / 15 phut
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: TOO_MANY,
});

/**
 * Chan do mat khau: gioi han so lan goi /login theo IP.
 * Noi long hon authLimiter mot chut de tranh khoa nham nguoi dung that
 * (nhieu nguoi cung mot mang NAT), nhung van chan duoc kieu dò tu dong.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phut
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true, // dang nhap dung thi khong tinh vao han muc
  message: TOO_MANY,
});

/**
 * Chan tao tai khoan / gui email xac minh hang loat tu mot IP.
 */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 gio
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: TOO_MANY,
});

/**
 * Endpoint xem bang CONG KHAI: khong doi hoi dang nhap (ai co link deu goi
 * duoc) nen de mo hon nhung van gioi han theo IP de tranh cao du lieu hang loat.
 */
export const publicBoardLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 phut
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: TOO_MANY,
});

/**
 * Cac limiter cua module AI tinh theo NGUOI DUNG (khong theo IP nhu cac limiter
 * o tren): chi dung sau requireAuth nen luon co req.user; ca lop hoc chung 1 IP
 * van khong tranh nhau han muc. Neu vi ly do gi do khong co user thi roi ve IP.
 * ipKeyGenerator nhan CHUOI ip (khong phai req) va chuan hoa IPv6 - bat buoc de
 * express-rate-limit khong canh bao nguoi dung IPv6 lach han muc.
 */
const byUser = (req: Request): string =>
  req.user?.id ?? ipKeyGenerator(req.ip ?? '');

/**
 * Doc tep .docx/.pdf (khoi chay tien trinh con, ton CPU/RAM, KHONG goi LLM): 10 lan / user /
 * 10 phut. Dat TRUOC multer de yeu cau vuot han muc bi chan truoc khi nhan 5MB du lieu.
 */
export const aiExtractLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: byUser,
  message: TOO_MANY,
});

/** Sinh ke hoach (goi LLM): 10 lan / user / 10 phut. */
export const aiGenerateLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: byUser,
  message: TOO_MANY,
});

/**
 * Goi y phan cong: moi luot doc ca khong gian lam viec (the + lich su) va ghi 1 dong AssignRun:
 * 60 lan / user / 10 phut. Chi dung sau requireAuth (tinh theo nguoi dung, khong theo IP).
 */
export const assignSuggestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: byUser,
  message: TOO_MANY,
});

/**
 * Chia viec cho ca danh sach (lop 2): moi luot doc ca khong gian va cham toi PLAN_MAX_CARDS the (do: ~3 ms / the o nhom 120
 * the, ~74 ms / the o nhom 3000 the) nhung KHONG ghi CSDL: 10 lan / user / 10 phut. Chi dung sau requireAuth.
 */
export const assignPlanLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: byUser,
  message: TOO_MANY,
});

/**
 * Tai CV cua ho so tu khai (goi y phan cong): trich chu bang tien trinh con nhu aiExtractLimiter + ghi tep xuong dia: 10 lan / user /
 * 10 phut. Dat TRUOC multer.
 */
export const cvUploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: byUser,
  message: TOO_MANY,
});

/**
 * Chatbot tro ly (moi POST /api/chat/*: hoi, tra loi cau hoi lai, xem them): 60 lan / user / 10 phut.
 * Rieng luot goi LLM con bi ngan sach CHUNG cua ca tien trinh o chat.llm (buoc 5) - vuot thi
 * chatbot tu dung bo luat, khong tra 429.
 */
export const chatLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: byUser,
  message: TOO_MANY,
});

/**
 * Chatbot: ap dung / huy mot thao tac da xem truoc (POST /api/chat/v2/actions/:id/confirm). Khong goi LLM nhung GHI du lieu:
 * 30 lan / user / 10 phut.
 */
export const chatActionLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: byUser,
  message: TOO_MANY,
});

/** Ap dung ke hoach thanh bang that (khong goi LLM, nhe hon): 30 lan / user / 10 phut. */
export const aiApplyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: byUser,
  message: TOO_MANY,
});
