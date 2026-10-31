import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

if (!API_URL) {
  throw new Error(
    'Thieu bien moi truong VITE_API_URL. Hay tao file .env tu .env.example.'
  );
}

export const api = axios.create({
  baseURL: API_URL,
  // Gui va nhan cookie httpOnly (chua JWT) cho moi request
  withCredentials: true,
});

// Cac trang cong khai (chua dang nhap van xem duoc) - khong da ve /login khi 401
const PUBLIC_PATHS = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
];

// Neu server tra ve 401 (het han / khong hop le), dua ve trang dang nhap
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // /auth/me la cau hoi "minh co dang dang nhap khong" - 401 o day la
      // ket qua BINH THUONG cho khach chua dang nhap tren MOI trang (ke ca
      // /boards/:id truoc khi ProtectedRoute kip dieu huong sang ban xem
      // cong khai), khong duoc coi la loi phien dang nhap can day ve /login.
      const requestUrl: string = error.config?.url ?? '';
      if (requestUrl.includes('/auth/me')) {
        return Promise.reject(error);
      }
      const path = window.location.pathname;
      // /public/... la trang xem bang PUBLIC danh cho khach chua dang nhap.
      if (!PUBLIC_PATHS.includes(path) && !path.startsWith('/public/')) {
        window.location.assign('/login');
      }
    }
    return Promise.reject(error);
  }
);
