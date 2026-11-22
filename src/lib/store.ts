'use client';
// Store ringan berbasis useSyncExternalStore dengan selector: komponen hanya render ulang
// bila potongan state yang dipakainya berubah (map 5x/detik tidak menyentuh tab Chat, dst.).
import { useSyncExternalStore } from 'react';
import type {
  ConnState, ContainerState, DbHealth, FeatureState, Inventory, MapEntity, MapPos, Msg, MsgLevel,
  NearbyEntity, PingResult, SessionInfo, SessionSummary, Stats, TabId, ToastKind,
} from './types';
import { emit } from './socket';
import { safeStorage } from './utils';

export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}
export type FilterId = 'all' | 'chat' | 'sys';

export interface AppState {
  socketUp: boolean;
  authFailed: boolean;
  sessions: SessionSummary[];
  dbHealth: DbHealth | null;
  activeSid: string | null;
  tab: TabId;
  invSub: 'inv' | 'equip' | 'hotbar' | 'chest';
  drawerOpen: boolean;
  editingSid: string | null;
  chatMode: 'single' | 'all';
  filter: FilterId;
  conn: Record<string, ConnState>;
  info: Record<string, SessionInfo>;
  stats: Record<string, Stats>;
  inventory: Record<string, Inventory>;
  container: Record<string, ContainerState | null>;
  features: Record<string, FeatureState>;
  messages: Msg[];
  map: { sid: string; pos: MapPos | null; entities: MapEntity[] } | null;
  entities: NearbyEntity[];
  ping: PingResult | null;
  pinging: boolean;
  toasts: Toast[];
}

const MAX_MESSAGES = 600;
const SID_KEY = 'snowychat:sid';
const MODE_KEY = 'snowychat:chatMode';
const storage = safeStorage();

const initial: AppState = {
  socketUp: false,
  authFailed: false,
  sessions: [],
  dbHealth: null,
  activeSid: null,
  tab: 'chat',
  invSub: 'inv',
  drawerOpen: false,
  editingSid: null,
  chatMode: 'single',
  filter: 'all',
  conn: {},
  info: {},
  stats: {},
  inventory: {},
  container: {},
  features: {},
  messages: [],
  map: null,
  entities: [],
  ping: null,
  pinging: false,
  toasts: [],
};

let state = initial;
const listeners = new Set<() => void>();

export const getState = () => state;
export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const next = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Selector harus mengembalikan referensi yang stabil (bukan objek/array baru tiap panggilan). */
export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(initial),
  );
}

// ───────── helpers per-sesi ─────────
export function defaultFeatures(): FeatureState {
  return {
    autoHit: { enabled: false, delay: 500 },
    autoBow: { enabled: false, range: 3 },
    rightClick: false,
    schedule: { enabled: false, schedules: [] },
    autoSell: { enabled: false, config: {} },
    antiAfk: { enabled: false, minIntervalSec: 15, maxIntervalSec: 45 },
    webhook: { webhookUrl: '', eventWatchEnabled: true },
    autoCommands: [],
    renderDistance: 4,
    autoRespawn: true,
    autoReconnect: true,
  };
}

export function patchFeatures(sid: string, patch: Partial<FeatureState>) {
  setState((s) => ({ features: { ...s.features, [sid]: { ...(s.features[sid] ?? defaultFeatures()), ...patch } } }));
}
export const setConn = (sid: string, conn: ConnState) =>
  setState((s) => (s.conn[sid] === conn ? {} : { conn: { ...s.conn, [sid]: conn } }));

let msgId = 0;
export function addMsg(sid: string, text: string, level: MsgLevel = 'normal', kind: 'chat' | 'sys' = 'sys') {
  if (!text) return;
  setState((s) => {
    const next = s.messages.length >= MAX_MESSAGES ? s.messages.slice(-(MAX_MESSAGES - 1)) : s.messages.slice();
    next.push({ id: ++msgId, sid, kind, level, text, ts: Date.now() });
    return { messages: next };
  });
}
export const clearMessages = (sid: string | null, all: boolean) =>
  setState((s) => ({ messages: all || !sid ? [] : s.messages.filter((m) => m.sid !== sid) }));

let toastId = 0;
export function toast(text: string, kind: ToastKind = 'info') {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, kind, text }] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3500);
}

// ───────── aksi UI ─────────
export function selectSession(sid: string | null) {
  if (sid) {
    storage.set(SID_KEY, sid);
    setState((s) => ({
      activeSid: sid,
      drawerOpen: false,
      map: s.map?.sid === sid ? s.map : null,
      entities: [],
      features: s.features[sid] ? s.features : { ...s.features, [sid]: defaultFeatures() },
    }));
    emit('mc:subscribe', { sessionId: sid });
    emit('mc:info', { sessionId: sid });
  } else {
    setState({ activeSid: null, map: null, entities: [] });
  }
}

export function restoreLastSession(sessions: SessionSummary[]) {
  const last = storage.get(SID_KEY);
  if (last && sessions.some((x) => x.sessionId === last)) selectSession(last);
  else if (sessions.length === 1) selectSession(sessions[0].sessionId);
}

export function setChatMode(mode: 'single' | 'all') {
  storage.set(MODE_KEY, mode);
  setState({ chatMode: mode });
  syncChatSubscriptions();
}
export function loadPrefs() {
  const mode = storage.get(MODE_KEY) === 'all' ? 'all' : 'single';
  setState({ chatMode: mode });
}

/** Mode "All Chat" butuh chat dari semua sesi; mode biasa cukup room sesi aktif. */
export function syncChatSubscriptions() {
  const s = state;
  emit('mc:subscribe_chat', { sessionIds: s.chatMode === 'all' ? s.sessions.map((x) => x.sessionId) : [] });
}

export const openDrawer = (open: boolean) => setState({ drawerOpen: open });
export const setTab = (tab: TabId) => setState({ tab });
