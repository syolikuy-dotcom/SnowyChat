'use client';
import { useEffect } from 'react';
import type { Socket } from 'socket.io-client';
import { emit, getSocket } from './socket';
import {
  addMsg, getState, loadPrefs, patchFeatures, restoreLastSession, selectSession, setConn, setState,
  syncChatSubscriptions, toast,
} from './store';
import type {
  AntiAfkStatus, AutoBowStatus, AutoCommand, AutoHitStatus, AutoSellStatus, CmdScheduleStatus,
  ContainerState, DbHealth, GensEvent, Inventory, MapEntity, MapPos, MsgLevel, NearbyEntity,
  PingResult, SessionInfo, SessionSummary, Stats, WebhookStatus, WinItems,
} from './types';

type WithSid<T> = T & { sessionId?: string };
const POLL_MS = 3000;
const EVENT_LEVEL: Record<string, MsgLevel> = {
  death: 'error', respawn: 'ok', join: 'join', leave: 'leave', eat: 'info', bow: 'info',
  lag: 'warning', info: 'info', cmd: 'info', cmdsched: 'info', autosell: 'ok',
};

/** Menghubungkan semua event Socket.IO ke store. Dipasang sekali di AppShell. */
export function useSocketBridge() {
  useEffect(() => {
    const socket: Socket = getSocket();
    loadPrefs();

    const isActive = (sid?: string) => !sid || sid === getState().activeSid;
    const target = (sid?: string) => sid ?? getState().activeSid;

    const handlers: Record<string, (...a: never[]) => void> = {
      connect: () => {
        setState({ socketUp: true, authFailed: false });
        emit('mc:list_bots');
        const sid = getState().activeSid;
        if (sid) {
          // Room hilang saat reconnect, jadi subscribe ulang.
          emit('mc:subscribe', { sessionId: sid });
          emit('mc:info', { sessionId: sid });
        }
        syncChatSubscriptions();
      },
      disconnect: () => {
        setState({ socketUp: false });
        toast('Server disconnected', 'er');
      },
      connect_error: (err: Error) => {
        if (err?.message === 'unauthorized') setState({ authFailed: true });
      },

      persistent_sessions: (sessions: SessionSummary[]) => {
        const prev = getState();
        const hadNone = prev.sessions.length === 0;
        const stillThere = prev.activeSid && sessions.some((s) => s.sessionId === prev.activeSid);
        setState({ sessions, ...(prev.activeSid && !stillThere ? { activeSid: null, map: null } : {}) });
        if (hadNone && !prev.activeSid && sessions.length) restoreLastSession(sessions);
        if (prev.chatMode === 'all') syncChatSubscriptions();
      },
      db_health: (h: DbHealth) => setState({ dbHealth: h }),
      session_created: ({ sessionId }: { sessionId: string }) => {
        toast('Bot created!', 'ok');
        selectSession(sessionId);
      },
      session_updated: () => toast('Session updated', 'ok'),

      status: ({ type, message, sessionId }: WithSid<{ type: string; message: string }>) => {
        const sid = target(sessionId);
        const active = isActive(sessionId);
        if (sid) addMsg(sid, message, type === 'error' || type === 'kicked' ? 'error' : 'system', 'sys');
        if (sid && sessionId) {
          if (type === 'spawned') {
            setConn(sid, 'online');
            if (active) emit('mc:get_inventory', { sessionId: sid });
          } else if (['connected', 'connecting', 'queued', 'reconnecting'].includes(type)) setConn(sid, 'connecting');
          else if (type === 'kicked' || type === 'disconnected') setConn(sid, 'offline');
        }
        if (!active) return;
        if (type === 'spawned') toast('Bot ready!', 'ok');
        else if (type === 'kicked' || type === 'error') toast(message, 'er');
        else if (type === 'warn') toast(message, 'warn');
      },

      chat: ({ raw, self, sessionId }: WithSid<{ raw: string; self?: boolean }>) => {
        const sid = target(sessionId);
        if (sid) addMsg(sid, raw, self ? 'self' : 'normal', 'chat');
      },
      event: ({ message, type, sessionId }: WithSid<{ message: string; type: string }>) => {
        const sid = target(sessionId);
        if (sid) addMsg(sid, message, EVENT_LEVEL[type] ?? 'info', 'sys');
      },
      stats: ({ sessionId, ...stats }: WithSid<Stats>) => {
        if (!sessionId) return;
        setState((s) => ({ stats: { ...s.stats, [sessionId]: { ...s.stats[sessionId], ...stats } } }));
      },
      info: (info: SessionInfo) => {
        if (!info?.sessionId) return;
        const sid = info.sessionId;
        setConn(sid, info.isDead ? 'dead' : info.connected ? 'online' : getState().conn[sid] === 'connecting' ? 'connecting' : 'offline');
        setState((s) => ({
          info: { ...s.info, [sid]: info },
          stats: info.connected ? { ...s.stats, [sid]: { ...s.stats[sid], health: info.health, food: info.food, ping: info.ping, saturation: info.saturation } } : s.stats,
        }));
        patchFeatures(sid, {
          autoHit: info.autoHit, autoBow: info.autoBow, rightClick: info.rightClickMode,
          schedule: info.commandSchedule, autoSell: info.autoSell, antiAfk: info.antiAfk, autoReconnect: info.autoReconnect,
        });
      },
      entities_list: ({ entities, sessionId }: WithSid<{ entities: NearbyEntity[] }>) => {
        if (isActive(sessionId)) setState({ entities });
      },
      inventory: ({ sessionId, ...inv }: WithSid<Inventory>) => {
        if (sessionId) setState((s) => ({ inventory: { ...s.inventory, [sessionId]: inv as Inventory } }));
      },
      map_data: ({ pos, entities, sessionId }: WithSid<{ pos: MapPos | null; entities?: MapEntity[] }>) => {
        if (!sessionId || sessionId !== getState().activeSid) return;
        setState((s) => ({ map: { sid: sessionId, pos, entities: entities ?? (s.map?.sid === sessionId ? s.map.entities : []) } }));
      },
      container_items: ({ ok, items, sessionId }: WithSid<{ ok: boolean; items?: WinItems }>) => {
        if (!ok || !items || !sessionId) return;
        setState((s) => {
          const cur = s.container[sessionId];
          return cur ? { container: { ...s.container, [sessionId]: { ...cur, items } } } : {};
        });
      },
      window: ({ type, title, items, inventoryStart, sessionId }: WithSid<{ type: 'open' | 'close'; title?: string; items?: WinItems; inventoryStart?: number }>) => {
        if (!sessionId) return;
        if (type === 'open') {
          const c: ContainerState = { title: title || 'Container', items: items ?? { container: [], botInv: [] }, inventoryStart: inventoryStart ?? 27 };
          setState((s) => ({ container: { ...s.container, [sessionId]: c } }));
          if (isActive(sessionId)) {
            emit('mc:get_inventory', { sessionId });
            if (getState().tab === 'inv') setState({ invSub: 'chest' });
            else toast(`Container: ${c.title}`, 'info');
          }
        } else {
          setState((s) => ({ container: { ...s.container, [sessionId]: null }, invSub: s.invSub === 'chest' && s.activeSid === sessionId ? 'inv' : s.invSub }));
        }
      },

      auto_hit_status: ({ sessionId, ...v }: WithSid<AutoHitStatus>) => sessionId && patchFeatures(sessionId, { autoHit: v }),
      auto_bow_status: ({ sessionId, ...v }: WithSid<AutoBowStatus>) => sessionId && patchFeatures(sessionId, { autoBow: v }),
      right_click_mode_status: ({ enabled, sessionId }: WithSid<{ enabled: boolean }>) => sessionId && patchFeatures(sessionId, { rightClick: enabled }),
      cmd_schedule_status: ({ sessionId, ...v }: WithSid<CmdScheduleStatus>) => sessionId && patchFeatures(sessionId, { schedule: v }),
      auto_sell_status: ({ sessionId, ...v }: WithSid<AutoSellStatus>) => sessionId && patchFeatures(sessionId, { autoSell: v }),
      anti_afk_status: ({ sessionId, ...v }: WithSid<AntiAfkStatus>) => sessionId && patchFeatures(sessionId, { antiAfk: v }),
      webhook_status: ({ sessionId, ...v }: WithSid<WebhookStatus>) => sessionId && patchFeatures(sessionId, { webhook: v }),
      auto_commands_updated: ({ commands, sessionId }: WithSid<{ commands: AutoCommand[] }>) => sessionId && patchFeatures(sessionId, { autoCommands: commands }),
      render_distance_status: ({ distance, sessionId }: WithSid<{ distance: number }>) => sessionId && patchFeatures(sessionId, { renderDistance: distance }),
      webhook_test_result: ({ ok, error, sessionId }: WithSid<{ ok: boolean; error?: string }>) => {
        if (isActive(sessionId)) toast(ok ? 'Webhook OK — cek channel Discord kamu' : `Webhook gagal: ${error ?? 'unknown'}`, ok ? 'ok' : 'er');
      },
      gens_event: ({ eventName, action, multiplier, sessionId }: WithSid<GensEvent>) => {
        if (isActive(sessionId)) toast(`${eventName}${multiplier ? ` ${multiplier}x` : ''} ${action === 'started' ? 'dimulai' : 'berakhir'}`, action === 'started' ? 'ok' : 'info');
      },
      ping_result: (r: PingResult) => setState({ ping: r, pinging: false }),
    };

    for (const [ev, fn] of Object.entries(handlers)) socket.on(ev, fn as (...a: unknown[]) => void);
    if (!socket.connected) socket.connect();
    else handlers.connect();

    // Info bot dipoll berkala (uptime, posisi, pemain) hanya untuk sesi aktif yang online.
    const poll = setInterval(() => {
      const { activeSid, conn } = getState();
      if (activeSid && socket.connected && conn[activeSid] !== 'offline') emit('mc:info', { sessionId: activeSid });
    }, POLL_MS);
    const dbPoll = setInterval(() => socket.connected && emit('mc:list_bots'), 30_000);

    return () => {
      clearInterval(poll);
      clearInterval(dbPoll);
      for (const [ev, fn] of Object.entries(handlers)) socket.off(ev, fn as (...a: unknown[]) => void);
      socket.disconnect();
    };
  }, []);
}
