// Otomasi: Auto Commands, Command Schedule, Auto Sell, Anti-AFK, Event Watch + Discord webhook.
import { logger } from '../logger.mjs';
import { GensEventParser } from '../gensEvents.mjs';
import { buildGensEmbed, sendWebhook, testWebhook } from '../discord.mjs';
import { clampInt, parseCommandList, parseWebhookUrl } from '../validators.mjs';
import { normalizeAntiAfkConfig } from '../sessionDefaults.mjs';

const ANTI_AFK_ACTIONS = ['look', 'jump', 'sneak', 'swing'];
const SCHEDULE_SAFETY_MS = 250;

export const automationMethods = {
  // ───────── Gens event parser wiring ─────────
  initGens() {
    this.gens = new GensEventParser({
      emit: (sid, evt) => this.emitGensEvent(sid, evt),
      looseSell: (sid, keyword) => this.fireAutoSell(sid, `keyword "${keyword}" terdeteksi`),
    });
  },

  disposeGens(sessionId) {
    if (sessionId) return this.gens.dispose(sessionId);
    for (const sid of [...this.gens.buffers.keys(), ...this.gens.lastSeen.keys()]) this.gens.dispose(sid);
  },

  checkGensEvent(sessionId, rawText) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    const cfg = s.autoSellConfig || {};
    this.gens.feed(sessionId, rawText, {
      eventWatchEnabled: s.eventWatchEnabled !== false,
      sellTriggerOn: !!s.autoSellEnabled && (cfg.triggerMode === 'event' || cfg.triggerMode === 'both'),
      keyword: (cfg.eventKeyword || 'sell').toLowerCase().trim(),
    });
  },

  /** Satu tempat yang memutuskan apa yang terjadi saat event terdeteksi. true = Auto Sell ditembakkan. */
  emitGensEvent(sessionId, { eventName, action, multiplier, duration, nextIn }) {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    const cfg = s.autoSellConfig || {};
    const sellTriggerOn = !!s.autoSellEnabled && (cfg.triggerMode === 'event' || cfg.triggerMode === 'both');
    const keyword = (cfg.eventKeyword || 'sell').toLowerCase().trim();
    const suffix = multiplier ? ` (${multiplier}x)` : '';
    const extra = action === 'started' && duration ? ` selama ${duration}` : action === 'ended' && nextIn ? ` · next in ${nextIn}` : '';

    this.push(sessionId, 'gens_event', { eventName, action, multiplier, duration: duration || null, nextIn: nextIn || null, ts: Date.now() });
    this.event(sessionId, 'autosell', `🎉 ${eventName}${suffix} ${action === 'started' ? 'dimulai' : 'berakhir'}${extra}`);
    this.notifyDiscord(sessionId, { embeds: [buildGensEmbed({ eventName, action, multiplier, duration, nextIn, username: s.username }, this.publicBaseUrl())] });

    if (action === 'started' && sellTriggerOn && keyword && eventName.toLowerCase().includes(keyword)) {
      this.fireAutoSell(sessionId, `event: ${eventName}${suffix}`);
      return true;
    }
    return false;
  },

  publicBaseUrl() {
    const { publicUrl, displayHost, port } = this.config;
    if (publicUrl) return publicUrl;
    return `http://${displayHost || 'localhost'}:${port}`;
  },

  notifyDiscord(sessionId, payload) {
    const s = this.sessions.get(sessionId);
    const url = s?.webhookUrl || this.config.discordWebhookUrl;
    if (!url) return;
    sendWebhook(url, payload, `${sessionId.slice(0, 8)}…`).catch(() => {});
  },

  setEventWatchEnabled(sessionId, enabled) {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Session not found' };
    s.eventWatchEnabled = !!enabled;
    this.save(sessionId);
    return { ok: true, enabled: s.eventWatchEnabled };
  },

  setWebhookUrl(sessionId, url) {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Session not found' };
    const parsed = parseWebhookUrl(url);
    if (!parsed.ok) return parsed;
    s.webhookUrl = parsed.value || null;
    this.save(sessionId);
    return { ok: true, webhookUrl: s.webhookUrl };
  },

  getWebhookStatus(sessionId) {
    const s = this.sessions.get(sessionId);
    return { webhookUrl: s?.webhookUrl || '', eventWatchEnabled: s?.eventWatchEnabled !== false };
  },

  testWebhook(sessionId, url) {
    const s = this.sessions.get(sessionId);
    return testWebhook(url, s?.username || sessionId.slice(0, 8));
  },

  // ───────── Auto Commands (jalan sekali setelah spawn) ─────────
  getAutoCommands(sessionId) {
    return this.sessions.get(sessionId)?.autoCommands || [];
  },

  setAutoCommands(sessionId, commands) {
    const safe = parseCommandList(commands, { withDelay: true });
    const s = this.sessions.get(sessionId);
    if (s) {
      s.autoCommands = safe;
      this.save(sessionId);
    }
    return safe;
  },

  async runAutoCommands(sessionId, commands) {
    const bot = this.bots.get(sessionId);
    for (const entry of commands) {
      if (entry.delay > 0) await new Promise((r) => setTimeout(r, entry.delay));
      if (this.bots.get(sessionId) !== bot || !bot?.entity) break;
      const cmd = entry.cmd?.trim();
      if (!cmd) continue;
      const r = await this.queueChat(sessionId, cmd, 1200);
      this.event(sessionId, 'cmd', r.ok ? `Auto Command: ${cmd}` : `Auto Command failed: ${cmd} — ${r.error}`);
    }
  },

  // ───────── Command Schedule ─────────
  getCommandSchedules(sessionId) {
    return this.sessions.get(sessionId)?.commandSchedules || [];
  },

  setCommandSchedules(sessionId, list) {
    const safe = parseCommandList(list, { withDelay: false });
    const s = this.sessions.get(sessionId);
    if (s) {
      s.commandSchedules = safe;
      this.save(sessionId);
    }
    if (this.scheduleTimers.has(sessionId)) this.startCommandSchedule(sessionId);
    return safe;
  },

  startCommandSchedule(sessionId) {
    const bot = this.bots.get(sessionId);
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Session not found' };
    if (!bot?.entity || bot.health <= 0) return { ok: false, error: 'Bot not ready' };
    const list = s.commandSchedules || [];
    if (!list.length) return { ok: false, error: 'Belum ada command yang diset' };

    this.stopCommandSchedule(sessionId, false);
    s.commandScheduleEnabled = true;
    this.save(sessionId);

    const handles = list.map((entry) => {
      const h = setInterval(async () => {
        if (this.bots.get(sessionId) !== bot || bot.health <= 0) return;
        const r = await this.queueChat(sessionId, entry.cmd, 1200);
        if (r.ok) this.event(sessionId, 'cmdsched', `⏱ ${entry.cmd}`);
      }, entry.intervalMs + SCHEDULE_SAFETY_MS);
      h.unref?.();
      return h;
    });
    this.scheduleTimers.set(sessionId, handles);
    return { ok: true };
  },

  stopCommandSchedule(sessionId, persist = true) {
    const handles = this.scheduleTimers.get(sessionId);
    if (handles) {
      handles.forEach((h) => clearInterval(h));
      this.scheduleTimers.delete(sessionId);
    }
    if (persist) {
      const s = this.sessions.get(sessionId);
      if (s && s.commandScheduleEnabled) {
        s.commandScheduleEnabled = false;
        this.save(sessionId);
      }
    }
  },

  getCommandScheduleStatus(sessionId) {
    return { enabled: this.scheduleTimers.has(sessionId), schedules: this.getCommandSchedules(sessionId) };
  },

  // ───────── Auto Sell ─────────
  sanitizeAutoSellConfig(raw) {
    const c = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    if (c.command !== undefined) {
      let cmd = String(c.command || '/selldrops all').replace(/[\u0000-\u001f\u007f]/g, '').trim();
      if (!cmd.startsWith('/')) cmd = `/${cmd}`;
      out.command = cmd.slice(0, 100);
    }
    if (c.triggerMode !== undefined) out.triggerMode = ['inventory', 'event', 'both'].includes(c.triggerMode) ? c.triggerMode : 'both';
    if (c.inventoryThresholdPercent !== undefined) out.inventoryThresholdPercent = clampInt(c.inventoryThresholdPercent, 10, 100, 80);
    if (c.cooldownMs !== undefined) out.cooldownMs = clampInt(c.cooldownMs, 1000, 300_000, 5000);
    if (c.eventKeyword !== undefined) out.eventKeyword = String(c.eventKeyword || 'sell').trim().slice(0, 40).toLowerCase() || 'sell';
    return out;
  },

  setAutoSellConfig(sessionId, config) {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Session not found' };
    s.autoSellConfig = { ...s.autoSellConfig, ...this.sanitizeAutoSellConfig(config) };
    this.save(sessionId);
    return { ok: true, config: s.autoSellConfig };
  },

  setAutoSellEnabled(sessionId, enabled) {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Session not found' };
    s.autoSellEnabled = !!enabled;
    this.save(sessionId);
    this.event(sessionId, 'autosell', s.autoSellEnabled ? 'Auto Sell diaktifkan' : 'Auto Sell dinonaktifkan');
    return { ok: true, enabled: s.autoSellEnabled };
  },

  getAutoSellStatus(sessionId) {
    const s = this.sessions.get(sessionId);
    return { enabled: !!s?.autoSellEnabled, config: s?.autoSellConfig || {} };
  },

  fireAutoSell(sessionId, reason) {
    const s = this.sessions.get(sessionId);
    const cfg = s?.autoSellConfig;
    if (!cfg || !this.bots.get(sessionId)?.entity) return;
    let state = this.autoSellState.get(sessionId);
    if (!state) this.autoSellState.set(sessionId, (state = { lastSellAt: 0 }));
    const now = Date.now();
    if (now - state.lastSellAt < (cfg.cooldownMs ?? 5000)) return;
    state.lastSellAt = now;
    const command = cfg.command || '/selldrops all';
    // Lewat antrean chat supaya tidak bertabrakan dengan Command Schedule / pesan manual.
    this.queueChat(sessionId, command, 1200).then((r) => {
      this.event(sessionId, 'autosell', r.ok ? `📤 Auto-sell (${reason}): "${command}"` : `⚠ Auto-sell gagal kirim command: ${r.error}`);
    });
  },

  checkAutoSellOnInventory(sessionId, inv) {
    const s = this.sessions.get(sessionId);
    if (!s?.autoSellEnabled || !inv?.ok) return;
    const cfg = s.autoSellConfig || {};
    if (cfg.triggerMode === 'event') return;
    const used = (inv.items || []).filter((i) => i.slot >= 9 && i.slot <= 44).length;
    const percent = Math.round((used / 36) * 100);
    if (percent >= (cfg.inventoryThresholdPercent ?? 80)) this.fireAutoSell(sessionId, `inventory ${percent}%`);
  },

  // ───────── Anti-AFK ─────────
  startAntiAfk(sessionId, opts = {}) {
    const bot = this.bots.get(sessionId);
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Session not found' };
    if (!bot?.entity) return { ok: false, error: 'Bot not ready' };
    this.stopAntiAfk(sessionId, false);

    const cfg = normalizeAntiAfkConfig({
      minIntervalSec: opts.minIntervalSec ?? s.antiAfkConfig?.minIntervalSec,
      maxIntervalSec: opts.maxIntervalSec ?? s.antiAfkConfig?.maxIntervalSec,
    });
    s.antiAfkEnabled = true;
    s.antiAfkConfig = cfg;
    this.save(sessionId);

    const pulse = (control, ms) => {
      try {
        bot.setControlState(control, true);
      } catch {
        return;
      }
      setTimeout(() => {
        try {
          if (this.bots.get(sessionId) === bot) bot.setControlState(control, false);
        } catch {
          /* ignore */
        }
      }, ms).unref?.();
    };

    const scheduleNext = () => {
      const delay = (cfg.minIntervalSec + Math.random() * (cfg.maxIntervalSec - cfg.minIntervalSec)) * 1000;
      const t = setTimeout(() => {
        if (!this.sessions.get(sessionId)?.antiAfkEnabled || this.bots.get(sessionId) !== bot) {
          this.antiAfkTimers.delete(sessionId);
          return;
        }
        if (bot.entity && bot.health > 0) {
          try {
            const action = ANTI_AFK_ACTIONS[Math.floor(Math.random() * ANTI_AFK_ACTIONS.length)];
            if (action === 'look') bot.look(Math.random() * Math.PI * 2 - Math.PI, Math.random() * 0.6 - 0.3, true);
            else if (action === 'jump') pulse('jump', 250);
            else if (action === 'sneak') pulse('sneak', 400);
            else bot.swingArm();
          } catch (e) {
            logger.debug('AntiAFK', 'aksi gagal', e?.message);
          }
        }
        scheduleNext();
      }, delay);
      t.unref?.();
      this.antiAfkTimers.set(sessionId, t);
    };
    scheduleNext();
    this.event(sessionId, 'info', `🕹 Anti-AFK aktif (tiap ${cfg.minIntervalSec}-${cfg.maxIntervalSec}s)`);
    this.push(sessionId, 'anti_afk_status', this.getAntiAfkStatus(sessionId));
    return { ok: true };
  },

  stopAntiAfk(sessionId, persist = true) {
    const t = this.antiAfkTimers.get(sessionId);
    if (t) {
      clearTimeout(t);
      this.antiAfkTimers.delete(sessionId);
    }
    if (persist) {
      const s = this.sessions.get(sessionId);
      if (s) {
        s.antiAfkEnabled = false;
        this.save(sessionId);
      }
      if (t) this.event(sessionId, 'info', '🕹 Anti-AFK dimatikan');
      this.push(sessionId, 'anti_afk_status', this.getAntiAfkStatus(sessionId));
    }
    return { ok: true };
  },

  getAntiAfkStatus(sessionId) {
    const s = this.sessions.get(sessionId);
    return {
      enabled: this.antiAfkTimers.has(sessionId),
      minIntervalSec: s?.antiAfkConfig?.minIntervalSec ?? 15,
      maxIntervalSec: s?.antiAfkConfig?.maxIntervalSec ?? 45,
    };
  },

  // ───────── Pulihkan fitur persisten setelah (re)connect ─────────
  syncFeatures(sessionId) {
    const bot = this.bots.get(sessionId);
    const s = this.sessions.get(sessionId);
    if (!bot || !s) return;
    const holdingBow = !!bot.heldItem?.name?.toLowerCase().includes('bow');

    if (s.autoHitEnabled && !this.autoHitTimers.has(sessionId) && this.startAutoHit(sessionId, s.autoHitDelay)) {
      this.event(sessionId, 'info', '⚔️ Auto Hit aktif');
      this.push(sessionId, 'auto_hit_status', this.getAutoHitStatus(sessionId));
    }
    if (s.autoBowEnabled) {
      if (holdingBow && !this.autoBowTimers.has(sessionId)) {
        if (this.startAutoBow(sessionId, s.autoBowRange).ok) {
          this.event(sessionId, 'info', '🏹 Auto Bow aktif');
          this.push(sessionId, 'auto_bow_status', this.getAutoBowStatus(sessionId));
        }
      } else if (!holdingBow && this.autoBowTimers.has(sessionId)) {
        this.stopAutoBow(sessionId, false);
        this.event(sessionId, 'info', '🏹 Auto Bow dijeda (ganti item)');
        this.push(sessionId, 'auto_bow_status', this.getAutoBowStatus(sessionId));
      }
    }
    if (s.commandScheduleEnabled && !this.scheduleTimers.has(sessionId) && this.startCommandSchedule(sessionId).ok) {
      this.event(sessionId, 'info', '⏱ Command Schedule aktif');
      this.push(sessionId, 'cmd_schedule_status', this.getCommandScheduleStatus(sessionId));
    }
    if (s.antiAfkEnabled && !this.antiAfkTimers.has(sessionId)) this.startAntiAfk(sessionId, s.antiAfkConfig || {});
  },

  featuresSettled(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return true;
    return (
      (!s.autoHitEnabled || this.autoHitTimers.has(sessionId)) &&
      (!s.autoBowEnabled || this.autoBowTimers.has(sessionId)) &&
      (!s.commandScheduleEnabled || this.scheduleTimers.has(sessionId)) &&
      (!s.antiAfkEnabled || this.antiAfkTimers.has(sessionId))
    );
  },
};
