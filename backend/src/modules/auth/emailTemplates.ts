/**
 * Noi dung cac email he thong gui cho nguoi dung.
 * Moi ham tra ve { subject, html } de dua thang vao sendMail().
 */

const BRAND = '#0c66e4';

/** Khung chung: header TaskFlow + phan than + chan trang. */
function layout(bodyHtml: string): string {
  return `
  <div style="background:#f1f5f9;padding:24px 0;font-family:system-ui,-apple-system,'Segoe UI',sans-serif">
    <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
      <div style="background:${BRAND};padding:16px 24px">
        <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-0.02em">TaskFlow</span>
      </div>
      <div style="padding:24px;color:#1e293b;font-size:14px;line-height:1.6">
        ${bodyHtml}
      </div>
      <div style="padding:16px 24px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:12px">
        Email tu dong tu TaskFlow &mdash; Do an tot nghiep. Vui long khong tra loi email nay.
      </div>
    </div>
  </div>`;
}

function button(url: string, label: string): string {
  return `
    <a href="${url}"
       style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;
              padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px">
      ${label}
    </a>`;
}

export function resetPasswordEmail(input: {
  name: string;
  url: string;
  expiresInMinutes: number;
}): { subject: string; html: string } {
  const { name, url, expiresInMinutes } = input;
  return {
    subject: 'Dat lai mat khau TaskFlow',
    html: layout(`
      <p>Chao ${escapeHtml(name)},</p>
      <p>Chung toi nhan duoc yeu cau dat lai mat khau cho tai khoan cua ban.
         Bam nut duoi day de tao mat khau moi:</p>
      <p style="margin:20px 0">${button(url, 'Dat lai mat khau')}</p>
      <p style="color:#64748b">Lien ket co hieu luc trong ${expiresInMinutes} phut.
         Neu ban khong yeu cau, hay bo qua email nay &mdash; mat khau hien tai van an toan.</p>
      <p style="color:#94a3b8;font-size:12px;word-break:break-all">
         Neu nut khong hoat dong, sao chep dia chi sau vao trinh duyet:<br>${url}</p>
    `),
  };
}

/** Tai khoan dang ky bang Google (chua co mat khau) bam "Quen mat khau": dat mat khau lan dau. */
export function setPasswordEmail(input: {
  name: string;
  url: string;
  expiresInMinutes: number;
}): { subject: string; html: string } {
  const { name, url, expiresInMinutes } = input;
  return {
    subject: 'Dat mat khau cho tai khoan TaskFlow',
    html: layout(`
      <p>Chao ${escapeHtml(name)},</p>
      <p>Tai khoan cua ban dang dang nhap bang Google va chua co mat khau.
         Bam nut duoi day de tao mat khau, sau do ban co the dang nhap bang email + mat khau:</p>
      <p style="margin:20px 0">${button(url, 'Dat mat khau')}</p>
      <p style="color:#64748b">Lien ket co hieu luc trong ${expiresInMinutes} phut.
         Dang nhap bang Google van dung duoc nhu cu. Neu ban khong yeu cau, hay bo qua email nay.</p>
      <p style="color:#94a3b8;font-size:12px;word-break:break-all">
         Neu nut khong hoat dong, sao chep dia chi sau vao trinh duyet:<br>${url}</p>
    `),
  };
}

export function verifyEmailEmail(input: {
  name: string;
  url: string;
  expiresInHours: number;
}): { subject: string; html: string } {
  const { name, url, expiresInHours } = input;
  return {
    subject: 'Xac minh email TaskFlow',
    html: layout(`
      <p>Chao ${escapeHtml(name)},</p>
      <p>Cam on ban da dang ky TaskFlow. Bam nut duoi day de xac minh dia chi email:</p>
      <p style="margin:20px 0">${button(url, 'Xac minh email')}</p>
      <p style="color:#64748b">Lien ket co hieu luc trong ${expiresInHours} gio.
         Neu ban khong tao tai khoan nay, hay bo qua email.</p>
      <p style="color:#94a3b8;font-size:12px;word-break:break-all">
         Neu nut khong hoat dong, sao chep dia chi sau vao trinh duyet:<br>${url}</p>
    `),
  };
}

export function boardInviteEmail(input: {
  inviterName: string;
  boardName: string;
  url: string;
}): { subject: string; html: string } {
  const { inviterName, boardName, url } = input;
  return {
    subject: `${inviterName} moi ban vao bang "${boardName}" tren TaskFlow`,
    html: layout(`
      <p>Chao ban,</p>
      <p><strong>${escapeHtml(inviterName)}</strong> vua moi ban tham gia bang
         <strong>${escapeHtml(boardName)}</strong> tren TaskFlow.</p>
      <p>Ban chua co tai khoan TaskFlow. Hay bam nut duoi day de dang ky (hoac dang nhap),
         sau do gui yeu cau tham gia bang:</p>
      <p style="margin:20px 0">${button(url, 'Xem loi moi')}</p>
      <p style="color:#94a3b8;font-size:12px;word-break:break-all">
         Neu nut khong hoat dong, sao chep dia chi sau vao trinh duyet:<br>${url}</p>
    `),
  };
}

export function workspaceInviteEmail(input: {
  inviterName: string;
  workspaceName: string;
  url: string;
}): { subject: string; html: string } {
  const { inviterName, workspaceName, url } = input;
  return {
    subject: `${inviterName} moi ban vao khong gian "${workspaceName}" tren TaskFlow`,
    html: layout(`
      <p>Chao ban,</p>
      <p><strong>${escapeHtml(inviterName)}</strong> vua moi ban tham gia khong gian lam viec
         <strong>${escapeHtml(workspaceName)}</strong> tren TaskFlow.</p>
      <p>Ban chua co tai khoan TaskFlow. Hay bam nut duoi day de dang ky; sau khi co tai khoan,
         quan tri vien khong gian se them ban vao.</p>
      <p style="margin:20px 0">${button(url, 'Dang ky TaskFlow')}</p>
      <p style="color:#94a3b8;font-size:12px;word-break:break-all">
         Neu nut khong hoat dong, sao chep dia chi sau vao trinh duyet:<br>${url}</p>
    `),
  };
}

export function dueReminderEmail(input: {
  name: string;
  cardTitle: string;
  boardName: string;
  dueDate: Date;
  offsetLabel: string;
  url: string;
}): { subject: string; html: string } {
  const { name, cardTitle, boardName, dueDate, offsetLabel, url } = input;
  const dueLabel = dueDate.toLocaleString('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
  return {
    subject: `Sắp đến hạn: "${cardTitle}"`,
    html: layout(`
      <p>Chao ${escapeHtml(name)},</p>
      <p>Thẻ <strong>${escapeHtml(cardTitle)}</strong> (bảng ${escapeHtml(boardName)})
         sẽ hết hạn vào <strong>${dueLabel}</strong> &mdash; còn ${offsetLabel} nữa,
         theo lời nhắc bạn đã đặt.</p>
      <p style="margin:20px 0">${button(url, 'Xem thẻ')}</p>
      <p style="color:#94a3b8;font-size:12px;word-break:break-all">
         Neu nut khong hoat dong, sao chep dia chi sau vao trinh duyet:<br>${url}</p>
    `),
  };
}

/**
 * Canh bao nguy co tre han (RISK_MODULE.md §8.4). CO Y KHONG chua ly do (ly do co the nhac toi lich su lam viec cua nguoi duoc
 * giao - luat rieng tu Q2), KHONG phan tram, KHONG muc (user chot 28/10, 30/10): chi "co nguy co tre han" hoac "da tre han".
 * Gio hien theo gio Viet Nam (may chu chay UTC trong Docker).
 */
export function riskWarningEmail(input: {
  name: string;
  cardTitle: string;
  boardName: string;
  dueDate: Date;
  /** true = "da tre han" (the vua qua han); false = "co nguy co tre han". */
  overdue: boolean;
  url: string;
}): { subject: string; html: string } {
  const { name, cardTitle, boardName, dueDate, overdue, url } = input;
  const dueLabel = dueDate.toLocaleString('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'Asia/Ho_Chi_Minh',
  });
  const card = `<strong>${escapeHtml(cardTitle)}</strong> (bảng ${escapeHtml(boardName)})`;
  return {
    subject: `${overdue ? 'Đã trễ hạn' : 'Có nguy cơ trễ hạn'}: "${cardTitle}"`,
    html: layout(`
      <p>Chao ${escapeHtml(name)},</p>
      <p>${
        overdue
          ? `Thẻ ${card} đã trễ hạn (hạn <strong>${dueLabel}</strong>).`
          : `Thẻ ${card} hạn <strong>${dueLabel}</strong> có nguy cơ trễ hạn.`
      }</p>
      <p>Mở thẻ để xem và điều chỉnh kế hoạch.</p>
      <p style="margin:20px 0">${button(url, 'Xem thẻ')}</p>
      <p style="color:#94a3b8;font-size:12px;word-break:break-all">
         Neu nut khong hoat dong, sao chep dia chi sau vao trinh duyet:<br>${url}</p>
      <p style="color:#94a3b8;font-size:12px">Tắt email loại này trong Cài đặt thông báo → Nguy cơ trễ hạn.</p>
    `),
  };
}

export function dailyDigestEmail(input: {
  name: string;
  cardCount: number;
  boardCount: number;
  url: string;
}): { subject: string; html: string } {
  const { name, cardCount, boardCount, url } = input;
  const total = cardCount + boardCount;
  const lines: string[] = [];
  if (cardCount > 0) {
    lines.push(`<li>${cardCount} thông báo hoạt động trên thẻ</li>`);
  }
  if (boardCount > 0) {
    lines.push(`<li>${boardCount} thông báo về bảng / không gian làm việc</li>`);
  }
  return {
    subject: `TaskFlow: ${total} thông báo mới hôm nay`,
    html: layout(`
      <p>Chao ${escapeHtml(name)},</p>
      <p>Tổng hợp thông báo bạn nhận được trong 24 giờ qua:</p>
      <ul style="padding-left:20px;margin:12px 0">${lines.join('')}</ul>
      <p style="margin:20px 0">${button(url, 'Xem trên TaskFlow')}</p>
      <p style="color:#94a3b8;font-size:12px">
         Bạn nhận được email này vì đã bật "Email tổng hợp hằng ngày" trong Cài đặt thông báo.</p>
    `),
  };
}

/** Chan cac ky tu HTML nguy hiem trong du lieu do nguoi dung nhap (ten). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
