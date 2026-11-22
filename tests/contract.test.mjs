// Menjamin klien (src/) dan server (server/) tidak pernah diam-diam tidak sinkron.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const walk = (dir, exts, out = []) => {
  for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) walk(rel, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(rel);
  }
  return out;
};
const listFrom = (src, name) => [...new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`).exec(src)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

const events = read('src/lib/events.ts');
const CLIENT = listFrom(events, 'CLIENT_EVENTS');
const SERVER = listFrom(events, 'SERVER_EVENTS');
const serverSrc = walk('server', ['.mjs']).map((f) => read(f)).join('\n');

test('every client event has a server handler', () => {
  const registered = new Set([...serverSrc.matchAll(/(?:on|onSession)\(\s*'(mc:[a-z_]+)'/g)].map((m) => m[1]));
  const missing = CLIENT.filter((e) => !registered.has(e));
  assert.deepEqual(missing, []);
});

test('every server handler is declared in CLIENT_EVENTS (no dead/undocumented handlers)', () => {
  const registered = [...serverSrc.matchAll(/(?:on|onSession)\(\s*'(mc:[a-z_]+)'/g)].map((m) => m[1]);
  const extra = registered.filter((e) => !CLIENT.includes(e) && !['mc:get_map', 'mc:auto_hit_status', 'mc:auto_bow_status', 'mc:right_click_mode_status', 'mc:cmd_schedule_status', 'mc:auto_sell_status', 'mc:anti_afk_status', 'mc:webhook_status', 'mc:get_render_distance', 'mc:get_auto_commands', 'mc:get_container_items', 'mc:db_health'].includes(e));
  assert.deepEqual(extra, []);
});

test('every event the client listens to is actually emitted by the server', () => {
  const emitted = (ev) => new RegExp(`['"]${ev}['"]`).test(serverSrc);
  assert.deepEqual(SERVER.filter((e) => !emitted(e)), []);
});

test('every handler registered in the bridge is a declared SERVER_EVENT (or socket lifecycle)', () => {
  const bridge = read('src/lib/use-socket-bridge.ts');
  const body = bridge.slice(bridge.indexOf('const handlers'), bridge.indexOf('for (const [ev, fn]'));
  const names = [...body.matchAll(/^\s{6}([a-z_]+):/gm)].map((m) => m[1]);
  const lifecycle = ['connect', 'disconnect', 'connect_error'];
  assert.deepEqual(names.filter((n) => !SERVER.includes(n) && !lifecycle.includes(n)), []);
  assert.deepEqual(SERVER.filter((n) => !names.includes(n)), [], 'SERVER_EVENTS without a client handler');
});

test('every mc:* string used by UI code is a declared CLIENT_EVENT', () => {
  const used = new Set();
  for (const f of walk('src', ['.ts', '.tsx'])) {
    if (f.endsWith('events.ts')) continue;
    for (const m of read(f).matchAll(/'(mc:[a-z_]+)'/g)) used.add(m[1]);
  }
  assert.deepEqual([...used].filter((e) => !CLIENT.includes(e)), []);
});

test('payload field names used by UI match what the server validates', () => {
  const ui = walk('src', ['.tsx', '.ts']).map(read).join('\n');
  // contoh field kritikal yang pernah/bisa salah nama
  for (const [event, field] of [['mc:withdraw', 'itemName'], ['mc:set_cmd_schedules', 'schedules'], ['mc:set_auto_commands', 'commands'], ['mc:set_webhook', 'url'], ['mc:auto_sell_set_config', 'config'], ['mc:subscribe_chat', 'sessionIds'], ['mc:disconnect', 'deleteFromStorage']]) {
    assert.ok(new RegExp(`${event}[^\\n]*${field}`).test(ui), `UI does not send ${field} for ${event}`);
    assert.ok(serverSrc.includes(`p.${field}`), `server does not read p.${field}`);
  }
});

test('package.json: all runtime imports are declared dependencies (e.g. vec3 was missing before)', () => {
  const pkg = JSON.parse(read('package.json'));
  const declared = new Set([...Object.keys(pkg.dependencies), ...Object.keys(pkg.devDependencies)]);
  const builtin = new Set(['fs', 'path', 'os', 'http', 'net', 'dns', 'crypto', 'events', 'child_process', 'module', 'url', 'util']);
  const files = [...walk('server', ['.mjs']), 'server.mjs', 'index.js', ...walk('src', ['.ts', '.tsx'])];
  const missing = new Set();
  for (const f of files) {
    for (const m of read(f).matchAll(/(?:from\s+|import\(\s*|require\(\s*)['"]([^'"./][^'"]*)['"]/g)) {
      const spec = m[1];
      if (spec.startsWith('node:') || spec.startsWith('@/')) continue;
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (!builtin.has(name) && !declared.has(name)) missing.add(`${name} (in ${f})`);
    }
  }
  assert.deepEqual([...missing], []);
});
