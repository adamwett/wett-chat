export const CHAT_WS_URL = import.meta.env.PROD ? import.meta.env.VITE_CHAT_WS_URL : 'ws://localhost:8787';

export const CHAT_HTTP_URL = CHAT_WS_URL.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');
