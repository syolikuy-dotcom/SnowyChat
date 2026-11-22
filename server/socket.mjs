// Lapisan Socket.IO: validasi input, room per sesi, rate limit, auth token, cek Origin.
// Kontrak event (nama + payload) harus sinkron dengan src/lib/events.ts — dites di tests/contract.test.mjs.
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { logger } from './logger.mjs';
import {
  isPlainObject,
  parseAuth,
  parseChatMessage,
  parseControl,
  parseCount,
  parseDestination,
  parseEntityId,
  parseHost,
  parseItemName,
  parsePort,
  parseSessionId,
  parseSlot,
  parseUsername,
  parseVersion,
  toBool,
} from './validators.mjs';

const sessionRoom = (sid) => `s:${sid}`;
const chatRoom = (sid) => `c:${sid}`;
const PING_COOLDOWN_MS = 2000;
const CHAT_COOLDOWN_MS = 600;

export function isPrivateAddress(addr) {
  if (net.isIPv4(addr)) {
    const [a, b] = addr.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(addr)) {
    const v = addr.toLowerCase();
    if (v === '::1' || v === '::') return true;
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd')) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  return true; // bukan IP valid → perlakukan sebagai tidak aman
}

export async function resolvesToPrivate(host, lookup = (h) => dns.lookup(h, { all: true })) {
  if (/^localhost$/i.test(host)) return true;
  if (net.isIP(host)) return isPrivateAddress(host);
  const addrs = await lookup(host);
  return addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address));
}

/** Cek Origin WebSocket. CORS saja TIDAK melindungi WebSocket dari situs lain (cross-site WS hijacking). */
export function makeAllowRequest(config) {
  const allowed = config.allowedOrigins === '*' ? '*' : config.allowedOrigins.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  let publicHost = null;
  try {
    if (config.publicUrl) publicHost = new URL(config.publicUrl).host.toLowerCase();
  } catch {
    /* PUBLIC_URL tidak valid, abaikan */
  }
  return (req, cb) => {
    const origin = req.headers.origin;
    if (!origin) return cb(null, true); // klien non-browser
    if (allowed === '*') return cb(null, true);
    let originHost;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return cb('Bad origin', false);
    }
    const host = String(req.headers.host || '').toLowerCase();
    if (originHost === host || (publicHost && originHost === publicHost)) return cb(null, true);
    if (allowed.length && allowed.some((o) => o === origin.toLowerCase() || o === originHost)) return cb(null, true);
    logger.warn('Security', `WebSocket ditolak dari origin asing: ${origin}`);
    return cb('Origin not allowed', false);
  };
}

export function makeAuthMiddleware(token) {
  if (!token) return null;
  const want = crypto.createHash('sha256').update(token).digest();
  return (socket, next) => {
    const got = crypto.createHash('sha256').update(String(socket.handshake.auth?.token ?? '')).digest();
    if (crypto.timingSafeEqual(want, got)) return next();
    next(new Error('unauthorized'));
  };
}

/**
 * @param {import('socket.io').Server} io
 * @param {import('./botManager.mjs').BotManager} manager
 * @param {{ config: object, ping?: Function }} opts
 */
export function attachSocket(io, manager, { config, ping }) {
  const auth = makeAuthMiddleware(config.accessToken);
  if (auth) io.use(auth);

  manager.on('push', (sid, event, payload) => {
    const target = event === 'chat' ? io.to(sessionRoom(sid)).to(chatRoom(sid)) : io.to(sessionRoom(sid));
    target.emit(event, payload);
  });
  manager.on('broadcast', (event, payload) => io.emit(event, payload));

  const chatCooldowns = new Map();
  const broadcastSessions = () => io.emit('persistent_sessions', manager.getAllSessions());
  const toast = (sid, type, message) => manager.status(sid, type, message);

  io.on('connection', (socket) => {
    socket.emit('persistent_sessions', manager.getAllSessions());
    socket.emit('db_health', manager.getDbHealth());

    const bucket = { tokens: 60, max: 60, perSec: 30, last: Date.now() };
    const allow = () => {
      const now = Date.now();
      bucket.tokens = Math.min(bucket.max, bucket.tokens + ((now - bucket.last) / 1000) * bucket.perSec);
      bucket.last = now;
      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    };
    const say = (type, message, sessionId) => socket.emit('status', { type, message, ts: Date.now(), ...(sessionId ? { sessionId } : {}) });

    /** Daftarkan handler. Payload non-object dipaksa {} → handler tidak pernah crash karena destructuring. */
    const on = (event, handler) => {
      socket.on(event, async (payload, ack) => {
        try {
          if (!allow()) return say('warn', 'Rate limit exceeded, slow down');
          await handler(isPlainObject(payload) ? payload : {}, typeof ack === 'function' ? ack : () => {});
        } catch (e) {
          logger.error('Socket', `Handler ${event} error`, e?.stack || e?.message || String(e));
          say('error', 'Internal error');
        }
      });
    };

    /** Handler yang membutuhkan sessionId valid & ada. quiet=true: tidak menampilkan error (untuk polling). */
    const onSession = (event, handler, { quiet = false } = {}) =>
      on(event, async (p, ack) => {
        const id = parseSessionId(p.sessionId);
        if (!id.ok) return quiet ? undefined : say('error', id.error);
        if (!manager.hasSession(id.value)) return quiet ? undefined : say('error', 'Session not found');
        return handler(id.value, p, ack);
      });

    const err = (sid, r) => say('error', r.error, sid);
    const info = (sid, message) => manager.push(sid, 'status', { type: 'info', message, ts: Date.now() });

    // ───── sesi ─────
    on('mc:connect', (p) => {
      const host = parseHost(p.host);
      if (!host.ok) return say('error', host.error);
      const username = parseUsername(p.username);
      if (!username.ok) return say('error', username.error);
      const port = parsePort(p.port);
      if (!port.ok) return say('error', port.error);
      const version = parseVersion(p.version);
      if (!version.ok) return say('error', version.error);
      const authMode = parseAuth(p.auth);
      if (!authMode.ok) return say('error', authMode.error);

      say('connecting', `Creating bot ${username.value}...`);
      const r = manager.createSession({ host: host.value, port: port.value, username: username.value, version: version.value, auth: authMode.value });
      if (!r.ok) return say('error', r.error);
      socket.join(sessionRoom(r.sessionId));
      socket.emit('session_created', { sessionId: r.sessionId, username: username.value, host: host.value, port: port.value });
      broadcastSessions();
    });

    onSession('mc:reconnect', (sid) => {
      socket.join(sessionRoom(sid));
      const s = manager.getSessionById(sid);
      if (manager.isConnected(sid)) {
        say('spawned', `Bot ${s.username} connected`, sid);
        const i = manager.getInfo(sid);
        if (i) socket.emit('info', i);
        return;
      }
      say('connecting', `Reconnecting ${s.username}...`, sid);
      const r = manager.connect(sid);
      if (!r.ok) err(sid, r);
      broadcastSessions();
    });

    onSession('mc:subscribe', (sid) => {
      socket.join(sessionRoom(sid));
      const i = manager.getInfo(sid);
      if (!i) return say('error', 'Session not found');
      socket.emit('info', i);
      if (manager.isConnected(sid)) {
        say('spawned', `Bot ${i.username} connected`, sid);
        socket.emit('stats', { health: i.health, food: i.food, ping: i.ping, uptime: i.uptime, saturation: i.saturation, sessionId: sid });
        const inv = manager.getInventory(sid);
        if (inv.ok) socket.emit('inventory', { ...inv, sessionId: sid });
        if (i.containerOpen) {
          const ci = manager.getContainerItems(sid);
          if (ci.ok) socket.emit('container_items', { ...ci, sessionId: sid });
        }
      } else {
        say('disconnected', `Bot ${i.username} offline`, sid);
      }
      for (const [ev, payload] of Object.entries(manager.getFeatureSnapshot(sid))) socket.emit(ev, { ...payload, sessionId: sid });
    });

    on('mc:unsubscribe', (p) => {
      const id = parseSessionId(p.sessionId);
      if (id.ok) socket.leave(sessionRoom(id.value));
    });

    // Mode "All Chat": hanya menerima chat (bukan map/inventory) dari sesi lain.
    on('mc:subscribe_chat', (p) => {
      const wanted = new Set(
        (Array.isArray(p.sessionIds) ? p.sessionIds : [])
          .slice(0, 50)
          .map((x) => parseSessionId(x))
          .filter((x) => x.ok && manager.hasSession(x.value))
          .map((x) => x.value),
      );
      for (const room of socket.rooms) if (room.startsWith('c:') && !wanted.has(room.slice(2))) socket.leave(room);
      for (const sid of wanted) socket.join(chatRoom(sid));
    });

    onSession('mc:disconnect', (sid, p) => {
      const remove = toBool(p.deleteFromStorage);
      manager.disconnect(sid, { remove });
      if (remove) {
        chatCooldowns.delete(sid);
        io.in(sessionRoom(sid)).socketsLeave(sessionRoom(sid));
        io.in(chatRoom(sid)).socketsLeave(chatRoom(sid));
      }
      say(remove ? 'deleted' : 'disconnected', remove ? 'Bot deleted' : 'Bot disconnected', sid);
      broadcastSessions();
    });

    on('mc:connect_all', () => {
      const n = manager.connectAll();
      say('info', n ? `Connecting ${n} bot(s), queued sequentially...` : 'All bots already connected');
      setTimeout(broadcastSessions, 500).unref?.();
    });
    on('mc:disconnect_all', () => {
      const n = manager.disconnectAll();
      say('info', n ? `Disconnected ${n} bot(s)` : 'No bots are connected');
      broadcastSessions();
    });
    on('mc:list_bots', () => socket.emit('persistent_sessions', manager.getAllSessions()));
    on('mc:db_health', () => socket.emit('db_health', manager.getDbHealth()));
    on('mc:check_username', (p, ack) => {
      const u = parseUsername(p.username);
      const h = parseHost(p.host);
      const port = parsePort(p.port);
      ack({ available: u.ok && h.ok && port.ok ? manager.checkUsernameAvailable(u.value, h.value, port.value) : false });
    });

    onSession('mc:update_session', (sid, p) => {
      const patch = {};
      if (p.username !== undefined) {
        const u = parseUsername(p.username);
        if (!u.ok) return say('error', u.error);
        patch.username = u.value;
      }
      if (p.host !== undefined) {
        const h = parseHost(p.host);
        if (!h.ok) return say('error', h.error);
        patch.host = h.value;
      }
      if (p.port !== undefined) {
        const po = parsePort(p.port);
        if (!po.ok) return say('error', po.error);
        patch.port = po.value;
      }
      if (p.version !== undefined) {
        const v = parseVersion(p.version);
        if (!v.ok) return say('error', v.error);
        patch.version = v.value;
      }
      const r = manager.updateSessionConfig(sid, patch);
      if (!r.ok) return say('error', r.error);
      socket.emit('session_updated', { sessionId: sid, ...r.session });
      say('info', 'Session updated', sid);
      broadcastSessions();
    });

    // ───── info / chat ─────
    onSession('mc:info', (sid) => {
      const i = manager.getInfo(sid);
      if (i) socket.emit('info', i);
    }, { quiet: true });

    onSession('mc:chat', (sid, p) => {
      const msg = parseChatMessage(p.message);
      if (!msg.ok) return say('error', msg.error, sid);
      const now = Date.now();
      if (now - (chatCooldowns.get(sid) || 0) < CHAT_COOLDOWN_MS) return say('warn', 'Chat too fast, slow down!', sid);
      chatCooldowns.set(sid, now);
      const r = manager.sendChat(sid, msg.value);
      if (!r.ok) return err(sid, r);
      manager.push(sid, 'chat', { raw: `[You] ${msg.value}`, ts: now, self: true });
    });

    // ───── gerak / peta ─────
    onSession('mc:move', (sid, p) => {
      const c = parseControl(p.control);
      if (!c.ok) return say('error', c.error, sid);
      const r = manager.setMovement(sid, c.value, toBool(p.state));
      if (!r.ok) say('warn', r.error, sid);
    });
    onSession('mc:stop_movement', (sid) => manager.stopAllMovement(sid));
    onSession('mc:get_map', (sid) => socket.emit('map_data', { pos: manager.getPosition(sid), entities: manager.getNearbyEntitiesForMap(sid), sessionId: sid }), { quiet: true });
    onSession('mc:get_entities', (sid) => socket.emit('entities_list', { entities: manager.getNearbyEntities(sid), sessionId: sid }), { quiet: true });
    onSession('mc:attack', (sid, p) => {
      const id = parseEntityId(p.entityId);
      if (!id.ok) return say('error', id.error, sid);
      const r = manager.manualAttack(sid, id.value);
      if (!r.ok) err(sid, r);
    });

    // ───── combat ─────
    const pushStatus = (sid, event, payload) => manager.push(sid, event, payload);

    onSession('mc:auto_hit_start', (sid, p) => {
      if (manager.autoBowTimers.has(sid)) {
        manager.stopAutoBow(sid);
        pushStatus(sid, 'auto_bow_status', manager.getAutoBowStatus(sid));
      }
      const started = manager.startAutoHit(sid, p.delay);
      pushStatus(sid, 'auto_hit_status', manager.getAutoHitStatus(sid));
      info(sid, started ? 'Auto Hit enabled' : 'Auto Hit armed — will start once the bot is ready');
    });
    onSession('mc:auto_hit_stop', (sid) => {
      manager.stopAutoHit(sid);
      pushStatus(sid, 'auto_hit_status', manager.getAutoHitStatus(sid));
      info(sid, 'Auto Hit disabled');
    });
    onSession('mc:auto_hit_status', (sid) => socket.emit('auto_hit_status', { ...manager.getAutoHitStatus(sid), sessionId: sid }), { quiet: true });
    onSession('mc:auto_hit_delay', (sid, p) => {
      manager.setAutoHitDelay(sid, p.delay);
      pushStatus(sid, 'auto_hit_status', manager.getAutoHitStatus(sid));
    });
    onSession('mc:auto_respawn', (sid, p) => manager.setAutoRespawn(sid, toBool(p.enabled)));

    onSession('mc:auto_bow_start', (sid, p) => {
      if (manager.autoHitTimers.has(sid)) {
        manager.stopAutoHit(sid);
        pushStatus(sid, 'auto_hit_status', manager.getAutoHitStatus(sid));
      }
      const r = manager.startAutoBow(sid, p.range);
      pushStatus(sid, 'auto_bow_status', manager.getAutoBowStatus(sid));
      if (r.ok) info(sid, 'Auto Bow enabled');
      else say('error', r.error || 'Cannot start auto bow', sid);
    });
    onSession('mc:auto_bow_stop', (sid) => {
      manager.stopAutoBow(sid);
      pushStatus(sid, 'auto_bow_status', manager.getAutoBowStatus(sid));
      info(sid, 'Auto Bow disabled');
    });
    onSession('mc:auto_bow_status', (sid) => socket.emit('auto_bow_status', { ...manager.getAutoBowStatus(sid), sessionId: sid }), { quiet: true });
    onSession('mc:auto_bow_range', (sid, p) => {
      manager.setAutoBowRange(sid, p.range);
      pushStatus(sid, 'auto_bow_status', manager.getAutoBowStatus(sid));
    });

    onSession('mc:right_click_mode', (sid, p) => {
      const v = manager.setRightClickMode(sid, toBool(p.enabled));
      pushStatus(sid, 'right_click_mode_status', { enabled: v });
      info(sid, v ? 'Right-click mode enabled' : 'Right-click mode disabled');
    });
    onSession('mc:right_click_mode_status', (sid) => socket.emit('right_click_mode_status', { enabled: manager.getRightClickMode(sid), sessionId: sid }), { quiet: true });

    // ───── otomasi ─────
    onSession('mc:cmd_schedule_start', (sid) => {
      const r = manager.startCommandSchedule(sid);
      pushStatus(sid, 'cmd_schedule_status', manager.getCommandScheduleStatus(sid));
      if (r.ok) info(sid, 'Command Schedule enabled');
      else say('error', r.error || 'Cannot start command schedule', sid);
    });
    onSession('mc:cmd_schedule_stop', (sid) => {
      manager.stopCommandSchedule(sid);
      pushStatus(sid, 'cmd_schedule_status', manager.getCommandScheduleStatus(sid));
      info(sid, 'Command Schedule disabled');
    });
    onSession('mc:cmd_schedule_status', (sid) => socket.emit('cmd_schedule_status', { ...manager.getCommandScheduleStatus(sid), sessionId: sid }), { quiet: true });
    onSession('mc:set_cmd_schedules', (sid, p) => {
      const saved = manager.setCommandSchedules(sid, p.schedules);
      pushStatus(sid, 'cmd_schedule_status', manager.getCommandScheduleStatus(sid));
      info(sid, `Command Schedule: ${saved.length} perintah disimpan`);
    });

    onSession('mc:auto_sell_enable', (sid, p) => {
      const r = manager.setAutoSellEnabled(sid, toBool(p.enabled));
      if (!r.ok) return err(sid, r);
      pushStatus(sid, 'auto_sell_status', manager.getAutoSellStatus(sid));
      info(sid, r.enabled ? 'Auto Sell enabled' : 'Auto Sell disabled');
    });
    onSession('mc:auto_sell_set_config', (sid, p) => {
      const r = manager.setAutoSellConfig(sid, p.config);
      if (!r.ok) return err(sid, r);
      pushStatus(sid, 'auto_sell_status', manager.getAutoSellStatus(sid));
    });
    onSession('mc:auto_sell_status', (sid) => socket.emit('auto_sell_status', { ...manager.getAutoSellStatus(sid), sessionId: sid }), { quiet: true });

    onSession('mc:anti_afk_start', (sid, p) => {
      const r = manager.startAntiAfk(sid, { minIntervalSec: p.minIntervalSec, maxIntervalSec: p.maxIntervalSec });
      if (!r.ok) {
        pushStatus(sid, 'anti_afk_status', manager.getAntiAfkStatus(sid));
        return err(sid, r);
      }
      pushStatus(sid, 'anti_afk_status', manager.getAntiAfkStatus(sid));
    });
    onSession('mc:anti_afk_stop', (sid) => manager.stopAntiAfk(sid));
    onSession('mc:anti_afk_status', (sid) => socket.emit('anti_afk_status', { ...manager.getAntiAfkStatus(sid), sessionId: sid }), { quiet: true });

    onSession('mc:event_watch_toggle', (sid, p) => {
      const r = manager.setEventWatchEnabled(sid, toBool(p.enabled));
      if (!r.ok) return err(sid, r);
      pushStatus(sid, 'webhook_status', manager.getWebhookStatus(sid));
      info(sid, r.enabled ? 'Event Watch enabled' : 'Event Watch disabled');
    });
    onSession('mc:set_webhook', (sid, p) => {
      const r = manager.setWebhookUrl(sid, p.url);
      if (!r.ok) return err(sid, r);
      pushStatus(sid, 'webhook_status', manager.getWebhookStatus(sid));
      say('info', r.webhookUrl ? 'Webhook tersimpan' : 'Webhook dihapus', sid);
    });
    onSession('mc:webhook_status', (sid) => socket.emit('webhook_status', { ...manager.getWebhookStatus(sid), sessionId: sid }), { quiet: true });
    onSession('mc:test_webhook', async (sid, p) => {
      const r = await manager.testWebhook(sid, p.url);
      socket.emit('webhook_test_result', { ...r, sessionId: sid });
    });

    onSession('mc:set_render_distance', (sid, p) => {
      const r = manager.setRenderDistance(sid, p.distance);
      if (!r.ok) return err(sid, r);
      pushStatus(sid, 'render_distance_status', { distance: r.distance });
      info(sid, `Render distance diset ke ${r.distance} chunks`);
    });
    onSession('mc:get_render_distance', (sid) => socket.emit('render_distance_status', { ...manager.getRenderDistance(sid), sessionId: sid }), { quiet: true });

    onSession('mc:set_auto_commands', (sid, p) => {
      const saved = manager.setAutoCommands(sid, p.commands);
      pushStatus(sid, 'auto_commands_updated', { commands: saved });
      info(sid, `Auto Commands: ${saved.length} command disimpan`);
    });
    onSession('mc:get_auto_commands', (sid) => socket.emit('auto_commands_updated', { commands: manager.getAutoCommands(sid), sessionId: sid }), { quiet: true });
    onSession('mc:run_auto_commands_now', (sid) => {
      const commands = manager.getAutoCommands(sid);
      if (!commands.length) return say('warn', 'Tidak ada auto command', sid);
      manager.runAutoCommands(sid, commands);
      say('info', 'Auto Commands dijalankan manual', sid);
    });
    onSession('mc:set_auto_reconnect', (sid, p) => {
      const r = manager.setAutoReconnect(sid, toBool(p.enabled));
      say('info', `Auto-reconnect ${r.enabled ? 'enabled' : 'disabled'}`, sid);
      broadcastSessions();
    });

    // ───── inventory & container ─────
    const pushInventory = (sid) => {
      const inv = manager.getInventory(sid);
      if (inv.ok) manager.push(sid, 'inventory', inv);
    };
    onSession('mc:get_inventory', (sid) => {
      const inv = manager.getInventory(sid);
      if (inv.ok) socket.emit('inventory', { ...inv, sessionId: sid });
      else if (!['Bot not ready', 'Refreshing', 'Container open'].includes(inv.error)) say('warn', `Inventory unavailable: ${inv.error}`, sid);
    }, { quiet: true });
    onSession('mc:equip', async (sid, p) => {
      const slot = parseSlot(p.slot);
      const dest = parseDestination(p.destination);
      if (!slot.ok) return say('error', slot.error, sid);
      if (!dest.ok) return say('error', dest.error, sid);
      const r = await manager.equipItem(sid, slot.value, dest.value);
      if (!r.ok) return err(sid, r);
      pushInventory(sid);
      info(sid, r.message);
    });
    onSession('mc:unequip', async (sid, p) => {
      const dest = parseDestination(p.destination);
      if (!dest.ok) return say('error', dest.error, sid);
      const r = await manager.unequipItem(sid, dest.value);
      if (!r.ok) return err(sid, r);
      pushInventory(sid);
    });
    onSession('mc:drop_item', async (sid, p) => {
      const slot = parseSlot(p.slot);
      const count = parseCount(p.count);
      if (!slot.ok) return say('error', slot.error, sid);
      if (!count.ok) return say('error', count.error, sid);
      const r = await manager.dropItem(sid, slot.value, count.value);
      if (!r.ok) return err(sid, r);
      pushInventory(sid);
      info(sid, r.message);
    });
    onSession('mc:select_slot', (sid, p) => {
      const slot = parseSlot(p.slot, 0, 8);
      if (!slot.ok) return say('error', slot.error, sid);
      const r = manager.selectHotbarSlot(sid, slot.value);
      if (!r.ok) return err(sid, r);
      pushInventory(sid);
    });

    onSession('mc:open_chest', async (sid, p) => {
      const r = await manager.openNearestContainer(sid, p.maxDistance);
      if (!r.ok) return say(r.warn ? 'warn' : 'error', r.error, sid);
      say('info', r.message, sid);
    });
    onSession('mc:close_container', async (sid) => {
      await manager.closeContainer(sid);
      manager.push(sid, 'window', { type: 'close' });
      info(sid, 'Container closed');
    });
    onSession('mc:get_container_items', (sid) => socket.emit('container_items', { ...manager.getContainerItems(sid), sessionId: sid }), { quiet: true });
    onSession('mc:withdraw', async (sid, p) => {
      const name = parseItemName(p.itemName);
      const count = parseCount(p.count);
      if (!name.ok) return say('error', name.error, sid);
      if (!count.ok) return say('error', count.error, sid);
      const r = await manager.withdrawFromContainer(sid, name.value, count.value);
      if (!r.ok) return err(sid, r);
      manager.push(sid, 'container_items', { ok: true, items: r.items });
      info(sid, r.message);
      pushInventory(sid);
    });
    onSession('mc:deposit', async (sid, p) => {
      const slot = parseSlot(p.slot);
      const count = parseCount(p.count);
      if (!slot.ok) return say('error', slot.error, sid);
      if (!count.ok) return say('error', count.error, sid);
      const r = await manager.depositToContainer(sid, slot.value, count.value);
      if (!r.ok) return err(sid, r);
      manager.push(sid, 'container_items', { ok: true, items: r.items });
      info(sid, r.message);
      pushInventory(sid);
    });

    // ───── ping server ─────
    let lastPing = 0;
    on('mc:ping', async (p) => {
      const host = parseHost(p.host);
      if (!host.ok) return socket.emit('ping_result', { ok: false, error: 'Invalid host' });
      const port = parsePort(p.port);
      if (!port.ok) return socket.emit('ping_result', { ok: false, error: 'Invalid port' });
      const now = Date.now();
      if (now - lastPing < PING_COOLDOWN_MS) return socket.emit('ping_result', { ok: false, error: 'Too fast, wait 2s' });
      lastPing = now;
      try {
        if (!config.allowPrivatePing && (await resolvesToPrivate(host.value))) {
          return socket.emit('ping_result', { ok: false, error: 'Private hosts not allowed' });
        }
      } catch {
        return socket.emit('ping_result', { ok: false, error: 'Host not found' });
      }
      try {
        const r = await ping({ host: host.value, port: port.value, timeout: 5000 });
        const motd = typeof r.description === 'string' ? r.description : r.description?.text || '';
        socket.emit('ping_result', {
          ok: true,
          motd: motd.replace(/§[0-9a-fk-or]/gi, ''),
          players: r.players?.online ?? 0,
          maxPlayers: r.players?.max ?? 0,
          version: r.version?.name || '?',
        });
      } catch {
        socket.emit('ping_result', { ok: false, error: 'Server not responding' });
      }
    });

    socket.on('disconnect', () => {
      /* keanggotaan room dibersihkan otomatis oleh Socket.IO */
    });
  });
}
