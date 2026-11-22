'use client';

import { useState } from 'react';
import { Gamepad2 } from 'lucide-react';
import { emit } from '@/lib/socket';
import { toast } from '@/lib/store';
import type { AntiAfkStatus } from '@/lib/types';
import { SettingRow } from '../ui/setting-row';
import { Card, Section, useActiveFeatures } from './common';

export function AntiAfkCard() {
  const a = useActiveFeatures();
  if (!a) return null;
  const { sid, f } = a;
  return (
    <section aria-label="Anti AFK">
      <Section Icon={Gamepad2} color="#34d399" title="Anti-AFK" />
      <Card>
        <Body key={sid + f.antiAfk.minIntervalSec + '-' + f.antiAfk.maxIntervalSec} sid={sid} st={f.antiAfk} />
      </Card>
    </section>
  );
}

function Body({ sid, st }: { sid: string; st: AntiAfkStatus }) {
  const [min, setMin] = useState(st.minIntervalSec);
  const [max, setMax] = useState(st.maxIntervalSec);
  const start = (on: boolean) => {
    if (on && min > max) return toast('Minimum tidak boleh lebih besar dari maksimum', 'er');
    emit(on ? 'mc:anti_afk_start' : 'mc:anti_afk_stop', { sessionId: sid, minIntervalSec: min, maxIntervalSec: max });
  };
  return (
    <>
      <SettingRow Icon={Gamepad2} color="#34d399" label="Anti-AFK" sub="Gerakan kecil acak (look/jump/sneak/swing) tanpa pindah posisi" checked={st.enabled} onChange={start} />
      <div className="grid grid-cols-2 gap-2 px-4 pb-4">
        <div>
          <label className="label mb-1 block" htmlFor="afk-min">Min (detik)</label>
          <input id="afk-min" className="input" type="number" inputMode="numeric" min={5} max={300} value={min} onChange={(e) => setMin(Number(e.target.value))} />
        </div>
        <div>
          <label className="label mb-1 block" htmlFor="afk-max">Max (detik)</label>
          <input id="afk-max" className="input" type="number" inputMode="numeric" min={5} max={600} value={max} onChange={(e) => setMax(Number(e.target.value))} />
        </div>
        {st.enabled && (
          <button type="button" className="btn col-span-2" onClick={() => start(true)}>Terapkan interval baru</button>
        )}
      </div>
    </>
  );
}
