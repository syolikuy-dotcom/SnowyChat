// Log chat in-game ke logs/DD-MM-YYYY.log (satu file per hari; rotasi otomatis
// karena nama file dihitung ulang di setiap penulisan).
import fs from 'node:fs';
import path from 'node:path';
import { logger } from './logger.mjs';

let logDir = path.join(process.cwd(), 'logs');
let disabled = false;
let dirEnsured = false;

export function configureChatLogger({ dataDir, disabled: off }) {
  logDir = path.join(dataDir, 'logs');
  disabled = !!off;
  dirEnsured = false;
}

const pad = (n) => String(n).padStart(2, '0');
export const todayFilename = (d = new Date()) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}.log`;
export const stripColorCodes = (text) => String(text ?? '').replace(/§[0-9a-fk-or]/gi, '');

function ensureDir() {
  if (dirEnsured) return true;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    dirEnsured = true;
    return true;
  } catch (e) {
    logger.warn('ChatLog', `Gagal membuat folder logs/: ${e.message}`);
    return false;
  }
}

export function logChat(sessionId, username, rawText) {
  if (disabled) return;
  const text = stripColorCodes(rawText).replace(/[\r\n]+/g, ' ').trim();
  if (!text || !ensureDir()) return;
  const now = new Date();
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const label = String(username || (sessionId ? sessionId.slice(0, 8) : '?')).replace(/[[\]\r\n]/g, '');
  const file = todayFilename(now);
  fs.appendFile(path.join(logDir, file), `[${time}] [${label}] ${text}\n`, (err) => {
    if (err) logger.warn('ChatLog', `Gagal menulis ${file}: ${err.message}`);
  });
}
