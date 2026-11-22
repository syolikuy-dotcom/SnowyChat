// Validasi & normalisasi semua input dari klien. Semua fungsi mengembalikan
// { ok: true, value } atau { ok: false, error } dan TIDAK PERNAH melempar.
export const SESSION_ID_RE = /^[a-f0-9]{16,64}$/i;
export const HOST_RE = /^[a-zA-Z0-9.\-_]{1,253}$/;
export const VERSION_RE = /^\d{1,2}\.\d{1,2}(\.\d{1,2})?$/;
export const CONTROLS = ['forward', 'back', 'left', 'right', 'jump', 'sneak', 'sprint'];
export const EQUIP_DESTINATIONS = ['hand', 'head', 'torso', 'legs', 'feet', 'off-hand'];
export const AUTH_MODES = ['offline'];

const ok = (value) => ({ ok: true, value });
const fail = (error) => ({ ok: false, error });

export const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function clampInt(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

export function toBool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function parseSessionId(value) {
  if (typeof value !== 'string' || !SESSION_ID_RE.test(value)) return fail('Invalid session id');
  return ok(value.toLowerCase());
}

export function parseUsername(value) {
  if (typeof value !== 'string') return fail('Username must be a string');
  const v = value.trim();
  if (v.length < 3 || v.length > 16) return fail('Username must be 3–16 chars');
  if (!/^[A-Za-z0-9_.\-]+$/.test(v)) return fail('Username may only contain letters, numbers, underscore, dot and dash');
  return ok(v);
}

export function parseHost(value) {
  if (typeof value !== 'string') return fail('Host and username required');
  const v = value.trim();
  if (!v) return fail('Host and username required');
  if (!HOST_RE.test(v)) return fail('Invalid host format');
  return ok(v);
}

export function parsePort(value, fallback = 25565) {
  if (value === undefined || value === null || value === '') return ok(fallback);
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n < 1 || n > 65535) return fail('Invalid port (must be 1–65535)');
  return ok(n);
}

// Versi kosong/undefined => null (deteksi otomatis oleh mineflayer).
export function parseVersion(value) {
  if (value === undefined || value === null) return ok(null);
  if (typeof value !== 'string') return fail('Invalid version format');
  const v = value.trim();
  if (!v || v.toLowerCase() === 'auto') return ok(null);
  if (!VERSION_RE.test(v)) return fail(`Invalid version format: ${v}`);
  return ok(v);
}

export function parseAuth(value) {
  if (value === undefined || value === null || value === '') return ok('offline');
  if (typeof value !== 'string' || !AUTH_MODES.includes(value)) return fail(`Unsupported auth mode (allowed: ${AUTH_MODES.join(', ')})`);
  return ok(value);
}

export function parseChatMessage(value) {
  if (typeof value !== 'string') return fail('Message must be text');
  const v = value.trim();
  if (!v) return fail('Message is empty');
  if (v.length > 256) return fail('Message too long (max 256 chars)');
  // Karakter kontrol tidak valid untuk chat Minecraft dan bisa memicu kick.
  if (/[\u0000-\u001f\u007f]/.test(v)) return fail('Message contains invalid characters');
  return ok(v);
}

export function parseControl(value) {
  return CONTROLS.includes(value) ? ok(value) : fail(`Invalid control: ${String(value).slice(0, 20)}`);
}

export function parseDestination(value) {
  return EQUIP_DESTINATIONS.includes(value) ? ok(value) : fail('Invalid destination');
}

export function parseSlot(value, min = 0, max = 45) {
  const n = clampInt(value, -1, 1e6, NaN);
  if (!Number.isInteger(n) || n < min || n > max) return fail(`Slot must be ${min}-${max}`);
  return ok(n);
}

export function parseCount(value) {
  if (value === undefined || value === null || value === '') return ok(null);
  const n = clampInt(value, 1, 64 * 64, NaN);
  return Number.isInteger(n) ? ok(n) : fail('Invalid count');
}

export function parseItemName(value) {
  if (typeof value !== 'string' || !/^[a-z0-9_:]{1,80}$/i.test(value)) return fail('Invalid item name');
  return ok(value);
}

export function parseEntityId(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? ok(n) : fail('Invalid entity id');
}

export const DISCORD_WEBHOOK_RE = /^https:\/\/(?:(?:canary|ptb)\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+\/?(?:\?[\w=&%-]*)?$/i;

export function parseWebhookUrl(value, { allowEmpty = true } = {}) {
  const v = String(value ?? '').trim();
  if (!v) return allowEmpty ? ok('') : fail('Isi dulu URL webhook-nya');
  if (v.length > 300 || !DISCORD_WEBHOOK_RE.test(v)) {
    return fail('Harus link Discord webhook yang valid (https://discord.com/api/webhooks/...)');
  }
  return ok(v);
}

export function parseCommandList(value, { withDelay }) {
  const list = Array.isArray(value) ? value : [];
  const out = [];
  for (const c of list.slice(0, 10)) {
    if (!isPlainObject(c)) continue;
    const cmd = String(c.cmd ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 256).trim();
    if (!cmd) continue;
    if (withDelay) out.push({ cmd, delay: clampInt(c.delay, 0, 30000, 0) });
    else out.push({ cmd, intervalMs: clampInt(Math.round(Number(c.intervalMs)), 5000, 86_400_000, 60_000) });
  }
  return out;
}
