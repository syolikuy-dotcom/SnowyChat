'use client';

import { useMemo, useState } from 'react';
import { Apple, Box, Crosshair, Pickaxe, RefreshCw, Shield, Sword, X, type LucideIcon } from 'lucide-react';
import { emit } from '@/lib/socket';
import { armorDest, CAT_COLOR, durColor, itemCategory, type ItemCat } from '@/lib/mc';
import { setState, toast, useStore } from '@/lib/store';
import type { EquipDest, InvItem, WinEntry } from '@/lib/types';
import { cn, fmtName } from '@/lib/utils';

const ICONS: Record<ItemCat, LucideIcon> = { weapon: Sword, bow: Crosshair, tool: Pickaxe, armor: Shield, food: Apple, misc: Box };
const FILTERS: ('all' | ItemCat)[] = ['all', 'weapon', 'tool', 'armor', 'food', 'misc'];
const SUBS = [
  { id: 'inv', label: 'Inventory' },
  { id: 'equip', label: 'Equipment' },
  { id: 'hotbar', label: 'Hotbar' },
  { id: 'chest', label: 'Chest' },
] as const;
const EQUIP_LABEL: Record<EquipDest, string> = { head: 'Helmet', torso: 'Chestplate', legs: 'Leggings', feet: 'Boots', offhand: 'Offhand' };

interface Pop {
  title: string;
  sub: string;
  actions: { label: string; danger?: boolean; run: () => void }[];
}

function Slot({ name, count, display, dur, selected, onClick }: { name?: string; count?: number; display?: string; dur?: number | null; selected?: boolean; onClick?: () => void }) {
  const cat = itemCategory(name);
  const Icon = ICONS[cat];
  return (
    <button type="button" className="slot" data-selected={selected ? 'true' : undefined} onClick={onClick} disabled={!name} aria-label={name ? `${display || fmtName(name)} x${count}` : 'Empty slot'} title={name ? display || fmtName(name) : undefined} style={!name ? { opacity: 0.35, cursor: 'default' } : undefined}>
      {name && <Icon size={20} color={CAT_COLOR[cat]} strokeWidth={1.8} />}
      {name && (count ?? 1) > 1 && <span className="qty">{count}</span>}
      {dur != null && dur < 100 && (
        <span className="dur">
          <i style={{ width: `${dur}%`, background: durColor(dur) }} />
        </span>
      )}
    </button>
  );
}

const durPct = (i: InvItem) => (i.maxDurability ? Math.round(((i.maxDurability - (i.durabilityUsed || 0)) / i.maxDurability) * 100) : null);

export default function InventoryTab() {
  const sid = useStore((s) => s.activeSid);
  const inv = useStore((s) => (s.activeSid ? s.inventory[s.activeSid] : undefined));
  const win = useStore((s) => (s.activeSid ? s.container[s.activeSid] : null));
  const sub = useStore((s) => s.invSub);
  const online = useStore((s) => !!s.activeSid && s.conn[s.activeSid] === 'online');
  const [filter, setFilter] = useState<'all' | ItemCat>('all');
  const [pop, setPop] = useState<Pop | null>(null);

  const bySlot = useMemo(() => new Map((inv?.items ?? []).map((i) => [i.slot, i])), [inv]);
  const items = useMemo(() => (inv?.items ?? []).filter((i) => i.slot >= 9 && i.slot <= 44 && (filter === 'all' || itemCategory(i.name) === filter)), [inv, filter]);

  if (!sid) return <div className="empty">Pilih sesi untuk melihat inventory.</div>;
  if (!online) return <div className="empty">Bot offline.</div>;

  const refresh = () => emit('mc:get_inventory', { sessionId: sid });
  const used = (inv?.items ?? []).filter((i) => i.slot >= 9 && i.slot <= 44).length;

  const invPopup = (i: InvItem) => {
    const actions: Pop['actions'] = [{ label: 'Hold in hand', run: () => emit('mc:equip', { sessionId: sid, slot: i.slot, destination: 'hand' }) }];
    const dest = armorDest(i.name);
    if (dest) actions.push({ label: `Wear (${dest})`, run: () => emit('mc:equip', { sessionId: sid, slot: i.slot, destination: dest }) });
    actions.push({ label: 'Move to offhand', run: () => emit('mc:equip', { sessionId: sid, slot: i.slot, destination: 'off-hand' }) });
    if (win) actions.push({ label: 'Deposit all to chest', run: () => emit('mc:deposit', { sessionId: sid, slot: i.slot, count: i.count }) });
    if (i.count > 1) actions.push({ label: 'Drop 1', danger: true, run: () => emit('mc:drop_item', { sessionId: sid, slot: i.slot, count: 1 }) });
    actions.push({ label: `Drop all (${i.count})`, danger: true, run: () => emit('mc:drop_item', { sessionId: sid, slot: i.slot, count: i.count }) });
    setPop({ title: i.displayName || fmtName(i.name), sub: `Slot ${i.slot} · x${i.count}`, actions });
  };
  const chestPopup = (e: WinEntry) =>
    setPop({
      title: e.displayName || fmtName(e.name),
      sub: `Chest slot ${e.slot} · x${e.count}`,
      actions: [
        ...(e.count > 1 ? [{ label: 'Withdraw 1', run: () => emit('mc:withdraw', { sessionId: sid, itemName: e.name, count: 1 }) }] : []),
        { label: `Withdraw all (${e.count})`, run: () => emit('mc:withdraw', { sessionId: sid, itemName: e.name, count: e.count }) },
      ],
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/5 bg-black/20 px-2 py-2" role="tablist">
        {SUBS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={sub === t.id} className="ftab shrink-0" aria-pressed={sub === t.id} onClick={() => setState({ invSub: t.id })}>
            {t.label}
            {t.id === 'chest' && win && <span className="ml-1 inline-block size-1.5 rounded-full bg-emerald-400" />}
          </button>
        ))}
        <button type="button" className="btn btn-icon sm ml-auto shrink-0" onClick={refresh} aria-label="Refresh inventory">
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
        {!inv && sub !== 'chest' && <div className="empty">Loading…</div>}

        {inv && sub === 'inv' && (
          <>
            <div className="mb-3 flex items-center gap-2">
              <div className="flex flex-1 gap-1 overflow-x-auto">
                {FILTERS.map((f) => (
                  <button key={f} type="button" className="ftab shrink-0 capitalize" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                    {f}
                  </button>
                ))}
              </div>
              <span className="label shrink-0">{used}/36</span>
            </div>
            <div className="mb-3 glass-subtle flex items-center gap-2 p-2.5 text-xs">
              <span className="label">Held</span>
              <span className="truncate font-semibold">{inv.heldItem ? `${inv.heldItem.displayName} x${inv.heldItem.count}` : 'Nothing in hand'}</span>
            </div>
            {items.length ? (
              <div className="grid grid-cols-5 gap-1.5 xs:grid-cols-6 sm:grid-cols-9">
                {items.map((i) => (
                  <Slot key={i.slot} name={i.name} display={i.displayName} count={i.count} dur={durPct(i)} onClick={() => invPopup(i)} />
                ))}
              </div>
            ) : (
              <div className="empty">Tidak ada item.</div>
            )}
          </>
        )}

        {inv && sub === 'equip' && (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {(Object.keys(EQUIP_LABEL) as EquipDest[]).map((d) => {
              const it = inv.equipment[d];
              return (
                <div key={d} className="glass-subtle flex items-center gap-3 p-3">
                  <div className="w-14 shrink-0">
                    <Slot name={it?.name} display={it?.displayName} count={it?.count} dur={it ? durPct(it) : null} onClick={it ? () => setPop({ title: it.displayName, sub: EQUIP_LABEL[d], actions: [{ label: 'Unequip', run: () => emit('mc:unequip', { sessionId: sid, destination: d === 'offhand' ? 'off-hand' : d }) }] }) : undefined} />
                  </div>
                  <div className="min-w-0">
                    <p className="label">{EQUIP_LABEL[d]}</p>
                    <p className="truncate text-xs font-semibold">{it ? it.displayName : 'Empty'}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {inv && sub === 'hotbar' && (
          <div className="grid grid-cols-9 gap-1.5">
            {inv.hotbar.map((it, idx) => (
              <div key={idx} className="min-w-0">
                <Slot name={it?.name} display={it?.displayName} count={it?.count} selected={inv.selectedSlot === idx} onClick={() => { emit('mc:select_slot', { sessionId: sid, slot: idx }); toast(`Holding slot ${idx + 1}`, 'info'); }} />
                <p className="mt-1 text-center text-[10px] text-(--dim)">{idx + 1}</p>
              </div>
            ))}
          </div>
        )}

        {sub === 'chest' && (
          win ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-sm font-bold">{win.title}</h3>
                <button type="button" className="btn btn-danger min-h-9 px-3" onClick={() => emit('mc:close_container', { sessionId: sid })}>
                  <X size={13} /> Close
                </button>
              </div>
              <div>
                <p className="label mb-2">Chest</p>
                <div className="grid grid-cols-5 gap-1.5 xs:grid-cols-6 sm:grid-cols-9">
                  {win.items.container.length ? win.items.container.map((e) => <Slot key={e.slot} name={e.name} display={e.displayName} count={e.count} onClick={() => chestPopup(e)} />) : <p className="empty col-span-full">Empty</p>}
                </div>
              </div>
              <div>
                <p className="label mb-2">Your Inv</p>
                <div className="grid grid-cols-5 gap-1.5 xs:grid-cols-6 sm:grid-cols-9">
                  {[...bySlot.values()].filter((i) => i.slot >= 9 && i.slot <= 44).map((i) => <Slot key={i.slot} name={i.name} display={i.displayName} count={i.count} dur={durPct(i)} onClick={() => invPopup(i)} />)}
                </div>
              </div>
            </div>
          ) : (
            <div className="empty">
              <p>No container open</p>
              <button type="button" className="btn btn-primary mt-4" onClick={() => { toast('Opening chest…', 'info'); emit('mc:open_chest', { sessionId: sid, maxDistance: 4 }); }}>
                Open nearby chest
              </button>
            </div>
          )
        )}
      </div>

      {pop && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-3 backdrop-blur-sm sm:items-center" onClick={() => setPop(null)} role="presentation">
          <div className="glass w-full max-w-xs overflow-hidden" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={pop.title}>
            <div className="border-b border-white/10 p-3">
              <p className="truncate text-sm font-bold">{pop.title}</p>
              <p className="label mt-0.5">{pop.sub}</p>
            </div>
            <div className="flex flex-col gap-1 p-2">
              {pop.actions.map((a) => (
                <button key={a.label} type="button" className={cn('btn justify-start', a.danger && 'btn-danger')} onClick={() => { a.run(); setPop(null); }}>
                  {a.label}
                </button>
              ))}
              <button type="button" className="btn justify-start" onClick={() => setPop(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
