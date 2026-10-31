import type { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Mot dong muc checklist co the keo sap xep (tay cam la bieu tuong luoi hien khi ro chuot)
export function SortableItem({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : undefined,
      }}
      className="group relative flex items-center gap-2"
    >
      {!disabled && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          title="Kéo để sắp xếp"
          className="-ml-4 shrink-0 cursor-grab touch-none rounded p-0.5 text-slate-300 dark:text-slate-600 opacity-0 hover:bg-slate-200 dark:hover:bg-slate-600 group-hover:opacity-100"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
            <circle cx="9" cy="6" r="1.5" />
            <circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" />
            <circle cx="15" cy="18" r="1.5" />
          </svg>
        </button>
      )}
      {children}
    </div>
  );
}
