import { useId } from 'react';

// Dai mau thuong hieu TaskFlow: xanh ngoc -> cham. Co tinh chon khac han xanh cua Trello.
export const BRAND_FROM = '#06b6d4';
export const BRAND_TO = '#4f46e5';

interface MarkProps {
  // 'color' = ban gradient (dat tren nen sang), 'white' = ban trang (dat tren nen mau dam)
  variant?: 'color' | 'white';
  className?: string;
}

/**
 * Dau hieu (icon) cua TaskFlow: mui ten gap giay gom 3 manh lech sac do,
 * phong len goc tren ben phai - y nghia "cong viec duoc day di".
 * Ve bang 3 hinh da giac dac nen phong to hay thu nho deu khong vo net.
 */
export function LogoMark({ variant = 'color', className = 'h-7 w-7' }: MarkProps) {
  // Moi lan render sinh mot id rieng, tranh trung id gradient khi trang co nhieu logo
  const gradientId = useId();
  const fill = variant === 'white' ? '#ffffff' : `url(#${gradientId})`;

  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="none"
      role="img"
      aria-label="TaskFlow"
    >
      {variant === 'color' && (
        <defs>
          {/* userSpaceOnUse: mau trai deu tren ca 3 manh thay vi tinh rieng tung manh */}
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1="0"
            y1="48"
            x2="48"
            y2="0"
          >
            <stop offset="0" stopColor={BRAND_FROM} />
            <stop offset="1" stopColor={BRAND_TO} />
          </linearGradient>
        </defs>
      )}
      {/* Manh tren: canh sang nhat, huong ve dau mui ten */}
      <path d="M41.8 7.9L16.5 16L24.6 25.2Z" fill={fill} />
      {/* Manh phai: mat gap chim hon */}
      <path d="M41.8 7.9L24.6 25.2L31.5 36.7Z" fill={fill} opacity={0.72} />
      {/* Manh duoi: duoi mui ten, nhat nhat de tao chieu sau */}
      <path d="M16.5 16L24.6 25.2L10.8 40.1L6.2 28.6Z" fill={fill} opacity={0.45} />
    </svg>
  );
}

interface LogoProps extends MarkProps {
  // Co hien chu "TaskFlow" ben canh hay chi hien mot dau hieu
  withText?: boolean;
  // Class rieng cho phan chu (co chu, mau chu)
  textClassName?: string;
  // Class rieng cho phan dau hieu
  markClassName?: string;
}

/**
 * Logo day du: dau hieu + chu "TaskFlow".
 * Dung chung cho header, trang dang nhap... de moi noi deu hien thi giong nhau.
 */
export default function Logo({
  variant = 'color',
  withText = true,
  className = '',
  markClassName = 'h-7 w-7',
  textClassName = 'text-lg font-extrabold tracking-tight',
}: LogoProps) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <LogoMark variant={variant} className={markClassName} />
      {withText && <span className={textClassName}>TaskFlow</span>}
    </span>
  );
}
