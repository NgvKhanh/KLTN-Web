import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Logo from '../Logo';
import AuthShowcase from './AuthShowcase';

// Shared brand colors keep authentication consistent with the public landing.
export const authFieldClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-500 transition-colors focus:border-[var(--brand-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]/20';

interface Props {
  title: string;
  subtitle: string;
  children: ReactNode;
  // Dong chan the (vi du: "Chua co tai khoan? Dang ky")
  footer: ReactNode;
}

// Trang Dang nhap / Dang ky / quen mat khau: nen sang tron, cung kieu voi trang gioi thieu. Duoi 1024px chi co
// form can giua; tu 1024px chia 2 cot: form ben trai, gioi thieu ngan + bang minh hoa (du lieu demo) ben phai.
export default function AuthShell({ title, subtitle, children, footer }: Props) {
  return (
    <div className="min-h-screen bg-slate-50 lg:grid lg:grid-cols-2" style={{ fontFamily: 'var(--brand-font)' }}>
      <div className="flex min-h-screen items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-6 flex justify-center text-slate-900">
            <Logo markClassName="h-8 w-8" textClassName="text-xl font-bold tracking-tight" />
          </Link>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
            <p className="mt-1 text-sm text-slate-500">{subtitle}</p>

            <div className="mt-6">{children}</div>
          </div>

          <p className="mt-5 text-center text-sm text-slate-600">{footer}</p>
          <p className="mt-8 text-center text-xs text-slate-500">© 2026 TaskFlow — Đồ án tốt nghiệp</p>
        </div>
      </div>

      <AuthShowcase />
    </div>
  );
}
