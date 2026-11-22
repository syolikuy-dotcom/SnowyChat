'use client';

import { useState } from 'react';
import { Coins } from 'lucide-react';
import { emit } from '@/lib/socket';
import type { AutoSellConfig } from '@/lib/types';
import { SettingRow } from '../ui/setting-row';
import { Card, Section, useActiveFeatures } from './common';

const DEFAULTS: AutoSellConfig = { command: '/selldrops all', triggerMode: 'both', inventoryThresholdPercent: 80, cooldownMs: 5000, eventKeyword: 'sell' };

export function AutoSellCard() {
  const a = useActiveFeatures();
  if (!a) return null;
  const { sid, f } = a;
  const cfg = { ...DEFAULTS, ...f.autoSell.config };
  return (
    <section aria-label="Auto sell">
      <Section Icon={Coins} color="#fbbf24" title="Auto Sell" />
      <Card>
        <SettingRow Icon={Coins} color="#fbbf24" label="Auto Sell" sub="Jual otomatis saat inventory penuh dan/atau event Sell dimulai" checked={f.autoSell.enabled} onChange={(on) => emit('mc:auto_sell_enable', { sessionId: sid, enabled: on })} />
        <Form key={sid + JSON.stringify(cfg)} sid={sid} cfg={cfg} />
      </Card>
    </section>
  );
}

function Form({ sid, cfg }: { sid: string; cfg: AutoSellConfig }) {
  const [c, setC] = useState(cfg);
  const set = <K extends keyof AutoSellConfig>(k: K, v: AutoSellConfig[K]) => setC((p) => ({ ...p, [k]: v }));
  return (
    <div className="space-y-3 px-4 pb-4">
      <div>
        <label className="label mb-1 block" htmlFor="as-cmd">Sell command</label>
        <input id="as-cmd" className="input" value={c.command} onChange={(e) => set('command', e.target.value)} maxLength={100} autoCapitalize="none" spellCheck={false} />
      </div>
      <div className="grid grid-cols-1 gap-2 xs:grid-cols-2">
        <div>
          <label className="label mb-1 block" htmlFor="as-mode">Trigger</label>
          <select id="as-mode" className="input" value={c.triggerMode} onChange={(e) => set('triggerMode', e.target.value as AutoSellConfig['triggerMode'])}>
            <option value="both">Inventory + Event</option>
            <option value="inventory">Inventory saja</option>
            <option value="event">Event saja</option>
          </select>
        </div>
        <div>
          <label className="label mb-1 block" htmlFor="as-kw">Event keyword</label>
          <input id="as-kw" className="input" value={c.eventKeyword} onChange={(e) => set('eventKeyword', e.target.value)} maxLength={40} />
        </div>
        <div>
          <label className="label mb-1 block" htmlFor="as-th">Inventory ≥ (%)</label>
          <input id="as-th" className="input" type="number" inputMode="numeric" min={10} max={100} value={c.inventoryThresholdPercent} onChange={(e) => set('inventoryThresholdPercent', Number(e.target.value))} />
        </div>
        <div>
          <label className="label mb-1 block" htmlFor="as-cd">Cooldown (detik)</label>
          <input id="as-cd" className="input" type="number" inputMode="numeric" min={1} max={300} value={Math.round(c.cooldownMs / 1000)} onChange={(e) => set('cooldownMs', Number(e.target.value) * 1000)} />
        </div>
      </div>
      <button type="button" className="btn btn-primary w-full" onClick={() => emit('mc:auto_sell_set_config', { sessionId: sid, config: c })}>Save</button>
    </div>
  );
}
