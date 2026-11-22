// Parser event server (NextGens / GensPlus / dsb.) dari baris chat/broadcast.
// Murni logika: tidak menyentuh bot/socket, sehingga mudah dites.
//
// Dua jalur deteksi:
//  A) satu baris: "Sell Multiplier has started! x2" atau "<Nama> Event started"
//  B) format kotak NextGens multi-baris ("Event Started" / "Type: 2x Sell Multiplier" /
//     "Duration: 5m"), urutan baris bisa terbalik → di-buffer per sesi lalu digabung.
// Ditambah fallback longgar khusus untuk memutuskan Auto Sell.

const TS = String.raw`(?:\[\d{1,2}:\d{2}:\d{2}\]\s*)?`;

export const RE = {
  eventStart: /([A-Za-z][A-Za-z\s]{1,30}?Event)\s+(?:has\s+|telah\s+)?(started|begun|dimulai|mulai)/i,
  eventEnd: /([A-Za-z][A-Za-z\s]{1,30}?Event)\s+(?:has\s+|telah\s+)?(ended|finished|berakhir|selesai)/i,
  startWord: /\b(started|begun|activated|active|aktif|dimulai|mulai)\b/i,
  endWord: /\b(ended|finished|stopped|over|berakhir|selesai|habis)\b/i,
  ngEvent: /\b(Sell Multiplier|Drop Multiplier|Generator Upgrade|Generator Speed|Mixed Up|Corruption)\b/i,
  ngMultiplier: /(?:(\d+(?:[.,]\d+)?)\s*[xX]\b)|(?:\b[xX]\s*(\d+(?:[.,]\d+)?))/,
  lineStart: new RegExp(`^${TS}Event\\s+Started\\b`, 'i'),
  lineEnd: new RegExp(`^${TS}Event\\s+Ended\\b`, 'i'),
  lineType: new RegExp(`^${TS}Type:\\s*(?:(\\d+(?:[.,]\\d+)?)\\s*x\\s+)?(.+?)\\s*$`, 'i'),
  lineDuration: new RegExp(`^${TS}Duration:\\s*(.+)$`, 'i'),
  lineNext: new RegExp(`^${TS}Next Event In:\\s*(.+)$`, 'i'),
};

export const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const stripColors = (text) => String(text ?? '').replace(/§[0-9a-fk-or]/gi, '').trim();
const normMult = (v) => (v ? String(v).replace(',', '.') : null);

export class GensEventParser {
  /**
   * @param {{ emit: (sessionId: string, evt: object) => boolean, looseSell: (sessionId: string, keyword: string) => void, bufferMs?: number, dedupeMs?: number }} hooks
   */
  constructor({ emit, looseSell, bufferMs = 350, dedupeMs = 2000 }) {
    this.emit = emit;
    this.looseSell = looseSell;
    this.bufferMs = bufferMs;
    this.dedupeMs = dedupeMs;
    this.buffers = new Map();
    this.lastSeen = new Map();
  }

  dispose(sessionId) {
    const buf = this.buffers.get(sessionId);
    if (buf?.timer) clearTimeout(buf.timer);
    this.buffers.delete(sessionId);
    this.lastSeen.delete(sessionId);
  }

  /**
   * @param {string} sessionId
   * @param {string} rawText
   * @param {{ eventWatchEnabled: boolean, sellTriggerOn: boolean, keyword: string }} ctx
   */
  feed(sessionId, rawText, ctx) {
    if (ctx.eventWatchEnabled === false) return;
    const cleaned = stripColors(rawText);
    if (!cleaned) return;
    for (const line of cleaned.split(/\r?\n/)) {
      const text = line.trim();
      if (text) this.#line(sessionId, text, ctx);
    }
  }

  #line(sessionId, text, ctx) {
    const now = Date.now();
    const seen = this.lastSeen.get(sessionId);
    if (seen && seen.text === text && now - seen.ts < this.dedupeMs) return;
    this.lastSeen.set(sessionId, { text, ts: now });

    let firedSell = false;

    // Jalur A — satu baris
    let ng = null;
    const nameMatch = text.match(RE.ngEvent);
    if (nameMatch) {
      const isStart = RE.startWord.test(text);
      const isEnd = !isStart && RE.endWord.test(text);
      if (isStart || isEnd) ng = { name: nameMatch[1], isStart };
    }
    const startMatch = !ng ? text.match(RE.eventStart) : null;
    const endMatch = !ng && !startMatch ? text.match(RE.eventEnd) : null;

    if (ng || startMatch || endMatch) {
      const eventName = ng ? ng.name : (startMatch || endMatch)[1].trim();
      const action = ng ? (ng.isStart ? 'started' : 'ended') : startMatch ? 'started' : 'ended';
      const m = text.match(RE.ngMultiplier);
      const multiplier = m ? normMult(m[1] || m[2]) : null;
      if (this.emit(sessionId, { eventName, action, multiplier, duration: null, nextIn: null })) firedSell = true;
    } else {
      // Jalur B — format kotak NextGens
      const isStartLine = RE.lineStart.test(text);
      const isEndLine = !isStartLine && RE.lineEnd.test(text);
      const typeLine = text.match(RE.lineType);
      const durationLine = text.match(RE.lineDuration);
      const nextLine = text.match(RE.lineNext);
      if (isStartLine || isEndLine || typeLine || durationLine || nextLine) {
        let buf = this.buffers.get(sessionId);
        if (!buf) {
          buf = {};
          this.buffers.set(sessionId, buf);
        }
        if (isStartLine) buf.action = 'started';
        if (isEndLine) buf.action = 'ended';
        if (typeLine) {
          buf.multiplier = normMult(typeLine[1]);
          buf.name = typeLine[2].trim();
        }
        if (durationLine) buf.duration = durationLine[1].trim();
        if (nextLine) buf.nextIn = nextLine[1].trim();
        clearTimeout(buf.timer);
        buf.timer = setTimeout(() => {
          if (this.buffers.get(sessionId) === buf) this.buffers.delete(sessionId);
          if (buf.action && buf.name) {
            this.emit(sessionId, {
              eventName: buf.name,
              action: buf.action,
              multiplier: buf.multiplier ?? null,
              duration: buf.duration ?? null,
              nextIn: buf.nextIn ?? null,
            });
          }
        }, this.bufferMs);
        buf.timer.unref?.();
      }
    }

    // Fallback longgar: hanya memutuskan Auto Sell, tidak pernah mengirim webhook ganda.
    if (!firedSell && ctx.sellTriggerOn && ctx.keyword) {
      const kwRe = new RegExp(`\\b${escapeRegExp(ctx.keyword)}\\b`, 'i');
      if (kwRe.test(text) && RE.startWord.test(text)) this.looseSell(sessionId, ctx.keyword);
    }
  }
}
