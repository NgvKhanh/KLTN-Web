import { useCallback, useState, type CSSProperties } from 'react';
import type { Board } from '../types/board';
import { assetUrl } from './assets';

// Mỗi mục điều hướng chính: nhãn, đích đến (route có sẵn) và nét vẽ biểu tượng.
// Dùng chung cho sidebar ngoài bảng và sidebar trong bảng để hai nơi không lệch nhau.
// Tìm kiếm nâng cao không có ở đây: vào bằng ô tìm kiếm trên header (Enter).
export const NAV_ITEMS = [
  { to: '/home', label: 'Tổng quan', end: false, icon: 'M3 12l9-8 9 8M5 10v10h5v-6h4v6h5V10' },
  { to: '/my-cards', label: 'Công việc của tôi', end: false, icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11' },
  { to: '/calendar', label: 'Lịch', end: false, icon: 'M5 4h14a2 2 0 012 2v13a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zM3 10h18M8 2v4M16 2v4' },
  { to: '/boards', label: 'Tất cả bảng', end: true, icon: 'M4 4h6v16H4zM14 4h6v10h-6z' },
  { to: '/templates', label: 'Mẫu', end: false, icon: 'M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2zM3 9h18M9 9v11' },
] as const;

export function boardSwatchStyle(b: Board): CSSProperties {
  return b.backgroundImage
    ? {
        backgroundImage: `url(${assetUrl(b.backgroundImage)})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }
    : { backgroundColor: b.color };
}

// Trạng thái đóng/mở từng không gian, nhớ trên trình duyệt này. Chưa có ghi nhận thì
// không gian mặc định được mở, các không gian khác đóng.
const OPEN_KEY = 'taskflow_sidebar_workspaces';

function loadOpenState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(OPEN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

// defaultOpenId: không gian mở sẵn khi chưa có ghi nhận nào cho nó.
export function useWorkspaceOpenState(defaultOpenId: string | null) {
  const [openState, setOpenState] = useState<Record<string, boolean>>(loadOpenState);

  const isOpen = (id: string): boolean => openState[id] ?? id === defaultOpenId;

  const setOpen = useCallback((id: string, open: boolean) => {
    setOpenState((cur) => {
      const next = { ...cur, [id]: open };
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(next));
      } catch {
        // trình duyệt chặn lưu trữ: chỉ mất khả năng nhớ giữa các lần mở
      }
      return next;
    });
  }, []);

  return { isOpen, setOpen };
}
