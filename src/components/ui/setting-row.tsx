'use client';

import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Toggle } from './toggle';

export function SettingRow({
  Icon, color, label, sub, checked, onChange, disabled,
}: { Icon: LucideIcon; color: string; label: string; sub: React.ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="card-row">
      <div className="row-icon" style={{ background: `${color}1f`, borderColor: `${color}33` }}>
        <Icon size={16} color={color} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="row-label">{label}</p>
        <p className="row-sub">{sub}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

export function SliderRow({
  label, value, unit, min, max, step, onCommit, hint,
}: { label: string; value: number; unit: string; min: number; max: number; step: number; onCommit: (v: number) => void; hint?: string }) {
  return <SliderInner key={value} {...{ label, value, unit, min, max, step, onCommit, hint }} />;
}

function SliderInner({
  label, value, unit, min, max, step, onCommit, hint,
}: { label: string; value: number; unit: string; min: number; max: number; step: number; onCommit: (v: number) => void; hint?: string }) {
  const [local, setLocal] = useState(value);
  return (
    <div className="min-w-0 px-4 pb-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">{label}</span>
        <span className="slider-val">
          {local} {unit}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={local} aria-label={label}
        onChange={(e) => setLocal(Number(e.target.value))}
        onPointerUp={() => onCommit(local)}
        onKeyUp={() => onCommit(local)}
        onBlur={() => local !== value && onCommit(local)}
      />
      {hint && <p className="hint mt-1.5">{hint}</p>}
    </div>
  );
}
