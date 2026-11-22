// Inti manajemen bot: siklus hidup sesi, antrean koneksi, reconnect, dan event bot.
// Fitur (combat, otomasi, inventory) dipasang dari modul terpisah di bawah.
//
// BotManager TIDAK tahu soal Socket.IO. Semua update ke UI dikirim lewat
// `this.emit('push', sessionId, eventName, payload)`; lapisan socket yang
// mem-broadcast ke room sesi tersebut. Dengan begitu tidak ada callback per-sesi
// yang bisa "tertimpa" saat browser subscribe/refresh.
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { logger } from './logger.mjs';
import { logChat } from './chatLogger.mjs';
import { applySessionDefaults } from './sessionDefaults.mjs';
import { ChatQueue } from './chatQueue.mjs';
import { combatMethods } from './features/combat.mjs';
import { automationMethods } from './features/automation.mjs';
import { inventoryMethods } from './features/inventory.mjs';

const CONNECT_QUEUE_GAP_MS = 1500;
const LOGIN_TIMEOUT_MS = 45_000;
const MAX_RECONNECT_DELAY_SEC = 30;
const POSITION_PUSH_MS = 200;
const ENTITY_PUSH_MS = 500;

async function loadDefaultDeps() {
  const [{ default: mineflayer }, { default: Vec3 }] = await Promise.all([import('mineflayer'), import('vec3')]);
  return { createBot: mineflayer.createBot, Vec3 };
}

const identityKey = (u, h, p) => `${String(u).toLowerCase()}@${String(h).toLowerCase()}:${p}`;
const round1 = (n) => Math.round(n * 10) / 10;

export class BotManager extends EventEmitter {
  /**
   * @param {{ config: object, db: import('./db.mjs').SessionDb, deps?: { createBot: Function, Vec3: any } }} opts
   */
  constructor({ config, db, deps }) {
    super();
    this.setMaxListeners(50);
    this.config = config;
    this.db = db;
    this.deps = deps || null;

    /** @type {Map<string, object>} */
    this.sessions = new Map();
    this.bots = new Map();

    // Runtime-only state (tidak pernah dipersist)
    this.autoHitTimers = new Map();
    this.autoHitRefs = new Map();
    this.autoBowTimers = new Map();
    this.autoBowRefs = new Map();
    this.scheduleTimers = new Map();
    this.antiAfkTimers = new Map();
    this.respawnTimers = new Map();
    this.invDebounce = new Map();
    this.invCache = new Map();
    this.invRefreshing = new Set();
    this.openWindows = new Map();
    this.infoCache = new Map();
    this.botStartTimes = new Map();
    this.movement = new Map();
    this.autoSellState = new Map();
    this.connectTimers = new Map();
    this.watchdogs = new Map();
    this.reconnect = new Map();
    this.chatQueue = new ChatQueue();

    this.connectQueue = [];
    this.connectQueueBusy = false;
    this.connectGapTimer = null;
    this.connectJobs = new Map(); // sessionId -> token terbaru
    this.shuttingDown = false;
    this.tickers = [];
    this.lastStatsJson = new Map();
    this.lastSessionsJson = '';
    this.lastDbHealthJson = '';

    this.initGens();
  }

  // ───────────────────────── lifecycle ─────────────────────────
  async init() {
    if (!this.deps) this.deps = await loadDefaultDeps();
    await this.db.init();
    this.sessions = this.db.loadAll();
    logger.info('SnowyChat', `Memuat ${this.sessions.size} sesi dari SQLite`);
    this.#startTickers();
  }

  #startTickers() {
    const every = (ms, fn) => {
      const t = setInterval(() => {
        try {
          fn();
        } catch (e) {
          logger.error('Ticker', e?.stack || e?.message || String(e));
        }
      }, ms);
      t.unref?.();
      this.tickers.push(t);
    };

    // Daftar sesi + statistik bot: hanya dikirim bila berubah.
    every(2000, () => {
      const sessions = this.getAllSessions();
      const json = JSON.stringify(sessions);
      if (json !== this.lastSessionsJson) {
        this.lastSessionsJson = json;
        this.emit('broadcast', 'persistent_sessions', sessions);
      }
      for (const s of sessions) {
        if (!s.connected) {
          this.lastStatsJson.delete(s.sessionId);
          continue;
        }
        const bot = this.bots.get(s.sessionId);
        if (!bot?.entity) continue;
        const stats = { health: bot.health || 0, food: bot.food || 0, ping: bot.player?.ping ?? 0, uptime: this.getUptime(s.sessionId) };
        const j = JSON.stringify(stats);
        if (j !== this.lastStatsJson.get(s.sessionId)) {
          this.lastStatsJson.set(s.sessionId, j);
          this.push(s.sessionId, 'stats', stats);
        }
      }
      for (const sid of this.lastStatsJson.keys()) if (!this.sessions.has(sid)) this.lastStatsJson.delete(sid);
    });

    every(15_000, () => {
      const health = this.db.getHealth();
      const json = JSON.stringify(health);
      if (json !== this.lastDbHealthJson) {
        this.lastDbHealthJson = json;
        this.emit('broadcast', 'db_health', health);
      }
    });

    every(10 * 60 * 1000, () => {
      const r = this.db.integrityCheck();
      if (!r.ok) logger.error('DB', 'Pemeriksaan integritas berkala menemukan masalah');
      const inDb = this.db.count();
      if (inDb !== null && inDb !== this.sessions.size) {
        logger.error('DB', `Ketidakcocokan: ${this.sessions.size} sesi di memori, ${inDb} di database`);
      }
    });
  }

  /** Hentikan semua bot dan timer, flush DB. Dipanggil saat shutdown. */
  async shutdown() {
    this.shuttingDown = true;
    for (const t of this.tickers) clearInterval(t);
    this.tickers = [];
    if (this.connectGapTimer) clearTimeout(this.connectGapTimer);
    this.connectQueue = [];
    for (const sid of [...this.bots.keys(), ...this.sessions.keys()]) {
      this.cancelReconnect(sid);
      this.cleanupBot(sid);
    }
    this.disposeGens();
    return this.db.close();
  }

  flushDbNow() {
    return this.db.flush();
  }

  getDbHealth() {
    return this.db.getHealth();
  }

  generateSessionId() {
    return crypto.randomBytes(16).toString('hex');
  }

  push(sessionId, event, payload = {}) {
    this.emit('push', sessionId, event, { ...payload, sessionId });
  }

  status(sessionId, type, message) {
    this.push(sessionId, 'status', { type, message, ts: Date.now() });
  }

  event(sessionId, type, message) {
    this.push(sessionId, 'event', { type, message, ts: Date.now() });
  }

  // ───────────────────────── sessions ─────────────────────────
  save(sessionId) {
    const s = this.sessions.get(sessionId);
    this.infoCache.delete(sessionId);
    if (s) this.db.save(sessionId, s);
  }

  /** True bila identitas (username@host:port) sedang dipakai sesi LAIN yang aktif/mengantre. */
  isIdentityInUse(username, host, port, exceptSessionId = null) {
    const key = identityKey(username, host, port);
    for (const [id, s] of this.sessions) {
      if (id === exceptSessionId) continue;
      if (identityKey(s.username, s.host, s.port) !== key) continue;
      if (this.bots.has(id) || this.connectJobs.has(id)) return true;
    }
    return false;
  }

  checkUsernameAvailable(username, host, port) {
    return !this.isIdentityInUse(username, host, port);
  }

  createSession({ host, port, username, version, auth }) {
    if (this.sessions.size >= this.config.maxSessions) {
      return { ok: false, error: `Max ${this.config.maxSessions} sessions reached. Delete an existing session first.` };
    }
    if (this.isIdentityInUse(username, host, port)) return { ok: false, error: `"${username}" already in use` };
    for (const s of this.sessions.values()) {
      if (identityKey(s.username, s.host, s.port) === identityKey(username, host, port)) {
        return { ok: false, error: `Session for "${username}" on ${host}:${port} already exists` };
      }
    }
    const sessionId = this.generateSessionId();
    const now = Date.now();
    this.sessions.set(
      sessionId,
      applySessionDefaults({ sessionId, host, port, username, version: version || null, auth: auth || 'offline', createdAt: now, lastActive: now }),
    );
    this.save(sessionId);
    const r = this.connect(sessionId);
    return r.ok ? { ok: true, sessionId, session: this.getSessionById(sessionId) } : r;
  }

  getSessionById(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    return { sessionId, host: s.host, port: s.port, username: s.username, connected: this.isConnected(sessionId) };
  }

  hasSession(sessionId) {
    return this.sessions.has(sessionId);
  }

  isConnected(sessionId) {
    const b = this.bots.get(sessionId);
    return !!(b?.entity && b.health > 0);
  }

  getAllSessions() {
    return Array.from(this.sessions.entries()).map(([id, s]) => ({
      sessionId: id,
      host: s.host,
      port: s.port,
      username: s.username,
      version: s.version,
      createdAt: s.createdAt,
      lastActive: s.lastActive,
      connected: this.isConnected(id),
      autoHitEnabled: this.autoHitTimers.has(id),
      autoBowEnabled: this.autoBowTimers.has(id),
      commandScheduleEnabled: this.scheduleTimers.has(id),
      autoSellEnabled: !!s.autoSellEnabled,
      antiAfkEnabled: this.antiAfkTimers.has(id),
      autoRespawn: s.autoRespawn !== false,
      autoReconnect: s.autoReconnect !== false,
      uptime: this.getUptime(id),
      containerOpen: this.openWindows.has(id),
    }));
  }

  updateSessionConfig(sessionId, { username, host, port, version }) {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Session not found' };
    if (this.bots.has(sessionId) || this.connectJobs.has(sessionId)) {
      return { ok: false, error: 'Disconnect the bot before editing its connection settings' };
    }
    const next = {
      username: username ?? s.username,
      host: host ?? s.host,
      port: port ?? s.port,
      version: version === undefined ? s.version : version,
    };
    for (const [id, other] of this.sessions) {
      if (id !== sessionId && identityKey(other.username, other.host, other.port) === identityKey(next.username, next.host, next.port)) {
        return { ok: false, error: `"${next.username}" already exists on ${next.host}:${next.port}` };
      }
    }
    Object.assign(s, next);
    this.save(sessionId);
    return { ok: true, session: { sessionId, username: s.username, host: s.host, port: s.port, version: s.version } };
  }

  setAutoReconnect(sessionId, enabled) {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Session not found' };
    s.autoReconnect = !!enabled;
    if (!s.autoReconnect) this.cancelReconnect(sessionId);
    this.save(sessionId);
    return { ok: true, enabled: s.autoReconnect };
  }

  setAutoRespawn(sessionId, enabled) {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Session not found' };
    s.autoRespawn = !!enabled;
    this.save(sessionId);
    return { ok: true, enabled: s.autoRespawn };
  }

  getRenderDistance(sessionId) {
    return { distance: this.sessions.get(sessionId)?.renderDistance ?? 4 };
  }

  setRenderDistance(sessionId, distance) {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Session not found' };
    const d = Math.max(2, Math.min(5, Number.parseInt(distance, 10) || 4));
    s.renderDistance = d;
    this.save(sessionId);
    this.#applyRenderDistance(sessionId, d);
    return { ok: true, distance: d };
  }

  // Memakai API resmi mineflayer (bukan menulis packet mentah) supaya aman lintas versi protokol.
  #applyRenderDistance(sessionId, distance) {
    const bot = this.bots.get(sessionId);
    if (!bot || bot._client?.destroyed || typeof bot.setSettings !== 'function') return;
    try {
      bot.setSettings({ viewDistance: distance });
    } catch (e) {
      logger.debug('Bot', 'setSettings(viewDistance) gagal', e?.message);
    }
  }

  // ───────────────────────── connect / reconnect ─────────────────────────
  /** Antrekan koneksi untuk sesi yang sudah tersimpan. Validasi sinkron, login asinkron. */
  connect(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Session not found' };
    if (this.shuttingDown) return { ok: false, error: 'Server is shutting down' };
    if (this.isIdentityInUse(s.username, s.host, s.port, sessionId)) {
      const error = `Username "${s.username}" already in use on ${s.host}:${s.port}`;
      this.status(sessionId, 'error', error);
      return { ok: false, error };
    }
    if (this.bots.has(sessionId)) this.cleanupBot(sessionId);

    const token = Symbol(sessionId);
    this.connectJobs.set(sessionId, token);
    this.connectQueue = this.connectQueue.filter((j) => j.sessionId !== sessionId);
    const position = this.connectQueue.length;
    if (position > 0 || this.connectQueueBusy) {
      this.status(sessionId, 'queued', `Waiting to connect (position ${position + 1} in queue)…`);
    }
    this.connectQueue.push({ sessionId, token });
    this.#pumpConnectQueue();
    return { ok: true, queued: true };
  }

  #pumpConnectQueue() {
    if (this.connectQueueBusy) return;
    const job = this.connectQueue.shift();
    if (!job) return;
    this.connectQueueBusy = true;

    // Job dianggap batal bila sesi sudah dihapus atau digantikan permintaan connect yang lebih baru.
    // (Bug lama: job dibandingkan lewat identitas objek callback, sehingga job diam-diam dibuang
    // ketika browser subscribe dan mengganti callback → sesi tidak pernah connect.)
    const stillWanted = this.sessions.has(job.sessionId) && this.connectJobs.get(job.sessionId) === job.token;
    if (stillWanted) {
      this.connectJobs.delete(job.sessionId);
      try {
        this.#createNow(job.sessionId);
      } catch (e) {
        logger.error('Bot', `Gagal membuat bot ${job.sessionId.slice(0, 8)}…`, e?.stack || e?.message);
        this.status(job.sessionId, 'error', `Failed to create bot: ${e.message}`);
        this.cleanupBot(job.sessionId);
        this.scheduleReconnect(job.sessionId);
      }
    }
    // Jeda tetap dipatuhi walau job dibuang, tanpa menunggu spawn (server lambat tidak memblokir sesi lain).
    this.connectGapTimer = setTimeout(() => {
      this.connectGapTimer = null;
      this.connectQueueBusy = false;
      this.#pumpConnectQueue();
    }, CONNECT_QUEUE_GAP_MS);
    this.connectGapTimer.unref?.();
  }

  scheduleReconnect(sessionId, baseDelaySec = 5) {
    const s = this.sessions.get(sessionId);
    if (!s || s.autoReconnect === false || this.shuttingDown) return;
    let meta = this.reconnect.get(sessionId);
    if (meta?.timer) return; // sudah ada yang menunggu
    if (!meta) {
      meta = { attempt: 0, timer: null };
      this.reconnect.set(sessionId, meta);
    }
    meta.attempt += 1;
    const delay = Math.min(baseDelaySec * 1.3 ** (meta.attempt - 1), MAX_RECONNECT_DELAY_SEC);
    this.status(sessionId, 'reconnecting', `Reconnecting in ${Math.round(delay)}s (attempt ${meta.attempt})`);
    meta.timer = setTimeout(() => {
      meta.timer = null;
      if (!this.sessions.has(sessionId) || this.shuttingDown) return;
      this.status(sessionId, 'connecting', `Reconnecting to ${s.host}:${s.port}`);
      const r = this.connect(sessionId);
      if (!r.ok) this.scheduleReconnect(sessionId, baseDelaySec);
    }, delay * 1000);
    meta.timer.unref?.();
  }

  cancelReconnect(sessionId) {
    const meta = this.reconnect.get(sessionId);
    if (meta?.timer) clearTimeout(meta.timer);
    this.reconnect.delete(sessionId);
  }

  reconnectAllOnStartup() {
    let queued = 0;
    for (const [sessionId, s] of this.sessions) {
      if (s.autoReconnect === false) continue;
      if (this.connect(sessionId).ok) queued++;
    }
    if (queued) logger.info('SnowyChat', `Auto-reconnect ${queued} sesi dari data tersimpan…`);
    return queued;
  }

  connectAll() {
    let n = 0;
    for (const [sessionId] of this.sessions) {
      if (this.isConnected(sessionId) || this.bots.has(sessionId) || this.connectJobs.has(sessionId)) continue;
      if (this.connect(sessionId).ok) n++;
    }
    return n;
  }

  /** Putuskan satu sesi. remove=true juga menghapusnya dari database. */
  disconnect(sessionId, { remove = false } = {}) {
    if (!this.sessions.has(sessionId) && !this.bots.has(sessionId)) return { ok: false, error: 'Session not found' };
    this.cancelReconnect(sessionId);
    this.connectJobs.delete(sessionId);
    this.connectQueue = this.connectQueue.filter((j) => j.sessionId !== sessionId);
    this.cleanupBot(sessionId, { remove });
    return { ok: true };
  }

  disconnectAll() {
    let n = 0;
    for (const sessionId of [...this.sessions.keys()]) {
      if (this.bots.has(sessionId) || this.connectJobs.has(sessionId) || this.reconnect.has(sessionId)) {
        this.disconnect(sessionId);
        n++;
      }
    }
    return n;
  }

  // ───────────────────────── bot creation ─────────────────────────
  #createNow(sessionId) {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.lastActive = Date.now();
    this.save(sessionId);

    const version = s.version || this.config.defaultMcVersion || undefined;
    const bot = this.deps.createBot({
      host: s.host,
      port: s.port,
      username: s.username,
      ...(version ? { version } : {}),
      auth: s.auth || 'offline',
      viewDistance: s.renderDistance,
      checkTimeoutInterval: 0,
      closeTimeout: 15_000,
      keepAlive: true,
      // Server lebih baru dari protokol yang dikenal mineflayer membanjiri konsol dengan PartialReadError.
      hideErrors: !this.config.showProtocolErrors,
      physicsEnabled: true,
    });

    this.bots.set(sessionId, bot);
    this.botStartTimes.set(sessionId, Date.now());
    const live = () => this.bots.get(sessionId) === bot;
    let loggedIn = false;

    // Jika tidak ada login dalam batas waktu (DNS gagal, port tertutup tanpa event 'end', dll.),
    // anggap koneksi gagal supaya auto-reconnect tidak macet selamanya.
    const loginTimer = setTimeout(() => {
      if (!live() || loggedIn) return;
      this.status(sessionId, 'error', '[ BOT ] Login timeout — server tidak merespons');
      this.cleanupBot(sessionId);
      this.scheduleReconnect(sessionId);
    }, LOGIN_TIMEOUT_MS);
    loginTimer.unref?.();
    this.connectTimers.set(sessionId, loginTimer);

    bot.on('login', () => {
      if (!live()) return;
      loggedIn = true;
      clearTimeout(loginTimer);
      this.connectTimers.delete(sessionId);
      this.status(sessionId, 'connected', `Logged in as ${bot.username}`);
      const sess = this.sessions.get(sessionId);
      if (sess) {
        sess.lastActive = Date.now();
        this.save(sessionId);
      }
    });

    bot.on('kicked', (reason) => {
      if (!live()) return;
      this.status(sessionId, 'kicked', `[ BOT ] ${this.#reasonToText(reason)}`);
      this.cleanupBot(sessionId);
      this.scheduleReconnect(sessionId);
    });

    bot._client?.on?.('error', (err) => logger.debug('Bot', '_client error', err?.message || String(err)));

    bot.on('error', (err) => {
      if (!live()) return;
      const msg = err?.message || String(err);
      if (/keep.?alive/i.test(msg) || /internal error/i.test(msg)) return logger.debug('Bot', 'noise diabaikan', msg);
      if (/PartialReadError|Unexpected buffer end|varint/i.test(msg)) return logger.debug('Bot', 'parse error non-fatal', msg);
      if (/ETIMEDOUT|ECONNRESET|EPIPE/.test(msg)) return logger.debug('Bot', 'network error (reconnect via end)', msg);
      if (/ECONNREFUSED/.test(msg)) return this.status(sessionId, 'error', '[ BOT ] Cannot connect to server');
      if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return this.status(sessionId, 'error', '[ BOT ] Server address not found');
      this.status(sessionId, 'error', `[ BOT ] ${msg}`);
    });

    bot.on('end', (reason) => {
      if (!live() || reason === 'manual') return;
      const text = !reason || reason === 'socketClosed' || reason === 'close' ? 'connection closed' : /internal error/i.test(String(reason)) ? 'server glitch' : String(reason);
      const isRestart = /restart/i.test(String(reason));
      this.status(sessionId, 'disconnected', `[ BOT ] Disconnected: ${text}`);
      this.cleanupBot(sessionId);
      this.scheduleReconnect(sessionId, isRestart ? 15 : 3);
    });

    this.#wireWatchdog(sessionId, bot, live);
    this.#wireWorldEvents(sessionId, bot, live);
  }

  #reasonToText(reason) {
    try {
      if (reason && typeof reason === 'object') {
        if (typeof reason.toString === 'function' && reason.toString !== Object.prototype.toString) {
          const t = reason.toString();
          if (t && t !== '[object Object]') return t;
        }
        return this.chatComponentToString(reason);
      }
      if (typeof reason === 'string') {
        try {
          return this.chatComponentToString(JSON.parse(reason));
        } catch {
          return reason;
        }
      }
    } catch {
      /* jatuh ke default */
    }
    return String(reason ?? 'Unknown reason');
  }

  unwrapNbt(v) {
    if (v && typeof v === 'object' && 'type' in v && 'value' in v) {
      if (v.type === 'compound' && v.value && typeof v.value === 'object') {
        const out = {};
        for (const k of Object.keys(v.value)) out[k] = this.unwrapNbt(v.value[k]);
        return out;
      }
      if (v.type === 'list' && Array.isArray(v.value?.value)) return v.value.value.map((x) => this.unwrapNbt(x));
      return v.value;
    }
    return v;
  }

  chatComponentToString(comp) {
    if (!comp) return '';
    if (typeof comp === 'string') return comp;
    comp = this.unwrapNbt(comp);
    if (typeof comp === 'string') return comp;
    let text = '';
    if (comp.text) text += comp.text;
    if (comp.translate && !comp.text) text += String(comp.translate).replace(/multiplayer\.disconnect\./, '').replace(/_/g, ' ');
    if (Array.isArray(comp.extra)) for (const part of comp.extra) text += this.chatComponentToString(part);
    if (Array.isArray(comp.with)) {
      const args = comp.with.map((w) => this.chatComponentToString(w)).join(', ');
      if (args && !text.includes(args)) text += (text ? ': ' : '') + args;
    }
    return text.trim() || 'Disconnected by server';
  }

  /** Deteksi lag server (tanpa memutus bot) + gerakan kecil berkala agar tidak dianggap AFK. */
  #wireWatchdog(sessionId, bot, live) {
    let lastPacketAt = Date.now();
    let lagSince = null;
    let lagNotifAt = 0;
    let tcpAlive = true;
    const onData = () => (lastPacketAt = Date.now());
    const onDead = () => (tcpAlive = false);
    let sock = null;
    const hook = () => {
      try {
        const next = bot._client?.socket;
        if (!next || next === sock) return;
        sock = next;
        sock.on('data', onData);
        sock.on('close', onDead);
        sock.on('error', onDead);
      } catch {
        /* socket belum ada */
      }
    };
    hook();
    bot._client?.on?.('connect', hook);

    const dog = setInterval(() => {
      if (!live() || bot._client?.destroyed) return;
      hook();
      const now = Date.now();
      if (now - lastPacketAt > 8000) {
        if (!lagSince) {
          lagSince = now;
          lagNotifAt = now;
          this.event(sessionId, 'lag', '⚠️ Server sedang lag/freeze, bot tetap online menunggu...');
        } else if (now - lagNotifAt > 30_000) {
          lagNotifAt = now;
          const sec = Math.round((now - lagSince) / 1000);
          if (tcpAlive) this.event(sessionId, 'lag', `⏳ Server masih lag (${sec}s), koneksi TCP aman, menunggu...`);
          else this.event(sessionId, 'lag', `❌ Koneksi terputus setelah ${sec}s`);
        }
      } else if (lagSince) {
        this.event(sessionId, 'lag', `✅ Server normal kembali (lag ${Math.round((now - lagSince) / 1000)}s)`);
        lagSince = null;
        lagNotifAt = 0;
        tcpAlive = true;
      }
    }, 3000);
    const swing = setInterval(() => {
      if (!live() || !bot.entity || bot.health <= 0 || bot._client?.destroyed) return;
      if (this.autoHitTimers.has(sessionId)) return;
      if (lagSince && Date.now() - lagSince > 15_000) return;
      try {
        bot.swingArm();
      } catch {
        /* diabaikan */
      }
    }, 25_000);
    dog.unref?.();
    swing.unref?.();
    this.watchdogs.set(sessionId, () => {
      clearInterval(dog);
      clearInterval(swing);
      try {
        sock?.off('data', onData);
        sock?.off('close', onDead);
        sock?.off('error', onDead);
        bot._client?.off?.('connect', hook);
      } catch {
        /* ignore */
      }
    });
  }

  #wireWorldEvents(sessionId, bot, live) {
    let lastPos = 0;
    let lastEntities = 0;
    bot.on('move', () => {
      if (!live()) return;
      const now = Date.now();
      if (now - lastPos < POSITION_PUSH_MS) return;
      lastPos = now;
      const payload = { pos: this.getPosition(sessionId) };
      if (now - lastEntities > ENTITY_PUSH_MS) {
        lastEntities = now;
        payload.entities = this.getNearbyEntitiesForMap(sessionId);
      }
      this.push(sessionId, 'map_data', payload);
    });

    const emitInventory = () => {
      clearTimeout(this.invDebounce.get(sessionId));
      const t = setTimeout(() => {
        this.invDebounce.delete(sessionId);
        if (!live() || this.openWindows.has(sessionId) || this.invRefreshing.has(sessionId)) return;
        const inv = this.getInventory(sessionId);
        if (inv.ok) {
          this.push(sessionId, 'inventory', inv);
          this.checkAutoSellOnInventory(sessionId, inv);
        }
      }, 50);
      t.unref?.();
      this.invDebounce.set(sessionId, t);
    };
    const onInvChange = () => {
      if (!live()) return;
      this.invCache.delete(sessionId);
      if (this.openWindows.has(sessionId) || this.invRefreshing.has(sessionId)) return;
      emitInventory();
    };
    bot.on('heldItemChanged', () => {
      onInvChange();
      setTimeout(() => live() && this.syncFeatures(sessionId), 300).unref?.();
    });
    bot.on('inventory', onInvChange);

    let autoCommandsDone = false;
    bot.on('spawn', () => {
      if (!live()) return;
      const s = this.sessions.get(sessionId);
      this.status(sessionId, 'spawned', 'Bot ready!');
      this.botStartTimes.set(sessionId, Date.now());
      this.cancelReconnect(sessionId); // koneksi sehat → reset hitungan percobaan
      if (s?.renderDistance) this.#applyRenderDistance(sessionId, s.renderDistance);
      const t = setTimeout(() => {
        if (!live()) return;
        this.invCache.delete(sessionId);
        this.invRefreshing.delete(sessionId);
        this.openWindows.delete(sessionId);
        const inv = this.getInventory(sessionId);
        if (inv.ok) this.push(sessionId, 'inventory', inv);
        this.syncFeatures(sessionId);
        // Pastikan fitur persisten (auto hit/bow/schedule/anti-AFK) ikut hidup kembali setelah reconnect.
        const deadline = Date.now() + 30_000;
        const iv = setInterval(() => {
          if (!live() || Date.now() > deadline || this.featuresSettled(sessionId)) return clearInterval(iv);
          this.syncFeatures(sessionId);
        }, 3000);
        iv.unref?.();
      }, 1000);
      t.unref?.();
      if (!autoCommandsDone && s?.autoCommands?.length) {
        autoCommandsDone = true;
        this.runAutoCommands(sessionId, s.autoCommands);
      }
    });

    bot.on('death', () => {
      if (!live()) return;
      this.event(sessionId, 'death', 'Bot died! Respawning in 2s...');
      this.stopAllMovement(sessionId);
      if (this.openWindows.delete(sessionId)) this.push(sessionId, 'window', { type: 'close' });
      this.invCache.delete(sessionId);
      this.invRefreshing.delete(sessionId);
      if (this.sessions.get(sessionId)?.autoRespawn !== false) {
        clearTimeout(this.respawnTimers.get(sessionId));
        const t = setTimeout(() => {
          this.respawnTimers.delete(sessionId);
          if (!live() || bot._client?.destroyed) return;
          try {
            bot.respawn();
            this.event(sessionId, 'respawn', 'Bot respawned!');
          } catch (e) {
            logger.debug('Bot', 'respawn gagal', e?.message);
          }
        }, 2000);
        t.unref?.();
        this.respawnTimers.set(sessionId, t);
      }
    });

    bot.on('message', (jsonMsg) => {
      if (!live()) return;
      const text = jsonMsg?.toString?.();
      if (!text?.trim()) return;
      this.push(sessionId, 'chat', { raw: text, ts: Date.now() });
      logChat(sessionId, bot.username, text);
      this.checkGensEvent(sessionId, text);
    });
    bot.on('playerJoined', (p) => live() && this.event(sessionId, 'join', `${p.username} joined`));
    bot.on('playerLeft', (p) => live() && this.event(sessionId, 'leave', `${p.username} left`));

    bot.on('health', () => {
      if (!live()) return;
      this.push(sessionId, 'stats', {
        health: bot.health || 0,
        food: bot.food || 0,
        ping: bot.player?.ping ?? 0,
        uptime: this.getUptime(sessionId),
        saturation: bot.foodSaturation || 0,
      });
    });

    bot.on('playerCollect', () => {
      if (!live() || this.openWindows.has(sessionId)) return;
      setTimeout(() => {
        if (!live()) return;
        const inv = this.getInventory(sessionId);
        if (inv.ok) this.push(sessionId, 'inventory', inv);
      }, 300).unref?.();
    });

    bot.on('windowOpen', (win) => {
      if (!live()) return;
      if (!this.invCache.has(sessionId)) this.getInventory(sessionId);
      this.openWindows.set(sessionId, win);
      this.push(sessionId, 'window', { type: 'open', title: this.windowTitle(win), items: this.getWinItems(win), inventoryStart: win.inventoryStart ?? 27 });
    });
    bot.on('windowClose', () => {
      if (!live()) return;
      this.openWindows.delete(sessionId);
      this.push(sessionId, 'window', { type: 'close' });
      this.invRefreshing.add(sessionId);
      const t = setTimeout(() => {
        this.invRefreshing.delete(sessionId);
        this.invCache.delete(sessionId);
        if (!live()) return;
        const inv = this.getInventory(sessionId);
        if (inv.ok) this.push(sessionId, 'inventory', inv);
      }, 800);
      t.unref?.();
    });
  }

  /** Hentikan bot + semua timer runtime. remove=true juga menghapus data sesi. */
  cleanupBot(sessionId, { remove = false } = {}) {
    clearTimeout(this.connectTimers.get(sessionId));
    this.connectTimers.delete(sessionId);
    this.watchdogs.get(sessionId)?.();
    this.watchdogs.delete(sessionId);
    clearTimeout(this.respawnTimers.get(sessionId));
    this.respawnTimers.delete(sessionId);
    clearTimeout(this.invDebounce.get(sessionId));
    this.invDebounce.delete(sessionId);

    this.stopAllMovement(sessionId);
    this.stopAutoBow(sessionId, false);
    this.stopAutoHit(sessionId, false);
    this.stopCommandSchedule(sessionId, false);
    this.stopAntiAfk(sessionId, false);
    this.chatQueue.clear(sessionId);

    const bot = this.bots.get(sessionId);
    this.bots.delete(sessionId); // dihapus dulu → handler event bot lama menjadi no-op (live() false)
    if (bot) {
      try {
        if (bot._client && !bot._client.destroyed) bot.end('manual');
      } catch {
        /* sudah tertutup */
      }
    }
    if (this.openWindows.delete(sessionId)) this.push(sessionId, 'window', { type: 'close' });
    this.botStartTimes.delete(sessionId);
    this.invCache.delete(sessionId);
    this.invRefreshing.delete(sessionId);
    this.infoCache.delete(sessionId);
    this.autoSellState.delete(sessionId);
    this.lastStatsJson.delete(sessionId);
    this.disposeGens(sessionId);

    if (remove) {
      this.cancelReconnect(sessionId);
      this.connectJobs.delete(sessionId);
      this.sessions.delete(sessionId);
      this.db.delete(sessionId);
    }
  }

  // ───────────────────────── movement / world ─────────────────────────
  setMovement(sessionId, control, state) {
    const bot = this.bots.get(sessionId);
    if (!bot?.entity) return { ok: false, error: 'Bot not ready' };
    try {
      bot.setControlState(control, !!state);
      let set = this.movement.get(sessionId);
      if (!set) this.movement.set(sessionId, (set = new Set()));
      if (state) set.add(control);
      else set.delete(control);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  stopAllMovement(sessionId) {
    const bot = this.bots.get(sessionId);
    if (bot) {
      try {
        bot.clearControlStates();
      } catch {
        /* bot sedang menutup */
      }
    }
    this.movement.delete(sessionId);
  }

  getPosition(sessionId) {
    const bot = this.bots.get(sessionId);
    if (!bot?.entity) return null;
    const p = bot.entity.position;
    return { x: round1(p.x), y: round1(p.y), z: round1(p.z), yaw: bot.entity.yaw, pitch: bot.entity.pitch };
  }

  getNearbyEntitiesForMap(sessionId) {
    const bot = this.bots.get(sessionId);
    if (!bot?.entity) return [];
    const list = [];
    const me = bot.entity.position;
    for (const e of Object.values(bot.entities)) {
      if (e === bot.entity || !e.position) continue;
      const d = me.distanceTo(e.position);
      if (d > 128) continue;
      list.push({
        x: e.position.x,
        z: e.position.z,
        type: e.username ? 'player' : e.name === 'item' ? 'item' : 'mob',
        name: e.username || e.name || e.type || '',
        distance: Math.round(d),
      });
    }
    return list;
  }

  getNearbyEntities(sessionId) {
    const bot = this.bots.get(sessionId);
    if (!bot?.entity) return [];
    const me = bot.entity.position;
    const list = [];
    for (const [id, e] of Object.entries(bot.entities)) {
      if (e === bot.entity || e.type === 'object' || !e.position) continue;
      if (e.name?.includes('item')) continue;
      const d = me.distanceTo(e.position);
      if (d < 30) {
        list.push({ id: Number(id), type: e.type || 'unknown', name: e.username || e.name || 'entity', isPlayer: !!e.username, health: e.health, distance: round1(d) });
      }
    }
    return list.sort((a, b) => a.distance - b.distance);
  }

  manualAttack(sessionId, entityId) {
    const bot = this.bots.get(sessionId);
    if (!bot?.entity) return { ok: false, error: 'Bot not ready' };
    if (bot.health <= 0) return { ok: false, error: 'Bot is dead' };
    const entity = bot.entities[entityId];
    if (!entity) return { ok: false, error: 'Entity not found' };
    try {
      bot.lookAt(new this.deps.Vec3(entity.position.x, entity.position.y + 1.5, entity.position.z));
      setTimeout(() => {
        try {
          if (this.bots.get(sessionId) === bot) bot.attack(entity);
        } catch {
          /* target sudah hilang */
        }
      }, 100).unref?.();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ───────────────────────── chat ─────────────────────────
  sendChat(sessionId, message) {
    const bot = this.bots.get(sessionId);
    if (!bot) return { ok: false, error: 'Bot not found' };
    if (!bot.entity) return { ok: false, error: 'Bot not spawned' };
    if (bot.health <= 0) return { ok: false, error: 'Bot is dead' };
    try {
      bot.chat(message);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  /** Kirim lewat antrean (dipakai fitur otomatis) agar jeda antar pesan terjaga. */
  queueChat(sessionId, message, minGapMs = 1200) {
    return this.chatQueue.enqueue(
      sessionId,
      message,
      (msg) => {
        const bot = this.bots.get(sessionId);
        if (!bot?.entity) return { ok: false, error: 'Bot not ready' };
        if (bot.health <= 0) return { ok: false, error: 'Bot is dead' };
        bot.chat(msg);
        return { ok: true };
      },
      minGapMs,
    );
  }

  // ───────────────────────── info ─────────────────────────
  getUptime(sessionId) {
    const start = this.botStartTimes.get(sessionId);
    if (!start || !this.bots.has(sessionId)) return null;
    const ms = Date.now() - start;
    return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  }

  #standingBlock(bot) {
    try {
      return bot.blockAt(bot.entity.position.offset(0, -0.2, 0))?.name || null;
    } catch {
      return null;
    }
  }

  getInfo(sessionId) {
    const cached = this.infoCache.get(sessionId);
    if (cached && Date.now() - cached.ts < 900) return cached.data;
    const bot = this.bots.get(sessionId);
    const s = this.sessions.get(sessionId);
    if (!bot && !s) return null;

    const common = {
      sessionId,
      host: s?.host || 'unknown',
      port: s?.port || 25565,
      version: s?.version || null,
      autoHit: this.getAutoHitStatus(sessionId),
      autoBow: this.getAutoBowStatus(sessionId),
      commandSchedule: this.getCommandScheduleStatus(sessionId),
      autoSell: this.getAutoSellStatus(sessionId),
      antiAfk: this.getAntiAfkStatus(sessionId),
      rightClickMode: this.getRightClickMode(sessionId),
      autoReconnect: s?.autoReconnect !== false,
    };
    let data;
    if (bot?.entity) {
      const names = bot.players ? Object.keys(bot.players) : [];
      const prev = cached?.data?.players;
      const players = prev && names.length === prev.length
        ? prev
        : Object.values(bot.players || {}).map((p) => ({ name: p.username, ping: p.ping || 0 })).sort((a, b) => a.ping - b.ping).slice(0, 50);
      const v = bot.entity.velocity;
      data = {
        ...common,
        username: bot.username,
        health: round1(bot.health || 0),
        food: bot.food || 0,
        saturation: bot.foodSaturation ?? 0,
        ping: bot.player?.ping ?? 0,
        gamemode: bot.game?.gameMode ?? 'unknown',
        dimension: bot.game?.dimension ?? 'unknown',
        players,
        connected: true,
        isDead: bot.health <= 0,
        uptime: this.getUptime(sessionId),
        containerOpen: this.openWindows.has(sessionId),
        position: { x: round1(bot.entity.position.x), y: round1(bot.entity.position.y), z: round1(bot.entity.position.z) },
        onGround: !!bot.entity.onGround,
        velocity: v ? { x: Math.round(v.x * 100) / 100, y: Math.round(v.y * 100) / 100, z: Math.round(v.z * 100) / 100 } : null,
        standingOn: this.#standingBlock(bot),
      };
    } else {
      data = {
        ...common,
        username: s?.username || 'unknown',
        health: 0,
        food: 0,
        saturation: 0,
        ping: 0,
        gamemode: 'unknown',
        dimension: 'unknown',
        players: [],
        connected: false,
        isDead: false,
        uptime: null,
        containerOpen: false,
        position: null,
      };
    }
    this.infoCache.set(sessionId, { data, ts: Date.now() });
    return data;
  }

  /** Semua status fitur untuk satu sesi — dikirim ke klien yang baru subscribe. */
  getFeatureSnapshot(sessionId) {
    return {
      auto_hit_status: this.getAutoHitStatus(sessionId),
      auto_bow_status: this.getAutoBowStatus(sessionId),
      right_click_mode_status: { enabled: this.getRightClickMode(sessionId) },
      cmd_schedule_status: this.getCommandScheduleStatus(sessionId),
      auto_sell_status: this.getAutoSellStatus(sessionId),
      anti_afk_status: this.getAntiAfkStatus(sessionId),
      webhook_status: this.getWebhookStatus(sessionId),
      auto_commands_updated: { commands: this.getAutoCommands(sessionId) },
      render_distance_status: this.getRenderDistance(sessionId),
    };
  }
}

Object.assign(BotManager.prototype, combatMethods, automationMethods, inventoryMethods);
