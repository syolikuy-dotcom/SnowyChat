import test from 'node:test';
import assert from 'node:assert/strict';
import { makeManager, wait } from './helpers.mjs';

const base = { host: 'mc.test', port: 25565, username: 'Snowy', version: null, auth: 'offline' };

test('createSession connects with auto-detect version (no hard-coded 1.21.1)', async () => {
  const { manager, bots } = makeManager();
  const r = manager.createSession(base);
  assert.equal(r.ok, true);
  assert.equal(bots.length, 1);
  assert.equal('version' in bots[0].opts, false);
  assert.equal(bots[0].opts.host, 'mc.test');
  await manager.shutdown();
});

test('DEFAULT_MC_VERSION env is used when the session has no version; protocol errors hidden by default', async () => {
  const { manager, bots } = makeManager({ defaultMcVersion: '1.21.1' });
  manager.createSession(base);
  assert.equal(bots[0].opts.version, '1.21.1');
  assert.equal(bots[0].opts.hideErrors, true);
  await manager.shutdown();
});

test('explicit version is passed through', async () => {
  const { manager, bots } = makeManager();
  manager.createSession({ ...base, version: '1.20.4' });
  assert.equal(bots[0].opts.version, '1.20.4');
  await manager.shutdown();
});

test('REGRESSION: queued startup job is NOT dropped when a client subscribes meanwhile', async () => {
  const { manager, bots, db } = makeManager();
  for (const n of ['A_bot', 'B_bot', 'C_bot']) {
    const id = manager.generateSessionId();
    manager.sessions.set(id, { sessionId: id, host: 'h', port: 1, username: n, autoReconnect: true });
    db.save(id, manager.sessions.get(id));
  }
  manager.reconnectAllOnStartup();
  // simulate browser subscribing while jobs wait in the queue (used to swap callbacks and kill jobs)
  manager.getInfo([...manager.sessions.keys()][2]);
  manager.emit('push', 'x', 'noop', {});
  await wait(3300);
  assert.equal(bots.length, 3, 'all three queued sessions must connect');
  await manager.shutdown();
});

test('duplicate identity is rejected, max sessions enforced', async () => {
  const { manager } = makeManager({ maxSessions: 2 });
  assert.equal(manager.createSession(base).ok, true);
  assert.equal(manager.createSession(base).ok, false);
  assert.equal(manager.createSession({ ...base, username: 'Two' }).ok, true);
  const third = manager.createSession({ ...base, username: 'Three' });
  assert.equal(third.ok, false);
  assert.match(third.error, /Max 2/);
  await manager.shutdown();
});

test('kick produces exactly one status and schedules one reconnect', async () => {
  const { manager, bots, pushes } = makeManager();
  const { sessionId } = manager.createSession(base);
  const bot = bots[0];
  bot.spawn();
  pushes.length = 0;
  bot.emit('kicked', JSON.stringify({ text: 'You are banned' }));
  bot.emit('end', 'socketClosed'); // must be ignored: bot already cleaned up
  const statuses = pushes.filter((p) => p.event === 'status').map((p) => p.payload.type);
  assert.deepEqual(statuses, ['kicked', 'reconnecting']);
  assert.equal(manager.bots.has(sessionId), false);
  assert.ok(manager.reconnect.get(sessionId).timer);
  await manager.shutdown();
});

test('unexpected end triggers reconnect that creates a new bot', async () => {
  const { manager, bots } = makeManager();
  manager.createSession(base);
  bots[0].spawn();
  bots[0].emit('end', 'socketClosed');
  await wait(3300 + 1700);
  assert.equal(bots.length, 2);
  await manager.shutdown();
});

test('events from a stale bot instance are ignored', async () => {
  const { manager, bots, pushes } = makeManager();
  const { sessionId } = manager.createSession(base);
  bots[0].spawn();
  manager.disconnect(sessionId);
  pushes.length = 0;
  bots[0].emit('message', { toString: () => 'ghost' });
  bots[0].emit('kicked', 'x');
  assert.equal(pushes.filter((p) => p.event === 'chat' || p.event === 'status').length, 0);
  await manager.shutdown();
});

test('disconnect(remove) wipes all per-session state and the db row', async () => {
  const { manager, bots, db } = makeManager();
  const { sessionId } = manager.createSession(base);
  bots[0].spawn();
  manager.startAutoHit(sessionId, 100);
  manager.startAntiAfk(sessionId, {});
  manager.disconnect(sessionId, { remove: true });
  assert.equal(manager.sessions.has(sessionId), false);
  assert.equal(db.rows.has(sessionId), false);
  for (const m of ['autoHitTimers', 'antiAfkTimers', 'bots', 'infoCache', 'botStartTimes', 'reconnect', 'connectJobs']) assert.equal(manager[m].size, 0, m);
  assert.equal(manager.gens.buffers.size, 0);
  await manager.shutdown();
});

test('login timeout does not hang forever: error + reconnect scheduled', async (t) => {
  const { manager, pushes } = makeManager();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { sessionId } = manager.createSession(base);
  t.mock.timers.tick(46_000);
  assert.ok(pushes.some((p) => p.event === 'status' && /timeout/i.test(p.payload.message)));
  assert.ok(manager.reconnect.get(sessionId)?.timer);
  t.mock.timers.reset();
  await manager.shutdown();
});

test('auto hit delay is coerced: NaN/garbage never stored', async () => {
  const { manager, bots } = makeManager();
  const { sessionId } = manager.createSession(base);
  bots[0].spawn();
  assert.equal(manager.setAutoHitDelay(sessionId, 'abc'), 500);
  assert.equal(manager.setAutoHitDelay(sessionId, 1), 10);
  assert.equal(manager.setAutoHitDelay(sessionId, 99999), 1500);
  assert.equal(manager.startAutoHit(sessionId, undefined), true);
  assert.equal(manager.sessions.get(sessionId).autoHitDelay, 500);
  assert.equal(manager.setAutoBowRange(sessionId, 'x'), 3);
  await manager.shutdown();
});

test('armed auto-hit can be turned off before the bot is ready (used to stay armed forever)', async () => {
  const { manager } = makeManager();
  const { sessionId } = manager.createSession(base); // not spawned
  assert.equal(manager.startAutoHit(sessionId, 200), false);
  assert.equal(manager.getAutoHitStatus(sessionId).armed, true);
  manager.stopAutoHit(sessionId);
  assert.equal(manager.sessions.get(sessionId).autoHitEnabled, false);
  assert.equal(manager.getAutoHitStatus(sessionId).armed, false);
  await manager.shutdown();
});

test('render distance uses bot.setSettings and clamps', async () => {
  const { manager, bots } = makeManager();
  const { sessionId } = manager.createSession(base);
  bots[0].spawn();
  assert.equal(manager.setRenderDistance(sessionId, 99).distance, 5);
  assert.equal(manager.setRenderDistance(sessionId, 'zzz').distance, 4);
  assert.ok(bots[0].settings.some((s) => s.viewDistance === 5));
  await manager.shutdown();
});

test('chat: dead / unspawned bot rejected; auto features go through queue with spacing', async () => {
  const { manager, bots } = makeManager();
  const { sessionId } = manager.createSession(base);
  assert.equal(manager.sendChat(sessionId, 'hi').ok, false);
  bots[0].spawn();
  assert.equal(manager.sendChat(sessionId, 'hi').ok, true);
  const r1 = manager.queueChat(sessionId, '/a', 30);
  const r2 = manager.queueChat(sessionId, '/b', 30);
  await Promise.all([r1, r2]);
  assert.deepEqual(bots[0].chats, ['hi', '/a', '/b']);
  await manager.shutdown();
});

test('webhook url validated; autosell config sanitised', async () => {
  const { manager } = makeManager();
  const { sessionId } = manager.createSession(base);
  assert.equal(manager.setWebhookUrl(sessionId, 'https://evil.com/x').ok, false);
  assert.equal(manager.setWebhookUrl(sessionId, 'https://discord.com/api/webhooks/1/abc').ok, true);
  const r = manager.setAutoSellConfig(sessionId, { command: 'sell\n all', cooldownMs: 'x', inventoryThresholdPercent: 5000, triggerMode: 'bogus' });
  assert.equal(r.config.command, '/sell all');
  assert.equal(r.config.inventoryThresholdPercent, 100);
  assert.equal(r.config.triggerMode, 'both');
  assert.equal(r.config.cooldownMs, 5000);
  await manager.shutdown();
});

test('updateSessionConfig refuses while connected and on identity clash', async () => {
  const { manager } = makeManager();
  const a = manager.createSession(base);
  const b = manager.createSession({ ...base, username: 'Other' });
  assert.equal(manager.updateSessionConfig(a.sessionId, { host: 'x' }).ok, false);
  manager.disconnect(a.sessionId);
  manager.disconnect(b.sessionId);
  assert.equal(manager.updateSessionConfig(b.sessionId, { username: 'Snowy' }).ok, false, 'identity already saved by another session');
  assert.equal(manager.updateSessionConfig(b.sessionId, { username: 'Renamed' }).ok, true);
  await manager.shutdown();
});

test('shutdown flushes db and stops everything', async () => {
  const { manager, bots, db } = makeManager();
  manager.createSession(base);
  bots[0].spawn();
  const before = db.flushed;
  assert.equal(await manager.shutdown(), true);
  assert.ok(db.flushed > before);
  assert.equal(bots[0].ended, true);
  assert.equal(manager.bots.size, 0);
});
