import { EventEmitter } from 'node:events';
import { BotManager } from '../server/botManager.mjs';
import { readConfig } from '../server/env.mjs';

export class FakeDb {
  constructor() { this.rows = new Map(); this.flushed = 0; this.ready = true; }
  async init() {}
  loadAll() { return new Map([...this.rows].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))])); }
  save(id, data) { this.rows.set(id, JSON.parse(JSON.stringify(data))); return true; }
  delete(id) { this.rows.delete(id); return true; }
  flush() { this.flushed++; return true; }
  count() { return this.rows.size; }
  integrityCheck() { return { ok: true }; }
  getHealth() { return { ready: true, lastFlushOk: true, lastIntegrityCheckOk: true, writeFailCount: 0, recoveredFromCorruption: false, sessionCountInDb: this.rows.size }; }
  close() { this.flush(); return true; }
}

export class Vec3 {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
  distanceTo(o) { return Math.hypot(this.x - o.x, this.y - o.y, this.z - o.z); }
  offset(x, y, z) { return new Vec3(this.x + x, this.y + y, this.z + z); }
  plus(o) { return new Vec3(this.x + o.x, this.y + o.y, this.z + o.z); }
  scaled(f) { return new Vec3(this.x * f, this.y * f, this.z * f); }
  equals(o) { return this.x === o.x && this.y === o.y && this.z === o.z; }
}

export class FakeBot extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts;
    this.username = opts.username;
    this.entity = null;
    this.health = 20;
    this.food = 20;
    this.entities = {};
    this.players = {};
    this.chats = [];
    this.ended = false;
    this.settings = [];
    this.inventory = { items: () => [], slots: [] };
    this._client = new EventEmitter();
    this._client.destroyed = false;
  }
  chat(m) { this.chats.push(m); }
  end(reason) { this.ended = true; this._client.destroyed = true; this.emit('end', reason); }
  setSettings(s) { this.settings.push(s); }
  setControlState() {}
  clearControlStates() {}
  swingArm() {}
  lookAt() {}
  attack() {}
  deactivateItem() {}
  spawn() {
    this.entity = { position: new Vec3(0, 64, 0), yaw: 0, pitch: 0, onGround: true, velocity: new Vec3(0, 0, 0) };
    this.emit('login');
    this.emit('spawn');
  }
}

export function makeManager(overrides = {}) {
  const bots = [];
  const config = { ...readConfig({}), maxSessions: 4, chatLogDisabled: true, ...overrides };
  const db = new FakeDb();
  const manager = new BotManager({
    config,
    db,
    deps: { createBot: (o) => { const b = new FakeBot(o); bots.push(b); return b; }, Vec3 },
  });
  const pushes = [];
  manager.on('push', (sid, event, payload) => pushes.push({ sid, event, payload }));
  manager.sessions = new Map();
  return { manager, bots, db, pushes, config };
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
