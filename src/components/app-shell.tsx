'use client';

import dynamic from 'next/dynamic';
import { useSocketBridge } from '@/lib/use-socket-bridge';
import { useStore } from '@/lib/store';
import { AuthGate } from './auth-gate';
import { BottomNav } from './bottom-nav';
import { ChatTab } from './tabs/chat-tab';
import { Header } from './header';
import { SessionsPanel } from './sessions-panel';
import { StatCards } from './stat-cards';
import { ToastHost } from './ui/toast-host';

// Tab berat dipecah jadi chunk terpisah: hanya diunduh saat pertama kali dibuka.
const TabFallback = () => <div className="empty">Loading…</div>;
const InfoTab = dynamic(() => import('./tabs/info-tab'), { loading: TabFallback });
const InventoryTab = dynamic(() => import('./tabs/inventory-tab'), { loading: TabFallback });
const MapTab = dynamic(() => import('./tabs/map-tab'), { loading: TabFallback });
const SettingsTab = dynamic(() => import('./tabs/settings-tab'), { loading: TabFallback });
const MobileDrawer = dynamic(() => import('./mobile-drawer'));
const EditSessionModal = dynamic(() => import('./edit-session-modal'));

export function AppShell() {
  useSocketBridge();
  const tab = useStore((s) => s.tab);
  const drawerOpen = useStore((s) => s.drawerOpen);
  const editing = useStore((s) => s.editingSid);

  return (
    <div className="relative flex h-dvh w-full overflow-hidden">
      <div className="bg-mesh" aria-hidden>
        <i />
        <i />
        <i />
      </div>

      {/* ≥1024px: panel sesi menempel di kiri. <1024px: drawer. */}
      <aside className="relative z-10 hidden w-80 shrink-0 flex-col border-r border-white/10 bg-black/25 backdrop-blur-xl lg:flex xl:w-96" aria-label="Sessions">
        <SessionsPanel />
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <div className="mx-auto flex h-full w-full max-w-3xl min-w-0 flex-col gap-3 px-3 pt-[max(var(--safe-t),12px)] sm:px-5 lg:max-w-4xl">
          <Header />
          <StatCards />
          <main id="main" className="glass flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className={tab === 'chat' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <ChatTab />
            </div>
            {tab === 'info' && <InfoTab />}
            {tab === 'inv' && <InventoryTab />}
            {tab === 'map' && <MapTab />}
            {tab === 'settings' && <SettingsTab />}
          </main>
          <BottomNav />
        </div>
      </div>

      {drawerOpen && <MobileDrawer />}
      {editing && <EditSessionModal sid={editing} />}
      <AuthGate />
      <ToastHost />
    </div>
  );
}
