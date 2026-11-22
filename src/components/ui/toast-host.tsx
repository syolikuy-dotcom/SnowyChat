'use client';

import { useStore } from '@/lib/store';

export function ToastHost() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[max(var(--safe-t),12px)] z-[500] flex flex-col items-center gap-2 px-3 sm:items-end sm:px-5">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
