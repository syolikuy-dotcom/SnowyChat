// Handler request HTTP untuk Next.js. Dipisah dari server.mjs agar bisa dites.
import { logger } from './logger.mjs';

/** Path yang ditangani Socket.IO/engine.io sendiri; TIDAK BOLEH ikut diproses Next. */
export const isSocketIoPath = (url = '') => url === '/socket.io' || url.startsWith('/socket.io/') || url.startsWith('/socket.io?');

export function createRequestHandler({ handle, limiter, getIp }) {
  return (req, res) => {
    // Bug sebelumnya: request polling Socket.IO juga diteruskan ke Next, sehingga dua handler
    // menulis header di response yang sama → ERR_HTTP_HEADERS_SENT dan proses crash.
    if (isSocketIoPath(req.url)) return;
    if (req.url?.startsWith('/api/') && !limiter.take(getIp(req))) {
      res.writeHead(429, { 'Content-Type': 'application/json' }).end('{"ok":false,"error":"Too Many Requests"}');
      return;
    }
    Promise.resolve(handle(req, res)).catch((e) => {
      logger.error('HTTP', 'Request handler error', e?.message);
      if (!res.headersSent) res.writeHead(500).end('Internal Server Error');
    });
  };
}

/** Error jaringan/HTTP yang tidak boleh mematikan seluruh bot. */
const NON_FATAL = new Set(['ERR_HTTP_HEADERS_SENT', 'ECONNRESET', 'EPIPE', 'ERR_STREAM_WRITE_AFTER_END', 'ERR_STREAM_DESTROYED']);
export const isNonFatalError = (err) => NON_FATAL.has(err?.code);
