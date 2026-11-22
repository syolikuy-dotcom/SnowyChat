'use client';

import { HeartPulse, RefreshCcw, Wifi } from 'lucide-react';
import { emit } from '@/lib/socket';
import { patchFeatures, toast } from '@/lib/store';
import { SettingRow, SliderRow } from '../ui/setting-row';
import { Card, Section, useActiveFeatures } from './common';

export function ConnectionCard() {
  const a = useActiveFeatures();
  if (!a) return null;
  const { sid, f } = a;
  return (
    <section aria-label="Koneksi">
      <Section Icon={Wifi} color="#6fe8ff" title="Connection" />
      <Card>
        <SettingRow
          Icon={HeartPulse} color="#f472b6" label="Auto Respawn" sub="Respawn otomatis 2 detik setelah mati" checked={f.autoRespawn}
          onChange={(on) => { patchFeatures(sid, { autoRespawn: on }); emit('mc:auto_respawn', { sessionId: sid, enabled: on }); toast(`Auto Respawn ${on ? 'on' : 'off'}`, 'info'); }}
        />
        <SettingRow
          Icon={RefreshCcw} color="#34d399" label="Auto Reconnect" sub="Sambung ulang otomatis bila terputus / server restart" checked={f.autoReconnect}
          onChange={(on) => { patchFeatures(sid, { autoReconnect: on }); emit('mc:set_auto_reconnect', { sessionId: sid, enabled: on }); }}
        />
        <SliderRow label="Render Distance" value={f.renderDistance} unit="chunks" min={2} max={5} step={1} hint="// Lebih kecil = hemat RAM & bandwidth untuk bot AFK." onCommit={(distance) => emit('mc:set_render_distance', { sessionId: sid, distance })} />
      </Card>
    </section>
  );
}
