'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { emit } from '@/lib/socket';
import { setState, useStore } from '@/lib/store';

const close = () => setState({ editingSid: null });

export default function EditSessionModal({ sid }: { sid: string }) {
  const session = useStore((s) => s.sessions.find((x) => x.sessionId === sid));
  const [f, setF] = useState({ username: session?.username ?? '', host: session?.host ?? '', port: String(session?.port ?? 25565), version: session?.version ?? '' });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!session) return null;
  const locked = session.connected;
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    emit('mc:update_session', { sessionId: sid, username: f.username, host: f.host, port: Number(f.port), version: f.version.trim() });
    close();
  };

  return (
    <div className="fixed inset-0 z-[70] grid place-items-center bg-black/65 p-4 backdrop-blur-sm" onClick={close} role="presentation">
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="glass w-full max-w-sm space-y-3 p-5" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <div className="flex items-center justify-between">
          <h2 id="edit-title" className="text-sm font-bold tracking-wider">
            Edit Session
          </h2>
          <button type="button" className="btn btn-icon sm" onClick={close} aria-label="Tutup">
            <X size={14} />
          </button>
        </div>
        {(['username', 'host'] as const).map((k) => (
          <div key={k}>
            <label className="label mb-1 block" htmlFor={`e-${k}`}>
              {k === 'username' ? 'Bot Name' : 'Server IP'}
            </label>
            <input id={`e-${k}`} className="input" value={f[k]} onChange={set(k)} maxLength={k === 'username' ? 16 : 253} disabled={locked} autoCapitalize="none" spellCheck={false} />
          </div>
        ))}
        <div className="grid grid-cols-[1fr_1.4fr] gap-2">
          <div>
            <label className="label mb-1 block" htmlFor="e-port">Port</label>
            <input id="e-port" className="input" inputMode="numeric" value={f.port} onChange={set('port')} disabled={locked} />
          </div>
          <div>
            <label className="label mb-1 block" htmlFor="e-ver">Version</label>
            <input id="e-ver" className="input" value={f.version} onChange={set('version')} placeholder="auto" disabled={locked} />
          </div>
        </div>
        <p className="hint">{locked ? 'Disconnect bot dulu sebelum mengubah pengaturan koneksi.' : 'Kosongkan Version untuk deteksi otomatis.'}</p>
        <button type="submit" className="btn btn-primary w-full" disabled={locked}>
          Save
        </button>
      </form>
    </div>
  );
}
