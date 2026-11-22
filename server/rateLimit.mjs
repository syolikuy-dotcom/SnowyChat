// Rate limiter fixed-window sederhana per IP.
export function clientIp(req, trustProxy = false) {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    const first = typeof fwd === 'string' ? fwd.split(',')[0]?.trim() : '';
    if (first) return first;
  }
  return req.socket?.remoteAddress || 'unknown';
}

export function createRateLimiter({ windowMs = 60_000, max = 120 } = {}) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [ip, e] of hits) if (now > e.reset) hits.delete(ip);
  }, windowMs);
  sweep.unref?.();
  return {
    /** @returns {boolean} true bila request diizinkan */
    take(ip) {
      const now = Date.now();
      let e = hits.get(ip);
      if (!e || now > e.reset) {
        e = { count: 0, reset: now + windowMs };
        hits.set(ip, e);
      }
      e.count += 1;
      return e.count <= max;
    },
    size: () => hits.size,
    stop: () => clearInterval(sweep),
  };
}
