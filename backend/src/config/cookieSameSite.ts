/**
 * Doc bien moi truong COOKIE_SAMESITE thanh gia tri `sameSite` cho cookie dang nhap ("token").
 *
 *   - "lax" (mac dinh): frontend va backend CUNG trang (vd localhost, hoac app.ten-mien.vn + api.ten-mien.vn).
 *                       Trinh duyet khong gui cookie kem request tu trang khac -> chan CSRF ngay tu goc.
 *   - "none"          : frontend va backend KHAC trang (vd xxx.vercel.app + yyy.onrender.com). Bat buoc kem
 *                       Secure (chi HTTPS). Cookie di kem moi request cheo trang -> phai co originGuard
 *                       (middleware/originGuard.middleware.ts) chan request ghi tu trang la. Safari chan
 *                       cookie ben thu ba nen se khong dang nhap duoc.
 *   - "strict"        : nhu lax nhung chat hon (mo link tu email / trang khac se chua dang nhap).
 */
export type CookieSameSite = 'lax' | 'strict' | 'none';

export function parseCookieSameSite(raw: string | undefined): CookieSameSite {
  if (raw === undefined) return 'lax';
  const value = raw.trim().toLowerCase();
  if (value === '') return 'lax';
  if (value === 'lax' || value === 'strict' || value === 'none') return value;
  throw new Error(`Bien moi truong COOKIE_SAMESITE khong hop le: "${raw}". Dung lax, strict hoac none.`);
}
