// Bentuk data sesi yang dipersist + normalisasi dari data lama di sessions.db.
export const SESSIONS_SCHEMA_VERSION = 4;

const DEFAULT_AUTOSELL = {
  command: '/selldrops all',
  triggerMode: 'both',
  inventoryThresholdPercent: 80,
  cooldownMs: 5000,
  eventKeyword: 'sell',
};
const DEFAULT_ANTIAFK = { minIntervalSec: 15, maxIntervalSec: 45 };

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

export function normalizeAutoSellConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  return {
    command: typeof c.command === 'string' && c.command.trim() ? c.command.trim().slice(0, 100) : DEFAULT_AUTOSELL.command,
    triggerMode: ['inventory', 'event', 'both'].includes(c.triggerMode) ? c.triggerMode : DEFAULT_AUTOSELL.triggerMode,
    inventoryThresholdPercent: finite(c.inventoryThresholdPercent) ? clamp(Math.round(c.inventoryThresholdPercent), 10, 100) : DEFAULT_AUTOSELL.inventoryThresholdPercent,
    cooldownMs: finite(c.cooldownMs) ? clamp(Math.round(c.cooldownMs), 1000, 300000) : DEFAULT_AUTOSELL.cooldownMs,
    eventKeyword: typeof c.eventKeyword === 'string' && c.eventKeyword.trim() ? c.eventKeyword.trim().toLowerCase().slice(0, 40) : DEFAULT_AUTOSELL.eventKeyword,
  };
}

export function normalizeAntiAfkConfig(raw) {
  const c = raw && typeof raw === 'object' ? raw : {};
  const min = finite(c.minIntervalSec) ? clamp(Math.round(c.minIntervalSec), 5, 300) : DEFAULT_ANTIAFK.minIntervalSec;
  let max = finite(c.maxIntervalSec) ? clamp(Math.round(c.maxIntervalSec), 5, 600) : DEFAULT_ANTIAFK.maxIntervalSec;
  if (max < min) max = min;
  return { minIntervalSec: min, maxIntervalSec: max };
}

export function applySessionDefaults(input) {
  const raw = input && typeof input === 'object' ? input : {};
  // Buang field runtime (_reconnecting dll.) yang mungkin tersimpan oleh build lama.
  const src = {};
  for (const k of Object.keys(raw)) {
    if (k.startsWith('_')) continue;
    src[k] = raw[k];
  }
  // Versi yang tersimpan dipertahankan apa adanya (sesi lama mungkin sengaja dikunci ke 1.21.1).
  const version = typeof src.version === 'string' && src.version.trim() ? src.version.trim() : null;
  const delay = finite(src.autoHitDelay) ? clamp(Math.round(src.autoHitDelay), 10, 1500) : 500;
  const bowRange = finite(src.autoBowRange) ? clamp(Math.round(src.autoBowRange), 3, 5) : 3;
  const render = finite(src.renderDistance) ? clamp(Math.round(src.renderDistance), 2, 5) : 4;
  return {
    autoReconnect: true,
    autoHitEnabled: false,
    autoRespawn: true,
    autoBowEnabled: false,
    autoCommands: [],
    autoSellEnabled: false,
    antiAfkEnabled: false,
    eventWatchEnabled: true,
    webhookUrl: null,
    rightClickMode: false,
    commandScheduleEnabled: false,
    commandSchedules: [
      { cmd: '/heal', intervalMs: 60000 },
      { cmd: '/feed', intervalMs: 90000 },
    ],
    ...src,
    version,
    autoHitDelay: delay,
    autoBowRange: bowRange,
    renderDistance: render,
    autoSellConfig: normalizeAutoSellConfig(src.autoSellConfig),
    antiAfkConfig: normalizeAntiAfkConfig(src.antiAfkConfig),
    _schemaVersion: SESSIONS_SCHEMA_VERSION,
  };
}
