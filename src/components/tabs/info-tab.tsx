'use client';

import { Clock, Crosshair, Globe, MapPin, Mountain, Server, Shield, Users, Utensils, Zap, type LucideIcon } from 'lucide-react';
import { emit } from '@/lib/socket';
import { toast, useStore } from '@/lib/store';
import { cn } from '@/lib/utils';

function Cell({ Icon, color, label, value, mono }: { Icon: LucideIcon; color: string; label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="glass-subtle flex min-w-0 items-center gap-2.5 p-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-xl border" style={{ background: `${color}1a`, borderColor: `${color}33` }}>
        <Icon size={14} color={color} />
      </div>
      <div className="min-w-0">
        <p className="label" style={{ fontSize: 9 }}>
          {label}
        </p>
        <p className={cn('mt-0.5 truncate text-xs font-bold', mono && 'font-mono')} style={{ color }}>
          {value}
        </p>
      </div>
    </div>
  );
}

function Flag({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="glass-subtle flex items-center justify-between gap-2 px-3 py-2.5">
      <span className="label" style={{ fontSize: 9 }}>{label}</span>
      <span className={cn('text-[11px] font-bold', on ? 'text-emerald-400' : 'text-(--dim)')}>{on ? 'ON' : 'OFF'}</span>
    </div>
  );
}

export default function InfoTab() {
  const sid = useStore((s) => s.activeSid);
  const info = useStore((s) => (s.activeSid ? s.info[s.activeSid] : undefined));
  const sat = useStore((s) => (s.activeSid ? s.stats[s.activeSid]?.saturation : undefined));
  const mapPos = useStore((s) => (s.map && s.map.sid === s.activeSid ? s.map.pos : null));
  const entities = useStore((s) => s.entities);

  if (!sid || !info) return <div className="empty">Pilih sesi untuk melihat info bot.</div>;
  const pos = mapPos ?? info.position;
  const dim = String(info.dimension ?? '?').replace('minecraft:', '');

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3 sm:p-4">
      <section className="grid grid-cols-1 gap-2.5 xs:grid-cols-2" aria-label="Detail bot">
        <Cell Icon={Server} color="#6fe8ff" label="SESSION" value={`${sid.slice(0, 8)}…`} mono />
        <Cell Icon={Clock} color="#4ade80" label="UPTIME" value={info.uptime ?? '—'} />
        <Cell Icon={Globe} color="#6fe8ff" label="DIMENSION" value={dim} />
        <Cell Icon={Zap} color="#f9a8d4" label="GAMEMODE" value={String(info.gamemode ?? '?').toUpperCase()} />
        <Cell Icon={MapPin} color="#fbbf24" label="POSITION" value={pos ? `${Math.round(pos.x)} ${Math.round(pos.y)} ${Math.round(pos.z)}` : '—'} mono />
        <Cell Icon={Utensils} color="#fb923c" label="SATURATION" value={(sat ?? info.saturation) !== undefined ? `${Math.round((sat ?? info.saturation) * 10) / 10} / 20` : '—'} />
        <Cell Icon={Mountain} color="#a78bfa" label="STANDING ON" value={info.standingOn ? info.standingOn.replace(/_/g, ' ') : '—'} />
        <Cell Icon={Shield} color={info.onGround ? '#bef264' : '#fbbf24'} label="GROUND STATE" value={info.onGround ? 'Grounded' : 'Airborne'} />
      </section>

      <section aria-label="Status fitur">
        <h2 className="sec-hdr mb-2.5">Features</h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Flag label="AUTO HIT" on={info.autoHit.enabled} />
          <Flag label="AUTO BOW" on={info.autoBow.enabled} />
          <Flag label="RIGHT CLICK" on={info.rightClickMode} />
          <Flag label="CMD SCHEDULE" on={info.commandSchedule.enabled} />
          <Flag label="RECONNECT" on={info.autoReconnect} />
          <Flag label="ANTI-AFK" on={info.antiAfk.enabled} />
        </div>
      </section>

      <section aria-label="Pemain online">
        <h2 className="sec-hdr mb-2.5">
          <Users size={12} /> Players ({info.players.length})
        </h2>
        {info.players.length ? (
          <ul className="grid grid-cols-1 gap-1.5 xs:grid-cols-2">
            {info.players.map((p) => (
              <li key={p.name} className="glass-subtle flex items-center justify-between gap-2 px-3 py-2 text-xs">
                <span className="truncate font-semibold">{p.name}</span>
                <span className="shrink-0 text-(--muted)">{p.ping}ms</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty">Tidak ada data pemain.</div>
        )}
      </section>

      <section aria-label="Entity terdekat">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <h2 className="sec-hdr flex-1">
            <Crosshair size={12} /> Nearby
          </h2>
          <button type="button" className="btn min-h-9 px-3 text-[11px]" onClick={() => emit('mc:get_entities', { sessionId: sid })}>
            Scan
          </button>
        </div>
        {entities.length ? (
          <ul className="flex flex-col gap-1.5">
            {entities.slice(0, 40).map((e) => (
              <li key={e.id} className="glass-subtle flex items-center gap-2 px-3 py-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-semibold">{e.name}</span>
                <span className="text-(--muted)">{e.distance}m</span>
                <button type="button" className="btn btn-danger min-h-8 px-2.5 text-[11px]" onClick={() => { emit('mc:attack', { sessionId: sid, entityId: e.id }); toast('Attack!', 'ok'); }}>
                  Hit
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty">Tekan Scan untuk mencari entity dalam 30 blok.</div>
        )}
      </section>
    </div>
  );
}
