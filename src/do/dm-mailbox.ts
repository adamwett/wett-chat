import { DurableObject } from 'cloudflare:workers';

// ─── Types ───────────────────────────────────────────────────────────────────

type DmServerEvent =
  | { type: 'keys'; ecdsaPub: string | null; ecdhPub: string | null }
  | {
      type: 'dm';
      direction: 'in' | 'out';
      peer: string;
      from: string;
      ciphertext: string;
      iv: string;
      sig: string;
      timestamp: number;
    };

type DmMessageRow = {
  direction: string;
  from_hash: string;
  to_hash: string | null;
  ciphertext: string;
  iv: string;
  sig: string;
  timestamp: number;
};

// ─── DmMailbox ───────────────────────────────────────────────────────────────
// A per-user mailbox for end-to-end encrypted DMs.
// The server stores and relays opaque blobs; all cryptography is done by clients.

export class DmMailbox extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS pubkeys (
        ecdsa_pub TEXT NOT NULL,
        ecdh_pub  TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        from_hash  TEXT    NOT NULL,
        ciphertext TEXT    NOT NULL,
        iv         TEXT    NOT NULL,
        sig        TEXT    NOT NULL,
        timestamp  INTEGER NOT NULL
      );
    `);
    // Migrations
    try {
      ctx.storage.sql.exec(`ALTER TABLE messages ADD COLUMN to_hash TEXT`);
    } catch {
      /* exists */
    }
    try {
      ctx.storage.sql.exec(`ALTER TABLE messages ADD COLUMN direction TEXT NOT NULL DEFAULT 'in'`);
    } catch {
      /* exists */
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // POST /register — store owner's public keys (idempotent: first write wins)
    if (url.pathname === '/register' && request.method === 'POST') {
      const body = (await request.json()) as { ecdsaPub: string; ecdhPub: string };
      if (!body.ecdsaPub || !body.ecdhPub) {
        return new Response('ecdsaPub and ecdhPub required', { status: 400 });
      }
      const existing = this.ctx.storage.sql.exec('SELECT COUNT(*) as cnt FROM pubkeys').one() as { cnt: number };
      if (existing.cnt === 0) {
        this.ctx.storage.sql.exec(
          'INSERT INTO pubkeys (ecdsa_pub, ecdh_pub) VALUES (?, ?)',
          body.ecdsaPub,
          body.ecdhPub,
        );
      }
      return new Response(null, { status: 204 });
    }

    // GET /pubkey — return the owner's public keys so others can encrypt DMs
    if (url.pathname === '/pubkey' && request.method === 'GET') {
      const row = this.ctx.storage.sql.exec('SELECT ecdsa_pub, ecdh_pub FROM pubkeys LIMIT 1').one() as {
        ecdsa_pub: string;
        ecdh_pub: string;
      } | null;
      if (!row) return new Response('Not registered', { status: 404 });
      return Response.json({ ecdsaPub: row.ecdsa_pub, ecdhPub: row.ecdh_pub });
    }

    // POST /send — client sends a DM via their own mailbox.
    // Stores the message as 'out' in the sender's mailbox, then forwards to recipient.
    if (url.pathname === '/send' && request.method === 'POST') {
      const body = (await request.json()) as { to: string; from: string; ciphertext: string; iv: string; sig: string };
      if (!body.to || !body.from || !body.ciphertext || !body.iv || !body.sig) {
        return new Response('to, from, ciphertext, iv, sig required', { status: 400 });
      }
      const timestamp = Date.now();

      // Store as sent in sender's mailbox
      this.ctx.storage.sql.exec(
        `INSERT INTO messages (from_hash, to_hash, direction, ciphertext, iv, sig, timestamp)
         VALUES (?, ?, 'out', ?, ?, ?, ?)`,
        body.from,
        body.to,
        body.ciphertext,
        body.iv,
        body.sig,
        timestamp,
      );

      // Deliver to recipient's mailbox DO
      const recipientId = this.env.DMMAILBOX.idFromName(body.to);
      await this.env.DMMAILBOX.get(recipientId).fetch(
        new Request('http://do-internal/deliver', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: body.from, ciphertext: body.ciphertext, iv: body.iv, sig: body.sig }),
        }),
      );

      return new Response(null, { status: 204 });
    }

    // POST /deliver — called by another DO to deliver an inbound DM.
    if (url.pathname === '/deliver' && request.method === 'POST') {
      const body = (await request.json()) as { from: string; ciphertext: string; iv: string; sig: string };
      if (!body.from || !body.ciphertext || !body.iv || !body.sig) {
        return new Response('from, ciphertext, iv, sig required', { status: 400 });
      }
      const timestamp = Date.now();
      this.ctx.storage.sql.exec(
        `INSERT INTO messages (from_hash, direction, ciphertext, iv, sig, timestamp)
         VALUES (?, 'in', ?, ?, ?, ?)`,
        body.from,
        body.ciphertext,
        body.iv,
        body.sig,
        timestamp,
      );

      // Push to connected owner clients
      const event: DmServerEvent = {
        type: 'dm',
        direction: 'in',
        peer: body.from,
        from: body.from,
        ciphertext: body.ciphertext,
        iv: body.iv,
        sig: body.sig,
        timestamp,
      };
      const payload = JSON.stringify(event);
      for (const ws of this.ctx.getWebSockets()) {
        ws.send(payload);
      }
      return new Response(null, { status: 204 });
    }

    // GET /messages — full mailbox history (both sent and received)
    if (url.pathname === '/messages' && request.method === 'GET') {
      const rows = this.ctx.storage.sql
        .exec<DmMessageRow>(
          `SELECT direction, from_hash, to_hash, ciphertext, iv, sig, timestamp
           FROM messages ORDER BY timestamp ASC`,
        )
        .toArray();
      return Response.json(
        rows.map((r) => ({
          direction: r.direction,
          peer: r.direction === 'out' ? r.to_hash : r.from_hash,
          from: r.from_hash,
          ciphertext: r.ciphertext,
          iv: r.iv,
          sig: r.sig,
          timestamp: r.timestamp,
        })),
      );
    }

    // GET /ws — WebSocket for the owner to receive live DMs
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Not found', { status: 404 });
  }

  async webSocketOpen(ws: WebSocket): Promise<void> {
    const keyRow = this.ctx.storage.sql.exec('SELECT ecdsa_pub, ecdh_pub FROM pubkeys LIMIT 1').one() as {
      ecdsa_pub: string;
      ecdh_pub: string;
    } | null;
    ws.send(
      JSON.stringify({
        type: 'keys',
        ecdsaPub: keyRow?.ecdsa_pub ?? null,
        ecdhPub: keyRow?.ecdh_pub ?? null,
      } satisfies DmServerEvent),
    );
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, 'WebSocket error');
    } catch {
      /* already closed */
    }
  }
}
