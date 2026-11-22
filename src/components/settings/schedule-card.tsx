'use client';

import { useState } from 'react';
import { Plus, Timer, Trash2 } from 'lucide-react';
import { emit } from '@/lib/socket';
import { toast } from '@/lib/store';
import type { ScheduleEntry } from '@/lib/types';
import { fmtMs, parseDuration } from '@/lib/utils';
import { SettingRow } from '../ui/setting-row';
import { Card, Section, useActiveFeatures } from './common';

interface Row { cmd: string; every: string }
const toRows = (list: ScheduleEntry[]): Row[] => list.map((s) => ({ cmd: s.cmd, every: fmtMs(s.intervalMs) }));

export function ScheduleCard() {
  const a = useActiveFeatures();
  if (!a) return null;
  const { sid, f } = a;
  return (
    <section aria-label="Command schedule">
      <Section Icon={Timer} color="#a78bfa" title="Command Schedule" />
      <Card>
        <SettingRow
          Icon={Timer} color="#a78bfa" label="Command Schedule" sub="Kirim command berulang pada interval tetap" checked={f.schedule.enabled}
          onChange={(on) => emit(on ? 'mc:cmd_schedule_start' : 'mc:cmd_schedule_stop', { sessionId: sid })}
        />
        <Editor key={sid + JSON.stringify(f.schedule.schedules)} sid={sid} initial={toRows(f.schedule.schedules)} />
      </Card>
    </section>
  );
}

function Editor({ sid, initial }: { sid: string; initial: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial);
  const patch = (i: number, p: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));

  const save = () => {
    const schedules: ScheduleEntry[] = [];
    for (const r of rows) {
      if (!r.cmd.trim()) continue;
      const ms = parseDuration(r.every);
      if (ms === null || ms < 5000) return toast(`Interval "${r.every}" tidak valid (min 5s, contoh: 30s, 5m, 1h)`, 'er');
      schedules.push({ cmd: r.cmd.trim(), intervalMs: ms });
    }
    emit('mc:set_cmd_schedules', { sessionId: sid, schedules });
  };

  return (
    <div className="space-y-2 px-4 pb-4">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[minmax(0,1fr)_6rem_auto]">
          <input className="input col-span-2 sm:col-span-1" value={r.cmd} onChange={(e) => patch(i, { cmd: e.target.value })} placeholder="/command" maxLength={256} aria-label={`Command ${i + 1}`} autoCapitalize="none" spellCheck={false} />
          <input className="input" value={r.every} onChange={(e) => patch(i, { every: e.target.value })} placeholder="Interval (30s, 5m)" aria-label={`Interval ${i + 1}`} />
          <button type="button" className="btn btn-icon btn-danger" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} aria-label="Hapus baris">
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" className="btn" disabled={rows.length >= 10} onClick={() => setRows((r) => [...r, { cmd: '', every: '60s' }])}>
          <Plus size={14} /> Add
        </button>
        <button type="button" className="btn btn-primary min-w-24 flex-1" onClick={save}>Save</button>
      </div>
    </div>
  );
}
