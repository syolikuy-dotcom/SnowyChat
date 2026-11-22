'use client';

import { Backpack, Cog, Info, Map as MapIcon, MessageSquare } from 'lucide-react';
import { setTab, useStore } from '@/lib/store';
import type { TabId } from '@/lib/types';

const TABS: { id: TabId; label: string; Icon: typeof Info }[] = [
  { id: 'chat', label: 'CHAT', Icon: MessageSquare },
  { id: 'info', label: 'INFO', Icon: Info },
  { id: 'inv', label: 'INV', Icon: Backpack },
  { id: 'map', label: 'MAP', Icon: MapIcon },
  { id: 'settings', label: 'SETTINGS', Icon: Cog },
];

export function BottomNav() {
  const tab = useStore((s) => s.tab);
  return (
    <nav className="shrink-0 pb-[max(var(--safe-b),12px)]" aria-label="Navigasi utama">
      <div className="glass flex items-center justify-around gap-1 p-1.5" style={{ borderRadius: 20, background: 'rgba(10,11,16,0.78)' }}>
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} type="button" className="nav-btn" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
            <Icon size={20} strokeWidth={2} />
            <span className="nav-label">{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
