import { DurableObject } from 'cloudflare:workers';

type ChatClientMessage = { type: 'join'; user: string; secret: string } | { type: 'message'; text: string };

type PersistedMessage = { type: 'message'; user: string; signature: string; text: string; timestamp: number };

type ChatServerMessage =
  | { type: 'join'; user: string; signature: string; timestamp: number }
  | { type: 'leave'; user: string; signature: string; timestamp: number }
  | PersistedMessage
  | { type: 'error'; text: string }
  | { type: 'history'; messages: PersistedMessage[] };

type WsAttachment = { user: string; signature: string };

type MessageRow = { user: string; signature: string; text: string; timestamp: number };

async function sha256hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export class ChatRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        user      TEXT    NOT NULL,
        signature TEXT    NOT NULL,
        text      TEXT    NOT NULL,
        timestamp INTEGER NOT NULL
      )
    `);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    let msg: ChatClientMessage;
    try {
      msg = JSON.parse(raw as string) as ChatClientMessage;
    } catch {
      ws.send(JSON.stringify({ type: 'error', text: 'Invalid JSON' } satisfies ChatServerMessage));
      return;
    }

    const attachment = ws.deserializeAttachment() as WsAttachment | null;

    if (msg.type === 'join') {
      if (attachment?.user) {
        ws.send(JSON.stringify({ type: 'error', text: 'Already joined' } satisfies ChatServerMessage));
        return;
      }

      const user = msg.user.trim().slice(0, 32);
      if (!user) {
        ws.send(JSON.stringify({ type: 'error', text: 'Username required' } satisfies ChatServerMessage));
        return;
      }

      const secret = String(msg.secret ?? '').slice(0, 256);
      const signature = await sha256hex(secret);

      ws.serializeAttachment({ user, signature });
      this.broadcast(ws, { type: 'join', user, signature, timestamp: Date.now() });

      const messages = this.ctx.storage.sql
        .exec<MessageRow>('SELECT user, signature, text, timestamp FROM messages ORDER BY timestamp ASC LIMIT 100')
        .toArray()
        .map((row) => ({ type: 'message' as const, ...row }));

      ws.send(JSON.stringify({ type: 'history', messages } satisfies ChatServerMessage));
      return;
    }

    if (msg.type === 'message') {
      if (!attachment?.user) {
        ws.send(JSON.stringify({ type: 'error', text: 'Send a join message first' } satisfies ChatServerMessage));
        return;
      }

      const text = msg.text.trim().slice(0, 2000);
      if (!text) return;

      const timestamp = Date.now();

      this.ctx.storage.sql.exec(
        'INSERT INTO messages (user, signature, text, timestamp) VALUES (?, ?, ?, ?)',
        attachment.user,
        attachment.signature,
        text,
        timestamp,
      );

      this.broadcast(null, {
        type: 'message',
        user: attachment.user,
        signature: attachment.signature,
        text,
        timestamp,
      });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const attachment = ws.deserializeAttachment() as WsAttachment | null;
    if (attachment?.user) {
      this.broadcast(ws, {
        type: 'leave',
        user: attachment.user,
        signature: attachment.signature,
        timestamp: Date.now(),
      });
    }
    ws.close(code, reason);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as WsAttachment | null;
    if (attachment?.user) {
      this.broadcast(ws, {
        type: 'leave',
        user: attachment.user,
        signature: attachment.signature,
        timestamp: Date.now(),
      });
    }
    ws.close(1011, 'WebSocket error');
  }

  private broadcast(exclude: WebSocket | null, msg: ChatServerMessage): void {
    const payload = JSON.stringify(msg);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket !== exclude) {
        socket.send(payload);
      }
    }
  }
}
