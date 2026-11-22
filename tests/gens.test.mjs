import test from 'node:test';
import assert from 'node:assert/strict';
import { GensEventParser } from '../server/gensEvents.mjs';
import { applySessionDefaults } from '../server/sessionDefaults.mjs';
import { ChatQueue } from '../server/chatQueue.mjs';
import { wait } from './helpers.mjs';

const ctx = { eventWatchEnabled: true, sellTriggerOn: false, keyword: 'sell' };
function make() {
  const events = [];
  const loose = [];
  const p = new GensEventParser({ emit: (sid, e) => (events.push(e), false), looseSell: (sid, k) => loose.push(k), bufferMs: 20, dedupeMs: 50 });
  return { p, events, loose };
}

test('single-line event start/end with multiplier', () => {
  const { p, events } = make();
  p.feed('s', '§aSell Multiplier has started! x2', ctx);
  p.feed('s', 'Sell Multiplier has ended', ctx);
  assert.equal(events.length, 2);
  assert.deepEqual([events[0].eventName, events[0].action, events[0].multiplier], ['Sell Multiplier', 'started', '2']);
  assert.equal(events[1].action, 'ended');
});
test('NextGens box format, reversed line order', async () => {
  const { p, events } = make();
  for (const l of ['Duration: 5m', 'Type: 2x Sell Multiplier', 'Event Started']) p.feed('s', l, ctx);
  await wait(60);
  assert.equal(events.length, 1);
  assert.deepEqual([events[0].eventName, events[0].multiplier, events[0].duration, events[0].action], ['Sell Multiplier', '2', '5m', 'started']);
});
test('duplicate lines within dedupe window are ignored; disabled watch ignores all', () => {
  const { p, events } = make();
  p.feed('s', 'Drop Multiplier started x3', ctx);
  p.feed('s', 'Drop Multiplier started x3', ctx);
  assert.equal(events.length, 1);
  p.feed('s', 'Sell Multiplier started', { ...ctx, eventWatchEnabled: false });
  assert.equal(events.length, 1);
});
test('loose keyword only when sell trigger on', () => {
  const { p, loose } = make();
  p.feed('s', 'The sell hour is active now', ctx);
  assert.equal(loose.length, 0);
  p.feed('s', 'The sell hour is active now!', { ...ctx, sellTriggerOn: true });
  assert.deepEqual(loose, ['sell']);
});
test('dispose clears buffers', () => {
  const { p } = make();
  p.feed('s', 'Event Started', ctx);
  p.dispose('s');
  assert.equal(p.buffers.size, 0);
});

test('stored version is preserved; values clamped; runtime keys stripped', () => {
  const s = applySessionDefaults({ version: '1.21.1', autoHitDelay: 'abc', autoBowRange: 99, renderDistance: 0, _reconnecting: true, antiAfkConfig: { minIntervalSec: 100, maxIntervalSec: 5 } });
  assert.equal(s.version, '1.21.1');
  assert.equal(s.autoHitDelay, 500);
  assert.equal(s.autoBowRange, 5);
  assert.equal(s.renderDistance, 2);
  assert.equal('_reconnecting' in s, false);
  assert.ok(s.antiAfkConfig.maxIntervalSec >= s.antiAfkConfig.minIntervalSec);
  const keep = applySessionDefaults({ version: '1.20.4', _schemaVersion: 4 });
  assert.equal(keep.version, '1.20.4');
  assert.equal(applySessionDefaults({}).version, null);
  assert.equal(applySessionDefaults(null).autoReconnect, true);
});

test('chat queue spaces messages and clear() resolves pending', async () => {
  const q = new ChatQueue();
  const sent = [];
  const t0 = Date.now();
  const a = q.enqueue('s', 'a', (m) => (sent.push([m, Date.now() - t0]), { ok: true }), 40);
  const b = q.enqueue('s', 'b', (m) => (sent.push([m, Date.now() - t0]), { ok: true }), 40);
  const c = q.enqueue('s', 'c', () => ({ ok: true }), 40);
  await a; await b;
  assert.ok(sent[1][1] - sent[0][1] >= 30);
  q.clear('s', 'gone');
  assert.deepEqual(await c, { ok: false, error: 'gone' });
});
