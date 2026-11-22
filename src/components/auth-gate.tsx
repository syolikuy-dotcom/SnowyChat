'use client';

import { useState } from 'react';
import { Lock } from 'lucide-react';
import { setToken } from '@/lib/socket';
import { useStore } from '@/lib/store';

export function AuthGate() {
  const failed = useStore((s) => s.authFailed);
  const [value, setValue] = useState('');
  if (!failed) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setToken(value.trim());
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <form onSubmit={submit} className="glass w-full max-w-sm space-y-4 p-6">
        <div className="flex items-center gap-3">
          <div className="row-icon" style={{ background: 'rgba(255,110,142,0.12)' }}>
            <Lock size={16} className="text-pink" />
          </div>
          <div>
            <h2 id="auth-title" className="text-base font-bold">
              Access token diperlukan
            </h2>
            <p className="row-sub">Server ini dilindungi ACCESS_TOKEN.</p>
          </div>
        </div>
        <input className="input" type="password" autoComplete="current-password" placeholder="Token" value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        <button className="btn btn-primary w-full" type="submit" disabled={!value.trim()}>
          Masuk
        </button>
      </form>
    </div>
  );
}
