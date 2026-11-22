import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachSocket, isPrivateAddress, makeAllowRequest, makeAuthMiddleware, resolvesToPrivate } from '../server/socket.mjs';
import { createRateLimiter } from '../server/rateLimit.mjs';
import { makeManager } from './helpers.mjs';

function fakeIo() {
  const io = new EventEmitter();
  io.emitted = [];
  io.middlewares = [];
  io.use = (fn) => io.middlewares.push(fn);
  const chain = (rooms) => ({ to: (r) => chain([...rooms, r]), emit: (ev, p) => io.emitted.push({ rooms, ev, p }) });
  io.to = (r) => chain([r]);
  io.in = () => ({ socketsLeave() {} });
  const baseEmit = io.emit.bind(io);
  io.emit = (ev, p) => (ev === 'connection' ? baseEmit(ev, p) : io.emitted.push({ rooms: ['*'], ev, p }));
  return io;
}
function fakeSocket() {
  const incoming = new EventEmitter();
  const s = {
    out: [],
    rooms: new Set(),
    handshake: { auth: {} },
    on: (ev, fn) => incoming.on(ev, fn),
    eventNames: () => incoming.eventNames(),
    join: (r) => s.rooms.add(r),
    leave: (r) => s.rooms.delete(r),
    emit: (ev, p) => s.out.push({ ev, p }),
    fire: async (ev, ...args) => {
      for (const l of incoming.listeners(ev)) l(...args);
      await new Promise((r) => setImmediate(r));
    },
  };
  return s;
}
async function setup(cfg = {}) {
  const ctx = makeManager();
  const io = fakeIo();
  attachSocket(io, ctx.manager, { config: { ...ctx.config, accessToken: '', ...cfg }, ping: async () => ({ description: 'hi', players: { online: 1, max: 2 }, version: { name: '1.21' } }) });
  const socket = fakeSocket();
  io.emit('connection', socket);
  return { ...ctx, io, socket };
}

test('REGRESSION: every handler survives undefined / garbage payloads (used to crash the process)', async () => {
  const { socket, manager } = await setup();
  const events = [...socket.eventNames()].filter((e) => String(e).startsWith('mc:'));
  assert.ok(events.length > 40, `only ${events.length} handlers registered`);
  const garbage = [undefined, null, 5, 'str', [], [1], { sessionId: 5 }, { sessionId: {} }, { __proto__: null }, { sessionId: 'a'.repeat(32), host: {}, port: [], username: 5 }];
  let uncaught = null;
  const onUncaught = (e) => (uncaught = e);
  process.once('uncaughtException', onUncaught);
  for (const ev of events) for (const g of garbage) await socket.fire(ev, g, () => {});
  process.off('uncaughtException', onUncaught);
  assert.equal(uncaught, null);
  assert.equal(manager.sessions.size, 0, 'garbage must never create a session');
});

test('mc:connect validates and creates a session; client joins its room', async () => {
  const { socket, manager, bots } = await setup();
  await socket.fire('mc:connect', { host: 'mc.test', username: 'ab' });
  assert.ok(socket.out.some((o) => o.ev === 'status' && /3–16/.test(o.p.message)));
  await socket.fire('mc:connect', { host: 'mc.test', username: 'Snowy', port: 99999 });
  assert.equal(manager.sessions.size, 0);
  await socket.fire('mc:connect', { host: 'mc.test', username: 'Snowy', port: 25565, version: '' });
  assert.equal(manager.sessions.size, 1);
  assert.equal(bots.length, 1);
  const created = socket.out.find((o) => o.ev === 'session_created');
  assert.ok(created);
  assert.ok(socket.rooms.has(`s:${created.p.sessionId}`));
});

test('unknown session ids produce an error, not a leaked room', async () => {
  const { socket } = await setup();
  await socket.fire('mc:subscribe', { sessionId: 'f'.repeat(32) });
  assert.equal(socket.rooms.size, 0);
  assert.ok(socket.out.some((o) => o.ev === 'status' && o.p.type === 'error'));
});

test('subscribe sends info + snapshot of every feature status with sessionId', async () => {
  const { socket, manager, bots } = await setup();
  await socket.fire('mc:connect', { host: 'mc.test', username: 'Snowy' });
  bots[0].spawn();
  socket.out.length = 0;
  const sid = [...manager.sessions.keys()][0];
  await socket.fire('mc:subscribe', { sessionId: sid });
  const evs = socket.out.map((o) => o.ev);
  for (const e of ['info', 'stats', 'auto_hit_status', 'auto_bow_status', 'right_click_mode_status', 'cmd_schedule_status', 'auto_sell_status', 'anti_afk_status', 'webhook_status', 'auto_commands_updated', 'render_distance_status']) assert.ok(evs.includes(e), `missing ${e}`);
  for (const o of socket.out.filter((x) => x.ev.endsWith('_status'))) assert.equal(o.p.sessionId, sid, `${o.ev} lacks sessionId`);
});

test('chat is routed to session room + chat room; chat cooldown and echo', async () => {
  const { socket, manager, bots, io } = await setup();
  await socket.fire('mc:connect', { host: 'mc.test', username: 'Snowy' });
  bots[0].spawn();
  const sid = [...manager.sessions.keys()][0];
  io.emitted.length = 0;
  await socket.fire('mc:chat', { sessionId: sid, message: 'hello' });
  await socket.fire('mc:chat', { sessionId: sid, message: 'again' });
  assert.deepEqual(bots[0].chats, ['hello']);
  const echo = io.emitted.find((e) => e.ev === 'chat');
  assert.deepEqual(echo.rooms, [`s:${sid}`, `c:${sid}`]);
  assert.equal(echo.p.self, true);
  assert.ok(socket.out.some((o) => o.ev === 'status' && /too fast/i.test(o.p.message)));
});

test('mc:subscribe_chat only joins existing sessions and prunes others', async () => {
  const { socket, manager } = await setup();
  await socket.fire('mc:connect', { host: 'a.test', username: 'AAA' });
  await socket.fire('mc:connect', { host: 'b.test', username: 'BBB' });
  const [a, b] = [...manager.sessions.keys()];
  await socket.fire('mc:subscribe_chat', { sessionIds: [a, b, 'f'.repeat(32), 5, null] });
  assert.deepEqual([...socket.rooms].filter((r) => r.startsWith('c:')).sort(), [`c:${a}`, `c:${b}`].sort());
  await socket.fire('mc:subscribe_chat', { sessionIds: [] });
  assert.equal([...socket.rooms].filter((r) => r.startsWith('c:')).length, 0);
});

test('rate limit protects against floods', async () => {
  const { socket } = await setup();
  for (let i = 0; i < 200; i++) await socket.fire('mc:list_bots', {});
  assert.ok(socket.out.some((o) => o.ev === 'status' && /rate limit/i.test(o.p.message)));
});

test('mc:ping blocks private/localhost/DNS-to-private, allows public', async () => {
  const { socket } = await setup();
  for (const host of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.1.1', '169.254.169.254', '::1', '0.0.0.0']) {
    socket.out.length = 0;
    await new Promise((r) => setTimeout(r, 2050));
    await socket.fire('mc:ping', { host });
    await new Promise((r) => setTimeout(r, 20));
    const res = socket.out.find((o) => o.ev === 'ping_result');
    assert.equal(res?.p.ok, false, host);
  }
});

test('isPrivateAddress / resolvesToPrivate', async () => {
  for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.1', '169.254.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1']) assert.equal(isPrivateAddress(a), true, a);
  for (const a of ['8.8.8.8', '172.32.0.1', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPrivateAddress(a), false, a);
  assert.equal(await resolvesToPrivate('evil.example', async () => [{ address: '10.0.0.1' }]), true);
  assert.equal(await resolvesToPrivate('ok.example', async () => [{ address: '8.8.8.8' }]), false);
  assert.equal(await resolvesToPrivate('mixed.example', async () => [{ address: '8.8.8.8' }, { address: '127.0.0.1' }]), true);
});

test('access token middleware (timing-safe)', () => {
  assert.equal(makeAuthMiddleware(''), null);
  const mw = makeAuthMiddleware('s3cret');
  let err;
  mw({ handshake: { auth: { token: 's3cret' } } }, (e) => (err = e));
  assert.equal(err, undefined);
  mw({ handshake: { auth: { token: 'nope' } } }, (e) => (err = e));
  assert.match(err.message, /unauthorized/);
  mw({ handshake: { auth: {} } }, (e) => (err = e));
  assert.match(err.message, /unauthorized/);
  mw({ handshake: {} }, (e) => (err = e));
  assert.match(err.message, /unauthorized/);
});

test('cross-site WebSocket hijacking is blocked; same-origin and non-browser allowed', () => {
  const check = (cfg, headers) => { let out; makeAllowRequest({ allowedOrigins: '', publicUrl: '', ...cfg })({ headers }, (e, ok) => (out = ok)); return out; };
  assert.equal(check({}, { host: 'localhost:24650' }), true);
  assert.equal(check({}, { host: 'localhost:24650', origin: 'http://localhost:24650' }), true);
  assert.equal(check({}, { host: '192.168.1.5:24650', origin: 'https://evil.com' }), false);
  assert.equal(check({}, { host: 'a', origin: 'not a url' }), false);
  assert.equal(check({ allowedOrigins: 'https://panel.example.com' }, { host: 'x', origin: 'https://panel.example.com' }), true);
  assert.equal(check({ publicUrl: 'https://snowy.example.com' }, { host: 'internal:1', origin: 'https://snowy.example.com' }), true);
  assert.equal(check({ allowedOrigins: '*' }, { host: 'x', origin: 'https://anything' }), true);
});

test('http rate limiter window', () => {
  const rl = createRateLimiter({ windowMs: 60000, max: 3 });
  assert.deepEqual([1, 2, 3, 4].map(() => rl.take('ip')), [true, true, true, false]);
  assert.equal(rl.take('other'), true);
  rl.stop();
});
