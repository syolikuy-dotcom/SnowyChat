// Persistensi sesi di SQLite (sql.js, WASM, tanpa native build) + backup & recovery.
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.mjs';
import { applySessionDefaults } from './sessionDefaults.mjs';

export class SessionDb {
  /**
   * @param {{ dataDir: string, loadSqlJs?: () => Promise<any>, flushDelayMs?: number }} opts
   */
  constructor({ dataDir, loadSqlJs, flushDelayMs = 300 }) {
    this.file = path.join(dataDir, 'sessions.db');
    this.bakFile = path.join(dataDir, 'sessions.db.bak');
    this.legacyJson = path.join(dataDir, 'persistent_sessions.json');
    this.loadSqlJs = loadSqlJs || (async () => (await import('sql.js')).default());
    this.flushDelayMs = flushDelayMs;
    this.db = null;
    this.flushTimer = null;
    this.health = {
      ready: false,
      lastFlushAt: null,
      lastFlushOk: null,
      lastVerifyAt: null,
      lastVerifyOk: null,
      lastIntegrityCheckAt: null,
      lastIntegrityCheckOk: null,
      pendingFlush: false,
      recoveredFromCorruption: false,
      writeFailCount: 0,
    };
  }

  #quarantine(reason) {
    try {
      if (!fs.existsSync(this.file)) return null;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const target = path.join(path.dirname(this.file), `sessions.db.corrupt-${stamp}`);
      fs.renameSync(this.file, target);
      logger.fatal('DB', `Database tampak korup (${reason}), dipindah ke ${path.basename(target)}`);
      return target;
    } catch (e) {
      logger.fatal('DB', 'Gagal mengarantina database korup', e.message);
      return null;
    }
  }

  #tryOpen(SQL, file) {
    const db = new SQL.Database(fs.readFileSync(file));
    db.exec('SELECT COUNT(*) FROM sqlite_master');
    return db;
  }

  async init() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const SQL = await this.loadSqlJs();
    let loaded = false;

    if (fs.existsSync(this.file)) {
      try {
        this.db = this.#tryOpen(SQL, this.file);
        loaded = true;
      } catch (e) {
        this.#quarantine(e.message);
        this.db = null;
      }
    }
    if (!loaded && fs.existsSync(this.bakFile)) {
      try {
        this.db = this.#tryOpen(SQL, this.bakFile);
        loaded = true;
        this.health.recoveredFromCorruption = true;
        logger.warn('DB', 'Database utama rusak, dipulihkan dari backup (sessions.db.bak)');
      } catch (e) {
        logger.fatal('DB', 'Backup database juga tidak bisa dibaca', e.message);
        this.db = null;
      }
    }
    if (!this.db) {
      this.db = new SQL.Database();
      if (fs.existsSync(this.file) || fs.existsSync(this.bakFile)) {
        logger.fatal('DB', 'Mulai dengan database kosong. Sesi lama mungkin hilang — cek file sessions.db.corrupt-*');
      }
    }

    // updated_at disimpan dalam milidetik (versi lama mencampur detik & milidetik).
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT 0
      )
    `);
    this.integrityCheck();
    this.flush();
    this.health.ready = true;
    this.#migrateLegacyJson();
  }

  #migrateLegacyJson() {
    if (!fs.existsSync(this.legacyJson)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.legacyJson, 'utf8'));
      const stmt = this.db.prepare('INSERT OR IGNORE INTO sessions (id, data, updated_at) VALUES (?, ?, ?)');
      let count = 0;
      for (const [id, s] of Object.entries(parsed)) {
        stmt.run([id, JSON.stringify(s), Date.now()]);
        count++;
      }
      stmt.free();
      this.flush();
      fs.renameSync(this.legacyJson, `${this.legacyJson}.migrated`);
      logger.info('DB', `Memigrasi ${count} sesi dari JSON ke SQLite`);
    } catch (e) {
      logger.error('DB', 'Migrasi JSON gagal', e.message);
    }
  }

  integrityCheck() {
    if (!this.db) return { ok: false, error: 'DB not initialized' };
    try {
      const verdict = this.db.exec('PRAGMA integrity_check')?.[0]?.values?.[0]?.[0];
      const structurallyOk = verdict === 'ok';
      let badRows = 0;
      const rows = this.db.exec('SELECT id, data FROM sessions');
      if (rows.length) {
        for (const [id, dataStr] of rows[0].values) {
          try {
            JSON.parse(dataStr);
          } catch {
            badRows++;
            logger.error('DB', `Baris korup untuk sesi ${String(id).slice(0, 8)}…, data bukan JSON valid`);
          }
        }
      }
      const ok = structurallyOk && badRows === 0;
      this.health.lastIntegrityCheckAt = Date.now();
      this.health.lastIntegrityCheckOk = ok;
      if (!ok) logger.error('DB', `Integrity check gagal (struktur: ${structurallyOk ? 'ok' : verdict}, baris korup: ${badRows})`);
      return { ok, structurallyOk, badRows };
    } catch (e) {
      this.health.lastIntegrityCheckAt = Date.now();
      this.health.lastIntegrityCheckOk = false;
      logger.error('DB', 'Integrity check melempar error', e.message);
      return { ok: false, error: e.message };
    }
  }

  /** Tulis atomik: file sementara lalu rename, supaya crash tidak meninggalkan DB setengah jadi. */
  flush() {
    if (!this.db) return false;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    try {
      const data = this.db.export();
      if (fs.existsSync(this.file)) {
        try {
          fs.copyFileSync(this.file, this.bakFile);
        } catch {
          /* backup best-effort */
        }
      }
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, data, { mode: 0o600 });
      fs.renameSync(tmp, this.file);
      this.health.lastFlushAt = Date.now();
      this.health.lastFlushOk = true;
      this.health.pendingFlush = false;
      return true;
    } catch (e) {
      this.health.lastFlushAt = Date.now();
      this.health.lastFlushOk = false;
      logger.fatal('DB', 'Flush ke disk gagal, sesi mungkin tidak tersimpan', e.message);
      return false;
    }
  }

  #scheduleFlush() {
    this.health.pendingFlush = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, this.flushDelayMs);
    this.flushTimer.unref?.();
  }

  loadAll() {
    const result = new Map();
    if (!this.db) return result;
    try {
      const rows = this.db.exec('SELECT id, data FROM sessions');
      if (!rows.length) return result;
      for (const [id, dataStr] of rows[0].values) {
        try {
          result.set(id, applySessionDefaults(JSON.parse(dataStr)));
        } catch {
          /* baris korup sudah dilaporkan integrityCheck */
        }
      }
    } catch (e) {
      logger.error('DB', 'Load gagal', e.message);
    }
    return result;
  }

  save(sessionId, sessionData) {
    if (!this.db) return false;
    const payload = JSON.stringify(sessionData);
    const attempt = () => {
      this.db.run('INSERT OR REPLACE INTO sessions (id, data, updated_at) VALUES (?, ?, ?)', [sessionId, payload, Date.now()]);
      return this.db.exec('SELECT data FROM sessions WHERE id = ?', [sessionId])?.[0]?.values?.[0]?.[0] === payload;
    };
    try {
      let ok = attempt();
      if (!ok) {
        logger.warn('DB', `Verifikasi tulis gagal untuk ${sessionId.slice(0, 8)}…, mencoba ulang`);
        ok = attempt();
      }
      this.health.lastVerifyAt = Date.now();
      this.health.lastVerifyOk = ok;
      if (!ok) {
        this.health.writeFailCount++;
        logger.fatal('DB', `Verifikasi tulis gagal dua kali untuk ${sessionId.slice(0, 8)}…`);
      }
      this.#scheduleFlush();
      return ok;
    } catch (e) {
      this.health.writeFailCount++;
      logger.error('DB', 'Save gagal', e.message);
      return false;
    }
  }

  delete(sessionId) {
    if (!this.db) return false;
    try {
      this.db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
      const stillExists = !!this.db.exec('SELECT id FROM sessions WHERE id = ?', [sessionId])?.[0]?.values?.length;
      if (stillExists) {
        logger.fatal('DB', `Verifikasi hapus gagal untuk ${sessionId.slice(0, 8)}…, baris masih ada`);
        this.health.writeFailCount++;
      }
      this.#scheduleFlush();
      return !stillExists;
    } catch (e) {
      this.health.writeFailCount++;
      logger.error('DB', 'Delete gagal', e.message);
      return false;
    }
  }

  count() {
    try {
      return this.db?.exec('SELECT COUNT(*) FROM sessions')?.[0]?.values?.[0]?.[0] ?? null;
    } catch {
      return null;
    }
  }

  getHealth() {
    let fileSizeBytes = null;
    try {
      fileSizeBytes = fs.statSync(this.file).size;
    } catch {
      /* belum ada file */
    }
    return { ...this.health, fileSizeBytes, sessionCountInDb: this.count() };
  }

  close() {
    const ok = this.flush();
    try {
      this.db?.close();
    } catch {
      /* ignore */
    }
    this.db = null;
    return ok;
  }
}
