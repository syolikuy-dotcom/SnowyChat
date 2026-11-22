// Pengiriman webhook Discord (embed event gens). Semua fetch punya timeout agar
// tidak menggantung selamanya kalau Discord/jaringan tidak merespons.
import { logger } from './logger.mjs';
import { parseWebhookUrl } from './validators.mjs';

const TIMEOUT_MS = 8000;
export const NEXTGENS_IMG_PATH = '/img/nextgens.jpg';

const sanitizeField = (v) => String(v ?? '').replace(/`/g, "'").slice(0, 200);

export function buildGensEmbed({ eventName, action, multiplier, duration, nextIn, username }, publicBaseUrl) {
  const started = action === 'started';
  const name = sanitizeField(eventName);
  const fields = [
    { name: 'Event Name', value: '```' + name + '```', inline: true },
    { name: 'Status', value: '```' + (started ? 'Started' : 'Ended') + '```', inline: true },
  ];
  if (multiplier) fields.push({ name: 'Multiplier', value: '```' + sanitizeField(multiplier) + 'x```', inline: true });
  if (started && duration) fields.push({ name: 'Duration', value: '```' + sanitizeField(duration) + '```', inline: true });
  if (!started && nextIn) fields.push({ name: 'Next Event In', value: '```' + sanitizeField(nextIn) + '```', inline: true });
  return {
    title: started ? '🎉 Event Started!' : '🔴 Event Ended!',
    description: started ? `A **${name}** event is now active on the server!` : `The **${name}** event has ended — back to normal.`,
    color: started ? 0x57f287 : 0xed4245,
    fields,
    thumbnail: { url: `${publicBaseUrl}${NEXTGENS_IMG_PATH}` },
    footer: { text: `NextGens Event Watcher • ${sanitizeField(username || 'SnowyChat')}` },
    timestamp: new Date().toISOString(),
  };
}

async function post(url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export async function sendWebhook(url, payload, label = '') {
  if (!url) return { ok: false, skipped: true };
  const body =
    typeof payload === 'string'
      ? { content: payload.slice(0, 1900) }
      : { content: payload?.content ? String(payload.content).slice(0, 1900) : undefined, embeds: payload?.embeds };
  try {
    const res = await post(url, body);
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      logger.warn('Webhook', `Discord menolak notifikasi ${label} (HTTP ${res.status}): ${detail.slice(0, 200)}`);
      return { ok: false, error: `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    logger.warn('Webhook', `Gagal kirim notifikasi ${label}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

export async function testWebhook(url, label) {
  const parsed = parseWebhookUrl(url, { allowEmpty: false });
  if (!parsed.ok) return { ok: false, error: parsed.error };
  try {
    const res = await post(parsed.value, {
      content: `✅ Test notifikasi dari SnowyChat — sesi \`${sanitizeField(label)}\`. Kalau kamu lihat ini, webhook-nya aktif!`,
    });
    if (res.ok || res.status === 204) return { ok: true };
    let detail = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.message) detail = String(body.message).slice(0, 200);
    } catch {
      /* body bukan JSON */
    }
    return { ok: false, error: detail };
  } catch (e) {
    return { ok: false, error: e.name === 'TimeoutError' ? 'Discord tidak merespons (timeout)' : e.message || 'Gagal konek ke Discord' };
  }
}
