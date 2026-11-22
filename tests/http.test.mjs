import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequestHandler, isNonFatalError, isSocketIoPath } from '../server/httpHandler.mjs';

const res = () => ({ headersSent: false, writeHead() { return this; }, end() {} });

test('REGRESSION: /socket.io requests never reach Next (caused ERR_HTTP_HEADERS_SENT crash)', () => {
  const seen = [];
  const h = createRequestHandler({ handle: (req) => seen.push(req.url), limiter: { take: () => true }, getIp: () => 'ip' });
  for (const url of ['/socket.io/?EIO=4&transport=polling', '/socket.io/', '/socket.io?EIO=4']) h({ url }, res());
  h({ url: '/' }, res());
  h({ url: '/api/health' }, res());
  assert.deepEqual(seen, ['/', '/api/health']);
  assert.equal(isSocketIoPath('/socket.iox'), false);
});

test('api rate limit returns 429; handler errors become 500 without throwing', async () => {
  let status;
  const r = { ...res(), writeHead(c) { status = c; return this; } };
  createRequestHandler({ handle: () => {}, limiter: { take: () => false }, getIp: () => 'ip' })({ url: '/api/health' }, r);
  assert.equal(status, 429);
  status = null;
  createRequestHandler({ handle: async () => { throw new Error('boom'); }, limiter: { take: () => true }, getIp: () => 'ip' })({ url: '/' }, r);
  await new Promise((x) => setImmediate(x));
  assert.equal(status, 500);
});

test('network-level errors are non-fatal, real bugs still are', () => {
  assert.equal(isNonFatalError({ code: 'ERR_HTTP_HEADERS_SENT' }), true);
  assert.equal(isNonFatalError({ code: 'ECONNRESET' }), true);
  assert.equal(isNonFatalError(new TypeError('x')), false);
});
