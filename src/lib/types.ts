// Tipe payload Socket.IO — cerminan dari server/botManager.mjs & server/socket.mjs.
export type ConnState = 'offline' | 'connecting' | 'online' | 'dead';
export type TabId = 'chat' | 'info' | 'inv' | 'map' | 'settings';
export type ToastKind = 'ok' | 'er' | 'info' | 'warn';

export interface SessionSummary {
  sessionId: string;
  host: string;
  port: number;
  username: string;
  version: string | null;
  createdAt?: number;
  lastActive?: number;
  connected: boolean;
  autoHitEnabled: boolean;
  autoBowEnabled: boolean;
  commandScheduleEnabled: boolean;
  autoSellEnabled: boolean;
  antiAfkEnabled: boolean;
  autoRespawn: boolean;
  autoReconnect: boolean;
  uptime: string | null;
  containerOpen: boolean;
}

export interface PlayerEntry {
  name: string;
  ping: number;
}

export interface SessionInfo {
  sessionId: string;
  username: string;
  host: string;
  port: number;
  version: string | null;
  health: number;
  food: number;
  saturation: number;
  ping: number;
  gamemode: string | number;
  dimension: string;
  players: PlayerEntry[];
  connected: boolean;
  isDead: boolean;
  uptime: string | null;
  containerOpen: boolean;
  position: { x: number; y: number; z: number } | null;
  onGround?: boolean;
  standingOn?: string | null;
  autoHit: AutoHitStatus;
  autoBow: AutoBowStatus;
  commandSchedule: CmdScheduleStatus;
  autoSell: AutoSellStatus;
  antiAfk: AntiAfkStatus;
  rightClickMode: boolean;
  autoReconnect: boolean;
}

export interface Stats {
  health: number;
  food: number;
  ping: number;
  saturation?: number;
  uptime?: string | null;
}

export interface InvItem {
  slot: number;
  type: number;
  name: string;
  displayName: string;
  count: number;
  stackSize?: number;
  durabilityUsed?: number;
  maxDurability?: number | null;
}
export type EquipDest = 'head' | 'torso' | 'legs' | 'feet' | 'offhand';
export interface Inventory {
  ok: boolean;
  items: InvItem[];
  equipment: Record<EquipDest, InvItem | null>;
  hotbar: (InvItem | null)[];
  heldItem: { slot: number; name: string; displayName: string; count: number } | null;
  selectedSlot: number;
}

export interface WinEntry {
  slot: number;
  name: string;
  displayName: string;
  count: number;
  type: number;
}
export interface WinItems {
  container: WinEntry[];
  botInv: WinEntry[];
}
export interface ContainerState {
  title: string;
  items: WinItems;
  inventoryStart: number;
}

export interface MapEntity {
  x: number;
  z: number;
  type: 'player' | 'mob' | 'item';
  name: string;
  distance: number;
}
export interface MapPos {
  x: number;
  y: number;
  z: number;
  yaw?: number;
  pitch?: number;
}
export interface NearbyEntity {
  id: number;
  type: string;
  name: string;
  isPlayer: boolean;
  health?: number;
  distance: number;
}

export interface AutoHitStatus {
  enabled: boolean;
  armed?: boolean;
  delay: number;
}
export interface AutoBowStatus {
  enabled: boolean;
  range: number;
}
export interface ScheduleEntry {
  cmd: string;
  intervalMs: number;
}
export interface CmdScheduleStatus {
  enabled: boolean;
  schedules: ScheduleEntry[];
}
export interface AutoSellConfig {
  command: string;
  triggerMode: 'inventory' | 'event' | 'both';
  inventoryThresholdPercent: number;
  cooldownMs: number;
  eventKeyword: string;
}
export interface AutoSellStatus {
  enabled: boolean;
  config: Partial<AutoSellConfig>;
}
export interface AntiAfkStatus {
  enabled: boolean;
  minIntervalSec: number;
  maxIntervalSec: number;
}
export interface WebhookStatus {
  webhookUrl: string;
  eventWatchEnabled: boolean;
}
export interface AutoCommand {
  cmd: string;
  delay: number;
}

/** Status fitur per sesi di sisi klien. */
export interface FeatureState {
  autoHit: AutoHitStatus;
  autoBow: AutoBowStatus;
  rightClick: boolean;
  schedule: CmdScheduleStatus;
  autoSell: AutoSellStatus;
  antiAfk: AntiAfkStatus;
  webhook: WebhookStatus;
  autoCommands: AutoCommand[];
  renderDistance: number;
  autoRespawn: boolean;
  autoReconnect: boolean;
}

export type MsgLevel = 'normal' | 'self' | 'system' | 'error' | 'ok' | 'info' | 'warning' | 'join' | 'leave';
export interface Msg {
  id: number;
  sid: string;
  kind: 'chat' | 'sys';
  level: MsgLevel;
  text: string;
  ts: number;
}

export interface PingResult {
  ok: boolean;
  error?: string;
  motd?: string;
  players?: number;
  maxPlayers?: number;
  version?: string;
}

export interface DbHealth {
  ready: boolean;
  lastFlushOk: boolean | null;
  lastIntegrityCheckOk: boolean | null;
  writeFailCount: number;
  recoveredFromCorruption: boolean;
  sessionCountInDb: number | null;
}

export interface GensEvent {
  eventName: string;
  action: 'started' | 'ended';
  multiplier: string | null;
  duration: string | null;
  nextIn: string | null;
  ts: number;
}
