'use client';

import { useState } from 'react';
import { Play, Plus, Terminal, Trash2 } from 'lucide-react';
import { emit } from '@/lib/socket';
import type { AutoCommand } from '@/lib/types';
import { Card, Section, useActiveFeatures } from './common';

export function AutoCommandsCard() {
  const a = useActiveFeatures();
  if (!a) return null;
  const { sid, f } = a;
  return (
    <section aria-label="Auto commands">
      <Section Icon={Terminal} color="#60a5fa" title="Auto Commands" />
      <Card>
        <p className="row-sub px-4 pt-4">Dijalankan berurutan satu kali setelah bot spawn (mis. /login, /server).</p>
        <Editor key={sid + JSON.stringify(f.autoCommands)} sid={sid} initial={f.autoCommands} online={a.online} />
      </Card>
    </section>
  );
}

function Editor({ sid, initial, online }: { sid: string; initial: AutoCommand[]; online: boolean }) {
  const [rows, setRows] = useState<{ cmd: string; delay: string }[]>(initial.map((c) => ({ cmd: c.cmd, delay: String(c.delay) })));
  const patch = (i: number, p: Partial<{ cmd: string; delay: string }>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const commands = () => rows.filter((r) => r.cmd.trim()).map((r) => ({ cmd: r.cmd.trim(), delay: Math.max(0, Math.min(30000, parseInt(r.delay, 10) || 0)) }));

  return (
    <div className="space-y-2 p-4">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_auto]">
          <input className="input col-span-2 sm:col-span-1" value={r.cmd} onChange={(e) => patch(i, { cmd: e.target.value })} placeholder="/login password" maxLength={256} aria-label={`Command ${i + 1}`} autoCapitalize="none" spellCheck={false} />
          <input className="input" value={r.delay} inputMode="numeric" onChange={(e) => patch(i, { delay: e.target.value })} placeholder="Delay (ms)" aria-label={`Delay ${i + 1}`} />
          <button type="button" className="btn btn-icon btn-danger" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label="Hapus baris"><Trash2 size={14} /></button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className="btn" disabled={rows.length >= 10} onClick={() => setRows((r) => [...r, { cmd: '', delay: '1000' }])}><Plus size={14} /> Add</button>
        <button type="button" className="btn btn-primary min-w-24 flex-1" onClick={() => emit('mc:set_auto_commands', { sessionId: sid, commands: commands() })}>Save</button>
        <button type="button" className="btn btn-success" disabled={!online || !initial.length} onClick={() => emit('mc:run_auto_commands_now', { sessionId: sid })}><Play size={13} /> Run</button>
      </div>
    </div>
  );
}
