// Ghep duong dan file tinh tu backend (vd "/uploads/boards/x.png") thanh URL day du.
const API_URL = import.meta.env.VITE_API_URL as string;
const ORIGIN = API_URL.replace(/\/api\/?$/, '');

export function assetUrl(pathOrUrl: string | null): string {
  if (!pathOrUrl) return '';
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  return `${ORIGIN}${pathOrUrl}`;
}
