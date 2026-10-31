import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import type { ListPhotosQuery } from './unsplash.schema';

const API_BASE = 'https://api.unsplash.com';
const UTM = 'utm_source=taskflow&utm_medium=referral';

// Anh nen sau khi da rut gon, gui ve cho frontend
export interface UnsplashPhoto {
  id: string;
  description: string;
  color: string; // mau chu dao (hex) - dung lam nen cho luc anh chua tai xong
  blurHash: string | null;
  width: number;
  height: number;
  thumbUrl: string; // anh nho cho luoi chon
  fullUrl: string; // anh lon dung lam phong nen bang
  downloadLocation: string; // ping vao day khi nguoi dung thuc su chon anh
  attributionName: string;
  attributionUrl: string;
}

// Cache nho trong bo nho: Unsplash chi cho 50 request/gio o che do demo,
// nen giu ket qua 10 phut de tiet kiem quota va tra ve nhanh hon.
interface CacheEntry {
  at: number;
  data: { photos: UnsplashPhoto[]; totalPages: number | null };
}
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function requireKey(): string {
  if (!env.unsplashAccessKey) {
    throw new AppError(
      'Chua cau hinh UNSPLASH_ACCESS_KEY tren server nen chua dung duoc thu vien anh.',
      503
    );
  }
  return env.unsplashAccessKey;
}

async function callUnsplash(pathWithQuery: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${pathWithQuery}`, {
    headers: {
      Authorization: `Client-ID ${requireKey()}`,
      'Accept-Version': 'v1',
    },
  });

  if (res.status === 401) {
    throw new AppError('Access Key Unsplash khong hop le.', 502);
  }
  if (res.status === 403) {
    throw new AppError(
      'Da vuot gioi han goi Unsplash (50 lan/gio o che do demo). Thu lai sau.',
      429
    );
  }
  if (!res.ok) {
    throw new AppError(`Unsplash tra ve loi (${res.status}).`, 502);
  }
  return res.json();
}

interface RawPhoto {
  id: string;
  description: string | null;
  alt_description: string | null;
  color: string | null;
  blur_hash: string | null;
  width: number;
  height: number;
  urls: { raw: string };
  links: { download_location: string };
  user: { name: string; links: { html: string } };
}

function toPhoto(raw: RawPhoto): UnsplashPhoto {
  const sep = raw.urls.raw.includes('?') ? '&' : '?';
  return {
    id: raw.id,
    description: raw.description ?? raw.alt_description ?? 'Anh nen',
    color: raw.color ?? '#0079BF',
    blurHash: raw.blur_hash,
    width: raw.width,
    height: raw.height,
    thumbUrl: `${raw.urls.raw}${sep}w=280&h=180&fit=crop&crop=entropy&q=60&auto=format`,
    fullUrl: `${raw.urls.raw}${sep}w=1920&q=80&fit=max&auto=format`,
    downloadLocation: raw.links.download_location,
    attributionName: raw.user.name,
    attributionUrl: `${raw.user.links.html}?${UTM}`,
  };
}

export async function searchPhotos(params: ListPhotosQuery): Promise<{
  photos: UnsplashPhoto[];
  totalPages: number | null;
}> {
  const query = params.query?.trim();
  const key = `${query ?? '*'}::${params.page}`;

  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.data;
  }

  let data: { photos: UnsplashPhoto[]; totalPages: number | null };

  if (query) {
    const json = (await callUnsplash(
      `/search/photos?query=${encodeURIComponent(query)}&per_page=30&page=${
        params.page
      }&orientation=landscape&content_filter=high`
    )) as { results: RawPhoto[]; total_pages: number };
    data = {
      photos: json.results.map(toPhoto),
      totalPages: json.total_pages,
    };
  } else {
    // Khong co tu khoa -> bo anh "noi bat" (editorial feed) lam mac dinh
    const json = (await callUnsplash(
      `/photos?per_page=30&page=${params.page}&order_by=popular`
    )) as RawPhoto[];
    data = { photos: json.map(toPhoto), totalPages: null };
  }

  cache.set(key, { at: Date.now(), data });
  return data;
}

// Theo dieu khoan Unsplash: khi nguoi dung THUC SU chon 1 anh de dung,
// ung dung phai goi vao links.download_location cua anh do.
export async function trackDownload(downloadLocation: string): Promise<void> {
  try {
    await fetch(downloadLocation, {
      headers: { Authorization: `Client-ID ${requireKey()}` },
    });
  } catch {
    // Chi la thong ke, that bai cung khong sao
  }
}
