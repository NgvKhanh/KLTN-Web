/**
 * Chuyen 1 moc thoi gian ISO (UTC, tu server) thanh gia tri cho
 * <input type="datetime-local">, dung GIO DIA PHUONG cua trinh duyet
 * (getFullYear/getMonth/getDate/getHours/getMinutes - KHONG dung getUTC*).
 *
 * <input type="datetime-local"> luon HIEU gia tri cua no la gio dia phuong,
 * khong co hau to mui gio. Dung .toISOString() (gio UTC) o day se lam gio
 * hien sai va lam lech hạn 1 khoang bang do lech mui gio moi lan Luu ma
 * khong sua gi (CODE_REVIEW.md #5). Chieu ghi lai (new Date(value).toISOString())
 * van dung, KHONG doi: chuoi khong hau to mui gio duoc JS hieu la gio dia
 * phuong, dung y nghia nguoi dung thay tren man hinh.
 *
 * Rong / null / undefined / khong hop le -> ''.
 */
export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
