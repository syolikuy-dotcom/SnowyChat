'use client';

import { useStore } from '@/lib/store';
import { AntiAfkCard } from '../settings/anti-afk-card';
import { AutoCommandsCard } from '../settings/auto-commands-card';
import { AutoSellCard } from '../settings/auto-sell-card';
import { CombatCard } from '../settings/combat-card';
import { ConnectionCard } from '../settings/connection-card';
import { ScheduleCard } from '../settings/schedule-card';
import { WebhookCard } from '../settings/webhook-card';

const ABOUT = [
  ['ENGINE', 'Mineflayer'],
  ['FRAMEWORK', 'Next.js'],
  ['PROTOCOL', 'Socket.IO'],
] as const;

export default function SettingsTab() {
  const sid = useStore((s) => s.activeSid);
  const socketUp = useStore((s) => s.socketUp);

  return (
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-3 sm:p-4">
      {sid ? (
        <>
          <CombatCard />
          <ScheduleCard />
          <AutoSellCard />
          <AntiAfkCard />
          <AutoCommandsCard />
          <WebhookCard />
          <ConnectionCard />
        </>
      ) : (
        <div className="empty">Pilih sesi untuk mengatur fitur bot.</div>
      )}

      <section aria-label="Tentang" className="glass p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="row-label">SnowyChat</p>
            <p className="row-sub">AFK Bot Control · Liquid Glass Edition</p>
          </div>
          <span className="rounded-lg border border-indigo-300/30 bg-indigo-400/20 px-2.5 py-1 font-display text-[10px] font-bold tracking-widest text-indigo-200">v2.0</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {ABOUT.map(([k, v]) => (
            <div key={k} className="glass-subtle p-3">
              <p className="label" style={{ fontSize: 9 }}>{k}</p>
              <p className="mt-0.5 text-xs font-bold tracking-wide text-zinc-300">{v}</p>
            </div>
          ))}
          <div className="glass-subtle p-3">
            <p className="label" style={{ fontSize: 9 }}>REALTIME</p>
            <p className={`mt-0.5 text-xs font-bold tracking-wide ${socketUp ? 'text-emerald-400' : 'text-red-400'}`}>{socketUp ? 'Active' : 'Offline'}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
