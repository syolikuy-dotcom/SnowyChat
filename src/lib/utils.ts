export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

export const fmtName = (n?: string | null) =>
  String(n ?? '').replace(/minecraft:/i, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export const pct = (v: number, max: number) => clamp(max > 0 ? (v / max) * 100 : 0, 0, 100);

export function safeStorage() {
  return {
    get(key: string): string | null {
      try {
        return localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key: string, value: string) {
      try {
        localStorage.setItem(key, value);
      } catch {
        /* diabaikan */
      }
    },
  };
}

export const fmtMs = (ms: number) => (ms >= 60000 && ms % 60000 === 0 ? `${ms / 60000}m` : `${Math.round(ms / 1000)}s`);

/** Parse "30s" / "5m" / "1h" / angka (detik) menjadi milidetik; null bila tidak valid. */
export function parseDuration(input: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([smh]?)\s*$/i.exec(input);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const unit = (m[2] || 's').toLowerCase();
  return Math.round(n * (unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : 1000));
}
