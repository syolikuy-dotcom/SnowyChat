// Antrean chat per sesi: menjaga jeda minimum antar pesan supaya tidak kena anti-spam server.
export class ChatQueue {
  constructor() {
    this.queues = new Map();
  }

  /** @param {string} sessionId @param {(msg: string) => {ok:boolean,error?:string}} send */
  enqueue(sessionId, message, send, minGapMs = 1200) {
    return new Promise((resolve) => {
      let q = this.queues.get(sessionId);
      if (!q) {
        q = { items: [], busy: false, lastSentAt: 0, timer: null };
        this.queues.set(sessionId, q);
      }
      q.items.push({ message, send, resolve });
      this.#pump(sessionId, minGapMs);
    });
  }

  #pump(sessionId, minGapMs) {
    const q = this.queues.get(sessionId);
    if (!q || q.busy || !q.items.length) return;
    q.busy = true;
    const run = () => {
      q.timer = null;
      const item = q.items.shift();
      if (!item) {
        q.busy = false;
        return;
      }
      let result;
      try {
        result = item.send(item.message) || { ok: false, error: 'No result' };
      } catch (e) {
        result = { ok: false, error: e.message };
      }
      q.lastSentAt = Date.now();
      item.resolve(result);
      if (q.items.length) {
        q.timer = setTimeout(run, minGapMs);
      } else {
        q.busy = false;
      }
    };
    q.timer = setTimeout(run, Math.max(0, minGapMs - (Date.now() - q.lastSentAt)));
  }

  /** Batalkan semua pesan menunggu (dipanggil saat bot putus / sesi dihapus). */
  clear(sessionId, error = 'Bot disconnected') {
    const q = this.queues.get(sessionId);
    if (!q) return;
    if (q.timer) clearTimeout(q.timer);
    for (const item of q.items) item.resolve({ ok: false, error });
    this.queues.delete(sessionId);
  }
}
