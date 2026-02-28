// In production the frontend and backend run in the same worker (same origin).
// HTTP calls use relative paths; WebSocket URL is derived from window.location.

export const CHAT_HTTP_URL = import.meta.env.PROD ? '' : 'http://localhost:8787';

export const CHAT_WS_URL = (() => {
  if (typeof window === 'undefined') return ''; // SSR: never actually used for connections
  if (!import.meta.env.PROD) return 'ws://localhost:8787';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
})();
