'use client';
import { io, type Socket } from 'socket.io-client';
import type { ClientEvent } from './events';

const TOKEN_KEY = 'snowychat:token';
let socket: Socket | null = null;

/** Token dibaca dari #token=... di URL (lalu dihapus dari address bar) atau localStorage. */
function readToken(): string {
  try {
    const m = /(?:^|[#&])token=([^&]+)/.exec(window.location.hash);
    if (m) {
      localStorage.setItem(TOKEN_KEY, decodeURIComponent(m[1]));
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage diblokir */
  }
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io({
      autoConnect: false,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      auth: (cb) => cb({ token: readToken() }),
    });
  }
  return socket;
}

export function emit(event: ClientEvent, payload: Record<string, unknown> = {}) {
  getSocket().emit(event, payload);
}
