import { useEffect, useRef, useState } from 'react';
import { assetUrl } from '../lib/assets';
import { initialsOf } from '../lib/avatar';

const AVATAR_COLORS = [
  '#0079BF',
  '#D29034',
  '#519839',
  '#B04632',
  '#89609E',
  '#CD5A91',
  '#00AECC',
  '#4BBF6B',
];

function colorOf(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1)
    h = (h * 31 + id.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(h)]!;
}

// Nho cac URL da tai thanh cong -> instance khac cua cung anh hien ngay, khong nhap nhay
const KNOWN_GOOD = new Set<string>();
// Backoff khi loi: 1s, 3s, 8s, roi 20s mai mai (chi thu khi tab dang mo)
const BACKOFF = [1000, 3000, 8000, 20000];

/**
 * O avatar tron dung chung.
 * - Luon ve chu cai dau ten lam nen.
 * - Neu co avatarUrl: <img> tai ngam ben tren, chi hien khi tai xong (fade).
 *   Anh loi/cham -> nguoi dung chi thay chu cai, KHONG bao gio thay bieu tuong
 *   "anh vo" cua trinh duyet.
 * - Loi -> thu lai mai (backoff toi da 20s), tu phuc hoi khi server tro lai.
 */
export default function Avatar({
  id,
  name,
  avatarUrl,
  className = 'h-7 w-7 text-xs',
  title,
}: {
  id: string;
  name: string;
  avatarUrl?: string | null;
  className?: string;
  /** Chú thích khi rê chuột; mặc định là tên. */
  title?: string;
}) {
  const base = avatarUrl ? assetUrl(avatarUrl) : '';
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState(() => KNOWN_GOOD.has(base));
  const failsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Doi anh -> reset
  useEffect(() => {
    failsRef.current = 0;
    setNonce(0);
    setLoaded(KNOWN_GOOD.has(base));
    return () => clearTimeout(timerRef.current);
  }, [base]);

  // Quay lai tab -> thu lai ngay (thay vi cho het backoff)
  useEffect(() => {
    if (!base || loaded) return;
    const onBack = () => {
      failsRef.current = 0;
      setNonce((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    return () => {
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', onBack);
    };
  }, [base, loaded]);

  const src = base ? (nonce > 0 ? `${base}${base.includes('?') ? '&' : '?'}v=${nonce}` : base) : '';

  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden rounded-full font-semibold text-white ${className}`}
      style={{ backgroundColor: colorOf(id) }}
      title={title ?? name}
    >
      <span className={loaded ? 'invisible' : ''}>{initialsOf(name)}</span>
      {base && (
        <img
          key={src}
          src={src}
          alt=""
          decoding="async"
          onLoad={() => {
            KNOWN_GOOD.add(base);
            setLoaded(true);
          }}
          onError={() => {
            clearTimeout(timerRef.current);
            const i = Math.min(failsRef.current, BACKOFF.length - 1);
            failsRef.current += 1;
            timerRef.current = setTimeout(() => setNonce((n) => n + 1), BACKOFF[i]);
          }}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </span>
  );
}
