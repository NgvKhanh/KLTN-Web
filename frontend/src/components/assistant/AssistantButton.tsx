import { useAssistant } from '../../context/AssistantContext';

/** Nut "Trợ lý" tren Header (giua "Tạo mới" va chuong thong bao): mo / dong panel ben phai. */
export default function AssistantButton() {
  const { open, togglePanel } = useAssistant();
  return (
    <button
      type="button"
      onClick={togglePanel}
      aria-label="Trợ lý"
      aria-expanded={open}
      title="Trợ lý công việc"
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-sm font-medium transition sm:px-3 ${
        open
          ? 'bg-primary/10 text-primary-ink'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" />
        <path d="M8.5 11h.01M12 11h.01M15.5 11h.01" strokeLinecap="round" />
      </svg>
      <span className="hidden md:inline">Trợ lý</span>
    </button>
  );
}
