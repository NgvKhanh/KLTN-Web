import { io, type Socket } from 'socket.io-client';

// Nguon goc backend (bo duoi /api) - giong cach lam trong lib/assets.ts
const API_URL = import.meta.env.VITE_API_URL as string;
const ORIGIN = API_URL.replace(/\/api\/?$/, '');

// 1 ket noi duy nhat cho ca app. Cookie httpOnly duoc gui kem nho withCredentials.
export const socket: Socket = io(ORIGIN, {
  path: '/socket.io',
  withCredentials: true,
  autoConnect: false,
  transports: ['websocket', 'polling'],
});

export function connectSocket() {
  if (!socket.connected) socket.connect();
}

export function disconnectSocket() {
  if (socket.connected) socket.disconnect();
}
