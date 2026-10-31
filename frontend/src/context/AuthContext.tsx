import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { googleLogin as googleLoginApi } from '../lib/api/auth';
import { api } from '../lib/axios';
import { connectSocket, disconnectSocket } from '../lib/socket';
import type { User } from '../types/auth';

interface AuthResponse {
  success: boolean;
  data: { user: User };
}

interface MeResponse {
  success: boolean;
  data: { user: User };
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  // Cap nhat thong tin nguoi dung trong bo nho (sau khi sua ho so)
  updateUser: (patch: Partial<User>) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Cookie httpOnly duoc gui tu dong; chi can hoi /auth/me xem con phien khong
    async function loadCurrentUser() {
      try {
        const res = await api.get<MeResponse>('/auth/me');
        setUser(res.data.data.user);
      } catch {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    }

    loadCurrentUser();
  }, []);

  // Nối/ngắt kết nối realtime theo trạng thái đăng nhập
  useEffect(() => {
    if (user) connectSocket();
    else disconnectSocket();
  }, [user]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<AuthResponse>('/auth/login', {
      email,
      password,
    });
    setUser(res.data.data.user);
  }, []);

  const loginWithGoogle = useCallback(async (credential: string) => {
    const user = await googleLoginApi(credential);
    setUser(user);
  }, []);

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const res = await api.post<AuthResponse>('/auth/register', {
        name,
        email,
        password,
      });
      setUser(res.data.data.user);
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
    }
  }, []);

  const updateUser = useCallback((patch: Partial<User>) => {
    setUser((cur) => (cur ? { ...cur, ...patch } : cur));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        login,
        loginWithGoogle,
        register,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth phai duoc dung ben trong AuthProvider');
  }
  return context;
}
