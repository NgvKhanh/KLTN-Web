import { useCallback, useEffect, useRef, useState } from 'react';
import {
  searchUnsplashPhotos,
  type UnsplashPhoto,
} from './api/unsplash';
import { getErrorMessage } from './errorMessage';

interface UseUnsplashPhotos {
  photos: UnsplashPhoto[];
  loading: boolean; // dang tai trang dau (hoac doi tu khoa)
  loadingMore: boolean;
  error: string | null;
  /** true khi server chua cau hinh UNSPLASH_ACCESS_KEY (HTTP 503) */
  unavailable: boolean;
  search: string;
  setSearch: (value: string) => void;
  loadMore: () => void;
  canLoadMore: boolean;
  /** goi kem callback moi khi trang dau tai xong (vd chon anh mac dinh) */
  onFirstLoad: (fn: (photos: UnsplashPhoto[]) => void) => void;
}

// Quan ly viec tim / phan trang anh nen Unsplash. Dung chung cho o "Tao bang"
// va menu "Thay doi hinh nen" trong bang.
export function useUnsplashPhotos(): UseUnsplashPhotos {
  const [photos, setPhotos] = useState<UnsplashPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState<number | null>(null);

  const firstLoadCb = useRef<((photos: UnsplashPhoto[]) => void) | null>(null);
  const onFirstLoad = useCallback(
    (fn: (photos: UnsplashPhoto[]) => void) => {
      firstLoadCb.current = fn;
    },
    []
  );
  const firedFirstLoad = useRef(false);

  // Trang dau: chay ngay khi search rong, debounce 400ms khi go tu khoa.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const t = setTimeout(
      () => {
        searchUnsplashPhotos(search, 1)
          .then((res) => {
            if (!alive) return;
            setPhotos(res.photos);
            setPage(1);
            setTotalPages(res.totalPages);
            if (!firedFirstLoad.current) {
              firedFirstLoad.current = true;
              firstLoadCb.current?.(res.photos);
            }
          })
          .catch((err) => {
            if (!alive) return;
            if (err?.response?.status === 503) setUnavailable(true);
            else setError(getErrorMessage(err, 'Không tải được ảnh.'));
          })
          .finally(() => {
            if (alive) setLoading(false);
          });
      },
      search ? 400 : 0
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [search]);

  const loadMore = useCallback(() => {
    setLoadingMore(true);
    searchUnsplashPhotos(search, page + 1)
      .then((res) => {
        setPhotos((cur) => [...cur, ...res.photos]);
        setPage((p) => p + 1);
        setTotalPages(res.totalPages);
      })
      .catch((err) => setError(getErrorMessage(err, 'Không tải được ảnh.')))
      .finally(() => setLoadingMore(false));
  }, [search, page]);

  const canLoadMore =
    !unavailable && photos.length > 0 && (totalPages === null || page < totalPages);

  return {
    photos,
    loading,
    loadingMore,
    error,
    unavailable,
    search,
    setSearch,
    loadMore,
    canLoadMore,
    onFirstLoad,
  };
}
