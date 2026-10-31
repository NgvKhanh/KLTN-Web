import { api } from '../axios';
import { connectSocket, disconnectSocket } from '../socket';
import type { User } from '../../types/auth';

export interface MyActivity {
  id: string;
  type: string;
  data: Record<string, string>;
  createdAt: string;
  board: { id: string; name: string } | null;
  /** The cua dong nhat ky: ten hien tai (null neu the da chuyen sang bang khac), da bi xoa chua. */
  card: { id: string; title: string | null; deleted: boolean } | null;
}

export async function updateProfile(input: {
  name?: string;
  avatarUrl?: string | null;
}): Promise<User> {
  const res = await api.patch<{ data: { user: User } }>('/auth/me', input);
  return res.data.data.user;
}

export async function changePassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<void> {
  await api.patch('/auth/password', input);
  // Backend cap cookie MOI nhung da chu dong ngat moi socket dang mo cua
  // phien nay (thu hoi token cu). Socket.IO KHONG tu ket noi lai khi bi
  // server chu dong ngat (disconnect reason "io server disconnect"), nen
  // phai tu ngat + noi lai o day - neu khong, cap nhat realtime cua bang se
  // ngung hoat dong cho toi khi nguoi dung tu tai lai trang.
  // disconnectSocket() truoc de dam bao noi lai voi cookie MOI ke ca khi
  // su kien ngat tu server chua kip toi client luc ham nay chay.
  disconnectSocket();
  connectSocket();
}

// Tai anh dai dien len (field "image", multipart/form-data)
export async function uploadAvatar(file: File): Promise<User> {
  const form = new FormData();
  form.append('image', file);
  const res = await api.post<{ data: { user: User } }>('/auth/me/avatar', form);
  return res.data.data.user;
}

/** `before` = createdAt cua dong cuoi cung da co (tai trang tiep theo). */
export async function fetchMyActivity(
  before?: string
): Promise<{ activities: MyActivity[]; hasMore: boolean }> {
  const res = await api.get<{ data: { activities: MyActivity[]; hasMore?: boolean } }>(
    '/activities/me',
    { params: before ? { before } : undefined }
  );
  return { activities: res.data.data.activities, hasMore: res.data.data.hasMore === true };
}

// Quen mat khau: gui email chua link dat lai.
// previewUrl chi co khi backend chay dev + dung Ethereal (mail ao).
export async function forgotPassword(
  email: string
): Promise<{ previewUrl?: string }> {
  const res = await api.post<{ data?: { previewUrl?: string } }>(
    '/auth/forgot-password',
    { email }
  );
  return res.data.data ?? {};
}

// Dat lai mat khau bang token trong link email.
export async function resetPassword(
  token: string,
  newPassword: string
): Promise<void> {
  await api.post('/auth/reset-password', { token, newPassword });
}

// Xac minh email bang token trong link. Tra ve user da cap nhat.
export async function verifyEmail(token: string): Promise<User> {
  const res = await api.post<{ data: { user: User } }>('/auth/verify-email', {
    token,
  });
  return res.data.data.user;
}

// Gui lai email xac minh (can dang nhap).
export async function resendVerification(): Promise<{ previewUrl?: string }> {
  const res = await api.post<{ data?: { previewUrl?: string } }>(
    '/auth/resend-verification'
  );
  return res.data.data ?? {};
}

// Dang nhap bang Google: gui ID token (credential) tu Google Identity Services.
export async function googleLogin(credential: string): Promise<User> {
  const res = await api.post<{ data: { user: User } }>('/auth/google', {
    credential,
  });
  return res.data.data.user;
}
