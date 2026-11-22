'use client';

import { Menu, Users, X } from 'lucide-react';
import { emit } from '@/lib/socket';
import { openDrawer, useStore } from '@/lib/store';
import type { ConnState } from '@/lib/types';
import { cn } from '@/lib/utils';

const LABEL: Record<ConnState, string> = { offline: 'OFFLINE', connecting: 'CONNECTING', online: 'ONLINE', dead: 'DEAD' };

export function Header() {
  const sid = useStore((s) => s.activeSid);
  const session = useStore((s) => s.sessions.find((x) => x.sessionId === s.activeSid));
  const conn = useStore((s) => (s.activeSid ? (s.conn[s.activeSid] ?? 'offline') : 'offline'));
  const players = useStore((s) => (s.activeSid ? s.info[s.activeSid]?.players.length : undefined));
  const socketUp = useStore((s) => s.socketUp);

  const state: ConnState = socketUp ? conn : 'offline';
  const label = !socketUp ? 'SERVER OFFLINE' : sid ? LABEL[state] : 'NO SESSION';

  return (
    <header className="glass flex shrink-0 items-center gap-3 p-2.5 sm:p-3">
      <button type="button" className="btn btn-icon lg:hidden" onClick={() => openDrawer(true)} aria-label="Buka daftar sesi">
        <Menu size={18} />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className={cn('dot', state)} aria-hidden />
        <div className="min-w-0">
          <h1 className="truncate font-display text-sm font-bold tracking-wide sm:text-base">{session?.username ?? 'SnowyChat'}</h1>
          <p className="label truncate" style={{ fontSize: 9 }}>
            {session ? `${session.host}:${session.port} · ` : ''}
            <span aria-live="polite">{label}</span>
          </p>
        </div>
      </div>
      {players !== undefined && state === 'online' && (
        <div className="flex items-center gap-1.5 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-2.5 py-1.5 text-xs font-bold text-cyan-300" title="Pemain online">
          <Users size={12} />
          {players}
        </div>
      )}
      <button
        type="button"
        className="btn btn-icon"
        disabled={!sid || state === 'offline'}
        onClick={() => sid && emit('mc:disconnect', { sessionId: sid, deleteFromStorage: false })}
        aria-label="Disconnect bot"
        title="Disconnect"
      >
        <X size={16} />
      </button>
    </header>
  );
}
