'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronsUp, Footprints, OctagonX, Zap } from 'lucide-react';
import { emit } from '@/lib/socket';
import { getState, useStore } from '@/lib/store';
import { clamp } from '@/lib/utils';

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 32;
const COLORS = { player: '#6fe8ff', mob: '#ff5c7a', item: '#ffb53e' } as const;

type Ctrl = 'forward' | 'back' | 'left' | 'right' | 'jump';

export default function MapTab() {
  const sid = useStore((s) => s.activeSid);
  const online = useStore((s) => !!s.activeSid && s.conn[s.activeSid] === 'online');
  const map = useStore((s) => s.map);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef({ panX: 0, panY: 0, zoom: 4 });
  const raf = useRef(0);
  const [sneak, setSneak] = useState(false);
  const [sprint, setSprint] = useState(false);
  const [pressed, setPressed] = useState<Ctrl | null>(null);
  const held = useRef(new Set<string>());

  const draw = useCallback(() => {
    raf.current = 0;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const { panX, panY, zoom } = view.current;
    const m = getState().map;
    const cx = w / 2 + panX;
    const cy = h / 2 + panY;
    const px = m?.pos?.x ?? 0;
    const pz = m?.pos?.z ?? 0;
    const toScreen = (x: number, z: number) => [cx + (x - px) * zoom, cy + (z - pz) * zoom] as const;

    // grid: tiap 16 blok (chunk) agar tetap terbaca di semua zoom
    const step = zoom >= 2 ? 16 : 64;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(111,232,255,0.07)';
    ctx.beginPath();
    const x0 = Math.floor((px - (cx) / zoom) / step) * step;
    const x1 = px + (w - cx) / zoom;
    for (let x = x0; x <= x1; x += step) {
      const sx = Math.round(cx + (x - px) * zoom) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    const z0 = Math.floor((pz - cy / zoom) / step) * step;
    const z1 = pz + (h - cy) / zoom;
    for (let z = z0; z <= z1; z += step) {
      const sy = Math.round(cy + (z - pz) * zoom) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.stroke();

    if (!m?.pos) return;
    for (const e of m.entities) {
      const [sx, sy] = toScreen(e.x, e.z);
      if (sx < -10 || sy < -10 || sx > w + 10 || sy > h + 10) continue;
      ctx.fillStyle = COLORS[e.type] ?? '#aaa';
      ctx.beginPath();
      ctx.arc(sx, sy, e.type === 'item' ? 2.5 : 4, 0, Math.PI * 2);
      ctx.fill();
      if (e.type === 'player' && zoom >= 2) {
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillText(e.name, sx + 7, sy + 3);
      }
    }

    const [bx, by] = toScreen(px, pz);
    const yaw = m.pos.yaw ?? 0;
    const dx = -Math.sin(yaw);
    const dz = -Math.cos(yaw);
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(Math.atan2(dz, dx) + Math.PI / 2);
    ctx.fillStyle = '#ff6e8e';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }, []);

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(draw);
  }, [draw]);

  useEffect(schedule, [map, schedule]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, [schedule]);

  // pan (1 pointer) + pinch zoom (2 pointer) + wheel
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pts = new Map<number, { x: number; y: number }>();
    let lastDist = 0;
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      lastDist = 0;
    };
    const move = (e: PointerEvent) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      if (pts.size === 1) {
        view.current.panX += e.clientX - p.x;
        view.current.panY += e.clientY - p.y;
      }
      p.x = e.clientX;
      p.y = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastDist) view.current.zoom = clamp(view.current.zoom * (d / lastDist), ZOOM_MIN, ZOOM_MAX);
        lastDist = d;
      }
      schedule();
    };
    const up = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      lastDist = 0;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      view.current.zoom = clamp(view.current.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), ZOOM_MIN, ZOOM_MAX);
      schedule();
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
    };
  }, [schedule]);

  // minta data peta berkala selain push dari server; lepas semua tombol saat keluar tab
  useEffect(() => {
    if (!sid) return;
    const held_ = held.current;
    return () => {
      if (held_.size) emit('mc:stop_movement', { sessionId: sid });
      held_.clear();
    };
  }, [sid]);

  const press = useCallback(
    (c: Ctrl, on: boolean) => {
      if (!sid) return;
      if (on) held.current.add(c);
      else held.current.delete(c);
      setPressed(on ? c : null);
      emit('mc:move', { sessionId: sid, control: c, state: on });
    },
    [sid],
  );

  // keyboard: WASD / panah / spasi
  useEffect(() => {
    const keys: Record<string, Ctrl> = { w: 'forward', arrowup: 'forward', s: 'back', arrowdown: 'back', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', ' ': 'jump' };
    const handler = (down: boolean) => (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const c = keys[e.key.toLowerCase()];
      if (!c || e.repeat) return;
      e.preventDefault();
      press(c, down);
    };
    const kd = handler(true);
    const ku = handler(false);
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  }, [press]);

  if (!sid) return <div className="empty">Pilih sesi untuk membuka peta.</div>;

  const pad = (c: Ctrl, Icon: typeof ArrowUp, label: string, extra = '') => (
    <button
      type="button"
      className={`btn btn-icon size-12 touch-none select-none ${extra}`}
      style={pressed === c ? { background: 'rgba(255,110,142,0.25)', borderColor: 'rgba(255,110,142,0.6)', color: '#fff' } : undefined}
      aria-label={label}
      disabled={!online}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); press(c, true); }}
      onPointerUp={() => press(c, false)}
      onPointerCancel={() => press(c, false)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Icon size={18} />
    </button>
  );

  const toggle = (name: 'sneak' | 'sprint', on: boolean, set: (v: boolean) => void) => {
    set(on);
    emit('mc:move', { sessionId: sid, control: name, state: on });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-white/5 bg-black/20 px-3 py-2">
        <span className="font-mono text-xs text-cyan-ice">{map?.pos ? `X: ${map.pos.x}  Y: ${map.pos.y}  Z: ${map.pos.z}` : 'No position'}</span>
        <button type="button" className="btn min-h-8 px-3 text-[11px]" onClick={() => { view.current = { panX: 0, panY: 0, zoom: 4 }; schedule(); }}>
          Recenter
        </button>
      </div>
      <div ref={wrapRef} className="relative min-h-40 flex-1 overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 size-full cursor-grab touch-none active:cursor-grabbing" aria-label="Peta bot" role="img" />
        <div className="pointer-events-none absolute bottom-2 left-3 flex gap-3 text-[10px] text-(--muted)">
          {(['player', 'mob', 'item'] as const).map((t) => (
            <span key={t} className="flex items-center gap-1">
              <i className="inline-block size-2 rounded-full" style={{ background: COLORS[t] }} /> {t}
            </span>
          ))}
        </div>
      </div>
      <div className="shrink-0 border-t border-white/5 bg-black/20 p-3">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <div className="grid grid-cols-3 gap-1.5">
            <span />
            {pad('forward', ArrowUp, 'Maju')}
            <span />
            {pad('left', ArrowLeft, 'Kiri')}
            <button type="button" className="btn btn-icon btn-danger size-12" onClick={() => { held.current.clear(); setSneak(false); setSprint(false); emit('mc:stop_movement', { sessionId: sid }); }} aria-label="Stop semua gerakan" disabled={!online}>
              <OctagonX size={18} />
            </button>
            {pad('right', ArrowRight, 'Kanan')}
            <span />
            {pad('back', ArrowDown, 'Mundur')}
            <span />
          </div>
          <div className="flex flex-col gap-1.5">
            {pad('jump', ChevronsUp, 'Lompat')}
            <button type="button" className="btn btn-icon size-12" aria-pressed={sneak} disabled={!online} onClick={() => toggle('sneak', !sneak, setSneak)} style={sneak ? { background: 'rgba(255,110,142,0.25)', color: '#fff' } : undefined} aria-label="Sneak">
              <Footprints size={18} />
            </button>
            <button type="button" className="btn btn-icon size-12" aria-pressed={sprint} disabled={!online} onClick={() => toggle('sprint', !sprint, setSprint)} style={sprint ? { background: 'rgba(255,110,142,0.25)', color: '#fff' } : undefined} aria-label="Sprint">
              <Zap size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
