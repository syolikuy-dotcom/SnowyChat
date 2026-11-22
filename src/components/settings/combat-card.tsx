'use client';

import { Hand, Swords, Target } from 'lucide-react';
import { emit } from '@/lib/socket';
import { patchFeatures } from '@/lib/store';
import { SettingRow, SliderRow } from '../ui/setting-row';
import { Card, Section, useActiveFeatures } from './common';

export function CombatCard() {
  const a = useActiveFeatures();
  if (!a) return null;
  const { sid, f } = a;
  return (
    <section aria-label="Combat">
      <Section Icon={Swords} color="#f87171" title="Combat" />
      <Card>
        <SettingRow
          Icon={Swords} color="#f87171" label="Auto Hit"
          sub={f.autoHit.armed && !f.autoHit.enabled ? 'Armed — menyala saat bot siap' : <>Melee mob terdekat · <span className="text-emerald-400">persisten setelah mati</span></>}
          checked={f.autoHit.enabled || !!f.autoHit.armed}
          onChange={(on) => {
            patchFeatures(sid, { autoHit: { ...f.autoHit, enabled: on, armed: false } });
            emit(on ? 'mc:auto_hit_start' : 'mc:auto_hit_stop', { sessionId: sid, delay: f.autoHit.delay });
          }}
        />
        <SliderRow
          label={f.rightClick ? 'Interval' : 'Attack Delay'} value={f.autoHit.delay} unit="ms" min={10} max={1500} step={10}
          hint={f.rightClick ? '// Right-click mode: interval antar interaksi.' : '// Attack mode: minimal 300ms disarankan agar tidak kena anti-cheat.'}
          onCommit={(delay) => emit('mc:auto_hit_delay', { sessionId: sid, delay })}
        />
        <SettingRow
          Icon={Hand} color="#60a5fa" label="Right-Click Mode" sub="Interaksi, bukan serang · berry, pintu, pot"
          checked={f.rightClick}
          onChange={(on) => { patchFeatures(sid, { rightClick: on }); emit('mc:right_click_mode', { sessionId: sid, enabled: on }); }}
        />
      </Card>
      <div className="h-3" />
      <Card>
        <SettingRow
          Icon={Target} color="#fbbf24" label="Auto Bow" sub={<>Serangan jarak jauh · pegang bow · <span className="text-emerald-400">persisten setelah mati</span></>}
          checked={f.autoBow.enabled}
          onChange={(on) => emit(on ? 'mc:auto_bow_start' : 'mc:auto_bow_stop', { sessionId: sid, range: f.autoBow.range })}
        />
        <SliderRow label="Bow Range" value={f.autoBow.range} unit="blk" min={3} max={5} step={1} onCommit={(range) => emit('mc:auto_bow_range', { sessionId: sid, range })} />
      </Card>
    </section>
  );
}
