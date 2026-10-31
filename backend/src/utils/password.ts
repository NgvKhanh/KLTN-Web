import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

/** Bam mat khau truoc khi luu vao DB, khong bao gio luu mat khau dang van ban thuong. */
export function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/** So sanh mat khau nguoi dung nhap voi hash da luu. */
export function comparePassword(
  plainPassword: string,
  hashedPassword: string
): Promise<boolean> {
  return bcrypt.compare(plainPassword, hashedPassword);
}
