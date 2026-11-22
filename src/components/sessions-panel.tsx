'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, Plus, Radio, Trash2, Wifi, X } from 'lucide-react';
import { emit, getSocket } from '@/lib/socket';
import { getState, openDrawer, selectSession, setState, toast, useStore } from '@/lib/store';
import type { SessionSummary } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Isi daftar sesi — dipakai di sidebar (desktop) dan drawer (mobile). */
export function SessionsPanel({ inDrawer = false }: { inDrawer?: boolean }) {
  const [pane, setPane] = useState<'list' | 'new'>('list');
  const dbOk = useStore((s) => (s.dbHealth ? s.dbHealth.ready && s.dbHealth.lastFlushOk !== false && s.dbHealth.lastIntegrityCheckOk !== false : true));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-white/10 bg-linear-to-br from-pink/10 to-rose/5 p-4 pt-[max(var(--safe-t),16px)]">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-bold tracking-widest">Sessions</h2>
            <p className="label mt-1 flex items-center gap-1.5">
              SnowyChat Control
              <span className="dot" style={{ background: dbOk ? '#4ade80' : '#f87171', width: 6, height: 6 }} title={dbOk ? 'Database OK' : 'Database bermasalah'} />
            </p>
          </div>
          {inDrawer && (
            <button type="button" className="btn btn-icon" onClick={() => openDrawer(false)} aria-label="Tutup">
              <X size={16} />
            </button>
          )}
        </div>
        <PingBox />
        <div className="mt-3 grid grid-cols-2 gap-2" role="tablist">
          <button type="button" role="tab" aria-selected={pane === 'list'} className={cn('btn', pane === 'list' && 'btn-primary')} onClick={() => setPane('list')}>
            Sessions
          </button>
          <button type="button" role="tab" aria-selected={pane === 'new'} className={cn('btn', pane === 'new' && 'btn-primary')} onClick={() => setPane('new')}>
            <Plus size={14} /> New Bot
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 pb-[max(var(--safe-b),12px)]">
        {pane === 'list' ? <SessionList /> : <NewBotForm onDone={() => setPane('list')} />}
      </div>
    </div>
  );
}

function PingBox() {
  const [host, setHost] = useState('');
  const ping = useStore((s) => s.ping);
  const pinging = useStore((s) => s.pinging);

  const run = () => {
    const [h, p] = host.trim().split(':');
    if (!h) return toast('Isi host dulu', 'er');
    setState({ pinging: true, ping: null });
    emit('mc:ping', { host: h, port: p ? Number(p) : 25565 });
    setTimeout(() => getState().pinging && setState({ pinging: false, ping: { ok: false, error: 'Timeout' } }), 9000);
  };

  return (
    <div className="glass-subtle p-3">
      <label className="label mb-2 block" htmlFor="ping-host">
        Ping Server
      </label>
      <div className="flex gap-2">
        <input id="ping-host" className="input" placeholder="mc.server.com[:port]" value={host} onChange={(e) => setHost(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        <button type="button" className="btn" onClick={run} disabled={pinging}>
          {pinging ? '…' : 'Ping'}
        </button>
      </div>
      {ping && (
        <p className="mt-2 text-xs leading-relaxed" style={{ color: ping.ok ? '#6ee9ac' : '#ff8da1' }} aria-live="polite">
          {ping.ok ? `${ping.motd || '(no motd)'} · ${ping.players}/${ping.maxPlayers} players · ${ping.version}` : ping.error}
        </p>
      )}
    </div>
  );
}

function SessionList() {
  const sessions = useStore((s) => s.sessions);
  const activeSid = useStore((s) => s.activeSid);
  const conn = useStore((s) => s.conn);

  if (!sessions.length) return <div className="empty">No sessions yet.<br />Buat bot baru lewat tab “New Bot”.</div>;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="mb-1 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-success" onClick={() => emit('mc:connect_all')}>
          <Wifi size={13} /> Connect All
        </button>
        <button type="button" className="btn btn-danger" onClick={() => emit('mc:disconnect_all')}>
          Disconnect All
        </button>
      </div>
      {sessions.map((s) => (
        <SessionItem key={s.sessionId} s={s} active={s.sessionId === activeSid} state={s.connected ? 'online' : (conn[s.sessionId] === 'connecting' ? 'connecting' : 'offline')} />
      ))}
    </div>
  );
}

function SessionItem({ s, active, state }: { s: SessionSummary; active: boolean; state: 'online' | 'connecting' | 'offline' }) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm]);

  const open = () => {
    selectSession(s.sessionId);
    if (!s.connected && state === 'offline') emit('mc:reconnect', { sessionId: s.sessionId });
  };

  return (
    <div className="flex items-stretch gap-1.5">
      <button type="button" className="sess-item min-w-0 flex-1" aria-current={active} onClick={open}>
        <div className="flex items-center gap-2">
          <span className={cn('dot', state)} />
          <span className="truncate text-sm font-bold">{s.username}</span>
          {s.autoHitEnabled && <span title="Auto Hit" className="text-xs">⚔️</span>}
          {s.antiAfkEnabled && <span title="Anti-AFK" className="text-xs">🕹</span>}
        </div>
        <p className="mt-1 truncate text-[11px] text-(--muted)">
          {s.host}:{s.port}
          {s.version ? ` · ${s.version}` : ' · auto'}
          {s.uptime ? ` · ${s.uptime}` : ''}
        </p>
      </button>
      <div className="flex flex-col gap-1.5">
        <button type="button" className="btn btn-icon sm" onClick={() => setState({ editingSid: s.sessionId })} aria-label={`Edit ${s.username}`} title="Edit">
          <Pencil size={13} />
        </button>
        <button
          type="button"
          className={cn('btn btn-icon sm', confirm && 'btn-danger')}
          aria-label={confirm ? 'Klik lagi untuk menghapus' : `Hapus ${s.username}`}
          title={confirm ? 'Klik lagi untuk hapus' : 'Hapus'}
          onClick={() => (confirm ? emit('mc:disconnect', { sessionId: s.sessionId, deleteFromStorage: true }) : setConfirm(true))}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function NewBotForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ username: '', host: '', port: '25565', version: '' });
  const [avail, setAvail] = useState<boolean | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const check = useCallback((next: typeof f) => {
    clearTimeout(timer.current);
    if (next.username.length < 3 || !next.host) return setAvail(null);
    timer.current = setTimeout(() => {
      getSocket().emit('mc:check_username', { username: next.username, host: next.host, port: Number(next.port) || 25565 }, (r: { available?: boolean }) => setAvail(r?.available ?? null));
    }, 350);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = { ...f, [k]: e.target.value };
    setF(next);
    setAvail(null);
    check(next);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const username = f.username.trim();
    const host = f.host.trim();
    if (username.length < 3 || username.length > 16) return toast('Username harus 3–16 karakter', 'er');
    if (!host) return toast('Isi alamat server', 'er');
    emit('mc:connect', { host, port: Number(f.port) || 25565, username, version: f.version.trim() || undefined, persistent: true });
    setF({ username: '', host: f.host, port: f.port, version: f.version });
    onDone();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field label="Username" id="nb-user">
        <input id="nb-user" className="input" maxLength={16} value={f.username} onChange={set('username')} placeholder="3–16 karakter" autoComplete="off" autoCapitalize="none" spellCheck={false} required />
      </Field>
      <Field label="Server IP" id="nb-host">
        <input id="nb-host" className="input" value={f.host} onChange={set('host')} placeholder="mc.server.com" autoComplete="off" autoCapitalize="none" spellCheck={false} required />
      </Field>
      <div className="grid grid-cols-[1fr_1.4fr] gap-2">
        <Field label="Port" id="nb-port">
          <input id="nb-port" className="input" inputMode="numeric" value={f.port} onChange={set('port')} />
        </Field>
        <Field label="Version" id="nb-ver">
          <input id="nb-ver" className="input" value={f.version} onChange={set('version')} placeholder="auto" />
        </Field>
      </div>
      {avail === false && <p className="text-xs text-red-300">Username sudah dipakai di server ini.</p>}
      <p className="hint">Kosongkan Version agar terdeteksi otomatis dari server.</p>
      <button type="submit" className="btn btn-primary w-full">
        <Radio size={14} /> Create Bot
      </button>
    </form>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={id} className="label mb-1 block">
        {label}
      </label>
      {children}
    </div>
  );
}
