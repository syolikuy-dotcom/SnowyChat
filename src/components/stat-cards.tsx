'use client';

import { Activity, Drumstick, Heart } from 'lucide-react';
import { useStore } from '@/lib/store';
import { pct } from '@/lib/utils';

export function StatCards() {
  const stats = useStore((s) => (s.activeSid ? s.stats[s.activeSid] : undefined));
  const online = useStore((s) => !!s.activeSid && s.conn[s.activeSid] === 'online');
  const dim = useStore((s) => (s.activeSid ? s.info[s.activeSid]?.dimension : undefined));
  const gm = useStore((s) => (s.activeSid ? s.info[s.activeSid]?.gamemode : undefined));

  const hp = online && stats ? stats.health : null;
  const food = online && stats ? stats.food : null;
  const ping = online && stats ? stats.ping : null;
  const dimLabel = dim ? `${String(dim).replace('minecraft:', '')}${gm !== undefined ? ` / ${gm}` : ''}` : '—';

  return (
    <section className="grid shrink-0 grid-cols-[1fr_1fr_auto] gap-2.5 sm:gap-3" aria-label="Status bot">
      <Card title="HP" color="#f87171" Icon={Heart} value={hp === null ? '—' : `${Math.round(hp * 10) / 10} / 20`} bar={hp === null ? 0 : pct(hp, 20)} />
      <Card title="FOOD" color="#fb923c" Icon={Drumstick} value={food === null ? '—' : `${food} / 20`} bar={food === null ? 0 : pct(food, 20)} />
      <div className="glass relative flex min-w-[76px] flex-col justify-center overflow-hidden px-3 py-2.5">
        <div className="absolute inset-x-0 top-0 h-0.5 bg-linear-to-r from-emerald-500 to-emerald-400" />
        <p className="label flex items-center gap-1" style={{ fontSize: 9 }}>
          <Activity size={10} /> PING
        </p>
        <p className="mt-0.5 text-sm font-black text-emerald-400">{ping === null ? '—' : `${ping}ms`}</p>
        <p className="truncate text-[9px] text-(--dim)" title={dimLabel}>
          {dimLabel}
        </p>
      </div>
    </section>
  );
}

function Card({ title, color, Icon, value, bar }: { title: string; color: string; Icon: typeof Heart; value: string; bar: number }) {
  return (
    <div className="glass relative flex min-w-0 items-center gap-2.5 overflow-hidden px-3 py-2.5">
      <div className="absolute inset-x-0 top-0 h-0.5" style={{ background: color }} />
      <div className="grid size-8 shrink-0 place-items-center rounded-xl border" style={{ background: `${color}1a`, borderColor: `${color}33` }}>
        <Icon size={14} color={color} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="label" style={{ fontSize: 9 }}>
          {title}
        </p>
        <p className="mt-0.5 truncate text-sm font-black" style={{ color }}>
          {value}
        </p>
        <div className="stat-bar" role="progressbar" aria-label={title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(bar)}>
          <i style={{ width: `${bar}%`, background: color }} />
        </div>
      </div>
    </div>
  );
}
