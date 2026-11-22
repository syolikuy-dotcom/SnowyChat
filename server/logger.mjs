// Logger ringan berlevel. Default hanya WARN ke atas supaya konsol tidak spam.
// LOG_LEVEL=debug|info|warn|error|fatal|silent
const LEVELS = {
  DEBUG: { tag: '[ DEBUG ]', stream: 'log', rank: 0 },
  INFO: { tag: '[ INFO  ]', stream: 'log', rank: 1 },
  WARN: { tag: '[ WARN  ]', stream: 'warn', rank: 2 },
  ERROR: { tag: '[ ERROR ]', stream: 'error', rank: 3 },
  FATAL: { tag: '[ FATAL ]', stream: 'error', rank: 4 },
};
const ALIASES = { debug: 'DEBUG', info: 'INFO', warn: 'WARN', warning: 'WARN', error: 'ERROR', fatal: 'FATAL', silent: 'SILENT', none: 'SILENT' };

function resolveMinRank() {
  const resolved = ALIASES[(process.env.LOG_LEVEL || '').trim().toLowerCase()];
  if (resolved === 'SILENT') return Infinity;
  if (resolved && LEVELS[resolved]) return LEVELS[resolved].rank;
  return LEVELS.WARN.rank;
}

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

function emit(level, scope, message, extra) {
  if (LEVELS[level].rank < resolveMinRank()) return;
  const { tag, stream } = LEVELS[level];
  const line = `${tag} ${stamp()}${scope ? ` (${scope})` : ''} ${message}`;
  if (extra !== undefined) console[stream](line, extra);
  else console[stream](line);
}

export const logger = {
  debug: (scope, message, extra) => emit('DEBUG', scope, message, extra),
  info: (scope, message, extra) => emit('INFO', scope, message, extra),
  warn: (scope, message, extra) => emit('WARN', scope, message, extra),
  error: (scope, message, extra) => emit('ERROR', scope, message, extra),
  fatal: (scope, message, extra) => emit('FATAL', scope, message, extra),
};
