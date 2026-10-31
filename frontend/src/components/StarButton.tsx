interface Props {
  starred: boolean;
  onToggle: () => void;
  className?: string;
}

// Nut danh dau sao dung chung (the bang, header bang).
export default function StarButton({ starred, onToggle, className = '' }: Props) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      aria-label={starred ? 'Bỏ đánh dấu sao' : 'Đánh dấu sao'}
      title={starred ? 'Bỏ đánh dấu sao' : 'Đánh dấu sao'}
      className={`transition-transform hover:scale-110 ${
        starred ? 'text-amber-400' : 'text-slate-400 hover:text-amber-400'
      } ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-4 w-4"
        fill={starred ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      >
        <path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.8 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" />
      </svg>
    </button>
  );
}
