/**
 * Che EMAIL trong mot cau truc du lieu long nhau (mang / doi tuong / the, danh sach, ban xuat bang...).
 *
 * Dung cho nguoi xem duoc bang chi vi bang la PUBLIC (khong phai chu bang / thanh vien bang / thanh vien
 * khong gian): ho chi co quyen xem NOI DUNG bang, khong duoc thay email that cua nguoi khac. Cung quy tac
 * voi GET /api/boards/:id/members (email tra ve la chuoi rong), nhung ap dung cho MOI duong doc long nhau
 * (danh sach + the, chi tiet the, xuat bang) de khong the sot mot noi nao do.
 *
 * Tra ve ban sao moi, khong sua dau vao. Gia tri Date giu nguyen.
 */
export function maskEmails<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => maskEmails(item)) as unknown as T;
  }
  if (value instanceof Date) {
    return value;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = key === 'email' && typeof item === 'string' ? '' : maskEmails(item);
    }
    return out as T;
  }
  return value;
}
