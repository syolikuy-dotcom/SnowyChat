'use client';

import { useEffect } from 'react';
import { openDrawer } from '@/lib/store';
import { SessionsPanel } from './sessions-panel';

export default function MobileDrawer() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openDrawer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div className="drawer-scrim lg:hidden" onClick={() => openDrawer(false)} aria-hidden />
      <aside className="drawer lg:hidden" role="dialog" aria-modal="true" aria-label="Sessions">
        <SessionsPanel inDrawer />
      </aside>
    </>
  );
}
