// Inventory & container (chest/barrel/shulker) untuk satu bot.
const EQUIP_SLOTS = { head: 5, torso: 6, legs: 7, feet: 8, offhand: 45 };
const CONTAINER_BLOCKS = [
  'chest', 'trapped_chest', 'barrel', 'ender_chest', 'shulker_box',
  ...['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'].map((c) => `${c}_shulker_box`),
];
const OPEN_TIMEOUT_MS = 8000;
const INV_CACHE_MS = 800;

const itemBrief = (it) => ({ slot: it.slot, type: it.type, name: it.name, displayName: it.displayName || it.name, count: it.count });
const itemFull = (it) => ({
  ...itemBrief(it),
  stackSize: it.stackSize,
  durabilityUsed: it.durabilityUsed || 0,
  maxDurability: it.maxDurability || null,
});

const withTimeout = (promise, ms, message) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms).unref?.())]);

export const inventoryMethods = {
  snapshotInventory(bot) {
    const items = bot.inventory.items().map(itemFull);
    const equipment = {};
    for (const [dest, slot] of Object.entries(EQUIP_SLOTS)) {
      const it = bot.inventory.slots[slot];
      equipment[dest] = it ? itemFull(it) : null;
    }
    const hotbar = [];
    for (let i = 36; i <= 44; i++) {
      const it = bot.inventory.slots[i];
      hotbar.push(it ? itemBrief(it) : null);
    }
    return {
      ok: true,
      items,
      equipment,
      hotbar,
      heldItem: bot.heldItem ? itemBrief(bot.heldItem) : null,
      selectedSlot: bot.quickBarSlot || 0,
    };
  },

  getInventory(sessionId) {
    const bot = this.bots.get(sessionId);
    if (!bot?.entity) return { ok: false, error: 'Bot not ready', items: [] };
    if (this.invRefreshing.has(sessionId)) return { ok: false, error: 'Refreshing', items: [] };
    const cached = this.invCache.get(sessionId);
    if (this.openWindows.has(sessionId)) return cached ? cached.data : { ok: false, error: 'Container open', items: [] };
    if (cached && Date.now() - cached.ts < INV_CACHE_MS) return cached.data;
    const data = this.snapshotInventory(bot);
    this.invCache.set(sessionId, { data, ts: Date.now() });
    return data;
  },

  async equipItem(sessionId, slot, destination) {
    const bot = this.bots.get(sessionId);
    if (!bot?.entity) return { ok: false, error: 'Bot not ready' };
    const item = bot.inventory.slots[slot];
    if (!item) return { ok: false, error: `Slot ${slot} is empty` };
    try {
      await bot.equip(item, destination);
      this.invCache.delete(sessionId);
      return { ok: true, message: `Equipped ${item.displayName || item.name} to ${destination}` };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async unequipItem(sessionId, destination) {
    const bot = this.bots.get(sessionId);
    if (!bot?.entity) return { ok: false, error: 'Bot not ready' };
    try {
      await bot.unequip(destination);
      this.invCache.delete(sessionId);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async dropItem(sessionId, slot, count) {
    const bot = this.bots.get(sessionId);
    if (!bot?.entity) return { ok: false, error: 'Bot not ready' };
    const item = bot.inventory.slots[slot];
    if (!item) return { ok: false, error: `Slot ${slot} is empty` };
    try {
      const n = !count || count >= item.count ? item.count : count;
      if (n === item.count) await bot.tossStack(item);
      else await bot.toss(item.type, null, n);
      this.invCache.delete(sessionId);
      return { ok: true, message: `Dropped ${n}x ${item.displayName || item.name}` };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  selectHotbarSlot(sessionId, slot) {
    const bot = this.bots.get(sessionId);
    if (!bot?.entity) return { ok: false, error: 'Bot not ready' };
    if (!Number.isInteger(slot) || slot < 0 || slot > 8) return { ok: false, error: 'Slot must be 0-8' };
    try {
      bot.setQuickBarSlot(slot);
      this.invCache.delete(sessionId);
      return { ok: true, slot };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  // ───────── container ─────────
  isContainerOpen(sessionId) {
    return this.openWindows.has(sessionId);
  },

  windowTitle(win) {
    const raw = win?.title;
    if (!raw) return 'Container';
    try {
      const comp = typeof raw === 'string' && /^[{["]/.test(raw.trim()) ? JSON.parse(raw) : raw;
      const text = this.chatComponentToString(comp);
      return text && text !== 'Disconnected by server' ? text : 'Container';
    } catch {
      return typeof raw === 'string' ? raw : 'Container';
    }
  },

  getWinItems(win) {
    if (!win) return { container: [], botInv: [] };
    const invStart = win.inventoryStart ?? 27;
    const container = [];
    const botInv = [];
    win.slots.forEach((item, i) => {
      if (!item) return;
      const entry = { slot: i, name: item.name, displayName: item.displayName || item.name, count: item.count, type: item.type };
      (i < invStart ? container : botInv).push(entry);
    });
    return { container, botInv };
  },

  getContainerItems(sessionId) {
    const win = this.openWindows.get(sessionId);
    if (!win) return { ok: false, error: 'No container open', items: { container: [], botInv: [] } };
    return { ok: true, items: this.getWinItems(win), title: this.windowTitle(win), inventoryStart: win.inventoryStart ?? 27, isOpen: true };
  },

  async openNearestContainer(sessionId, maxDistance = 4) {
    const bot = this.bots.get(sessionId);
    if (!bot?.entity) return { ok: false, error: 'Bot not ready' };
    if (!bot.registry) return { ok: false, error: 'Bot not fully spawned yet' };
    if (this.openWindows.has(sessionId)) return { ok: false, error: 'Close the current container first', warn: true };
    const dist = Math.max(1, Math.min(Number(maxDistance) || 4, 6));
    try {
      const ids = CONTAINER_BLOCKS.map((n) => bot.registry.blocksByName[n]?.id).filter((id) => id !== undefined);
      if (!ids.length) return { ok: false, error: 'No chest block types found in registry' };
      const positions = bot.findBlocks({ matching: ids, maxDistance: dist, count: 10 });
      if (!positions.length) return { ok: false, error: `No chest found nearby (within ${dist} blocks)` };
      const me = bot.entity.position;
      const nearest = positions.reduce((a, b) => (me.distanceTo(b) < me.distanceTo(a) ? b : a));
      const block = bot.blockAt(nearest);
      if (!block) return { ok: false, error: 'Could not read block data' };
      const open = bot.openContainer ? bot.openContainer(block) : bot.openBlock(block);
      await withTimeout(open, OPEN_TIMEOUT_MS, 'Server tidak membuka container (timeout)');
      return { ok: true, message: 'Membuka container...' };
    } catch (e) {
      return { ok: false, error: `Open chest failed: ${e.message}` };
    }
  },

  async closeContainer(sessionId) {
    const bot = this.bots.get(sessionId);
    const win = this.openWindows.get(sessionId);
    if (!win) return { ok: false, error: 'No container open' };
    this.openWindows.delete(sessionId);
    try {
      await bot?.closeWindow(win);
    } catch {
      /* window sudah ditutup server */
    }
    this.invCache.delete(sessionId);
    return { ok: true };
  },

  async withdrawFromContainer(sessionId, itemName, count) {
    const bot = this.bots.get(sessionId);
    if (!bot?.entity) return { ok: false, error: 'Bot not ready' };
    const win = this.openWindows.get(sessionId);
    if (!win) return { ok: false, error: 'No container open' };
    const invStart = win.inventoryStart ?? 27;
    let found = null;
    for (let i = 0; i < invStart; i++) {
      const it = win.slots[i];
      if (it && it.name === itemName) {
        found = it;
        break;
      }
    }
    if (!found) return { ok: false, error: `${itemName} not found in container` };
    try {
      const n = count || found.count;
      await win.withdraw(found.type, null, n);
      this.invCache.delete(sessionId);
      return { ok: true, message: `Withdrew ${n}x ${found.displayName || found.name}`, items: this.getWinItems(win) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  async depositToContainer(sessionId, slot, count) {
    const bot = this.bots.get(sessionId);
    if (!bot?.entity) return { ok: false, error: 'Bot not ready' };
    const win = this.openWindows.get(sessionId);
    if (!win) return { ok: false, error: 'No container open' };
    const item = bot.inventory.slots[slot];
    if (!item) return { ok: false, error: `Slot ${slot} is empty` };
    try {
      const n = count || item.count;
      await win.deposit(item.type, null, n);
      this.invCache.delete(sessionId);
      return { ok: true, message: `Deposited ${n}x ${item.displayName || item.name}`, items: this.getWinItems(win) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },
};
