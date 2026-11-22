// Entry point: Next.js (UI + API route) + Socket.IO + BotManager dalam satu proses.
//   npm run dev    → mode development (HMR, restart otomatis saat file server/ berubah)
//   npm run start  → mode production (butuh `npm run build` dulu)
import http from 'node:http';
import os from 'node:os';
import { loadEnv, readConfig } from './server/env.mjs';

loadEnv();
// Harus ditetapkan SEBELUM `next` di-import, karena Next membaca NODE_ENV saat load.
const dev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
process.env.NODE_ENV = dev ? 'development' : 'production';

const config = { ...readConfig(), dev };
const { logger } = await import('./server/logger.mjs');
const { configureChatLogger } = await import('./server/chatLogger.mjs');
const { SessionDb } = await import('./server/db.mjs');
const { BotManager } = await import('./server/botManager.mjs');
const { attachSocket, makeAllowRequest } = await import('./server/socket.mjs');
const { createRateLimiter, clientIp } = await import('./server/rateLimit.mjs');
const { createRequestHandler, isNonFatalError } = await import('./server/httpHandler.mjs');
const { Server } = await import('socket.io');
const { default: next } = await import('next');

configureChatLogger({ dataDir: config.dataDir, disabled: config.chatLogDisabled });

function detectLanIp() {
  if (config.displayHost) return config.displayHost;
  for (const list of Object.values(os.networkInterfaces())) {
    for (const iface of list || []) if (iface.family === 'IPv4' && !iface.internal) return iface.address;
  }
  return 'localhost';
}

const apiLimiter = createRateLimiter({ windowMs: 60_000, max: 300 });
const httpServer = http.createServer();
const app = next({ dev, hostname: config.bindHost === '0.0.0.0' ? 'localhost' : config.bindHost, port: config.port, httpServer });
const handle = app.getRequestHandler();

const manager = new BotManager({ config, db: new SessionDb({ dataDir: config.dataDir }) });
// Dibaca oleh route handler Next (mis. /api/health); proses & modul graph berbeda, jadi lewat globalThis.
globalThis.__snowychat = { manager, config };

const io = new Server(httpServer, {
  cors: config.allowedOrigins ? { origin: config.allowedOrigins === '*' ? '*' : config.allowedOrigins.split(',').map((s) => s.trim()) } : undefined,
  allowRequest: makeAllowRequest(config),
  pingTimeout: 60_000,
  pingInterval: 25_000,
  maxHttpBufferSize: 1e5,
});

try {
  await Promise.all([app.prepare(), manager.init()]);
} catch (e) {
  logger.fatal('SnowyChat', 'Gagal start', e?.stack || e?.message || String(e));
  process.exit(1);
}

const { default: mc } = await import('minecraft-protocol');
attachSocket(io, manager, { config, ping: (opts) => mc.ping(opts) });

httpServer.on('request', createRequestHandler({ handle, limiter: apiLimiter, getIp: (req) => clientIp(req, config.trustProxy) }));

httpServer.on('error', (e) => {
  logger.fatal('SnowyChat', e.code === 'EADDRINUSE' ? `Port ${config.port} sudah dipakai proses lain` : e.message);
  process.exit(1);
});

httpServer.listen(config.port, config.bindHost, () => {
  console.log('\n❄️  SnowyChat — AFK Bot Control');
  console.log('───────────────────────────────');
  console.log(`🖥️  Local    http://localhost:${config.port}`);
  console.log(`🌐  Network  http://${detectLanIp()}:${config.port}`);
  console.log(`⚙️  Mode     ${dev ? 'development' : 'production'}`);
  console.log('⏹️  Ctrl+C to stop\n');
  if (!config.accessToken && config.bindHost !== '127.0.0.1' && config.bindHost !== 'localhost') {
    logger.warn('Security', 'ACCESS_TOKEN belum di-set: siapa pun yang bisa menjangkau port ini dapat mengendalikan bot. Set ACCESS_TOKEN di .env, atau BIND_HOST=127.0.0.1.');
  }
  manager.reconnectAllOnStartup();
});

let shuttingDown = false;
async function shutdown(signal, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('SnowyChat', `${signal} diterima, menyimpan database lalu keluar…`);
  const force = setTimeout(() => process.exit(1), 8000);
  force.unref();
  try {
    io.close();
    const flushed = await manager.shutdown();
    if (!flushed) logger.fatal('SnowyChat', 'Flush database gagal saat shutdown, perubahan terakhir mungkin hilang');
    process.exit(flushed ? code : 1);
  } catch (e) {
    logger.fatal('SnowyChat', 'Error saat shutdown', e?.message);
    process.exit(1);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (err) => {
  if (isNonFatalError(err)) return logger.warn('SnowyChat', `Error jaringan diabaikan (${err.code}), server tetap jalan`);
  logger.fatal('SnowyChat', 'Uncaught exception, mencoba flush database darurat', err?.stack || err?.message || String(err));
  try {
    manager.flushDbNow();
  } catch {
    /* sudah di jalur fatal */
  }
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('SnowyChat', 'Unhandled promise rejection', reason?.stack || reason?.message || String(reason));
});
