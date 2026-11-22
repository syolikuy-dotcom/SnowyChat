'use client';

import { useState } from 'react';
import { BellRing } from 'lucide-react';
import { emit } from '@/lib/socket';
import { toast } from '@/lib/store';
import type { WebhookStatus } from '@/lib/types';
import { SettingRow } from '../ui/setting-row';
import { Card, Section, useActiveFeatures } from './common';

export function WebhookCard() {
  const a = useActiveFeatures();
  if (!a) return null;
  const { sid, f } = a;
  return (
    <section aria-label="Discord webhook">
      <Section Icon={BellRing} color="#818cf8" title="Gens Event Watch" />
      <Card>
        <SettingRow Icon={BellRing} color="#818cf8" label="Event Watch" sub="Deteksi event server (Sell/Drop Multiplier, dll.) dan kirim ke Discord" checked={f.webhook.eventWatchEnabled} onChange={(on) => emit('mc:event_watch_toggle', { sessionId: sid, enabled: on })} />
        <Form key={sid + f.webhook.webhookUrl} sid={sid} st={f.webhook} />
      </Card>
    </section>
  );
}

function Form({ sid, st }: { sid: string; st: WebhookStatus }) {
  const [url, setUrl] = useState(st.webhookUrl);
  const valid = (u: string) => !u || /^https:\/\/(?:(?:canary|ptb)\.)?(?:discord|discordapp)\.com\/api\/webhooks\//i.test(u.trim());
  return (
    <div className="space-y-2 px-4 pb-4">
      <label className="label block" htmlFor="wh-url">Discord Webhook URL</label>
      <input id="wh-url" className="input" type="password" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/…" spellCheck={false} />
      <p className="hint">URL disimpan di server (sessions.db) dan tidak ditampilkan di log.</p>
      <div className="flex gap-2">
        <button type="button" className="btn" onClick={() => (url.trim() ? emit('mc:test_webhook', { sessionId: sid, url: url.trim() }) : toast('Isi URL webhook dulu', 'er'))}>Test</button>
        <button type="button" className="btn btn-primary flex-1" onClick={() => (valid(url) ? emit('mc:set_webhook', { sessionId: sid, url: url.trim() }) : toast('Bukan link Discord webhook yang valid', 'er'))}>Save</button>
      </div>
    </div>
  );
}
