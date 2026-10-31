// Chuan hoa de so khop khong phan biet hoa thuong va dau tieng Viet (loc / tim kiem phia giao dien).

/** "  Đăng Nhập " -> "dang nhap". */
export function fold(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase('vi')
    .trim();
}
