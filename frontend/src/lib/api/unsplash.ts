import { api } from '../axios';

export interface UnsplashPhoto {
  id: string;
  description: string;
  color: string;
  blurHash: string | null;
  width: number;
  height: number;
  thumbUrl: string;
  fullUrl: string;
  downloadLocation: string;
  attributionName: string;
  attributionUrl: string;
}

interface SearchResult {
  photos: UnsplashPhoto[];
  totalPages: number | null;
}

// Tim anh nen. query rong -> bo anh "noi bat" mac dinh.
export async function searchUnsplashPhotos(
  query: string,
  page = 1
): Promise<SearchResult> {
  const res = await api.get<{ data: SearchResult }>('/unsplash', {
    params: { query: query.trim() || undefined, page },
  });
  return res.data.data;
}

// Bao Unsplash "anh nay vua duoc dung" (bat buoc theo dieu khoan cua ho).
export async function trackUnsplashDownload(
  downloadLocation: string
): Promise<void> {
  try {
    await api.post('/unsplash/track-download', { downloadLocation });
  } catch {
    // chi la thong ke
  }
}
