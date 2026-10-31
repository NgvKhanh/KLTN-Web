// Danh sach id cac bang vua mo gan day (luu tren trinh duyet)
const KEY = 'taskflow_recent_boards';
const MAX = 8;

export function pushRecentBoard(id: string): void {
  try {
    const cur = getRecentBoards();
    const next = [id, ...cur.filter((x) => x !== id)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // bo qua (che do rieng tu / bi chan)
  }
}

export function getRecentBoards(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}
