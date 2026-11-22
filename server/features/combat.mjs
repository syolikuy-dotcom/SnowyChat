// Fitur combat: Auto Hit, Right-Click Mode, Auto Bow.
// Dipasang ke BotManager.prototype; `this` adalah instance BotManager.
import { logger } from '../logger.mjs';

const TICK_MS = 50; // 1 tick Minecraft. Loop lama 10ms = 5x kerja sia-sia per bot.
const MIN_HIT_DELAY = 10;
const MAX_HIT_DELAY = 1500;
const BOW_NAMES = ['bow', 'crossbow'];
const ARROW_NAMES = ['arrow', 'spectral_arrow', 'tipped_arrow'];
const BOW_CHARGE_MS = 1050;
const BOW_COOLDOWN_MS = 1200;
// Auto Bow hanya menembak target ini (perilaku bawaan SnowyChat untuk farming warden).
const BOW_TARGETS = new Set(['warden']);
const AUTOHIT_SKIP = new Set(['armor_stand', 'text_display', 'block_display', 'item_display', 'interaction', 'marker', 'item']);

const clampDelay = (v) => Math.max(MIN_HIT_DELAY, Math.min(MAX_HIT_DELAY, Math.round(Number(v)) || 500));
const clampRange = (v) => Math.max(3, Math.min(5, Math.round(Number(v)) || 3));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const combatMethods = {
  setRightClickMode(sessionId, enabled) {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.rightClickMode = !!enabled;
      this.save(sessionId);
    }
    return !!enabled;
  },

  getRightClickMode(sessionId) {
    return !!this.sessions.get(sessionId)?.rightClickMode;
  },

  findRipeCaveVine(bot, maxDistance = 5) {
    const isVine = (n) => n === 'cave_vines' || n === 'cave_vines_plant';
    const hasBerries = (block) => {
      if (!block) return false;
      const props = typeof block.getProperties === 'function' ? block.getProperties() : block._properties;
      return props?.berries === true || props?.berries === 'true';
    };
    try {
      return bot.findBlock({
        matching: (block) => isVine(block?.name) && hasBerries(block),
        maxDistance,
        point: bot.entity.position.offset(0, 1.6, 0),
      });
    } catch {
      return null;
    }
  },

  // Mengembalikan true bila loop hidup; false bila bot belum siap ("armed", akan menyala saat bot siap).
  startAutoHit(sessionId, delayMs = 500) {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    const delay = clampDelay(delayMs);
    s.autoHitEnabled = true;
    s.autoHitDelay = delay;
    this.save(sessionId);

    const bot = this.bots.get(sessionId);
    if (!bot?.entity || bot.health <= 0) return false;
    this.stopAutoHit(sessionId, false);

    const { Vec3 } = this.deps;
    const ref = { value: delay };
    this.autoHitRefs.set(sessionId, ref);
    let last = 0;
    let rcBusy = false;
    let rcLastPos = null;
    let atkBusy = false;

    const timer = setInterval(async () => {
      const b = this.bots.get(sessionId);
      if (b !== bot || !b.entity) return this.stopAutoHit(sessionId, false);
      if (b.health <= 0) return;
      const now = Date.now();
      if (now - last < ref.value) return;

      try {
        if (this.sessions.get(sessionId)?.rightClickMode) {
          if (rcBusy) return;
          rcBusy = true;
          last = now;
          try {
            let target = this.findRipeCaveVine(b, 5);
            if (!target) {
              try {
                target = b.blockAtCursor(4.5);
              } catch {
                target = null;
              }
            }
            if (!target && b.entity.yaw !== undefined) {
              const eye = b.entity.position.offset(0, 1.62, 0);
              const dir = new Vec3(-Math.sin(b.entity.yaw), 0, -Math.cos(b.entity.yaw));
              for (let dist = 1; dist <= 3 && !target; dist += 0.5) {
                const blk = b.blockAt(eye.plus(dir.scaled(dist)));
                if (blk && blk.name !== 'air') target = blk;
              }
            }
            if (target) {
              const same = rcLastPos && rcLastPos.equals?.(target.position);
              try {
                b.lookAt(target.position.offset(0.5, 0.5, 0.5), true);
              } catch {
                /* lookAt boleh gagal */
              }
              if (!same) await sleep(40);
              rcLastPos = target.position;
              if (this.bots.get(sessionId) === bot && b.health > 0) {
                try {
                  b.activateBlock(target, new Vec3(0, 1, 0), new Vec3(0.5, 1.0, 0.5));
                } catch {
                  try {
                    b.swingArm();
                  } catch {
                    /* ignore */
                  }
                }
              }
            } else {
              rcLastPos = null;
              try {
                b.swingArm();
              } catch {
                /* ignore */
              }
            }
          } finally {
            rcBusy = false;
          }
          return;
        }

        let closest = null;
        let closestDist = 4;
        const me = b.entity.position;
        for (const e of Object.values(b.entities)) {
          if (e === b.entity || !e.position) continue;
          if (AUTOHIT_SKIP.has(e.name) || e.displayName === 'Armor Stand') continue;
          const d = me.distanceTo(e.position);
          if (d < closestDist) {
            closest = e;
            closestDist = d;
          }
        }
        if (closest) {
          if (atkBusy) return;
          atkBusy = true;
          const target = closest;
          try {
            b.lookAt(new Vec3(target.position.x, target.position.y + 1.5, target.position.z));
          } catch {
            /* ignore */
          }
          setTimeout(() => {
            atkBusy = false;
            const bb = this.bots.get(sessionId);
            if (bb !== bot || !bb.entity || bb.health <= 0) return;
            try {
              bb.attack(target);
            } catch (err) {
              logger.debug('autoHit', 'Attack gagal', err?.message || err);
              try {
                bb.swingArm();
              } catch {
                /* ignore */
              }
            }
          }, Math.min(100, ref.value)).unref?.();
        } else {
          b.swingArm();
        }
        last = now;
      } catch {
        last = now;
      }
    }, TICK_MS);
    timer.unref?.();
    this.autoHitTimers.set(sessionId, timer);
    return true;
  },

  stopAutoHit(sessionId, persist = true) {
    const timer = this.autoHitTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.autoHitTimers.delete(sessionId);
    }
    this.autoHitRefs.delete(sessionId);
    if (persist) {
      const s = this.sessions.get(sessionId);
      if (s && s.autoHitEnabled) {
        s.autoHitEnabled = false;
        this.save(sessionId);
      }
    }
  },

  getAutoHitStatus(sessionId) {
    const s = this.sessions.get(sessionId);
    const enabled = this.autoHitTimers.has(sessionId);
    return { enabled, armed: !enabled && !!s?.autoHitEnabled, delay: s?.autoHitDelay || 500 };
  },

  setAutoHitDelay(sessionId, d) {
    const s = this.sessions.get(sessionId);
    const delay = clampDelay(d);
    if (s) {
      s.autoHitDelay = delay;
      this.save(sessionId);
    }
    const ref = this.autoHitRefs.get(sessionId);
    if (ref) ref.value = delay;
    return delay;
  },

  startAutoBow(sessionId, rangeBlocks = 3) {
    const s = this.sessions.get(sessionId);
    if (!s) return { ok: false, error: 'Session not found' };
    const range = clampRange(rangeBlocks);
    s.autoBowEnabled = true;
    s.autoBowRange = range;
    this.save(sessionId);

    const bot = this.bots.get(sessionId);
    if (!bot?.entity || bot.health <= 0) return { ok: false, error: 'Bot not ready' };
    if (!bot.heldItem?.name?.toLowerCase().includes('bow')) return { ok: false, error: 'No bow in hand' };
    this.stopAutoBow(sessionId, false);

    const { Vec3 } = this.deps;
    const ref = { value: range };
    this.autoBowRefs.set(sessionId, ref);
    let shooting = false;

    const timer = setInterval(async () => {
      if (shooting) return;
      const b = this.bots.get(sessionId);
      if (b !== bot || !b.entity || b.health <= 0) return this.stopAutoBow(sessionId, false);

      const items = b.inventory.items();
      const bow = items.find((i) => BOW_NAMES.some((n) => i.name.includes(n)));
      if (!bow || !items.some((i) => ARROW_NAMES.some((n) => i.name.includes(n)))) return;

      let closest = null;
      let closestDist = Infinity;
      for (const e of Object.values(b.entities)) {
        if (e === b.entity || !e.position || e.username) continue;
        if (!BOW_TARGETS.has(e.name)) continue;
        const d = b.entity.position.distanceTo(e.position);
        if (d <= ref.value && d < closestDist) {
          closest = e;
          closestDist = d;
        }
      }
      if (!closest) return;

      shooting = true;
      const aim = () => b.lookAt(new Vec3(closest.position.x, closest.position.y + 1.6, closest.position.z));
      try {
        await b.equip(bow, 'hand');
        await sleep(100);
        aim();
        await sleep(80);
        b.activateItem();
        await sleep(BOW_CHARGE_MS);
        if (this.bots.get(sessionId) === bot && b.health > 0) {
          aim();
          await sleep(50);
          b.deactivateItem();
          this.event(sessionId, 'bow', `Auto bow → ${closest.name || 'entity'} (${Math.round(closestDist)}m)`);
        } else {
          b.deactivateItem();
        }
        await sleep(BOW_COOLDOWN_MS);
      } catch {
        try {
          if (b.entity && b.health > 0) b.deactivateItem();
        } catch {
          /* ignore */
        }
      } finally {
        shooting = false;
      }
    }, BOW_CHARGE_MS + BOW_COOLDOWN_MS + 300);
    timer.unref?.();
    this.autoBowTimers.set(sessionId, timer);
    return { ok: true };
  },

  stopAutoBow(sessionId, persist = true) {
    const timer = this.autoBowTimers.get(sessionId);
    if (timer) {
      clearInterval(timer);
      this.autoBowTimers.delete(sessionId);
      try {
        const bot = this.bots.get(sessionId);
        if (bot?.entity) bot.deactivateItem();
      } catch {
        /* ignore */
      }
    }
    this.autoBowRefs.delete(sessionId);
    if (persist) {
      const s = this.sessions.get(sessionId);
      if (s && s.autoBowEnabled) {
        s.autoBowEnabled = false;
        this.save(sessionId);
      }
    }
  },

  getAutoBowStatus(sessionId) {
    return { enabled: this.autoBowTimers.has(sessionId), range: this.sessions.get(sessionId)?.autoBowRange || 3 };
  },

  setAutoBowRange(sessionId, range) {
    const r = clampRange(range);
    const s = this.sessions.get(sessionId);
    if (s) {
      s.autoBowRange = r;
      this.save(sessionId);
    }
    const ref = this.autoBowRefs.get(sessionId);
    if (ref) ref.value = r;
    return r;
  },
};
