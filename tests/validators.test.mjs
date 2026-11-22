import test from 'node:test';
import assert from 'node:assert/strict';
import * as v from '../server/validators.mjs';

test('session id', () => {
  assert.equal(v.parseSessionId('a'.repeat(32)).ok, true);
  for (const bad of [undefined, null, 5, {}, '', 'xyz', '../etc', 'a'.repeat(100)]) assert.equal(v.parseSessionId(bad).ok, false);
});
test('username/host/port', () => {
  assert.equal(v.parseUsername('Steve_1').ok, true);
  for (const bad of ['ab', 'a'.repeat(17), 'a b c', 5, null, 'bad;rm']) assert.equal(v.parseUsername(bad).ok, false);
  assert.equal(v.parseHost('mc.example.com').ok, true);
  for (const bad of ['', ' ', 'a/b', 5, 'x'.repeat(300), 'host name']) assert.equal(v.parseHost(bad).ok, false);
  assert.equal(v.parsePort(undefined).value, 25565);
  assert.equal(v.parsePort('25566').value, 25566);
  for (const bad of [0, 70000, 1.5, 'abc', NaN]) assert.equal(v.parsePort(bad).ok, false);
});
test('version: empty/auto -> null (auto-detect)', () => {
  assert.equal(v.parseVersion('').value, null);
  assert.equal(v.parseVersion('auto').value, null);
  assert.equal(v.parseVersion(undefined).value, null);
  assert.equal(v.parseVersion('1.21.4').value, '1.21.4');
  assert.equal(v.parseVersion('latest').ok, false);
  assert.equal(v.parseVersion(12).ok, false);
});
test('chat message', () => {
  assert.equal(v.parseChatMessage('hi').ok, true);
  for (const bad of ['', '   ', 5, 'x'.repeat(257), 'a\u0000b', 'a\nb']) assert.equal(v.parseChatMessage(bad).ok, false);
});
test('numbers are coerced, never NaN', () => {
  assert.equal(v.clampInt('abc', 1, 5, 3), 3);
  assert.equal(v.clampInt(99, 1, 5, 3), 5);
  assert.equal(v.clampInt(undefined, 1, 5, 3), 3);
  assert.equal(v.parseSlot('7').value, 7);
  assert.equal(v.parseSlot(99).ok, false);
  assert.equal(v.parseCount(0).ok, true);
  assert.equal(v.parseCount('x').ok, false);
  assert.equal(v.toBool('false'), false);
  assert.equal(v.toBool('true'), true);
});
test('controls / destination / item', () => {
  assert.equal(v.parseControl('forward').ok, true);
  assert.equal(v.parseControl('__proto__').ok, false);
  assert.equal(v.parseDestination('off-hand').ok, true);
  assert.equal(v.parseDestination('pocket').ok, false);
  assert.equal(v.parseItemName('diamond_sword').ok, true);
  assert.equal(v.parseItemName('a;b').ok, false);
});
test('webhook url', () => {
  assert.equal(v.parseWebhookUrl('https://discord.com/api/webhooks/123456/abc-DEF_1').ok, true);
  assert.equal(v.parseWebhookUrl('').value, '');
  for (const bad of ['http://discord.com/api/webhooks/1/a', 'https://evil.com/api/webhooks/1/a', 'https://discord.com.evil.com/api/webhooks/1/a']) assert.equal(v.parseWebhookUrl(bad).ok, false);
});
test('command lists are sanitised and capped', () => {
  const list = Array.from({ length: 30 }, (_, i) => ({ cmd: `/c${i}\n`, delay: 'x', intervalMs: 1 }));
  const a = v.parseCommandList(list, { withDelay: true });
  assert.equal(a.length, 10);
  assert.equal(a[0].cmd, '/c0');
  assert.equal(a[0].delay, 0);
  const s = v.parseCommandList([{ cmd: '/x', intervalMs: 10 }, null, 'str'], { withDelay: false });
  assert.deepEqual(s, [{ cmd: '/x', intervalMs: 5000 }]);
});
