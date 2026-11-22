'use client';

import type { LucideIcon } from 'lucide-react';
import { defaultFeatures, useStore } from '@/lib/store';
import type { FeatureState } from '@/lib/types';

/** Sesi aktif + status fiturnya; null bila belum ada sesi. */
export function useActiveFeatures(): { sid: string; f: FeatureState; online: boolean } | null {
  const sid = useStore((s) => s.activeSid);
  const f = useStore((s) => (s.activeSid ? s.features[s.activeSid] : undefined));
  const online = useStore((s) => !!s.activeSid && s.conn[s.activeSid] === 'online');
  if (!sid) return null;
  return { sid, f: f ?? defaultFeatures(), online };
}

export function Section({ Icon, color, title }: { Icon: LucideIcon; color: string; title: string }) {
  return (
    <div className="mb-2.5 mt-1 flex items-center gap-2">
      <div className="grid size-6 place-items-center rounded-lg border" style={{ background: `${color}1a`, borderColor: `${color}33` }}>
        <Icon size={11} color={color} strokeWidth={2.5} />
      </div>
      <h2 className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color }}>
        {title}
      </h2>
      <div className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${color}4d, transparent)` }} />
    </div>
  );
}

export function Card({ children }: { children: React.ReactNode }) {
  return <div className="glass overflow-hidden">{children}</div>;
}
