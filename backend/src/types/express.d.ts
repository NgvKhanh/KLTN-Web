// Mo rong kieu Request cua Express de gan thong tin nguoi dung da xac thuc

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
