// Butuh paket sql.js (terpasang lewat npm install). Dilewati otomatis bila belum ada.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionDb } from '../server/db.mjs';

let hasSql = true;
try { await import('sql.js'); } catch { hasSql = false; }
const opts = { skip: hasSql ? false : 'sql.js tidak terpasang (jalankan npm install)' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'snowy-db-'));

test('save → flush → reload round trip, delete persists', opts, async () => {
  const dir = tmp();
  const a = new SessionDb({ dataDir: dir, flushDelayMs: 5 });
  await a.init();
  assert.equal(a.save('id1', { username: 'A', host: 'h', port: 1, version: '1.21.1' }), true);
  assert.equal(a.save('id2', { username: 'B', host: 'h', port: 1 }), true);
  a.delete('id2');
  a.close();
  const b = new SessionDb({ dataDir: dir });
  await b.init();
  const all = b.loadAll();
  assert.deepEqual([...all.keys()], ['id1']);
  assert.equal(all.get('id1').version, '1.21.1', 'stored version preserved');
  assert.equal(all.get('id1').autoReconnect, true);
  assert.equal(b.integrityCheck().ok, true);
  b.close();
});

test('corrupt main db falls back to .bak instead of losing sessions', opts, async () => {
  const dir = tmp();
  const a = new SessionDb({ dataDir: dir });
  await a.init();
  a.save('keep', { username: 'Keep', host: 'h', port: 1 });
  a.flush();
  a.save('keep2', { username: 'Keep2', host: 'h', port: 1 });
  a.flush(); // sekarang .bak berisi snapshot sebelumnya
  a.close();
  fs.writeFileSync(path.join(dir, 'sessions.db'), Buffer.from('this is not sqlite'));
  const b = new SessionDb({ dataDir: dir });
  await b.init();
  assert.ok(b.loadAll().has('keep'));
  assert.equal(b.getHealth().recoveredFromCorruption, true);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('sessions.db.corrupt-')), 'corrupt file quarantined, not deleted');
  b.close();
});

test('legacy persistent_sessions.json is migrated once', opts, async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'persistent_sessions.json'), JSON.stringify({ old1: { username: 'Old', host: 'h', port: 25565 } }));
  const a = new SessionDb({ dataDir: dir });
  await a.init();
  assert.ok(a.loadAll().has('old1'));
  assert.ok(fs.existsSync(path.join(dir, 'persistent_sessions.json.migrated')));
  a.close();
});
