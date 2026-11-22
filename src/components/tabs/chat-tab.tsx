'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Send, Trash2 } from 'lucide-react';
import { emit } from '@/lib/socket';
import { clearMessages, setChatMode, setState, toast, useStore, type FilterId } from '@/lib/store';
import { parseColorCodes } from '@/lib/mc';
import type { Msg } from '@/lib/types';
import { cn } from '@/lib/utils';

const FILTERS: { id: FilterId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'chat', label: 'Chat' },
  { id: 'sys', label: 'Events' },
];
const VISIBLE_LINES = 300;
const HISTORY_MAX = 50;

const Line = memo(function Line({ m, label }: { m: Msg; label?: string }) {
  const spans = useMemo(() => parseColorCodes(m.text), [m.text]);
  return (
    <div className={cn('chat-line', m.kind === 'sys' && m.level, m.level === 'self' && 'self')}>
      <span className="mr-2 text-[10px] text-(--dim)" suppressHydrationWarning>
        {new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
      {label && <span className="mr-1 text-cyan-ice">[{label}]</span>}
      {spans.map((sp, i) => (
        <span key={i} style={{ color: sp.color, fontWeight: sp.bold ? 700 : undefined, fontStyle: sp.italic ? 'italic' : undefined, textDecoration: [sp.underline && 'underline', sp.strike && 'line-through'].filter(Boolean).join(' ') || undefined }}>
          {sp.text}
        </span>
      ))}
    </div>
  );
});

export function ChatTab() {
  const sid = useStore((s) => s.activeSid);
  const messages = useStore((s) => s.messages);
  const filter = useStore((s) => s.filter);
  const mode = useStore((s) => s.chatMode);
  const sessions = useStore((s) => s.sessions);
  const conn = useStore((s) => (s.activeSid ? s.conn[s.activeSid] : undefined));
  const online = conn === 'online';

  const [text, setText] = useState('');
  const history = useRef<string[]>([]);
  const histIdx = useRef(-1);
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const names = useMemo(() => new Map(sessions.map((s) => [s.sessionId, s.username])), [sessions]);
  const lines = useMemo(() => {
    const out: Msg[] = [];
    for (let i = messages.length - 1; i >= 0 && out.length < VISIBLE_LINES; i--) {
      const m = messages[i];
      const mine = m.sid === sid;
      if (!(mine || (mode === 'all' && m.kind === 'chat'))) continue;
      if (filter === 'chat' && m.kind !== 'chat') continue;
      if (filter === 'sys' && m.kind !== 'sys') continue;
      out.push(m);
    }
    return out.reverse();
  }, [messages, sid, mode, filter]);

  useEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const onScroll = () => {
    const el = logRef.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  };

  const send = () => {
    const msg = text.trim();
    if (!msg) return;
    if (msg.length > 256) return toast('Pesan terlalu panjang (maks 256)', 'er');
    const targets = mode === 'all' ? sessions.filter((s) => s.connected).map((s) => s.sessionId) : sid ? [sid] : [];
    if (!targets.length) return toast('Tidak ada bot online', 'er');
    for (const t of targets) emit('mc:chat', { message: msg, sessionId: t });
    history.current = [msg, ...history.current.filter((h) => h !== msg)].slice(0, HISTORY_MAX);
    histIdx.current = -1;
    stick.current = true;
    setText('');
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) return send();
    if (e.key === 'ArrowUp' && history.current.length) {
      e.preventDefault();
      histIdx.current = Math.min(histIdx.current + 1, history.current.length - 1);
      setText(history.current[histIdx.current]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      histIdx.current = Math.max(histIdx.current - 1, -1);
      setText(histIdx.current < 0 ? '' : history.current[histIdx.current]);
    }
  };

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5 border-b border-white/5 bg-black/20 px-3 py-2">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className="ftab" aria-pressed={filter === f.id} onClick={() => setState({ filter: f.id })}>
            {f.label}
          </button>
        ))}
        <button type="button" className="btn btn-icon sm ml-auto" onClick={() => clearMessages(sid, mode === 'all')} aria-label="Bersihkan chat" title="Clear">
          <Trash2 size={13} />
        </button>
      </div>

      <div ref={logRef} onScroll={onScroll} className="chat-log" role="log" aria-live="off" aria-label="Chat log">
        {!lines.length && <div className="empty">{sid ? 'Belum ada pesan.' : 'Pilih atau buat sesi dari menu Sessions.'}</div>}
        {lines.map((m) => (
          <Line key={m.id} m={m} label={mode === 'all' && sessions.length > 1 && m.sid !== sid ? names.get(m.sid) : undefined} />
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-white/5 bg-black/20 p-2.5 sm:p-3">
        <button
          type="button"
          className="btn shrink-0 px-3 text-[11px]"
          aria-pressed={mode === 'all'}
          title="Kirim ke 1 sesi atau semua sesi"
          onClick={() => setChatMode(mode === 'all' ? 'single' : 'all')}
          style={mode === 'all' ? { color: '#ffc2d4', borderColor: 'rgba(255,110,142,0.4)' } : undefined}
        >
          {mode === 'all' ? 'All Chat' : '1 Chat'}
        </button>
        <input className="input min-w-0 flex-1" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} disabled={!online && mode === 'single'} placeholder={online || mode === 'all' ? 'Type a message…' : 'Bot offline'} maxLength={256} enterKeyHint="send" autoComplete="off" aria-label="Pesan chat" />
        <button type="button" className="btn btn-primary btn-icon" onClick={send} disabled={!text.trim() || (!online && mode === 'single')} aria-label="Kirim">
          <Send size={16} />
        </button>
      </div>
    </>
  );
}
