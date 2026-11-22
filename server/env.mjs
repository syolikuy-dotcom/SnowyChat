// Loader .env minimal (tanpa dependency). Env asli proses selalu menang atas .env.
import fs from 'node:fs';
import path from 'node:path';

export function loadEnv(envPath = path.join(process.cwd(), '.env')) {
  let raw;
  try {
    raw = fs.readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

const toInt = (v, fallback, { min = -Infinity, max = Infinity } = {}) => {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

export function readConfig(env = process.env) {
  return {
    dev: env.NODE_ENV !== 'production',
    port: toInt(env.PORT, 24650, { min: 1, max: 65535 }),
    bindHost: (env.BIND_HOST || '0.0.0.0').trim(),
    displayHost: (env.HOST || '').trim(),
    publicUrl: (env.PUBLIC_URL || '').trim().replace(/\/+$/, ''),
    allowedOrigins: (env.ALLOWED_ORIGIN || '').trim(),
    // Token akses opsional. Kalau diisi, semua koneksi Socket.IO wajib membawanya.
    accessToken: (env.ACCESS_TOKEN || '').trim(),
    discordWebhookUrl: (env.DISCORD_WEBHOOK_URL || '').trim(),
    maxSessions: toInt(env.MAX_SESSIONS, 6, { min: 1, max: 50 }),
    dataDir: env.DATA_DIR ? path.resolve(env.DATA_DIR) : process.cwd(),
    // Percaya header X-Forwarded-For (hanya aktifkan bila di belakang reverse proxy tepercaya).
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    allowPrivatePing: env.ALLOW_PRIVATE_PING === '1' || env.ALLOW_PRIVATE_PING === 'true',
    // false (default) = error parsing paket dari library protokol disembunyikan (bot tetap jalan).
    showProtocolErrors: env.SHOW_PROTOCOL_ERRORS === '1' || env.SHOW_PROTOCOL_ERRORS === 'true',
    chatLogDisabled: env.DISABLE_CHAT_LOG === '1' || env.DISABLE_CHAT_LOG === 'true',
    // Kosong = deteksi versi otomatis dari server (disarankan, selalu ikut update).
    defaultMcVersion: (env.DEFAULT_MC_VERSION || '').trim(),
  };
}
