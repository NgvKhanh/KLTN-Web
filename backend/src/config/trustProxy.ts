/**
 * Doc bien moi truong TRUST_PROXY thanh gia tri cho `app.set('trust proxy', ...)` cua Express.
 *
 * Mac dinh (khong dat) = KHONG tin proxy nao: req.ip la dia chi ket noi truc tiep. Khi chay SAU reverse proxy
 * (nginx, Cloudflare, Render...) phai dat, neu khong req.ip luon la dia chi cua proxy va moi gioi han theo IP
 * (dang nhap, dang ky, quen mat khau) se tinh chung MOI nguoi dung thanh mot.
 *   - so nguyen N (>= 1)  : tin N cap proxy (vd 1 khi chi co mot reverse proxy truoc backend) - KHUYEN DUNG
 *   - "true"              : tin moi proxy (khong khuyen: client tu gia duoc X-Forwarded-For)
 *   - chuoi khac          : danh sach dia chi / mang con theo cu phap Express, vd "loopback, 10.0.0.0/8"
 *   - de trong / false / 0: khong tin
 */
export type TrustProxy = boolean | number | string | null;

export function parseTrustProxy(raw: string | undefined): TrustProxy {
  if (raw === undefined) return null;
  const value = raw.trim();
  if (value === '') return null;
  const lower = value.toLowerCase();
  if (['false', 'no', 'off', '0'].includes(lower)) return null;
  if (['true', 'yes', 'on'].includes(lower)) return true;
  if (/^\d+$/.test(value)) return Number(value);
  if (/^[A-Za-z0-9.:/,\s_-]+$/.test(value)) return value;
  throw new Error(
    `Bien moi truong TRUST_PROXY khong hop le: "${raw}". Dung so nguyen (so cap proxy), true, hoac danh sach dia chi / mang con.`
  );
}
